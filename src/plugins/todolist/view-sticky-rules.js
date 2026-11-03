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
    { value: 'bookmark', label: '[[bookmark:…]] 收藏标记' },
    { value: 'cr', label: '[[cr:…]] 建立日期标记' },
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
    const tags = Array.isArray(s.tags) ? s.tags
      : (typeof s.tags === 'string' ? String(s.tags).split(/[,，、\n]/) : []);
    const marker = MARKERS.some((m) => m.value === s.marker) ? s.marker : '';
    const rt = s.rowTypes && typeof s.rowTypes === 'object' ? s.rowTypes : null;  // null＝继承规则层
    // 🆕 日期条件：建档日(cr)／完成日(cp)／预计完成(dl)，两种比较口径——固定日期(kind 省略) 或 距今天数(kind:'age')：
    //   • 固定日期：该日期 比较 设定日(value: YYYY-MM-DD)；
    //   • 距今天数：该日期 到今天 经过 N 天（ageDays = today − d），再拿 N 跟 days 比较（> 超过／< 不到／= 正好）。
    //   两者都限定小事件勾选状态(doneState)。合法条件＝field + op + (固定日期的 value ｜ 距今天数的 days≥0)。
    const FIELDS = { cr: 1, dl: 1, cp: 1, ev: 1 }, OPS = { '>': 1, '<': 1, '=': 1 }, DONE = { any: 1, undone: 1, done: 1 };
    const dc = (s.dateCond && typeof s.dateCond === 'object') ? s.dateCond : null;
    let dateCond = null;
    if (dc && FIELDS[dc.field] && OPS[dc.op]) {
      const doneState = DONE[dc.doneState] ? dc.doneState : 'any';
      if (dc.kind === 'age') {
        const rawDays = typeof dc.days === 'number' ? Math.round(dc.days) : parseInt(String(dc.days), 10);
        if (isFinite(rawDays) && rawDays >= 0) dateCond = { field: dc.field, op: dc.op, kind: 'age', days: rawDays, doneState };
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dc.value || '')) {
        dateCond = { field: dc.field, op: dc.op, value: dc.value, doneState };
      }
    }
    return {
      title: String(s.title == null ? '' : s.title).replace(/\s+/g, ' ').trim(),
      keywords: kw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean),
      keywordMode: s.keywordMode === 'ALL' ? 'ALL' : 'ANY',
      tags: tags.map((x) => String(x == null ? '' : x).trim()).filter(Boolean),
      tagMode: s.tagMode === 'ALL' ? 'ALL' : 'ANY',
      detail: s.detail === false ? false : true,   // false＝只显示事件标题（不收明细行）
      includeDoneEvents: s.includeDoneEvents === false ? false : true,  // 标题模式下是否也列「已完成」事件的标题（默认列）
      // 🆕 单开关「只列含未完 checkbox 的事件」：① 收录判定只看是否真有未打勾 checkbox 行（type==='todo'）→ 隐藏无子项的纯标题事件（台雄生日等）；
      //   ② 事件级「未完成」闸门对「已勾完成却仍含未完 checkbox」的事件放行（保留「留尾巴」资料）。二者同源（都围绕「未完 checkbox」），
      //      合并为单一开关，去掉维护窗两个语义重叠的勾选框（用户 2026-11-03 指摘冗余）。旧配置 keepUndoneInDone 视为同义开启，平滑迁移。
      hideNoHitEvents: s.hideNoHitEvents === true || s.keepUndoneInDone === true,
      marker: marker,
      dateCond: dateCond,
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
  function blankSegment() { return normalizeSegment({ title: '', keywords: [], keywordMode: 'ANY', tags: [], tagMode: 'ANY', detail: true, includeDoneEvents: true, marker: '', caseSensitive: false, rowTypes: null }); }
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
      // 🆕 内置「提醒」规则改为「可编辑但不可删」：不再因为 builtin 而自动 readonly。
      //   readonly 只留给显式标记 r.readonly===true 的规则（目前没有），保留这个字段以备将来锁定用。
      readonly: r.readonly === true,
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
    // 🆕 只显示事件标题：带标签条件的段落自动走此模式（用户 2026-10-31 要求标签搜索只列标题）；
    //    行级条件（标记／行型态）在此模式不适用，只列事件级条件＋明确标注「只显示事件标题」。
    const titleOnly = (cond.tags && cond.tags.length > 0) || cond.detail === false;
    if (titleOnly) {
      const parts = [];
      if (cond.tags && cond.tags.length) parts.push('标签' + (cond.tagMode === 'ALL' ? '全有' : '任一') + '：' + cond.tags.join('、'));
      if (cond.keywords && cond.keywords.length) parts.push('标题关键词' + (cond.keywordMode === 'ALL' ? '全中' : '任一') + '：' + cond.keywords.join('、') + (cond.caseSensitive ? '（区分大小写）' : ''));
      if (!parts.length) parts.push('⚠ 没有条件（不会抓到内容）');
      parts.push('只显示事件标题');
      if (cond.includeDoneEvents === false) parts.push('（不含已完成事件）');
      return parts.join(' ＋ ');
    }
    const parts = [];
    if (cond.marker) parts.push('标记＝' + cond.marker);
    if (cond.keywords.length) parts.push('关键词' + (cond.keywordMode === 'ALL' ? '全中' : '任一') + '：' + cond.keywords.join('、') + (cond.caseSensitive ? '（区分大小写）' : ''));
    if (cond.tags && cond.tags.length) parts.push('标签' + (cond.tagMode === 'ALL' ? '全有' : '任一') + '：' + cond.tags.join('、'));
    if (cond.dateCond) {
      const fld = { cr: '建档日期', dl: '预计完成', cp: '完成日期', ev: '事件日期' }[cond.dateCond.field] || cond.dateCond.field;
      const st = { undone: '未完成', done: '已完成', any: '' }[cond.dateCond.doneState] || '';
      if (cond.dateCond.kind === 'age') {
        // 距今天数口径（直觉版）：> 距离今天 N 天后（未来侧）／< 距离今天 N 天前（过去侧）／= 距今天正好 N 天
        const opAge = {
          '>': '距离今天 ' + cond.dateCond.days + ' 天后',
          '<': '距离今天 ' + cond.dateCond.days + ' 天前',
          '=': '距离今天 正好 ' + cond.dateCond.days + ' 天'
        }[cond.dateCond.op] || cond.dateCond.op;
        parts.push(fld + ' ' + opAge + (st ? '（' + st + '）' : ''));
      } else {
        const op = { '>': '晚于', '<': '早于', '=': '等于' }[cond.dateCond.op] || cond.dateCond.op;
        parts.push(fld + op + cond.dateCond.value + (st ? '（' + st + '）' : ''));
      }
    }
    if (!parts.length) parts.push('⚠ 没有条件（不会抓到内容）');
    const types = ROW_TYPES.filter((t) => cond.rowTypes && cond.rowTypes[t]).map((t) => ROW_TYPE_LABEL[t]);
    parts.push('行型态：' + (types.join('／') || '无'));
    if (cond.hideNoHitEvents) parts.push('只列含未完 checkbox 的事件（隐藏无子项纯标题、保留已勾完成却留尾巴）');
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
    return !!seg && (seg.keywords.length > 0 || !!seg.marker || (seg.tags && seg.tags.length > 0) || !!seg.dateCond);
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
  const EMPTY_NOTES = '**这个条件目前没抓到任何行**\n\n关键词要和行程档里出现的文字一模一样（顺序与括号位置都要对得上）；要抓提醒，请把上方的「标记条件」选成 remind。改条件请开便利贴菜单的「🧩 自定义 VIEW 便利贴设定维护作业」。';

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
  // 🆕 事件是否「已完成」：
  //   ① 优先认事件级的「已完成」勾选框（编辑器里「已完成」写入的 ev.done，与标题旁「· 已完成」同为一条数据）；
  //   ② 兜底：事件备注里的 checkbox 子项（与 TASK_RE 同口径，仅认 `- [ ]`／`- [x]`）至少有一项、且全部已打勾（[x]）。
  //   没有任何 checkbox 子项、且事件级未勾选「已完成」的事件 → 不算已完成（照常显示，不受 includeDoneEvents 影响）。
  function eventIsCompleted(ev) {
    if (!ev) return false;
    // ① 事件级「已完成」勾选框（编辑器「已完成」写入的 ev.done）—— 这是最直接的信号
    if (ev.done === true) return true;
    // ② 兜底：备注里 checkbox 子项全部已打勾
    const notes = String(ev.notes || '');
    let any = false, allDone = true;
    notes.replace(/\r\n/g, '\n').split('\n').forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const m = t.match(TASK_RE);
      if (m) { any = true; if (m[1] !== 'x' && m[1] !== 'X') allDone = false; }
    });
    return any && allDone;
  }
  // 🆕 事件备注里是否含有「未完成的 checkbox」（− [ ]）：用于「事件已勾『已完成』却还留尾巴」的边界——
  //   用户要求这类事件的未完 checkbox 也要被抓出来（见 collectGroups 的 ev+undone 闸门：hideNoHitEvents 开启时对「已勾完成却留尾巴」的事件放行）。
  function eventHasUncompletedCheckbox(ev) {
    if (!ev) return false;
    return /\n?[ \t]*-\s+\[\s\]\s?/.test('\n' + String(ev.notes || ''));
  }
  // 🆕 今天的日期（本地，YYYY-MM-DD）：相对日期条件用
  function todayStr() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  // 🆕 两个 YYYY-MM-DD 相差的整数天（按 UTC 计算，避开日光节约时间造成的 ±1 小时误差）；a→b 为正表示 b 较晚
  function daysBetween(a, b) {
    const da = Date.parse(a + 'T00:00:00Z');
    const db = Date.parse(b + 'T00:00:00Z');
    if (!isFinite(da) || !isFinite(db)) return NaN;
    return Math.floor((db - da) / 86400000);
  }
  // 🆕 在 YYYY-MM-DD 上加／减 N 天（UTC 计算，避开日光节约误差），回传 YYYY-MM-DD
  function addDays(dateStr, n) {
    const t = Date.parse(dateStr + 'T00:00:00Z');
    if (!isFinite(t)) return '';
    const d = new Date(t + n * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  // 🆕 日期条件匹配：小事件须是 checkbox（按 doneState 限定 未完成／已完成），且行内含 [[field:YYYY-MM-DD]]；
  //   固定模式＝该日期 比较 设定日；相对模式（kind:'age'）＝该日期 到今天 经过的天数 比较 N 天。
  function dateCondMatch(type, line, dc) {
    if (dc.doneState === 'undone' && type !== 'todo') return false;
    if (dc.doneState === 'done' && type !== 'done') return false;
    if (dc.doneState === 'any' && type !== 'todo' && type !== 'done') return false;
    const m = line.match(new RegExp('\\[\\[' + dc.field + ':(\\d{4}-\\d{2}-\\d{2})\\]\\]', 'i'));
    if (!m) return false;
    const d = m[1];
    if (dc.kind === 'age') {
      // 🆕 用户直觉口径（2026-11-01 调整）：> ＝「距离今天 N 天后」（field 在 今天+N 之后，未来侧）；
      //    < ＝「距离今天 N 天前」（field 在 今天−N 之前，过去侧，如建档已满 N 天）；= ＝「距今天正好 N 天」（前后皆可）。
      //    以「今天 ± N 天」为比较基准，operator 方向不再与直觉相反（旧版用「该日期已存放几天」再比，导致 > 反而抓到更旧的）。
      const today = todayStr();
      if (dc.op === '=') return Math.abs(daysBetween(d, today)) === dc.days;   // 正好距离今天 N 天
      const target = addDays(today, dc.op === '>' ? dc.days : -dc.days);        // 后：今天+N；前：今天−N
      if (!target) return false;
      const cmp = d < target ? -1 : (d > target ? 1 : 0);
      if (dc.op === '>') return cmp > 0;   // 距离今天 N 天后（未来侧）
      if (dc.op === '<') return cmp < 0;   // 距离今天 N 天前（过去侧）
      return false;
    }
    const cmp = d < dc.value ? -1 : (d > dc.value ? 1 : 0);
    if (dc.op === '>') return cmp > 0;
    if (dc.op === '<') return cmp < 0;
    return cmp === 0;
  }
  // 🆕 事件日期条件（dateCond.field === 'ev'）：比对「事件本身的日历日」ev.date，而非行内 [[cr/dl/cp:…]] 标记。
  //    只在「事件级」判定整张事件是否收（在 collectGroups 的事件循环外调用）；固定模式比 value，距今天数模式比 今天±N。
  //    ⚠️ 跨天行程（endDate 存在且 ≠ date）：事件日期是一个「区间 [lo, hi]」而非单日——与日历「某天 occurring」同口径，
  //       今天／指定日 落在 [lo, hi] 内即算该日有此行程。这是修复核心：旧版只比起始日 ev.date，导致「10/31–11/1」的行程
  //       在 11/1（今天）因 起始日距今天 1 天 ≠ 0 而被「正好 0 天（今天）」条件漏掉。
  //    复用 todayStr/addDays/daysBetween；operator 语义与 dateCondMatch 一致（> 后／< 前／= 正好），边界含当日。
  function eventDateMatch(ev, dc) {
    const today = todayStr();
    const d0 = (ev && typeof ev.date === 'string') ? ev.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d0)) return false;
    // 跨天行程 → 区间 [lo, hi]（ISO 串可直接按字典序比较）；否则单日 lo=hi=date。
    //   ⚠️ endDate 必须是合法日期串才视为跨天——单日事件 endDate 多为空串 ''，若误当成区间下界会把 lo 变成 ''，
    //      使「today >= lo」恒真而把未来单日事件也漏进「今天」匹配（2026-11-01 测试发现）。
    const d1 = (ev && typeof ev.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.endDate) && ev.endDate !== d0) ? ev.endDate : d0;
    let lo = d0 <= d1 ? d0 : d1, hi = d0 <= d1 ? d1 : d0;
    // 🆕 显示方式（spanDisplay）＝锚定「行程实际被渲染的那一天」，与日历 tlEventOccurrences / tlEventDisplayDate 完全同口径，
    //   否则「显示在今天」的行程在 VIEW 便利贴里会被漏掉（2026-11-02 用户回报：日历能显示、VIEW 抓不到）。
    //   • 'today'（显示在今天）：无视真实 date/endDate，整张只锚定今天 → 「正好今天(days:0)」命中、其余日期不命中；
    //     固定日期查询 value===today 也命中（它确实「显式出现在今天」），value===真实日期则不命中（它今天不渲染）。
    //   • 'first'/'last'（首末天）：仅多天行程的 首天／末天 被渲染（tlFilterSpanDisplay），区间收缩为 [lo,lo]／[hi,hi]；单天等同 daily。
    //   • 其余（'daily' 或空）→ 维持原区间 [lo, hi]（跨天行程整段可命中，见 2026-11-01 修复）。
    const span = (ev && typeof ev.spanDisplay === 'string') ? ev.spanDisplay : 'daily';
    if (span === 'today') { lo = hi = today; }
    else if (span === 'first') { hi = lo; }
    else if (span === 'last') { lo = hi; }
    if (dc.kind === 'age') {
      if (dc.op === '=') {
        // 正好 N 天：N=0 → 今天落在行程区间内（含跨天，与日历「今天」一致）；N>0 → 行程发生的某天正好是「今天±N」（前后皆可）
        if (dc.days === 0) return today >= lo && today <= hi;
        const fwd = addDays(today, dc.days), bwd = addDays(today, -dc.days);
        return (fwd >= lo && fwd <= hi) || (bwd >= lo && bwd <= hi);
      }
      const target = addDays(today, dc.op === '>' ? dc.days : -dc.days);   // 后：今天+N；前：今天−N
      if (!target) return false;
      // > 后（未来侧）：行程起始在 target 当天或之后（N=1 即「明天」起，与维护窗说明一致）；
      // < 前（过去侧）：行程结束在 target 当天或之前（整段已过去）。
      if (dc.op === '>') return lo >= target;
      return hi <= target;
    }
    // 固定日期：该日期落在行程区间内即命中（与日历「某天 occurring」同口径）；op 仍区分 晚于／早于／等于（边界含当日）
    const v = dc.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    if (dc.op === '=') return v >= lo && v <= hi;   // 指定日在区间内（含跨天）
    if (dc.op === '>') return lo >= v;               // 晚于：行程起始在 value 当天或之后
    return hi <= v;                                   // 早于：行程结束在 value 当天或之前
  }
  function collectGroups(events, cond, deps, includeTitle) {
    const D = makeDeps(deps);
    const searchTitle = includeTitle !== false;   // 默认纳入标题搜索；🔔 内置贴传 false 保持只搜正文
    const groups = [];
    if (!segmentHasCondition(cond)) return groups;
    (Array.isArray(events) ? events : []).forEach((ev) => {
      if (!ev) return;
      // 🆕 事件级标签过滤：事件须带指定标签（tags 任一／全部）才纳入本段搜索；与下方行级条件为「且」
      if (cond.tags && cond.tags.length) {
        const evTagNames = (ev.tags || []).map((t) => (t && typeof t === 'object' ? (t.name || '') : (t || '')));
        const tagHit = cond.tagMode === 'ALL'
          ? cond.tags.every((tg) => evTagNames.indexOf(tg) >= 0)
          : cond.tags.some((tg) => evTagNames.indexOf(tg) >= 0);
        if (!tagHit) return;
      }
      // 🆕 事件日期条件（dateCond.field==='ev'）：事件级闸口，整张事件按其日历日 ev.date 过滤；命中才继续收内容。
      //    与「行内标记」日期条件（cr/dl/cp）不同——ev 比的是事件本身的日期，用于「某天（或今天）的日程汇总」。
      if (cond.dateCond && cond.dateCond.field === 'ev' && !eventDateMatch(ev, cond.dateCond)) return;
      // 🆕 事件状态（dateCond.doneState）在 field:'ev' 时作用于「整张事件」，而非逐行 checkbox：
      //   'undone' → 排除已完成的事件（ev.done 为真，或备注里 checkbox 子项全部已打勾）；'done' → 只收已完成的；'any'（默认）→ 不限制。
      //   否则「所有未完成的项目」这类规则会把「小事件全打勾 ＋ 事件本身已勾」的已完成行程也列进来——
      //   因为明细模式只要有「任意一行」（如备注里的段落文字）命中就收整张事件，导致已完成行程照样出现（2026-11-02 用户回报）。
      //   🆕 hideNoHitEvents（单开关「只列含未完 checkbox 的事件」，ev+undone）：事件虽已勾「已完成」，但备注里仍有未完 checkbox 时，不整张排除——
      //     把那张事件的未完 checkbox 也抓出来（用户 2026-11-03 明确要求「已勾完成却留尾巴的 checkbox 也要」）。
      //     判断「真正全完」＝ eventIsCompleted 且 不含未完 checkbox；只要还有未完 checkbox，就保留该事件。
      if (cond.dateCond && cond.dateCond.field === 'ev' && cond.dateCond.doneState && cond.dateCond.doneState !== 'any') {
        const completed = eventIsCompleted(ev);
        if (cond.dateCond.doneState === 'undone') {
          const keep = cond.hideNoHitEvents && eventHasUncompletedCheckbox(ev);
          if (completed && !keep) return;   // 真正全完才排除；留尾巴则保留
        } else if (cond.dateCond.doneState === 'done' && !completed) {
          return;    // 只收已完成
        }
      }
      // 🆕 自动「只显示事件标题」：带标签条件的段落，事件级命中即收整张行程、不展开其下的小事件
      //    （checkbox 子项）——用户 2026-10-31 明确要求：标签搜索只列事件标题，不要把小事件也列出。
      //    亦兼容旧手动开关 detail:false（残留则同样走此分支）。行级条件（标记／行型态）在此无意义→忽略；
      //    若段落另设了关键词，则只比对事件标题（标题命中才收这张行程）。
      // 🆕 日期条件只在明细（行）模式有意义 → 有 dateCond 时强制走明细分支（即便也设了标签／只显示标题）
      const titleOnly = cond.dateCond && cond.dateCond.field ? false : ((cond.tags && cond.tags.length > 0) || cond.detail === false);
      if (titleOnly) {
        // 🆕 关闭「包含已完成事件」时，跳过「已完成」事件的标题（事件级「已完成」勾选框已勾，
        //    或其备注里 checkbox 子项全部已打勾）。仅影响标题模式的事件级收录；明细模式由行型态的
        //    已完成 checkbox 控制，与此无关。
        if (cond.includeDoneEvents === false && eventIsCompleted(ev)) return;
        let ok = true;
        if (cond.keywords && cond.keywords.length) {
          const titleRaw = String(ev.title == null ? '' : ev.title);
          ok = searchTitle && titleRaw.trim() ? lineHitsRule(titleRaw, titleRaw.trim(), cond) : false;
        }
        if (ok) groups.push({ ev, hits: [] });
        return;
      }
      const hits = [];
      let inFence = false;
      // 🆕 标题也纳入搜索范围：标题命中关键词／标记（不受 rowType 限制）时，这张行程也算命中，
      //    这样「便利贴标题」含关键词／标记的行程也会被收进这张 VIEW 投影贴。
      const titleRaw = String(ev.title == null ? '' : ev.title);
      const titleTrim = titleRaw.trim();
      // 🆕 日期条件只作用在行上，不作用在标题 → 行级标记日期（cr/dl/cp）不把标题命中当收录（避免没命中行的事件被标题捎带进来）。
      //    ⚠️ 但「事件日期」(field==='ev') 例外：ev 的日期闸口已在事件级跑过（上方 line 416），命中即代表这张行程「发生在指定日」，
      //       此时标题本就是事件的名字、理应永远显示——若仍压抑 titleHit，会让「今天日历」这类纯事件日期规则把「没有备注正文」的行程整张漏掉
      //       （2026-11-02 修复：用户今日 2 笔行程都无备注 → 便利贴误报「这一天没有行程」）。
      //       故只对「行级标记日期」压抑 titleHit，ev 放行（无关键词时 lineHitsRule 恒真 → 标题必被收录；有关键词时仍按标题/正文命中过滤）。
      const titleHit = (searchTitle && titleTrim && !(cond.dateCond && cond.dateCond.field && cond.dateCond.field !== 'ev')) ? lineHitsRule(titleRaw, titleTrim, cond) : false;
      String(ev.notes || '').replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
        if (FENCE_RE.test(line)) { inFence = !inFence; return; }
        if (inFence) return;
        const t = line.trim();
        if (!t) return;
        const type = rowTypeOf(line, t);
        // 🆕 日期条件：field 为 cr/dl/cp 时按「行内标记 + 日期比较 + 勾选状态」过滤小事件（取代行型态门槛）；
        //    field==='ev' 已在事件级闸口处理，这里不再逐行比 [[ev:…]]（不存在），仅对 checkbox 行施加 doneState 门槛
        //    （未完成的事件不收已勾项、反之亦然），非 checkbox 行（段落/列表/引用/标题）一律保留；其余走原行型态门槛。
        if (cond.dateCond && cond.dateCond.field && cond.dateCond.field !== 'ev') {
          if (!dateCondMatch(type, line, cond.dateCond)) return;
        } else if (cond.dateCond && cond.dateCond.field === 'ev' && (type === 'todo' || type === 'done')) {
          const ds = cond.dateCond.doneState;
          if (ds === 'undone' && type !== 'todo') return;
          if (ds === 'done' && type !== 'done') return;
          if (ds === 'any' && type !== 'todo' && type !== 'done') return;
        } else {
          if (!cond.rowTypes[type]) return;
        }
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
      // 正文有命中行 → 照常收；正文无命中但标题命中 → 仍收这张行程（其分组标题即来源标题，
      //   可经 groupHeadHtml 的切换徽标一键跳回来源）。不再压入独立的「标题命中」单元，
      //   避免与分组标题的切换徽标重复显示（2026-10-30 用户要求）。
      // 🆕 hideNoHitEvents：只列「含未完 checkbox（todo 行）」的事件，隐藏无子项的纯标题事件（如生日/纯日程）——
      //   用户 2026-11-03 明确不要这些没有任务的事件出现在「所有未完成的项目」。开启时无视 titleHit。
      //   ⚠️ 不能用 hits.length>0：normalizeSegment 会把 rowTypes 展开成「para/list/quote/heading 默认 true」，
      //      纯标题事件若带任意段落备注，其段落会被收进 hits → 误判「有命中」。本意是「含未完 checkbox」，
      //      故只看是否真有 type==='todo'（未打勾的 checkbox）行。
      const include = cond.hideNoHitEvents ? hits.some((h) => h.type === 'todo') : (hits.length || titleHit);
      if (include) groups.push({ ev, hits });
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
    const evDate = (ev && ev.date) ? ev.date : '';
    const evEnd = (ev && ev.endDate && ev.endDate !== evDate) ? ev.endDate : '';
    const date = evDate ? '（' + D.shortDate(evDate) + (evEnd ? ' – ' + D.shortDate(evEnd) : '') + '）' : '';
    const src = (ev && ev.src) ? ' · 📎 ' + D.esc(String(ev.src).trim()) : '';
    const head = HEADING_RE.test(title) ? title + date : '**' + title + '**' + date;
    return head + src;
  }
  function groupsToMd(groups, deps) {
    if (!groups || !groups.length) return '';
    return groups.map((g) => groupHeadMd(g.ev, deps) + (g.hits && g.hits.length ? '\n' + g.hits.map((h) => h.raw).join('\n') : '')).join('\n\n');
  }

  // ===== 分组标题（来源行程的标题）渲染成「可点整块＋📍 切换按钮」=====
  //   与标题命中项的「📍 切换回来源」同一机制：点击唤起主程式打开该来源行程表单
  //   （noteFindSameOpenSourceEvent → wake-main-from-note → tlOpenEventForm(uid)）。
  //   整块标题都可点（data-src＝来源行程 uid），让使用者一眼看到「这段内容来自哪张行程」并随手切换；
  //   标题前方放一个 gold 圆形「切换」徽标（class vsr-goto-source，外观仿编辑小圆点）。
  function groupHeadHtml(ev, deps) {
    const D = makeDeps(deps);
    const inner = D.inline(groupHeadMd(ev, D));   // 维持原本的标题（粗体/标题语义）＋日期＋来源档
    const src = (ev && ev.uid) ? ev.uid : '';
    const stitle = D.esc(String((ev && ev.title) || '').replace(/\s+/g, ' ').trim() || '(无标题)');
    // 切换徽标：放在标题「最前面」，外观仿照编辑小圆点（同尺寸圆形），但用 gold 主色与圆点（purple）区分——
    //   purple＝编辑/复制/找出相同；gold＝跳回来源行程。点击经 .vsr-goto-source 委托切换来源。
    //   ⚠️ 整块用 display:flex 横排（而非 block＋inline 徽标）：来源标题若本身是 # 标题会被渲染成 block 元素，
    //      inline 徽标会被挤到单独一行（台雄生日 即此例）；flex 横排可保证徽标与标题永远同一行。
    const dot = '<button type="button" class="vsr-goto-source" data-src="' + D.esc(src) +
      '" title="切换到来源：' + stitle + '"' +
      ' style="display:inline-flex;flex:none;width:13px;height:13px;padding:0;margin:0;align-items:center;justify-content:center;vertical-align:-2px;border:0;border-radius:50%;background:var(--gold,#D4AF37);color:#fff;font-size:9px;line-height:1;cursor:pointer;opacity:.85;-webkit-app-region:no-drag;">↪</button>';
    return '<div class="vsr-group-head" data-src="' + D.esc(src) + '" title="点击切换到来源：' + stitle + '"' +
      ' style="cursor:pointer;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;margin:2px 0 4px;">' + dot + inner + '</div>';
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
      out += groupHeadHtml(g.ev, D) + '\n';
      groupHitsIntoUnits(g.hits).forEach((u) => {
        out += u.task ? taskLineHtml(u.hits[0], g.ev, selfKey, D) + '\n'
          : nonTaskUnitHtml(u.hits, g.ev, selfKey, D) + '\n';
      });
    });
    return out;
  }

  // 段落标题（markdown）：多段落时渲染「段落 N：标题」；单段落与旧版一致不加标题。
  //   条件说明不再铺在便利贴里，改为悬停 tooltip（见 buildRef）。
  //   🆕 标题开头的 # 层级标记（#{1,6}）决定整段段落标题的层级：带 #＝用户自定层级（如 #→H1、##→H2），
  //      不带 #＝默认 H3（与旧版「### 段落 N：」一致）。这样 # 真的会改变渲染（层级不同、字号不同），
  //      且 # 在一行开头当标题标记用、不会变成字面符号，整行仍与「段落 N：」并成一行（满足「不要换行」）。
  function segmentHeaderMd(seg, i) {
    const titleRaw = seg.title ? String(seg.title).replace(/\s+/g, ' ').trim() : '';
    const m = titleRaw.match(/^(#{1,6})\s*/);          // 提取开头的标题层级
    const level = m ? m[1].length : 3;                // 默认 H3（与旧版一致）
    const body = m ? titleRaw.slice(m[0].length) : titleRaw;  // 去掉层级标记后的标题正文
    const hashes = '#'.repeat(level);
    return body ? (hashes + ' 段落 ' + (i + 1) + '：' + body) : (hashes + ' 段落 ' + (i + 1));
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
    // 🆕 searchTitle 对所有规则一致（不再 !r.builtin）：内置「提醒」规则现在可像自定义规则一样被编辑
    //   （改标题／加段落／改用关键词或标记收集），若仍对内置关掉标题搜索，编辑后的内置规则与同条件的自定义规则
    //   会产出不同结果——仅「标题命中」的事件（如标题里带 ⭐／关键词、正文无对应标记行）会被漏抓。
    //   默认内置（marker=remind、无关键词）标题里没有 [[remind:]]，searchTitle=true 对其行为无影响 → 零回归。
    const segResults = r.segments
      .filter(segmentHasCondition)
      .map((seg) => ({ seg, groups: collectGroups(events, seg, D, true) }));
    const totalHits = segResults.reduce((a, s) => a + s.groups.length, 0);
    if (totalHits === 0) {
      if (r.emptyBehavior === 'hide') return null;
      // 🆕 事件日期便利贴（任一段用 field==='ev'）0 命中时，给一句「这一天没有行程」比通用 EMPTY_NOTES 更贴切
      const isEvDate = segResults.some((sr) => sr.seg.dateCond && sr.seg.dateCond.field === 'ev');
      const emptyNotes = isEvDate
        ? '**这一天没有行程**\n\n事件本身的日期没匹配到任何日程。改日期条件请开便利贴菜单的「🧩 自定义 VIEW 便利贴设定维护作业」。'
        : EMPTY_NOTES;
      return Object.assign(base, { notes: emptyNotes, html: D.markdown(D.termDefs(emptyNotes)) });
    }
    const multi = segResults.length > 1;
    // 🆕 标题 tooltip 统一显示「所有段落」的设定摘要（单／多段落同一逻辑）：把每段的条件摘要合并后
    //    挂到便利贴标题文字上，鼠标悬停标题即见全部段落。多段落时每段标题（.vsr-seg-hd）再各挂「该段」条件，
    //    两者并存（用户要求每段也能单独看自己的条件）。
    const titleTipParts = segResults.map((sr, i) => {
      const seg = sr.seg;
      const label = multi
        ? ('段落' + (i + 1) + (seg.title ? '：' + seg.title : '') + '：')
        : (seg.title ? seg.title + '：' : '');
      return label + conditionText(seg);
    });
    base.titleTip = titleTipParts.join('\n');
    let notes = '';
    let html = '';
    const tabBtns = [];
    let segsHtml = '';
    segResults.forEach((sr, i) => {
      const g = sr.groups;
      const segNotes = groupsToMd(g, D);
      const segHtml = groupsToHtml(g, key, D);
      // 🆕 多段落时，把「该段」条件摘要挂到段落标题（.vsr-seg-hd，hover 段落 N 标题即见），
      //    与便利贴标题的「全部段落合并」tooltip 并存——用户要求每段也要能单独看自己的条件。
      const segTip = conditionText(sr.seg);
      let head = '', headHtml = '';
      if (multi) {
        head = segmentHeaderMd(sr.seg, i);
        const hr = D.markdown(D.termDefs(head));
        headHtml = '<div class="vsr-seg-hd"' + (segTip ? ' data-tip="' + D.esc(segTip) + '"' : '') + '>' + hr + '</div>';
      }
      const segInner = headHtml + (headHtml ? '\n' : '') +
        (g.length ? segHtml : D.markdown('> （这个段落目前没抓到任何行）'));
      // 🆕 多段落：每段一个页签按钮 + 一个内容面板（页签方式时只显示 active 面板）
      if (multi) {
        // 🆕 页签按钮只显示「描述」文字、隐藏「段落 N」字眼以节省横向空间；无描述时才回退「段落 N」
        const desc = (sr.seg.title ? String(sr.seg.title).replace(/^#{1,6}\s*/, '').trim() : '');
        const label = desc || ('段落 ' + (i + 1));
        // 🆕 胶囊只挂 data-tip（条件摘要 tooltip，由 CSS ::after 渲染）；不再挂原生 title="label"——
        // 原生 title 只会重复可见文字、且与自定义 tooltip 叠成双气泡，已无意义。
        // 标签文字包进 .vsr-tab-label 内层：省略号截断交給内层做，.vsr-tab 本身保持 overflow:visible，
        // 否则按钮的 overflow:hidden 会把定位在它下方(top:100%)的 ::after tooltip 整个裁掉（看不到）。
        tabBtns.push('<button type="button" class="vsr-tab' + (i === 0 ? ' vsr-active' : '') + '" data-seg="' + i + '"' +
          (segTip ? ' data-tip="' + D.esc(segTip) + '"' : '') + '><span class="vsr-tab-label">' + D.esc(label) + '</span></button>');
        segsHtml += (segsHtml ? '\n' : '') + '<div class="vsr-seg' + (i === 0 ? ' vsr-active' : '') + '" data-seg="' + i + '">' + segInner + '</div>';
      }
      const notesBlock = head + (head ? '\n' : '') + (g.length ? segNotes : '\n\n> （这个段落目前没抓到任何行）');
      notes += (notes ? '\n\n' : '') + notesBlock;
      if (!multi) {
        html += (html ? '\n' : '') + '<div class="vsr-seg">' + segInner + '</div>';
      }
    });
    // 🆕 多段落：包一层 .vsr-display，内含「顺序平铺／页签方式」随时切换控件 + 页签栏 + 内容面板。
    //    两种模式都在同一份 html 里，由便利贴端的 CSS + JS 决定显示哪种（默认顺序平铺，偏好记忆在 localStorage）。
    //    单段落（含 🔔 内置、旧版自定义）维持原样（不加 .vsr-display，无切换控件，零回归）。
    if (multi) {
      const toggle = '<div class="vsr-display-toggle" role="group" aria-label="显示方式">' +
        '<button type="button" class="vsr-mode-btn vsr-mode-flat vsr-active" data-mode="flat">顺序平铺</button>' +
        '<button type="button" class="vsr-mode-btn vsr-mode-tabs" data-mode="tabs">页签方式</button>' +
        '</div>';
      const tabs = '<div class="vsr-tabs">' + tabBtns.join('') + '</div>';
      html = '<div class="vsr-display vsr-mode-flat" data-segs="' + segResults.length + '">' +
        toggle + '\n' + tabs + '\n' + '<div class="vsr-segs">\n' + segsHtml + '\n</div></div>';
    }
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
