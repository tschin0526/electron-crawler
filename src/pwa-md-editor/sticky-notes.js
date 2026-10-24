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
function calStickyStorageKey() {
  const name = (typeof state !== 'undefined' && state.currentFile && state.currentFile.name)
    ? state.currentFile.name : 'calendar.md';
  return CAL_STICKY_STORE_PREFIX + String(name).toLowerCase();
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
function calStickyNoteLabel(note) {
  const name = String(note.title || '').replace(/\s+/g, ' ').trim() || '未命名便利貼';
  return name + (note.idx > 0 ? ' (' + (note.idx + 1) + ')' : '');
}
function calStickyRenderSheetList() {
  const listEl = calStickyEl('calStickyList');
  if (!listEl) return;
  const titleEl = calStickyEl('calStickyListTitle');
  const hidden = new Set(calStickyLoadStore().hidden);
  const inactive = calStickyCatalog.filter((n) => hidden.has(n.identity));
  if (titleEl) {
    titleEl.textContent = '翻頁清單（' + calStickyPages.length + ' 項；點名稱顯示，點開 / 關切換）';
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
  calStickyPages.forEach((note, i) => appendRow(note, i + 1));
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
  if ('undoneChecksOnly' in patch) calStickySyncMetaActions(next);
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
  // 編輯中有未保存改動：確定＝保存再關；取消＝留在編輯模式（切換檔案路徑傳 skipDirtyGuard 不問）
  if (!skipDirtyGuard && calStickyEditMode && calStickyEditDirty) {
    const ok = window.confirm('內容有未保存的改動。\n\n確定＝先保存再關閉便利貼\n取消＝留在編輯模式');
    if (ok) { if (!calStickySaveEdit()) return; }
    else return;
  }
  calStickyIsOpen = false;
  calStickyPendingRename = null;
  calStickyEditMode = false;
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
  ev.notes = ea.value;
  const ok = (typeof calCommitEventNotes === 'function') ? calCommitEventNotes(ev) : false;
  calStickyEditSavePending = false;
  if (!ok) {
    ev.notes = prevNotes;   // 寫回被拒（區塊位置/標題已變）：還原記憶體值，避免與檔案脫節
    return false;
  }
  calStickyEditDirty = false;
  calStickyMarkEditDirty(false);
  // ro 路徑 calCommitEventNotes 已自刷；主檔路徑補刷一次，讓進度徽章/來源●同趟更新
  if (!ev.ro && typeof calStickyRefreshIfOpen === 'function') calStickyRefreshIfOpen();
  return true;
}
function calStickySyncEditBtn() {
  const modeBtn = calStickyEl('calStickyModeBtn');
  const saveBtn = calStickyEl('calStickySaveBtn');
  if (modeBtn) {
    modeBtn.textContent = calStickyEditMode ? '▤' : '✎';
    modeBtn.title = calStickyEditMode ? '切換到渲染模式' : '切換到編輯模式（直接改原始 Markdown）';
    modeBtn.setAttribute('aria-label', modeBtn.title);
    modeBtn.classList.toggle('active', calStickyEditMode);
  }
  if (saveBtn) saveBtn.style.display = calStickyEditMode ? '' : 'none';
}
function calStickySetEditMode(edit) {
  const note = calStickyEl('calStickyNote');
  const ea = calStickyEl('calStickyEditArea');
  if (!note || !ea) return;
  // 離開編輯前：有未保存改動 → 先確認（取消＝留在編輯模式，不丟改動）
  if (!edit && calStickyEditMode && calStickyEditDirty) {
    const ok = window.confirm('內容有未保存的改動。\n\n確定＝先保存再返回渲染模式\n取消＝留在編輯模式（不丟改動）');
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
  } else {
    note.classList.remove('editing');
    calStickyEditDirty = false;
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
    const ok = window.confirm('內容有未保存的改動。\n\n確定＝先保存再切換便利貼\n取消＝留在本頁');
    if (!ok) return false;
    if (!calStickySaveEdit()) return false;
  }
  calStickyEditMode = false;
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
});


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
    if (migrated) calStickySaveStore();
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
  on('calStickyModeBtn', 'click', () => calStickySetEditMode(!calStickyEditMode));
  on('calStickySaveBtn', 'click', () => { if (calStickySaveEdit()) showToast('已保存', 'success'); });
  const editArea = calStickyEl('calStickyEditArea');
  if (editArea) {
    // 手動保存制：輸入只標記「未保存」，不再自動落盤（與桌面便利貼同口徑）
    editArea.addEventListener('input', () => { calStickyEditDirty = true; calStickyMarkEditDirty(true); });
  }
  on('calStickyDeleteBtn', 'click', calStickyDeleteCurrent);
  on('calStickyNewNoteBtn', 'click', () => { if (typeof calOpenNewNoteDialog === 'function') calOpenNewNoteDialog(); });
  on('calStickyPrevBtn', 'click', () => calStickyStep(-1));
  on('calStickyNextBtn', 'click', () => calStickyStep(1));
  on('calStickyUndone', 'click', calStickyToggleUndone);
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
