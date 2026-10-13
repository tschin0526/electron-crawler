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
    // 默认视图：'year'（第十一批依用户截图设定改为年；此前为 'month'）
    let tlCalMode = 'year';
    let tlCalCursor = new Date();
    let tlCalSelected = null;
    let tlListSel = null;    // 列表模式：< > / 「今天」导航到的「选中日」（金色描边）
    // 列表模式滚动锚点标志：仅当用户显式导航（今天 / < >）时才为 true，渲染时据此把列表滚到锚点日；
    // 否则一律恢复到「渲染前的滚动位置」(prevScrollTop)，绝不任意自动滚动（2026-09-30 用户反馈）
    let tlListScrollAnchorPending = false;
    // 年/月「下方明细」(tlRenderYearDayList / tlRenderDayList) 滚动锚点标志：语义同上，仅覆盖 年/月 明细表身。
    // 仅当 今天按钮 / 点选日期格 时才为 true；编辑存档 / 过滤 / 搜索 / 切范围 / < > 一律恢复 prevScrollTop（2026-09-30 用户反馈）
    let tlDetailListScrollPending = false;
    // ⚠️ 加载标记（一次性）：确认本文件已生效。若硬刷新后 DevTools Console 看不到这行 → 跑的是旧缓存脚本
    if (!window.__calEditorLoaded) { window.__calEditorLoaded = true; console.log('[calendar-editor] 已加载 — 滚动策略(2026-09-30-v3)：进入程式 / 切换 列表·日·月·周·年 模式 / 按「今天」/ 点选日期格 → 表身滚到今天；编辑存档 / 过滤 / 搜索 / 切范围 / < > 不自动滚动'); }
    // 下方明细显示范围：'day'=选定日单日 / 'full'=整月（月模式）·整周（周模式）·整年（年模式）。仅内存态，不持久化。
    // 第十一批：年视图默认 'full'（整年＝「表身 默认 by 年」）；月/週/日仍默认 'day'（见 tlSetMode，尊重「默认以日显示」）。
    // 初始值取年视图默认（'full'）——因 tlCalMode 现已默认 'year'（第十一批）。
    let tlCalScope = 'full';
    let tlCalEvents = [];
    let tlIncludedEvents = [];    // 📎 include 进来的 calendar-*.md 事件（只读，ro=true）
    let tlCalHolidays = [];    // ## HOLIDAY 解析結果（与 ## EVENT 同结构，多 holidayType 字段）；仅列表/日志视图显示，不进时间网格/月格 chip
    let tlCalDiaries = [];     // ## DIARY 解析結果（每天一条，keyed by date）；行事历日期旁显示日记按钮，有则打勾
    let tlIncludedHolidays = [];  // 📎 include 进来的只读假日
    let tlIncludedDiaries = [];   // 📎 include 进来的只读日记
    let tlIncludedFiles = [];    // 📎 include 加载的文件清单 [{ name, size }]（供「加载清单」按钮展示，含全部同目录 calendar-*.md，不只勾选的）
    let tlIncludeListBound = false; // 📎 Include 弹窗的 change 委托监听器是否已绑定（只绑一次）
    let tlCalTagFilter = [];   // 标签过滤（空＝全部；OR 逻辑：事件 tags 命中任一即显示）
    let tlCalRegionFilter = [];   // ## HOLIDAY 地区过滤（图例 checkbox 勾选；第十一批依用户截图设定：默认为空＝不显示任何地区假日；只影响显示，不改数据）
    let tlCalShowEvents = true;   // 分类显示：普通行程 EVENT（默认勾选；只影响显示，不改数据）
    let tlCalShowRepeat = 'next';   // 分类显示：重复行程 REPEAT 三态（none=隐藏 / next=只显示未来最近一次 / some=最近前一次+未来4次≤5；第十一批依用户截图设定默认 'next'；只影响显示，不改数据）
    // 📋 「跨天行程」在列表模式里显示几笔（纯 UI 偏好：内存 + localStorage，绝不写回 calendar.md）
    //    'multi'（默认）＝跨几天就显示几笔（每天一笔，与「日」范围同口径）；
    //    'one'＝整段跨天只在「起始日」显示一笔。
    //    ⚠️ 只作用于列表模式（tlRenderList）；月/週/日三种模式一律不受影响。
    let tlCalMultiDayMode = 'multi';
    let tlMultiDayLoaded = false;
    // 📓 「只显示日记」：列表模式专属的显示过滤（纯 UI 偏好：内存 + localStorage，绝不写回 calendar.md）
    //    勾选后列表只列「有日记」的日期（每篇日记渲染成一条，含内容预览）；行程 EVENT/REPEAT 与假日 HOLIDAY 一律不参与。
    //    ⚠️ 只作用于列表模式（tlRenderList）；月/週/日三种模式一律不受影响。
    let tlCalDiaryOnly = false;
    let tlDiaryOnlyLoaded = false;
    // 📆 年视图自动滚动：切到年视图 / 点「今天」 / 首次打开行程视图时，若当前月份未完整显示，则滚动使其可见。
    //    由触发点设 tlYearAutoScrollPending=true，tlRenderYear 渲染后消费一次，避免选择日期等重绘时重复滚动。
    let tlYearAutoScrollPending = false;
    // 📅 月视图自动滚动：切到月视图 / 点「今天」 / 首次打开行程视图时，若「今天」日期格未完整显示，则滚动使其可见。
    let tlMonthAutoScrollPending = false;
    // 📎 程式启动首渲：面板尚未布局，滚动函数会因 rect 全 0 误判「已完整显示」而跳过；
    //    故进入行程视图后延迟到布局就绪再自动按一次「今天」按钮（只触发一次，避免与用户操作打架）。
    let tlStartupScrollDone = false;
    // ☐ 「只显示未完成」：全模式生效（年/月/周/日/列表）的显示过滤（纯 UI 偏好：内存 + localStorage，绝不写回 calendar.md）
    //    勾选后隐藏已完成（done ✓）的行程，只看未完成；假日无完成态、不受影响。⚠️ 收口于 tlEventShown（所有视图自动生效，无需每处重复过滤）。
    //    第十一批依用户截图设定：默认「开」（新环境未设 localStorage 时即勾选）。
    let tlCalUndoneOnly = true;
    let tlUndoneOnlyLoaded = false;
    let tlUndoneScrollResult = null;   // 测试 seam：undone 勾选切换后实际滚动到的日期组（null＝无列表/无锚点）
    let tlEvFormTodoIds = [];   // 表单内「关联 Todo 卡片」临时列表（仅编辑期，不污染存档对象）
    let tlEvFormUid = null;
    let tlEvFormColor = null;
    let tlEvFormSticky = 0;   // 🆕 桌面便利贴 instance 数（表单临时值，不污染存档对象）

    // 表单内「＋ CheckBox」按钮旁的便利贴小图标：sticky>0 才显示（开表单时载入 + sticky 字段改动时实时同步）
    function tlSyncStickyFlag() {
      const flag = document.getElementById('tlEvFStickyFlag');
      if (!flag) return;
      const v = parseInt((document.getElementById('tlEvFSticky') || {}).value, 10) || 0;
      flag.style.display = v > 0 ? '' : 'none';
    }

    // 🆕 便利贴小图标：与工具栏 #tlStickyBtn 用的同一段 SVG（淡黄折叠便签造型），保证视觉一致
    const TL_STICKY_IC_SVG = '<svg class="ev-sticky-ic" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="2.8" y="2.8" width="18.4" height="18.4" rx="2.2" fill="#FCEFA4"/><path d="M3 18.4c0 1.5 1.2 2.8 2.8 2.8h14.4v-2.8H3Z" fill="#F7E694"/><path d="M21.2 14.8v3.6c0 1.5-1.2 2.8-2.8 2.8h-3.6l6.4-6.4Z" fill="#FDF6C8"/><path d="M21.2 14.8 14.8 21.2" stroke="#E8CE7C" stroke-width=".7" stroke-linecap="round" fill="none"/><rect x="8.6" y="6.1" width="6.8" height="1.9" rx=".95" fill="#F0C860"/><rect x="9.1" y="6.5" width="5.8" height=".8" rx=".4" fill="#FFF3C0"/><path d="M6.6 11.4h10.8M6.6 14.2h7.6" stroke="#EBD88F" stroke-width=".9" stroke-linecap="round" fill="none"/></svg>';
    let tlEvFormTags = [];
    let tlEvTagEditIndex = -1;   // 正在内联编辑分类的选中标签下标（-1＝无）
    let tlEvTagEditLevel = 'cat';
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
        tlRefreshIncludedEvents(); // 📎 打开/切入 calendar.md 时，加载同目录 calendar-*.md（只读合并；加载完自动重绘）
      } else if (calEventsView) {
        setCalEventsView(false);
      }
    }

    // 📎 合并 include 进来的只读事件（渲染统一走 tlCalEvents，只读约束靠 ro 标记 + 写回过滤）
    function tlAllEvents(md) { return (tlParseEvents(md) || []).concat(tlIncludedEvents || []); }
    function tlAllHolidays(md) { return (tlParseHolidays(md) || []).concat(tlIncludedHolidays || []); }
    function tlAllDiaries(md) { return (tlParseDiaries(md) || []).concat(tlIncludedDiaries || []); }
    // 📎 加载同目录 calendar-*.md（结构与 calendar.md 相同：EVENT / HOLIDAY / DIARY）并解析为只读数据：
    //   - 外部文件模式：目录 = externalFilePath 所在目录，读取走 readFileByPath
    //   - 内部 md 模式：目录 = TODO_DATA_DIR（getTodoDataDir），读取走 readMdFile
    async function tlRefreshIncludedEvents() {
      if (!isCalendarMdDoc()) { tlIncludedEvents = []; tlIncludedHolidays = []; tlIncludedDiaries = []; tlIncludedFiles = []; return; }
      const api = window.electronAPI || {};
      try {
        let dir = null, isExt = false;
        const t = currentFileTarget();
        if (t && t.kind === 'ext' && t.path) {
          dir = String(t.path).replace(/[\\/][^\\/]*$/, '');
          isExt = true;
        } else if (api.getTodoDataDir) {
          const r = await api.getTodoDataDir();
          dir = (r && r.data) ? String(r.data) : null;
        }
        if (!dir || !api.listAllFilesInDir) return;
        const ls = await api.listAllFilesInDir(dir);
        const items = (((ls && ls.data) || []).map((it) => ({ name: it && it.name, size: (it && it.size) || 0 })))
          .filter((it) => it.name && /^calendar-.+\.md$/i.test(it.name) && it.name.toLowerCase() !== 'calendar.md')
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const names = items.map((it) => it.name);
        // 📎 勾选过滤：只加载 INCLUDE 区块里标记为 '+' 的文件；区块缺失则默认全部加载
        const sel = tlParseIncludeSel(document.getElementById('taskText').value, names);
        tlIncludedFiles = items.slice(); // 📎 弹窗展示用「全部」文件（含未勾选），不只是已加载的
        const merged = [], mergedHolidays = [], mergedDiaries = [];
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (!sel.has(name)) continue; // 📎 未勾选 → 跳过（动态释放）
          let content = '';
          if (isExt) {
            if (api.readFileByPath) {
              const rr = await api.readFileByPath(dir + '/' + name);
              content = (rr && rr.success) ? (rr.content || '') : '';
            }
          } else if (api.readMdFile) {
            const rr = await api.readMdFile(name.replace(/\.md$/i, ''));
            content = (rr && rr.success) ? (rr.content || '') : '';
          }
          tlParseEvents(content).forEach((ev, j) => {
            ev.ro = true;
            ev.src = name;
            ev.uid = 'ro-' + i + '-' + j + '-' + ev.uid;   // 全局唯一，避免与 calendar.md 的 evpN 冲突
            merged.push(ev);
          });
          tlParseHolidays(content).forEach((h, j) => { h.ro = true; h.src = name; h.uid = 'ro-' + i + '-' + j + '-h-' + h.uid; mergedHolidays.push(h); });
          tlParseDiaries(content).forEach((d) => { d.ro = true; d.src = name; mergedDiaries.push(d); });
        }
        tlIncludedEvents = merged;
        tlIncludedHolidays = mergedHolidays;
        tlIncludedDiaries = mergedDiaries;
      } catch (e) {
        tlIncludedEvents = []; tlIncludedHolidays = []; tlIncludedDiaries = []; tlIncludedFiles = [];
      }
      if (calEventsView) {
        tlRenderEventsContent();
        // 📎 include 加载是启动最后一步：其重渲（无「今天」pending）会把提前滚好的位置还原；
        //    故在此「最后一次启动渲染」之后再自动按一次「今天」按钮，确保滚动真正生效并留下。
        tlTriggerStartupToday();
      }
    }

    // 📂 Include 加载清单：列出同目录被 include 的 calendar-*.md 及其大小
    function tlFormatSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function tlOpenIncludeList() {
      const body = document.getElementById('tlIncludeListBody');
      const fileEl = document.getElementById('tlIncludeListFile');
      const list = tlIncludedFiles || [];
      const sel = tlParseIncludeSel(document.getElementById('taskText').value, list.map((f) => f.name));
      if (fileEl) fileEl.textContent = '已加载 ' + list.filter((f) => sel.has(f.name)).length + ' / 共 ' + list.length + ' 个文件';
      if (!body) return;
      if (!list.length) {
        body.innerHTML = '<div class="tl-include-empty">同目录下没有其他 calendar-*.md 文件</div>';
      } else {
        body.innerHTML = list.map((f) => {
          const on = sel.has(f.name);
          return '<label class="tl-include-item">' +
            '<input type="checkbox" class="tl-include-check" data-name="' + tlEscapeHtml(f.name) + '"' + (on ? ' checked' : '') + '>' +
            '<span class="fname">' + tlEscapeHtml(f.name) + '</span>' +
            '<span class="fsize">' + tlFormatSize(f.size) + '</span></label>';
        }).join('');
      }
      // 📎 绑定一次：行内 checkbox 勾选变化 → 立即写入 calendar.md 并动态重新加载
      if (!tlIncludeListBound && body) {
        body.addEventListener('change', (e) => {
          const cb = e.target.closest('.tl-include-check');
          if (!cb) return;
          tlSetInclude(cb.getAttribute('data-name'), cb.checked);
        });
        tlIncludeListBound = true;
      }
      const ov = document.getElementById('tlIncludeListOverlay');
      if (ov) ov.style.display = 'flex';
    }
    // 📎 勾选/取消勾选某个 include 文件：写回 ## INCLUDE 区块 → 立即持久化 → 立即动态重载（加载/释放）
    function tlSetInclude(name, on) {
      const names = (tlIncludedFiles || []).map((f) => f.name);
      if (!names.includes(name)) return;
      const sel = tlParseIncludeSel(document.getElementById('taskText').value, names);
      if (on) sel.add(name); else sel.delete(name);
      const list = names.map((n) => ({ name: n, on: sel.has(n) }));
      tlWriteIncludeBlock(list);
      // 立即落盘（含外部文件模式）：写回 calendar.md，供下次启动按勾选加载 + 跨设备同步
      if (typeof saveTask === 'function') { try { saveTask(false, true); } catch (e) {} }
      // 立即动态重载：勾选→出现，取消→释放，无需重开文件
      tlRefreshIncludedEvents();
      // 刷新弹窗计数（列表本身状态已由 checkbox 反映）
      const fileEl = document.getElementById('tlIncludeListFile');
      if (fileEl) fileEl.textContent = '已加载 ' + list.filter((it) => it.on).length + ' / 共 ' + list.length + ' 个文件';
    }
    function tlCloseIncludeList() {
      const ov = document.getElementById('tlIncludeListOverlay');
      if (ov) ov.style.display = 'none';
    }

    function toggleCalEventsView() {
      setCalEventsView(!calEventsView);
    }

    function setCalEventsView(on) {
      if (on && !isCalendarMdDoc()) return;
      calEventsView = !!on;
      const btn = document.getElementById('calEventsBtn');
      if (btn) btn.classList.toggle('active', calEventsView);
      // 🔎 搜索框占位符随视图切换：行程视图搜的是「画面上渲染出来的内容」，不是 calendar.md 源码
      const si = document.getElementById('editSearchInput');
      if (si) si.placeholder = calEventsView ? '搜索当前视图...' : '搜索内容...';
      if (calEventsView) {
        showCalEventsPaneOnly();
        // 首次/重新进入行程视图：网格滚动到当前月份/今天；表身明细（年/月/周/日）或列表滚到今天
        if (tlCalMode === 'year') tlYearAutoScrollPending = true;
        if (tlCalMode === 'month') tlMonthAutoScrollPending = true;
        if (tlCalMode === 'list') tlListScrollAnchorPending = true;
        else tlDetailListScrollPending = true;
        tlRenderEventsContent();
        tlApplyCalLayout();
      } else {
        // 交还给原模式：这里先收掉面板，再由 toggleMdPreview 按 previewMode 重新显示
        // （toggleMdPreview 内部会一并清掉 #mdPreview 上的内联 display:none）
        const pane = document.getElementById('calEventsPane');
        if (pane) pane.style.display = 'none';
        toggleMdPreview(previewMode);
      }
    }

    // 行程视图下：隐藏三个输入框 + 预览 + 三套工具栏，只显示行程面板

    // 📎 程式启动自动滚到今天：在「include 加载完成后的最后一次渲染」之后调用（见 tlRefreshIncludedEvents）。
    //    仅触发一次：等行程面板真正可见（有高度）后按一次「今天」按钮；按钮逻辑里的滚动函数
    //    若遇容器未布局会自延后重试（见 tlScrollYearToCurrentMonth / tlScrollMonthToToday / tlScrollElToTop），直到真正滚到今天。
    function tlTriggerStartupToday() {
      if (tlStartupScrollDone) return;
      tlStartupScrollDone = true;
      let tries = 0;
      const waitPane = () => {
        const pane = document.getElementById('calEventsPane');
        if (!pane || !pane.offsetHeight) { // 面板还没开/动画中 → 下帧再试（上限 120 帧 ≈ 2s）
          if (tries++ < 120) requestAnimationFrame(waitPane);
          return;
        }
        const tb = document.getElementById('tlEvTodayBtn');
        if (tb) tb.click(); // 面板可见后按一次「今天」：重设游标/选中日 + 设 pending + 重渲并滚动
      };
      requestAnimationFrame(waitPane);
    }    function showCalEventsPaneOnly() {
      const ids = ['taskText', 'htmlText', 'jsonText', 'mdPreview'];
      ids.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      // 撤销/重做钮是 #editorToolbar 的直接子元素（位于 #mdTools 分组之外），隐藏行程视图时一并收起，
      // 否则它们会遗留在行程面板工具栏、却只改动隐藏的 taskText 缓冲（行程面板不重绘，且会被自动保存静默写回）
      ['mdTools', 'htmlTools', 'jsonTools', 'undoBtn', 'redoBtn'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      const pane = document.getElementById('calEventsPane');
      if (pane) pane.style.display = '';
    }

    // ===== 解析（与桌面 calendar 插件 parseMarkdownEvents 对齐） =====
    function tlParseArr(s) {
      s = (s || '').trim();
      if (!s) return [];
      try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    // ===== 標籤結構：{name, cat?, subcat?}；舊資料純字串自動升級 =====
    function tlTagName(t) { return (t && typeof t === 'object') ? (t.name || '') : (t || ''); }
    function tlTagCat(t) { return (t && typeof t === 'object') ? (t.cat || '') : ''; }
    function tlTagSubcat(t) { return (t && typeof t === 'object') ? (t.subcat || '') : ''; }
    function tlTagLabel(t) { const n = tlTagName(t), c = tlTagCat(t), s = tlTagSubcat(t); return n + (c ? '·' + c : '') + (s ? '·' + s : ''); }
    function tlNormalizeTags(arr) {
      return (Array.isArray(arr) ? arr : []).map((t) => (t && typeof t === 'object')
        ? { name: t.name || '', cat: t.cat || '', subcat: t.subcat || '' }
        : { name: String(t || ''), cat: '', subcat: '' });
    }
    // ===== 標籤父階（樹形結構）：標籤名 → 父標籤名，集中存於 calendar.md 的 ## TAGS 區塊 =====
    // ⚠️ 與事件/日記不同：標籤父階是全文件級元數據（一棵標籤名組成的樹），不依附於單一事件，
    //    故單獨收口在 ## TAGS（JSON map：標籤名 → 父標籤名；缺省或空字串＝根）。
    //    右键标签 → 编辑 → 画面显示「子标签列表」（child tag names）＋ 可设定「父阶标签」。
    function tlParseTagsMeta(md) {
      const map = {};
      const blocks = String(md || '').split(/^##[ \t]*TAGS[ \t]*$/m);
      if (blocks.length < 2) return map;
      let chunk = blocks[1];
      const cut = chunk.search(/^##[ \t]/m);
      if (cut >= 0) chunk = chunk.slice(0, cut);
      const m = chunk.match(/\{[\s\S]*\}/);
      if (m) { try { const o = JSON.parse(m[0]); if (o && typeof o === 'object') { for (const k in o) if (typeof o[k] === 'string') map[k] = o[k]; } } catch (e) {} }
      return map;
    }
    function tlSerializeTagsMeta(map) {
      const clean = {};
      for (const k in map) if (k) clean[k] = (map[k] || '');
      return '## TAGS\n' + JSON.stringify(clean);
    }
    // 把最新父階表寫回 calendar.md 緩衝（taskText）；已存在 ## TAGS 區塊則替換其內容，否則追加
    function tlWriteTagsMeta(map) {
      let md = document.getElementById('taskText').value;
      const body = tlSerializeTagsMeta(map);
      const idx = md.search(/^##[ \t]*TAGS[ \t]*$/m);
      if (idx >= 0) {
        const after = md.slice(idx);
        const next = after.search(/\n##[ \t]/m);
        const end = next >= 0 ? idx + next : md.length;
        md = md.slice(0, idx) + body + md.slice(end);
      } else {
        md = md.replace(/\s*$/, '') + '\n\n' + body + '\n';
      }
      document.getElementById('taskText').value = md;
    }
    function tlTagMeta() { return tlParseTagsMeta(document.getElementById('taskText').value); }
    // ===== Include 加载清单：勾选状态存于 calendar.md 的 ## INCLUDE 区块 =====
    // 每行一个同目录 calendar-*.md 文件，前缀 '+' = 加载 / '-' = 不加载（与 LITE 共用此格式）。
    // 区块不存在（老文件）或区块无有效行时，默认「全部加载」（与改前行为一致；默认 A）。
    // allNames：当前目录枚举到的全部 calendar-*.md 文件名（不含 calendar.md），用于「缺省全选」回退。
    function tlParseIncludeSel(md, allNames) {
      const set = new Set();
      const blocks = String(md || '').split(/^##[ \t]*INCLUDE[ \t]*$/m);
      if (blocks.length < 2) { (allNames || []).forEach((n) => set.add(n)); return set; }
      let chunk = blocks[1];
      const cut = chunk.search(/^##[ \t]/m);
      if (cut >= 0) chunk = chunk.slice(0, cut);
      let hasLine = false;
      chunk.split(/\r?\n/).forEach((ln) => {
        const m = ln.match(/^\s*([+\-])\s+(.+?)\s*$/);
        if (m) { hasLine = true; if (m[1] === '+') set.add(m[2]); }
      });
      if (!hasLine) (allNames || []).forEach((n) => set.add(n));
      return set;
    }
    // 把勾选列表序列化：list = [{ name, on }]；on=true → '+ name'，否则 '- name'
    function tlSerializeInclude(list) {
      let body = '## INCLUDE\n';
      (list || []).forEach((it) => { body += (it.on ? '+ ' : '- ') + it.name + '\n'; });
      return body.replace(/\n$/, '');
    }
    // 把最新勾选列表写回 calendar.md 缓冲（taskText）；已存在 ## INCLUDE 区块则替换其内容，否则追加
    function tlWriteIncludeBlock(list) {
      let md = document.getElementById('taskText').value;
      const body = tlSerializeInclude(list);
      const idx = md.search(/^##[ \t]*INCLUDE[ \t]*$/m);
      if (idx >= 0) {
        const after = md.slice(idx);
        const next = after.search(/\n##[ \t]/m);
        const end = next >= 0 ? idx + next : md.length;
        md = md.slice(0, idx) + body + md.slice(end);
      } else {
        md = md.replace(/\s*$/, '') + '\n\n' + body + '\n';
      }
      document.getElementById('taskText').value = md;
    }
    function tlTagParent(name) { return (tlTagMeta()[name] || ''); }
    function tlTagChildren(name) { const m = tlTagMeta(); return Object.keys(m).filter((k) => m[k] === name); }
    function tlAllTagNames() {
      const set = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { const n = tlTagName(t); if (n) set.add(n); }));
      const m = tlTagMeta();
      Object.keys(m).forEach((k) => { if (k) set.add(k); });
      Object.keys(m).forEach((k) => { if (m[k]) set.add(m[k]); });
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    }
    // 防止成環：start 是否為 root 的（間接）後代（沿父階向上走，若撞到 root 即為後代）
    function tlIsDescendant(start, root, m) {
      m = m || tlTagMeta();
      let cur = start, guard = 0;
      while (cur && guard++ < 1000) { if (cur === root) return true; cur = m[cur]; }
      return false;
    }
    // 設定/解除父階（parent==='' 或不存在 → 根）。返回 false 表示會成環被拒絕
    function tlSetTagParent(name, parent) {
      parent = (parent || '').trim();
      if (!name || parent === name) return false;
      const m = tlTagMeta();
      if (parent && tlIsDescendant(parent, name, m)) return false;
      if (parent) m[name] = parent; else delete m[name];
      tlWriteTagsMeta(m);
      return true;
    }
    // ===== Remark 围栏：备注正文可能本身含 ``` 代码围栏 → 按 CommonMark 规则处理 =====
    // 写入：围栏长度取 max(3, 备注内最长反引号串+1)，保证正文的 ``` 不可能闭合外层围栏
    function tlRemarkFence(notes) {
      const runs = String(notes || '').match(/`+/g) || [];
      const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
      return '`'.repeat(Math.max(3, longest + 1));
    }
    // 读取：开启围栏＝首个仅由 3+ 反引号组成的行；闭合围栏＝其后首个长度 ≥ 开启长度的反引号行（CommonMark：闭合围栏须 ≥ 开启长度）
    function tlExtractRemark(rest) {
      const lines = String(rest || '').split('\n');
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
    function tlParseBlock(block, idx) {
      let remark = '';
      let head = block;
      const ri = block.indexOf('- Remark:');
      if (ri >= 0) {
        head = block.slice(0, ri);
        // ⚠️ 不能用非贪婪 /```([\s\S]*?)```/：备注正文含 ``` 时会在正文首个 ``` 处提前闭合，吞掉其后内容（2026-09-30 用户反馈）
        remark = tlExtractRemark(block.slice(ri + '- Remark:'.length));
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
        tags: tlNormalizeTags(tlParseArr(get('tags'))),
        // 修复：此前缺读 todoIds，往返保存会把 calendar 插件写入的关联卡片清空
        todoIds: tlParseArr(get('todoIds')),
        // ## HOLIDAY 比 ## EVENT 多一个 holidayType 字段（workday/holiday/festival），事件解析为空字符串即可
        holidayType: get('holidayType') || '',
        // 地区：cn 中国大陆 / hk 香港 / tw 台湾（可扩展）；缺省 '' 渲染时回退 cn（向后兼容旧数据）
        region: get('region') || '',
        notes: remark,
        // ===== ## EVENT(REPEAT) 重複事件字段（空＝不重複）=====
        repeatMode: get('repeatMode') || '',
        repeatInterval: get('repeatInterval') || '',
        repeatWeekDay: tlParseArr(get('repeatWeekDay')),
        repeatMonthDay: get('repeatMonthDay') || '',
        repeatYearMonthDay: get('repeatYearMonthDay') || '',
        repeatEndType: get('repeatEndType') || '',
        repeatEndValue: get('repeatEndValue') || '',
        repeatExcludeDates: tlParseArr(get('repeatExcludeDates')),
        // 🆕 桌面便利贴：instance 数（缺省 0 = 不显示为便利贴）；同事件可同时显示多张
        sticky: parseInt(get('sticky'), 10) || 0
      };
    }
    function tlParseEvents(md) {
      if (!md) return [];
      const out = [];
      const blocks = String(md).split(/^##[ \t]*EVENT(?:\([^)]*\))?[ \t]*$/m);
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
        // 同理：假日块尾巴可能粘着后面的 ## EVENT（含 (REPEAT)）块 → 先在该标记处截断
        const cut = blocks[i].search(/^##[ \t]*EVENT(?:\([^)]*\))?[ \t]*$/m);
        const h = tlParseBlock(cut >= 0 ? blocks[i].slice(0, cut) : blocks[i], i);
        if (h) out.push(h);
      }
      return out;
    }

    // ===== ## DIARY 解析 / 序列化（每天一条，keyed by date；行事历日期旁按钮打勾）=====
    // 块格式（桌面 + LITE 共用）：
    // ## DIARY
    // - date: `2026-09-20`
    // - title: `今日交易复盘`
    // - mood: `平稳`
    // - tags: `["投资","自我总结"]`
    // - weather: `多云`
    // - content:        ← 多行正文走代码块（与 Remark 同约定：非贪婪截取，避免吞掉后续 ## 块）
    // ```
    // 今天大盘震荡，持仓观察。
    // ```
    // - remark: `晚间复盘再核对数据`
    function tlParseDiaryBlock(block, idx) {
      let content = '';
      let head = block;
      const ci = block.indexOf('- content:');
      if (ci >= 0) {
        const after = block.slice(ci + '- content:'.length);
        // ⚠️ 必须非贪婪：与 Remark 同一坑（曾用贪婪版会吞掉紧随其后的 ## EVENT/## HOLIDAY 原文）
        const m = after.match(/```([\s\S]*?)```/);
        if (m) {
          content = m[1].replace(/^\n/, '').replace(/\n$/, '');
          if (content.trim() === '') content = '';
          // ⚠️ 只摘掉整段 content 區（含 - content: 與首尾 ```），讓 remark 等「位於 content 之後」的欄位不被它隔斷而丟失
          const regionEnd = ci + '- content:'.length + m.index + m[0].length;
          head = block.slice(0, ci) + block.slice(regionEnd);
        }
      }
      const get = (name) => {
        const m = head.match(new RegExp('- ' + name + ': `([^`]*)`'));
        return m ? m[1] : '';
      };
      const date = get('date');
      if (!date) return null;       // 无日期的块无效（日记必须挂在某个日期上）
      let tags = [];
      try { const a = JSON.parse(get('tags') || '[]'); if (Array.isArray(a)) tags = tlNormalizeTags(a); } catch (e) {}
      return {
        idx,
        date,
        title: get('title'),
        mood: get('mood'),
        tags,
        weather: get('weather'),
        content,
        remark: get('remark')
      };
    }
    function tlParseDiaries(md) {
      if (!md) return [];
      const out = [];
      const blocks = String(md).split(/^##[ \t]*DIARY[ \t]*$/m);
      for (let i = 1; i < blocks.length; i++) {
        // ⚠️ 块尾可能黏着紧随其后的 ## EVENT / ## HOLIDAY / ## DIARY → 在最靠前的标记处截断
        const cut = blocks[i].search(/^##[ \t]*(EVENT(?:\([^)]*\))?|HOLIDAY|DIARY)[ \t]*$/m);
        const d = tlParseDiaryBlock(cut >= 0 ? blocks[i].slice(0, cut) : blocks[i], i);
        if (d) out.push(d);
      }
      return out;
    }
    function tlDiaryToMarkdown(d) {
      const tagsJson = JSON.stringify(Array.isArray(d.tags) ? d.tags : []);
      let s = '## DIARY \n';
      s += '- date: `' + tlMdEscape(d.date) + '`\n';
      s += '- title: `' + tlMdEscape(d.title || '') + '`\n';
      s += '- mood: `' + tlMdEscape(d.mood || '') + '`\n';
      s += '- tags: `' + tagsJson + '`\n';
      s += '- weather: `' + tlMdEscape(d.weather || '') + '`\n';
      s += '- content:\n```\n' + String(d.content || '') + '\n```\n';
      s += '- remark: `' + tlMdEscape(d.remark || '') + '`\n';
      return s;
    }
    function tlDiaryOnDate(dateStr) {
      if (!tlCalDiaries || !tlCalDiaries.length) return null;
      return tlCalDiaries.find((d) => d.date === dateStr) || null;
    }
    // 📕「当天有日记」标记（月格日期数字旁、周/日视图列头日期旁**共用**，一个入口一处样式）。
    // ⚠️ 纯显示、故意不挂 onclick：这些格子单击＝选日，在 ~12px 的小图标上再开一个点击热区只会造成误点；
    //    要看/改日记 → 点格子选日，下方明细的日期标题上有可点的日记按钮 .ev-day-diary。
    function tlDiaryMarkHtml(date) {
      const dy = tlDiaryOnDate(date);
      if (!dy) return '';
      return '<span class="ev-diary-mark' + (dy.ro ? ' ro' : '') + '" title="' + tlEscapeHtml('日记：' + (dy.title || '（无标题）')) + '">\ud83d\udcd5</span>';
    }

    // ===== 序列化（与桌面 calendar 插件 eventsToMarkdown 逐字节对齐） =====
    function tlMdEscape(s) { return String(s == null ? '' : s).replace(/`/g, "'"); }
    function tlEventToMarkdown(ev) {
      const tagsJson = JSON.stringify(Array.isArray(ev.tags) ? ev.tags : []);
      const todoJson = JSON.stringify(Array.isArray(ev.todoIds) ? ev.todoIds : []);
      const color = '"' + String(ev.color || '').replace(/^"|"$/g, '') + '"';
      const rep = !!(ev.repeatMode && ev.repeatMode !== '');
      let s = (rep ? '## EVENT(REPEAT) ' : '## EVENT ') + '\n';
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
      // 🆕 桌面便利贴 instance 数（>0 才写出，缺省 0 不写）
      if (ev.sticky > 0) s += '- sticky: `' + (ev.sticky | 0) + '`\n';
      if (rep) {
        s += '- repeatMode: `' + String(ev.repeatMode || '') + '`\n';
        s += '- repeatInterval: `' + String(ev.repeatInterval || '1') + '`\n';
        s += '- repeatWeekDay: `' + JSON.stringify(Array.isArray(ev.repeatWeekDay) ? ev.repeatWeekDay : []) + '`\n';
        s += '- repeatMonthDay: `' + String(ev.repeatMonthDay || '') + '`\n';
        s += '- repeatYearMonthDay: `' + String(ev.repeatYearMonthDay || '') + '`\n';
        s += '- repeatEndType: `' + String(ev.repeatEndType || 'never') + '`\n';
        s += '- repeatEndValue: `' + String(ev.repeatEndValue || '') + '`\n';
        s += '- repeatExcludeDates: `' + JSON.stringify(Array.isArray(ev.repeatExcludeDates) ? ev.repeatExcludeDates : []) + '`\n';
      }
      // Remark 围栏长度按备注内容动态加长（CommonMark：闭合围栏 ≥ 开启围栏），备注正文里的 ``` 不会再提前闭合
      s += '- Remark:\n' + tlRemarkFence(ev.notes) + '\n' + String(ev.notes || '') + '\n' + tlRemarkFence(ev.notes) + '\n';
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
      s += '- Remark:\n' + tlRemarkFence(h.notes) + '\n' + String(h.notes || '') + '\n' + tlRemarkFence(h.notes) + '\n';
      return s;
    }
    // 整份 calendar.md 序列化：events + holidays + diaries 都保留（保存任一类时若只写该类会把用户手写的其它类整体覆盖掉）
    function tlCalendarToMarkdown(events, holidays, diaries) {
      const head = '# 日历行程\n\n> 每条行程以 `## EVENT` 分隔，字段值写在反引号内，Remark 用代码块保存多行备注。\n\n';
      // 📎 保存时按 date 排序：EVENT（用现有 tlSorted：日期→全天→时间）与 DIARY（按日期）都排序，HOLIDAY 保持原序
      const evSorted = (events && events.length) ? tlSorted(events.slice()) : [];
      const diSorted = (diaries && diaries.length) ? diaries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) : [];
      let body = evSorted.length ? evSorted.map(tlEventToMarkdown).join('\n') : '';
      if (holidays && holidays.length) {
        body += (body ? '\n' : '') + holidays.map(tlHolidayToMarkdown).join('\n');
      }
      if (diSorted.length) {
        body += (body ? '\n' : '') + diSorted.map(tlDiaryToMarkdown).join('\n');
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
    // 🆕 桌面便利贴清单：把 sticky>0 的事件展开成 [{key,idx,html}]（key = 事件 uid，供桌面便利贴窗口定位）
    //    evpN 是当前 Markdown 分块位置生成的临时 key，重排事件后可能变化；刷新时由标题/日期回退定位旧便利贴。
    //    html 复用主程式 tlRenderNotes/renderMarkdown 管线（含 [[cp:]]→✅、[[dl:]]→📅、checkbox），
    //    渲染好的 HTML 交给便利贴窗口显示 → 单一可信来源，两处渲染永不漂移。
    function tlStickyNoteRefs() {
      const out = [];
      tlCalEvents.forEach((ev) => {
        const n = parseInt(ev && ev.sticky, 10) || 0;
        if (n > 0) {
          const key = ev.uid || ((ev.title || '') + '|' + (ev.date || ''));
          const html = (typeof tlRenderNotes === 'function') ? tlRenderNotes(ev.notes, ev.uid || key) : '';
          // 🆕 标题同样由主窗口渲染（与列表行同一 tlRenderInlineMarkdown 管线），避免便利贴里显示原始 <BIG> 等标签
          const titleHtml = (typeof tlRenderInlineMarkdown === 'function') ? tlRenderInlineMarkdown(ev.title || '') : '';
          const titleNode = document.createElement('div');
          titleNode.innerHTML = titleHtml;
          const title = (titleNode.textContent || titleNode.innerText || ev.title || '').replace(/\s+/g, ' ').trim();
          for (let i = 0; i < n; i++) out.push({
            key, idx: i, html, titleHtml, title, date: ev.date || '',
            done: !!ev.done, tags: Array.isArray(ev.tags) ? ev.tags : []
          });
        }
      });
      return out;
    }
    // 🆕 主程式事件变更后，把每张便利贴最新渲染结果推给对应便利贴窗（经由主进程中转）
    //   仅在便利贴开启时推送，避免无谓渲染；主进程会只转发给真实存在的窗口
    function tlPushStickyRefreshes() {
      if (typeof tlStickyNotesOpen !== 'undefined' && !tlStickyNotesOpen) return;
      if (!window.electronAPI || !window.electronAPI.send) return;
      tlStickyNoteRefs().forEach((ref) => { window.electronAPI.send('sticky-note-refresh', ref); });
    }
    // 依据便利贴 key（= 事件 uid）找事件 uid（供桌面便利贴「在主程式打开 / 编辑回写」定位事件）
    function tlFindEventUidByKey(key) {
      const ev = tlCalEvents.find((x) => (x.uid || '') === key);
      return ev ? ev.uid : null;
    }

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
      // ===== ## EVENT(REPEAT) 重複事件：展開為可見範圍內的發生日 =====
      // REPEAT 三態：none=隱藏全部；next=只顯示「今天及之後最近的一次」；some=最近的前一次+未來4次（最多5次）
      if (ev.repeatMode && ev.repeatMode !== '') {
        // ⚠️ some 需要「未來 4 次」但當前視圖窗口（tlRepeatFrom/To）可能只覆蓋未來 1~3 次，
        //    故 some 分支改用「寬窗口」重新展開，拿到完整序列再截取，不受視圖窗口裁剪。
        const savedFrom = tlRepeatFrom, savedTo = tlRepeatTo;
        tlSetRepeatWindow('2000-01-01', '2100-01-01');
        const occ = tlExpandRepeats(ev);
        tlSetRepeatWindow(savedFrom, savedTo);
        if (tlCalShowRepeat === 'none') return [];
        const today = tlFmtDate(new Date());
        if (tlCalShowRepeat === 'next') {
          let best = null;
          for (let i = 0; i < occ.length; i++) { if (occ[i].date >= today && (!best || occ[i].date < best.date)) best = occ[i]; }
          return best ? [best] : [];
        }
        // some：最近的前一次（date < today）+ 未來 4 次（date >= today），最多 5 次
        const past = [], future = [];
        for (let i = 0; i < occ.length; i++) { if (occ[i].date < today) past.push(occ[i]); else future.push(occ[i]); }
        return (past.length ? [past[past.length - 1]] : []).concat(future.slice(0, 4));
      }
      out.push({ date: ev.date, ev, pos: 'single', idx: 1, total: 1 });
      return out;
    }
    // 重複展開視窗：各視圖渲染前用 tlSetRepeatWindow 設定，避免 never 模式無限展開
    let tlRepeatFrom = '2000-01-01', tlRepeatTo = '2100-01-01';
    function tlSetRepeatWindow(from, to) { tlRepeatFrom = from || '2000-01-01'; tlRepeatTo = to || '2100-01-01'; }
    const TL_WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    function tlWdKey(d) { return TL_WD[d.getDay()]; }
    function tlAddDaysStr(ds, n) { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return tlFmtDate(d); }
    // 把 ''/'1'/'01' 統一成 'DD'（日）
    function tlPad2(n) { n = parseInt(n, 10); return isNaN(n) ? '' : (n < 10 ? '0' + n : '' + n); }
    // 由重複定義生成發生日陣列（受 [tlRepeatFrom, tlRepeatTo] 約束）；idx＝實際收錄序號，total＝count 模式總次數
    function tlExpandRepeats(ev) {
      // 去掉用户手写时可能带的最外层双引号（如 repeatYearMonthDay: `"05-26"`），保证比较正确且不改写文件
      const strip = (s) => { s = String(s == null ? '' : s); return (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') ? s.slice(1, -1) : s; };
      const mode = strip(ev.repeatMode);
      if (!mode) return [];
      const interval = Math.max(1, parseInt(strip(ev.repeatInterval), 10) || 1);
      let exclude = ev.repeatExcludeDates;
      if (typeof exclude === 'string') { try { exclude = JSON.parse(exclude); } catch (e) { exclude = []; } }
      if (!Array.isArray(exclude)) exclude = [];
      const endType = strip(ev.repeatEndType) || 'never';
      const endVal = strip(ev.repeatEndValue);
      const from = tlRepeatFrom, to = tlRepeatTo;
      const out = [];
      const cur = new Date(ev.date + 'T00:00:00');
      if (isNaN(cur)) return out;
      const bD = cur.getDate(), bM = cur.getMonth(), bY = cur.getFullYear();
      const wds = (ev.repeatWeekDay && ev.repeatWeekDay.length) ? ev.repeatWeekDay : [tlWdKey(cur)];
      const mDay = ev.repeatMonthDay ? parseInt(strip(ev.repeatMonthDay), 10) : bD;
      const ymd = ev.repeatYearMonthDay ? strip(ev.repeatYearMonthDay) : (tlPad2(bM + 1) + '-' + tlPad2(bD));
      let idx = 0, guard = 0;
      while (guard++ < 8000) {
        const ds = tlFmtDate(cur);
        if (ds > to) break;
        if (ds >= from) {
          let hit = false;
          if (mode === 'daily') hit = true;
          else if (mode === 'weekly') hit = wds.indexOf(tlWdKey(cur)) >= 0;
          else if (mode === 'monthly') {
            const months = (cur.getFullYear() - bY) * 12 + (cur.getMonth() - bM);
            hit = cur.getDate() === mDay && months % interval === 0;
          } else if (mode === 'yearly') {
            const curMd = tlPad2(cur.getMonth() + 1) + '-' + tlPad2(cur.getDate());
            hit = curMd === ymd && (cur.getFullYear() - bY) % interval === 0;
          }
          if (hit && exclude.indexOf(ds) < 0) {
            idx++;
            if (endType === 'count' && idx > (parseInt(endVal, 10) || 0)) break;
            if (endType === 'date' && ds > endVal) break;
            out.push({ date: ds, ev, pos: 'single', idx, total: endType === 'count' ? (parseInt(endVal, 10) || 0) : 0 });
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }
    function tlOccSort(a, b) {
      const aSpan = a.pos === 'single' ? 1 : 0, bSpan = b.pos === 'single' ? 1 : 0;
      if (aSpan !== bSpan) return aSpan - bSpan;
      if (a.ev.date !== b.ev.date) return a.ev.date < b.ev.date ? -1 : 1;
      if (a.ev.allDay !== b.ev.allDay) return a.ev.allDay ? -1 : 1;
      return tlTimeToMin(a.ev.startTime) - tlTimeToMin(b.ev.startTime);
    }
    // 跨天行程的「第幾天」後綴（單一來源）：total>1 時回傳「 (idx/total)」（如 回上海 (1/7)），單日行程不加
    // 使用點：月格色條、時間網格（全天條／定時塊／假期條）、列表行、假日列
    function tlSpanSuffix(idx, total) { return (total > 1 && idx > 0) ? ' (' + idx + '/' + total + ')' : ''; }
    // 由「出現日」直接算跨天序號——呼叫方不必手上握有 occurrence 的 idx/total（列表行/假日列走的是
    // 「按日期分組」入口，那份資料只有 ev + 日期，沒有產生 seq）。
    // ⚠️ 只認「跨天」（date ≠ endDate）：重複事件的 idx/total 是「第幾次」而非「第幾天」，兩者不可混用。
    function tlSpanDaySuffix(item, occDate) {
      if (!tlIsMultiDay(item)) return '';
      const total = tlSpanDays(item.date, item.endDate);
      if (total <= 1) return '';
      const idx = Math.min(Math.max(tlSpanDays(item.date, occDate || item.date), 1), total);
      return tlSpanSuffix(idx, total);
    }
    // 📝 備註裡的 Markdown checkbox（- [ ] / - [x]）渲染成 ☐/☑ 樣式，且可點擊勾選/取消（寫回 notes 原文）。
    //    入參必須是「已 escape」的文本；支援任意縮進的 `- [ ]` / `- [x]` / `- [X]`。
    //    uid 為所屬行程（點擊時定位用）；fenced code block 內的行不當成 checkbox，避免誤判代碼。
    // 基礎 Markdown 渲染（標題/備註共用）。
    // 標題行內使用：若 marked 只產出單個 <p>，去掉 <p> 包裝，避免在 .ev-title 裡產生多餘段間距。
    function tlRenderInlineMarkdown(text) {
      if (!text) return '';
      const html = renderMarkdown(String(text).trim());
      const trimmed = html.trim();
      if (/^<p>/i.test(trimmed) && /<\/p>$/i.test(trimmed)) {
        const inner = trimmed.slice(3, -4);
        if (!/<p>/i.test(inner)) return inner;
      }
      return html;
    }
    // 備註：先處理 checkbox 與子事件編輯按鈕，再整段 renderMarkdown；uid 為 null 時只顯示、不交互。
    function tlRenderNotes(notes, uid) {
      if (!notes) return '';
      const withChecks = tlNotesWithChecks(String(notes), uid);
      return renderMarkdown(withChecks);
    }
    // 備註 checkbox 行內的 deadline / completed 標記（顯示層轉換，不改寫源）：裸日期與 [[dl:...]] → 📅、[[cp:...]] → ✅
    function tlRenderNoteMarkers(text) {
      return String(text)
        .replace(/\[\[(?:dl:)?(\d{4}-\d{2}-\d{2})\]\]/g, '📅 $1')
        .replace(/\[\[cp:(\d{4}-\d{2}-\d{2})\]\]/g, '✅ $1');
    }
    function tlNotesWithChecks(text, uid) {
      let inFence = false;
      return text.split('\n').map((line, i) => {
        if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
        if (inFence) return line;
        const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
        if (!m) return line;
        const done = m[2] !== ' ';
        const event = uid && tlCalEvents.find((item) => item.uid === uid);
        const editButton = uid && event && !event.ro
          ? '<button type="button" class="ev-md-edit" title="编辑子事件" onclick="tlOpenEditNoteCheckDialog(event,\'' +
            tlEscapeHtml(uid) + '\',' + i + ')">\u270e</button>'
          : '';
        const cbAttr = uid
          ? ' class="ev-cb interactive" data-uid="' + tlEscapeHtml(uid) + '" data-line="' + i + '"' +
            ' onclick="tlToggleNoteCheck(event,\'' + tlEscapeHtml(uid) + '\',' + i + ')"' +
            ' onkeydown="tlCalCheckKey(event,\'' + tlEscapeHtml(uid) + '\',' + i + ')"' +
            ' role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '" tabindex="0"'
          : ' class="ev-cb"';
        return m[1] + '<span class="ev-md-check' + (done ? ' done' : '') + '">' +
          editButton +
          '<span' + cbAttr + '>' + (done ? '\u2713' : '') + '</span>' +
          '<span class="ev-md-check-text">' + tlRenderInlineMarkdown(tlRenderNoteMarkers(m[3])) + '</span></span>';
      }).join('\n');
    }
    // 🔁 重复事件小图标（## EVENT(REPEAT)）：双箭头环形，随文色（灰），用于月格 chip / 时间网格 / 列表行 / 悬停提示
    function tlRepeatIcon(ev) {
      if (!ev || !ev.repeatMode) return '';
      return '<svg class="ev-repeat-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="\u91cd\u590d"><title>\u91cd\u590d\u4e8b\u4ef6</title><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
    }
    function tlSpanChipHtml(ev, pos, idx, total, occDate) {
      // 单日 → 普通 chip（圆点+标题）；跨天 start/middle/end → 连续色条
      const links = tlEventTodoLinks(ev);
      if (pos === 'single') {
        return '<div class="ev-chip' + (ev.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '" data-occ-date="' + tlEscapeHtml(occDate || ev.date) + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')"><span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>' + (ev.done ? '\u2713 ' : '') + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + links + '</div>';
      }
      const cls = 'ev-chip span ' + pos + (ev.done ? ' done' : '');
      const dot = '<span class="dot" style="background:' + tlEscapeHtml(ev.color) + '"></span>';
      const titlePart = (ev.done ? '\u2713 ' : '') + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + tlSpanSuffix(idx, total) + links;
      // 每一段（start/middle/end）都顯示「標題 k/N」——空色條看不出是哪條行程的延續
      const inner = (pos === 'start' ? dot : '') + titlePart;
      return '<div class="' + cls + '" data-uid="' + tlEscapeHtml(ev.uid) + '" data-occ-date="' + tlEscapeHtml(occDate || ev.date) + '" style="--ev-color:' + tlEscapeHtml(ev.color) + '" onclick="tlOpenEventFromChip(event,\'' + tlEscapeHtml(ev.uid) + '\')">' + inner + '</div>';
    }

    // ===== 标签过滤 / 跨天展开 / 时间网格 辅助 =====
    // 事件是否满足当前标签过滤（空＝全部；OR 逻辑）
    // 🆕 父阶标签 BOM 展开：选中某标签＝匹配「自身＋全部子阶＋孙阶…」的事件（沿 ## TAGS 树向下收集）
    function tlTagDescendants(name) {
      const m = tlTagMeta();
      const out = [name];
      const queue = [name];
      const seen = new Set(queue);
      let guard = 0;
      while (queue.length && guard++ < 1000) {
        const cur = queue.shift();
        Object.keys(m).forEach((k) => { if (m[k] === cur && !seen.has(k)) { seen.add(k); out.push(k); queue.push(k); } });
      }
      return out;
    }
    function tlEventMatchesTag(ev) {
      if (!tlCalTagFilter.length) return true;
      const tags = ev.tags || [];
      return tlCalTagFilter.some((f) => {
        const fam = tlTagDescendants(f);
        return tags.some((tg) => fam.indexOf(tlTagName(tg)) >= 0);
      });
    }
    // 分类显示过滤（顶栏 EVENT / REPEAT 三态勾选）：
    //   EVENT 勾选＝显示普通行程；REPEAT 三态＝none 隐藏全部 / next 只显示未来最近一次 / some 最近前一次+未来4次（最多5次）。
    // ⚠️ 重复行程是否「可见」由 tlEventVisible 决定（none 才隐藏），「显示几次」由 tlEventOccurrences 决定。
    function tlEventVisible(ev) {
      if (ev && ev.repeatMode) return tlCalShowRepeat !== 'none';
      return tlCalShowEvents;
    }
    // 事件是否应显示＝标签过滤 ∩ 分类过滤（所有「按日期分组」入口统一走这里）
    // ⚠️ 「只显示未完成」全模式生效（年/月/周/日/列表）：勾选后隐藏已完成（done ✓）的行程；假日无完成态不受影响
    function tlEventShown(ev) { if (tlCalUndoneOnly && ev && ev.done) return false; return tlEventMatchesTag(ev) && tlEventVisible(ev); }
    // 取某天出现的所有事件（含跨天展开），并套用标签过滤
    function tlEventsOnDay(dateStr) {
      const out = [];
      tlCalEvents.forEach((ev) => {
        if (!tlEventShown(ev)) return;
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
        return '<span class="ev-link" data-card-id="' + tlEscapeHtml(id) + '" title="\ud83d\udd17 ' + tlEscapeHtml(name) + '" onclick="event.stopPropagation(); if (typeof openCardWindow === \'function\') openCardWindow(this.getAttribute(\'data-card-id\'));">\ud83d\udd17</span>';
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
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (tlTagName(t)) tags.add(tlTagName(t)); }));
      // 🆕 父阶标签（无事件直接挂靠，但是其他标签的父/祖阶）也要显示：并入 ## TAGS 树登记的全部标签
      tlAllTagNames().forEach((t) => tags.add(t));
      const options = document.getElementById('tl-ev-tag-options');
      if (options) options.innerHTML = Array.from(tags).sort().map((t) => '<option value="' + tlEscapeHtml(t) + '"></option>').join('');
      if (!tags.size) { bar.style.display = 'none'; filter.innerHTML = ''; return; }
      bar.style.display = '';
      const tlIsTagInherited = (t) => {
        if (tlCalTagFilter.indexOf(t) >= 0) return false;
        return tlCalTagFilter.some((f) => tlTagDescendants(f).indexOf(t) >= 0);
      };
      filter.innerHTML = Array.from(tags).map((t) => {
        const active = tlCalTagFilter.indexOf(t) >= 0;
        const desc = !active && tlIsTagInherited(t);
        const cls = active ? ' active' : (desc ? ' active-desc' : '');
        return '<span class="ev-tag-chip' + cls + '" data-tag="' + tlEscapeHtml(t) + '">' + tlEscapeHtml(t) + '</span>';
      }).join('');
    }
    function tlFormTagNames() {
      const tags = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (tlTagName(t)) tags.add(tlTagName(t)); }));
      return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    }
    // 子标签（分类）历史：只从「该标签」所属事件的 cat 收集，供内联输入的 datalist 下拉选择
    // （标签与子标签有从属关系：某标签的子分类候选只来自挂了同名标签的事件；tagName 为空 → 空列表）
    function tlFormCatNames(tagName) {
      const cats = new Set();
      if (!tagName) return [];
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (tlTagName(t) === tagName) { const c = tlTagCat(t); if (c) cats.add(c); } }));
      return Array.from(cats).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    }
    function tlFormSubcatNames(tagName, cat) {
      const subcats = new Set();
      if (!tagName || !cat) return [];
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => {
        if (tlTagName(t) === tagName && tlTagCat(t) === cat) {
          const subcat = tlTagSubcat(t);
          if (subcat) subcats.add(subcat);
        }
      }));
      return Array.from(subcats).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    }
    function tlRenderTagPicker() {
      const picker = document.getElementById('tl-ev-tag-picker');
      const selected = document.getElementById('tl-ev-tag-selected');
      const menu = document.getElementById('tl-ev-tag-menu');
      const input = document.getElementById('tlEvFTags');
      if (!picker || !selected || !menu || !input) return;
      selected.innerHTML = tlEvFormTags.map((t, i) => {
        if (i === tlEvTagEditIndex) {
          const isSubcat = tlEvTagEditLevel === 'subcat';
          const value = isSubcat ? tlTagSubcat(t) : tlTagCat(t);
          const listId = isSubcat ? 'tl-ev-subcat-options' : 'tl-ev-cat-options';
          return '<span class="tl-ev-tag-selected-chip"><input type="text" class="tl-ev-tag-cat-input" data-tl-ev-tag-cat="' + i + '" maxlength="40" value="' + tlEscapeHtml(value) + '" placeholder="' + (isSubcat ? '第3段标签' : '次标签') + '" list="' + listId + '"></span>';
        }
        const name = tlEscapeHtml(tlTagName(t));
        const cat = tlTagCat(t);
        const subcat = tlTagSubcat(t);
        const catHtml = cat ? '<span class="ev-tag-cat" data-tl-ev-tag-subcat-edit="' + i + '" title="点击输入第3段标签">·' + tlEscapeHtml(cat) + '</span>' : '';
        const subcatHtml = subcat ? '<span class="ev-tag-cat" data-tl-ev-tag-subcat-edit="' + i + '" title="点击编辑第3段标签">·' + tlEscapeHtml(subcat) + '</span>' : '';
        return '<span class="tl-ev-tag-selected-chip">' + '<span class="tl-ev-tag-name" data-tl-ev-tag-edit="' + i + '" title="点击输入次标签">' + name + '</span>' + catHtml + subcatHtml + '<button type="button" data-tl-ev-tag-remove="' + tlEscapeHtml(tlTagName(t)) + '" aria-label="删除标签">×</button></span>';
      }).join('');
      // 子标签（分类）历史下拉：原生 datalist，与标签菜单同源（calendar.md 已有事件）
      // ⚠️ 只列当前编辑标签所属的子分类，不混入其他标签的子分类（从属关系）
      let catList = picker.querySelector('#tl-ev-cat-options');
      if (!catList) { catList = document.createElement('datalist'); catList.id = 'tl-ev-cat-options'; picker.appendChild(catList); }
      const editingTag = tlEvTagEditIndex >= 0 ? tlEvFormTags[tlEvTagEditIndex] : null;
      const catNames = tlFormCatNames(editingTag ? tlTagName(editingTag) : null);
      catList.innerHTML = catNames.map((c) => '<option value="' + tlEscapeHtml(c) + '"></option>').join('');
      let subcatList = picker.querySelector('#tl-ev-subcat-options');
      if (!subcatList) { subcatList = document.createElement('datalist'); subcatList.id = 'tl-ev-subcat-options'; picker.appendChild(subcatList); }
      const subcatNames = editingTag ? tlFormSubcatNames(tlTagName(editingTag), tlTagCat(editingTag)) : [];
      subcatList.innerHTML = subcatNames.map((c) => '<option value="' + tlEscapeHtml(c) + '"></option>').join('');
      const query = input.value.trim().toLowerCase();
      const names = tlFormTagNames().filter((t) => !query || t.toLowerCase().includes(query));
      menu.innerHTML = names.length ? names.map((t) => '<button type="button" class="tl-ev-tag-option' + (tlEvFormTags.some((x) => tlTagName(x) === t) ? ' selected' : '') + '" data-tl-ev-tag-option="' + tlEscapeHtml(t) + '">' + (tlEvFormTags.some((x) => tlTagName(x) === t) ? '✓ ' : '') + tlEscapeHtml(t) + '</button>').join('') : '<div class="tl-ev-tag-option">暂无可选标签</div>';
      if (tlEvTagEditIndex >= 0) {
        const ci = selected.querySelector('.tl-ev-tag-cat-input[data-tl-ev-tag-cat="' + tlEvTagEditIndex + '"]');
        if (ci) {
          ci.focus(); ci.select();
          // 有历史分类时自动弹下拉（showPicker 需用户手势；此处由点击标签名触发，正处手势链路内）
          const suggestions = tlEvTagEditLevel === 'subcat' ? subcatNames : catNames;
          try { if (suggestions.length && typeof ci.showPicker === 'function') ci.showPicker(); } catch (err) { /* 无手势等场景忽略，仍可手动点箭头 */ }
          const editIndex = tlEvTagEditIndex;
          const editLevel = tlEvTagEditLevel;
          ci.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); tlCommitTagCat(editIndex, ci.value, editLevel); }
            else if (e.key === 'Escape') { e.preventDefault(); tlEvTagEditIndex = -1; tlRenderTagPicker(); }
          });
          // datalist 选中历史分类后立即提交（change 在 blur 前触发；重复提交无副作用）
          ci.addEventListener('change', () => tlCommitTagCat(editIndex, ci.value, editLevel));
          ci.addEventListener('blur', () => tlCommitTagCat(editIndex, ci.value, editLevel));
        }
      }
    }
    function tlCommitTagCat(i, val, level) {
      if (tlEvFormTags[i]) {
        const value = (val || '').trim();
        if (level === 'subcat') tlEvFormTags[i].subcat = value;
        else {
          if (tlEvFormTags[i].cat !== value) tlEvFormTags[i].subcat = '';
          tlEvFormTags[i].cat = value;
        }
      }
      tlEvTagEditIndex = -1;
      tlRenderTagPicker();
    }
    function tlAddFormTag(value) {
      String(value || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean).forEach((t) => { if (!tlEvFormTags.some((x) => tlTagName(x) === t)) tlEvFormTags.push({ name: t, cat: '', subcat: '' }); });
      document.getElementById('tlEvFTags').value = '';
      tlRenderTagPicker();
    }
    function tlRemoveFormTag(tag) {
      tlEvFormTags = tlEvFormTags.filter((t) => tlTagName(t) !== tag);
      tlRenderTagPicker();
    }
    function tlToggleFormTag(tag) {
      if (tlEvFormTags.some((t) => tlTagName(t) === tag)) tlRemoveFormTag(tag); else tlAddFormTag(tag);
    }
    function tlRenderTagOptions() {
      const options = document.getElementById('tl-ev-tag-options');
      if (!options) return;
      const tags = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { if (tlTagName(t)) tags.add(tlTagName(t)); }));
      options.innerHTML = Array.from(tags).sort().map((t) => '<option value="' + tlEscapeHtml(t) + '"></option>').join('');
    }
    // ===== 标签右键菜单 + 编辑标签画面（树形父阶）=====
    function tlInjectTagTreeStyle() {
      if (document.getElementById('tl-tag-tree-style')) return;
      const s = document.createElement('style');
      s.id = 'tl-tag-tree-style';
      s.textContent = [
        '.tl-tag-ctx-menu{position:fixed;z-index:9999;min-width:150px;background:var(--ev-card,#1e293b);color:var(--ev-text,#e2e8f0);border:1px solid var(--ev-border,#334155);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:6px;font-size:13px}',
        '.tl-tag-ctx-menu button{display:block;width:100%;text-align:left;background:none;border:0;color:inherit;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px}',
        '.tl-tag-ctx-menu button:hover{background:var(--ev-hover,#334155)}',
        '#tlTagEditOverlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}',
        '#tlTagEditOverlay .tl-tag-edit-box{background:var(--ev-card,#1e293b);color:var(--ev-text,#e2e8f0);border:1px solid var(--ev-border,#334155);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.45);width:min(440px,92vw);max-height:86vh;overflow:auto;padding:18px 20px}',
        '#tlTagEditOverlay h3{margin:0 0 4px;font-size:16px}',
        '.tl-tag-edit-sec{margin-top:16px}',
        '.tl-tag-edit-sec .lbl{font-size:12px;opacity:.7;margin-bottom:8px}',
        '.tl-tag-children{display:flex;flex-wrap:wrap;gap:8px}',
        '.tl-tag-child{display:inline-flex;align-items:center;gap:6px;background:var(--ev-hover,#334155);border-radius:999px;padding:5px 12px;cursor:pointer;font-size:13px}',
        '.tl-tag-child:hover{outline:1px solid var(--primary,#3b82f6)}',
        '.tl-tag-cat-item{display:inline-flex;align-items:center;background:var(--ev-hover,#334155);border-radius:999px;padding:5px 12px;font-size:13px}',
        '.tl-tag-edit-actions{margin-top:20px;display:flex;justify-content:flex-end;gap:10px}',
        '.tl-tag-edit-actions button{padding:8px 16px;border-radius:8px;border:1px solid var(--ev-border,#334155);background:var(--ev-hover,#334155);color:inherit;cursor:pointer;font-size:13px}',
        '.tl-tag-edit-actions button.primary{background:var(--primary,#3b82f6);color:#fff;border-color:transparent}',
      ].join('');
      document.head.appendChild(s);
    }
    function tlEnsureTagCtxMenu() {
      let menu = document.getElementById('tlTagCtxMenu');
      if (menu) return menu;
      tlInjectTagTreeStyle();
      menu = document.createElement('div');
      menu.id = 'tlTagCtxMenu';
      menu.className = 'tl-tag-ctx-menu';
      menu.style.display = 'none';
      menu.innerHTML = '<button type="button" data-tl-tag-edit="1">✎ 编辑标签属性</button>';
      document.body.appendChild(menu);
      menu.addEventListener('click', (ev) => {
        if (ev.target.getAttribute && ev.target.getAttribute('data-tl-tag-edit')) { menu.style.display = 'none'; tlOpenTagEdit(menu.__tag); }
      });
      document.addEventListener('click', () => { menu.style.display = 'none'; }, true);
      return menu;
    }
    function tlShowTagCtxMenu(name, x, y) {
      const menu = tlEnsureTagCtxMenu();
      menu.__tag = name;
      menu.style.display = 'block';
      const pw = menu.offsetWidth || 160, ph = menu.offsetHeight || 40;
      let left = x, top = y;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
      menu.style.left = Math.max(4, left) + 'px';
      menu.style.top = Math.max(4, top) + 'px';
    }
    function tlEnsureTagEditOverlay() {
      let ov = document.getElementById('tlTagEditOverlay');
      if (ov) return ov;
      tlInjectTagTreeStyle();
      ov = document.createElement('div');
      ov.id = 'tlTagEditOverlay';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.style.display = 'none'; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.style.display !== 'none') ov.style.display = 'none'; });
      return ov;
    }
    // 编辑标签画面：显示「子标签列表」（以其为父的标签名）＋「分类」（该标签事件的 cat，与表单下拉同源）＋ 可设定「父阶标签」（select，排除自身与后代防成环）
    function tlOpenTagEdit(name) {
      if (!name) return;
      const ov = tlEnsureTagEditOverlay();
      const parent = tlTagParent(name);
      const children = tlTagChildren(name);
      const cats = tlFormCatNames(name);
      const m = tlTagMeta();
      const candidates = tlAllTagNames().filter((t) => t !== name && !tlIsDescendant(t, name, m));
      const opts = ['<option value="">（无／根标签）</option>'].concat(
        candidates.map((t) => '<option value="' + tlEscapeHtml(t) + '"' + (t === parent ? ' selected' : '') + '>' + tlEscapeHtml(t) + '</option>')
      ).join('');
      const childHtml = children.length
        ? '<div class="tl-tag-children">' + children.map((c) => '<span class="tl-tag-child" data-tl-tag-child="' + tlEscapeHtml(c) + '">' + tlEscapeHtml(c) + '</span>').join('') + '</div>'
        : '<div class="lbl">（暂无子标签）</div>';
      // 分类 chip：只读展示（勿用 .tl-tag-child，避免命中「点子标签递归打开」的委托）
      const catHtml = cats.length
        ? '<div class="tl-tag-children">' + cats.map((c) => '<span class="tl-tag-cat-item">' + tlEscapeHtml(c) + '</span>').join('') + '</div>'
        : '<div class="lbl">（暂无分类）</div>';
      ov.innerHTML =
        '<div class="tl-tag-edit-box">' +
          '<h3>编辑标签「' + tlEscapeHtml(name) + '」</h3>' +
          '<div class="tl-tag-edit-sec"><div class="lbl">子标签列表（以其为父的标签）</div>' + childHtml + '</div>' +
          '<div class="tl-tag-edit-sec"><div class="lbl">分类（该标签的子分类）</div>' + catHtml + '</div>' +
          '<div class="tl-tag-edit-sec"><div class="lbl">父阶标签（上级）</div>' +
            '<select id="tlTagParentSel" style="width:100%;padding:8px;border-radius:8px;background:var(--ev-hover,#334155);color:inherit;border:1px solid var(--ev-border,#334155);font-size:13px">' + opts + '</select>' +
          '</div>' +
          '<div class="tl-tag-edit-actions"><button type="button" id="tlTagEditClose">关闭</button></div>' +
        '</div>';
      ov.style.display = 'flex';
      ov.querySelector('#tlTagEditClose').addEventListener('click', () => { ov.style.display = 'none'; });
      ov.querySelector('#tlTagParentSel').addEventListener('change', (e) => {
        const ok = tlSetTagParent(name, e.target.value);
        if (!ok) { showToast('不能将上级设为自身的下级（会造成循环）', 'danger'); e.target.value = parent; return; }
        if (typeof saveTask === 'function') saveTask(false); // 落盤到 calendar.md
        tlRenderTagBar();
        showToast('已更新「' + name + '」的父阶标签', 'success');
      });
      ov.querySelectorAll('.tl-tag-child').forEach((c) => c.addEventListener('click', () => tlOpenTagEdit(c.getAttribute('data-tl-tag-child'))));
    }
    // 标签（过滤条 chip 或 事件/日志卡片上的内联标签 .ev-tag-view）右键 → 弹出菜单（委托监听，覆盖重绘后的新节点）
    document.addEventListener('contextmenu', (e) => {
      const tagEl = e.target.closest('[data-tag]');
      if (!tagEl) return;
      e.preventDefault();
      tlShowTagCtxMenu(tagEl.getAttribute('data-tag'), e.clientX, e.clientY);
    });
    // ========== 📊 事件统计：主事件 × 备注子事件（- [ ]），按标签·完成状态分类 ==========
    // 解析备注中的 Markdown checkbox 行 → 子事件数组 [{text, done}]
    function tlParseNoteChecks(text) {
      const out = [];
      if (!text) return out;
      let inFence = false;
      text.split('\n').forEach((line) => {
        if (/^\s*```/.test(line)) { inFence = !inFence; return; }
        if (inFence) return;
        const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
        if (!m) return;
        // 捕获 dl/cp 日期（裸日期视同 dl，与渲染约定一致），供统计明细显示 📅/✅
        const raw = m[3] || '';
        const dlM = raw.match(/\[\[(?:dl:)?(\d{4}-\d{2}-\d{2})\]\]/);
        const cpM = raw.match(/\[\[cp:(\d{4}-\d{2}-\d{2})\]\]/);
        const txt = raw
          .replace(/\[\[(?:dl:)?(\d{4}-\d{2}-\d{2})\]\]/g, '$1')
          .replace(/\[\[cp:(\d{4}-\d{2}-\d{2})\]\]/g, '$1')
          .replace(/\s{2,}/g, ' ').trim();
        out.push({ text: txt, done: m[2] !== ' ', dl: dlM ? dlM[1] : '', cp: cpM ? cpM[1] : '' });
      });
      return out;
    }
    // 收集统计数据：仅统计 EVENT（tlCalEvents），REPEAT 系列按 1 条主事件计；子事件继承主事件标签
    // filter: { tags: Set<string>|null, status: 'all'|'done'|'undone' }；tags 非空集合才生效（空=不过滤）；status 缺省 'all'
    function tlBuildStats(filter) {
      const fTags = (filter && filter.tags && filter.tags.size) ? filter.tags : null;
      const fStatus = (filter && filter.status) || 'all';
      // 「只显示事件主体」（2026-10-10）：无子事件的事件本身＝主体；有子事件的事件不算主体（由其子事件代表）
      const fMainOnly = !!(filter && filter.mainOnly);
      // 🆕 父阶标签 BOM 展开（2026-10-13）：勾选父阶标签＝匹配「自身＋全部子阶/孙阶…」，
      //    与主程式标签过滤 tlEventMatchesTag()/tlTagDescendants() 完全同逻辑（沿 ## TAGS 树向下收集）
      const fam = new Set();
      if (fTags) fTags.forEach((t) => tlTagDescendants(t).forEach((d) => fam.add(d)));
      const tagMap = new Map();   // tagName -> { mainTotal, mainDone, mainUndone, subTotal, subDone, subUndone, mains:[], subs:[] }
      const ensure = (k) => { if (!tagMap.has(k)) tagMap.set(k, { mainTotal: 0, mainDone: 0, mainUndone: 0, subTotal: 0, subDone: 0, subUndone: 0, mains: [], subs: [] }); return tagMap.get(k); };
      let mainT = 0, mainD = 0, mainU = 0, subT = 0, subD = 0, subU = 0;
      tlCalEvents.forEach((ev) => {
        // 完成状态过滤（作用于主事件 done）
        if (fStatus === 'done' && !ev.done) return;
        if (fStatus === 'undone' && ev.done) return;
        const tagNames = (ev.tags || []).map((t) => tlTagName(t)).filter(Boolean);
        // 标签过滤：事件须命中至少一个所选标签的 BOM 家族（OR，含子孙标签）；无标签事件仅在选中「(无标签)」时计入
        if (fTags) {
          const hit = tagNames.some((t) => fam.has(t));
          const noTagHit = (tagNames.length === 0 && fTags.has('(无标签)'));
          if (!hit && !noTagHit) return;
        }
        const allSubs = tlParseNoteChecks(ev.notes);
        // mainOnly：有子事件的事件本身不算主体 → 主事件栏（计数＋明细）不计，其子事件照常计入子事件栏
        const countMain = !(fMainOnly && allSubs.length > 0);
        if (countMain) { mainT++; if (ev.done) mainD++; else mainU++; }
        // 完成状态过滤同样作用于子事件（按每条子事件自身 done 过滤，与主事件一致）
        const subs = fStatus === 'all' ? allSubs : allSubs.filter((s) => (fStatus === 'done' ? s.done : !s.done));
        const subDoneCount = subs.filter((s) => s.done).length;
        subT += subs.length; subD += subDoneCount; subU += (subs.length - subDoneCount);
        // 标签分组（含「无标签」），仅保留所选标签（或其 BOM 子孙标签）分组
        const groups = tagNames.length ? tagNames : ['(无标签)'];
        groups.forEach((g) => {
          if (fTags && !fam.has(g)) return;
          const r = ensure(g);
          if (countMain) { r.mainTotal++; if (ev.done) r.mainDone++; else r.mainUndone++; }
          r.subTotal += subs.length; r.subDone += subDoneCount; r.subUndone += (subs.length - subDoneCount);
          if (countMain) r.mains.push({ title: ev.title, done: !!ev.done, uid: ev.uid, date: ev.date });
          subs.forEach((s) => r.subs.push({ text: s.text, done: s.done, date: ev.date, dl: s.dl, cp: s.cp, uid: ev.uid, ptitle: ev.title }));
        });
      });
      // 合计行：主/子 全局合计已在 mainT/subT；标签行在 tlStatsTableHtml 内排序
      const pct = (d, t) => (t ? Math.round((d / t) * 100) : 0);
      return {
        mainT, mainD, mainU, subT, subD, subU,
        mainRate: pct(mainD, mainT), subRate: pct(subD, subT),
        mainOnly: fMainOnly,
        rows: tagMap, pct, fam,
      };
    }
    function tlStatsSummaryHtml(s) {
      const card = (title, t, d, u, rate) =>
        '<div class="tl-stats-card"><h4>' + title + '</h4>' +
        '<div class="row"><span>总计</span><b>' + t + '</b></div>' +
        '<div class="row"><span>已完成 ✓</span><b>' + d + '</b></div>' +
        '<div class="row"><span>未完成 ☐</span><b>' + u + '</b></div>' +
        '<div class="rate">完成率 ' + rate + '%<div class="bar"><i style="width:' + rate + '%"></i></div></div>' +
        '</div>';
      return '<div class="tl-stats-summary">' +
        card(s.mainOnly ? '主事件（无子事件＝主体）' : '主事件', s.mainT, s.mainD, s.mainU, s.mainRate) +
        card('子事件（备注 - [ ]）', s.subT, s.subD, s.subU, s.subRate) +
        '</div>';
    }
    function tlStatsDetailHtml(group) {
      // 主/子事件同色显示（链接 color:inherit），用「主/子事件」栏位值区分；状态直接显示文字；
      // 首栏「项次」序号；末栏「跳转」＝关闭弹层并滚动到主画面该事件位置（子事件跳到其所属主事件）；
      // 子事件内容悬停 → tooltip 显示所属主事件标题（原生 title）
      let no = 0;
      const row = (kind, date, contentHtml, done, uid, tip, extraCls) => {
        no++;
        // 状态列在内容列之前（2026-10-10 用户要求）；○＝完成、✕＝未完成，悬停 title 保留文字说明
        return '<tr class="' + (done ? 'done ' : '') + (extraCls || '') + '">' +
          '<td class="d-no">' + no + '</td>' +
          '<td class="d-date">' + tlEscapeHtml(date || '') + '</td>' +
          '<td class="d-kind">' + kind + '</td>' +
          '<td class="d-status" title="' + (done ? '完成' : '未完成') + '"><span class="st-ic ' + (done ? 'st-done' : 'st-undone') + '">' + (done ? '\u25CB' : '\u2715') + '</span></td>' +
          '<td class="d-content"' + (tip ? ' data-tip="' + tip + '"' : '') + '>' + contentHtml + '</td>' +
          '<td class="d-jump"><button class="tl-stats-jump" onclick="tlJumpToEvent(\'' + tlEscapeHtml(uid) + '\')">跳转</button></td>' +
        '</tr>';
      };
      const mainRows = group.mains.map((m) => row('主事件', m.date,
        '<a href="javascript:void(0)" onclick="tlOpenEventForm(\'' + tlEscapeHtml(m.uid) + '\')">' + tlRenderInlineMarkdown(m.title) + '</a>',
        m.done, m.uid)).join('');
      // 同一主事件的子事件行打同一「色带」class，切换主事件即交替换色（build 层按事件顺序 push，同 uid 必连续）
      let prevUid = null, band = false;
      const subRows = group.subs.map((x) => {
        if (x.uid !== prevUid) { prevUid = x.uid; band = !band; }
        return row('子事件', x.date,
        tlEscapeHtml(x.text) +
        (x.dl ? ' <span class="d-dl">📅 ' + tlEscapeHtml(x.dl) + '</span>' : '') +
        (x.cp ? ' <span class="d-cp">✅ ' + tlEscapeHtml(x.cp) + '</span>' : ''),
        x.done, x.uid, '主事件：' + tlEscapeHtml(x.ptitle || ''), band ? 'band-a' : 'band-b');
      }).join('');
      return '<table class="tl-stats-detail-table">' +
        '<thead><tr><th>项次</th><th>日期</th><th>主/子事件</th><th>状态</th><th>事件 / 子事件</th><th>跳转</th></tr></thead><tbody>' +
        (mainRows + subRows || '<tr><td colspan="6" class="muted">—</td></tr>') +
        '</tbody></table>';
    }
    // 关闭统计弹层并滚动定位到事件在主画面的渲染位置（子事件＝跳到其所属主事件）
    function tlJumpToEvent(uid) {
      tlCloseStats();
      const el = document.querySelector('[data-uid="' + uid + '"]');
      if (!el || !el.offsetParent) { showToast('当前视图未显示该事件，请切换到包含它的视图后再试', 'danger'); return; }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('tl-jump-flash');
      void el.offsetWidth;  // 强制 reflow 重启动画
      el.classList.add('tl-jump-flash');
      setTimeout(() => el.classList.remove('tl-jump-flash'), 2000);
    }
    function tlStatsTableHtml(s) {
      const head = '<thead><tr><th>标签</th><th>主事件<br>总计</th><th>主·完成</th><th>主·未完成</th><th>子事件<br>总计</th><th>子·完成</th><th>子·未完成</th></tr></thead>';
      const fam = s.fam || new Set();
      const tagCell = (name) => {
        if (name === '(无标签)') return '<span class="muted">(无标签)</span>';
        // 🆕 未勾选、但被已勾选父阶标签 BOM 带入的子孙标签：标「↳」并注明继承来源（与主程式标签条 active-desc 同义）
        if (!tlStatsFilter.tags.has(name) && fam.has(name)) {
          const src = tlStatsTagInheritSource(name);
          return '<span class="tl-stats-tag-inherit" title="BOM 继承自父阶标签「' + tlEscapeHtml(src) + '」">↳ ' + tlEscapeHtml(name) + '</span>';
        }
        return tlEscapeHtml(name);
      };
      const body = Array.from(s.rows.entries()).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans')).map(([name, r]) => {
        const detail = '<tr class="tl-stats-detail"><td class="tl-stats-detail" colspan="7"><details><summary>展开明细</summary>' + tlStatsDetailHtml(r) + '</details></td></tr>';
        return '<tr><td class="tl-stats-tag">' + tagCell(name) + '</td>' +
          '<td>' + r.mainTotal + '</td><td>' + r.mainDone + '</td><td>' + r.mainUndone + '</td>' +
          '<td>' + r.subTotal + '</td><td>' + r.subDone + '</td><td>' + r.subUndone + '</td></tr>' + detail;
      }).join('');
      const total = '<tr class="tl-stats-total"><td class="tl-stats-tag">总计</td>' +
        '<td>' + s.mainT + '</td><td>' + s.mainD + '</td><td>' + s.mainU + '</td>' +
        '<td>' + s.subT + '</td><td>' + s.subD + '</td><td>' + s.subU + '</td></tr>';
      return '<table class="tl-stats-table">' + head + '<tbody>' + body + total + '</tbody></table>';
    }
    let tlStatsFilter = { tags: new Set(), status: 'all', mainOnly: false };  // 默认：全部（mainOnly＝只显示事件主体）
    // 统计可选标签＝事件上用过的标签 ∪ ## TAGS 树登记的全部标签
    // 🆕 父阶标签（无事件直接挂靠，如「工作」）也要显示：与主程式标签过滤条 tlRenderTagBar() 同源合并
    function tlStatsTagOptions() {
      const set = new Set();
      tlCalEvents.forEach((ev) => (ev.tags || []).forEach((t) => { const n = tlTagName(t); if (n) set.add(n); }));
      tlAllTagNames().forEach((t) => set.add(t));
      const arr = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
      arr.push('(无标签)');
      return arr;
    }
    // 该子孙标签是被哪个「已勾选的（祖）父阶标签」BOM 带入：沿父阶向上找最近的已勾选祖先
    function tlStatsTagInheritSource(name) {
      let cur = tlTagParent(name), guard = 0;
      while (cur && guard++ < 100) {
        if (tlStatsFilter.tags.has(cur)) return cur;
        cur = tlTagParent(cur);
      }
      return '';
    }
    let tlStatsTagBoxBound = false;  // 标签胶囊点击委托是否已绑定（只绑一次：容器 #tlEvStatsFilters 稳定，chips 每次重绘）
    function tlRenderStatsFilters() {
      const box = document.getElementById('tlEvStatsFilters');
      if (!box) return;
      const tags = tlStatsTagOptions();
      // 🆕 勾选父阶标签 → BOM 展开出全部子孙标签；未勾选的子孙标签以「继承」态显示（与主程式标签条 active-desc 一致）
      const fam = new Set();
      tlStatsFilter.tags.forEach((t) => tlTagDescendants(t).forEach((d) => fam.add(d)));
      // 胶囊渲染（2026-10-13 由 checkbox 改为胶囊）：与主程式标签过滤条 .ev-tag-chip 完全同一套类名与三态——
      //   .active＝主动勾选（实心蓝白）／.active-desc＝选父阶后被动带入的子孙（ghost 蓝）／无类＝未选
      const tagChips = tags.map((t) => {
        const checked = tlStatsFilter.tags.has(t);
        const inherit = !checked && fam.has(t);
        const cls = 'ev-tag-chip' + (checked ? ' active' : (inherit ? ' active-desc' : ''));
        if (!inherit) {
          return '<span class="' + cls + '" data-tl-stats-tag="' + tlEscapeHtml(t) + '">' + tlEscapeHtml(t) + '</span>';
        }
        const src = tlStatsTagInheritSource(t);
        return '<span class="' + cls + '" data-tl-stats-tag="' + tlEscapeHtml(t) + '" title="BOM 继承自父阶标签「' + tlEscapeHtml(src) + '」（点选可主动勾选）">' + tlEscapeHtml(t) + '</span>';
      }).join('');
      const st = tlStatsFilter.status;
      const radio = (v, label) => '<label class="tl-stats-status"><input type="radio" name="tlStatsStatus" value="' + v + '"' + (st === v ? ' checked' : '') + '> ' + label + '</label>';
      box.innerHTML =
        '<div class="tl-stats-filter-row"><span class="lbl" title="点选胶囊过滤；点选父阶标签＝自动展开 BOM，纳入其全部子孙标签（与主程式标签过滤条同逻辑）">标签：</span><div class="tl-stats-tag-filters">' + (tagChips || '<span class="muted">（无标签可选）</span>') + '</div></div>' +
        '<div class="tl-stats-filter-row"><span class="lbl">完成状态：</span>' + radio('all', '全部') + radio('done', '已完成') + radio('undone', '未完成') +
        '<label class="tl-stats-status tl-stats-mainonly" title="事件主体：无子事件的事件本身＝主体；有子事件的事件由其子事件代表（主事件本身不计入主事件栏）"><input type="checkbox" data-tl-stats-mainonly="1"' + (tlStatsFilter.mainOnly ? ' checked' : '') + '> 只显示事件主体</label></div>';
      // 标签胶囊点击（事件委托，绑定在稳定容器上只绑一次；与主程式 #tlEvTagFilter 委托同模式）
      if (!tlStatsTagBoxBound) {
        tlStatsTagBoxBound = true;
        box.addEventListener('click', (e) => {
          const chip = e.target.closest ? e.target.closest('[data-tl-stats-tag]') : null;
          if (!chip) return;
          const v = chip.getAttribute('data-tl-stats-tag');
          if (tlStatsFilter.tags.has(v)) tlStatsFilter.tags.delete(v); else tlStatsFilter.tags.add(v);
          tlRenderStatsFilters();  // 重绘胶囊：即时切换主动/被动（继承）态
          tlRenderStatsBody();
        });
      }
      box.querySelectorAll('input[name="tlStatsStatus"]').forEach((rb) => {
        rb.addEventListener('change', () => { if (rb.checked) { tlStatsFilter.status = rb.value; tlRenderStatsBody(); } });
      });
      box.querySelectorAll('input[data-tl-stats-mainonly]').forEach((cb) => {
        cb.addEventListener('change', () => { tlStatsFilter.mainOnly = cb.checked; tlRenderStatsBody(); });
      });
    }
    function tlRenderStatsBody() {
      const body = document.getElementById('tlEvStatsBody');
      if (!body) return;
      const s = tlBuildStats(tlStatsFilter);
      const emptyMsg = (tlCalEvents.length === 0) ? 'calendar.md 中还没有任何行程事件' : '没有符合筛选条件的事件';
      body.innerHTML = (s.mainT || s.subT)
        ? tlStatsSummaryHtml(s) + tlStatsTableHtml(s)
        : '<div class="tl-stats-empty">' + emptyMsg + '</div>';
    }
    function tlOpenStats() {
      const overlay = document.getElementById('tlEvStatsOverlay');
      if (!overlay) return;
      const fileEl = document.getElementById('tlEvStatsFile');
      if (fileEl) fileEl.textContent = tlFileSizeLabel();
      tlRenderStatsFilters();
      tlRenderStatsBody();
      overlay.style.display = 'flex';
    }
    function tlCloseStats() {
      const overlay = document.getElementById('tlEvStatsOverlay');
      if (overlay) overlay.style.display = 'none';
      tlStatsTipHide();
    }
    // 🖱 事件统计：子事件内容悬停 → 浅蓝背景 tooltip（替代深色原生 title）
    let tlStatsTipEl = null;
    function tlStatsTipGet() {
      if (!tlStatsTipEl) {
        tlStatsTipEl = document.createElement('div');
        tlStatsTipEl.className = 'tl-stats-tip';
        tlStatsTipEl.setAttribute('role', 'tooltip');
        tlStatsTipEl.style.display = 'none';
        document.body.appendChild(tlStatsTipEl);
      }
      return tlStatsTipEl;
    }
    function tlStatsTipShow(text, x, y) {
      const tip = tlStatsTipGet();
      tip.textContent = text;
      tip.style.display = 'block';
      const r = tip.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 14);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 14);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function tlStatsTipHide() { if (tlStatsTipEl) tlStatsTipEl.style.display = 'none'; }
    // UTF-8 字节长度（纯 JS，无依赖）：用于估算当前加载的 calendar.md 内容大小
    function tlUtf8Len(s) {
      if (!s) return 0;
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } // 代理对
        else n += 3;
      }
      return n;
    }
    // 统计弹层表头：展示「calendar.md 文件名 · 内容大小」（大小取当前编辑器缓冲，即正在统计的数据）
    function tlFileSizeLabel() {
      const t = currentFileTarget();
      const fname = (t && t.name) ? t.name : 'calendar.md';
      const ta = document.getElementById('taskText');
      const bytes = tlUtf8Len(ta ? (ta.value || '') : '');
      const sizeStr = bytes.toLocaleString('en-US') + ' Bytes'; // 固定 byte 顯示＋千分位逗號（不走 formatFileSizeShort 的 KB 縮寫）
      return fname + ' · ' + sizeStr;
    }

    // 日 / 周视图 时间网格（移植自 calendar 插件的 buildTimeGrid，使用 ev- 前缀类名）
    function tlRenderTimeGrid(dayDates) {
      const wrap = document.getElementById('tlEvWeekWrap');
      if (!wrap) return;
      // 重複展開視窗：網格首末日 ±7 天，避免 never 無限展開
      const first = dayDates[0], last = dayDates[dayDates.length - 1];
      tlSetRepeatWindow(tlFmtDate(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7)), tlFmtDate(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7)));
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
        // 📕 当天有日记 → 日期旁挂标记（与月格共用 tlDiaryMarkHtml）。
        // ⚠️ 必须放在 .dnum **内部**：.dnum 是 display:block，作为兄弟节点会另起一行 → 整行表头被顶高
        html += '<div class="ev-tg-head-cell' + (ds === todayStr ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') + '" data-date="' + ds + '" onclick="tlSelectWeekDay(\'' + ds + '\')">' +
          '<span class="dow">週' + WD[d.getDay()] + '</span><span class="dnum">' + label + tlDiaryMarkHtml(ds) + '</span></div>';
      });
      html += '</div>';
      if (hasAllDay) {
        html += '<div class="ev-allday-strip" style="--cols:' + n + '"><div class="label">全天</div>';
        allDayByCol.forEach((arr, ci) => {
          html += '<div class="ev-allday-col" data-date="' + tlFmtDate(dayDates[ci]) + '">';
          arr.forEach((o) => {
            const ev = o.ev;
            html += '<div class="ev-block all-day' + (ev.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '" data-occ-date="' + tlEscapeHtml(tlFmtDate(dayDates[ci])) + '" onclick="tlOpenEventForm(\'' + tlEscapeHtml(ev.uid) + '\')" style="--ev-color:' + tlEscapeHtml(ev.color || TL_CAL_COLORS[0]) + '">' +
              (ev.done ? '\u2713 ' : '') + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + tlSpanSuffix(o.idx, o.total) + tlEventTodoLinks(ev) + '</div>';
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
            // 跨天假日：与行程同款「(第几天/共几天)」，一天一格（ci＝所属列＝出现日）
            html += '<div class="ev-holiday-block" style="--holiday-color:' + tlEscapeHtml(region.color) + '" title="' + tlEscapeHtml(h.title) + '">' + region.icon + ' ' + tlRenderInlineMarkdown(h.title) + tlSpanDaySuffix(h, tlFmtDate(dayDates[ci])) + '</div>';
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
          html += '<div class="ev-block' + (e.done ? ' done' : '') + '" data-uid="' + tlEscapeHtml(e.uid) + '" data-occ-date="' + tlEscapeHtml(tlFmtDate(d)) + '" onclick="tlOpenEventForm(\'' + tlEscapeHtml(e.uid) + '\')" style="top:' + top + 'px;height:' + height + 'px;left:calc(' + left + '% + 1px);width:calc(' + width + '% - 3px);--ev-color:' + tlEscapeHtml(cbg) + '">' +
            // 跨天定时行程：该列即「出现日」，标题后标 (第几天/共几天)
            '<div class="t">' + (e.done ? '\u2713 ' : '') + tlRepeatIcon(e) + tlRenderInlineMarkdown(e.title) + tlSpanDaySuffix(e, tlFmtDate(d)) + tlEventTodoLinks(e) + '</div>' +
            (tm ? '<div class="tm">' + tlEscapeHtml(tm) + '</div>' : '') +
            (e.location ? '<div class="loc">' + tlEscapeHtml('\ud83d\udccd ' + e.location) + '</div>' : '') +
            (notes ? '<div class="notes">' + tlRenderNotes(notes, e.uid) + '</div>' : '') +
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
      const prevScrollTop = list.scrollTop; // 渲染前记录（确定性还原依据，不依赖缓存）
      const isDay = tlCalMode === 'day';
      const today = tlFmtDate(new Date());
      // 重複展開視窗：整週＝網格首末 ±7 天；單日＝選定日當天
      let rwFrom, rwTo;
      if (tlCalScope === 'full' && !isDay) {
        const wk = tlWeekDays(tlCalCursor);
        rwFrom = tlFmtDate(new Date(wk[0].getFullYear(), wk[0].getMonth(), wk[0].getDate() - 7));
        rwTo = tlFmtDate(new Date(wk[6].getFullYear(), wk[6].getMonth(), wk[6].getDate() + 7));
      } else {
        const ds = tlGridSelectedDay();
        rwFrom = rwTo = ds;
      }
      tlSetRepeatWindow(rwFrom, rwTo);
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
          for (const h of hols) g += tlHolidayHtml(h, today, ds);
          for (const ev of evs) g += tlItemHtml(ev, today, ds);
          html += (ds === sel) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
        }
        if (!any) html += '<div class="ev-scope-row">' + toggle + '</div><div class="ev-empty">本周没有行程</div>';
        list.innerHTML = html;
        list.classList.add('scope-follow');
        tlBindActiveDateScroll(list);
        // 明细滚动策略（2026-09-30-v2）：仅显式导航才滚；编辑存档/过滤/搜索/切范围均不自动滚动
        if (tlDetailListScrollPending) { tlDetailListScrollPending = false; tlScrollListToDate(list, list, tlGridSelectedDay()); }
        else { list.scrollTop = prevScrollTop; }
        tlUpdateActiveDate(list);
        tlAfterCalRender();
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
        for (const h of hols) html += tlHolidayHtml(h, today, ds);
        for (const ev of evs) html += tlItemHtml(ev, today, ds);
      }
      list.innerHTML = html;
      list.classList.remove('scope-follow');
      // 日/週单日明细：仅显式导航才滚到该日日期条；否则恢复渲染前位置
      if (tlDetailListScrollPending) { tlDetailListScrollPending = false; tlScrollListToDate(list, list, ds); }
      else { list.scrollTop = prevScrollTop; }
      tlAfterCalRender();
    }
    // 日/週视图：点日期标题切换「下方明细」显示的那一天（与月模式「选中日」、日模式「游标日」一致，均只显示单日）
    function tlSelectWeekDay(ds) {
      tlCalSelected = ds;
      tlDetailListScrollPending = true; // 显式点选日期：明细滚到该日
      if (tlCalMode === 'week') tlRenderTimeGrid(tlWeekDays(tlCalCursor));
      else if (tlCalMode === 'day') tlRenderTimeGrid([tlCalCursor]);
    }
    // 明细范围切换（日 <-> 月/週）：月模式切「整月」、週模式切「整週」；日模式无意义不显示。默认「日」。
    function tlScopeToggleHtml() {
      if (tlCalMode !== 'month' && tlCalMode !== 'week' && tlCalMode !== 'year') return '';
      const isFull = tlCalScope === 'full';
      const fullLabel = tlCalMode === 'week' ? '週' : (tlCalMode === 'year' ? '年' : '月');
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
      else if (tlCalMode === 'year') tlRenderYear(document.getElementById('taskText').value);
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
        return '<span class="ev-todo-chip" data-id="' + tlEscapeHtml(id) + '" title="' + tlEscapeHtml(name) + '"><span class="ev-todo-chip-name" data-id="' + tlEscapeHtml(id) + '">' + tlRenderInlineMarkdown(name) + '</span><span class="ev-todo-chip-x" data-id="' + tlEscapeHtml(id) + '" title="移除">✕</span></span>';
      }).join('');
    }
    function tlRenderEvTodoDropdown() {
      const dd = document.getElementById('tlEvTodoDropdown');
      if (!dd) return;
      const candidates = ((typeof todos !== 'undefined') ? todos : []).filter((t) => tlEvFormTodoIds.indexOf(t.id) < 0);
      if (!candidates.length) { dd.innerHTML = '<div class="ev-todo-dropdown-empty">已无更多卡片可选</div>'; return; }
      dd.innerHTML = candidates.map((t) => '<div class="ev-todo-dropdown-item" data-id="' + tlEscapeHtml(t.id) + '">' + tlRenderInlineMarkdown(tlTodoTitle(t)) + '</div>').join('');
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
      const isYear = mode === 'year';
      const isGrid = isWeek || isDay; // 日/周共用时间网格
      const setDisp = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v; };
      const isList = mode === 'list';
      setDisp('tlEvMonthNav', (isMonth || isGrid || isList || isYear) ? '' : 'none');
      setDisp('tlEvMonthWrap', isMonth ? '' : 'none');
      setDisp('tlEvWeekWrap', isGrid ? '' : 'none');
      setDisp('tlEvList', mode === 'list' ? '' : 'none');
      setDisp('tlEvYearWrap', isYear ? '' : 'none');
      setDisp('tlEvDayGridList', isGrid ? '' : 'none');   // 日/週时间网格下方的「当日/当周明细」列表（含假日）
      // 「跨天一笔 / 跨天多笔」切换：只在列表模式出现（月/週/日不显示，也不受其影响）
      setDisp('tlEvMultiDayBtn', isList ? '' : 'none');
      if (isList) tlUpdateMultiDayBtn();
      const lb = document.getElementById('tlEvModeList'); if (lb) lb.classList.toggle('active', mode === 'list');
      const db = document.getElementById('tlEvModeDay'); if (db) db.classList.toggle('active', isDay);
      const wb = document.getElementById('tlEvModeWeek'); if (wb) wb.classList.toggle('active', isWeek);
      const mb = document.getElementById('tlEvModeMonth'); if (mb) mb.classList.toggle('active', isMonth);
      const yb = document.getElementById('tlEvModeYear'); if (yb) yb.classList.toggle('active', isYear);
      const content = document.getElementById('taskText').value;
      tlCalEvents = tlAllEvents(content);
      tlCalHolidays = tlAllHolidays(content);
      tlCalDiaries = tlAllDiaries(content);
      tlRenderTagBar();
      tlRenderHolidayLegend(); // 动态图例：列出 calendar.md 中出现过的地区，辅助「目视差别」
      tlCursorTitle(); // ⚠️ 導航列標題每種模式都要更新（周模式尤其會跨月，不能殘留上次的「X年X月」）
      if (isMonth) tlRenderMonth(content);
      else if (isYear) tlRenderYear(content);
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
        t.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 週' + WD[d.getDay()];
      } else if (tlCalMode === 'week') {
        const ds = tlWeekDays(tlCalCursor);
        const y0 = ds[0].getFullYear(), y1 = ds[6].getFullYear();
        // 週區間：起始帶年；跨年時結尾也補年，避免「12/29 – 1/4」看不出年份
        t.textContent = y0 + '/' + (ds[0].getMonth() + 1) + '/' + ds[0].getDate() + ' – ' + (y1 === y0 ? '' : y1 + '/') + (ds[6].getMonth() + 1) + '/' + ds[6].getDate();
      } else if (tlCalMode === 'year') {
        t.textContent = tlCalCursor.getFullYear() + '年';
      } else if (tlCalMode === 'list') {
        t.textContent = '';
      } else {
        t.textContent = tlCalCursor.getFullYear() + '年' + (tlCalCursor.getMonth() + 1) + '月';
      }
    }

    // 🔁 重复规则「说人话」：把 ## EVENT(REPEAT) 的字段翻成一句可读文字（顶栏「重复事件一览」面板用）
    const TL_REPEAT_MODE_LABEL = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' };
    const TL_WD_LABEL = { sun: '日', mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六' };
    function tlRepeatRuleText(ev) {
      const mode = ev.repeatMode || '';
      if (!mode) return '';
      const interval = Math.max(1, parseInt(ev.repeatInterval, 10) || 1);
      const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年' }[mode] || '';
      let s = interval > 1 ? ('每 ' + interval + ' ' + unit) : (TL_REPEAT_MODE_LABEL[mode] || mode);
      if (mode === 'weekly') {
        // 未显式指定星期时按「起始日的星期」回退，与展开引擎 tlExpandRepeats 口径一致
        let wds = ev.repeatWeekDay || [];
        if (!wds.length && ev.date) { const d = new Date(ev.date + 'T00:00:00'); if (!isNaN(d)) wds = [TL_WD[d.getDay()]]; }
        if (wds.length) s += '（' + wds.map((w) => TL_WD_LABEL[w] || w).join('、') + '）';
      } else if (mode === 'monthly' && ev.repeatMonthDay) {
        s += ' 第 ' + (parseInt(ev.repeatMonthDay, 10) || ev.repeatMonthDay) + ' 日';
      } else if (mode === 'yearly' && ev.repeatYearMonthDay) {
        s += ' ' + String(ev.repeatYearMonthDay).replace(/^"|"$/g, '');
      }
      return s;
    }
    function tlRepeatEndText(ev) {
      const t = ev.repeatEndType || 'never';
      if (t === 'count') return '共 ' + (ev.repeatEndValue || '?') + ' 次';
      if (t === 'date') return '至 ' + (ev.repeatEndValue || '?');
      return '永不结束';
    }
    // 一览按钮图标（截图内的小「条列」字形）：三行 + 圆点
    const TL_REPEAT_OV_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

    // 顶栏过滤条：EVENT | HOLIDAY(地区细项) | REPEAT 三类顺序排列（EVENT/REPEAT 默认勾选）
    // EVENT/REPEAT 过滤普通/重复行程；HOLIDAY 分组内为「出现过的地区」细项（颜色/图标与渲染一致，零学习成本）
    function tlRenderHolidayLegend() {
      const el = document.getElementById('tlEvHolidayLegend');
      if (!el) return;
      const catEvent = '<label class="ev-legend-item ev-legend-cat' + (tlCalShowEvents ? '' : ' off') + '" title="勾选显示 / 取消勾选隐藏普通行程（EVENT）">' +
        '<input type="checkbox" ' + (tlCalShowEvents ? 'checked' : '') + ' onchange="tlSetCategoryChecked(\'event\', this.checked)">EVENT</label>';
      const catRepeat = '<label class="ev-legend-item ev-legend-cat' + (tlCalShowRepeat === 'none' ? ' off' : '') + '" title="REPEAT 三态：未勾选＝隐藏全部 / 半勾选＝只显示未来最近一次 / 全勾选＝最近的前一次＋未来4次（最多5次）；点击循环切换">' +
        '<input type="checkbox" id="tlEvRepeatChk" data-rep="repeat" onclick="tlCycleRepeat()" title="点击循环：隐藏全部 → 只显示未来最近一次 → 显示5次">REPEAT</label>';
      const items = [];
      const seen = {};
      for (const h of (tlCalHolidays || [])) {
        const r = (h.region || 'cn').toLowerCase();
        if (seen[r]) continue;
        seen[r] = true;
        const m = tlHolidayRegionMeta(r);
        const on = tlCalRegionFilter.indexOf(r) >= 0;
        items.push('<label class="ev-legend-item' + (on ? '' : ' off') + '" title="勾选显示 / 取消勾选隐藏该地区假日">' +
          '<input type="checkbox" ' + (on ? 'checked' : '') + ' style="accent-color:' + tlEscapeHtml(m.color) + '" onchange="tlSetRegionChecked(\'' + r + '\', this.checked)">' +
          '<span class="ev-legend-dot" style="background:' + tlEscapeHtml(m.color) + '"></span>' + m.icon + tlEscapeHtml(m.label) + '</label>');
      }
      let html = catEvent;
      if (items.length) html += '<span class="ev-legend-sep"></span><span class="ev-legend-label">HOLIDAY:</span>' + items.join('');
      // REPEAT 后接「条列」图标：点击开一览视窗（列出当前所有重复事件设定，点条目可直接编辑）
      const repeatMore = '<button type="button" class="ev-legend-more" title="查看全部重复事件设定" aria-label="查看全部重复事件设定" onclick="tlOpenRepeatOverview()">' + TL_REPEAT_OV_ICON + '</button>';
      html += '<span class="ev-legend-sep"></span>' + catRepeat + repeatMore;
      // 📓 「只显示日记」勾选：只在列表模式出现（月/週/日不显示，也不受其影响）
      if (tlCalMode === 'list') {
        tlLoadDiaryOnly();
        html += '<span class="ev-legend-sep"></span>' +
          '<label class="ev-legend-item ev-legend-cat' + (tlCalDiaryOnly ? '' : ' off') + '" title="只在列表模式生效：勾选后列表只列出有写日记的日期（行程与假日暂时隐藏）">' +
          '<input type="checkbox" ' + (tlCalDiaryOnly ? 'checked' : '') + ' onchange="tlSetDiaryOnly(this.checked)">只显示日记</label>';
      }
      // ☐ 「只显示未完成」：全模式生效（年/月/周/日/列表）——勾选后隐藏已完成（✓）的行程（假日无完成态，不受影响）
      tlLoadUndoneOnly();
      html += '<span class="ev-legend-sep"></span>' +
        '<label class="ev-legend-item ev-legend-cat' + (tlCalUndoneOnly ? '' : ' off') + '" title="勾选后隐藏已完成（✓）的行程，只看未完成（年/月/周/日/列表 全模式生效）">' +
        '<input type="checkbox" ' + (tlCalUndoneOnly ? 'checked' : '') + ' onchange="tlSetUndoneOnly(this.checked)">只显示未完成</label>';
      el.style.display = '';
      el.innerHTML = html;
      const repChk = el.querySelector('input[data-rep="repeat"]');
      if (repChk) { repChk.indeterminate = (tlCalShowRepeat === 'next'); repChk.checked = (tlCalShowRepeat === 'some'); }
    }

    // 🔁 重复事件一览：条列当前 calendar.md 中所有 ## EVENT(REPEAT)；点条目 → 套用既有行程编辑表单
    function tlRepeatOvItemHtml(ev) {
      const rule = tlRepeatRuleText(ev) + ' · ' + tlRepeatEndText(ev);
      const ex = (ev.repeatExcludeDates && ev.repeatExcludeDates.length) ? ' · 排除 ' + ev.repeatExcludeDates.length + ' 天' : '';
      const when = ev.allDay ? '全天' : (ev.startTime ? ev.startTime + (ev.endTime ? '-' + ev.endTime : '') : '');
      return '<div class="tl-repeat-ov-item" data-uid="' + tlEscapeHtml(ev.uid) + '" onclick="tlOpenRepeatEvent(\'' + tlEscapeHtml(ev.uid) + '\')">' +
        '<span class="tl-repeat-ov-swatch" style="background:' + tlEscapeHtml(ev.color) + '"></span>' +
        '<div class="tl-repeat-ov-main">' +
        '<div class="tl-repeat-ov-title">' + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + '</div>' +
        '<div class="tl-repeat-ov-rule">' + tlEscapeHtml(rule) + '</div>' +
        '<div class="tl-repeat-ov-meta">' + tlEscapeHtml('起始 ' + ev.date + (when ? ' · ' + when : '') + ex) + '</div>' +
        '</div></div>';
    }
    function tlOpenRepeatOverview() {
      if (!isCalendarMdDoc()) return;
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const reps = tlCalEvents.filter((e) => e.repeatMode).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const cnt = document.getElementById('tlRepeatOvCount');
      if (cnt) cnt.textContent = reps.length ? '（共 ' + reps.length + ' 条）' : '';
      const list = document.getElementById('tlRepeatOvList');
      if (list) {
        list.innerHTML = reps.length ? reps.map(tlRepeatOvItemHtml).join('')
          : '<div class="tl-repeat-ov-empty">目前没有任何重复事件<br><span class="tl-repeat-ov-empty-hint">点下方「＋ 新增重复事件」开始</span></div>';
      }
      const ov = document.getElementById('tlRepeatOverviewOverlay');
      if (ov) ov.style.display = 'flex';
    }
    // 点条目：先关一览，再开既有编辑表单（uid 相同，编辑后写回缓冲，按编辑器「保存」落盘）
    function tlOpenRepeatEvent(uid) { tlCloseRepeatOverview(); tlOpenEventForm(uid); }
    // 一览面板的「新增重复事件」：关一览 → 开「新增行程」表单并预置为重复模式（不另写一套表单）
    function tlNewRepeatEvent() { tlCloseRepeatOverview(); tlOpenEventForm(null, null, { repeat: true }); }
    function tlCloseRepeatOverview() {
      const ov = document.getElementById('tlRepeatOverviewOverlay');
      if (ov) ov.style.display = 'none';
    }

    function tlSetMode(mode) {
      tlCalMode = (mode === 'month') ? 'month' : (mode === 'week') ? 'week' : (mode === 'day') ? 'day' : (mode === 'year') ? 'year' : 'list';
      // 第十一批：年视图下方明细默认「整年」（full）；月/週/日恢复「默认以日显示」（day）
      tlCalScope = (tlCalMode === 'year') ? 'full' : 'day';
      if ((tlCalMode === 'month' || tlCalMode === 'year') && !tlCalSelected) tlCalSelected = tlFmtDate(new Date());
      if (tlCalMode === 'year') tlYearAutoScrollPending = true; // 网格：切到年视图滚动到当前月份
      if (tlCalMode === 'month') tlMonthAutoScrollPending = true; // 网格：切到月视图滚动到今天日期
      // 模式切换 / 进入：表身明细（年/月/周/日）或列表滚到今天（满足"切换模式后定位今天"）；编辑存档不在此路径 → 不滚
      if (tlCalMode === 'list') tlListScrollAnchorPending = true;
      else tlDetailListScrollPending = true;
      tlRenderEventsContent();
    }

    // 上/下一期：按当前模式步进（月→月、周→周、日→日、年→年）
    function tlCalStepCursor(dir) {
      if (tlCalMode === 'week') tlCalCursor = tlAddDays(tlCalCursor, dir * 7);
      else if (tlCalMode === 'day') tlCalCursor = tlAddDays(tlCalCursor, dir);
      else if (tlCalMode === 'year') tlCalCursor = new Date(tlCalCursor.getFullYear() + dir, tlCalCursor.getMonth(), 1);
      else tlCalCursor = new Date(tlCalCursor.getFullYear(), tlCalCursor.getMonth() + dir, 1);
      if (tlCalMode === 'month' && !tlCalSelected) tlCalSelected = tlFmtDate(tlCalCursor);
      tlRenderEventsContent();
    }

    // ===== 年视图：12 个月迷你月历（点击日期选日→下部显示明细；点击月份名 → 月视图） =====
    function tlRenderYear(content) {
      const grid = document.getElementById('tlEvYearGrid');
      if (!grid) return;
      tlCalEvents = tlAllEvents(content);
      tlCalHolidays = tlAllHolidays(content);
      tlCalDiaries = tlAllDiaries(content);
      const y = tlCalCursor.getFullYear();
      // 重複展開視窗：整年，重复事件/跨天行程首尾由展开引擎自行处理
      tlSetRepeatWindow(y + '-01-01', y + '-12-31');
      // 全年逐日事件出现（含跨天/重复展开，套用标签/分类过滤）→ 12 个月共用同一份
      const occByDate = {};
      tlCalEvents.filter(tlEventShown).forEach((ev) => {
        tlEventOccurrences(ev).forEach((o) => { (occByDate[o.date] = occByDate[o.date] || []).push(o); });
      });
      const today = tlFmtDate(new Date());
      const todayY = +today.slice(0, 4);
      const todayM = +today.slice(5, 7) - 1; // 0-based：今天所在月份（年视图月份卡片金色外框用）
      if (!tlCalSelected) tlCalSelected = today;
      const WD = ['一', '二', '三', '四', '五', '六', '日'];
      let html = '';
      for (let m = 0; m < 12; m++) {
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const offset = (new Date(y, m, 1).getDay() + 6) % 7; // 周一=0
        // 第十一批续：今天所在月份加金色外框（.cur-month），随视图年份自动判定
        const isCurMonth = (y === todayY && m === todayM);
        html += '<div class="ev-year-month' + (isCurMonth ? ' cur-month' : '') + '"><div class="ev-year-mh" onclick="tlGotoMonthFromYear(' + y + ',' + m + ')">' + (m + 1) + '月</div>';
        html += '<div class="ev-year-grid">';
        html += WD.map((w) => '<div class="ev-year-wd">' + w + '</div>').join('');
        for (let k = 0; k < offset; k++) html += '<div></div>';
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const occ = (occByDate[ds] || []).slice().sort(tlOccSort);
          const hols = tlHolidaysOnDay(ds);
          // 事件与假日合并成彩色圆点（最多 3 个；事件优先，假日其次），用 title 悬停列出标题
          const marks = [];
          for (const o of occ) marks.push({ color: o.ev.color || TL_CAL_COLORS[0], title: o.ev.title });
          for (const h of hols) marks.push({ color: tlHolidayRegionMeta(h.region).color, title: h.title });
          let dots = '';
          for (let i = 0; i < Math.min(3, marks.length); i++) {
            dots += '<span class="ev-year-dot" style="background:' + tlEscapeHtml(marks[i].color) + '"></span>';
          }
          if (marks.length > 3) dots += '<span class="ev-year-more">+' + (marks.length - 3) + '</span>';
          const evUids = occ.map((o) => o.ev.uid).join(',');
          html += '<div class="ev-year-day' + (ds === today ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') + '" data-date="' + ds + '" data-ev-uids="' + tlEscapeHtml(evUids) + '" onclick="tlSelectDateFromYear(\'' + ds + '\')">' +
            '<span class="n">' + d + '</span>' +
            (dots ? '<span class="ev-year-dots">' + dots + '</span>' : '') +
            '</div>';
        }
        html += '</div></div>';
      }
      grid.innerHTML = html;
      tlBindSplit(document.getElementById('tlEvYearWrap'), document.getElementById('tlEvYearSplit'));
      tlRenderYearDayList();
      if (tlYearAutoScrollPending) {
        tlYearAutoScrollPending = false;
        tlScrollYearToCurrentMonth();
      }
    }
    // 年视图：若当前月份卡片未完整显示在滚动区内，则平滑滚动到可视区中央
    function tlScrollYearToCurrentMonth(_n) {
      const cur = document.querySelector('#tlEvYearGrid .ev-year-month.cur-month');
      const scroller = document.querySelector('#tlEvYearWrap .ev-month-scroll');
      if (!cur || !scroller) return;
      // 📎 容器尚未布局（rect 全 0）时，误判为「已完整显示」会跳过滚动；未布局则延后一帧重试（上限 60）
      if (!scroller.offsetHeight) { if ((_n || 0) < 60) requestAnimationFrame(() => tlScrollYearToCurrentMonth((_n || 0) + 1)); return; }
      const sr = scroller.getBoundingClientRect();
      const cr = cur.getBoundingClientRect();
      // 已完整显示：无需滚动
      if (cr.top >= sr.top && cr.bottom <= sr.bottom) return;
      cur.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
    // 年视图：点日期选日 → 重绘选中态 + 下部明细；400ms 内连点同一天＝快速新增（与月视图一致）
    let tlYearLastCellClick = { date: null, t: 0 };
    function tlSelectDateFromYear(ds) {
      const now = Date.now();
      const isDbl = tlYearLastCellClick.date === ds && (now - tlYearLastCellClick.t) < 400;
      tlYearLastCellClick = isDbl ? { date: null, t: 0 } : { date: ds, t: now };
      tlCalSelected = ds;
      if (isDbl) { tlOpenEventForm(null, ds); return; }
      tlDetailListScrollPending = true; // 显式点选日期：明细滚到该日
      tlRenderYear(document.getElementById('taskText').value);
    }
    // 年视图下部：选定日行程明细（「日」=当天；年模式「年」=整年；月模式「月」=选中日所在整月，与月视图同口径）
    function tlRenderYearDayList() {
      const list = document.getElementById('tlEvYearDayList');
      if (!list) return;
      const prevScrollTop = list.scrollTop; // 渲染前记录（确定性还原依据，不依赖缓存）
      const today = tlFmtDate(new Date());
      const sel = tlCalSelected || today;
      const toggle = tlScopeToggleHtml();
      const mm = String(sel).match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
      const my = mm ? +mm[1] : tlCalCursor.getFullYear();
      const mo = mm ? +mm[2] - 1 : tlCalCursor.getMonth();
      if (tlCalScope === 'full') {
        // ⚠️ 年模式下的「年」范围必须取「整年」——曾一律沿用选中日所在月份 → 用户实测「by年 却只看到某一个月」
        const isYearScope = tlCalMode === 'year';
        const prefix = isYearScope ? String(my) : (my + '-' + String(mo + 1).padStart(2, '0'));
        // 重复展开视窗：年＝整年；月＝选中日所在月 + 前 7 天
        if (isYearScope) tlSetRepeatWindow(my + '-01-01', my + '-12-31');
        else tlSetRepeatWindow(tlFmtDate(new Date(my, mo, 1 - 7)), tlFmtDate(new Date(my, mo + 1, 0)));
        const byDate = tlEventsByDate(tlCalEvents.filter(tlEventShown), (ds) => typeof ds === 'string' && ds.slice(0, prefix.length) === prefix);
        const dates = Array.from(byDate.keys()).sort();
        let total = 0;
        byDate.forEach((g) => { total += g.events.length + g.holidays.length; });
        let html = '';
        if (!dates.length) html += '<div class="ev-date active">' + (isYearScope ? my + '年' : (mo + 1) + '月') + ' <span class="ev-week">全部 ' + total + ' 条</span>' +
          '<span style="flex:1"></span>' + toggle + '</div><div class="ev-empty">' + (isYearScope ? '本年没有行程' : '本月没有行程') + '</div>';
        else {
          for (let i = 0; i < dates.length; i++) {
            const grp = byDate.get(dates[i]);
            let g = tlDateHeader(dates[i], today, toggle, grp.events.length + grp.holidays.length);
            for (const h of grp.holidays) g += tlHolidayHtml(h, today, dates[i]);
            for (const ev of tlSorted(grp.events)) g += tlItemHtml(ev, today, dates[i]);
            html += (dates[i] === sel) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
          }
        }
        list.innerHTML = html;
        list.classList.add('scope-follow');
        tlBindActiveDateScroll(list);
        // 明细滚动策略（2026-09-30-v2）：仅显式导航（今天/点选日期）才滚到选定日；编辑存档/过滤/搜索/切范围均不自动滚动
        if (tlDetailListScrollPending) { tlDetailListScrollPending = false; tlScrollListToDate(list, list, sel); }
        else { list.scrollTop = prevScrollTop; }
        tlUpdateActiveDate(list);
        tlAfterCalRender();
        return;
      }
      // 「日」范围（默认）：选定日单日
      tlSetRepeatWindow(sel, sel);
      const dayItems = tlDayItems(sel);
      const evs = tlSorted(dayItems.events);
      const hols = dayItems.holidays;
      let html = tlDateHeader(sel, today, toggle, evs.length + hols.length);
      if (!evs.length && !hols.length) html += '<div class="ev-empty">这一天没有行程</div>';
      else {
        for (const h of hols) html += tlHolidayHtml(h, today, sel);
        for (const ev of evs) html += tlItemHtml(ev, today, sel);
      }
      list.classList.remove('scope-follow');
      list.innerHTML = html;
      tlAfterCalRender();
    }
    // 年视图：点月份名 → 切到该月的「月」视图
    function tlGotoMonthFromYear(y, m) {
      tlCalCursor = new Date(y, m, 1);
      tlCalSelected = tlFmtDate(new Date(y, m, 1));
      tlSetMode('month');
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

    // opts.noAdd：抑制日期标题右侧的「＋ 新增」（「只显示日记」过滤下新增的行程不会出现在列表里，避免误导）
    function tlDateHeader(date, today, extra, count, opts) {
      const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const WD = ['日', '一', '二', '三', '四', '五', '六'];
      let label = '日期未知', week = '';
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        label = (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日';
        week = WD[d.getDay()];
      }
      const isToday = date === today;
      const cd = tlCountdownLabel(date, today);
      const cp = tlLunarCompact(date);
      const lunarHdr = cp.lunarText ? '農曆 ' + cp.lunarText + (cp.jieqi ? ' · ' + cp.jieqi : '') : (cp.jieqi || '');
      const dy = tlDiaryOnDate(date);
      const diaryBtn = '<button type="button" class="ev-day-diary' + (dy ? (dy.ro ? ' ro' : ' has') : '') + '" title="' + (dy ? '已有日记 · 点击编辑' : '写日记') + '" data-ev-diary="' + tlEscapeHtml(date) + '" onclick="tlOpenDiaryForm(\'' + date + '\')">\ud83d\udcd5</button>';
      return '<div class="ev-date' + (isToday ? ' today' : '') + '" data-ev-date="' + tlEscapeHtml(date) + '">' + label +
        (week ? '<span class="ev-week">週' + week + '</span>' : '') +
        // ⏳ 倒計時徽章：每天必顯示（今天＝高亮，其餘＝灰底），取代原先「僅今天顯示」
        (cd ? '<span class="ev-today-badge' + (isToday ? '' : ' dim') + '">' + cd + '</span>' : '') +
        // 当天条数（与「日」范围单日标题的「· N 条」一致；列表/整月/整週分组标题都显示）
        (typeof count === 'number' ? '<span class="ev-week">· ' + count + ' 条</span>' : '') +
        (lunarHdr ? '<span class="ev-lunar hdr" onclick="tlShowAlmanac(\'' + date + '\',this)" title="農民曆 / 老黃曆">' + tlEscapeHtml(lunarHdr) + '</span>' : '') +
        (extra || '') +
        diaryBtn +
        ((opts && opts.noAdd) ? '' : '<button type="button" class="ev-day-add" onclick="tlOpenEventForm(null, \'' + date + '\')">＋ 新增</button>') +
        '</div>';
    }

    // occDate＝该行所属的「出现日」（重复事件为展开后的当天；非重复＝ev.date）。
    // ⚠️ 重复事件的 ev.date 是「系列起始日」：若拿它算 past，则「过去开始的年度重复」在未来年份的实例会被误判为过去而淡化。
    // 📊 备注子事件完成进度徽章（标签旁「3/6」）：解析备注 checkbox 行，全部完成时徽章转绿
    function tlSubProgressBadge(ev) {
      const subs = tlParseNoteChecks(ev && ev.notes);
      if (!subs.length) return '';
      const done = subs.filter((s) => s.done).length;
      const all = done === subs.length;
      return '<span class="ev-sub-progress' + (all ? ' all-done' : '') + '" title="备注子事件：' + done + ' / ' + subs.length + ' 已完成">' + done + '/' + subs.length + '</span>';
    }
    function tlItemHtml(ev, today, occDate) {
      const multi = tlIsMultiDay(ev);
      const isRep = !!ev.repeatMode;
      // 重复事件：该行代表「出现日当天」（单日）；非重复：用自身 date/endDate
      const effEnd = isRep ? (occDate || ev.date) : ((ev.endDate && ev.endDate !== ev.date) ? ev.endDate : ev.date);
      const past = effEnd < today;   // 等价于原「start<today 且 跨天未结束」——跨天 end<today 亦蕴含 start<today
      let time;
      if (multi) {
        time = ev.allDay
          ? (tlRangeLabel(ev.date, ev.endDate) + ' \u00b7 \u5171' + tlSpanDays(ev.date, ev.endDate) + '\u5929')
          : tlRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
      } else {
        time = ev.allDay ? '\u5168\u5929' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
      }
      const spanBadge = multi ? '<span class="ev-span-badge" title="\u8de8\u5929\u884c\u7a0b">\u2922 \u8de8' + tlSpanDays(ev.date, ev.endDate) + '\u5929</span>' : '';
      return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + (multi ? ' multi' : '') + '" data-uid="' + tlEscapeHtml(ev.uid) + '" data-occ-date="' + tlEscapeHtml(occDate || ev.date) + '">' +
        '<input type="checkbox" class="ev-check" onchange="tlToggleDone(\'' + ev.uid + '\', this.checked)"' +
        (ev.done ? ' checked' : '') + ' title="\u52fe\u9009=\u5df2\u5b8c\u6210\uff0c\u53d6\u6d88\u52fe\u9009=\u672a\u5b8c\u6210">' +
        (ev.ro ? '<span class="ev-ro-icon" title="来自被包含的只读文件，不可编辑">\u26d4</span>' : '') +
        '<span class="ev-swatch" style="background:' + tlEscapeHtml(ev.color) + '"></span>' +
        '<div class="ev-body">' +
        // 跨天行程（含跨天重复）标题后紧跟「(第几天/共几天)」——让「回上海 (3/7)」一眼看出是第三天
        '<div class="ev-title">' + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + tlSpanDaySuffix(ev, occDate) + spanBadge +
        (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map((t) => '<span class="ev-tag-view" data-tag="' + tlEscapeHtml(tlTagName(t)) + '">' + tlEscapeHtml(tlTagLabel(t)) + '</span>').join('') + '</span>' : '') +
        tlSubProgressBadge(ev) +
        // 📋 列表行「＋☐」：与编辑表单备注旁同一入口（开 CheckBox 小窗）；列表模式按「加入备注」直接存档
        (ev.ro ? '' : '<button type="button" class="ev-addcheck-btn" title="在备注末尾加入 CheckBox（加入后直接存档）" onclick="tlOpenAddCheckDialog(\'' + tlEscapeHtml(ev.uid) + '\')">＋☐</button>') +
        (ev.sticky > 0 ? '<span class="ev-sticky-flag" title="该事件已设为便利贴（桌面可见）">' + TL_STICKY_IC_SVG + '</span>' : '') +
        tlEventTodoLinks(ev) +
        '</div>' +
        '<div class="ev-meta">' + tlEscapeHtml(time) + (ev.location ? ' \u00b7 \ud83d\udccd' + tlEscapeHtml(ev.location) : '') + '</div>' +
        (ev.notes ? '<div class="ev-notes">' + tlRenderNotes(ev.notes, ev.uid) + '</div>' : '') +
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
    // 按当前模式「直接」重渲染（勿走 tlRenderEventsContent —— 它开头有宿主守卫 if (!calEventsView) return，
    //    勾选过滤条时会被拦下导致画面不刷新），再同步顶栏过滤条勾选态。分类/地区过滤共用。
    function tlRerenderCalendarView() {
      const content = document.getElementById('taskText').value;
      if (tlCalMode === 'month') tlRenderMonth(content);
      else if (tlCalMode === 'week') tlRenderTimeGrid(tlWeekDays(tlCalCursor));
      else if (tlCalMode === 'day') tlRenderTimeGrid([tlCalCursor]);
      else if (tlCalMode === 'year') tlRenderYear(content);
      else tlRenderList(content);
      tlRenderHolidayLegend();
    }

    // 🔎 重繪收尾：行程視圖下的搜尋是「畫面上的內容」，任何一次 innerHTML 重建都會把 <mark> 抹掉。
    //    由每個「渲染葉子」函数（tlRenderList / tlRenderDiaryOnlyList / tlRenderDayList /
    //    tlRenderDayGridList）在收尾处调用，按搜索框里的关键词原样重建高亮 —— 否则高亮凭空消失、
    //    右上角计数却还在显示旧数字（说谎）。
    //    ⚠️ 只在「行程视图 + 关键词非空」时起作用，其余情况是空操作；定义在 index.html 的内联脚本里。
    function tlAfterCalRender() {
      if (typeof tlCalSearchReapply === 'function') tlCalSearchReapply();
    }

    // 顶栏分类过滤：EVENT（普通行程）/ REPEAT（重复行程）
    function tlSetCategoryChecked(kind, on) {
      if (kind === 'event') tlCalShowEvents = !!on;
      else return;
      tlRerenderCalendarView();
    }
    // REPEAT 三態循環：none → next → some → none（點擊圖例 checkbox 切換）
    function tlCycleRepeat() {
      const order = ['none', 'next', 'some'];
      let i = order.indexOf(tlCalShowRepeat);
      if (i < 0) i = 0;
      tlCalShowRepeat = order[(i + 1) % order.length];
      tlRerenderCalendarView();
    }
    function tlSetRegionChecked(code, on) {
      const r = (code || '').toLowerCase();
      if (!r) return;
      const i = tlCalRegionFilter.indexOf(r);
      if (on && i < 0) tlCalRegionFilter.push(r);
      else if (!on && i >= 0) tlCalRegionFilter.splice(i, 1);
      tlRerenderCalendarView();
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
      return tlEventsByDate(tlCalEvents.filter(tlEventShown), (d) => d === ds).get(ds) || { events: [], holidays: [] };
    }
    // occDate＝该列所属的「出现日」：跨天假日（endDate ≠ date）用它算「(第几天/共几天)」，与行程同款。
    // ⚠️ 必须由调用方传入（分组入口只给 h + 日期，h 自身不知道自己被渲染在哪一天）。
    function tlHolidayHtml(h, today, occDate) {
      const meta = tlHolidayMeta(h.holidayType);
      const region = tlHolidayRegionMeta(h.region);
      const accent = region.color; // 假日主色＝地区色（地区为目视差别唯一来源；color 字段不参与假日着色）
      const multi = h.endDate && h.endDate !== h.date;
      const time = multi
        ? (tlMdShort(h.date) + ' – ' + tlMdShort(h.endDate) + ' · 共' + tlSpanDays(h.date, h.endDate) + '天')
        : '全天';
      const tags = (h.tags && h.tags.length) ? '<span class="ev-tags">' + h.tags.map((t) => '<span class="ev-tag-view" data-tag="' + tlEscapeHtml(tlTagName(t)) + '">' + tlEscapeHtml(tlTagLabel(t)) + '</span>').join('') + '</span>' : '';
      return '<div class="ev-holiday" data-ev-holiday="' + tlEscapeHtml(h.uid) + '" style="--holiday-color:' + tlEscapeHtml(accent) + '">' +
        (h.ro ? '<span class="ev-ro-icon" title="来自被包含的只读文件，不可编辑">\u26d4</span>' : '') +
        '<span class="ev-holiday-region" style="--region-color:' + tlEscapeHtml(region.color) + '" title="' + tlEscapeHtml(region.label + '地区假日') + '">' + region.icon + tlEscapeHtml(region.label) + '</span>' +
        '<span class="ev-holiday-badge">' + meta.icon + ' ' + tlEscapeHtml(meta.label) + '</span>' +
        '<div class="ev-body">' +
        '<div class="ev-title">' + tlRenderInlineMarkdown(h.title) + tlSpanDaySuffix(h, occDate) + tags + '</div>' +
        '<div class="ev-meta">' + tlEscapeHtml(time) + (h.location ? ' · 📍' + tlEscapeHtml(h.location) : '') + '</div>' +
        (h.notes ? '<div class="ev-notes">' + tlRenderNotes(h.notes, null) + '</div>' : '') +
        '</div></div>';
    }

    // ===== 列表模式：「跨天行程」显示方式（跨天一笔 / 跨天多笔）=====
    // 纯 UI 偏好（内存 + localStorage，键 tlCalMultiDay；绝不写回 calendar.md）。
    // 只在列表模式生效：跨天行程要不要「跨几天就显示几笔」——默认多笔（与「日」范围同口径）。
    const TL_MULTIDAY_KEY = 'tlCalMultiDay';
    function tlLoadMultiDayMode() {
      if (tlMultiDayLoaded) return tlCalMultiDayMode;
      tlMultiDayLoaded = true;
      let v = '';
      try { v = localStorage.getItem(TL_MULTIDAY_KEY) || ''; } catch (e) {}
      tlCalMultiDayMode = (v === 'one') ? 'one' : 'multi';
      return tlCalMultiDayMode;
    }
    // 同步「跨天一笔 / 跨天多笔」按钮的文案与高亮（按钮只在列表模式显示）
    function tlUpdateMultiDayBtn() {
      const b = document.getElementById('tlEvMultiDayBtn');
      if (!b) return;
      tlLoadMultiDayMode();
      const one = tlCalMultiDayMode === 'one';
      b.textContent = one ? '跨天一笔' : '跨天多笔';
      b.classList.toggle('active', one);
      b.title = one
        ? '当前「跨天一笔」：跨天行程只在起始日显示一笔 · 点击改为「跨天多笔」'
        : '当前「跨天多笔」：跨天行程跨几天就显示几笔 · 点击改为「跨天一笔」';
    }
    function tlSetMultiDayMode(mode) {
      tlCalMultiDayMode = (mode === 'one') ? 'one' : 'multi';
      tlMultiDayLoaded = true;
      try { localStorage.setItem(TL_MULTIDAY_KEY, tlCalMultiDayMode); } catch (e) {}
      tlUpdateMultiDayBtn();
      tlRerenderCalendarView();
    }
    function tlToggleMultiDayMode() { tlSetMultiDayMode(tlCalMultiDayMode === 'one' ? 'multi' : 'one'); }
    // 「跨天一笔」：同一个跨天行程在整份列表里只保留「最早出现日」那一笔，其余各天移除；
    // 被清空的日期（原本只挂着这一个跨天行程）整条删掉，避免留下「· 0 条」的空标题。
    // ⚠️ 就地改的是 tlRenderList 自己那份 byDate 副本——tlEventsByDate 的「逐日展开」口径不动，
    //    所以月格 chip / 时间网格 / 日明细一律不受影响（用户约定：只调列表模式）。
    function tlCollapseMultiDayRows(byDate) {
      const seen = new Set();
      for (const ds of Array.from(byDate.keys()).sort()) {
        const grp = byDate.get(ds);
        grp.events = grp.events.filter((ev) => {
          if (!tlIsMultiDay(ev)) return true;   // 单日行程（含重复事件的每个出现日）逐日照显
          if (seen.has(ev.uid)) return false;   // 跨天行程：后续天不再重复出现
          seen.add(ev.uid);
          return true;
        });
        if (!grp.events.length && !grp.holidays.length) byDate.delete(ds);
      }
    }

    // ===== 列表模式：「只显示日记」过滤（勾选后行程/假日全部隐藏，只列有日记的日期）=====
    // 纯 UI 偏好（内存 + localStorage，键 tlCalDiaryOnly；绝不写回 calendar.md）。只在列表模式生效。
    const TL_DIARYONLY_KEY = 'tlCalDiaryOnly';
    function tlLoadDiaryOnly() {
      if (tlDiaryOnlyLoaded) return tlCalDiaryOnly;
      tlDiaryOnlyLoaded = true;
      let v = '';
      try { v = localStorage.getItem(TL_DIARYONLY_KEY) || ''; } catch (e) {}
      tlCalDiaryOnly = (v === '1');
      return tlCalDiaryOnly;
    }
    function tlSetDiaryOnly(on) {
      tlCalDiaryOnly = !!on;
      tlDiaryOnlyLoaded = true;
      try { localStorage.setItem(TL_DIARYONLY_KEY, tlCalDiaryOnly ? '1' : '0'); } catch (e) {}
      tlRenderHolidayLegend();   // 同步顶栏勾选态（该勾选框只在列表模式渲染）
      tlRerenderCalendarView();
    }
    // ☐ 「只显示未完成」：纯 UI 偏好（内存 + localStorage，键 tlCalUndoneOnly；绝不写回 calendar.md）。全模式生效（收口于 tlEventShown）。
    const TL_UNDONEONLY_KEY = 'tlCalUndoneOnly';
    function tlLoadUndoneOnly() {
      if (tlUndoneOnlyLoaded) return tlCalUndoneOnly;
      tlUndoneOnlyLoaded = true;
      let v = '';
      try { v = localStorage.getItem(TL_UNDONEONLY_KEY) || ''; } catch (e) {}
      // 第十一批依用户截图设定：缺省（从未设过该键）＝默认「开」；仅当用户明确设过 '0' 才关闭
      tlCalUndoneOnly = (v === '' ? true : v === '1');
      return tlCalUndoneOnly;
    }
    function tlSetUndoneOnly(on) {
      tlCalUndoneOnly = !!on;
      tlUndoneOnlyLoaded = true;
      try { localStorage.setItem(TL_UNDONEONLY_KEY, tlCalUndoneOnly ? '1' : '0'); } catch (e) {}
      tlRenderHolidayLegend();   // 同步顶栏勾选态（该勾选框只在列表模式渲染）
      // 切换前：捕获当前画面顶部日期组＋偏移，用于切换后尽量不滚动（Feature #8）
      const list = tlActiveDetailList();
      let anchorDate = null, anchorOffset = 0;
      if (list) {
        const info = tlViewportTopDateInfo(list);
        if (info) { anchorDate = info.date; anchorOffset = info.offset; }
      }
      tlRerenderCalendarView();
      // 切换后：把锚点日期组对齐回原偏移（锚点被过滤掉 → 回落到最近的未过滤组）；覆盖重绘自带的 prevScrollTop 还原
      if (list && anchorDate) tlReanchorList(list, anchorDate, anchorOffset);
    }
    // 日记正文：压掉行尾空白并 trim 后以基础 Markdown 渲染（不截断）。
    // ⚠️ 绝不在这里截断：正文被截掉的部分根本没进 DOM，列表滚动条再怎么滚也滚不出来。
    function tlDiaryBody(content) {
      const raw = String(content || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
      return raw ? renderMarkdown(raw) : '';
    }
    // 日记条目：标题 + 心情/天气 + 标签 + 完整正文；「编辑」开既有日记表单。
    // ⚠️ 日记没有 color 字段 → 色点统一用日记绿 #16a34a（与日期标题上「已有日记」的 📕 勾同色）。
    function tlDiaryRowHtml(d) {
      const meta = [];
      if (d.mood) meta.push('心情 ' + d.mood);
      if (d.weather) meta.push(d.weather);
      const tags = (d.tags && d.tags.length)
        ? '<span class="ev-tags">' + d.tags.map((t) => '<span class="ev-tag-view" data-tag="' + tlEscapeHtml(tlTagName(t)) + '">' + tlEscapeHtml(tlTagLabel(t)) + '</span>').join('') + '</span>'
        : '';
      const body = tlDiaryBody(d.content);
      return '<div class="ev-item ev-diary-item" data-ev-diary-row="' + tlEscapeHtml(d.date) + '">' +
        '<span class="ev-swatch" style="background:#16a34a"></span>' +
        '<div class="ev-body">' +
        '<div class="ev-title">\ud83d\udcd5 ' + tlRenderInlineMarkdown(d.title || '（无标题）') + tags + '</div>' +
        (meta.length ? '<div class="ev-meta">' + tlEscapeHtml(meta.join(' · ')) + '</div>' : '') +
        (body ? '<div class="ev-notes">' + body + '</div>' : '') +
        '</div>' +
        '<div class="ev-actions">' +
        '<button type="button" onclick="tlOpenDiaryForm(\'' + d.date + '\')">\u7f16\u8f91</button>' +
        '<button type="button" onclick="tlDeleteDiaryByDate(\'' + d.date + '\')">\u5220\u9664</button>' +
        '</div></div>';
    }
    // 「只显示日记」的列表本体：日期组只来自 ## DIARY（行程/假日不参与），一天一条
    function tlRenderDiaryOnlyList(list) {
      const today = tlFmtDate(new Date());
      const prevScrollTop = list.scrollTop; // 渲染前先记下列表当前滚动位置（确定性还原依据）
      // 同一天只应有一条日记，但解析层不做唯一性保证 → 这里按日期去重（保留首条）
      const seen = {};
      const rows = (tlCalDiaries || []).filter((d) => d.date && !seen[d.date] && (seen[d.date] = true));
      if (!rows.length) {
        list.innerHTML = '<div class="ev-empty">尚未有日记<br><span style="font-size:12px">取消勾选「只显示日记」可回到行程清单；或在日期标题右侧点 \ud83d\udcd5 写一篇</span></div>';
        tlAfterCalRender();
        return;
      }
      const byDate = {};
      rows.forEach((d) => { byDate[d.date] = d; });
      const dates = rows.map((d) => d.date).sort();
      // 锚点日（「今天」或 < > 导航到的日期）：只用于判断「是否该框金边」与滚动，绝不因回退而漂移
      const anchor = tlListSel || today;
      const anchorInList = dates.indexOf(anchor) >= 0;
      // ⚠️ 「框选」只在锚点日本身真有分组时才生效：今天（或所选日）无内容 → 不框任何其它日
      const highlight = anchorInList ? anchor : null;
      const scrollTo = anchorInList ? anchor : (dates.find((d) => d > today) || dates[dates.length - 1] || today);
      if (anchorInList) tlListSel = anchor;
      let html = '';
      for (const ds of dates) {
        // 标题条不显示「· N 条」（一天一条，计数无信息量），并抑制「＋ 新增」（新增的是行程，此处不显示）
        let g = tlDateHeader(ds, today, '', undefined, { noAdd: true });
        g += tlDiaryRowHtml(byDate[ds]);
        html += (ds === highlight) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
      }
      list.innerHTML = html;
      // 列表滚动策略（2026-09-30，确定性）：除「今天 / < >」显式导航外，渲染后精确还原到渲染前的 scrollTop，绝不跳今天
      if (tlListScrollAnchorPending) {
        tlListScrollAnchorPending = false;
        tlScrollListToDate(list, list, scrollTo); // 仅显式导航：滚到锚点日（今天或所选日）
      } else {
        list.scrollTop = prevScrollTop; // 非显式导航：原地恢复，不自动滚动
      }
      tlAfterCalRender();
    }

    function tlRenderList(content) {
      const list = document.getElementById('tlEvList');
      if (!list) return;
      const prevScrollTop = list.scrollTop; // 渲染前先记下列表当前滚动位置（确定性还原依据，不依赖内存/缓存）
      tlCalEvents = tlAllEvents(content);
      tlCalHolidays = tlAllHolidays(content);
      tlCalDiaries = tlAllDiaries(content);
      // 📓 「只显示日记」：勾选后走专用分支（行程/假日不参与），连「尚未有行程」的空态也不适用
      tlLoadDiaryOnly();
      if (tlCalDiaryOnly) { tlRenderDiaryOnlyList(list); return; }
      if (!tlCalEvents.length && !tlVisibleHolidays().length) {
        list.innerHTML = '<div class="ev-empty">尚未有行程<br><span style="font-size:12px">点右上「＋ 新增行程」，或切回文本编辑直接改 calendar.md</span></div>';
        tlAfterCalRender();
        return;
      }
      const today = tlFmtDate(new Date());
      // 重複展開視窗（列表無固定範圍）：今天前 1 年 ~ 後 3 年，避免 never 無限展開
      tlSetRepeatWindow(tlAddDaysStr(today, -365), tlAddDaysStr(today, 1095));
      // 按日期分组（跨天行程/假日逐日展开，与「日」范围同口径）：每天先显示该日假日，再显示行程
      tlLoadMultiDayMode();
      // ☐ 「只显示未完成」已收口于 tlEventShown（全模式生效）：过滤链已排除 done ✓ 的行程
      tlLoadUndoneOnly();
      let evs = tlCalEvents.filter(tlEventShown);
      if (tlCalUndoneOnly && !evs.length && !tlVisibleHolidays().length) {
        list.innerHTML = '<div class="ev-empty">没有未完成的行程<br><span style="font-size:12px">取消勾选「只显示未完成」可查看全部</span></div>';
        tlAfterCalRender();
        return;
      }
      const byDate = tlEventsByDate(evs);
      if (tlCalMultiDayMode === 'one') tlCollapseMultiDayRows(byDate);   // 跨天一笔：跨天行程只在起始日显示一笔
      const dates = Array.from(byDate.keys()).sort();
      // 锚点日（「今天」或 < > 导航到的日期）：只用于判断「是否该框金边」与滚动，绝不因回退而漂移
      const anchor = tlListSel || today;
      const anchorInList = dates.indexOf(anchor) >= 0;
      // ⚠️ 「框选」（金色描边）只在锚点日本身真有分组时才生效：今天（或所选日）无行程 → 不框任何其它日
      const highlight = anchorInList ? anchor : null;
      // 滚动锚点：锚点日不在列表时回退「最近未来日」（仅滚动定位，不写回 tlListSel、不影响框选）
      const scrollTo = anchorInList ? anchor : (dates.find((d) => d > today) || dates[dates.length - 1] || today);
      if (anchorInList) tlListSel = anchor;
      let html = '';
      for (const ds of dates) {
        const grp = byDate.get(ds);
        let g = tlDateHeader(ds, today, '', grp.events.length + grp.holidays.length);
        for (const h of grp.holidays) g += tlHolidayHtml(h, today, ds);
        for (const ev of tlSorted(grp.events)) g += tlItemHtml(ev, today, ds);
        html += (ds === highlight) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
      }
      list.innerHTML = html;
      // 列表滚动策略（2026-09-30，确定性）：除「今天 / < >」显式导航外，渲染后精确还原到渲染前的 scrollTop，绝不跳今天
      if (tlListScrollAnchorPending) {
        tlListScrollAnchorPending = false;
        tlScrollListToDate(list, list, scrollTo); // 仅显式导航：滚到锚点日（今天 / 所选日；不在列表则最近未来日）
      } else {
        list.scrollTop = prevScrollTop; // 非显式导航（编辑/过滤/勾选/存档重载…）：原地恢复，不自动滚动
      }
      tlAfterCalRender();
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
      const today = tlFmtDate(new Date());
      const anchor = tlListSel || today;
      let idx = dates.indexOf(anchor);
      if (idx < 0) {
        // 锚点日不在列表（如今天无行程）：改以「最近未来日」为基准——dir>0 落在该未来日，dir<0 落在其前一日
        const fi = dates.findIndex((d) => d > today);
        if (fi < 0) idx = dates.length - 1;           // 全是过去日 → 以末日为基准
        else idx = (dir > 0) ? fi - 1 : fi;
      }
      const target = idx + dir;
      if (target < 0 || target >= dates.length) return;
      tlListSel = dates[target];
      // ⚠️ 用户要求：< > 只移动「选中日」高亮，不再滚动表身（与「今天」按钮区分）
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
    function tlScrollElToTop(el, scroller, _n) {
      if (!el || !scroller) return;
      // 📎 滚动容器尚未布局（高度为 0）时，offsetTop/scrollTop 计算会失效；未布局则延后一帧重试（上限 60）
      if (!scroller.offsetHeight) { if ((_n || 0) < 60) requestAnimationFrame(() => tlScrollElToTop(el, scroller, (_n || 0) + 1)); return; }
      scroller.scrollTop = tlElAbsTop(el, scroller);
    }
    function tlScrollListToDate(list, scroller, ds) {
      if (!list || !scroller || !ds) return;
      tlScrollElToTop(tlPickScrollTarget(list.querySelectorAll('.ev-date[data-ev-date]'), ds), scroller);
    }
    // 元素在 scroller 内的「绝对布局 scrollTop」（sticky 安全：先临时摘 .ev-date 再读，见 tlScrollElToTop）
    function tlElAbsTop(el, scroller) {
      const prevPos = el.style.position;
      el.style.position = 'static';
      const next = (el.offsetParent && el.offsetParent === scroller.offsetParent)
        ? el.offsetTop - scroller.offsetTop - (scroller.clientTop || 0)
        : scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
      el.style.position = prevPos;
      return next;
    }
    // 当前模式下真正可见/可滚动的「明细列表」元素（undone 勾选切换只重锚这一条）
    function tlActiveDetailList() {
      if (tlCalMode === 'list') return document.getElementById('tlEvList');
      if (tlCalMode === 'year') return document.getElementById('tlEvYearDayList');
      return document.getElementById('tlEvDayList'); // month / week / day
    }
    // 切换前：捕获「视口顶部日期组」及其在滚动容器内的相对偏移（用于切换后尽量不滚动）
    function tlViewportTopDateInfo(list) {
      if (!list) return null;
      const active = tlPickActiveDate(list); // 复用顶部 sticky 日期条判定（已是 sticky 安全版）
      if (!active) return null;
      const offset = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
      return { date: active.dataset.evDate, offset: offset };
    }
    // 给定一组日期标题，挑与 ds 日期距离最小者（tie → 较晚日期）；ds 已被过滤掉时用来回落到「最近的未过滤组」
    function tlNearestDateHeader(headers, ds) {
      if (!headers || !headers.length) return null;
      const base = parseInt(ds.replace(/-/g, ''), 10);
      let best = null, bestD = Infinity;
      for (const h of headers) {
        const d = Math.abs(parseInt(h.dataset.evDate.replace(/-/g, ''), 10) - base);
        if (d < bestD || (d === bestD && best && h.dataset.evDate > best.dataset.evDate)) { bestD = d; best = h; }
      }
      return best;
    }
    // 切换后把列表重锚：锚点存活→保持原偏移（＝不滚动）；锚点被过滤掉→滚到最近未过滤组（置顶）
    function tlReanchorList(list, anchorDate, anchorOffset) {
      const headers = list.querySelectorAll('.ev-date[data-ev-date]');
      if (!headers.length) { tlUndoneScrollResult = null; return; }
      let target = null, survived = false;
      for (const h of headers) if (h.dataset.evDate === anchorDate) { target = h; survived = true; break; }
      if (!target) target = tlNearestDateHeader(headers, anchorDate);
      if (!target) { tlUndoneScrollResult = null; return; }
      const absTop = tlElAbsTop(target, list);
      list.scrollTop = survived ? (absTop - anchorOffset) : absTop;
      tlUndoneScrollResult = target.dataset.evDate;
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
    const TL_SPLIT_MIN_PX = 56;        // 明细最小（宽/高）度（至少看得见一条日期条）
    const TL_SPLIT_TOP_MIN_PX = 120;   // 上区最小高度（仍看得见月格 / 时间网格）
    const TL_SPLIT_LEFT_MIN_PX = 220;  // 左右布局下左区（日历）最小宽度
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
    // 指针 → 明细 尺寸百分比（实时量 rect，不依赖缓存尺寸）；只写 CSS 变量，不落盘
    // horizontal 模式（左右布局）：用宽度 + clientX 写 --ev-detail-w；否则用高度 + clientY 写 --ev-detail-h
    function tlApplySplitFromPointer(wrap, clientX, clientY) {
      const horizontal = wrap.classList.contains('horizontal');
      const r = wrap.getBoundingClientRect();
      if (horizontal) {
        if (!r.width) return null;
        const maxPx = Math.max(TL_SPLIT_MIN_PX, r.width - TL_SPLIT_LEFT_MIN_PX);
        const px = Math.min(Math.max(TL_SPLIT_MIN_PX, r.right - clientX), maxPx);
        const pct = px / r.width * 100;
        wrap.style.setProperty('--ev-detail-w', pct + '%');
        return pct;
      }
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
      const pct0 = tlLoadSplitPct();
      wrap.style.setProperty('--ev-detail-h', pct0 + '%');
      wrap.style.setProperty('--ev-detail-w', pct0 + '%');
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
        tlApplySplitFromPointer(wrap, e.clientX, e.clientY);
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false;
        split.classList.remove('dragging');
        try { split.releasePointerCapture(e.pointerId); } catch (err) {}
        const pct = tlApplySplitFromPointer(wrap, e.clientX, e.clientY);
        if (pct != null) tlSaveSplitPct(pct);   // 松手才落盘
      };
      split.addEventListener('pointerup', end);
      split.addEventListener('pointercancel', end);
      split.addEventListener('dblclick', () => {
        tlSaveSplitPct(TL_SPLIT_DEFAULT);
        wrap.style.setProperty('--ev-detail-h', TL_SPLIT_DEFAULT + '%');
        wrap.style.setProperty('--ev-detail-w', TL_SPLIT_DEFAULT + '%');
      });
    }

    // ===== 上下 / 左右 布局切换（纯 UI 偏好，localStorage，绝不落盘数据文件）=====
    const TL_LAYOUT_KEY = 'tlCalSplitLayout';
    // 套用已存偏好：给三个 .ev-split 容器（周/月/年）统一加/去 .horizontal，并同步切换按钮文案
    function tlApplyCalLayout() {
      let horizontal = false;
      try { horizontal = localStorage.getItem(TL_LAYOUT_KEY) === '1'; } catch (e) {}
      ['tlEvWeekWrap', 'tlEvMonthWrap', 'tlEvYearWrap'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('horizontal', horizontal);
      });
      const btn = document.getElementById('tlCalLayoutBtn');
      // 圆形图标钮：▤＝上下、▥＝左右；.active 高亮表示当前为左右布局（颜色即状态）
      if (btn) {
        btn.textContent = horizontal ? '▥' : '▤';
        btn.title = horizontal ? '当前：左右布局（点击切换为上下）' : '当前：上下布局（点击切换为左右）';
        btn.classList.toggle('active', horizontal);
      }
    }
    // 切换：读当前（以月视图容器为准，三容器状态一致），翻转后存盘并重套
    function tlToggleCalLayout() {
      const cur = (() => { const el = document.getElementById('tlEvMonthWrap'); return el && el.classList.contains('horizontal'); })();
      try { localStorage.setItem(TL_LAYOUT_KEY, cur ? '0' : '1'); } catch (e) {}
      tlApplyCalLayout();
    }

    function tlRenderMonth(content) {
      tlCalEvents = tlAllEvents(content);
      tlCalHolidays = tlAllHolidays(content);
      tlCalDiaries = tlAllDiaries(content);
      const cur = tlCalCursor;
      const y = cur.getFullYear(), m = cur.getMonth();
      // 重複展開視窗：當月 + 前後 7 天（網格含跨月首尾週），避免 never 無限展開
      const mFirst = new Date(y, m, 1), mLast = new Date(y, m + 1, 0);
      tlSetRepeatWindow(tlFmtDate(new Date(y, m, 1 - 7)), tlFmtDate(mLast));
      const occByDate = {};
      tlCalEvents.filter(tlEventShown).forEach((ev) => {
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
          chips += tlSpanChipHtml(occ[j].ev, occ[j].pos, occ[j].idx, occ[j].total, occ[j].date);
        }
        if (occ.length > evCap) chips += '<div class="ev-more">+' + (occ.length - evCap) + '</div>';
        const cp = tlLunarCompact(ds);
        const lunarCls = 'ev-lunar' + (cp.jieqi ? ' jieqi' : '');
        const lunarSpan = cp.text
          ? '<span class="' + lunarCls + '" onclick="event.stopPropagation();tlShowAlmanac(\'' + ds + '\',this)" title="農民曆 / 老黃曆">' + tlEscapeHtml(cp.text) + '</span>'
          : '';
        // 📕 当天有日记 → 日期数字旁挂一枚小图标（与日期标题上的「日记按钮」同图标，日期一眼可辨）
        const diaryMark = tlDiaryMarkHtml(ds);
        html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === today ? ' today' : '') + (ds === tlCalSelected ? ' selected' : '') +
          '" data-date="' + ds + '" onclick="tlSelectDate(\'' + ds + '\')"><span class="ev-daynum">' + d.getDate() + '</span>' + diaryMark + lunarSpan + chips + '</div>';
      }
      const grid = document.getElementById('tlEvMonthGrid');
      if (grid) grid.innerHTML = html;
      tlBindSplit(document.getElementById('tlEvMonthWrap'), document.getElementById('tlEvMonthSplit'));
      tlRenderDayList();
      if (tlMonthAutoScrollPending) {
        tlMonthAutoScrollPending = false;
        tlScrollMonthToToday();
      }
    }

    // 月视图：若「今天」日期格未完整显示在滚动区内，则平滑滚动到可视区中央
    function tlScrollMonthToToday(_n) {
      const todayCell = document.querySelector('#tlEvMonthGrid .ev-cell.today');
      const scroller = document.querySelector('#tlEvMonthWrap .ev-month-scroll');
      if (!todayCell || !scroller) return;
      // 📎 容器尚未布局（rect 全 0）时误判已显示而跳过；未布局则延后一帧重试（上限 60）
      if (!scroller.offsetHeight) { if ((_n || 0) < 60) requestAnimationFrame(() => tlScrollMonthToToday((_n || 0) + 1)); return; }
      const sr = scroller.getBoundingClientRect();
      const cr = todayCell.getBoundingClientRect();
      // 已完整显示：无需滚动
      if (cr.top >= sr.top && cr.bottom <= sr.bottom) return;
      todayCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
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
      tlDetailListScrollPending = true; // 显式点选日期：明细滚到该日
      tlRenderMonth(document.getElementById('taskText').value);
    }

    function tlRenderDayList() {
      const list = document.getElementById('tlEvDayList');
      if (!list) return;
      const prevScrollTop = list.scrollTop; // 渲染前记录（确定性还原依据，不依赖缓存）
      const today = tlFmtDate(new Date());
      // 重複展開視窗：整月＝當月 + 前 7 天（含跨月首尾週）；單日＝選定日當天
      if (tlCalScope === 'full') {
        const mo = tlCalCursor.getMonth(), my = tlCalCursor.getFullYear();
        const mLast = new Date(my, mo + 1, 0);
        tlSetRepeatWindow(tlFmtDate(new Date(my, mo, 1 - 7)), tlFmtDate(mLast));
      } else {
        tlSetRepeatWindow(tlCalSelected || today, tlCalSelected || today);
      }
      const toggle = tlScopeToggleHtml();
      // 「月」范围：渲染游标月整月（按日期分组，只含该月开始的事件/假日），头部显示汇总 + 切换
      if (tlCalScope === 'full') {
        const mo = tlCalCursor.getMonth();
        const prefix = tlCalCursor.getFullYear() + '-' + String(mo + 1).padStart(2, '0');
        const byDate = tlEventsByDate(tlCalEvents.filter(tlEventShown), (ds) => typeof ds === 'string' && ds.slice(0, 7) === prefix);
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
            for (const h of grp.holidays) g += tlHolidayHtml(h, today, dates[i]);
            for (const ev of tlSorted(grp.events)) g += tlItemHtml(ev, today, dates[i]);
            html += (dates[i] === tlCalSelected) ? '<div class="ev-date-group sel-date">' + g + '</div>' : g;
          }
        }
        list.innerHTML = html;
        list.classList.add('scope-follow');
        tlBindActiveDateScroll(list);
        // 整月：仅显式导航才滚到「选中日」日期条；编辑存档/过滤/搜索/切范围均不自动滚动
        if (tlDetailListScrollPending) { tlDetailListScrollPending = false; tlScrollListToDate(list, list, tlCalSelected); }
        else { list.scrollTop = prevScrollTop; }
        tlUpdateActiveDate(list);
        tlAfterCalRender();
        return;
      }
      // 「日」范围（默认）：选定日单日
      const ds = tlCalSelected || tlFmtDate(new Date());
      const dayItems = tlDayItems(ds);
      const evs = tlSorted(dayItems.events);
      const hols = dayItems.holidays;
      // 与「月」范围/列表模式共用 tlDateHeader（含倒计时/农历/日记按钮），避免两范围头部不一致
      let html = tlDateHeader(ds, today, toggle, evs.length + hols.length);
      if (!evs.length && !hols.length) html += '<div class="ev-empty">这一天没有行程</div>';
      else {
        for (const h of hols) html += tlHolidayHtml(h, today, ds);
        for (const ev of evs) html += tlItemHtml(ev, today, ds);
      }
      list.classList.remove('scope-follow');
      list.innerHTML = html;
      tlAfterCalRender();
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
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      tlRenderTagOptions();
      tlEvFormUid = null;
      let ev = null;
      if (uid) {
        ev = tlCalEvents.find((x) => x.uid === uid);
        if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
        if (ev.ro) { showToast('此行程来自被包含的只读文件，不可编辑', 'danger'); return; }
        tlEvFormUid = uid;
      }
      const p = pre || {}; // 🖱 雙擊空白快速新增時的預填：{ allDay, startTime, endTime }
      const today = tlFmtDate(new Date());
      document.getElementById('tlEvFormTitle').textContent = uid ? '编辑行程' : '新增行程';
      document.getElementById('tlEvFTitle').value = ev ? ev.title : '';
      document.getElementById('tlEvFDate').value = ev ? ev.date : (defaultDate || (tlCalMode === 'month' ? tlCalSelected : today) || today);
      document.getElementById('tlEvFEndDate').value = ev ? (ev.endDate || '') : '';
      // ===== 重複事件 =====
      // p.repeat：由「重复事件一览」的新增按钮传入 → 新增时直接进「重复」模式并带出起始日的星期
      const rMode = ev ? (ev.repeatMode || '') : (p.repeat ? 'weekly' : '');
      document.getElementById('tlEvFRepeatOn').checked = !!rMode;
      document.getElementById('tlEvFRepeatFields').style.display = rMode ? '' : 'none';
      document.getElementById('tlEvFRepeatMode').value = rMode || 'weekly';
      document.getElementById('tlEvFRepeatInterval').value = ev && ev.repeatInterval ? (parseInt(ev.repeatInterval, 10) || 1) : 1;
      tlRenderRepeatWeekDays(ev ? (ev.repeatWeekDay || []) : []);
      document.getElementById('tlEvFMonthDay').value = ev && ev.repeatMonthDay ? (parseInt(ev.repeatMonthDay, 10) || '') : '';
      document.getElementById('tlEvFYearMonthDay').value = ev && ev.repeatYearMonthDay ? String(ev.repeatYearMonthDay).replace(/^"|"$/g, '') : '';
      const rEnd = ev ? (ev.repeatEndType || 'never') : 'never';
      document.getElementById('tlEvFRepeatEndType').value = rEnd;
      document.getElementById('tlEvFRepeatEndValue').value = ev && ev.repeatEndValue != null ? String(ev.repeatEndValue) : '';
      document.getElementById('tlEvFRepeatExclude').value = (ev && ev.repeatExcludeDates && ev.repeatExcludeDates.length) ? ev.repeatExcludeDates.join(', ') : '';
      tlOnRepeatModeChange();
      tlOnRepeatEndTypeChange();
      if (!uid && p.repeat) tlToggleRepeat(); // 走既有入口：展开重复字段 + 自动勾上起始日所属星期
      tlUpdateFormDow(); // 🗓 依輸入日期即時顯示星期
      document.getElementById('tlEvFAllday').checked = ev ? ev.allDay : (p.allDay === true);
      // 完成状态：新增默认未完成（旧文件没有 - done 栏位时解析也是未完成）
      document.getElementById('tlEvFDone').checked = ev ? !!ev.done : false;
      document.getElementById('tlEvFStart').value = ev ? ev.startTime : (p.startTime || '');
      document.getElementById('tlEvFEnd').value = ev ? ev.endTime : (p.endTime || '');
      tlToggleAllDay();
      document.getElementById('tlEvFLocation').value = ev ? ev.location : '';
      tlEvFormColor = ev ? ev.color : TL_CAL_COLORS[0];
      tlEvFormSticky = ev ? (ev.sticky || 0) : 0;
      document.getElementById('tlEvFSticky').value = tlEvFormSticky;
      tlSyncStickyFlag();
      tlEvFormTags = tlNormalizeTags(ev && ev.tags ? ev.tags : []);
      document.getElementById('tlEvFTags').value = '';
      tlRenderTagPicker();
      document.getElementById('tlEvFNotes').value = ev ? ev.notes : '';
      document.getElementById('tlEvFormDelete').style.display = uid ? '' : 'none';
      tlEvFormTodoIds = ev ? (ev.todoIds || []).slice() : [];
      tlRenderEvTodoLinkPanel();
      tlRenderColors();
      document.getElementById('tlEvFormOverlay').style.display = 'flex';
      tlAutoSizeNotes();
      document.getElementById('tlEvFTitle').focus();
    }

    // 📝 開啟編輯/新增行程時，依備註內容自動加高 textarea（最多 15 行，不足 15 行按實際行數）
    function tlAutoSizeNotes() {
      const ta = document.getElementById('tlEvFNotes');
      if (!ta) return;
      ta.style.height = 'auto';
      const cs = getComputedStyle(ta);
      let lh = parseFloat(cs.lineHeight);
      if (!lh) lh = parseFloat(cs.fontSize) * 1.3;
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const maxH = lh * 15 + pad;
      const h = Math.min(ta.scrollHeight, maxH);
      ta.style.height = h + 'px';
      ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
    }

    function tlToggleAllDay() {
      const allDay = document.getElementById('tlEvFAllday').checked;
      document.getElementById('tlEvFStart').disabled = allDay;
      document.getElementById('tlEvFEnd').disabled = allDay;
    }

    // ===== ## EVENT(REPEAT) 表單控件 =====
    const TL_REPEAT_INTERVAL_UNIT = { daily: '天', weekly: '周', monthly: '月', yearly: '年' };
    function tlToggleRepeat() {
      const on = document.getElementById('tlEvFRepeatOn').checked;
      document.getElementById('tlEvFRepeatFields').style.display = on ? '' : 'none';
      if (on) {
        if (!document.getElementById('tlEvFRepeatMode').value) document.getElementById('tlEvFRepeatMode').value = 'weekly';
        if (!document.getElementById('tlEvFRepeatInterval').value) document.getElementById('tlEvFRepeatInterval').value = '1';
        const d = document.getElementById('tlEvFDate').value;
        if (d && !tlGetRepeatWeekDays().length) {
          const wd = TL_WD[new Date(d + 'T00:00:00').getDay()];
          tlSetWeekDay(wd, true);
        }
        tlOnRepeatModeChange();
        tlOnRepeatEndTypeChange();
      }
    }
    function tlRenderRepeatWeekDays(selected) {
      selected = selected || [];
      const labels = { sun: '日', mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六' };
      const box = document.getElementById('tlEvFWeekDays');
      if (!box) return;
      box.innerHTML = TL_WD.map((w) =>
        '<label class="tl-ev-f-wd"><input type="checkbox" data-wd="' + w + '"' + (selected.indexOf(w) >= 0 ? ' checked' : '') + ' onchange="tlOnWeekDayChange()">' + labels[w] + '</label>'
      ).join('');
    }
    function tlSetWeekDay(w, checked) {
      const el = document.querySelector('#tlEvFWeekDays input[data-wd="' + w + '"]');
      if (el) el.checked = checked;
    }
    function tlOnWeekDayChange() { /* 仅作委派占位，取值走 tlGetRepeatWeekDays */ }
    function tlGetRepeatWeekDays() {
      const els = document.querySelectorAll('#tlEvFWeekDays input[data-wd]:checked');
      return Array.prototype.map.call(els, (e) => e.getAttribute('data-wd'));
    }
    function tlOnRepeatModeChange() {
      const mode = document.getElementById('tlEvFRepeatMode').value;
      document.getElementById('tlEvFWeekDayBox').style.display = mode === 'weekly' ? '' : 'none';
      document.getElementById('tlEvFMonthDayBox').style.display = mode === 'monthly' ? '' : 'none';
      document.getElementById('tlEvFYearMonthDayBox').style.display = mode === 'yearly' ? '' : 'none';
      const unit = document.getElementById('tlEvFRepeatIntervalUnit');
      if (unit) unit.textContent = TL_REPEAT_INTERVAL_UNIT[mode] ? '（每 ' + TL_REPEAT_INTERVAL_UNIT[mode] + '）' : '';
    }
    function tlOnRepeatEndTypeChange() {
      const t = document.getElementById('tlEvFRepeatEndType').value;
      const box = document.getElementById('tlEvFEndValueBox');
      box.style.display = t === 'never' ? 'none' : '';
      const unit = document.getElementById('tlEvFEndValueUnit');
      const inp = document.getElementById('tlEvFRepeatEndValue');
      if (t === 'count') { unit.textContent = '（次）'; inp.type = 'number'; inp.placeholder = '如 20'; }
      else if (t === 'date') { unit.textContent = ''; inp.type = 'date'; inp.placeholder = ''; }
      else { unit.textContent = ''; inp.type = 'text'; inp.value = ''; }
    }
    // 规范化「每年月-日」：去掉可能存在的外层引号后统一加上，保证写回文件格式与用户一致（"MM-DD"）
    function tlNormalizeYmd(v) {
      v = (v || '').trim();
      if (!v) return '';
      if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
      return '"' + v + '"';
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

    // 📋 备注「＋ CheckBox」：开小窗输入，保存后以 `- [ ] 内容` 追加到备注末尾（多行＝每行一个 checkbox）
    // 两种模式：tlAddCheckTargetUid=null＝编辑表单模式（追加到 #tlEvFNotes，等表单保存）；
    //          非空＝列表模式（追加到该事件备注后**直接存档**：写缓冲＋落盘 calendar.md，2026-10-10 用户需求）
    let tlAddCheckTargetUid = null;
    let tlEditNoteCheckTarget = null;
    function tlOpenAddCheckDialog(uid) {
      tlAddCheckTargetUid = uid || null;
      tlEditNoteCheckTarget = null;
      const ov = document.getElementById('tlAddCheckOverlay');
      const inp = document.getElementById('tlAddCheckInput');
      const copyButton = document.getElementById('tlCopyNoteCheckButton');
      if (ov) ov.onkeydown = null;
      if (copyButton) copyButton.style.display = 'none';
      document.querySelector('#tlAddCheckOverlay .tl-ev-form-title').textContent = '建立 CheckBox 项目';
      document.querySelector('#tlAddCheckOverlay .tl-ev-form-hint').innerHTML = '每行一个项目，保存后以 <code>- [ ] …</code> 形式追加到「备注」末尾';
      document.querySelector('#tlAddCheckOverlay .btn-primary').textContent = '加入备注';
      if (inp) inp.value = '';
      if (inp) inp.rows = 4;
      if (ov) ov.style.display = 'flex';
      if (inp) setTimeout(() => inp.focus(), 0);
    }
    function tlOpenEditNoteCheckDialog(event, uid, line) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((item) => item.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      if (ev.ro) { showToast('此行程来自被包含的只读文件，不可修改', 'danger'); return; }
      const lines = String(ev.notes || '').split('\n');
      if (line < 0 || line >= lines.length) return;
      const match = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
      if (!match) { showToast('该子事件已被修改，请刷新后重试', 'danger'); return; }

      const markerPattern = /\[\[(?:dl|cp):\d{4}-\d{2}-\d{2}\]\]|\[\[\d{4}-\d{2}-\d{2}\]\]/g;
      const markers = match[3].match(markerPattern) || [];
      tlAddCheckTargetUid = null;
      tlEditNoteCheckTarget = { uid, line, markers };
      const ov = document.getElementById('tlAddCheckOverlay');
      const inp = document.getElementById('tlAddCheckInput');
      const copyButton = document.getElementById('tlCopyNoteCheckButton');
      document.querySelector('#tlAddCheckOverlay .tl-ev-form-title').textContent = '编辑 CheckBox 子事件';
      document.querySelector('#tlAddCheckOverlay .tl-ev-form-hint').textContent = '只修改子事件文字；勾选状态与日期标记会保留';
      document.querySelector('#tlAddCheckOverlay .btn-primary').textContent = '保存修改';
      if (copyButton) copyButton.style.display = '';
      if (ov) ov.onkeydown = (e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          tlSaveAddCheckDialog();
        }
      };
      if (inp) {
        inp.value = match[3].replace(markerPattern, '').replace(/\s{2,}/g, ' ').trim();
        inp.rows = 2;
      }
      if (ov) ov.style.display = 'flex';
      if (inp) setTimeout(() => inp.focus(), 0);
    }
    async function tlCopyNoteCheckText() {
      const inp = document.getElementById('tlAddCheckInput');
      if (!inp || !inp.value) { showToast('没有可复制的子事件内容', 'danger'); return; }
      try {
        if (!window.electronAPI || typeof window.electronAPI.writeTextToClipboard !== 'function') {
          throw new Error('剪贴板功能不可用');
        }
        const result = await window.electronAPI.writeTextToClipboard(inp.value);
        if (!result || result.success !== true) throw new Error((result && result.error) || '写入剪贴板失败');
        showToast('子事件内容已复制', 'success');
      } catch (error) {
        showToast('复制子事件失败：' + (error.message || error), 'danger');
      }
    }
    function tlCloseAddCheckDialog() {
      const ov = document.getElementById('tlAddCheckOverlay');
      if (ov) ov.style.display = 'none';
      tlAddCheckTargetUid = null;
      tlEditNoteCheckTarget = null;
    }
    async function tlSaveAddCheckDialog() {
      const inp = document.getElementById('tlAddCheckInput');
      if (!inp) return;
      if (tlEditNoteCheckTarget) {
        const target = tlEditNoteCheckTarget;
        const text = inp.value.replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
        if (!text) { showToast('子事件内容不可为空', 'danger'); return; }
        tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
        const ev = tlCalEvents.find((item) => item.uid === target.uid);
        if (!ev) { tlCloseAddCheckDialog(); showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
        if (ev.ro) { tlCloseAddCheckDialog(); showToast('此行程来自被包含的只读文件，不可修改', 'danger'); return; }
        const lines = String(ev.notes || '').split('\n');
        if (target.line < 0 || target.line >= lines.length) {
          tlCloseAddCheckDialog();
          showToast('该子事件已被修改，请重新打开后编辑', 'danger');
          return;
        }
        const match = lines[target.line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
        if (!match) {
          tlCloseAddCheckDialog();
          showToast('该子事件已被修改，请重新打开后编辑', 'danger');
          return;
        }
        const suffix = target.markers.length ? ' ' + target.markers.join(' ') : '';
        lines[target.line] = match[1] + '- [' + match[2] + '] ' + text + suffix;
        ev.notes = lines.join('\n');
        tlCloseAddCheckDialog();
        tlApplyEventsToBuffer();
        const saved = typeof saveTask === 'function' ? await saveTask(false) : false;
        showToast(saved ? '子事件已修改并存档' : '子事件已修改到行程缓冲，但尚未确认存档成功', saved ? 'success' : 'danger');
        return;
      }
      const lines = inp.value.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length);
      if (!lines.length) { tlCloseAddCheckDialog(); return; }
      const md = lines.map((l) => '- [ ] ' + l).join('\n');
      // 列表模式：追加到目标事件备注，并直接存档（写缓冲 + saveTask 落盘），无需打开编辑表单
      if (tlAddCheckTargetUid) {
        const uid = tlAddCheckTargetUid;
        tlCloseAddCheckDialog(); // 先清 target 再走异步/重绘，避免残留
        tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
        const ev = tlCalEvents.find((x) => x.uid === uid);
        if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
        if (ev.ro) { showToast('此行程来自被包含的只读文件，不可修改', 'danger'); return; }
        ev.notes = (ev.notes ? String(ev.notes).replace(/\s*$/, '') + '\n' : '') + md + '\n';
        tlApplyEventsToBuffer();
        if (typeof saveTask === 'function') saveTask(false); // 直接存档：写回 calendar.md
        showToast('已在备注末尾加入 CheckBox 并存档', 'success');
        return;
      }
      // 编辑表单模式：追加到表单备注 textarea（原行为，随表单保存一起写入）
      const notes = document.getElementById('tlEvFNotes');
      if (!notes) return;
      const cur = notes.value || '';
      notes.value = (cur ? cur.replace(/\s*$/, '') + '\n' : '') + md + '\n';
      tlCloseAddCheckDialog();
    }

    function tlSaveEventForm(closeAfterSave = true) {
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
        // 🆕 桌面便利贴 instance 数（0 = 不显示为便利贴）
        sticky: Math.max(0, parseInt(document.getElementById('tlEvFSticky').value, 10) || 0),
        tags: tlEvFormTags.slice(),
        notes: document.getElementById('tlEvFNotes').value.replace(/\r\n/g, '\n'),
        todoIds: tlEvFormTodoIds.slice()
      };
      // ===== 重複事件：依表單寫回欄位（未勾選則清空，序列化降回 ## EVENT）=====
      if (document.getElementById('tlEvFRepeatOn').checked) {
        const rMode = document.getElementById('tlEvFRepeatMode').value;
        const interval = Math.max(1, parseInt(document.getElementById('tlEvFRepeatInterval').value, 10) || 1);
        ev.repeatMode = rMode;
        ev.repeatInterval = String(interval);
        if (rMode === 'weekly') {
          ev.repeatWeekDay = tlGetRepeatWeekDays();
          ev.repeatMonthDay = '';
          ev.repeatYearMonthDay = '';
        } else if (rMode === 'monthly') {
          ev.repeatWeekDay = [];
          const md = parseInt(document.getElementById('tlEvFMonthDay').value, 10);
          ev.repeatMonthDay = (md >= 1 && md <= 31) ? String(md) : '';
          ev.repeatYearMonthDay = '';
        } else if (rMode === 'yearly') {
          ev.repeatWeekDay = [];
          ev.repeatMonthDay = '';
          ev.repeatYearMonthDay = tlNormalizeYmd(document.getElementById('tlEvFYearMonthDay').value);
        } else {
          ev.repeatWeekDay = [];
          ev.repeatMonthDay = '';
          ev.repeatYearMonthDay = '';
        }
        const endType = document.getElementById('tlEvFRepeatEndType').value;
        ev.repeatEndType = endType;
        ev.repeatEndValue = endType === 'never' ? '' : document.getElementById('tlEvFRepeatEndValue').value.trim();
        const exRaw = document.getElementById('tlEvFRepeatExclude').value;
        ev.repeatExcludeDates = exRaw.split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
      } else {
        ev.repeatMode = '';
        ev.repeatInterval = '';
        ev.repeatWeekDay = [];
        ev.repeatMonthDay = '';
        ev.repeatYearMonthDay = '';
        ev.repeatEndType = 'never';
        ev.repeatEndValue = '';
        ev.repeatExcludeDates = [];
      }
      // 以当前编辑内容为准重新解析（保留用户手改过的其它条目），再 upsert
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const i = tlCalEvents.findIndex((x) => x.uid === ev.uid);
      if (i >= 0) tlCalEvents[i] = ev; else tlCalEvents.push(ev);
      // 写入后返回列表：不设滚动锚点（pending 保持 false）→ tlRenderList 走「保留原 scrollTop」分支，原地不动
      tlApplyEventsToBuffer();
      // 关键修复（新增行程重复建档）：uid 不落盘——解析时按文件位置临时生成 'evp'+idx，
      // 首次保存生成的新 uid 在下一次重新解析后必然失配 → 又 push 一条。
      // 因此写缓冲后必须重新解析，把表单「重新指向上一条已落盘事件」（＝模拟你点「编辑」按钮），
      // 使后续 Cmd+S / 写入编辑内容 走「更新同一条」而非再建档。
      // 匹配用「内容指纹 + 排序位置」双重定位，不依赖脆弱的长度相等（真实文件含 HOLIDAY/DIARY/TAGS/INCLUDE 时计数易错位）。
      try {
        const reparsed = tlParseEvents(document.getElementById('taskText').value);
        const sortedMain = tlSorted(tlCalEvents.filter((e) => !e.ro).slice());
        // 与序列化一致的内容指纹（忽略 uid，专盯会写进文件的字段）
        const sig = (e) => [e.title, e.date, e.allDay, e.startTime, e.endTime, e.location, e.color, (e.notes || ''), JSON.stringify(e.tags || [])].join('');
        const want = sig(ev);
        const k = sortedMain.indexOf(ev); // 本事件在「序列化顺序」中的位置（＝文件顺序，与 reparsed 对齐）
        // 优先：同位置且同签名（最精确，可避开同名/同内容重复事件）；否则回退到任一同签名事件（至少不再新增）
        if (k >= 0 && reparsed[k] && sig(reparsed[k]) === want) tlEvFormUid = reparsed[k].uid;
        else {
          const m = reparsed.find((r) => sig(r) === want);
          if (m) tlEvFormUid = m.uid;
        }
      } catch (e) { /* 记回失败不影响本次保存 */ }
      if (closeAfterSave) tlCloseEventForm();
      showToast(closeAfterSave
        ? '已写入编辑内容，按「保存」写回 calendar.md'
        : '已写入编辑内容，可继续编辑（按「保存」写回 calendar.md）', 'success');
    }

    function tlDeleteEvent(uid) {
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      if (ev.ro) { showToast('此行程来自被包含的只读文件，不可删除', 'danger'); return; }
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

    // ===== ## DIARY 新增/编辑/删除（写回 taskText 缓冲，按「保存」落盘）=====
    let tlDiaryFormDate = null;
    let tlDiaryFormReadonly = false;
    function tlOpenDiaryForm(date) {
      tlHideTip();
      if (!isCalendarMdDoc()) return;
      tlCalDiaries = tlParseDiaries(document.getElementById('taskText').value);
      // 📎 只读日记：主文件无此日期、但 include 里有 → 只读查看（字段只读，隐藏保存/删除，可看不可改）
      const own = tlCalDiaries.find((x) => x.date === date);
      const roD = own ? null : (tlIncludedDiaries || []).find((d) => d.date === date);
      const isRo = !!roD;
      const d = isRo ? roD : own;
      tlDiaryFormDate = date;
      document.getElementById('tlDiaryFTitle').value = d ? d.title : '';
      document.getElementById('tlDiaryFDate').textContent = date;
      document.getElementById('tlDiaryFMood').value = d ? (d.mood || '') : '';
      document.getElementById('tlDiaryFTags').value = d ? (d.tags || []).map(tlTagName).join(', ') : '';
      document.getElementById('tlDiaryFWeather').value = d ? (d.weather || '') : '';
      document.getElementById('tlDiaryFContent').value = d ? (d.content || '') : '';
      document.getElementById('tlDiaryFRemark').value = d ? (d.remark || '') : '';
      tlSetDiaryFormReadonly(isRo);
      tlDiaryFormReadonly = isRo;
      document.getElementById('tlDiaryFormDelete').style.display = (d && !isRo) ? '' : 'none';
      document.getElementById('tlDiaryFormOverlay').style.display = 'flex';
      if (!isRo) document.getElementById('tlDiaryFContent').focus();
    }
    function tlSetDiaryFormReadonly(ro) {
      ['tlDiaryFTitle', 'tlDiaryFMood', 'tlDiaryFWeather', 'tlDiaryFTags', 'tlDiaryFContent', 'tlDiaryFRemark'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.readOnly = !!ro;
      });
      const t = document.getElementById('tlDiaryFormTitleText');
      if (t) t.textContent = ro ? '查看日记（只读）' : '写日记';
      const save = document.getElementById('tlDiaryFormSave');
      if (save) save.style.display = ro ? 'none' : '';
      const hint = document.getElementById('tlDiaryFormHint');
      if (hint) hint.textContent = ro ? '此日记来自被包含的只读文件，仅供查看' : '写入后按编辑器「保存」，把改动写回 calendar.md';
    }
    function tlCloseDiaryForm() {
      const ov = document.getElementById('tlDiaryFormOverlay');
      if (ov) ov.style.display = 'none';
      tlDiaryFormDate = null;
      tlDiaryFormReadonly = false;
      // 恢复「合并」状态（含 include 的只读日记）：tlOpenDiaryForm 曾把 tlCalDiaries 重置为仅主文件，
      // 若不恢复，关闭表单后日记图标 tooltip / 日期标记会因找不到 include 日记而失效（用户实测）。
      if (isCalendarMdDoc()) {
        const ta = document.getElementById('taskText');
        if (ta) tlCalDiaries = tlAllDiaries(ta.value);
      }
    }
    function tlSaveDiaryForm() {
      if (tlDiaryFormReadonly) return;
      const date = tlDiaryFormDate;
      if (!date) return;
      const title = document.getElementById('tlDiaryFTitle').value.trim();
      if (!title) { alert('请输入日记标题'); return; }
      const tags = document.getElementById('tlDiaryFTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean).map((nm) => ({ name: nm, cat: '' }));
      const diary = {
        date,
        title,
        mood: document.getElementById('tlDiaryFMood').value.trim(),
        tags,
        weather: document.getElementById('tlDiaryFWeather').value.trim(),
        content: document.getElementById('tlDiaryFContent').value.replace(/\r\n/g, '\n'),
        remark: document.getElementById('tlDiaryFRemark').value.trim()
      };
      tlCalDiaries = tlParseDiaries(document.getElementById('taskText').value);
      const i = tlCalDiaries.findIndex((x) => x.date === date);
      if (i >= 0) tlCalDiaries[i] = diary; else tlCalDiaries.push(diary);
      tlApplyDiariesToBuffer();
      tlCloseDiaryForm();
      showToast('已写入日记，按「保存」写回 calendar.md', 'success');
    }
    // 删除日记的「唯一收口」：确认 → 从缓冲重解析 → 剔除该日 → 序列化写回（按「保存」才落盘）。
    // 表单内删除与列表条目删除共用；返回是否真的删了（日记表单据此决定要不要关窗）。
    function tlRemoveDiary(date) {
      const d = tlDiaryOnDate(date);
      if (!d) return false;
      if (d.ro) { showToast('此日记来自被包含的只读文件，不可删除', 'danger'); return false; }
      if (!confirm('确定删除 ' + date + ' 的日记「' + d.title + '」吗？\n\n按「保存」才会真正写回文件。')) return false;
      tlCalDiaries = tlParseDiaries(document.getElementById('taskText').value);
      tlCalDiaries = tlCalDiaries.filter((x) => x.date !== date);
      tlApplyDiariesToBuffer();
      showToast('已删除日记，按「保存」写回文件', 'success');
      return true;
    }
    function tlDeleteDiary() {
      if (tlDiaryFormReadonly) return;
      const date = tlDiaryFormDate;
      if (!date) return;
      if (!tlDiaryOnDate(date)) { tlCloseDiaryForm(); return; }
      if (tlRemoveDiary(date)) tlCloseDiaryForm();
    }
    // 「只显示日记」列表条目上的删除按钮（不经日记表单，直接按日期删）
    function tlDeleteDiaryByDate(date) {
      if (!date || !tlDiaryOnDate(date)) return;
      tlRemoveDiary(date);
    }
    // 序列化整份 calendar.md（events + holidays + diaries）写回 taskText：从当前缓冲重解析 events/holidays，
    // 再以最新 tlCalDiaries 覆盖日记段，避免保存日记时把用户手写的事件/假日覆盖掉。
    function tlApplyDiariesToBuffer() {
      const ta = document.getElementById('taskText');
      const events = tlParseEvents(ta.value);
      const holidays = tlParseHolidays(ta.value);
      tlCalEvents = events;
      tlCalHolidays = holidays;
      // 📎 重画后保留 ## TAGS / ## INCLUDE（避免父阶标签、Include 勾选被清掉）
      ta.value = tlPreserveMetaBlocks(ta.value, tlCalendarToMarkdown(events, holidays, tlCalDiaries.filter((d) => !d.ro)));
      if (typeof autoGrowTextarea === 'function') autoGrowTextarea(ta);
      if (typeof markCurrentTabDirty === 'function') markCurrentTabDirty();
      tlRenderEventsContent();
    }

    // 清单上的「完成」勾选框：切换 done → 序列化写回 taskText 缓冲（按「保存」才落盘）
    function tlToggleDone(uid, done) {
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      if (ev.ro) { showToast('此行程来自被包含的只读文件，不可修改完成状态', 'danger'); return; }
      ev.done = !!done;
      tlApplyEventsToBuffer(); // 内部会重绘行程视图
      showToast(ev.done ? '已标记完成，按「保存」写回 calendar.md' : '已取消完成，按「保存」写回 calendar.md', 'success');
    }

    // 備註 checkbox 行勾選互換 + dl/cp 標記維護（純函數，不改入參；便於單測）：newDone=true 勾選、false 取消；todayStr 為 YYYY-MM-DD
    function tlNoteCheckTransform(line, newDone, todayStr) {
      const m = line.match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
      if (!m) return line;
      let body = m[3] || '';
      if (newDone) {
        // 勾選：先把裸日期 [[YYYY-MM-DD]] 歸一為 [[dl:YYYY-MM-DD]]
        body = body.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, '[[dl:$1]]');
        // 勾選一律補 [[cp:今天]]（無論有無 dl；已有 cp 則不重複）
        if (!/\[\[cp:\d{4}-\d{2}-\d{2}\]\]/.test(body)) {
          body = body.replace(/\s+$/, '') + ' [[cp:' + todayStr + ']]';
        }
      } else {
        // 取消勾選：移除 cp 塊（保留 dl）
        body = body.replace(/\s*\[\[cp:\d{4}-\d{2}-\d{2}\]\]/g, '');
      }
      return m[1] + '- [' + (newDone ? 'x' : ' ') + ']' + (body ? ' ' + body : '');
    }
    // 備註裡的 Markdown checkbox 勾選/取消：定位 ev.notes 的對應行，互換 - [ ] ↔ - [x]，序列化寫回 taskText（按「保存」才落盤）
    function tlToggleNoteCheck(e, uid, line) {
      if (e) { e.stopPropagation(); e.preventDefault(); } // 阻止冒泡到 .ev-block 的 onclick 打開編輯表單
      tlCalEvents = tlAllEvents(document.getElementById('taskText').value);
      const ev = tlCalEvents.find((x) => x.uid === uid);
      if (!ev) { showToast('找不到该条行程（内容可能已被修改）', 'danger'); return; }
      if (ev.ro) { showToast('此行程来自被包含的只读文件，不可勾选', 'danger'); return; }
      const lines = String(ev.notes || '').split('\n');
      if (line < 0 || line >= lines.length) return;
      const m = lines[line].match(/^(\s*)-\s+\[([ xX])\]\s?(.*)$/);
      if (!m) return; // 該行已被用戶改得不再是 checkbox，跳過以免破壞原文
      const wasDone = m[2] !== ' ';
      lines[line] = tlNoteCheckTransform(lines[line], !wasDone, tlFmtDate(new Date()));
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
    // 📎 事件/日记保存会把整份 calendar.md 重画（tlCalendarToMarkdown 只产 EVENT/HOLIDAY/DIARY），
    // 必须把原本的 ## TAGS / ## INCLUDE 元數據块保留下来，否则按「保存」落盘会把这两个块清掉。
    // 从 original 抽出这两个块（含内容，直到下一个 ## 标题或文末），重新贴回 newMd 末尾。
    function tlPreserveMetaBlocks(original, newMd) {
      const kept = [];
      ['TAGS', 'INCLUDE'].forEach((name) => {
        const idx = String(original || '').search(new RegExp('^##[ \\t]*' + name + '[ \\t]*$', 'm'));
        if (idx < 0) return;
        const after = String(original).slice(idx);
        const next = after.search(/\n##[ \t]/m);
        const end = next >= 0 ? idx + next : String(original).length;
        kept.push(String(original).slice(idx, end).replace(/\s+$/, ''));
      });
      if (!kept.length) return newMd;
      return String(newMd).replace(/\s*$/, '') + '\n\n' + kept.join('\n\n') + '\n';
    }
    function tlApplyEventsToBuffer() {
      const ta = document.getElementById('taskText');
      // ⚠️ 从当前缓冲重新解析 holiday / diary，避免保存事件时把用户手写的 ## HOLIDAY / ## DIARY 整体覆盖掉（事件序列化器会重画整份文件）
      const holidays = tlParseHolidays(ta.value);
      const diaries = tlParseDiaries(ta.value);
      tlCalHolidays = holidays;
      tlCalDiaries = diaries;
      // 📎 重画后保留 ## TAGS / ## INCLUDE（避免父阶标签、Include 勾选被清掉）
      ta.value = tlPreserveMetaBlocks(ta.value, tlCalendarToMarkdown(tlCalEvents.filter((e) => !e.ro), holidays, diaries));
      if (typeof autoGrowTextarea === 'function') autoGrowTextarea(ta);
      if (typeof markCurrentTabDirty === 'function') markCurrentTabDirty();
      tlRenderEventsContent();
      if (typeof tlUpdateStickyBadge === 'function') tlUpdateStickyBadge();
      if (typeof tlPushStickyRefreshes === 'function') tlPushStickyRefreshes();
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
    // occDate＝該列所屬「出現日」：跨天行程要標 (第幾天/共幾天)，與列表行/月格 chip 同款
    function tlTipHtml(ev, occDate) {
      const multi = tlIsMultiDay(ev);
      let when;
      if (multi) when = ev.allDay
        ? (tlRangeLabel(ev.date, ev.endDate) + ' · 共' + tlSpanDays(ev.date, ev.endDate) + '天')
        : tlRangeLabel(ev.date, ev.endDate, ev.startTime, ev.endTime);
      else when = ev.allDay ? '全天' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
      const tags = (ev.tags && ev.tags.length) ? '<div class="ev-tip-tags">' + ev.tags.map((t) => '<span class="ev-tag-view" data-tag="' + tlEscapeHtml(tlTagName(t)) + '">' + tlEscapeHtml(tlTagLabel(t)) + '</span>').join('') + '</div>' : '';
      const loc = ev.location ? '\ud83d\udccd ' + tlEscapeHtml(ev.location) : '';
      const notes = ev.notes ? '<div class="ev-tip-notes">' + tlRenderNotes(ev.notes, null) + '</div>' : '';
      const links = tlEventTodoLinks(ev);
      return '<div class="ev-tip-title">' + tlRepeatIcon(ev) + tlRenderInlineMarkdown(ev.title) + tlSpanDaySuffix(ev, occDate) + (ev.done ? ' <span class="ev-tip-done">\u2713</span>' : '') + '</div>' +
        '<div class="ev-tip-meta">' + tlEscapeHtml(when) + (loc ? ' · ' + loc : '') + '</div>' + tags + links + notes;
    }
    function tlShowTip(uid, occDate, x, y) {
      const ev = tlCalEvents.find((e) => e.uid === uid);
      if (!ev) return;
      const tip = tlGetTipEl();
      // ⚠️ 跨天行程同一 uid 会出现在多天 → 缓存 key 必须带上 occDate，否则在「第1天」悬停后切到「第3天」仍显示 (1/7)
      const key = uid + '@' + (occDate || '');
      if (tlTipUid !== key) { tip.innerHTML = tlTipHtml(ev, occDate); tlTipUid = key; }
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

    // 🆕 年视图日期格悬停：显示当天所有日程的富文本 tips（同表身列表 hover 的 tlTipHtml 样式）
    function tlShowDayTip(ds, uids, x, y) {
      const tip = tlGetTipEl();
      let html = '';
      if (uids && uids.length) {
        for (const uid of uids) {
          const ev = tlCalEvents.find((e) => e.uid === uid);
          if (!ev) continue;
          html += '<div class="ev-tip-day-item">' + tlTipHtml(ev, ds) + '</div>';
        }
      }
      const hols = tlHolidaysOnDay(ds);
      if (hols.length) {
        html += '<div class="ev-tip-day-hols">';
        for (const h of hols) {
          const region = tlHolidayRegionMeta(h.region);
          html += '<div class="ev-tip-day-hol"><span class="dot" style="background:' + tlEscapeHtml(region.color) + '"></span>' + tlEscapeHtml(h.title) + '</div>';
        }
        html += '</div>';
      }
      if (!html) { tip.style.display = 'none'; tlTipUid = null; return; }
      // 按日期缓存：同一天重复 mousemove 不重建 innerHTML（避免闪烁），仅重新定位
      const key = 'day:' + ds;
      if (tlTipUid !== key) { tip.innerHTML = html; tlTipUid = key; }
      tip.style.display = 'block';
      const r = tip.getBoundingClientRect();
      let left = x + 16, top = y + 16;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 16);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function tlShowYearDayTip(el, e) {
      const ds = el.getAttribute('data-date');
      const uids = (el.getAttribute('data-ev-uids') || '').split(',').filter(Boolean);
      if (!ds) return;
      tlShowDayTip(ds, uids, e.clientX, e.clientY);
    }

    // ===== 📓 悬停日记图标 → 放大提示框（复用 .ev-tip 结构，仅当天有日记时显示） =====
    function tlDiaryTipHtml(d) {
      const meta = [d.date, d.mood, d.weather].filter(Boolean).join(' · ');
      const tags = (d.tags && d.tags.length) ? '<div class="ev-tip-tags">' + d.tags.map((t) => '<span class="ev-tag-view" data-tag="' + tlEscapeHtml(tlTagName(t)) + '">' + tlEscapeHtml(tlTagLabel(t)) + '</span>').join('') + '</div>' : '';
      const body = d.content ? '<div class="ev-tip-notes">' + tlDiaryBody(d.content) + '</div>' : '';
      const remark = d.remark ? '<div class="ev-tip-meta" style="margin-top:6px;">备注：' + tlRenderInlineMarkdown(d.remark) + '</div>' : '';
      return '<div class="ev-tip-title">\ud83d\udcd5 ' + tlRenderInlineMarkdown(d.title || '日记') + '</div>' +
        (meta ? '<div class="ev-tip-meta">' + tlEscapeHtml(meta) + '</div>' : '') + tags + body + remark;
    }
    function tlShowDiaryTip(date, x, y) {
      const d = tlDiaryOnDate(date);
      if (!d) return;
      const tip = tlGetTipEl();
      const key = 'diary:' + date;
      if (tlTipUid !== key) { tip.innerHTML = tlDiaryTipHtml(d); tlTipUid = key; }
      tip.style.display = 'block';
      const r = tip.getBoundingClientRect();
      let left = x + 16, top = y + 16;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 16);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 16);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

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
      on('tlEvModeYear', 'click', () => tlSetMode('year'));
      on('tlEvAddBtn', 'click', () => tlOpenEventForm(null));
      on('tlEvStatsBtn', 'click', () => tlOpenStats());
      on('tlEvPrevMonth', 'click', () => { if (tlCalMode === 'list') tlListNavDay(-1); else tlCalStepCursor(-1); });
      on('tlEvNextMonth', 'click', () => { if (tlCalMode === 'list') tlListNavDay(1); else tlCalStepCursor(1); });
      on('tlEvTodayBtn', 'click', () => {
        tlCalCursor = new Date();
        tlCalSelected = tlFmtDate(new Date());
        tlListSel = tlFmtDate(new Date());
        // 年/月视图点「今天」时，确保当前月份/今天日期完整显示
        if (tlCalMode === 'year') tlYearAutoScrollPending = true;
        if (tlCalMode === 'month') tlMonthAutoScrollPending = true;
        if (tlCalMode === 'list') tlListScrollAnchorPending = true; // 列表：显式导航→滚到今天
        else tlDetailListScrollPending = true; // 年/月/周/日 明细：显式导航→滚到今天
        tlRenderEventsContent();
      });
      on('tlEvMultiDayBtn', 'click', () => tlToggleMultiDayMode());   // 列表模式：跨天一笔 / 跨天多笔
      // 🗓 表單日期輸入變更 → 即時更新輸入框旁的星期提示
      on('tlEvFDate', 'change', tlUpdateFormDow);
      on('tlEvFDate', 'input', tlUpdateFormDow);
      on('tlEvFEndDate', 'change', tlUpdateFormDow);
      on('tlEvFEndDate', 'input', tlUpdateFormDow);
      const tagPicker = document.getElementById('tl-ev-tag-picker');
      const tagInput = document.getElementById('tlEvFTags');
      if (tagPicker && tagInput) {
        tagPicker.addEventListener('click', (e) => {
          const edit = e.target.closest('[data-tl-ev-tag-edit]');
          const editSubcat = e.target.closest('[data-tl-ev-tag-subcat-edit]');
          if (edit) {
            tlEvTagEditIndex = parseInt(edit.getAttribute('data-tl-ev-tag-edit'), 10);
            tlEvTagEditLevel = 'cat';
            tlRenderTagPicker();
            return;
          }
          if (editSubcat) {
            tlEvTagEditIndex = parseInt(editSubcat.getAttribute('data-tl-ev-tag-subcat-edit'), 10);
            tlEvTagEditLevel = 'subcat';
            tlRenderTagPicker();
            return;
          }
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
          const name = e.target.closest('.ev-todo-chip-name');
          if (name) {
            const id = name.getAttribute('data-id');
            if (id && typeof openEditModal === 'function') openEditModal(id);
            return;
          }
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
      // ⌨️ 行程編輯表單快捷鍵：Esc＝取消關閉、Command/Ctrl+S＝寫入編輯內容
      document.addEventListener('keydown', (e) => {
        if (!ov || ov.style.display === 'none') return;
        if (e.key === 'Escape') { e.preventDefault(); tlCloseEventForm(); }
        if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); e.stopPropagation(); tlSaveEventForm(false); if (typeof saveTask === 'function') saveTask(false); }
      });
      // 🔁 重复事件一览：点遮罩关闭 + Esc 关闭
      const rov = document.getElementById('tlRepeatOverviewOverlay');
      if (rov) {
        rov.addEventListener('click', (e) => { if (e.target === rov) tlCloseRepeatOverview(); });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && rov.style.display !== 'none') tlCloseRepeatOverview();
        });
      }
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
      // 🖱 列表模式：双击条目直接进入编辑状态（条目本身无单击打开，故用 dblclick 快捷编辑）
      document.addEventListener('dblclick', (e) => {
        // 📓「只显示日记」列表条目：双击进日记编辑（同样无单击打开；按钮区除外）
        const diaryRow = e.target.closest('.ev-item.ev-diary-item[data-ev-diary-row]');
        if (diaryRow) {
          // 「编辑 / 删除」按钮不触发双击编辑，避免与单击操作冲突（尤其删除按钮二次确认）
          if (e.target.closest('.ev-actions')) return;
          tlOpenDiaryForm(diaryRow.getAttribute('data-ev-diary-row'));
          return;
        }
        // 📎 双击假日（.ev-holiday）：被 include 进来的只读假日提示不可编辑（假日本无编辑入口，无 uid 的 ev-item 不会命中）
        const holidayEl = e.target.closest('.ev-holiday[data-ev-holiday]');
        if (holidayEl) {
          const hid = holidayEl.getAttribute('data-ev-holiday');
          const h = (tlCalHolidays || []).find((x) => x.uid === hid);
          if (h && h.ro) showToast('此假日来自被包含的只读文件，不可编辑', 'danger');
          return;
        }
        const item = e.target.closest('.ev-item[data-uid]');
        if (!item) return;
        // 勾选框 / 备注清单勾选框 / 编辑删除按钮不触发双击编辑，避免与单击操作冲突（尤其删除按钮二次删除）
        if (e.target.closest('.ev-check') || e.target.closest('.ev-actions') || e.target.closest('.ev-md-check')) return;
        tlOpenEventForm(item.getAttribute('data-uid'));
      });
      // 🖱 悬停行程事件 → 放大提示框（事件委托；tooltip 用 pointer-events:none 不挡点击）
      //    ⚠️ 只覆盖「内容被截断」的网格元素：月格 .ev-chip、周/日网格 .ev-block。
      //    列表行 .ev-item（列表模式 + 月/週/日下方明细）已完整显示内容，不再弹 tooltip（用户 2026-09-29 要求取消）。
      const tlTipPane = document.getElementById('calEventsPane');
      if (tlTipPane) {
        const evSel = '.ev-chip, .ev-block';
        tlTipPane.addEventListener('mouseover', (e) => {
          // 日记图标 hover → 显示日记 tip（仅当天有日记时）
          const dyBtn = e.target.closest('.ev-day-diary');
          if (dyBtn && dyBtn.getAttribute('data-ev-diary')) {
            const d = tlDiaryOnDate(dyBtn.getAttribute('data-ev-diary'));
            if (d) { tlShowDiaryTip(d.date, e.clientX, e.clientY); return; }
          }
          // 年视图日期格 hover → 显示当天所有日程/假日的富文本 tips（与表身列表 hover 同款）
          const yd = e.target.closest('.ev-year-day[data-ev-uids]');
          if (yd) { tlShowYearDayTip(yd, e); return; }
          const el = e.target.closest(evSel);
          if (el && el.getAttribute('data-uid')) tlShowTip(el.getAttribute('data-uid'), el.getAttribute('data-occ-date'), e.clientX, e.clientY);
        });
        tlTipPane.addEventListener('mousemove', (e) => {
          if (!tlTipEl || tlTipEl.style.display === 'none') return;
          const dyBtn = e.target.closest('.ev-day-diary');
          if (dyBtn && dyBtn.getAttribute('data-ev-diary')) {
            const d = tlDiaryOnDate(dyBtn.getAttribute('data-ev-diary'));
            if (d) { tlShowDiaryTip(d.date, e.clientX, e.clientY); return; }
          }
          // 年视图日期格：移动也保持/重定位 tips（不调用 tlHideTip 以免刚显示就被隐藏）
          const yd = e.target.closest('.ev-year-day[data-ev-uids]');
          if (yd) { tlShowYearDayTip(yd, e); return; }
          const el = e.target.closest(evSel);
          if (el && el.getAttribute('data-uid')) tlShowTip(el.getAttribute('data-uid'), el.getAttribute('data-occ-date'), e.clientX, e.clientY);
          else tlHideTip();
        });
        tlTipPane.addEventListener('mouseout', (e) => {
          const to = e.relatedTarget;
          if (to && to.closest) {
            if (to.closest(evSel)) return;                 // 仍在事件元素间移动，不隐藏
            if (to.closest('.ev-day-diary')) return;       // 仍在日记按钮上，不隐藏
            if (to.closest('.ev-year-day[data-ev-uids]')) return; // 仍在年视图日期格上（含子元素/相邻格），不隐藏
          }
          tlHideTip();
        });
        tlTipPane.addEventListener('mouseleave', tlHideTip);
      }
      // 🖱 事件统计：子事件内容悬停 → 浅蓝背景 tooltip（事件委托；替代原生深色 title）
      const tlStatsOverlayEl = document.getElementById('tlEvStatsOverlay');
      if (tlStatsOverlayEl) {
        const statsSel = '.tl-stats-detail-table .d-content[data-tip]';
        tlStatsOverlayEl.addEventListener('mouseover', (e) => {
          const cell = e.target.closest ? e.target.closest(statsSel) : null;
          if (cell) tlStatsTipShow(cell.getAttribute('data-tip'), e.clientX, e.clientY);
        });
        tlStatsOverlayEl.addEventListener('mousemove', (e) => {
          const cell = e.target.closest ? e.target.closest(statsSel) : null;
          if (cell) tlStatsTipShow(cell.getAttribute('data-tip'), e.clientX, e.clientY);
          else tlStatsTipHide();
        });
        tlStatsOverlayEl.addEventListener('mouseout', (e) => {
          const to = e.relatedTarget;
          if (to && to.closest && to.closest(statsSel)) return;
          tlStatsTipHide();
        });
      }
    })();
