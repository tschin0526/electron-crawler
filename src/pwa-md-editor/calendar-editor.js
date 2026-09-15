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
function renderCalTimeGrid(dayDates) {
  const wrap = elements.evWeekWrap;
  if (!wrap) return;
  const hourH = dayDates.length > 1 ? 48 : 56;   // 週視圖列窄 → 小時格矮一點
  const n = dayDates.length;
  const todayStr = calendarFmtDate(new Date());
  const now = new Date();
  const allDayByCol = dayDates.map((d) => calEventsOnDay(calendarFmtDate(d)).filter((o) => o.ev.allDay));
  const hasAllDay = allDayByCol.some((arr) => arr.length > 0);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  let html = '';
  // 🗓 欄位日期標題：讓每一「直行」看得出是哪一天（與桌面端對齊）
  //    ⚠️ 與時間網格共用同一套 grid 模板，且 column-gap 必須為 0，否則會累積漂移導致對不齊
  html += '<div class="ev-tg-head" style="--cols:' + n + '"><div class="ev-tg-head-gutter"></div>';
  dayDates.forEach((d) => {
    const ds = calendarFmtDate(d);
    const dm = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const label = dm ? (+dm[2]) + '/' + (+dm[3]) : ds;
    html += '<div class="ev-tg-head-cell' + (ds === todayStr ? ' today' : '') + '" data-date="' + ds + '">' +
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
        (notes ? '<div class="notes">' + escapeHtml(notes) + '</div>' : '') +
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
  html += '</div></div>';
  wrap.innerHTML = html;
  // 初次進入自動捲到「現在時間前 2 小時」
  requestAnimationFrame(() => {
    const sc = wrap.querySelector('.ev-timegrid-scroll');
    if (sc) sc.scrollTop = Math.max(0, now.getHours() * hourH + now.getMinutes() - 120);
  });
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
  else if (state.calMode === 'day') state.calCursor = calAddDays(state.calCursor, dir);
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
  return '<div class="ev-date' + (isToday ? ' today' : '') + '" data-ev-date="' + escapeHtml(date) + '">' + label +
    (week ? '<span class="ev-week">週' + week + '</span>' : '') +
    (isToday ? '<span class="ev-today-badge">今天</span>' : '') +
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
  return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + (multi ? ' multi' : '') + '">' +
    '<input type="checkbox" class="ev-check" data-ev-done="' + escapeHtml(ev.uid) + '"' +
    (ev.done ? ' checked' : '') + ' title="勾選＝已完成">' +
    '<span class="ev-swatch" style="background:' + escapeHtml(ev.color) + '"></span>' +
    '<div class="ev-body">' +
    '<div class="ev-title">' + escapeHtml(ev.title) + spanBadge +
    (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map(t => '#' + escapeHtml(t)).join(' ') + '</span>' : '') +
    calEventTodoLinks(ev) +
    '</div>' +
    '<div class="ev-meta">' + escapeHtml(time) + (ev.location ? ' · 📍' + escapeHtml(ev.location) : '') + '</div>' +
    (ev.notes ? '<div class="ev-notes">' + escapeHtml(ev.notes) + '</div>' : '') +
    '</div>' +
    '<div class="ev-actions">' +
    '<button type="button" data-ev-edit="' + escapeHtml(ev.uid) + '">編輯</button>' +
    '<button type="button" data-ev-del="' + escapeHtml(ev.uid) + '">刪除</button>' +
    '</div></div>';
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
    html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === todayStr ? ' today' : '') + (ds === state.calSelectedDate ? ' selected' : '') + '" data-date="' + ds + '">' +
      '<span class="ev-daynum">' + d.getDate() + '</span>' + chips + '</div>';
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
  // 完成勾選框：切換 done → 寫回編輯緩衝（按頂欄「保存」才落盤）
  const doneChk = e.target.closest('[data-ev-done]');
  if (doneChk) { toggleEventDone(doneChk.getAttribute('data-ev-done'), doneChk.checked); return; }
  const editBtn = e.target.closest('[data-ev-edit]');
  if (editBtn) { openEventForm(editBtn.getAttribute('data-ev-edit')); return; }
  const delBtn = e.target.closest('[data-ev-del]');
  if (delBtn) { deleteEventByUid(delBtn.getAttribute('data-ev-del')); return; }
  const addBtn = e.target.closest('[data-ev-add-on]');
  if (addBtn) { openEventForm(null, addBtn.getAttribute('data-ev-add-on')); return; }
}

// 打開表單：uid 為 null = 新增（預設日期 = 月視圖選中日或今天）；uid 有值 = 編輯該條
function openEventForm(uid, defaultDate, pre) {
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

// 把工作副本序列化為 calendar.md 全文寫回編輯器緩衝；
// lastContent 不動 → isDirty = true → 頂欄「保存」亮起，由用戶決定何時落盤
function applyEventsToEditor() {
  elements.editor.value = calEventsToMarkdown(state.calEvents);
  state.isDirty = elements.editor.value !== state.lastContent;
  updateStatus();
  updateWordCount();
  updatePreview(); // 重新渲染行程列表 / 月曆
}
