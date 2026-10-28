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
  function normalizeRule(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const rt = r.rowTypes && typeof r.rowTypes === 'object' ? r.rowTypes : {};
    const kw = Array.isArray(r.keywords) ? r.keywords
      : (typeof r.keywords === 'string' ? String(r.keywords).split(/[,，、\n]/) : []);
    const marker = MARKERS.some((m) => m.value === r.marker) ? r.marker : '';
    return {
      id: String(r.id == null ? '' : r.id),
      title: String(r.title == null ? '' : r.title).replace(/\s+/g, ' ').trim() || '自定义便利贴',
      enabled: r.enabled !== false,
      keywords: kw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean),
      keywordMode: r.keywordMode === 'ALL' ? 'ALL' : 'ANY',
      marker: marker,
      caseSensitive: !!r.caseSensitive,
      emptyBehavior: r.emptyBehavior === 'hide' ? 'hide' : 'show',
      builtin: r.builtin === true,
      readonly: r.readonly === true || r.builtin === true,
      rowTypes: {
        todo: rt.todo !== false,
        done: rt.done === true,        // 默认不收已打勾（与 🔔 同口径：打勾＝不必再提醒）
        list: rt.list !== false,
        para: rt.para !== false,
        quote: rt.quote !== false,
        heading: rt.heading !== false
      }
    };
  }
  function normalizeList(list) {
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r === 'object').map(normalizeRule);
  }
  function newRuleId() { return 'vsr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }
  function blankRule() { return normalizeRule({ id: newRuleId(), title: '' }); }
  function builtinRules() { return [normalizeRule(BUILTIN_REMIND_RULE)]; }

  // 这一行是否命中规则（三个条件是 AND；关键词／标记都没设＝不收，否则会整本行程洗进贴纸）
  function ruleHasCondition(rule) {
    return rule.keywords.length > 0 || !!rule.marker;
  }
  function lineHitsRule(line, trimmed, rule) {
    if (rule.marker && !new RegExp('\\[\\[' + rule.marker + ':', 'i').test(line)) return false;
    if (!rule.keywords.length) return true;
    const hay = rule.caseSensitive ? trimmed : trimmed.toLowerCase();
    const ok = rule.keywords.map((k) => (rule.caseSensitive ? k : k.toLowerCase()))
      .filter((k) => k).map((k) => hay.indexOf(k) >= 0);
    return rule.keywordMode === 'ALL' ? ok.every(Boolean) : ok.some(Boolean);
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

  // ===== 收集：规则 ＋ 全部行程 → 分组（结构与 🔔 的 tlViewStickyGroups 逐字相同）=====
  //   回传 [{ ev, hits }]，hits＝[{ raw, line, uid, text, task, type }]＋分隔用空行 { raw:'', sep:true }。
  //   line＝来源行程备注里的 0-based 行号；text＝checkbox 内文（便利贴窗右键「找出相同」要比对的字）。
  //   收哪些行：围栏程式码块内的标记是范例→不收；其余按 rowTypes／关键词／标记过滤。
  //   ⚠️ 「列表项」后面直接接「非列表行」＝CommonMark 的 lazy continuation，会被并到上一条里面，
  //      所以中间要补一个空行（收集来的行原本未必相邻，源档的空行不会一起带过来）。
  function collectGroups(events, rule, deps) {
    const D = makeDeps(deps);
    const groups = [];
    if (!ruleHasCondition(rule)) return groups;
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
        if (!rule.rowTypes[type]) return;
        if (!lineHitsRule(line, t, rule)) return;
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
  function groupsToHtml(groups, selfKey, deps) {
    const D = makeDeps(deps);
    let out = '';
    (groups || []).forEach((g) => {
      out += D.inline(groupHeadMd(g.ev, D)) + '\n';
      g.hits.forEach((h) => {
        if (h.sep) return;
        out += h.task ? taskLineHtml(h, g.ev, selfKey, D) + '\n'
          : D.markdown(D.termDefs(h.raw)) + '\n';
      });
    });
    return out;
  }

  // ===== 一张自定义投影贴 =====
  //   回传 null 只有两种：规则关闭、或一个命中条件都没设（＝还没填好，不是「抓完发现没有」）。
  //   有条件但 0 命中 → 照建一张，贴面写明原因（见 EMPTY_NOTES）。
  function buildRef(rule, events, deps) {
    const D = makeDeps(deps);
    const r = normalizeRule(rule);
    if (!r.enabled) return null;                     // 关闭的规则＝不要这张贴
    // 一个条件都没设（无关键词也无标记）＝还没填好，不是「抓完发现没有」：
    // 维护窗已经用「⚠ 没有条件（不会抓到内容）」直接提示这一条，这里不再开一张空贴，
    // 更重要的是绝不能把整本行程洗进贴纸。
    if (!ruleHasCondition(r)) return null;
    const groups = collectGroups(events, r, D);
    const notes = groupsToMd(groups, D);
    const key = viewKeyOf(r.id);
    const base = {
      key, idx: 0, view: true, customView: true, ruleId: r.id,
      titleHtml: D.inline(r.title), title: r.title, date: '', endDate: '', color: '', done: false, tags: [], src: ''
    };
    // 一条都没命中也照建一张（2026-10-27 使用者要求）：静默消失让人分不清「规则没生效」还是「行程里就是没有」，
    // 所以把原因写在贴面上。⚠️ 只有自订规则走这里——🔔 提醒的母本在 calendar-editor.js，仍是没内容就没这张贴。
    if (!notes && r.emptyBehavior !== 'hide') {
      return Object.assign(base, { notes: EMPTY_NOTES, html: D.markdown(D.termDefs(EMPTY_NOTES)) });
    }
    if (!notes) return null;
    return Object.assign(base, { notes, html: groupsToHtml(groups, key, D) });
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
    normalizeRule: normalizeRule, normalizeList: normalizeList,
    newRuleId: newRuleId, blankRule: blankRule, builtinRules: builtinRules,
    ruleHasCondition: ruleHasCondition,
    EMPTY_NOTES: EMPTY_NOTES,
    rowTypeOf: rowTypeOf, collectGroups: collectGroups, groupHeadMd: groupHeadMd,
    groupsToMd: groupsToMd, groupsToHtml: groupsToHtml, taskLineHtml: taskLineHtml,
    buildRef: buildRef, buildRefs: buildRefs
  };
})(typeof window !== 'undefined' ? window : globalThis);
