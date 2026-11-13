const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, screen, powerMonitor } = require('electron');

const SOUND_MODES = new Set(['classic', 'sci-fi', 'chime', 'silent']);
const ANIMATION_MODES = new Set([
  'pulse', 'scan', 'data', 'aurora', 'orbit', 'arc', 'holo', 'signal', 'glitch'
]);
const DEFAULT_SETTINGS = { sound: 'classic', animation: 'pulse' };

let getMainWindow = () => null;
let alarmWindow = null;
const activeAlarms = new Map();
const snoozedRecurringAlarms = new Map();
const completedRecurringOccurrences = new Map();
let entries = new Map();
let pollTimer = null;
let closingForAction = false;
let actionInProgress = false;
let mutedAppWindows = [];
let actionSeq = 0;
const pendingActions = new Map();
let settings = { ...DEFAULT_SETTINGS };

function normalizedSettings(value) {
  const sound = value && SOUND_MODES.has(value.sound) ? value.sound : DEFAULT_SETTINGS.sound;
  const animation = value && ANIMATION_MODES.has(value.animation) ? value.animation : DEFAULT_SETTINGS.animation;
  return { sound, animation };
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'alarm-settings.json');
}

function loadSettings() {
  try {
    const file = settingsFile();
    if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
    return normalizedSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    console.error('[Alarms] 读取闹铃设置失败:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(value) {
  if (!value || !SOUND_MODES.has(value.sound) || !ANIMATION_MODES.has(value.animation)) {
    return { ok: false, error: '铃声或动画模式无效' };
  }
  const next = normalizedSettings(value);
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    settings = next;
    return { ok: true, settings: { ...settings } };
  } catch (error) {
    console.error('[Alarms] 保存闹铃设置失败:', error);
    return { ok: false, error: error.message || String(error) };
  }
}

function muteSiblingWindows(parent) {
  const visibleSiblings = BrowserWindow.getAllWindows().filter((win) =>
    win !== parent && win !== alarmWindow && !win.isDestroyed() && win.isVisible()
  );
  visibleSiblings.forEach((win) => {
    if (!mutedAppWindows.includes(win)) mutedAppWindows.push(win);
    win.hide();
  });
}

function restoreSiblingWindows() {
  const restore = mutedAppWindows;
  mutedAppWindows = [];
  restore.forEach((win) => {
    if (win && !win.isDestroyed()) win.show();
  });
}

function sendToAlarm(channel, payload) {
  if (alarmWindow && !alarmWindow.isDestroyed() && alarmWindow.webContents.isLoading() === false) {
    alarmWindow.webContents.send(channel, payload);
  }
}

function requestAction(action, alarmId, note) {
  const win = alarmWindow;
  const parent = getMainWindow();
  const alarm = activeAlarms.get(alarmId);
  const entryAtAction = entries.get(alarmId);
  if (!win || win.isDestroyed() || !parent || parent.isDestroyed() || !alarm) {
    return Promise.resolve({ ok: false, error: '闹铃窗口或日历窗口已关闭' });
  }
  if (actionInProgress) return Promise.resolve({ ok: false, error: '正在处理上一项闹铃操作' });
  actionInProgress = true;
  const requestId = 'alarm-action-' + (++actionSeq);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingActions.delete(requestId);
      actionInProgress = false;
      resolve({ ok: false, error: '日历没有及时回应，闹铃仍保持开启' });
    }, 30000);
    pendingActions.set(requestId, {
      resolve: (result) => {
        clearTimeout(timer);
        pendingActions.delete(requestId);
        actionInProgress = false;
        if (result && result.ok) {
          if (action === 'snooze' && alarm.recurring) {
            const entry = entries.get(alarmId);
            snoozedRecurringAlarms.set(alarmId, {
              scheduleDueAt: entry ? entry.dueAt : alarm.dueAt,
              until: Date.now() + alarm.intervalMs
            });
          } else if (action === 'complete') {
            snoozedRecurringAlarms.delete(alarmId);
            if (alarm.recurring) {
              completedRecurringOccurrences.set(alarmId,
                entryAtAction ? entryAtAction.dueAt : alarm.dueAt);
            }
          }
          activeAlarms.delete(alarmId);
          if (activeAlarms.size) {
            sendToAlarm('alarm-update', { alarms: Array.from(activeAlarms.values()) });
          } else {
            closingForAction = true;
            if (alarmWindow && !alarmWindow.isDestroyed()) alarmWindow.close();
          }
        }
        resolve(result || { ok: false, error: '日历返回了无效结果' });
      }
    });
    parent.webContents.send('alarm-action-request', { requestId, action, alarm, alarmId, note });
  });
}

function showAlarm() {
  const parent = getMainWindow();
  if (!parent || parent.isDestroyed()) return;
  if (alarmWindow && !alarmWindow.isDestroyed()) {
    sendToAlarm('alarm-update', { alarms: Array.from(activeAlarms.values()) });
    return;
  }
  actionInProgress = false;
  muteSiblingWindows(parent);
  parent.show();

  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  alarmWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    parent,
    modal: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#080d18',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  alarmWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  alarmWindow.setAlwaysOnTop(true);
  alarmWindow.on('close', (event) => {
    if (closingForAction) return;
    event.preventDefault();
    const activeIds = Array.from(activeAlarms.keys());
    (async () => {
      for (const id of activeIds) {
        try {
          const result = await requestAction('snooze', id);
          if (!result || !result.ok) {
            sendToAlarm('alarm-action-error', { alarmId: id, error: result && result.error || '稍后提醒失败' });
            return;
          }
        } catch (error) {
          console.error('[Alarms] 关闭闹铃时写回失败:', error);
          sendToAlarm('alarm-action-error', { alarmId: id, error: error.message || String(error) });
          return;
        }
      }
    })();
  });
  alarmWindow.on('closed', () => {
    alarmWindow = null;
    closingForAction = false;
    actionInProgress = false;
    checkDue();
    if (!alarmWindow) restoreSiblingWindows();
  });
  alarmWindow.loadFile(path.join(__dirname, '..', 'src', 'plugins', 'todolist', 'alarm.html'))
    .then(() => {
      if (!alarmWindow || alarmWindow.isDestroyed()) return;
      alarmWindow.show();
      alarmWindow.focus();
      alarmWindow.webContents.send('alarm-show', {
        alarms: Array.from(activeAlarms.values()),
        settings: { ...settings }
      });
    })
    .catch((error) => {
      console.error('[Alarms] 闹铃界面加载失败:', error);
      if (alarmWindow && !alarmWindow.isDestroyed()) alarmWindow.close();
    });
}

function checkDue() {
  if (!entries.size) {
    if (activeAlarms.size && (!alarmWindow || alarmWindow.isDestroyed())) showAlarm();
    return;
  }
  const now = Date.now();
  const dueEntries = [];
  let addedAlarm = false;
  entries.forEach((entry) => {
    const completedDueAt = completedRecurringOccurrences.get(entry.id);
    if (completedRecurringOccurrences.has(entry.id)) {
      if (entry.recurring && completedDueAt === entry.dueAt) return;
      completedRecurringOccurrences.delete(entry.id);
    }
    const snooze = snoozedRecurringAlarms.get(entry.id);
    if (snooze && (!entry.recurring || snooze.scheduleDueAt !== entry.dueAt)) {
      snoozedRecurringAlarms.delete(entry.id);
    }
    const activeSnooze = snoozedRecurringAlarms.get(entry.id);
    const dueAt = activeSnooze ? activeSnooze.until : entry.dueAt;
    if (!entry.completed && Number.isFinite(dueAt) && dueAt <= now) {
      dueEntries.push(dueAt === entry.dueAt ? entry : { ...entry, dueAt });
    }
  });
  dueEntries.sort((a, b) => a.dueAt - b.dueAt).forEach((entry) => {
    if (!activeAlarms.has(entry.id)) {
      activeAlarms.set(entry.id, entry);
      addedAlarm = true;
    }
  });
  if (activeAlarms.size && (addedAlarm || !alarmWindow || alarmWindow.isDestroyed())) showAlarm();
}

function sanitizeEntries(list) {
  if (!Array.isArray(list)) return new Map();
  const next = new Map();
  list.forEach((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 300) return;
    if (!Number.isFinite(item.dueAt) || !Number.isFinite(item.intervalMs) || item.intervalMs <= 0) return;
    next.set(item.id, {
      id: item.id,
      dueAt: item.dueAt,
      intervalMs: item.intervalMs,
      message: String(item.message || '').slice(0, 2000),
      contentHtml: typeof item.contentHtml === 'string' ? item.contentHtml : '',
      title: String(item.title || '行程提醒').slice(0, 300),
      date: String(item.date || '').slice(0, 100),
      eventUid: String(item.eventUid || ''),
      marker: String(item.marker || '').slice(0, 4000),
      markerOffset: Number.isInteger(item.markerOffset) ? item.markerOffset : -1,
      recurring: item.recurring === true,
      completed: item.completed === true
    });
  });
  return next;
}

function init(options) {
  getMainWindow = options.getMainWindow;
  settings = loadSettings();

  ipcMain.handle('alarm-sync', (event, list) => {
    const parent = getMainWindow();
    if (!parent || parent.isDestroyed() || event.sender.id !== parent.webContents.id) {
      return { ok: false, error: '无权更新闹铃清单' };
    }
    entries = sanitizeEntries(list);
    snoozedRecurringAlarms.forEach((_, id) => {
      if (!entries.has(id)) snoozedRecurringAlarms.delete(id);
    });
    completedRecurringOccurrences.forEach((_, id) => {
      if (!entries.has(id)) completedRecurringOccurrences.delete(id);
    });
    checkDue();
    return { ok: true };
  });

  ipcMain.handle('alarm-action', (event, payload) => {
    if (!alarmWindow || alarmWindow.isDestroyed() || event.sender.id !== alarmWindow.webContents.id ||
        !payload || typeof payload.alarmId !== 'string' || !activeAlarms.has(payload.alarmId) ||
        !['snooze', 'complete'].includes(payload.action) ||
        (payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length > 500))) {
      return { ok: false, error: '闹铃操作无效或已过期' };
    }
    return requestAction(payload.action, payload.alarmId, payload.note || '');
  });

  ipcMain.handle('alarm-action-result', (event, payload) => {
    const parent = getMainWindow();
    if (!parent || event.sender.id !== parent.webContents.id || !payload || typeof payload.requestId !== 'string') {
      return { ok: false, error: '无效的闹铃操作回应' };
    }
    if (!payload.result || typeof payload.result.ok !== 'boolean' ||
        (payload.result.error !== undefined && typeof payload.result.error !== 'string')) {
      return { ok: false, error: '无效的闹铃操作结果' };
    }
    const pending = pendingActions.get(payload.requestId);
    if (!pending) return { ok: false, error: '闹铃操作请求已过期' };
    pending.resolve(payload.result);
    return { ok: true };
  });

  ipcMain.handle('alarm-load-settings', (event) => {
    if (!alarmWindow || event.sender.id !== alarmWindow.webContents.id) return { ok: false, error: '无权读取闹铃设置' };
    return { ok: true, settings: { ...settings } };
  });

  ipcMain.handle('alarm-save-settings', (event, value) => {
    if (!alarmWindow || event.sender.id !== alarmWindow.webContents.id) return { ok: false, error: '无权保存闹铃设置' };
    return saveSettings(value);
  });

  if (!pollTimer) pollTimer = setInterval(checkDue, 1000);
  powerMonitor.on('resume', checkDue);
}

module.exports = { init };
