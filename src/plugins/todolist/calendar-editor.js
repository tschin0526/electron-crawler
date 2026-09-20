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
    let tlCalMode = 'month';
    let tlCalCursor = new Date();
    let tlCalSelected = null;
    let tlListSel = null;    // 列表模式：< > / 「今天」导航到的「选中日」（金色描边）
    // 下方明细显示范围：'day'=选定日单日（默认）/ 'full'=整月（月模式）或整周（周模式）。
    // 仅内存态，不持久化——用户约定「默认以日显示」。
    let tlCalScope = 'day';
    let tlCalEvents = [];
    let tlCalHolidays = [];    // ## HOLIDAY 解析結果（与 ## EVENT 同结构，多 holidayType 字段）；仅列表/日志视图显示，不进时间网格/月格 chip
    let tlCalTagFilter = [];   // 标签过滤（空＝全部；OR 逻辑：事件 tags 命中任一即显示）
    let tlCalRegionFilter = ['cn'];   // ## HOLIDAY 地区过滤（图例 checkbox 勾选；默认只显示大陆 cn；只影响显示，不改数据）
    let tlEvFormTodoIds = [];   // 表单内「关联 Todo 卡片」临时列表（仅编辑期，不污染存档对象）
    let tlEvFormUid = null;
    let tlEvFormColor = null;
    let tlEvFormTags = [];
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

    // 资料感知编辑器分派：文件成为「当前」时，若有专属编辑器（calendar.md → 行程视图）优先启用；
    // 否则回退默认编辑器（照旧）。
    // ⚠️ 只在「打开/切换文件」入口（openEditMdModal / openExternalFile）调用；这些入口都由用户动作触发
    //    （点文件列表项、点底部 Sheet 页签、edit: 链接），所以「用户每次打开 calendar.md 都应重新进入行程视图」。
    //    绝不能用「上次已分派的文件 key」去跳过——否则用户手动退出行程视图后再次选中 calendar.md，
    //    会因 key 相同被跳过而退化成文本编辑器（实测 bug）。而用户手动关闭行程视图不会再次触发这些入口，
    //    因此无需任何守卫来「保留其关闭状态」。
    function tlPrioritizeDedicatedEditor() {
      if (isCalendarMdDoc()) {
        // ⚠️ 必须「无条件」重新进入行程视图，不能写成 `if (!calEventsView) setCalEventsView(true)`：
        //    openExternalFile 的 md 分支在派发前会把 #taskText 重新显示出来（textarea.style.display=''，见 L12707），
        //    若此刻 calEventsView 已为 true 而跳过 → showCalEventsPaneOnly() 不执行 → 文字编辑器与行程面板
        //    「同时」占据 flex 版面（textarea flex:1 抢走绝大部分高度，行程只剩底部一条）。
        //    用户实测：进入系统后第二次打开 calendar.md 就会这样；切走再切回（会把 calEventsView 置 false）反而正常。
        //    setCalEventsView(true) 幂等：重跑 showCalEventsPaneOnly()（重新隐藏文字编辑器）+ 重渲染行程内容；
        //    内容来自 #taskText 实时缓冲，不会丢编辑。
        setCalEventsView(true);
      } else if (calEventsView) {
        setCalEventsView(false);
      }
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
        // ⚠️ 必须非贪婪：曾用 /```([\s\S]*)```/ 贪婪匹配到块尾最后一个 ``` → 备注会吞掉紧随其后的 ## HOLIDAY 原文
        const m = block.slice(ri + '- Remark:'.length).match(/```([\s\S]*?)```/);
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
        // ## HOLIDAY 比 ## EVENT 多一个 holidayType 字段（workday/holiday/festival），事件解析为空字符串即可
        holidayType: get('holidayType') || '',
        // 地区：cn 中国大陆 / hk 香港 / tw 台湾（可扩展）；缺省 '' 渲染时回退 cn（向后兼容旧数据）
        region: get('region') || '',
        notes: remark
      };
    }
    function tlParseEvents(md) {
      if (!md) return [];
      const out = [];
      const blocks = String(md).split(/^##[ \t]*EVENT[ \t]*$/m);
      for (let i = 0; i < blocks.length; i++) {
        // ⚠️ 切块只按 ## EVENT → 本块尾巴会粘着紧随其后的 ## HOLIDAY 块。
        //    必须先在该标记处截断，否则 remark / holidayType / region 等会被后面的假日块污染（2026-09-19 用户反馈）
        const cut = blocks[i].search(/^##[ \t]*HOLIDAY[ \t]*$/m);
        const ev = tlParseBlock(cut >= 0 ? blocks[i].slice(0, cut) : blocks[i], i);
        if (ev) out.push(ev);
      }
      return out;
    }
    // ## HOLIDAY：与 ## EVENT 同一套字段（多 holidayType），仅分割符不同；复用 tlParseBlock 解析（无 title 的块会被跳过）
    // ⚠️ 必须从 i=1 开始：split 后 blocks[0] 是「第一个 ## HOLIDAY 之前的所有内容」（通常含 ## EVENT 块），
    //    那段里的 - title 会被误当成 holiday；holiday 必然跟在它自己的 ## HOLIDAY 标记之后，故跳过 blocks[0] 即正确。
    function tlParseHolidays(md) {
      if (!md) return [];
      const out = [];
      const blocks = String(md).split(/^##[ \t]*HOLIDAY[ \t]*$/m);
      for (let i = 1; i < blocks.length; i++) {
        // 同理：假日块尾巴可能粘着后面的 ## EVENT 块 → 先在该标记处截断
        const cut = blocks[i].search(/^##[ \t]*EVENT[ \t]*$/m);
        const h = tlParseBlock(cut >= 0 ? blocks[i].slice(0, cut) : blocks[i], i);
        if (h) out.push(h);
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
    // ## HOLIDAY 序列化：字段顺序与用户实际写法对齐（在 todoIds 后多 holidayType，再 Remark），保证保存后 diff 干净
    function tlHolidayToMarkdown(h) {
      const tagsJson = JSON.stringify(Array.isArray(h.tags) ? h.tags : []);
      const todoJson = JSON.stringify(Array.isArray(h.todoIds) ? h.todoIds : []);
      const color = '"' + String(h.color || '').replace(/^"|"$/g, '') + '"';
      let s = '## HOLIDAY \n';
      s += '- title: `' + tlMdEscape(h.title) + '`\n';
      s += '- date: `' + tlMdEscape(h.date) + '`\n';
      if (h.endDate && h.endDate !== h.date) s += '- endDate: `' + tlMdEscape(h.endDate) + '`\n';
      s += '- allDay: `' + (h.allDay ? 'true' : 'false') + '`\n';
      s += '- done: `' + (h.done ? 'true' : 'false') + '`\n';
      s += '- startTime: `' + tlMdEscape(h.startTime) + '`\n';
      s += '- endTime: `' + tlMdEscape(h.endTime) + '`\n';
      s += '- location: `' + tlMdEscape(h.location) + '`\n';
      s += '- color: `' + color + '`\n';
      s += '- tags: `' + tagsJson + '`\n';
      s += '- todoIds: `' + todoJson + '`\n';
      s += '- holidayType: `' + tlMdEscape(h.holidayType || '') + '`\n';
      s += '- region: `' + tlMdEscape(h.region || 'cn') + '`\n';
      s += '- Remark:\n```\n' + String(h.notes || '') + '\n```\n';
      return s;
    }
    // 整份 calendar.md 序列化：events + holidays 都保留（保存事件时若只写 events 会把用户手写的 ## HOLIDAY 整体覆盖掉）
    function tlCalendarToMarkdown(events, holidays) {
      const head = '# 日历行程\n\n> 每条行程以 `## EVENT` 分隔，字段值写在反引号内，Remark 用代码块保存多行备注。\n\n';
      let body = (events && events.length) ? events.map(tlEventToMarkdown).join('\n') : '';
      if (holidays && holidays.length) {
        body += (body ? '\n' : '') + holidays.map(tlHolidayToMarkdown).join('\n');
      }
      return head + (body || '');
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
    // ⚠️ 必须含「日」：曾漏掉 (+m[3]) → 跨天行程/假日区间显示成「2026/9 – 2026/9」（看不出是哪天）。与 LITE calMdShort 对齐。
    function tlMdShort(d) { const m = String(d || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? (+m[1]) + '/' + (+m[2]) + '/' + (+m[3]) : (d || ''); }
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
        return '<div class="ev-chip' + (ev.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')"><span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>' + (ev.done ? '\u2713 ' : '') + tlEscapeHtml(ev.title) + links + '</div>';
      }
      const cls = 'ev-chip span ' + pos + (ev.done ? ' done' : '');
      const dot = '<span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>';
      const titlePart = (ev.done ? '\u2713 ' : '') + tlEscapeHtml(ev.title) + tlSpanSuffix(idx, total) + links;
      // 每一段（start/middle/end）都顯示「標題 k/N」——空色條看不出是哪條行程的延續
      const inner = (pos === 'start' ? dot : '') + titlePart;
      return '<div class="' + cls + '" data-uid="' + tlEscapeHtml(ev.uid) + '" style="--ev-color:' + tlEscapeHtml(ev.color) + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')">' + inner + '</div>';
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
      const options = document.getElementById('tl-ev-tag-options');
      if (options) options.innerHTML = Array.from(tags).sort().map((t) => '<option value="' + tlEscapeHtml(t) + '"></option>').join('');
      if (!tags.size) { bar.style.display = 'none'; filter.innerHTML = ''; return; }
      bar.style.display = '';
      filter.innerHTML = Array.from(tags).map((t) => {
        const active = tlCalTagFilter.indexOf(t) >= 0;
        return '<span class="ev-tag-chip' + (active ? ' active' : '') + '" data-tag="' + tlEscapeHtml(t) + '">' + tlEscapeHtml(t) + '</span>';
      }).join('');
    }
    function tlFormTagNames() {
      const tags = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (t) tags.add(t); }));
      return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    }
    function tlRenderTagPicker() {
      const picker = document.getElementById('tl-ev-tag-picker');
      const selected = document.getElementById('tl-ev-tag-selected');
      const menu = document.getElementById('tl-ev-tag-menu');
      const input = document.getElementById('tlEvFTags');
      if (!picker || !selected || !menu || !input) return;
      selected.innerHTML = tlEvFormTags.map((t) => '<span class="tl-ev-tag-selected-chip">' + tlEscapeHtml(t) + '<button type="button" data-tl-ev-tag-remove="' + tlEscapeHtml(t) + '" aria-label="删除标签">×</button></span>').join('');
      const query = input.value.trim().toLowerCase();
      const names = tlFormTagNames().filter((t) => !query || t.toLowerCase().includes(query));
      menu.innerHTML = names.length ? names.map((t) => '<button type="button" class="tl-ev-tag-option' + (tlEvFormTags.indexOf(t) >= 0 ? ' selected' : '') + '" data-tl-ev-tag-option="' + tlEscapeHtml(t) + '">' + (tlEvFormTags.indexOf(t) >= 0 ? '✓ ' : '') + tlEscapeHtml(t) + '</button>').join('') : '<div class="tl-ev-tag-option">暂无可选标签</div>';
    }
    function tlAddFormTag(value) {
      String(value || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean).forEach((t) => { if (tlEvFormTags.indexOf(t) < 0) tlEvFormTags.push(t); });
      document.getElementById('tlEvFTags').value = '';
      tlRenderTagPicker();
    }
    function tlRemoveFormTag(tag) {
      tlEvFormTags = tlEvFormTags.filter((t) => t !== tag);
      tlRenderTagPicker();
    }
    function tlToggleFormTag(tag) {
      if (tlEvFormTags.indexOf(tag) >= 0) tlRemoveFormTag(tag); else tlAddFormTag(tag);
    }
    function tlRenderTagOptions() {
      const options = document.getElementById('tl-ev-tag-options');
      if (!options) return;
      const tags = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (t) tags.add(t); }));
      options.innerHTML = Array.from(tags).sort().map((t) => '<option value="' + tlEscapeHtml(t) + '"></option>').join('');
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
        html += '<div class="ev-tg-head-cell' + (ds === todayStr ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') + '" data-date="' + ds + '" onclick="tlSelectWeekDay(\'' + ds + '\')">' +
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
      // ## HOLIDAY：日/週时间网格顶部「假期」条（与 EVENT 全天条视觉区隔：type 色块）
      const holByCol = dayDates.map((d) => tlHolidaysOnDay(tlFmtDate(d)));
      const hasHoliday = holByCol.some((arr) => arr.length > 0);
      if (hasHoliday) {
        html += '<div class="ev-holiday-strip" style="--cols:' + n + '"><div class="label">假期</div>';
        holByCol.forEach((arr, ci) => {
          html += '<div class="ev-holiday-col" data-date="' + tlFmtDate(dayDates[ci]) + '">';
          arr.forEach((h) => {
            const region = tlHolidayRegionMeta(h.region);
            html += '<div class="ev-holiday-block" style="--holiday-color:' + tlEscapeHtml(region.color) + '" title="' + tlEscapeHtml(h.title) + '">' + region.icon + ' ' + tlEscapeHtml(h.title) + '</div>';
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
      // 上下可拖动分割：时间网格（.ev-split-top）自动占余量，行程明细（.ev-detail）高度由 --ev-detail-h 决定
      wrap.innerHTML = '<div class="ev-timegrid-col ev-split-top">' + html + '</div>' +
        '<div class="ev-hsplit" id="tlEvWeekSplit" title="拖动调整下方行程明细高度（双击复位）"></div>' +
        '<div id="tlEvDayGridList" class="events-list ev-detail"></div>';
      tlBindSplit(wrap, document.getElementById('tlEvWeekSplit'));
      tlRenderDayGridList();
      requestAnimationFrame(() => {
        const sc = wrap.querySelector('.ev-timegrid-scroll');
        if (sc) sc.scrollTop = Math.max(0, now.getHours() * hourH + now.getMinutes() - 120);
      });
    }
    // 日/週时间网格下方明细：日模式显示游标那天、週模式显示当周每天（仅含内容者），
    // 与列表模式一致——每天先假日（.ev-holiday）后行程（.ev-item），保证假日必定可见。
    // 日/週网格下方明细「所顯示的那一天」：日模式＝游标当天；週模式＝选定日（须在当週内），否则今天（若在当週）否则週一
    function tlGridSelectedDay() {
      if (tlCalMode === 'day') return tlFmtDate(tlCalCursor);
      const week = tlWeekDays(tlCalCursor).map(tlFmtDate);
      const today = tlFmtDate(new Date());
      return (tlCalSelected && week.indexOf(tlCalSelected) >= 0) ? tlCalSelected
           : (week.indexOf(today) >= 0 ? today : week[0]);
    }
    function tlRenderDayGridList() {
      const list = document.getElementById('tlEvDayGridList');
      if (!list) return;
      const isDay = tlCalMode === 'day';
      const today = tlFmtDate(new Date());
      const toggle = tlScopeToggleHtml();
      let html = '';
      // 整週（週模式切到「週」）：遍历当周 7 天，跳过无内容日（与列表模式一致）
      if (tlCalScope === 'full' && !isDay) {
        let any = false;
        const sel = tlGridSelectedDay();
        for (const d of tlWeekDays(tlCalCursor)) {
          const ds = tlFmtDate(d);
          const dayItems = tlDayItems(ds);
          const evs = tlSorted(dayItems.events);
          const hols = dayItems.holidays;
          if (!evs.length && !hols.length) continue;
          // toggle 内联进每个日期标题条，随 sticky 一直可见（无需滚回週首）
          let g = tlDateHeader(ds, today, toggle, evs.length + hols.length);
          any = true;
          for (const h of hols) g += tlHolidayHtml(h, today);
          for (const ev of evs) g += tlItemHtml(ev, today);
          html += (ds === sel) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
        }
        if (!any) html += '<div class="ev-scope-row">' + toggle + '</div><div class="ev-empty">本周没有行程</div>';
        list.innerHTML = html;
        list.classList.add('scope-follow');
        tlBindActiveDateScroll(list);
        // 整週：滚动到「选定日」的日期条（该日无内容则回退到最近的一天）；列表自身即滚动容器
        tlScrollListToDate(list, list, tlGridSelectedDay());
        tlUpdateActiveDate(list);
        return;
      }
      // 单日（默认）：週模式=「选定日」、日模式=游标当天；空日也显示日期标题 + 空提示
      const ds = tlGridSelectedDay();
      const dayItems = tlDayItems(ds);
      const evs = tlSorted(dayItems.events);
      const hols = dayItems.holidays;
      html += tlDateHeader(ds, today, toggle, evs.length + hols.length);
      if (!evs.length && !hols.length) {
        html += '<div class="ev-empty">这一天没有行程</div>';
      } else {
        for (const h of hols) html += tlHolidayHtml(h, today);
        for (const ev of evs) html += tlItemHtml(ev, today);
      }
      list.innerHTML = html;
      list.classList.remove('scope-follow');
      tlScrollListToDate(list, list, ds);   // 日/週单日明细：滚到该日日期条（列表自身即滚动容器）
    }
    // 日/週视图：点日期标题切换「下方明细」显示的那一天（与月模式「选中日」、日模式「游标日」一致，均只显示单日）
    function tlSelectWeekDay(ds) {
      tlCalSelected = ds;
      if (tlCalMode === 'week') tlRenderTimeGrid(tlWeekDays(tlCalCursor));
      else if (tlCalMode === 'day') tlRenderTimeGrid([tlCalCursor]);
    }
    // 明细范围切换（日 <-> 月/週）：月模式切「整月」、週模式切「整週」；日模式无意义不显示。默认「日」。
    function tlScopeToggleHtml() {
      if (tlCalMode !== 'month' && tlCalMode !== 'week') return '';
      const isFull = tlCalScope === 'full';
      const fullLabel = tlCalMode === 'month' ? '月' : '週';
      return '<span class="ev-scope-seg" role="group" title="切换下方明细显示范围">' +
        '<button type="button" class="' + (!isFull ? 'active' : '') + '" onclick="tlSetCalScope(\'day\')">日</button>' +
        '<button type="button" class="' + (isFull ? 'active' : '') + '" onclick="tlSetCalScope(\'full\')">' + fullLabel + '</button>' +
        '</span>';
    }
    function tlSetCalScope(s) {
      tlCalScope = (s === 'full') ? 'full' : 'day';
      if (tlCalMode === 'month') tlRenderMonth(document.getElementById('taskText').value);
      else if (tlCalMode === 'week') tlRenderTimeGrid(tlWeekDays(tlCalCursor));
      else if (tlCalMode === 'day') tlRenderTimeGrid([tlCalCursor]);
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
      const isList = mode === 'list';
      setDisp('tlEvMonthNav', (isMonth || isGrid || isList) ? '' : 'none');
      setDisp('tlEvMonthWrap', isMonth ? '' : 'none');
      setDisp('tlEvWeekWrap', isGrid ? '' : 'none');
      setDisp('tlEvList', mode === 'list' ? '' : 'none');
      setDisp('tlEvDayGridList', isGrid ? '' : 'none');   // 日/週时间网格下方的「当日/当周明细」列表（含假日）
      const lb = document.getElementById('tlEvModeList'); if (lb) lb.classList.toggle('active', mode === 'list');
      const db = document.getElementById('tlEvModeDay'); if (db) db.classList.toggle('active', isDay);
      const wb = document.getElementById('tlEvModeWeek'); if (wb) wb.classList.toggle('active', isWeek);
      const mb = document.getElementById('tlEvModeMonth'); if (mb) mb.classList.toggle('active', isMonth);
      const content = document.getElementById('taskText').value;
      tlCalEvents = tlParseEvents(content);
      tlCalHolidays = tlParseHolidays(content);
      tlRenderTagBar();
      tlRenderHolidayLegend(); // 动态图例：列出 calendar.md 中出现过的地区，辅助「目视差别」
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
      } else if (tlCalMode === 'list') {
        t.textContent = '';
      } else {
        t.textContent = tlCalCursor.getFullYear() + '年' + (tlCalCursor.getMonth() + 1) + '月';
      }
    }

    // 地区图例：列出当前 calendar.md 出现过的地区（去重），无假日则隐藏。颜色/图标与渲染一致，零学习成本。
    function tlRenderHolidayLegend() {
      const el = document.getElementById('tlEvHolidayLegend');
      if (!el) return;
      if (!tlCalHolidays || !tlCalHolidays.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
      const seen = {};
      const items = [];
      for (const h of tlCalHolidays) {
        const r = (h.region || 'cn').toLowerCase();
        if (seen[r]) continue;
        seen[r] = true;
        const m = tlHolidayRegionMeta(r);
        const on = tlCalRegionFilter.indexOf(r) >= 0;
        items.push('<label class="ev-legend-item' + (on ? '' : ' off') + '" title="勾选显示 / 取消勾选隐藏该地区假日">' +
          '<input type="checkbox" ' + (on ? 'checked' : '') + ' style="accent-color:' + tlEscapeHtml(m.color) + '" onchange="tlSetRegionChecked(\'' + r + '\', this.checked)">' +
          '<span class="ev-legend-dot" style="background:' + tlEscapeHtml(m.color) + '"></span>' + m.icon + tlEscapeHtml(m.label) + '</label>');
      }
      if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
      el.style.display = '';
      el.innerHTML = '<span class="ev-legend-label">地区:</span>' + items.join('');
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

    // ⏳ 倒計時標籤：今天 / N天后 / N天前（日期字符串安全運算，不受時區/夏令時影響）
    function tlCountdownLabel(date, today) {
      const p = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
      const a = p(date), b = p(today);
      if (!a || !b) return '';
      const diff = Math.round((a - b) / 86400000);
      if (diff === 0) return '今天';
      return diff > 0 ? diff + '天后' : (-diff) + '天前';
    }

    function tlDateHeader(date, today, extra, count) {
      const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      let label = '日期未知', week = '';
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        label = (+m[2]) + '月' + (+m[3]) + '日';
        week = WD[d.getDay()];
      }
      const isToday = date === today;
      const cd = tlCountdownLabel(date, today);
      const cp = tlLunarCompact(date);
      const lunarHdr = cp.lunarText ? '農曆 ' + cp.lunarText + (cp.jieqi ? ' · ' + cp.jieqi : '') : (cp.jieqi || '');
      return '<div class="ev-date' + (isToday ? ' today' : '') + '" data-ev-date="' + tlEscapeHtml(date) + '">' + label +
        (week ? '<span class="ev-week">週' + week + '</span>' : '') +
        // ⏳ 倒計時徽章：每天必顯示（今天＝高亮，其餘＝灰底），取代原先「僅今天顯示」
        (cd ? '<span class="ev-today-badge' + (isToday ? '' : ' dim') + '">' + cd + '</span>' : '') +
        // 当天条数（与「日」范围单日标题的「· N 条」一致；列表/整月/整週分组标题都显示）
        (typeof count === 'number' ? '<span class="ev-week">· ' + count + ' 条</span>' : '') +
        (lunarHdr ? '<span class="ev-lunar hdr" onclick="tlShowAlmanac(\'' + date + '\',this)" title="農民曆 / 老黃曆">' + tlEscapeHtml(lunarHdr) + '</span>' : '') +
        (extra || '') +
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
      return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + (multi ? ' multi' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '">' +
        '<input type="checkbox" class="ev-check" onchange="tlToggleDone(\'' + ev.uid + '\', this.checked)"' +
        (ev.done ? ' checked' : '') + ' title="\u52fe\u9009=\u5df2\u5b8c\u6210\uff0c\u53d6\u6d88\u52fe\u9009=\u672a\u5b8c\u6210">' +
        '<span class="ev-swatch" style="background:' + tlEscapeHtml(ev.color) + '"></span>' +
        '<div class="ev-body">' +
        '<div class="ev-title">' + tlEscapeHtml(ev.title) + spanBadge +
        (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map((t) => '<span class="ev-tag-view">#' + tlEscapeHtml(t) + '</span>').join('') + '</span>' : '') +
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

    // ===== ## HOLIDAY 辅助（日志/列表视图显示，与 EVENT 视觉区隔：左侧 type 色条＋类型徽章，无勾选框/编辑删除）=====
    // 地区调色板：决定假日「目视差别」的主色（与类型徽章正交）。可扩展：直接往此表加一项即可（如 kr 韩国 #003478 / jp 日本 #E60012）。
    // 缺省 cn：旧数据无 region 字段时回退中国大陆；非空但未知的地区→中性灰＋原始代号（不静默当大陆，避免误判）。
    const TL_HOLIDAY_REGIONS = {
      cn: { label: '大陆', icon: '<span class="ev-region-icon ev-region-cn" aria-label="中国大陆旗帜"></span>', color: '#E4002B' },
      hk: { label: '港',   icon: '<span class="ev-region-icon ev-region-hk" aria-label="香港旗帜"></span>', color: '#7B2FBE' },
      tw: { label: '台',   icon: '<span class="ev-region-icon ev-region-tw" aria-label="台湾旗帜"></span>', color: '#00A3A3' },
      us: { label: '美',   icon: '<span class="ev-region-icon ev-region-us" aria-label="美国旗帜"></span>', color: '#1F4E79' },
    };
    function tlHolidayRegionMeta(region) {
      const r = (region || '').toLowerCase();
      if (!r) return TL_HOLIDAY_REGIONS.cn;
      if (TL_HOLIDAY_REGIONS[r]) return TL_HOLIDAY_REGIONS[r];
      return { label: r.toUpperCase(), icon: '🌐', color: '#6B7280' };
    }
    function tlHolidayMeta(type) {
      switch ((type || '').toLowerCase()) {
        case 'workday': return { label: '补班', icon: '💼', color: '#FF9500' };
        case 'holiday': return { label: '假日', icon: '🎉', color: '#34C759' };
        case 'festival': return { label: '节日', icon: '🏮', color: '#FF3B30' };
        default: return { label: '假日', icon: '🎌', color: '#FF9500' };
      }
    }
    // 取某天出现的假日（含跨天展开）：dateStr 落在 [date, endDate] 区间内即命中
    // ## HOLIDAY 地区过滤：图例 checkbox 勾选要显示的地区（默认只勾大陆 cn）
    function tlRegionVisible(h) {
      return tlCalRegionFilter.indexOf((h.region || 'cn').toLowerCase()) >= 0;
    }
    // 只保留「勾选地区」的假日（供按日期分组 / 空态判断使用，避免绕过地区过滤）
    function tlVisibleHolidays() {
      return (tlCalHolidays || []).filter(tlRegionVisible);
    }
    function tlSetRegionChecked(code, on) {
      const r = (code || '').toLowerCase();
      if (!r) return;
      const i = tlCalRegionFilter.indexOf(r);
      if (on && i < 0) tlCalRegionFilter.push(r);
      else if (!on && i >= 0) tlCalRegionFilter.splice(i, 1);
      // ⚠️ 与 tlSetCalScope 同款：按当前模式「直接」重渲染（勿走 tlRenderEventsContent —— 它开头有宿主守卫
      //    if (!calEventsView) return，勾选图例时会被拦下导致画面不刷新），并同步刷新图例勾选态
      const content = document.getElementById('taskText').value;
      if (tlCalMode === 'month') tlRenderMonth(content);
      else if (tlCalMode === 'week') tlRenderTimeGrid(tlWeekDays(tlCalCursor));
      else if (tlCalMode === 'day') tlRenderTimeGrid([tlCalCursor]);
      else tlRenderList(content);
      tlRenderHolidayLegend();
    }
    function tlHolidaysOnDay(dateStr) {
      if (!tlCalHolidays || !tlCalHolidays.length) return [];
      return tlCalHolidays.filter((h) => {
        const end = (h.endDate && h.endDate !== h.date) ? h.endDate : h.date;
        return tlRegionVisible(h) && dateStr >= h.date && dateStr <= end;
      });
    }
    // 🗓 依日期分組的「唯一入口」：跨天行程/假日一律「逐日展開」——在涵蓋的每一天都出現，
    //    與「日」範圍同口徑。（修復：by月/列表先前只認起始日 → 同一天 by日 4 條、by月 3 條）
    //    dateOk(ds) 可選：只收符合條件的日期（如「整月」只收游標月）。
    function tlEventsByDate(events, dateOk) {
      const byDate = new Map();
      const add = (ds, key, item) => {
        if (!ds || (dateOk && !dateOk(ds))) return;
        if (!byDate.has(ds)) byDate.set(ds, { events: [], holidays: [] });
        byDate.get(ds)[key].push(item);
      };
      (events || []).forEach((ev) => { tlEventOccurrences(ev).forEach((o) => add(o.date, 'events', ev)); });
      tlVisibleHolidays().forEach((h) => {
        const s = new Date(h.date + 'T00:00:00');
        const en = new Date(((h.endDate && h.endDate !== h.date) ? h.endDate : h.date) + 'T00:00:00');
        if (isNaN(s) || isNaN(en) || en < s) { add(h.date, 'holidays', h); return; }
        for (const cur = new Date(s); cur <= en; cur.setDate(cur.getDate() + 1)) add(tlFmtDate(cur), 'holidays', h);
      });
      return byDate;
    }
    // 某日明细的「唯一取数入口」（日/週/月三处明细都用它）→ 与列表/整月同口径，不会再分叉
    function tlDayItems(ds) {
      return tlEventsByDate(tlCalEvents.filter(tlEventMatchesTag), (d) => d === ds).get(ds) || { events: [], holidays: [] };
    }
    function tlHolidayHtml(h, today) {
      const meta = tlHolidayMeta(h.holidayType);
      const region = tlHolidayRegionMeta(h.region);
      const accent = region.color; // 假日主色＝地区色（地区为目视差别唯一来源；color 字段不参与假日着色）
      const multi = h.endDate && h.endDate !== h.date;
      const time = multi
        ? (tlMdShort(h.date) + ' – ' + tlMdShort(h.endDate) + ' · 共' + tlSpanDays(h.date, h.endDate) + '天')
        : '全天';
      const tags = (h.tags && h.tags.length) ? '<span class="ev-tags">' + h.tags.map((t) => '<span class="ev-tag-view">#' + tlEscapeHtml(t) + '</span>').join('') + '</span>' : '';
      return '<div class="ev-holiday" data-ev-holiday="' + tlEscapeHtml(h.uid) + '" style="--holiday-color:' + tlEscapeHtml(accent) + '">' +
        '<span class="ev-holiday-region" style="--region-color:' + tlEscapeHtml(region.color) + '" title="' + tlEscapeHtml(region.label + '地区假日') + '">' + region.icon + tlEscapeHtml(region.label) + '</span>' +
        '<span class="ev-holiday-badge">' + meta.icon + ' ' + tlEscapeHtml(meta.label) + '</span>' +
        '<div class="ev-body">' +
        '<div class="ev-title">' + tlEscapeHtml(h.title) + tags + '</div>' +
        '<div class="ev-meta">' + tlEscapeHtml(time) + (h.location ? ' · 📍' + tlEscapeHtml(h.location) : '') + '</div>' +
        (h.notes ? '<div class="ev-notes">' + tlEscapeHtml(h.notes) + '</div>' : '') +
        '</div></div>';
    }

    function tlRenderList(content) {
      const list = document.getElementById('tlEvList');
      if (!list) return;
      tlCalEvents = tlParseEvents(content);
      tlCalHolidays = tlParseHolidays(content);
      if (!tlCalEvents.length && !tlVisibleHolidays().length) {
        list.innerHTML = '<div class="ev-empty">尚未有行程<br><span style="font-size:12px">点右上「＋ 新增行程」，或切回文本编辑直接改 calendar.md</span></div>';
        return;
      }
      const today = tlFmtDate(new Date());
      // 按日期分组（跨天行程/假日逐日展开，与「日」范围同口径）：每天先显示该日假日，再显示行程
      const byDate = tlEventsByDate(tlCalEvents.filter(tlEventMatchesTag));
      const dates = Array.from(byDate.keys()).sort();
      // 选中日：< > / 「今天」导航到的锚点日（默认今天；今天无行程则回退最近未来日期，最后回退末尾）
      let sel = tlListSel || today;
      if (dates.indexOf(sel) < 0) sel = dates.find((d) => d > today) || dates[dates.length - 1] || today;
      if (dates.length) tlListSel = sel;
      let html = '';
      for (const ds of dates) {
        const grp = byDate.get(ds);
        let g = tlDateHeader(ds, today, '', grp.events.length + grp.holidays.length);
        for (const h of grp.holidays) g += tlHolidayHtml(h, today);
        for (const ev of tlSorted(grp.events)) g += tlItemHtml(ev, today);
        html += (ds === sel) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
      }
      list.innerHTML = html;
      // 滚动到选中的锚点日（今天，或 < > 导航到的日期）
      tlScrollListToDate(list, list, sel);
    }

    // 自动滚动到离今天最近的日期悬浮条（优先今天，其次最近未来日期，最后最后一个）
    // ⚠️ 用 tlScrollElToTop 而不是 scrollIntoView：`.ev-date` 吸顶后 rect 是「位移后」的位置，
    //    scrollIntoView 会误判「已在视口内」而不滚（与 2026-09-19 那个单向滚动 bug 同源）。
    function tlScrollToNearestDate(list) {
      if (!list) return;
      const headers = list.querySelectorAll('.ev-date[data-ev-date]');
      if (!headers.length) return;
      const today = tlFmtDate(new Date());
      let pick = null;
      // 1. 精确匹配今天
      for (let i = 0; i < headers.length; i++) if (headers[i].dataset.evDate === today) { pick = headers[i]; break; }
      // 2. 找最近未来日期
      if (!pick) for (let i = 0; i < headers.length; i++) if (headers[i].dataset.evDate > today) { pick = headers[i]; break; }
      // 3. 全是过去日期 → 滚到最后一个
      if (!pick) pick = headers[headers.length - 1];
      tlScrollElToTop(pick, list);
    }

    // 列表模式：< > 逐日移动「选中日」（金色描边随其移动）并滚动到该日
    function tlListNavDay(dir) {
      const list = document.getElementById('tlEvList');
      if (!list) return;
      const dates = Array.from(list.querySelectorAll('.ev-date[data-ev-date]')).map((h) => h.dataset.evDate);
      if (!dates.length) return;
      let idx = dates.indexOf(tlListSel);
      if (idx < 0) idx = 0;
      const target = idx + dir;
      if (target < 0 || target >= dates.length) return;
      tlListSel = dates[target];
      tlRenderEventsContent();
    }

    // 在明细里挑「要滚动到的日期标题」：精确命中 → 其后最近 → 其前最近 → 首个（＝附近位置回退）
    function tlPickScrollTarget(headers, ds) {
      if (!headers || !headers.length) return null;
      for (const h of headers) if (h.dataset.evDate === ds) return h;
      for (const h of headers) if (h.dataset.evDate > ds) return h;
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i].dataset.evDate < ds) return headers[i];
      return headers[0];
    }
    // 把元素滚到 scroller 顶部（sticky 安全版，月/週明细 + 列表模式共用）
    // ⚠️ 坑：`.ev-date` 是 position:sticky，**被「吸顶」时它的 offsetTop / getBoundingClientRect()
    //    返回的是「位移后」的渲染位置（≈ 当前 scrollTop），不是布局位置**（Chrome 实测：吸顶后
    //    offsetTop === scroller.offsetTop + scrollTop）。于是「点更早的日期」时，目标标题正被吸在
    //    滚动口顶部 → 算出的目标 scrollTop 恰好等于当前 scrollTop → 永远滚不上去；点更晚的日期时
    //    标题在下方、没被吸顶，所以只有单向能滚（2026-09-19 用户报告的 bug）。
    //    修法：读真实布局位置前先把该元素的 sticky 临时摘掉（同步 reflow，同一帧内还原，不会闪）。
    //    只改 scroller.scrollTop，不触碰祖先滚动容器。
    function tlScrollElToTop(el, scroller) {
      if (!el || !scroller) return;
      const prevPos = el.style.position;
      el.style.position = 'static';                 // 临时摘 sticky → 读到真实布局位置
      const next = (el.offsetParent && el.offsetParent === scroller.offsetParent)
        ? el.offsetTop - scroller.offsetTop - (scroller.clientTop || 0)   // 同 offsetParent：直接相减（补边框）
        : scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);  // 否则退回 rect 差
      el.style.position = prevPos;
      scroller.scrollTop = next;
    }
    function tlScrollListToDate(list, scroller, ds) {
      if (!list || !scroller || !ds) return;
      tlScrollElToTop(tlPickScrollTarget(list.querySelectorAll('.ev-date[data-ev-date]'), ds), scroller);
    }
    // 「日/月」切换只显示在当前画面顶部（第一个可见）的日期标题条上：
    // active = 已滚过顶部、当前贴着顶部的那条日期标题（sticky 顶条）。
    function tlPickActiveDate(list) {
      const heads = list.querySelectorAll('.ev-date[data-ev-date]');
      if (!heads.length) return null;
      const topLine = list.getBoundingClientRect().top + 16; // 16px：容纳首条 margin-top 与容器内边距
      let active = null;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top <= topLine) active = heads[i];
      }
      return active;
    }
    function tlUpdateActiveDate(list) {
      if (!list) return;
      const active = tlPickActiveDate(list);
      list.querySelectorAll('.ev-date[data-ev-date].active').forEach((h) => h.classList.remove('active'));
      if (active) active.classList.add('active');
    }
    function tlBindActiveDateScroll(list) {
      if (!list || list.dataset.activeBound === '1') return;
      list.dataset.activeBound = '1';
      let raf = 0;
      list.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; tlUpdateActiveDate(list); });
      }, { passive: true });
    }

    // ===== 上下区域可拖動分割（月/週共用）=====
    // 拖動横条调整「下方行程明细」高度：写成 CSS 变量 --ev-detail-h（百分比）
    // → 窗口尺寸变化时比例自然保持，无需重算。纯 UI 偏好：内存 + localStorage，绝不写回数据文件。
    const TL_SPLIT_MIN_PX = 56;        // 明细最小高度（至少看得见一条日期条）
    const TL_SPLIT_TOP_MIN_PX = 120;   // 上区最小高度（仍看得见月格 / 时间网格）
    const TL_SPLIT_DEFAULT = 30;       // 默认占比（%）
    let tlSplitPct = null;
    function tlLoadSplitPct() {
      if (tlSplitPct != null) return tlSplitPct;
      let v = NaN;
      try { v = parseFloat(localStorage.getItem('tlCalDetailH')); } catch (e) {}
      tlSplitPct = (isFinite(v) && v >= 10 && v <= 80) ? v : TL_SPLIT_DEFAULT;
      return tlSplitPct;
    }
    function tlSaveSplitPct(v) {
      tlSplitPct = Math.min(80, Math.max(10, Math.round(v * 10) / 10));
      try { localStorage.setItem('tlCalDetailH', String(tlSplitPct)); } catch (e) {}
    }
    // 指针 Y → 明细高度百分比（实时量 rect，不依赖缓存尺寸）；只写 CSS 变量，不落盘
    function tlApplySplitFromPointer(wrap, clientY) {
      const r = wrap.getBoundingClientRect();
      if (!r.height) return null;
      const maxPx = Math.max(TL_SPLIT_MIN_PX, r.height - TL_SPLIT_TOP_MIN_PX);
      const px = Math.min(Math.max(TL_SPLIT_MIN_PX, r.bottom - clientY), maxPx);
      const pct = px / r.height * 100;
      wrap.style.setProperty('--ev-detail-h', pct + '%');
      return pct;
    }
    // 绑一次即可（重渲染换了新元素才会再绑）；每次调用都重新套用已存占比
    function tlBindSplit(wrap, split) {
      if (!wrap || !split) return;
      wrap.style.setProperty('--ev-detail-h', tlLoadSplitPct() + '%');
      if (split.dataset.splitBound === '1') return;
      split.dataset.splitBound = '1';
      let dragging = false;
      split.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        split.classList.add('dragging');
        try { split.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();   // 防止拖动时选中文本
      });
      // 有了 pointer capture，move/up 都会派发到 split 自身
      split.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if ((e.buttons & 1) !== 1) { dragging = false; split.classList.remove('dragging'); return; }
        tlApplySplitFromPointer(wrap, e.clientY);
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false;
        split.classList.remove('dragging');
        try { split.releasePointerCapture(e.pointerId); } catch (err) {}
        const pct = tlApplySplitFromPointer(wrap, e.clientY);
        if (pct != null) tlSaveSplitPct(pct);   // 松手才落盘
      };
      split.addEventListener('pointerup', end);
      split.addEventListener('pointercancel', end);
      split.addEventListener('dblclick', () => {
        tlSaveSplitPct(TL_SPLIT_DEFAULT);
        wrap.style.setProperty('--ev-detail-h', TL_SPLIT_DEFAULT + '%');
      });
    }

    function tlRenderMonth(content) {
      tlCalEvents = tlParseEvents(content);
      tlCalHolidays = tlParseHolidays(content);
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
        const hols = tlHolidaysOnDay(ds);
        let chips = '';
        // ## HOLIDAY：月格 chip（与 EVENT 视觉区隔：type 色块＋图标徽章）
        for (let k = 0; k < Math.min(2, hols.length); k++) {
          const region = tlHolidayRegionMeta(hols[k].region);
          chips += '<span class="ev-holiday-chip" style="--holiday-color:' + tlEscapeHtml(region.color) + '" title="' + tlEscapeHtml(hols[k].title) + '">' + region.icon + tlEscapeHtml(region.label) + '</span>';
        }
        if (hols.length > 2) chips += '<div class="ev-more">+' + (hols.length - 2) + '</div>';
        // 事件 chip（假日占用空间时收紧上限，避免月格溢出）
        const evCap = hols.length ? 2 : 3;
        for (let j = 0; j < Math.min(evCap, occ.length); j++) {
          chips += tlSpanChipHtml(occ[j].ev, occ[j].pos, occ[j].idx, occ[j].total);
        }
        if (occ.length > evCap) chips += '<div class="ev-more">+' + (occ.length - evCap) + '</div>';
        const cp = tlLunarCompact(ds);
        const lunarCls = 'ev-lunar' + (cp.jieqi ? ' jieqi' : '');
        const lunarSpan = cp.text
          ? '<span class="' + lunarCls + '" onclick="event.stopPropagation();tlShowAlmanac(\'' + ds + '\',this)" title="農民曆 / 老黃曆">' + tlEscapeHtml(cp.text) + '</span>'
          : '';
        html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === today ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') +
          '" data-date="' + ds + '" onclick="tlSelectDate(\'' + ds + '\')"><span class="ev-daynum">' + d.getDate() + '</span>' + lunarSpan + chips + '</div>';
      }
      const grid = document.getElementById('tlEvMonthGrid');
      if (grid) grid.innerHTML = html;
      tlBindSplit(document.getElementById('tlEvMonthWrap'), document.getElementById('tlEvMonthSplit'));
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
      const today = tlFmtDate(new Date());
      const toggle = tlScopeToggleHtml();
      // 「月」范围：渲染游标月整月（按日期分组，只含该月开始的事件/假日），头部显示汇总 + 切换
      if (tlCalScope === 'full') {
        const mo = tlCalCursor.getMonth();
        const prefix = tlCalCursor.getFullYear() + '-' + String(mo + 1).padStart(2, '0');
        const byDate = tlEventsByDate(tlCalEvents.filter(tlEventMatchesTag), (ds) => typeof ds === 'string' && ds.slice(0, 7) === prefix);
        const dates = Array.from(byDate.keys()).sort();
        let total = 0;
        byDate.forEach((g) => { total += g.events.length + g.holidays.length; });
        // toggle 内联进每个日期标题条，随 sticky 让「第一笔可见日期」始终带切换控件；
        // 整月无内容时才退回独立汇总条放 toggle，保证切换仍可达
        let html = '';
        if (!dates.length) html += '<div class="ev-date active">' + (mo + 1) + '月 <span class="ev-week">全部 ' + total + ' 条</span>' +
          '<span style="flex:1"></span>' + toggle + '</div><div class="ev-empty">本月没有行程</div>';
        else {
          for (let i = 0; i < dates.length; i++) {
            const grp = byDate.get(dates[i]);
            let g = tlDateHeader(dates[i], today, toggle, grp.events.length + grp.holidays.length);
            for (const h of grp.holidays) g += tlHolidayHtml(h, today);
            for (const ev of tlSorted(grp.events)) g += tlItemHtml(ev, today);
            html += (dates[i] === tlCalSelected) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
          }
        }
        list.innerHTML = html;
        list.classList.add('scope-follow');
        tlBindActiveDateScroll(list);
        // 整月：滚动到「选中日」的日期条（该日无内容则回退到最近的一天）。
        // 明细自身即滚动容器（.ev-detail 有确定高度）→ 月格不再被滚走。
        tlScrollListToDate(list, list, tlCalSelected);
        tlUpdateActiveDate(list);
        return;
      }
      // 「日」范围（默认）：选定日单日
      const ds = tlCalSelected || tlFmtDate(new Date());
      const m = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
      const dayItems = tlDayItems(ds);
      const evs = tlSorted(dayItems.events);
      const hols = dayItems.holidays;
      let html = '<div class="ev-date' + (ds === today ? ' today' : '') + '" data-ev-date="' + tlEscapeHtml(ds) + '">' +
        (m ? (+m[2]) + '月' + (+m[3]) + '日' : '日期未知') +
        '<span class="ev-week">週' + WD[d.getDay()] + '</span>' +
        (ds === today ? '<span class="ev-today-badge">今天</span>' : '') +
        '<span class="ev-week">· ' + (evs.length + hols.length) + ' 条</span>' +
        toggle +
        '<button type="button" class="ev-day-add" onclick="tlOpenEventForm(null, \'' + ds + '\')">＋ 此日新增</button></div>';
      if (!evs.length && !hols.length) html += '<div class="ev-empty">这一天没有行程</div>';
      else {
        for (const h of hols) html += tlHolidayHtml(h, today);
        for (const ev of evs) html += tlItemHtml(ev, today);
      }
      list.classList.remove('scope-follow');
      list.innerHTML = html;
    }

    // ===== 新增 / 编辑 / 删除（写入 taskText 缓冲） =====
    // 🗓 表單日期輸入框旁的星期提示：根據輸入的日期即時顯示「（星期五）」；結束日留空則清除
    function tlUpdateFormDow() {
      const WD = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        const m = String(val || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        el.textContent = m ? '（' + WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + '）' : '';
      };
      set('tlEvFDateDow', document.getElementById('tlEvFDate') && document.getElementById('tlEvFDate').value);
      set('tlEvFEndDateDow', document.getElementById('tlEvFEndDate') && document.getElementById('tlEvFEndDate').value);
      // 📅 農民曆 / 老黃曆：日期輸入框旁即時顯示農曆日（或節氣），點擊開老黃曆詳情
      const setLunar = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        const cp = tlLunarCompact(val);
        el.textContent = cp.jieqi || cp.lunarText || '';
      };
      setLunar('tlEvFDateLunar', document.getElementById('tlEvFDate') && document.getElementById('tlEvFDate').value);
      setLunar('tlEvFEndDateLunar', document.getElementById('tlEvFEndDate') && document.getElementById('tlEvFEndDate').value);
    }

    function tlOpenEventForm(uid, defaultDate, pre) {
      tlHideTip();
      if (!isCalendarMdDoc()) return;
      tlCalEvents = tlParseEvents(document.getElementById('taskText').value);
      tlRenderTagOptions();
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
      tlUpdateFormDow(); // 🗓 依輸入日期即時顯示星期
      document.getElementById('tlEvFAllday').checked = ev ? ev.allDay : (p.allDay === true);
      // 完成状态：新增默认未完成（旧文件没有 - done 栏位时解析也是未完成）
      document.getElementById('tlEvFDone').checked = ev ? !!ev.done : false;
      document.getElementById('tlEvFStart').value = ev ? ev.startTime : (p.startTime || '');
      document.getElementById('tlEvFEnd').value = ev ? ev.endTime : (p.endTime || '');
      tlToggleAllDay();
      document.getElementById('tlEvFLocation').value = ev ? ev.location : '';
      tlEvFormColor = ev ? ev.color : TL_CAL_COLORS[0];
      tlEvFormTags = ev && ev.tags ? ev.tags.slice() : [];
      document.getElementById('tlEvFTags').value = '';
      tlRenderTagPicker();
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
        tags: tlEvFormTags.slice(),
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
      const ta = document.getElementById('taskText');
      // ⚠️ 从当前缓冲重新解析 holiday，避免保存事件时把用户手写的 ## HOLIDAY 整体覆盖掉（事件序列化器会重画整份文件）
      const holidays = tlParseHolidays(ta.value);
      tlCalHolidays = holidays;
      ta.value = tlCalendarToMarkdown(tlCalEvents, holidays);
      if (typeof autoGrowTextarea === 'function') autoGrowTextarea(ta);
      if (typeof markCurrentTabDirty === 'function') markCurrentTabDirty();
      tlRenderEventsContent();
    }

    // ===== 🖱 悬停行程事件 → 放大提示框（更大字体显示事件内容） =====
    let tlTipEl = null, tlTipUid = null;
    function tlGetTipEl() {
      if (!tlTipEl) {
        tlTipEl = document.createElement('div');
        tlTipEl.className = 'ev-tip';
        tlTipEl.setAttribute('role', 'tooltip');
        tlTipEl.style.display = 'none';
        document.body.appendChild(tlTipEl);
      }
      return tlTipEl;
    }
    function tlTipHtml(ev) {
      const multi = tlIsMultiDay(ev);
      let when;
      if (multi) when = ev.allDay
        ? (tlRangeLabel(ev.date, ev.endDate) + ' · 共' + tlSpanDays(ev.date, ev.endDate) + '天')
        : tlRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
      else when = ev.allDay ? '全天' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
      const tags = (ev.tags && ev.tags.length) ? '<div class="ev-tip-tags">' + ev.tags.map((t) => '#' + tlEscapeHtml(t)).join(' ') + '</div>' : '';
      const loc = ev.location ? '\ud83d\udccd ' + tlEscapeHtml(ev.location) : '';
      const notes = ev.notes ? '<div class="ev-tip-notes">' + tlEscapeHtml(ev.notes) + '</div>' : '';
      const links = tlEventTodoLinks(ev);
      return '<div class="ev-tip-title">' + tlEscapeHtml(ev.title) + (ev.done ? ' <span class="ev-tip-done">\u2713</span>' : '') + '</div>' +
        '<div class="ev-tip-meta">' + tlEscapeHtml(when) + (loc ? ' · ' + loc : '') + '</div>' + tags + links + notes;
    }
    function tlShowTip(uid, x, y) {
      const ev = tlCalEvents.find((e) => e.uid === uid);
      if (!ev) return;
      const tip = tlGetTipEl();
      if (tlTipUid !== uid) { tip.innerHTML = tlTipHtml(ev); tlTipUid = uid; }
      tip.style.display = 'block';
      // 定位：跟随光标，越界则翻转到另一侧（避免超出视口）
      const r = tip.getBoundingClientRect();
      let left = x + 16, top = y + 16;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 16);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function tlHideTip() { if (tlTipEl) { tlTipEl.style.display = 'none'; tlTipUid = null; } }

    // ===== 📅 農民曆 / 老黃曆取數（lunar-javascript，繁體）=====
    // 以 <script> 載入的 window.Solar / window.Lunar 為資料源；Map 快取避免重複計算。
    const tlAlmanacCache = new Map();
    function tlAlmanac(dateStr) {
      if (tlAlmanacCache.has(dateStr)) return tlAlmanacCache.get(dateStr);
      let data = { error: 'lunar lib 未載入或日期無效' };
      try {
        if (typeof Solar === 'undefined' || typeof Lunar === 'undefined') throw new Error('lunar lib 未載入');
        const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) throw new Error('日期格式錯誤');
        const lunar = Solar.fromYmd(+m[1], +m[2], +m[3]).getLunar();
        data = {
          lunarMonth: lunar.getMonthInChinese(),
          lunarDay: lunar.getDayInChinese(),
          lunarText: lunar.getMonthInChinese() + '月' + lunar.getDayInChinese(),
          isLeap: lunar.getMonth() < 0,
          yearGanZhi: lunar.getYearInGanZhi(),
          monthGanZhi: lunar.getMonthInGanZhi(),
          dayGanZhi: lunar.getDayInGanZhi(),
          shengxiao: lunar.getYearShengXiao(),
          yearChinese: lunar.getYearInChinese(),
          jieqi: lunar.getJieQi() || '',
          // 宜忌/彭祖/吉神/凶神/納音/宿/建除 均為簡體 → 逐詞轉繁體（almanacToTrad）
          yi: (lunar.getDayYi() || []).map(almanacToTrad),
          ji: (lunar.getDayJi() || []).map(almanacToTrad),
          chong: lunar.getDayChong() || '',
          chongShengXiao: almanacToTrad(lunar.getDayChongShengXiao() || ''),
          sha: lunar.getDaySha() || '',
          pengZuGan: almanacToTrad(lunar.getPengZuGan() || ''),
          pengZuZhi: almanacToTrad(lunar.getPengZuZhi() || ''),
          jiShen: (lunar.getDayJiShen() || []).map(almanacToTrad),
          xiongSha: (lunar.getDayXiongSha() || []).map(almanacToTrad),
          naYin: almanacToTrad(lunar.getDayNaYin() || ''),
          xiu: almanacToTrad(lunar.getXiu() || ''),
          xiuLuck: lunar.getXiuLuck() || '',
          zhiXing: almanacToTrad(lunar.getZhiXing() || ''),
          posXi: lunar.getDayPositionXiDesc() || '',
          posCai: lunar.getDayPositionCaiDesc() || '',
          posFu: lunar.getDayPositionFuDesc() || '',
          posYangGui: lunar.getDayPositionYangGuiDesc() || '',
          posYinGui: lunar.getDayPositionYinGuiDesc() || ''
        };
      } catch (e) {
        data = { error: String((e && e.message) || e) };
      }
      tlAlmanacCache.set(dateStr, data);
      return data;
    }

    function tlLunarCompact(dateStr) {
      const a = tlAlmanac(dateStr);
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

    function tlAlmanacHtml(dateStr) {
      const a = tlAlmanac(dateStr);
      const E = tlEscapeHtml;
      const join = (arr) => (arr && arr.length ? arr.map(E).join('、') : '—');
      const row = (k, v) => '<div class="ev-alm-row"><span class="ev-alm-k">' + k + '</span><span class="ev-alm-v">' + v + '</span></div>';
      if (a.error) return '<div class="ev-alm-empty">無法取得農民曆：' + E(a.error) + '</div>';
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
      const solarLabel = m ? (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日 週' + WD[d.getDay()] : dateStr;
      let html = '<div class="ev-alm-head">';
      html += '<div class="ev-alm-solar">' + E(solarLabel) + '</div>';
      html += '<div class="ev-alm-lunar">農曆 ' + E(a.yearGanZhi) + '年（' + E(a.shengxiao) + '）' + E(a.lunarText) + (a.jieqi ? ' · ' + E(a.jieqi) : '') + '</div>';
      html += '</div><div class="ev-alm-grid">';
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

    let tlAlmanacEl = null;
    function tlShowAlmanac(dateStr, anchorEl) {
      tlRemoveAlmanac();
      const pop = document.createElement('div');
      pop.className = 'ev-almanac-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', '老黃曆');
      pop.innerHTML = '<button type="button" class="ev-almanac-close" aria-label="關閉">✕</button>' + tlAlmanacHtml(dateStr);
      document.body.appendChild(pop);
      tlAlmanacEl = pop;
      const pw = pop.offsetWidth || 320, ph = pop.offsetHeight || 320;
      const r = anchorEl ? anchorEl.getBoundingClientRect() : null;
      let left = r ? r.left : (window.innerWidth - pw) / 2;
      let top = r ? r.bottom + 6 : (window.innerHeight - ph) / 2;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
      pop.style.left = Math.max(8, left) + 'px';
      pop.style.top = Math.max(8, top) + 'px';
      pop.querySelector('.ev-almanac-close').addEventListener('click', tlRemoveAlmanac);
      setTimeout(() => document.addEventListener('click', tlAlmanacDocClick, true), 0);
    }
    function tlRemoveAlmanac() {
      if (tlAlmanacEl) { tlAlmanacEl.remove(); tlAlmanacEl = null; }
      document.removeEventListener('click', tlAlmanacDocClick, true);
    }
    function tlAlmanacDocClick(e) {
      if (tlAlmanacEl && !tlAlmanacEl.contains(e.target)) tlRemoveAlmanac();
    }

    // 事件绑定（DOM 就绪时执行一次）
    (function bindCalendarEventsUI() {
      const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
      on('tlEvModeList', 'click', () => tlSetMode('list'));
      on('tlEvModeDay', 'click', () => tlSetMode('day'));
      on('tlEvModeWeek', 'click', () => tlSetMode('week'));
      on('tlEvModeMonth', 'click', () => tlSetMode('month'));
      on('tlEvAddBtn', 'click', () => tlOpenEventForm(null));
      on('tlEvPrevMonth', 'click', () => { if (tlCalMode === 'list') tlListNavDay(-1); else tlCalStepCursor(-1); });
      on('tlEvNextMonth', 'click', () => { if (tlCalMode === 'list') tlListNavDay(1); else tlCalStepCursor(1); });
      on('tlEvTodayBtn', 'click', () => { tlCalCursor = new Date(); tlCalSelected = tlFmtDate(new Date()); tlListSel = tlFmtDate(new Date()); tlRenderEventsContent(); });
      // 🗓 表單日期輸入變更 → 即時更新輸入框旁的星期提示
      on('tlEvFDate', 'change', tlUpdateFormDow);
      on('tlEvFDate', 'input', tlUpdateFormDow);
      on('tlEvFEndDate', 'change', tlUpdateFormDow);
      on('tlEvFEndDate', 'input', tlUpdateFormDow);
      const tagPicker = document.getElementById('tl-ev-tag-picker');
      const tagInput = document.getElementById('tlEvFTags');
      if (tagPicker && tagInput) {
        tagPicker.addEventListener('click', (e) => {
          const remove = e.target.closest('[data-tl-ev-tag-remove]');
          const option = e.target.closest('[data-tl-ev-tag-option]');
          if (remove) tlRemoveFormTag(remove.getAttribute('data-tl-ev-tag-remove'));
          else if (option) tlToggleFormTag(option.getAttribute('data-tl-ev-tag-option'));
          else { tagPicker.classList.add('open'); tlRenderTagPicker(); }
        });
        tagInput.addEventListener('input', () => { tagPicker.classList.add('open'); tlRenderTagPicker(); });
        tagInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); tlAddFormTag(tagInput.value); }
          else if (e.key === 'Backspace' && !tagInput.value) tlRemoveFormTag(tlEvFormTags[tlEvFormTags.length - 1]);
        });
        document.addEventListener('click', (e) => { if (!tagPicker.contains(e.target)) tagPicker.classList.remove('open'); });
      }
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
      // 🖱 列表模式：双击事件项直接进入编辑状态（事件项本身无单击打开，故用 dblclick 快捷编辑）
      document.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.ev-item[data-uid]');
        if (!item) return;
        // 勾选框 / 备注清单勾选框 / 编辑删除按钮不触发双击编辑，避免与单击操作冲突（尤其删除按钮二次删除）
        if (e.target.closest('.ev-check') || e.target.closest('.ev-actions') || e.target.closest('.ev-md-check')) return;
        tlOpenEventForm(item.getAttribute('data-uid'));
      });
      // 🖱 悬停行程事件 → 放大提示框（事件委托，覆盖三种事件元素；tooltip 用 pointer-events:none 不挡点击）
      const tlTipPane = document.getElementById('calEventsPane');
      if (tlTipPane) {
        const evSel = '.ev-chip, .ev-block, .ev-item';
        tlTipPane.addEventListener('mouseover', (e) => {
          const el = e.target.closest(evSel);
          if (el && el.getAttribute('data-uid')) tlShowTip(el.getAttribute('data-uid'), e.clientX, e.clientY);
        });
        tlTipPane.addEventListener('mousemove', (e) => {
          if (!tlTipEl || tlTipEl.style.display === 'none') return;
          const el = e.target.closest(evSel);
          if (el && el.getAttribute('data-uid')) tlShowTip(el.getAttribute('data-uid'), e.clientX, e.clientY);
          else tlHideTip();
        });
        tlTipPane.addEventListener('mouseout', (e) => {
          const to = e.relatedTarget;
          if (to && to.closest && to.closest(evSel)) return; // 仍在事件元素间移动，不隐藏
          tlHideTip();
        });
        tlTipPane.addEventListener('mouseleave', tlHideTip);
      }
    })();
