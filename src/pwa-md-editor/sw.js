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
const CACHE_NAME = 'md-editor-lite-v62';
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
