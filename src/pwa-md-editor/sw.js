/**
 * Service Worker - PWA 離線支持
 */

const CACHE_NAME = 'md-editor-lite-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

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

// 請求事件 - 網絡優先，失敗時回退緩存；CDN 資源只緩存 GET 成功響應
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
    fetch(req)
      .then((response) => {
        // 只緩存成功且可複製的響應（basic=同源 / cors=跨域但可讀）
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(req, responseClone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // 網絡失敗：優先精確匹配，其次退化到 ./ 首頁（SPA 兜底）
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});

// 消息事件 - 處理來自頁面的消息
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
