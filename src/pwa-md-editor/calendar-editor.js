/* ============================================================
 * 📅 Calendar 特性編輯器（手機 LITE 版的資料感知編輯器 #1）
 * ------------------------------------------------------------
 * 由 app.js 抽離成獨立程式文件（index.html 在 app.js 之後載入）。
 * 職責：calendar.md 的解析 / 序列化 / 列表·月·週·日渲染 / 表單 / 導航。
 * 宿主（app.js）提供：state / elements（含 cal* 字段）、escapeHtml、
 * showToast、editor 編輯緩衝、events-* 樣式。
 * 約定：本文件只含 calendar 邏輯；未來新增其它特性編輯器時各自一個
 * xxx-editor.js，互不干擾。
 * ============================================================ */
// ===== 📅 行程視圖（calendar.md 專用，只讀查看） =====
// calendar.md 是行程應用（桌面版 calendar 插件）的數據文件：以 `## EVENT` 分隔的塊 + 反引號字段 + Remark 代碼塊。
// 解析邏輯與 calendar 插件的 parseMarkdownEvents 對齊（單向解析，本視圖不寫回）。

function isCalendarMd() {
  return !!(state.currentFile && String(state.currentFile.name || '').toLowerCase() === 'calendar.md');
}

// 顯示/隱藏「行程」頁簽；文件不是 calendar.md 時若停在行程視圖則退回分屏
function updateEventsTabVisibility() {
  if (!elements.tabEvents) return;
  const show = isCalendarMd();
  elements.tabEvents.style.display = show ? '' : 'none';
  if (!show && state.view === 'events') setView('split');
}

function parseCalendarArrField(s) {
  s = (s || '').trim();
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

function parseCalendarEventBlock(block, idx) {
  // 先把 Remark 代碼塊與字段頭部切開，避免備注內容干擾字段解析（與 calendar 插件一致）
  let remark = '';
  let head = block;
  const ri = block.indexOf('- Remark:');
  if (ri >= 0) {
    head = block.slice(0, ri);
    const after = block.slice(ri + '- Remark:'.length);
    const m = after.match(/```([\s\S]*)```/);
    if (m) {
      remark = m[1].replace(/^\n/, '').replace(/\n$/, '');
      if (remark.trim() === '') remark = '';
    }
  }
  const get = (name) => {
    const m = head.match(new RegExp('- ' + name + ': `([^`]*)`'));
    return m ? m[1] : '';
  };
  const title = get('title');
  if (!title) return null;
  let color = get('color').trim();
  if (color.length >= 2 && color[0] === '"' && color[color.length - 1] === '"') color = color.slice(1, -1);
  return {
    idx,
    uid: 'evp' + idx,  // 确定性 uid：同一內容多次解析結果一致，供編輯/刪除定位
    title,
    date: get('date'),
    endDate: get('endDate'),
    allDay: get('allDay') === 'true',
    // 完成狀態：舊檔案沒有 - done 欄位 → 視為未設定 = 未完成
    done: get('done') === 'true',
    startTime: get('startTime'),
    endTime: get('endTime'),
    location: get('location'),
    color: color || '#3b82f6',
    tags: parseCalendarArrField(get('tags')),
    // 修復：此前缺讀 todoIds，往返保存會把 calendar 插件寫入的關聯卡片清空
    todoIds: parseCalendarArrField(get('todoIds')),
    notes: remark
  };
}

function parseCalendarEvents(md) {
  if (!md) return [];
  const events = [];
  const blocks = String(md).split(/^##[ \t]*EVENT[ \t]*$/m);
  for (let i = 0; i < blocks.length; i++) {
    const ev = parseCalendarEventBlock(blocks[i], i);
    if (ev) events.push(ev);
  }
  return events;
}

function calendarFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calendarTimeToMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

// ===== 跨天行程輔助 =====
function calIsMultiDay(ev) { return !!(ev && ev.endDate && ev.endDate !== ev.date); }
function calMdShort(d) { const m = String(d || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? (+m[1]) + '/' + (+m[2]) + '/' + (+m[3]) : (d || ''); }
function calSpanDays(a, b) {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return 1;
  return Math.round((d2 - d1) / 86400000) + 1;
}
function calRangeLabel(a, b, st, et) {
  if (st || et) return calMdShort(a) + ' ' + (st || '') + ' – ' + calMdShort(b) + ' ' + (et || '');
  return calMdShort(a) + ' – ' + calMdShort(b);
}
// 把一條行程展開成「逐日出現」陣列（跨天行程每天一條，帶 start/middle/end 位置）
function calEventOccurrences(ev) {
  const out = [];
  if (calIsMultiDay(ev)) {
    let cur = new Date(ev.date + 'T00:00:00');
    const end = new Date(ev.endDate + 'T00:00:00');
    if (!isNaN(cur) && !isNaN(end)) {
      const total = Math.round((end - cur) / 86400000) + 1;
      let idx = 0;
      while (cur <= end) {
        idx++;
        const ds = calendarFmtDate(cur);
        const pos = ds === ev.date ? 'start' : (ds === ev.endDate ? 'end' : 'middle');
        out.push({ date: ds, ev, pos, idx, total });
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }
  }
  out.push({ date: ev.date, ev, pos: 'single', idx: 1, total: 1 });
  return out;
}
function calOccSort(a, b) {
  const aSpan = a.pos === 'single' ? 1 : 0, bSpan = b.pos === 'single' ? 1 : 0;
  if (aSpan !== bSpan) return aSpan - bSpan;
  if (a.ev.date !== b.ev.date) return a.ev.date < b.ev.date ? -1 : 1;
  if (a.ev.allDay !== b.ev.allDay) return a.ev.allDay ? -1 : 1;
  return calendarTimeToMin(a.ev.startTime) - calendarTimeToMin(b.ev.startTime);
}
// 跨天行程的「第幾天」後綴：total>1 時回傳「 idx/total」（如 去峨眉山 1/5），單日行程不加
function calSpanSuffix(idx, total) { return (total > 1 && idx > 0) ? ' ' + idx + '/' + total : ''; }
// 📝 備註裡的 Markdown checkbox（- [ ] / - [x]）渲染成 ☐/☑ 樣式，且可點擊勾選/取消（寫回 notes 原文）。
//    入參必須是「已 escape」的文本；支援任意縮進的 `- [ ]` / `- [x]` / `- [X]`。
//    uid 為所屬行程（點擊時定位用）；fenced code block 內的行不當成 checkbox，避免誤判代碼。
function calNotesWithChecks(esc, uid) {
  let inFence = false;
  return esc.split('\n').map((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
    if (!m) return line;
    const done = m[2] !== ' ';
    const cbAttr = uid
      ? ' data-uid="' + escapeHtml(uid) + '" data-line="' + i + '"' +
        ' onclick="calToggleNoteCheck(event,\'' + escapeHtml(uid) + '\',' + i + ')"' +
        ' onkeydown="calCalCheckKey(event,\'' + escapeHtml(uid) + '\',' + i + ')"'
      : '';
    return m[1] + '<span class="ev-md-check' + (done ? ' done' : '') + '"' + cbAttr +
      ' role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '" tabindex="0">' +
      '<span class="ev-cb">' + (done ? '✓' : '') + '</span>' + m[3] + '</span>';
  }).join('\n');
}
// 🖱 日/週時間網格雙擊空白處快速新增：15 分鐘取整，默認時長 1 小時；全天條＝日期(全天)
function calGridDblClickNew(e) {
  if (e.target.closest('.ev-block') || e.target.closest('button')) return; // 點在已有行程上不新增
  const col = e.target.closest('.ev-tg-col[data-date]');
  if (col) {
    const rect = col.getBoundingClientRect();
    if (rect.height <= 0) return;
    const mins = Math.max(0, Math.min(23 * 60, Math.floor((e.clientY - rect.top) / rect.height * 24 * 60 / 15) * 15));
    const pad = (x) => String(x).padStart(2, '0');
    const endM = mins + 60;
    openEventForm(null, col.getAttribute('data-date'), {
      allDay: false,
      startTime: pad(Math.floor(mins / 60)) + ':' + pad(mins % 60),
      endTime: endM >= 24 * 60 ? '' : pad(Math.floor(endM / 60)) + ':' + pad(endM % 60),
    });
    return;
  }
  const ad = e.target.closest('.ev-allday-col[data-date]');
  if (ad) openEventForm(null, ad.getAttribute('data-date'), { allDay: true });
}
// 月格連點檢測的狀態（見 setupEventListeners 的 evMonthGrid click）
let calLastCellClick = { date: null, t: 0 };
// 月視圖單元格內的跨天色條 / 普通 chip
// ⚠️ 帶 data-ev-edit：月格上的 chip 點擊直接開表單（走事件委派，見 setupEventListeners 的 evMonthGrid）
function calSpanChipHtml(ev, pos, idx, total) {
  const links = calEventTodoLinks(ev);
  const edit = ' data-ev-edit="' + escapeHtml(ev.uid) + '"';
  // 单日 → 普通 chip（圆点+标题）
  if (pos === 'single') {
    return '<div class="ev-chip' + (ev.done ? ' done' : '') + '"' + edit + '><span class="dot" style="background:' + escapeHtml(ev.color) + '"></span>' + (ev.done ? '✓ ' : '') + escapeHtml(ev.title) + links + '</div>';
  }
  // 跨天：start/end 显示标题作起止标识，middle 渲染为连续色条（不重复标题，悬停可见）
  const cls = 'ev-chip span ' + pos + (ev.done ? ' done' : '');
  const dot = '<span class="dot" style="background:' + escapeHtml(ev.color) + '"></span>';
  const titlePart = (ev.done ? '✓ ' : '') + escapeHtml(ev.title) + calSpanSuffix(idx, total) + links;
  // 每一段（start/middle/end）都顯示「標題 k/N」——空色條看不出是哪條行程的延續
  let inner = (pos === 'start' ? dot : '') + titlePart;
  const tip = (pos === 'middle') ? ' title="' + escapeHtml(ev.title) + '"' : '';
  return '<div class="' + cls + '" style="--ev-color:' + escapeHtml(ev.color) + '"' + tip + edit + '>' + inner + '</div>';
}

// ===== 🏷 標籤過濾 / 跨天展開 / 時間網格 輔助（移植自桌面 TodoList 日曆模式）=====
// 事件是否滿足當前標籤過濾（空＝全部；OR 邏輯：任一標籤命中即顯示）
function calEventMatchesTag(ev) {
  if (!state.calTagFilter.length) return true;
  const tags = ev.tags || [];
  return state.calTagFilter.some((t) => tags.indexOf(t) >= 0);
}
// 取某天出現的所有事件（含跨天展開），並套用標籤過濾
function calEventsOnDay(dateStr) {
  const out = [];
  state.calEvents.forEach((ev) => {
    if (!calEventMatchesTag(ev)) return;
    calEventOccurrences(ev).forEach((o) => { if (o.date === dateStr) out.push({ ev: o.ev, pos: o.pos, idx: o.idx, total: o.total }); });
  });
  return out;
}
// 日期加減（回傳新的本地日期物件，避免改到原物件）
function calAddDays(d, n) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
// 取某天所在週的 7 天（週一開頭）
function calWeekDays(d) {
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (cur.getDay() + 6) % 7; // 週一 = 0
  cur.setDate(cur.getDate() - dow);
  const out = [];
  for (let i = 0; i < 7; i++) out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + i));
  return out;
}
// 重疊佈局：把時間衝突的事件分配到並排列（移植自桌面 layoutDay 的 cluster packing）
function calLayoutDay(evs) {
  const items = evs.map((e) => ({
    e,
    start: calendarTimeToMin(e.startTime),
    end: Math.max(calendarTimeToMin(e.endTime), calendarTimeToMin(e.startTime) + 15),
  })).sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const cols = [];
    cluster.forEach((it) => {
      let placed = false;
      for (let ci = 0; ci < cols.length; ci++) {
        if (cols[ci] <= it.start) { cols[ci] = it.end; it.col = ci; placed = true; break; }
      }
      if (!placed) { it.col = cols.length; cols.push(it.end); }
    });
    cluster.forEach((it) => { it.cols = cols.length; result.push(it); });
    cluster = [];
    clusterEnd = -1;
  };
  items.forEach((it) => {
    if (it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  });
  flush();
  return result;
}
// 行程條上的 🔗 關聯標記
// ⚠️ 與桌面的差異：LITE 是通用 MD 編輯器，沒有 todo 卡片清單可解析標題 → 直接顯示卡片 id
function calEventTodoLinks(ev) {
  const ids = ev.todoIds || [];
  if (!ids.length) return '';
  return ids.map((id) => '<span class="ev-link" title="🔗 ' + escapeHtml(id) + '">🔗</span>').join('');
}

// ===== 🖱 悬停行程事件 → 放大提示框（更大字体显示事件内容；手机无 hover，桌面浏览器看 PWA 时生效） =====
let calTipEl = null, calTipUid = null;
function calGetTipEl() {
  if (!calTipEl) {
    calTipEl = document.createElement('div');
    calTipEl.className = 'ev-tip';
    calTipEl.setAttribute('role', 'tooltip');
    calTipEl.style.display = 'none';
    document.body.appendChild(calTipEl);
  }
  return calTipEl;
}
function calTipHtml(ev) {
  const multi = calIsMultiDay(ev);
  let when;
  if (multi) when = ev.allDay
    ? (calRangeLabel(ev.date, ev.endDate) + ' · 共' + calSpanDays(ev.date, ev.endDate) + '天')
    : calRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
  else when = ev.allDay ? '全天' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
  const tags = (ev.tags && ev.tags.length) ? '<div class="ev-tip-tags">' + ev.tags.map((t) => '#' + escapeHtml(t)).join(' ') + '</div>' : '';
  const loc = ev.location ? '\ud83d\udccd ' + escapeHtml(ev.location) : '';
  const notes = ev.notes ? '<div class="ev-tip-notes">' + escapeHtml(ev.notes) + '</div>' : '';
  const links = calEventTodoLinks(ev);
  return '<div class="ev-tip-title">' + escapeHtml(ev.title) + (ev.done ? ' <span class="ev-tip-done">\u2713</span>' : '') + '</div>' +
    '<div class="ev-tip-meta">' + escapeHtml(when) + (loc ? ' · ' + loc : '') + '</div>' + tags + links + notes;
}
function calShowTip(uid, x, y) {
  const ev = state.calEvents.find((e) => e.uid === uid);
  if (!ev) return;
  const tip = calGetTipEl();
  if (calTipUid !== uid) { tip.innerHTML = calTipHtml(ev); calTipUid = uid; }
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 16);
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function calHideTip() { if (calTipEl) { calTipEl.style.display = 'none'; calTipUid = null; } }

// ===== 📱 触屏：点事件 → 小选单（编辑 / 详情）替代「直接开表单」+「hover 提示框」 =====
// 手机无真 hover：hover 提示框已禁用（app.js 媒体查询守卫 + @media (hover:none) 隐藏），
// 故把「放大详情」做成点击可达——点事件先弹选单，再选「编辑」或「详情（类似 tips 显示）」。
const calCanHover = window.matchMedia('(hover: hover) and (pointer: fine)');
let calMenuEl = null, calDetailEl = null;
// 文档级外部点击关闭（capture，绑定一次复用）；选单/详情各自移除时一并解绑，避免重复监听。
function calDocClick(e) {
  if (calMenuEl && !calMenuEl.contains(e.target)) calRemoveMenu();
  if (calDetailEl && !calDetailEl.contains(e.target)) calRemoveDetail();
  if (calAlmanacEl && !calAlmanacEl.contains(e.target)) calRemoveAlmanac();
}
function calRemoveMenu() {
  if (calMenuEl) { calMenuEl.remove(); calMenuEl = null; }
  document.removeEventListener('click', calDocClick, true);
}
function calRemoveDetail() {
  if (calDetailEl) { calDetailEl.remove(); calDetailEl = null; }
  document.removeEventListener('click', calDocClick, true);
}
// 点事件：弹小选单（编辑 / 详情）。只在触屏（!calCanHover.matches）调用，桌面保持点开表单。
function calShowEventMenu(anchorEl, uid) {
  calRemoveMenu(); calRemoveDetail();
  const menu = document.createElement('div');
  menu.className = 'ev-act-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-uid', uid);
  menu._anchor = anchorEl;
  menu.innerHTML =
    '<button type="button" data-act="detail" role="menuitem">🔍 详情</button>' +
    '<button type="button" data-act="edit" role="menuitem">✏️ 编辑</button>' +
    '<button type="button" data-act="del" role="menuitem">🗑 删除</button>' +
    '<button type="button" data-act="cancel" role="menuitem">✕ 取消</button>';
  document.body.appendChild(menu);
  calMenuEl = menu;
  const r = anchorEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 150, mh = menu.offsetHeight || 80;
  let left = r.left, top = r.bottom + 6;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const u = menu.getAttribute('data-uid');
    if (act === 'detail') { calRemoveMenu(); calShowEventDetail(u, anchorEl); }
    else if (act === 'edit') { calRemoveMenu(); openEventForm(u); }
    else if (act === 'del') { calRemoveMenu(); deleteEventByUid(u); }
    else { calRemoveMenu(); } // 取消：仅关闭选单
  });
  // 延后绑定外部点击，避开「开启当次 click」把自己关掉
  setTimeout(() => document.addEventListener('click', calDocClick, true), 0);
}
// 选单「详情」：以可点闭的浮层显示放大内容（复用 calTipHtml），pointer-events:auto 可交互。
function calShowEventDetail(uid, anchorEl) {
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find((x) => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  calRemoveMenu(); calRemoveDetail();
  const pop = document.createElement('div');
  pop.className = 'ev-detail-pop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = '<button type="button" class="ev-detail-close" aria-label="关闭">✕</button>' + calTipHtml(ev);
  document.body.appendChild(pop);
  calDetailEl = pop;
  const pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 160;
  let left = anchorEl ? anchorEl.getBoundingClientRect().left : (window.innerWidth - pw) / 2;
  let top = anchorEl ? anchorEl.getBoundingClientRect().bottom + 6 : (window.innerHeight - ph) / 2;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  pop.querySelector('.ev-detail-close').addEventListener('click', calRemoveDetail);
  setTimeout(() => document.addEventListener('click', calDocClick, true), 0);
}
// 標籤過濾條：無標籤時整條隱藏
function renderCalTagBar() {
  const bar = elements.evTagBar;
  const filter = elements.evTagFilter;
  if (!bar || !filter) return;
  const tags = new Set();
  state.calEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (t) tags.add(t); }));
  if (!tags.size) { bar.style.display = 'none'; filter.innerHTML = ''; return; }
  // ⚠️ 必須顯式給 'flex'：CSS 裡 .ev-tagbar 預設 display:none，清空 inline style 會被 CSS 覆蓋回隱藏
  bar.style.display = 'flex';
  filter.innerHTML = Array.from(tags).map((t) => {
    const active = state.calTagFilter.indexOf(t) >= 0;
    return '<span class="ev-tag-chip' + (active ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }).join('');
}
// 日 / 週視圖 時間網格（移植自桌面 renderTimeGrid；事件委派用 data-ev-edit）
// 日/週視圖「下半部明細清單」所顯示的那一天：永遠只有「選中日」一條（與月視圖一致）。
// 日模式＝游標那天；週模式＝calSelectedDate（須在當週內），否則今天（若在週內）否則週一。
function calGridSelectedDay() {
  if (state.calMode === 'day') return calendarFmtDate(state.calCursor);
  const wk = calWeekDays(state.calCursor);
  const wkSet = new Set(wk.map(calendarFmtDate));
  const today = calendarFmtDate(new Date());
  const ds = (state.calSelectedDate && wkSet.has(state.calSelectedDate)) ? state.calSelectedDate
    : (wkSet.has(today) ? today : calendarFmtDate(wk[0]));
  state.calSelectedDate = ds; // 跨週後把殘留的舊選日收斂回當週內
  return ds;
}
function renderCalTimeGrid(dayDates) {
  const wrap = elements.evWeekWrap;
  if (!wrap) return;
  const hourH = dayDates.length > 1 ? 48 : 56;   // 週視圖列窄 → 小時格矮一點
  const n = dayDates.length;
  const todayStr = calendarFmtDate(new Date());
  const selDay = calGridSelectedDay();   // 下半部明細清單只顯示這一天（與月視圖選中日一致）
  const now = new Date();
  const allDayByCol = dayDates.map((d) => calEventsOnDay(calendarFmtDate(d)).filter((o) => o.ev.allDay));
  const hasAllDay = allDayByCol.some((arr) => arr.length > 0);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  let html = '<div class="ev-timegrid-col">';  // 時間網格整列（標題+全天條+網格）包一層，便於橫屏與明細清單左右並排
  // 🗓 欄位日期標題：讓每一「直行」看得出是哪一天（與桌面端對齊）
  //    ⚠️ 與時間網格共用同一套 grid 模板，且 column-gap 必須為 0，否則會累積漂移導致對不齊
  html += '<div class="ev-tg-head" style="--cols:' + n + '"><div class="ev-tg-head-gutter"></div>';
  dayDates.forEach((d) => {
    const ds = calendarFmtDate(d);
    const dm = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const label = dm ? (+dm[2]) + '/' + (+dm[3]) : ds;
    html += '<div class="ev-tg-head-cell' + (ds === todayStr ? ' today' : '') + (ds === selDay ? ' selected' : '') + '" data-date="' + ds + '">' +
      '<span class="dow">週' + WD[d.getDay()] + '</span><span class="dnum">' + label + '</span></div>';
  });
  html += '</div>';
  if (hasAllDay) {
    html += '<div class="ev-allday-strip" style="--cols:' + n + '"><div class="label">全天</div>';
    allDayByCol.forEach((arr, ci) => {
      html += '<div class="ev-allday-col" data-date="' + calendarFmtDate(dayDates[ci]) + '">';
      arr.forEach((o) => {
        const ev = o.ev;
        html += '<div class="ev-block all-day' + (ev.done ? ' done' : '') + '" data-ev-edit="' + escapeHtml(ev.uid) + '" style="--ev-color:' + escapeHtml(ev.color || CAL_COLORS[0]) + '">' +
          (ev.done ? '✓ ' : '') + escapeHtml(ev.title) + calSpanSuffix(o.idx, o.total) + calEventTodoLinks(ev) + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div class="ev-timegrid-scroll"><div class="ev-timegrid" style="--cols:' + n + ';--hour-h:' + hourH + 'px;">';
  html += '<div class="ev-tg-gutter">';
  for (let h = 0; h <= 23; h++) html += '<div class="ev-tg-hour-label" style="top:' + (h * hourH) + 'px">' + String(h).padStart(2, '0') + ':00</div>';
  html += '</div>';
  dayDates.forEach((d) => {
    html += '<div class="ev-tg-col" data-date="' + calendarFmtDate(d) + '">';
    for (let h = 0; h <= 23; h++) html += '<div class="ev-tg-hour-line" style="top:' + (h * hourH) + 'px"></div>';
    const timed = calLayoutDay(calEventsOnDay(calendarFmtDate(d)).filter((o) => !o.ev.allDay).map((o) => o.ev));
    timed.forEach(({ e, start, end, col, cols }) => {
      const top = start / 60 * hourH;
      const height = Math.max((end - start) / 60 * hourH, 18);
      const width = 100 / cols;
      const left = col * width;
      const cbg = e.color || CAL_COLORS[0];
      // 時間範圍 + 備註（與桌面端對齊）：夠高（>=64px）才顯示備註，超出由 CSS line-clamp / overflow 裁掉
      const tm = (e.allDay || !e.startTime) ? '' : (e.startTime + (e.endTime ? '–' + e.endTime : ''));
      const notes = (!e.allDay && height >= 64 && e.notes) ? String(e.notes).slice(0, 400) : '';
      html += '<div class="ev-block' + (e.done ? ' done' : '') + '" data-ev-edit="' + escapeHtml(e.uid) + '" style="top:' + top + 'px;height:' + height + 'px;left:calc(' + left + '% + 1px);width:calc(' + width + '% - 3px);--ev-color:' + escapeHtml(cbg) + '">' +
        '<div class="t">' + (e.done ? '✓ ' : '') + escapeHtml(e.title) + calEventTodoLinks(e) + '</div>' +
        (tm ? '<div class="tm">' + escapeHtml(tm) + '</div>' : '') +
        (e.location ? '<div class="loc">' + escapeHtml('📍 ' + e.location) + '</div>' : '') +
        (notes ? '<div class="notes">' + calNotesWithChecks(escapeHtml(notes), e.uid) + '</div>' : '') +
        '</div>';
    });
    html += '</div>';
  });
  // 現在時間線：僅當今天落在顯示範圍內
  dayDates.forEach((d) => {
    if (calendarFmtDate(d) === todayStr) {
      const mins = now.getHours() * 60 + now.getMinutes();
      html += '<div class="ev-tg-now-line" style="top:' + (mins / 60 * hourH) + 'px"></div>';
    }
  });
  html += '</div></div></div>';   // 關閉 .ev-timegrid / .ev-timegrid-scroll / .ev-timegrid-col
  // 日/週視圖「下半部」行程內容明細：時間網格下方補一列文字清單（與月視圖 #ev-day-list 對齊），
  // 保證事件標題/時間/地點/備註一定可見，不必依賴時間網格滾動。
  html += '<div id="ev-grid-list" class="events-list"></div>';
  wrap.innerHTML = html;
  renderCalGridDayList();
  // 初次進入自動捲到「現在時間前 2 小時」
  requestAnimationFrame(() => {
    const sc = wrap.querySelector('.ev-timegrid-scroll');
    if (sc) sc.scrollTop = Math.max(0, now.getHours() * hourH + now.getMinutes() - 120);
  });
}

// 日/週視圖「下半部」行程明細：僅顯示「選中日」(calGridSelectedDay) 那一日的行程，與月視圖一致。
// 日模式選中日＝游標那天；週模式選中日＝所點的日期標題（預設今天/週一），點不同日期標題即切換。
function renderCalGridDayList() {
  const list = document.getElementById('ev-grid-list');
  if (!list) return;
  const ds = calGridSelectedDay();
  const today = calendarFmtDate(new Date());
  const m = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const evs = sortedCalEvents(state.calEvents.filter((e) => (e.date === ds || (e.endDate && ds > e.date && ds <= e.endDate)) && calEventMatchesTag(e)));
  let html = '<div class="ev-date' + (ds === today ? ' today' : '') + '">' +
    (m ? (+m[2]) + '月' + (+m[3]) + '日' : ds) +
    '<span class="ev-week">週' + WD[d.getDay()] + '</span>' +
    (ds === today ? '<span class="ev-today-badge">今天</span>' : '') +
    '<span class="ev-week">· ' + evs.length + ' 條</span>' +
    '<span class="ev-toolbar-flex"></span>' +
    '<button type="button" class="ev-day-add" data-ev-add-on="' + escapeHtml(ds) + '">＋ 此日新增</button>' +
    '</div>';
  if (!evs.length) html += '<div class="ev-empty">這一天沒有行程</div>';
  else for (const ev of evs) html += evItemHtml(ev, today);
  list.innerHTML = html;
}
// 導航列標題：依模式顯示「月 / 週區間 / 單日」
function calCursorTitle() {
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  if (state.calMode === 'day') {
    const d = state.calCursor;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 週' + WD[d.getDay()];
  }
  if (state.calMode === 'week') {
    const ds = calWeekDays(state.calCursor);
    return (ds[0].getMonth() + 1) + '/' + ds[0].getDate() + ' – ' + (ds[6].getMonth() + 1) + '/' + ds[6].getDate();
  }
  return state.calCursor.getFullYear() + '年' + (state.calCursor.getMonth() + 1) + '月';
}
// 上/下一期：按當前模式步進（月→月、週→週、日→日）
function calStepCursor(dir) {
  if (state.calMode === 'week') state.calCursor = calAddDays(state.calCursor, dir * 7);
  else if (state.calMode === 'day') { state.calCursor = calAddDays(state.calCursor, dir); state.calSelectedDate = calendarFmtDate(state.calCursor); }
  else state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() + dir, 1);
  if (state.calMode === 'month' && !state.calSelectedDate) state.calSelectedDate = calendarFmtDate(state.calCursor);
  renderEventsContent();
}

// ===== 🔗 表單內「關聯 Todo 卡片」面板 =====
// ⚠️ LITE 端沒有 todo 卡片清單（無法像桌面一樣下拉選卡片標題），
//    故以「卡片 id」為單位顯示 / 移除，並提供輸入框手動新增；
//    寫回的字段與桌面完全一致（todoIds），桌面上仍會正常解析成卡片標題。
function calRenderEvTodoLinkPanel() {
  const panel = elements.evFTodoPanel;
  if (!panel) return;
  if (!state.evFormTodoIds.length) {
    panel.innerHTML = '<div class="ev-todo-placeholder">尚無關聯卡片（在下方輸入卡片 id 後按 ＋）</div>';
    return;
  }
  panel.innerHTML = state.evFormTodoIds.map((id) =>
    '<span class="ev-todo-chip" data-id="' + escapeHtml(id) + '" title="' + escapeHtml(id) + '">' +
    '<span class="ev-todo-chip-text">' + escapeHtml(id) + '</span>' +
    '<span class="ev-todo-chip-x" data-id="' + escapeHtml(id) + '" title="移除">✕</span></span>'
  ).join('');
}
function calEvAddTodoLink(id) {
  id = String(id || '').trim();
  if (!id) return;
  if (state.evFormTodoIds.indexOf(id) >= 0) { showToast('該卡片 id 已關聯', 'error'); return; }
  state.evFormTodoIds.push(id);
  calRenderEvTodoLinkPanel();
}
function calEvRemoveTodoLink(id) {
  const i = state.evFormTodoIds.indexOf(id);
  if (i >= 0) state.evFormTodoIds.splice(i, 1);
  calRenderEvTodoLinkPanel();
}

// 渲染行程列表：日期升序分組，過去行程淡化，今天高亮；每條帶「編輯/刪除」
function renderEventsList(content) {
  const list = elements.eventsList;
  if (!list) return;
  state.calEvents = parseCalendarEvents(content);
  if (!state.calEvents.length) {
    list.innerHTML = '<div class="ev-empty">尚未有行程<br><span style="font-size:12px">點右上「＋ 新增行程」，或編輯 calendar.md 原文（以 ## EVENT 分隔）</span></div>';
    return;
  }
  const today = calendarFmtDate(new Date());
  // 🏷 套用標籤過濾（過濾後為空 → 提示「沒有符合的行程」，與無行程區分）
  const visible = state.calEvents.filter(calEventMatchesTag);
  if (!visible.length) {
    list.innerHTML = '<div class="ev-empty">' +
      (state.calEvents.length ? '沒有符合所選標籤的行程<br><span style="font-size:12px">點上方標籤可取消篩選</span>'
        : '尚未有行程<br><span style="font-size:12px">點右上「＋ 新增行程」，或編輯 calendar.md 原文（以 ## EVENT 分隔）</span>') +
      '</div>';
    return;
  }
  const sorted = sortedCalEvents(visible);

  let html = '';
  let lastDate = null;
  for (const ev of sorted) {
    if (ev.date !== lastDate) {
      lastDate = ev.date;
      html += calDateHeaderHtml(ev.date, today);
    }
    html += evItemHtml(ev, today);
  }
  list.innerHTML = html;
  // 自動滾動到今天或最近未來日期的懸浮條
  scrollToNearestDate(list);
}

// 自動滾動到離今天最近的日期懸浮條（優先今天，其次最近未來日期，最後最後一個）
function scrollToNearestDate(list) {
  if (!list) return;
  const headers = list.querySelectorAll('.ev-date[data-ev-date]');
  if (!headers.length) return;
  const today = calendarFmtDate(new Date());
  // 1. 精確匹配今天
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].dataset.evDate === today) { headers[i].scrollIntoView({ block: 'start' }); return; }
  }
  // 2. 找最近未來日期
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].dataset.evDate > today) { headers[i].scrollIntoView({ block: 'start' }); return; }
  }
  // 3. 全是過去日期 → 滾到最後一個
  headers[headers.length - 1].scrollIntoView({ block: 'start' });
}

// 條目排序：日期升序 → 同日全天在前 → 開始時間
function sortedCalEvents(events) {
  return events.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return calendarTimeToMin(a.startTime) - calendarTimeToMin(b.startTime);
  });
}

// 倒計時標籤：今天 / N天后 / N天前（日期字符串安全運算，不受時區/夏令時影響）
function calCountdownLabel(date, today) {
  const p = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const a = p(date), b = p(today);
  if (!a || !b) return '';
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return '今天';
  return diff > 0 ? diff + '天后' : (-diff) + '天前';
}

// ===== 📅 農民曆 / 老黃曆取數（lunar-javascript，繁體）=====
// 以 <script> 載入的 window.Solar / window.Lunar 為資料源；Map 快取避免重複計算。
const calAlmanacCache = new Map();
function calAlmanac(dateStr) {
  if (calAlmanacCache.has(dateStr)) return calAlmanacCache.get(dateStr);
  let data = { error: 'lunar lib 未載入或日期無效' };
  try {
    if (typeof Solar === 'undefined' || typeof Lunar === 'undefined') throw new Error('lunar lib 未載入');
    const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) throw new Error('日期格式錯誤');
    const lunar = Solar.fromYmd(+m[1], +m[2], +m[3]).getLunar();
    data = {
      lunarMonth: lunar.getMonthInChinese(),   // 八 / 闰二
      lunarDay: lunar.getDayInChinese(),        // 初七
      lunarText: lunar.getMonthInChinese() + '月' + lunar.getDayInChinese(), // 八月初七（getMonthInChinese 只回「八」，需補「月」）
      isLeap: lunar.getMonth() < 0,
      yearGanZhi: lunar.getYearInGanZhi(),      // 丙午
      monthGanZhi: lunar.getMonthInGanZhi(),    // 丁酉
      dayGanZhi: lunar.getDayInGanZhi(),        // 甲午
      shengxiao: lunar.getYearShengXiao(),      // 馬
      yearChinese: lunar.getYearInChinese(),    // 二〇二六
      jieqi: lunar.getJieQi() || '',            // 秋分 / ''
      // 宜忌/彭祖/吉神/凶神/納音/宿/建除 均為簡體 → 逐詞轉繁體（almanacToTrad）
      yi: (lunar.getDayYi() || []).map(almanacToTrad),   // 宜
      ji: (lunar.getDayJi() || []).map(almanacToTrad),   // 忌
      chong: lunar.getDayChong() || '',         // 子
      chongShengXiao: almanacToTrad(lunar.getDayChongShengXiao() || ''), // 鼠
      sha: lunar.getDaySha() || '',             // 北
      pengZuGan: almanacToTrad(lunar.getPengZuGan() || ''),
      pengZuZhi: almanacToTrad(lunar.getPengZuZhi() || ''),
      jiShen: (lunar.getDayJiShen() || []).map(almanacToTrad),   // 吉神宜趨
      xiongSha: (lunar.getDayXiongSha() || []).map(almanacToTrad),   // 凶神宜忌
      naYin: almanacToTrad(lunar.getDayNaYin() || ''),  // 沙中金
      xiu: almanacToTrad(lunar.getXiu() || ''),         // 角
      xiuLuck: lunar.getXiuLuck() || '',        // 吉
      zhiXing: almanacToTrad(lunar.getZhiXing() || ''), // 收
      posXi: lunar.getDayPositionXiDesc() || '',    // 東北
      posCai: lunar.getDayPositionCaiDesc() || '',  // 東北
      posFu: lunar.getDayPositionFuDesc() || '',    // 正北
      posYangGui: lunar.getDayPositionYangGuiDesc() || '', // 西南
      posYinGui: lunar.getDayPositionYinGuiDesc() || ''    // 東北
    };
  } catch (e) {
    data = { error: String((e && e.message) || e) };
  }
  calAlmanacCache.set(dateStr, data);
  return data;
}

// 常顯用精簡標籤：有節氣顯示節氣（更實用），否則顯示農曆日（初七 / 廿三 …）
function calLunarCompact(dateStr) {
  const a = calAlmanac(dateStr);
  if (a.error) return { text: '', jieqi: '', lunar: '', lunarText: '', yearGanZhi: '', shengxiao: '', monthGanZhi: '', dayGanZhi: '' };
  return {
    text: a.jieqi || a.lunarDay,
    jieqi: a.jieqi || '',
    lunar: a.lunarDay,
    lunarText: a.lunarText,
    yearGanZhi: a.yearGanZhi,
    shengxiao: a.shengxiao,
    monthGanZhi: a.monthGanZhi,
    dayGanZhi: a.dayGanZhi
  };
}

// 老黃曆詳情浮層 HTML（繁體）
function calAlmanacHtml(dateStr) {
  const a = calAlmanac(dateStr);
  if (a.error) return '<div class="ev-alm-empty">無法取得農民曆：' + escapeHtml(a.error) + '</div>';
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const solarLabel = m ? (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日 週' + WD[d.getDay()] : dateStr;
  const E = escapeHtml;
  const join = (arr) => (arr && arr.length ? arr.map(E).join('、') : '—');
  const row = (k, v) => '<div class="ev-alm-row"><span class="ev-alm-k">' + k + '</span><span class="ev-alm-v">' + v + '</span></div>';
  let html = '';
  html += '<div class="ev-alm-head">';
  html += '<div class="ev-alm-solar">' + E(solarLabel) + '</div>';
  html += '<div class="ev-alm-lunar">農曆 ' + E(a.yearGanZhi) + '年（' + E(a.shengxiao) + '）' + E(a.lunarText) + (a.jieqi ? ' · ' + E(a.jieqi) : '') + '</div>';
  html += '</div>';
  html += '<div class="ev-alm-grid">';
  html += row('干支', E(a.yearGanZhi) + '（年） / ' + E(a.monthGanZhi) + '（月） / ' + E(a.dayGanZhi) + '（日）');
  html += row('五行納音', E(a.naYin));
  if (a.jieqi) html += row('節氣', E(a.jieqi));
  html += row('宜', '<span class="ev-alm-yi">' + join(a.yi) + '</span>');
  html += row('忌', '<span class="ev-alm-ji">' + join(a.ji) + '</span>');
  html += row('沖煞', '沖' + E(a.chongShengXiao) + '（' + E(a.chong) + '）· 煞' + E(a.sha) + '方');
  html += row('彭祖百忌', E(a.pengZuGan) + '；' + E(a.pengZuZhi));
  html += row('吉神宜趨', join(a.jiShen));
  html += row('凶神宜忌', join(a.xiongSha));
  html += row('二十八宿', E(a.xiu) + '（' + E(a.xiuLuck) + '）');
  html += row('十二建除', E(a.zhiXing));
  html += row('喜神', E(a.posXi));
  html += row('財神', E(a.posCai));
  html += row('福神', E(a.posFu));
  html += row('陽貴', E(a.posYangGui));
  html += row('陰貴', E(a.posYinGui));
  html += '</div>';
  return html;
}

// 老黃曆詳情浮層：點擊農曆文字 / 📜 觸發，複用 body 浮層 + 外部點擊關閉
let calAlmanacEl = null;
function calShowAlmanac(dateStr, anchorEl) {
  calRemoveMenu(); calRemoveDetail(); calRemoveAlmanac();
  const pop = document.createElement('div');
  pop.className = 'ev-almanac-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '老黃曆');
  pop.innerHTML = '<button type="button" class="ev-almanac-close" aria-label="關閉">✕</button>' + calAlmanacHtml(dateStr);
  document.body.appendChild(pop);
  calAlmanacEl = pop;
  const pw = pop.offsetWidth || 320, ph = pop.offsetHeight || 320;
  const r = anchorEl ? anchorEl.getBoundingClientRect() : null;
  let left = r ? r.left : (window.innerWidth - pw) / 2;
  let top = r ? r.bottom + 6 : (window.innerHeight - ph) / 2;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  pop.querySelector('.ev-almanac-close').addEventListener('click', calRemoveAlmanac);
  setTimeout(() => document.addEventListener('click', calDocClick, true), 0);
}
function calRemoveAlmanac() {
  if (calAlmanacEl) { calAlmanacEl.remove(); calAlmanacEl = null; }
  // 若選單/詳情都已關，一併解綁外部點擊監聽
  if (!calMenuEl && !calDetailEl) document.removeEventListener('click', calDocClick, true);
}

// 表單日期輸入框旁的星期提示：根據輸入的日期即時顯示「（星期五）」；結束日留空則清除
// 同時顯示農曆 / 節氣（ev-f-*-lunar，點擊即開老黃曆詳情）
function calUpdateFormDow() {
  const WD = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const m = String(val || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    el.textContent = m ? '（' + WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + '）' : '';
  };
  set('ev-f-date-dow', elements.evFDate && elements.evFDate.value);
  set('ev-f-enddate-dow', elements.evFEndDate && elements.evFEndDate.value);
  const setLunar = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cp = calLunarCompact(val);
    el.textContent = cp.jieqi || cp.lunarText || '';
  };
  setLunar('ev-f-date-lunar', elements.evFDate && elements.evFDate.value);
  setLunar('ev-f-enddate-lunar', elements.evFEndDate && elements.evFEndDate.value);
}

function calDateHeaderHtml(date, today) {
  const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  let label = '日期未知';
  let week = '';
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    label = (+m[2]) + '月' + (+m[3]) + '日';
    week = WD[d.getDay()];
  }
  const isToday = date === today;
  const cd = calCountdownLabel(date, today);
  const cp = calLunarCompact(date);
  const lunarHdr = cp.lunarText ? '農曆 ' + cp.lunarText + (cp.jieqi ? ' · ' + cp.jieqi : '') : (cp.jieqi || '');
  return '<div class="ev-date' + (isToday ? ' today' : '') + '" data-ev-date="' + escapeHtml(date) + '">' + label +
    (week ? '<span class="ev-week">週' + week + '</span>' : '') +
    // ⏳ 倒計時徽章：每天必顯示（今天＝高亮，其餘＝灰底），取代原先「僅今天顯示」
    (cd ? '<span class="ev-today-badge' + (isToday ? '' : ' dim') + '">' + cd + '</span>' : '') +
    (lunarHdr ? '<span class="ev-lunar hdr" data-ev-almanac="' + escapeHtml(date) + '" title="農民曆 / 老黃曆">' + escapeHtml(lunarHdr) + '</span>' : '') +
    '<button type="button" class="ev-day-add" data-ev-add-on="' + escapeHtml(date) + '">＋ 新增</button></div>';
}

// 單條行程 HTML（列表視圖與月視圖日列表共用；含編輯/刪除按鈕，走事件委派）
function evItemHtml(ev, today) {
  const multi = calIsMultiDay(ev);
  // 跨天進行中（今天落在區間內）不視為過去 → 不淡化
  const past = ev.date < today && !(multi && ev.endDate >= today);
  let time;
  if (multi) {
    time = ev.allDay
      ? (calRangeLabel(ev.date, ev.endDate) + ' · 共' + calSpanDays(ev.date, ev.endDate) + '天')
      : calRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
  } else {
    time = ev.allDay ? '全天' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
  }
  const spanBadge = multi ? '<span class="ev-span-badge" title="跨天行程">⤢ 跨' + calSpanDays(ev.date, ev.endDate) + '天</span>' : '';
  return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + (multi ? ' multi' : '') + '" data-ev-edit="' + escapeHtml(ev.uid) + '">' +
    '<input type="checkbox" class="ev-check" data-ev-done="' + escapeHtml(ev.uid) + '"' +
    (ev.done ? ' checked' : '') + ' title="勾選＝已完成">' +
    '<span class="ev-swatch" style="background:' + escapeHtml(ev.color) + '"></span>' +
    '<div class="ev-body">' +
    '<div class="ev-title">' + escapeHtml(ev.title) + spanBadge +
    (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map(t => '#' + escapeHtml(t)).join(' ') + '</span>' : '') +
    calEventTodoLinks(ev) +
    '</div>' +
    '<div class="ev-meta">' + escapeHtml(time) + (ev.location ? ' · 📍' + escapeHtml(ev.location) : '') + '</div>' +
    (ev.notes ? '<div class="ev-notes">' + calNotesWithChecks(escapeHtml(ev.notes), ev.uid) + '</div>' : '') +
    '</div>' +
    '</div>';
  // 📱 編輯/刪除按鈕已移除：點整列（data-ev-edit）→ 觸屏彈選單（詳情/編輯/刪除/取消）、桌面直接開表單。
  //    原按鈕被整行 data-ev-edit 遮蔽（closest 先命中行 → 刪除分支走不到）＋ 觸屏改選單後按鈕行為混亂，故統一收進選單。
}

// ===== 📅 行程月視圖 + 新增/編輯（寫回編輯緩衝，按頂欄「保存」落盤） =====

// 與桌面 calendar 插件完全一致的 11 色 iOS 色板
const CAL_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93'];

function genCalId() {
  return 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// 序列化：與桌面 calendar 插件的 eventToMarkdown/eventsToMarkdown 逐字節對齊（桌面端要能讀回）
function calMdEscape(s) {
  return String(s == null ? '' : s).replace(/`/g, "'");
}
function calEventToMarkdown(ev) {
  const tagsJson = JSON.stringify(Array.isArray(ev.tags) ? ev.tags : []);
  const todoJson = JSON.stringify(Array.isArray(ev.todoIds) ? ev.todoIds : []);
  const color = '"' + String(ev.color || '').replace(/^"|"$/g, '') + '"';
  let s = '## EVENT \n';
  s += '- title: `' + calMdEscape(ev.title) + '`\n';
  s += '- date: `' + calMdEscape(ev.date) + '`\n';
  if (ev.endDate && ev.endDate !== ev.date) s += '- endDate: `' + calMdEscape(ev.endDate) + '`\n';
  s += '- allDay: `' + (ev.allDay ? 'true' : 'false') + '`\n';
  // 完成狀態：永遠顯式寫出（與桌面 calendar 插件同一欄位、同一順序）
  s += '- done: `' + (ev.done ? 'true' : 'false') + '`\n';
  s += '- startTime: `' + calMdEscape(ev.startTime) + '`\n';
  s += '- endTime: `' + calMdEscape(ev.endTime) + '`\n';
  s += '- location: `' + calMdEscape(ev.location) + '`\n';
  s += '- color: `' + color + '`\n';
  s += '- tags: `' + tagsJson + '`\n';
  s += '- todoIds: `' + todoJson + '`\n';
  s += '- Remark:\n```\n' + String(ev.notes || '') + '\n```\n';
  return s;
}
function calEventsToMarkdown(events) {
  const head = '# 日历行程\n\n> 每条行程以 `## EVENT` 分隔，字段值写在反引号内，Remark 用代码块保存多行备注。\n\n';
  if (!events || !events.length) return head;
  return head + events.map(calEventToMarkdown).join('\n');
}

// 視圖總入口（updatePreview 的 events 分支調用）：按模式渲染列表或月曆
function renderEventsContent() {
  if (!isCalendarMd()) return;
  syncEventsModeUI();
  const content = elements.editor.value;
  const isMonth = state.calMode === 'month';
  const isWeek = state.calMode === 'week';
  const isDay = state.calMode === 'day';
  const isGrid = isWeek || isDay;          // 日 / 週共用時間網格
  // 先解析一次供標籤條與日/週網格使用（月/列表的渲染函式內部會再解析一次，結果相同）
  state.calEvents = parseCalendarEvents(content);
  renderCalTagBar();
  if (isMonth) renderCalMonth(content);
  else if (isGrid) {
    renderCalTimeGrid(isDay ? [state.calCursor] : calWeekDays(state.calCursor));
    if (elements.evMonthTitle) elements.evMonthTitle.textContent = calCursorTitle();
  } else renderEventsList(content);
}

function setCalMode(mode) {
  state.calMode = (mode === 'month') ? 'month' : (mode === 'week') ? 'week' : (mode === 'day') ? 'day' : 'list';
  if (state.calMode === 'month' && !state.calSelectedDate) state.calSelectedDate = calendarFmtDate(new Date());
  if (state.calMode === 'day') state.calSelectedDate = calendarFmtDate(state.calCursor);
  renderEventsContent();
}

// 同步工具欄按鈕態 + 列表 / 月曆 / 時間網格容器可見性
function syncEventsModeUI() {
  const mode = state.calMode;
  const month = mode === 'month';
  const isDay = mode === 'day';
  const isWeek = mode === 'week';
  const isGrid = isWeek || isDay;
  if (elements.evModeList) elements.evModeList.classList.toggle('active', mode === 'list');
  if (elements.evModeDay) elements.evModeDay.classList.toggle('active', isDay);
  if (elements.evModeWeek) elements.evModeWeek.classList.toggle('active', isWeek);
  if (elements.evModeMonth) elements.evModeMonth.classList.toggle('active', month);
  // 導航列：列表模式不需要（沒有游標概念）
  if (elements.evMonthNav) elements.evMonthNav.style.display = (month || isGrid) ? '' : 'none';
  if (elements.evMonthWrap) elements.evMonthWrap.style.display = month ? '' : 'none';
  // ⚠️ 同上：#ev-week-wrap 的 CSS 預設是 display:none，顯示時要顯式給 'flex'
  if (elements.evWeekWrap) elements.evWeekWrap.style.display = isGrid ? 'flex' : 'none';
  if (elements.eventsList) elements.eventsList.style.display = mode === 'list' ? '' : 'none';
}

// 月曆：6x7 網格（週一開頭），單元格顯示日號 + 最多 2 條 chip + 溢出數；下方渲染選中日的行程列表
function renderCalMonth(content) {
  state.calEvents = parseCalendarEvents(content);
  const cur = state.calCursor;
  const y = cur.getFullYear(), m = cur.getMonth();
  if (elements.evMonthTitle) elements.evMonthTitle.textContent = y + '年' + (m + 1) + '月';
  const occByDate = {};
  // 🏷 套用標籤過濾後才展開成逐日出現（跨天行程整條過濾，不做逐日拆分）
  state.calEvents.filter(calEventMatchesTag).forEach(ev => { calEventOccurrences(ev).forEach(o => { (occByDate[o.date] = occByDate[o.date] || []).push(o); }); });
  if (!state.calSelectedDate) state.calSelectedDate = calendarFmtDate(new Date());
  const todayStr = calendarFmtDate(new Date());
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // 週一開頭
  const start = new Date(y, m, 1 - offset);
  const HEADS = ['一', '二', '三', '四', '五', '六', '日'];
  let html = HEADS.map(h => '<div class="ev-mc-head">' + h + '</div>').join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = calendarFmtDate(d);
    const out = d.getMonth() !== m;
    const occ = (occByDate[ds] || []).slice().sort(calOccSort);
    let chips = '';
    for (let j = 0; j < Math.min(2, occ.length); j++) {
      chips += calSpanChipHtml(occ[j].ev, occ[j].pos, occ[j].idx, occ[j].total);
    }
    if (occ.length > 2) chips += '<div class="ev-more">+' + (occ.length - 2) + '</div>';
    const cp = calLunarCompact(ds);
    const lunarCls = 'ev-lunar' + (cp.jieqi ? ' jieqi' : '');
    html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === todayStr ? ' today' : '') + (ds === state.calSelectedDate ? ' selected' : '') + '" data-date="' + ds + '">' +
      '<span class="ev-daynum">' + d.getDate() + '</span>' +
      (cp.text ? '<span class="' + lunarCls + '" data-ev-almanac="' + escapeHtml(ds) + '" title="農民曆 / 老黃曆">' + escapeHtml(cp.text) + '</span>' : '') +
      chips + '</div>';
  }
  if (elements.evMonthGrid) elements.evMonthGrid.innerHTML = html;
  renderCalDayList();
}

// 月視圖下方：選中日期的行程列表（含編輯/刪除 + 該日新增入口）
function renderCalDayList() {
  const list = elements.evDayList;
  if (!list) return;
  const ds = state.calSelectedDate || calendarFmtDate(new Date());
  const today = calendarFmtDate(new Date());
  const m = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const evs = sortedCalEvents(state.calEvents.filter(e => (e.date === ds || (e.endDate && ds > e.date && ds <= e.endDate)) && calEventMatchesTag(e)));
  let html = '<div class="ev-date' + (ds === today ? ' today' : '') + '">' +
    (m ? (+m[2]) + '月' + (+m[3]) + '日' : '日期未知') +
    '<span class="ev-week">週' + WD[d.getDay()] + '</span>' +
    (ds === today ? '<span class="ev-today-badge">今天</span>' : '') +
    '<span class="ev-week">· ' + evs.length + ' 條</span>' +
    '<span class="ev-toolbar-flex"></span>' +
    '<button type="button" class="ev-day-add" data-ev-add-on="' + escapeHtml(ds) + '">＋ 此日新增</button>' +
    '</div>';
  if (!evs.length) {
    html += '<div class="ev-empty">這一天沒有行程</div>';
  } else {
    for (const ev of evs) html += evItemHtml(ev, today);
  }
  list.innerHTML = html;
}

// 條目操作（事件委派）：編輯 / 刪除 / 月視圖「此日新增」
function onEvListClick(e) {
  // 📅 點列表標題的農曆文字 → 開老黃曆詳情
  const alm = e.target.closest('[data-ev-almanac]');
  if (alm) { calShowAlmanac(alm.getAttribute('data-ev-almanac'), alm); return; }
  // 完成勾選框：切換 done → 寫回編輯緩衝（按頂欄「保存」才落盤）
  const doneChk = e.target.closest('[data-ev-done]');
  if (doneChk) { toggleEventDone(doneChk.getAttribute('data-ev-done'), doneChk.checked); return; }
  const editBtn = e.target.closest('[data-ev-edit]');
  if (editBtn) {
    const uid = editBtn.getAttribute('data-ev-edit');
    // 触屏：点事件改弹小选单（编辑 / 详情），不再直接开表单；桌面保持点开表单
    if (calCanHover.matches) openEventForm(uid);
    else calShowEventMenu(editBtn, uid);
    return;
  }
  const delBtn = e.target.closest('[data-ev-del]');
  if (delBtn) { deleteEventByUid(delBtn.getAttribute('data-ev-del')); return; }
  const addBtn = e.target.closest('[data-ev-add-on]');
  if (addBtn) { openEventForm(null, addBtn.getAttribute('data-ev-add-on')); return; }
}

// 打開表單：uid 為 null = 新增（預設日期 = 月視圖選中日或今天）；uid 有值 = 編輯該條
function openEventForm(uid, defaultDate, pre) {
  calHideTip();
  if (!isCalendarMd()) return;
  state.calEvents = parseCalendarEvents(elements.editor.value);
  state.evFormUid = null;
  let ev = null;
  if (uid) {
    ev = state.calEvents.find(x => x.uid === uid) || null;
    if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
    state.evFormUid = uid;
  }
  const p = pre || {}; // 🖱 雙擊空白快速新增時的預填：{ allDay, startTime, endTime }
  const today = calendarFmtDate(new Date());
  elements.evFormTitle.textContent = uid ? '編輯行程' : '新增行程';
  elements.evFTitle.value = ev ? ev.title : '';
  elements.evFDate.value = ev ? ev.date : (defaultDate || (state.calMode === 'month' ? state.calSelectedDate : today) || today);
  elements.evFEndDate.value = ev ? (ev.endDate || '') : '';
  calUpdateFormDow(); // 🗓 依輸入日期即時顯示星期
  elements.evFAllday.checked = ev ? ev.allDay : (p.allDay === true);
  // 完成狀態：新增預設未完成（舊檔案沒有 - done 欄位時解析也是未完成）
  elements.evFDone.checked = ev ? !!ev.done : false;
  elements.evFStart.value = ev ? ev.startTime : (p.startTime || '');
  elements.evFEnd.value = ev ? ev.endTime : (p.endTime || '');
  elements.evFStart.disabled = elements.evFAllday.checked;
  elements.evFEnd.disabled = elements.evFAllday.checked;
  elements.evFLocation.value = ev ? ev.location : '';
  state.evFormColor = ev ? ev.color : CAL_COLORS[0];
  elements.evFTags.value = ev && ev.tags ? ev.tags.join(', ') : '';
  // 🔗 關聯 Todo 卡片：帶入該行程原本的 todoIds（slice 複製，避免改到工作副本）
  state.evFormTodoIds = ev ? (ev.todoIds || []).slice() : [];
  calRenderEvTodoLinkPanel();
  if (elements.evFTodoInput) elements.evFTodoInput.value = '';
  elements.evFNotes.value = ev ? ev.notes : '';
  elements.evFormDelete.style.display = uid ? '' : 'none';
  renderEvColorSwatches();
  elements.evFormOverlay.style.display = 'flex';
  elements.evFTitle.focus();
}

function renderEvColorSwatches() {
  if (!elements.evFColors) return;
  elements.evFColors.innerHTML = CAL_COLORS.map(c =>
    '<span class="sw' + (c === state.evFormColor ? ' selected' : '') + '" data-color="' + c + '" style="background:' + c + '"></span>'
  ).join('');
  // 色板選擇（一次性委派，openEventForm 每次重建）
  elements.evFColors.onclick = (e) => {
    const sw = e.target.closest('.sw[data-color]');
    if (!sw) return;
    state.evFormColor = sw.getAttribute('data-color');
    elements.evFColors.querySelectorAll('.sw').forEach(x => x.classList.toggle('selected', x.getAttribute('data-color') === state.evFormColor));
  };
}

function closeEventForm() {
  if (elements.evFormOverlay) elements.evFormOverlay.style.display = 'none';
  state.evFormUid = null;
  state.evFormColor = null;
  state.evFormTodoIds = [];
}

// 表單「寫入編輯內容」：校驗 → upsert 工作副本 → 重新序列化整份 calendar.md → 寫回編輯器緩衝（isDirty = true）
// ⚠️ 不直接落盤：iOS 無法直接寫原文件，走現有「保存」流程（分享面板 → 儲存到檔案 → 覆蓋）
function saveEventForm() {
  const title = elements.evFTitle.value.trim();
  let date = elements.evFDate.value;
  let endDate = elements.evFEndDate.value;
  if (!title) { alert('請輸入標題'); elements.evFTitle.focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('請選擇日期'); elements.evFDate.focus(); return; }
  // 跨天：結束日早於起始日則互換；等於起始日視為單日（清空 endDate）
  if (endDate && endDate < date) { const tmp = date; date = endDate; endDate = tmp; }
  if (endDate === date) endDate = '';
  const allDay = elements.evFAllday.checked;
  const ev = {
    uid: state.evFormUid || genCalId(),
    title,
    date,
    endDate: endDate || '',
    allDay,
    done: elements.evFDone.checked,
    startTime: allDay ? '' : elements.evFStart.value,
    endTime: allDay ? '' : elements.evFEnd.value,
    location: elements.evFLocation.value.trim(),
    color: state.evFormColor || CAL_COLORS[0],
    tags: elements.evFTags.value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    // 🔗 修復：此前漏寫 todoIds → 每次編輯存檔都會把桌面端建立的關聯卡片清空
    todoIds: state.evFormTodoIds.slice(),
    notes: elements.evFNotes.value.replace(/\r\n/g, '\n')
  };
  // 以當前編輯器內容為基準重新解析（保留用戶可能手改過的其它條目），再 upsert
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const i = state.calEvents.findIndex(x => x.uid === ev.uid);
  if (i >= 0) state.calEvents[i] = ev;
  else state.calEvents.push(ev);
  applyEventsToEditor();
  closeEventForm();
  showToast('已寫入編輯內容，按頂欄「保存」存回文件', 'success');
}

// 刪除：confirm → 從工作副本移除 → 寫回編輯器緩衝
function deleteEventByUid(uid) {
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find(x => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  if (!window.confirm('確定刪除行程「' + ev.title + '」（' + ev.date + '）嗎？\n\n寫入後按「保存」才會真正存回文件。')) return;
  state.calEvents = state.calEvents.filter(x => x.uid !== uid);
  applyEventsToEditor();
  showToast('已刪除「' + ev.title + '」，按「保存」存回文件', 'success');
}

function deleteEventFromForm() {
  if (!state.evFormUid) return;
  const uid = state.evFormUid;
  closeEventForm();
  deleteEventByUid(uid);
}

// 清單上的「完成」勾選框：切換 done → 寫回編輯緩衝（applyEventsToEditor 內會重繪行程視圖）
function toggleEventDone(uid, done) {
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find(x => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  ev.done = !!done;
  applyEventsToEditor();
  showToast(ev.done ? '已標記完成，按「保存」存回文件' : '已取消完成，按「保存」存回文件', 'success');
}

// 備註裡的 Markdown checkbox 勾選/取消：定位 ev.notes 的對應行，互換 - [ ] ↔ - [x]，序列化寫回編輯緩衝（按「保存」才落盤）
function calToggleNoteCheck(e, uid, line) {
  if (e) { e.stopPropagation(); e.preventDefault(); } // 阻止冒泡到 .ev-block 開啟編輯表單
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find(x => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  const lines = String(ev.notes || '').split('\n');
  if (line < 0 || line >= lines.length) return;
  const m = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
  if (!m) return; // 該行已被用戶改得不再是 checkbox，跳過以免破壞原文
  const done = m[2] !== ' ';
  lines[line] = m[1] + '- [' + (done ? ' ' : 'x') + ']' + (m[3] ? ' ' + m[3] : '');
  ev.notes = lines.join('\n');
  applyEventsToEditor(); // 序列化 + 標髒 + 重繪（多天事件多列自動同步）
  showToast(done ? '已取消勾選，按「保存」存回文件' : '已勾選，按「保存」存回文件', 'success');
}
function calCalCheckKey(e, uid, line) {
  if (e && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
    e.preventDefault();
    calToggleNoteCheck(e, uid, line);
  }
}

// 把工作副本序列化為 calendar.md 全文寫回編輯器緩衝；
// lastContent 不動 → isDirty = true → 頂欄「保存」亮起，由用戶決定何時落盤
function applyEventsToEditor() {
  elements.editor.value = calEventsToMarkdown(state.calEvents);
  state.isDirty = elements.editor.value !== state.lastContent;
  updateStatus();
  updateWordCount();
  updatePreview(); // 重新渲染行程列表 / 月曆
}
