/* ============================================================
 * 🧩 自定义「VIEW 便利贴」引擎（桌面版）
 * ------------------------------------------------------------
 * 这张文件做的事只有一件：照「🔔 提醒」投影贴（calendar-editor.js 的
 * tlViewStickyGroups / tlViewStickyRef）那一套逻辑，用「使用者自己设定的
 * 过滤条件」再多做几张一模一样的投影贴。
 *
 * 与 🔔 的关系：口径完全相同（同一个收集流程、同一个渲染管线、同一套只读规则），
 * 唯一的差别是「哪些行算数」——🔔 写死「带 [[remind:]] 的行」，
 * 这里改成规则里的 关键词／标记／行型态 三个条件。
 *
 * ⚠️ 故意为之的两件事：
 *   1. 🔔 那份代码留在 calendar-editor.js 里，没有搬进来共用。
 *      搬进来会让「投影贴」这个功能同时挂在两个档案上，而 🔔 已经有整套
 *      回归（含与 LITE 端的逐字比对）；改动的风险大于省下的几十行。
 *      ⇒ 改这里的收集／渲染口径时，先看一眼 calendar-editor.js:1176 起的母本，
 *        两边要一起改才不会出现「🔔 跟自定义贴行为不同」。
 *        唯一刻意不同的一处：**0 命中**时自订规则仍建一张贴（贴面写清「这个条件没抓到任何行」，
 *        见 EMPTY_NOTES），而 🔔 是没内容就没这张贴 —— 使用者要能翻到规则标题才知道去哪改。
 *   2. 三条例外口径沿用 🔔（主进程与便利贴窗都按 key 前缀 __view__ 认得它们）：
 *      ① 内容不落盘（key 是保留字，正文每次由行程现算；这张贴的外观／位置照一般便利贴存盘）；
 *      ② 只读（checkbox 不可点、小圆点不开编辑浮层、菜单只留 复制／找出相同）；
 *      ③ 浏览功能与普通便利贴完全一致（清单／翻页／搜索定位／样式）。
 *
 * 存档：规则本体存在主进程的 data/view-sticky-rules.json（全应用共用一份），
 *       这个档案只负责「规则 → 便利贴」，不读档、不写档、不碰 DOM。
 * ============================================================ */
(function (global) {
  'use strict';

  // ===== key：投影贴的身份证 =====
  //   🔔 的 key 是 '__view__'（历史保留字，也是没有 ruleId 时的形状）；
  //   自定义贴是 '__view__:<规则 id>'。主进程与便利贴窗都用「前缀」判断它是投影贴。
  const KEY_PREFIX = '__view__';
  const viewKeyOf = (ruleId) => (ruleId === '__builtin_remind__' || !ruleId)
    ? KEY_PREFIX : KEY_PREFIX + ':' + ruleId;
  const isViewKey = (key) => {
    const s = String(key == null ? '' : key);
    return s === KEY_PREFIX || s.indexOf(KEY_PREFIX + ':') === 0;
  };

  // ===== 行型态判定（三个正则与 🔔 的 TL_VIEW_*_RE 同名同值，别单独调这里）=====
  const TASK_RE = /^-\s+\[([ xX])\]\s?([\s\S]*)$/;                                       // = TL_VIEW_TASK_RE
  // 渲染 checkbox 行时要保留原始缩进 → 这条多带一个「行首空白」捕获组（＝🔔 的 tlViewTaskLineHtml 内联式）
  const TASK_LINE_RE = /^(\s*)-\s+\[([ xX])\]\s?([\s\S]*)$/;
  const DONE_CHECK_RE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\](?=[ \t]|$)/; // = TL_VIEW_DONE_CHECK_RE
  const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/;                              // = TL_VIEW_LIST_ITEM_RE
  const QUOTE_RE = /^>[ \t]*/;
  const HEADING_RE = /^#{1,6}(\s|$)/;
  const FENCE_RE = /^\s*(```|~~~)/;
  const ROW_TYPES = ['todo', 'done', 'list', 'para', 'quote', 'heading'];
  const ROW_TYPE_LABEL = {
    todo: '未完成 checkbox', done: '已完成 checkbox', list: '列表项',
    para: '段落／纯文字', quote: '引用（>）', heading: '标题（#）'
  };
  // ===== 🆕 启动通知：勾了「通知讯息」的 VIEW 贴，在便利贴启动时先闪烁显示 =====
  //   这两个值属于「显示行为」不是过滤条件，但同样收在规则里（维护作业唯一写入端）。
  //   默认不勾；秒数默认 15 秒，夹在 1–600 秒（避免 0 秒／负数／浮夸值）。
  const NOTIFY_DEFAULT_SECONDS = 15;
  const NOTIFY_MIN_SECONDS = 1;
  const NOTIFY_MAX_SECONDS = 600;
  function normalizeNotifySeconds(v) {
    const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : NOTIFY_DEFAULT_SECONDS;
    return Math.min(NOTIFY_MAX_SECONDS, Math.max(NOTIFY_MIN_SECONDS, n));
  }
  // 是否要当启动通知：必须是启用中的规则且勾了通知
  function isNotifyRule(rule) {
    const r = normalizeRule(rule);
    return r.enabled && r.notify === true;
  }

  const BUILTIN_REMIND_RULE = {
    id: '__builtin_remind__',
    title: '🔔 提醒',
    enabled: true,
    keywords: [],
    keywordMode: 'ANY',
    marker: 'remind',
    caseSensitive: false,
    emptyBehavior: 'hide',
    builtin: true,
    notify: false,
    notifySeconds: NOTIFY_DEFAULT_SECONDS,
    rowTypes: { todo: true, done: false, list: true, para: true, quote: true, heading: true }
  };
  const MARKERS = [
    { value: '', label: '不限（有命中条件就算）' },
    { value: 'remind', label: '[[remind:…]] 提醒标记' },
    { value: 'dl', label: '[[dl:…]] deadline 标记' },
    { value: 'cp', label: '[[cp:…]] completed 标记' }
  ];

  // 一行属于哪种「型态」。判定顺序＝🔔 的过滤顺序：围栏 > 已打勾 > checkbox > 列表 > 引用 > 标题 > 段落。
  function rowTypeOf(rawLine, trimmed) {
    if (DONE_CHECK_RE.test(rawLine)) return 'done';
    if (TASK_RE.test(trimmed)) return 'todo';
    if (LIST_ITEM_RE.test(rawLine)) return 'list';
    if (QUOTE_RE.test(trimmed)) return 'quote';
    if (HEADING_RE.test(trimmed)) return 'heading';
    return 'para';
  }

  // ===== 规则：读进来的 JSON 一律先归一化（缺字段补默认值，脏值不让它炸）=====
  // 段落（segment）：每一段＝一个完整的搜索（关键词＋标记＋模式＋大小写＋行型态）。
  //   旧版规则没有 segments 字段 → 用顶层条件合成「单一段落」（向后兼容，外观与旧版一致）。
  function normalizeSegment(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const kw = Array.isArray(s.keywords) ? s.keywords
      : (typeof s.keywords === 'string' ? String(s.keywords).split(/[,，、\n]/) : []);
    const marker = MARKERS.some((m) => m.value === s.marker) ? s.marker : '';
    const rt = s.rowTypes && typeof s.rowTypes === 'object' ? s.rowTypes : null;  // null＝继承规则层
    return {
      title: String(s.title == null ? '' : s.title).replace(/\s+/g, ' ').trim(),
      keywords: kw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean),
      keywordMode: s.keywordMode === 'ALL' ? 'ALL' : 'ANY',
      marker: marker,
      caseSensitive: !!s.caseSensitive,
      rowTypes: rt ? {
        todo: rt.todo !== false,
        done: rt.done === true,        // 默认不收已打勾（与 🔔 同口径：打勾＝不必再提醒）
        list: rt.list !== false,
        para: rt.para !== false,
        quote: rt.quote !== false,
        heading: rt.heading !== false
      } : null
    };
  }
  function blankSegment() { return normalizeSegment({ title: '', keywords: [], keywordMode: 'ANY', marker: '', caseSensitive: false, rowTypes: null }); }
  function normalizeRule(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const rt = r.rowTypes && typeof r.rowTypes === 'object' ? r.rowTypes : {};
    const ruleRowTypes = {
      todo: rt.todo !== false, done: rt.done === true, list: rt.list !== false,
      para: rt.para !== false, quote: rt.quote !== false, heading: rt.heading !== false
    };
    // 段落：优先用显式 segments；否则（旧版规则）用顶层条件合成单一段落
    let segments;
    if (Array.isArray(r.segments) && r.segments.length) segments = r.segments.map(normalizeSegment);
    else segments = [normalizeSegment({
      title: '', keywords: r.keywords, keywordMode: r.keywordMode,
      marker: r.marker, caseSensitive: r.caseSensitive, rowTypes: r.rowTypes
    })];
    segments.forEach((s) => { if (!s.rowTypes) s.rowTypes = ruleRowTypes; });  // 未明写行型态→继承规则层
    return {
      id: String(r.id == null ? '' : r.id),
      title: String(r.title == null ? '' : r.title).replace(/\s+/g, ' ').trim() || '自定义便利贴',
      enabled: r.enabled !== false,
      segments: segments,
      emptyBehavior: r.emptyBehavior === 'hide' ? 'hide' : 'show',
      builtin: r.builtin === true,
      readonly: r.readonly === true || r.builtin === true,
      // 🆕 启动通知（便利贴启动时先闪烁显示这张贴，秒数到或手动关闭后才进正常显示）
      notify: r.notify === true,
      notifySeconds: normalizeNotifySeconds(r.notifySeconds)
    };
  }
  function normalizeList(list) {
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r === 'object').map(normalizeRule);
  }
  function newRuleId() { return 'vsr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }
  function blankRule() { return normalizeRule({ id: newRuleId(), title: '' }); }
  function builtinRules() { return [normalizeRule(BUILTIN_REMIND_RULE)]; }

  // 单段条件文案（不含「段落」前缀）：维护窗清单、徽标弹层、段落标题共用，保证同口径。
  //   ⚠️ 标记用「标记＝remind」而不是「[[remind:…]]」——后者会被 termDefs 当胶囊解析，
  //      这里只是说明文字，不能出现成对的双方括号。
  function conditionText(cond) {
    if (!cond) return '⚠ 没有条件（不会抓到内容）';
    const parts = [];
    if (cond.marker) parts.push('标记＝' + cond.marker);
    if (cond.keywords.length) parts.push('关键词' + (cond.keywordMode === 'ALL' ? '全中' : '任一') + '：' + cond.keywords.join('、') + (cond.caseSensitive ? '（区分大小写）' : ''));
    if (!parts.length) parts.push('⚠ 没有条件（不会抓到内容）');
    const types = ROW_TYPES.filter((t) => cond.rowTypes && cond.rowTypes[t]).map((t) => ROW_TYPE_LABEL[t]);
    parts.push('行型态：' + (types.join('／') || '无'));
    return parts.join(' ＋ ');
  }
  // 规则摘要（人类可读）：单段＝旧格式（与旧版一致）；多段＝「共 N 段：段落1（…）｜段落2（…）」。
  function ruleSummary(rule) {
    const r = normalizeRule(rule);
    if (r.segments.length === 1) return conditionText(r.segments[0]);
    return '共 ' + r.segments.length + ' 段：' + r.segments.map((s, i) =>
      '段落' + (i + 1) + (s.title ? '：' + s.title : '') + '（' + conditionText(s) + '）').join(' ｜ ');
  }

  // 这一段是否算「有搜索条件」（关键词／标记至少要有一个）；整条规则＝任一段有即可
  function segmentHasCondition(seg) {
    return !!seg && (seg.keywords.length > 0 || !!seg.marker);
  }
  function ruleHasCondition(rule) {
    return (rule && Array.isArray(rule.segments) ? rule.segments : []).some(segmentHasCondition);
  }
  function lineHitsRule(line, trimmed, cond) {
    if (cond.marker && !new RegExp('\\[\\[' + cond.marker + ':', 'i').test(line)) return false;
    if (!cond.keywords.length) return true;
    const hay = cond.caseSensitive ? trimmed : trimmed.toLowerCase();
    const ok = cond.keywords.map((k) => (cond.caseSensitive ? k : k.toLowerCase()))
      .filter((k) => k).map((k) => hay.indexOf(k) >= 0);
    return cond.keywordMode === 'ALL' ? ok.every(Boolean) : ok.some(Boolean);
  }

  // 0 命中时贴面上的话：把「为什么是空的」和「去哪改」直接写在贴子上。
  //   ⚠️ 这段刻意不出现成对的双方括号：它会先过 termDefs（术语胶囊）再进 markdown，
  //      写成 `[[remind:` 那种示范文字有被解析器咬掉的风险，所以只讲「顺序、括号位置要对得上」。
  const EMPTY_NOTES = '**这个条件目前没抓到任何行**\n\n关键词要和行程档里出现的文字一模一样（顺序与括号位置都要对得上）；要抓提醒，请把上方的「标记条件」选成 remind。改条件请开便利贴菜单的「🧩 自定义 VIEW 便利贴维护作业」。';

  // ===== 依赖注入 =====
  //   渲染器由宿主（calendar-editor.js）传进来，保持「单一可信来源」：
  //   投影贴的文字必须跟列表行、普通便利贴走同一条管线，否则 <BIG>／[[术语]] 会显示成原文。
  //   没传就退回全局函数（calendar-editor.js 的 function 声明就是全局）；再没有才降级成纯文字。
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function makeDeps(d) {
    if (d && typeof d.esc === 'function' && typeof d.inline === 'function') return d;   // 已解析过的 deps 直接用
    const e = d && typeof d === 'object' ? d : {};
    const pick = (name, fallback) => {
      if (typeof e[name] === 'function') return e[name];
      if (typeof global[name] === 'function') return global[name];
      return fallback;
    };
    return {
      esc: pick('tlEscapeHtml', escapeHtml),
      inline: pick('tlRenderInlineMarkdown', (s) => String(s == null ? '' : s)),
      noteMarkers: pick('tlRenderNoteMarkers', (s) => String(s == null ? '' : s)),
      termDefs: pick('tlRenderTermDefs', (s) => String(s == null ? '' : s)),
      markdown: pick('renderMarkdown', (s) => String(s == null ? '' : s)),
      shortDate: pick('tlMdShort', (s) => String(s == null ? '' : s))
    };
  }

  // ===== 收集：一段条件 ＋ 全部行程 → 分组（结构与 🔔 的 tlViewStickyGroups 逐字相同）=====
  //   回传 [{ ev, hits }]，hits＝[{ raw, line, uid, text, task, type }]＋分隔用空行 { raw:'', sep:true }。
  //   line＝来源行程备注里的 0-based 行号；text＝checkbox 内文（便利贴窗右键「找出相同」要比对的字）。
  //   收哪些行：围栏程式码块内的标记是范例→不收；其余按 rowTypes／关键词／标记过滤。
  //   ⚠️ 「列表项」后面直接接「非列表行」＝CommonMark 的 lazy continuation，会被并到上一条里面，
  //      所以中间要补一个空行（收集来的行原本未必相邻，源档的空行不会一起带过来）。
  //   cond＝一个段落（segment）：{ keywords, keywordMode, marker, caseSensitive, rowTypes }。
  function collectGroups(events, cond, deps) {
    const D = makeDeps(deps);
    const groups = [];
    if (!segmentHasCondition(cond)) return groups;
    (Array.isArray(events) ? events : []).forEach((ev) => {
      if (!ev) return;
      const hits = [];
      let inFence = false;
      String(ev.notes || '').replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
        if (FENCE_RE.test(line)) { inFence = !inFence; return; }
        if (inFence) return;
        const t = line.trim();
        if (!t) return;
        const type = rowTypeOf(line, t);
        if (!cond.rowTypes[type]) return;
        if (!lineHitsRule(line, t, cond)) return;
        // 🆕 已完成的 checkbox（type='done'）也要當 task 行渲染。
        //   否則 done 行會落進下面的「非 task」分支 → D.markdown(D.termDefs(raw))，
        //   被 GFM 當成一般任務清單 → 顯示成「方形 checkbox ＋ 未解析的 [[cp:…]] 原文」，
        //   與普通便利貼（tlTaskLineHtml：綠圓勾 ✅）不一致。見 2026-10-27 使用者回報。
        const m = (type === 'todo' || type === 'done') ? t.match(TASK_RE) : null;
        if (hits.length && !LIST_ITEM_RE.test(t) && LIST_ITEM_RE.test(hits[hits.length - 1].raw)) {
          hits.push({ raw: '', sep: true });
        }
        hits.push({ raw: t, line: i, uid: ev.uid || '', text: m ? (m[2] || '').trim() : '', task: !!m, type: type });
      });
      if (hits.length) groups.push({ ev, hits });
    });
    return groups;
  }

  // ===== 分组标题＝来源行程的标题＋（日期）＋（📎 来源文件名，仅 INCLUDE 事件显示）=====
  //   标题本身带 `#`／`<BIG>`／[[术语]] 时照其语义渲染（不要再包 ** 变成字面符号）；
  //   纯文字标题才补 **粗体**，维持「分组」的可辨识度。
  //   🆕 INCLUDE 外部文件的事件（ev.src 非空）尾巴加 `· 📎 文件名`，主档事件不显示（默认来源）。
  function groupHeadMd(ev, deps) {
    const D = makeDeps(deps);
    const title = String((ev && ev.title) || '(无标题)').replace(/\s+/g, ' ').trim();
    const date = (ev && ev.date) ? '（' + D.shortDate(ev.date) + '）' : '';
    const src = (ev && ev.src) ? ' · 📎 ' + D.esc(String(ev.src).trim()) : '';
    const head = HEADING_RE.test(title) ? title + date : '**' + title + '**' + date;
    return head + src;
  }
  function groupsToMd(groups, deps) {
    if (!groups || !groups.length) return '';
    return groups.map((g) => groupHeadMd(g.ev, deps) + '\n' + g.hits.map((h) => h.raw).join('\n')).join('\n\n');
  }

  // ===== 渲染 =====
  //   checkbox 行：结构照抄 🔔 的 tlViewTaskLineHtml（同一套 CSS），差别只在「只读」——
  //   checkbox 不带 onclick／data-uid（不可勾）；小圆点照样显示（右键 复制／找出相同 的入口），
  //   但 data-uid＝这张投影贴自己的 key（便利贴窗据此走只读分支），
  //   data-src／data-stitle／data-text＝来源行程的身份（右键比对要用，不能拿来源当「自己」）。
  function taskLineHtml(h, ev, selfKey, deps) {
    const D = makeDeps(deps);
    const m = h.raw.match(TASK_LINE_RE);
    if (!m) return '';
    const done = m[2] !== ' ';
    const stitle = D.esc(String((ev && ev.title) || '').replace(/\s+/g, ' ').trim() || '(无标题)');
    const dot = '<button type="button" class="ev-md-edit" title="右键：复制／找出相同的项目"' +
      ' data-uid="' + D.esc(selfKey) + '" data-src="' + D.esc(h.uid || '') +
      '" data-stitle="' + stitle + '" data-line="' + h.line + '" data-text="' + D.esc(h.text) + '">\u270e</button>';
    return m[1] + '<span class="ev-md-check' + (done ? ' done' : '') + '">' + dot +
      '<span class="ev-cb">' + (done ? '\u2713' : '') + '</span>' +
      '<span class="ev-md-check-text">' + D.inline(D.noteMarkers(m[3])) + '</span></span>';
  }
  // 非 task 行（段落／列表项／引用／标题／含 [[…]] 胶囊的行）：投影贴里同样给编辑小圆点，
  //   但「最小 MD 单元」口径必须与来源便利贴（calendar-editor.js::tlSplitMdBlocks）一致——
  //   连续同类行合并成一个单元、一颗圆点（例如连续两条 - 列表项＝一个 list 块＝一颗圆点），
  //   而不是像之前那样「每行一颗」。否则 VIEW 投影贴会把同一 list 块的 2 条 bullet 显示成 2 颗圆点，
  //   与来源便利贴（1 颗）不一致，让使用者误以为「比来源多了编辑单元」（2026-10-30 使用者回报）。
  //   ⚠️ 圆点保持只读：不开编辑浮层（投影贴无落盘位置）；用 .md-unit 包住以复用来源便利贴的左侧凹槽定位。
  //   ⚠️ 圆点的 data-text 携带「整块原文」（多行用 \n 连接），供「找出相同的项目」比整块而非单行；
  //      见 desktop-note.js noteFindSameComputeMatches 的整块比对分支。
  function viewMergeCategory(h) {
    // 与 tlSplitMdBlocks 同口径：list/para/quote 连续可并；heading/hr/code/table 各自独立（每命中即新单元）
    if (h.type === 'list') return 'list';
    if (h.type === 'para') return 'para';
    if (h.type === 'quote') return 'quote';
    // heading/hr/code/table：用行号保证每命中独立成单元（不会与相邻同类合并）
    return 'solo:' + (h.line != null ? h.line : Math.random());
  }
  // 把一组命中切成「编辑单元」：连续同类非 task 行合并成一个单元；task 行各自独立（沿用 checkbox 行逻辑）。
  function groupHitsIntoUnits(hits) {
    const units = [];
    let cur = null;
    (hits || []).forEach((h) => {
      if (h.sep) return;
      if (h.task) { if (cur) units.push(cur); units.push({ task: true, hits: [h] }); cur = null; return; }
      const cat = viewMergeCategory(h);
      if (cur && !cur.task && cur.cat === cat) cur.hits.push(h);
      else { if (cur) units.push(cur); cur = { cat: cat, task: false, hits: [h] }; }
    });
    if (cur) units.push(cur);
    return units;
  }
  // 一个非 task 编辑单元（可能含 1..n 条连续同类行）：整块渲染成 1 个 .md-unit ＋ 1 颗只读圆点。
  function nonTaskUnitHtml(hits, ev, selfKey, deps) {
    const D = makeDeps(deps);
    const list = (hits && hits.length) ? hits : [];
    if (!list.length) return '';
    const first = list[0];
    const stitle = D.esc(String((ev && ev.title) || '').replace(/\s+/g, ' ').trim() || '(无标题)');
    const chunk = list.map((h) => String(h.raw || '').trim()).join('\n');   // 整块原文（多行用 \n 连接）
    const dot = '<button type="button" class="ev-md-edit" title="右键：复制／找出相同的项目"' +
      ' data-uid="' + D.esc(selfKey) + '" data-src="' + D.esc(first.uid || '') +
      '" data-stitle="' + stitle + '" data-line="' + (first.line != null ? first.line : '') +
      '" data-text="' + D.esc(chunk) + '">\u270e</button>';
    // 🆕 data-start/data-end：与 tlRenderNotes 的 .md-unit 同口径（0-based 行区间），
    //    让「找出相同的项目 → 切换」能在便利贴窗里用同一个选择器定位到这个单元并闪烁。
    const last = list[list.length - 1];
    return '<div class="md-unit" data-start="' + (first.line != null ? first.line : '') +
      '" data-end="' + (last.line != null ? last.line : (first.line != null ? first.line : '')) + '">' +
      dot + D.markdown(D.termDefs(chunk)) + '</div>';
  }
  function groupsToHtml(groups, selfKey, deps) {
    const D = makeDeps(deps);
    let out = '';
    (groups || []).forEach((g) => {
      out += D.inline(groupHeadMd(g.ev, D)) + '\n';
      groupHitsIntoUnits(g.hits).forEach((u) => {
        out += u.task ? taskLineHtml(u.hits[0], g.ev, selfKey, D) + '\n'
          : nonTaskUnitHtml(u.hits, g.ev, selfKey, D) + '\n';
      });
    });
    return out;
  }

  // 段落标题（markdown）：「### 段落 N：标题」＋ 一行条件说明（blockquote，纯文字、不含 [[…]]）。
  //   只在「多段落」时才渲染（单段落与旧版外观一致，不加标题）；条件文案走 conditionText（已避开 [[…]]）。
  function segmentHeaderMd(seg, i) {
    const title = seg.title ? '：' + seg.title : '';
    return '### 段落 ' + (i + 1) + title + '\n> 条件：' + conditionText(seg);
  }

  // ===== 一张自定义投影贴 =====
  //   回传 null 只有两种：规则关闭、或所有段落都没有命中条件（＝还没填好，不是「抓完发现没有」）。
  //   有条件但 0 命中 → 照建一张，贴面写明原因（见 EMPTY_NOTES）。
  //   🆕 多段落：每段各是一个完整搜索，按 segments 顺序显示为多个「段落 N」区块；
  //      单段落（含 🔔 内置、旧版自定义）外观与旧版完全一致（不加标题）。
  function buildRef(rule, events, deps) {
    const D = makeDeps(deps);
    const r = normalizeRule(rule);
    if (!r.enabled) return null;                     // 关闭的规则＝不要这张贴
    if (!r.segments.some(segmentHasCondition)) return null;   // 全部段落都没条件＝还没填好
    const key = viewKeyOf(r.id);
    const base = {
      key, idx: 0, view: true, customView: true, ruleId: r.id,
      titleHtml: D.inline(r.title), title: r.title, date: '', endDate: '', color: '', done: false, tags: [], src: '',
      notify: r.notify === true,
      notifySeconds: r.notifySeconds
    };
    // 每段独立收集（只收「有」条件的段落）
    const segResults = r.segments
      .filter(segmentHasCondition)
      .map((seg) => ({ seg, groups: collectGroups(events, seg, D) }));
    const totalHits = segResults.reduce((a, s) => a + s.groups.length, 0);
    if (totalHits === 0) {
      if (r.emptyBehavior === 'hide') return null;
      return Object.assign(base, { notes: EMPTY_NOTES, html: D.markdown(D.termDefs(EMPTY_NOTES)) });
    }
    const multi = segResults.length > 1;
    let notes = '';
    let html = '';
    segResults.forEach((sr, i) => {
      const g = sr.groups;
      const segNotes = groupsToMd(g, D);
      const segHtml = groupsToHtml(g, key, D);
      if (!multi) { notes += segNotes; html += segHtml; return; }
      // 🆕 多段落：每段一个标题，按设定顺序显示
      const head = segmentHeaderMd(sr.seg, i);
      const headHtml = D.markdown(D.termDefs(head));
      if (g.length) {
        notes += (notes ? '\n\n' : '') + head + '\n' + segNotes;
        html += (html ? '\n' : '') + headHtml + '\n' + segHtml;
      } else {
        notes += (notes ? '\n\n' : '') + head + '\n\n> （这个段落目前没抓到任何行）';
        html += (html ? '\n' : '') + headHtml + '\n' + D.markdown('> （这个段落目前没抓到任何行）');
      }
    });
    return Object.assign(base, { notes, html });
  }
  function buildRefs(rules, events, deps) {
    const D = makeDeps(deps);
    const out = [];
    normalizeList(rules).forEach((r) => {
      const ref = buildRef(r, events, D);
      if (ref) out.push(ref);
    });
    return out;
  }

  global.ViewStickyRules = {
    KEY_PREFIX: KEY_PREFIX, viewKeyOf: viewKeyOf, isViewKey: isViewKey,
    ROW_TYPES: ROW_TYPES, ROW_TYPE_LABEL: ROW_TYPE_LABEL, MARKERS: MARKERS,
    NOTIFY_DEFAULT_SECONDS: NOTIFY_DEFAULT_SECONDS,
    NOTIFY_MIN_SECONDS: NOTIFY_MIN_SECONDS,
    NOTIFY_MAX_SECONDS: NOTIFY_MAX_SECONDS,
    normalizeNotifySeconds: normalizeNotifySeconds,
    isNotifyRule: isNotifyRule,
    normalizeRule: normalizeRule, normalizeList: normalizeList,
    newRuleId: newRuleId, blankRule: blankRule, builtinRules: builtinRules,
    blankSegment: blankSegment,
    segmentHasCondition: segmentHasCondition, ruleHasCondition: ruleHasCondition,
    conditionText: conditionText, ruleSummary: ruleSummary,
    EMPTY_NOTES: EMPTY_NOTES,
    rowTypeOf: rowTypeOf, collectGroups: collectGroups, groupHeadMd: groupHeadMd,
    groupsToMd: groupsToMd, groupsToHtml: groupsToHtml, taskLineHtml: taskLineHtml,
    buildRef: buildRef, buildRefs: buildRefs
  };
})(typeof window !== 'undefined' ? window : globalThis);
