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
const CACHE_NAME = 'md-editor-lite-v104';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './lunar.js',
  './almanac-s2t.js',
  './app.js',
  './calendar-editor.js',
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
});
