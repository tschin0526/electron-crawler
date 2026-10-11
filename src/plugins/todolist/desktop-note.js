// 单张桌面便利贴（每张一个 frameless 小窗口）
// 操作全部在本贴纸本体上：拖动移动 / 右下把手缩放 / ×关闭 / 🎨改背景色+透明度 / 📂唤起主程式 / 点击唤起主程式
'use strict';

const fs = require('fs');
const { ipcRenderer } = require('electron');

const PALETTE = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93', '#FFF3B0'];
// 内容字体颜色候选（首个 = 默认正文色 #33384a，兼作「恢复默认」）
const TEXT_PALETTE = ['#33384a', '#1f2430', '#4b5160', '#8E8E93', '#A2845E', '#007AFF', '#34C759', '#AF52DE', '#FF3B30', '#FF9500'];
const DEFAULT_W = 240, DEFAULT_H = 170, MIN_W = 140, MIN_H = 90;

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

function parseEvents(md) {
  if (!md) return [];
  const out = [];
  const blocks = String(md).split(/^##[ \t]*EVENT(?:\([^)]*\))?[ \t]*$/m);
  for (const b of blocks) {
    const cut = b.search(/^##[ \t]*HOLIDAY[ \t]*$/m);
    const blk = cut >= 0 ? b.slice(0, cut) : b;
    const get = (k) => { const m = blk.match(new RegExp('^- ' + k + ':\\s*`?([^`\\n]*)`?', 'm')); return m ? m[1].trim() : ''; };
    const title = get('title');
    if (!title) continue;
    let color = get('color').replace(/^"|"$/g, '');
    let tags = []; try { tags = JSON.parse(get('tags')) || []; } catch (e) { tags = []; }
    let notes = '';
    const rm = blk.match(/- Remark:\s*\n```\n([\s\S]*?)\n```/) || blk.match(/```\n([\s\S]*?)\n```/);
    if (rm) notes = rm[1];
    out.push({
      title, date: get('date'), color: color || '#FFCC00',
      tags: Array.isArray(tags) ? tags : [], notes, done: get('done') === 'true',
      key: title + '|' + get('date')
    });
  }
  return out;
}

const state = { w: DEFAULT_W, h: DEFAULT_H, color: '#FFCC00', opacity: 100, minimized: false, minH: 0, fontScale: 1, fontColor: '#33384a', fontWeight: 400 };

async function init() {
  if (IS_FLIP) { await initFlip(); return; }
  let inst = {};
  try { inst = (await ipcRenderer.invoke('sticky-note-get', { key: KEY, idx: IDX })) || {}; } catch (e) {}
  Object.assign(state, {
    w: (typeof inst.w === 'number' && inst.w > MIN_W) ? inst.w : DEFAULT_W,
    h: (typeof inst.h === 'number' && inst.h > MIN_H) ? inst.h : DEFAULT_H,
    color: inst.color || '#FFCC00',
    opacity: (typeof inst.opacity === 'number') ? inst.opacity : 100,
    minimized: !!inst.minimized,
    minH: (typeof inst.minH === 'number' && inst.minH > 20) ? inst.minH : 0,
    fontScale: (typeof inst.fontScale === 'number') ? inst.fontScale : 1,
    fontColor: (typeof inst.fontColor === 'string' && inst.fontColor) ? inst.fontColor : '#33384a',
    fontWeight: (typeof inst.fontWeight === 'number') ? inst.fontWeight : 400
  });

  let md = '';
  try { md = fs.readFileSync(FILE, 'utf8'); } catch (e) {}
  const ev = parseEvents(md).find(e => e.key === KEY);
  if (!ev) { document.getElementById('title').textContent = '(找不到该便利贴)'; applyColor(); return; }

  document.getElementById('meta').textContent = (ev.date || '') + (ev.done ? ' · 已完成' : '');
  document.getElementById('tags').innerHTML = (ev.tags || []).map(t => '<li>' + escapeHtml((t && t.name) ? t.name : t) + '</li>').join('');
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
  // 事件色作为默认底色（仅当用户未手动改过色时）
  if (!inst.color) state.color = ev.color;
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
  updateMinBtn();

  // 控件（分体/翻页共用：关闭/刷新/唤起主程式/最小化/改色/透明度/缩放 + 点击唤起主程式）
  setupControls();
}

// 右上角 ☰ 下拉菜单：收纳全部操作（翻页◀▶ / 刷新 / 打开 / 颜色·透明度 / 最小化 / 关闭）
function setupControls() {
  const menu = document.getElementById('menu');
  const btnMenu = document.getElementById('btnMenu');
  const closeMenu = () => { if (menu) menu.classList.remove('open'); };
  if (btnMenu) btnMenu.onclick = (e) => { e.stopPropagation(); if (menu) menu.classList.toggle('open'); };
  // 点击菜单与 ☰ 以外任意处（含便利贴本体）关闭菜单
  document.addEventListener('click', (e) => {
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target) || (btnMenu && btnMenu.contains(e.target))) return;
    closeMenu();
  }, true);
  document.getElementById('miClose').onclick = (e) => {
    e.stopPropagation();
    if (IS_FLIP) ipcRenderer.invoke('close-sticky-notes');          // 翻页模式：结束整个翻页会话
    else ipcRenderer.invoke('sticky-note-close', { key: KEY, idx: IDX });
  };
  document.getElementById('miRefresh').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.send('sticky-note-refresh-request', { key: KEY, idx: IDX }); };
  document.getElementById('miOpen').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('wake-main-from-note', { key: KEY }); };
  document.getElementById('miMin').onclick = (e) => { e.stopPropagation(); closeMenu(); toggleMinimize(); };
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
  syncTextAppearance();
  document.getElementById('menu').addEventListener('pointerdown', e => e.stopPropagation());
  document.getElementById('rz').addEventListener('pointerdown', startResize);
  // 拖动交给 OS 原生（CSS -webkit-app-region: drag）；这里只处理「点击（未拖动）唤起主程式」/ 双击跳转
  const note = document.getElementById('note');
  note.addEventListener('click', onNoteClick);
  note.addEventListener('dblclick', onNoteDblClick);
  if (IS_FLIP) bindFlipNav();
}

// 原生拖拽由 OS 处理；只有「按下后未移动、松开＝点击」才会触发此 handler
// （拖拽过程中 OS 不会派发 click），故可安全用它区分「点一下＝唤起主程式」
function onNoteClick(e) {
  if (e.target.closest('.iconbtn')) return;                   // 按钮各自处理
  if (!e.target.closest('.bar, .head, .meta, .tags')) return; // 仅拖拽区点击＝唤起主程式
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
}

// 双击便利贴（标题栏或正文）：唤起主程式并打开该事件表单
// 正文区是 -webkit-app-region: no-drag，双击不会触发拖动，故可安全复用「唤起+打开事件」管线
function onNoteDblClick(e) {
  if (e.target.closest('.iconbtn, .menu, .rz')) return; // 菜单/☰按钮/缩放把手各自处理
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
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
  if (ev) {
    document.getElementById('meta').textContent = (ev.date || '') + (ev.done ? ' · 已完成' : '');
    document.getElementById('tags').innerHTML = (ev.tags || []).map(t => '<li>' + escapeHtml((t && t.name) ? t.name : t) + '</li>').join('');
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

function applyColor() {
  const hex = tint(state.color, state.opacity);
  document.getElementById('note').style.background = hex;
  document.getElementById('bar').style.background = state.color;
}
function persist() {
  if (IS_FLIP) {
    // 几何（位置/尺寸/最小化）写翻页窗专用 id；颜色/透明度/字号按当前显示的便利贴自身状态写
    const g = geomId();
    ipcRenderer.invoke('sticky-note-set', { key: g.key, idx: g.idx, patch: { w: state.w, h: state.h, minimized: state.minimized, minH: state.minH } });
    ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { color: state.color, opacity: state.opacity, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight } });
    return;
  }
  ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { w: state.w, h: state.h, color: state.color, opacity: state.opacity, minimized: state.minimized, minH: state.minH, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight } });
}

// 内容字号/颜色/字重：以 12px 为基准按 fontScale 等比例缩放（heading 等均用 em，随基准同步放大/缩小）
function applyContentFont() {
  const body = document.getElementById('body');
  if (!body) return;
  body.style.fontSize = (12 * (state.fontScale || 1)).toFixed(2) + 'px';
  body.style.color = state.fontColor || '#33384a';
  body.style.fontWeight = state.fontWeight || 400;
}
// 同步「字体颜色 / 字重」选中态（菜单内色板 + 分段按钮）
function syncTextAppearance() {
  document.querySelectorAll('#textSwatches .sw').forEach(el => {
    el.classList.toggle('active', (el.getAttribute('data-color') || '') === (state.fontColor || '#33384a'));
  });
  document.querySelectorAll('#mCfg .m-wbtn').forEach(b => {
    b.classList.toggle('active', (+b.getAttribute('data-w') || 400) === (state.fontWeight || 400));
  });
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
function updateMinBtn() {
  const b = document.getElementById('miMin');
  if (!b) return;
  if (state.minimized) b.textContent = '▢ 还原（展开便利贴）';
  else b.textContent = '▁ 最小化（收合成小卡）';
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
  updateMinBtn();
  persist();
}

// （拖动已改为 OS 原生 -webkit-app-region: drag，无需 JS 逐帧移动）

// 右下把手缩放
let rz = null;
function startResize(e) {
  e.stopPropagation(); e.preventDefault();
  rz = { sx: e.clientX, sy: e.clientY, w: state.w, h: state.h };
  window.addEventListener('pointermove', onResize);
  window.addEventListener('pointerup', endResize, { once: true });
}
function onResize(e) {
  if (!rz) return;
  state.w = Math.max(MIN_W, rz.w + (e.clientX - rz.sx));
  state.h = Math.max(MIN_H, rz.h + (e.clientY - rz.sy));
  const g = geomId();
  ipcRenderer.invoke('sticky-note-bounds', { key: g.key, idx: g.idx, width: state.w, height: state.h });
}
function endResize() { window.removeEventListener('pointermove', onResize); if (rz) { persist(); rz = null; } }

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
  bindFlipNav();
  if (flipTotal === 0) {
    document.getElementById('title').textContent = '(没有便利贴)';
    document.getElementById('meta').textContent = '';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('body').innerHTML = '';
    updateFlipInd();
    return;
  }
  if (state.minimized) {
    document.getElementById('note').classList.add('minimized');
    const ch = collapsedH() || state.minH || 90;
    if (ch > 0) ipcRenderer.invoke('sticky-note-bounds', { key: FLIP_KEY, idx: FLIP_IDX, width: state.w, height: ch });
  }
  updateMinBtn();
  await renderFlipPage(0);
}

// 渲染第 i 张：切换 KEY/IDX（内容＋颜色/透明度按该便利贴自身状态），翻页窗几何保持不变
async function renderFlipPage(i) {
  if (flipTotal === 0) return;
  i = Math.max(0, Math.min(flipTotal - 1, i));
  flipIndex = i;
  KEY = flipOrder[i].key;
  IDX = +flipOrder[i].idx || 0;
  const ev = parseEvents(readMd()).find(e => e.key === KEY);
  if (!ev) {
    document.getElementById('title').textContent = '(找不到该便利贴)';
    document.getElementById('meta').textContent = '';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('body').innerHTML = '';
    updateFlipInd();
    return;
  }
  // 颜色/透明度/字号：优先用该便利贴自身已存状态，否则退回事件色
  const inst = (await ipcRenderer.invoke('sticky-note-get', { key: KEY, idx: IDX })) || {};
  state.color = (inst && inst.color) ? inst.color : ev.color;
  state.opacity = (inst && typeof inst.opacity === 'number') ? inst.opacity : 100;
  state.fontScale = (inst && typeof inst.fontScale === 'number') ? inst.fontScale : 1;
  state.fontColor = (inst && typeof inst.fontColor === 'string' && inst.fontColor) ? inst.fontColor : '#33384a';
  state.fontWeight = (inst && typeof inst.fontWeight === 'number') ? inst.fontWeight : 400;

  document.getElementById('meta').textContent = (ev.date || '') + (ev.done ? ' · 已完成' : '');
  document.getElementById('tags').innerHTML = (ev.tags || []).map(t => '<li>' + escapeHtml((t && t.name) ? t.name : t) + '</li>').join('');
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
  applyColor();
  applyContentFont();
  syncTextAppearance();
  // 透明度面板同步到当前便利贴自身状态
  const op = document.getElementById('opacity');
  if (op) { op.value = String(state.opacity); document.getElementById('opacityVal').textContent = state.opacity + '%'; }
  updateZoomInd();
  updateFlipInd();
}

function updateFlipInd() {
  const el = document.getElementById('flipInd');
  if (el) el.textContent = flipTotal ? ((flipIndex + 1) + ' / ' + flipTotal) : '0 / 0';
  const prev = document.getElementById('miPrev');
  const next = document.getElementById('miNext');
  if (prev) prev.disabled = flipIndex <= 0;
  if (next) next.disabled = flipIndex >= flipTotal - 1;
}

function bindFlipNav() {
  const prev = document.getElementById('miPrev');
  const next = document.getElementById('miNext');
  if (prev) prev.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex - 1); };
  if (next) next.onclick = (e) => { e.stopPropagation(); renderFlipPage(flipIndex + 1); };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); renderFlipPage(flipIndex - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); renderFlipPage(flipIndex + 1); }
  });
}

init();