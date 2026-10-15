// 单张桌面便利贴（每张一个 frameless 小窗口）
// 操作全部在本贴纸本体上：拖动移动 / 右下把手缩放 / ×关闭 / 🎨改背景色+透明度 / 📂唤起主程式 / 点击唤起主程式
'use strict';

const fs = require('fs');
const { ipcRenderer } = require('electron');

// 背景色候选（含纯黑 #000000 与纯白 #FFFFFF；共 30 色，网格 6 列 = 5 行）
const PALETTE = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E',
  '#8E8E93', '#FFF3B0', '#FFC9C9', '#FFE8CC', '#D3F9D8', '#A5D8FF',
  '#E5DBFF', '#FF8787', '#FFA94D', '#FFE066', '#8CE99A', '#74C0FC',
  '#B197FC', '#FAD8C0', '#FFE3E3', '#E7F5C2', '#C3FAE8', '#FFE9F0'
];
// 内容字体颜色候选（共 24 色 = 4 行 × 6；首个 = 默认正文色 #33384a，兼作「恢复默认」；纯黑与纯白紧挨排在最前）
const TEXT_PALETTE = [
  '#33384a', '#000000', '#FFFFFF', '#1f2430', '#4b5160', '#8E8E93',
  '#A2845E', '#007AFF', '#34C759', '#AF52DE', '#FF3B30', '#FF9500',
  '#E03131', '#2F9E44', '#0B7285', '#1864AB', '#5F3DC4', '#A61E4D',
  '#704818', '#F59F00', '#1098AD', '#495057', '#ADB5BD', '#212529'
];
const DEFAULT_W = 240, DEFAULT_H = 170, MIN_W = 140, MIN_H = 90;
// 新便利贴默认配色：纸质便利贴淡黄底 + 纯黑字（覆盖事件色继承；#FFF3B0 已在 PALETTE 中，可重新选中高亮）
const STICKY_DEF_BG = '#FFF3B0';
const STICKY_DEF_FG = '#000000';

const qs = new URLSearchParams(location.search);
const FILE = qs.get('file') || '';
let KEY = qs.get('key') || '';
let IDX = parseInt(qs.get('idx'), 10) || 0;
// 显示模式：split（分体显示，每张一窗）/ flip（翻页显示，单窗循环多张）
const MODE = qs.get('mode') || 'split';
const IS_FLIP = MODE === 'flip';
// 翻页窗几何（位置/尺寸/最小化）专用 id，与「当前显示哪张便利贴」无关；
// 颜色/透明度仍按各便利贴自身状态（KEY/IDX）保存。
const FLIP_KEY = '__flip__', FLIP_IDX = 0;
let flipOrder = [];   // [{key, idx}]
let flipIndex = 0;    // 当前页
let flipTotal = 0;
let stickyMenuLoadSeq = 0;
let stickyRefreshSeq = 0;
let activeStickyRefreshId = '';
let stickyRefreshFeedbackTimer = null;
let flipPointerX = null;
let pointerClientX = null;
let pointerClientY = null;
const FLIP_EDGE_TRIGGER_PX = 48;
let editMode = false; // 内容模式：false＝渲染（Markdown 预览）/ true＝编辑（直接改原始 notes）
let editDirty = false;// 编辑后是否有未保存改动（⌘S 才落盘）
function geomId() { return IS_FLIP ? { key: FLIP_KEY, idx: FLIP_IDX } : { key: KEY, idx: IDX }; }

let marked = null;
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tint(hex, opacityPct) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) h = 'FFF3B0';
  const a = Math.round((Math.max(20, Math.min(100, opacityPct == null ? 100 : opacityPct)) / 100) * 255);
  return '#' + h + a.toString(16).padStart(2, '0');
}
function showStickyRefreshFeedback(message, isError = false) {
  const feedback = document.getElementById('noteRefreshFeedback');
  if (!feedback) return;
  if (stickyRefreshFeedbackTimer) clearTimeout(stickyRefreshFeedbackTimer);
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
  feedback.classList.add('visible');
  stickyRefreshFeedbackTimer = setTimeout(() => {
    feedback.classList.remove('visible');
    stickyRefreshFeedbackTimer = null;
  }, 3200);
}

function parseEvents(md) {
  if (!md) return [];
  const out = [];
  // ⚠️ 与桌面主程式 tlParseEvents 用相同分块正则、相同序号 i 生成 uid='evp'+i，
  //    使便利贴 KEY 与主程式一致（改标题/日期不再断开关联）。i 从 0 起，与 tlParseBlock(idx) 对齐。
  const blocks = String(md).split(/^##[ \t]*EVENT(?:\([^)]*\))?[ \t]*$/m);
  blocks.forEach((b, i) => {
    const cut = b.search(/^##[ \t]*HOLIDAY[ \t]*$/m);
    const blk = cut >= 0 ? b.slice(0, cut) : b;
    const get = (k) => { const m = blk.match(new RegExp('^- ' + k + ':\\s*`?([^`\\n]*)`?', 'm')); return m ? m[1].trim() : ''; };
    const title = get('title');
    if (!title) return;
    let color = get('color').replace(/^"|"$/g, '');
    let tags = []; try { tags = JSON.parse(get('tags')) || []; } catch (e) { tags = []; }
    let notes = '';
    const rm = blk.match(/- Remark:\s*\n```\n([\s\S]*?)\n```/) || blk.match(/```\n([\s\S]*?)\n```/);
    if (rm) notes = rm[1];
    const uid = 'evp' + i;
    out.push({
      title, date: get('date'), endDate: get('endDate'), color: color || '#FFCC00',
      tags: Array.isArray(tags) ? tags : [], notes, done: get('done') === 'true',
      uid, key: uid
    });
  });
  return out;
}

// ===== 标签显示 / 子事件进度（与主程式 calendar 事件行的显示样式对齐）=====
// 标签显示文字＝「一级·二级·三级」，与主程式 tlTagLabel 同源同格式
function tagLabelOf(t) {
  const n = (t && typeof t === 'object') ? (t.name || '') : (t || '');
  const c = (t && typeof t === 'object') ? (t.cat || '') : '';
  const s = (t && typeof t === 'object') ? (t.subcat || '') : '';
  return n + (c ? '·' + c : '') + (s ? '·' + s : '');
}
// 解析备注中的 Markdown checkbox 行 → 子事件 [{text, done}]（与主程式 tlParseNoteChecks 同规则：
// 跳过 ``` 代码围栏内的行；- [x]/[X]＝已完成、- [ ]＝未完成）
function parseNoteChecks(text) {
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
// 子事件进度胶囊「完成/总数」（全完成转绿）——与主程式列表行 .ev-sub-progress 同款式
function subProgressBadge(ev) {
  const subs = parseNoteChecks(ev && ev.notes);
  if (!subs.length) return '';
  const done = subs.filter((s) => s.done).length;
  const all = done === subs.length;
  return '<span class="note-sub-progress' + (all ? ' all-done' : '') +
    '" title="子事件：' + done + ' / ' + subs.length + ' 已完成">' + done + '/' + subs.length + '</span>';
}
// 跨天行程天数（含首尾；与主程式 tlSpanDays 同算法）
function spanDays(a, b) {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return 1;
  return Math.round((d2 - d1) / 86400000) + 1;
}
// meta 行日期文字（2026-10-13 修复：跨天行程漏显示结束日期）：
//   单日＝date；跨天（endDate 存在且 ≠ date）＝「date – endDate · 共N天」
// ⚠️ 与主程式 tlIsMultiDay / tlRangeLabel / tlSpanDays 同源同义；便利贴自身日期沿用原始 ISO 格式
//   （与正文里 [[dl:]]/[[cp:]] 渲染出的 📅/✅ 日期标记一致，不改动既有单日显示）
function metaDateText(ev) {
  const d = (ev && ev.date) || '';
  const e = (ev && ev.endDate && ev.endDate !== ev.date) ? ev.endDate : '';
  if (d && e) return d + ' – ' + e + ' · 共' + spanDays(d, e) + '天';
  return d || e || '';
}
// meta 行统一渲染：日期（跨天含结束日期与总天数 ·已完成）在前，右侧接「完成/总数」胶囊与「＋☐」加入子事件按钮
function renderMeta(ev) {
  const dateText = escapeHtml(metaDateText(ev) + (ev.done ? ' · 已完成' : ''));
  document.getElementById('meta').innerHTML = dateText + subProgressBadge(ev) +
    '<button type="button" class="note-addcheck" title="加入子事件（在备注末尾加 CheckBox，直接存档）">＋☐</button>';
}
// 标签列表统一渲染：显示「名·子标签」
function renderTags(ev) {
  document.getElementById('tags').innerHTML = (ev.tags || []).map((t) => '<li>' + escapeHtml(tagLabelOf(t)) + '</li>').join('');
}

const state = { w: DEFAULT_W, h: DEFAULT_H, color: STICKY_DEF_BG, opacity: 100, minimized: false, minH: 0, fontScale: 1, fontColor: STICKY_DEF_FG, fontWeight: 400, undoneChecksOnly: false };

async function init() {
  if (IS_FLIP) { await initFlip(); return; }
  let inst = {};
  try { inst = (await ipcRenderer.invoke('sticky-note-get', { key: KEY, idx: IDX })) || {}; } catch (e) {}
  Object.assign(state, {
    w: (typeof inst.w === 'number' && inst.w > MIN_W) ? inst.w : DEFAULT_W,
    h: (typeof inst.h === 'number' && inst.h > MIN_H) ? inst.h : DEFAULT_H,
    color: inst.color || STICKY_DEF_BG,
    opacity: (typeof inst.opacity === 'number') ? inst.opacity : 100,
    minimized: !!inst.minimized,
    minH: (typeof inst.minH === 'number' && inst.minH > 20) ? inst.minH : 0,
    fontScale: (typeof inst.fontScale === 'number') ? inst.fontScale : 1,
    fontColor: (typeof inst.fontColor === 'string' && inst.fontColor) ? inst.fontColor : STICKY_DEF_FG,
    fontWeight: (typeof inst.fontWeight === 'number') ? inst.fontWeight : 400,
    undoneChecksOnly: !!inst.undoneChecksOnly
  });

  let md = '';
  try { md = fs.readFileSync(FILE, 'utf8'); } catch (e) {}
  const ev = parseEvents(md).find(e => e.key === KEY);
  if (!ev) { document.getElementById('title').textContent = '(找不到该便利贴)'; applyColor(); return; }

  renderMeta(ev);
  renderTags(ev);
  // 正文/标题都用主窗口渲染好的 HTML（同一套 renderMarkdown/tlRenderNotes/tlRenderInlineMarkdown 管线：
  //    正文含 [[cp:]]→✅、[[dl:]]→📅、checkbox、GFM 表格/清单/代码块等；标题含 <BIG> 等行内标签），此处只负责显示。
  let html = '', titleHtml = '';
  try {
    const res = (await ipcRenderer.invoke('sticky-note-html', { key: KEY, idx: IDX })) || {};
    html = (typeof res.html === 'string') ? res.html : '';
    titleHtml = (typeof res.titleHtml === 'string') ? res.titleHtml : '';
  } catch (e) { html = ''; titleHtml = ''; }
  // 🆕 标题：优先用主窗口渲染好的 HTML（与列表行一致）；拿不到时退回纯文本（避免显示原始标签）
  const titleEl = document.getElementById('title');
  if (titleHtml) { titleEl.innerHTML = titleHtml; } else { titleEl.textContent = ev.title; }
  // 兜底：主窗口未就绪时退回纯文本，避免空白
  if (!html && ev.notes) html = '<p>' + escapeHtml(ev.notes).replace(/\n/g, '<br>') + '</p>';
  document.getElementById('body').innerHTML = html;
  syncUndoneChecksFilter();
  // 新便利贴默认淡黄纸底（仅当用户未手动改过色时）；不再继承事件色，保持纸质便利贴观感
  if (!inst.color) state.color = STICKY_DEF_BG;
  // 勾选框填充色跟随事件色（与日历渲染一致：.ev-md-check.done .ev-cb 用事件色）
  document.getElementById('note').style.setProperty('--ev-primary', ev.color || '#7c3aed');
  applyColor();
  applyContentFont();

  // 🆕 最小化状态：收合成小卡（重测量确保窗口高度精确贴合）
  if (state.minimized) {
    document.getElementById('note').classList.add('minimized');
    const chx = collapsedH() || state.minH || 90;
    if (chx > 0) ipcRenderer.invoke('sticky-note-bounds', { key: KEY, idx: IDX, width: state.w, height: chx });
  }
  updateMinHandle();

  // 控件（分体/翻页共用：关闭/刷新/唤起主程式/最小化/改色/透明度/缩放 + 点击唤起主程式）
  setupControls();
}

// 右上角 ☰ 下拉菜单：收纳全部操作（翻页◀▶ / 刷新 / 打开 / 颜色·透明度 / 最小化 / 关闭）
function setupControls() {
  const menu = document.getElementById('menu');
  const menuHandle = document.getElementById('noteMenuHandle');
  const closeMenu = () => { if (menu) menu.classList.remove('open'); };
  const undoneChecksButton = document.getElementById('miUndoneChecks');
  if (undoneChecksButton) undoneChecksButton.onclick = (e) => {
    e.stopPropagation();
    state.undoneChecksOnly = !state.undoneChecksOnly;
    syncUndoneChecksFilter();
    persist();
  };
  const confirmClose = async () => {
    if (editMode && editDirty) {
      const ok = window.confirm('内容有未保存的改动。\n\n确定＝保存后关闭\n取消＝不关闭');
      if (!ok) return false;
      if (!await saveNoteEdit()) return false;
      return true;
    }
    const message = IS_FLIP
      ? '确定要关闭便利贴翻页窗口吗？\n\n关闭后将结束当前翻页显示。'
      : '确定要关闭这张便利贴吗？\n\n之后仍可从便利贴菜单重新开启。';
    return window.confirm(message);
  };
  ipcRenderer.on('sticky-note-close-request', async (event, payload) => {
    if (!payload || typeof payload.requestId !== 'string') return;
    const accepted = await confirmClose();
    try {
      await ipcRenderer.invoke('sticky-note-menu-close-result', {
        requestId: payload.requestId,
        accepted
      });
    } catch (error) {
      console.error('[StickyNote] 关闭便利贴失败:', error);
    }
  });
  if (menuHandle) menuHandle.onclick = (e) => {
    e.stopPropagation();
    if (menu) menu.classList.toggle('open');
    if (menu && menu.classList.contains('open')) loadStickyMenuNotes();
  };
  ipcRenderer.on('sticky-note-catalog-updated', () => {
    if (menu && menu.classList.contains('open')) loadStickyMenuNotes();
  });
  // 点击菜单与右上角手柄以外任意处（含便利贴本体）关闭菜单
  document.addEventListener('click', (e) => {
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target) || (menuHandle && menuHandle.contains(e.target))) return;
    closeMenu();
  }, true);
  document.getElementById('miClose').onclick = async (e) => {
    e.stopPropagation();
    if (!await confirmClose()) return;
    if (IS_FLIP) ipcRenderer.invoke('close-sticky-notes');          // 翻页模式：结束整个翻页会话
    else ipcRenderer.invoke('sticky-note-close', { key: KEY, idx: IDX });
  };
  const refreshStickyNote = (e) => {
    e.stopPropagation();
    closeMenu();
    const ev = parseEvents(readMd()).find(item => item.key === KEY);
    activeStickyRefreshId = 'sticky-refresh-' + Date.now() + '-' + (++stickyRefreshSeq);
    showStickyRefreshFeedback('正在刷新便利贴…');
    ipcRenderer.send('sticky-note-refresh-request', {
      requestId: activeStickyRefreshId,
      key: KEY, idx: IDX,
      title: (document.getElementById('title').textContent || '').replace(/\s+/g, ' ').trim(),
      date: ev ? ev.date : ''
    });
  };
  document.getElementById('noteRefreshHandle').onclick = refreshStickyNote;
  ipcRenderer.on('sticky-note-refresh-result', (event, result) => {
    if (!result || result.requestId !== activeStickyRefreshId) return;
    showStickyRefreshFeedback(result.message || (result.success
      ? '便利贴刷新完成，共同步 ' + result.count + ' 项。'
      : '便利贴刷新失败。'), !result.success);
  });
  document.getElementById('miCalendar').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('activate-main-window'); };
  const stickyList = document.getElementById('mStickyList');
  if (stickyList) stickyList.onclick = async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const stateButton = target && target.closest('button[data-action="toggle"][data-key]');
    const row = target && target.closest('.m-sticky-item');
    const itemButton = row && row.querySelector('button[data-action="show"][data-key]');
    const button = stateButton || itemButton;
    if (!button) return;
    e.stopPropagation();
    try {
      const note = { key: button.dataset.key, idx: Number(button.dataset.idx) || 0 };
      if (stateButton) {
        const result = await ipcRenderer.invoke('toggle-sticky-note', note);
        if (result && result.success) await loadStickyMenuNotes();
        return;
      }
      closeMenu();
      let result = await ipcRenderer.invoke('focus-sticky-note', note);
      if (!result || !result.success) {
        result = await ipcRenderer.invoke('toggle-sticky-note', note);
        if (result && result.success) await ipcRenderer.invoke('focus-sticky-note', note);
      }
    } catch (error) {
      console.error('[StickyNote] 显示便利贴失败:', error);
    }
  };
  loadStickyMenuNotes();
  document.getElementById('noteMinHandle').onclick = (e) => {
    e.stopPropagation();
    toggleMinimize();
  };
  document.getElementById('miCfg').onclick = (e) => {
    e.stopPropagation();
    const cfg = document.getElementById('mCfg');
    if (cfg) cfg.classList.toggle('open');
  };
  document.getElementById('miZoomIn').onclick = (e) => { e.stopPropagation(); changeFontScale(0.1); };
  document.getElementById('miZoomOut').onclick = (e) => { e.stopPropagation(); changeFontScale(-0.1); };
  // 显示模式（分体 / 翻页）：请求主进程转发给主程式统一切换（记忆 + 重开）
  document.getElementById('miModeSplit').onclick = (e) => { e.stopPropagation(); requestStickyDisplayMode('split'); };
  document.getElementById('miModeFlip').onclick = (e) => { e.stopPropagation(); requestStickyDisplayMode('flip'); };
  syncModeSeg();
  // 内容模式由左下角浮动手柄切换；编辑模式直接改事件原始 Markdown（notes）
  document.getElementById('noteModeHandle').onclick = (e) => {
    e.stopPropagation();
    setEditMode(!editMode);
  };
  syncEditSeg();
  const editArea = document.getElementById('editArea');
  if (editArea) {
    // 🆕 手动保存制：输入只标记「未保存」，不再自动落盘（避免打断思路、浪费 IO）
    editArea.addEventListener('input', () => { editDirty = true; markEditDirty(true); });
    // 编辑区不触发「点击唤起主程式」/ 双击跳转
    editArea.addEventListener('click', (e) => e.stopPropagation());
    editArea.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  // ⌘S / Ctrl+S 手动保存（编辑模式）；＋☐ 浮层打开时＝确认加入（焦点在 textarea 时由其自身 keydown 处理，这里兜底焦点在浮层外的情况）；本窗口无应用菜单，不会被系统抢走
  window.addEventListener('keydown', (e) => {
    const acOv = document.getElementById('addCheckOv');
    if (acOv && acOv.classList.contains('show')) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); e.stopPropagation(); confirmAddCheck(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAddCheck(); }
      return;
    }
    if (!editMode) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      saveNoteEdit();
    }
  });
  document.getElementById('swatches').innerHTML = PALETTE.map(c => '<span class="sw" data-color="' + c + '" style="background:' + c + '"></span>').join('');
  document.getElementById('swatches').onclick = (e) => {
    const c = e.target.getAttribute && e.target.getAttribute('data-color');
    if (!c) return;
    state.color = c; applyColor(); persist(); // 选色后保持菜单展开，便于继续调透明度
  };
  const op = document.getElementById('opacity');
  op.value = String(state.opacity);
  document.getElementById('opacityVal').textContent = state.opacity + '%';
  op.oninput = () => { state.opacity = +op.value; document.getElementById('opacityVal').textContent = state.opacity + '%'; applyColor(); };
  op.onchange = persist;
  // 字体颜色 / 字重（收纳于「背景色 / 透明度」子区）
  document.getElementById('textSwatches').innerHTML = TEXT_PALETTE.map(c => '<span class="sw" data-color="' + c + '" style="background:' + c + '"></span>').join('');
  document.getElementById('textSwatches').onclick = (e) => {
    const c = e.target.getAttribute && e.target.getAttribute('data-color');
    if (!c) return;
    state.fontColor = c; applyContentFont(); syncTextAppearance(); persist(); // 保持菜单展开便于连调
  };
  document.querySelectorAll('#mCfg .m-wbtn').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); state.fontWeight = +b.getAttribute('data-w') || 400; applyContentFont(); syncTextAppearance(); persist(); };
  });
  // 🎨 自选色（调色盘）：两块色板末尾各加一个「自选色」彩虹圆点，内嵌透明 input[type=color]；
  //    input＝拖动调色盘实时预览，change＝收盘后落盘。色值统一转大写（与 PALETTE 一致）。
  function addCustomSwatch(boxId, getCur, onInput, onCommit) {
    const box = document.getElementById(boxId);
    if (!box) return null;
    const wrap = document.createElement('span');
    wrap.className = 'sw sw-custom';
    wrap.title = '自选色（调色盘）';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = getCur();
    inp.addEventListener('input', () => onInput(String(inp.value).toUpperCase()));
    inp.addEventListener('change', () => onCommit(String(inp.value).toUpperCase()));
    wrap.appendChild(inp);
    box.appendChild(wrap);
    return wrap;
  }
  addCustomSwatch('swatches',
    () => (/^#[0-9a-fA-F]{6}$/.test(state.color) ? state.color : STICKY_DEF_BG),
    (c) => { state.color = c; applyColor(); },
    () => { persist(); syncCustomSwatchActive(); });
  addCustomSwatch('textSwatches',
    () => (/^#[0-9a-fA-F]{6}$/.test(state.fontColor) ? state.fontColor : STICKY_DEF_FG),
    (c) => { state.fontColor = c; applyContentFont(); },
    () => { persist(); syncTextAppearance(); });
  syncTextAppearance();
  document.getElementById('menu').addEventListener('pointerdown', e => e.stopPropagation());
  document.getElementById('rz').addEventListener('pointerdown', startResize);
  // 🆕 ＋☐ 加入子事件：meta 内按钮用事件委托（innerHTML 每次重绘），浮层 Enter/⌘S 确认、Esc 取消
  const ov = document.getElementById('addCheckOv');
  const metaEl = document.getElementById('meta');
  if (metaEl) metaEl.addEventListener('click', (e) => { if (e.target.closest('.note-addcheck')) openAddCheck(); });
  if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) closeAddCheck(); });
  const acInput = document.getElementById('addCheckInput');
  if (acInput) {
    acInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); confirmAddCheck(); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAddCheck(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeAddCheck(); }
    });
    acInput.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  if (ov) ov.addEventListener('pointerdown', (e) => e.stopPropagation());
  // 拖动交给 OS 原生（CSS -webkit-app-region: drag）；这里只处理「点击（未拖动）唤起主程式」/ 双击跳转
  const note = document.getElementById('note');
  note.addEventListener('click', onNoteClick);
  note.addEventListener('dblclick', onNoteDblClick);
  note.addEventListener('pointermove', (e) => {
    pointerClientX = e.clientX;
    pointerClientY = e.clientY;
    const rect = note.getBoundingClientRect();
    const rightGap = rect.right - e.clientX;
    const leftGap = e.clientX - rect.left;
    const topGap = e.clientY - rect.top;
    const bottomGap = rect.bottom - e.clientY;
    const centerGap = Math.abs(e.clientX - (rect.left + rect.width / 2));
    const nearBottomRight = rightGap >= 0 && rightGap <= 48 && bottomGap >= 0 && bottomGap <= 48;
    const nearBottomLeft = leftGap >= 0 && leftGap <= 48 && bottomGap >= 0 && bottomGap <= 48;
    const nearTopLeft = leftGap >= 0 && leftGap <= 48 && topGap >= 0 && topGap <= 48;
    const nearTopRight = rightGap >= 0 && rightGap <= 48 && topGap >= 0 && topGap <= 48;
    const nearTopCenter = centerGap <= 48 && topGap >= 0 && topGap <= 48;
    const nearBottomCenter = centerGap <= 48 && bottomGap >= 0 && bottomGap <= 48;
    document.getElementById('rz').classList.toggle('visible', nearBottomRight || !!rz);
    document.getElementById('noteModeHandle').classList.toggle('visible', nearBottomLeft);
    document.getElementById('noteMinHandle').classList.toggle('visible', nearTopLeft);
    document.getElementById('noteMenuHandle').classList.toggle('visible', nearTopRight);
    document.getElementById('miClose').classList.toggle('visible', nearTopCenter);
    document.getElementById('noteRefreshHandle').classList.toggle('visible', nearBottomCenter);
  });
  note.addEventListener('pointerleave', () => {
    pointerClientX = null;
    pointerClientY = null;
    if (!rz) document.getElementById('rz').classList.remove('visible');
    document.getElementById('noteModeHandle').classList.remove('visible');
    document.getElementById('noteMinHandle').classList.remove('visible');
    document.getElementById('noteMenuHandle').classList.remove('visible');
    document.getElementById('miClose').classList.remove('visible');
    document.getElementById('noteRefreshHandle').classList.remove('visible');
  });
  if (IS_FLIP) bindFlipNav();
}

// 原生拖拽由 OS 处理；只有「按下后未移动、松开＝点击」才会触发此 handler
// （拖拽过程中 OS 不会派发 click），故可安全用它区分「点一下＝唤起主程式」
function onNoteClick(e) {
  if (e.target.closest('.iconbtn, .note-mode-handle, .note-min-handle, .note-menu-handle, .note-refresh-handle, .note-addcheck, .flip-edge')) return;  // 按钮各自处理
  if (!e.target.closest('.bar, .head, .meta, .tags')) return; // 仅拖拽区点击＝唤起主程式
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
}

// 双击便利贴（标题栏或正文）：唤起主程式并打开该事件表单
// 正文区是 -webkit-app-region: no-drag，双击不会触发拖动，故可安全复用「唤起+打开事件」管线
function onNoteDblClick(e) {
  if (e.target.closest('.iconbtn, .menu, .rz, .note-addcheck, .flip-edge, .ev-md-edit, .ev-cb')) return; // 菜单/☰按钮/翻页把手/缩放把手/checkbox 控件各自处理
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
}

// ===== 🆕 便利贴「＋☐」加入子事件：对齐 calendar 列表行 tlOpenAddCheckDialog =====
// 逐行输入 → 每行列成「- [ ] 行」追加到事件备注末尾；Calendar 关闭时由主进程唤醒并交由其保存。
// 只读包含文件（ev.ro）由主程式拦截并 toast，这里无需额外判断。
function openAddCheck() {
  const inp = document.getElementById('addCheckInput');
  const ov = document.getElementById('addCheckOv');
  const title = ov && ov.querySelector('.ac-title');
  const hint = ov && ov.querySelector('.ac-hint');
  const copyButton = document.getElementById('copyNoteCheckButton');
  noteCheckEditTarget = null;
  if (title) title.textContent = '加入子事件（CheckBox）';
  if (hint) hint.textContent = '⌘S 加入 · Esc 取消';
  if (copyButton) copyButton.style.display = 'none';
  if (inp) { inp.value = ''; inp.placeholder = '每行一个子事件，回车直接加入…'; }
  if (ov) ov.classList.add('show');
  if (inp) setTimeout(() => inp.focus(), 0);
}
function closeAddCheck() {
  const ov = document.getElementById('addCheckOv');
  if (ov) ov.classList.remove('show');
  noteCheckEditTarget = null;
}
let addCheckSavePending = false;
let noteCheckEditTarget = null;
function closeEditNoteCheck() {
  noteCheckEditTarget = null;
  closeAddCheck();
}
function eventNotesForKey(key) {
  const ev = parseEvents(readMd()).find(item => item.key === key);
  return ev ? ev.notes || '' : null;
}
function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function transformNoteCheck(line, checked) {
  const match = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!match) return null;
  let text = match[3] || '';
  if (checked) {
    text = text.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, '[[dl:$1]]');
    if (!/\[\[cp:\d{4}-\d{2}-\d{2}\]\]/.test(text)) {
      text = text.replace(/\s+$/, '') + ' [[cp:' + localDateString() + ']]';
    }
  } else {
    text = text.replace(/\s*\[\[cp:\d{4}-\d{2}-\d{2}\]\]/g, '');
  }
  return match[1] + '- [' + (checked ? 'x' : ' ') + ']' + (text ? ' ' + text : '');
}
async function saveStickyNoteContent(notes, errorLabel, eventKey) {
  if (addCheckSavePending) return false;
  addCheckSavePending = true;
  try {
    const targetKey = eventKey || KEY;
    const result = await ipcRenderer.invoke('sticky-note-save-edit', { key: targetKey, idx: IDX, notes });
    if (!result || !result.success) {
      window.alert(errorLabel + '失败：' + ((result && result.error) || '主进程未确认保存'));
      return false;
    }
    const savedEvent = parseEvents(readMd()).find(item => item.key === targetKey);
    ipcRenderer.send('sticky-note-refresh-request', {
      key: KEY,
      idx: IDX,
      title: savedEvent ? savedEvent.title : '',
      date: savedEvent ? savedEvent.date : ''
    });
    return true;
  } catch (error) {
    window.alert(errorLabel + '失败：' + (error && error.message ? error.message : error));
    return false;
  } finally {
    addCheckSavePending = false;
  }
}
window.tlToggleNoteCheck = async function (event, uid, line) {
  const checkbox = event && event.target.closest('.ev-cb.interactive');
  if (!checkbox || checkbox.dataset.uid !== uid) return;
  event.preventDefault();
  event.stopPropagation();
  if (addCheckSavePending) return;
  const notes = eventNotesForKey(uid);
  if (notes == null) {
    window.alert('找不到该行程，无法更新子事件');
    return;
  }
  const lines = notes.split('\n');
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return;
  const match = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!match) {
    window.alert('该子事件内容已变化，请刷新便利贴后重试');
    return;
  }
  const updatedLine = transformNoteCheck(lines[line], match[2] === ' ');
  if (!updatedLine) return;
  lines[line] = updatedLine;
  await saveStickyNoteContent(lines.join('\n'), '更新子事件', uid);
};
window.tlCalCheckKey = function (event, uid, line) {
  if (!event || ![' ', 'Spacebar', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  window.tlToggleNoteCheck(event, uid, line);
};
window.tlOpenEditNoteCheckDialog = function (event, uid, line) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!event || !event.target.closest('.ev-md-edit')) return;
  const notes = eventNotesForKey(uid);
  if (notes == null) {
    window.alert('找不到该行程，无法编辑子事件');
    return;
  }
  const lines = notes.split('\n');
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return;
  const match = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!match) {
    window.alert('该子事件内容已变化，请刷新便利贴后重试');
    return;
  }
  const markerPattern = /\[\[(?:dl|cp):\d{4}-\d{2}-\d{2}\]\]|\[\[\d{4}-\d{2}-\d{2}\]\]/g;
  noteCheckEditTarget = { uid, line, markers: match[3].match(markerPattern) || [] };
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  const copyButton = document.getElementById('copyNoteCheckButton');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑子事件（CheckBox）';
    ov.querySelector('.ac-hint').textContent = '⌘S 保存修改 · Esc 取消；勾选状态与日期标记会保留';
    ov.classList.add('show');
  }
  if (copyButton) {
    copyButton.style.display = '';
    copyButton.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!inp || !inp.value) { window.alert('没有可复制的子事件内容'); return; }
      try {
        const result = await ipcRenderer.invoke('write-text-to-clipboard', inp.value);
        if (!result || result.success !== true) throw new Error((result && result.error) || '写入剪贴板失败');
        const originalText = copyButton.textContent;
        copyButton.textContent = '已复制';
        setTimeout(() => { if (copyButton) copyButton.textContent = originalText; }, 1200);
      } catch (error) {
        window.alert('复制子事件失败：' + (error && error.message ? error.message : error));
      }
    };
  }
  if (inp) {
    inp.value = match[3].replace(markerPattern, '').replace(/\s{2,}/g, ' ').trim();
    inp.placeholder = '输入子事件内容…';
    setTimeout(() => inp.focus(), 0);
  }
};
async function confirmAddCheck() {
  const inp = document.getElementById('addCheckInput');
  if (!inp) { closeAddCheck(); return; }
  if (noteCheckEditTarget) {
    if (addCheckSavePending) return;
    const target = noteCheckEditTarget;
    const text = inp.value.replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
    if (!text) { window.alert('子事件内容不可为空'); return; }
    const notes = eventNotesForKey(target.uid);
    if (notes == null) {
      window.alert('找不到该行程，无法保存子事件');
      return;
    }
    const lines = notes.split('\n');
    if (target.line < 0 || target.line >= lines.length) {
      window.alert('该子事件内容已变化，请刷新便利贴后重试');
      return;
    }
    const match = lines[target.line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (!match) {
      window.alert('该子事件内容已变化，请刷新便利贴后重试');
      return;
    }
    const suffix = target.markers.length ? ' ' + target.markers.join(' ') : '';
    lines[target.line] = match[1] + '- [' + match[2] + '] ' + text + suffix;
    if (await saveStickyNoteContent(lines.join('\n'), '保存子事件', target.uid)) closeEditNoteCheck();
    return;
  }
  const lines = inp.value.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  if (addCheckSavePending) return;
  const md = lines.map((l) => '- [ ] ' + l).join('\n');
  const ev = parseEvents(readMd()).find((x) => x.key === KEY);
  if (!ev) {
    window.alert('找不到该行程，无法保存子事件');
    return;
  }
  const notes = (ev.notes ? String(ev.notes).replace(/\s*$/, '') + '\n' : '') + md + '\n';
  if (await saveStickyNoteContent(notes, '保存子事件')) closeAddCheck();
}

// 🆕 刷新内容：接收主程式推来的最新渲染结果（arg.{html,titleHtml}），同步标题/正文/日期/标签
// 标题与正文来自主程式渲染（与列表行/主窗一致）；日期·完成态·标签直接回读 calendar.md 保持权威
function applyNoteContent(arg) {
  // 翻页模式：仅当刷新的是「当前页」才重绘；其余只更新缓存（翻到该页时生效）
  if (IS_FLIP && (!arg || arg.key !== KEY || +arg.idx !== IDX)) return;
  const titleEl = document.getElementById('title');
  if (arg && arg.titleHtml) {
    titleEl.innerHTML = arg.titleHtml;
  } else {
    const ev0 = parseEvents(readMd()).find(e => e.key === KEY);
    titleEl.textContent = ev0 ? ev0.title : '';
  }
  let html = (arg && typeof arg.html === 'string') ? arg.html : '';
  if (!html) {
    const ev0 = parseEvents(readMd()).find(e => e.key === KEY);
    if (ev0 && ev0.notes) html = '<p>' + escapeHtml(ev0.notes).replace(/\n/g, '<br>') + '</p>';
  }
  document.getElementById('body').innerHTML = html;
  const ev = parseEvents(readMd()).find(e => e.key === KEY);
  if (ev || arg) {
    renderMeta(Object.assign({}, ev || {}, {
      date: arg && typeof arg.date === 'string' ? arg.date : (ev && ev.date),
      done: arg && typeof arg.done === 'boolean' ? arg.done : !!(ev && ev.done),
      tags: arg && Array.isArray(arg.tags) ? arg.tags : ((ev && ev.tags) || [])
    }));
    renderTags({ tags: arg && Array.isArray(arg.tags) ? arg.tags : ((ev && ev.tags) || []) });
  }
  // 最小化态需按新内容重测紧凑卡高度（标题/标签变化可能改变高度）
  if (document.getElementById('note').classList.contains('minimized')) {
    const ch = collapsedH() || state.minH || 90;
    if (ch > 0) ipcRenderer.invoke('sticky-note-bounds', { key: KEY, idx: IDX, width: state.w, height: ch });
  }
}
// 读取 calendar.md（便利贴窗始终持有 FILE 路径）
function readMd() { try { return fs.readFileSync(FILE, 'utf8'); } catch (e) { return ''; } }
// 监听主程式推来的刷新（自动同步）
ipcRenderer.on('sticky-note-refresh', (e, arg) => applyNoteContent(arg));

function parseHexRgb(hex) {
  let value = String(hex || '').replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [255, 243, 176];
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}
function blendRgb(a, b, amount) {
  return a.map((value, index) => Math.round(value * (1 - amount) + b[index] * amount));
}
function rgbCss(rgb) { return 'rgb(' + rgb.join(', ') + ')'; }
function relativeLuminance(rgb) {
  const channels = rgb.map((value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function updateMenuTheme() {
  const menu = document.getElementById('menu');
  if (!menu) return;
  const cardBg = parseHexRgb(state.color);
  const text = parseHexRgb(state.fontColor || STICKY_DEF_FG);
  const darkSurface = [32, 35, 42], lightSurface = [246, 245, 239];
  const surfaceTarget = contrastRatio(text, darkSurface) >= contrastRatio(text, lightSurface)
    ? darkSurface : lightSurface;
  let low = 0.14, high = 1;
  if (contrastRatio(text, blendRgb(cardBg, surfaceTarget, low)) < 4.5) {
    for (let i = 0; i < 12; i += 1) {
      const mid = (low + high) / 2;
      if (contrastRatio(text, blendRgb(cardBg, surfaceTarget, mid)) >= 4.5) high = mid;
      else low = mid;
    }
    low = high;
  }
  const surface = blendRgb(cardBg, surfaceTarget, low);
  menu.style.setProperty('--menu-bg', rgbCss(surface));
  menu.style.setProperty('--menu-muted', rgbCss(blendRgb(text, surface, 0.2)));
  menu.style.setProperty('--menu-divider', rgbCss(blendRgb(text, surface, 0.72)));
  menu.style.setProperty('--menu-status-open', relativeLuminance(surface) < 0.25 ? '#4ade80' : '#15803d');
}

function applyColor() {
  const hex = tint(state.color, state.opacity);
  document.getElementById('note').style.background = hex;
  document.getElementById('bar').style.background = state.color;
  // ＋☐ 浮层盒与便利贴同背景色（取实色 tint(…,100)，不随透明度变淡，保证浮层可读）；文字色经 --note-fg 继承
  const acBox = document.getElementById('addCheckBox');
  if (acBox) acBox.style.background = tint(state.color, 100);
  updateMenuTheme();
  syncCustomSwatchActive();
}
function syncUndoneChecksFilter() {
  const body = document.getElementById('body');
  const button = document.getElementById('miUndoneChecks');
  if (body) body.classList.toggle('only-undone-checks', !!state.undoneChecksOnly);
  if (button) {
    button.textContent = '只显示未完成 checkbox：' + (state.undoneChecksOnly ? '开' : '关');
    button.setAttribute('aria-pressed', state.undoneChecksOnly ? 'true' : 'false');
  }
}
function persist() {
  if (IS_FLIP) {
    // 几何（位置/尺寸/最小化）写翻页窗专用 id；颜色/透明度/字号按当前显示的便利贴自身状态写
    const g = geomId();
    ipcRenderer.invoke('sticky-note-set', { key: g.key, idx: g.idx, patch: { w: state.w, h: state.h, minimized: state.minimized, minH: state.minH } });
    ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { color: state.color, opacity: state.opacity, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight, undoneChecksOnly: state.undoneChecksOnly } });
    return;
  }
  ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { w: state.w, h: state.h, color: state.color, opacity: state.opacity, minimized: state.minimized, minH: state.minH, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight, undoneChecksOnly: state.undoneChecksOnly } });
}

// 依字体色亮度取反色：浅色文字 → 给标签一个深底；深色文字 → 给浅底（保证标签始终可读）
function contrastTagBg(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return 'rgba(0,0,0,.06)';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;   // 感知亮度
  return lum > 0.6 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.28)';
}

// 内容字号/颜色/字重：以 12px 为基准按 fontScale 等比例缩放（heading 等均用 em，随基准同步放大/缩小）
// 字体颜色同时驱动 标题/日期/标签（CSS 变量 --note-fg），标签底色自动反差（--tag-bg）
function applyContentFont() {
  const fg = state.fontColor || STICKY_DEF_FG;
  const note = document.getElementById('note');
  if (note) {
    note.style.setProperty('--note-fg', fg);
    note.style.setProperty('--tag-bg', contrastTagBg(fg));
  }
  updateMenuTheme();
  const fontSize = (12 * (state.fontScale || 1)).toFixed(2) + 'px';
  const body = document.getElementById('body');
  if (body) {
    body.style.fontSize = fontSize;
    body.style.color = fg;
    body.style.fontWeight = state.fontWeight || 400;
  }
  const editArea = document.getElementById('editArea');
  if (editArea) editArea.style.fontSize = fontSize;
}
// 同步「字体颜色 / 字重」选中态（菜单内色板 + 分段按钮）
function syncTextAppearance() {
  document.querySelectorAll('#textSwatches .sw').forEach(el => {
    el.classList.toggle('active', (el.getAttribute('data-color') || '') === (state.fontColor || STICKY_DEF_FG));
  });
  document.querySelectorAll('#mCfg .m-wbtn').forEach(b => {
    b.classList.toggle('active', (+b.getAttribute('data-w') || 400) === (state.fontWeight || 400));
  });
  syncCustomSwatchActive();
}
// 自选色圆点选中态：当前色不在固定色板内＝正用自选色 → 高亮对应彩虹圆点（蓝圈）
function syncCustomSwatchActive() {
  const bg = document.querySelector('#swatches .sw-custom');
  if (bg) bg.classList.toggle('active', !PALETTE.includes(state.color));
  const tx = document.querySelector('#textSwatches .sw-custom');
  if (tx) tx.classList.toggle('active', !TEXT_PALETTE.includes(state.fontColor));
}
function updateZoomInd() {
  const el = document.getElementById('zoomInd');
  if (el) el.textContent = Math.round((state.fontScale || 1) * 100) + '%';
}
function changeFontScale(delta) {
  state.fontScale = Math.max(0.5, Math.min(2.5, +((state.fontScale || 1) + delta).toFixed(2)));
  applyContentFont();
  updateZoomInd();
  persist();
}

// 显示模式：向主进程请求切换（分体 / 翻页）；主程式会按新模式重开全部便利贴（当前窗随之销毁）
function requestStickyDisplayMode(mode) {
  ipcRenderer.invoke('request-sticky-display-mode', { mode });
}
// 下拉菜单高亮当前显示模式
async function syncModeSeg() {
  let mode = 'split';
  try { const r = await ipcRenderer.invoke('sticky-note-mode'); mode = (r && r.mode) || 'split'; } catch (e) {}
  const s = document.getElementById('miModeSplit'), f = document.getElementById('miModeFlip');
  if (s) s.classList.toggle('active', mode === 'split');
  if (f) f.classList.toggle('active', mode === 'flip');
}
// 下拉菜单高亮当前内容模式（渲染 / 编辑）
function syncEditSeg() {
  const handle = document.getElementById('noteModeHandle');
  if (handle) {
    handle.textContent = editMode ? '▤' : '✎';
    handle.title = editMode ? '切换到渲染模式' : '切换到编辑模式';
    handle.setAttribute('aria-label', handle.title);
  }
}

// 读取当前事件（KEY/IDX）的原始 notes（直接回读 calendar.md，保证权威）
function getEventNotes() {
  const ev = parseEvents(readMd()).find(x => x.key === KEY);
  return ev ? (ev.notes || '') : '';
}
// 统一重渲染正文/标题/日期/标签（用主窗口渲染好的 HTML）：编辑→渲染切换时复用
async function renderNoteContent() {
  const ev = parseEvents(readMd()).find(x => x.key === KEY);
  const titleEl = document.getElementById('title');
  if (!ev) {
    titleEl.textContent = '(找不到该便利贴)';
    document.getElementById('meta').textContent = '';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('body').innerHTML = '';
    return false;
  }
  let html = '', titleHtml = '';
  try {
    const res = (await ipcRenderer.invoke('sticky-note-html', { key: KEY, idx: IDX })) || {};
    html = (typeof res.html === 'string') ? res.html : '';
    titleHtml = (typeof res.titleHtml === 'string') ? res.titleHtml : '';
  } catch (e) {}
  if (titleHtml) titleEl.innerHTML = titleHtml; else titleEl.textContent = ev.title;
  if (!html && ev.notes) html = '<p>' + escapeHtml(ev.notes).replace(/\n/g, '<br>') + '</p>';
  document.getElementById('body').innerHTML = html;
  syncUndoneChecksFilter();
  renderMeta(ev);
  renderTags(ev);
  return true;
}
// 切换内容模式：edit=true 进编辑（textarea 填原始 notes）/ false 回渲染（重新取最新 HTML）
async function setEditMode(edit) {
  const note = document.getElementById('note');
  const ea = document.getElementById('editArea');
  // 离开编辑模式前：有未保存改动 → 先确认（默认留在编辑模式，取消＝不丢改动）
  if (!edit && editMode && editDirty) {
    const ok = window.confirm('内容有未保存的改动。\n\n确定＝先保存再返回渲染模式\n取消＝留在编辑模式（不丢改动）');
    if (ok) {
      if (!await saveNoteEdit()) return;
    }
    else { syncEditSeg(); return; }
  }
  editMode = !!edit;
  if (editMode) {
    if (ea) { ea.value = getEventNotes(); applyContentFont(); ea.scrollTop = 0; ea.style.boxShadow = ''; }
    if (note) note.classList.add('editing');
  } else {
    if (note) note.classList.remove('editing');
    editDirty = false;
    // 渲染模式：重新拉取最新渲染结果（编辑回写后已落盘 + 主程式刷新过，这里确保显示最新）
    renderNoteContent();
  }
  syncEditSeg();
}

// 🆕 手动保存（⌘S）：把 textarea 内容回写到 calendar.md；Calendar 关闭时由主进程直接写文件。
let editSavePending = false;
async function saveNoteEdit() {
  const ea = document.getElementById('editArea');
  if (!ea || editSavePending) return false;
  editSavePending = true;
  let result;
  try {
    result = await ipcRenderer.invoke('sticky-note-save-edit', { key: KEY, idx: IDX, notes: ea.value });
  } catch (error) {
    window.alert('保存便利贴失败：' + (error && error.message ? error.message : error));
    editSavePending = false;
    return false;
  }
  editSavePending = false;
  if (!result || !result.success) {
    window.alert('保存便利贴失败：' + ((result && result.error) || '主进程未确认保存'));
    return false;
  }
  editDirty = false;
  markEditDirty(false);
  return true;
}
// 未保存状态提示：用编辑框内圈描边表示（不新增 DOM，保持画面干净）
//   红框＝有未保存改动；按 ⌘S 后转绿框，1.6 秒后自动淡出
let dirtyTimer = null;
function markEditDirty(on) {
  const ea = document.getElementById('editArea');
  if (!ea) return;
  if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
  if (on) {
    ea.title = '有未保存的改动 —— 按 ⌘S（Windows 为 Ctrl+S）保存';
    ea.style.boxShadow = 'inset 0 0 0 1px rgba(220,38,38,.55)';
  } else {
    ea.title = '已保存到 calendar.md';
    ea.style.boxShadow = 'inset 0 0 0 1px rgba(34,197,94,.5)';
    dirtyTimer = setTimeout(() => { if (ea) ea.style.boxShadow = ''; dirtyTimer = null; }, 1600);
  }
}

// 🆕 最小化：收合成小卡（标题＋日期＋标签）。状态随便利贴一并持久化，重新开启时还原
// ⚠️ sticky-note-bounds 的宽/高是成对判定（缺 width 则 setBounds 不执行），所以这里必须同时传 width+height
function collapsedH() {
  const note = document.getElementById('note');
  if (!note) return 0;
  let h = 0;
  const sels = ['.bar', '.head', '.meta', '.tags'];
  sels.forEach((sel) => {
    const el = note.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    h += el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  });
  return Math.round(h) + 8; // 底部留白
}
function updateMinHandle() {
  const handle = document.getElementById('noteMinHandle');
  const icon = state.minimized ? '▢' : '▁';
  const title = state.minimized ? '还原（展开便利贴）' : '最小化（收合成小卡）';
  if (handle) {
    handle.textContent = icon;
    handle.title = title;
    handle.setAttribute('aria-label', title);
  }
}
function toggleMinimize() {
  const note = document.getElementById('note');
  const g = geomId();
  const ch = collapsedH() || state.minH || 90;
  if (state.minimized) {
    state.minimized = false;
    note.classList.remove('minimized');
    ipcRenderer.invoke('sticky-note-bounds', { key: g.key, idx: g.idx, width: state.w, height: state.h });
  } else {
    state.minimized = true;
    note.classList.add('minimized');
    if (ch > 0) { state.minH = ch; ipcRenderer.invoke('sticky-note-bounds', { key: g.key, idx: g.idx, width: state.w, height: ch }); }
  }
  updateMinHandle();
  persist();
}

// （拖动已改为 OS 原生 -webkit-app-region: drag，无需 JS 逐帧移动）

// 右下把手缩放
let rz = null;
function startResize(e) {
  e.stopPropagation(); e.preventDefault();
  document.getElementById('rz').classList.add('visible');
  rz = { sx: e.clientX, sy: e.clientY, w: state.w, h: state.h };
  window.addEventListener('pointermove', onResize);
  window.addEventListener('pointerup', endResize, { once: true });
}
function onResize(e) {
  if (!rz) return;
  pointerClientX = e.clientX;
  pointerClientY = e.clientY;
  state.w = Math.max(MIN_W, rz.w + (e.clientX - rz.sx));
  state.h = Math.max(MIN_H, rz.h + (e.clientY - rz.sy));
  const g = geomId();
  ipcRenderer.invoke('sticky-note-bounds', { key: g.key, idx: g.idx, width: state.w, height: state.h });
}
function endResize() {
  window.removeEventListener('pointermove', onResize);
  if (rz) { persist(); rz = null; }
  const note = document.getElementById('note');
  const rect = note.getBoundingClientRect();
  const rightGap = pointerClientX === null ? Infinity : rect.right - pointerClientX;
  const bottomGap = pointerClientY === null ? Infinity : rect.bottom - pointerClientY;
  const nearBottomRight = pointerClientX !== null && pointerClientY !== null
    && rightGap >= 0 && rightGap <= 48 && bottomGap >= 0 && bottomGap <= 48;
  document.getElementById('rz').classList.toggle('visible', nearBottomRight);
}

// 🆕 翻页模式入口：拉取顺序、建翻页窗、渲染第 0 张，并绑定 ◀ ▶ 与 ← → 翻页
async function initFlip() {
  flipOrder = ((await ipcRenderer.invoke('sticky-note-order')) || {}).order || [];
  flipTotal = flipOrder.length;
  const geom = (await ipcRenderer.invoke('sticky-note-get', { key: FLIP_KEY, idx: FLIP_IDX })) || {};
  Object.assign(state, {
    w: (typeof geom.w === 'number' && geom.w > MIN_W) ? geom.w : DEFAULT_W,
    h: (typeof geom.h === 'number' && geom.h > MIN_H) ? geom.h : DEFAULT_H,
    minimized: !!geom.minimized,
    minH: (typeof geom.minH === 'number' && geom.minH > 20) ? geom.minH : 0
  });
  document.getElementById('note').classList.add('flip');
  setupControls();
  ipcRenderer.on('sticky-note-show-page', (e, payload) => {
    if (payload && Number.isInteger(payload.index)) renderFlipPage(payload.index);
  });
  ipcRenderer.on('sticky-note-order-updated', (e, payload) => {
    const current = flipOrder[flipIndex];
    const currentKey = current && current.key;
    const currentIdx = current && (+current.idx || 0);
    flipOrder = payload && Array.isArray(payload.order) ? payload.order : [];
    flipTotal = flipOrder.length;
    const currentIndex = flipOrder.findIndex(note => note.key === currentKey && (+note.idx || 0) === currentIdx);
    const targetIndex = currentIndex >= 0 ? currentIndex : Math.min(flipIndex, Math.max(0, flipTotal - 1));
    updateFlipInd();
    if (flipTotal) renderFlipPage(targetIndex);
  });
  if (flipTotal === 0) {
    document.getElementById('title').textContent = '(没有可翻页的便利贴)';
    document.getElementById('meta').textContent = '';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('body').innerHTML = '';
    applyColor();
    updateFlipInd();
    return;
  }
  if (state.minimized) {
    document.getElementById('note').classList.add('minimized');
    const ch = collapsedH() || state.minH || 90;
    if (ch > 0) ipcRenderer.invoke('sticky-note-bounds', { key: FLIP_KEY, idx: FLIP_IDX, width: state.w, height: ch });
  }
  updateMinHandle();
  await renderFlipPage(0);
}

async function loadStickyMenuNotes() {
  const wrap = document.getElementById('mStickyListWrap');
  const list = document.getElementById('mStickyList');
  if (!wrap || !list) return;
  const requestSeq = ++stickyMenuLoadSeq;
  try {
    const result = await ipcRenderer.invoke('sticky-note-order');
    if (requestSeq !== stickyMenuLoadSeq) return;
    const notes = result && Array.isArray(result.notes)
      ? result.notes
      : (result && Array.isArray(result.order) ? result.order : []);
    list.replaceChildren();
    notes.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'm-sticky-item';
      const name = String(item.title || item.key || '未命名便利贴').replace(/\s+/g, ' ').trim();
      const label = (name || '未命名便利贴') + ((+item.idx || 0) > 0 ? ' (' + ((+item.idx || 0) + 1) + ')' : '');
      const indexEl = document.createElement('span');
      indexEl.className = 'm-sticky-item-index';
      indexEl.textContent = String(index + 1) + '.';
      indexEl.setAttribute('aria-hidden', 'true');
      const nameEl = document.createElement('button');
      nameEl.type = 'button';
      nameEl.className = 'mi m-sticky-item-name';
      nameEl.dataset.action = 'show';
      nameEl.dataset.key = item.key;
      nameEl.dataset.idx = String(item.idx || 0);
      nameEl.textContent = label;
      nameEl.title = label + '（点击显示该便利贴）';
      const stateEl = document.createElement('button');
      stateEl.type = 'button';
      stateEl.className = 'mi m-sticky-item-state' + (item.isOpen ? ' open' : '');
      stateEl.dataset.action = 'toggle';
      stateEl.dataset.key = item.key;
      stateEl.dataset.idx = String(item.idx || 0);
      stateEl.textContent = item.isOpen ? '开' : '关';
      stateEl.title = item.isOpen ? '点击关闭该便利贴' : '点击开启该便利贴';
      stateEl.setAttribute('aria-label', item.isOpen ? '关闭该便利贴' : '开启该便利贴');
      row.append(indexEl, nameEl, stateEl);
      list.appendChild(row);
    });
    wrap.classList.toggle('open', notes.length > 0);
  } catch (error) {
    if (requestSeq !== stickyMenuLoadSeq) return;
    console.error('[StickyNote] 读取便利贴清单失败:', error);
    wrap.classList.remove('open');
  }
}

// 渲染第 i 张：切换 KEY/IDX（内容＋颜色/透明度按该便利贴自身状态），翻页窗几何保持不变
async function renderFlipPage(i) {
  if (flipTotal === 0) return;
  i = Math.max(0, Math.min(flipTotal - 1, i));
  flipIndex = i;
  // 翻页：退出编辑模式（每页各自编辑，翻页即切到该页的渲染视图，避免 textarea 内容错位）
  // ⚠️ 有未保存改动时不静默丢弃：先确认（确定＝保存并翻页；取消＝中止本次翻页）
  if (editMode && editDirty) {
    const ok = window.confirm('内容有未保存的改动。\n\n确定＝先保存再翻页\n取消＝留在本页不翻');
    if (!ok) return;
    saveNoteEdit();
  }
  editMode = false;
  editDirty = false;
  syncEditSeg();
  const noteEl0 = document.getElementById('note');
  if (noteEl0) noteEl0.classList.remove('editing');
  const eaEl0 = document.getElementById('editArea');
  if (eaEl0) eaEl0.style.boxShadow = '';
  KEY = flipOrder[i].key;
  IDX = +flipOrder[i].idx || 0;
  const listed = flipOrder[i];
  const parsedEvent = parseEvents(readMd()).find(e => e.key === KEY);
  const ev = listed ? Object.assign({}, parsedEvent || {}, listed, { key: KEY, uid: KEY }) : parsedEvent;
  if (!ev) {
    document.getElementById('title').textContent = '(无法载入该便利贴)';
    document.getElementById('meta').textContent = '';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('body').innerHTML = '';
    applyColor();
    updateFlipInd();
    return;
  }
  // 颜色/透明度/字号：优先用该便利贴自身已存状态，否则退回纸质默认（淡黄底 + 纯黑字）
  const inst = (await ipcRenderer.invoke('sticky-note-get', { key: KEY, idx: IDX })) || {};
  state.color = (inst && inst.color) ? inst.color : STICKY_DEF_BG;
  state.opacity = (inst && typeof inst.opacity === 'number') ? inst.opacity : 100;
  state.fontScale = (inst && typeof inst.fontScale === 'number') ? inst.fontScale : 1;
  state.fontColor = (inst && typeof inst.fontColor === 'string' && inst.fontColor) ? inst.fontColor : STICKY_DEF_FG;
  state.fontWeight = (inst && typeof inst.fontWeight === 'number') ? inst.fontWeight : 400;
  state.undoneChecksOnly = !!(inst && inst.undoneChecksOnly);

  renderMeta(ev);
  renderTags(ev);
  document.getElementById('note').style.setProperty('--ev-primary', ev.color || '#7c3aed');

  let html = '', titleHtml = '';
  try {
    const res = (await ipcRenderer.invoke('sticky-note-html', { key: KEY, idx: IDX })) || {};
    html = (typeof res.html === 'string') ? res.html : '';
    titleHtml = (typeof res.titleHtml === 'string') ? res.titleHtml : '';
  } catch (e) { html = ''; titleHtml = ''; }
  const titleEl = document.getElementById('title');
  if (titleHtml) titleEl.innerHTML = titleHtml; else titleEl.textContent = ev.title;
  if (!html && ev.notes) html = '<p>' + escapeHtml(ev.notes).replace(/\n/g, '<br>') + '</p>';
  document.getElementById('body').innerHTML = html;
  syncUndoneChecksFilter();
  applyColor();
  applyContentFont();
  syncTextAppearance();
  // 透明度面板同步到当前便利贴自身状态
  const op = document.getElementById('opacity');
  if (op) { op.value = String(state.opacity); document.getElementById('opacityVal').textContent = state.opacity + '%'; }
  updateZoomInd();
  updateFlipInd();
  syncEditSeg();
}

function updateFlipInd() {
  updateFlipEdgeHandles();
}

function updateFlipEdgeHandles() {
  const prev = document.getElementById('flipPrevEdge');
  const next = document.getElementById('flipNextEdge');
  if (!prev || !next) return;
  const note = document.getElementById('note');
  const nearLeft = flipPointerX !== null && flipPointerX <= FLIP_EDGE_TRIGGER_PX;
  const nearRight = flipPointerX !== null && note.clientWidth - flipPointerX <= FLIP_EDGE_TRIGGER_PX;
  const previousPage = flipIndex;
  const nextPage = flipIndex + 2;
  prev.title = '上一张 · page ' + previousPage + ' of ' + flipTotal;
  next.title = '下一张 · page ' + nextPage + ' of ' + flipTotal;
  prev.classList.toggle('visible', flipIndex > 0 && nearLeft);
  next.classList.toggle('visible', flipIndex < flipTotal - 1 && nearRight);
}

function bindFlipNav() {
  const note = document.getElementById('note');
  const prevEdge = document.getElementById('flipPrevEdge');
  const nextEdge = document.getElementById('flipNextEdge');
  if (note) {
    note.addEventListener('pointermove', (e) => {
      flipPointerX = e.clientX;
      updateFlipEdgeHandles();
    });
    note.addEventListener('pointerleave', () => {
      flipPointerX = null;
      updateFlipEdgeHandles();
    });
  }
  if (prevEdge) prevEdge.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex - 1); };
  if (nextEdge) nextEdge.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex + 1); };
  window.addEventListener('keydown', (e) => {
    // 🆕 编辑模式、或焦点落在可输入控件时：所有按键交给文本编辑
    //    （← → ↑ ↓、空白、中英/输入法切换、复制粘贴等组合键），绝不抢去翻页
    if (editMode) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT'
              || (t.closest && t.closest('#editArea')))) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); renderFlipPage(flipIndex - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); renderFlipPage(flipIndex + 1); }
  });
}

init();