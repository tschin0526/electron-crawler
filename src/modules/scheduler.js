/**
 * 排程管理模组
 * 从 renderer.js 拆分而来
 * 依赖：showStatus, addFloatHistoryEntry, sendToCard, sendEmailViaPlugin（来自 renderer.js / email.js）
 */

// ========== 启动时执行的排程 ==========

async function executeStartupSchedules() {
  try {
    const startupSchedules = schedules.filter(s => s.recurrence === 'startup' && s.enabled);
    if (startupSchedules.length === 0) {
      console.log('[Scheduler] 无启动时执行的排程');
      return;
    }

    startupSchedules.sort((a, b) => (a.priority || 999) - (b.priority || 999));

    console.log('[Scheduler] 发现', startupSchedules.length, '个启动时执行的排程，按优先级排序后开始串行执行');

    for (let i = 0; i < startupSchedules.length; i++) {
      const schedule = startupSchedules[i];
      const delay = schedule.delaySeconds || 3;

      console.log(`[Scheduler] 执行第 ${i + 1}/${startupSchedules.length} 个排程: ${schedule.prompt}`);
      addSchedulerLog('info', `执行启动排程 ${i + 1}/${startupSchedules.length}: ${schedule.prompt}`);

      try {
        if (schedule.resultSendMethod === 'email' && schedule.emailRecipients) {
          window.scheduleEmailRecipientsValue = schedule.emailRecipients;
          console.log(`[Scheduler] 📧 启动排程邮件已设置，收件人: ${schedule.emailRecipients}`);
        } else {
          window.scheduleEmailRecipientsValue = '';
        }

        addFloatHistoryEntry({
          type: 'sent',
          source: '通用',
          cardName: '',
          recipients: schedule.resultSendMethod === 'email' ? schedule.emailRecipients || '' : '',
          message: schedule.prompt
        });

        await autoScheduleBeforeExecute('general', schedule.prompt);
        const result = await sendToCard(schedule.prompt, [], { skipAutoSchedule: true });

        if (result.ok) {
          addSchedulerLog('success', `启动排程执行成功: ${schedule.prompt} → ${result.cardName}`);
          console.log(`[Scheduler] 启动排程执行成功: ${schedule.prompt} → ${result.cardName}`);
          
          const idx = floatHistory.findIndex(h => h.message === schedule.prompt && h.type === 'sent');
          if (idx !== -1) {
            floatHistory[idx].cardName = result.cardName || '';
            saveFloatHistory();
          }
        } else {
          addSchedulerLog('error', `启动排程执行失败: ${schedule.prompt} → ${result.error}`);
          console.error(`[Scheduler] 启动排程执行失败: ${schedule.prompt} → ${result.error}`);
        }
      } catch (error) {
        addSchedulerLog('error', `启动排程执行异常: ${schedule.prompt} → ${error.message}`);
        console.error(`[Scheduler] 启动排程执行异常: ${schedule.prompt} → ${error.message}`);
      } finally {
        window.scheduleEmailRecipientsValue = '';
      }

      if (i < startupSchedules.length - 1) {
        console.log(`[Scheduler] 等待 ${delay} 秒后执行下一个排程...`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }

    addSchedulerLog('info', '所有启动排程执行完毕');
    console.log('[Scheduler] 所有启动排程执行完毕');
  } catch (error) {
    console.error('[Scheduler] 执行启动排程失败:', error);
    addSchedulerLog('error', '启动排程执行失败: ' + error.message);
  }
}

// ========== 排程设定功能 ==========

let schedules = [];
let schedulerLogs = [];

async function loadSchedules() {
  try {
    const data = await window.electronAPI.loadSchedules();
    if (data && Array.isArray(data)) {
      schedules = data;
      console.log('[Scheduler] ✅ 已加载', schedules.length, '个排程');
    } else {
      schedules = [];
    }
    renderScheduleList();
    renderSchedulePreview();
  } catch (error) {
    console.error('[Scheduler] ❌ 加载排程失败:', error);
    schedules = [];
    renderScheduleList();
    renderSchedulePreview();
  }
}

async function saveSchedules() {
  try {
    const result = await window.electronAPI.saveSchedules(schedules);
    console.log('[Scheduler] ✅ 排程已保存');
    return result;
  } catch (error) {
    console.error('[Scheduler] ❌ 保存排程失败:', error);
    throw error;
  }
}

async function loadSchedulerLogs() {
  try {
    const data = await window.electronAPI.loadSchedulerLogs();
    if (data && Array.isArray(data)) {
      schedulerLogs = data;
      schedulerLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      console.log('[Scheduler] ✅ 已加载', schedulerLogs.length, '条日志');
    } else {
      schedulerLogs = [];
    }
    renderScheduleLogs();
  } catch (error) {
    console.error('[Scheduler] ❌ 加载日志失败:', error);
    schedulerLogs = [];
    renderScheduleLogs();
  }
}

async function saveSchedulerLogs() {
  try {
    const result = await window.electronAPI.saveSchedulerLogs(schedulerLogs);
    console.log('[Scheduler] ✅ 日志已保存');
    return result;
  } catch (error) {
    console.error('[Scheduler] ❌ 保存日志失败:', error);
    throw error;
  }
}

function addSchedulerLog(type, message, scheduleId = null) {
  const log = {
    id: 'log_' + Date.now(),
    timestamp: new Date().toISOString(),
    type: type,
    message: message,
    scheduleId: scheduleId
  };
  schedulerLogs.unshift(log);
  if (schedulerLogs.length > 500) {
    schedulerLogs = schedulerLogs.slice(0, 500);
  }
  saveSchedulerLogs().catch(() => {});
  renderScheduleLogs();
}

function formatRecurrence(recurrence) {
  const map = {
    'startup': '📂 启动时执行',
    'once': '⏱️ 一次性执行',
    'daily': '📅 每日执行',
    'weekly': '📆 每周执行',
    'monthly': '📆 每月执行',
    'repeating': '🔁 重复执行',
    'hourly': '⏰ 每小时执行'
  };
  return map[recurrence] || recurrence;
}

function formatExecuteTime(executeAt) {
  if (!executeAt) return '';
  const date = new Date(executeAt);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderScheduleList() {
  const container = document.getElementById('scheduleList');
  if (!container) return;

  if (schedules.length === 0) {
    container.innerHTML = `
      <div class="empty-schedule">
        <span style="font-size: 32px;">⏰</span>
        <p style="margin-top: 8px; color: #94a3b8;">暂无排程任务</p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">点击"新增排程"创建定时任务</p>
      </div>
    `;
    return;
  }

  let html = '';
  schedules.forEach((schedule, index) => {
    const statusClass = schedule.enabled ? '' : 'disabled';
    const statusText = schedule.enabled ? '运行中' : '已禁用';
    const statusColor = schedule.enabled ? '#10b981' : '#94a3b8';
    
    const recurrenceText = formatRecurrence(schedule.recurrence);
    let timeText = '';
    if (schedule.executeAt) {
      timeText = formatExecuteTime(schedule.executeAt);
    } else if (schedule.times && schedule.times.length > 0) {
      timeText = schedule.times.join('、');
    } else if (schedule.executeTime) {
      timeText = schedule.executeTime;
    }
    const intervalText = schedule.intervalMinutes ? `${schedule.intervalMinutes}分钟` : '';
    const delayText = schedule.delaySeconds ? `${schedule.delaySeconds}秒` : '3秒';
    
    let daysText = '';
    if (schedule.weekDays && schedule.weekDays.length > 0) {
      const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      daysText = schedule.weekDays.map(d => weekDayNames[d]).join('、');
    } else if (schedule.monthDays && schedule.monthDays.length > 0) {
      daysText = schedule.monthDays.join('日、') + '日';
    }
    
    let minutesText = '';
    if (schedule.minutes && schedule.minutes.length > 0) {
      minutesText = schedule.minutes.join('分、') + '分';
    }
    
    html += `
      <div class="schedule-card" data-id="${schedule.id}">
        <div class="schedule-card-tip">${escapeHtml(schedule.prompt || '')}</div>
        <div class="schedule-card-header">
          <div class="schedule-card-title">
            <span class="schedule-card-number">${index + 1}</span>
            <span class="schedule-card-status ${statusClass}" style="background: ${statusColor}"></span>
            <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(schedule.prompt)}</span>
          </div>
          <div class="schedule-card-actions">
            <button class="schedule-card-action-btn toggle ${statusClass}" onclick="toggleSchedule('${schedule.id}')" title="${statusText}">
              ${schedule.enabled ? '⏸️' : '▶️'}
            </button>
            <button class="schedule-card-action-btn execute" onclick="executeSchedule('${schedule.id}')" title="立即执行">
              ▶️
            </button>
            <button class="schedule-card-action-btn edit" onclick="editSchedule('${schedule.id}')" title="编辑">
              ✏️
            </button>
            <button class="schedule-card-action-btn delete" onclick="deleteScheduleConfirm('${schedule.id}')" title="删除">
              🗑️
            </button>
          </div>
        </div>
        <div class="schedule-card-footer">
          <div class="schedule-card-content">${escapeHtml(schedule.notes || '')}</div>
          <div class="schedule-card-meta">
            <span class="schedule-card-meta-item">${recurrenceText}</span>
            ${daysText ? `<span class="schedule-card-meta-item">📅 ${daysText}</span>` : ''}
            ${timeText ? `<span class="schedule-card-meta-item">⏰ ${timeText}</span>` : ''}
            ${minutesText ? `<span class="schedule-card-meta-item">⏰ ${minutesText}</span>` : ''}
            ${intervalText ? `<span class="schedule-card-meta-item">🔁 ${intervalText}</span>` : ''}
            <span class="schedule-card-meta-item">⏳ ${delayText}</span>
            ${schedule.recurrence === 'startup' ? `<span class="schedule-card-meta-item">🎯 优先级: ${schedule.priority || 100}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderScheduleLogs() {
  const container = document.getElementById('scheduleLogs');
  if (!container) return;

  if (schedulerLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-logs">
        <p style="color: #94a3b8;">暂无执行日志</p>
      </div>
    `;
    return;
  }

  let html = '';
  schedulerLogs.forEach(log => {
    const date = new Date(log.timestamp);
    const timeStr = date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    html += `
      <div class="schedule-log-item ${log.type}">
        <span class="schedule-log-time">${timeStr}</span>
        <span>${escapeHtml(log.message)}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function showScheduleModal(scheduleId = null) {
  const modal = document.getElementById('scheduleModal');
  const title = document.getElementById('scheduleModalTitle');
  const idInput = document.getElementById('scheduleId');
  const promptInput = document.getElementById('schedulePrompt');
  const recurrenceSelect = document.getElementById('scheduleRecurrence');
  const executeDateTimeInput = document.getElementById('scheduleExecuteDateTime');
  const intervalInput = document.getElementById('scheduleInterval');
  const delayInput = document.getElementById('scheduleDelay');
  const priorityInput = document.getElementById('schedulePriority');
  const resultSendSelect = document.getElementById('scheduleResultSend');
  const notesTextarea = document.getElementById('scheduleNotes');

  if (!modal) return;

  if (scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (schedule) {
      title.textContent = '编辑排程任务';
      idInput.value = schedule.id;
      promptInput.value = schedule.prompt;
      recurrenceSelect.value = schedule.recurrence;
      executeDateTimeInput.value = schedule.executeAt || schedule.executeDateTime || '';
      intervalInput.value = schedule.intervalMinutes || 60;
      delayInput.value = schedule.delaySeconds || 3;
      priorityInput.value = schedule.priority || 100;
      resultSendSelect.value = schedule.resultSendMethod || 'none';
      notesTextarea.value = schedule.notes || '';
      const emailRecipientsInput = document.getElementById('scheduleEmailRecipients');
      if (emailRecipientsInput) {
        emailRecipientsInput.value = schedule.emailRecipients || '';
      }
      
      loadWeekDays(schedule.weekDays || []);
      loadMonthDays(schedule.monthDays || []);
      loadTimes(schedule.times || []);
      loadHourlyMinutes(schedule.minutes || []);
    }
  } else {
    title.textContent = '新增排程任务';
    idInput.value = '';
    promptInput.value = '';
    recurrenceSelect.value = 'startup';
    executeDateTimeInput.value = '';
    intervalInput.value = 60;
    delayInput.value = 3;
    priorityInput.value = 100;
    resultSendSelect.value = 'none';
    notesTextarea.value = '';
    
    loadWeekDays([]);
    loadMonthDays([]);
    loadTimes([]);
    loadHourlyMinutes([]);
  }

  updateScheduleModalVisibility(recurrenceSelect.value);
  toggleScheduleEmailRecipients();
  modal.style.display = 'flex';
}

function closeScheduleModal() {
  const modal = document.getElementById('scheduleModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function toggleScheduleEmailRecipients() {
  const resultSendSelect = document.getElementById('scheduleResultSend');
  const emailContainer = document.getElementById('scheduleEmailRecipientsContainer');
  if (emailContainer) {
    emailContainer.style.display = resultSendSelect.value === 'email' ? 'block' : 'none';
  }
}

function updateScheduleModalVisibility(recurrence) {
  const executeDateTimeContainer = document.getElementById('executeDateTimeContainer');
  const intervalContainer = document.getElementById('intervalContainer');
  const hourlyMinutesContainer = document.getElementById('hourlyMinutesContainer');
  const weekDaysContainer = document.getElementById('weekDaysContainer');
  const monthDaysContainer = document.getElementById('monthDaysContainer');
  const timesContainer = document.getElementById('timesContainer');
  const priorityContainer = document.getElementById('priorityContainer');

  executeDateTimeContainer.style.display = 'none';
  intervalContainer.style.display = 'none';
  hourlyMinutesContainer.style.display = 'none';
  weekDaysContainer.style.display = 'none';
  monthDaysContainer.style.display = 'none';
  timesContainer.style.display = 'none';
  priorityContainer.style.display = 'none';

  if (recurrence === 'startup') {
    priorityContainer.style.display = 'block';
  } else if (recurrence === 'once') {
    executeDateTimeContainer.style.display = 'block';
  } else if (recurrence === 'daily') {
    timesContainer.style.display = 'block';
  } else if (recurrence === 'weekly') {
    weekDaysContainer.style.display = 'block';
    timesContainer.style.display = 'block';
  } else if (recurrence === 'monthly') {
    monthDaysContainer.style.display = 'block';
    timesContainer.style.display = 'block';
  } else if (recurrence === 'repeating') {
    intervalContainer.style.display = 'block';
  } else if (recurrence === 'hourly') {
    hourlyMinutesContainer.style.display = 'block';
    const currentMinutes = Array.from(document.querySelectorAll('#hourlyMinutesList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    renderHourlyMinutesList(currentMinutes);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const recurrenceSelect = document.getElementById('scheduleRecurrence');
  if (recurrenceSelect) {
    recurrenceSelect.addEventListener('change', function() {
      updateScheduleModalVisibility(this.value);
    });
  }
  
  document.querySelectorAll('#monthDaysList input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', function() {
      const checked = document.querySelectorAll('#monthDaysList input[type="checkbox"]:checked');
      if (checked.length > 10) {
        this.checked = false;
        showStatus('⚠️ 最多只能选择10天', 'warning');
      }
    });
  });
});

async function saveSchedule() {
  const idInput = document.getElementById('scheduleId');
  const promptInput = document.getElementById('schedulePrompt');
  const recurrenceSelect = document.getElementById('scheduleRecurrence');
  const executeDateTimeInput = document.getElementById('scheduleExecuteDateTime');
  const intervalInput = document.getElementById('scheduleInterval');
  const delayInput = document.getElementById('scheduleDelay');
  const priorityInput = document.getElementById('schedulePriority');
  const resultSendSelect = document.getElementById('scheduleResultSend');
  const notesTextarea = document.getElementById('scheduleNotes');

  const prompt = promptInput.value.trim();
  if (!prompt) {
    showStatus('⚠️ 请输入执行指令', 'warning');
    return;
  }

  const recurrence = recurrenceSelect.value;
  
  const weekDays = Array.from(document.querySelectorAll('#weekDaysList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
  const monthDays = Array.from(document.querySelectorAll('#monthDaysList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
  const times = Array.from(document.querySelectorAll('#timesList input[type="time"]')).map(input => input.value).filter(t => t);
  const minutes = Array.from(document.querySelectorAll('#hourlyMinutesList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));

  const emailRecipientsInput = document.getElementById('scheduleEmailRecipients');
  const scheduleData = {
    prompt: prompt,
    recurrence: recurrence,
    executeAt: recurrence === 'once' ? (executeDateTimeInput.value || null) : null,
    intervalMinutes: recurrence === 'repeating' ? (parseInt(intervalInput.value) || 60) : null,
    delaySeconds: parseInt(delayInput.value) || 3,
    priority: parseInt(priorityInput.value) || 100,
    resultSendMethod: resultSendSelect.value,
    emailRecipients: resultSendSelect.value === 'email' ? (emailRecipientsInput?.value || '').trim() : '',
    notes: notesTextarea.value.trim(),
    weekDays: recurrence === 'weekly' ? weekDays : [],
    monthDays: recurrence === 'monthly' ? monthDays : [],
    times: (recurrence === 'daily' || recurrence === 'weekly' || recurrence === 'monthly') ? times : [],
    minutes: recurrence === 'hourly' ? minutes : []
  };

  if (idInput.value) {
    const index = schedules.findIndex(s => s.id === idInput.value);
    if (index !== -1) {
      schedules[index] = { ...schedules[index], ...scheduleData, updatedAt: new Date().toISOString() };
      addSchedulerLog('info', `排程 "${prompt.substring(0, 30)}..." 已更新`);
    }
  } else {
    const newSchedule = {
      id: 'sched_' + Date.now(),
      itemNo: schedules.length + 1,
      ...scheduleData,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    schedules.push(newSchedule);
    addSchedulerLog('info', `排程 "${prompt.substring(0, 30)}..." 已创建`);
  }

  await saveSchedules();
  renderScheduleList();
  closeScheduleModal();
  showStatus('✅ 排程已保存', 'success');
}

function addScheduleTime() {
  const timesList = document.getElementById('timesList');
  const timeInputs = timesList.querySelectorAll('input[type="time"]');
  
  if (timeInputs.length >= 10) {
    showStatus('⚠️ 最多只能添加10个时间点', 'warning');
    return;
  }
  
  const timeItem = document.createElement('div');
  timeItem.className = 'time-item';
  timeItem.innerHTML = `
    <input type="time" value="09:00">
    <button onclick="removeScheduleTime(this)">删除</button>
  `;
  timesList.appendChild(timeItem);
}

function removeScheduleTime(btn) {
  const timesList = document.getElementById('timesList');
  const timeItem = btn.parentElement;
  timesList.removeChild(timeItem);
}

function renderHourlyMinutesList(selectedMinutes = []) {
  const container = document.getElementById('hourlyMinutesList');
  container.innerHTML = '';
  
  for (let i = 0; i < 60; i++) {
    const item = document.createElement('label');
    item.className = 'hourly-minute-item';
    item.innerHTML = `<input type="checkbox" value="${i}" ${selectedMinutes.includes(i) ? 'checked' : ''}>${i}`;
    container.appendChild(item);
  }
}

function loadHourlyMinutes(minutes) {
  renderHourlyMinutesList(minutes || []);
}

function loadTimes(times) {
  const timesList = document.getElementById('timesList');
  timesList.innerHTML = '';
  
  if (!times || times.length === 0) {
    const timeItem = document.createElement('div');
    timeItem.className = 'time-item';
    timeItem.innerHTML = `
      <input type="time" value="09:00">
      <button onclick="removeScheduleTime(this)">删除</button>
    `;
    timesList.appendChild(timeItem);
  } else {
    times.forEach(time => {
      const timeItem = document.createElement('div');
      timeItem.className = 'time-item';
      timeItem.innerHTML = `
        <input type="time" value="${time}">
        <button onclick="removeScheduleTime(this)">删除</button>
      `;
      timesList.appendChild(timeItem);
    });
  }
}

function loadWeekDays(weekDays) {
  const checkboxes = document.querySelectorAll('#weekDaysList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = weekDays.includes(parseInt(cb.value));
  });
}

function loadMonthDays(monthDays) {
  const checkboxes = document.querySelectorAll('#monthDaysList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = monthDays.includes(parseInt(cb.value));
  });
}

function editSchedule(scheduleId) {
  showScheduleModal(scheduleId);
}

function deleteScheduleConfirm(scheduleId) {
  const schedule = schedules.find(s => s.id === scheduleId);
  if (!schedule) return;

  const confirmModal = document.getElementById('scheduleConfirmModal');
  const confirmTitle = document.getElementById('scheduleConfirmTitle');
  const confirmMessage = document.getElementById('scheduleConfirmMessage');
  const confirmBtn = document.getElementById('scheduleConfirmBtn');

  confirmTitle.textContent = '确认删除';
  confirmMessage.textContent = `确定要删除排程「${schedule.prompt}」吗？此操作无法撤销。`;
  confirmBtn.textContent = '删除';
  confirmBtn.className = 'schedule-modal-btn schedule-modal-btn-danger';
  confirmBtn.onclick = () => {
    deleteSchedule(scheduleId);
    closeScheduleConfirmModal();
  };

  confirmModal.style.display = 'flex';
}

function deleteSchedule(scheduleId) {
  const schedule = schedules.find(s => s.id === scheduleId);
  if (schedule) {
    schedules = schedules.filter(s => s.id !== scheduleId);
    saveSchedules().then(() => {
      renderScheduleList();
      addSchedulerLog('info', `排程 "${schedule.prompt.substring(0, 30)}..." 已删除`);
      showStatus('✅ 排程已删除', 'success');
    });
  }
}

function closeScheduleConfirmModal() {
  const modal = document.getElementById('scheduleConfirmModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function toggleSchedule(scheduleId) {
  const schedule = schedules.find(s => s.id === scheduleId);
  if (schedule) {
    schedule.enabled = !schedule.enabled;
    saveSchedules().then(() => {
      renderScheduleList();
      const status = schedule.enabled ? '已启用' : '已禁用';
      addSchedulerLog('info', `排程 "${schedule.prompt.substring(0, 30)}..." ${status}`);
      showStatus(`✅ 排程已${status}`, 'success');
    });
  }
}

async function executeSchedule(scheduleId) {
  const schedule = schedules.find(s => s.id === scheduleId);
  if (!schedule) return;

  addSchedulerLog('info', `开始执行排程: ${schedule.prompt}`);
  showStatus(`🚀 正在执行排程: ${schedule.prompt}`, 'info');

  //  排程邮件：设置全局变量，供 continueConversation 统一邮件发送使用
  if (schedule.resultSendMethod === 'email' && schedule.emailRecipients) {
    window.scheduleEmailRecipientsValue = schedule.emailRecipients;
    console.log(`[Schedule] 📧 排程邮件已设置，收件人: ${schedule.emailRecipients}`);
  } else {
    window.scheduleEmailRecipientsValue = '';
  }

  try {
    addFloatHistoryEntry({
      type: 'sent',
      source: '通用',
      cardName: '',
      recipients: schedule.resultSendMethod === 'email' ? schedule.emailRecipients || '' : '',
      message: schedule.prompt
    });

    await autoScheduleBeforeExecute('general', schedule.prompt);
    const result = await sendToCard(schedule.prompt, [], { skipAutoSchedule: true });
    
    if (result.ok) {
      addSchedulerLog('success', `排程执行成功: ${schedule.prompt} → ${result.cardName}`);
      showStatus(`✅ 排程执行成功，发送给「${result.cardName}」`, 'success');
      
      const idx = floatHistory.findIndex(h => h.message === schedule.prompt && h.type === 'sent');
      if (idx !== -1) {
        floatHistory[idx].cardName = result.cardName || '';
        saveFloatHistory();
      }
    } else {
      addSchedulerLog('error', `排程执行失败: ${schedule.prompt} → ${result.error}`);
      showStatus(`❌ 排程执行失败: ${result.error}`, 'error');
    }
  } catch (error) {
    addSchedulerLog('error', `排程执行异常: ${schedule.prompt} → ${error.message}`);
    showStatus(`❌ 排程执行异常: ${error.message}`, 'error');
  } finally {
    // 清除排程邮件变量
    window.scheduleEmailRecipientsValue = '';
  }
}

let scheduleTimer = null;
let isCheckingSchedules = false;

function startScheduleChecker() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  
  scheduleTimer = setInterval(() => {
    if (!isCheckingSchedules) {
      checkSchedules();
    }
  }, 1000);
}

function shouldExecuteSchedule(schedule) {
  if (!schedule.enabled) return false;
  
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDay = now.getDay();
  const todayDate = now.getDate();
  
  if (schedule.recurrence === 'repeating') {
    const interval = schedule.intervalMinutes || 60;
    if (!schedule.lastExecutedAt) return true;
    const lastTime = new Date(schedule.lastExecutedAt);
    const diffMinutes = (now - lastTime) / 1000 / 60;
    return diffMinutes >= interval;
  }
  
  if (schedule.recurrence === 'hourly') {
    const minutes = schedule.minutes || [];
    if (minutes.length === 0) return false;
    
    const currentMinute = now.getMinutes();
    if (!minutes.includes(currentMinute)) return false;
    
    if (!schedule.lastExecutedAt) return true;
    const lastExecTime = new Date(schedule.lastExecutedAt);
    const lastExecHour = lastExecTime.getHours();
    const currentHour = now.getHours();
    if (lastExecHour !== currentHour) return true;
    
    return false;
  }
  
  if (schedule.recurrence === 'daily') {
    const times = schedule.times || [];
    if (times.length === 0) return false;
    
    for (const time of times) {
      const [hours, minutes] = time.split(':').map(Number);
      const timeMinutes = hours * 60 + minutes;
      
      if (Math.abs(nowMinutes - timeMinutes) <= 1) {
        if (!schedule.lastExecutedAt) return true;
        const lastExecTime = new Date(schedule.lastExecutedAt);
        const lastExecDate = lastExecTime.toDateString();
        const todayDateStr = now.toDateString();
        if (lastExecDate !== todayDateStr) return true;
        
        const lastExecMinutes = lastExecTime.getHours() * 60 + lastExecTime.getMinutes();
        if (Math.abs(lastExecMinutes - timeMinutes) > 5) return true;
      }
    }
    return false;
  }
  
  if (schedule.recurrence === 'weekly') {
    const weekDays = schedule.weekDays || [];
    const times = schedule.times || [];
    
    if (!weekDays.includes(todayDay) || times.length === 0) return false;
    
    for (const time of times) {
      const [hours, minutes] = time.split(':').map(Number);
      const timeMinutes = hours * 60 + minutes;
      
      if (Math.abs(nowMinutes - timeMinutes) <= 1) {
        if (!schedule.lastExecutedAt) return true;
        const lastExecTime = new Date(schedule.lastExecutedAt);
        const lastExecDay = lastExecTime.getDay();
        if (lastExecDay !== todayDay) return true;
        
        const lastExecMinutes = lastExecTime.getHours() * 60 + lastExecTime.getMinutes();
        if (Math.abs(lastExecMinutes - timeMinutes) > 5) return true;
      }
    }
    return false;
  }
  
  if (schedule.recurrence === 'monthly') {
    const monthDays = schedule.monthDays || [];
    const times = schedule.times || [];
    
    if (!monthDays.includes(todayDate) || times.length === 0) return false;
    
    for (const time of times) {
      const [hours, minutes] = time.split(':').map(Number);
      const timeMinutes = hours * 60 + minutes;
      
      if (Math.abs(nowMinutes - timeMinutes) <= 1) {
        if (!schedule.lastExecutedAt) return true;
        const lastExecTime = new Date(schedule.lastExecutedAt);
        const lastExecDate = lastExecTime.getDate();
        if (lastExecDate !== todayDate) return true;
        
        const lastExecMinutes = lastExecTime.getHours() * 60 + lastExecTime.getMinutes();
        if (Math.abs(lastExecMinutes - timeMinutes) > 5) return true;
      }
    }
    return false;
  }
  
  if (schedule.recurrence === 'once') {
    if (!schedule.executeAt) return false;
    const executeAt = new Date(schedule.executeAt);
    if (now >= executeAt) {
      if (!schedule.lastExecutedAt) return true;
      return false;
    }
    return false;
  }
  
  return false;
}

async function checkSchedules() {
  isCheckingSchedules = true;
  try {
    for (const schedule of schedules) {
      if (shouldExecuteSchedule(schedule)) {
        schedule.lastExecutedAt = new Date().toISOString();
        await saveSchedules();
        await executeSchedule(schedule.id);
        
        if (schedule.recurrence === 'once') {
          schedule.enabled = false;
          await saveSchedules();
          renderScheduleList();
        }
      }
    }
  } catch (error) {
    console.error('[Scheduler] 检查排程失败:', error);
  } finally {
    isCheckingSchedules = false;
  }
}

function calculateSchedulePreview(days = 1) {
  const preview = [];
  const now = new Date();
  const endTime = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    
    const executeTimes = calculateExecuteTimes(schedule, now, endTime);
    for (const time of executeTimes) {
      preview.push({
        scheduleId: schedule.id,
        prompt: schedule.prompt,
        executeTime: time,
        recurrence: schedule.recurrence
      });
    }
  }
  
  preview.sort((a, b) => a.executeTime - b.executeTime);
  return preview;
}

function calculateExecuteTimes(schedule, startTime, endTime) {
  const times = [];
  
  if (schedule.recurrence === 'startup') {
    return times;
  }
  
  if (schedule.recurrence === 'once') {
    if (schedule.executeAt) {
      const executeAt = new Date(schedule.executeAt);
      if (executeAt >= startTime && executeAt <= endTime) {
        times.push(executeAt);
      }
    }
    return times;
  }
  
  if (schedule.recurrence === 'repeating') {
    const interval = (schedule.intervalMinutes || 60) * 60 * 1000;
    let nextTime = schedule.lastExecutedAt ? new Date(schedule.lastExecutedAt).getTime() + interval : startTime.getTime();
    while (nextTime <= endTime.getTime()) {
      times.push(new Date(nextTime));
      nextTime += interval;
    }
    return times;
  }
  
  if (schedule.recurrence === 'hourly') {
    const minutes = schedule.minutes || [];
    if (minutes.length === 0) return times;
    
    let currentHour = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate(), startTime.getHours(), 0, 0);
    while (currentHour <= endTime) {
      for (const minute of minutes) {
        const executeTime = new Date(currentHour.getTime() + minute * 60 * 1000);
        if (executeTime >= startTime && executeTime <= endTime) {
          times.push(executeTime);
        }
      }
      currentHour = new Date(currentHour.getTime() + 60 * 60 * 1000);
    }
    return times;
  }
  
  if (schedule.recurrence === 'daily') {
    const scheduleTimes = schedule.times || [];
    if (scheduleTimes.length === 0) return times;
    
    let currentDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    while (currentDate <= endTime) {
      for (const timeStr of scheduleTimes) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const executeTime = new Date(currentDate.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
        if (executeTime >= startTime && executeTime <= endTime) {
          times.push(executeTime);
        }
      }
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
    }
    return times;
  }
  
  if (schedule.recurrence === 'weekly') {
    const weekDays = schedule.weekDays || [];
    const scheduleTimes = schedule.times || [];
    if (weekDays.length === 0 || scheduleTimes.length === 0) return times;
    
    let currentDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    while (currentDate <= endTime) {
      const dayOfWeek = currentDate.getDay();
      if (weekDays.includes(dayOfWeek)) {
        for (const timeStr of scheduleTimes) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          const executeTime = new Date(currentDate.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
          if (executeTime >= startTime && executeTime <= endTime) {
            times.push(executeTime);
          }
        }
      }
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
    }
    return times;
  }
  
  if (schedule.recurrence === 'monthly') {
    const monthDays = schedule.monthDays || [];
    const scheduleTimes = schedule.times || [];
    if (monthDays.length === 0 || scheduleTimes.length === 0) return times;
    
    let currentDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    while (currentDate <= endTime) {
      const dateOfMonth = currentDate.getDate();
      if (monthDays.includes(dateOfMonth)) {
        for (const timeStr of scheduleTimes) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          const executeTime = new Date(currentDate.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
          if (executeTime >= startTime && executeTime <= endTime) {
            times.push(executeTime);
          }
        }
      }
      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
    }
    return times;
  }
  
  return times;
}

function renderSchedulePreview() {
  const previewContainer = document.getElementById('schedulePreview');
  if (!previewContainer) return;
  
  const preview = calculateSchedulePreview(1);
  
  if (preview.length === 0) {
    previewContainer.innerHTML = '<div class="empty-preview"><p style="color: #94a3b8;">暂无执行计划</p></div>';
    return;
  }
  
  let html = '';
  preview.forEach((item, index) => {
    const timeStr = item.executeTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = item.executeTime.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const fullTimeStr = item.executeTime.getDate() === new Date().getDate() ? timeStr : `${dateStr} ${timeStr}`;
    
    html += `
      <div class="schedule-preview-item">
        <span class="schedule-preview-number">${index + 1}</span>
        <span class="schedule-preview-time">${fullTimeStr}</span>
        <span class="schedule-preview-prompt">${escapeHtml(item.prompt)}</span>
      </div>
    `;
  });
  
  previewContainer.innerHTML = html;
}

function toggleSchedulePreview() {
  const previewContainer = document.getElementById('schedulePreview');
  const toggleBtn = document.querySelector('.schedule-preview-section .schedule-logs-toggle');
  
  if (previewContainer && toggleBtn) {
    const isHidden = previewContainer.style.display === 'none';
    previewContainer.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '📅 执行预览 ▲' : '📅 执行预览 ▼';
    
    if (isHidden) {
      renderSchedulePreview();
    }
  }
}

function toggleScheduleLogs() {
  const logsContainer = document.getElementById('scheduleLogs');
  const toggleBtn = document.querySelector('.schedule-logs-section .schedule-logs-toggle');
  
  if (logsContainer && toggleBtn) {
    const isHidden = logsContainer.style.display === 'none';
    logsContainer.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '📋 执行日志 ▲' : '📋 执行日志 ▼';
    
    if (isHidden) {
      loadSchedulerLogs();
    }
  }
}

function clearSchedulerLogsConfirm() {
  const confirmModal = document.getElementById('scheduleConfirmModal');
  const confirmTitle = document.getElementById('scheduleConfirmTitle');
  const confirmMessage = document.getElementById('scheduleConfirmMessage');
  const confirmBtn = document.getElementById('scheduleConfirmBtn');

  confirmTitle.textContent = '确认清空日志';
  confirmMessage.textContent = `确定要清空所有执行日志吗？此操作无法撤销。`;
  confirmBtn.textContent = '清空';
  confirmBtn.className = 'schedule-modal-btn schedule-modal-btn-danger';
  confirmBtn.onclick = () => {
    clearSchedulerLogs();
    closeScheduleConfirmModal();
  };

  confirmModal.style.display = 'flex';
}

async function clearSchedulerLogs() {
  schedulerLogs = [];
  await saveSchedulerLogs();
  renderScheduleLogs();
  addSchedulerLog('info', '执行日志已清空');
  showStatus('✅ 日志已清空', 'success');
}

function initSchedulePanel() {
  const panel = document.getElementById('scheduleContainer');
  if (panel && panel.dataset.active === 'true') {
    loadSchedules();
  }
}

// 挂载到 window
window.executeStartupSchedules = executeStartupSchedules;
window.loadSchedules = loadSchedules;
window.saveSchedules = saveSchedules;
window.loadSchedulerLogs = loadSchedulerLogs;
window.saveSchedulerLogs = saveSchedulerLogs;
window.renderScheduleList = renderScheduleList;
window.renderScheduleLogs = renderScheduleLogs;
window.showScheduleModal = showScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.toggleScheduleEmailRecipients = toggleScheduleEmailRecipients;
window.saveSchedule = saveSchedule;
window.editSchedule = editSchedule;
window.deleteScheduleConfirm = deleteScheduleConfirm;
window.deleteSchedule = deleteSchedule;
window.closeScheduleConfirmModal = closeScheduleConfirmModal;
window.toggleSchedule = toggleSchedule;
window.executeSchedule = executeSchedule;
window.renderSchedulePreview = renderSchedulePreview;
window.toggleSchedulePreview = toggleSchedulePreview;
window.toggleScheduleLogs = toggleScheduleLogs;
window.clearSchedulerLogsConfirm = clearSchedulerLogsConfirm;
window.clearSchedulerLogs = clearSchedulerLogs;
