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

// 請求事件 - 網絡優先，失敗時使用緩存
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 克隆響應並存入緩存
        const responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseClone);
          });
        return response;
      })
      .catch(() => {
        // 網絡失敗時使用緩存
        return caches.match(event.request);
      })
  );
});

// 消息事件 - 處理來自頁面的消息
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
