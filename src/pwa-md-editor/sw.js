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
const CACHE_NAME = 'md-editor-lite-v12';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
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
