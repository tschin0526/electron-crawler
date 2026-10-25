/* ============================================================
 * 🗒 LITE 便利貼（翻頁模式；calendar 檔專用＝檔名 calendar*.md）
 * ------------------------------------------------------------
 * 資料源與桌面便利貼一致：calendar 檔中 `- sticky: \`N\``（N>0）的行程
 * 會展開成 N 張便利貼；本檔案只負責「顯示 / 翻頁 / 顯示偏好」，
 * 絕不改寫 calendar 檔。備註 checkbox ✎ 與勾選仍走 calToggleNoteCheck /
 * calOpenEditNoteCheckDialog → calCommitEventNotes（主檔＝編輯緩衝；
 * include 檔＝只改來源檔那一塊 Remark），與行程列表同一條寫回路徑。
 * ⚠️ 權限分工（對齊桌面）：include(ro) 行程的備註**只能在便利貼裡改**——
 *    行程檢視那邊是唯讀的，所以這裡呼叫 calRenderNotes 一律帶 forceEditable=true、
 *    calOpenAddCheckDialog 要明確傳 'sticky'。
 * 由組合菜單「🗒 便利貼（翻頁）」主動開啟，平時不佔畫面。
 * ============================================================ */
'use strict';

// 背景色 / 字色候選：與桌面便利貼同一套色板（30 色 / 24 色），首個為紙張預設
const CAL_STICKY_BG_PALETTE = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E',
  '#8E8E93', '#FFF3B0', '#FFC9C9', '#FFE8CC', '#D3F9D8', '#A5D8FF',
  '#E5DBFF', '#FF8787', '#FFA94D', '#FFE066', '#8CE99A', '#74C0FC',
  '#B197FC', '#FAD8C0', '#FFE3E3', '#E7F5C2', '#C3FAE8', '#FFE9F0'
];
const CAL_STICKY_FG_PALETTE = [
  '#33384a', '#000000', '#FFFFFF', '#1f2430', '#4b5160', '#8E8E93',
  '#A2845E', '#007AFF', '#34C759', '#AF52DE', '#FF3B30', '#FF9500',
  '#E03131', '#2F9E44', '#0B7285', '#1864AB', '#5F3DC4', '#A61E4D',
  '#704818', '#F59F00', '#1098AD', '#495057', '#ADB5BD', '#212529'
];
const CAL_STICKY_DEF_BG = '#FFF3B0';
const CAL_STICKY_DEF_FG = '#000000';
// 手機版以 14px 為正文基準（桌面窗較小用 12px），字級倍率與桌面同一範圍 0.5–2.5
const CAL_STICKY_BASE_FONT = 14;
// localStorage 命名空間：每個 calendar 檔各自一份顯示偏好（只存在本機）
const CAL_STICKY_STORE_PREFIX = 'calStickyState:';

let calStickyIsOpen = false;
let calStickyCatalog = [];
let calStickyPages = [];
let calStickyIndex = 0;
let calStickyCurrentId = '';
let calStickyCurrentUid = '';
let calStickyStoreCache = null;
let calStickyStoreKeyCache = '';
let calStickyToastTimer = null;
let calStickyPendingRename = null;
let calStickyTouchStart = null;

function calStickyEl(id) { return document.getElementById(id); }

// ===== 本機持久化（只存顯示偏好：每張樣式 / 開關 / 上次頁次）=====
function calStickyCurrentFileName() {
  const name = (typeof state !== 'undefined' && state.currentFile && state.currentFile.name)
    ? state.currentFile.name : 'calendar.md';
  return String(name);
}
function calStickyStorageKey() {
  return CAL_STICKY_STORE_PREFIX + calStickyCurrentFileName().toLowerCase();
}
function calStickyLoadStore() {
  const key = calStickyStorageKey();
  if (calStickyStoreCache && calStickyStoreKeyCache === key) return calStickyStoreCache;
  let data = null;
  try { data = JSON.parse(localStorage.getItem(key) || 'null'); }
  catch (e) { console.warn('[LITE] 讀取便利貼設定失敗:', e); }
  const notes = (data && data.notes && typeof data.notes === 'object' && !Array.isArray(data.notes)) ? data.notes : {};
  const hidden = (data && Array.isArray(data.hidden)) ? data.hidden.filter((x) => typeof x === 'string') : [];
  calStickyStoreCache = {
    notes,
    hidden,
    lastId: (data && typeof data.lastId === 'string') ? data.lastId : '',
    // 頁次兜底：標題／日期被改（身分失效）時，至少回到上次停留的位置
    lastIdx: (data && typeof data.lastIdx === 'number' && isFinite(data.lastIdx))
      ? Math.max(0, Math.trunc(data.lastIdx)) : 0
  };
  calStickyStoreKeyCache = key;
  return calStickyStoreCache;
}
function calStickySaveStore() {
  if (!calStickyStoreCache) return;
  try { localStorage.setItem(calStickyStoreKeyCache, JSON.stringify(calStickyStoreCache)); }
  catch (e) {
    if (typeof showToast === 'function') showToast('無法保存便利貼設定：' + ((e && e.message) || e), 'error');
    else console.warn('[LITE] 保存便利貼設定失敗:', e);
  }
}
function calStickyResetStore() {
  calStickyStoreCache = null;
  calStickyStoreKeyCache = '';
}

// ===== 「設定已寫回 JSON」基線（保存角標用）=====
// 只比對樣式＋關閉清單；頁次（lastId/lastIdx）不列入，否則光是翻頁就會一直亮角標。
const CAL_STICKY_SYNCED_PREFIX = 'calStickySettingsSynced:';
let calStickySyncedCache = null;   // null＝本檔還沒建立基線
let calStickySyncedKeyCache = '';

function calStickySyncedKey() {
  return CAL_STICKY_SYNCED_PREFIX + calStickyCurrentFileName().toLowerCase();
}
function calStickySettingsSignature() {
  const store = calStickyLoadStore();
  const notes = {};
  Object.keys(store.notes || {}).sort().forEach((id) => {
    const prefs = (typeof StickySettings !== 'undefined')
      ? StickySettings.pickPrefs(store.notes[id])
      : (store.notes[id] || {});
    if (Object.keys(prefs).length) notes[id] = prefs;
  });
  const hidden = (store.hidden || []).slice().sort();
  return JSON.stringify({ notes, hidden });
}
function calStickyReadSynced() {
  const key = calStickySyncedKey();
  if (key === calStickySyncedKeyCache && calStickySyncedCache !== null) return calStickySyncedCache;
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
  calStickySyncedKeyCache = key;
  calStickySyncedCache = (typeof raw === 'string') ? raw : null;
  return calStickySyncedCache;
}
function calStickyWriteSynced(signature) {
  calStickySyncedKeyCache = calStickySyncedKey();
  calStickySyncedCache = signature;
  try { localStorage.setItem(calStickySyncedKeyCache, signature); } catch (e) {}
}
// 目前設定是否和「上次寫回的 JSON」不同（供保存按鈕角標）
function calStickySettingsDirty() {
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) return false;
  const current = calStickySettingsSignature();
  const base = calStickyReadSynced();
  if (base === null) {   // 這個檔第一次使用：以現況當基線，不立刻亮角標
    calStickyWriteSynced(current);
    return false;
  }
  return base !== current;
}
// JSON 真的交付出去（picker 寫入／分享面板完成）之後才呼叫；取消不得呼叫
function calStickyMarkSettingsSaved() {
  calStickyWriteSynced(calStickySettingsSignature());
  if (typeof updateStatus === 'function') updateStatus();
}

// ===== 設定備份：匯出／載入可攜 JSON（桌面與 LITE 同一套轉換，見 sticky-settings.js）=====
// 手機 localStorage 對「origin + 檔名」敏感：換 port／LAN IP 或清網站資料就會整份不見。
// 這兩個動作讓使用者把樣式／開關／頁次存進 calendar 同目錄的 JSON，之後再寫回 storage。
function calStickySettingsFileName() {
  const base = calStickyCurrentFileName().replace(/\.md$/i, '') || 'calendar';
  return 'sticky-notes-settings-' + base + '.json';
}
function calStickySettingsFile() {
  const store = calStickyLoadStore();
  const payload = StickySettings.buildPortable({
    notes: store.notes,
    hidden: store.hidden,
    lastId: store.lastId,
    lastIdx: store.lastIdx
  }, calStickyCurrentFileName(), 'pwa-md-editor');
  return { name: calStickySettingsFileName(), content: JSON.stringify(payload, null, 2) };
}
// 回傳 { ok, canceled, how, name }；opts.silent＝由呼叫端統一回報，不自己彈 toast
async function calStickyExportSettings(opts) {
  opts = opts || {};
  const silent = !!opts.silent;
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) {
    if (!silent) showToast('請先開啟 calendar 檔', 'error');
    return { ok: false, canceled: false, error: 'no-file' };
  }
  if (typeof StickySettings === 'undefined') {
    if (!silent) showToast('設定轉換模組未載入，請重新整理頁面', 'error');
    return { ok: false, canceled: false, error: 'module-missing' };
  }
  let file = null;
  try { file = calStickySettingsFile(); }
  catch (e) {
    if (!silent) showToast('匯出設定失敗：' + ((e && e.message) || e), 'error');
    return { ok: false, canceled: false, error: (e && e.message) || String(e) };
  }

  // 桌面 Chromium：直接開儲存對話框（可選 iCloud 的 calendar 資料夾）
  if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name,
        types: [{ description: '便利貼設定 JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([file.content], { type: 'application/json;charset=utf-8' }));
      await writable.close();
      calStickyMarkSettingsSaved();
      if (!silent) showToast('已匯出設定：' + file.name + '（請與 calendar 檔放同一目錄）', 'success');
      return { ok: true, canceled: false, how: 'picker', name: file.name };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, canceled: true, error: 'canceled' };
      if (!silent) showToast('匯出設定失敗：' + ((e && e.message) || e), 'error');
      return { ok: false, canceled: false, error: (e && e.message) || String(e) };
    }
  }

  // iOS / Android：分享面板（存到檔案）→ 下載兜底
  try {
    const how = await saveViaMobile(file.content, file.name);
    calStickyMarkSettingsSaved();
    if (!silent) {
      showToast(how === 'shared'
        ? '已送出設定檔：在分享面板選「儲存到檔案」→ 存到 calendar 同一目錄'
        : '已下載設定檔：' + file.name + '（請移到 calendar 同一目錄）', 'success');
    }
    return { ok: true, canceled: false, how, name: file.name };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, canceled: true, error: 'canceled' };
    if (!silent) showToast('匯出設定失敗：' + ((e && e.message) || e), 'error');
    return { ok: false, canceled: false, error: (e && e.message) || String(e) };
  }
}
function calStickyReadJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result || ''))); }
      catch (e) { reject(new Error('JSON 解析失敗：' + e.message)); }
    };
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsText(file, 'UTF-8');
  });
}
function calStickyImportSettings() {
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) {
    showToast('請先開啟 calendar 檔', 'error');
    return;
  }
  if (calStickyEditMode && calStickyEditDirty) {
    showToast('便利貼內容有未保存的改動，請先保存再載入設定', 'error');
    return;
  }
  // iOS 的檔案選單對 accept 過濾不可靠（會把目標檔灰掉），故不設 accept，選完再驗內容
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.remove();
    if (file) calStickyApplySettingsFile(file);
  });
  document.body.appendChild(input);
  input.click();
}
// opts.auto＝開檔時「calendar + 設定 JSON」一起選的自動套用：不再彈確認，
//   因為選擇這個檔案本身就是使用者的明示意圖；成功與否則以 toast 回報。
async function calStickyApplySettingsFile(file, opts) {
  opts = opts || {};
  const auto = !!opts.auto;
  if (auto && calStickyEditMode && calStickyEditDirty) {
    showToast('便利貼內容有未保存的改動，這次不套用設定 JSON', 'info');
    return false;
  }
  let parsed = null;
  try { parsed = await calStickyReadJsonFile(file); }
  catch (e) { showToast(e.message, 'error'); return false; }
  let normalized = null;
  try {
    if (typeof StickySettings === 'undefined') throw new Error('設定轉換模組未載入，請重新整理頁面');
    normalized = StickySettings.normalize(parsed);
  } catch (e) {
    showToast('設定檔無法使用：' + ((e && e.message) || e), 'error');
    return false;
  }
  const next = normalized.store;
  const noteCount = Object.keys(next.notes).length;
  if (!noteCount && !next.hidden.length && !next.lastId) {
    showToast('這個 JSON 裡沒有便利貼設定', 'info');
    return false;
  }
  // 還沒開 calendar 檔（例如剛啟動就先選設定 JSON）：以 JSON 自帶的 calendarFile 為目標，
  //   先寫進那個檔的設定槽，之後開啟同名 calendar 檔就自動生效。
  const hasCurrent = (typeof isCalendarMd === 'function') && isCalendarMd();
  const currentName = hasCurrent ? calStickyCurrentFileName() : String(normalized.calendarFile || '');
  if (!hasCurrent && !/^calendar.*\.md$/i.test(currentName)) {
    showToast('請先開啟 calendar 檔，或選擇檔內帶 calendarFile 的設定 JSON', 'error');
    return false;
  }
  const storageKey = hasCurrent ? calStickyStorageKey() : CAL_STICKY_STORE_PREFIX + currentName.toLowerCase();
  const catalogIds = new Set(calStickyCatalog.map((n) => n.identity));
  const matched = Object.keys(next.notes).filter((id) => catalogIds.has(id)).length;
  const mismatch = normalized.calendarFile
    && normalized.calendarFile.toLowerCase() !== currentName.toLowerCase();
  if (!auto) {
    const lines = [
      '📥 載入便利貼設定',
      '',
      '檔案：' + file.name,
      '樣式：' + noteCount + ' 項（本檔符合 ' + matched + ' 項）',
      '關閉清單：' + next.hidden.length + ' 項',
      '上次頁次：第 ' + (next.lastIdx + 1) + ' 張'
    ];
    if (mismatch) {
      lines.push('', '⚠ 這份 JSON 來自「' + normalized.calendarFile + '」，與目前檔「' + currentName + '」不同。');
    }
    lines.push('', '將以此取代本機「' + currentName + '」現有的便利貼設定（原有設定無法復原）。', '', '確定載入？');
    if (!window.confirm(lines.join('\n'))) return false;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify({
      notes: next.notes,
      hidden: next.hidden,
      lastId: next.lastId,
      lastIdx: next.lastIdx
    }));
  } catch (e) {
    showToast('寫入設定失敗：' + ((e && e.message) || e), 'error');
    return false;
  }
  const summary = noteCount + ' 張樣式、' + next.hidden.length + ' 張關閉';
  if (!hasCurrent) {
    showToast('已套用便利貼設定：開啟「' + currentName + '」後生效（' + summary + '）', 'success');
    return true;
  }
  calStickyResetStore();
  calStickyRebuild();
  let idx = next.lastId ? calStickyPages.findIndex((n) => n.identity === next.lastId) : -1;
  if (idx < 0) idx = Math.min(next.lastIdx, Math.max(0, calStickyPages.length - 1));
  if (idx < 0) idx = 0;
  calStickyRenderPage(idx, { toast: false });
  // 匯入設定時若正在編輯：折疊狀態跟隨新設定（勾選＝折疊／未勾選＝還原全文）
  if (calStickyEditMode) {
    if (calStickyNotePrefs(calStickyCurrentId).undoneChecksOnly) calStickyApplyDoneFold();
    else calStickyExpandDoneFold();
  }
  if (calStickySheetOpen()) {
    calStickyRenderSheetList();
    const prefs = calStickyCurrentId ? calStickyNotePrefs(calStickyCurrentId) : calStickyNotePrefs('');
    calStickySyncControls(prefs);
    calStickyRenderSwatches(prefs);
  }
  // 剛載入的 JSON 就是磁碟上的現況 → 基線對齊，不必再提示寫回
  calStickyMarkSettingsSaved();
  if (auto) {
    showToast('已套用便利貼設定 JSON：' + summary
      + (mismatch ? '（JSON 來自「' + normalized.calendarFile + '」）' : ''), 'success');
  } else {
    calStickyShowToast('已載入設定：' + summary);
  }
  return true;
}

// ===== 目錄：把 sticky>0 的行程展開成 N 張 =====
// 身分＝標題|日期|序號（與桌面便利貼同口徑）：evpN 是位置型 uid，重排後會漂移，不能當長期身分。
function calStickyIdentityOf(ev, idx) {
  return String((ev && ev.title) || '') + '|' + String((ev && ev.date) || '') + '|' + (parseInt(idx, 10) || 0);
}
function calStickyBuildCatalog() {
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) return [];
  // 📎 多檔聯運：用「主档 + include 只讀事件」的併集，否則來自 calendar-*.md 的便利貼
  //   雖在行程列表看得到徽標（sticky>0），卻不在便利貼翻頁清單裡 → 點徽標翻不到。
  //   calRefreshAll 是唯一可信來源（同時刷新 state.calEvents / calHolidays / calDiaries）。
  let events = [];
  if (typeof calRefreshAll === 'function') {
    calRefreshAll();
    events = (typeof state !== 'undefined' && Array.isArray(state.calEvents)) ? state.calEvents : [];
  } else if (typeof parseCalendarEvents === 'function' && typeof elements !== 'undefined' && elements.editor) {
    events = parseCalendarEvents(elements.editor.value);
  }
  const out = [];
  events.forEach((ev) => {
    // 不設上限：與桌面便利貼同一口徑（表單 UI 以 9 為輸入上限，但檔案既有 >9 張不可靜默截斷）
    const count = Math.max(0, parseInt(ev.sticky, 10) || 0);
    for (let i = 0; i < count; i += 1) {
      out.push({
        uid: ev.uid,
        idx: i,
        identity: calStickyIdentityOf(ev, i),
        title: ev.title || '',
        date: ev.date || '',
        endDate: ev.endDate || '',
        done: !!ev.done,
        color: ev.color || '',
        tags: Array.isArray(ev.tags) ? ev.tags.slice() : [],
        notes: ev.notes || '',
        // 📄 來源檔案：來自「開啟」多選併入的聯運行程才有值（主档＝空字串）。
        //   dirty＝該來源檔有便利貼修改還沒匯出寫回（chip/徽标打 ●）。
        src: ev.src || '',
        ro: !!ev.ro,
        dirty: !!ev.roDirty
      });
    }
  });
  return out;
}
function calStickyRebuild() {
  calStickyCatalog = calStickyBuildCatalog();
  const hidden = new Set(calStickyLoadStore().hidden);
  calStickyPages = calStickyCatalog.filter((n) => !hidden.has(n.identity));
}

// ===== 每張便利貼的顯示偏好 =====
function calStickyIsHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')); }
function calStickyNotePrefs(identity) {
  const store = calStickyLoadStore();
  const raw = (identity && store.notes[identity]) || {};
  return {
    color: calStickyIsHex(raw.color) ? raw.color : CAL_STICKY_DEF_BG,
    opacity: (typeof raw.opacity === 'number' && isFinite(raw.opacity)) ? Math.min(100, Math.max(20, Math.round(raw.opacity))) : 100,
    fontScale: (typeof raw.fontScale === 'number' && isFinite(raw.fontScale)) ? Math.min(2.5, Math.max(0.5, +raw.fontScale.toFixed(2))) : 1,
    fontColor: calStickyIsHex(raw.fontColor) ? raw.fontColor : CAL_STICKY_DEF_FG,
    fontWeight: [400, 600, 700].indexOf(raw.fontWeight) >= 0 ? raw.fontWeight : 400,
    undoneChecksOnly: raw.undoneChecksOnly === true
  };
}
function calStickyWritePrefs(identity, prefs) {
  if (!identity) return;
  calStickyLoadStore().notes[identity] = prefs;
  calStickySaveStore();
  // 樣式變更 → 保存角標依「與上次寫回的 JSON 是否不同」重算
  if (typeof updateStatus === 'function') updateStatus();
}

// ===== 色彩工具（透明度＝8 位 hex 的 alpha；標籤底色依字色亮度取反）=====
function calStickyParseHex(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function calStickyTint(hex, opacityPct) {
  const rgb = calStickyParseHex(hex) || [255, 243, 176];
  const a = Math.min(1, Math.max(0.2, (opacityPct == null ? 100 : opacityPct) / 100));
  return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + a.toFixed(2) + ')';
}
function calStickyContrastTagBg(hex) {
  const rgb = calStickyParseHex(hex);
  if (!rgb) return 'rgba(0, 0, 0, .07)';
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6 ? 'rgba(0, 0, 0, .18)' : 'rgba(255, 255, 255, .28)';
}
function calStickyApplyStyle(prefs) {
  const note = calStickyEl('calStickyNote');
  if (!note) return;
  note.style.background = calStickyTint(prefs.color, prefs.opacity);
  note.style.setProperty('--cal-sticky-fg', prefs.fontColor);
  // 🆕 紙張實色（不隨透明度變淡）：供搜尋高標做 reverse（字=紙色、底=字色）時取用
  note.style.setProperty('--cal-sticky-bg', calStickyTint(prefs.color, 100));
  note.style.setProperty('--cal-sticky-tag-bg', calStickyContrastTagBg(prefs.fontColor));
  const body = calStickyEl('calStickyBody');
  if (!body) return;
  body.style.fontSize = (CAL_STICKY_BASE_FONT * (prefs.fontScale || 1)).toFixed(2) + 'px';
  body.style.color = prefs.fontColor;
  body.style.fontWeight = String(prefs.fontWeight || 400);
  body.classList.toggle('cal-sticky-only-undone', !!prefs.undoneChecksOnly);
  // 編輯框與正文同一套字級/字色/字重（對齊桌面 applyContentFont），縮放偏好在編輯模式同樣生效
  const ea = calStickyEl('calStickyEditArea');
  if (ea) {
    ea.style.fontSize = (CAL_STICKY_BASE_FONT * (prefs.fontScale || 1)).toFixed(2) + 'px';
    ea.style.color = prefs.fontColor;
    ea.style.fontWeight = String(prefs.fontWeight || 400);
  }
}

// ===== meta / 子事件進度 =====
function calStickySpanDays(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return 1;
  return Math.round((d2 - d1) / 86400000) + 1;
}
function calStickyMetaText(note) {
  const d = note.date || '';
  const e = (note.endDate && note.endDate !== note.date) ? note.endDate : '';
  let s = d && e ? d + ' – ' + e + ' · 共' + calStickySpanDays(d, e) + '天' : (d || e || '');
  if (note.done) s += ' · 已完成';
  return s;
}
// 只統計非代碼圍欄內的 checkbox 行（與桌面 parseNoteChecks 同規則）
function calStickyParseChecks(text) {
  const out = [];
  if (!text) return out;
  let inFence = false;
  String(text).split('\n').forEach((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (m) out.push({ text: (m[3] || '').trim(), done: m[2] !== ' ' });
  });
  return out;
}
function calStickyProgressHtml(note) {
  const subs = calStickyParseChecks(note.notes);
  if (!subs.length) return '';
  const done = subs.filter((s) => s.done).length;
  const all = done === subs.length;
  return '<span class="cal-sticky-progress' + (all ? ' all-done' : '') +
    '" title="子事件：' + done + ' / ' + subs.length + ' 已完成">' + done + '/' + subs.length + '</span>';
}
// meta 行右側兩個操作（與桌面便利貼同口徑）：＋☐▾ 加入（三模式下拉）、☐/☑ 只看未完成
function calStickyMetaActionsHtml(prefs) {
  const on = !!(prefs && prefs.undoneChecksOnly);
  return '<span class="cal-sticky-meta-actions">' +
    '<button type="button" class="cal-sticky-meta-btn cal-sticky-addcheck" aria-haspopup="menu"' +
    ' title="加入內容（checkbox 子事件／MD 表格／自由編輯）" onclick="calStickyToggleAddCheckMenu(event)">＋☐▾</button>' +
    '<button type="button" class="cal-sticky-meta-btn cal-sticky-undone-toggle' + (on ? ' active' : '') + '"' +
    ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
    ' title="' + (on ? '僅顯示未完成的 checkbox 子事件（點擊顯示全部）' : '只顯示未完成的 checkbox 子事件') + '"' +
    ' onclick="calStickyToggleUndone()">' + (on ? '☑' : '☐') + '</button></span>';
}
function calStickySyncMetaActions(prefs) {
  const metaEl = calStickyEl('calStickyMeta');
  const btn = metaEl ? metaEl.querySelector('.cal-sticky-undone-toggle') : null;
  if (!btn) return;
  const on = !!(prefs && prefs.undoneChecksOnly);
  btn.textContent = on ? '☑' : '☐';
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '僅顯示未完成的 checkbox 子事件（點擊顯示全部）' : '只顯示未完成的 checkbox 子事件';
}
// ===== 🆕 ＋☐▾ 下拉選單（對齊桌面便利貼：checkbox 子事件／MD 表格／自由編輯）=====
function calStickyAddCheckMenuEl() { return calStickyEl('calStickyAddCheckMenu'); }
function calStickyAddCheckMenuOpen() {
  const menu = calStickyAddCheckMenuEl();
  return !!menu && menu.classList.contains('open');
}
function calStickyCloseAddCheckMenu() {
  const menu = calStickyAddCheckMenuEl();
  if (menu) menu.classList.remove('open');
}
function calStickyOpenAddCheckMenu() {
  const menu = calStickyAddCheckMenuEl();
  const stage = calStickyEl('calStickyStage');
  const meta = calStickyEl('calStickyMeta');
  const chip = meta ? meta.querySelector('.cal-sticky-addcheck') : null;
  if (!menu || !stage || !chip) return;
  menu.classList.add('open');
  const sr = stage.getBoundingClientRect();
  const cr = chip.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(cr.left - sr.left, sr.width - menu.offsetWidth - 6)) + 'px';
  const below = cr.bottom - sr.top + 6;
  // 剩餘空間不足時往上開，避免選單被 stage 下緣裁掉
  menu.style.top = (below + menu.offsetHeight > sr.height - 6
    ? Math.max(4, cr.top - sr.top - menu.offsetHeight - 6) : below) + 'px';
}
function calStickyToggleAddCheckMenu(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (calStickyAddCheckMenuOpen()) { calStickyCloseAddCheckMenu(); return; }
  calStickyOpenAddCheckMenu();
}
function calStickyPickAddMode(act) {
  calStickyCloseAddCheckMenu();
  if (!calStickyCurrentUid || typeof calOpenAddCheckDialog !== 'function') return;
  calOpenAddCheckDialog(calStickyCurrentUid, act, 'sticky');
}

// ===== 渲染一頁（循環）=====
function calStickyUpdateIndicator(current, total) {
  const text = total ? '第 ' + current + ' / ' + total + ' 張' : '沒有便利貼';
  const pageInd = calStickyEl('calStickyPageInd');
  if (pageInd) pageInd.textContent = text;
  const footInd = calStickyEl('calStickyFootInd');
  if (footInd) footInd.textContent = text;
  const foot = calStickyEl('calStickyFoot');
  if (foot) foot.style.display = total ? 'flex' : 'none';
  const multi = total > 1;
  const prevBtn = calStickyEl('calStickyPrevBtn');
  const nextBtn = calStickyEl('calStickyNextBtn');
  if (prevBtn) prevBtn.disabled = !multi;
  if (nextBtn) nextBtn.disabled = !multi;
  const editBtn = calStickyEl('calStickyEditBtn');
  if (editBtn) editBtn.disabled = !total;
  const modeBtn = calStickyEl('calStickyModeBtn');
  if (modeBtn) modeBtn.disabled = !total;
  const saveBtn = calStickyEl('calStickySaveBtn');
  if (saveBtn) saveBtn.disabled = !total;
}

// 顯示用短檔名：手機寬度有限，全名會被截成「calendar-calendar-d…」→ draft2 / draft3 分不出來。
//   聯運檔一律是 calendar*.md，前綴沒有資訊量，所以剝掉重複的 calendar 前綴，
//   只留真正能區分的那一段（calendar-calendar-draft2.md → draft2.md）；完整檔名留在 title。
function calStickyShortSrc(name) {
  let s = String(name || '').trim();
  let guard = 0;
  while (guard < 4 && /^calendar[-_.]/i.test(s)) { s = s.replace(/^calendar[-_.]/i, ''); guard += 1; }
  return s || String(name || '').trim();
}
// 🆕 來源檔案徽標（對齊桌面便利貼 applyDocBadge）：只在這張便利貼的行程來自
//   聯運檔（「開啟」時同批選進來的其它 calendar*.md）才出現。權限與桌面一致——**便利貼內容可改**（寫回來源檔），
//   只有行程本體（標題／日期／刪除／完成）鎖住，所以文案要說清楚「可編、但行程不可編」。
//   有修改未匯出時（dirty）尾巴加 ●，提醒還要把檔案匯出覆寫原檔。
function calStickyApplySrcBadge(note) {
  const el = calStickyEl('calStickySrcBadge');
  if (!el) return;
  const src = String((note && note.src) || '').trim();
  if (src) {
    const dirty = !!note.dirty;
    el.textContent = '📄 ' + calStickyShortSrc(src) + (dirty ? ' ●' : '');
    el.title = '內容來源：' + src +
      '\n（便利貼內容可修改；行程本體不可編輯）' +
      (dirty ? '\n● 有修改還在本機，需在 📎 聯運檔案清單按 ↓ 匯出覆寫原檔' : '');
    el.classList.toggle('dirty', dirty);
    el.classList.add('show');
  } else {
    el.textContent = '';
    el.removeAttribute('title');
    el.classList.remove('show');
    el.classList.remove('dirty');
  }
}
function calStickyRenderPage(target, options) {
  options = options || {};
  calStickyCloseAddCheckMenu();   // 換頁＝＋☐ 的位置與所屬行程都變了，選單先收合
  calStickyRebuild();
  const total = calStickyPages.length;
  const noteEl = calStickyEl('calStickyNote');
  const emptyEl = calStickyEl('calStickyEmpty');
  if (!total) {
    calStickyIndex = 0;
    calStickyCurrentId = '';
    calStickyCurrentUid = '';
    calStickyApplySrcBadge(null);   // 沒有便利貼時徽標一併清掉，否則會殘留上一張的檔名
    // 沒有便利貼：編輯模式直接退出（編輯對象已不存在，不留 textarea 與未保存態）
    if (calStickyEditMode) {
      calStickyEditMode = false;
      calStickyEditDirty = false;
      if (noteEl) noteEl.classList.remove('editing');
      const ea0 = calStickyEl('calStickyEditArea');
      if (ea0) ea0.style.boxShadow = '';
      calStickyResetDoneFold();
      calStickySyncEditBtn();
    }
    if (noteEl) noteEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      // 分兩種空狀態：全部被關掉 vs 這份文件根本沒有便利貼
      emptyEl.innerHTML = calStickyCatalog.length
        ? '所有便利貼都已關閉。<br>點左上角 ☰ 開啟清單。'
        : '此 calendar 檔目前沒有便利貼。<br><br>在行程編輯表單把「便利貼張數」設為 1 以上，<br>即可在這裡以翻頁方式查看。';
    }
    calStickyUpdateIndicator(0, 0);
    calStickyRenderSheetList();
    calStickySyncControls(null);
    calStickyRenderSwatches(calStickyNotePrefs(''));
    return;
  }
  if (noteEl) noteEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  let i = (typeof target === 'number' && isFinite(target)) ? Math.trunc(target) : calStickyIndex;
  i = ((i % total) + total) % total; // 首尾循環，與桌面翻頁一致
  calStickyIndex = i;
  const note = calStickyPages[i];
  calStickyCurrentId = note.identity;
  calStickyCurrentUid = note.uid;
  const store = calStickyLoadStore();
  if (store.lastId !== note.identity || store.lastIdx !== i) {
    store.lastId = note.identity;
    store.lastIdx = i;
    calStickySaveStore();
  }
  const prefs = calStickyNotePrefs(note.identity);
  const titleEl = calStickyEl('calStickyTitle');
  if (titleEl) titleEl.innerHTML = note.title ? calRenderInlineMarkdown(note.title) : '(無標題)';
  calStickyApplySrcBadge(note);
  const metaEl = calStickyEl('calStickyMeta');
  if (metaEl) metaEl.innerHTML = escapeHtml(calStickyMetaText(note)) + calStickyProgressHtml(note) + calStickyMetaActionsHtml(prefs);
  const tagsEl = calStickyEl('calStickyTags');
  if (tagsEl) {
    tagsEl.innerHTML = note.tags.map((t) =>
      '<li>' + escapeHtml(typeof calTagLabel === 'function' ? calTagLabel(t) : t) + '</li>').join('');
  }
  const bodyEl = calStickyEl('calStickyBody');
  if (bodyEl) {
    // forceEditable=true：便利貼是 include 備註唯一的編輯場所（行程檢視對 ro 行程是唯讀的），
    //   所以即使 note.ro 也照樣給 ✎ 與可勾 checkbox；寫回仍走 calCommitEventNotes（只改來源檔那一塊）
    bodyEl.innerHTML = note.notes
      ? calRenderNotes(note.notes, note.uid, true)
      : '<p style="opacity:.6">（無備註）</p>';
    if (options.resetScroll !== false) bodyEl.scrollTop = 0;
  }
  // 🆕 定位高亮：渲染模式（非編輯）下，若定位開關生效，把搜尋詞以 <mark> 標示在標題與內容
  if (calStickyLocateEffective() && !calStickyEditMode) {
    const q = calStickyGetQuery();
    calStickyWrap(titleEl, q);
    calStickyWrap(bodyEl, q);
  }
  calStickyApplyStyle(prefs);
  calStickyUpdateIndicator(i + 1, total);
  calStickyRenderSheetList();
  calStickySyncControls(prefs);
  // 色板只在設定面板打開時重建（54 顆色鈕 × 每次翻頁會白白拖慢低階手機）；開面板時另有一次完整同步
  if (options.swatches === true || calStickySheetOpen()) calStickyRenderSwatches(prefs);
  if (options.toast) calStickyShowToast('第 ' + (i + 1) + ' / ' + total + ' 張');
}

function calStickyStep(delta) {
  if (!calStickyIsOpen || calStickyPages.length <= 1) return;
  if (!calStickyGuardDirtyForNav()) return;
  calStickyRenderPage(calStickyIndex + delta, { toast: true });
}

function calStickyShowToast(text) {
  const el = calStickyEl('calStickyToast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  if (calStickyToastTimer) clearTimeout(calStickyToastTimer);
  calStickyToastTimer = setTimeout(() => {
    el.classList.remove('show');
    calStickyToastTimer = null;
  }, 1000);
}

// ===== 清單（開 / 關；未開啟項獨立編號）=====
// 便利貼來自 calendar.md 的 ev.title，裡面會摻雜 Markdown/HTML/維基語法（<BIG>、**、[[...]]、# 標題、[x] 等）。
// 桌面版便利貼的 title 存的是純文字（從編輯器 textContent 來），所以清單不需要再 strip；
// LITE 版 title 直接用 ev.title（原始 markdown），必須這裡先清理才能在翻頁清單顯示乾淨的名稱。
function calStripTitleDecor(text) {
  let s = String(text || '');
  // 1) HTML 標籤（含 <BIG>、<u>、<em>、<strong>、<code> 等所有標籤）
  s = s.replace(/<[^>]+>/g, '');
  // 2) 維基連結 [[文字]]、[[文字|顯示]] → 保留顯示文字
  s = s.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (m, label, shown) => (shown || label).trim());
  // 3) Markdown 連結 [文字](url) / ![alt](url) → 保留文字
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 4) Markdown 強調／斜體／刪除線 **text** / *text* / __text__ / _text_ / ~~text~~
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1$2');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  // 5) Checkbox [x] [ ] [X] → 拿掉
  s = s.replace(/\[[xX ]\]\s*/g, '');
  // 6) 行首的 # / ## / ### 標題記號（只在行首才是 heading）
  s = s.replace(/^\s{0,3}#{1,6}\s+/, '');
  // 7) 多餘空白壓縮
  return s.replace(/\s+/g, ' ').trim();
}
function calStickyNoteLabel(note) {
  const name = calStripTitleDecor(note.title) || '未命名便利貼';
  return name + (note.idx > 0 ? ' (' + (note.idx + 1) + ')' : '');
}
// 🆕 便利貼清單搜尋：標題（去裝飾）＋ 內容（notes）模糊匹配（不區分大小寫）
function calStickyMatchQuery(note, q) {
  if (!q) return true;
  const hay = (calStickyNoteLabel(note) + ' ' + (note.title || '') + ' ' + (note.notes || '')).toLowerCase();
  return hay.indexOf(q) >= 0;
}

// 🆕 combo 搜尋框：定位開關（locate toggle）—— 在便利貼渲染模式以 <mark> 高亮搜尋結果
//   規則：有搜尋內容時預設開啟（使用者可自行關閉）；無內容時固定關閉（不可開啟）。
let calStickyLocateOn = false;        // 使用者意圖：預設開 / 手動關
let calStickyLastQueryEmpty = true;   // 上一次查詢是否為空（用於「內容出現→預設開」的轉場判斷）
function calStickyGetQuery() {
  const el = calStickyEl('calStickySearch');
  return (((el && el.value) || '').trim().toLowerCase());
}
// 真正生效的定位：開關開著「且」有搜尋內容
function calStickyLocateEffective() {
  return calStickyLocateOn && !!calStickyGetQuery();
}
// 搜尋框 oninput：先處理「內容出現→預設開啟 / 內容消失→強制關閉」的轉場，再同步開關 UI 與重繪
function calStickyOnSearchInput() {
  const q = calStickyGetQuery();
  const empty = !q;
  if (!empty && calStickyLastQueryEmpty) calStickyLocateOn = true; // 內容剛出現 → 預設開啟
  if (empty) calStickyLocateOn = false;                            // 內容消失 → 強制關閉
  calStickyLastQueryEmpty = empty;
  calStickySyncLocate();
  calStickyRenderSheetList();
  // 渲染模式（翻頁視圖）即時反映定位高亮
  if (calStickyPages.length) calStickyRenderPage(calStickyIndex, { toast: false });
}
// 手動點擊定位開關（無內容時 disabled，不可開啟）
function calStickyToggleLocate() {
  if (!calStickyGetQuery()) return;
  calStickyLocateOn = !calStickyLocateOn;
  calStickySyncLocate();
  if (calStickyPages.length) calStickyRenderPage(calStickyIndex, { toast: false });
}
// 同步定位按鈕的 disabled / aria-pressed / 文字狀態
function calStickySyncLocate() {
  const btn = calStickyEl('calStickyLocateBtn');
  if (!btn) return;
  const q = calStickyGetQuery();
  const on = calStickyLocateOn && !!q;
  btn.disabled = !q;
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('on', on);
  btn.textContent = on ? '📍 定位：開' : '📍 定位';
}
// 把 root 內所有文本節點的命中片段包成 <mark class="search-highlight">（只碰文本節點，不破壞標籤結構）
function calStickyWrap(root, query) {
  if (!root || !query) return;
  const lower = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentNode;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.nodeName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'noscript' ||
          (tag === 'mark' && p.classList.contains('search-highlight'))) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const textNode of nodes) {
    const text = textNode.nodeValue;
    const lowerText = text.toLowerCase();
    const hits = [];
    let idx = 0;
    while ((idx = lowerText.indexOf(lower, idx)) !== -1) { hits.push([idx, idx + query.length]); idx += query.length; }
    if (!hits.length) continue;
    const parent = textNode.parentNode;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const h of hits) {
      if (h[0] > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, h[0])));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(h[0], h[1]);
      frag.appendChild(mark);
      cursor = h[1];
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    parent.replaceChild(frag, textNode);
  }
}
function calStickyRenderSheetList() {
  const listEl = calStickyEl('calStickyList');
  if (!listEl) return;
  const titleEl = calStickyEl('calStickyListTitle');
  const q = (((calStickyEl('calStickySearch') && calStickyEl('calStickySearch').value) || '').trim().toLowerCase());
  const hidden = new Set(calStickyLoadStore().hidden);
  const inactive = calStickyCatalog.filter((n) => hidden.has(n.identity) && calStickyMatchQuery(n, q));
  const pages = calStickyPages.filter((n) => calStickyMatchQuery(n, q));
  if (titleEl) {
    const base = '翻頁清單（' + calStickyPages.length + ' 項；點名稱顯示，點開 / 關切換）';
    titleEl.textContent = q ? (base + ' · 符合 ' + (pages.length + inactive.length) + ' 項') : base;
  }
  const frag = document.createDocumentFragment();
  const appendRow = (note, no) => {
    const row = document.createElement('div');
    row.className = 'cal-sticky-list-item';
    const noEl = document.createElement('span');
    noEl.className = 'cal-sticky-list-no';
    noEl.textContent = String(no) + '.';
    noEl.setAttribute('aria-hidden', 'true');
    const nameEl = document.createElement('button');
    nameEl.type = 'button';
    nameEl.className = 'cal-sticky-list-name';
    const label = calStickyNoteLabel(note);
    // 📄 聯運檔的便利貼在清單裡也打個記號，否則翻頁時分不清哪張不可編輯
    const shown = note.src ? '📄 ' + label : label;
    nameEl.textContent = shown;
    nameEl.title = shown + '（點擊顯示這張便利貼）';
    nameEl.addEventListener('click', () => {
      const idx = calStickyPages.findIndex((n) => n.identity === note.identity);
      if (idx >= 0) {
        if (!calStickyGuardDirtyForNav()) return;
        calStickyRenderPage(idx, { toast: false });
        calStickyCloseSheet();
      }
    });
    const stateEl = document.createElement('button');
    stateEl.type = 'button';
    const isOpen = !hidden.has(note.identity);
    stateEl.className = 'cal-sticky-list-state' + (isOpen ? ' open' : '');
    stateEl.textContent = isOpen ? '開' : '關';
    stateEl.title = isOpen ? '關閉這張便利貼（不計入翻頁；狀態會記住）' : '開啟這張便利貼（加入翻頁）';
    stateEl.setAttribute('aria-label', stateEl.title);
    stateEl.addEventListener('click', () => calStickyToggleHidden(note.identity));
    row.append(noEl, nameEl, stateEl);
    frag.appendChild(row);
  };
  pages.forEach((note, i) => appendRow(note, i + 1));
  if (inactive.length) {
    const title = document.createElement('div');
    title.className = 'cal-sticky-list-inactive-title';
    title.textContent = '未開啟（不計入翻頁）';
    frag.appendChild(title);
    // 未開啟項獨立編號（從 1 開始），與桌面便利貼清單同口徑
    inactive.forEach((note, i) => appendRow(note, i + 1));
  }
  if (!calStickyCatalog.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-sticky-list-title';
    empty.textContent = '目前沒有便利貼（在行程表單設定「便利貼張數」）。';
    frag.appendChild(empty);
  } else if (!pages.length && !inactive.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-sticky-list-title';
    empty.textContent = '沒有符合「' + q + '」的便利貼。';
    frag.appendChild(empty);
  }
  listEl.replaceChildren(frag);
}
function calStickyToggleHidden(identity) {
  if (!identity) return;
  const store = calStickyLoadStore();
  const at = store.hidden.indexOf(identity);
  const wasHidden = at >= 0;
  if (wasHidden) store.hidden.splice(at, 1);
  else store.hidden.push(identity);
  calStickySaveStore();
  if (typeof updateStatus === 'function') updateStatus();   // 關閉清單也算設定變更
  calStickyRebuild();
  if (wasHidden) {
    // 剛開啟：直接跳到它，讓使用者立刻看到
    const idx = calStickyPages.findIndex((n) => n.identity === identity);
    calStickyRenderPage(idx >= 0 ? idx : 0, { toast: true });
    return;
  }
  // 剛關閉：若關的是當前頁，留在同一頁次（順勢顯示下一張）；否則留在原張
  const stillVisible = calStickyPages.some((n) => n.identity === calStickyCurrentId);
  const idx = stillVisible
    ? calStickyPages.findIndex((n) => n.identity === calStickyCurrentId)
    : Math.min(calStickyIndex, calStickyPages.length - 1);
  calStickyRenderPage(idx, { toast: false });
}

// ===== 清單 / 設定 bottom sheet =====
function calStickySheetOpen() {
  const sheet = calStickyEl('calStickySheet');
  return !!sheet && sheet.style.display !== 'none';
}
function calStickyCloseSheet() {
  const sheet = calStickyEl('calStickySheet');
  if (sheet) sheet.style.display = 'none';
  const btn = calStickyEl('calStickyMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function calStickyOpenSheet() {
  if (!calStickyIsOpen) return;
  const s = calStickyEl('calStickySearch');
  if (s) s.value = '';
  // 開清單＝清空搜尋，定位隨之強制關閉（內容消失→關；下次輸入再預設開）
  calStickyLocateOn = false;
  calStickyLastQueryEmpty = true;
  calStickySyncLocate();
  calStickyRenderSheetList();
  const prefs = calStickyCurrentId ? calStickyNotePrefs(calStickyCurrentId) : calStickyNotePrefs('');
  calStickySyncControls(prefs);
  calStickyRenderSwatches(prefs);
  const sheet = calStickyEl('calStickySheet');
  if (sheet) sheet.style.display = 'flex';
  const btn = calStickyEl('calStickyMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function calStickySyncControls(prefs) {
  const has = !!calStickyCurrentId;
  const p = prefs || calStickyNotePrefs('');
  const undo = calStickyEl('calStickyUndone');
  if (undo) {
    undo.textContent = '只顯示未完成 checkbox：' + (p.undoneChecksOnly ? '開' : '關');
    undo.classList.toggle('active', !!p.undoneChecksOnly);
    undo.setAttribute('aria-pressed', String(!!p.undoneChecksOnly));
    undo.disabled = !has;
  }
  const op = calStickyEl('calStickyOpacity');
  if (op) {
    op.value = String(p.opacity);
    op.disabled = !has;
  }
  const opVal = calStickyEl('calStickyOpacityVal');
  if (opVal) opVal.textContent = p.opacity + '%';
  const zoomInd = calStickyEl('calStickyZoomInd');
  if (zoomInd) zoomInd.textContent = Math.round((p.fontScale || 1) * 100) + '%';
  const zoomOut = calStickyEl('calStickyZoomOut');
  const zoomIn = calStickyEl('calStickyZoomIn');
  if (zoomOut) zoomOut.disabled = !has;
  if (zoomIn) zoomIn.disabled = !has;
  const weights = calStickyEl('calStickyWeights');
  if (weights) {
    weights.querySelectorAll('button[data-w]').forEach((b) => {
      b.classList.toggle('active', (parseInt(b.getAttribute('data-w'), 10) || 400) === (p.fontWeight || 400));
      b.disabled = !has;
    });
  }
}

function calStickyHasColor(palette, color) {
  const c = String(color || '').toLowerCase();
  return palette.some((x) => x.toLowerCase() === c);
}
function calStickyFillSwatches(container, palette, current, onPick) {
  if (!container) return;
  container.replaceChildren();
  palette.forEach((hex) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-sticky-sw' + (hex.toLowerCase() === String(current || '').toLowerCase() ? ' active' : '');
    btn.style.background = hex;
    btn.title = hex;
    btn.setAttribute('aria-label', '顏色 ' + hex);
    btn.addEventListener('click', () => onPick(hex));
    container.appendChild(btn);
  });
  // 自選色：彩虹圓點內嵌透明 color input（與桌面便利貼同做法）
  const custom = document.createElement('span');
  custom.className = 'cal-sticky-sw cal-sticky-sw-custom';
  custom.title = '自訂顏色';
  if (!calStickyHasColor(palette, current)) custom.classList.add('active');
  const input = document.createElement('input');
  input.type = 'color';
  input.value = calStickyIsHex(current) ? current : palette[0];
  input.setAttribute('aria-label', '自訂顏色');
  input.addEventListener('input', () => onPick(input.value));
  custom.appendChild(input);
  container.appendChild(custom);
}
function calStickyRenderSwatches(prefs) {
  const p = prefs || calStickyNotePrefs('');
  calStickyFillSwatches(calStickyEl('calStickyBgSwatches'), CAL_STICKY_BG_PALETTE, p.color, (hex) => calStickyUpdatePrefs({ color: hex }));
  calStickyFillSwatches(calStickyEl('calStickyFgSwatches'), CAL_STICKY_FG_PALETTE, p.fontColor, (hex) => calStickyUpdatePrefs({ fontColor: hex }));
}

function calStickyUpdatePrefs(patch) {
  if (!calStickyCurrentId || !patch) return;
  const next = Object.assign(calStickyNotePrefs(calStickyCurrentId), patch);
  calStickyWritePrefs(calStickyCurrentId, next);
  const note = calStickyPages[calStickyIndex];
  if (note && note.identity === calStickyCurrentId) calStickyApplyStyle(next);
  calStickySyncControls(next);
  if ('undoneChecksOnly' in patch) {
    calStickySyncMetaActions(next);
    // 折疊與「只看未完成 checkbox」聯動：勾選才折疊，取消勾選立即還原全文
    if (calStickyEditMode) {
      if (next.undoneChecksOnly) calStickyApplyDoneFold();
      else calStickyExpandDoneFold();
    }
  }
  if ('color' in patch || 'fontColor' in patch) calStickyRenderSwatches(next);
}
function calStickyToggleUndone() {
  if (!calStickyCurrentId) return;
  const p = calStickyNotePrefs(calStickyCurrentId);
  calStickyUpdatePrefs({ undoneChecksOnly: !p.undoneChecksOnly });
}
function calStickyZoom(delta) {
  if (!calStickyCurrentId) return;
  const p = calStickyNotePrefs(calStickyCurrentId);
  const next = Math.max(0.5, Math.min(2.5, +((p.fontScale || 1) + delta).toFixed(2)));
  calStickyUpdatePrefs({ fontScale: next });
}

// ===== 開啟 / 關閉 / 外部資料變更 =====
// ev（可選）＝從清單行的便利貼徽標進來：開在該行程的第一張，而不是上次停留的那張
function calStickyOpen(ev) {
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) {
    // 🛡️ 嚴格校验路線（2026-10-24）：不再只吐錯誤 toast——直接帶 intent='calendar' 跳檔案選單，
    //   該輪 handleFileSelect 只收 calendar*.md（選錯拒絕＋說明），選成功自動開便利貼。
    //   iOS 原生選單無法按檔名前綴過濾，把關只能做在選擇之後。
    if (typeof openFilePicker === 'function') {
      if (typeof showToast === 'function') showToast('便利貼只適用 calendar*.md：請在選單挑選檔案', 'info');
      openFilePicker('calendar');
    } else if (typeof showToast === 'function') {
      showToast('便利貼僅適用於 calendar 檔（檔名 calendar*.md）', 'error');
    }
    return;
  }
  const overlay = calStickyEl('calStickyOverlay');
  if (!overlay) return;
  calStickyResetStore();
  calStickyIsOpen = true;
  calStickyPendingRename = null;
  overlay.style.display = 'flex';
  calStickyCloseSheet();
  calStickyRebuild();
  // 指定行程：以「標題|日期|0」認領它的第一張（身分口徑同 calStickyIdentityOf）
  let idx = -1;
  if (ev) idx = calStickyPages.findIndex((n) => n.identity === calStickyIdentityOf(ev, 0));
  // 認不到又有其他便利貼 → 說明是被關掉了（☰ 清單可重新開啟），再退回上次頁次
  if (ev && idx < 0 && calStickyPages.length) {
    calStickyShowToast('此行程的便利貼目前關閉中，可在 ☰ 清單重新開啟');
  }
  // 沒指定 / 認不到：還原上次顯示的那張（以「標題|日期|序號」認領），再退上次頁次
  if (idx < 0) {
    const store = calStickyLoadStore();
    const lastId = store.lastId;
    idx = lastId ? calStickyPages.findIndex((n) => n.identity === lastId) : -1;
    if (idx < 0 && calStickyPages.length) idx = Math.min(store.lastIdx, calStickyPages.length - 1);
    if (idx < 0) idx = 0;
  }
  calStickyRenderPage(idx, { toast: false });
}
function calStickyClose(skipDirtyGuard) {
  console.log('[calStickyClose] called skip=' + skipDirtyGuard + ' editMode=' + calStickyEditMode + ' editDirty=' + calStickyEditDirty + ' formOpen=' + (document.getElementById('ev-form-overlay')?.style.display === 'flex') + ' formDirty=' + (typeof calIsEventFormDirty === 'function' ? calIsEventFormDirty() : 'NA'));
  // 🚨 行程表單開著且有未保存改動 → 先處理行程表單（避免便利貼關了、行程表單被遺漏）
  const formOpen = document.getElementById('ev-form-overlay')?.style.display === 'flex';
  if (!skipDirtyGuard && formOpen && typeof calIsEventFormDirty === 'function' && calIsEventFormDirty()) {
    const ok = window.confirm('🚨 行程編輯表單有未保存的改動\n\n請先處理行程表單，再關閉便利貼');
    if (ok) {
      // 不幫用戶自動關行程表單——讓用戶自己處理（保存 / 關閉 / 取消）
      return;
    }
  }
  // 便利貼 textarea 編輯中有未保存改動
  if (!skipDirtyGuard && calStickyEditMode && calStickyEditDirty) {
    const ok = window.confirm('🚨 便利貼內容有未保存的改動\n\n【確定】＝先保存再關閉便利貼\n【取消】＝留在編輯模式（不丟失改動）');
    if (ok) { if (!calStickySaveEdit()) return; }
    else return;
  }
  calStickyIsOpen = false;
  calStickyPendingRename = null;
  calStickyEditMode = false;
  calStickyResetDoneFold();
  calStickyEditDirty = false;
  const noteEl = calStickyEl('calStickyNote');
  if (noteEl) noteEl.classList.remove('editing');
  const ea = calStickyEl('calStickyEditArea');
  if (ea) ea.style.boxShadow = '';
  calStickySyncEditBtn();
  const overlay = calStickyEl('calStickyOverlay');
  if (overlay) overlay.style.display = 'none';
  calStickyCloseAddCheckMenu();
  calStickyCloseSheet();
}

// ✎ 編輯：開既有的行程表單（彈層 z-index 高於便利貼，存檔後由 applyEventsToEditor 觸發刷新）
function calStickyEditCurrent() {
  if (!calStickyCurrentUid || typeof openEventForm !== 'function') return;
  calStickyCloseSheet();
  calStickyPendingRename = { uid: calStickyCurrentUid, identity: calStickyCurrentId };
  openEventForm(calStickyCurrentUid);
}

// ===== 🆕 編輯模式：textarea 直接改事件原始 Markdown（notes），對齊桌面便利貼 setEditMode / saveNoteEdit =====
//  · 手動保存制：輸入只標「未保存」（紅色內圈描邊），按「保存」才寫回；離開編輯／翻頁／關閉時有改動先確認。
//  · 寫回與 checkbox 勾選同一條路徑：主檔 → calCommitEventNotes 序列化回編輯緩衝；
//    include(ro) → 只改來源檔那一個 ## EVENT 區塊的 Remark（絕不整份重畫）。
let calStickyEditMode = false;
let calStickyEditDirty = false;
let calStickyEditSavePending = false;
let calStickyEditDirtyTimer = null;

function calStickyCurrentEvent() {
  return ((typeof state !== 'undefined' && Array.isArray(state.calEvents)) ? state.calEvents : [])
    .find((e) => e.uid === calStickyCurrentUid) || null;
}
// 未保存提示：編輯框內圈描邊（紅＝未保存；綠＝剛保存，1.6 秒淡出），與桌面 markEditDirty 同口徑
function calStickyMarkEditDirty(on) {
  const ea = calStickyEl('calStickyEditArea');
  if (!ea) return;
  if (calStickyEditDirtyTimer) { clearTimeout(calStickyEditDirtyTimer); calStickyEditDirtyTimer = null; }
  if (on) {
    ea.title = '有未保存的改動 —— 按「保存」寫回';
    ea.style.boxShadow = 'inset 0 0 0 1px rgba(220,38,38,.55)';
  } else {
    ea.title = '';
    ea.style.boxShadow = 'inset 0 0 0 1px rgba(34,197,94,.5)';
    calStickyEditDirtyTimer = setTimeout(() => {
      if (ea) ea.style.boxShadow = '';
      calStickyEditDirtyTimer = null;
    }, 1600);
  }
}
function calStickySaveEdit() {
  const ea = calStickyEl('calStickyEditArea');
  if (!ea || calStickyEditSavePending) return false;
  const ev = calStickyCurrentEvent();
  if (!ev) { showToast('找不到該便利貼的來源行程', 'error'); return false; }
  if (typeof calNotesRoLocked === 'function' && calNotesRoLocked(ev, true)) return false;
  calStickyEditSavePending = true;
  const prevNotes = ev.notes;
  ev.notes = calStickyDoneFoldCurrentText();   // 折疊中：把隱藏行按原錨點合併回全文再落盤
  const ok = (typeof calCommitEventNotes === 'function') ? calCommitEventNotes(ev) : false;
  calStickyEditSavePending = false;
  if (!ok) {
    ev.notes = prevNotes;   // 寫回被拒（區塊位置/標題已變）：還原記憶體值，避免與檔案脫節
    return false;
  }
  calStickyRefreshDoneFoldAfterSave();
  calStickyEditDirty = false;
  calStickyMarkEditDirty(false);
  // ro 路徑 calCommitEventNotes 已自刷；主檔路徑補刷一次，讓進度徽章/來源●同趟更新
  if (!ev.ro && typeof calStickyRefreshIfOpen === 'function') calStickyRefreshIfOpen();
  return true;
}
function calStickySyncEditBtn() {
  const modeBtn = calStickyEl('calStickyModeBtn');
  const saveBtn = calStickyEl('calStickySaveBtn');
  const editBtn = calStickyEl('calStickyEditBtn');
  const closeBtn = calStickyEl('calStickyCloseBtn');
  if (modeBtn) {
    if (calStickyEditMode) {
      // 編輯模式：mode 按鈕變成「保存並返回」
      // click handler 在 calStickyInit 裡根據 calStickyEditMode 分流：
      // calStickyEditMode=true → calStickySaveEdit() 成功後 calStickySetEditMode(false)
      modeBtn.textContent = '保存並返回';
      modeBtn.title = '保存改動並返回渲染模式';
    } else {
      modeBtn.textContent = '✎';
      modeBtn.title = '切換到編輯模式（直接改原始 Markdown）';
    }
    modeBtn.setAttribute('aria-label', modeBtn.title);
    modeBtn.classList.toggle('active', calStickyEditMode);
  }
  if (saveBtn) saveBtn.style.display = calStickyEditMode ? '' : 'none';
  // 🚨 模式鎖：進入 textarea 編輯模式 → 隱藏頂部的「✎ 編輯行程」和「✕ 關閉便利貼」
  if (editBtn) editBtn.style.display = calStickyEditMode ? 'none' : '';
  if (closeBtn) closeBtn.style.display = calStickyEditMode ? 'none' : '';
}
function calStickySetEditMode(edit) {
  const note = calStickyEl('calStickyNote');
  const ea = calStickyEl('calStickyEditArea');
  if (!note || !ea) return;
  // 離開編輯前：有未保存改動 → 先確認（取消＝留在編輯模式，不丟改動）
  if (!edit && calStickyEditMode && calStickyEditDirty) {
    const ok = window.confirm('🚨 便利貼內容有未保存的改動\n\n【確定】＝先保存再返回閱讀模式\n【取消】＝留在編輯模式（不丟失改動）');
    if (ok) { if (!calStickySaveEdit()) return; }
    else return;
  }
  calStickyEditMode = !!edit;
  if (calStickyEditMode) {
    const ev = calStickyCurrentEvent();
    ea.value = ev ? (ev.notes || '') : '';
    calStickyEditDirty = false;
    ea.style.boxShadow = '';
    ea.scrollTop = 0;
    note.classList.add('editing');
    calStickyApplyStyle(calStickyNotePrefs(calStickyCurrentId));   // 字級/字色/字重同步到編輯框
    calStickyEditGutter.start();
    calStickyApplyDoneFold();
  } else {
    note.classList.remove('editing');
    calStickyEditDirty = false;
    calStickyResetDoneFold();
    ea.style.boxShadow = '';
    // 渲染模式：重拉最新渲染結果（編輯回寫後緩衝已變，這裡確保顯示最新）
    calStickyRenderPage(calStickyIndex, { toast: false, resetScroll: false });
  }
  calStickySyncEditBtn();
}
// 翻頁 / 清單跳轉前的髒守門（對齊桌面 renderFlipPage）：確定＝保存再導航；取消＝中止。
// 導航成功一律退出編輯模式（每張各自編輯，避免 textarea 內容錯位）。
function calStickyGuardDirtyForNav() {
  if (!calStickyEditMode) return true;
  if (calStickyEditDirty) {
    const ok = window.confirm('🚨 便利貼內容有未保存的改動\n\n【確定】＝先保存再切換到下一張\n【取消】＝留在本頁（不丟失改動）');
    if (!ok) return false;
    if (!calStickySaveEdit()) return false;
  }
  calStickyEditMode = false;
  calStickyResetDoneFold();
  const note = calStickyEl('calStickyNote');
  if (note) note.classList.remove('editing');
  const ea = calStickyEl('calStickyEditArea');
  if (ea) ea.style.boxShadow = '';
  calStickySyncEditBtn();
  return true;
}
// 行號邊条：與 #editor 共用 app.js 的 createLineGutter（同名算法第三份實例）；
// 顯隱＝便利貼開著 ＋ 編輯模式 ＋ textarea 真實可見（offsetParent），離開後 tick 自停
const calStickyEditGutter = createLineGutter({
  taId: 'calStickyEditArea',
  wrapId: 'calStickyEditWrap',
  gutterId: 'calStickyEditGutter',
  innerId: 'calStickyEditGutterInner',
  chrome: 10,
  visible: function (e) { return calStickyIsOpen && calStickyEditMode && e.ta.offsetParent !== null; },
  // 折疊時行號沿用原文編號（可見行顯示 1,2,5…），並在折疊縫隙上渲染可單獨展開的標記
  count: function () { return calStickyDoneFoldState ? calStickyDoneFoldState.orig.length : 0; },
  label: function (i) { return calStickyDoneFoldLabel(i); },
  decorate: function (info) { calStickyDoneFoldRenderRail(info); },
});

// ===== 🆕 編輯模式：折疊已完成的 checkbox（- [x] / - [X]）=====
// textarea 沒有「隱藏行」能力：編輯框放投影後的可見行，被折疊的原始行留在 state；
// 展開／保存時用行級 LCS 依原錨點插回 —— 折疊期間改／刪任何可見行都不會丟隱藏內容。
// 只折 checkbox 那一行（支援 > 引用前綴）；圍欄程式碼區塊內的 - [x] 是範例，不折。
const CAL_STICKY_DONE_CHECK_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\](?=[ \t]|$)/;

function calStickyDoneFoldHiddenIndexes(lines) {
  const hidden = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] == null ? '' : lines[i]).replace(/\r$/, '');
    const fm = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && !fm[2].trim()) fence = null;
      continue;
    }
    if (fm) { fence = { ch: fm[1][0], len: fm[1].length }; continue; }
    if (CAL_STICKY_DONE_CHECK_RE.test(line)) hidden.push(i);
  }
  return hidden;
}

function calStickyProjectDoneLines(lines, hiddenIdx) {
  const skip = new Set(hiddenIdx);
  const view = [];
  const map = [];
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    view.push(lines[i]);
    map.push(i);
  }
  return { view: view, map: map };
}

// 行級 LCS：回傳 base 每行在 cur 的行號（-1＝被改／刪）。超大文件退化為「前綴＋後綴」對齊，
// 只在中間改動處失去精確錨點（隱藏行仍按順序插回），避免 O(n*m) 記憶體。
// 行被编辑（非删/插）时 LCS 认不出是同一行，会让相邻隐藏块错位到编辑行前面；
// 用「共同前缀 ≥ 较短行的 60%（且至少 3 字符）」把它们配回锚点。仅用于锚点映射，不改输出内容。
function calStickyDoneLineSimilar(a, b) {
  const x = String(a == null ? '' : a).trim();
  const y = String(b == null ? '' : b).trim();
  if (!x || !y || x === y) return false;
  const min = Math.min(x.length, y.length);
  if (min < 3) return false;
  let i = 0;
  while (i < min && x.charAt(i) === y.charAt(i)) i++;
  return i >= 3 && i >= min * 0.6;
}

function calStickyMatchDoneLines(base, cur) {
  const n = base.length, m = cur.length;
  const out = new Array(n).fill(-1);
  if (!n || !m) return out;
  let pre = 0;
  while (pre < n && pre < m && base[pre] === cur[pre]) { out[pre] = pre; pre++; }
  let suf = 0;
  while (suf < n - pre && suf < m - pre && base[n - 1 - suf] === cur[m - 1 - suf]) {
    out[n - 1 - suf] = m - 1 - suf; suf++;
  }
  const bn = n - pre - suf, cm = m - pre - suf;
  if (bn <= 0 || cm <= 0 || bn * cm > 1600000) return out;
  const w = cm + 1;
  const dp = new Uint32Array((bn + 1) * w);
  for (let i = bn - 1; i >= 0; i--) {
    for (let j = cm - 1; j >= 0; j--) {
      dp[i * w + j] = base[pre + i] === cur[pre + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < bn && j < cm) {
    if (base[pre + i] === cur[pre + j]) { out[pre + i] = pre + j; i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  // 已匹配行把两边切成若干空隙：空隙两侧行数相同（原地改行）时，按顺序一对一补上相似行
  // 的匹配，隐藏块才不会因「紧邻的可见行被改」而漂到它前面。
  const curMatched = new Set();
  for (let k = 0; k < n; k++) if (out[k] >= 0) curMatched.add(out[k]);
  const bounds = [];
  for (let k = 0; k < n; k++) if (out[k] >= 0) bounds.push(k);
  let prevI = -1, prevJ = -1;
  for (let b = 0; b <= bounds.length; b++) {
    const nextI = b < bounds.length ? bounds[b] : n;
    const nextJ = b < bounds.length ? out[nextI] : m;
    const ub = [], uc = [];
    for (let k = prevI + 1; k < nextI; k++) if (out[k] < 0) ub.push(k);
    for (let k = prevJ + 1; k < nextJ; k++) if (!curMatched.has(k)) uc.push(k);
    if (ub.length && ub.length === uc.length) {
      for (let k = 0; k < ub.length; k++) {
        if (calStickyDoneLineSimilar(base[ub[k]], cur[uc[k]])) { out[ub[k]] = uc[k]; curMatched.add(uc[k]); }
      }
    }
    prevI = nextI; prevJ = nextJ;
  }
  return out;
}

// 合併投影回全文，同時給出「舊原文行號 → 合併後行號」映射（個別展開時要翻譯到新座標）
function calStickyMergeDoneLinesDetailed(orig, hiddenIdx, baseMap, curView) {
  if (!hiddenIdx || !hiddenIdx.length) return { lines: curView.slice(), origToOut: null };
  const skip = new Set(hiddenIdx);
  const base = baseMap.map(function (i) { return orig[i]; });
  const bn = base.length;
  // 空 textarea 的 '' split 出 ['']：原本就沒有可見行（或可見行被全刪）時視作 0 行，
  // 否則會在插回的隱藏行前面憑空多一條空行。
  const cur = (curView.length === 1 && curView[0] === '' && !(bn === 1 && base[0] === '')) ? [] : curView;
  const match = calStickyMatchDoneLines(base, cur);
  const curLen = cur.length;
  const anchorOf = function (pos) {
    if (!bn) return curLen;
    if (pos <= 0) {
      for (let i = 0; i < bn; i++) if (match[i] >= 0) return match[i];
      return 0;
    }
    if (pos >= bn) {
      for (let i = bn - 1; i >= 0; i--) if (match[i] >= 0) return match[i] + 1;
      return curLen;
    }
    const before = match[pos - 1], after = match[pos];
    if (before >= 0 && after >= 0) return after;
    if (before >= 0) {
      for (let i = pos; i < bn; i++) if (match[i] >= 0) return match[i];
      return before + 1;
    }
    if (after >= 0) return after;
    for (let i = pos - 1; i >= 0; i--) if (match[i] >= 0) return match[i] + 1;
    for (let i = pos; i < bn; i++) if (match[i] >= 0) return match[i];
    return curLen;
  };
  // 每個隱藏行的錨點＝它前面有多少可見行（投影座標），再映射回當前檢視座標
  const inserts = new Map();
  let visibleBefore = 0;
  for (let i = 0; i < orig.length; i++) {
    if (skip.has(i)) {
      const at = Math.max(0, Math.min(curLen, anchorOf(visibleBefore)));
      if (!inserts.has(at)) inserts.set(at, []);
      inserts.get(at).push(i);
    } else {
      visibleBefore++;
    }
  }
  const out = [];
  const origToOut = new Array(orig.length).fill(-1);
  const curToOut = new Array(curLen).fill(-1);
  for (let p = 0; p <= curLen; p++) {
    const ins = inserts.get(p);
    if (ins) {
      for (let k = 0; k < ins.length; k++) { origToOut[ins[k]] = out.length; out.push(orig[ins[k]]); }
    }
    if (p < curLen) { curToOut[p] = out.length; out.push(cur[p]); }
  }
  for (let bi = 0; bi < bn; bi++) {
    if (match[bi] >= 0) origToOut[baseMap[bi]] = curToOut[match[bi]];
  }
  return { lines: out, origToOut: origToOut };
}

function calStickyMergeDoneLines(orig, hiddenIdx, baseMap, curView) {
  return calStickyMergeDoneLinesDetailed(orig, hiddenIdx, baseMap, curView).lines;
}

let calStickyDoneFoldState = null; // { orig, hidden, baseMap, expanded }；null＝當前未折疊
let calStickyDoneFoldEpoch = 0;
let calStickyDoneFoldInfoCache = { key: null, info: null };

function calStickyDoneFoldEl() { return calStickyEl('calStickyEditArea'); }
function calStickyDoneFoldCurrentText() {
  const ea = calStickyDoneFoldEl();
  if (!ea) return '';
  if (!calStickyDoneFoldState) return ea.value;
  return calStickyMergeDoneLines(
    calStickyDoneFoldState.orig,
    calStickyDoneFoldState.hidden,
    calStickyDoneFoldState.baseMap,
    ea.value.split('\n')
  ).join('\n');
}
function calStickyDoneFoldBump() {
  calStickyDoneFoldEpoch++;
  calStickyDoneFoldInfoCache.key = null;
}
// 折疊行數（已從畫面收起的）／已完成總數（折疊中＋仍可見的）
function calStickyDoneFoldFoldedCount() {
  return calStickyDoneFoldState ? calStickyDoneFoldState.hidden.length : 0;
}
function calStickyDoneFoldCompletedCount() {
  const ea = calStickyDoneFoldEl();
  if (!ea) return 0;
  return calStickyDoneFoldFoldedCount() + calStickyDoneFoldHiddenIndexes(ea.value.split('\n')).length;
}
function calStickySyncDoneFoldChip() {
  const chip = calStickyEl('calStickyFoldChip');
  if (!chip) return;
  const folded = calStickyDoneFoldFoldedCount();
  const completed = calStickyDoneFoldCompletedCount();
  const prefs = calStickyNotePrefs(calStickyCurrentId);
  if (!calStickyEditMode || !prefs.undoneChecksOnly || !completed) {
    chip.style.display = 'none';
    chip.textContent = '';
    chip.removeAttribute('title');
    chip.setAttribute('aria-pressed', 'false');
    return;
  }
  chip.style.display = 'inline-block';
  chip.textContent = (folded ? '顯示已完成 ' : '隱藏已完成 ') + (folded || completed);
  chip.title = folded
    ? '還有 ' + folded + ' 行已完成折疊中（連同行號）；點擊全部展開，或點邊條上的 ▸ 單獨展開某一塊'
    : '把 ' + completed + ' 行已完成 checkbox 連同行號一起折疊';
  chip.setAttribute('aria-pressed', folded ? 'true' : 'false');
}
function calStickyRefreshDoneFoldChip() { calStickySyncDoneFoldChip(); }
function calStickySetDoneFoldState(lines, hiddenIdx, expandedSet) {
  const ea = calStickyDoneFoldEl();
  const fullText = lines.join('\n');
  const hidden = (hiddenIdx || []).slice().sort(function (a, b) { return a - b; });
  calStickyDoneFoldState = null;
  calStickyDoneFoldBump();
  if (!hidden.length) {
    if (ea && ea.value !== fullText) ea.value = fullText;
    calStickySyncDoneFoldChip();
    calStickyEditGutter.invalidate();
    calStickyEditGutter.start();
    return;
  }
  const proj = calStickyProjectDoneLines(lines, hidden);
  calStickyDoneFoldState = { orig: lines, hidden: hidden, baseMap: proj.map, expanded: expandedSet || new Set() };
  const viewText = proj.view.join('\n');
  if (ea && ea.value !== viewText) ea.value = viewText;
  calStickySyncDoneFoldChip();
  calStickyEditGutter.invalidate();
  calStickyEditGutter.start();
}
function calStickyApplyDoneFold() {
  const ea = calStickyDoneFoldEl();
  if (!ea) return;
  // 未勾選「只顯示未完成 checkbox」＝不折疊（已有折疊則先還原全文）
  if (!calStickyNotePrefs(calStickyCurrentId).undoneChecksOnly) {
    calStickyExpandDoneFold();
    calStickySyncDoneFoldChip();
    return;
  }
  const keepTop = ea.scrollTop;
  const full = calStickyDoneFoldCurrentText().split('\n');
  calStickySetDoneFoldState(full, calStickyDoneFoldHiddenIndexes(full), new Set());
  if (calStickyDoneFoldEl()) calStickyDoneFoldEl().scrollTop = keepTop;
}
function calStickyExpandDoneFold() {
  const ea = calStickyDoneFoldEl();
  if (!ea || !calStickyDoneFoldState) return;
  const keepTop = ea.scrollTop;
  const full = calStickyDoneFoldCurrentText();
  calStickyDoneFoldState = null;
  calStickyDoneFoldBump();
  if (ea.value !== full) ea.value = full;
  ea.scrollTop = keepTop;
  calStickySyncDoneFoldChip();
  calStickyEditGutter.invalidate();
  calStickyEditGutter.start();
}
// 只展開某一塊折疊行（邊條上的 ▸N）；其餘折疊塊保持折疊
function calStickyExpandDoneFoldBlock(targets) {
  const ea = calStickyDoneFoldEl();
  if (!ea || !calStickyDoneFoldState || !targets || !targets.length) return;
  const keepTop = ea.scrollTop;
  const old = calStickyDoneFoldState;
  const merged = calStickyMergeDoneLinesDetailed(old.orig, old.hidden, old.baseMap, ea.value.split('\n'));
  const map = merged.origToOut;
  const tr = function (i) { const v = map ? map[i] : -1; return v == null ? -1 : v; };
  const expanded = new Set();
  old.expanded.forEach(function (i) { const j = tr(i); if (j >= 0) expanded.add(j); });
  targets.forEach(function (i) { const j = tr(i); if (j >= 0) expanded.add(j); });
  const full = merged.lines;
  const hidden = calStickyDoneFoldHiddenIndexes(full).filter(function (i) { return !expanded.has(i); });
  calStickySetDoneFoldState(full, hidden, expanded);
  if (calStickyDoneFoldEl()) calStickyDoneFoldEl().scrollTop = keepTop;
}
function calStickyToggleDoneFold() {
  if (calStickyDoneFoldFoldedCount()) calStickyExpandDoneFold(); else calStickyApplyDoneFold();
}
function calStickyResetDoneFold() {
  calStickyDoneFoldState = null;
  calStickyDoneFoldBump();
  calStickySyncDoneFoldChip();
}
// 保存成功後：以「合併後的全文」重建折疊基線（期間新勾成 [x] 的可見行順手折進去）
function calStickyRefreshDoneFoldAfterSave() {
  if (!calStickyNotePrefs(calStickyCurrentId).undoneChecksOnly || !calStickyDoneFoldState) {
    calStickyExpandDoneFold();
    calStickyRefreshDoneFoldChip();
    return;
  }
  const full = calStickyDoneFoldCurrentText().split('\n');
  calStickySetDoneFoldState(full, calStickyDoneFoldHiddenIndexes(full), new Set());
}

// 折疊縫隙錨點：與 calStickyMergeDoneLinesDetailed 同一套映射（折疊塊插在哪，標記就畫在哪）
function calStickyDoneFoldAnchorOf(match, bn, curLen, pos) {
  if (!bn) return curLen;
  if (pos <= 0) {
    for (let i = 0; i < bn; i++) if (match[i] >= 0) return match[i];
    return 0;
  }
  if (pos >= bn) {
    for (let i = bn - 1; i >= 0; i--) if (match[i] >= 0) return match[i] + 1;
    return curLen;
  }
  const before = match[pos - 1], after = match[pos];
  if (before >= 0 && after >= 0) return after;
  if (before >= 0) {
    for (let i = pos; i < bn; i++) if (match[i] >= 0) return match[i];
    return before + 1;
  }
  if (after >= 0) return after;
  for (let i = pos - 1; i >= 0; i--) if (match[i] >= 0) return match[i] + 1;
  for (let i = pos; i < bn; i++) if (match[i] >= 0) return match[i];
  return curLen;
}

// 折疊檢視的行號標籤與折疊塊位置（快取：值與折疊狀態沒變就不重跑 LCS）
function calStickyDoneFoldViewInfo() {
  const ea = calStickyDoneFoldEl();
  if (!ea || !calStickyDoneFoldState) return null;
  const key = calStickyDoneFoldEpoch + '\0' + ea.value;
  if (calStickyDoneFoldInfoCache.key === key) return calStickyDoneFoldInfoCache.info;
  const st = calStickyDoneFoldState;
  const base = st.baseMap.map(function (i) { return st.orig[i]; });
  const bn = base.length;
  const lines = ea.value.split('\n');
  let cur = lines;
  if (lines.length === 1 && lines[0] === '' && bn > 0 && !(bn === 1 && base[0] === '')) cur = [];
  const match = calStickyMatchDoneLines(base, cur);
  const curLen = cur.length;
  const curToBase = new Array(curLen).fill(-1);
  for (let bi = 0; bi < bn; bi++) {
    const cj = match[bi];
    if (cj >= 0 && curToBase[cj] < 0) curToBase[cj] = bi;
  }
  // 可見行編號＝它在原文裡的行號（折疊不重排）；新行取鄰近編號間的空位
  const labels = new Array(lines.length);
  if (!curLen) {
    labels[0] = '1';
  } else {
    let last = 0;
    let j = 0;
    while (j < curLen) {
      if (curToBase[j] >= 0) {
        const origNo = st.baseMap[curToBase[j]] + 1;
        last = Math.max(origNo, last + 1);
        labels[j] = String(last);
        j++;
      } else {
        let k = j;
        while (k < curLen && curToBase[k] < 0) k++;
        const run = k - j;
        const nextNo = k < curLen ? st.baseMap[curToBase[k]] + 1 : 0;
        let start = last + 1;
        if (nextNo > 0) start = Math.max(start, nextNo - run);
        for (let t = 0; t < run; t++) labels[j + t] = String(start + t);
        last = start + run - 1;
        j = k;
      }
    }
  }
  for (let t = 1; t < labels.length; t++) {
    if (Number(labels[t]) <= Number(labels[t - 1])) labels[t] = String(Number(labels[t - 1]) + 1);
  }
  const blocks = [];
  const hiddenSet = new Set(st.hidden);
  let visibleBefore = 0;
  // ⚠️ 必須用 while 逐行推進：若用 for，內層跳過折疊塊後外層還會再 i++，
  //    會漏算「折疊塊後第一條可見行」→ visibleBefore 逐塊少 1，▸ 標記越往後偏得越多。
  let i = 0;
  while (i < st.orig.length) {
    if (!hiddenSet.has(i)) { visibleBefore++; i++; continue; }
    const first = i;
    const indices = [];
    while (i < st.orig.length && hiddenSet.has(i)) { indices.push(i); i++; }
    blocks.push({
      at: Math.max(0, Math.min(curLen, calStickyDoneFoldAnchorOf(match, bn, curLen, visibleBefore))),
      count: indices.length,
      indices: indices,
      firstLine: first + 1,
      lastLine: i,
    });
  }
  const info = { labels: labels, blocks: blocks };
  calStickyDoneFoldInfoCache.key = key;
  calStickyDoneFoldInfoCache.info = info;
  return info;
}
function calStickyDoneFoldLabel(i) {
  const info = calStickyDoneFoldViewInfo();
  if (!info || info.labels[i] == null) return i + 1;
  return info.labels[i];
}
// 每個折疊塊在邊條上畫一個可點標記（▸N）：點哪塊只展開哪塊
function calStickyDoneFoldRenderRail(context) {
  const inner = context && context.inner;
  if (!inner) return;
  let rail = inner.querySelector('.fold-rail');
  const info = calStickyDoneFoldViewInfo();
  if (!info || !info.blocks.length) {
    if (rail) { rail.textContent = ''; rail._sig = ''; }
    return;
  }
  if (!rail) {
    rail = document.createElement('div');
    rail.className = 'fold-rail';
    inner.appendChild(rail);
    rail._sig = '';
  } else if (rail.parentNode !== inner) {
    inner.appendChild(rail);
    rail._sig = '';
  }
  const lhPx = parseFloat(context.lh) || 16;
  const tops = context.tops || [];
  const positions = [];
  const sigParts = [];
  const seenTop = {};
  for (let k = 0; k < info.blocks.length; k++) {
    const b = info.blocks[k];
    const rowTop = b.at < tops.length ? tops[b.at] : (tops.length ? tops[tops.length - 1] + lhPx : 0);
    let top = Math.max(0, Math.round(rowTop - 6));
    // 極端情況（可見行被全刪）多塊會共用同一錨點：往下錯開，避免標記完全疊住
    const dup = seenTop[top] || 0;
    seenTop[top] = dup + 1;
    if (dup) top += dup * 13;
    positions.push(top);
    sigParts.push(b.count + ':' + b.indices.join(',') + ':' + top);
  }
  const sig = sigParts.join('|');
  if (rail._sig === sig) return;
  rail._sig = sig;
  rail.textContent = '';
  for (let k = 0; k < info.blocks.length; k++) {
    const b = info.blocks[k];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fold-seam';
    btn.textContent = '▸' + b.count;
    btn.title = '第 ' + b.firstLine + '–' + b.lastLine + ' 行已完成（' + b.count + ' 行），點擊展開這一塊';
    btn.style.top = positions[k] + 'px';
    (function (indices) {
      btn.addEventListener('mousedown', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); calStickyExpandDoneFoldBlock(indices); });
    })(b.indices);
    rail.appendChild(btn);
  }
}


// 🆕 刪除便利貼：刪當前翻頁顯示的那張所屬行程（與桌面便利貼窗「刪除」同口徑）。
//   主檔事件 → 從編輯緩衝移除該 ## EVENT 塊；ro 聯運事件 → 從來源檔快取移除並標髒，等匯出寫回。
//   破壞性操作 → 先用 window.confirm 確認（行動端機制；與行程刪除同一套）。
function calStickyDeleteCurrent() {
  if (!calStickyIsOpen) { showToast('請先開啟便利貼', 'error'); return; }
  const note = calStickyPages[calStickyIndex];
  if (!note) { showToast('目前沒有可刪除的便利貼', 'error'); return; }
  if (!window.confirm('確定刪除便利貼「' + (note.title || '未命名') + '」嗎？' + String.fromCharCode(10) + String.fromCharCode(10) + '刪除後該行程將從來源檔案中移除，不可恢復。')) return;
  const ev = (state.calEvents || []).find((e) => e.uid === note.uid);
  if (!ev) { showToast('找不到該便利貼的來源行程', 'error'); return; }
  if (ev.ro) {
    const files = state.calIncludeFiles || [];
    let inc = (Number.isInteger(ev.roFileIdx) && files[ev.roFileIdx]) ? files[ev.roFileIdx] : null;
    if (!inc || inc.name !== ev.src) inc = files.find((f) => f.name === ev.src) || null;
    if (!inc) { showToast('找不到來源檔「' + (ev.src || '') + '」', 'error'); return; }
    const next = (typeof calRemoveEventBlockInContent === 'function') ? calRemoveEventBlockInContent(inc.content, ev.roBlockIdx, ev.title) : null;
    if (next === null) { showToast('來源檔區塊位置已變動，已取消刪除', 'error'); return; }
    inc.content = next;
    inc.dirty = true;
    if (typeof calPersistIncludes === 'function') calPersistIncludes();
    if (typeof calRefreshAll === 'function') calRefreshAll();
    if (typeof renderEventsContent === 'function') renderEventsContent();
    if (typeof calRenderIncludeBar === 'function') calRenderIncludeBar();
  } else {
    const blockIdx = parseInt(String(ev.uid).slice(3), 10);
    const src = (typeof elements !== 'undefined' && elements.editor) ? elements.editor.value : '';
    const next = (typeof calRemoveEventBlockInContent === 'function') ? calRemoveEventBlockInContent(src, blockIdx, ev.title) : null;
    if (next === null) { showToast('檔案區塊位置已變動，已取消刪除', 'error'); return; }
    if (typeof elements !== 'undefined' && elements.editor) elements.editor.value = next;
    state.isDirty = (typeof elements !== 'undefined' && elements.editor) ? (elements.editor.value !== state.lastContent) : true;
    if (typeof updateStatus === 'function') updateStatus();
    if (typeof updateWordCount === 'function') updateWordCount();
    if (typeof updatePreview === 'function') updatePreview();
    if (typeof calRefreshAll === 'function') calRefreshAll();
    if (typeof renderEventsContent === 'function') renderEventsContent();
  }
  calStickyCloseSheet();
  if (typeof calStickyRefreshIfOpen === 'function') calStickyRefreshIfOpen();
  showToast('已刪除便利貼「' + (note.title || '未命名') + '」', 'success');
}

// 勾選 checkbox / 表單存檔後：重新解析（evpN 可能位移），保留當前這張
function calStickyRefreshIfOpen() {
  if (!calStickyIsOpen) {
    calStickyPendingRename = null;
    return;
  }
  if (calStickyPendingRename) {
    const pending = calStickyPendingRename;
    calStickyPendingRename = null;
    // 從便利貼改標題 / 日期 → 身分（標題|日期|序號）整批改變：
    // 同一事件的所有實例按 idx 一對一搬移樣式 / 開關 / 上次頁次，避免「改個字全部變回預設」
    const oldNotes = calStickyCatalog.filter((n) => n.uid === pending.uid);
    const newNotes = calStickyBuildCatalog().filter((n) => n.uid === pending.uid);
    const store = calStickyLoadStore();
    let migrated = false;
    newNotes.forEach((next) => {
      const prev = oldNotes.find((n) => n.idx === next.idx);
      if (!prev || prev.identity === next.identity) return;
      if (store.notes[prev.identity]) {
        store.notes[next.identity] = store.notes[prev.identity];
        delete store.notes[prev.identity];
      }
      const hi = store.hidden.indexOf(prev.identity);
      if (hi >= 0) {
        store.hidden.splice(hi, 1);
        if (store.hidden.indexOf(next.identity) < 0) store.hidden.push(next.identity);
      }
      if (store.lastId === prev.identity) store.lastId = next.identity;
      if (calStickyCurrentId === prev.identity) calStickyCurrentId = next.identity;
      migrated = true;
    });
    if (migrated) {
      calStickySaveStore();
      if (typeof updateStatus === 'function') updateStatus();   // 身分搬家＝設定鍵也變了
    }
  }
  const keepId = calStickyCurrentId;
  const keepUid = calStickyCurrentUid;
  const keepIndex = calStickyIndex;
  calStickyRebuild();
  let idx = keepId ? calStickyPages.findIndex((n) => n.identity === keepId) : -1;
  if (idx < 0 && keepUid) idx = calStickyPages.findIndex((n) => n.uid === keepUid);
  if (idx < 0) idx = Math.min(keepIndex, calStickyPages.length - 1);
  // 編輯／外部資料變更後保留原捲動位置：深處改完一個子事件不該被彈回頂端
  const bodyEl = calStickyEl('calStickyBody');
  const keepScroll = bodyEl ? bodyEl.scrollTop : 0;
  calStickyRenderPage(idx, { toast: false, resetScroll: false });
  if (bodyEl) bodyEl.scrollTop = keepScroll;
}

// 切換檔案（開啟新檔 / 載入草稿）：關閉彈層並換用該檔的偏好命名空間
function calStickyOnFileChange() {
  calStickyResetStore();
  if (calStickyIsOpen) calStickyClose(true);
}

// ===== 觸控 / 鍵盤 =====
// 手指在畫面上左右滑＝翻頁；縱向仍交給正文滾動。綁在整個彈層上，
// 所以卡片兩側留白、標題區也能滑（不必精準落在正文）。
function calStickyBindTouch() {
  const overlay = calStickyEl('calStickyOverlay');
  if (!overlay) return;
  const IGNORE = 'button, a, input, select, textarea, label, .ev-md-check, .md-unit-edit, .cal-sticky-sheet, .cal-sticky-foot, .cal-sticky-top, .cal-sticky-addcheck-menu';
  overlay.addEventListener('touchstart', (e) => {
    calStickyTouchStart = null;
    if (e.touches.length !== 1 || calStickyPages.length <= 1) return;
    if (calStickySheetOpen()) return;
    if (typeof calMdEditIsOpen === 'function' && calMdEditIsOpen()) return;
    if (e.target.closest && e.target.closest(IGNORE)) return;
    calStickyTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  }, { passive: true });
  overlay.addEventListener('touchmove', (e) => {
    const start = calStickyTouchStart;
    if (!start || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (!start.axis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      start.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    // 已判定為橫滑：阻止瀏覽器把它當成頁面前後導覽或縱向拖曳
    if (start.axis === 'x' && e.cancelable) e.preventDefault();
  }, { passive: false });
  overlay.addEventListener('touchend', (e) => {
    const start = calStickyTouchStart;
    calStickyTouchStart = null;
    if (!start || start.axis !== 'x' || !e.changedTouches || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // 橫向位移要明顯大於縱向，避免與正文上下滾動打架
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    calStickyStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  overlay.addEventListener('touchcancel', () => { calStickyTouchStart = null; }, { passive: true });
}
function calStickyOnKeyDown(e) {
  if (!calStickyIsOpen) return;
  // 備註編輯彈層在上層：Escape / 方向鍵都先交給它，避免同時關掉底下的便利貼或翻頁
  if (typeof calMdEditIsOpen === 'function' && calMdEditIsOpen()) return;
  const form = calStickyEl('ev-form-overlay');
  if (form && form.style.display && form.style.display !== 'none') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (calStickyAddCheckMenuOpen()) calStickyCloseAddCheckMenu();
    else if (calStickySheetOpen()) calStickyCloseSheet();
    else if (calStickyEditMode) calStickySetEditMode(false);   // 編輯中：Esc 先退編輯（有髒改動會先問），不直接關彈層
    else calStickyClose();
    return;
  }
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); calStickyStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); calStickyStep(1); }
}

// ===== 初始化（DOM 已就緒直接綁定，與 app.js 同一時序約定）=====
function calStickyInit() {
  const overlay = calStickyEl('calStickyOverlay');
  if (!overlay || overlay.dataset.initialized === '1') return;
  overlay.dataset.initialized = '1';
  const on = (id, ev, fn) => { const el = calStickyEl(id); if (el) el.addEventListener(ev, fn); };
  on('calStickyCloseBtn', 'click', calStickyClose);
  on('calStickyMenuBtn', 'click', calStickyOpenSheet);
  on('calStickySheetClose', 'click', calStickyCloseSheet);
  on('calStickyEditBtn', 'click', calStickyEditCurrent);
  // 底部 mode 按鈕：編輯模式下顯示「保存並返回」（直接保存+退出，不走 dirty guard）；
  // 渲染模式下顯示「✎」（進入編輯）。calStickySetEditMode(false) 的 dirty guard 只供 Esc/遮罩退出用。
  on('calStickyModeBtn', 'click', () => {
    if (calStickyEditMode) {
      if (calStickySaveEdit()) calStickySetEditMode(false);   // 保存成功才退出
    } else {
      calStickySetEditMode(true);
    }
  });
  on('calStickySaveBtn', 'click', () => { if (calStickySaveEdit()) showToast('已保存', 'success'); });
  const editArea = calStickyEl('calStickyEditArea');
  if (editArea) {
    // 手動保存制：輸入只標記「未保存」，不再自動落盤（與桌面便利貼同口徑）
    editArea.addEventListener('input', () => {
      calStickyEditDirty = true;
      calStickyMarkEditDirty(true);
      calStickyRefreshDoneFoldChip();
    });
  }
  // 🆕 已完成 checkbox 折疊切換（mousedown 阻止預設 → 不搶走編輯框焦點）
  const foldChip = calStickyEl('calStickyFoldChip');
  if (foldChip) {
    foldChip.addEventListener('mousedown', (e) => e.preventDefault());
    foldChip.addEventListener('click', (e) => { e.stopPropagation(); calStickyToggleDoneFold(); });
  }
  on('calStickyDeleteBtn', 'click', calStickyDeleteCurrent);
  on('calStickyNewNoteBtn', 'click', () => { if (typeof calOpenNewNoteDialog === 'function') calOpenNewNoteDialog(); });
  on('calStickyPrevBtn', 'click', () => calStickyStep(-1));
  on('calStickyNextBtn', 'click', () => calStickyStep(1));
  on('calStickyUndone', 'click', calStickyToggleUndone);
  on('calStickyImportSettingsBtn', 'click', calStickyImportSettings);
  on('calStickyExportSettingsBtn', 'click', () => calStickyExportSettings());
  on('calStickyOpacity', 'input', (e) => calStickyUpdatePrefs({ opacity: parseInt(e.target.value, 10) || 100 }));
  on('calStickyZoomOut', 'click', () => calStickyZoom(-0.1));
  on('calStickyZoomIn', 'click', () => calStickyZoom(0.1));
  const weights = calStickyEl('calStickyWeights');
  if (weights) {
    weights.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-w]');
      if (!btn) return;
      calStickyUpdatePrefs({ fontWeight: parseInt(btn.getAttribute('data-w'), 10) || 400 });
    });
  }
  const sheet = calStickyEl('calStickySheet');
  if (sheet) {
    sheet.addEventListener('click', (e) => { if (e.target === sheet) calStickyCloseSheet(); });
  }
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (calStickySheetOpen()) calStickyCloseSheet();
    else calStickyClose();
  });
  calStickyBindTouch();
  // 點選單以外任何地方＝收合。用 capture 只讀不阻斷，別的功能的事件委托照常跑。
  document.addEventListener('click', (e) => {
    if (!calStickyAddCheckMenuOpen()) return;
    if (e.target.closest && e.target.closest('#calStickyAddCheckMenu, .cal-sticky-addcheck')) return;
    calStickyCloseAddCheckMenu();
  }, true);
  document.addEventListener('keydown', calStickyOnKeyDown);
  // 初次先渲染空狀態 / 設定色板，讓清單一打開就有內容（尚未開啟時不顯示任何東西）
  calStickySyncControls(null);
  calStickyRenderSwatches(calStickyNotePrefs(''));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', calStickyInit);
} else {
  calStickyInit();
}
