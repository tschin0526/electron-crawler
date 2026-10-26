/**
 * Service Worker - PWA 離線支持
 *
 * 策略：緩存優先（cache-first）+ 後台更新（stale-while-revalidate）。
 * 先立即回傳快取（命中即秒開），同時在背景嘗試拉取網絡更新快取。
 *
 * ⚠️ 為何不用「網絡優先」：iOS 上「徹底斷網」時 fetch 會立即失敗（可即時回退快取），
 * 但「連著蜂窩數據、卻到不了內網 192.168.x.x 服務器」時，fetch 不會立刻失敗，
 * 而是卡在 DNS/TCP 超時裡 → 頁面一直打不開。緩存優先可徹底規避這種「有網但到不了」的卡死。
 */

// 快取名帶版本：每次改資源內容或 SW 邏輯都要 bump 版本號，
// 讓舊快取名自動失效、activate 階段清掉，確保用戶一定拿到最新資源。
// v105：標籤樹過濾升級——①標籤條併入 ## TAGS 樹登記的全部標籤（父階標籤即使無事件直接掛靠也顯示）；②calEventMatchesTag 改 BOM 展開：選中標籤＝匹配自身＋全部子階＋孫階（新增 calTagDescendants 沿樹向下收集，seen 防成環）；③繼承選中：被選中主標籤 BOM 覆蓋的子/孫標籤顯示 ghost 藍 active-desc 樣式（與 .active 實心藍白配色有差異）；calendar-editor.js/style.css 改，bump 讓手機重拉
// v104：統計彈層與桌面對齊——①「只顯示事件主體」過濾（calBuildStats 加 mainOnly：有子事件的事件本身不算主體，其子事件照常計入子事件欄；無子事件的事件才是主體；calStatsFilter.mainOnly＋篩選區 checkbox＋匯總卡標題改「主事件（無子事件＝主體）」）；②同一主事件的子事件行交替色帶分組（紫↔藍 band-a/band-b）；③明細表狀態列前移到內容列前、狀態改 ○＝完成/✕＝未完成 圖標；calendar-editor.js/style.css 改，bump 讓手機重拉
// v103：展開明細子事件內容懸停 → tooltip 顯示所屬主事件標題（原生 title 屬性，*BuildStats 子事件推送補 ptitle: ev.title；主事件行不加；d-content[title] cursor:help＋點狀底線提示可懸停）；calendar-editor.js/style.css 改，bump 讓手機重拉
// v102：統計彈層加寬（max-width 720px → min(1080px, 96vw)）＋展開明細表加「項次」序號欄（首欄 d-no）與「跳轉」按鈕欄（末欄，calJumpToEvent＝關閉彈層＋scrollIntoView 滾動到主畫面該事件位置＋金色描邊閃爍 2 秒；子事件跳到其所屬主事件——*BuildStats 子事件推送補 uid；找不到/不可見→toast 提示）；calendar-editor.js/style.css 改，bump 讓手機重拉
// v101：統計完成狀態過濾修正為同時作用於子事件——原只過濾主事件（ev.done），子事件全量計入/推送，導致「未完成」篩選下明細仍顯示已完成子事件；現於 *BuildStats 內子事件按自身 done 再過濾（all=不過濾/done=只留完成子/undone=只留未完成子），子事件隨主事件為過濾單位（主事件被過濾掉→其子事件一併排除）；calendar-editor.js 改，bump 讓手機重拉
// v100：統計展開明細表改版——同色顯示主/子事件（連結 a{color:inherit}）+ 新增「主/子事件」欄位值區分；內容欄左對齊（修正 .ev-stats-table td 居中壓過明細表的特異性問題，改用 .ev-stats-table .ev-stats-detail-table 前綴）；狀態直接顯示「完成/未完成」文字；子事件含 dl:→📅 / cp:→✅ 圖標（calParseNoteChecks 捕獲 dl/cp）；calendar-editor.js/style.css 改，bump 讓手機重拉
// v99：事件統計彈層重做——固定標題欄（標題＋✕關閉）不滾動；新增篩選區（標籤勾選 OR 過濾 ＋ 完成狀態 全部/已完成/未完成，預設全部）；列表明細改為表格（日期/事件/狀態 左對齊）；calendar-editor.js/index.html/style.css 改，bump 讓手機重拉
// v98：標籤右鍵選單＋編輯標籤畫面（樹形父階）——## TAGS 區塊存標籤名→父標籤名、成環防呆；右鍵標籤 chip→「編輯標籤屬性」→畫面顯示子標籤列表＋分類（該標籤的子分類，與表單下拉同源）＋可設父階（select 排除自身與後代）；事件內聯標籤 .ev-tag-view 補 data-tag 也可右鍵；calendar-editor.js 改，bump 讓手機重拉
// v97：勾選「只顯示未完成」後畫面儘量不自動滾動——切換前捕獲視口頂部日期組＋偏移，切換後重錨（錨點存活→保持偏移＝不滾；被過濾掉→滾到最近未過濾組）；calendar-editor.js 改，bump 讓手機重拉
// v96：備註 checkbox 勾選時無論有無 [[dl:...]] 都一律補 [[cp:今天]]（原為「有 dl 才補 cp」）；取消勾選仍刪 cp 保留 dl（calNoteCheckTransform）；calendar-editor.js 改，bump 讓手機重拉
// v95：統計彈層檔案大小顯示再調整——固定 byte ＋千分位逗號＋單位「Bytes」（如 38099 → 38,099 Bytes）；calendar-editor.js 改，bump 讓手機重拉
// v94：統計彈層表頭檔案大小改為固定以 byte 顯示（不再走 formatFileSizeShort 的 KB 縮寫，如 37.2KB → 38099 B）；calendar-editor.js 改，bump 讓手機重拉
// v93：備註 checkbox 子事件支援 deadline(dl)/completed(cp) 標記——裸日期 [[YYYY-MM-DD]] 歸一為 [[dl:...]]；勾選 [x] 且含 dl 自動追加 [[cp:今天]]、取消勾選移除 cp（保留 dl）；渲染 dl→📅、cp→✅（calRenderNoteMarkers + calToggleNoteCheck）；calendar-editor.js 改，bump 讓手機重拉
// v92：統計彈層表頭顯示 calendar.md 內容大小（calFileSizeLabel 取編輯器緩衝 UTF-8 字節）；統計按鈕改為與平台 .btn 一致的圖標按鈕（桌面圓形📊／LITE 藥丸📊統計）；calendar-editor.js/index.html/style.css 改，bump 讓手機重拉
// v91：事件統計按鈕（📊 統計，放在 日/週/月/年 旁）——calBuildStats/calOpenStats 主事件×備註子事件(-[ ])按標籤·完成狀態分類＋詳情可展開；calendar-editor.js/index.html/style.css/app.js 改，bump 讓手機重拉
// v90：行程編輯「標籤」補齊子標籤（分類）datalist 下拉（與桌面對齊）——calFormCatNames(tagName) 按標籤從屬過濾＋cat 輸入 list/showPicker/change；calendar-editor.js 改，bump 讓手機重拉
// v89：進入程式自動「按今天」→ 年視圖滾到當月（setView 首次進入 events 視圖設 calYearAutoScrollPending；calStartupAutoScrollDone 守衛只觸發一次）；app.js/calendar-editor.js 改，bump 讓手機重拉
// v88：年視圖「今天」按鈕 / 切到年模式 → 12 個月迷你月曆自動滾動到今天所在月份卡片（calScrollYearToCurrentMonth，與桌面對齊）；calendar-editor.js/app.js 改，bump 讓手機重拉
// v87：月視圖「今天」按鈕 / 切到月模式 → 上半月曆網格自動滾動到今天日期格（calScrollMonthToToday，與桌面對齊）；calendar-editor.js/app.js 改，bump 讓手機重拉
// v86：備註 Markdown 表格補網格線——style.css 為 .ev-notes / .ev-block .notes / .ev-tip-notes 三容器
//      加 border-collapse + th/td 邊框（淺色 var(--border)、深色 .dark-mode 金色 #fbbf24 !important，與桌面對齊）；
//      style.css 改，bump 讓手機重拉
// v12：備註框自繪拖拽手柄（iOS 無原生 resize）
// v15：更換 App 圖示（3D 紫葡萄），一併預緩存圖示檔
// v16：Calendar 特性編輯器抽離為獨立 calendar-editor.js（預緩存新文件）
// v17：備註 checkbox 可點擊勾選/取消（寫回 notes 原文），calendar-editor.js 內部變動
// v18：行程視圖 .events-list 去 720px 居中限寬（列表模式 + 月視圖日明細清單滿寬填充，橫屏充分用左右空間）
// v19：日/週視圖時間網格下方新增「行程明細文字清單」（#ev-grid-list，對齊月視圖 #ev-day-list），保證日周也顯示事件詳情
// v20：行程視圖四模式對齊（時間網格＋重疊並列＋當前時間線）、標籤過濾(OR)、跨天色條
// v21：行事历首开默认月模式（app.js calMode 默认 'month'），bump 让手机重拉 app.js
// v22：悬停行程事件显示放大提示框（app.js/calendar-editor.js 加 data-ev-edit 委托 + style.css 加 .ev-tip），bump 让手机重拉
// v23：.ev-tip 背景改为不透明（显式回退色 var(--bg-secondary, #fff)），避免透明看不清资料
// v24：触屏设备禁用悬停提示框（app.js 加 (hover:hover)+(pointer:fine) 媒体查询守卫 + style.css 加 @media (hover:none) 强制隐藏），避免手机点事件时提示框与编辑表单重叠
// v25：触屏点事件改为弹小选单（编辑 / 详情）：app.js 月历 chip + calendar-editor.js onEvListClick 触屏改调 calShowEventMenu；新增 .ev-act-menu / .ev-detail-pop 样式与 calShowEventMenu/calShowEventDetail
// v26：手机「详情」浮层字号加大一码（.ev-detail-pop 13→14、标题 16→18、meta 13→14、tags 12→13、notes 13→14），style.css 又改
// v27：列表项取消「編輯/刪除」按钮（被整行 data-ev-edit 遮蔽致删除失效），动作统一收进触屏选单：详情/编辑/删除/取消 四项
// v28：手机「详情」浮层字号再加 2 码（.ev-detail-pop 14→16、标题 18→20、meta 14→16、tags 13→15、notes 14→16），style.css 又改
// v29：列表模式日期标题旁显示倒计时徽章（今天/N天后/N天前；今天高亮、其余灰底）：calDateHeaderHtml + calCountdownLabel + .ev-today-badge.dim
// v30：表单「日期/结束日期」输入框旁依输入日期即时显示星期（calUpdateFormDow + .ev-f-dow；change/input 监听 + openEventForm 刷新）
// v31：星期改为「（星期五）」带括号全名，并与正文同色同字號（去掉难读的金色加粗）：calUpdateFormDow + .ev-f-dow 样式
// v32：農民曆 / 老黃曆：新增 lunar.js（lunar-javascript 離線曆法庫，預緩存）+ calendar-editor.js 加 calAlmanac/常顯農曆·節氣/老黃曆彈層
// v33：農民曆簡→繁術語對照（新增 almanac-s2t.js，暴露 almanacToTrad；宜忌/彭祖/吉神/凶神/納音/宿/建除轉繁體），bump 讓手機重拉
// v34：HOLIDAY 多地區 region 欄位（cn/hk/tw/us 地區色＋pill＋圖例）＋ 明細範圍切換（日<->月/週，默認日；月/週列表頭部與日/週明細頂部加 .ev-scope-seg），calendar-editor.js/app.js/style.css 改，bump 讓手機重拉
// v35：範圍切換頭部收成單行：去掉獨立 toggle 條（.ev-scope-row /「9月 全部N條」彙總條），toggle 內聯進第一個日期標題條（與「日」範圍同構）；修復 LITE 週「日」toggle 重複兩次；空月/空週回退獨立條保證可切換
// v36：假日地區過濾（圖例改 checkbox 勾選，默認只勾大陸 cn）：只影響顯示不改數據；過濾收口在 calHolidaysOnDay/calVisibleHolidays（修復「列表/整月」直讀 calHolidays 繞過過濾）；calSetRegionChecked 直接分派重渲染＋同步圖例
// v37：日期標題補「· N 條」當日條數（calDateHeaderHtml 加 count 參數；列表/整月/整週分組標題都顯示，與「日」範圍單日標題一致）
// v38：修復事件備注「貪婪」吞掉緊隨其後的 ## HOLIDAY 原文（Remark 正則改非貪婪；解析時事件塊在 ## HOLIDAY 處截斷、假日塊在 ## EVENT 處截斷，避免字段互相污染）
// v39：跨天行程/假日「逐日展開」——分組收口到唯一入口 calEventsByDate()/calDayItems()（日/週/月/列表共用），
//      修復 by月/列表只認起始日 → 同一天 by日 4 條、by月 3 條。只影響顯示（不改數據）
// v40：月/週「整月/整週」明細自動滾動到選中日（calPickScrollTarget 精確命中→其後最近→其前最近；
//      calScrollListToDate 用 offsetTop 換算避開 .ev-date sticky 干擾；月模式滾 #ev-month-wrap、週/日滾清單自身）
// v41：月/週上下區域改「上區獨立滾動＋下區固定在底部」（與週模式同構）：.ev-split/.ev-split-top/.ev-detail/.ev-hsplit
//      ＋ calBindSplit 拖動分割條即時改 --ev-detail-h（鬆手才落盤 localStorage calDetailH；雙擊復位 30%）。
//      月模式下區不再被月格滾走；滾動目標改為明細自身（#ev-day-list / #ev-grid-list）
// v42：修復日/週模式拖條沉底且拖不動——#ev-grid-list 這條 ID 規則(1,0,0)原寫了 flex/min-height，
//      壓過 .ev-split .ev-detail(0,2,0) 使下區 flex-basis 歸 0 塌成 0 高（拖條被擠到畫面最底、改 CSS 變數無效）。
//      現只保留盒子裝飾，高度一律由 .ev-split 系列決定；橫屏 50/50 改用 .ev-split .ev-split-top 覆寫
// v43：修復月（by月）/週明細「點更早日期不會向前（向上）回滾」——`.ev-date` 是 position:sticky，
//      被吸頂時它的 offsetTop / getBoundingClientRect() 返回的是「位移後」的渲染位置（≈ 當前
//      scrollTop），故算出的目標 scrollTop 恰好＝當前值 → 原地不動（點更晚日期才有效）。
//      現由 calScrollElToTop 讀佈局位置前先臨時摘掉 sticky；列表模式的 scrollIntoView 也改用同一入口。
// v53：「日」範圍日期標題改用 calDateHeaderHtml（補日記按鈕/農曆/倒計時）+ 日記表單加寬（正文主導、三欄並排）；calendar-editor.js/index.html/style.css 改
// v52：日記圖標 hover 顯示內容 tips（複用行程事件 .ev-tip 機制，僅當天有日記時）；calendar-editor.js/app.js 改，bump 讓手機重拉
// v51：新增 ## DIARY 日記（桌面 + LITE 共用結構）：日期標題旁日記按鈕（有日記打勾）、專用日記編輯視窗；
//      calendar-editor.js/app.js/index.html/style.css 改，bump 讓手機重拉
// v85：標籤支援「分類」——標籤資料結構由純字串升級為 {name, cat}（舊資料自動相容）；表單選中標籤可點擊內聯輸入分類，有分類時顯示為「標籤·分類」；列表/假日/日記/tooltip 同步顯示
// v84：修正標籤樣式作用域——.ev-tag-view 提升為全域可用，tooltip/列表/假日/日記一致；並去掉所有 # 前綴
// v83：懸停 tooltip 內的標籤改為與列表一致的膠囊樣式（.ev-tag-view），並去掉 # 前綴；兩端同步
// v82：懸停 tooltip 最大寬度加大 1/3（320px → 426px），兩端同步
// v81：懸停 tooltip 的備註區最大高度加大（200px → 320px），讓長備註顯示更完整；兩端同步
// v80：假日地區/類型標籤從膠囊形改為圓角矩形（border-radius 999px → 6px），兩端同步
// v79：行程/假日/日記的標題與備註支持基礎 Markdown 渲染（renderMarkdown），兩端視覺一致；
//      calendar-editor.js / style.css 改，bump 讓手機重拉（桌面同步改 calendar-editor.js / index.html）
// v78：年視圖「今天所在月份」卡片加金色外框描邊——renderCalYear 給含今天的月份卡片加 .cur-month
//      類別；style.css 加 .ev-year-month.cur-month 金色 box-shadow 外框。calendar-editor.js/style.css
//      改，bump 讓手機重拉（桌面同樣改 tlRenderYear + index.html）
// v77：年視圖下方明細（表身）預設「整年」（calScope 預設 'full' 僅年視圖；月/週/日仍 'day'）：
//      桌面 tlCalScope 初始 'full' ＋ tlSetMode 年→full 其餘→day；LITE app.js calScope 'full' ＋ setCalMode 同款。
//      calendar-editor.js / app.js 改，bump 讓手機重拉
// v76：預設設定調整（依使用者截圖，桌面＋LITE 兩端同步）：①預設視圖 'month'→'year'；
//      ②HOLIDAY 地區過濾 ['cn']→[]（預設不顯示任何地區假日）；③REPEAT 三態 'some'→'next'
//      （只顯示未來最近一次）；④「只顯示未完成」預設關→開（calUndoneOnly 缺省回退 true）。
//      app.js / calendar-editor.js 改，bump 讓手機重拉
// v75：列表模式「框選日（金色描邊）」修正——原邏輯把「今天無行程 → 回退最近未來日」的結果同時用於
//      滾動與框選、且寫回 calListSel，導致今天沒有行程時卻把未來某天框金邊。改為：框選僅在錨點日
//      （今天 / < > 導航日）真有分組時才生效，回退值只作滾動定位、不寫回；< > 導航在錨點日缺失時以
//      「最近未來日」為基準。calendar-editor.js 改，bump 讓手機重拉
// v74：把「只顯示未完成」從「只列表模式」提升為「全模式生效」（年/月/週/日/列表）——收口於共享過濾鏈
//      calEventShown（所有「按日期分組」入口統一走這裡），圖例勾選框移出 calMode==='list' 守衛；
//      renderEventsList 的冗餘再過濾移除，單一可信來源。calendar-editor.js/app.js 改，bump 讓手機重拉
// v73：修正年視圖「年」範圍明細只顯示某一個月——renderCalYearDayList 的 full 分支一律沿用選中日
//      所在月份（prefix=YYYY-MM），年模式下應取整年（prefix=YYYY、重複展開窗口＝整年）；空態文案也
//      由「本月沒有行程」改為年模式「本年沒有行程」。calendar-editor.js 改，bump 讓手機重拉
// v72：列表模式新增「只顯示未完成」勾選（在「只顯示日記」旁）——勾選後隱藏已完成（done ✓）的行程，
//      只看未完成；假日無完成態不受影響。純 UI 偏好（內存 + localStorage 鍵 calUndoneOnly，絕不寫回
//      calendar.md），只在列表模式生效；renderEventsList 過濾後為空顯示「沒有未完成的行程」空態；
//      calendar-editor.js/app.js(state.calUndoneOnly) 改，bump 讓手機重拉
// v71：修正 REPEAT 三態的 some「未來4次」被當前視圖窗口裁剪——calEventOccurrences 的 repeat 分支在
//      展開前臨時切換到寬窗口（2000-01-01..2100-01-01）再截取「最近前一次+未來4次」，用完恢復原窗口；
//      calendar-editor.js 改，bump 讓手機重拉
// v70：REPEAT 勾選框改為「三態」——未勾選(none)＝完全隱藏全部；半勾選(next)＝只顯示「今天及之後最近
//      一次」（未來最近待生效）；全勾選(some)＝最近的前一次(date<今天)＋未來4次(date>=今天)（最多5次）。
//      calEventVisible 僅判 none 才隱藏；收斂邏輯在 calEventOccurrences 的 repeat 分支（none 回[]、
//      next 回最小>=今天的1次、some 回 past[past.length-1]+future.slice(0,4)）；圖例 checkbox 改
//      onclick="calCycleRepeat()" 循環 none→next→some→none，indeterminate 表半勾選/checked 表全勾選；
//      calSetCategoryChecked 移除 repeat 分支、新增 calCycleRepeat；calendar-editor.js/app.js(state.calShowRepeat) 改，bump 讓手機重拉
// v69：REPEAT 勾選框語意改為「顯示幾次」——勾選＝顯示全部發生日（多次）；取消勾選＝只顯示「今天及之後
//      最近的一次」（未來最近待生效），不再整體隱藏。calEventVisible 對重複行程永遠 return true，
//      收斂邏輯移入 calEventOccurrences（勾選回全部、未勾選回最近一次）；圖例 tooltip 同步改；
//      calendar-editor.js 改，bump 讓手機重拉
// v68：跨天行程的懸停提示框（tips）與「詳情」浮層也顯示「(第幾天/共幾天)」——calTipHtml/calShowTip 加
//      occDate 參數＋緩存 key 改 uid@occDate（跨天同 uid 多天不串檔）；calSpanChipHtml 加 occDate 並在兩個
//      div 加 data-occ-date；月格 chip、時間網格全天條/定時塊、列表行、詳情浮層觸發點全補 data-occ-date；
//      app.js 兩處監聽改傳 data-occ-date；calendar-editor.js/app.js 改，bump 讓手機重拉
// v67：跨天行程/跨天節日標題後顯示「(第幾天/共幾天)」（如 回上海 (3/7)）——列表行、假日列、時間網格
//      （全天條／定時塊／假期條）全覆蓋；新增 calSpanDaySuffix（由「出現日」直接算序號，呼叫方不必
//      握有 occurrence 的 idx/total）；calSpanSuffix 統一改帶括號；calendar-editor.js 改，bump 讓手機重拉
// v66：年視圖修復「週日整列消失」——.ev-year-grid 由 repeat(7,1fr) 改 repeat(7,minmax(0,1fr))，
//      並放開 .ev-year-day/.n 的 min-width（1fr=minmax(auto,1fr)，被 min-width:18px 頂住使 7 列最小需 146px
//      > 手機卡片內寬 ~110px，第 7 列溢出被裁，表頭少了「日」）；style.css 改，bump 讓手機重拉
// v65：週/日檢視「欄頭日期旁」也顯示 📕 日記標記；月格標記與欄頭標記收成同一入口/同一類
//      （calDiaryMarkHtml + .ev-diary-mark，原 .ev-cell-diary 更名）；calendar-editor.js/style.css 改，bump 讓手機重拉
// v64：月格「當天有日記」標記——有日記的日期在日期數字旁顯示 📕（純顯示，不掛 onclick）；
//      calendar-editor.js/style.css 改，bump 讓手機重拉
// v63：「只顯示日記」正文不再截斷——去掉舊的「3 行 / 120 字 + 省略號」上限，改為完整渲染、靠列錶整體滾動條查看
//      （calDiaryPreview → calDiaryBody）；calendar-editor.js 改，bump 讓手機重拉
// v111：子事件 checkbox 框線加粗金黃（1px var(--border) → 2px #fbbf24），深色主題下清晰可見；style.css 改，bump 讓手機重拉
// v110：術語（term）渲染移植到 Lite —— calRenderInlineMarkdown（標題）＋ calRenderNotes（備註）接入 calRenderTermDefs
//      （[[term]]／[[term:釋義]]／[[term:釋義:領域]] 立體金膠囊＋tooltip＋內嵌領域小膠囊；dl/cp/裸日期排除、跳代碼圍欄）；
//      style.css 新增 .tl-term-cap/.tl-term-domain。calendar-editor.js/style.css/sw.js 改，bump 讓手機重拉
// v109：Lite 行程列表补充备注 checkbox 数量胶囊与跨天模式字母胶囊；calendar-editor.js/style.css 改，bump 让手机重拉
// v113：修復 ## DIARY 被誤解析為行程事件（帶勾選框）的問題——parseCalendarEvents/parseCalendarHolidays 切塊時一併在 ## DIARY 處截斷，與 parseCalendarDiaries 已在 ## EVENT/## HOLIDAY 處截斷對齊；calendar-editor.js 改，bump 讓手機重拉
// v114：帶文字的分割線（與桌面端同一套私有語法）——整行「--- 文字 ---」（星號／下劃線三種記號同、首尾須同款）在 marked 前提成 %%HRTEXT_n%% 佔位符（跳代碼圍欄、前後補空行確保獨佔一段），渲染後還原成 span.hr-text＋標籤過 parseInline；style.css 加 .hr-text（橫線左右各半由偽元素畫、顏色取 currentColor 混色，不依賴背景遮罩）。md-renderer.js/style.css 改，bump 讓手機重拉
// v115：每事件「只顯示該事件未完成的 checkbox 子事件」開關（與桌面對齊）——列表/日/週/月共用列的標題尾加金色膠囊 ☐/☑（.ev-undone-filter-btn），點擊在該列 toggle .only-undone-checks，CSS 讓 .ev-md-check.done 整行隐藏；偏好存 localStorage（calUndoneChecksByEvent，以 uid 為鍵，只影響顯示、絕不改寫 calendar.md）；委派分支必須排在 data-ev-edit 前否則被整列選單吃掉；calendar-editor.js/style.css 改，bump 讓手機重拉
// v116：LITE 便利貼（翻頁模式，calendar.md 專用）——combo 菜單新增「🗒 便利貼（翻頁）」動作項，平時不顯示、按下才開；
//      資料源＝行程的 `- sticky: \`N\``（N>0 展開 N 張）；翻頁/清單開關/每張背景色·透明度·字色·字重·字級/只顯示未完成 checkbox/
//      上次頁次全部存 localStorage（每份 calendar.md 各自一份），只讀不寫 calendar.md（checkbox 仍走編輯緩衝→保存）；
//      行程表單補「便利貼張數」欄位（載入＋存檔保留）；新增 sticky-notes.js，index.html/style.css/app.js/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v117：LITE 備註可編輯化（與桌面同口徑）——非 checkbox 的「最小 MD 區塊」注入 ✎ 圓點、checkbox 行加行內 ✎；
//      底部彈層可編輯區塊原文／子事件（多行＝拆分，第一行保留勾選狀態）／＋☐ 加入子事件；清空保存＝刪除（先確認）。
//      便利貼 meta 補＋☐ 與逐張 ☐/☑「只看未完成」，列表行補＋☐；時間格因只顯示前 400 字，維持唯讀避免截斷回寫。
//      calendar-editor.js/sticky-notes.js/index.html/style.css/app.js/sw.js 改，bump 讓手機重拉
// v118：LITE 便利貼翻頁手勢——整個彈層支援手指左右滑（touchmove 軸鎖定＋橫滑 preventDefault），
//      移除卡片兩側 ‹ › 常駐按鈕與其 44px 預留內距，正文恢復全寬；底部翻頁鈕與鍵盤方向鍵保留。
//      index.html/style.css/sticky-notes.js 改，bump 讓手機重拉
// v119：LITE 便利貼設定持久化補強——除 lastId（標題|日期|序號）外另存 lastIdx，標題／日期被改導致身分認不到時
//      退回上次停留的頁次而非一律回第 1 張；設定面板提示改為明示「開關/樣式/上次頁次會自動記住」。
//      sticky-notes.js/index.html/sw.js 改，bump 讓手機重拉
// v120：修復便利貼備註在正文含 ``` 處被截斷——Remark/content 解析改為 CommonMark 圍欄規則（整行 3+ 反引號、
//      閉合長度 ≥ 開啟），寫入時圍欄長度動態取 max(3, 正文最長反引號串+1)，與桌面 calendar 插件一致；
//      桌面已寫出的 4 反引號 Remark 內含行內 ``` 時不再吞掉後續內容。calendar-editor.js 改，bump 讓手機重拉
// v121：LITE 便利貼／行程備註的表格區塊支援「MD 表格網格編輯器」——點表格區塊的 ✎ 圓點直接開格子網格
//      （＋行／列、建立空白表、改 Markdown 原文），格子改動即時寫回區塊 textarea，保存仍走既有區間回寫；
//      新增 md-table-grid.js（桌面引擎的鏡像），index.html/style.css/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v122：LITE 便利貼「＋☐」改成三模式下拉（＋☐▾ → checkbox 子事件／MD 表格／自由編輯），
//      對齊桌面便利貼；表格入口從零建空白網格、加入後不關窗可連續建立。
//      index.html/style.css/sticky-notes.js/calendar-editor.js 改，bump 讓手機重拉
// v123：手機 LITE 認 calendar 檔改為「檔名 calendar*.md 前綴匹配」（原本只認 calendar.md）——
//      calendar-event-draft.md 等草稿/分包檔可直接以行程方式開啟編輯；並補上「重畫整份文件時
//      保留 ## TAGS / ## INCLUDE 元區塊」（原本會被整段清掉）。calendar-editor.js/sticky-notes.js/
//      index.html/sw.js 改，bump 讓手機重拉
// v124：行程行新增「便利貼徽標」（該行程設了 - sticky: N（N>0）才顯示，與桌面 calendar 清單行同一位置＋同一圖示）；
//      點徽標＝開便利貼並跳到該行程的第一張（原本只會回到上次停留的那張）。
//      calendar-editor.js/style.css/sticky-notes.js/sw.js 改，bump 讓手機重拉
// v125：手機 LITE 多檔聯運——開啟 calendar*.md 主檔後，可用行程工具列「📎 加入档案」多次/多選載入
//      其它 calendar*.md（只讀併入顯示，不寫回主檔；iCloud 無法一次全載，故採分段多次加入）。include 事件
//      標 ro+⛔、禁用編輯/刪除/勾選，內容快取 localStorage（按主檔名），重開主檔自動重併。
//      app.js/calendar-editor.js/index.html/style.css/sw.js 改，bump 讓手機重拉
// v126：便利貼（翻頁）清單改用「主档 + include 只讀事件」併集建目錄——修「點 include 事件的便利貼徽標
//      卻翻不到、顯示別張」的 bug（原 calStickyBuildCatalog 只解析 elements.editor.value 主檔）。
//      便利貼內的寫入（＋☐/✎/勾選）對 ro 事件一律攔阻並提示。
//      sticky-notes.js/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v127：便利貼加上「來源檔案徽標」📄 <檔名>（對齊桌面便利貼 #docBadge 的做法）——只有來自
//      「📎 加入檔案」的只讀聯運行程才顯示，金色虛線膠囊，右上角不佔位；翻頁清單同名項也加 📄 記號。
//      非聯運便利貼（主档）完全看不出差別。sticky-notes.js/index.html/style.css/sw.js 改，bump 讓手機重拉
// v128：權限與桌面對齊——聯運（include）行程只鎖「行程本體」（標題／日期／刪除／完成），
//      **便利貼內容可改**：勾子事件、＋☐ 加子事件/表格/文本、編輯區塊與子事件都開放，
//      寫回只動來源檔「那一個 ## EVENT 區塊」的 Remark（其餘原文逐字保留），
//      內容存本機快取並在 📎 chip 打 ● 出現 ↓ 匯出（覆寫原檔才真正落回 iCloud）。
//      calendar-editor.js/app.js/sticky-notes.js/style.css/sw.js 改，bump 讓手機重拉
// v129：「保存」鍵納入聯運檔——只改聯運檔時保存鍵不再灰掉（狀態列顯示「● N 個聯運檔未寫回」），
//      按下即匯出；行動端把「主檔＋全部待寫回聯運檔」塞進**同一次分享面板**（選一次資料夾全部存回），
//      桌面 Chromium 逐檔 picker 直接寫回。取消（AbortError）整批不標已存。
//      app.js/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v130：「開啟」與「📎 加入檔案」合併成單一入口——按一次「開啟」可多選檔案，
//      calendar.md（不分大小寫）優先當主檔＝行程本體可編輯，其餘 calendar*.md 自動成為只讀聯運
//      （行程本體不可編輯，只有便利貼內容可改）。整組替換舊聯運清單；有未匯出修改時先確認。
//      工具列的 📎 按鈕與其隱藏 input 移除。index.html/app.js/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v131：LITE 行程檢視的備註可寫性對齊桌面——include(ro) 行程在「行程檢視」的備註降級為唯讀
//      （不給區塊 ✎／子事件 ✎，勾選與各編輯入口一律攔下並提示去便利貼改）；便利貼那邊仍可改並寫回來源檔。
//      兩邊共用同一組編輯函式，靠 DOM 歸屬（#calStickyOverlay）判斷這次動作來自哪個介面。
//      calendar-editor.js/sticky-notes.js/sw.js 改，bump 讓手機重拉
// v132：combo 選單新增三項——「＋ 建立 calendar 檔案」（前綴固定 calendar-，建空檔→設為當前文檔並標髒，
//      資料未載入也能用，按「保存」存回 iCloud）、「＋ 新建便利貼」（標題＋寫入檔案下拉：主檔或已併入聯運檔，
//      sticky=1 新行程，建好跳轉翻頁）、便利貼 ☰ 清單「🗑 删除便利貼」（刪當前翻頁那張，主檔→編輯緩衝、
//      ro 聯運→來源檔快取標髒，window.confirm 確認）。calendar-editor.js/sticky-notes.js/index.html/style.css/app.js/sw.js 改
// v141：狀態列版本號同時顯示 SW 版本——頁面透過 MessageChannel 問 SW（GET_VERSION），
//      SW 回 CACHE_NAME 尾碼，顯示成「v0.7.44 · sw.js v141」。
//      app.js/sw.js 改，bump 讓手機重拉
// v142：📎 聯運檔案清單從工具列下方搬進 combo 菜單——平時收合不占畫面，點「📎 聯運檔案 ▸」展開看 chip
//      清單（含 dirty ● / ↓ 匯出 / ✕ 移除）；數量與 dirty 狀態同步顯示在 toggle 按鈕上。
//      index.html/style.css/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v143：📅 事件過濾（EVENT/HOLIDAY/REPEAT/只顯示未完成）與 🏷 標籤過濾 一併搬進 combo 菜單——
//      平時全部收合不占畫面，各自獨立 toggle 展開；combo 關閉時自動把三個面板都收回去。
//      index.html/style.css/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v144：＋ 新增行程 也搬進 combo 菜單——工具列移除獨立按鈕，改在 combo 最底部用主動作樣式顯示；
//      點擊直接呼叫 openEventForm(null)，預設日期為今天。
//      index.html/style.css/calendar-editor.js/sw.js 改，bump 讓手機重拉
// v145：📱 啟動恢復草稿時（iOS 關閉前的自動備份），若是 calendar.md 自動切 events 視圖並滾到今天——
//      原本 restoreDraft() 只恢復文字與檔名、不做資料感知分派，就算草稿是 calendar.md 也停留
//      在 edit/split 視圖；補一行 dispatchDataAwareEditor() 即串起 setView('events') →
//      updatePreview → calStartupAutoScrollDone 守衛 → calAutoScrollToTodayPending →
//      renderEventsContent 雙 rAF 後滾到今天（月視圖置今日格於中央、列表視圖滾到最近今日）。
//      app.js 改，bump 讓手機重拉
// v146：修復啟動自動滾今天不生效的兩個 race condition——
//      (1) restoreDraft() 先 dispatchDataAwareEditor() 跑 render → init() 又 setView() 再跑一次，
//          第二次消費 calAutoScrollToTodayPending（已是 false）→ 不滾；改為 restoreDraft 只設
//          state.view='events'，讓 init() 走單次 setView 即可。
//      (2) 双 rAF 不夠——panel.offsetHeight 還沒出來就執行滾；改 desktop 同套路徑的 waitPane
//          迴圈（最多 120 帧）確保滾動容器真有高度才滾。
//      app.js/calendar-editor.js 改，bump 讓手機重拉
// v147：月視圖下方「今日行程列表」也要滾到今日——原來只在 calScope==='full' 時才滾，
//      預設月視圖 calScope='day'（setCalMode 設的），導致「行事曆（上）滾了、日程事件（下）沒滾」；
//      改為 month 模式只要有 elements.evDayList 就滾。calendar-editor.js 改，bump 讓手機重拉
// v148：修復「多选開啟（含 calendar.md）不滚到今天」的回歸——openSingleFile 那次渲染已消費掉
//      calAutoScrollToTodayPending（startup 守衛只觸發一次），隨後 calReplaceIncludes 重建列表把滾動
//      重置到頂部、flag 已為 false 不再滾；改在 calReplaceIncludes 的「最終併入後」渲染前重設 flag。
//      calendar-editor.js 改，bump 讓手機重拉
// v161：手機 LITE 只讀（ro / include）事件的「完成」checkbox 補視覺暗化——HTML 早已加 disabled（不觸發
//       change/click，故本就點不動），但缺 .ev-check:disabled 暗化 CSS，導致看起來「亮的但點不動」；
//       補 .ev-item .ev-check:disabled { cursor:default; opacity:.45 } 對齊桌面。style.css 改，bump 讓手機重拉
// v162：手機版主版本號升版 0 → 1（1.8.0）——APP_VERSION 與 manifest.json 長期停在 0.x 不恰當；
//       app.js APP_VERSION '0.7.64'→'1.8.0'、manifest.json version '0.8.0'→'1.8.0' 拉齊（原兩者已不同步）；
//       CACHE_NAME 跟進 v161→v162（app.js 內容變更，須讓手機重拉最新資源）。純版本號維護，無功能變動。
// v163：頂欄「保存」按鈕改為 combo——主按鈕＝保存全部（原行為），右側 ▾ 下拉可選單一檔案保存
//       （只存主檔 / 只存某個聯運檔），dirty 角標隨之遞減。app.js/style.css/index.html 改，bump 讓手機重拉；
//       APP_VERSION 與 manifest.json 同步 1.8.0→1.8.1。
// v164：修正保存 combo 下拉選單定位——原 right:0 讓選單向左延伸出螢幕左緣、裁掉檔名開頭；
//       改 left:0（按鈕在頂部最左，向右展開）並加 max-width 防極窄屏溢出。純 style.css 改，bump 讓手機重拉；
//       APP_VERSION 與 manifest.json 同步 1.8.1→1.8.2。
// v165：列表模式按「今天」、今天無行程時不再「一動不動」——calQueueScrollActiveViewToToday 的 list 分支
//       原把 target 限定為「今天那天的 .ev-date 頭」，今天無行程→target=null→整個滾動流程被略過；
//       改為「只要有任一有行程的日期就放行」。scrollToNearestDate 同步由「只找最近未來日」改為
//       「取離今天絕對距離最小的有行程日」（過去/未來皆可，天數相同取較早日），並補 calDayDiff 輔助。
//       calendar-editor.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.2→1.8.3。
// v166：收緊列表事件項「內容行」行盒——原 TERM 膠囊 line-height 1.7（高 ~25px）、標籤膠囊 line-height 1.35 + padding 3px、
//       ✎ 最小高 17px，把標題行（被撐到 ~48px）與 notes 內 checkbox 子事件行（被撐到 ~25px）整行撐高，視覺上「內容行間距太大」。
//       改 TERM 膠囊 line-height 1.7→1.3 + padding 0 .55em→0 .5em + font .9em→.88em、標籤膠囊 line-height 1.35→1.2 + padding 3px 12px→2px 10px、
//       ✎ 最小 17px→15px + vertical-align -.2em→-.15em；行盒降約 24%（checkbox 子事件行 25→19px、TERM 膠囊 25→17-20px）。
//       純 style.css 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.3→1.8.4。
// v167：進一步收緊列表事件項「內容行」行盒（上輪 v166 使用者仍嫌鬆）——在 v166 基礎上再降 line-height 與膠囊尺寸：
//       .ev-title 顯式 line-height 1.3、.ev-notes line-height 1.35；TERM 膠囊 line-height 1.3→1.15 + padding 0 .5em→0 .42em + font .88em→.85em、
//       TERM 領域小膠囊 line-height 1.6→1.15 + padding 0 .4em→0 .35em + font .76em→.72em；標籤膠囊 padding 2px 10px→1px 8px + line-height 1.2→1.1；
//       ✎/MD 編輯圓點 width/height 1.3em→1.2em + min 15px→13px + font .7em→.62em。
//       實測（Electron 真引擎）：checkbox 子事件行盒 19→18px、TERM 膠囊(標題)20→17px、(notes)17→14px、標籤 20→17px、✎ 15→13px、標題行 45→43px，
//       事件內容行(18px) 已小於事件間距(~21px＝padding 10+10 + 1px border)，符合「內容行距應小於事件間距」的原訴求。
//       純 style.css 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.4→1.8.5。
// v168：年視圖「今天」滾動邏輯對齊列表模式——原年模式下方「全年行程列表」按 today 滾動走 calScrollListToDate
//       （calPickScrollTarget 只偏好「未來日」），今天無行程時定位不確定、且與列表模式的「絕對距離最近、tie 取較早」不一致。
//       改為呼叫與列表模式同款的 scrollToNearestDate(elements.evYearDayList)：今天無行程時滾到「離今天絕對距離最小且有行程」的那天
//       （過去/未來皆可、天數相同取較早），與 v165 列表邏輯完全一致。年網格本身仍由 calScrollYearToCurrentMonth 置中當月，不受影響。
//       calendar-editor.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.5→1.8.6。
// v169：便利貼（兩端）下拉選單支援搜尋——LITE `#calStickySheet` 與桌面 `#tlStickyMenu` 各加一個搜尋框，
//       輸入即過濾清單：LITE 匹配「標題（去裝飾）＋ 內容(notes)」、桌面匹配「標題＋日期＋內容」，皆不區分大小寫；
//       LITE 清單標題同步顯示「符合 N 項」、無符合時提示「沒有符合「xxx」的便利貼」；兩端開啟選單時清空搜尋框。
//       實作：LITE 在 sticky-notes.js 增 calStickyMatchQuery ＋ 改 calStickyRenderSheetList（oninput 觸發）、
//       index.html 加 #calStickySearch、style.css 加 .cal-sticky-search；桌面在 index.html 改 tlRenderStickyMenuList
//       （oninput 觸發）＋ 加 #tlStickySearch ＋ 加 .ev-sticky-search。清單重繪只替換列表容器、不動搜尋框，故輸入焦點不丟。
//       LITE sticky-notes.js/index.html/style.css 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.6→1.8.7。
// v170：便利貼搜尋升級為 combo 搜尋框（定位開關）——在搜尋框旁加「📍 定位」開關：有搜尋內容時預設開啟（可手動關）、
//       無內容時固定關閉（disabled，不可開啟）。開啟時在便利貼「渲染模式」把搜尋詞以 <mark class="search-highlight">
//       金底高亮標示（LITE 標題＋內容；桌面便利貼窗 #body/#title 同樣高亮），方便快速查找結果。
//       實作：LITE sticky-notes.js 增 calStickyOnSearchInput/calStickyToggleLocate/calStickySyncLocate/calStickyWrap ＋
//       calStickyRenderPage 渲染模式注入高亮；index.html 加 #calStickyLocateBtn、style.css 加 .cal-sticky-locate ＋
//       search-highlight。桌面同款 combo（index.html 加 #tlStickyLocateBtn ＋ .ev-sticky-locate）並經由新 IPC
//       sticky-note-locate（windows.js 廣播給所有便利貼窗）／sticky-note-locate-get（新窗啟動補種）把定位詞送進
//       desktop-note.js 的 noteApplyHighlight；刷新載荷亦帶 hl（tlPushStickyRefreshes / refresh-complete）。
//       LITE index.html/sticky-notes.js/style.css 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.7→1.8.8。
// v171：搜尋高亮改 reverse 渲染（承接 v170）——使用者回饋金底高亮與 TERM 術語膠囊顏色太近，改為「字/底對調」：
//       高標底＝便利貼字色(--note-fg / --cal-sticky-fg)、高標字＝紙張實色(--note-bg / --cal-sticky-bg)，
//       與金色膠囊明確區分，對比度由便利貼自身字/底配對保證（深淺便條皆清楚）。
//       實作：desktop-note.js applyColor 增設 --note-bg（tint 實色 100）；LITE calStickyApplyStyle 增設 --cal-sticky-bg；
//       desktop-note.html 與 style.css 的 .search-highlight 由金底黑字改為 var(--note-fg/--cal-sticky-fg) 底 + 紙色字。
//       LITE sticky-notes.js/style.css 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.8.8→1.8.9。
// v172：便利貼設定可攜 JSON（承接「改程式／重開後設定不見」）——LITE localStorage 對 origin + 檔名敏感，
//       換 port／LAN IP 或清網站資料就整份消失。便利貼 ☰ 清單新增「📥 載入設定 JSON／📤 匯出設定 JSON」：
//       匯出檔名 sticky-notes-settings-<calendar檔名>.json，內含每張樣式、關閉清單、上次頁次；
//       載入時同時認得桌面原生存檔 sticky-notes-state.json（自動逐筆轉換），確認後取代目前 calendar 檔的 storage。
//       轉換與欄位驗證抽成共用 sticky-settings.js（桌面主程序 require 同一份，避免兩端口徑分歧）。
//       LITE index.html/sticky-notes.js/style.css/sticky-settings.js/sw.js 改，bump 讓手機重拉；
//       APP_VERSION 與 manifest.json 同步 1.8.9→1.9.0。
// v181：便利貼內 checkbox 視覺規格化——內框用字體色（var(--cal-sticky-fg)）、外框套金色 #D4AF37，
//       兩框皆用最細 1px 線、緊密嵌套（外框用 box-shadow 0 0 0 1px 直接貼在內框外、無任何間隙），
//       方框大小＝字體大小（width/height:1em，font-size:inherit 隨便利貼字級縮放）。
//       僅作用於便利貼正文 .cal-sticky-body，桌面端同步改 desktop-note.html 的 .ev-cb。
//       LITE style.css/sw.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.8→1.9.9。
// v180：便利貼「設定資料缺失」提醒改為常駐（不自動關閉）——toast 加 ✕ 關閉鈕，由使用者手動關閉；
//       showToast 加 persistent 參數（第 4 參，預設 false），persistent 時不排程自動消失、顯示 ✕；
//       #toast 結構改成 <span id="toast-msg">＋<button id="toast-close">，.toast 改 flex 並加 .closable（換行＋最大寬度）。
//       LITE index.html/style.css/app.js/sticky-notes.js/sw.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.7→1.9.8。
// v179：便利貼「設定資料缺失」提醒——手機 LITE 啟動／開啟 calendar 時，若本機 localStorage 找不到該檔的
//       便利貼設定、且本次「開啟」又沒帶入 sticky-notes-settings-*.json，就 toast 提醒使用者去「開啟」一次
//       選 calendar 檔＋該設定 JSON 來還原（承接「換 origin／清網站資料後設定不見」）。
//       判斷點 calStickyHasStoredSettings()（以 storage 鍵是否存在為準）；同一 session 同一 calendar 只提醒一次。
//       LITE app.js/sticky-notes.js/sw.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.6→1.9.7。
// v178：修正便利貼摺疊 ▸ 標記位置偏移——掃描摺疊塊時外層 for 迴圈在內層跳過整塊後又 i++，
//       漏算「摺疊塊後第一條可見行」，每個前置摺疊塊就讓後面的 ▸ 再往上偏一條可見行
//       （多塊時偏移累積十幾行，出現 tooltip 寫「第 89–91 行」卻畫在第 57 行附近）。
//       改以 while 逐行推進。桌面 desktop-note.js 與 LITE sticky-notes.js 同修，
//       bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.5→1.9.6。
// v177：便利貼編輯模式「折疊已完成 checkbox」與既有「只顯示未完成 checkbox」設定聯動——勾選才折疊，
//       未勾選時編輯框顯示全文、行號 1..n、不顯示 chip 與 ▸ 標記；編輯中切換設定立即折疊／還原全文。
//       保存仍沿 LCS 合併隱藏行（未勾選時本來就是全文，無隱藏行）。桌面 desktop-note.js 與
//       LITE sticky-notes.js 同口徑；bump 讓手機重拉，APP_VERSION 與 manifest.json 同步 1.9.4→1.9.5。
// v176：便利貼編輯模式「折疊已完成 checkbox」定稿——折疊不是刪除也不是隱藏：原文行數不變、行號不重排
//       （折 3 行後可見行仍顯示 1,2,5…）；每個摺疊塊在行號邊條縫隙上有 ▸N 標記，點哪塊只展開哪塊；
//       右上角 chip 全部展開／全部折疊（無完成項時不顯示）。保存時沿 LCS 錨點把折疊行按原順序插回全文，
//       折疊期間新增／修改／刪除可見行都不會丟已完成內容；圍欄程式碼塊內的 [x] 不折。
//       桌面 desktop-note.js/html 與 LITE sticky-notes.js/index.html/style.css/app.js 同口徑。
//       bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.3→1.9.4。
// v174：手機版「開啟」一次選 calendar.md ＋ sticky-notes-settings-*.json 時，主檔開好就自動套用設定
//       （不必再進便利貼選單按「載入設定 JSON」）；只選設定 JSON 也能套用到目前 calendar 檔；
//       剛啟動還沒開檔時先選設定 JSON → 依 JSON 自帶的 calendarFile 寫入該檔設定槽，開啟後即生效。
//       app.js/sticky-notes.js/sw.js 改，bump 讓手機重拉；APP_VERSION 與 manifest.json 同步 1.9.1→1.9.2。
// v173：便利貼設定接進主保存流程——改樣式／關閉清單後頂欄「保存」亮角標，
//       按保存時設定 JSON 與主檔、聯運檔一起交付（iOS 逐檔各彈一次分享面板）；
//       交付成功才清角標，取消則保留。頁次不列入比對（翻頁不會亮角標）。
//       app.js/calendar-editor.js/sticky-notes.js 改，bump 讓手機重拉；APP_VERSION 1.9.0→1.9.1。
const CACHE_NAME = 'md-editor-lite-v181';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './lunar.js',
  './almanac-s2t.js',
  './app.js',
  './md-renderer.js',
  './md-table-grid.js',
  './calendar-editor.js',
  './sticky-settings.js',
  './sticky-notes.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// 網絡超時上限（ms）：超過就視為「連不上」，立刻回退快取，避免內網不可達時無限等待。
const FETCH_TIMEOUT = 3000;

// 包一層帶超時的 fetch：到時間未完成 → 拋錯（觸發回退快取）
function fetchWithTimeout(req, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    fetch(req)
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// 安裝事件 - 預緩存資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('緩存資源...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活事件 - 清理舊緩存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 請求事件 - 緩存優先 + 後台更新；CDN 資源只緩存 GET 成功響應
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理 GET 請求（POST/PUT 等直接放行）
  if (req.method !== 'GET') return;

  // 只處理同源資源或 https 的 CDN（其它跨域請求直接放行，避免干擾）
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = /cdn\.jsdelivr\.net$/.test(url.hostname) || /unpkg\.com$/.test(url.hostname);
  if (!isSameOrigin && !isCdn) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);

      // 後台更新：有快取也要嘗試拉新（不阻塞回應），成功則覆寫快取
      const networkUpdate = fetchWithTimeout(req, FETCH_TIMEOUT)
        .then((response) => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(req, responseClone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => null); // 網絡失敗/超時 → 忽略，繼續用快取

      // 若有快取：立即回傳快取，同時讓網絡更新在背景跑（stale-while-revalidate）
      if (cached) {
        event.waitUntil(networkUpdate);
        return cached;
      }

      // 無快取：只能等網絡，失敗則 SPA 兜底到首頁
      try {
        return await networkUpdate;
      } catch (_) {
        if (req.mode === 'navigate') {
          const indexHtml = await caches.match('./index.html');
          if (indexHtml) return indexHtml;
        }
        return Response.error();
      }
    })()
  );
});

// 消息事件 - 處理來自頁面的消息
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // 回報自身版本（CACHE_NAME 尾碼），頁面狀態列拿來顯示 sw.js 版本
  if (event.data && event.data.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', cacheName: CACHE_NAME };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  }
});
