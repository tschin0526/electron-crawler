/* ============================================================
 * 🗒 LITE 便利貼（翻頁模式；calendar.md 專用）
 * ------------------------------------------------------------
 * 資料源與桌面便利貼一致：calendar.md 中 `- sticky: \`N\``（N>0）的行程
 * 會展開成 N 張便利貼；本檔案只負責「顯示 / 翻頁 / 顯示偏好」，
 * 絕不改寫 calendar.md。備註 checkbox 仍走 calToggleNoteCheck →
 * 編輯緩衝 → 頂欄「保存」，與行程列表同一條寫回路徑。
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
// localStorage 命名空間：每份 calendar.md 各自一份顯示偏好（只存在本機）
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
    lastId: (data && typeof data.lastId === 'string') ? data.lastId : ''
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
  const events = (typeof parseCalendarEvents === 'function' && typeof elements !== 'undefined' && elements.editor)
    ? parseCalendarEvents(elements.editor.value) : [];
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
        notes: ev.notes || ''
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
// meta 行右側兩個操作（與桌面便利貼同口徑）：＋☐ 加入子事件、☐/☑ 只看未完成
function calStickyMetaActionsHtml(prefs) {
  const on = !!(prefs && prefs.undoneChecksOnly);
  return '<span class="cal-sticky-meta-actions">' +
    '<button type="button" class="cal-sticky-meta-btn cal-sticky-addcheck" title="在備註末尾加入 checkbox 子事件" onclick="calStickyOpenAddCheck()">＋☐</button>' +
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
function calStickyOpenAddCheck() {
  if (!calStickyCurrentUid || typeof calOpenAddCheckDialog !== 'function') return;
  calOpenAddCheckDialog(calStickyCurrentUid);
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
  const noteEl = calStickyEl('calStickyNote');
  if (noteEl) noteEl.classList.toggle('cal-sticky-multi', multi); // 讓正文左右留出翻頁鈕的位置
  const edgePrev = calStickyEl('calStickyPrev');
  const edgeNext = calStickyEl('calStickyNext');
  if (edgePrev) edgePrev.style.display = multi ? 'flex' : 'none';
  if (edgeNext) edgeNext.style.display = multi ? 'flex' : 'none';
  const prevBtn = calStickyEl('calStickyPrevBtn');
  const nextBtn = calStickyEl('calStickyNextBtn');
  if (prevBtn) prevBtn.disabled = !multi;
  if (nextBtn) nextBtn.disabled = !multi;
  const editBtn = calStickyEl('calStickyEditBtn');
  if (editBtn) editBtn.disabled = !total;
}

function calStickyRenderPage(target, options) {
  options = options || {};
  calStickyRebuild();
  const total = calStickyPages.length;
  const noteEl = calStickyEl('calStickyNote');
  const emptyEl = calStickyEl('calStickyEmpty');
  if (!total) {
    calStickyIndex = 0;
    calStickyCurrentId = '';
    calStickyCurrentUid = '';
    if (noteEl) noteEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      // 分兩種空狀態：全部被關掉 vs 這份文件根本沒有便利貼
      emptyEl.innerHTML = calStickyCatalog.length
        ? '所有便利貼都已關閉。<br>點左上角 ☰ 開啟清單。'
        : '此 calendar.md 目前沒有便利貼。<br><br>在行程編輯表單把「便利貼張數」設為 1 以上，<br>即可在這裡以翻頁方式查看。';
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
  if (store.lastId !== note.identity) {
    store.lastId = note.identity;
    calStickySaveStore();
  }
  const prefs = calStickyNotePrefs(note.identity);
  const titleEl = calStickyEl('calStickyTitle');
  if (titleEl) titleEl.innerHTML = note.title ? calRenderInlineMarkdown(note.title) : '(無標題)';
  const metaEl = calStickyEl('calStickyMeta');
  if (metaEl) metaEl.innerHTML = escapeHtml(calStickyMetaText(note)) + calStickyProgressHtml(note) + calStickyMetaActionsHtml(prefs);
  const tagsEl = calStickyEl('calStickyTags');
  if (tagsEl) {
    tagsEl.innerHTML = note.tags.map((t) =>
      '<li>' + escapeHtml(typeof calTagLabel === 'function' ? calTagLabel(t) : t) + '</li>').join('');
  }
  const bodyEl = calStickyEl('calStickyBody');
  if (bodyEl) {
    bodyEl.innerHTML = note.notes
      ? calRenderNotes(note.notes, note.uid)
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
    nameEl.textContent = label;
    nameEl.title = label + '（點擊顯示這張便利貼）';
    nameEl.addEventListener('click', () => {
      const idx = calStickyPages.findIndex((n) => n.identity === note.identity);
      if (idx >= 0) {
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
function calStickyOpen() {
  if (typeof isCalendarMd !== 'function' || !isCalendarMd()) {
    if (typeof showToast === 'function') showToast('便利貼僅適用於 calendar.md', 'error');
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
  // 還原上次顯示的那張：以「標題|日期|序號」認領；檔案改過認不到就回第 1 張
  const lastId = calStickyLoadStore().lastId;
  let idx = lastId ? calStickyPages.findIndex((n) => n.identity === lastId) : -1;
  if (idx < 0) idx = 0;
  calStickyRenderPage(idx, { toast: false });
}
function calStickyClose() {
  calStickyIsOpen = false;
  calStickyPendingRename = null;
  const overlay = calStickyEl('calStickyOverlay');
  if (overlay) overlay.style.display = 'none';
  calStickyCloseSheet();
}

// ✎ 編輯：開既有的行程表單（彈層 z-index 高於便利貼，存檔後由 applyEventsToEditor 觸發刷新）
function calStickyEditCurrent() {
  if (!calStickyCurrentUid || typeof openEventForm !== 'function') return;
  calStickyCloseSheet();
  calStickyPendingRename = { uid: calStickyCurrentUid, identity: calStickyCurrentId };
  openEventForm(calStickyCurrentUid);
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
  if (calStickyIsOpen) calStickyClose();
}

// ===== 觸控 / 鍵盤 =====
function calStickyBindTouch() {
  const note = calStickyEl('calStickyNote');
  if (!note) return;
  note.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('button, a, input, select, textarea, .ev-md-check')) {
      calStickyTouchStart = null;
      return;
    }
    calStickyTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  note.addEventListener('touchend', (e) => {
    const start = calStickyTouchStart;
    calStickyTouchStart = null;
    if (!start || !e.changedTouches || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // 橫向位移要明顯大於縱向，避免與正文上下滾動打架
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    calStickyStep(dx < 0 ? 1 : -1);
  }, { passive: true });
}
function calStickyOnKeyDown(e) {
  if (!calStickyIsOpen) return;
  // 備註編輯彈層在上層：Escape / 方向鍵都先交給它，避免同時關掉底下的便利貼或翻頁
  if (typeof calMdEditIsOpen === 'function' && calMdEditIsOpen()) return;
  const form = calStickyEl('ev-form-overlay');
  if (form && form.style.display && form.style.display !== 'none') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (calStickySheetOpen()) calStickyCloseSheet();
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
  on('calStickyPrev', 'click', () => calStickyStep(-1));
  on('calStickyNext', 'click', () => calStickyStep(1));
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
