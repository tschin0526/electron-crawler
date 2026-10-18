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
// 📧 便利贴发邮件：收件人历史走主进程持久化（所有便利贴窗共享）
// 📧 发邮件链路（与 ToDo 卡片 📧、邮件插件 UI 完全同一函数）：

//   便利贴窗 → ipcRenderer.invoke('sticky-note-send-email') → 主进程二选一：
//    ① 主程序模式：找到邮件插件 webview → executeJavaScript('window.sendEmailByPlugin(...)')
//       → 邮件插件 POST http://localhost:5003/send_email（并写邮件插件自己的发送历史）
//    ② --sticky 独立模式：没有邮件插件 → 主进程按同一 multipart 契约直连 localhost:5003
//   结果原路回传。两种模式都能发（2026-10-17：用户 --sticky 实测②路径）。

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
// 边框悬浮把手「进入即显、停留 N 秒自动隐藏、离开边框带后再进入才重现」——防止遮挡内容按钮（编辑小圆点 / checkbox）
const EDGE_HANDLE_AUTOHIDE_MS = 4000;
let handleHideTimer = null;
let lastInBand = false;
function armEdgeHandlesAutoHide() {
  if (handleHideTimer) clearTimeout(handleHideTimer);
  handleHideTimer = setTimeout(hideAllEdgeHandles, EDGE_HANDLE_AUTOHIDE_MS);
}
function hideAllEdgeHandles() {
  ['rz', 'noteModeHandle', 'noteMinHandle', 'noteMenuHandle', 'miClose', 'noteRefreshHandle', 'flipPrevEdge', 'flipNextEdge']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'rz' && rz) return; // 缩放拖拽中保持把手可见
      el.classList.remove('visible');
    });
  if (handleHideTimer) { clearTimeout(handleHideTimer); handleHideTimer = null; }
}
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

// 从事件块提取 Remark 正文。参考桌面主程式 tlExtractRemark：按围栏长度匹配，支持备注内部再出现 ```。
// 旧正则 `/```\n([\s\S]*?)\n```/` 是非贪婪，遇到内容里有 ``` 会提前闭合，导致便利贴编辑模式内容消失。
function extractRemark(block) {
  const ri = block.indexOf('- Remark:');
  if (ri < 0) return '';
  const lines = block.slice(ri + '- Remark:'.length).split('\n');
  let start = -1, n = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(`{3,})[ \t]*$/);
    if (m) { start = i; n = m[1].length; break; }
  }
  if (start < 0) return '';
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(`{3,})[ \t]*$/);
    if (m && m[1].length >= n) { end = i; break; }
  }
  const body = (end >= 0 ? lines.slice(start + 1, end) : lines.slice(start + 1)).join('\n');
  const trimmed = body.replace(/^\n/, '').replace(/\n$/, '');
  return trimmed.trim() === '' ? '' : trimmed;
}

function parseEvents(md) {
  if (!md) return [];
  const out = [];
  // ⚠️ 与桌面主程式 tlParseEvents 用相同分块正则、相同序号 i 生成 uid='evp'+i，
  //    使便利贴 KEY 与主程式一致（改标题/日期不再断开关联）。i 从 0 起，与 tlParseBlock(idx) 对齐。
  const blocks = String(md).split(/^##[ \t]*EVENT(?:\([^)]*\))?[ \t]*$/m);
  blocks.forEach((b, i) => {
    // 同步桌面主程式 tlParseEvents：尾部黏着的 ## HOLIDAY / ## DIARY 都要截断，
    // 否则 ## DIARY 的 - title/-date 可能被误当成事件字段，diary 的代码块也会污染 remark 解析。
    const cut = b.search(/^##[ \t]*(HOLIDAY|DIARY)[ \t]*$/m);
    const blk = cut >= 0 ? b.slice(0, cut) : b;
    const get = (k) => { const m = blk.match(new RegExp('^- ' + k + ':\\s*`?([^`\\n]*)`?', 'm')); return m ? m[1].trim() : ''; };
    const title = get('title');
    if (!title) return;
    let color = get('color').replace(/^"|"$/g, '');
    let tags = []; try { tags = JSON.parse(get('tags')) || []; } catch (e) { tags = []; }
    const notes = extractRemark(blk);
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
      ? '确定要关闭 翻页模式的便利贴 窗口吗？\n\n关闭后将结束当前 翻页模式的便利贴 的显示。'
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
    if (!editMode) rereadStickyNoteTable(); // 按浮动按钮＝重新读表（编辑中有未保存改动时不覆盖）
    armEdgeHandlesAutoHide(); // 点击后从「此刻」重新计算 4 秒自动隐藏
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
  // 重新读表：请求主进程重读 calendar.md 并把最新事件内容经 sticky-note-refresh → applyNoteContent 落渲染
  function rereadStickyNoteTable() {
    const ev = parseEvents(readMd()).find(item => item.key === KEY);
    activeStickyRefreshId = 'sticky-refresh-' + Date.now() + '-' + (++stickyRefreshSeq);
    showStickyRefreshFeedback('正在刷新便利贴…');
    ipcRenderer.send('sticky-note-refresh-request', {
      requestId: activeStickyRefreshId,
      key: KEY, idx: IDX,
      title: (document.getElementById('title').textContent || '').replace(/\s+/g, ' ').trim(),
      date: ev ? ev.date : ''
    });
  }
  const refreshStickyNote = (e) => {
    e.stopPropagation();
    closeMenu();
    rereadStickyNoteTable();
    armEdgeHandlesAutoHide(); // 点击后从「此刻」重新计算 4 秒自动隐藏
  };
  document.getElementById('noteRefreshHandle').onclick = refreshStickyNote;
  ipcRenderer.on('sticky-note-refresh-result', (event, result) => {
    if (!result || result.requestId !== activeStickyRefreshId) return;
    showStickyRefreshFeedback(result.message || (result.success
      ? '便利贴刷新完成，共同步 ' + result.count + ' 项。'
      : '便利贴刷新失败。'), !result.success);
  });
  document.getElementById('miCalendar').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('activate-main-window'); };
  // 📜 滚动：唤起主程式并滚动定位到该行程（不打开编辑框）
  document.getElementById('miCalendarScroll').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('wake-main-from-note', { key: KEY, action: 'scroll' }); };
  // 📧 发邮件：收件人浮层 → 直调本机邮件服务（sendStickyEmail）
  document.getElementById('miEmail').onclick = (e) => { e.stopPropagation(); closeMenu(); openStickyEmailDialog(); };
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
    if (!editMode) rereadStickyNoteTable(); // 按浮动按钮＝重新读表
    armEdgeHandlesAutoHide(); // 点击后从「此刻」重新计算 4 秒自动隐藏
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
    armEdgeHandlesAutoHide(); // 点击后从「此刻」重新计算 4 秒自动隐藏
    setEditMode(!editMode); // 左下角把手＝纯模式切换（渲染 ⇄ 编辑），不做重读（避免与刷新按钮混淆、且不打断刚进入的编辑）
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
    // 📧 发邮件浮层打开中：Enter/Esc 已由输入框自身 keydown 处理；此处兜底焦点不在输入框的
    //    Esc，并挡住翻页 ←/→ 等快捷键（与 addCheckOv 同优先级）
    const emailOv = document.getElementById('emailOv');
    if (emailOv && emailOv.classList.contains('show')) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeStickyEmailDialog(); }
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
      // 🆕 回车＝确认加入仅在「加入子事件」模式（快速逐行新增）；「编辑子事件」模式不拦截回车，避免打断输入（保存用 ⌘S／「保存」按钮，关闭用 Esc）
      else if (e.key === 'Enter' && !e.shiftKey && !noteCheckEditTarget && !noteBlockEditTarget) { e.preventDefault(); confirmAddCheck(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeAddCheck(); }
    });
    acInput.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  // 🆕 弹层按钮行「复制｜保存｜关闭」：保存＝⌘S 同路径（confirmAddCheck），关闭＝Esc 同路径（closeAddCheck，加入/编辑两模式通用）
  const acSave = document.getElementById('saveCheckButton');
  if (acSave) acSave.onclick = (e) => { e.stopPropagation(); confirmAddCheck(); };
  const acClose = document.getElementById('closeCheckButton');
  if (acClose) acClose.onclick = (e) => { e.stopPropagation(); closeAddCheck(); };
  if (ov) ov.addEventListener('pointerdown', (e) => e.stopPropagation());
  // 🆕 发邮件浮层：发送｜取消、点背罩关闭、Enter 发送 / Esc 取消（焦点在输入框时由其自身处理）
  const emailSendBtn = document.getElementById('emailSendBtn');
  if (emailSendBtn) emailSendBtn.onclick = (e) => { e.stopPropagation(); sendStickyEmail(); };
  const emailCancelBtn = document.getElementById('emailCancelBtn');
  if (emailCancelBtn) emailCancelBtn.onclick = (e) => { e.stopPropagation(); closeStickyEmailDialog(); };
  const emailOv = document.getElementById('emailOv');
  if (emailOv) {
    emailOv.addEventListener('click', (e) => { if (e.target === emailOv) closeStickyEmailDialog(); });
    emailOv.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const emailInput = document.getElementById('emailRecipientInput');
  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); sendStickyEmail(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeStickyEmailDialog(); }
    });
    emailInput.addEventListener('focus', () => showEmailRecipientDropdown());
    emailInput.addEventListener('input', () => renderEmailRecipientDropdown());
    emailInput.addEventListener('blur', () => setTimeout(hideEmailRecipientDropdown, 150));
  }
  // 拖动交给 OS 原生（CSS -webkit-app-region: drag）；这里只处理「点击（未拖动）唤起主程式」/ 双击跳转
  const note = document.getElementById('note');
  note.addEventListener('click', onNoteClick);
  note.addEventListener('dblclick', onNoteDblClick);
  note.addEventListener('pointermove', (e) => {
    pointerClientX = e.clientX;
    pointerClientY = e.clientY;
    if (IS_FLIP) flipPointerX = e.clientX;
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
    // 边框带：上下左右 4 边/4 角 与 翻页左右边（翻页模式）
    const inBand = nearBottomRight || nearBottomLeft || nearTopLeft || nearTopRight || nearTopCenter || nearBottomCenter
      || (IS_FLIP && flipPointerX !== null
          && (flipPointerX <= FLIP_EDGE_TRIGGER_PX || note.clientWidth - flipPointerX <= FLIP_EDGE_TRIGGER_PX));
    if (inBand) {
      // 仅在「重新进入边框带」瞬间显示把手（避免持续悬停 / 在带内晃动时重复触发），并启动自动隐藏计时
      if (!lastInBand) {
        document.getElementById('rz').classList.toggle('visible', nearBottomRight || !!rz);
        document.getElementById('noteModeHandle').classList.toggle('visible', nearBottomLeft);
        document.getElementById('noteMinHandle').classList.toggle('visible', nearTopLeft);
        document.getElementById('noteMenuHandle').classList.toggle('visible', nearTopRight);
        document.getElementById('miClose').classList.toggle('visible', nearTopCenter);
        document.getElementById('noteRefreshHandle').classList.toggle('visible', nearBottomCenter);
        if (IS_FLIP) updateFlipEdgeHandles();
        armEdgeHandlesAutoHide();
      }
    } else {
      // 离开边框带：立即隐藏并取消防自动隐藏计时
      hideAllEdgeHandles();
    }
    lastInBand = inBand;
  });
  note.addEventListener('pointerleave', () => {
    pointerClientX = null;
    pointerClientY = null;
    lastInBand = false;
    hideAllEdgeHandles();
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
  noteBlockEditTarget = null;
  if (title) title.textContent = '加入子事件（CheckBox）';
  if (hint) hint.textContent = '⌘S 加入 · Esc 取消';
  if (copyButton) copyButton.style.display = 'none';
  const fullBtn = document.getElementById('editFullNoteFromCheckButton');
  if (fullBtn) fullBtn.style.display = 'none';
  if (inp) { inp.value = ''; inp.placeholder = '每行一个子事件，回车直接加入…'; }
  if (ov) ov.classList.add('show');
  if (inp) setTimeout(() => inp.focus(), 0);
}
function closeAddCheck() {
  const ov = document.getElementById('addCheckOv');
  if (ov) ov.classList.remove('show');
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
}
let addCheckSavePending = false;
let noteCheckEditTarget = null;
let noteBlockEditTarget = null; // { uid, start, end, type } — 通用「最小 MD 区块」编辑区间
function closeEditNoteCheck() {
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
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
  noteCheckEditTarget = { uid, line };
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  const copyButton = document.getElementById('copyNoteCheckButton');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑子事件（CheckBox）';
    ov.querySelector('.ac-hint').textContent = '⌘S 保存（不关闭，可继续编辑）· Esc 关闭；勾选状态会保留，日期标记（[[dl:…]]/[[cp:…]]）以原文显示可直接编辑；清空内容并保存＝删除该子事件（会先确认）';
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
  const fullBtn = document.getElementById('editFullNoteFromCheckButton');
  if (fullBtn) {
    fullBtn.style.display = '';
    fullBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAddCheck();
      setEditMode(true);
    };
  }
  if (inp) {
    // 🆕 原文保真：编辑框显示原始文本（含 [[dl:…]]/[[cp:…]] 等 [[]] 符号），不剥离、不折叠空白；保存时直接写回
    inp.value = match[3];
    inp.placeholder = '输入子事件内容…';
    setTimeout(() => inp.focus(), 0);
  }
};
function stickyBlockTypeName(type) {
  return ({ code: '代码块', table: '表格', heading: '标题', hr: '分隔线', quote: '引用', list: '列表', para: '段落' })[type] || '区块';
}
// 🆕 通用「最小 MD 区块」编辑（便利贴端）：编辑 notes 中 lines[start..end] 的 Markdown 原文。
//   区间起止由主窗渲染时嵌入 onclick；⌘S／「保存」＝只落盘不关闭 · Esc 关闭；清空并保存＝删除该区块（需确认）。
window.tlOpenEditBlockDialog = function (event, uid, start, end, type) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!event || !event.target.closest('.md-unit-edit')) return;
  if (addCheckSavePending) return;
  const notes = eventNotesForKey(uid);
  if (notes == null) { window.alert('找不到该行程，无法编辑区块'); return; }
  const lines = notes.split('\n');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= lines.length || start > end) {
    window.alert('该区块内容已变化，请刷新便利贴后重试');
    return;
  }
  const src = lines.slice(start, end + 1).join('\n');
  noteCheckEditTarget = null;
  noteBlockEditTarget = { uid, start, end, type };
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  const copyButton = document.getElementById('copyNoteCheckButton');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑内容区块（' + stickyBlockTypeName(type) + '）';
    ov.querySelector('.ac-hint').textContent = '直接编辑此区块的 Markdown 原文；⌘S 保存（不关闭，可继续编辑）· Esc 关闭；清空并保存＝删除该区块（会先确认）';
    ov.classList.add('show');
  }
  if (copyButton) {
    copyButton.style.display = '';
    copyButton.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!inp || !inp.value) { window.alert('没有可复制的内容'); return; }
      try {
        const result = await ipcRenderer.invoke('write-text-to-clipboard', inp.value);
        if (!result || result.success !== true) throw new Error((result && result.error) || '写入剪贴板失败');
        const originalText = copyButton.textContent;
        copyButton.textContent = '已复制';
        setTimeout(() => { if (copyButton) copyButton.textContent = originalText; }, 1200);
      } catch (error) {
        window.alert('复制失败：' + (error && error.message ? error.message : error));
      }
    };
  }
  const fullBtn = document.getElementById('editFullNoteFromCheckButton');
  if (fullBtn) {
    fullBtn.style.display = '';
    fullBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAddCheck();
      setEditMode(true);
    };
  }
  if (inp) {
    inp.value = src;
    inp.placeholder = '编辑此区块的 Markdown 原文…';
    setTimeout(() => inp.focus(), 0);
  }
};
async function confirmAddCheck() {
  const inp = document.getElementById('addCheckInput');
  if (!inp) { closeAddCheck(); return; }
  if (noteBlockEditTarget) {
    if (addCheckSavePending) return;
    const target = noteBlockEditTarget;
    const blockText = inp.value.replace(/\r\n/g, '\n');
    const notes = eventNotesForKey(target.uid);
    if (notes == null) { window.alert('找不到该行程，无法保存区块'); return; }
    const lines = notes.split('\n');
    if (target.start < 0 || target.end >= lines.length) {
      window.alert('该区块内容已变化，请刷新便利贴后重试'); return;
    }
    const span = target.end - target.start + 1;
    if (!blockText.trim()) {
      if (!window.confirm('区块内容为空＝删除该区块。\n\n确定要删除吗？删除后将直接写回并存档，无法从本窗口恢复（可先按「复制」留存原文）。')) return;
      lines.splice(target.start, span);
      if (await saveStickyNoteContent(lines.join('\n'), '删除区块', target.uid)) closeEditNoteCheck();
      return;
    }
    const newLines = blockText.split('\n');
    lines.splice(target.start, span, ...newLines);
    // 更新区间为新区块，便于继续 ⌘S 覆写同一段
    noteBlockEditTarget = { uid: target.uid, start: target.start, end: target.start + newLines.length - 1, type: target.type };
    if (await saveStickyNoteContent(lines.join('\n'), '保存区块', target.uid)) showStickyRefreshFeedback('已保存（按 Esc 关闭）');
    return;
  }
  if (noteCheckEditTarget) {
    if (addCheckSavePending) return;
    const target = noteCheckEditTarget;
    const text = inp.value.replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
    // 🆕 内容清空＝删除该子事件：必须先经使用者确认（拒绝则留在编辑框，可先「复制」留存原文）
    if (!text && !window.confirm('子事件内容为空＝删除该子事件。\n\n确定要删除吗？删除后将直接写回并存档，无法从本窗口恢复（可先按「复制」留存原文）。')) return;
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
    if (!text) {
      // 🆕 空内容＝删除：移除该行后写回并存档（上方 confirm 已获使用者同意）
      lines.splice(target.line, 1);
      if (await saveStickyNoteContent(lines.join('\n'), '删除子事件', target.uid)) closeEditNoteCheck();
      return;
    }
    // 🆕 原文保真：编辑框已是完整原文（含 [[]] 标记），保存时直接写回，不再额外补/删标记
    lines[target.line] = match[1] + '- [' + match[2] + '] ' + text;
    // 🆕 编辑模式：⌘S／「保存」＝只落盘不离开视窗（离开视窗只用 Esc）
    if (await saveStickyNoteContent(lines.join('\n'), '保存子事件', target.uid)) showStickyRefreshFeedback('已保存（按 Esc 关闭）');
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

// ===== 🆕 便利贴「发邮件」：菜单 📧 → 收件人浮层 → 主进程转邮件插件 sendEmailByPlugin =====
// 正文用便利贴当前渲染的 HTML（与画面看到的一致）；主题取行程标题。
// 分体 / 翻页模式通用：KEY 始终指向「当前这张」（翻页时 renderFlipPage 已重写 KEY）。
function currentStickyEvent() {
  return parseEvents(readMd()).find(e => e.key === KEY) || null;
}
function buildStickyEmailPayload(ev) {
  // 标题优先取画面渲染后的纯文本（# 前缀、[[链接]]、<MARK> 等都已处理好），
  // 拿不到再退回 parseEvents 的原始 title（可能是 '# 如何让[[中信金]]…' 这种 markdown 源码）
  const titleEl = document.getElementById('title');
  const renderedTitle = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const title = renderedTitle
    || (ev && ev.title ? String(ev.title) : '').replace(/\s+/g, ' ').trim()
    || '(未命名便利贴)';
  const metaBits = [];
  if (ev && ev.date) {
    metaBits.push('📅 ' + ev.date + (ev.endDate && ev.endDate !== ev.date ? ' – ' + ev.endDate : ''));
  }
  if (ev && ev.done) metaBits.push('✅ 已完成');
  const tagLabels = ((ev && ev.tags) || []).map(tagLabelOf).filter(Boolean);
  if (tagLabels.length) metaBits.push('🏷️ ' + tagLabels.map(t => '#' + t).join(' '));
  const header = '<div style="background:#f8fafc;border-left:4px solid #667eea;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;">'
    + '<div style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:6px;">便利贴</div>'
    + (metaBits.length
        ? '<div style="font-size:12px;color:#475569;line-height:1.8;">' + metaBits.map(escapeHtml).join('<br>') + '</div>'
        : '')
    + '</div>';
  // 正文优先取当前渲染结果（含表格 / checkbox / 清单）；拿不到时退回纯文本 notes
  const bodyEl = document.getElementById('body');
  let bodyHtml = bodyEl ? bodyEl.innerHTML : '';
  if (!String(bodyHtml).trim() && ev && ev.notes) {
    bodyHtml = '<pre style="background:#f8fafc;padding:12px 16px;border-radius:8px;font-size:13px;line-height:1.6;color:#1e293b;white-space:pre-wrap;word-break:break-all;">'
      + escapeHtml(ev.notes) + '</pre>';
  }
  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;line-height:1.7;color:#1e293b;max-width:760px;">'
    + header
    + '<h3 style="margin:0 0 10px;font-size:15px;color:#1e293b;">' + escapeHtml(title) + '</h3>'
    + bodyHtml
    + '</div>';
  return { subject: '[便利贴] ' + title, body: html };
}
// 🆕 收件人历史：从主进程读取 / 追加（去重、限制数量、统一小写由主进程维护）
async function loadStickyEmailRecipients() {
  try { return await ipcRenderer.invoke('email-recipients-get') || []; } catch (e) { return []; }
}
async function addStickyEmailRecipients(recipients) {
  try { await ipcRenderer.invoke('email-recipients-add', recipients); } catch (e) {}
}
// 🆕 收件人下拉：按当前正在输入的 token 过滤历史；点选后替换该 token
async function renderEmailRecipientDropdown() {
  const input = document.getElementById('emailRecipientInput');
  const dropdown = document.getElementById('emailRecipientDropdown');
  if (!input || !dropdown) return;
  const all = await loadStickyEmailRecipients();
  const raw = input.value || '';
  const parts = raw.split(/[,，;]/);
  const currentToken = (parts[parts.length - 1] || '').trim().toLowerCase();
  const matchesToken = (email) => {
    const e = email.toLowerCase();
    if (!currentToken) return true;
    if (e.startsWith(currentToken)) return true;
    const local = e.split('@')[0] || '';
    if (local.startsWith(currentToken)) return true;
    if (currentToken.length >= 2) {
      const words = e.split(/[@.\-_]+/);
      if (words.some(w => w.startsWith(currentToken))) return true;
    }
    return false;
  };
  const items = currentToken ? all.filter(matchesToken) : all.slice();
  dropdown.innerHTML = '';
  if (!items.length) {
    dropdown.innerHTML = '<div class="erd-empty">' + (all.length ? '无匹配收件人' : '暂无历史收件人') + '</div>';
    return;
  }
  items.forEach((email) => {
    const div = document.createElement('div');
    div.className = 'erd-item';
    div.textContent = email;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      insertEmailRecipient(email);
      renderEmailRecipientDropdown();
    });
    dropdown.appendChild(div);
  });
}
function insertEmailRecipient(email) {
  const input = document.getElementById('emailRecipientInput');
  if (!input) return;
  const parts = (input.value || '').split(/[,，;]/);
  parts.pop();
  const kept = parts.map(s => s.trim()).filter(Boolean);
  kept.push(email);
  input.value = kept.join(', ');
  setTimeout(() => { input.focus(); const len = input.value.length; input.setSelectionRange(len, len); }, 0);
}
async function showEmailRecipientDropdown() { const d = document.getElementById('emailRecipientDropdown'); if (d) { await renderEmailRecipientDropdown(); d.classList.add('show'); } }
function hideEmailRecipientDropdown() { const d = document.getElementById('emailRecipientDropdown'); if (d) d.classList.remove('show'); }
function openStickyEmailDialog() {
  const ov = document.getElementById('emailOv');
  const input = document.getElementById('emailRecipientInput');
  if (!ov || !input) return;
  const ev = currentStickyEvent();
  const titleEl = document.getElementById('emailNoteTitle');
  if (titleEl) {
    titleEl.textContent = ev && ev.title
      ? '便利贴：' + String(ev.title).replace(/\s+/g, ' ').trim()
      : '(找不到该便利贴)';
  }
  input.value = '';
  ov.classList.add('show');
  input.focus();
  input.select();
  showEmailRecipientDropdown();
}
function closeStickyEmailDialog() {
  const ov = document.getElementById('emailOv');
  if (ov) ov.classList.remove('show');
  hideEmailRecipientDropdown();
}
async function sendStickyEmail() {
  const input = document.getElementById('emailRecipientInput');
  if (!input) return;
  const recipients = String(input.value || '').split(/[,，;]/).map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) {
    showStickyRefreshFeedback('请填写收件人邮箱', true);
    input.focus();
    return;
  }
  // 与邮件插件 UI 同一格式校验；有不合格项就留在浮层里改，不直接丢给服务端
  const bad = recipients.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (bad.length) {
    showStickyRefreshFeedback('收件人格式不正确：' + bad.join('、'), true);
    input.focus();
    return;
  }
  const ev = currentStickyEvent();
  if (!ev) {
    showStickyRefreshFeedback('找不到该便利贴，无法发送', true);
    return;
  }
  const { subject, body } = buildStickyEmailPayload(ev);
  closeStickyEmailDialog();
  showStickyRefreshFeedback('📧 正在发送邮件…');
  try {
    // 主进程负责找到邮件插件 webview 并调 window.sendEmailByPlugin（见 windows.js）
    const result = await ipcRenderer.invoke('sticky-note-send-email', { recipients, subject, body });
    if (result && result.success) {
      showStickyRefreshFeedback('📧 邮件已发送给 ' + recipients.join(', '));
      await addStickyEmailRecipients(recipients);
    } else {
      showStickyRefreshFeedback('📧 邮件发送失败：' + ((result && result.message) || '未知错误'), true);
    }
  } catch (error) {
    console.error('[StickyNote] 发送邮件失败:', error);
    showStickyRefreshFeedback('📧 邮件发送失败：' + ((error && error.message) || error), true);
  }
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
  const note = document.getElementById('note');
  if (!menu && !note) return;
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
  const surfaceCss = rgbCss(surface);
  // --menu-bg 同时挂到 #note（#menu 的祖先）：术语胶囊（位于 #body 内）与刷新反馈浮层才能继承到
  // 这套与便利贴底色协调、且与字色保证 ≥4.5 对比的配色（原本只设在 #menu，胶囊取不到）。
  if (note) note.style.setProperty('--menu-bg', surfaceCss);
  if (menu) {
    menu.style.setProperty('--menu-bg', surfaceCss);
    menu.style.setProperty('--menu-muted', rgbCss(blendRgb(text, surface, 0.2)));
    menu.style.setProperty('--menu-divider', rgbCss(blendRgb(text, surface, 0.72)));
    menu.style.setProperty('--menu-status-open', relativeLuminance(surface) < 0.25 ? '#4ade80' : '#15803d');
  }
}

function applyColor() {
  const hex = tint(state.color, state.opacity);
  document.getElementById('note').style.background = hex;
  document.getElementById('bar').style.background = state.color;
  // ＋☐ 浮层盒与便利贴同背景色（取实色 tint(…,100)，不随透明度变淡，保证浮层可读）；文字色经 --note-fg 继承
  const acBox = document.getElementById('addCheckBox');
  if (acBox) acBox.style.background = tint(state.color, 100);
  // 📧 发邮件浮层盒同理（与 ＋☐ 浮层共用 addcheck-box 样式）
  const emailBox = document.getElementById('emailBox');
  if (emailBox) emailBox.style.background = tint(state.color, 100);
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
  // 🆕 加入/编辑子事件编辑框（.addcheck-box textarea）字号与便利贴正文一致（打开时即同步，缩放时实时跟随）
  const addCheckInput = document.getElementById('addCheckInput');
  if (addCheckInput) addCheckInput.style.fontSize = fontSize;
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
  const listTitle = document.getElementById('mStickyListTitle');
  if (!wrap || !list || !listTitle) return;
  const requestSeq = ++stickyMenuLoadSeq;
  try {
    const result = await ipcRenderer.invoke('sticky-note-order');
    if (requestSeq !== stickyMenuLoadSeq) return;
    const mode = result && result.mode;
    const allNotes = result && Array.isArray(result.notes) ? result.notes : [];
    const pageNotes = result && Array.isArray(result.order) ? result.order : allNotes.filter(note => note.isOpen);
    const inactiveNotes = mode === 'flip' ? allNotes.filter(note => !note.isOpen) : [];
    const notes = mode === 'flip' ? pageNotes : allNotes;
    listTitle.textContent = mode === 'flip'
      ? '翻页清单（' + pageNotes.length + ' 项；点击名称显示，点开 / 关切换）'
      : '已设定的便利贴（点击名称显示；点击开 / 关切换）';
    list.replaceChildren();
    const appendNoteRow = (item, index) => {
      const row = document.createElement('div');
      row.className = 'm-sticky-item';
      const name = String(item.title || item.key || '未命名便利贴').replace(/\s+/g, ' ').trim();
      const label = (name || '未命名便利贴') + ((+item.idx || 0) > 0 ? ' (' + ((+item.idx || 0) + 1) + ')' : '');
      const indexEl = document.createElement('span');
      indexEl.className = 'm-sticky-item-index';
      indexEl.textContent = index === null ? '' : String(index + 1) + '.';
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
    };
    notes.forEach(appendNoteRow);
    if (inactiveNotes.length) {
      const inactiveTitle = document.createElement('div');
      inactiveTitle.className = 'm-sticky-list-inactive-title';
      inactiveTitle.textContent = '未开启（不计入翻页）';
      list.appendChild(inactiveTitle);
      inactiveNotes.forEach(item => appendNoteRow(item, null));
    }
    wrap.classList.toggle('open', notes.length > 0 || inactiveNotes.length > 0);
  } catch (error) {
    if (requestSeq !== stickyMenuLoadSeq) return;
    console.error('[StickyNote] 读取便利贴清单失败:', error);
    wrap.classList.remove('open');
  }
}

// 渲染第 i 张：切换 KEY/IDX（内容＋颜色/透明度按该便利贴自身状态），翻页窗几何保持不变
async function renderFlipPage(i) {
  if (flipTotal === 0) return;
  i = ((i % flipTotal) + flipTotal) % flipTotal; // 循环换页：越界自动首尾回绕（首⇄尾）
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
  showFlipPageToast('第 ' + (flipIndex + 1) + ' / ' + flipTotal + ' 张');
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
  // 循环换页：首尾相连，左右边把手在「多于 1 张」时始终可点；仅 1 张则不显示
  const cyclic = flipTotal > 1;
  const prevPage = cyclic ? ((flipIndex - 1 + flipTotal) % flipTotal) + 1 : 0;
  const nextPage = cyclic ? ((flipIndex + 1) % flipTotal) + 1 : 0;
  prev.title = '前一笔 · 第 ' + prevPage + ' / ' + flipTotal + ' 张（循环）';
  next.title = '后一笔 · 第 ' + nextPage + ' / ' + flipTotal + ' 张（循环）';
  prev.classList.toggle('visible', cyclic && nearLeft);
  next.classList.toggle('visible', cyclic && nearRight);
}

// 翻页页次讯息框：画面正中央、透明度 70%、约 2cm 大字、1 秒自动关闭（连翻时重置计时）
let flipPageToastTimer = null;
function showFlipPageToast(text) {
  const el = document.getElementById('flipPageToast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  if (flipPageToastTimer) clearTimeout(flipPageToastTimer);
  flipPageToastTimer = setTimeout(() => { el.classList.remove('show'); }, 1000);
}

function bindFlipNav() {
  const note = document.getElementById('note');
  const prevEdge = document.getElementById('flipPrevEdge');
  const nextEdge = document.getElementById('flipNextEdge');
  if (note) {
    // 翻页左右边的显隐统一交由 setupControls 的「边框带」逻辑驱动（含进入即显 / 自动隐藏），
    // 这里只同步指针横坐标，避免每次移动都重显而破坏自动隐藏语义
    note.addEventListener('pointermove', (e) => {
      flipPointerX = e.clientX;
    });
    note.addEventListener('pointerleave', () => {
      flipPointerX = null;
    });
  }
  if (prevEdge) prevEdge.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex - 1); armEdgeHandlesAutoHide(); };
  if (nextEdge) nextEdge.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex + 1); armEdgeHandlesAutoHide(); };
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