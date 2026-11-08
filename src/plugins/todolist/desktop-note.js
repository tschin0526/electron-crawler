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
// 🆕 开窗瞬间（initFlip 还在等 sticky-note-order、flipTotal 仍是 0）就收到的跳页请求先存这里，
//    等权威顺序回来再消费；否则「便利贴原本没开 → 主窗按徽标开启并跳页」会整包丢掉。
let pendingShowPage = null;
// 🆕 主窗右击某笔小事件(群)后「跳转到便利贴」顺带要滚动定位+闪烁的目标单元描述。
//   翻页模式由 sticky-note-show-page 的 payload.focusUnit 写入；分体模式由独立 IPC sticky-note-focus-unit 写入。
let pendingFocusUnit = null;
let noteRendered = false;   // 正文是否已渲染过（用于判断 focus-unit 早到时要不要立刻消费）
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
// 🆕 定位開關：當前便利貼窗的定位詞（空字串＝不高亮）。由本窗 ☰ 菜單的 combo 搜尋框（menuOnSearchInput/menuToggleLocate）驅動；
//    刷新/翻頁只重打高亮、不改這個值（故換張或同步後高亮仍在）。
let NOTE_HL = '';
function geomId() { return IS_FLIP ? { key: FLIP_KEY, idx: FLIP_IDX } : { key: KEY, idx: IDX }; }

let marked = null;
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// 渲染便利贴标题：把标题内容包进 .tt（no-drag）小「洞」，并把单段落 tooltip 挂到 .tt 上。
// 关键：macOS 上 drag 区不响应 :hover/任何指针事件，故仅「文字本身」设为 no-drag——
// tooltip 只在文字上出现（范围最小，符合「悬停测试专用这几字才显示」），
// 标题栏其余空白/色条/.meta/.tags 仍是 drag，拖动照常（只牺牲「抓在文字正上方」发起拖拽）。
function setStickyTitle(titleEl, htmlOrNull, text, tip) {
  titleEl.textContent = '';
  const span = document.createElement('span');
  span.className = 'tt';
  if (tip) span.setAttribute('data-tip', tip);   // setAttribute 自动处理引号，无需手动 escape
  if (htmlOrNull) span.innerHTML = htmlOrNull;     // 主窗口渲染好的 HTML（受信任）
  else span.textContent = (text == null ? '' : String(text));
  titleEl.appendChild(span);
}
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
      spanDisplay: get('spanDisplay') || '',   // 🆕 显示方式（显示在今天 → meta 行改固定字样）
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
// 🆕 2026-11-08：显示方式＝「显示在今天」时，真实日期区间已锚定到今天、不该再显示，
//    改显示固定字样「显示在今天」（与主程式 tlItemHtml / LITE evItemHtml 同口径）。
const NOTE_SPAN_TODAY_TEXT = '显示在今天';
function metaDateText(ev) {
  if (ev && ev.spanDisplay === 'today') return NOTE_SPAN_TODAY_TEXT;
  const d = (ev && ev.date) || '';
  const e = (ev && ev.endDate && ev.endDate !== ev.date) ? ev.endDate : '';
  if (d && e) return d + ' – ' + e + ' · 共' + spanDays(d, e) + '天';
  return d || e || '';
}
// 🆕 VIEW 便利贴（投影贴）：主程式把「全部行程里符合某个条件的行」汇总成这种合成贴。
//   两种来源：🔔 提醒（key＝__view__，条件写死抓 [[remind:]]）＋ 使用者自订规则（key＝__view__:<规则 id>，
//   条件＝关键词／标记／行型态，见 view-sticky-rules.js）。对本窗体而言它们是同一种东西。
//   它只是投影 → 一切「异动资料」的入口都要收起来（＋☐／编辑把手／编辑小圆点／删除／搬移／滚动定位），
//   浏览功能（渲染、☰ 清单、翻页、搜索定位、样式、最小化、缩放、右键 复制／找出相同）与普通便利贴一致。
//   ⚠️ 翻页窗的 KEY 会随页次变，所以「是不是 VIEW 贴」必须即时读 KEY，不能像 MODE 那样在载入时定值。
//   ⚠️ 前缀判断：自订贴的 key 带规则 id，这里写成等值比较＝新贴当成可编辑的普通贴（会写坏 calendar.md）。
const VIEW_KEY = '__view__';
function isViewKey(key) { const s = String(key == null ? '' : key); return s === VIEW_KEY || s.indexOf(VIEW_KEY + ':') === 0; }
function isViewNote() { return isViewKey(KEY); }
// 把「只读」状态同步到 DOM（CSS 靠 #note.view-note 隐藏把手与菜单项）
function syncViewNoteMode() {
  const noteEl = document.getElementById('note');
  if (noteEl) noteEl.classList.toggle('view-note', isViewNote());
}
// meta 行统一渲染：日期（跨天含结束日期与总天数 ·已完成）在前，右侧接「完成/总数」胶囊、「＋☐」加入子事件与「☐/☑」只看未完成筛选按钮
function undoneFilterChipHtml() {
  const on = !!state.undoneChecksOnly;
  return '<button type="button" class="note-undone-filter' + (on ? ' active' : '') + '"' +
    ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
    ' title="' + (on ? '仅显示未完成的 checkbox 子事件（点击显示全部）' : '只显示未完成的 checkbox 子事件') + '">' +
    (on ? '☑' : '☐') + '</button>';
}
function renderMeta(ev) {
  const dateText = escapeHtml(metaDateText(ev) + (ev.done ? ' · 已完成' : ''));
  document.getElementById('meta').innerHTML = dateText + subProgressBadge(ev) +
    // 🆕 VIEW 贴只读：不给「＋☐ 加入内容」，只留「只看未完成」这颗纯显示开关
    (isViewNote() ? '' :
      '<button type="button" class="note-addcheck" title="加入…（checkbox 子事件／MD 表格／自由编辑）" aria-haspopup="menu">＋☐▾</button>') +
    undoneFilterChipHtml() +
    (isViewNote() ? viewSortSelectHtml() : '');
  wireViewSortSelect();
}
// 🆕 VIEW 便利贴：行事件排序下拉（原序／升幂／降幂），紧跟「只看未完成」徽标按钮
function viewSortSelectHtml() {
  return '<select id="miViewSort" class="note-sort-select" title="排序：行事件按「建立日 cr 与完成日 cp 中较晚者」（两者都没有则用事件日期）。升幂/降幂＝组内按小事件日期、组间按组内最大日期">' +
    '<option value="orig">原序</option><option value="asc">升幂</option><option value="desc">降幂</option></select>';
}
function wireViewSortSelect() {
  const sel = document.getElementById('miViewSort');
  if (!sel) return;
  sel.value = state.sortMode || 'orig';
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', (e) => {
    e.stopPropagation();
    const v = sel.value;
    if (v !== 'orig' && v !== 'asc' && v !== 'desc') return;
    if (v === state.sortMode) return;
    state.sortMode = v;
    persist();
    applyViewSort();
  });
}
// 🆕 VIEW 便利贴排序：小事件排序键＝自身「建立日 cr 与完成日 cp 中较晚者」
//   （同一单元有多个标记时取全部 cr/cp 里最晚的那个；两者都没有才退来源事件日期 → data-sort-date）。
//   组（来源行程）排序键＝组内「最大单元日期」（组内完全没有标记日期才退事件日期 → data-group-date）。
//   原序＝还原重绘后的原始 DOM 顺序；升幂＝早的在上；降幂＝晚的在上；缺日期升幂置顶、降幂置底。
//   ⚠️ data-sort-date / data-unit-date / data-group-date 统一由 normalizeViewSortUnits() 在「本窗重绘后」
//      从渲染出的 🆕／✅ 日期写入；主窗 view-sticky-rules.js 下发的 data-cr-date 只是旧口径的兼容回退。
function isViewSortUnit(el) { return el && el.nodeType === 1 && el.classList.contains('vsr-sort-unit'); }
// 🆕 排序键的「单一可信来源」＝便利贴窗里实际渲染出来的 🆕 建立日／✅ 完成日，而不是主窗口下发的 data-* 属性。
//   原因：view-sticky-rules.js 由「主窗口」加载，生成的 HTML 经主进程 stickyNoteHtml Map 缓存后下发；
//   只 Cmd+R 刷新便利贴窗（甚至只重开便利贴窗）拿到的仍是旧 HTML（没有 .vsr-sort-unit / data-sort-date），
//   排序会全部当空日期 → 稳定排序保持原序 → 看起来「降幂没生效」。故窗内自行从 DOM 归一化，
//   无论主窗／主进程是否已重载都能正确排序（旧 HTML 结构：.md-unit / .ev-md-check 直接子元素）。
// 🆕 cr / cp 标记与可见徽标共用同一条规则：取「所有日期里最晚的一个」（YYYY-MM-DD 字典序＝时间序）。
//   一个单元可能是多行 {gp} 小事件群（cr 整组只有 1 个、每行各有自己的 cp），故用 g 正则扫全部而非 match 第一个。
// 🆕 2026-11-08：新写入的 cr/cp 为 [[cr:YYYY-MM-DD HH:mm]]（本机 24H、无秒）。
//   排序比较一律先正规化成 "YYYY-MM-DD HH:mm"：旧标记没有时间 → 视当天 00:00；
//   ⛔ 绝不拿原始字串直接比（'2026-11-08' 字典序会小于 '2026-11-08 00:00'，同日新旧资料会错位）。
//   对外回传的仍是「原始最晚标记值」（旧资料维持纯日期、新资料带时间），既有 data-* 断言零回归。
function viewSortKey(s) {
  const m = String(s == null ? '' : s).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  return m ? m[1] + ' ' + (m[2] || '00:00') : '';
}
function viewLatestMarkerDate(s) {
  let best = '', bestKey = '';
  const re = /\[\[(?:cr|cp):(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\]\]/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const raw = m[1] + (m[2] ? ' ' + m[2] : '');
    const key = viewSortKey(raw);
    if (!bestKey || key > bestKey) { bestKey = key; best = raw; }
  }
  return best;
}
function viewLatestVisibleDate(s) {
  let best = '', bestKey = '';
  const re = /(?:\u{1F195}|\u2705)\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/gu;   // 🆕 建立日 / ✅ 完成日；📅 预计完成不参与排序
  let m;
  while ((m = re.exec(String(s || '')))) {
    const raw = m[1] + (m[2] ? ' ' + m[2] : '');
    const key = viewSortKey(raw);
    if (!bestKey || key > bestKey) { bestKey = key; best = raw; }
  }
  return best;
}
function unitDateFromUnit(el) {
  // ① 编辑小圆点的 data-text 存原始行文本（最可靠，含 [[cr:…]] / [[cp:…]] 原文）
  const dot = el.querySelector && el.querySelector('.ev-md-edit[data-text]');
  if (dot) {
    const d = viewLatestMarkerDate(dot.getAttribute('data-text'));
    if (d) return d;
  }
  // ①b 🆕 2026-11-08：长徽标视觉只显示「MM-DD」，完整 date+time 存在 data-date；
  //     这里补一条读取路径，避免「没有编辑圆点」的单元因画面不显示完整日期而退化成纯日期排序。
  //     ⛔ dl（预计完成）不参与排序，与 viewLatestMarkerDate 口径一致。
  const marks = el.querySelectorAll && el.querySelectorAll('.ev-date-mark[data-date]');
  if (marks && marks.length) {
    let best = '', bestKey = '';
    Array.from(marks).forEach((mk) => {
      if (mk.classList && mk.classList.contains('ev-date-dl')) return;
      const raw = mk.getAttribute('data-date') || '';
      if (!raw) return;
      const k = viewSortKey(raw);
      if (!bestKey || k > bestKey) { bestKey = k; best = raw; }
    });
    if (best) return best;
  }
  // ② 渲染后的可见文字「🆕 YYYY-MM-DD」／「✅ YYYY-MM-DD」（旧 HTML 的纯文本兜底）
  const v = viewLatestVisibleDate(el.textContent);
  if (v) return v;
  // ③ HTML 里残留的字面标记（含属性里的 data-text 原文）
  const r = viewLatestMarkerDate(el.innerHTML);
  if (r) return r;
  // ④ 主窗下发值：新口径 data-unit-date；旧缓存 HTML 的 data-cr-date 仍可当回退（窗内会再覆盖成新值）
  return String(el.getAttribute('data-unit-date') || el.getAttribute('data-cr-date') || '');
}
function groupDateFromHead(head) {
  const d = head.getAttribute('data-group-date');
  if (d) return d;
  const m = String(head.textContent || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
// 把每个 .vsr-seg 的直接子元素归一化成可排序单元（新版 .vsr-sort-unit 原样保留；
// 旧版 .md-unit / .ev-md-check / 含两者的包裹层补上 vsr-sort-unit class 与排序键）。
// 只加 class 与 data-*，不改 DOM 层级 → 视觉零影响（.vsr-sort-unit 无 CSS 规则）。
function normalizeViewSortUnits() {
  document.querySelectorAll('#body .vsr-seg').forEach((seg) => {
    let groupDate = '';
    Array.from(seg.children).forEach((el) => {
      if (el.classList.contains('vsr-group-head')) {
        groupDate = groupDateFromHead(el);
        el.setAttribute('data-group-date', groupDate);
        return;
      }
      if (el.classList.contains('vsr-seg-hd')) return;   // 多段落的段落标题不是行事件
      const isUnit = el.classList.contains('vsr-sort-unit') ||
        el.classList.contains('md-unit') || el.classList.contains('ev-md-check') ||
        !!(el.querySelector && el.querySelector('.ev-md-check, .md-unit'));
      if (!isUnit) return;
      el.classList.add('vsr-sort-unit');
      const unitDate = unitDateFromUnit(el);
      el.setAttribute('data-unit-date', unitDate);
      el.setAttribute('data-sort-date', unitDate || groupDate || el.getAttribute('data-sort-date') || '');
    });
  });
}
function cmpViewDate(a, b, dir) {
  // 🆕 一律先正规化成 date+time 再比：旧纯日期＝当天 00:00，新格式＝实际 HH:mm，同日也能分先后。
  const av = viewSortKey(a), bv = viewSortKey(b);
  if (av === bv) return 0;
  if (av === '') return dir === 'asc' ? -1 : 1;
  if (bv === '') return dir === 'asc' ? 1 : -1;
  return dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
}
function viewGroupSortDate(head, itemEls) {
  // 组排序键＝组内「最大单元日期」（每个单元已是 cr/cp 较晚者）；组内完全没有标记日期才退回事件日期。
  // （用 data-unit-date 区隔「有标记日期」与「无标记、data-sort-date 退化为事件日期」两种情形，
  //   避免「所有标记日期都早于事件日期」时被误用事件日期覆盖。）
  // 🆕 组内取最大值也要用 date+time 正规化比较，否则同日 09:00／16:00 会只看日期而误判。
  const gd = head.getAttribute('data-group-date') || '';
  let maxDate = '', maxKey = '', hasDate = false;
  itemEls.forEach((it) => {
    const d = it.getAttribute('data-unit-date') || '';
    if (!d) return;
    hasDate = true;
    const k = viewSortKey(d);
    if (!maxKey || k > maxKey) { maxKey = k; maxDate = d; }
  });
  return hasDate ? maxDate : gd;
}
function viewSortContainer(container, dir) {
  if (!container) return;
  // 收集「单元」：vsr-group-head 起一组（其后连续的 vsr-sort-unit 为子事件），其余元素原样保留
  const tokens = [];
  let cur = null;
  Array.from(container.children).forEach((el) => {
    if (el.classList.contains('vsr-group-head')) {
      if (cur) tokens.push(cur);
      cur = { type: 'group', head: el, items: [], gi: tokens.length };
    } else if (isViewSortUnit(el)) {
      const unit = { el: el, ui: 0 };
      if (cur) { unit.ui = cur.items.length; cur.items.push(unit); }
      else tokens.push({ type: 'unit', unit: unit });
    } else {
      tokens.push({ type: 'other', el: el });
    }
  });
  if (cur) tokens.push(cur);
  if (dir === 'orig') {
    const orig = container.__origChildren || Array.from(container.children);
    orig.forEach((c) => container.appendChild(c));
    return;
  }
  // 组内小事件排序（稳定：同日期保原序）
  tokens.forEach((t) => {
    if (t.type !== 'group') return;
    t.items.forEach((u, i) => { u.ui2 = i; });
    t.items.sort((a, b) => {
      const r = cmpViewDate(a.el.getAttribute('data-sort-date'), b.el.getAttribute('data-sort-date'), dir);
      return r === 0 ? a.ui2 - b.ui2 : r;
    });
    t.sortDate = viewGroupSortDate(t.head, t.items.map((u) => u.el));
  });
  // 组间排序（稳定）
  const groups = tokens.filter((t) => t.type === 'group');
  groups.sort((a, b) => {
    const r = cmpViewDate(a.sortDate, b.sortDate, dir);
    return r === 0 ? a.gi - b.gi : r;
  });
  // 重排 DOM：把「组 token」按排序后的组顺序回填（其余 other/unit 保持原相对位置），只移动节点不重建
  let gk = 0;
  const ordered = tokens.map((t) => (t.type === 'group' ? groups[gk++] : t));
  ordered.forEach((t) => {
    if (t.type === 'group') {
      container.appendChild(t.head);
      t.items.forEach((u) => container.appendChild(u.el));
    } else if (t.type === 'unit') {
      container.appendChild(t.unit.el);
    } else {
      container.appendChild(t.el);
    }
  });
}
function captureViewSortOriginal() {
  document.querySelectorAll('#body .vsr-seg').forEach((seg) => { seg.__origChildren = Array.from(seg.children); });
}
function applyViewSort() {
  if (!isViewNote()) return;
  const dir = (state.sortMode === 'asc' || state.sortMode === 'desc') ? state.sortMode : 'orig';
  document.querySelectorAll('#body .vsr-seg').forEach((seg) => viewSortContainer(seg, dir));
}
// 🆕 重绘后的统一入口：**只在 innerHTML 重绘完成后**呼叫（已收口在 refreshNoteViewDisplay 末尾，
//   覆盖初始渲染／主进程推送刷新／applyNoteContent／翻页共 4 条路径）。
//   ⚠️ 排序模式切换（下拉 change）只走 applyViewSort()，绝不重新 capture，
//   否则会把「已排序」的顺序误当成原序基线。
function applyViewSortAfterRender() {
  if (!isViewNote()) return;
  normalizeViewNoteMarkers();   // 先补标记转换 → 排序键的「可见文字」来源才会是 🆕 日期
  normalizeViewSortUnits();
  captureViewSortOriginal();
  applyViewSort();
}
// 🆕 VIEW 投影贴的标记兜底：主窗引擎（view-sticky-rules.js）生成的 HTML 经主进程缓存下发，
//   只刷新便利贴窗拿到的仍是旧 HTML —— 非 checkbox 单元会把 [[cr:…]] 显示为原文。
//   这里在重绘后把「残留的字面标记」补成与母本 tlRenderNoteMarkers 相同的 🆕/📅/✅ 显示。
//   ⚠️ 绝不碰属性（编辑圆点的 data-text 存原文，是排序／找出相同的依据）；跳过 code/pre。
//      主窗引擎修好后本函数自然变成 no-op（幂等：已转过的徽标里不再有 [[...]] 字面标记）。
//   🆕 2026-11-08：跟母本同步改成「一颗长徽标」＝圖示＋月-日（小字），完整日期+時間放
//      title（hover tooltip）與 data-date（VIEW 排序讀取）；故這裡改成插入 DOM 元素，不再純改文字。
function noteDateMarkElement(icon, kind, full) {
  const label = { cr: '建立日', dl: '预计完成', cp: '完成日' }[kind];
  const span = document.createElement('span');
  span.className = 'ev-date-mark ev-date-' + kind;
  span.setAttribute('title', label + ' ' + full);
  span.setAttribute('data-date', full);
  span.appendChild(document.createTextNode(icon + ' '));
  const md = document.createElement('span');
  md.className = 'ev-date-mark-md';
  md.textContent = full.slice(5, 10);           // YYYY-MM-DD → MM-DD（不顯示年／時間）
  span.appendChild(md);
  return span;
}
function normalizeViewNoteMarkers() {
  const body = document.getElementById('body');
  if (!body || !body.querySelector) return;
  const skipTags = /^(CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/;
  const SHOW_TEXT = (typeof NodeFilter !== 'undefined') ? NodeFilter.SHOW_TEXT : 4; // 4＝NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(body, SHOW_TEXT, null);
  const targets = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.nodeValue || n.nodeValue.indexOf('[[') < 0) continue;
    let p = n.parentNode, skip = false;
    while (p && p !== body) {
      if (p.nodeType === 1 && skipTags.test(p.tagName)) { skip = true; break; }
      p = p.parentNode;
    }
    if (!skip) targets.push(n);
  }
  const markRe = /\[\[cr:(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\]\]|\[\[cp:(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\]\]|\[\[(?:dl:)?(\d{4}-\d{2}-\d{2})\]\]/g;
  targets.forEach((n) => {
    const text = n.nodeValue;
    markRe.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m, hit = false;
    while ((m = markRe.exec(text))) {
      hit = true;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const full = m[1] || m[2] || m[3];
      const kind = m[1] ? 'cr' : (m[2] ? 'cp' : 'dl');
      const icon = kind === 'cr' ? '\u{1F195}' : (kind === 'cp' ? '\u2705' : '\u{1F4C5}');
      frag.appendChild(noteDateMarkElement(icon, kind, full));
      last = markRe.lastIndex;
    }
    if (!hit) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    if (n.parentNode) n.parentNode.replaceChild(frag, n);
  });
}
// 标签列表统一渲染：显示「名·子标签」
function renderTags(ev) {
  document.getElementById('tags').innerHTML = (ev.tags || []).map((t) => '<li>' + escapeHtml(tagLabelOf(t)) + '</li>').join('');
}

// 🆕 外框流星：把任意（含残缺／缺省）输入收敛成规范对象，桌面与 LITE 字段名一致（on/speed/size/shape/color/follow/rainbow/flame）
function normalizeMeteor(m) {
  m = (m && typeof m === 'object') ? m : {};
  const shapes = ['comet', 'sharp', 'band', 'twin'];
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
  return {
    on: m.on === true,
    speed: num(m.speed, 3, 30, 12),
    size: num(m.size, 4, 120, 12),
    shape: shapes.indexOf(m.shape) >= 0 ? m.shape : 'comet',
    color: isHex(m.color) ? m.color : '#ffae00',
    follow: m.follow === true,
    rainbow: m.rainbow === true,
    flame: num(m.flame, 10, 600, 160)
  };
}
const state = { w: DEFAULT_W, h: DEFAULT_H, color: STICKY_DEF_BG, opacity: 100, minimized: false, minH: 0, fontScale: 1, fontColor: STICKY_DEF_FG, fontWeight: 400, undoneChecksOnly: false, sortMode: 'orig', scrollPos: 0, meteor: { on: false, speed: 12, size: 12, shape: 'comet', color: '#ffae00', follow: false, rainbow: false, flame: 160 } };

async function init() {
  if (IS_FLIP) { await initFlip(); return; }
  syncViewNoteMode();   // 🆕 分体模式 KEY 不变，开窗即定只读与否
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
    undoneChecksOnly: !!inst.undoneChecksOnly,
    sortMode: (inst.sortMode === 'asc' || inst.sortMode === 'desc') ? inst.sortMode : 'orig',
    scrollPos: (typeof inst.scrollPos === 'number' && isFinite(inst.scrollPos)) ? Math.max(0, inst.scrollPos) : 0,
    meteor: normalizeMeteor(inst.meteor)
  });

  // 正文/标题都用主窗口渲染好的 HTML（同一套 renderMarkdown/tlRenderNotes/tlRenderInlineMarkdown 管线：
  //    正文含 [[cp:]]→✅、[[dl:]]→📅、checkbox、GFM 表格/清单/代码块等；标题含 <BIG> 等行内标签），此处只负责显示。
  //    同时把 ref 元数据（notes/src/…）缓存下来：来自外部 INCLUDE 文件的行程（草稿便利贴）本地解析不到，
  //    编辑/徽标/写回全靠这份 ref。
  let html = '', titleHtml = '';
  try {
    const res = (await ipcRenderer.invoke('sticky-note-html', { key: KEY, idx: IDX })) || {};
    html = (typeof res.html === 'string') ? res.html : '';
    titleHtml = (typeof res.titleHtml === 'string') ? res.titleHtml : '';
    rememberRefMeta(Object.assign({ key: KEY }, res));
  } catch (e) { html = ''; titleHtml = ''; }
  const ev = sourceEvent(KEY);
  if (!ev) { document.getElementById('title').textContent = '(找不到该便利贴)'; applyColor(); return; }

  renderMeta(ev);
  renderTags(ev);
  // 🆕 标题：优先用主窗口渲染好的 HTML（与列表行一致）；拿不到时退回纯文本（避免显示原始标签）
  const titleEl = document.getElementById('title');
  // 🆕 单段落 VIEW 贴：把段落名称＋条件摘要挂到标题 tooltip（多段落标题不挂，每段各自有 tooltip）。
  //   标题文字包进 .tt（no-drag）小洞：tooltip 只在文字上出现，标题栏其余仍是 drag 可拖动。
  const tip1 = (ev && typeof ev.titleTip === 'string' && ev.titleTip) ? ev.titleTip : '';
  setStickyTitle(titleEl, titleHtml, ev.title, tip1);
  // 🆕 移除 raw 原文兜底：便利贴正文即 checkbox，清光即空，留白＝正确终态；
  //    旧逻辑会把 notes 当未渲染 Markdown 源塞进正文（如 "- [ ] 11111"），属显示错误。
  document.getElementById('body').innerHTML = html;
  syncUndoneChecksFilter();
  noteApplyHighlight(); // 🆕 依當前定位詞重打高亮
  refreshNoteViewDisplay(); // 🆕 多段落 VIEW 便利贴：初始渲染后套用记忆的「顺序平铺／页签方式」与 active 段落
  // VIEW 贴排序已统一收口在 refreshNoteViewDisplay() 末尾（normalize → capture → apply）
  // 新便利贴默认淡黄纸底（仅当用户未手动改过色时）；不再继承事件色，保持纸质便利贴观感
  if (!inst.color) state.color = STICKY_DEF_BG;
  // 勾选框填充色跟随事件色（与日历渲染一致：.ev-md-check.done .ev-cb 用事件色）
  document.getElementById('note').style.setProperty('--ev-primary', ev.color || '#7c3aed');
  applyColor();
  applyContentFont();
  restoreScrollPos();   // 🆕 还原上次离开前的卷动位置（统一行为）
  noteRendered = true;
  consumePendingFocusUnit();   // 🆕 消费「跳转到便利贴」顺带要定位+闪烁的小事件(群)

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

// 🆕 顶部 × 的「关闭选项」二选一菜单（分体/翻页共用）。
//    菜单挂在 #note 外＋position:fixed（#note 有 overflow:hidden），坐标按视窗算并夹在窗口内。
//    这里只收/开「关闭选项」本身，不碰「编辑内容区块」浮层的关闭路径锁定。
function noteCloseMenuHide() {
  const cm = document.getElementById('noteCloseMenu');
  if (cm) cm.classList.remove('open');
}
function noteCloseMenuToggle() {
  const cm = document.getElementById('noteCloseMenu');
  const btn = document.getElementById('miClose');
  if (!cm || !btn) return;
  if (cm.classList.contains('open')) { noteCloseMenuHide(); return; }
  // 同一时间只留一套浮层菜单（☰ 主菜单＋三套右键菜单）
  const main = document.getElementById('menu');
  if (main) main.classList.remove('open');
  noteFindSameClose(); noteBlockMenuClose(); vsrGotoMenuClose();
  // 🆕 配色跟「当前这张便利贴」一致：--note-bg／--note-fg 只挂在 #note（applyColor/applyContentFont），
  //    本菜单在 #note 外继承不到 → 开窗瞬间从 #note 取一份；翻页换色后下次开窗自动跟着换。
  //    ⚠️ 刻意不把变量提到 :root：#note 外的 viewRuleModal 等浮层有自己的深底配色，
  //       继承便利贴字色会变成「深底深字」，不能为了一个菜单改全局主题。
  const noteEl = document.getElementById('note');
  if (noteEl) {
    const bg = noteEl.style.getPropertyValue('--note-bg');
    const fg = noteEl.style.getPropertyValue('--note-fg');
    if (bg) cm.style.setProperty('--note-bg', bg);
    if (fg) cm.style.setProperty('--note-fg', fg);
  }
  const r = btn.getBoundingClientRect();
  cm.classList.add('open');   // 先开才量得到尺寸（base 是 display:none）
  const mw = cm.offsetWidth || 190;
  const mh = cm.offsetHeight || 68;
  let left = r.left + r.width / 2 - mw / 2;
  let top = r.bottom + 4;
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight - 4) top = Math.max(4, r.top - mh - 4);
  cm.style.left = String(Math.max(4, left)) + 'px';
  cm.style.top = String(Math.max(4, top)) + 'px';
  armEdgeHandlesAutoHide();
}

// 右上角 ☰ 下拉菜单：收纳全部操作（翻页◀▶ / 刷新 / 打开 / 颜色·透明度 / 最小化 / 关闭）
function setupControls() {
  const menu = document.getElementById('menu');
  const menuHandle = document.getElementById('noteMenuHandle');
  const closeMenu = () => { if (menu) menu.classList.remove('open'); };
  const undoneChecksButton = document.getElementById('miUndoneChecks');
  if (undoneChecksButton) undoneChecksButton.onclick = (e) => {
    e.stopPropagation();
    toggleUndoneChecksFilter();
  };
  // 🆕 关闭动作共用的「未存改动」守卫：两个选项都要先保住编辑中的内容，绝不静默丢弃。
  const ensureSavedBeforeClose = async () => {
    if (!(editMode && editDirty)) return true;
    const ok = window.confirm('内容有未保存的改动。\n\n确定＝保存后关闭\n取消＝不关闭');
    if (!ok) return false;
    return !!(await saveNoteEdit());
  };
  // scope='all'＝结束整个便利贴；其余＝主程式菜单请求关闭单张时沿用原确认文案。
  const confirmClose = async (scope) => {
    if (!await ensureSavedBeforeClose()) return false;
    if (scope === 'all') {
      return window.confirm('确定要关闭整个便利贴应用吗？\n\n将关闭所有便利贴窗口并结束本次显示；主程式保留，之后仍可从便利贴按钮重新开启。');
    }
    const message = IS_FLIP
      ? '确定要关闭 翻页模式的便利贴 窗口吗？\n\n关闭后将结束当前 翻页模式的便利贴 的显示。'
      : '确定要关闭这张便利贴吗？\n\n之后仍可从便利贴菜单重新开启。';
    return window.confirm(message);
  };
  ipcRenderer.on('sticky-note-close-request', async (event, payload) => {
    if (!payload || typeof payload.requestId !== 'string') return;
    flushScrollSave();   // 🆕 关窗前记下卷动位置（含翻页窗；此刻 KEY/IDX 还是这一张）
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
    if (menu && menu.classList.contains('open')) {
      // 🆕 開菜單＝清空搜尋，定位隨之強制關閉（內容消失→關；下次輸入再預設開）
      const s = document.getElementById('mStickySearch');
      if (s) s.value = '';
      menuSearchQuery = '';
      menuLocateOn = false;
      menuLastQueryEmpty = true;
      NOTE_HL = '';
      noteApplyHighlight();
      menuSyncLocate();
      loadStickyMenuNotes();
      syncMeteorControls();   // 🆕 菜单打开时把当前便利贴的外框流星状态反映到控制项
    }
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
  // 🆕 顶部 × 不再直接关：先给「结束整个便利贴 / 只关当前页面」二选一。
  //    两个选项都先 flushScrollSave，避免关掉前丢掉这一张的卷动位置。
  document.getElementById('miClose').onclick = (e) => {
    e.stopPropagation();
    noteCloseMenuToggle();
  };
  const closeChoiceMenu = document.getElementById('noteCloseMenu');
  if (closeChoiceMenu) closeChoiceMenu.onclick = async (e) => {
    const item = e.target.closest && e.target.closest('.nami[data-act]');
    if (!item) return;
    e.stopPropagation();
    const act = item.getAttribute('data-act');
    noteCloseMenuHide();
    flushScrollSave();
    if (act === 'close-all') {
      if (!await confirmClose('all')) return;
      ipcRenderer.invoke('close-sticky-notes');
    } else if (act === 'close-page') {
      if (!await ensureSavedBeforeClose()) return;
      // ⚠️ 翻页窗的 order-updated 在 editMode 会刻意不重绘（避免抢画面）；但这一页已被移出，
      //    若还停在编辑模式，画面会一直显示已经关掉的贴 → 先正规退出编辑模式再发关页请求。
      if (IS_FLIP && editMode) await setEditMode(false);
      // 翻页模式：主进程把这一页自 order 移出并记进 flipHidden → order-updated 自动翻到相邻页；
      // 分体模式：只关掉这一个窗口。两者都不会删除行程资料，清单里仍可再开启。
      ipcRenderer.invoke('sticky-note-close-page', { key: KEY, idx: IDX });
    }
  };
  // 重新读表：请求主进程重读 calendar.md 并把最新事件内容经 sticky-note-refresh → applyNoteContent 落渲染
  function rereadStickyNoteTable() {
    const ev = sourceEvent(KEY);
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
  // 🆕 手动按 🔄 ＝使用者明确要重新采信远端 → 先解除「本地权威」保护，再刷新
  document.getElementById('noteRefreshHandle').onclick = () => {
    clearAuthWriteGuard(KEY);
    refreshStickyNote();
  };
  ipcRenderer.on('sticky-note-refresh-result', (event, result) => {
    if (!result || result.requestId !== activeStickyRefreshId) return;
    showStickyRefreshFeedback(result.message || (result.success
      ? '便利贴刷新完成，共同步 ' + result.count + ' 项。'
      : '便利贴刷新失败。'), !result.success);
  });
  document.getElementById('miCalendar').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('activate-main-window'); };
  // 📜 滚动：唤起主程式并滚动定位到该行程（不打开编辑框）
  document.getElementById('miCalendarScroll').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('wake-main-from-note', { key: KEY, action: 'scroll' }); };
  // ✎ 检视行程：与「双击便利贴 / 点标题栏」同一条管线（wake-main-from-note → open-sticky-event → tlOpenEventForm）。
  //    被 include 的外部档行程（ev.ro）现在不再被主程式 toast 拒绝，会开成「查看行程（只读）」窗体。
  //    VIEW 投影贴没有单一来源行程，该按钮由 CSS 收起（#note.view-note #miEditEvent）。
  const editEventBtn = document.getElementById('miEditEvent');
  if (editEventBtn) editEventBtn.onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('wake-main-from-note', { key: KEY }); };
  // 🆕 ＋ 新建便利贴：在便利贴窗内直接开浮层（选 include 档 + 填标题）→ sticky-note-create 写盘。
  //    不走 Calendar 表单：用户的要求是「不要我自己再去 Calendar 建一遍」，字段框架由 Calendar 那边算。
  document.getElementById('miNewNote').onclick = (e) => {
    e.stopPropagation();
    closeMenu();
    openNewNoteDialog();
  };
  // 🆕 ＋ 建立 calendar 档案：开浮层（前缀固定 calendar-，输入后缀）→ sticky-note-create-calendar 落盘
  document.getElementById('miNewCalendar').onclick = (e) => {
    e.stopPropagation();
    closeMenu();
    openNewCalDialog();
  };
  // 🗑 删除便利贴：把当前这张对应的行程从来源档（include 档或 calendar.md）移除。
  //   删除是破坏性的、不可恢复 → 先 confirm；参数带 title/date/src 让渲染端精确定位要删的块。
  //   来源档判定靠 refMeta（主程式推来的元数据缓存）：src 空＝calendar.md 正式档，非空＝include 档。
  document.getElementById('miDeleteNote').onclick = (e) => {
    e.stopPropagation();
    closeMenu();
    const meta = refMeta.get(KEY) || {};
    const src = String(meta.src || '');
    const title = String(meta.title || '');
    const date = String(meta.date || '');
    const srcLabel = src ? ('（来源：' + src + '）') : '（来源：calendar.md）';
    const name = title || KEY;
    if (typeof window.confirm !== 'function' || !window.confirm('确定删除便利贴「' + name + '」' + srcLabel + ' 吗？\n\n删除后该行程将从来源文件中移除，不可恢复。')) return;
    ipcRenderer.invoke('sticky-note-delete', {
      key: KEY, idx: IDX,
      ev: { title: title, date: date, src: src }
    }).then((r) => {
      if (r && r.ok) {
        showStickyRefreshFeedback('已删除便利贴「' + name + '」', false);
        // 翻页模式：翻页窗是整段会话，不关窗；order-updated 会自动把当前页 clamp 到相邻张。
        // 分体模式：直接关掉这张（它对应的行程已不在来源档，留着是幽灵）。
        if (!IS_FLIP) ipcRenderer.invoke('sticky-note-close', { key: KEY, idx: IDX });
      } else {
        showStickyRefreshFeedback('删除失败：' + ((r && r.error) || '未知错误'), true);
      }
    }).catch((err) => {
      showStickyRefreshFeedback('删除失败：' + (err && err.message ? err.message : err), true);
    });
  };
  // 浮层交互：Enter 建立 · Esc 取消 · 点背罩取消（与「发邮件」浮层同一手感）
  {
    const nnCreate = document.getElementById('nnCreateBtn');
    const nnCancel = document.getElementById('nnCancelBtn');
    const nnOv = document.getElementById('newNoteOv');
    const nnTitle = document.getElementById('nnTitle');
    if (nnCreate) nnCreate.onclick = (e) => { e.stopPropagation(); submitNewNote(); };
    if (nnCancel) nnCancel.onclick = (e) => { e.stopPropagation(); closeNewNoteDialog(); };
    if (nnOv) {
      nnOv.onclick = (e) => { if (e.target === nnOv) closeNewNoteDialog(); };
      nnOv.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;   // IME 组字中不拦
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewNoteDialog(); return; }
        if (e.key === 'Enter') {
          const t = e.target;
          if (t && t.id === 'nnFile') return;              // 下拉里的 Enter 不当作建立
          e.preventDefault();
          e.stopPropagation();
          submitNewNote();
        }
      }, true);
    }
    if (nnTitle) nnTitle.addEventListener('input', () => setNewNoteHint('Enter 建立 · Esc 取消；建好后会立刻出现在便利贴里，可继续编辑内容', false));
  }
  // 🆕 建立 calendar 档案浮层交互：Enter 建立 · Esc 取消 · 点背罩取消（与「新建便利贴」浮层同一手感）
  {
    const ncCreate = document.getElementById('ncCreateBtn');
    const ncCancel = document.getElementById('ncCancelBtn');
    const ncOv = document.getElementById('newCalOv');
    const ncSuffix = document.getElementById('ncSuffix');
    if (ncCreate) ncCreate.onclick = (e) => { e.stopPropagation(); submitNewCal(); };
    if (ncCancel) ncCancel.onclick = (e) => { e.stopPropagation(); closeNewCalDialog(); };
    if (ncOv) {
      ncOv.onclick = (e) => { if (e.target === ncOv) closeNewCalDialog(); };
      ncOv.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;   // IME 组字中不拦
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewCalDialog(); return; }
        if (e.key === 'Enter' && e.target && e.target.id === 'ncSuffix') {
          e.preventDefault();
          e.stopPropagation();
          submitNewCal();
        }
      }, true);
    }
    if (ncSuffix) ncSuffix.addEventListener('input', () => setNewCalHint('Enter 建立 · Esc 取消；文件建立在当前 calendar 同目录，可在 Calendar 中独立打开', false));
  }
  // 📝 唤起 TodoList（Gallery 独立模式，等同 ./start.sh --todolist）：主窗切到 todolist 并显示
  document.getElementById('miOpenTodolist').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('open-todolist-from-note'); };
  // 🤖 唤起 AI 智能控制台（主程序，等同 ./start.sh）：主窗切到 crawler-window 并显示
  document.getElementById('miOpenAiConsole').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('open-ai-console-from-note'); };
  // 🧩 自定义 VIEW 便利贴设定维护作业：开独立维护窗（规则窗不依赖这张贴是谁，投影贴里也照样能开）
  document.getElementById('miViewRules').onclick = (e) => { e.stopPropagation(); closeMenu(); ipcRenderer.invoke('vsr-open'); };
  // 📧 发邮件：收件人浮层 → 直调本机邮件服务（sendStickyEmail）
  document.getElementById('miEmail').onclick = (e) => { e.stopPropagation(); closeMenu(); openStickyEmailDialog(); };
  // 📥📤 设定备份：可携 JSON（与手机 LITE 互通；主进程负责选档／确认／写入并即时套用）
  const importSettingsBtn = document.getElementById('miImportSettings');
  if (importSettingsBtn) importSettingsBtn.onclick = async (e) => {
    e.stopPropagation();
    closeMenu();
    try {
      const r = await ipcRenderer.invoke('sticky-notes-import-settings');
      if (!r || r.canceled) return;
      showStickyRefreshFeedback(r.ok
        ? '已载入设定：套用 ' + r.applied + ' 张（JSON 共 ' + r.notes + ' 项，本档符合 ' + r.matched + ' 项）'
        : ('载入设定失败：' + (r.error || '未知错误')), !r.ok);
    } catch (err) {
      showStickyRefreshFeedback('载入设定失败：' + ((err && err.message) || err), true);
    }
  };
  const exportSettingsBtn = document.getElementById('miExportSettings');
  if (exportSettingsBtn) exportSettingsBtn.onclick = async (e) => {
    e.stopPropagation();
    closeMenu();
    try {
      const r = await ipcRenderer.invoke('sticky-notes-export-settings');
      if (!r || r.canceled) return;
      showStickyRefreshFeedback(r.ok
        ? '已汇出设定：' + r.path + '（' + r.notes + ' 项样式、' + r.hidden + ' 项关闭）'
        : ('汇出设定失败：' + (r.error || '未知错误')), !r.ok);
    } catch (err) {
      showStickyRefreshFeedback('汇出设定失败：' + ((err && err.message) || err), true);
    }
  };
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
    editArea.addEventListener('input', () => { editDirty = true; markEditDirty(true); refreshDoneFoldChip(); });
    // 编辑区不触发「点击唤起主程式」/ 双击跳转
    editArea.addEventListener('click', (e) => e.stopPropagation());
    editArea.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  // 🆕 已完成 checkbox 折叠切换（mousedown 阻止默认 → 不抢走编辑框焦点）
  const foldChip = document.getElementById('editFoldChip');
  if (foldChip) {
    foldChip.addEventListener('mousedown', (e) => e.preventDefault());
    foldChip.addEventListener('click', (e) => { e.stopPropagation(); toggleDoneFold(); });
  }
  // ⌘S / Ctrl+S 手动保存（编辑模式）；＋☐ 浮层打开时＝确认加入（焦点在 textarea 时由其自身 keydown 处理，这里兜底焦点在浮层外的情况）；本窗口无应用菜单，不会被系统抢走
  window.addEventListener('keydown', (e) => {
    const acMenu = document.getElementById('noteAddCheckMenu');
    if (acMenu && acMenu.classList.contains('open') && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); closeAddCheckMenu(); return;
    }
    const acOv = document.getElementById('addCheckOv');
    if (acOv && acOv.classList.contains('show')) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); e.stopPropagation(); confirmAddCheck(); }
      else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        // 🆕 只有「编辑内容区块」下方的「关闭」按钮能关窗：Esc 一律不关闭
        //    （决策条已显示时仍收回提问、留在编辑，这不是关闭动作）
        const bar = document.getElementById('addCheckUnsavedBar');
        if (bar && bar.style.display !== 'none') { hideAddCheckUnsavedBar(); focusAddCheckInput(); }
      }
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
  // 🆕 外框流星飞绕：可展开子区（开/关 + 飞速/大小/形状/颜色/焰尾）
  const miMeteor = document.getElementById('miMeteor');
  if (miMeteor) miMeteor.onclick = (e) => {
    e.stopPropagation();
    const cfg = document.getElementById('mMeteorCfg');
    if (cfg) cfg.classList.toggle('open');
  };
  const miMeteorToggle = document.getElementById('miMeteorToggle');
  if (miMeteorToggle) miMeteorToggle.onclick = (e) => { e.stopPropagation(); toggleMeteor(); };
  const mSp = document.getElementById('mMeteorSpeed');
  if (mSp) mSp.oninput = () => { const v = +mSp.value; const el = document.getElementById('mMeteorSpeedVal'); if (el) el.textContent = '每圈 ' + v + ' 秒'; setMeteor({ speed: v }); };
  const mSz = document.getElementById('mMeteorSize');
  if (mSz) mSz.oninput = () => { const v = +mSz.value; const el = document.getElementById('mMeteorSizeVal'); if (el) el.textContent = v + '°'; setMeteor({ size: v }); };
  const mFl = document.getElementById('mMeteorFlame');
  if (mFl) mFl.oninput = () => { const v = +mFl.value; const el = document.getElementById('mMeteorFlameVal'); if (el) el.textContent = v + 'px'; setMeteor({ flame: v }); };
  const mSh = document.getElementById('mMeteorShape');
  if (mSh) mSh.querySelectorAll('button[data-shape]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); setMeteor({ shape: b.getAttribute('data-shape') || 'comet' }); };
  });
  const mCol = document.getElementById('mMeteorColor');
  if (mCol) mCol.oninput = () => setMeteor({ color: mCol.value, follow: false });
  const mFol = document.getElementById('mMeteorFollow');
  if (mFol) mFol.onchange = () => setMeteor({ follow: !!mFol.checked });
  const mRb = document.getElementById('mMeteorRainbow');
  if (mRb) mRb.onchange = () => setMeteor({ rainbow: !!mRb.checked });
  // 🆕 卷动位置记忆：body 卷动时节流记下位置（下次开窗／翻回来还原）
  const scrollBodyEl = document.getElementById('body');
  if (scrollBodyEl) scrollBodyEl.addEventListener('scroll', scheduleScrollSave, { passive: true });
  notifyBindControls();   // 🆕 启动通知的「✕ 关闭」钮
  syncMeteorControls();
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
  // 🆕 ＋☐ 加入子事件：meta 内按钮用事件委托（innerHTML 每次重绘），浮层 ⌘S 加入、Esc 取消（Enter＝换行）
  const ov = document.getElementById('addCheckOv');
  const metaEl = document.getElementById('meta');
  if (metaEl) metaEl.addEventListener('click', (e) => {
    if (e.target.closest('.note-undone-filter')) { e.stopPropagation(); toggleUndoneChecksFilter(); return; }
    if (e.target.closest('.note-addcheck')) { e.stopPropagation(); toggleAddCheckMenu(); }
  });
  // 🆕 ＋☐ 下拉选单：三个项目分别开子事件／表格／自由文本；点选单外任意处或 Esc 收起
  const addCheckMenu = document.getElementById('noteAddCheckMenu');
  if (addCheckMenu) {
    addCheckMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.nami');
      if (!item) return;
      e.stopPropagation();
      const act = item.getAttribute('data-act');
      closeAddCheckMenu();
      if (act === 'table') openAddTable();
      else if (act === 'text') openAddFreeText();
      else openAddCheck();
    });
    addCheckMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    addCheckMenu.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#noteAddCheckMenu, .note-addcheck')) return;
    closeAddCheckMenu();
  }, true);
  // 🆕 误触背罩绝不关窗：只有下方「关闭」按钮能关；点背罩只把焦点还给编辑框，继续打字
  if (ov) ov.addEventListener('click', (e) => {
    if (e.target !== ov) return;
    e.stopPropagation();
    focusAddCheckInput();
  });
  const acInput = document.getElementById('addCheckInput');
  if (acInput) {
    acInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // 🆕 IME 铁律：输入法组字时的 Enter（选用候选字）绝不能当成「加入」/确认
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); confirmAddCheck(); }
      // ⚠️ 回车＝换行，不再「回车直接加入」：与「编辑小圆点」打开的是同一个浮层，必须同一手感。
      //    以前回车会立刻加入并清空输入框（多行被打断、输入法选字也被截断），2026-10-22 用户回馈。
      //    加入改由 ⌘S／「保存」按钮触发（两条路径都不会关窗，可继续输入）。
      // 🆕 Esc 不关窗：只吃掉按键（上面已 stopPropagation），避免误触打断编辑
      else if (e.key === 'Escape') { e.preventDefault(); }
    });
    acInput.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  // 🆕 弹层按钮行「复制｜保存｜关闭」：保存＝⌘S 同路径（confirmAddCheck），关闭＝Esc 同路径（requestCloseAddCheck，有改动会先问）
  const acSave = document.getElementById('saveCheckButton');
  if (acSave) acSave.onclick = (e) => { e.stopPropagation(); confirmAddCheck(); };
  const acClose = document.getElementById('closeCheckButton');
  if (acClose) acClose.onclick = (e) => { e.stopPropagation(); requestCloseAddCheck(); };
  // 🆕「未保存改动」决策条：三选一（继续编辑＝安全默认 · 不保存关闭＝丢弃 · 保存并关闭＝先落盘成功才关）
  const acKeep = document.getElementById('addCheckKeepEditingButton');
  if (acKeep) acKeep.onclick = (e) => { e.stopPropagation(); hideAddCheckUnsavedBar(); focusAddCheckInput(); };
  const acDiscard = document.getElementById('addCheckDiscardButton');
  if (acDiscard) acDiscard.onclick = (e) => { e.stopPropagation(); closeAddCheck(); };
  const acSaveClose = document.getElementById('addCheckSaveCloseButton');
  if (acSaveClose) acSaveClose.onclick = async (e) => {
    e.stopPropagation();
    hideAddCheckUnsavedBar();
    if (await confirmAddCheck()) closeAddCheck();
  };
  if (ov) {
    ov.addEventListener('pointerdown', (e) => e.stopPropagation());
    // 浮层内双击选字（尤其表格网格的格子）不该把主窗体拉起来，与 editArea 同口径
    ov.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  // 🆕 发邮件浮层：发送｜取消、点背罩关闭、Enter 发送 / Esc 取消（焦点在输入框时由其自身处理）
  const emailSendBtn = document.getElementById('emailSendBtn');
  if (emailSendBtn) emailSendBtn.onclick = (e) => { e.stopPropagation(); sendStickyEmail(); };
  const emailCancelBtn = document.getElementById('emailCancelBtn');
  if (emailCancelBtn) emailCancelBtn.onclick = (e) => { e.stopPropagation(); closeStickyEmailDialog(); };
  const emailOv = document.getElementById('emailOv');
  if (emailOv) {
    emailOv.addEventListener('click', (e) => { if (e.target === emailOv) closeStickyEmailDialog(); });
    emailOv.addEventListener('pointerdown', (e) => e.stopPropagation());
    emailOv.addEventListener('dblclick', (e) => e.stopPropagation());
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
  // 🆕 链接点击：本窗体没挂 preload → 没有 window.electronAPI，且主窗体那份委托监听住在这里收不到，
  //   必须自己接一份（项目规则：每个窗体各自复刻 handler）。分四种：
  //     exec:  → 主窗体渲染成 <a class="card-exec-link" data-exec-url>（刻意没有 href）→ shell.openExternal
  //     http(s)→ 主窗体走 openWebPreview 开 1400x900 独立预览窗；本窗体若不管，
  //              原生默认行为会「把便利贴自己导航到该网址」，页面挤在贴纸宽度里
  //              （2026-10-20 用户回馈：点〔执行mcpTest〕后画面没有完整展开）。
  //     a.card-cur-link（[文字](cur:URL)）例外：语义是「在本窗体就地开启」，与主窗体一致直接放行，
  //              主进程的护栏（guardStickyNoteNavigation）也为此放行 http/file 协议。
  //     file://图片 → 'open-image-window'（与主窗体同）；其它 file:// → 交系统默认程式，
  //              因为本窗体没有 renderMarkdown（正文是主窗体渲染好再传进来的 HTML），
  //              做不出主窗体那份「文档窗体」，只能退给系统开。
  //     #锚点  → 不拦，留给窗内原生片段滚动。
  const bodyClickEl = document.getElementById('body');
  if (bodyClickEl) bodyClickEl.addEventListener('click', (e) => {
    const execLink = e.target.closest && e.target.closest('a.card-exec-link');
    if (execLink) {
      e.preventDefault();
      e.stopPropagation();
      const url = execLink.getAttribute('data-exec-url') || '';
      if (!url) { showStickyRefreshFeedback('该链接没有可执行的地址', true); return; }
      ipcRenderer.invoke('openExternalBrowser', url)
        .then((result) => {
          if (result && result.success === false) showStickyRefreshFeedback('执行失败：' + (result.error || '未知错误'), true);
        })
        .catch((error) => showStickyRefreshFeedback('执行失败：' + (error && error.message ? error.message : error), true));
      return;
    }
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    if (link.classList && link.classList.contains('card-cur-link')) return; // cur:＝就地导航，与主窗体一致
    const href = (link.getAttribute('href') || '').trim();
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.invoke('open-web-preview', href)
        .catch((error) => showStickyRefreshFeedback('开启网页预览失败：' + (error && error.message ? error.message : error), true));
      return;
    }
    if (/^file:\/\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      const label = (link.textContent || '').trim();
      if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)(?:[?#].*)?$/i.test(href)) {
        ipcRenderer.invoke('open-image-window', { src: href, title: label ? ('图片：' + label) : '图片' })
          .catch((error) => showStickyRefreshFeedback('开启图片失败：' + (error && error.message ? error.message : error), true));
      } else {
        ipcRenderer.invoke('openExternalBrowser', href)
          .then((result) => {
            if (result && result.success === false) showStickyRefreshFeedback('开启失败：' + (result.error || '未知错误'), true);
          })
          .catch((error) => showStickyRefreshFeedback('开启失败：' + (error && error.message ? error.message : error), true));
      }
    }
  });
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
  if (e.target.closest('.iconbtn, .note-mode-handle, .note-min-handle, .note-menu-handle, .note-refresh-handle, .note-addcheck, .note-addcheck-menu, .note-close-menu, #noteCloseMenu, .note-undone-filter, .flip-edge, .doc-badge')) return;  // 按钮/徽标各自处理（VIEW 徽标有自己的弹层，不唤起主程式）
  if (!e.target.closest('.bar, .head, .meta, .tags')) return; // 仅拖拽区点击＝唤起主程式
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
}

// 双击便利贴（标题栏或正文）：唤起主程式并打开该事件表单
// 正文区是 -webkit-app-region: no-drag，双击不会触发拖动，故可安全复用「唤起+打开事件」管线
function onNoteDblClick(e) {
  if (e.target.closest('.iconbtn, .menu, .rz, .note-addcheck, .note-addcheck-menu, .note-close-menu, #noteCloseMenu, .note-undone-filter, .flip-edge, .ev-md-edit, .ev-cb, .doc-badge')) return; // 菜单/☰按钮/翻页把手/缩放把手/checkbox 控件/徽标各自处理
  ipcRenderer.invoke('wake-main-from-note', { key: KEY });
}

// ===== 🆕 「＋☐」下拉选单：子事件／MD 表格／自由编辑 =====
// 三个入口共用 #addCheckOv；noteAddMode 只决定「加入」时怎么回写：
//   check＝逐行包 - [ ]（原功能）｜table／text＝把 textarea 内容当原始 MD 区块追加（不包 checkbox）
let noteAddMode = 'check';
// 🆕 「group 启用（唯一小事件）」：只在编辑内容区块时有效，默认不启用。
//    noteGroupWasOn＝开框时该区块原本就整组带同一个 {gp} key；noteGroupBaseline＝勾选状态的「脏值」基线。
let noteGroupWasOn = false;
let noteGroupBaseline = false;
let noteGroupMarkBaseline = '';   // 🆕 群标记输入框的脏值基线（避免勾选即误判脏）
function closeAddCheckMenu() {
  const menu = document.getElementById('noteAddCheckMenu');
  if (menu) menu.classList.remove('open');
}
function openAddCheckMenu() {
  const menu = document.getElementById('noteAddCheckMenu');
  const note = document.getElementById('note');
  const chip = document.querySelector('#meta .note-addcheck');
  if (!menu || !note || !chip) return;
  menu.classList.add('open');
  const nr = note.getBoundingClientRect();
  const cr = chip.getBoundingClientRect();
  const left = cr.left - nr.left;
  menu.style.left = Math.max(6, Math.min(left, nr.width - menu.offsetWidth - 6)) + 'px';
  const below = cr.bottom - nr.top + 4;
  // 贴纸太矮时向上展开，避免被 #note 的 overflow:hidden 裁掉
  menu.style.top = (below + menu.offsetHeight > nr.height - 4
    ? Math.max(4, cr.top - nr.top - menu.offsetHeight - 4) : below) + 'px';
}
function toggleAddCheckMenu() {
  const menu = document.getElementById('noteAddCheckMenu');
  if (menu && menu.classList.contains('open')) closeAddCheckMenu();
  else openAddCheckMenu();
}
// ===== 🆕 便利贴「＋☐」加入子事件：对齐 calendar 列表行 tlOpenAddCheckDialog =====
// 逐行输入 → 每行列成「- [ ] 行」追加到事件备注末尾；Calendar 关闭时由主进程唤醒并交由其保存。
// 被 include 的外部档行程（ev.ro）便利贴内容仍可编辑：主程式依 ref.src 把改动写回来源档，
// 这与「编辑行程窗体」不同——后者对 ro 行程只开只读查看（2026-11-04）。
function openAddCheck() {
  const inp = document.getElementById('addCheckInput');
  const ov = document.getElementById('addCheckOv');
  const title = ov && ov.querySelector('.ac-title');
  const hint = ov && ov.querySelector('.ac-hint');
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
  noteAddMode = 'check';
  noteExitTableMode();   // 🆕 ＋☐ 新增子事件一律用不上网格，先把上一个表格会话的状态收干净
  noteSyncGroupUi('');   // 🆕 「加入子事件」也提供 group 勾选（默认不启用），保存时整批变成一个唯一小事件
  if (title) title.textContent = '加入子事件（CheckBox）';
  // 🆕 与「编辑小圆点」入口同一套按钮／快捷键口径：Enter 换行、⌘S 加入后不关窗可继续编辑，只有下方「关闭」按钮能关窗（有草稿未加入会先问）
  if (hint) hint.textContent = 'Enter 换行 · ⌘S 加入（加入后不关闭，内容留在框里可继续编辑）· 关闭请按下方「关闭」按钮（草稿未加入会先问是否保存）';
  bindAddCheckTools('加入');
  if (inp) { inp.value = ''; inp.placeholder = '每行一个子事件；Enter 换行，⌘S 或「保存」加入…'; }
  addCheckBaseline = '';
  hideAddCheckUnsavedBar();
  if (ov) ov.classList.add('show');
  if (inp) setTimeout(() => inp.focus(), 0);
}
// 🆕 选单第 2 项：从零建一张空白表（尺寸取工具列的「行×列」），格子即时生成 MD 写回 textarea
function openAddTable() {
  const inp = document.getElementById('addCheckInput');
  const ov = document.getElementById('addCheckOv');
  const g = noteTableGridInstance();
  if (!g) { showStickyRefreshFeedback('表格编辑器未加载', true); return; }
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
  noteAddMode = 'table';
  noteExitTableMode();
  noteSyncGroupUi('');   // 🆕 表格是格子视图，逐行 {gp} 没意义 → 不提供 group 勾选
  if (ov) {
    ov.classList.add('show');
    ipcRenderer.invoke('sticky-note-editor-state', { editing: true }).catch(() => {});
    ov.querySelector('.ac-title').textContent = '加入表格（MD）';
    ov.querySelector('.ac-hint').textContent = '在格子里填内容（可「＋行／＋列」增删）；⌘S 或「加入」＝追加到备注末尾（不关窗）· 关闭请按下方「关闭」按钮（有改动会先问）';
  }
  bindAddCheckTools('加入');
  if (inp) { inp.value = ''; inp.placeholder = ''; }
  hideAddCheckUnsavedBar();
  g.bind();
  const rowsEl = document.getElementById('noteTableRows');
  const colsEl = document.getElementById('noteTableCols');
  g.enterBlank(parseInt(rowsEl && rowsEl.value, 10), parseInt(colsEl && colsEl.value, 10));
  markAddCheckBaseline();   // 刚打开的空白表＝还没开始编辑，关窗不必被问
  g.focusFirstCell();
}
// 🆕 选单第 3 项：任意文本／Markdown，原样追加到备注末尾
function openAddFreeText() {
  const inp = document.getElementById('addCheckInput');
  const ov = document.getElementById('addCheckOv');
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
  noteAddMode = 'text';
  noteExitTableMode();
  noteSyncGroupUi('');   // 🆕 自由文本新增不提供；保存后会切成「编辑刚加入的这一段」，那时才有 group 勾选
  if (ov) {
    ov.classList.add('show');
    ov.querySelector('.ac-title').textContent = '自由编辑（纯文本）';
    ov.querySelector('.ac-hint').textContent = '直接输入任意文本／Markdown；Enter 换行；⌘S 或「加入文本」＝原样追加到备注末尾（不会包成 - [ ] 子事件，不关窗）· 关闭请按下方「关闭」按钮（草稿未加入会先问）';
  }
  bindAddCheckTools('加入文本');
  if (inp) { inp.value = ''; inp.placeholder = '任意输入文本，Enter 换行（原样保存，不会变成子事件）…'; }
  addCheckBaseline = '';
  hideAddCheckUnsavedBar();
  if (inp) setTimeout(() => inp.focus(), 0);
}
// 🆕 「加入」成功后把浮层就地切成「编辑刚加入的这一段」：与「编辑小圆点」同一个状态——
//    内容留在框里可继续改、⌘S 变成覆写同一段（不会重复追加）、Esc 才关窗。
//    这样两个入口（＋☐ 新增 / 编辑小圆点）手感完全一致（2026-10-22 用户要求）。
function applyAddCheckEditUi(titleText, hintText) {
  const ov = document.getElementById('addCheckOv');
  if (!ov) return;
  const titleEl = ov.querySelector('.ac-title');
  const hintEl = ov.querySelector('.ac-hint');
  if (titleEl && titleText) titleEl.textContent = titleText;
  if (hintEl && hintText) hintEl.textContent = hintText;
  bindAddCheckTools();   // 主按钮文字：「加入」→「保存」
  // 🆕 新增成功后会就地切成「编辑刚加入的这一段」：自由文本模式此时变成区块编辑，要补上 group 勾选
  const inpEl = document.getElementById('addCheckInput');
  noteSyncGroupUi(inpEl ? inpEl.value : '', true);   // keep：加入后就地切编辑，勾选要延续（否则第二次 ⌘S 会把组拆掉）
}
function closeAddCheck() {
  ipcRenderer.invoke('sticky-note-editor-state', { editing: false }).catch(() => {});
  const ov = document.getElementById('addCheckOv');
  if (ov) ov.classList.remove('show');
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
  noteAddMode = 'check';
  addCheckBaseline = '';
  noteSyncGroupUi('', false, true);   // 🆕 关窗一律复位，下次开任何模式都不会残留上次的勾选
  noteExitTableMode();   // 🆕 收掉表格网格，下次开一般浮层别残留
  const toBlockBtn = document.getElementById('noteCheckToBlockButton');
  if (toBlockBtn) toBlockBtn.hidden = true;   // 🆕 模式切换钮一并收掉，别留到下一次开窗
  hideAddCheckUnsavedBar();
}
let addCheckSavePending = false;
let noteCheckEditTarget = null;
let noteBlockEditTarget = null; // { uid, start, end, type } — 通用「最小 MD 区块」编辑区间
// ── 🆕 表格网格编辑器（引擎＝md-table-grid.js，与主窗体共用同一份；这里只接便利贴的节点与配色）
//  网格只把内容即时写回 #addCheckInput，落盘仍走 confirmAddCheck() 的区块区间回写；
//  便利贴的 ⌘S／Esc 原本只绑在那颗 textarea 上，焦点在格子里时接不到 → 由 onSave／onClose 补上（onClose 现在只还焦点、不关窗）。
let noteTableGrid = null;
function noteTableGridInstance() {
  if (noteTableGrid) return noteTableGrid;
  if (!window.MdTableGrid || !document.getElementById('noteTableGrid')) return null;
  const byId = (id) => document.getElementById(id);
  const box = document.getElementById('addCheckBox');
  noteTableGrid = window.MdTableGrid.createGrid({
    textarea: byId('addCheckInput'),
    grid: byId('noteTableGrid'),
    scroll: byId('noteTableGridScroll'),
    controls: {
      rows: byId('noteTableRows'), cols: byId('noteTableCols'), build: byId('noteTableBuild'),
      addRow: byId('noteTableAddRow'), delRow: byId('noteTableDelRow'),
      addCol: byId('noteTableAddCol'), delCol: byId('noteTableDelCol'), toggle: byId('noteTableViewText')
    },
    // 便利贴窗体本身可能只有两三百宽：宽度扣掉浮层内边距，再以 720px 封顶
    setWide: (on) => {
      if (!box) return;
      box.style.width = on ? 'calc(100vw - 24px)' : '';
      box.style.maxWidth = on ? '720px' : '';
    },
    toast: (m) => showStickyRefreshFeedback(m, true),
    onSave: () => { confirmAddCheck(); },
    onClose: () => { focusAddCheckInput(); }   // 🆕 网格内 Esc 也不关窗，只把焦点还给编辑区
  });
  return noteTableGrid;
}
function noteExitTableMode() { if (noteTableGrid) noteTableGrid.exit(); }
function closeEditNoteCheck() {
  noteCheckEditTarget = null;
  noteBlockEditTarget = null;
  closeAddCheck();
}
// ── 🆕 关闭拦截：浮层内容有改动时（编辑＝与开框原文不同；新增＝草稿尚未加入），
//    只有下方「关闭」按钮会走这道拦截；Esc／点背罩一律不关窗（误触不再丢编辑状态）。
//  · 基线＝开框时的内容，⌘S／「保存」成功后刷新（保存过就不再算脏）。
//  · 决策条给三个出口，默认焦点「继续编辑」＝不丢改动的安全默认；「不保存，直接关闭」才会丢弃（不落盘、不动存档）。
let addCheckBaseline = '';
function markAddCheckBaseline() {
  const inp = document.getElementById('addCheckInput');
  addCheckBaseline = inp ? inp.value : '';
  const gp = document.getElementById('noteGroupEnable');
  noteGroupBaseline = !!(gp && gp.checked && !gp.disabled);
  const mark = document.getElementById('noteGroupMark');
  noteGroupMarkBaseline = (gp && gp.checked && !gp.disabled && mark) ? mark.value : '';
  hideAddCheckUnsavedBar();
}
function addCheckEditing() {
  return !!noteCheckEditTarget || !!noteBlockEditTarget;
}
function addCheckDirty() {
  const inp = document.getElementById('addCheckInput');
  const gp = document.getElementById('noteGroupEnable');
  const mark = document.getElementById('noteGroupMark');
  const gpOn = !!(gp && !gp.disabled && gp.checked);
  // 🆕 只勾了 group、或改了群标记也算未保存（二者都不改 textarea 内容，光比文字会漏掉）
  return (!!inp && inp.value !== addCheckBaseline) ||
         (!!gp && !gp.disabled && gp.checked !== noteGroupBaseline) ||
         (gpOn && !!mark && mark.value !== noteGroupMarkBaseline);
}
function showAddCheckUnsavedBar() {
  const bar = document.getElementById('addCheckUnsavedBar');
  if (!bar) { closeAddCheck(); return; }   // 决策条不在 markup 里 → 退化成直接关闭，别把使用者卡住
  const tip = bar.querySelector('.ac-unsaved-tip');
  if (tip) tip.textContent = addCheckEditing()
    ? '内容有改动，尚未保存。关闭前请决定：'
    : '草稿尚未加入。关闭前请决定：';
  const saveClose = document.getElementById('addCheckSaveCloseButton');
  if (saveClose) saveClose.textContent = addCheckEditing() ? '保存并关闭' : '加入并关闭';
  bar.style.display = '';
  const keep = document.getElementById('addCheckKeepEditingButton');
  if (keep) keep.focus();
}
function hideAddCheckUnsavedBar() {
  const bar = document.getElementById('addCheckUnsavedBar');
  if (bar) bar.style.display = 'none';
}
function focusAddCheckInput() {
  // 网格里打字时点「继续编辑」，焦点要落回格子（那颗 textarea 在表格模式下是隐藏的，focus 它等于把焦点丢掉）
  if (noteTableGrid && noteTableGrid.isGridVisible() && noteTableGrid.focusFirstCell()) return;
  const inp = document.getElementById('addCheckInput');
  if (inp) inp.focus();
}
// 返回 true＝浮层已关闭；false＝有改动、已把决定权交给使用者（浮层仍开着）
function requestCloseAddCheck() {
  if (!addCheckDirty()) { closeAddCheck(); return true; }
  showAddCheckUnsavedBar();
  return false;
}
// ── 🆕 「编辑全文内容」跳转定位（2026-11-08）──────────────────────────────
//    按「编辑全文内容」离开子事件浮层时，把当前这颗小圆点（或整个 {gp} 群）在整篇原文里的
//    行号区间带进 #editArea：选中该段、卷到可见、金底闪烁 4 秒，避免「切过去了却找不到内容」。
//    ⚠️ 区间必须在 closeAddCheck() 之前取好——它会清掉 noteCheckEditTarget / noteBlockEditTarget。
function noteEditLocateRange() {
  const b = noteBlockEditTarget;
  if (b && Number.isInteger(b.start) && Number.isInteger(b.end)) {
    const s = Math.max(0, b.start);
    return [s, Math.max(s, b.end)];
  }
  const c = noteCheckEditTarget;
  if (c && Number.isInteger(c.line)) {
    const s = Math.max(0, c.line);
    return [s, s + Math.max(1, c.count || 1) - 1];
  }
  return null;   // ＋☐ 新增模式：没有既有位置可定位
}
// 折叠「隐藏已完成」会改 #editArea 的内容 → 原文行号失效，用底稿该区块第一行文字兜底找行
function noteEditLocateText(range) {
  if (!Array.isArray(range) || range.length !== 2) return '';
  const seg = String(getEventNotes() || '').split('\n').slice(range[0], range[1] + 1);
  for (let i = 0; i < seg.length; i += 1) { if (String(seg[i]).trim()) return String(seg[i]); }
  return '';
}
function notePlainForLocate(s) {
  return String(s == null ? '' : s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/^[\s>#*+~-]+/, ' ')
    .replace(/[*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// 与主窗 tlFlashEventFormLines 同口径：行号 → 字符偏移 → 选中 → 卷动 → 闪烁（4 秒）
function noteFlashEditAreaLines(range, text) {
  const ea = document.getElementById('editArea');
  if (!ea || !editMode || !Array.isArray(range) || range.length !== 2) return;
  const value = String(ea.value || '');
  const view = value.split('\n');
  let span = Math.max(1, (+range[1] || 0) - (+range[0] || 0) + 1);
  let start = Math.max(0, +range[0] || 0);
  // 🆕 折叠「隐藏已完成」时 #editArea 是投影视图 → 原始行号全部错位。旧版一律退化成「按首行文字猜」，
  //    但 plain 化会剥掉 "- [ ] "，很容易在文件前面误命中同名文字、算出 start=0 → scrollTop=0，
  //    于是「闪了却没卷动」（2026-11-08 用户回报）。新口径：用 baseMap（视图行号→原始行号）精确反查。
  if (doneFoldState && Array.isArray(doneFoldState.baseMap)) {
    const from = start, to = (+range[1] || 0);
    const mapped = [];
    for (let i = 0; i < doneFoldState.baseMap.length; i += 1) {
      const orig = doneFoldState.baseMap[i];
      if (orig >= from && orig <= to) mapped.push(i);
    }
    if (mapped.length) {
      start = mapped[0];
      span = mapped[mapped.length - 1] - mapped[0] + 1;
    } else { start = -1; }
  } else if (start + span > view.length) {
    start = -1;
  }
  if (start < 0) {
    // 目标行被折叠隐藏／行号越界 → 内容兜底：精确相等优先，避免误命中前面的同名片段
    const want = notePlainForLocate(text);
    if (want.length >= 2) {
      let exact = -1, loose = -1;
      for (let i = 0; i < view.length; i += 1) {
        const p = notePlainForLocate(view[i]);
        if (p === want) { exact = i; break; }
        if (loose < 0 && p.indexOf(want) >= 0) loose = i;
      }
      start = exact >= 0 ? exact : loose;
    }
    if (start < 0) return;
  }
  const end = Math.min(view.length - 1, start + span - 1);
  function lineToOffset(targetLine) {
    let i = 0, ln = 0;
    while (i < value.length && ln < targetLine) { if (value[i] === '\n') ln++; i++; }
    return i;
  }
  const sOff = lineToOffset(start);
  let eOff = value.length;
  (function () {
    let i = sOff, ln = start;
    while (i < value.length) {
      if (value[i] === '\n') { if (ln === end) { eOff = i; return; } ln++; }
      i++;
    }
    eOff = value.length;
  })();
  if (eOff < sOff) eOff = sOff;
  try { ea.focus(); ea.setSelectionRange(sOff, eOff); } catch (e) {}
  // 🆕 卷动改到 rAF 两帧后并连设两次：避开 display:none→block 布局未完成，
  //    也压过 focus()/setSelectionRange() 触发的浏览器异步自动卷动（同步设会被覆盖）。
  function applyLocateScroll() {
    try {
      const cs = getComputedStyle(ea);
      const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.5) || 18;
      ea.scrollTop = Math.max(0, start * lh - ea.clientHeight / 3);
    } catch (e) {}
  }
  requestAnimationFrame(function () {
    applyLocateScroll();
    requestAnimationFrame(applyLocateScroll);
  });
  ea.classList.remove('note-edit-locate-flash');
  void ea.offsetWidth;                       // 强制重排，连续点两次也能重播动画
  ea.classList.add('note-edit-locate-flash');
  setTimeout(function () { ea.classList.remove('note-edit-locate-flash'); }, 4200);
}

// ── 🆕 浮层工具按钮（三个入口共用：＋☐ 新增／子事件编辑／区块编辑）：复制 ｜ 编辑全文内容 ｜ 主按钮
//    「编辑全文内容」也是离开本浮层，所以同样要先过「未保存改动」这道问。
function bindAddCheckTools(saveLabel) {
  const inp = document.getElementById('addCheckInput');
  const saveButton = document.getElementById('saveCheckButton');
  if (saveButton) saveButton.textContent = saveLabel || '保存';
  const copyButton = document.getElementById('copyNoteCheckButton');
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
    fullBtn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // ⚠️ 先取定位资料：requestCloseAddCheck() → closeAddCheck() 会清掉编辑 target
      const range = noteEditLocateRange();
      const text = noteEditLocateText(range);
      if (requestCloseAddCheck()) {
        await setEditMode(true);   // 有改动 → 先问，决定完才切到整篇编辑
        // 延迟一帧：等 textarea 已显示、折叠投影已套用，再卷动＋选中＋闪烁
        if (range) setTimeout(function () { noteFlashEditAreaLines(range, text); }, 60);
      }
    };
  }
  // 🆕 双向模式切换（单一 setter）：编辑窗（有 target）与加入窗（无 target）共用同一颗按钮。
  //    显隐／文案／分派全收在这里，开窗与每次切换后重绑即可，不需要额外状态旗标。
  //    ⚠️ 判「编辑区块能否反切」要读 inp.value，所以区块开窗必须先写好 textarea 再 bind。
  const toBlockBtn = document.getElementById('noteCheckToBlockButton');
  if (toBlockBtn) {
    const editing = !!noteCheckEditTarget || !!noteBlockEditTarget;
    const isCheck = (!!noteCheckEditTarget && !noteBlockEditTarget) ||
                    (!editing && noteAddMode === 'check');   // 🆕 ＋☐「加入子事件」
    const isBlock = (!!noteBlockEditTarget && !noteCheckEditTarget &&
                     noteStripCheckboxBlock(inp ? inp.value : '') !== null) ||
                    (!editing && noteAddMode === 'text');    // 🆕 ＋☐「加入内容区块」
    toBlockBtn.hidden = !(isCheck || isBlock);
    toBlockBtn.textContent = isCheck ? '⇄ 原文模式' : '⇄ CheckBox 模式';
    toBlockBtn.title = isCheck
      ? '切换为原文模式：编辑既有区块会重新载入含 - [ ] 的 Markdown 原文；加入模式则改成原样加入 Markdown 区块'
      : '切换回 CheckBox 模式：编辑模式去掉 - [ ] 前缀；加入模式改回逐行包成子事件';
    toBlockBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (editing) {
        if (noteCheckEditTarget) noteSwitchCheckToBlockMode();
        else noteSwitchBlockToCheckMode();
      } else if (noteAddMode === 'check') noteSwitchAddToBlockMode();
      else noteSwitchAddToCheckMode();
    };
  }
  // 🆕 自动标示术语（便利贴窗是独立渲染进程，术语字典由主进程 sticky-note-terms 提供）
  const autoTermBtn = document.getElementById('autoTermCheckButton');
  if (autoTermBtn) {
    autoTermBtn.style.display = '';
    autoTermBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      noteAutoMarkTermsInEditBox();
    };
  }
  // 🆕 group 启用勾选：勾上→显示群标记输入并自动给出全篇不重复的 {gp}（可改）；取消→隐藏并清空
  const gpBox = document.getElementById('noteGroupEnable');
  if (gpBox) {
    gpBox.onchange = () => {
      const on = !!(gpBox.checked && !gpBox.disabled);
      const srcNow = (function () { const i = document.getElementById('addCheckInput'); return i ? i.value : ''; })();
      noteShowGroupMark(on, srcNow, false);
    };
  }
  // 🆕 自动标示术语「勾选确认」浮层按钮（onclick/onchange 幂等，绑定一次即可）
  const atOv = document.getElementById('autoTermOv');
  if (atOv) atOv.onclick = (event) => { if (event.target === atOv) noteAutoTermClose(); };  // 点背景关闭
  const atConfirm = document.getElementById('autoTermConfirm');
  if (atConfirm) atConfirm.onclick = (event) => { event.preventDefault(); event.stopPropagation(); noteAutoTermConfirm(); };
  const atCancel = document.getElementById('autoTermCancel');
  if (atCancel) atCancel.onclick = (event) => { event.preventDefault(); event.stopPropagation(); noteAutoTermClose(); };
  const atAll = document.getElementById('autoTermAllChk');
  if (atAll) atAll.onchange = () => {
    const list = document.getElementById('autoTermList');
    if (list) list.querySelectorAll('.at-chk').forEach((c) => { c.checked = atAll.checked; });
  };
}
// ── 🆕 自动标示术语（与主窗 tlAutoMarkTermsInText 同源规则）：
//    ① 已存在 [[...]] 保护区不重复标注；② 未标注字串最长匹配优先；③ 大小写不敏感精确匹配（字典去重本就不区分大小写）。
//    字典来源＝主进程 sticky-note-terms（扫描全部日历事件的 [[term...]]，与主窗 tlCollectTerms 同源）。
//    🆕 流程改为「列出候选项 + 勾选确认」：先展示待替换清单（默认全选），用户确认后才写回编辑框。
let noteAutoTermState = null;   // { src, accepted:[{start,end,term,marker}], inp }
async function noteAutoMarkTermsInEditBox() {
  const inp = document.getElementById('addCheckInput');
  if (!inp) return;
  if (!inp.value.trim()) { window.alert('编辑框为空，无可标示的内容'); return; }
  let terms = [];
  try {
    terms = await ipcRenderer.invoke('sticky-note-terms');
  } catch (error) {
    window.alert('读取术语字典失败：' + (error && error.message ? error.message : error));
    return;
  }
  const dict = (terms || [])
    .map((t) => ({ term: t.term, def: (t.def || '').trim() }))
    .filter((t) => t.term && t.term.length >= 2)
    .sort((a, b) => b.term.length - a.term.length);   // 长词优先
  if (!dict.length) {
    window.alert('目前没有可用的术语字典（需先在任意事件中定义 [[术语]] 或 [[术语:释文]]）');
    return;
  }
  const src = String(inp.value);
  const srcL = src.toLowerCase();   // 🆕 大小写不敏感匹配：字典去重按 toLowerCase，匹配口径须一致，否则定义过也会因大小写漏标
  // 1) 保护区：已存在的 [[...]] 不在此内标注（已标注的不重复标）
  const protectedSpans = [];
  let m; const br = /\[\[[^\]\n]*\]\]/g;
  while ((m = br.exec(src)) !== null) protectedSpans.push([m.index, m.index + m[0].length]);
  const inProtected = (i) => protectedSpans.some((sp) => i >= sp[0] && i < sp[1]);
  // 2) 收集候选命中（端点落入保护区则跳过）
  const cands = [];
  for (const d of dict) {
    const termL = d.term.toLowerCase(); let from = 0, idx;
    while ((idx = srcL.indexOf(termL, from)) !== -1) {
      const end = idx + d.term.length;   // 原始字串长度＝小写长度，定位用原串下標
      if (!inProtected(idx) && !inProtected(end - 1)) cands.push({ start: idx, end: end, term: d.term, def: d.def });
      from = idx + 1;
    }
  }
  // 3) 最长优先 + 非重叠贪心
  cands.sort((a, b) => (b.end - b.start) - (a.end - b.start) || a.start - b.start);
  const used = new Array(src.length).fill(false);
  const accepted = [];
  for (const c of cands) {
    let overlap = false;
    for (let i = c.start; i < c.end; i++) { if (used[i]) { overlap = true; break; } }
    if (overlap) continue;
    for (let i = c.start; i < c.end; i++) used[i] = true;
    const marker = (c.def && c.def.indexOf(']]') === -1) ? ('[[' + c.term + ':' + c.def + ']]') : ('[[' + c.term + ']]');
    accepted.push({ start: c.start, end: c.end, term: c.term, marker: marker });
  }
  if (!accepted.length) { window.alert('没有发现可标示的未标注术语'); return; }
  accepted.sort((a, b) => a.start - b.start);
  // 🆕 不直接写回：保存候选与原文，打开「勾选确认」浮层
  noteAutoTermState = { src: src, accepted: accepted, inp: inp };
  noteAutoTermRenderList();
  const ov = document.getElementById('autoTermOv');
  if (ov) ov.classList.add('show');
}
// 渲染候选项清单（默认全选；每项含上下文预览，避免同名多处混淆）
function noteAutoTermRenderList() {
  const st = noteAutoTermState;
  const list = document.getElementById('autoTermList');
  const allChk = document.getElementById('autoTermAllChk');
  if (!st || !list) return;
  list.innerHTML = '';
  if (allChk) allChk.checked = true;
  st.accepted.forEach((c, i) => {
    const label = document.createElement('label');
    label.className = 'at-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'at-chk'; chk.checked = true; chk.dataset.i = String(i);
    // 子项变化时同步「全选」主勾选状态
    chk.onchange = () => {
      const all = document.getElementById('autoTermAllChk');
      if (all) all.checked = list.querySelectorAll('.at-chk:checked').length === st.accepted.length;
    };
    const idx = document.createElement('span'); idx.className = 'at-idx'; idx.textContent = '第 ' + (i + 1) + ' 处';
    const term = document.createElement('span'); term.className = 'at-term'; term.textContent = c.term;
    const arrow = document.createElement('span'); arrow.className = 'at-arrow'; arrow.textContent = ' → ';
    const marker = document.createElement('span'); marker.className = 'at-marker'; marker.textContent = c.marker;
    label.append(chk, idx, term, arrow, marker);
    // 上下文预览（命中字串高亮）；换行转 ⏎ 以免破坏排版
    const ctx = document.createElement('div'); ctx.className = 'at-ctx';
    const b = document.createElement('span'); b.textContent = st.src.slice(Math.max(0, c.start - 12), c.start).replace(/\n/g, '⏎');
    const hl = document.createElement('span'); hl.className = 'at-hl'; hl.textContent = st.src.slice(c.start, c.end).replace(/\n/g, '⏎');
    const a = document.createElement('span'); a.textContent = st.src.slice(c.end, Math.min(st.src.length, c.end + 12)).replace(/\n/g, '⏎');
    ctx.append(b, hl, a);
    list.append(label, ctx);
  });
}
// 确认替换：仅写回被勾选的项（accepted 已非重叠，子集亦非重叠）
function noteAutoTermConfirm() {
  const st = noteAutoTermState;
  if (!st) return;
  const checks = document.querySelectorAll('#autoTermList .at-chk');
  const sel = [];
  checks.forEach((chk) => { if (chk.checked) sel.push(st.accepted[Number(chk.dataset.i)]); });
  if (!sel.length) { noteAutoTermClose(); window.alert('未勾选任何项目，未做替换'); return; }
  sel.sort((a, b) => a.start - b.start);
  let out = '', cursor = 0;
  for (const c of sel) { out += st.src.slice(cursor, c.start); out += c.marker; cursor = c.end; }
  out += st.src.slice(cursor);
  st.inp.value = out;
  st.inp.dispatchEvent(new Event('input', { bubbles: true }));
  noteAutoTermClose();
  window.alert('已自动标示 ' + sel.length + ' 处术语（最长匹配优先，已标注不重复）');
}
function noteAutoTermClose() {
  const ov = document.getElementById('autoTermOv');
  if (ov) ov.classList.remove('show');
  noteAutoTermState = null;
}
// ⚠️ 已弃用（2026-10-26）：不要再拿它当「写入底稿」。
//    它底层是 sourceEvent()，而对来自 INCLUDE 的便利贴只会回退到 refMeta 内存缓存 ——
//    那份缓存可能被主程式推来的陈旧快照回滚，拿它当底稿做整篇覆写会让已删除的旧内容复活
//    （「搬移后项目又回来」事故）。**凡涉及写入，一律改用 await fetchAuthoritativeNotes(key)。**
function eventNotesForKey(key) {
  const ev = sourceEvent(key);
  return ev ? ev.notes || '' : null;
}
function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
// 🆕 2026-11-08：小事件存檔的 cr/cp 標記改用「本機日期 + 本機時:分」（24H、無秒）。
//   刻意不用 toISOString()（那是 UTC）；getHours/getMinutes 才是使用者看到的本機時間。
//   ⚠️ 回歸腳本以 slice() 抽純函數時不會載入本函式 → 寫入點用 typeof 降級成純日期，
//      既有「固定 TODAY」斷言零回歸；想測新格式只要額外 stub localTimeString 即可。
function localTimeString(date = new Date()) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
// 備註 checkbox 行：確保帶有 [[cr:建立日期]] 標記（不存在才補今天；已有則不動，避免重複／改到原始建立日）。
// 建立日期一律排在最前：若正文已有 [[dl:…]]/[[cp:…]] 則插到它們前面；否則補在行尾。純函數，不改入參。
function ensureCrMarker(text) {
  if (/\[\[cr:\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/.test(text)) return text;  // 已有建立日：保留原值、不重複補
  const cr = '[[cr:' + localDateString() + (typeof localTimeString === 'function' ? ' ' + localTimeString() : '') + ']]';
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed.trim()) return cr;  // 空正文：直接給建立日標記（不帶前導空白）
  const m = text.match(/\[\[(dl|cp):\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/);
  if (m && typeof m.index === 'number') {
    return text.slice(0, m.index).replace(/\s+$/, '') + ' ' + cr + ' ' + text.slice(m.index);
  }
  return trimmed + ' ' + cr;
}
// ── group 标记语法（2026-11-06 宽放）：花括号内「开头」是 gp 或 group 即算；大小写不拘、冒号可省略 ──
//   {gp}＝{GP}＝{GroUP}＝{group} → 无名组；{gp:ABC}＝{gpABC}＝{GROUP:ABC} → 'ABC'；{gp1}＝{gp:1} → '1'。
//   ⚠️ 位置：标记必须在行尾、或行尾 [[...]] 标记序列之前才算结构标记；行中的 {gp} 是普通文字，原样显示也不分组。
//   前缀 group 优先于 gp；组名仍区分大小写；三式正则与桌面主窗／LITE／VIEW 引擎同口径。
// ── 🆕 group 启用（唯一小事件）：保存时把编辑框里「每一行」行尾标成同一个群标记，
//    使 tlSplitMdBlocks / view-sticky-rules 的「连续同 key 段」把整块认成一个小事件。
//  · 与 tlStripGpMarkers 完全对称：代码围栏行与围栏内文原样保留（不解析、不污染代码内容）。
//  · 2026-11-07：既有具名组（{gp:名稱}／{gpABC}）是使用者自訂的分組邊界，**绝不改写**。
//    旧版一律归一成 {gp}，会让当前群与前后同为 {gp} 的群连成一片（3 群融合成 1 群）。
//    新口径：已有行尾标记的行原样保留；没有标记的新行补上「本块第一个标记的字面量」；
//    整块都没有标记才补 {gp}（保留「主动把一般文字改成唯一小事件」的既有行为）。
//  · 行数不变 → 保存后 noteBlockEditTarget 的 start/end 区间仍然有效。
//  · 三端同口径：桌面主窗 tlApplyGroupMarkers／LITE calApplyGroupMarkers。
function noteHasCodeFence(text) {
  return /^\s*(```|~~~)/m.test(String(text == null ? '' : text));
}
// ── 🆕 块级（围栏式）小事件群（2026-11-08）：单独一行 {gpX} 开启、
//    单独一行 {/gpX} 结束，两行之间的 Markdown 整体算「一个」[[小事件群]]。
//  与桌面 tlGpFenceOfLine／tlGpFenceScan、LITE calGpFenceOfLine／calGpFenceScan 同口径。
//  便利贴窗正文 HTML 由主窗 tlRenderNotes 下发，这里只需「写入／预勾／改群标记」三件事。
function noteGpFenceOfLine(line) {
  const s = String(line == null ? '' : line).trim();
  let m = s.match(/^\{[ \t]*\/[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}[ \t]*$/i);
  if (m) return { kind: 'close', key: String(m[1] || '').trim() };
  m = s.match(/^\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}[ \t]*$/i);
  if (m) return { kind: 'open', key: String(m[1] || '').trim() };
  return null;
}
function noteGpFenceScan(lines) {
  const ranges = [], markers = [];
  let inFence = false, open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] == null ? '' : lines[i]);
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const f = noteGpFenceOfLine(line);
    if (!f) continue;
    if (f.kind === 'open') { if (!open) open = { i: i, key: f.key }; continue; }
    if (open && open.key === f.key) {
      ranges.push({ start: open.i, end: i, key: f.key });
      markers.push(open.i, i);
      open = null;
    }
  }
  return { ranges: ranges, markers: markers };
}
function noteGpFenceWrap(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  let s = 0, e = lines.length - 1;
  while (s <= e && !lines[s].trim()) s++;
  while (e >= s && !lines[e].trim()) e--;
  if (s > e) return null;
  const scan = noteGpFenceScan(lines);
  const hit = scan.ranges.find((r) => r.start === s && r.end === e);
  return hit ? { lines: lines, start: s, end: e, key: hit.key, scan: scan } : null;
}
// ── 🆕 2026-11-08：勾选「group 启用」按保存时一律写成块级 {gpX}…{/gpX}，不再逐行补行尾标记 ──
//  · 已是块级群且没给新标记 → 原样保留；给了 mark（群标记输入框）→ 整段改名（两行一起改）。
//  · 旧的「行尾式」群 → 先剥掉每行行尾标记，再沿用原本群名包成块级。
//  · 便利贴窗没有独立的显示层剥除函数，这里用 noteApplyGroupMarkers(text,false) 剥行尾标记。
//  · 与桌面 tlWrapGpFence／LITE calWrapGpFence 同口径；行数恒为「内容行数 + 2」。
function noteWrapGpFence(text, mark) {
  const canonical = (typeof noteNormalizeGpInput === 'function') ? noteNormalizeGpInput(mark || '') : (mark || '{gp}');
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  const wrap = (typeof noteGpFenceWrap === 'function') ? noteGpFenceWrap(text) : null;
  if (wrap) {
    if (!mark) return lines.join('\n');
    const out = lines.slice();
    out[wrap.start] = canonical;
    out[wrap.end] = '{/' + canonical.slice(1);
    return out.join('\n');
  }
  let open = mark ? canonical : '';
  if (!open) {
    for (const line of lines) {
      const m = line.match(/(\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*[^{}]*\})(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
      if (m) { open = m[1]; break; }
    }
  }
  open = open || '{gp}';
  const close = '{/' + open.slice(1);
  const stripped = (typeof noteApplyGroupMarkers === 'function')
    ? noteApplyGroupMarkers(lines.join('\n'), false) : lines.join('\n');
  const body = stripped.split('\n');
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (!body.length) return '';
  return [open].concat(body, [close]).join('\n');
}
// 🆕 2026-11-07：group 启用时自动给出一个「全篇不重复」的 {gp} 标记，避免与便利贴中前后小事件群合并。
//   · 扫描「当前便利贴」（KEY 对应的整篇 notes）里所有用过的 {gp:名称}，生成一个未占用的名称（A/B/C…）。
//   · 若当前编辑的区块本身已是整组，且它的名称在全篇只出现一次（无冲突），则沿用该名称，避免无谓改名。
//   · 名称大小写敏感（与切块器同口径）；标记统一规范成 {gp}（无名）或 {gp名称}（无冒号）形式。
// 把一行里的 {gp...} 字面量解析成「名称」（''＝无名 {gp}）
function noteParseGpName(literal) {
  let s = String(literal == null ? '' : literal).trim();
  s = s.replace(/^\{/, '').replace(/\}$/, '');
  const m = s.match(/^(?:gp|group)\s*:?\s*(.*)$/i);
  const rest = m ? m[1] : s;
  return rest.trim().replace(/[{}]/g, '');
}
// 名称 → 规范标记字面量
function noteCanonicalGp(name) {
  const n = String(name == null ? '' : name).trim().replace(/[{}]/g, '');
  return n === '' ? '{gp}' : '{gp' + n + '}';
}
// 规范化「用户输入」（可能带 / 不带花括号、可能带 gp 前缀）→ 规范标记；空 → {gp}
function noteNormalizeGpInput(input) {
  let s = String(input == null ? '' : input).trim();
  s = s.replace(/^\{/, '').replace(/\}$/, '');
  const m = s.match(/^(?:gp|group)\s*:?\s*(.*)$/i);
  const name = (m ? m[1] : s).trim().replace(/[{}]/g, '');
  return noteCanonicalGp(name);
}
// 扫描一篇 notes，返回 Map：name → 出现次数（''＝无名 {gp}），围栏内外都跳过围栏本身但保留围栏内文
function noteScanUsedGpNames(notes) {
  const map = new Map();
  const lines = String(notes || '').replace(/\r\n/g, '\n').split('\n');
  let fence = false;
  const re = /[ \t]*(\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*[^{}]*\})(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(re);
    if (m) {
      const name = noteParseGpName(m[1]);
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return map;
}
// 给出一个全篇未占用的标记：优先沿用「当前区块自身已用的、且全篇不冲突」的名称，否则生成 A/B/C…/1/2…
function noteSuggestGpMark(notes, blockSrc) {
  const used = noteScanUsedGpNames(notes);
  let blockName = null, blockCount = 0;
  if (blockSrc != null && noteIsWholeGpBlock(blockSrc)) {
    const ls = String(blockSrc).replace(/\r\n/g, '\n').split('\n');
    for (const line of ls) {
      const m = line.match(/\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
      if (m) { blockName = noteParseGpName(m[1]); break; }
    }
    blockCount = noteScanUsedGpNames(blockSrc).get(blockName) || 0;
  }
  // 「全篇不冲突」＝该名称在全篇的出现次数，扣掉「本块自身占用的次数」后仍为 0（即不在本块之外出现）
  if (blockName !== null && (used.get(blockName) || 0) - blockCount <= 0) {
    return noteCanonicalGp(blockName);   // 全篇只此一处（或本块独占）：安全沿用，不无谓改名
  }
  for (let i = 0; i < 26; i += 1) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return '{gp' + c + '}';
  }
  for (let n = 1; n < 1000; n += 1) {
    if (!used.has(String(n))) return '{gp' + n + '}';
  }
  return '{gpA}';
}
// 读取「group 标记输入框」当前值并规范化成保存用标记（空输入 → {gp}）；无输入框 → null
function noteGroupMarkValue() {
  const inp = document.getElementById('noteGroupMark');
  if (!inp) return null;
  return noteNormalizeGpInput(inp.value);
}
// 显示／隐藏群标记输入并给出建议（keep＝就地切模式时保留用户已填值，不重刷建议）
function noteShowGroupMark(show, src, keep) {
  const markRow = document.getElementById('noteGroupMarkRow');
  const markInput = document.getElementById('noteGroupMark');
  const markHint = document.getElementById('noteGroupMarkHint');
  if (!markRow || !markInput) return;
  markRow.style.display = show ? '' : 'none';
  if (!show) { markInput.value = ''; return; }
  if (!keep || !markInput.value.trim()) {
    markInput.value = noteSuggestGpMark(noteCurrentNotes(), src);
  }
  if (markHint) markHint.textContent = '保存时整段以此标记分组，避免与前后小事件群合并（可修改）';
  noteGroupMarkBaseline = markInput.value;   // 基线＝建议值（开框即基准，手动改才变脏）
}
// 当前便利贴整篇 notes（本地缓存优先，与写入安全网同口径）
function noteCurrentNotes() {
  const m = refMeta.get(KEY);
  return (m && typeof m.notes === 'string') ? m.notes : '';
}
//  · **纯空白行保持空白**：空白行在 {gp} 规则里是「上一行的延续」，不能被写成内容行，
//    否则 group 启用保存后空行会变成 '{gp}'，段落间隔就被破坏了（2026-11-06 空白行规则）。
//  · 🆕 2026-11-07：forceMark（用户指定的群标记）优先——保存时整段统一成该标记，避免与前后群合并；
//    无 forceMark 时沿用既有口径（扫描本块第一个标记、保留既有具名组、绝不归一）。
function noteApplyGroupMarkers(text, on, forceMark) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  // 🆕 块级群：边界已是硬分组，勾选时绝不逐行补行尾标记（会双重分组／破坏原文）；
  //    forceMark 则整段改名（{gpX} 与 {/gpX} 一起改）；取消勾选把两行标记「置空」拆组，行数恒不变。
  const fenceScan = (typeof noteGpFenceScan === 'function') ? noteGpFenceScan(lines) : { ranges: [] };
  if (fenceScan.ranges.length) {
    if (!on) {
      const out = lines.slice();
      fenceScan.ranges.forEach((r) => { out[r.start] = ''; out[r.end] = ''; });
      return out.join('\n');
    }
    const mark = noteNormalizeGpInput(forceMark || noteCanonicalGp(fenceScan.ranges[0].key));
    const closeMark = '{/' + mark.slice(1);
    const out = lines.slice();
    fenceScan.ranges.forEach((r) => { out[r.start] = mark; out[r.end] = closeMark; });
    return out.join('\n');
  }
  // 本块基准标记：forceMark 优先（用户指定的群标记，参考它保存，避免与前后群合并）；
  // 否则只扫围栏外的行取「本块第一个标记的字面量」（沿用既有具名组，绝不归一）。
  let baseMark = forceMark ? forceMark : '';
  if (!forceMark) {
    let fence = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const m = line.match(/[ \t]*(\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*[^{}]*\})(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
      if (m) { baseMark = m[1]; break; }
    }
  }
  let inFence = false;
  return lines.map(function (line) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    if (!line.trim()) return line;
    const stripped = line.replace(/[ \t]*\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*[^{}]*\}(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/gi, '');
    // 没标记的行必须原样回传（尤其 on=false）：行尾两空格是 Markdown 换行语义，不能顺手清掉
    const clean = stripped === line ? line : stripped.replace(/[ \t]+$/, '');
    if (!on) return clean;                  // 拆组：沿用既有行为
    if (!forceMark && stripped !== line) return line;  // 无 forceMark：已有标记原样保留（含具名组，绝不归一）
    return clean + (baseMark || '{gp}');    // 新行补齐成同一组 / forceMark：整段统一成用户指定的标记
  }).join('\n');
}
function noteIsWholeGpBlock(text) {
  const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  // 🆕 块级群本身已是「唯一小事件」：即使内容含代码围栏也照常预勾（不逐行加标记，围栏安全）
  if (typeof noteGpFenceWrap === 'function' && noteGpFenceWrap(raw)) return true;
  if (noteHasCodeFence(raw)) return false;
  const lines = raw.split('\n');
  let key = null, seen = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = lines[i].match(/\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
    if (!m) return false;
    const k = String(m[1] || '').trim();
    if (!seen) { key = k; seen = true; }
    else if (k !== key) return false;
  }
  return seen;
}
function noteResolveGroupText(raw, checked, wasOn, mark) {
  // 🆕 2026-11-08：编辑「内容区块」勾选 group 启用 → 一律改写成块级 {gpX}…{/gpX}
  //    （旧的行尾式群就地升级：剥掉每行行尾标记、沿用群标记输入框的值包成块级）。
  if (checked) return (typeof noteWrapGpFence === 'function') ? noteWrapGpFence(raw, mark) : noteApplyGroupMarkers(raw, true, mark);
  if (wasOn) return noteApplyGroupMarkers(raw, false);   // 原本整组、使用者主动取消 → 拆回多个小事件
  return raw;                                            // 原本不是整组：使用者手写的 {gp} 原样保留
}
// 「group 启用」目前在哪种编辑模式：block＝既有区块／check＝编辑子事件／add＝加入子事件／off＝表格、自由文本新增
function noteGroupMode() {
  if (noteBlockEditTarget && !noteCheckEditTarget) return 'block';
  if (noteCheckEditTarget) return 'check';
  if (noteAddMode === 'check') return 'add';
  return 'off';
}
function noteGroupChecked() {
  const box = document.getElementById('noteGroupEnable');
  return !!(box && box.checked && !box.disabled);
}
// 把「已经包装成 Markdown 行」的整段按 group 勾选收敛（＋☐ 加入 / 编辑子事件共用）：
//   · 勾选 → 逐行补 {gp}，每个 checkbox 行各自补 1 个 cr（2026-11-07：只有 checkbox 需要建立日）
//   · 原本整组却取消 → 移除 {gp}（拆回多个小事件）＋逐行补 cr
//   · 其余 → 直接走 fallback，完全沿用原本的逐行 cr 写法（零回归）
function noteGroupMd(rawMd, fallback, fenceWrap) {
  const on = noteGroupChecked();
  if (!on && !noteGroupWasOn) return fallback();
  const mark = on ? noteGroupMarkValue() : null;
  let resolved;
  if (fenceWrap) {
    // 🆕 新增「＋☐ 加入子事件」：整批包成一个块级小事件群
    resolved = (typeof noteWrapGpFence === 'function')
      ? (on ? noteWrapGpFence(rawMd, mark) : (noteGroupWasOn ? noteApplyGroupMarkers(rawMd, false) : rawMd))
      : noteResolveGroupText(rawMd, on, noteGroupWasOn, mark);
  } else {
    // 编辑「单个 CheckBox 子事件」：target 只是群内局部行，包块会嵌套 → 沿用旧行尾式
    resolved = on ? noteApplyGroupMarkers(rawMd, true, mark)
      : (noteGroupWasOn ? noteApplyGroupMarkers(rawMd, false) : rawMd);
  }
  if (on) return ensureCrMarkersForCheckboxLines(resolved);
  return resolved.split('\n').map(function (l) { return ensureCrMarker(l); }).join('\n');
}
// 单一 setter：开窗／关窗／切模式都走它，避免某一种入口把勾选状态带到下一种模式。
//   keep＝就地切模式（加入成功→编辑刚加入的那段）时保留勾选；hide＝关窗强制隐藏。
function noteSyncGroupUi(src, keep, hide) {
  const row = document.getElementById('noteGroupRow');
  const box = document.getElementById('noteGroupEnable');
  const label = row && row.querySelector('span');
  const mode = noteGroupMode();
  const show = !hide && mode !== 'off';
  const type = mode === 'block' ? noteBlockEditTarget.type : '';
  // 代码块（或内含围栏）不适用：围栏行加标记会破坏 isFence，围栏内标记又会原样显示
  // 🆕 例外：整段已是「块级 {gpX}…{/gpX} 群」时不逐行加标记，围栏完全安全 → 照常启用
  const isFenceGroup = (typeof noteGpFenceWrap === 'function') && !!noteGpFenceWrap(src);
  const enabled = show && (isFenceGroup || (!(mode === 'block' && type === 'code') && !noteHasCodeFence(src)));
  // add 是「还没写入的草稿」永遠不预勾；block/check 依开框原文侦测
  const detected = (mode === 'block' || mode === 'check') && enabled && noteIsWholeGpBlock(src);
  noteGroupWasOn = !!detected;
  const preset = keep && box && show ? box.checked : detected;
  if (row) {
    row.style.display = show ? '' : 'none';
    row.classList.toggle('is-disabled', !enabled);
  }
  if (label) label.textContent = enabled ? 'group 启用（唯一小事件）' : 'group 启用（代码块不适用）';
  if (box) {
    box.disabled = !enabled;
    box.checked = !!preset && !!enabled;   // 默认不启用；只有原本已是整组才预勾
  }
  noteGroupBaseline = !!(box && box.checked && !box.disabled);
  // 🆕 group 标记输入：只在 group 启用勾选时显示，并自动给一个全篇不重复的 {gp} 标记（可改）
  const showMark = !hide && enabled && !!(box && box.checked && !box.disabled);
  noteShowGroupMark(showMark, src, keep);
  return enabled;
}
// 編輯小圓點「單元」補 1 個 [[cr:建立日]]（不是每個自然行都加！）；與行事曆 tlEnsureCrMarkerForBlock 同口徑，單元只補 1 個
function ensureCrMarkerForBlock(blockText) {
  if (/\[\[cr:\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/.test(blockText)) return blockText;  // 單元已含 cr：保留原值、不重複補
  const lines = String(blockText).replace(/\r\n/g, '\n').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last < 0) return '[[cr:' + localDateString() + (typeof localTimeString === 'function' ? ' ' + localTimeString() : '') + ']]';
  const cr = '[[cr:' + localDateString() + (typeof localTimeString === 'function' ? ' ' + localTimeString() : '') + ']]';
  const whole = lines[last];
  // 🆕 {gp} 組最後一行帶分組標記：cr 插在標記之前（與主程式 tlEnsureCrMarkerForBlock 同口徑），
  //    否則標記會被 cr 擠到行中間、原檔可讀性變差。無標記時行為與舊版完全一致。
  const gp = whole.match(/\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*[^{}]*\}(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
  const cut = (gp && typeof gp.index === 'number') ? gp.index : whole.length;
  const head = whole.slice(0, cut), tail = whole.slice(cut);
  const m = head.match(/\[\[(dl|cp):\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/);
  if (m && typeof m.index === 'number') {
    lines[last] = head.slice(0, m.index).replace(/\s+$/, '') + ' ' + cr + ' ' + head.slice(m.index) + tail;
  } else {
    lines[last] = head.replace(/\s+$/, '') + ' ' + cr + tail;
  }
  return lines.join('\n');
}
// 🆕 2026-11-07：只有「可點選完成」的 checkbox 行才需要建立日 —— 逐行各補 1 個 [[cr:…]]，
//   不再讓整群共用 1 個；非 checkbox 行（純文字／標題／表格／程式碼）一律原樣保留。
//   單行格式（cr 插在 {gp} 之前、dl/cp 之前、已有 cr 不動）仍交給 ensureCrMarkerForBlock，
//   避免兩套邏輯；代碼圍欄整段跳過，不誤改程式碼內容。
function ensureCrMarkersForCheckboxLines(blockText) {
  let inFence = false;
  return String(blockText == null ? '' : blockText).replace(/\r\n/g, '\n').split('\n').map(function (line) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    if (!/^\s*-\s+\[[ xX]\]\s?/.test(line)) return line;   // 非 checkbox：不注入 cr
    return ensureCrMarkerForBlock(line);                    // 單行＝一個單元，已有 cr 自行短路
  }).join('\n');
}
function transformNoteCheck(line, checked) {
  const match = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!match) return null;
  let text = match[3] || '';
  if (checked) {
    text = text.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, '[[dl:$1]]');
    if (!/\[\[cp:\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/.test(text)) {
      text = text.replace(/\s+$/, '') + ' [[cp:' + localDateString() + (typeof localTimeString === 'function' ? ' ' + localTimeString() : '') + ']]';
    }
  } else {
    text = text.replace(/\s*\[\[cp:\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\]\]/g, '');
  }
  return match[1] + '- [' + (checked ? 'x' : ' ') + '] ' + ensureCrMarker(text);
}
// ============================================================
// 🆕 写入安全网（2026-10-26）：「便利贴窗只持有 calendar.md 路径」是既有限制，
//    凡来自 INCLUDE 的便利贴（如 calendar-我的iphone.md），其 notes 底稿在无 FD 可读的情况下
//    只能靠 refMeta 内存缓存 —— 而这个缓存会被主程式推来的快照无条件覆盖。一旦推来的是
//    稍旧时序的值，后续任何「底稿 + 新内容」的整篇覆写就会把已删除的旧内容写回去。
//    这正是「搬移后项目又复活」事故的根因（2026-10-26）。三重防护：
//      ① 底稿权威化：refMeta 优先（比主进程目录快照即时），只有本地无记录时才 IPC 拉目录；
//      ② 陈旧保护：本地刚确认的写入不被推送的 notes 覆盖，**直到推送内容与本地收敛**才解除；
//      ③ 写后校验：回读确认真的反映了预期结果（某行必须消失 / 必须出现）。
// ============================================================
const NOTE_SHORTEN_MAX = 24;
function shortenNoteText(s) {
  const t = String(s || '').replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim();
  return t.length > NOTE_SHORTEN_MAX ? (t.slice(0, NOTE_SHORTEN_MAX) + '…') : (t || '(空白)');
}
// ① 底稿权威化：取指定便利贴的最新 notes（null＝拿不到，调用端须自行处理）
//
//    ⚠️ 来源优先顺序（2026-10-26 修）：**本地 refMeta 优先，主进程目录次之。**
//    主进程的便利贴目录（sticky-note-order → stickyNoteCatalog）只在主程式「整批 sync」时才刷新
//    （windows.js:889），便利贴刚写回后它**仍是写入前的旧快照**。若把它当底稿做整篇覆写，
//    刚加入的那一项会被抹掉 —— 正是「加入 AAAAA 后再加 BBBBB，AAAAA 消失」的回归。
//    refMeta 由两个渠道维护且都比目录即时：① 本地写入确认（markAuthWrite）② 主程式 refresh 推送。
//    因此：本地有值就用本地；本地还没有这笔记录时，才向目录拉取。
async function fetchAuthoritativeNotes(key) {
  const local = refMeta.get(key);
  if (local && typeof local.notes === 'string') return String(local.notes);
  let result = null;
  try { result = await ipcRenderer.invoke('sticky-note-order'); } catch (e) { return null; }
  const arr = (result && Array.isArray(result.notes)) ? result.notes : [];
  const hit = arr.find((n) => n && n.key === key);
  return hit ? String(hit.notes || '') : null;
}
// ② 陈旧保护：记录本地刚确认写入的 notes，并竖起「本地权威」旗标
//    （rememberRefMeta 会据此拒绝主程式推来的旧快照，直到推送内容与本地收敛）
function markAuthWrite(key, notes) {
  const cur = refMeta.get(key) || {};
  cur.notes = notes;
  cur.__writeAt = Date.now();
  cur.__localWrite = true;
  refMeta.set(key, cur);
}
// 手动解除「本地权威」（使用者主动按 🔄 刷新、或重绘整窗口时）：重新采信主程式推来的值
function clearAuthWriteGuard(key) {
  const cur = refMeta.get(key);
  if (!cur) return;
  cur.__localWrite = false;
  refMeta.set(key, cur);
}
// ③ 写后校验：actualNotes 是否满足 expect = { absent?: string[], present?: string[] }
function verifyNoteExpectation(actualNotes, expect) {
  const lines = String(actualNotes || '').split('\n').map((l) => l.trim());
  const absent = (expect && Array.isArray(expect.absent)) ? expect.absent : [];
  for (let i = 0; i < absent.length; i += 1) {
    const t = String(absent[i]).trim();
    if (t && lines.indexOf(t) >= 0) return '「' + shortenNoteText(t) + '」仍然存在（删除未生效）';
  }
  const present = (expect && Array.isArray(expect.present)) ? expect.present : [];
  for (let i = 0; i < present.length; i += 1) {
    const t = String(present[i]).trim();
    if (t && lines.indexOf(t) < 0) return '「' + shortenNoteText(t) + '」未出现在目标便利贴（写入未生效）';
  }
  return null;
}
// 🆕 核心：把 notes 回写到「指定便利贴」；返回 { ok, error, warn }，不弹 alert（供搬移用 toast 回报）。
//    eventIdx/eventSrc 传 null＝沿用当前张的全局 IDX/SRC_FILE（向后兼容既有调用）。
//    opts.expect = { absent?, present? }：写回后回读校验，不符即回报失败，避免静默留下重复资料。
async function commitStickyNoteContent(notes, eventKey, eventIdx, eventSrc, opts) {
  if (addCheckSavePending) return { ok: false, error: '有其它保存进行中，请稍后再试' };
  addCheckSavePending = true;
  try {
    const targetKey = eventKey || KEY;
    const targetIdx = (eventIdx == null) ? IDX : (+eventIdx || 0);
    const targetSrc = (eventSrc == null) ? SRC_FILE : eventSrc;
    const result = await ipcRenderer.invoke('sticky-note-save-edit', { key: targetKey, idx: targetIdx, notes, src: targetSrc });
    if (!result || !result.success) return { ok: false, error: ((result && result.error) || '主进程未确认保存') };
    // 本地缓存同步（外部 include 文件的内容只存在于 refMeta，不走本地 calendar.md）
    markAuthWrite(targetKey, notes);          // ② 陈旧保护的起点：记版本，后面的推送不能在保护窗口内覆盖它
    // ③ 写后校验：回读主程式的权威值，确认真的反映了预期结果（删除的行必须消失／加入的行必须出现）
    const expect = (opts && opts.expect) || null;
    if (expect) {
      const fresh = await fetchAuthoritativeNotes(targetKey);
      if (fresh == null) {
        return { ok: true, warn: '无法回读确认写回结果，请重开便利贴确认内容是否正确' };
      }
      const bad = verifyNoteExpectation(fresh, expect);
      if (bad) return { ok: false, error: bad, verifyFailed: true };
    }
    const savedEvent = sourceEvent(targetKey);
    ipcRenderer.send('sticky-note-refresh-request', {
      key: targetKey,
      idx: targetIdx,
      title: savedEvent ? savedEvent.title : '',
      date: savedEvent ? savedEvent.date : ''
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error && error.message) ? error.message : String(error) };
  } finally {
    addCheckSavePending = false;
  }
}
async function saveStickyNoteContent(notes, errorLabel, eventKey) {
  const r = await commitStickyNoteContent(notes, eventKey, null, null);
  if (!r.ok) window.alert(errorLabel + '失败：' + r.error);
  return r.ok;
}
window.tlToggleNoteCheck = async function (event, uid, line) {
  const checkbox = event && event.target.closest('.ev-cb.interactive');
  if (!checkbox || checkbox.dataset.uid !== uid) return;
  event.preventDefault();
  event.stopPropagation();
  if (addCheckSavePending) return;
  // 🆕 ① 底稿权威化：勾选也是整篇写回，底稿必须现拉现用
  const notes = await fetchAuthoritativeNotes(uid);
  if (notes == null) {
    window.alert('无法读取该便利贴的最新内容，已取消更新（请重开便利贴后再试）。');
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
window.tlOpenEditNoteCheckDialog = async function (event, uid, line) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!event || !event.target.closest('.ev-md-edit')) return;
  // 🆕 ① 底稿权威化：打开编辑框时的内容与行号必须取自最新权威值，否则会对错行落笔
  const notes = await fetchAuthoritativeNotes(uid);
  if (notes == null) {
    window.alert('无法读取该便利贴的最新内容，已取消编辑（请重开便利贴后再试）。');
    return;
  }
  const lines = notes.split('\n');
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return;
  const match = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!match) {
    window.alert('该子事件内容已变化，请刷新便利贴后重试');
    return;
  }
  noteCheckEditTarget = { uid, line, count: 1 };
  noteBlockEditTarget = null;
  noteAddMode = 'check';
  noteExitTableMode();   // 🆕 子事件入口一律用不上网格
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑子事件（CheckBox）';
    ov.querySelector('.ac-hint').textContent = '⌘S 保存（不关闭，可继续编辑）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；勾选状态会保留，日期标记（[[cr:…]] 建立日／[[dl:…]] 预计完成／[[cp:…]] 完成日，建立日会自动补在最前面）以原文显示可直接编辑；换行（shift+enter）＝拆成多个子事件（第一行保留本条的勾选状态）；清空内容并保存＝删除该子事件（会先确认）';
    ov.classList.add('show');
  }
  bindAddCheckTools();
  if (inp) {
    // 🆕 原文保真：编辑框显示原始文本（含 [[dl:…]]/[[cp:…]] 等 [[]] 符号），不剥离、不折叠空白；保存时直接写回
    inp.value = match[3];
    noteSyncGroupUi(match[3]);   // 🆕 编辑子事件也提供 group 勾选；原文已带 {gp} 时预勾
    inp.placeholder = '输入子事件内容…';
    markAddCheckBaseline();   // 🆕 基线＝开框原文，之后有任何差异都会在关闭前询问
    setTimeout(() => inp.focus(), 0);
  }
};

// ===== 🆕 右键 checkbox 编辑小圆点（.ev-md-edit）→ 下拉菜单「找出相同的项目」 =====
// 目的：多档联运下，同一 checkbox 子事件可能出现在多个 calendar*.md；右键该小圆点 →
//   拿「该子事件的内容（checkbox 文本）」去比对所有便利贴（主档＋并入的联运档都算），找出含相同子事件的其它张。
//   左键 ✎ 仍进编辑（onclick＝tlOpenEditNoteCheckDialog，contextmenu 与 click 分流不冲突）。
let noteFindSameTarget = null;      // { uid＝比对时排除的「自己」, srcUid＝来源/落盘那张, srcTitle, line, text, view }
// 🆕 待搬移目标：右键那颗 checkbox 的身份。noteFindSameRun 会先 noteFindSameClose() 清掉
//    noteFindSameTarget，故「未找到」时另存一份，供结果窗里的「搬移」按钮使用。
let noteFindSameMoveTarget = null;
// 🆕 本次「找出相同」的目标文本（可能是整块多行）：切换时用来做「按内容定位」兜底——
//    当 .md-unit / .ev-cb 都找不到时（例如该贴正文走的是整段渲染分支、没有区块包裹），
//    改用渲染后的纯文字比对定位行元素（2026-10-30：非 checkbox 行切换后不闪烁）。
let noteFindSameCurText = '';
async function noteFindSameOpen(e) {
  noteBlockMenuClose();          // 开任一套菜单前，先收掉另一套，避免重叠
  const dot = e.target.closest && e.target.closest('.ev-md-edit');
  if (!dot) return;              // 不是小圆点：不拦截，交给浏览器原生右键
  e.preventDefault();            // 阻止原生右键
  const uid = dot.getAttribute('data-uid') || '';
  const line = dot.getAttribute('data-line');
  const pt = { x: e.clientX, y: e.clientY };   // await 前先留住坐标（原生事件对象不回收，但留一手更安全）
  // 🆕 投影贴（🔔 提醒／自订 VIEW 贴）的圆点：内文已经带在 data-text 上，不回读来源行程 ——
  //    来源行程可能根本没设便利贴，refMeta／目录里查不到它；而且这里只读，不存在「对错行落笔」。
  const isView = isViewKey(uid);
  let text, srcUid, srcTitle = '', li;
  if (isView) {
    text = (dot.getAttribute('data-text') || '').trim();
    srcUid = dot.getAttribute('data-src') || '';
    srcTitle = (dot.getAttribute('data-stitle') || '').trim();
    li = Number(line);
    if (!text) { window.alert('该提醒没有内容，无法比对相同项目'); return; }
  } else {
    // 🆕  底稿权威化：这里算出的 li 直接决定后续要删／搬哪一行，
    //    用陈旧的 refMeta 会对错行落笔 —— 代价远大于菜单晚几十毫秒弹出，故一律现拉现用。
    const notes = await fetchAuthoritativeNotes(uid);
    if (notes == null) { window.alert('无法读取该便利贴的最新内容，请重开便利贴后再试'); return; }
    const lines = String(notes).split('\n');
    li = Number(line);
    if (!Number.isInteger(li) || li < 0 || li >= lines.length) { window.alert('该子事件内容已变化，请刷新便利贴后重试'); return; }
    const m = lines[li].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (!m) { window.alert('该子事件内容已变化，请刷新便利贴后重试'); return; }
    text = (m[3] || '').trim();
    srcUid = uid;
    if (!text) { window.alert('该子事件没有内容，无法比对相同项目'); return; }
  }
  // ⚠️ uid＝「自己」的身份证（比对时整张排除）。投影贴的「自己」只有它自己那张 key：
  //    它的内容全是从来源行程的便利贴抓过来的，来源那张恰恰是「找出相同」要给出的答案，
  //    拿 srcUid 当自己排除掉＝必然报「没有找到」（2026-10-27 用户两轮实测抓到）。
  //    自订贴的 key 是 __view__:<规则 id>，所以要原样带 uid，不能写死成 __view__（否则比对排错张）。
  //    来源身份另存 srcUid，只用于把结果标成「它的来源」。
  noteFindSameTarget = { uid: isView ? uid : srcUid, srcUid: srcUid, srcTitle: srcTitle, line: li, text: text, view: isView };
  const menu = document.getElementById('noteFindSameMenu');
  if (!menu) return;
  // 🆕 投影贴＝只读投影：搬移／删除会异动资料（而且没有对应的落盘位置），菜单里直接收起。
  //    「📝 切换编辑行程并定位」是纯查看动作，VIEW 贴照样保留（它用 data-src 找来源行程）。
  //   ⚠️ 靠 .nami[hidden]{display:none !important}（desktop-note.html）才真的不见：
  //      单靠 hidden 属性会被 .note-addcheck-menu .nami{display:block} 压过去（2026-10-27 实测踩过）
  menu.querySelectorAll('.nami').forEach((item) => {
    const act = item.getAttribute('data-act');
    if (act === 'move' || act === 'del') item.hidden = isView;
  });
  const noteEl = document.getElementById('note');
  const rect = noteEl.getBoundingClientRect();
  menu.classList.add('open');   // 先開，才量得到尺寸（base 是 display:none）
  const mw = menu.offsetWidth || 160;
  const mh = menu.offsetHeight || 40;
  let left = pt.x - rect.left;
  let top = pt.y - rect.top;
  if (top + mh > rect.height - 2) top = Math.max(2, top - mh);   // 太靠下 → 往上翻
  if (left + mw > rect.width - 2) left = Math.max(2, left - mw);  // 太靠右 → 往左翻
  menu.style.left = String(Math.max(2, left)) + 'px';
  menu.style.top = String(top) + 'px';
}
function noteFindSameClose() {
  const menu = document.getElementById('noteFindSameMenu');
  if (menu) menu.classList.remove('open');
  noteFindSameTarget = null;
}
// 🆕 比对前主动让「主进程便利贴目录」收敛。
//    背景：sticky-note-order 回的是主进程的 stickyNoteCatalog 快照，只有主程式整份
//    sticky-note-sync 时才刷新。使用者在另一张便利贴删掉某项后，这份快照往往还是旧的 ——
//    直接拿它比对会把「早就删掉」的项目报成「仍然存在」，产生难以理解的讯息。
//    因此比对前先发一次 refresh-request 让主程式重算并整份 sync，等到回包（或超时）再读。
function awaitStickyNotesSync(timeoutMs) {
  return new Promise((resolve) => {
    let requestId = '';
    try {
      requestId = 'sticky-find-sync-' + Date.now() + '-' + (++stickyRefreshSeq);
    } catch (e) { resolve(); return; }
    let settled = false;
    const titleEl = document.getElementById('title');
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ipcRenderer.removeListener('sticky-note-refresh-result', onResult); } catch (e) {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs || 3000);
    const onResult = (event, result) => {
      if (!result || result.requestId !== requestId) return;
      finish();
    };
    try { ipcRenderer.on('sticky-note-refresh-result', onResult); } catch (e) {}
    ipcRenderer.send('sticky-note-refresh-request', {
      requestId,
      key: KEY,
      idx: IDX,
      title: (titleEl ? (titleEl.textContent || '') : '').replace(/\s+/g, ' ').trim(),
      date: ''
    });
  });
}
// 🆕 抽出「重复比对」为共用逻辑：检查某子事件（checkbox 文本）是否在其它便利贴出现相同内容。
//    返回 { allNotes, matches }：matches＝其它含相同 checkbox 文本的便利贴列表（带命中行号，1-based）。
//    两处复用：①「找出相同的项目」；②「搬移项目」前置查重（命中即阻断搬移，避免产生重复资料）。
async function noteFindSameComputeMatches(target) {
  const curUid = target.uid;
  const curText = target.text;
  // 🆕 先等目录收敛再比对，避免拿快照把已删除的项目报成「仍存在」
  await awaitStickyNotesSync();
  let result = null;
  try { result = await ipcRenderer.invoke('sticky-note-order'); } catch (err) { result = null; }
  const allNotes = (result && Array.isArray(result.notes)) ? result.notes : [];
  const allEvents = (result && Array.isArray(result.events)) ? result.events : [];
  // 可搜索集合＝① 便利贴目录（实体便利贴，可翻页切换）＋ ② 全部行程（含未设便利贴的普通行程，
  //    供 VIEW 投影贴找回「来源行程」与「其它普通行程」里的相同内容）。
  // ⚠️ 去重：普通行程若本身就是某张实体便利贴（key===uid），目录版优先（可翻页跳转），事件版跳过，避免同张出现两次。
  const seenStickyKey = new Set();
  const searchList = [];
  allNotes.forEach((n) => {
    if (!n || typeof n.key !== 'string') return;
    if (isViewKey(n.key)) return;            // 🆕 投影贴（🔔＋自订）里本来就是各来源行程内容的复本，算它＝永远「找到相同」，是噪音
    seenStickyKey.add(n.key);
    searchList.push({ kind: 'sticky', note: n, uid: n.key });
  });
  allEvents.forEach((ev) => {
    const uid = ev && ev.uid ? String(ev.uid) : '';
    if (!uid || seenStickyKey.has(uid)) return;   // 已是实体便利贴→用目录版（可翻页跳转）
    searchList.push({ kind: 'event', note: ev, uid });
  });
  // 目标可能是「单行」（旧单行圆点）或「整块」（VIEW 投影贴把连续同类行并成 1 个圆点、data-text 携带整块原文）。
  const curLines = String(curText || '').split('\n');
  const isBlock = curLines.length > 1;
  // 排除「自己」那一张（target.uid＝圆点所在的那张；投影贴的 uid 是 __view__，所以来源那张不会被排掉——
  //   它正是答案本身，见 noteFindSameOpen 的 ⚠️ 注释）；其它張只要「至少含一段与目标完全相同的内容」即视为命中。
  const matches = [];
  searchList.forEach((item) => {
    const n = item.note;
    if (!n) return;
    if (item.kind === 'sticky' && n.key === curUid) return;   // 排除「自己」那张实体便利贴
    const nl = String(n.notes || '').split('\n');
    const hitLines = [];     // 每个命中＝行号数组（单行＝[k+1]；整块＝[起..止] 扁平）
    const hitDone = [];
    if (isBlock) {
      // 🆕 整块比对：在目标备注里找「逐行 trim 后」与 curLines 完全一致的连续行段，记其行号区间。
      for (let k = 0; k + curLines.length <= nl.length; k += 1) {
        let ok = true;
        for (let m = 0; m < curLines.length; m++) {
          if (nl[k + m].trim() !== curLines[m].trim()) { ok = false; break; }
        }
        if (ok) { for (let m = 0; m < curLines.length; m++) { hitLines.push(k + 1 + m); hitDone.push(false); } }
      }
    } else {
      const single = curLines[0].trim();
      for (let k = 0; k < nl.length; k += 1) {
        const raw = nl[k];
        const mm = raw.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
        // 🆕 同时比对 checkbox 内容（mm[3]）与非 task 行整行（raw.trim()）：
        //    之前只比 checkbox → 投影贴里的「列表/胶囊/段落」行（如 [[超链接执行]]）永远比不到，
        //    而它恰恰常是使用者想找回来源的那一行（2026-10-29 用户回报）。
        const lineText = mm ? (mm[3] || '').trim() : raw.trim();
        if (lineText && lineText === single) { hitLines.push(k + 1); hitDone.push(mm ? (mm[2] !== ' ') : false); }
      }
    }
    if (hitLines.length) matches.push({ note: n, lines: hitLines, doneFlags: hitDone, kind: item.kind, uid: item.uid });
  });
  return { allNotes, allEvents, matches };
}

// 浮层里显示长文案一律截断：便利贴只有 240px 宽，整段回显会把结果盖掉（全文挂 title 悬停看）。
function noteClipText(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const lim = max || 36;
  return s.length > lim ? s.slice(0, lim) + '…' : s;
}

async function noteFindSameRun() {
  const target = noteFindSameTarget;
  noteFindSameClose();
  if (!target) return;
  const { matches } = await noteFindSameComputeMatches(target);
  // 🆕 记住本次目标文本：切换时若行号定位不到（区块不存在／行号因过滤位移），改用内容比对兜底
  noteFindSameCurText = String(target.text || '');
  const ov = document.getElementById('findSameOv');
  const list = document.getElementById('findSameList');
  if (!ov || !list) return;
  const titleEl = document.getElementById('findSameTitle');
  const moveBtn = document.getElementById('findSameMoveBtn');
  const clip = noteClipText(target.text);
  const setHead = (txt) => {
    if (!titleEl) return;
    titleEl.textContent = txt;
    titleEl.title = String(target.text || '');   // 悬停看全文
  };
  const itemHtml = (m, tag) => {
    const n = m.note;
    const title = escapeHtml(n.title || '(无标题)');
    const date = n.date ? '（' + escapeHtml(n.date) + '）' : '';
    const src = n.src ? (' @ ' + escapeHtml(n.src)) : ' @ 主档';
    const lineTxt = m.lines.length === 1
      ? '第 ' + m.lines[0] + ' 行'
      : '第 ' + m.lines.join('、') + ' 行';
    // 🆕 切换按钮：data-line0 为 0-based 行号（body 内 .ev-cb[data-line] 用 0-based），点击后翻到该张并滚动到该行；
    //    data-done＝命中首行是否为已完成项目（供「来源贴只看未完成」时给出双闪 toast 例外）。
    //    🆕 data-kind：实体便利贴(sticky)→翻页切换；普通行程(event，如 VIEW 来源)→唤起主程式打开该行程。
    const line0 = m.lines[0] - 1;
    const lineDone = (m.doneFlags && m.doneFlags[0]) ? 1 : 0;
    // 🆕 data-lines：命中行区间的 0-based 行号（逗号分隔，连续块含多行）。普通行程（event）切换时
    //    一并送给主程式，让行程表单的备注框能滚动＋选中＋金底闪烁定位到这些行（见 tlFlashEventFormLines）。
    const lines0 = m.lines.map((x) => x - 1).join(',');
    const jumpAttr = (m.kind === 'event')
      ? ' data-kind="event" data-uid="' + escapeHtml(m.uid || '') + '"'
      : ' data-kind="sticky" data-key="' + escapeHtml(n.key || '') + '"';
    return '<div class="fs-item' + (tag ? ' fs-is-source' : '') + '">' +
      (tag ? '<div class="fs-tag">' + tag + '</div>' : '') +
      '<div class="fs-title">' + title + date + '</div>' +
      '<div class="fs-meta"><span class="fs-src">' + src + ' · ' + lineTxt + '</span>' +
      '<button type="button" class="fs-jump"' + jumpAttr + ' data-lines="' + lines0 + '" data-line0="' + line0 + '" data-done="' + lineDone + '">切换</button></div></div>';
  };
  if (matches.length) {
    // 有找到：列出命中张，标注来源档与命中行号；隐藏「搬移」
    noteFindSameMoveTarget = null;
    setHead('\u{1F50D} 找到相同的子事件（' + clip + '）');
    if (moveBtn) moveBtn.hidden = true;
    // 🆕 投影贴：来源那张必然在结果里，单独标成「它的来源」，与「其它便利贴也有相同内容」分两段
    //    ⚠️ 来源身份用 m.uid（实体便利贴＝key；普通行程＝uid）比对 target.srcUid，两端口径一致
    const source = target.view ? matches.filter((m) => m && m.uid === target.srcUid) : [];
    const others = matches.filter((m) => source.indexOf(m) < 0);
    let html = '<div class="fs-context">' + (target.view
      ? '该提醒的内容出现在以下便利贴中：'
      : '本便利贴第 ' + (target.line + 1) + ' 行的内容，在以下便利贴中也出现：') + '</div>';
    if (source.length) html += '<div class="fs-group">📍 它的来源</div>' + source.map((m) => itemHtml(m, '来源')).join('');
    if (others.length) html += (source.length ? '<div class="fs-group">🔎 其它便利贴也有相同内容</div>' : '') + others.map((m) => itemHtml(m, '')).join('');
    list.innerHTML = html;
  } else {
    // 没找到：自「找出相同」与「搬移」拆分为独立菜单项后，这里只回报「没有找到」，
    // 不再自动进搬移目标选择（要搬移请改用独立的「📤 搬移项目」菜单项）。
    noteFindSameMoveTarget = null;
    setHead('\u{1F50D} 没有找到相同的子事件（' + clip + '）');
    if (moveBtn) moveBtn.hidden = true;
    // 投影贴真的没命中＝来源行程本身没设便利贴（内容是从行程备注抓来的），把这件事讲清楚，
    //   否则使用者会以为「其它便利贴里明明有」（其实那张没上桌面）。
    const fromTxt = target.view && target.srcTitle
      ? '该提醒来自行程「' + escapeHtml(noteClipText(target.srcTitle, 24)) + '」，该行程没有设便利贴。'
      : '';
    list.innerHTML = '<div class="fs-empty" title="' + escapeHtml(String(target.text || '')) + '">' +
      fromTxt + '已比对所有便利贴，没有与「' + escapeHtml(clip) + '」完全相同的子事件。</div>';
  }
  ov.classList.add('show');
}

// 🆕 显示「搬移」目标选择：列出其它便利贴供单选，并显示「搬移」按钮。
//   两种入口共用：① 找出相同项目「未找到」时自动进入；② 菜单直接点「搬移项目」。
//   allNotes 可复用（入口①已拉过目录），未传则自行现拉（入口②）。
async function noteShowMoveTargets(target, allNotes) {
  if (!target) return;
  noteFindSameMoveTarget = target;
  const ov = document.getElementById('findSameOv');
  const list = document.getElementById('findSameList');
  const titleEl = document.getElementById('findSameTitle');
  const moveBtn = document.getElementById('findSameMoveBtn');
  if (!ov || !list) return;
  const isBlock = !!(target.block && Number.isInteger(target.end) && Number.isInteger(target.line));
  const blockLen = isBlock ? (target.end - target.line + 1) : 1;
  const what = isBlock ? ('小事件群（' + blockLen + ' 行）') : '子事件';
  if (titleEl) {
    titleEl.textContent = '📤 搬移此' + what + '（' + noteClipText(target.text) + '）到其它便利贴';
    titleEl.title = String(target.text || '');
  }
  if (!Array.isArray(allNotes)) {
    // 入口②：先让主进程目录收敛，再读（避免列出已删／漏掉新增的便利贴）
    await awaitStickyNotesSync();
    let result = null;
    try { result = await ipcRenderer.invoke('sticky-note-order'); } catch (err) { result = null; }
    allNotes = (result && Array.isArray(result.notes)) ? result.notes : [];
  }
  // 🆕 投影贴（VIEW/🔔提醒/自订规则）不是实体档案、没有可写回的原文，绝不能作为搬移目标——
  //    从候选清单剔除，避免把子事件「搬」进一张只读投影（搬过去也落不了盘、还制造幻影资料）。
  const others = allNotes.filter((n) => n && n.key !== (target.srcUid || target.uid) && !isViewKey(n.key));
  if (moveBtn) moveBtn.hidden = !others.length;
  // 🆕 小事件群是整段删除：交互确认必须说清「删几行、后果、可否复原」（既有删除铁律）。
  const hint = isBlock
    ? '将整个小事件群（' + blockLen + ' 行，含 {gp} 标记）复制到所选便利贴；成功后会从本张删除这 ' + blockLen + ' 行，删除后无法复原。'
    : '将此子事件移动到以下所选择的其他便利贴中（复制过去后从本张删除）：';
  list.innerHTML = others.length
    ? '<div class="fs-move-hint">' + hint + '</div>' +
      others.map((n, i) => {
        const title = escapeHtml(n.title || '(无标题)');
        const date = n.date ? '（' + escapeHtml(n.date) + '）' : '';
        const src = n.src ? escapeHtml(n.src) : '主档';
        return '<label class="fs-move-item">' +
          '<input type="radio" name="fsMoveTarget" value="' + escapeHtml(n.key) + '"' +
          ' data-idx="' + escapeHtml(String(n.idx == null ? 0 : n.idx)) + '"' +
          ' data-src="' + escapeHtml(String(n.src || '')) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span class="fs-move-title">' + title + date + '</span>' +
          '<span class="fs-move-src">' + src + '</span></label>';
      }).join('')
    : '<div class="fs-empty">没有其它便利贴可作为搬移目标</div>';
  ov.classList.add('show');
}

// 🆕 「搬移项目」前置查重：进入目标选择前，先检查该子事件是否已在其它便利贴出现相同内容。
//    有相同 → 提示讯息并阻断（不进入搬移目标选择，避免把已重复的资料又搬去别处制造更多重复）；
//    无相同 → 才进入目标选择（复制＋删源）。与「找出相同的项目」共用同一套比对逻辑。
async function noteFindSameMoveCheck(target) {
  if (!target) return;
  if (target.view) { showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，请到来源行程里搬移', true); return; }
  const isBlock = !!(target.block && Number.isInteger(target.end));
  const what = isBlock ? '小事件群' : '子事件';
  const desc = isBlock ? noteClipText(target.text) : (target.text || '');
  const { allNotes, matches } = await noteFindSameComputeMatches(target);
  if (matches.length) {
    // 有相同：阻断搬移，提示使用者先处理重复项（列出命中位置，便于核对）
    const where = matches.map((m) => {
      const n = m.note;
      const title = n.title || '(无标题)';
      const date = n.date ? ('（' + n.date + '）') : '';
      const src = n.src ? (' @ ' + n.src) : ' @ 主档';
      const lineTxt = m.lines.length === 1
        ? ('第 ' + m.lines[0] + ' 行')
        : ('第 ' + m.lines.join('、') + ' 行');
      return title + date + src + ' · ' + lineTxt;
    }).join('；\n');
    window.alert(
      '⚠️ 该' + what + '（' + desc + '）在其它便利贴已存在相同内容：\n\n' + where + '\n\n' +
      '为避免搬移后产生重复资料，已阻止搬移。\n' +
      '请先处理重复项，或改用「找出相同的项目」查看这些相同内容所在的位置。'
    );
    return;
  }
  noteShowMoveTargets(target, allNotes);
}

// 🆕 结果项「切换」按钮：翻到被匹配的那张便利贴，滚动到命中的子事件行并闪烁两下；
//   例外：该项目已完成、而来源便利贴当前只显示未完成 → 无处可滚，弹「双闪」toast 说明即可。
async function noteFindSameSwitchTo(key, line0, done, lines) {
  const ov = document.getElementById('findSameOv');
  if (ov) ov.classList.remove('show');
  // 🆕 该便利贴不在翻页清单里（例如来源那张没开成桌面便利贴、或目前不是翻页模式）→ 无法翻页切换，
  //    退而唤起主程式打开该行程表单并闪烁定位命中行（key＝实体便利贴的 uid，可直接当 uid 用）。
  const idx = (flipOrder && flipOrder.length) ? flipOrder.findIndex((f) => f && f.key === key) : -1;
  if (idx < 0) {
    // 整块命中时传整段行区间（表单里会把整块选中＋闪烁），退化为单行也照旧可用
    noteFindSameOpenSourceEvent(key, (Array.isArray(lines) && lines.length) ? lines : (line0 >= 0 ? [line0] : []));
    return;
  }
  if (idx !== flipIndex) {
    try { await renderFlipPage(idx); } catch (e) { /* 渲染失败也不阻塞滚动尝试 */ }
  }
  // 例外：已完成项目 ＋ 来源贴「只看未完成」→ 该行被过滤、无处可滚，给明确双闪 toast（仍已切到来源贴）
  if (done && state.undoneChecksOnly) {
    showFindSameBlinkToast('该项目已完成 ✅，而「来源便利贴」当前只显示未完成的項目，因此无法滚动定位到它。');
    return;
  }
  // 滚动到命中位置并闪烁（4 秒）。
  // 🆕 改用 noteFindFlashLocated：轮询等翻页重渲染落地，且「行号定位不到」时按内容兜底——
  //    之前只查 .ev-cb[data-line]，非 checkbox 行（列表/胶囊/段落）永远定位不到 → 切换过去毫无反应
  //    （2026-10-30 用户回报：只有 checkbox 开头的项目会闪）。
  noteFindFlashLocated(line0, noteFindSameCurText);
}

// 🆕 依 0-based 行号找出 body 里对应的元素：
//   ① checkbox 子事件行 → .ev-cb[data-line]（逐行独立）；
//   ② 区块（.md-unit[data-start][data-end]，0-based 行区间）→ 命中行落在块内任意一行即算该块。
function noteFindLineEl(line0) {
  const n = Number(line0);
  if (!Number.isFinite(n) || n < 0) return null;
  const cb = document.querySelector('#body .ev-cb[data-line="' + n + '"]');
  if (cb) return cb;
  const units = document.querySelectorAll('#body .md-unit[data-start]');
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    const s = parseInt(u.getAttribute('data-start'), 10);
    if (isNaN(s)) continue;
    const eAttr = u.getAttribute('data-end');
    const e = (eAttr === null || eAttr === '') ? s : parseInt(eAttr, 10);
    if (n >= s && n <= (isNaN(e) ? s : e)) return u;
  }
  return null;
}

// 🆕 把 Markdown 原文压成「可跟渲染后文字比对」的纯文字：
//    去掉链接目标 / 图片 / [[…]] 胶囊标记 / 行首块级符号 / 强调符号，空白归一。
//    用途：「找出相同」的目标文本是**原文**（data-text），而画面上是**渲染后**的 textContent，
//    直接用原文比永远对不上（例如 `- [[超链接执行]] [执行X](exec:...)` → 画面上只有「执行X」）。
function notePlainText(s) {
  return String(s == null ? '' : s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // [文字](链接) → 文字
    .replace(/\[\[[^\]]*\]\]/g, ' ')             // [[dl:/cp:/term:/remind:/超链接执行]] 等标记整段移除
    .replace(/^[\s>#*+~-]+/, ' ')                // 行首块级标记（# > - * + 1. 等）
    .replace(/^\s*\d{1,9}[.)]\s*/, ' ')          // 有序列表序号
    .replace(/[*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 🆕 按内容在第 #body 里找「最贴合的那一行元素」：以目标首行为准，
//    先找渲染纯文字完全相等的（取最短＝最内层），没有再退化为包含匹配。
//    返回值尽量升级为可闪烁的容器（.md-unit 区块 / .ev-md-check 行）。
function noteFindElByText(text) {
  const root = document.getElementById('body');
  if (!root) return null;
  const firstLine = String(text == null ? '' : text).split('\n').map((l) => l.trim()).find((l) => l) || '';
  const want = notePlainText(firstLine);
  if (want.length < 2) return null;              // 太短容易误命中，宁可不闪
  const nodes = root.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, .ev-md-check-text');
  let exact = null, fuzzy = null, exactLen = Infinity, fuzzyLen = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const plain = notePlainText(el.textContent);
    if (!plain) continue;
    if (plain === want) { if (plain.length < exactLen) { exact = el; exactLen = plain.length; } }
    else if (plain.indexOf(want) >= 0) { if (plain.length < fuzzyLen) { fuzzy = el; fuzzyLen = plain.length; } }
  }
  const hit = exact || fuzzy;
  if (!hit) return null;
  return hit.closest('.md-unit, .ev-md-check') || hit;
}

// 🆕 切换后的「定位＋闪烁」：翻页会重渲染 body（异步取 sticky-note-html），元素引用会失效，
//    故改为轮询——每 120ms 重新找一次，最多约 2.4 秒，找到才滚动＋闪烁（4 秒）。
//    查找顺序：行号（.ev-cb[data-line] / .md-unit 区间）→ 内容（渲染后纯文字比对）。
function noteFindFlashLocated(line0, text) {
  let tries = 0;
  const MAX = 20;                     // 20 × 120ms ≈ 2.4s
  const tick = () => {
    tries += 1;
    const el = noteFindLineEl(line0) || noteFindElByText(text);
    if (el) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      setTimeout(() => blinkFoundLineTwice(el), 80);
      return;
    }
    if (tries < MAX) setTimeout(tick, 120);
    else if (typeof showNoteMoveToast === 'function') {
      // 兜底回报：确实切过去了但画面上找不到该行（内容被「只看未完成」过滤／行已变动），
      //   避免使用者以为是「点了没反应」。（双色交错 toast：未主动关闭则 30 秒自动消失）
      showNoteMoveToast('已切换到该便利贴，但画面上没找到这一行（可能被过滤或内容已变动）', true);
    }
  };
  tick();
}

// 🆕 结果项「切换」→ 跳到「普通行程」（VIEW 投影贴的来源行程／未设便利贴的行程）：
//   这类命中不在翻页清单里（没实体便利贴），无法用 renderFlipPage 翻；改为唤起主程式并打开该行程表单。
//   复用既有 wake-main-from-note（action='open'）→ 主程式 open-sticky-event → tlOnStickyOpenEvent → tlOpenEventForm(uid)。
//   ⚠️ lines（0-based 行号区间）必须一起送：主程式据它把备注框滚动到命中行、选中并金底闪烁两次
//      （tlFlashEventFormLines）——否则「切换过去了但找不到内容在哪」（2026-10-30 用户回报）。
function noteFindSameOpenSourceEvent(uid, lines, text) {
  const ov = document.getElementById('findSameOv');
  if (ov) ov.classList.remove('show');
  if (!uid) { window.alert('找不到该行程，无法切换'); return; }
  const payload = { key: uid, action: 'open' };
  if (Array.isArray(lines) && lines.length) payload.lines = lines;
  // 🆕 text 可由调用方显式给（编辑小圆点右键「切换编辑行程并定位」用该小圆点自己的原文）；
  //    未给才退回 noteFindSameCurText（「找出相同」结果窗切换的既有行为）。
  //    ⚠️ 不能一律用全域：右键直接切换时全域可能残留上一次搜寻的文字，会把定位带去错误的行。
  const payloadText = (typeof text === 'string') ? text : noteFindSameCurText;
  if (payloadText) payload.text = payloadText;
  try { ipcRenderer.invoke('wake-main-from-note', payload); }
  catch (err) { window.alert('唤起主程式打开行程失败：' + (err && err.message ? err.message : err)); }
}

// 🆕 区块编辑小圆点（.md-unit-edit）没有 data-text：从渲染后的 .md-unit 取纯文字，
//    作为主程式 tlFlashEventFormLines「行号对不上时按内容找行」的兜底（行号优先，故不要求精确）。
function noteDotBlockText(dot) {
  if (!dot) return '';
  const unit = dot.closest && dot.closest('.md-unit');
  if (!unit) return '';
  const clone = unit.cloneNode(true);
  const btn = clone.querySelector('.md-unit-edit, .ev-md-edit');
  if (btn) btn.remove();
  return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
}

// 让命中的行闪烁：checkbox 行取外层 .ev-md-check（金底＋金环脉冲）；
//   非 checkbox 行（列表/胶囊/段落）取 .md-unit 区块，整块闪同样的金底＋金环。
//   🆕 时长 4 秒（约 4 次脉冲）——使用者要求「闪久一点、更醒目」（2026-10-30）。
function blinkFoundLineTwice(cbEl) {
  const row = (cbEl && cbEl.closest) ? (cbEl.closest('.ev-md-check') || cbEl.closest('.md-unit') || cbEl) : cbEl;
  if (!row) return;
  row.classList.remove('fs-found-blink');
  void row.offsetWidth;   // 强制 reflow，确保重复点击也能重新触发动画
  row.classList.add('fs-found-blink');
  setTimeout(() => { row.classList.remove('fs-found-blink'); }, 4200);
}

// 🆕 关闭结果窗（并清掉待搬移目标，避免残留状态被下次误用）
function hideNoteFindSame() {
  const ov = document.getElementById('findSameOv');
  if (ov) ov.classList.remove('show');
  noteFindSameMoveTarget = null;
}
// 🆕 搬移结果 toast：默认按 ✕ 才关闭；若使用者未主动关闭，则 30 秒后自动关闭。
//   显示期间「正常／reverse」每 2 秒交错切换——normal＝纸底＋字色，reverse＝字色底＋纸色字。
let noteMoveToastTimer = null;        // reverse 交错计时器（setInterval）
let noteMoveToastAutoTimer = null;    // 30 秒自动关闭计时器（setTimeout）
function showNoteMoveToast(message, isError = false) {
  const el = document.getElementById('noteMoveToast');
  const msg = document.getElementById('noteMoveToastMsg');
  if (!el || !msg) return;
  // 重置两个计时器：避免旧 toast 的计时器对新 toast 误触发（尤其 30s 自动关闭会提前关掉新 toast）
  if (noteMoveToastTimer) { clearInterval(noteMoveToastTimer); noteMoveToastTimer = null; }
  if (noteMoveToastAutoTimer) { clearTimeout(noteMoveToastAutoTimer); noteMoveToastAutoTimer = null; }
  msg.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('reverse');
  el.classList.add('show');
  noteMoveToastTimer = setInterval(() => {
    el.classList.toggle('reverse');
  }, 2000);
  // 🆕 未主动关闭则 30 秒后自动关闭
  noteMoveToastAutoTimer = setTimeout(() => {
    hideNoteMoveToast();
  }, 30000);
}
function hideNoteMoveToast() {
  const el = document.getElementById('noteMoveToast');
  if (noteMoveToastTimer) { clearInterval(noteMoveToastTimer); noteMoveToastTimer = null; }
  if (noteMoveToastAutoTimer) { clearTimeout(noteMoveToastAutoTimer); noteMoveToastAutoTimer = null; }
  if (el) {
    el.classList.remove('show');
    el.classList.remove('reverse');
    el.classList.remove('blink2');
  }
}

// 🆕 「双闪」toast：复用搬移 toast 容器，给一条需要醒目提示的讯息（如「已完成项目无处可滚」），
//    toast 本体闪烁两下后，约 4.5 秒自动关闭（短于搬移 toast 的 30 秒）。
let findSameBlinkTimer = null;
let findSameBlinkAuto = null;
function showFindSameBlinkToast(message) {
  const el = document.getElementById('noteMoveToast');
  const msg = document.getElementById('noteMoveToastMsg');
  if (!el || !msg) return;
  // 先清掉搬移 toast 自身的计时器与双闪计时器，避免互相干扰
  if (noteMoveToastTimer) { clearInterval(noteMoveToastTimer); noteMoveToastTimer = null; }
  if (noteMoveToastAutoTimer) { clearTimeout(noteMoveToastAutoTimer); noteMoveToastAutoTimer = null; }
  if (findSameBlinkTimer) { clearTimeout(findSameBlinkTimer); findSameBlinkTimer = null; }
  if (findSameBlinkAuto) { clearTimeout(findSameBlinkAuto); findSameBlinkAuto = null; }
  msg.textContent = message;
  el.classList.remove('reverse');
  el.classList.add('error');     // 红边，更醒目
  el.classList.add('show', 'blink2');
  // 双闪动画（1.2s）结束后去掉 blink2（保留 show，随后自动关闭）
  findSameBlinkTimer = setTimeout(() => { if (el) el.classList.remove('blink2'); }, 1300);
  findSameBlinkAuto = setTimeout(() => { hideNoteMoveToast(); }, 4500);
}

// 🆕 搬移：把当前便利贴的这个子事件复制到所选便利贴，并从当前便利贴删除该子事件。
//    顺序＝「先复制到目标，成功后才从当前删除」——目标写入失败时原行仍在，不会丢数据。
async function noteFindSameMove() {
  const target = noteFindSameMoveTarget;
  if (!target) return;
  if (target.view) { showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，请到来源行程里搬移', true); return; }
  const selfUid = target.srcUid || target.uid;   // 要落盘的那张（比对时 target.uid 可能是「自己」的保留字 __view__）
  const checked = document.querySelector('#findSameList input[name="fsMoveTarget"]:checked');
  if (!checked) { showNoteMoveToast('请先选择一张要搬移过去的便利贴', true); return; }
  const destKey = String(checked.value || '');
  const destIdx = checked.getAttribute('data-idx');
  const destSrc = String(checked.getAttribute('data-src') || '');
  if (!destKey || destKey === selfUid) { showNoteMoveToast('目标便利贴无效', true); return; }
  // 🆕 双保险：即便清单被绕过，也绝不允许搬进投影贴（它没有实体档、落不了盘）
  if (isViewKey(destKey)) { showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，不能作为搬移目标', true); return; }

  // 取最新全量清单（单一可信来源）：目标便利贴与当前这张都从**同一份快照**取，
  //    避免两次拉取之间又发生写入、让两端看到不同版本。
  //    🆕 ① 底稿权威化：不再用可能陈旧的 refMeta（这就是事故起因），一律现拉现用。
  let result = null;
  try { result = await ipcRenderer.invoke('sticky-note-order'); } catch (err) { result = null; }
  const allNotes = (result && Array.isArray(result.notes)) ? result.notes : [];
  if (!allNotes.length) { showNoteMoveToast('无法读取便利贴最新内容，已取消搬移', true); return; }
  const dest = allNotes.find((n) => n && n.key === destKey);
  if (!dest) { showNoteMoveToast('找不到所选便利贴，无法搬移', true); return; }
  // 🆕 双方的「notes」都改走本地优先的权威读取：目录快照可能比实际内容旧，
  //    追加到目标时不能用它，否则会连带抹掉目标刚新增的内容。
  const destNotesRaw = await fetchAuthoritativeNotes(destKey);
  const curNotes = await fetchAuthoritativeNotes(selfUid);
  if (destNotesRaw == null || curNotes == null) {
    showNoteMoveToast('无法读取便利贴的最新内容，已取消搬移', true);
    return;
  }
  const destNotes = String(destNotesRaw || '');

  const lines = curNotes.split('\n');
  const li = target.line;
  // 🆕 小事件群（{gp}）＝一个「小事件」，整群一起搬；文案与 toast 一律按这个身份走
  const what = (target.block && Number.isInteger(target.end)) ? '小事件群' : '子事件';
  if (!Number.isInteger(li) || li < 0 || li >= lines.length) {
    showNoteMoveToast('该' + what + '（' + noteClipText(target.text || '') + '）内容已变化，请刷新便利贴后重试', true);
    return;
  }
  // 🆕 整段分支：一次搬 [line..end] 的**原文**（含行尾 {gp}、cr/cp 标记），不能只搬第一行；
  //    少了 {gp} 目标贴里这些行不再连续同组，会散成多个小事件，分组语义就没了。
  const isBlock = !!(target.block && Number.isInteger(target.end));
  if (isBlock && (target.end < li || target.end >= lines.length)) {
    showNoteMoveToast('该小事件群内容已变化，请刷新便利贴后重试', true); return;
  }
  const count = isBlock ? (target.end - li + 1) : 1;
  const movedLines = lines.slice(li, li + count);
  const movedText = movedLines.join('\n');
  const label = noteClipText(target.text || movedText);

  const btn = document.getElementById('findSameMoveBtn');
  if (btn) btn.disabled = true;
  let ok = false;
  let msg = '';
  try {
    // ① 先复制到目标便利贴末尾（保留整段原文与 {gp}/cr/cp 标记）
    //    🆕 写后回读校验：整段每一行都必须出现在目标便利贴，否则视为失败、绝不继续删来源（避免两边都丢）
    //    🆕 整群多补一个空行：目标贴末尾若正好也是无名 {gp} 行，直接接上会连续合并成同一群，
    //       搬过去就不是「独立的一个小事件群」了；空行是 tlSplitMdBlocks 的硬分隔。
    const sep = isBlock ? '\n\n' : '\n';
    const newDest = destNotes ? (destNotes.replace(/\s+$/, '') + sep + movedText) : movedText;
    const rAdd = await commitStickyNoteContent(newDest, destKey, destIdx, destSrc, {
      expect: { present: movedLines }
    });
    if (!rAdd.ok) {
      msg = '搬移失败：无法写入所选便利贴（' + rAdd.error + '）';
    } else if (rAdd.warn) {
      ok = true;
      msg = '✅ 已将此' + what + '（' + label + '）复制到「' + (dest.title || '(无标题)') + '」。' + rAdd.warn;
    } else {
      // ② 再从当前便利贴删除；🆕 删除后回读确认整段真的消失了
      const rest = lines.slice();
      rest.splice(li, count);
      const rDel = await commitStickyNoteContent(rest.join('\n'), selfUid, IDX, SRC_FILE, {
        expect: { absent: movedLines }
      });
      if (rDel.ok) {
        ok = true;
        msg = '✅ 已将此' + what + '（' + label + '）搬移到「' + (dest.title || '(无标题)') + '」'
          + (rDel.warn ? ('。' + rDel.warn) : '');
      } else {
        msg = '⚠️ 已复制此' + what + '（' + label + '）到「' + (dest.title || '(无标题)') + '」，但从当前便利贴删除失败（' + rDel.error + '）'
          + (rDel.verifyFailed ? '。请先重开便利贴确认后再处理重复的内容。' : '');
      }
    }
  } finally {
    if (btn) btn.disabled = false;
  }
  hideNoteFindSame();
  showNoteMoveToast(msg, !ok);
}

// 🆕 菜单项「删除此小事件」：删前 confirm（含内容预览），确认后从当前便利贴移除该行并落盘，
//    再以「常驻 toast ＋ ✕ 关闭钮」回报结果（与搬移共用同一套 toast 样式）。
async function noteFindSameDelete() {
  const target = noteFindSameTarget;
  if (!target) return;
  if (target.view) { noteFindSameClose(); showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，请到来源行程里删除', true); return; }
  const selfUid = target.srcUid;   // 要落盘的那张便利贴（一般贴 srcUid===uid；投影贴已在上面早退，不会用到 __view__）
  noteFindSameClose();   // 先收菜单，再弹确认框（避免确认框背后残留菜单）
  // 🆕 ① 底稿权威化：重拉最新内容（不用可能陈旧的 refMeta），避免删错行或拿到旧底稿整篇覆写
  const curNotes = await fetchAuthoritativeNotes(selfUid);
  if (curNotes == null) { showNoteMoveToast('无法读取该便利贴的最新内容，已取消删除', true); return; }
  const lines = curNotes.split('\n');
  const li = target.line;
  if (!Number.isInteger(li) || li < 0 || li >= lines.length) {
    showNoteMoveToast('该子事件内容已变化，请刷新便利贴后重试', true);
    return;
  }
  const m = lines[li].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!m) { showNoteMoveToast('该子事件内容已变化，请刷新便利贴后重试', true); return; }
  const label = (m[3] || '').trim();
  // 铁律：删除数据前必须交互确认，且告知「删什么、后果、可否恢复」
  const ok = window.confirm(
    '确定要删除这个子事件吗？\n\n' +
    '内容：' + (label || '(无内容)') + '\n\n' +
    '删除后会从当前便利贴移除并立即存档，无法复原。'
  );
  if (!ok) { showNoteMoveToast('已取消删除'); return; }
  noteFindSameTarget = null;
  noteFindSameMoveTarget = null;
  const rest = lines.slice();
  rest.splice(li, 1);
  // 🆕 ③ 写后回读校验：确认这一行真的消失了，避免「画面消失、实际还在」的假象
  const r = await commitStickyNoteContent(rest.join('\n'), selfUid, IDX, SRC_FILE, {
    expect: { absent: [lines[li]] }
  });
  showNoteMoveToast(r.ok
    ? ('✅ 已删除子事件' + (label ? ('：' + label) : '') + (r.warn ? ('。' + r.warn) : ''))
    : ('⚠️ 删除失败（' + r.error + '）'), !r.ok);
}

// 🆕 「复制内容」：把右键那颗 checkbox 的子事件内容（文本）写入系统剪贴板，并以常驻 toast 回报。
async function noteFindSameCopy(t) {
  if (!t) return;
  const text = (t.text || '').trim();
  if (!text) { showNoteMoveToast('该子事件没有内容，无法复制', true); return; }
  try {
    // 复用全局既有的剪贴板 IPC（与浮层「复制」按钮同源：write-text-to-clipboard）
    const result = await ipcRenderer.invoke('write-text-to-clipboard', text);
    if (!result || result.success !== true) throw new Error((result && result.error) || '写入剪贴板失败');
    showNoteMoveToast('✅ 已复制内容（' + text + '）', false);
  } catch (error) {
    showNoteMoveToast('复制失败：' + (error && error.message ? error.message : error), true);
  }
}


function stickyBlockTypeName(type) {
  return ({ code: '代码块', table: '表格', heading: '标题', hr: '分隔线', quote: '引用', list: '列表', para: '段落', gp: '分组' })[type] || '区块';
}
// 🆕 右键 区块编辑小圆点（.md-unit-edit）→ 区块级菜单「切换／编辑／复制／删除」，
//   🆕 例外：type=gp 的「{gp} 小事件群」语义上就是一个小事件（连续同组行＝一颗编辑圆点），
//      故额外开放「📤 搬移项目」，与 checkbox 子事件共用搬移管线；其余区块（段落/表格/代码…）仍不给。
//      旧注释「区块不是小事件，无搬移语义」在 {gp} 分组体系上线后已不成立（2026-11-06 使用者回报）。
let noteBlockMenuTarget = null;   // { uid, start, end, type, dot }
function noteBlockMenuOpen(e) {
  const dot = e.target.closest && e.target.closest('.md-unit-edit');
  if (!dot) return;              // 不是区块把手：交给浏览器原生右键
  e.preventDefault();            // 阻止原生右键
  const uid = dot.getAttribute('data-uid') || '';
  const start = parseInt(dot.getAttribute('data-start') || '-1', 10);
  const end = parseInt(dot.getAttribute('data-end') || '-1', 10);
  const type = dot.getAttribute('data-type') || '';
  if (!uid || !Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end < start) {
    window.alert('该区块信息不完整，无法打开菜单'); return;
  }
  noteBlockMenuTarget = { uid, start, end, type, dot };
  noteFindSameClose();           // 关掉另一套菜单，避免重叠
  const menu = document.getElementById('noteBlockMenu');
  if (!menu) return;
  // 🆕 只有 {gp} 小事件群才给搬移；投影贴只读也一并收起。
  //    靠 .nami[hidden]{display:none !important} 才真的隐藏（hidden 属性单用会被 .nami{display:block} 压过）。
  menu.querySelectorAll('.nami').forEach((item) => {
    if (item.getAttribute('data-act') === 'move') item.hidden = (type !== 'gp' || isViewKey(uid));
  });
  menu.classList.add('open');
  const r = menu.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + r.width > window.innerWidth) x = Math.max(0, window.innerWidth - r.width - 4);
  if (y + r.height > window.innerHeight) y = Math.max(0, window.innerHeight - r.height - 4);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}
function noteBlockMenuClose() {
  const menu = document.getElementById('noteBlockMenu');
  if (menu) menu.classList.remove('open');
  noteBlockMenuTarget = null;
}
// 🆕 右键 VIEW 投影贴「切换徽标」（.vsr-group-head 标题区）→ 下拉菜单：
//   菜单项1＝原左键行为（切换到来源行程编辑器，复用 noteFindSameOpenSourceEvent）；
//   菜单项2＝仅滚动定位到 calendar 该事件所在位置（不开编辑器，action='scroll'）。
//   与 #noteFindSameMenu / #noteBlockMenu 平行，但只认 .vsr-group-head（标题区），不认小圆点。
let vsrGotoSrc = '';
function vsrGotoMenuOpen(e) {
  const head = e.target.closest && e.target.closest('.vsr-group-head');
  if (!head) return;            // 不在标题区：不拦截，交给浏览器原生右键（也避免误关其它菜单）
  const src = head.getAttribute('data-src') || '';
  if (!src) return;
  e.preventDefault();           // 阻止原生右键
  // ⚠️ 关键：关掉另两套菜单的动作必须放在「确认要开自己菜单」之后，
  //   否则本全局 contextmenu 监听会在每次右键都先跑、把 noteFindSameOpen/noteBlockMenuOpen
  //   刚打开的「编辑小圆点」菜单（#noteFindSameMenu / #noteBlockMenu）立刻关掉（2026-10-31 实测踩雷）。
  noteFindSameClose();          // 开这套菜单前，先收掉另两套，避免重叠
  noteBlockMenuClose();
  vsrGotoSrc = src;
  const menu = document.getElementById('vsrGotoMenu');
  if (!menu) return;
  const noteEl = document.getElementById('note');
  const rect = noteEl.getBoundingClientRect();
  menu.classList.add('open');   // 先開，才量得到尺寸（base 是 display:none）
  const mw = menu.offsetWidth || 190;
  const mh = menu.offsetHeight || 64;
  let left = e.clientX - rect.left;
  let top = e.clientY - rect.top;
  if (top + mh > rect.height - 2) top = Math.max(2, top - mh);   // 太靠下 → 往上翻
  if (left + mw > rect.width - 2) left = Math.max(2, left - mw);  // 太靠右 → 往左翻
  menu.style.left = String(Math.max(2, left)) + 'px';
  menu.style.top = String(top) + 'px';
}
function vsrGotoMenuClose() {
  const menu = document.getElementById('vsrGotoMenu');
  if (menu) menu.classList.remove('open');
  vsrGotoSrc = '';
}
// 🆕 复制整块内容：读权威底稿、取 [start..end] 原文写剪贴板（与 noteFindSameCopy 同源 IPC）
async function noteBlockCopy(t) {
  if (!t) return;
  const notes = await fetchAuthoritativeNotes(t.uid);
  if (notes == null) { showNoteMoveToast('无法读取该便利贴的最新内容，已取消复制', true); return; }
  const lines = notes.split('\n');
  if (t.start < 0 || t.end >= lines.length || t.end < t.start) { showNoteMoveToast('区块内容已变化，请刷新便利贴后重试', true); return; }
  const text = lines.slice(t.start, t.end + 1).join('\n');
  if (!text.trim()) { showNoteMoveToast('该区块没有内容，无法复制', true); return; }
  try {
    const result = await ipcRenderer.invoke('write-text-to-clipboard', text);
    if (!result || result.success !== true) throw new Error((result && result.error) || '写入剪贴板失败');
    showNoteMoveToast('✅ 已复制区块内容（' + stickyBlockTypeName(t.type) + '）', false);
  } catch (error) {
    showNoteMoveToast('复制失败：' + (error && error.message ? error.message : error), true);
  }
}
// 🆕 删除此区块：删前 confirm（含类型＋内容预览），确认后移除 [start..end] 并落盘，回读校验
async function noteBlockDelete(t) {
  if (!t) return;
  if (isViewKey(t.uid)) { showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，请到来源行程里删除', true); return; }
  const notes = await fetchAuthoritativeNotes(t.uid);
  if (notes == null) { showNoteMoveToast('无法读取该便利贴的最新内容，已取消删除', true); return; }
  const lines = notes.split('\n');
  if (t.start < 0 || t.end >= lines.length || t.end < t.start) { showNoteMoveToast('区块内容已变化，请刷新便利贴后重试', true); return; }
  const removed = lines.slice(t.start, t.end + 1);
  const typeName = stickyBlockTypeName(t.type);
  const ok = window.confirm(
    '确定要删除这个区块吗？\n\n类型：' + typeName + '\n内容：\n' + removed.join('\n') + '\n\n删除后会从当前便利贴移除并立即存档，无法复原。'
  );
  if (!ok) { showNoteMoveToast('已取消删除'); return; }
  const rest = lines.slice();
  rest.splice(t.start, t.end - t.start + 1);
  const r = await commitStickyNoteContent(rest.join('\n'), t.uid, IDX, SRC_FILE, { expect: { absent: removed } });
  showNoteMoveToast(r.ok
    ? ('✅ 已删除区块（' + typeName + '）' + (r.warn ? ('。' + r.warn) : ''))
    : ('⚠️ 删除失败（' + r.error + '）'), !r.ok);
}
// 🆕 小事件群（{gp}）搬移入口：把 [start..end] 整段原文交给既有的「搬移项目」管线。
//    ⚠️ 必须用 fetchAuthoritativeNotes 现拉原文（含 {gp}/cr/cp 标记），不能用渲染后的纯文字：
//       少了行尾 {gp}，搬到目标贴后这些行不再连续同组，会散成多个小事件（分组语义丢失）。
//    ⚠️ target.block＝true + end 让 noteFindSameMove 走「整段」分支（复制整段＋删整段）；
//       text 是整块原文（多行），noteFindSameComputeMatches 的「整块比对」分支会据此做前置查重。
async function noteBlockMove(t) {
  // 硬守卫：搬移会删除整段，只有 {gp} 小事件群能走这条路（菜单显隐之外再加一道）
  if (!t || t.type !== 'gp') { showNoteMoveToast('只有 {gp} 小事件群可以整群搬移', true); return; }
  if (isViewKey(t.uid)) { showNoteMoveToast('预览便利贴（🔔 提醒／自订 VIEW 贴）是自动汇总的投影，请到来源行程里搬移', true); return; }
  const notes = await fetchAuthoritativeNotes(t.uid);
  if (notes == null) { showNoteMoveToast('无法读取该便利贴的最新内容，已取消搬移', true); return; }
  const lines = String(notes).split('\n');
  if (t.start < 0 || t.end >= lines.length || t.end < t.start) {
    showNoteMoveToast('小事件群内容已变化，请刷新便利贴后重试', true); return;
  }
  const text = lines.slice(t.start, t.end + 1).join('\n');
  if (!text.trim()) { showNoteMoveToast('该小事件群没有内容，无法搬移', true); return; }
  // 与 noteFindSameTarget 同形，多了 block/end；uid＝srcUid＝这张便利贴，view=false 表示可写
  const target = {
    uid: t.uid, srcUid: t.uid, srcTitle: '', view: false,
    line: t.start, end: t.end, block: true, text: text
  };
  await noteFindSameMoveCheck(target);
}

// ===== 🆕 「加入」模式的双向切换（2026-11-07） =====
// ＋☐ 打开的空白浮层（noteCheckEditTarget / noteBlockEditTarget 皆为 null）也要能来回切：
//   noteAddMode='check'＝逐行包成 - [ ] 子事件加入；'text'＝整段当 Markdown 区块原样加入。
// ⚠️ 与「编辑」切换不同：这里只有草稿、没有底稿可重载 → 一律保留 textarea 内容、不弹确认、不落盘。
// ⚠️ 绝不呼叫 markAddCheckBaseline()：新增模式的基线恒为 ''，才能维持「草稿尚未加入」的关闭拦截，
//    否则切一次模式后按「关闭」会把已输入的草稿静默丢掉。
function noteSwitchAddToBlockMode() {
  if (noteCheckEditTarget || noteBlockEditTarget || addCheckSavePending) return;
  if (noteAddMode !== 'check') return;
  noteAddMode = 'text';
  noteExitTableMode();
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '加入内容区块（Markdown 原文）';
    ov.querySelector('.ac-hint').textContent = '直接输入任意文本／Markdown；Enter 换行；⌘S 或「加入文本」＝原样追加到备注末尾（不会包成 - [ ] 子事件，不关窗）· 关闭请按下方「关闭」按钮（草稿未加入会先问）；可按「⇄ CheckBox 模式」切回逐行加入子事件';
  }
  if (inp) inp.placeholder = '任意输入文本／Markdown，Enter 换行（原样加入，不会变成子事件）…';
  bindAddCheckTools('加入文本');
  noteSyncGroupUi(inp ? inp.value : '');   // 新增 text 模式不提供 group 勾选（与 openAddFreeText 同口径）
  showStickyRefreshFeedback('已切换为原文模式（原样加入 Markdown，按下方「关闭」按钮离开）');
  if (inp) setTimeout(() => inp.focus(), 0);
}
function noteSwitchAddToCheckMode() {
  if (noteCheckEditTarget || noteBlockEditTarget || addCheckSavePending) return;
  if (noteAddMode !== 'text') return;
  noteAddMode = 'check';
  noteExitTableMode();
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '加入子事件（CheckBox）';
    ov.querySelector('.ac-hint').textContent = 'Enter 换行 · ⌘S 加入（加入后不关闭，内容留在框里可继续编辑）· 关闭请按下方「关闭」按钮（草稿未加入会先问是否保存）；可按「⇄ 原文模式」切成原样加入 Markdown 区块';
  }
  if (inp) inp.placeholder = '每行一个子事件；Enter 换行，⌘S 或「加入」加入…';
  bindAddCheckTools('加入');
  noteSyncGroupUi(inp ? inp.value : '');   // 切回来重新提供 group 勾选（默认不勾）
  showStickyRefreshFeedback('已切换回 CheckBox 模式（逐行加入子事件，按下方「关闭」按钮离开）');
  if (inp) setTimeout(() => inp.focus(), 0);
}

// 🆕 反向切换的结构校验：只有「每一行都是 CheckBox 行、且缩进一致」的区块才能切回 CheckBox 模式。
//   含空行／表格／段落／缩进不齐时一律返回 null —— 否则 checkbox 保存分支会把这些行也包成子事件，
//   或按首行缩进改写整段，等于偷偷改了资料。
function noteStripCheckboxBlock(blockText) {
  const lines = String(blockText == null ? '' : blockText).replace(/\r\n/g, '\n').split('\n');
  if (!lines.length) return null;
  let indent = null;
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (!m) return null;
    if (indent === null) indent = m[1];
    else if (m[1] !== indent) return null;   // 缩进不齐：保存时会统一成首行缩进，不能默默改
    out.push(m[3]);
  }
  return out.join('\n');
}

// ===== 🆕 「编辑内容区块」→「编辑子事件（CheckBox）」反向切换（2026-11-07） =====
// 与正向完全对称：先从权威底稿重载整段原文，校验它仍是纯 CheckBox 行，再逐行剥掉 "- [ ] " 前缀
//   写回 textarea，并把 target 换回 noteCheckEditTarget（保存重新走逐行包 checkbox 的分支）。
// 有未保存改动时同样先经确认才放弃（安全默认＝留在原文模式）；切换不关窗、不落盘。
async function noteSwitchBlockToCheckMode() {
  const target = noteBlockEditTarget;
  if (!target || noteCheckEditTarget || addCheckSavePending) return;
  if (addCheckDirty()) {
    const ok = window.confirm(
      '切换回 CheckBox 模式，会从便利贴底稿重新载入并去掉 "- [ ] " 前缀。\n\n' +
      '目前编辑框里尚未保存的改动不会保留。\n\n' +
      '按「确定」＝放弃未保存的改动并切换；\n' +
      '按「取消」＝留在原文模式（可先按 ⌘S 保存后再切换）。'
    );
    if (!ok) return;   // 取消／Esc 一律不丢改动
  }
  // ① 底稿权威化：切换后的区间与原文都取自最新底稿（与正向切换、tlOpenEditBlockDialog 同口径）
  const notes = await fetchAuthoritativeNotes(target.uid);
  if (notes == null) {
    window.alert('无法读取该便利贴的最新内容，为避免对错行落笔已取消切换。请重开便利贴后再试。');
    return;
  }
  const lines = notes.split('\n');
  const start = target.start, end = target.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= lines.length ||
      end >= lines.length || end < start) {
    window.alert('该区块内容已变化，请刷新便利贴后重试');
    return;
  }
  const src = lines.slice(start, end + 1).join('\n');
  const stripped = noteStripCheckboxBlock(src);
  if (stripped == null) {
    window.alert('此区块含有非 CheckBox 行（或各行缩进不一致），无法切回 CheckBox 模式。\n\n请留在原文模式编辑，或先把每一行整理成 "- [ ] …" 再切换。');
    return;
  }
  // ② 状态切换：count＝底稿里这段原本占几行（不是编辑框当前行数），
  //    保存时 lines.splice(line, count, …newLines) 才能正确替换，不会多删相邻行。
  noteBlockEditTarget = null;
  noteCheckEditTarget = { uid: target.uid, line: start, count: end - start + 1 };
  noteAddMode = 'check';
  noteExitTableMode();
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑子事件（CheckBox）';
    ov.querySelector('.ac-hint').textContent = '已从原文模式切回，编辑框显示去掉 "- [ ] " 前缀的子事件内容 · ⌘S 保存（不关闭，逐行写回 CheckBox 子事件）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；清空并保存＝删除该子事件（会先确认）；可再按「⇄ 原文模式」切回原文';
  }
  if (inp) {
    inp.value = stripped;                 // 🆕 关键：去掉 - [ ] 前缀，回到 CheckBox 编辑手感
    inp.placeholder = '输入子事件内容…';
  }
  bindAddCheckTools();        // 按钮文案改回「⇄ 原文模式」
  noteSyncGroupUi(stripped);  // 依切回后的内容重新侦测 group 勾选（与 tlOpenEditNoteCheckDialog 同口径）
  markAddCheckBaseline();     // 基线＝切回后的内容，切换本身不算「未保存改动」
  showStickyRefreshFeedback('已切换回 CheckBox 模式（按下方「关闭」按钮离开）');
  if (inp) setTimeout(() => { inp.focus(); inp.setSelectionRange(0, 0); }, 0);
}

// ===== 🆕 「编辑子事件（CheckBox）」→「编辑内容区块」正向切换（2026-11-07） =====
// checkbox 模式的编辑框只显示 match[3]（"- [ ] " 前缀与缩进已被剥掉）。若只改标题／target 而不重载内容，
//   切换后 "- [ ]" 仍然不会出现，而保存又会走 checkbox 分支再包一层前缀 —— 所以这里一律从权威底稿
//   重新取 lines[line .. line+count-1] 的**原文**写回 textarea，并把 target 换成 noteBlockEditTarget。
// 切换＝改状态 + 重载内容，不关窗、不落盘；有未保存改动时先经使用者明确确认才放弃（安全默认＝留在原模式）。
// 切过去后同一颗按钮会变成「⇄ CheckBox 模式」，可经 noteSwitchBlockToCheckMode() 再切回来。
async function noteSwitchCheckToBlockMode() {
  const target = noteCheckEditTarget;
  // 硬守卫：只有 checkbox 编辑中可切；区块模式／新增模式按不到这颗按钮，也不做任何动作
  if (!target || noteBlockEditTarget || addCheckSavePending) return;
  if (addCheckDirty()) {
    const ok = window.confirm(
      '切换为原文模式，会从便利贴底稿重新载入原始 Markdown（含 "- [ ]" 前缀）。\n\n' +
      '目前编辑框里尚未保存的改动不会保留。\n\n' +
      '按「确定」＝放弃未保存的改动并切换；\n' +
      '按「取消」＝留在 CheckBox 模式（可先按 ⌘S 保存后再切换）。'
    );
    if (!ok) return;   // 取消／Esc 一律不丢改动
  }
  // ① 底稿权威化：切换后的区间与原文都取自最新底稿（与 tlOpenEditBlockDialog 同口径）
  const notes = await fetchAuthoritativeNotes(target.uid);
  if (notes == null) {
    window.alert('无法读取该便利贴的最新内容，为避免对错行落笔已取消切换。请重开便利贴后再试。');
    return;
  }
  const lines = notes.split('\n');
  const start = target.line;
  const span = Math.max(1, target.count || 1);
  const end = start + span - 1;
  if (!Number.isInteger(start) || start < 0 || start >= lines.length || end >= lines.length) {
    window.alert('该子事件内容已变化，请刷新便利贴后重试');
    return;
  }
  if (!/^(\s*)-\s+\[[ xX]\]\s?/.test(lines[start])) {
    window.alert('该子事件内容已变化，请刷新便利贴后重试');
    return;
  }
  const src = lines.slice(start, end + 1).join('\n');
  // ② 状态切换：清掉 checkbox target → 由 noteBlockEditTarget 接管 confirmAddCheck() 的区块覆写分支
  //    （区块分支原样写回 Markdown，不会再包 "- [ ] "，也不会重复追加）
  noteCheckEditTarget = null;
  noteBlockEditTarget = { uid: target.uid, start, end, type: 'list' };
  noteAddMode = 'check';
  noteExitTableMode();
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑内容区块（子事件原文）';
    ov.querySelector('.ac-hint').textContent = '已从 CheckBox 模式切换，编辑框显示底稿原始 Markdown（含 "- [ ]"）· ⌘S 保存（不关闭，以区块原文覆写同一段，不会重复包成子事件）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；清空并保存＝删除该区块（会先确认）；可按「⇄ CheckBox 模式」切回';
    ipcRenderer.invoke('sticky-note-editor-state', { editing: true }).catch(() => {});
  }
  if (inp) {
    inp.value = src;                                  // 🆕 关键：重新显示原文，"- [ ]" 才会出现
    inp.placeholder = '编辑此区块的 Markdown 原文…';
  }
  bindAddCheckTools();        // 🆕 按钮原地变成「⇄ CheckBox 模式」（原文全是 CheckBox 行 → 可反切）
  noteSyncGroupUi(src);       // 区块模式 group 勾选按原文重新侦测（原本整组带 {gp} 则预勾）
  markAddCheckBaseline();     // 基线＝刚载入的原文，切换本身不算「未保存改动」
  showStickyRefreshFeedback('已切换为原文模式（原文含 - [ ]，按下方「关闭」按钮离开）');
  if (inp) setTimeout(() => { inp.focus(); inp.setSelectionRange(0, 0); }, 0);
}

// 🆕 通用「最小 MD 区块」编辑（便利贴端）：编辑 notes 中 lines[start..end] 的 Markdown 原文。
//   区间起止由主窗渲染时嵌入 onclick；⌘S／「保存」＝只落盘不关闭 · 只有下方「关闭」按钮能关窗；清空并保存＝删除该区块（需确认）。
window.tlOpenEditBlockDialog = async function (event, uid, start, end, type) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!event || !event.target.closest('.md-unit-edit')) return;
  if (addCheckSavePending) return;
  // 🆕 ① 底稿权威化：编辑区块＝整段覆写，底稿必须现拉现用（用陈旧底稿会把已删的旧内容写回）
  const notes = await fetchAuthoritativeNotes(uid);
  if (notes == null) {
    window.alert('无法读取该便利贴的最新内容，为避免覆盖资料已取消编辑。请重开便利贴后再试。');
    return;
  }
  const lines = notes.split('\n');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= lines.length || start > end) {
    window.alert('该区块内容已变化，请刷新便利贴后重试');
    return;
  }
  const src = lines.slice(start, end + 1).join('\n');
  noteCheckEditTarget = null;
  noteBlockEditTarget = { uid, start, end, type };
  noteAddMode = 'check';
  const ov = document.getElementById('addCheckOv');
  const inp = document.getElementById('addCheckInput');
  if (ov) {
    ov.querySelector('.ac-title').textContent = '编辑内容区块（' + stickyBlockTypeName(type) + '）';
    ov.querySelector('.ac-hint').textContent = '直接编辑此区块的 Markdown 原文；⌘S 保存（不关闭，可继续编辑）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；清空并保存＝删除该区块（会先确认）';
    ov.classList.add('show');
    ipcRenderer.invoke('sticky-note-editor-state', { editing: true }).catch(() => {});
  }
  noteSyncGroupUi(src);   // 🆕 区块编辑才显示 group 勾选；原本已整组带 {gp} 时预勾
  if (inp) {
    inp.value = src;
    inp.placeholder = '编辑此区块的 Markdown 原文…';
    markAddCheckBaseline();   // 🆕 基线＝开框原文，之后有任何差异都会在关闭前询问
  }
  // 🆕 反切按钮的显隐要看「这段原文是不是全是 CheckBox 行」，所以必须在 inp.value 写好之后才重绑
  bindAddCheckTools();
  // 🆕 表格区块 → 进网格模式：必须先写好 textarea 与基线再进模式（引擎不碰没编辑过的原文），
  //   认不出合法表格（缺表头＋分隔行）就退回原文模式，不挡路。
  noteExitTableMode();
  let tableMode = false;
  if (type === 'table') {
    const g = noteTableGridInstance();
    if (g) { g.bind(); tableMode = g.enter(src); }
  }
  if (tableMode) {
    if (ov) {
      ov.querySelector('.ac-title').textContent = '编辑表格内容';
      ov.querySelector('.ac-hint').textContent = '在格子里填内容；「＋行／＋列」增删，或填「行×列」按「建立空白表」重画一张；⌘S 保存（不关闭，可继续编辑）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；需要手写 Markdown 时按「改 Markdown 原文」切换';
    }
    if (!noteTableGrid.focusFirstCell() && inp) setTimeout(() => inp.focus(), 0);
  } else if (inp) setTimeout(() => inp.focus(), 0);
};
// 返回 true＝内容已落盘（或已按使用者同意删除并关闭）；false＝未保存（校验失败／使用者拒绝／正在保存）。
// 「保存并关闭」按这个返回值决定要不要关窗：只有真的写成功才关，避免保存失败把改动丢掉。
async function confirmAddCheck() {
  const inp = document.getElementById('addCheckInput');
  if (!inp) { closeAddCheck(); return false; }
  if (noteBlockEditTarget) {
    if (addCheckSavePending) return false;
    const target = noteBlockEditTarget;
    // 🆕 group 启用：勾选时逐行补 {gp}（整块＝一个小事件）；原本整组却取消勾选＝拆组；其余原样保留
    const gpBox = document.getElementById('noteGroupEnable');
    const raw = inp.value.replace(/\r\n/g, '\n');
    const gpOn = !!(gpBox && gpBox.checked && !gpBox.disabled);
    const mark = gpOn ? noteGroupMarkValue() : null;
    const blockText = noteResolveGroupText(raw, gpOn, noteGroupWasOn, mark);
    // 🆕 ① 底稿权威化：整篇覆写前现拉最新底稿
    const notes = await fetchAuthoritativeNotes(target.uid);
    if (notes == null) { window.alert('无法读取该便利贴的最新内容，为避免覆盖资料已取消保存。'); return false; }
    const lines = notes.split('\n');
    if (target.start < 0 || target.end >= lines.length) {
      window.alert('该区块内容已变化，请刷新便利贴后重试'); return false;
    }
    const span = target.end - target.start + 1;
    if (!blockText.trim()) {
      if (!window.confirm('区块内容为空＝删除该区块。\n\n确定要删除吗？删除后将直接写回并存档，无法从本窗口恢复（可先按「复制」留存原文）。')) return false;
      lines.splice(target.start, span);
      if (await saveStickyNoteContent(lines.join('\n'), '删除区块', target.uid)) { closeEditNoteCheck(); return true; }
      return false;
    }
    const newLines = ensureCrMarkersForCheckboxLines(blockText).split('\n');
    lines.splice(target.start, span, ...newLines);
    // 更新区间为新区块，便于继续 ⌘S 覆写同一段
    noteBlockEditTarget = { uid: target.uid, start: target.start, end: target.start + newLines.length - 1, type: target.type };
    if (await saveStickyNoteContent(lines.join('\n'), '保存区块', target.uid)) {
      // 🆕 2026-11-08：group 启用已把整块升级成块级 {gpX}…{/gpX}，编辑框同步显示真实底稿，
      //    否则使用者看到旧的行尾式原文继续编辑，下一次 ⌘S 会把块级群降级回去。
      //    markAddCheckBaseline() 会一并重设文字／勾选／群标记三条基线，不会误判成未保存。
      inp.value = newLines.join('\n');
      markAddCheckBaseline();
      showStickyRefreshFeedback('已保存（按下方「关闭」按钮）');
      return true;
    }
    return false;
  }
  if (noteCheckEditTarget) {
    if (addCheckSavePending) return false;
    const target = noteCheckEditTarget;
    // 🆕 多行＝拆成多个子事件（与 ＋☐ 新增同一口径）：第一行继承原条目的勾选状态（含使用者自己写的
    //    [[dl:…]]/[[cp:…]] 标记），其余每行成为同缩进的未完成子事件紧接其后。
    //    旧版这里把 \n 一律压成空格（为了守「一行＝一个 checkbox」），结果用 shift+enter 折的
    //    行存完又被合并回一行（2026-10-20 用户回馈）；单行输入的行为保持不变。
    const rows = inp.value.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    // 🆕 内容清空＝删除该子事件：必须先经使用者确认（拒绝则留在编辑框，可先「复制」留存原文）
    if (!rows.length && !window.confirm('子事件内容为空＝删除该子事件。\n\n确定要删除吗？删除后将直接写回并存档，无法从本窗口恢复（可先按「复制」留存原文）。')) return false;
    // 🆕 ① 底稿权威化：整篇覆写前现拉最新底稿（陈旧底稿会把已搬走的旧内容一并写回）
    const notes = await fetchAuthoritativeNotes(target.uid);
    if (notes == null) {
      window.alert('无法读取该便利贴的最新内容，为避免覆盖资料已取消保存。请重开便利贴后再试。');
      return false;
    }
    const lines = notes.split('\n');
    if (target.line < 0 || target.line >= lines.length) {
      window.alert('该子事件内容已变化，请刷新便利贴后重试');
      return false;
    }
    const match = lines[target.line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (!match) {
      window.alert('该子事件内容已变化，请刷新便利贴后重试');
      return false;
    }
    // 本条子事件目前实际占用的行数：上一次保存若已拆成多项，这次要整段覆写而不是再插一段
    const span = Math.max(1, target.count || 1);
    if (!rows.length) {
      // 🆕 空内容＝删除：移除该行后写回并存档（上方 confirm 已获使用者同意）
      lines.splice(target.line, span);
      if (await saveStickyNoteContent(lines.join('\n'), '删除子事件', target.uid)) { closeEditNoteCheck(); return true; }
      return false;
    }
    // 🆕 原文保真：编辑框已是完整原文（含 [[]] 标记），保存时直接写回；并自动补建立日标记 [[cr:今天]]
    //    （已含 cr 则不動＝保留原始建立日、不重複補；若含 dl/cp 則 cr 排在最前）
    const rawMd = rows.map((l, i) => match[1] + '- [' + (i === 0 ? match[2] : ' ') + '] ' + l).join('\n');
    const mdText = noteGroupMd(rawMd, () => rows.map((l, i) => match[1] + '- [' + (i === 0 ? match[2] : ' ') + '] ' + ensureCrMarker(l)).join('\n'));
    const newLines = mdText.split('\n');
    lines.splice(target.line, span, ...newLines);
    noteCheckEditTarget = { uid: target.uid, line: target.line, count: newLines.length };
    // 🆕 编辑模式：⌘S／「保存」＝只落盘不离开视窗（离开视窗要过「未保存改动」这道问）
    if (await saveStickyNoteContent(lines.join('\n'), '保存子事件', target.uid)) {
      markAddCheckBaseline();
      showStickyRefreshFeedback((rows.length > 1 ? ('已拆成 ' + rows.length + ' 项子事件') : '已保存') + '（按下方「关闭」按钮）');
      return true;
    }
    return false;
  }
  // 🆕 表格／自由文本模式：把整段内容当一个 MD 区块原样追加（不逐行包 - [ ]），
  //   与前文空一行隔开，保证切块器把它认成独立的 table／para（否则表格会被并进上一段）。
  if (noteAddMode === 'table' || noteAddMode === 'text') {
    if (addCheckSavePending) return false;
    // 2026-11-07：自由文本里若手写了 checkbox 行，加入当下就补 cr（与内容区块保存同口径），
    //   不必等再按一次 ⌘S；表格行不是 checkbox，包装器原样回传，网格解析不受影响。
    const block = ensureCrMarkersForCheckboxLines(
      inp.value.replace(/\r\n/g, '\n').replace(/^\s*\n+/, '').replace(/\s+$/, '')
    );
    if (!block) { showStickyRefreshFeedback('没有可加入的内容'); return false; }
    if (noteAddMode === 'table') {
      const parsed = window.MdTableGrid && window.MdTableGrid.parseMd(block);
      const filled = parsed && [parsed.header].concat(parsed.rows).some((row) => row.some((cell) => String(cell).trim()));
      if (!parsed) { showStickyRefreshFeedback('表格内容不完整（需要表头行＋分隔行）', true); return false; }
      if (!filled) { showStickyRefreshFeedback('请先在格子里填内容'); return false; }
    }
    // 🆕 ① 底稿权威化：追加＝「整篇覆写」，底稿必须是最新的。
    //    用 refMeta 的话，陈旧快照会让已删除的行随这次写入一起复活（2026-10-26 事故）。
    const authPrev = await fetchAuthoritativeNotes(KEY);
    if (authPrev == null) { showStickyRefreshFeedback('无法读取便利贴最新内容，请重开便利贴再试', true); return false; }
    const prev = String(authPrev).replace(/\s+$/, '');
    const notes = (prev ? prev + '\n\n' : '') + block + '\n';
    if (await saveStickyNoteContent(notes, noteAddMode === 'table' ? '加入表格' : '加入文本')) {
      if (noteAddMode === 'table') {
        const g = noteTableGridInstance();
        if (g) {
          // 加完再给一张同尺寸空白表，可连续建立
          const rowsEl = document.getElementById('noteTableRows');
          const colsEl = document.getElementById('noteTableCols');
          g.enterBlank(parseInt(rowsEl && rowsEl.value, 10), parseInt(colsEl && colsEl.value, 10));
          g.focusFirstCell();
        }
      } else {
        // 🆕 自由文本：内容留在框里，改成「编辑刚加入的这一段」——⌘S 覆写同一块，不再重复追加
        noteCheckEditTarget = null;
        noteBlockEditTarget = {
          uid: KEY,
          start: prev ? prev.split('\n').length + 1 : 0,
          end: (prev ? prev.split('\n').length + 1 : 0) + block.split('\n').length - 1,
          type: 'para'
        };
        applyAddCheckEditUi('自由编辑（纯文本）',
          '⌘S 保存（不关闭，覆写刚加入的这一段，不会重复追加）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）');
      }
      markAddCheckBaseline();
      showStickyRefreshFeedback(noteAddMode === 'table' ? '已加入表格（可继续建立下一张，按下方「关闭」按钮）' : '已加入文本（内容留在框里，⌘S 覆写这一段 · 按下方「关闭」按钮）');
      return true;
    }
    return false;
  }
  // 🆕 新增模式与编辑模式同一口径：加入＝落盘但**不关窗、不清空**，随后自动切成「编辑刚加入的这一段」
  //    （⌘S 再按＝覆写同一段，不会重复追加；内容留在框里可继续改）——与「编辑小圆点」完全同手感
  if (addCheckSavePending) return false;
  const lines = inp.value.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { showStickyRefreshFeedback('没有可加入的内容'); return false; }
  const rawMd = lines.map((l) => '- [ ] ' + l).join('\n');
  const md = noteGroupMd(rawMd, () => lines.map((l) => '- [ ] ' + ensureCrMarker(l)).join('\n'), true);
  // 🆕 ① 底稿权威化：先前加入 ABCDEF 时就是用了陈旧的 refMeta 底稿，
  //    把早已搬走的内容连着新内容一起写回，才让旧项目「复活」（2026-10-26 事故）。
  //    追加＝整篇覆写，底稿必须现拉现用。
  const authPrev = await fetchAuthoritativeNotes(KEY);
  if (authPrev == null) {
    window.alert('无法读取该便利贴的最新内容，为避免覆盖资料已取消加入。请重开便利贴后再试。');
    return false;
  }
  const prev = String(authPrev).replace(/\s*$/, '');
  const notes = (prev ? prev + '\n' : '') + md + '\n';
  if (await saveStickyNoteContent(notes, '保存子事件')) {
    // 这一批在备注里的行区间：prev 有内容时从 prev 的行数开始，否则从第 0 行
    const startLine = prev ? prev.split('\n').length : 0;
    const mdLines = md.split('\n');
    // 🆕 2026-11-08：新增的是「块级小事件群」时，切成「整块编辑」并把整段原文（含 {gpX}/{/gpX}）放进编辑框。
    //    否则再按 ⌘S 会走「单个 CheckBox 子事件」分支：把开启标记行误判成子事件、又把行尾标记补回来。
    const fenced = mdLines.length > lines.length &&
      typeof noteGpFenceOfLine === 'function' &&
      !!noteGpFenceOfLine(mdLines[0]) && !!noteGpFenceOfLine(mdLines[mdLines.length - 1]);
    if (fenced) {
      inp.value = md;
      noteCheckEditTarget = null;
      noteBlockEditTarget = { uid: KEY, start: startLine, end: startLine + mdLines.length - 1, type: 'gp' };
      applyAddCheckEditUi('编辑内容区块（分组）',
        '⌘S 保存（不关闭，覆写这整个块级小事件群）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）');
      noteSyncGroupUi(md, true);
      if (typeof bindAddCheckTools === 'function') bindAddCheckTools();
      markAddCheckBaseline();
      showStickyRefreshFeedback('已加入 ' + lines.length + ' 项（块级小事件群，内容留在框里，⌘S 覆写这一段）');
      return true;
    }
    noteCheckEditTarget = { uid: KEY, line: startLine, count: lines.length };
    noteBlockEditTarget = null;
    applyAddCheckEditUi('编辑子事件（CheckBox）',
      '⌘S 保存（不关闭，覆写刚加入的这一段，不会重复追加）· 关闭请按下方「关闭」按钮（有改动会先问是否保存）；换行＝拆成多个子事件；清空内容并保存＝删除这一段（会先确认）');
    markAddCheckBaseline();
    showStickyRefreshFeedback('已加入 ' + lines.length + ' 项（内容留在框里，⌘S 覆写这一段 · 按下方「关闭」按钮）');
    return true;
  }
  return false;
}

// ===== 🆕 便利贴「发邮件」：菜单 📧 → 收件人浮层 → 主进程转邮件插件 sendEmailByPlugin =====
// 正文用便利贴当前渲染的 HTML（与画面看到的一致）；主题取行程标题。
// 分体 / 翻页模式通用：KEY 始终指向「当前这张」（翻页时 renderFlipPage 已重写 KEY）。
function currentStickyEvent() {
  return sourceEvent(KEY) || null;
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

// ===== 🆕 新建便利贴（写进 include 进来的 calendar-*.md，如 calendar-event-draft.md）=====
//   只问两件：写入哪个档、叫什么名字。其余字段（日期＝今天／全天／sticky:1／颜色／Remark 围栏）
//   由 Calendar 渲染端的 tlEventToMarkdown 补成完整 ## EVENT 框架 —— 那边是序列化唯一可信来源，
//   便利贴窗不重抄一份模板，否则字段一改就漂移。落盘也由它做（tlAppendEventToIncludeFile：只追加、不重写）。
let newNoteBusy = false;
function nnAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
function syncNewNoteButtons() {
  const b = document.getElementById('nnCreateBtn');
  if (b) { b.disabled = newNoteBusy; b.textContent = newNoteBusy ? '建立中…' : '建立'; }
}
function setNewNoteHint(text, isError) {
  const h = document.getElementById('nnHint');
  if (!h) return;
  h.textContent = text;
  h.style.opacity = isError ? '1' : '';
  h.style.color = isError ? '#c0392b' : '';
}
function closeNewNoteDialog() {
  const ov = document.getElementById('newNoteOv');
  if (ov) ov.classList.remove('show');
  newNoteBusy = false;
  syncNewNoteButtons();
}
async function openNewNoteDialog() {
  const ov = document.getElementById('newNoteOv');
  const sel = document.getElementById('nnFile');
  const inp = document.getElementById('nnTitle');
  if (!ov || !sel || !inp) return;
  let res = null;
  try { res = await ipcRenderer.invoke('sticky-note-create-files'); } catch (e) { res = { ok: false, error: e.message }; }
  if (!res || !res.ok) {
    showStickyRefreshFeedback('无法读取文件清单：' + ((res && res.error) || '未知错误'), true);
    return;
  }
  const files = Array.isArray(res.files) ? res.files : [];
  if (!files.length) {
    showStickyRefreshFeedback('同目录没有 include 档（calendar-*.md），无法新建', true);
    return;
  }
  sel.innerHTML = files.map(f => '<option value="' + nnAttr(f.name) + '">' + escapeHtml(f.name) + '</option>').join('');
  // 默认选中「当前这张便利贴的来源档」——多半就是要继续往那支草稿档里加
  if (SRC_FILE && files.some(f => f.name === SRC_FILE)) sel.value = SRC_FILE;
  inp.value = '';
  setNewNoteHint('Enter 建立 · Esc 取消；建好后会立刻出现在便利贴里，可继续编辑内容', false);
  newNoteBusy = false;
  syncNewNoteButtons();
  ov.classList.add('show');
  setTimeout(() => inp.focus(), 0);
}
async function submitNewNote() {
  if (newNoteBusy) return;
  const sel = document.getElementById('nnFile');
  const inp = document.getElementById('nnTitle');
  const title = String((inp && inp.value) || '').trim();
  const src = String((sel && sel.value) || '').trim();
  if (!title) { setNewNoteHint('请先填写便利贴标题', true); if (inp) inp.focus(); return; }
  if (!src) { setNewNoteHint('请选择要写入的文件', true); return; }
  newNoteBusy = true;
  syncNewNoteButtons();
  setNewNoteHint('正在建立…', false);
  let r = null;
  try { r = await ipcRenderer.invoke('sticky-note-create', { src, title }); } catch (e) { r = { ok: false, error: e.message }; }
  newNoteBusy = false;
  syncNewNoteButtons();
  if (!r || !r.ok) {
    setNewNoteHint('新建失败：' + ((r && r.error) || '未知错误'), true);
    showStickyRefreshFeedback('新建便利贴失败：' + ((r && r.error) || '未知错误'), true);
    return;
  }
  closeNewNoteDialog();
  showStickyRefreshFeedback('已新建「' + title + '」→ ' + src);
}
// 🆕 建立新 calendar 档案：前缀固定 calendar-，后缀由用户输入 → calendar-<后缀>.md（骨架文件）。
//   落盘由主进程做（路径安全、防目录穿越、重名检测都在那边），便利贴窗只传后缀。
let newCalBusy = false;
function syncNewCalButtons() {
  const b = document.getElementById('ncCreateBtn');
  if (b) { b.disabled = newCalBusy; b.textContent = newCalBusy ? '建立中…' : '建立'; }
}
function setNewCalHint(text, isError) {
  const h = document.getElementById('ncHint');
  if (!h) return;
  h.textContent = text;
  h.style.opacity = isError ? '1' : '';
  h.style.color = isError ? '#c0392b' : '';
}
function closeNewCalDialog() {
  const ov = document.getElementById('newCalOv');
  if (ov) ov.classList.remove('show');
  newCalBusy = false;
  syncNewCalButtons();
}
async function openNewCalDialog() {
  const ov = document.getElementById('newCalOv');
  const inp = document.getElementById('ncSuffix');
  if (!ov || !inp) return;
  inp.value = '';
  setNewCalHint('Enter 建立 · Esc 取消；文件建立在当前 calendar 同目录，可在 Calendar 中独立打开', false);
  newCalBusy = false;
  syncNewCalButtons();
  ov.classList.add('show');
  setTimeout(() => inp.focus(), 0);
}
async function submitNewCal() {
  if (newCalBusy) return;
  const inp = document.getElementById('ncSuffix');
  const suffix = String((inp && inp.value) || '').trim();
  if (!suffix) { setNewCalHint('请先输入档案后缀（例如 work / 工作）', true); if (inp) inp.focus(); return; }
  newCalBusy = true;
  syncNewCalButtons();
  setNewCalHint('正在建立…', false);
  let r = null;
  try { r = await ipcRenderer.invoke('sticky-note-create-calendar', { suffix }); } catch (e) { r = { ok: false, error: e.message }; }
  newCalBusy = false;
  syncNewCalButtons();
  if (!r || !r.ok) {
    setNewCalHint('建立失败：' + ((r && r.error) || '未知错误'), true);
    showStickyRefreshFeedback('建立 calendar 档案失败：' + ((r && r.error) || '未知错误'), true);
    return;
  }
  closeNewCalDialog();
  showStickyRefreshFeedback('已建立 ' + (r.name || ('calendar-' + suffix + '.md')) + '（可在 Calendar 中独立打开）');
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
  rememberRefMeta(arg);
  syncViewNoteMode();   // 🆕 VIEW 贴＝只读投影（刷新后可能从有内容变成没内容）
  const titleEl = document.getElementById('title');
  let ev0 = null;
  let titleHtml2 = null, titleText2 = '';
  if (arg && arg.titleHtml) {
    titleHtml2 = arg.titleHtml;
  } else {
    ev0 = sourceEvent(KEY);
    titleText2 = ev0 ? ev0.title : '';
  }
  // 🆕 单段落 VIEW 贴：标题 tooltip（段落名称＋条件摘要）；多段落不挂。文字包进 .tt（no-drag），只写 data-tip。
  const tip2 = (ev0 && typeof ev0.titleTip === 'string' && ev0.titleTip) ? ev0.titleTip : '';
  setStickyTitle(titleEl, titleHtml2, titleText2, tip2);
  let html = (arg && typeof arg.html === 'string') ? arg.html : '';
  // 🆕 移除 raw 原文兜底：html 缺失时直接留白，等待主进程推来的权威 HTML；
  //    便利贴内容即 checkbox，清光即空，绝不以未渲染 Markdown 源呈现（如 "- [ ] 11111"）。
  // 🆕 主程式推來的內容刷新不该把使用者當下位置沖掉（重設 innerHTML 會把 scrollTop 歸零）：
  //    先記後還，且避免「被歸零→節流存成 0」把記憶的位置洗掉
  const bodyElRef = document.getElementById('body');
  const keepScroll = bodyElRef ? Math.max(0, Math.round(bodyElRef.scrollTop)) : 0;
  document.getElementById('body').innerHTML = html;
  // 🆕 定位高亮：渲染模式下把定位詞以 <mark> 標示在標題與內容
  noteApplyHighlight();
  refreshNoteViewDisplay(); // 🆕 多段落 VIEW 便利贴：主进程推送刷新重渲染后重新套用记忆的「顺序平铺／页签方式」与 active 段落
  if (keepScroll && bodyElRef) bodyElRef.scrollTop = keepScroll;
  const ev = sourceEvent(KEY);
  if (ev || arg) {
    renderMeta(Object.assign({}, ev || {}, {
      date: arg && typeof arg.date === 'string' ? arg.date : (ev && ev.date),
      done: arg && typeof arg.done === 'boolean' ? arg.done : !!(ev && ev.done),
      tags: arg && Array.isArray(arg.tags) ? arg.tags : ((ev && ev.tags) || []),
      // 🆕 显示方式随刷新即时生效（显示在今天 → meta 行改固定字样）
      spanDisplay: arg && typeof arg.spanDisplay === 'string' ? arg.spanDisplay : ((ev && ev.spanDisplay) || '')
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

// ===== 🆕 来源文件（INCLUDE 外部文件，如 calendar-event-draft.md）支持 =====
//   便利贴窗只持有 calendar.md 的 FILE；草稿便利贴这类「来自 INCLUDE 的行程」在本地这份文本里
//   根本不存在（主程式解析时才把外部文件合并进来）。因此这类便利贴：
//     ① 内容/元数据以主程式推来的 ref 为准（refMeta 缓存，含 notes 原文）；
//     ② 画面上显示文档名徽标，一眼认出它不是正式档的便利贴；
//     ③ 保存时把 src 一并上报，由主程式写回该来源文件（绝不写 calendar.md）。
let SRC_FILE = '';                       // 当前便利贴的来源文件名（空＝calendar.md 正式档）
const refMeta = new Map();               // key -> {notes, src, title, date, endDate, color, done, tags}
function rememberRefMeta(arg) {
  if (!arg || typeof arg.key !== 'string') return;
  const prev = refMeta.get(arg.key);
  const next = Object.assign({}, prev || {});
  // 🆕 陈旧保护：本窗刚确认写入过 notes 时（__localWrite），主程式推来的值**不得覆盖**，
  //    直到推送内容与本地一致为止（＝双方收敛，远程已收到这次写入），保护才解除。
  //
  //    ⚠️ 为什么不能只看时间：主程式的 tlCalEvents／tlIncludedEvents 可能仍是本次写入前的
  //    内存快照（例如原值是后来才重算的），于是它推回来的 notes 会持续是旧的；
  //    一旦时间窗口过期，这份旧值就灌回 refMeta，下一次「整篇覆写」便用旧底稿把
  //    已搬走／已删除的项目写回去 —— 这正是「搬到别的便利贴后，改另一项又跑出来」的现象。
  //    改成「内容收敛才解除」才能真正挡住；要强制同步请按便利贴的 🔄 刷新（会显式解除）。
  const incoming = (arg.notes !== undefined && arg.notes !== null) ? String(arg.notes) : null;
  const guard = !!(prev && prev.__localWrite && incoming !== null);
  ['notes', 'src', 'title', 'titleTip', 'date', 'endDate', 'spanDisplay', 'color', 'tags', 'temp'].forEach((k) => {
    if (k === 'notes' && guard) return;   // 保护期内：沿用本地刚写的版本
    if (arg[k] !== undefined && arg[k] !== null) next[k] = arg[k];
  });
  if (guard) next.__localWrite = (incoming !== String(next.notes || ''));  // 收敛 → 解除保护
  else next.__localWrite = false;
  if (typeof arg.done === 'boolean') next.done = arg.done;
  refMeta.set(arg.key, next);
  if (arg.key === KEY) syncSourceFile();
}
function syncSourceFile() {
  const meta = refMeta.get(KEY) || {};
  SRC_FILE = String(meta.src || '');
  applyDocBadge();
}
// 🆕 临时便利贴标记：ref.temp 由主窗口 tlTempStickyUids 产生，随整份 sticky-note-sync 下发，
//   主进程目录（sticky-note-order 的 notes/order）原样保留该字段 → 窗内无需改主进程程式。
//   翻页清单（renderFlipPage 的 listed）与 sticky-note-refresh 会把 temp 带进 refMeta；
//   分体窗「刚开窗」那一帧只拿得到 sticky-note-html（不含 temp），故补一次目录查询。
let tempProbeId = '';
function noteFlagId(key, idx) { return String(key == null ? '' : key) + '#' + (+idx || 0); }
function isTempNote() {
  if (isViewNote()) return false;
  return !!(refMeta.get(KEY) || {}).temp;
}
function probeTempNoteFlag() {
  // 翻页模式的 flipOrder 本身就是权威目录（已带 temp），无需额外 IPC
  if (IS_FLIP) return;
  const id = noteFlagId(KEY, IDX);
  if (tempProbeId === id || isViewNote() || isTempNote()) return;
  tempProbeId = id;   // 每张只查一次；翻页换 key 会自然重查
  ipcRenderer.invoke('sticky-note-order').then((res) => {
    const notes = (res && Array.isArray(res.notes)) ? res.notes : [];
    const hit = notes.find((n) => n && n.key === KEY && (+n.idx || 0) === (+IDX || 0));
    // 以权威目录纠正：临时贴关闭／转正式贴后不会残留旧徽标
    rememberRefMeta({ key: KEY, temp: !!(hit && hit.temp) });
    if (noteFlagId(KEY, IDX) === id) applyDocBadge();
  }).catch(() => {});
}
// 文档名徽标（标题行 #docBadge，与 VIEW 徽标同一个位置）：
//   VIEW＝紫色、临时便利贴＝蓝色虚线、include 来源档＝金色虚线、主档正式贴＝不显示。
function applyDocBadge() {
  const el = document.getElementById('docBadge');
  if (!el) return;
  // 🆕 VIEW 便利贴专属紫色徽标（聚合提醒视图，没有单一来源档）
  if (isViewNote()) {
    el.textContent = '👁 VIEW 便利貼';
    el.title = 'VIEW 便利贴（聚合提醒视图）\n从所有来源档自动收集符合规则的提醒项；只读显示，没有对应的单一来源档。';
    el.classList.remove('dirty', 'is-temp');
    el.classList.add('show', 'is-view');
    return;
  }
  // 🆕 临时便利贴徽标：仅本会话、不写入 calendar.md；资料功能与正式贴完全相同
  if (isTempNote()) {
    el.textContent = '📌 临时便利贴';
    el.title = '临时便利贴（仅本会话）\n由行程「📌 临时开启为便利贴」产生，不写入 calendar.md；重开应用即消失。\n资料维护／编辑／搜索功能与正式便利贴完全相同' +
      (SRC_FILE ? '；内容来源：' + SRC_FILE : '') + '。';
    el.classList.remove('dirty', 'is-view');
    el.classList.add('show', 'is-temp');
    return;
  }
  if (SRC_FILE) {
    el.textContent = '📄 ' + SRC_FILE;
    el.title = '内容来源：' + SRC_FILE + '\n（编辑结果会写回该文件）';
    el.classList.remove('is-view', 'is-temp');
    el.classList.add('show');
  } else {
    el.textContent = '';
    el.removeAttribute('title');
    el.classList.remove('show', 'is-view', 'is-temp', 'dirty');
  }
  probeTempNoteFlag();   // 分体窗首次渲染：异步补查权威目录，回来后重绘徽标
}
// 🆕 VIEW 便利贴徽标：点一下显示该投影贴在 JSON 里设定的抓取逻辑（关键词／标记／行型态），
//   并在弹层里提供「前往维护作业」按钮跳到 view-sticky-rules.html。
function closeViewRuleModal() {
  const m = document.getElementById('viewRuleModal');
  if (m) m.classList.remove('show');
}
async function showViewRuleInfo(e) {
  if (!isViewNote()) return;            // 只有 VIEW 投影贴才弹；include 来源徽标不弹
  if (e) e.stopPropagation();           // 别让点击冒泡到 #note 的「点击唤起主程式」→ 误开 AI 智控台
  const m = document.getElementById('viewRuleModal');
  if (!m) return;
  const subEl = document.getElementById('vrSub');
  const titleEl = document.getElementById('vrTitle');
  const condEl = document.getElementById('vrCond');
  // 先弹窗并给「读取中」状态，再异步拉规则，避免界面卡白
  titleEl.textContent = '（读取中…）';
  condEl.textContent = '正在读取设定档案 view-sticky-rules.json …';
  subEl.textContent = '';
  m.classList.add('show');
  try {
    // 🆕 统一拉一次规则档案（内置提醒也优先用存盘里被自定义过的版本，没有才回退引擎默认）
    const res = await ipcRenderer.invoke('vsr-list');
    const rules = (res && Array.isArray(res.rules)) ? res.rules : [];
    let rule;
    if (KEY === VIEW_KEY) {
      // 🔔 内置提醒：优先用存盘里被自定义过的内置规则（见引擎 BUILTIN_REMIND_RULE），没有才回退默认
      const saved = rules.filter((r) => r.id === '__builtin_remind__' || r.builtin === true)[0];
      rule = saved || (window.ViewStickyRules && ViewStickyRules.builtinRules ? ViewStickyRules.builtinRules()[0] : null);
    } else {
      const ruleId = String(KEY).slice(VIEW_KEY.length + 1); // '__view__:' 之后的部分
      rule = rules.filter((r) => String(r.id) === ruleId)[0] || null;
    }
    if (!rule) {
      titleEl.textContent = '（找不到对应的规则）';
      condEl.textContent = '这张 VIEW 便利贴对应的规则不在 view-sticky-rules.json 里（可能已被删除或尚未保存）。';
      subEl.textContent = '';
      return;
    }
    const V = window.ViewStickyRules;
    const norm = (V && V.normalizeRule) ? V.normalizeRule(rule) : rule;
    titleEl.textContent = (norm.title || '(未命名)');
    const tag = norm.builtin ? '系统内置' : (norm.enabled ? '已启用' : '已关闭');
    subEl.textContent = tag + ' · 设定档案：view-sticky-rules.json';
    condEl.textContent = (V && V.ruleSummary) ? V.ruleSummary(norm) : '';
  } catch (e) {
    titleEl.textContent = '（读取失败）';
    condEl.textContent = '无法读取 view-sticky-rules.json：' + (e && e.message ? e.message : e);
    subEl.textContent = '';
  }
}
function setupViewBadge() {
  const badge = document.getElementById('docBadge');
  if (badge) badge.addEventListener('click', showViewRuleInfo);
  const m = document.getElementById('viewRuleModal');
  if (!m) return;
  const closeBtn = document.getElementById('vrClose');
  if (closeBtn) closeBtn.addEventListener('click', closeViewRuleModal);
  // 跳转维护作业：先关弹层，再开维护窗（vsr-open 跟菜单项走同一入口）
  const openBtn = document.getElementById('vrOpenRules');
  if (openBtn) openBtn.addEventListener('click', () => { closeViewRuleModal(); ipcRenderer.invoke('vsr-open'); });
  // 点遮罩（卡片外）关闭
  m.addEventListener('click', (e) => { if (e.target === m) closeViewRuleModal(); });
  // Esc 关闭
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.classList.contains('show')) closeViewRuleModal(); });
}
// 🆕 定位高亮：把 root 內所有文本節點的命中片段包成 <mark class="search-highlight">（只碰文本節點，不破壞標籤結構）
function noteWrapMatches(root, query) {
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
// 摘掉 #body / #title 內所有 search-highlight 標記，還原文本（冪等）
function noteUnwrapHighlights() {
  ['body', 'title'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('mark.search-highlight').forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
  });
}
// 依當前 NOTE_HL 重打高亮（先清再打，重複呼叫也安全）
function noteApplyHighlight() {
  noteUnwrapHighlights();
  if (!NOTE_HL) return;
  noteWrapMatches(document.getElementById('body'), NOTE_HL);
  noteWrapMatches(document.getElementById('title'), NOTE_HL);
}
// 当前事件对象：优先本地解析（calendar.md 正式档）；本地没有则用主程式推来的 ref
//   ⚠️ 回退到 ref 的两种情形（其余一律当作「找不到」，宁可提示也不显示幽灵内容）：
//      ① 外部 include 来源（meta.src 非空）：本地解析本来就读不到它。
//      ② VIEW 投影贴「🔔 提醒」：key 是保留字、不在 calendar.md 里，但资料是主程式即时算好推来的，
//         照 ref 显示才对；这一张全程只读，没有「用旧 ref 把内容写回」的风险。
//      正式档的事件若被删掉，src 是空 → 继续用旧 ref 会一直显示幽灵内容，所以照旧提示「找不到该便利贴」。
function sourceEvent(key) {
  const local = parseEvents(readMd()).find((x) => x.key === key);
  if (local) return local;
  const meta = refMeta.get(key);
  if (!meta || (!meta.src && !isViewKey(key))) return null;
  return {
    title: meta.title || '', date: meta.date || '', endDate: meta.endDate || '',
    spanDisplay: meta.spanDisplay || '',
    color: meta.color || '#FFCC00', tags: Array.isArray(meta.tags) ? meta.tags : [],
    notes: meta.notes || '', done: !!meta.done, uid: key, key,
    titleTip: meta.titleTip || ''
  };
}
// 监听主程式推来的刷新（自动同步）
ipcRenderer.on('sticky-note-refresh', (e, arg) => applyNoteContent(arg));
// 🆕 主窗「跳转到便利贴」顺带要滚动定位+闪烁的小事件(群)（分体模式专用；翻页模式走 show-page payload）。
//   正文已渲染就立即消费；否则先存 pending，等 init/renderFlipPage 渲染完再消费（避免早到丢请求）。
ipcRenderer.on('sticky-note-focus-unit', (e, payload) => {
  if (!payload) return;
  pendingFocusUnit = payload.unit || payload;
  if (noteRendered) consumePendingFocusUnit();
});
// 📥 主进程载入可携设定后：重读自身状态并立即套用（只读不写回，避免覆盖刚导入的值）
ipcRenderer.on('sticky-note-apply-state', async (e, payload) => {
  if (IS_FLIP) {
    if (!flipTotal) { clearFlipPage(); return; }
    // 汇入档带了上次页次 → 跳到那一页再重绘（否则重绘会把当前页写回 lastId／lastIdx）
    const lastId = (payload && typeof payload.lastId === 'string') ? payload.lastId : '';
    const lastIdx = (payload && Number.isFinite(+payload.lastIdx)) ? +payload.lastIdx : 0;
    const target = lastId ? flipStartIndex('', lastIdx, lastId) : flipIndex;
    await renderFlipPage(target);
    return;
  }
  let inst = {};
  try { inst = (await ipcRenderer.invoke('sticky-note-get', { key: KEY, idx: IDX })) || {}; } catch (e) {}
  state.color = inst.color || STICKY_DEF_BG;
  state.opacity = (typeof inst.opacity === 'number') ? inst.opacity : 100;
  state.fontScale = (typeof inst.fontScale === 'number') ? inst.fontScale : 1;
  state.fontColor = (typeof inst.fontColor === 'string' && inst.fontColor) ? inst.fontColor : STICKY_DEF_FG;
  state.fontWeight = (typeof inst.fontWeight === 'number') ? inst.fontWeight : 400;
  state.undoneChecksOnly = !!inst.undoneChecksOnly;
  state.sortMode = (inst.sortMode === 'asc' || inst.sortMode === 'desc') ? inst.sortMode : 'orig';
  syncUndoneChecksFilter();
  applyViewSort();   // 🆕 汇入可携设定后立刻按新 sortMode 重排（DOM 未重绘，无需重新 capture）
  const vsSel = document.getElementById('miViewSort');
  if (vsSel) vsSel.value = state.sortMode;
  // 汇入设定时若正在编辑：折叠状态跟随新设定（勾选＝折叠／未勾选＝还原全文）
  if (editMode) {
    if (state.undoneChecksOnly) applyDoneFold();
    else expandDoneFold();
  }
  applyColor();
  applyContentFont();
  syncTextAppearance();
  const op = document.getElementById('opacity');
  if (op) {
    op.value = String(state.opacity);
    document.getElementById('opacityVal').textContent = state.opacity + '%';
  }
  updateZoomInd();
});

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
  // 🆕 紙張實色（不隨透明度變淡）：供搜尋高標做 reverse（字=紙色、底=字色）時取用，保證對比與可讀
  document.getElementById('note').style.setProperty('--note-bg', tint(state.color, 100));
  document.getElementById('bar').style.background = state.color;
  // ＋☐ 浮层盒与便利贴同背景色（取实色 tint(…,100)，不随透明度变淡，保证浮层可读）；文字色经 --note-fg 继承
  const acBox = document.getElementById('addCheckBox');
  if (acBox) acBox.style.background = tint(state.color, 100);
  // 📧 发邮件浮层盒同理（与 ＋☐ 浮层共用 addcheck-box 样式）
  const emailBox = document.getElementById('emailBox');
  if (emailBox) emailBox.style.background = tint(state.color, 100);
  // 🆕 新建便利贴 / 建立 calendar 档案 浮层盒：同样取便利贴实色背景，避免白底 + --note-fg 在深色便利贴上「白字白底」看不清
  const newNoteBox = document.getElementById('newNoteBox');
  if (newNoteBox) newNoteBox.style.background = tint(state.color, 100);
  const newCalBox = document.getElementById('newCalBox');
  if (newCalBox) newCalBox.style.background = tint(state.color, 100);
  // 🆕 找出相同项目结果窗：同样取便利贴实色背景，避免白底+--note-fg 在深色便利贴上看不清（金色外框由 .addcheck-box 提供）
  const findSameBox = document.getElementById('findSameBox');
  if (findSameBox) findSameBox.style.background = tint(state.color, 100);
  // 🆕 自动标示术语确认浮层盒：同样取便利贴实色背景，与所在便利贴色调一致（否则在深色便利贴上白底+--note-fg 看不清）
  const autoTermBox = document.getElementById('autoTermBox');
  if (autoTermBox) autoTermBox.style.background = tint(state.color, 100);
  updateMenuTheme();
  syncCustomSwatchActive();
  applyMeteor();   // 🆕 改色/透明度/字号都会重跑 applyColor，这里顺带把外框流星状态套用到 #note
}
function syncUndoneChecksFilter() {
  const body = document.getElementById('body');
  const button = document.getElementById('miUndoneChecks');
  if (body) body.classList.toggle('only-undone-checks', !!state.undoneChecksOnly);
  if (button) {
    button.textContent = '只显示未完成 checkbox：' + (state.undoneChecksOnly ? '开' : '关');
    button.setAttribute('aria-pressed', state.undoneChecksOnly ? 'true' : 'false');
  }
  // meta 行的「☐/☑」快捷按钮与菜单项共用同一状态；renderMeta 与这里的调用顺序不定，故重绘成同一份标记
  const chip = document.querySelector('#meta .note-undone-filter');
  if (chip) chip.outerHTML = undoneFilterChipHtml();
}
function toggleUndoneChecksFilter() {
  state.undoneChecksOnly = !state.undoneChecksOnly;
  syncUndoneChecksFilter();
  // 折叠与「只看未完成 checkbox」联动：勾选才折叠，取消勾选立即还原全文
  if (editMode) {
    if (state.undoneChecksOnly) applyDoneFold();
    else expandDoneFold();
  }
  persist();
}
function persist() {
  if (IS_FLIP) {
    // 几何（位置/尺寸/最小化）写翻页窗专用 id；颜色/透明度/字号按当前显示的便利贴自身状态写
    const g = geomId();
    ipcRenderer.invoke('sticky-note-set', { key: g.key, idx: g.idx, patch: { w: state.w, h: state.h, minimized: state.minimized, minH: state.minH } });
    ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { color: state.color, opacity: state.opacity, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight, undoneChecksOnly: state.undoneChecksOnly, sortMode: state.sortMode, scrollPos: state.scrollPos, meteor: state.meteor } });
    return;
  }
  ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { w: state.w, h: state.h, color: state.color, opacity: state.opacity, minimized: state.minimized, minH: state.minH, fontScale: state.fontScale, fontColor: state.fontColor, fontWeight: state.fontWeight, undoneChecksOnly: state.undoneChecksOnly, sortMode: state.sortMode, scrollPos: state.scrollPos, meteor: state.meteor } });
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
// 🆕 外框流星：把 state.meteor 套用到 #note（开关 → .meteor-on＋形狀 class；參數走 CSS 變數 --m-color/--m-dur/--m-head/--m-flame）
function applyMeteor() {
  const note = document.getElementById('note');
  if (!note) return;
  const m = state.meteor || { on: false };
  note.classList.toggle('meteor-on', !!m.on);
  note.classList.toggle('meteor-rainbow', !!(m.on && m.rainbow));
  note.classList.remove('meteor-shape-comet', 'meteor-shape-sharp', 'meteor-shape-band', 'meteor-shape-twin');
  if (m.on) {
    note.classList.add('meteor-shape-' + (m.shape || 'comet'));
    const color = (m.follow && state.fontColor) ? state.fontColor : (m.color || '#ffae00');
    note.style.setProperty('--m-color', color);
    note.style.setProperty('--m-dur', (m.speed || 12) + 's');
    // 焰火長度(flame)＝「亮頭+拖尾總可見長度(px)」：先依便利貼周長反推總角度，再從中切出亮頭。
    // 亮頭不超過總長一半，讓 flame 設很小時整段都短（否則固定 12° 亮頭會吃掉預算、使 10px 失效）。
    const nW = note.clientWidth || 360, nH = note.clientHeight || 360;
    const perim = 2 * (nW + nH);
    const sizeHead = Math.min(120, Math.max(1, m.size || 12));
    let totalDeg = ((m.flame || 160) / perim) * 360;
    totalDeg = Math.min(300, Math.max(1.5, totalDeg));
    const headDeg = Math.max(0.5, Math.min(sizeHead, totalDeg * 0.5));
    const tailDeg = Math.max(0.5, totalDeg - headDeg);
    note.style.setProperty('--m-head', headDeg + 'deg');
    note.style.setProperty('--m-flame', tailDeg + 'deg');
    // 🆕 大小同步放大环厚：旧上限 40°→2px，新上限 120°→6px（3×），40° 以下维持 2px 不退化
    note.style.setProperty('--m-thick', Math.min(6, Math.max(2, (m.size || 12) / 20)) + 'px');
  }
}
// 把 state.meteor 反映到菜单控制项（翻页切页 / 开菜单都重跑）
function syncMeteorControls() {
  const m = state.meteor || { on: false, speed: 12, size: 12, shape: 'comet', color: '#ffae00', follow: false, flame: 160 };
  const tgl = document.getElementById('miMeteorToggle');
  if (tgl) { tgl.textContent = '外框流星：' + (m.on ? '开' : '关'); tgl.setAttribute('aria-pressed', m.on ? 'true' : 'false'); }
  const sp = document.getElementById('mMeteorSpeed');
  if (sp) sp.value = String(m.speed);
  const spv = document.getElementById('mMeteorSpeedVal');
  if (spv) spv.textContent = '每圈 ' + m.speed + ' 秒';
  const sz = document.getElementById('mMeteorSize');
  if (sz) sz.value = String(m.size);
  const szv = document.getElementById('mMeteorSizeVal');
  if (szv) szv.textContent = m.size + '°';
  const sh = document.getElementById('mMeteorShape');
  if (sh) sh.querySelectorAll('button[data-shape]').forEach(b => b.classList.toggle('active', (b.getAttribute('data-shape') || 'comet') === (m.shape || 'comet')));
  const col = document.getElementById('mMeteorColor');
  if (col) col.value = /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? m.color : '#ffae00';
  const fol = document.getElementById('mMeteorFollow');
  if (fol) fol.checked = !!m.follow;
  const rb = document.getElementById('mMeteorRainbow');
  if (rb) rb.checked = !!m.rainbow;
  const fl = document.getElementById('mMeteorFlame');
  if (fl) fl.value = String(m.flame);
  const flv = document.getElementById('mMeteorFlameVal');
  if (flv) flv.textContent = m.flame + 'px';
  [sp, sz, sh, col, fol, fl].forEach(el => { if (el) el.disabled = !m.on; });   // 关闭时停用细项
}
function setMeteor(patch) {
  if (!state.meteor || typeof state.meteor !== 'object') state.meteor = normalizeMeteor(null);
  Object.assign(state.meteor, patch);
  applyMeteor();
  syncMeteorControls();
  persist();
}
function toggleMeteor() {
  setMeteor({ on: !(state.meteor && state.meteor.on) });
}
// 🆕 卷动位置记忆（统一行为，无开关参数）：每张便利贴记住「上次离开前」的卷动位置，
//    下次开窗（分体）或翻回来（翻页）即还原。body 是唯一卷动容器。
//    · 卷动中节流写回（400ms）；· 翻页换张／关窗前 flush（此刻 KEY/IDX 仍是离开的那一张）。
let scrollSaveTimer = null;
function currentScrollTop() {
  const body = document.getElementById('body');
  return body ? Math.max(0, Math.round(body.scrollTop)) : 0;
}
function restoreScrollPos() {
  const body = document.getElementById('body');
  if (!body) return;
  const pos = (typeof state.scrollPos === 'number' && isFinite(state.scrollPos)) ? Math.max(0, state.scrollPos) : 0;
  if (!pos) return;   // 0＝没记过，浏览器默认就在顶部，不必动
  // 等版面定稿（高亮重包、字级／配色套用都可能改变高度）后再定位，避免被后续重绘吃掉
  requestAnimationFrame(() => { body.scrollTop = pos; });
}
function writeScrollPos(pos) {
  if (!KEY) return;   // 翻页窗首次重绘时 KEY 还是空（URL 没带 key），别写出垃圾条目
  if (pos === (state.scrollPos || 0)) return;
  state.scrollPos = pos;
  ipcRenderer.invoke('sticky-note-set', { key: KEY, idx: IDX, patch: { scrollPos: pos } });
}
function scheduleScrollSave() {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => { scrollSaveTimer = null; writeScrollPos(currentScrollTop()); }, 400);
}
function flushScrollSave() {
  if (scrollSaveTimer) { clearTimeout(scrollSaveTimer); scrollSaveTimer = null; }
  writeScrollPos(currentScrollTop());
}
// ===== 🆕 主窗「跳转到便利贴」滚动定位＋闪烁 =====
//   主窗卡片与便利贴正文共用同一套 tlRenderNotes → data-line / data-start+data-end 索引完全一致，
//   故以坐标为权威匹配键；text 作为只读区块（无编辑按钮）的兜底匹配。
function normalizeUnitText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function closestUnit(el) {
  if (!el) return null;
  // ⚠️ tlRenderNotes 的 checkbox 行产出的是「裸 <span class="ev-md-check">」（不在 <li> 内），
  //    它的父元素就是 #body 容器。早期版本这里爬 'li, p, div, .md-unit' → closest('div') 命中 #body，
  //    结果把 .note-unit-flash 加在整张便利贴正文上，看起来就是「整个便利贴在闪」（2026-11-08 用户回报）。
  //    ✅ 只认真正的列表项 <li>（GFM 渲染路径），否则就用 .ev-md-check 本身 —— 绝不爬任意 div。
  //    闪烁改用「背景 + 外发光金环」，对 inline span 与块级 div 都可靠，且完全不改变布局。
  const check = el.closest('.ev-md-check');
  if (check) {
    const li = check.parentElement && check.parentElement.closest('li');
    return li || check;
  }
  return el.closest('.md-unit') || el;
}
function noteFindUnitElement(unit) {
  const body = document.getElementById('body');
  if (!body || !unit) return null;
  // ① 坐标精确匹配（用户右击的就是「编辑小圆点」，先找它自身，最贴近目标）
  if (unit.kind === 'check' && Number.isFinite(unit.line)) {
    const ed = body.querySelector('.ev-md-edit[data-line="' + unit.line + '"]');
    if (ed) return closestUnit(ed);
    const cb = body.querySelector('.ev-cb[data-line="' + unit.line + '"]');
    if (cb) return closestUnit(cb);
  }
  if (unit.kind === 'block' && Number.isFinite(unit.start) && Number.isFinite(unit.end) && unit.start >= 0) {
    const ed = body.querySelector('.md-unit-edit[data-start="' + unit.start + '"][data-end="' + unit.end + '"]');
    if (ed) return closestUnit(ed);
  }
  // ② 文本兜底：主窗与便利贴同源渲染，textContent 通常完全相等 → 精确相等优先。
  //    ⚠️ 早期版本用「任意方向子串 + 取最短命中」：当 unit.text 是一整个群的长文本时，
  //       会误命中某个只含一两个字的短 checkbox 行（它恰好是长文本的子串），闪错目标。
  //       現只接受「精确相等」或「候选包含目标文本」，且候选不许是 #body 之类的大容器。
  if (typeof unit.text === 'string' && unit.text) {
    const want = normalizeUnitText(unit.text);
    if (want) {
      const cands = Array.prototype.slice.call(body.querySelectorAll('.ev-md-check, .md-unit'));
      let exact = null, contained = null, containedLen = Infinity;
      cands.forEach((c) => {
        const t = normalizeUnitText(c.textContent);
        if (!t) return;
        if (t === want) { if (!exact) exact = c; }
        else if (t.indexOf(want) >= 0 && want.length >= 4 && t.length < containedLen) {
          contained = c; containedLen = t.length;
        }
      });
      const hit = exact || contained;
      if (hit) return closestUnit(hit);
    }
  }
  return null;
}
function noteScrollToCenter(el) {
  const body = document.getElementById('body');
  if (!body || !el) return;
  const bRect = body.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const delta = (eRect.top + eRect.height / 2) - (bRect.top + bRect.height / 2);
  // 两帧后设置：避开 restoreScrollPos 的 rAF 回写（它只设一次，且先跑），确保定位不被覆盖
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { body.scrollTop = Math.max(0, body.scrollTop + delta); });
  });
}
function flashUnit(el) {
  if (!el) return;
  // ① 复用项目里「找出相同 → 切换」已在真机验证的闪烁（fs-found-blink：4 秒金底＋金环脉冲），DRY。
  //    ⛔ 不再自己造 .note-unit-flash 动画：万一便利贴窗样式表没刷新/被覆盖，自造动画就会「完全看不见」。
  if (typeof blinkFoundLineTwice === 'function') blinkFoundLineTwice(el);
  else {
    el.classList.remove('fs-found-blink');
    void el.offsetWidth;
    el.classList.add('fs-found-blink');
    setTimeout(() => el.classList.remove('fs-found-blink'), 4200);
  }
  // ② Web Animations API 兜底：优先级高于所有 CSS（含 !important 之外的层叠），
  //    直接作用于元素，不受选择器特异性／样式表版本影响；线上若 CSS 失效仍必定闪。
  if (typeof el.animate === 'function') {
    try {
      el.animate([
        { backgroundColor: 'rgba(212,175,55,0)', boxShadow: '0 0 0 0 rgba(212,175,55,0)', offset: 0 },
        { backgroundColor: 'rgba(212,175,55,.55)', boxShadow: '0 0 0 3px rgba(212,175,55,.98)', offset: 0.25 },
        { backgroundColor: 'rgba(212,175,55,0)', boxShadow: '0 0 0 0 rgba(212,175,55,0)', offset: 0.5 },
        { backgroundColor: 'rgba(212,175,55,.55)', boxShadow: '0 0 0 3px rgba(212,175,55,.98)', offset: 0.75 },
        { backgroundColor: 'rgba(212,175,55,0)', boxShadow: '0 0 0 0 rgba(212,175,55,0)', offset: 1 }
      ], { duration: 2000, iterations: 2, easing: 'ease-in-out' });
    } catch (e) {}
  }
}
function noteFlashWholePage() {
  const note = document.getElementById('note');
  if (!note) return;
  note.classList.remove('note-page-flash');
  void note.offsetWidth;
  note.classList.add('note-page-flash');
  setTimeout(() => note.classList.remove('note-page-flash'), 2400);
}
function noteScrollFlashUnit(unit) {
  const el = noteFindUnitElement(unit);
  // 🆕 防回归守卫：只接受真正的「小事件(群)」单元，绝不把 #body / #note 等容器当目标。
  //    早期 closestUnit 会爬到 #body（check.parentElement.closest('div')），结果整张便利贴一起闪。
  const isRealUnit = !!el && el !== document.body &&
    el.id !== 'body' && el.id !== 'note' &&
    (el.classList.contains('ev-md-check') || el.classList.contains('md-unit') || /^LI$/i.test(el.tagName || ''));
  if (!isRealUnit) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[便利贴] 无法定位到指定的小事件(群)，改闪整页细边提示；unit=', unit, ' 匹配到的元素=', el && (el.id || el.className || el.tagName));
    }
    noteFlashWholePage();
    return;
  }
  noteScrollToCenter(el);
  // ⚠️ 闪烁必须延到「滚动落地」那一帧，并**重新查一次元素**：
  //    便利贴跳转常伴随 sticky-note-refresh / 翻页重绘竞态，旧 el 可能已被 innerHTML 换掉变成 detached——
  //    此时 scrollTop 照常会动（使用者看到「有滚动」），但 class 加在脱离文档的节点上**完全看不见**（11-08 回报）。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const connected = (typeof el.isConnected === 'boolean') ? el.isConnected : document.body.contains(el);
      const fresh = connected ? el : noteFindUnitElement(unit);
      if (!fresh) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[便利贴] 重绘后找不到目标单元；unit=', unit);
        noteFlashWholePage();
        return;
      }
      flashUnit(fresh);
    });
  });
}
function consumePendingFocusUnit() {
  if (!pendingFocusUnit) return;
  const u = pendingFocusUnit;
  pendingFocusUnit = null;
  // 🆕 诊断：DevTools 里可确认主窗右击带来的 focusUnit 是否真的送达便利贴窗
  if (typeof console !== 'undefined' && console.log) console.log('[便利贴] 收到 focusUnit，准备滚动+闪烁：', u);
  // 等下一帧：确保 init/renderFlipPage 内的 restoreScrollPos 已完成，再滚动定位
  requestAnimationFrame(() => noteScrollFlashUnit(u));
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

// 读取当前事件（KEY/IDX）的原始 notes（正式档直接回读 calendar.md；外部 include 文件用主程式推来的 ref）
function getEventNotes() {
  const ev = sourceEvent(KEY);
  return ev ? (ev.notes || '') : '';
}
// 统一重渲染正文/标题/日期/标签（用主窗口渲染好的 HTML）：编辑→渲染切换时复用
async function renderNoteContent() {
  const ev = sourceEvent(KEY);
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
    rememberRefMeta(Object.assign({ key: KEY }, res));
  } catch (e) {}
  const tip = (ev && typeof ev.titleTip === 'string' && ev.titleTip) ? ev.titleTip : '';
  setStickyTitle(titleEl, titleHtml || null, ev.title, tip);
  // 🆕 移除 raw 原文兜底：html 缺失时留白，绝不以未渲染 Markdown 源呈现（如 "- [ ] 11111"）。
  // 🆕 同上：重設 innerHTML 會把 scrollTop 歸零，先記後還（也避免被節流存成 0）
  const bodyElKeep = document.getElementById('body');
  const keepScrollPos = bodyElKeep ? Math.max(0, Math.round(bodyElKeep.scrollTop)) : 0;
  document.getElementById('body').innerHTML = html;
  noteApplyHighlight(); // 🆕 依當前定位詞重打高亮
  refreshNoteViewDisplay(); // 🆕 多段落 VIEW 便利贴：绑定（一次性事件委托）＋套用记忆的「顺序平铺／页签方式」与 active 段落
  if (keepScrollPos && bodyElKeep) bodyElKeep.scrollTop = keepScrollPos;
  syncUndoneChecksFilter();
  renderMeta(ev);
  renderTags(ev);
  return true;
}
// 🆕 多段落 VIEW 便利贴：套用记忆的「顺序平铺／页签方式」并显示 active 段落。
//   偏好按便利贴 key 记忆在 localStorage（vsr-display-mode:<key> / vsr-display-active:<key>）；
//   单段落或普通便利贴的 body 里没有 .vsr-display → 直接 no-op，零回归。
//   ⚠️ 关键：点击监听改成「挂在稳定的 #body 上、一次性事件委托」——body.innerHTML 被翻页（renderFlipPage）
//      或主进程推送刷新（applyNoteContent）重设后，监听也不会丢；旧写法把监听绑在瞬态 .vsr-display 上，
//      翻页重渲染后监听随 DOM 一起被销毁，导致桌面点「页签方式」毫无反应（手机端无翻页/刷新重渲染故正常）。
let noteViewDisplayBound = false;
function applyNoteViewDisplay() {
  const key = (typeof KEY !== 'undefined' && KEY) ? KEY : '';   // 模块级 KEY＝当前便利贴 key，作 localStorage 命名空间
  const body = document.getElementById('body');
  const disp = body && body.querySelector('.vsr-display');
  if (!disp) return;
  const segCount = Math.max(0, parseInt(disp.getAttribute('data-segs') || '0', 10) || 0);
  const store = (typeof localStorage !== 'undefined') ? localStorage : null;
  const modeKey = 'vsr-display-mode:' + key, activeKey = 'vsr-display-active:' + key;
  let mode = (store && store.getItem(modeKey) === 'tabs') ? 'tabs' : 'flat';
  let active = 0;
  if (store) { const a = parseInt(store.getItem(activeKey), 10); if (isFinite(a) && a >= 0 && a < segCount) active = a; }
  disp.classList.toggle('vsr-mode-tabs', mode === 'tabs');
  disp.classList.toggle('vsr-mode-flat', mode !== 'tabs');
  // 🆕 页签栏可能被搬到标题栏 #vsrTabs（桌面），故 mode 类也同步到 #vsrTabs，驱动 .vsr-tabs-head 的显隐
  const tabsHead = document.getElementById('vsrTabs');
  if (tabsHead) { tabsHead.classList.toggle('vsr-mode-tabs', mode === 'tabs'); tabsHead.classList.toggle('vsr-mode-flat', mode !== 'tabs'); }
  // 🆕 模式按钮可能已被搬到标题栏 #vsrHead（桌面），故在 #note 范围内查找（兼容正文内与头部两种位置）
  const noteEl = document.getElementById('note');
  if (noteEl) noteEl.querySelectorAll('.vsr-mode-btn').forEach((b) => { b.classList.toggle('vsr-active', b.getAttribute('data-mode') === mode); });
  // 🆕 页签（.vsr-tab）同样可能已被搬到 #vsrTabs（桌面），故在 #note 范围内查找（兼容两种位置）
  if (noteEl) noteEl.querySelectorAll('.vsr-tab').forEach((t) => { t.classList.toggle('vsr-active', parseInt(t.getAttribute('data-seg'), 10) === active); });
  disp.querySelectorAll('.vsr-seg').forEach((s) => { s.classList.toggle('vsr-active', parseInt(s.getAttribute('data-seg'), 10) === active); });
}
function onBodyViewDisplayClick(e) {
  const t = e.target.closest && e.target.closest('.vsr-mode-btn, .vsr-tab');
  if (!t) return;
  const key = (typeof KEY !== 'undefined' && KEY) ? KEY : '';
  const store = (typeof localStorage !== 'undefined') ? localStorage : null;
  const body = document.getElementById('body');
  const disp = body && body.querySelector('.vsr-display');
  if (!disp) return;
  const segCount = Math.max(0, parseInt(disp.getAttribute('data-segs') || '0', 10) || 0);
  if (t.classList.contains('vsr-mode-btn')) {
    const mode = t.getAttribute('data-mode') === 'tabs' ? 'tabs' : 'flat';
    if (store) store.setItem('vsr-display-mode:' + key, mode);
  } else if (t.classList.contains('vsr-tab')) {
    const s = parseInt(t.getAttribute('data-seg'), 10);
    if (isFinite(s) && s >= 0 && s < segCount) { if (store) store.setItem('vsr-display-active:' + key, String(s)); }
  }
  applyNoteViewDisplay();
}
function bindNoteViewDisplayOnce() {
  if (noteViewDisplayBound) return;
  const note = document.getElementById('note');
  if (!note) return;
  // 🆕 挂在稳定的 #note 上（不是 #body）：模式切换控件可能被搬到标题栏 #vsrHead，
  //    #body 只覆盖正文，会漏掉头部控件；#note 是头部与正文共同的稳定祖先。
  note.addEventListener('click', onBodyViewDisplayClick);
  noteViewDisplayBound = true;
}
// 每次重设 body.innerHTML 后调用：确保监听已绑（一次性）且套用记忆的模式/active 段落
function refreshNoteViewDisplay() {
  bindNoteViewDisplayOnce();
  applyNoteViewDisplay();
  placeViewDisplayToggleInHeader(); // 🆕 桌面：把模式切换控件搬到标题栏下方（VIEW 徽标之下），腾出正文空间
  applyViewSortAfterRender();       // 🆕 VIEW 贴：重绘后统一归一化排序键 → 留存原序 → 套用 sortMode
}

// 🆕 桌面专属：把正文 .vsr-display 里的 .vsr-display-toggle（顺序平铺／页签方式）搬到标题栏 #vsrHead，
//   置于 VIEW 徽标右下方；手机端不调用此函数，控件留在正文。每次重渲染先清空 #vsrHead 再搬入新节点，
//   避免翻页/刷新重渲染产生重复控件。单段落／普通便利贴没有 .vsr-display → 整块隐藏。
function placeViewDisplayToggleInHeader() {
  const head = document.getElementById('vsrHead');
  const tabsHead = document.getElementById('vsrTabs');
  const body = document.getElementById('body');
  const disp = body && body.querySelector('.vsr-display');
  // 无多段落控件 → 两处表头控件整块隐藏并清空（避免翻页/刷新重渲染残留旧节点）
  if (!head) { /* noop */ } else if (!disp) { head.innerHTML = ''; head.style.display = 'none'; }
  if (!tabsHead) { /* noop */ } else if (!disp) { tabsHead.innerHTML = ''; tabsHead.className = 'vsr-tabs-head'; }
  if (!head || !disp) return;
  // 🆕 模式切换控件（顺序平铺／页签方式）搬到 #vsrHead
  head.innerHTML = '';
  const toggle = disp.querySelector('.vsr-display-toggle');
  if (!toggle) { head.style.display = 'none'; }
  else { head.appendChild(toggle); head.style.display = 'flex'; }   // 节点整体搬移（委托监听挂在 #note 上，移出 #body 仍生效）
  // 🆕 段落页签栏（.vsr-tabs）搬到 #vsrTabs，使其像模式切换胶囊一样固定表头、滚动时不掉
  if (tabsHead) {
    tabsHead.innerHTML = '';
    const tabs = disp.querySelector('.vsr-tabs');
    if (!tabs) { tabsHead.className = 'vsr-tabs-head'; }   // 无页签（理论上多段落必有，保险）
    else { tabsHead.appendChild(tabs); }                    // 节点整体搬移；显隐由 applyNoteViewDisplay 同步的 mode 类驱动
  }
}
// 切换内容模式：edit=true 进编辑（textarea 填原始 notes）/ false 回渲染（重新取最新 HTML）
async function setEditMode(edit) {
  // 🆕 VIEW 贴是「🔔 提醒」汇总投影，没有可写回的原文 → 编辑模式一律不进
  //    （左下角把手已由 CSS 收起，这里挡的是键盘／程式化调用等其他入口）
  if (edit && isViewNote()) return;
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
    startGutterLoop();
    applyDoneFold();
  } else {
    if (note) note.classList.remove('editing');
    editDirty = false;
    resetDoneFold();
    // 渲染模式：重新拉取最新渲染结果（编辑回写后已落盘 + 主程式刷新过，这里确保显示最新）
    renderNoteContent();
  }
  syncEditSeg();
}

// 🆕 手动保存（⌘S）：把 textarea 内容回写；正式档 → calendar.md，外部 include 文件 → 该来源文件
let editSavePending = false;
async function saveNoteEdit() {
  const ea = document.getElementById('editArea');
  if (!ea || editSavePending) return false;
  editSavePending = true;
  const fullNotes = doneFoldCurrentText();   // 折叠中：把隐藏行按原锚点合并回全文再落盘
  let result;
  try {
    result = await ipcRenderer.invoke('sticky-note-save-edit', { key: KEY, idx: IDX, notes: fullNotes, src: SRC_FILE });
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
  // 本地缓存同步（外部 include 文件不走本地 calendar.md，重进编辑要能读回刚写的内容）
  const cached = refMeta.get(KEY);
  if (cached) cached.notes = fullNotes;
  refreshDoneFoldAfterSave();
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
    ea.title = '已保存到 ' + (SRC_FILE || 'calendar.md');
    ea.style.boxShadow = 'inset 0 0 0 1px rgba(34,197,94,.5)';
    dirtyTimer = setTimeout(() => { if (ea) ea.style.boxShadow = ''; dirtyTimer = null; }, 1600);
  }
}

// 🆕 编辑模式：左侧「只读」行号边条（做法参考 todo 编辑器的 #taskText 边条）
//  · 行号只显示、不可编辑（pointer-events:none），是编辑器的固有装饰（空文档也算 1 行）。
//  · 用离屏 mirror（与 editArea 同排版）量出每个逻辑行的纵向起点，故折行后行号仍精确对齐。
//  · rAF 轮询仅在编辑模式可见时运行：捕获一切值变化（输入/插入/撤销/JS 改值）与滚动，无需逐处挂钩。
function isEditAreaVisible() {
  const note = document.getElementById('note');
  const ea = document.getElementById('editArea');
  if (!note || !ea) return false;
  return note.classList.contains('editing') && ea.offsetParent !== null;
}
// ── 行号边条工厂（本窗体与主窗体各持一份同名实现，算法一致）───────────────────────
//  · 行号是编辑器的固有装饰，不是内容的附属：文档为空时 ''.split('\n') 得到 [''] → 恒有第 1 行。
//  · 离屏 mirror 常驻 DOM（不再每次 append/remove）＋ 镜像行与行号节点池化：
//    一次调用里「写」全在前、「读」集中在 offsetTop 那一批 → 每帧只强制排版一次，
//    打字延迟随行数线性而非平方增长。
//  · 改边条宽 → textarea 重排后，clientWidth 是同一趟读到的新值，mirror 立刻按新宽量测，
//    故不需要旧的 _settling 二次 rAF 复检（那趟复检会让行号滞后一帧、旧行号残留可见）。
function createLineGutter(cfg) {
  function els() {
    return {
      ta: document.getElementById(cfg.taId),
      gutter: document.getElementById(cfg.gutterId),
      inner: document.getElementById(cfg.innerId),
    };
  }
  let mirror = null;
  const mirrorLines = [];
  const mirrorTexts = [];
  const nums = [];
  let layoutKey = '';
  let lhApplied = '';
  let raf = null;
  let lastSig = null;
  let lastScrollTop = null;

  function lineHeightPx(cs) {
    const lh = cs.lineHeight;
    const fs = parseFloat(cs.fontSize) || 12;
    if (!lh || lh === 'normal') return fs * 1.2;
    if (lh.indexOf('px') >= 0) return parseFloat(lh);
    return parseFloat(lh) * fs; // 无量纲数值（如 1.5）→ ×字号
  }
  function ensureMirror() {
    if (mirror) return mirror;
    const m = document.createElement('div');
    m.setAttribute('aria-hidden', 'true');
    // height:0 ＋ overflow:hidden → 常驻离屏量测盒，绝不把文档撑出滚动条
    m.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;height:0;overflow:hidden';
    document.body.appendChild(m);
    mirror = m;
    return m;
  }
  function syncScroll(ta, inner) {
    inner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }

  function refresh() {
    const e = els();
    if (!e.ta || !e.gutter || !e.inner) return;
    if (!cfg.visible(e)) return;
    const ta = e.ta, gutter = e.gutter, inner = e.inner, m = ensureMirror();
    const cs = getComputedStyle(ta);
    const lhStr = lineHeightPx(cs) + 'px';
    const lines = ta.value.replace(/\r/g, '').split('\n');

    // 边条宽度用 ch（按边条自己的小字号）；textarea 的留白必须换成边条的实际像素宽，
    // 否则同一个 'calc(Nch + Mpx)' 字符串按正文大号字重新解析，两者会错开约 2px。
    // count：折叠时行号按原文编号（1,2,5…），宽度须按原文档总行数算，避免展开/折叠时边条抖宽。
    const totalLines = cfg.count ? Math.max(lines.length, cfg.count()) : lines.length;
    const targetWidth = 'calc(' + (String(totalLines).length + 1) + 'ch + ' + cfg.chrome + 'px)';
    if (gutter.style.width !== targetWidth) gutter.style.width = targetWidth;
    const marginPx = gutter.offsetWidth + 'px';
    if (ta.style.marginLeft !== marginPx) ta.style.marginLeft = marginPx;

    // mirror 与 textarea 同排版（含 padding），只在版签变化时重写 cssText，避免每帧改样式引发重排。
    // 镜像宽度取 textarea 内部宽度（clientWidth，box-sizing:border-box）→ 折行起点逐像素对齐。
    const cw = Math.max(1, ta.clientWidth);
    const key = [cw, cs.fontFamily, cs.fontSize, cs.fontWeight, cs.letterSpacing, cs.lineHeight,
      cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.tabSize || '8'].join('|');
    if (key !== layoutKey) {
      layoutKey = key;
      m.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
        'height:0;overflow:hidden;box-sizing:border-box;margin:0;border:0;' +
        'white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;' +
        'width:' + cw + 'px;' +
        'padding-top:' + cs.paddingTop + ';padding-right:' + cs.paddingRight +
        ';padding-bottom:' + cs.paddingBottom + ';padding-left:' + cs.paddingLeft + ';' +
        'font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight +
        ';letter-spacing:' + cs.letterSpacing + ';line-height:' + cs.lineHeight +
        ';tab-size:' + (cs.tabSize || '8');
    }

    // 写阶段①：镜像行数增删 ＋ 只替换内容真的变了的行
    while (mirrorLines.length > lines.length) { mirrorTexts.pop(); m.removeChild(mirrorLines.pop()); }
    while (mirrorLines.length < lines.length) {
      const d = document.createElement('div');
      m.appendChild(d);
      mirrorLines.push(d);
      mirrorTexts.push(null);
    }
    for (let i = 0; i < lines.length; i++) {
      if (mirrorTexts[i] !== lines[i]) {
        mirrorTexts[i] = lines[i];
        // 空行必须占 1 行高：完全没有文字的行盒高度为 0，补一个换行符才有行高
        mirrorLines[i].textContent = lines[i] === '' ? '\n' : lines[i];
      }
    }

    // 读阶段：上面全是写，第一次 offsetTop 才强制排版，之后是纯读 → 每次调用只排版一次
    const tops = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) tops[i] = mirrorLines[i].offsetTop;

    // 写阶段②：行号节点池化复用（inner 若被外部重建过，池里的引用已失效 → 连容器一起清空重来，
    //           只丢引用会让旧行号变成留在边条里的孤儿节点、行数越滚越多）
    if (nums.length && nums[0].parentNode !== inner) { inner.textContent = ''; nums.length = 0; }
    while (nums.length > lines.length) inner.removeChild(nums.pop());
    while (nums.length < lines.length) {
      const n = document.createElement('div');
      n.className = 'gutter-num';
      inner.appendChild(n);
      nums.push(n);
    }
    const lhChanged = lhStr !== lhApplied;
    if (lhChanged) lhApplied = lhStr;
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const top = tops[i] + 'px';
      if (n._top !== top) { n._top = top; n.style.top = top; }
      if (lhChanged) { n.style.height = lhStr; n.style.lineHeight = lhStr; }
      const label = cfg.label ? String(cfg.label(i)) : String(i + 1);
      if (n._label !== label) { n._label = label; n.textContent = label; }
    }

    syncScroll(ta, inner);
    if (cfg.decorate) cfg.decorate({ ta: ta, gutter: gutter, inner: inner, lines: lines, tops: tops, lh: lhStr });
  }

  // 版签＝内容 + 尺寸 + 字号/行高/内边距：拖拽改窗体尺寸、菜单缩放字号、换主题都可能改排版，
  // 值没变也一样要重建（否则边条会按旧折行结果排版）。
  function signature(ta) {
    const cs = getComputedStyle(ta);
    return ta.value + '\0' + ta.clientWidth + 'x' + ta.clientHeight + 'x' +
      cs.fontSize + '/' + cs.lineHeight + '/' + cs.paddingLeft + '/' + cs.paddingTop;
  }
  function tick() {
    const e = els();
    if (!e.ta || !cfg.visible(e)) { raf = null; return; }  // 离开编辑模式 → 自动停轮询
    const sig = signature(e.ta);
    if (sig !== lastSig) {
      lastSig = sig;
      lastScrollTop = e.ta.scrollTop;
      refresh();
    } else if (e.ta.scrollTop !== lastScrollTop) {
      lastScrollTop = e.ta.scrollTop;
      syncScroll(e.ta, e.inner);
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    refresh: refresh,
    start: function () {
      if (raf == null) {
        lastSig = null;
        lastScrollTop = null;
        raf = requestAnimationFrame(tick);
      }
    },
    invalidate: function () { lastSig = null; },
  };
}
const editAreaGutter = createLineGutter({
  taId: 'editArea',
  gutterId: 'editAreaGutter',
  innerId: 'editAreaGutterInner',
  chrome: 10,
  visible: function () { return isEditAreaVisible(); },
  // 折叠时行号沿用原文编号（可见行显示 1,2,5…），并在折叠缝隙上渲染可点开该块的标记
  count: function () { return doneFoldState ? doneFoldState.orig.length : 0; },
  label: function (i) { return doneFoldLabel(i); },
  decorate: function (info) { doneFoldRenderRail(info); },
});
function refreshLineGutter() { editAreaGutter.refresh(); }
function startGutterLoop() { editAreaGutter.start(); }

// ===== 🆕 编辑模式：折叠已完成的 checkbox（- [x] / - [X]）=====
// textarea 没有「隐藏行」能力：编辑框里放投影后的可见行，被折叠的原始行留在 doneFoldState；
// 展开或保存时用行级 LCS 依原锚点插回 —— 折叠期间改/删任何可见行都不会丢隐藏内容。
// 只折叠 checkbox 那一行（支持 > 引用前缀）；围栏代码块里的 - [x] 是范例，不折。
const DONE_CHECK_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\](?=[ \t]|$)/;

function doneFoldHiddenIndexes(lines) {
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
    if (DONE_CHECK_RE.test(line)) hidden.push(i);
  }
  return hidden;
}

function projectDoneLines(lines, hiddenIdx) {
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

// 行级 LCS：回传 base 每行在 cur 的行号（-1＝被改/删）。超大文档退化为「前缀＋后缀」对齐，
// 只在中间改动处失去精确锚点（隐藏行仍按顺序插回），避免 O(n*m) 内存。
// 行被编辑（非删/插）时 LCS 认不出是同一行，会让相邻隐藏块错位到编辑行前面；
// 用「共同前缀 ≥ 较短行的 60%（且至少 3 字符）」把它们配回锚点。仅用于锚点映射，不改输出内容。
function doneLineSimilar(a, b) {
  const x = String(a == null ? '' : a).trim();
  const y = String(b == null ? '' : b).trim();
  if (!x || !y || x === y) return false;
  const min = Math.min(x.length, y.length);
  if (min < 3) return false;
  let i = 0;
  while (i < min && x.charAt(i) === y.charAt(i)) i++;
  return i >= 3 && i >= min * 0.6;
}

function matchDoneLines(base, cur) {
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
        if (doneLineSimilar(base[ub[k]], cur[uc[k]])) { out[ub[k]] = uc[k]; curMatched.add(uc[k]); }
      }
    }
    prevI = nextI; prevJ = nextJ;
  }
  return out;
}

// 合并投影回全文，同时给出「旧原文行号 → 合并后行号」映射（个别展开时要把它翻译到新坐标）
function mergeDoneLinesDetailed(orig, hiddenIdx, baseMap, curView) {
  if (!hiddenIdx || !hiddenIdx.length) return { lines: curView.slice(), origToOut: null };
  const skip = new Set(hiddenIdx);
  const base = baseMap.map(function (i) { return orig[i]; });
  const bn = base.length;
  // 空 textarea 的 '' split 出 ['']：原本就没有可见行（或可见行被全删）时视作 0 行，
  // 否则会在插回的隐藏行前面凭空多一条空行。
  const cur = (curView.length === 1 && curView[0] === '' && !(bn === 1 && base[0] === '')) ? [] : curView;
  const match = matchDoneLines(base, cur);
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
  // 每个隐藏行的锚点＝它前面有多少可见行（投影坐标），再映射回当前视图坐标
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

function mergeDoneLines(orig, hiddenIdx, baseMap, curView) {
  return mergeDoneLinesDetailed(orig, hiddenIdx, baseMap, curView).lines;
}

let doneFoldState = null; // { orig, hidden, baseMap, expanded }；null＝当前未折叠
let doneFoldEpoch = 0;
let doneFoldInfoCache = { key: null, info: null };

function doneFoldEl() { return document.getElementById('editArea'); }
function doneFoldCurrentText() {
  const ea = doneFoldEl();
  if (!ea) return '';
  if (!doneFoldState) return ea.value;
  return mergeDoneLines(doneFoldState.orig, doneFoldState.hidden, doneFoldState.baseMap, ea.value.split('\n')).join('\n');
}
function doneFoldBump() {
  doneFoldEpoch++;
  doneFoldInfoCache.key = null;
}
// 折叠行数（已从画面收起的）／已完成总数（折叠中＋仍可见的）
function doneFoldFoldedCount() { return doneFoldState ? doneFoldState.hidden.length : 0; }
function doneFoldCompletedCount() {
  const ea = doneFoldEl();
  if (!ea) return 0;
  return doneFoldFoldedCount() + doneFoldHiddenIndexes(ea.value.split('\n')).length;
}
function syncDoneFoldChip() {
  const chip = document.getElementById('editFoldChip');
  if (!chip) return;
  const folded = doneFoldFoldedCount();
  const completed = doneFoldCompletedCount();
  if (!editMode || !state.undoneChecksOnly || !completed) {
    chip.style.display = 'none';
    chip.textContent = '';
    chip.removeAttribute('title');
    chip.setAttribute('aria-pressed', 'false');
    return;
  }
  chip.style.display = 'inline-block';
  chip.textContent = (folded ? '显示已完成 ' : '隐藏已完成 ') + (folded || completed);
  chip.title = folded
    ? '还有 ' + folded + ' 行已完成折叠中（连同行号）；点击全部展开，或点边条上的 ▸ 单独展开某一块'
    : '把 ' + completed + ' 行已完成 checkbox 连同行号一起折叠';
  chip.setAttribute('aria-pressed', folded ? 'true' : 'false');
}
function refreshDoneFoldChip() { syncDoneFoldChip(); }
function setDoneFoldState(lines, hiddenIdx, expandedSet) {
  const ea = doneFoldEl();
  const fullText = lines.join('\n');
  const hidden = (hiddenIdx || []).slice().sort(function (a, b) { return a - b; });
  doneFoldState = null;
  doneFoldBump();
  if (!hidden.length) {
    if (ea && ea.value !== fullText) ea.value = fullText;
    syncDoneFoldChip();
    editAreaGutter.invalidate();
    editAreaGutter.start();
    return;
  }
  const proj = projectDoneLines(lines, hidden);
  doneFoldState = { orig: lines, hidden: hidden, baseMap: proj.map, expanded: expandedSet || new Set() };
  const viewText = proj.view.join('\n');
  if (ea && ea.value !== viewText) ea.value = viewText;
  syncDoneFoldChip();
  editAreaGutter.invalidate();
  editAreaGutter.start();
}
function applyDoneFold() {
  const ea = doneFoldEl();
  if (!ea) return;
  // 未勾选「只显示未完成 checkbox」＝不折叠（已有折叠则先还原全文）
  if (!state.undoneChecksOnly) { expandDoneFold(); syncDoneFoldChip(); return; }
  const keepTop = ea.scrollTop;
  const full = doneFoldCurrentText().split('\n');
  setDoneFoldState(full, doneFoldHiddenIndexes(full), new Set());
  if (doneFoldEl()) doneFoldEl().scrollTop = keepTop;
}
function expandDoneFold() {
  const ea = doneFoldEl();
  if (!ea || !doneFoldState) return;
  const keepTop = ea.scrollTop;
  const full = doneFoldCurrentText();
  doneFoldState = null;
  doneFoldBump();
  if (ea.value !== full) ea.value = full;
  ea.scrollTop = keepTop;
  syncDoneFoldChip();
  editAreaGutter.invalidate();
  editAreaGutter.start();
}
// 只展开某一块折叠行（边条上的 ▸N）；其余折叠块保持折叠
function expandDoneFoldBlock(targets) {
  const ea = doneFoldEl();
  if (!ea || !doneFoldState || !targets || !targets.length) return;
  const keepTop = ea.scrollTop;
  const old = doneFoldState;
  const merged = mergeDoneLinesDetailed(old.orig, old.hidden, old.baseMap, ea.value.split('\n'));
  const map = merged.origToOut;
  const tr = function (i) { const v = map ? map[i] : -1; return v == null ? -1 : v; };
  const expanded = new Set();
  old.expanded.forEach(function (i) { const j = tr(i); if (j >= 0) expanded.add(j); });
  targets.forEach(function (i) { const j = tr(i); if (j >= 0) expanded.add(j); });
  const full = merged.lines;
  const hidden = doneFoldHiddenIndexes(full).filter(function (i) { return !expanded.has(i); });
  setDoneFoldState(full, hidden, expanded);
  if (doneFoldEl()) doneFoldEl().scrollTop = keepTop;
}
function toggleDoneFold() {
  if (doneFoldFoldedCount()) expandDoneFold(); else applyDoneFold();
}
function resetDoneFold() {
  doneFoldState = null;
  doneFoldBump();
  syncDoneFoldChip();
}
// 保存成功后：以「合并后的全文」重建折叠基线（期间新勾成 [x] 的可见行顺手折进去）
function refreshDoneFoldAfterSave() {
  if (!state.undoneChecksOnly || !doneFoldState) { expandDoneFold(); refreshDoneFoldChip(); return; }
  const full = doneFoldCurrentText().split('\n');
  setDoneFoldState(full, doneFoldHiddenIndexes(full), new Set());
}

// 折叠缝隙锚点：与 mergeDoneLinesDetailed 同一套映射（折叠块插在哪，标记就画在哪）
function doneFoldAnchorOf(match, bn, curLen, pos) {
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

// 折叠视图的行号标签与折叠块位置（缓存：值与折叠状态没变就不重跑 LCS）
function doneFoldViewInfo() {
  const ea = doneFoldEl();
  if (!ea || !doneFoldState) return null;
  const key = doneFoldEpoch + '\0' + ea.value;
  if (doneFoldInfoCache.key === key) return doneFoldInfoCache.info;
  const st = doneFoldState;
  const base = st.baseMap.map(function (i) { return st.orig[i]; });
  const bn = base.length;
  const lines = ea.value.split('\n');
  let cur = lines;
  if (lines.length === 1 && lines[0] === '' && bn > 0 && !(bn === 1 && base[0] === '')) cur = [];
  const match = matchDoneLines(base, cur);
  const curLen = cur.length;
  const curToBase = new Array(curLen).fill(-1);
  for (let bi = 0; bi < bn; bi++) {
    const cj = match[bi];
    if (cj >= 0 && curToBase[cj] < 0) curToBase[cj] = bi;
  }
  // 可见行编号＝它在原文里的行号（折叠不重排）；新行取邻近编号间的空位
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
  // ⚠️ 必须用 while 逐行推进：若用 for，内层跳过折叠块后外层还会再 i++，
  //    会把「折叠块后第一条可见行」漏掉不计数 → visibleBefore 逐块少 1，▸ 标记越往后偏得越多。
  let i = 0;
  while (i < st.orig.length) {
    if (!hiddenSet.has(i)) { visibleBefore++; i++; continue; }
    const first = i;
    const indices = [];
    while (i < st.orig.length && hiddenSet.has(i)) { indices.push(i); i++; }
    blocks.push({
      at: Math.max(0, Math.min(curLen, doneFoldAnchorOf(match, bn, curLen, visibleBefore))),
      count: indices.length,
      indices: indices,
      firstLine: first + 1,
      lastLine: i,
    });
  }
  const info = { labels: labels, blocks: blocks };
  doneFoldInfoCache.key = key;
  doneFoldInfoCache.info = info;
  return info;
}
function doneFoldLabel(i) {
  const info = doneFoldViewInfo();
  if (!info || info.labels[i] == null) return i + 1;
  return info.labels[i];
}
// 每个折叠块在边条上画一个可点标记（▸N）：点哪块只展开哪块
function doneFoldRenderRail(context) {
  const inner = context && context.inner;
  if (!inner) return;
  let rail = inner.querySelector('.fold-rail');
  const info = doneFoldViewInfo();
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
    btn.title = '第 ' + b.firstLine + '–' + b.lastLine + ' 行已完成（' + b.count + ' 行），点击展开这一块';
    btn.style.top = positions[k] + 'px';
    (function (indices) {
      btn.addEventListener('mousedown', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); expandDoneFoldBlock(indices); });
    })(b.indices);
    rail.appendChild(btn);
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

// 🆕 顺序版本号：initFlip 的「拉取」与主进程的「推送」可能交错，晚到的拉取结果不得覆盖更新的推送
let flipOrderSeq = 0;
// 🆕 静默重绘：后台对齐清单导致的第 N/T 张讯息框不弹（避免开窗/翻着看时突然闪一下）
let flipRenderQuiet = false;

function sameFlipOrder(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key) return false;
    if ((+a[i].idx || 0) !== (+b[i].idx || 0)) return false;
  }
  return true;
}

// 🆕 唯一的「采用主进程顺序」入口：只换清单／页次，重绘由调用方决定。
//    当前这张优先按「标题|日期|idx」认领（Calendar 重排会换掉 evpN key，按 key 找会指到别张），
//    认不到才退 key+idx，最后退回原位置。
function applyFlipOrder(order) {
  const prevOrder = flipOrder;
  const prevIndex = flipIndex;
  const current = prevOrder[prevIndex];
  const currentId = current ? stickyFlipIdentity(current) : '';
  const currentKey = current ? String(current.key || '') : '';
  const currentIdx = current ? (+current.idx || 0) : 0;
  flipOrder = (Array.isArray(order) ? order : []).filter(note => note && typeof note.key === 'string');
  flipTotal = flipOrder.length;
  let target = -1;
  if (currentId) target = flipOrder.findIndex(note => stickyFlipIdentity(note) === currentId);
  if (target < 0 && currentKey) target = flipOrder.findIndex(note => note.key === currentKey && (+note.idx || 0) === currentIdx);
  if (target < 0) target = Math.min(Math.max(0, prevIndex), Math.max(0, flipTotal - 1));
  flipIndex = target;
  const changed = !sameFlipOrder(prevOrder, flipOrder);
  updateFlipInd();
  return { changed, index: target };
}
// 清单被设定档全部关掉时，翻页窗仍要留住（它是重新开启的入口），但不能继续显示旧内容
function clearFlipPage() {
  document.getElementById('title').textContent = '(没有可翻页的便利贴)';
  document.getElementById('meta').textContent = '';
  document.getElementById('tags').innerHTML = '';
  document.getElementById('body').innerHTML = '';
  updateFlipInd();
}

// 🆕 后台对齐：窗口脚本开始运行之前主进程推的「顺序更新」会整条丢掉（webContents 还没挂监听），
//    这里再主动查两次把启动瞬间错过的顺序补回来（拉取不会丢）；只在清单真的变了才重绘。
async function resyncFlipOrder() {
  let res = null;
  try { res = await ipcRenderer.invoke('sticky-note-order'); } catch (e) { return; }
  if (!res || !Array.isArray(res.order)) return;
  const r = applyFlipOrder(res.order);
  if (!r.changed || !flipTotal) return;
  // 编辑中绝不抢画面（未保存改动会被 renderFlipPage 的确认框打断）：只更新页数，等下次翻页再取内容
  if (editMode) return;
  flipRenderQuiet = true;
  try { await renderFlipPage(flipIndex); } finally { flipRenderQuiet = false; }
}

// 🆕 翻页模式入口：拉取顺序、建翻页窗、渲染「上次停留的那张」，并绑定 ◀ ▶ 与 ← → 翻页
// ⚠️ 所有 IPC 监听必须在任何 await 之前挂好：窗口刚建好时主进程可能立刻推「顺序更新」，
//    以前要等两次 invoke 往返后才挂监听，那段时间的推送会整条丢掉 →
//    症状：翻页窗写「第 9 / 9 张」，而 ☰ 清单现场查询已经是 12 项（点第 12 项才补回来）。
// 把「显示某一张」的 payload 换算成页次：先按 key+idx（主进程权威），index 只作兜底。
//   监听与 initFlip 的「消费早到请求」共用这一处，避免两套定位口径漂移。
function flipPageTargetOf(payload) {
  if (!payload) return -1;
  if (typeof payload.key === 'string' && payload.key) {
    const t = flipOrder.findIndex(note => note.key === payload.key && (+note.idx || 0) === (+payload.idx || 0));
    if (t >= 0) return t;
  }
  return Number.isInteger(payload.index) ? payload.index : -1;
}
function showFlipPagePayload(payload) {
  const target = flipPageTargetOf(payload);
  if (target >= 0 && flipTotal) renderFlipPage(target);
}

async function initFlip() {
  document.getElementById('note').classList.add('flip');
  // ① 顺序更新（切开关 / Calendar 同步都会来这一条）：采纳新清单后必须重绘，
  //    因为 sync 只发这一条事件，当前页的新内容／新 key 都靠这次重取
  ipcRenderer.on('sticky-note-order-updated', (e, payload) => {
    flipOrderSeq++;
    applyFlipOrder(payload && payload.order);
    if (!flipTotal) { clearFlipPage(); return; }
    if (payload && payload.skipRender) return; // 紧接着会推 apply-state（可能还要跳页），避免两次重绘互踩
    if (editMode) return; // 编辑中不抢画面（页数已更新，内容等翻页再取）
    renderFlipPage(flipIndex);
  });
  // ② 指定显示某一张：payload 带主进程的权威顺序 → 先对齐清单，再按 key+idx 定位（index 只作兜底）
  //    ⚠️ flipTotal 还是 0（initFlip 尚未拿到 order）时不能丢：暂存给 initFlip 消费，
  //    否则「便利贴原本没开 → 主窗按徽标开启并跳页」这次请求会整包失效。
  ipcRenderer.on('sticky-note-show-page', (e, payload) => {
    if (!payload) return;
    if (Array.isArray(payload.order)) { flipOrderSeq++; applyFlipOrder(payload.order); }
    // 🆕 顺带要定位+闪烁的小事件(群)：翻页渲染后会由 renderFlipPage 末尾消费（含 pendingShowPage 早到分支）
    if (typeof payload.focusUnit !== 'undefined') pendingFocusUnit = payload.focusUnit;
    if (!flipTotal) { pendingShowPage = payload; return; }
    showFlipPagePayload(payload);
  });
  const seq0 = flipOrderSeq;
  const [orderRes, geomRes] = await Promise.all([
    ipcRenderer.invoke('sticky-note-order').catch(() => null),
    ipcRenderer.invoke('sticky-note-get', { key: FLIP_KEY, idx: FLIP_IDX }).catch(() => null)
  ]);
  const geom = geomRes || {};
  Object.assign(state, {
    w: (typeof geom.w === 'number' && geom.w > MIN_W) ? geom.w : DEFAULT_W,
    h: (typeof geom.h === 'number' && geom.h > MIN_H) ? geom.h : DEFAULT_H,
    minimized: !!geom.minimized,
    minH: (typeof geom.minH === 'number' && geom.minH > 20) ? geom.minH : 0
  });
  setupControls();
  // 拉取回来之前若有推送到达（seq 变了）→ 以推送为准，丢掉这份可能更旧的快照
  if (flipOrderSeq === seq0) applyFlipOrder(orderRes && orderRes.order);
  // 🆕 消费「开窗瞬间早到、当时 flipTotal 还是 0」的跳页请求（见上方 ② 监听）。
  //    该 payload 自带的 order 已被监听采纳（flipOrderSeq 已变），所以这里不会再被旧快照盖掉。
  const pendingTarget = pendingShowPage ? flipPageTargetOf(pendingShowPage) : -1;
  pendingShowPage = null;
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
  // 🆕 有主窗指定的目标页（例如从编辑行程按便利贴徽标跳来）就优先翻到那一页；
  //    否则照旧用「上一次结束前显示的那张」：key 是按 calendar.md 位置生成的，
  //    存档重排后会指到别的贴纸，所以先用「标题|日期|idx」认领，认不到才退回 key+idx，再不行回第 1 张。
  const startIndex = (pendingTarget >= 0 && pendingTarget < flipTotal)
    ? pendingTarget
    : flipStartIndex(
        typeof geom.lastKey === 'string' ? geom.lastKey : '',
        Number.isFinite(+geom.lastIdx) ? +geom.lastIdx : 0,
        typeof geom.lastId === 'string' ? geom.lastId : ''
      );
  // 🆕 启动通知：先把勾了「通知讯息」的 VIEW 贴依序闪烁显示，结束才进正常显示
  //    （runNotifyPhase 内部最后会渲染 startIndex；回传 false＝没有通知贴，这里照旧渲染）
  let ranNotify = false;
  try { ranNotify = await runNotifyPhase(startIndex); } catch (e) { ranNotify = false; }
  if (!ranNotify) await renderFlipPage(startIndex);
  // 启动兜底：补回「脚本还没挂监听时被丢掉」的顺序更新（两次足够覆盖 Calendar 载入/同步的时间差）
  [800, 2400].forEach((delay) => { setTimeout(resyncFlipOrder, delay); });
}
// ===== 🆕 启动通知：勾了「通知讯息」的 VIEW 贴，便利贴启动时先外框闪烁显示 =====
//   行为：依序显示每一张（闪烁），每张停留 notifySeconds 秒，或使用者按「✕ 关闭」提前换下一张；
//   全部结束后才渲染原本要显示的那一张（startIndex）→ 之后的正常显示行为完全不变。
//   ⚠️ 通知贴本身就是便利贴清单里的一张（不新增、不移除），这里只是「启动时先翻到它」。
let notifyActive = false;     // 是否正处于通知阶段
let notifyRendering = false;  // 通知阶段自己触发的 renderFlipPage（用来分辨「使用者手动翻页」）
let notifyTimer = null;       // 倒数 interval
let notifyResolve = null;     // 结束当前这一张（倒数结束／手动关闭／被取消）
const NOTIFY_FALLBACK_SECONDS = 15;
function notifySecondsOf(note) {
  const v = note && note.notifySeconds;
  if (typeof v === 'number' && isFinite(v)) return Math.min(600, Math.max(1, Math.round(v)));
  return NOTIFY_FALLBACK_SECONDS;
}
function notifyQueueFromOrder() {
  const out = [];
  flipOrder.forEach((note, i) => {
    // 只认 VIEW 贴（__view__ 前缀）且勾了通知的
    if (!note || !note.notify || !isViewKey(note.key)) return;
    out.push({ index: i, seconds: notifySecondsOf(note) });
  });
  return out;
}
function notifySetChrome(on) {
  const noteEl = document.getElementById('note');
  if (noteEl) noteEl.classList.toggle('notify-flash', !!on);
  const badge = document.getElementById('notifyBadge');
  if (badge) badge.classList.toggle('show', !!on);
  const btn = document.getElementById('notifyClose');
  if (btn) btn.classList.toggle('show', !!on);
}
// 结束／放弃通知阶段：停倒数、唤醒等待者、收掉闪烁与按钮
function notifyCancel() {
  if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
  if (notifyResolve) { const r = notifyResolve; notifyResolve = null; r(); }
  notifyActive = false;
  notifySetChrome(false);
}
// 等这一张的秒数（同时跑倒数显示）；被 notifyCancel 唤醒＝放弃
function notifyWait(seconds) {
  return new Promise((resolve) => {
    let left = Math.max(1, seconds);
    const el = document.getElementById('notifyCount');
    const tick = () => { if (el) el.textContent = left + 's'; };
    const finish = () => {
      if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
      notifyResolve = null;
      resolve();
    };
    tick();
    notifyResolve = finish;
    notifyTimer = setInterval(() => {
      left -= 1;
      tick();
      if (left <= 0) finish();
    }, 1000);
  });
}
// 手动关闭：结束「当前这一张」→ 交给回圈进下一张（最后一张则由回圈进正常显示）
function notifyCloseCurrent() {
  if (!notifyActive) return;
  if (notifyResolve) { const r = notifyResolve; notifyResolve = null; if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; } r(); }
}
// 回传 true＝有跑过通知阶段（return false 时呼叫端要自己渲染 startIndex）
async function runNotifyPhase(startIndex) {
  const queue = notifyQueueFromOrder();
  if (!queue.length) return false;
  notifyActive = true;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    notifyRendering = true;
    try { await renderFlipPage(item.index); } finally { notifyRendering = false; }
    if (!notifyActive) return true;   // 期间被取消（例如使用者手动翻页）→ 交由那次翻页作主
    notifySetChrome(true);
    await notifyWait(item.seconds);
    if (!notifyActive) return true;
  }
  notifyCancel();                     // 收尾：停倒数、收闪烁
  notifyRendering = true;
  try { await renderFlipPage(startIndex); } finally { notifyRendering = false; }
  return true;
}
function notifyBindControls() {
  const btn = document.getElementById('notifyClose');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); notifyCloseCurrent(); };
}

function stickyFlipIdentity(note) {
  const title = String((note && note.title) || '');
  const date = String((note && note.date) || '');
  if (!title && !date) return '';
  return title + '|' + date + '|' + (+((note && note.idx) || 0));
}
function flipStartIndex(lastKey, lastIdx, lastId) {
  if (!flipTotal) return 0;
  if (lastId) {
    const same = flipOrder.findIndex((note) => stickyFlipIdentity(note) === lastId);
    if (same >= 0) return same;
  }
  if (lastKey) {
    const exact = flipOrder.findIndex((note) => note.key === lastKey && (+note.idx || 0) === lastIdx);
    if (exact >= 0) return exact;
  }
  return 0;
}
// 只发 IPC 更新内存，落盘由主进程去抖（关窗时会立即 flush）
function persistFlipPosition() {
  const current = flipOrder[flipIndex];
  if (!current) return;
  ipcRenderer.send('sticky-note-flip-position', {
    lastKey: KEY,
    lastIdx: IDX,
    lastId: stickyFlipIdentity(current)
  });
}

// 🆕 便利貼窗 ☰ 菜單 combo 搜尋框：定位開關（locate toggle）—— 過濾翻頁清單 + 以 reverse 高亮當前這張
//   規則（與手機端／LITE 一致）：有搜尋內容時預設開啟（可手動關）；無內容時固定關閉（disabled，不可開啟）。
let menuSearchQuery = '';   // 目前查詢詞（已 trim + 轉小寫）
let menuLocateOn = false;   // 使用者意圖：預設開 / 手動關
let menuLastQueryEmpty = true; // 上一次查詢是否為空（用於「內容出現→預設開」的轉場判斷）
function menuGetQuery() {
  const el = document.getElementById('mStickySearch');
  return (((el && el.value) || '').trim().toLowerCase());
}
function menuLocateEffective() { return menuLocateOn && !!menuGetQuery(); }
// 搜尋框 oninput：轉場（空→非空預設開／非空→空強制關）→ 同步開關 → 重過濾清單 → 即時高亮當前張
function menuOnSearchInput() {
  const q = menuGetQuery();
  const empty = !q;
  if (!empty && menuLastQueryEmpty) menuLocateOn = true; // 內容剛出現 → 預設開啟
  if (empty) menuLocateOn = false;                       // 內容消失 → 強制關閉
  menuLastQueryEmpty = empty;
  menuSearchQuery = q;
  menuSyncLocate();
  menuApplyLocate();
  loadStickyMenuNotes();
}
// 手動點擊定位開關（無內容時 disabled，不可開啟）
function menuToggleLocate() {
  if (!menuGetQuery()) return;
  menuLocateOn = !menuLocateOn;
  menuSyncLocate();
  menuApplyLocate();
}
// 把目前定位狀態反映到 NOTE_HL 並重打高亮（渲染模式；編輯模式下 body 隱藏，重打也無害）
function menuApplyLocate() {
  NOTE_HL = menuLocateEffective() ? menuGetQuery() : '';
  noteApplyHighlight();
}
// 同步定位按鈕的 disabled / aria-pressed / 文字狀態
function menuSyncLocate() {
  const btn = document.getElementById('mStickyLocateBtn');
  if (!btn) return;
  const q = menuGetQuery();
  const on = menuLocateOn && !!q;
  btn.disabled = !q;
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('on', on);
  btn.textContent = on ? '📍 定位：開' : '📍 定位';
}

// 🆕 翻页清单「四类识别徽标」单一可信来源：
//   主档一般（calendar.md）／外部 include 档一般／VIEW 投影／临时（仅本会话、未落盘）。
//   判定优先级固定 VIEW → 临时 → 有 src＝include → 其余＝主档，四类互斥，一张贴只有一个徽标。
//   资料来自 sticky-note-order 的 note（主进程 sync 时 Object.assign 原样保留 view/temp/src），
//   refMeta 只作兜底（分体窗首帧或旧快照缺字段时）。旧版「VIEW 用斜体识别」已全面改为徽标。
const STICKY_KIND_META = {
  main:    { mark: '主', tip: '一般便利贴 · 主档 calendar.md' },
  include: { mark: '外', tip: '一般便利贴 · 外部 include 档' },
  view:    { mark: '視', tip: 'VIEW 便利贴 · 自动汇总投影' },
  temp:    { mark: '臨', tip: '临时便利贴 · 仅本会话，未写入 calendar.md' }
};
function stickyKindOf(item) {
  if (!item) return { kind: 'main', src: '' };
  const cached = refMeta.get(item.key) || {};
  const src = String(item.src || cached.src || '').trim();
  if (isViewKey(item.key) || item.view) return { kind: 'view', src: '' };
  if (item.temp || cached.temp) return { kind: 'temp', src };
  return src ? { kind: 'include', src } : { kind: 'main', src: '' };
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
    // 🆕 combo 搜尋：依目前查詢詞過濾清單（標題＋內容，不區分大小寫）；空查詢＝不過濾
    const q = menuSearchQuery;
    const menuMatch = (item) => {
      if (!q) return true;
      const hay = (String(item.title || item.key || '') + ' ' + String(item.notes || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    };
    const pageShown = pageNotes.filter(menuMatch);
    const inactiveShown = inactiveNotes.filter(menuMatch);
    const notesShown = notes.filter(menuMatch);
    // 🆕 这份清单是「现场查询」的结果，而翻页窗的 flipOrder 只是开窗那一刻的快照；
    //    这里顺手对齐，让「第 N / T 张」与这份清单永远同一来源（只换清单与页次，不动画面内容）
    if (IS_FLIP && mode === 'flip' && Array.isArray(result.order)) {
      flipOrderSeq++;
      applyFlipOrder(result.order);
    }
    // 标题写清算术：翻页张数 / 未开启张数 分开讲，避免把「未开启」的行数也算成页数
    // 🆕 一行化（省纵向空间）：可见文案只留「翻页清单 N 张（另有 M 张未开启）」，超出宽度自动省略号；
    //    完整说明（怎么操作、未开启为何不计入）放 title tooltip。分体模式同一套处理。
    // 🆕 搜尋時標題改顯示「符合 N 項」（與手機端清單同調），讓使用者知道過濾出了幾張。
    const matchCount = pageShown.length + inactiveShown.length;
    const flipFull = '翻页清单 ' + pageNotes.length + ' 张'
      + (inactiveNotes.length ? '（另有 ' + inactiveNotes.length + ' 张未开启，不计入翻页）' : '')
      + '：点击名称显示，点开 / 关切换';
    // 徽标图例放 tooltip：清单本身窄，不额外占一行；四类含义在此一次讲清
    const kindLegend = '｜徽标：主＝主档一般、外＝外部 include 档、視＝VIEW 投影、臨＝临时便利贴';
    listTitle.textContent = q
      ? ('符合 ' + matchCount + ' 項')
      : (mode === 'flip'
        ? '翻页清单 ' + pageNotes.length + ' 张'
          + (inactiveNotes.length ? '（另有 ' + inactiveNotes.length + ' 张未开启）' : '')
        : '已设定的便利贴');
    listTitle.title = (mode === 'flip' ? flipFull : '已设定的便利贴（点击名称显示；点击开 / 关切换）') + kindLegend;
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
      // 🆕 四类识别徽标：编号之后、名称之前。名称的 ellipsis 仍由 nameEl 自己负责，徽标不参与截断
      const kind = stickyKindOf(item);
      const kindMeta = STICKY_KIND_META[kind.kind];
      const kindTip = kindMeta.tip + (kind.src ? '：' + kind.src : '');
      const kindEl = document.createElement('span');
      kindEl.className = 'm-sticky-kind is-' + kind.kind;
      kindEl.textContent = kindMeta.mark;
      kindEl.title = kindTip;
      kindEl.setAttribute('aria-label', kindTip);
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
      row.append(indexEl, kindEl, nameEl, stateEl);
      list.appendChild(row);
    };
    notesShown.forEach(appendNoteRow);
    if (inactiveShown.length) {
      const inactiveTitle = document.createElement('div');
      inactiveTitle.className = 'm-sticky-list-inactive-title';
      inactiveTitle.textContent = '未开启（不计入翻页 · 点「开」才加入）';
      list.appendChild(inactiveTitle);
      // ⚠️ 未开启项「不编号」：以前从 1 再数一遍，视觉上会和上方页次连成一片，
      //    让人误以为总页数是「已开启 + 未开启」（例：9 页 + 3 张未开启 = 看成 12 张）
      inactiveShown.forEach((item) => appendNoteRow(item, null));
    }
    // 🆕 有查詢但一張都不符合：給一句提示（與手機端「沒有符合」同調）
    if (q && matchCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'm-sticky-list-title';
      empty.style.padding = '6px 9px';
      empty.textContent = '沒有符合「' + q + '」的便利貼';
      list.appendChild(empty);
    }
    // ⚠️ 展開與否只根據「整份清單有沒有便利貼」——**不可**因為過濾後 0 符合就移除 .open：
    //    搜尋框就在這個框裡，一移除 .open 會連標題＋搜尋框＋清單整個 display:none，
    //    使用者一輸入查不到的字就全消失、連清除都做不到（2026-10-25 實測回饋）。
    //    0 符合時保留展開，改在清單區顯示「沒有符合」提示即可。
    wrap.classList.toggle('open', allNotes.length > 0);
  } catch (error) {
    if (requestSeq !== stickyMenuLoadSeq) return;
    console.error('[StickyNote] 读取便利贴清单失败:', error);
    wrap.classList.remove('open');
  }
}

// 渲染第 i 张：切换 KEY/IDX（内容＋颜色/透明度按该便利贴自身状态），翻页窗几何保持不变
async function renderFlipPage(i) {
  if (flipTotal === 0) return;
  // 🆕 通知期间使用者自己翻页（键盘／滑动／按钮）→ 放弃整个通知阶段，以使用者的操作为准
  if (notifyActive && !notifyRendering) notifyCancel();
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
  resetDoneFold();
  syncEditSeg();
  showFlipPageToast('第 ' + (flipIndex + 1) + ' / ' + flipTotal + ' 张');
  const noteEl0 = document.getElementById('note');
  if (noteEl0) noteEl0.classList.remove('editing');
  const eaEl0 = document.getElementById('editArea');
  if (eaEl0) eaEl0.style.boxShadow = '';
  flushScrollSave();   // 🆕 换张前先记下「离开的这一张」的卷动位置（此刻 KEY/IDX 仍是它）
  KEY = flipOrder[i].key;
  IDX = +flipOrder[i].idx || 0;
  syncViewNoteMode();   // 🆕 翻页换到 VIEW 贴（或离开它）→ 只读把手显隐跟着换
  const listed = flipOrder[i];
  persistFlipPosition();   // 每次切页都记下「当前这张」，关窗/退出前至少已更新到内存
  rememberRefMeta(listed); // 翻页清单本身就带 notes/src（外部 include 文件的行程本地解析不到）
  const parsedEvent = sourceEvent(KEY);
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
  // 🆕 翻页换到另一张便利贴：套用「该张」自己的排序偏好（须在下方 refreshNoteViewDisplay 之前设好）
  state.sortMode = (inst && (inst.sortMode === 'asc' || inst.sortMode === 'desc')) ? inst.sortMode : 'orig';
  state.scrollPos = (inst && typeof inst.scrollPos === 'number' && isFinite(inst.scrollPos)) ? Math.max(0, inst.scrollPos) : 0;
  state.meteor = normalizeMeteor(inst && inst.meteor);

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
  // 🆕 单段落 VIEW 贴：标题 tooltip（段落名称＋条件摘要）；多段落不挂。文字包进 .tt（no-drag），只写 data-tip。
  const tip = (ev && typeof ev.titleTip === 'string' && ev.titleTip) ? ev.titleTip : '';
  setStickyTitle(titleEl, titleHtml, ev.title, tip);
  // 🆕 移除 raw 原文兜底：html 缺失时留白，绝不以未渲染 Markdown 源呈现（如 "- [ ] 11111"）。
  document.getElementById('body').innerHTML = html;
  noteApplyHighlight(); // 🆕 依當前定位詞重打高亮
  refreshNoteViewDisplay(); // 🆕 多段落 VIEW 便利贴：翻页重渲染后重新套用记忆的「顺序平铺／页签方式」与 active 段落
  syncUndoneChecksFilter();
  // VIEW 贴排序已统一收口在 refreshNoteViewDisplay() 末尾（normalize → capture → apply）
  applyColor();
  applyContentFont();
  restoreScrollPos();   // 🆕 还原这一张「上次离开前」的卷动位置
  noteRendered = true;
  consumePendingFocusUnit();   // 🆕 消费「跳转到便利贴」顺带要定位+闪烁的小事件(群)
  syncTextAppearance();
  syncMeteorControls();   // 🆕 重绘当前便利贴后，把外框流星状态反映到菜单控制项
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
  if (flipRenderQuiet) return; // 后台对齐清单的静默重绘不弹页次
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
    bindFlipSwipe(note);
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

// 🆕 鼠标左右拖拽（正文区）/ 触控板横向滚动＝翻页。
//    正文是 -webkit-app-region:no-drag，可安全接管；标题/边框仍是 OS 拖窗区，不抢。
const FLIP_SWIPE_IGNORE = 'button, a, input, textarea, select, label, pre, .flip-edge, .ev-md-check, .ev-md-edit, .md-unit-edit, .note-addcheck-menu, .addcheck-ov, .menu';
function bindFlipSwipe(note) {
  const blocked = () => editMode || !!document.querySelector('.addcheck-ov.show, .menu.open');
  let drag = null;
  let wheelAcc = 0;
  let wheelAt = 0;
  note.addEventListener('pointerdown', (e) => {
    drag = null;
    if (flipTotal < 2 || blocked() || e.button !== 0) return;
    if (!e.target.closest || !e.target.closest('.body')) return;
    if (e.target.closest(FLIP_SWIPE_IGNORE)) return;
    drag = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  });
  window.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Date.now() - d.t > 900) return;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    renderFlipPage(flipIndex + (dx < 0 ? 1 : -1));
  });
  window.addEventListener('blur', () => { drag = null; });
  note.addEventListener('wheel', (e) => {
    if (flipTotal < 2 || blocked() || e.ctrlKey) return;
    if (!e.target.closest || e.target.closest(FLIP_SWIPE_IGNORE)) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = Date.now();
    if (now - wheelAt > 500) wheelAcc = 0;
    wheelAcc += e.deltaX;
    wheelAt = now;
    if (Math.abs(wheelAcc) < 72) return;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    renderFlipPage(flipIndex + dir);
  }, { passive: true });
}

// 🆕 右键 编辑小圆点 → 下拉菜单：checkbox 子事件（.ev-md-edit＝#noteFindSameMenu）／区块（.md-unit-edit＝#noteBlockMenu），两套全局绑定（分体/翻页模式共用，脚本载入即生效）
document.addEventListener('contextmenu', noteFindSameOpen);
document.addEventListener('contextmenu', noteBlockMenuOpen);
document.addEventListener('contextmenu', vsrGotoMenuOpen);
document.addEventListener('click', (e) => {
  const fsm = document.getElementById('noteFindSameMenu');
  if (fsm && fsm.classList.contains('open') && !(e.target.closest && e.target.closest('#noteFindSameMenu'))) noteFindSameClose();
  const bm = document.getElementById('noteBlockMenu');
  if (bm && bm.classList.contains('open') && !(e.target.closest && e.target.closest('#noteBlockMenu'))) noteBlockMenuClose();
  const vm = document.getElementById('vsrGotoMenu');
  if (vm && vm.classList.contains('open') && !(e.target.closest && e.target.closest('#vsrGotoMenu'))) vsrGotoMenuClose();
  // 🆕 × 的关闭选项菜单：点别处收起，但点 × 自己要留给 toggle（否则永远只能开不能关）。
  const cm = document.getElementById('noteCloseMenu');
  if (cm && cm.classList.contains('open')
      && !(e.target.closest && e.target.closest('#noteCloseMenu'))
      && !(e.target.closest && e.target.closest('#miClose'))) noteCloseMenuHide();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 🆕 Esc 只收起「关闭选项」这一层，绝不关便利贴窗口（编辑内容区块浮层的关闭锁定不变）。
  const cm = document.getElementById('noteCloseMenu');
  if (cm && cm.classList.contains('open')) { noteCloseMenuHide(); return; }
  const fsm = document.getElementById('noteFindSameMenu');
  if (fsm && fsm.classList.contains('open')) { noteFindSameClose(); return; }
  const bm = document.getElementById('noteBlockMenu');
  if (bm && bm.classList.contains('open')) { noteBlockMenuClose(); return; }
  const vm = document.getElementById('vsrGotoMenu');
  if (vm && vm.classList.contains('open')) { vsrGotoMenuClose(); return; }
  const ov = document.getElementById('findSameOv');
  if (ov && ov.classList.contains('show')) { hideNoteFindSame(); return; }
  const mt = document.getElementById('noteMoveToast');
  if (mt && mt.classList.contains('show')) { hideNoteMoveToast(); return; }
  const at = document.getElementById('autoTermOv');
  if (at && at.classList.contains('show')) { noteAutoTermClose(); return; }
});
(function bindFindSameOverlay() {
  const fsMenu = document.getElementById('noteFindSameMenu');
  if (fsMenu) {
    // 🆕 菜单项改事件委托（按 data-act 分流）：find＝找出相同的项目，del＝删除此小事件
    fsMenu.addEventListener('click', (e) => {
      const item = e.target.closest && e.target.closest('.nami');
      if (!item) return;
      e.stopPropagation();
      const act = item.getAttribute('data-act');
      if (act === 'goto-event') {
        // 🆕 切换到 Calendar 的编辑行程画面并把备注框滚到该小事件：三类便利贴共用同一份 target。
        //    · 一般／include 贴：srcUid＝便利贴 key（＝事件 uid，ro-* 亦可），line＝该贴备注的 0-based 行号
        //    · VIEW 投影贴：srcUid＝data-src（来源行程 uid），line＝来源行程备注里的行号
        //    主程式 tlOnStickyOpenEvent 带 lines/text 开窗 → tlFlashEventFormLines 滚动＋选中＋闪烁；
        //    ro 行程会开只读窗体（readOnly textarea 仍能 setSelectionRange 与卷动）。
        const t = noteFindSameTarget;
        noteFindSameClose();                 // 会清掉 target，故先存副本
        if (!t) return;
        noteFindSameOpenSourceEvent(t.srcUid,
          Number.isInteger(t.line) && t.line >= 0 ? [t.line] : [], t.text || '');
      }
      else if (act === 'find') noteFindSameRun();
      else if (act === 'move') { const t = noteFindSameTarget; noteFindSameClose(); noteFindSameMoveCheck(t); }
      else if (act === 'copy') { const t = noteFindSameTarget; noteFindSameClose(); noteFindSameCopy(t); }
      else if (act === 'del') noteFindSameDelete();
    });
  }
  const nbMenu = document.getElementById('noteBlockMenu');
  if (nbMenu) {
    // 🆕 区块菜单项事件委托（按 data-act 分流）：edit＝编辑该区块，copy＝复制整块内容，del＝删除此区块
    nbMenu.addEventListener('click', (e) => {
      const item = e.target.closest && e.target.closest('.nami');
      if (!item) return;
      e.stopPropagation();
      const act = item.getAttribute('data-act');
      const t = noteBlockMenuTarget;
      if (!t) { noteBlockMenuClose(); return; }
      if (act === 'goto-event') {
        // 🆕 区块圆点也走同一条定位管线：data-start/data-end 是多行区块的行号区间，
        //    主程式 tlFlashEventFormLines 会取首尾把整块选中并闪烁。
        const tt = t;
        const txt = noteDotBlockText(tt.dot);
        noteBlockMenuClose();
        noteFindSameOpenSourceEvent(tt.uid, [tt.start, tt.end], txt);
      }
      else if (act === 'edit') { const tt = t; noteBlockMenuClose(); const synth = { preventDefault() {}, stopPropagation() {}, target: tt.dot }; tlOpenEditBlockDialog(synth, tt.uid, tt.start, tt.end, tt.type); }
      else if (act === 'copy') { noteBlockMenuClose(); noteBlockCopy(t); }
      // 🆕 gp 小事件群：整群搬移（t 是关菜单前留下的副本，noteBlockMenuClose 清的是全域变量）
      else if (act === 'move') { noteBlockMenuClose(); noteBlockMove(t); }
      else if (act === 'del') { noteBlockMenuClose(); noteBlockDelete(t); }
    });
  }
  const vsrMenu = document.getElementById('vsrGotoMenu');
  if (vsrMenu) {
    // 🆕 切换徽标右键菜单项事件委托（按 data-act 分流）：open＝切换到来源行程编辑器；scroll＝仅滚动定位到 calendar
    vsrMenu.addEventListener('click', (e) => {
      const item = e.target.closest && e.target.closest('.nami');
      if (!item) return;
      e.stopPropagation();
      const act = item.getAttribute('data-act');
      const src = vsrGotoSrc;
      vsrGotoMenuClose();
      if (!src) return;
      if (act === 'open') noteFindSameOpenSourceEvent(src, []);          // 原左键行为
      else if (act === 'scroll') {
        // 🆕 仅滚动定位到 calendar 该事件所在位置（不开编辑器）：复用 wake-main-from-note action='scroll'
        try { ipcRenderer.invoke('wake-main-from-note', { key: src, action: 'scroll' }); }
        catch (err) { window.alert('滚动到该事件失败：' + (err && err.message ? err.message : err)); }
      }
    });
  }
  const fsOv = document.getElementById('findSameOv');
  if (fsOv) {
    const cb = document.getElementById('findSameCloseBtn');
    if (cb) cb.onclick = () => hideNoteFindSame();
    const mv = document.getElementById('findSameMoveBtn');
    if (mv) mv.addEventListener('click', (e) => { e.stopPropagation(); noteFindSameMove(); });
    // 🆕 结果项「切换」按钮：事件委托（按钮是 innerHTML 动态生成，无法逐个绑 onclick）
    fsOv.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.fs-jump');
      if (!btn) return;
      e.stopPropagation();
      const kind = btn.getAttribute('data-kind') || 'sticky';
      const line0 = parseInt(btn.getAttribute('data-line0') || '-1', 10);
      const done = parseInt(btn.getAttribute('data-done') || '0', 10);
      // 🆕 命中行区间（0-based，连续块含多行）：主程式行程表单据此闪烁定位
      const linesAttr = btn.getAttribute('data-lines') || '';
      const lines = linesAttr ? linesAttr.split(',').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x)) : [];
      // 🆕 普通行程（如 VIEW 投影贴的来源行程）不在翻页清单里（没实体便利贴），无法用 renderFlipPage 翻；
      //    改用唤起主程式打开该行程表单（wake-main-from-note → open-sticky-event → tlOpenEventForm）。
      if (kind === 'event') noteFindSameOpenSourceEvent(btn.getAttribute('data-uid') || '', lines);
      else noteFindSameSwitchTo(btn.getAttribute('data-key') || '', line0, done, lines);
    });
    fsOv.addEventListener('click', (e) => { if (e.target === fsOv) hideNoteFindSame(); });
  }
  // 🆕 VIEW 投影贴「标题命中」单元与「分组标题」的「📍 切换」：直接唤起主程式打开该来源行程
  //   （标题在来源行程表单顶部），复用 noteFindSameOpenSourceEvent，不依赖「找出相同」（它按正文内容比对，标题不在正文里）。
  //   先判「📍 切换」按钮（避免与整块分组标题的点击重复触发），再判整块分组标题（.vsr-group-head）。
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.vsr-goto-source');
    if (btn) {
      e.stopPropagation();
      const src = btn.getAttribute('data-src') || '';
      if (src) noteFindSameOpenSourceEvent(src, []);
      return;
    }
    const head = e.target.closest && e.target.closest('.vsr-group-head');
    if (head) {
      e.stopPropagation();
      const src = head.getAttribute('data-src') || '';
      if (src) noteFindSameOpenSourceEvent(src, []);
    }
  });
  // 🆕 搬移结果 toast 的 ✕ 关闭钮
  const tc = document.getElementById('noteMoveToastClose');
  if (tc) tc.onclick = () => hideNoteMoveToast();
  // 🆕 VIEW 便利贴徽标：点开看 JSON 设定逻辑＋跳转维护作业
  setupViewBadge();
})();

init();