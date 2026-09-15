/* ============================================================
 * 📅 Calendar 特性編輯器（桌面版 todo 編輯器的資料感知編輯器 #1）
 * ------------------------------------------------------------
 * 由 index.html 內嵌腳本抽離成獨立程式文件（<script src> 載入）。
 * 職責：calendar.md 的解析 / 序列化 / 列表·月·週·日渲染 / 表單 / 導航。
 * 宿主（index.html 主腳本）提供：currentFileTarget、tlEscapeHtml、showToast、
 * taskText 編輯緩衝、#calEventsPane 等掛載 DOM 與 ev-* 樣式。
 * 約定：本文件只含 calendar 邏輯；未來新增其它特性編輯器時各自一個
 * <script src="xxx-editor.js">，互不干擾。
 * ============================================================ */
    // ========== 📅 行程视图（calendar.md 专用）：列表 / 月模式 + 新增·编辑·删除 ==========
    // 与 Lite（pwa-md-editor）同一套实现：解析 ## EVENT 块；编辑写回 taskText 缓冲，按「保存」落盘。
    let calEventsView = false;
    let tlCalMode = 'list';
    let tlCalCursor = new Date();
    let tlCalSelected = null;
    let tlCalEvents = [];
    let tlCalTagFilter = [];   // 标签过滤（空＝全部；OR 逻辑：事件 tags 命中任一即显示）
    let tlEvFormTodoIds = [];   // 表单内「关联 Todo 卡片」临时列表（仅编辑期，不污染存档对象）
    let tlEvFormUid = null;
    let tlEvFormColor = null;
    const TL_CAL_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93'];

    // 当前编辑器打开的文件是不是 calendar.md（行程应用数据文件）
    function isCalendarMdDoc() {
      const t = currentFileTarget();
      if (!t) return false;
      const name = String(t.name || '').toLowerCase();
      if (name !== 'calendar.md') return false;
      return t.kind === 'md' || (t.kind === 'ext' && /\.md$/i.test(name));
    }

    // 显示/隐藏「📅 行程」开关；文件不是 calendar.md 时若停在行程视图则退回编辑模式
    function updateCalEventsBtnVisibility() {
      const btn = document.getElementById('calEventsBtn');
      const show = isCalendarMdDoc();
      if (btn) {
        btn.style.display = show ? '' : 'none';
        btn.classList.toggle('active', show && calEventsView);
      }
      if (!show && calEventsView) setCalEventsView(false);
    }

    function toggleCalEventsView() {
      setCalEventsView(!calEventsView);
    }

    function setCalEventsView(on) {
      if (on && !isCalendarMdDoc()) return;
      calEventsView = !!on;
      const btn = document.getElementById('calEventsBtn');
      if (btn) btn.classList.toggle('active', calEventsView);
      if (calEventsView) {
        showCalEventsPaneOnly();
        tlRenderEventsContent();
      } else {
        // 交还给原模式：这里先收掉面板，再由 toggleMdPreview 按 previewMode 重新显示
        // （toggleMdPreview 内部会一并清掉 #mdPreview 上的内联 display:none）
        const pane = document.getElementById('calEventsPane');
        if (pane) pane.style.display = 'none';
        toggleMdPreview(previewMode);
      }
    }

    // 行程视图下：隐藏三个输入框 + 预览 + 三套工具栏，只显示行程面板
    function showCalEventsPaneOnly() {
      const ids = ['taskText', 'htmlText', 'jsonText', 'mdPreview'];
      ids.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      ['mdTools', 'htmlTools', 'jsonTools'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      const pane = document.getElementById('calEventsPane');
      if (pane) pane.style.display = '';
    }

    // ===== 解析（与桌面 calendar 插件 parseMarkdownEvents 对齐） =====
    function tlParseArr(s) {
      s = (s || '').trim();
      if (!s) return [];
      try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function tlParseBlock(block, idx) {
      let remark = '';
      let head = block;
      const ri = block.indexOf('- Remark:');
      if (ri >= 0) {
        head = block.slice(0, ri);
        const m = block.slice(ri + '- Remark:'.length).match(/```([\s\S]*)```/);
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
        idx, uid: 'evp' + idx, title,
        date: get('date'),
        endDate: get('endDate'),
        allDay: get('allDay') === 'true',
        // 完成状态：旧文件没有 - done 栏位 → 视为未设定 = 未完成
        done: get('done') === 'true',
        startTime: get('startTime'),
        endTime: get('endTime'),
        location: get('location'),
        color: color || TL_CAL_COLORS[0],
        tags: tlParseArr(get('tags')),
        // 修复：此前缺读 todoIds，往返保存会把 calendar 插件写入的关联卡片清空
        todoIds: tlParseArr(get('todoIds')),
        notes: remark
      };
    }
    function tlParseEvents(md) {
      if (!md) return [];
      const out = [];
      const blocks = String(md).split(/^##[ \t]*EVENT[ \t]*$/m);
      for (let i = 0; i < blocks.length; i++) {
        const ev = tlParseBlock(blocks[i], i);
        if (ev) out.push(ev);
      }
      return out;
    }

    // ===== 序列化（与桌面 calendar 插件 eventsToMarkdown 逐字节对齐） =====
    function tlMdEscape(s) { return String(s == null ? '' : s).replace(/`/g, "'"); }
    function tlEventToMarkdown(ev) {
      const tagsJson = JSON.stringify(Array.isArray(ev.tags) ? ev.tags : []);
      const todoJson = JSON.stringify(Array.isArray(ev.todoIds) ? ev.todoIds : []);
      const color = '"' + String(ev.color || '').replace(/^"|"$/g, '') + '"';
      let s = '## EVENT \n';
      s += '- title: `' + tlMdEscape(ev.title) + '`\n';
      s += '- date: `' + tlMdEscape(ev.date) + '`\n';
      if (ev.endDate && ev.endDate !== ev.date) s += '- endDate: `' + tlMdEscape(ev.endDate) + '`\n';
      s += '- allDay: `' + (ev.allDay ? 'true' : 'false') + '`\n';
      // 完成状态：永远显式写出（与桌面 calendar 插件同一栏位、同一顺序）
      s += '- done: `' + (ev.done ? 'true' : 'false') + '`\n';
      s += '- startTime: `' + tlMdEscape(ev.startTime) + '`\n';
      s += '- endTime: `' + tlMdEscape(ev.endTime) + '`\n';
      s += '- location: `' + tlMdEscape(ev.location) + '`\n';
      s += '- color: `' + color + '`\n';
      s += '- tags: `' + tagsJson + '`\n';
      s += '- todoIds: `' + todoJson + '`\n';
      s += '- Remark:\n```\n' + String(ev.notes || '') + '\n```\n';
      return s;
    }
    function tlEventsToMarkdown(events) {
      const head = '# 日历行程\n\n> 每条行程以 `## EVENT` 分隔，字段值写在反引号内，Remark 用代码块保存多行备注。\n\n';
      if (!events || !events.length) return head;
      return head + events.map(tlEventToMarkdown).join('\n');
    }

    function tlFmtDate(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function tlTimeToMin(t) {
      const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? (+m[1]) * 60 + (+m[2]) : 0;
    }
    function tlSorted(events) {
      return events.slice().sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return tlTimeToMin(a.startTime) - tlTimeToMin(b.startTime);
      });
    }
    function tlGenId() { return 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }
    function tlEscapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }
    // ===== 跨天行程辅助 =====
    function tlIsMultiDay(ev) { return !!(ev && ev.endDate && ev.endDate !== ev.date); }
    function tlMdShort(d) { const m = String(d || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? (+m[1]) + '/' + (+m[2]) : (d || ''); }
    function tlSpanDays(a, b) {
      const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
      if (isNaN(d1) || isNaN(d2)) return 1;
      return Math.round((d2 - d1) / 86400000) + 1;
    }
    function tlRangeLabel(a, b, st, et) {
      if (st || et) return tlMdShort(a) + ' ' + (st || '') + ' \u2013 ' + tlMdShort(b) + ' ' + (et || '');
      return tlMdShort(a) + ' \u2013 ' + tlMdShort(b);
    }
    function tlEventOccurrences(ev) {
      const out = [];
      if (tlIsMultiDay(ev)) {
        let cur = new Date(ev.date + 'T00:00:00');
        const end = new Date(ev.endDate + 'T00:00:00');
        if (!isNaN(cur) && !isNaN(end)) {
          const total = Math.round((end - cur) / 86400000) + 1;
          let idx = 0;
          while (cur <= end) {
            idx++;
            const ds = tlFmtDate(cur);
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
    function tlOccSort(a, b) {
      const aSpan = a.pos === 'single' ? 1 : 0, bSpan = b.pos === 'single' ? 1 : 0;
      if (aSpan !== bSpan) return aSpan - bSpan;
      if (a.ev.date !== b.ev.date) return a.ev.date < b.ev.date ? -1 : 1;
      if (a.ev.allDay !== b.ev.allDay) return a.ev.allDay ? -1 : 1;
      return tlTimeToMin(a.ev.startTime) - tlTimeToMin(b.ev.startTime);
    }
    // 跨天行程的「第幾天」後綴：total>1 時回傳「 idx/total」（如 去峨眉山 1/5），單日行程不加
    function tlSpanSuffix(idx, total) { return (total > 1 && idx > 0) ? ' ' + idx + '/' + total : ''; }
    // 📝 備註裡的 Markdown checkbox（- [ ] / - [x]）渲染成 ☐/☑ 樣式，且可點擊勾選/取消（寫回 notes 原文）。
    //    入參必須是「已 escape」的文本；支援任意縮進的 `- [ ]` / `- [x]` / `- [X]`。
    //    uid 為所屬行程（點擊時定位用）；fenced code block 內的行不當成 checkbox，避免誤判代碼。
    function tlNotesWithChecks(esc, uid) {
      let inFence = false;
      return esc.split('\n').map((line, i) => {
        if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
        if (inFence) return line;
        const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
        if (!m) return line;
        const done = m[2] !== ' ';
        const cbAttr = uid
          ? ' data-uid="' + tlEscapeHtml(uid) + '" data-line="' + i + '"' +
            ' onclick="tlToggleNoteCheck(event,\'' + tlEscapeHtml(uid) + '\',' + i + ')"' +
            ' onkeydown="tlCalCheckKey(event,\'' + tlEscapeHtml(uid) + '\',' + i + ')"'
          : '';
        return m[1] + '<span class="ev-md-check' + (done ? ' done' : '') + '"' + cbAttr +
          ' role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '" tabindex="0">' +
          '<span class="ev-cb">' + (done ? '\u2713' : '') + '</span>' + m[3] + '</span>';
      }).join('\n');
    }
    function tlSpanChipHtml(ev, pos, idx, total) {
      // 单日 → 普通 chip（圆点+标题）；跨天 start/middle/end → 连续色条
      const links = tlEventTodoLinks(ev);
      if (pos === 'single') {
        return '<div class="ev-chip' + (ev.done ? ' done' : '') + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')"><span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>' + (ev.done ? '\u2713 ' : '') + tlEscapeHtml(ev.title) + links + '</div>';
      }
      const cls = 'ev-chip span ' + pos + (ev.done ? ' done' : '');
      const dot = '<span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>';
      const titlePart = (ev.done ? '\u2713 ' : '') + tlEscapeHtml(ev.title) + tlSpanSuffix(idx, total) + links;
      // 每一段（start/middle/end）都顯示「標題 k/N」——空色條看不出是哪條行程的延續
      const inner = (pos === 'start' ? dot : '') + titlePart;
      return '<div class="' + cls + '" style="--ev-color:' + tlEscapeHtml(ev.color) + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')">' + inner + '</div>';
    }

    // ===== 标签过滤 / 跨天展开 / 时间网格 辅助 =====
    // 事件是否满足当前标签过滤（空＝全部；OR 逻辑）
    function tlEventMatchesTag(ev) {
      if (!tlCalTagFilter.length) return true;
      const tags = ev.tags || [];
      return tlCalTagFilter.some((t) => tags.indexOf(t) >= 0);
    }
    // 取某天出现的所有事件（含跨天展开），并套用标签过滤
    function tlEventsOnDay(dateStr) {
      const out = [];
      tlCalEvents.forEach((ev) => {
        if (!tlEventMatchesTag(ev)) return;
        tlEventOccurrences(ev).forEach((o) => { if (o.date === dateStr) out.push({ ev: o.ev, pos: o.pos, idx: o.idx, total: o.total }); });
      });
      return out;
    }
    function tlAddDays(d, n) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
    function tlWeekDays(d) {
      const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = (cur.getDay() + 6) % 7; // 周一=0
      cur.setDate(cur.getDate() - dow);
      const out = [];
      for (let i = 0; i < 7; i++) out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + i));
      return out;
    }
    // 重叠布局：把时间冲突的事件分配到并排列（移植自 calendar 插件的 layoutDay）
    function tlLayoutDay(evs) {
      const items = evs.map((e) => ({
        e,
        start: tlTimeToMin(e.startTime),
        end: Math.max(tlTimeToMin(e.endTime), tlTimeToMin(e.startTime) + 15),
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
    // 事件条上的 🔗 关联标记
    function tlEventTodoLinks(ev) {
      const ids = ev.todoIds || [];
      if (!ids.length) return '';
      return ids.map((id) => {
        const t = (typeof todos !== 'undefined') ? todos.find((x) => x.id === id) : null;
        const name = t ? tlTodoTitle(t) : id;
        return '<span class="ev-link" title="\ud83d\udd17 ' + tlEscapeHtml(name) + '">\ud83d\udd17</span>';
      }).join('');
    }
    function tlTodoTitle(t) {
      if (!t) return '';
      const title = t.title || (typeof t.text === 'string' ? t.text.split('\n')[0] : '') || '';
      return (title.trim()) || '(未命名卡片)';
    }
    // 标签过滤条
    function tlRenderTagBar() {
      const bar = document.getElementById('tlEvTagBar');
      const filter = document.getElementById('tlEvTagFilter');
      if (!bar || !filter) return;
      const tags = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (t) tags.add(t); }));
      if (!tags.size) { bar.style.display = 'none'; filter.innerHTML = ''; return; }
      bar.style.display = '';
      filter.innerHTML = Array.from(tags).map((t) => {
        const active = tlCalTagFilter.indexOf(t) >= 0;
        return '<span class="ev-tag-chip' + (active ? ' active' : '') + '" data-tag="' + tlEscapeHtml(t) + '">' + tlEscapeHtml(t) + '</span>';
      }).join('');
    }
    // 日 / 周视图 时间网格（移植自 calendar 插件的 buildTimeGrid，使用 ev- 前缀类名）
    function tlRenderTimeGrid(dayDates) {
      const wrap = document.getElementById('tlEvWeekWrap');
      if (!wrap) return;
      const hourH = dayDates.length > 1 ? 48 : 56;
      const n = dayDates.length;
      const todayStr = tlFmtDate(new Date());
      const now = new Date();
      const allDayByCol = dayDates.map((d) => tlEventsOnDay(tlFmtDate(d)).filter((o) => o.ev.allDay));
      const hasAllDay = allDayByCol.some((arr) => arr.length > 0);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      let html = '';
      // 🗓 欄位日期標題：讓每一「直行」看得出是哪一天。
      //    ⚠️ 與時間網格共用同一套 grid 模板（52px + repeat(--cols,1fr)）且一樣受 max-width 限制 → 必定對齊
      html += '<div class="ev-tg-head" style="--cols:' + n + '"><div class="ev-tg-head-gutter"></div>';
      dayDates.forEach((d) => {
        const ds = tlFmtDate(d);
        const dm = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        const label = dm ? (+dm[2]) + '/' + (+dm[3]) : ds;
        html += '<div class="ev-tg-head-cell' + (ds === todayStr ? ' today' : '') + '" data-date="' + ds + '">' +
          '<span class="dow">週' + WD[d.getDay()] + '</span><span class="dnum">' + label + '</span></div>';
      });
      html += '</div>';
      if (hasAllDay) {
        html += '<div class="ev-allday-strip" style="--cols:' + n + '"><div class="label">全天</div>';
        allDayByCol.forEach((arr, ci) => {
          html += '<div class="ev-allday-col" data-date="' + tlFmtDate(dayDates[ci]) + '">';
          arr.forEach((o) => {
            const ev = o.ev;
            html += '<div class="ev-block all-day' + (ev.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '" onclick="tlOpenEventForm(\'' + tlEscapeHtml(ev.uid) + '\')" style="--ev-color:' + tlEscapeHtml(ev.color || TL_CAL_COLORS[0]) + '">' +
              (ev.done ? '\u2713 ' : '') + tlEscapeHtml(ev.title) + tlSpanSuffix(o.idx, o.total) + tlEventTodoLinks(ev) + '</div>';
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
        html += '<div class="ev-tg-col" data-date="' + tlFmtDate(d) + '">';
        for (let h = 0; h <= 23; h++) html += '<div class="ev-tg-hour-line" style="top:' + (h * hourH) + 'px"></div>';
        const timed = tlLayoutDay(tlEventsOnDay(tlFmtDate(d)).filter((o) => !o.ev.allDay).map((o) => o.ev));
        timed.forEach(({ e, start, end, col, cols }) => {
          const top = start / 60 * hourH;
          const height = Math.max((end - start) / 60 * hourH, 18);
          const width = 100 / cols;
          const left = col * width;
          const cbg = e.color || TL_CAL_COLORS[0];
          // 時間範圍：有開始時間才顯示
          const tm = (e.allDay || !e.startTime) ? '' : (e.startTime + (e.endTime ? '–' + e.endTime : ''));
          // 備註：只有方塊夠高（日模式下 >=64px，約標題+時間+地點+兩行備註）才顯示，
          //       用 -webkit-line-clamp 限行數，超出仍由 .ev-block 的 overflow:hidden 裁掉
          const notes = (!e.allDay && height >= 64 && e.notes) ? String(e.notes).slice(0, 400) : '';
          html += '<div class="ev-block' + (e.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(e.uid) + '" onclick="tlOpenEventForm(\'' + tlEscapeHtml(e.uid) + '\')" style="top:' + top + 'px;height:' + height + 'px;left:calc(' + left + '% + 1px);width:calc(' + width + '% - 3px);--ev-color:' + tlEscapeHtml(cbg) + '">' +
            '<div class="t">' + (e.done ? '\u2713 ' : '') + tlEscapeHtml(e.title) + tlEventTodoLinks(e) + '</div>' +
            (tm ? '<div class="tm">' + tlEscapeHtml(tm) + '</div>' : '') +
            (e.location ? '<div class="loc">' + tlEscapeHtml('\ud83d\udccd ' + e.location) + '</div>' : '') +
            (notes ? '<div class="notes">' + tlNotesWithChecks(tlEscapeHtml(notes), e.uid) + '</div>' : '') +
            '</div>';
        });
        html += '</div>';
      });
      dayDates.forEach((d) => {
        if (tlFmtDate(d) === todayStr) {
          const mins = now.getHours() * 60 + now.getMinutes();
          const top = mins / 60 * hourH;
          html += '<div class="ev-tg-now-line" style="top:' + top + 'px" data-date="' + tlFmtDate(d) + '"></div>';
        }
      });
      html += '</div></div>';
      wrap.innerHTML = html;
      requestAnimationFrame(() => {
        const sc = wrap.querySelector('.ev-timegrid-scroll');
        if (sc) sc.scrollTop = Math.max(0, now.getHours() * hourH + now.getMinutes() - 120);
      });
    }
    // 行程条 / 月格点击打开表单（阻止冒泡到单元格选择）
    function tlOpenEventFromChip(e, uid) { if (e) e.stopPropagation(); tlOpenEventForm(uid); }

    // 表单内「关联 Todo 卡片」面板
    function tlRenderEvTodoLinkPanel() {
      const panel = document.getElementById('tlEvTodoLinkPanel');
      if (!panel) return;
      if (!tlEvFormTodoIds.length) {
        const has = (typeof todos !== 'undefined') && todos.length;
        panel.innerHTML = '<div class="ev-todo-placeholder">' + (has ? '点此或按 ? 选择要关联的卡片' : '暂无 Todo 卡片') + '</div>';
        return;
      }
      panel.innerHTML = tlEvFormTodoIds.map((id) => {
        const t = (typeof todos !== 'undefined') ? todos.find((x) => x.id === id) : null;
        const name = t ? tlTodoTitle(t) : id;
        return '<span class="ev-todo-chip" data-id="' + tlEscapeHtml(id) + '" title="' + tlEscapeHtml(name) + '"><span class="ev-todo-chip-text">' + tlEscapeHtml(name) + '</span><span class="ev-todo-chip-x" data-id="' + tlEscapeHtml(id) + '" title="移除">✕</span></span>';
      }).join('');
    }
    function tlRenderEvTodoDropdown() {
      const dd = document.getElementById('tlEvTodoDropdown');
      if (!dd) return;
      const candidates = ((typeof todos !== 'undefined') ? todos : []).filter((t) => tlEvFormTodoIds.indexOf(t.id) < 0);
      if (!candidates.length) { dd.innerHTML = '<div class="ev-todo-dropdown-empty">已无更多卡片可选</div>'; return; }
      dd.innerHTML = candidates.map((t) => '<div class="ev-todo-dropdown-item" data-id="' + tlEscapeHtml(t.id) + '">' + tlEscapeHtml(tlTodoTitle(t)) + '</div>').join('');
    }
    function tlEvToggleTodoDropdown() {
      const dd = document.getElementById('tlEvTodoDropdown');
      if (!dd) return;
      if (dd.classList.contains('show')) { dd.classList.remove('show'); return; }
      if (!(typeof todos !== 'undefined') || !todos.length) return;
      tlRenderEvTodoDropdown();
      dd.classList.add('show');
    }
    function tlEvAddTodoLink(id) {
      if (!id || tlEvFormTodoIds.indexOf(id) >= 0) return;
      tlEvFormTodoIds.push(id);
      tlRenderEvTodoLinkPanel();
      const left = ((typeof todos !== 'undefined') ? todos : []).filter((t) => tlEvFormTodoIds.indexOf(t.id) < 0);
      if (left.length) tlRenderEvTodoDropdown();
      else { const dd = document.getElementById('tlEvTodoDropdown'); if (dd) dd.classList.remove('show'); }
    }
    function tlEvRemoveTodoLink(id) {
      const i = tlEvFormTodoIds.indexOf(id);
      if (i >= 0) tlEvFormTodoIds.splice(i, 1);
      tlRenderEvTodoLinkPanel();
      const dd = document.getElementById('tlEvTodoDropdown');
      if (dd && dd.classList.contains('show')) tlRenderEvTodoDropdown();
    }

    // ===== 渲染 =====
    function tlRenderEventsContent() {
      if (!calEventsView) return;
      const mode = tlCalMode;
      const isMonth = mode === 'month';
      const isWeek = mode === 'week';
      const isDay = mode === 'day';
      const isGrid = isWeek || isDay; // 日/周共用时间网格
      const setDisp = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v; };
      setDisp('tlEvMonthNav', (isMonth || isGrid) ? '' : 'none');
      setDisp('tlEvMonthWrap', isMonth ? '' : 'none');
      setDisp('tlEvWeekWrap', isGrid ? '' : 'none');
      setDisp('tlEvList', mode === 'list' ? '' : 'none');
      const lb = document.getElementById('tlEvModeList'); if (lb) lb.classList.toggle('active', mode === 'list');
      const db = document.getElementById('tlEvModeDay'); if (db) db.classList.toggle('active', isDay);
      const wb = document.getElementById('tlEvModeWeek'); if (wb) wb.classList.toggle('active', isWeek);
      const mb = document.getElementById('tlEvModeMonth'); if (mb) mb.classList.toggle('active', isMonth);
      const content = document.getElementById('taskText').value;
      tlCalEvents = tlParseEvents(content);
      tlRenderTagBar();
      tlCursorTitle(); // ⚠️ 導航列標題每種模式都要更新（周模式尤其會跨月，不能殘留上次的「X年X月」）
      if (isMonth) tlRenderMonth(content);
      else if (isGrid) tlRenderTimeGrid(isDay ? [tlCalCursor] : tlWeekDays(tlCalCursor));
      else tlRenderList(content);
    }

    // 導航列標題：依模式顯示「月 / 週區間 / 單日」（與 LITE 版 calCursorTitle 同款）
    function tlCursorTitle() {
      const t = document.getElementById('tlEvMonthTitle');
      if (!t) return;
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      if (tlCalMode === 'day') {
        const d = tlCalCursor;
        t.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 週' + WD[d.getDay()];
      } else if (tlCalMode === 'week') {
        const ds = tlWeekDays(tlCalCursor);
        t.textContent = (ds[0].getMonth() + 1) + '/' + ds[0].getDate() + ' – ' + (ds[6].getMonth() + 1) + '/' + ds[6].getDate();
      } else {
        t.textContent = tlCalCursor.getFullYear() + '年' + (tlCalCursor.getMonth() + 1) + '月';
      }
    }

    function tlSetMode(mode) {
      tlCalMode = (mode === 'month') ? 'month' : (mode === 'week') ? 'week' : (mode === 'day') ? 'day' : 'list';
      if (tlCalMode === 'month' && !tlCalSelected) tlCalSelected = tlFmtDate(new Date());
      tlRenderEventsContent();
    }

    // 上/下一期：按当前模式步进（月→月、周→周、日→日）
    function tlCalStepCursor(dir) {
      if (tlCalMode === 'week') tlCalCursor = tlAddDays(tlCalCursor, dir * 7);
      else if (tlCalMode === 'day') tlCalCursor = tlAddDays(tlCalCursor, dir);
      else tlCalCursor = new Date(tlCalCursor.getFullYear(), tlCalCursor.getMonth() + dir, 1);
      if (tlCalMode === 'month' && !tlCalSelected) tlCalSelected = tlFmtDate(tlCalCursor);
      tlRenderEventsContent();
    }

    function tlDateHeader(date, today) {
      const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      let label = '日期未知', week = '';
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        label = (+m[2]) + '月' + (+m[3]) + '日';
        week = WD[d.getDay()];
      }
      const isToday = date === today;
      return '<div class="ev-date' + (isToday ? ' today' : '') + '" data-ev-date="' + tlEscapeHtml(date) + '">' + label +
        (week ? '<span class="ev-week">週' + week + '</span>' : '') +
        (isToday ? '<span class="ev-today-badge">今天</span>' : '') +
        '<button type="button" class="ev-day-add" onclick="tlOpenEventForm(null, \'' + date + '\')">＋ 新增</button></div>';
    }

    function tlItemHtml(ev, today) {
      const multi = tlIsMultiDay(ev);
      const past = ev.date < today && !(multi && ev.endDate >= today);
      let time;
      if (multi) {
        time = ev.allDay
          ? (tlRangeLabel(ev.date, ev.endDate) + ' \u00b7 \u5171' + tlSpanDays(ev.date, ev.endDate) + '\u5929')
          : tlRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
      } else {
        time = ev.allDay ? '\u5168\u5929' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
      }
      const spanBadge = multi ? '<span class="ev-span-badge" title="\u8de8\u5929\u884c\u7a0b">\u2922 \u8de8' + tlSpanDays(ev.date, ev.endDate) + '\u5929</span>' : '';
      return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + (multi ? ' multi' : '') + '">' +
        '<input type="checkbox" class="ev-check" onchange="tlToggleDone(\'' + ev.uid + '\', this.checked)"' +
        (ev.done ? ' checked' : '') + ' title="\u52fe\u9009=\u5df2\u5b8c\u6210\uff0c\u53d6\u6d88\u52fe\u9009=\u672a\u5b8c\u6210">' +
        '<span class="ev-swatch" style="background:' + tlEscapeHtml(ev.color) + '"></span>' +
        '<div class="ev-body">' +
        '<div class="ev-title">' + tlEscapeHtml(ev.title) + spanBadge +
        (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map((t) => '#' + tlEscapeHtml(t)).join(' ') + '</span>' : '') +
        tlEventTodoLinks(ev) +
        '</div>' +
        '<div class="ev-meta">' + tlEscapeHtml(time) + (ev.location ? ' \u00b7 \ud83d\udccd' + tlEscapeHtml(ev.location) : '') + '</div>' +
        (ev.notes ? '<div class="ev-notes">' + tlNotesWithChecks(tlEscapeHtml(ev.notes), ev.uid) + '</div>' : '') +
        '</div>' +
        '<div class="ev-actions">' +
        '<button type="button" onclick="tlOpenEventForm(\'' + ev.uid + '\')">\u7f16\u8f91</button>' +
        '<button type="button" onclick="tlDeleteEvent(\'' + ev.uid + '\')">\u5220\u9664</button>' +
        '</div></div>';
    }

    function tlRenderList(content) {
      const list = document.getElementById('tlEvList');
      if (!list) return;
      tlCalEvents = tlParseEvents(content);
      if (!tlCalEvents.length) {
        list.innerHTML = '<div class="ev-empty">尚未有行程<br><span style="font-size:12px">点右上「＋ 新增行程」，或切回文本编辑直接改 calendar.md</span></div>';
        return;
      }
      const today = tlFmtDate(new Date());
      let html = '', last = null;
      for (const ev of tlSorted(tlCalEvents.filter(tlEventMatchesTag))) {
        if (ev.date !== last) { last = ev.date; html += tlDateHeader(ev.date, today); }
        html += tlItemHtml(ev, today);
      }
      list.innerHTML = html;
      // 自动滚动到今天或最近未来日期的悬浮条
      tlScrollToNearestDate(list);
    }

    // 自动滚动到离今天最近的日期悬浮条（优先今天，其次最近未来日期，最后最后一个）
    function tlScrollToNearestDate(list) {
      if (!list) return;
      const headers = list.querySelectorAll('.ev-date[data-ev-date]');
      if (!headers.length) return;
      const today = tlFmtDate(new Date());
      // 1. 精确匹配今天
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].dataset.evDate === today) { headers[i].scrollIntoView({ block: 'start' }); return; }
      }
      // 2. 找最近未来日期
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].dataset.evDate > today) { headers[i].scrollIntoView({ block: 'start' }); return; }
      }
      // 3. 全是过去日期 → 滚到最后一个
      headers[headers.length - 1].scrollIntoView({ block: 'start' });
    }

    function tlRenderMonth(content) {
      tlCalEvents = tlParseEvents(content);
      const cur = tlCalCursor;
      const y = cur.getFullYear(), m = cur.getMonth();
      const occByDate = {};
      tlCalEvents.filter(tlEventMatchesTag).forEach((ev) => {
        tlEventOccurrences(ev).forEach((o) => { (occByDate[o.date] = occByDate[o.date] || []).push(o); });
      });
      if (!tlCalSelected) tlCalSelected = tlFmtDate(new Date());
      const today = tlFmtDate(new Date());
      const first = new Date(y, m, 1);
      const offset = (first.getDay() + 6) % 7;
      const start = new Date(y, m, 1 - offset);
      let html = ['一', '二', '三', '四', '五', '六', '日'].map((h) => '<div class="ev-mc-head">' + h + '</div>').join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const ds = tlFmtDate(d);
        const out = d.getMonth() !== m;
        const occ = (occByDate[ds] || []).slice().sort(tlOccSort);
        let chips = '';
        for (let j = 0; j < Math.min(3, occ.length); j++) {
          chips += tlSpanChipHtml(occ[j].ev, occ[j].pos, occ[j].idx, occ[j].total);
        }
        if (occ.length > 3) chips += '<div class="ev-more">+' + (occ.length - 3) + '</div>';
        html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === today ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') +
          '" data-date="' + ds + '" onclick="tlSelectDate(\'' + ds + '\')"><span class="ev-daynum">' + d.getDate() + '</span>' + chips + '</div>';
      }
      const grid = document.getElementById('tlEvMonthGrid');
      if (grid) grid.innerHTML = html;
      tlRenderDayList();
    }

    // 月格單擊＝選日；400ms 內連點同一天＝快速新增。
    // ⚠️ 不能用原生 dblclick：單擊會整格重繪 innerHTML，第二次點擊落在新節點上，
    //    瀏覽器視為不同目標，dblclick 事件根本不會派發（實測）——必須手動檢測。
    let tlLastCellClick = { date: null, t: 0 };
    function tlSelectDate(ds) {
      const now = Date.now();
      const isDbl = tlLastCellClick.date === ds && (now - tlLastCellClick.t) < 400;
      tlLastCellClick = isDbl ? { date: null, t: 0 } : { date: ds, t: now };
      tlCalSelected = ds;
      if (isDbl) { tlOpenEventForm(null, ds); return; }
      tlRenderMonth(document.getElementById('taskText').value);
    }

    function tlRenderDayList() {
      const list = document.getElementById('tlEvDayList');
      if (!list) return;
      const ds = tlCalSelected || tlFmtDate(new Date());
      const today = tlFmtDate(new Date());
      const m = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
      const evs = tlSorted(tlCalEvents.filter((e) => (e.date === ds || (e.endDate && ds > e.date && ds <= e.endDate)) && tlEventMatchesTag(e)));
      let html = '<div class="ev-date' + (ds === today ? ' today' : '') + '">' +
        (m ? (+m[2]) + '月' + (+m[3]) + '日' : '日期未知') +
        '<span class="ev-week">週' + WD[d.getDay()] + '</span>' +
        (ds === today ? '<span class="ev-today-badge">今天</span>' : '') +
        '<span class="ev-week">· ' + evs.length + ' 条</span>' +
        '<button type="button" class="ev-day-add" onclick="tlOpenEventForm(null, \'' + ds + '\')">＋ 此日新增</button></div>';
      if (!evs.length) html += '<div class="ev-empty">这一天没有行程</div>';
      else for (const ev of evs) html += tlItemHtml(ev, today);
      list.innerHTML = html;
    }

    // ===== 新增 / 编辑 / 删除（写入 taskText 缓冲） =====
    function tlOpenEventForm(uid, defaultDate, pre) {
      if (!isCalendarMdDoc()) return;
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      tlEvFormUid = null;
      let ev = null;
      if (uid) {
        ev = tlCalEvents.find((x) => x.uid === uid);
        if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
        tlEvFormUid = uid;
      }
      const p = pre || {}; // 🖱 雙擊空白快速新增時的預填：{ allDay, startTime, endTime }
      const today = tlFmtDate(new Date());
      document.getElementById('tlEvFormTitle').textContent = uid ? '编辑行程' : '新增行程';
      document.getElementById('tlEvFTitle').value = ev ? ev.title : '';
      document.getElementById('tlEvFDate').value = ev ? ev.date : (defaultDate || (tlCalMode === 'month' ? tlCalSelected : today) || today);
      document.getElementById('tlEvFEndDate').value = ev ? (ev.endDate || '') : '';
      document.getElementById('tlEvFAllday').checked = ev ? ev.allDay : (p.allDay === true);
      // 完成状态：新增默认未完成（旧文件没有 - done 栏位时解析也是未完成）
      document.getElementById('tlEvFDone').checked = ev ? !!ev.done : false;
      document.getElementById('tlEvFStart').value = ev ? ev.startTime : (p.startTime || '');
      document.getElementById('tlEvFEnd').value = ev ? ev.endTime : (p.endTime || '');
      tlToggleAllDay();
      document.getElementById('tlEvFLocation').value = ev ? ev.location : '';
      tlEvFormColor = ev ? ev.color : TL_CAL_COLORS[0];
      document.getElementById('tlEvFTags').value = ev && ev.tags ? ev.tags.join(', ') : '';
      document.getElementById('tlEvFNotes').value = ev ? ev.notes : '';
      document.getElementById('tlEvFormDelete').style.display = uid ? '' : 'none';
      tlEvFormTodoIds = ev ? (ev.todoIds || []).slice() : [];
      tlRenderEvTodoLinkPanel();
      tlRenderColors();
      document.getElementById('tlEvFormOverlay').style.display = 'flex';
      document.getElementById('tlEvFTitle').focus();
    }

    function tlToggleAllDay() {
      const allDay = document.getElementById('tlEvFAllday').checked;
      document.getElementById('tlEvFStart').disabled = allDay;
      document.getElementById('tlEvFEnd').disabled = allDay;
    }

    function tlRenderColors() {
      const box = document.getElementById('tlEvFColors');
      if (!box) return;
      box.innerHTML = TL_CAL_COLORS.map((c) =>
        '<span class="sw' + (c === tlEvFormColor ? ' selected' : '') + '" data-color="' + c + '" style="background:' + c + '" onclick="tlPickColor(\'' + c + '\')"></span>'
      ).join('');
    }
    function tlPickColor(c) {
      tlEvFormColor = c;
      tlRenderColors();
    }

    function tlCloseEventForm() {
      const ov = document.getElementById('tlEvFormOverlay');
      if (ov) ov.style.display = 'none';
      tlEvFormUid = null;
      tlEvFormColor = null;
    }

    function tlSaveEventForm() {
      const title = document.getElementById('tlEvFTitle').value.trim();
      let date = document.getElementById('tlEvFDate').value;
      let endDate = document.getElementById('tlEvFEndDate').value;
      if (!title) { alert('请输入标题'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('请选择日期'); return; }
      // 跨天：结束日早于起始日则互换；等于起始日视为单日（清空 endDate）
      if (endDate && endDate < date) { const tmp = date; date = endDate; endDate = tmp; }
      if (endDate === date) endDate = '';
      const allDay = document.getElementById('tlEvFAllday').checked;
      const ev = {
        uid: tlEvFormUid || tlGenId(),
        title, date, endDate: endDate || '', allDay,
        done: document.getElementById('tlEvFDone').checked,
        startTime: allDay ? '' : document.getElementById('tlEvFStart').value,
        endTime: allDay ? '' : document.getElementById('tlEvFEnd').value,
        location: document.getElementById('tlEvFLocation').value.trim(),
        color: tlEvFormColor || TL_CAL_COLORS[0],
        tags: document.getElementById('tlEvFTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        notes: document.getElementById('tlEvFNotes').value.replace(/\r\n/g, '\n'),
        todoIds: tlEvFormTodoIds.slice()
      };
      // 以当前编辑内容为准重新解析（保留用户手改过的其它条目），再 upsert
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      const i = tlCalEvents.findIndex((x) => x.uid === ev.uid);
      if (i >= 0) tlCalEvents[i] = ev; else tlCalEvents.push(ev);
      tlApplyEventsToBuffer();
      tlCloseEventForm();
      showToast('已写入编辑内容，按「保存」写回 calendar.md', 'success');
    }

    function tlDeleteEvent(uid) {
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      if (!confirm('确定删除行程「' + ev.title + '」（' + ev.date + '）吗？\n\n写入后按「保存」才会真正写回文件。')) return;
      tlCalEvents = tlCalEvents.filter((x) => x.uid !== uid);
      tlApplyEventsToBuffer();
      showToast('已删除「' + ev.title + '」，按「保存」写回文件', 'success');
    }

    function tlDeleteFromForm() {
      if (!tlEvFormUid) return;
      const uid = tlEvFormUid;
      tlCloseEventForm();
      tlDeleteEvent(uid);
    }

    // 清单上的「完成」勾选框：切换 done → 序列化写回 taskText 缓冲（按「保存」才落盘）
    function tlToggleDone(uid, done) {
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      ev.done = !!done;
      tlApplyEventsToBuffer(); // 内部会重绘行程视图
      showToast(ev.done ? '已标记完成，按「保存」写回 calendar.md' : '已取消完成，按「保存」写回 calendar.md', 'success');
    }

    // 備註裡的 Markdown checkbox 勾選/取消：定位 ev.notes 的對應行，互換 - [ ] ↔ - [x]，序列化寫回 taskText（按「保存」才落盤）
    function tlToggleNoteCheck(e, uid, line) {
      if (e) { e.stopPropagation(); e.preventDefault(); } // 阻止冒泡到 .ev-block 的 onclick 打開編輯表單
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      const lines = String(ev.notes || '').split('\n');
      if (line < 0 || line >= lines.length) return;
      const m = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
      if (!m) return; // 該行已被用戶改得不再是 checkbox，跳過以免破壞原文
      const done = m[2] !== ' ';
      lines[line] = m[1] + '- [' + (done ? ' ' : 'x') + ']' + (m[3] ? ' ' + m[3] : '');
      ev.notes = lines.join('\n');
      tlApplyEventsToBuffer(); // 序列化 + 標髒 + 重繪（多天事件多列自動同步）
      showToast(done ? '已取消勾选，按「保存」写回 calendar.md' : '已勾选，按「保存」写回 calendar.md', 'success');
    }
    function tlCalCheckKey(e, uid, line) {
      if (e && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
        e.preventDefault();
        tlToggleNoteCheck(e, uid, line);
      }
    }

    // 序列化整份 calendar.md 写回 taskText（不动 editSnapshot → 未保存检测自动判定为脏，「保存」亮起）
    function tlApplyEventsToBuffer() {
      const md = tlEventsToMarkdown(tlCalEvents);
      const ta = document.getElementById('taskText');
      ta.value = md;
      if (typeof autoGrowTextarea === 'function') autoGrowTextarea(ta);
      if (typeof markCurrentTabDirty === 'function') markCurrentTabDirty();
      tlRenderEventsContent();
    }

    // 事件绑定（DOM 就绪时执行一次）
    (function bindCalendarEventsUI() {
      const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
      on('tlEvModeList', 'click', () => tlSetMode('list'));
      on('tlEvModeDay', 'click', () => tlSetMode('day'));
      on('tlEvModeWeek', 'click', () => tlSetMode('week'));
      on('tlEvModeMonth', 'click', () => tlSetMode('month'));
      on('tlEvAddBtn', 'click', () => tlOpenEventForm(null));
      on('tlEvPrevMonth', 'click', () => tlCalStepCursor(-1));
      on('tlEvNextMonth', 'click', () => tlCalStepCursor(1));
      on('tlEvTodayBtn', 'click', () => { tlCalCursor = new Date(); tlCalSelected = tlFmtDate(new Date()); tlRenderEventsContent(); });
      // 标签过滤 chips（事件委托）
      const tf = document.getElementById('tlEvTagFilter');
      if (tf) tf.addEventListener('click', (e) => {
        const chip = e.target.closest('.ev-tag-chip');
        if (!chip) return;
        const t = chip.getAttribute('data-tag');
        const i = tlCalTagFilter.indexOf(t);
        if (i >= 0) tlCalTagFilter.splice(i, 1); else tlCalTagFilter.push(t);
        tlRenderEventsContent();
      });
      // 关联 Todo 卡片面板
      const tlp = document.getElementById('tlEvTodoLinkPanel');
      if (tlp) {
        tlp.addEventListener('dblclick', () => tlEvToggleTodoDropdown());
        tlp.addEventListener('keydown', (e) => { if (e.key === '?' || e.key === '/') { e.preventDefault(); tlEvToggleTodoDropdown(); } });
        tlp.addEventListener('click', (e) => {
          const x = e.target.closest('.ev-todo-chip-x');
          if (x) { tlEvRemoveTodoLink(x.getAttribute('data-id')); return; }
          tlEvToggleTodoDropdown();
        });
      }
      const tld = document.getElementById('tlEvTodoDropdown');
      if (tld) tld.addEventListener('click', (e) => {
        const item = e.target.closest('.ev-todo-dropdown-item');
        if (item) tlEvAddTodoLink(item.getAttribute('data-id'));
      });
      const ov = document.getElementById('tlEvFormOverlay');
      if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) tlCloseEventForm(); });
      // 🖱 雙擊空白處快速新增：時間網格＝日期+時間（15 分鐘取整，默認 1 小時）、全天條＝日期(全天)、月格＝僅日期
      function tlGridDblClickNew(e) {
        if (e.target.closest('.ev-block') || e.target.closest('button')) return; // 點在已有行程上不新增
        const col = e.target.closest('.ev-tg-col[data-date]');
        if (col) {
          const rect = col.getBoundingClientRect();
          if (rect.height <= 0) return;
          const mins = Math.max(0, Math.min(23 * 60, Math.floor((e.clientY - rect.top) / rect.height * 24 * 60 / 15) * 15));
          const pad = (x) => String(x).padStart(2, '0');
          const endM = mins + 60;
          tlOpenEventForm(null, col.getAttribute('data-date'), {
            allDay: false,
            startTime: pad(Math.floor(mins / 60)) + ':' + pad(mins % 60),
            endTime: endM >= 24 * 60 ? '' : pad(Math.floor(endM / 60)) + ':' + pad(endM % 60),
          });
          return;
        }
        const ad = e.target.closest('.ev-allday-col[data-date]');
        if (ad) tlOpenEventForm(null, ad.getAttribute('data-date'), { allDay: true });
      }
      // 月模式不走原生 dblclick（單擊重繪導致 dblclick 不派發，見 tlSelectDate 內手動檢測）
      on('tlEvWeekWrap', 'dblclick', tlGridDblClickNew);
    })();
