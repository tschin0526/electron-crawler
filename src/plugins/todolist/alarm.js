(() => {
  const api = window.electronAPI;
  const alarmEl = document.getElementById('alarm');
  const cardsEl = document.getElementById('cards');
  const errorEl = document.getElementById('error');
  const soundEl = document.getElementById('sound');
  const animationEl = document.getElementById('animation');
  const settingsStatus = document.getElementById('settings-status');
  const alarms = new Map();
  const cardErrors = new Map();
  let audioContext = null;
  let ringTimer = null;
  let elapsedTimer = null;
  let settingsTimer = null;
  let actionPending = false;
  let currentSound = 'classic';

  function setAnimation(mode) {
    alarmEl.className = 'alarm alarm-' + mode;
  }

  function playSound(mode) {
    if (mode === 'silent') return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('浏览器不支持 Web Audio');
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === 'suspended') audioContext.resume();
      const now = audioContext.currentTime;
      const notes = mode === 'sci-fi' ? [[660, 0], [990, .18], [740, .36]] :
        mode === 'chime' ? [[880, 0], [1175, .2], [1568, .4]] : [[740, 0], [880, .22]];
      notes.forEach(([frequency, offset]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = mode === 'chime' ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(.12, now + offset + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .18);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + .2);
      });
    } catch (error) {
      console.error('[Alarm] 播放铃声失败:', error);
      settingsStatus.textContent = '无法播放铃声：' + error.message;
    }
  }

  function startRinging() {
    stopRinging();
    playSound(currentSound);
    if (currentSound !== 'silent') ringTimer = setInterval(() => playSound(currentSound), 2400);
  }

  function stopRinging() {
    if (ringTimer) clearInterval(ringTimer);
    ringTimer = null;
  }

  function setBusy(busy) {
    actionPending = busy;
    cardsEl.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  }

  function formatDateTime(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(timestamp));
  }

  function formatElapsed(timestamp, now) {
    const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    const days = Math.floor(elapsedSeconds / 86400);
    const hours = Math.floor((elapsedSeconds % 86400) / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const parts = [];
    if (days) parts.push(days + ' 天');
    if (hours || days) parts.push(hours + ' 小时');
    if (minutes || hours || days) parts.push(minutes + ' 分');
    parts.push(seconds + ' 秒');
    return '已提醒 ' + parts.join(' ');
  }

  function updateElapsedTimes() {
    const now = Date.now();
    cardsEl.querySelectorAll('[data-due-at]').forEach((element) => {
      const dueAt = Number(element.dataset.dueAt);
      if (Number.isFinite(dueAt)) element.textContent = formatElapsed(dueAt, now);
    });
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createActionButton(label, action, alarmId, className) {
    const button = createTextElement('button', 'button ' + className, label);
    button.type = 'button';
    button.disabled = actionPending;
    button.addEventListener('click', () => act(action, alarmId));
    return button;
  }

  function renderAlarms() {
    const list = Array.from(alarms.values());
    const count = list.length;
    document.getElementById('alarm-count').textContent = String(count);
    document.getElementById('empty').hidden = count > 0;
    cardsEl.classList.toggle('density-one', count === 1);
    cardsEl.classList.toggle('density-5', count >= 5 && count < 9);
    cardsEl.classList.toggle('density-9', count >= 9);
    cardsEl.replaceChildren();

    list.forEach((alarm, index) => {
      const card = document.createElement('article');
      card.className = 'alarm-card';
      card.dataset.alarmId = alarm.id;

      const top = document.createElement('div');
      top.className = 'card-top';
      top.appendChild(createTextElement('span', 'card-index', 'ALERT ' + String(index + 1).padStart(2, '0')));
      top.appendChild(createTextElement('span', 'card-date', alarm.date ? '行程日期 · ' + alarm.date : '即时提醒'));
      card.appendChild(top);
      card.appendChild(createTextElement('p', 'card-message', alarm.message || '您有一项行程需要处理。'));
      card.appendChild(createTextElement('p', 'card-title', alarm.title || '行程提醒'));
      card.appendChild(createTextElement('p', 'card-when',
        '提醒时间 · ' + formatDateTime(alarm.dueAt)));
      const elapsed = createTextElement('p', 'card-elapsed', '');
      elapsed.dataset.dueAt = String(alarm.dueAt);
      elapsed.setAttribute('aria-label', '闹铃提醒已经过时间');
      card.appendChild(elapsed);
      card.appendChild(createTextElement('p', 'card-error', cardErrors.get(alarm.id) || ''));

      const actions = document.createElement('div');
      actions.className = 'card-actions';
      actions.appendChild(createActionButton('稍后提醒', 'snooze', alarm.id, 'secondary'));
      actions.appendChild(createActionButton('完成', 'complete', alarm.id, 'primary'));
      card.appendChild(actions);
      cardsEl.appendChild(card);
    });
    updateElapsedTimes();
  }

  function updateAlarms(list) {
    const next = new Map();
    (Array.isArray(list) ? list : []).forEach((alarm) => {
      if (!alarm || typeof alarm.id !== 'string') return;
      next.set(alarm.id, alarm);
    });
    alarms.clear();
    next.forEach((alarm, id) => alarms.set(id, alarm));
    cardErrors.forEach((_, id) => {
      if (!alarms.has(id)) cardErrors.delete(id);
    });
    renderAlarms();
  }

  async function act(action, alarmId) {
    if (actionPending || !alarms.has(alarmId) || !api || !api.alarmAction) return;
    setBusy(true);
    errorEl.textContent = '';
    cardErrors.delete(alarmId);
    renderAlarms();
    try {
      const result = await api.alarmAction(action, alarmId);
      if (!result || !result.ok) {
        cardErrors.set(alarmId, (result && result.error) || '操作失败，提醒仍会继续响铃');
        setBusy(false);
        renderAlarms();
      } else if (!alarms.size) {
        stopRinging();
      } else {
        setBusy(false);
        renderAlarms();
      }
    } catch (error) {
      cardErrors.set(alarmId, error.message || '操作失败，提醒仍会继续响铃');
      setBusy(false);
      renderAlarms();
    }
  }

  async function savePreferences() {
    settingsStatus.textContent = '';
    try {
      const result = await api.saveAlarmSettings({
        sound: soundEl.value,
        animation: animationEl.value
      });
      if (!result || !result.ok) throw new Error((result && result.error) || '保存失败');
      currentSound = result.settings.sound;
      setAnimation(result.settings.animation);
      settingsStatus.textContent = '设置已保存';
      if (settingsTimer) clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => { settingsStatus.textContent = ''; }, 1800);
      if (ringTimer) startRinging();
    } catch (error) {
      settingsStatus.textContent = '设置保存失败：' + error.message;
    }
  }

  async function loadPreferences() {
    try {
      const result = await api.loadAlarmSettings();
      if (!result || !result.ok) throw new Error((result && result.error) || '读取失败');
      currentSound = result.settings.sound;
      soundEl.value = currentSound;
      animationEl.value = result.settings.animation;
      setAnimation(result.settings.animation);
    } catch (error) {
      console.error('[Alarm] 读取闹铃设置失败:', error);
      settingsStatus.textContent = '读取设置失败：' + error.message;
    }
  }

  soundEl.addEventListener('change', savePreferences);
  animationEl.addEventListener('change', savePreferences);
  document.getElementById('preview-sound').addEventListener('click', () => playSound(soundEl.value));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && alarms.size) {
      act('complete', alarms.keys().next().value);
    }
  });

  api.onAlarmShow(({ alarms: initialAlarms, settings }) => {
    updateAlarms(initialAlarms);
    if (settings && settings.sound) {
      currentSound = settings.sound;
      soundEl.value = settings.sound;
      animationEl.value = settings.animation;
      setAnimation(settings.animation);
    }
    startRinging();
    loadPreferences();
    const firstButton = cardsEl.querySelector('.secondary');
    if (firstButton) firstButton.focus();
  });

  api.onAlarmUpdate(({ alarms: updatedAlarms }) => updateAlarms(updatedAlarms));
  api.onAlarmActionError((payload) => {
    const id = payload && payload.alarmId;
    if (id && alarms.has(id)) cardErrors.set(id, payload.error || '写入失败，提醒仍会继续响铃');
    else errorEl.textContent = (payload && payload.error) || '写入失败，提醒仍会继续响铃';
    setBusy(false);
    renderAlarms();
  });

  elapsedTimer = setInterval(updateElapsedTimes, 1000);
  window.addEventListener('beforeunload', () => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    stopRinging();
  });

  loadPreferences();
})();
