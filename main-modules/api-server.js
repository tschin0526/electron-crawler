/**
 * API 服务器模组
 * 从 main.js 拆分而来
 *
 * 提供内置 HTTP API 服务，供网页版智控实验室调用。
 * 通过 init(shared) 注入 main.js 中的外部依赖。
 */
const http = require('http');
const url = require('url');
const { ipcMain } = require('electron');

let apiServer = null;
let apiServerRunning = false;
const API_PORT = 3000;

let shared = {};

// 通过 init(shared) 注入的依赖：
//   shared.APP_VERSION                 - 版本号字符串
//   shared.lastUsedServiceCard         - { index, name, time } 可变对象（与 main.js 共享实时状态）
//   shared.loadBookmarksForAPI         - 函数
//   shared.previewBookmarkByIndex      - 函数
//   shared.captureElementContentByIndex - 函数
//   shared.injectMessageToWebview      - 函数
//   shared.sendEmailViaSMTP            - 函数

function startAPIServer() {
  return new Promise((resolve, reject) => {
    if (apiServerRunning && apiServer) {
      resolve({ success: true, message: 'API 服务器已经在运行', port: API_PORT });
      return;
    }

    const APP_VERSION = shared.APP_VERSION;
    const lastUsedServiceCard = shared.lastUsedServiceCard;

    apiServer = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 🔒 [已废弃] /api/crawl?url=... —— 2026-06-12 起不再使用扫整页 DOM 模式
      if (pathname === '/api/crawl' && req.method === 'GET') {
        res.writeHead(410);
        res.end(JSON.stringify({ error: '[已废弃] 此接口不再使用，请改用 preview-bookmark + capture-element-content 组合方式' }));

      } else if (pathname === '/api/status' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'running',
          message: 'AI智控台 API 服务已启动',
          port: API_PORT
        }));

      } else if (pathname === '/api/current-service-card' && req.method === 'GET') {
        // 🆕 v1.0.0-37: 返回当前使用的服务卡片信息（用于"识别后台服务"功能）
        // 简单直接：返回 lastUsedServiceCard 对象（在 previewBookmarkByIndex 中自动更新）
        res.writeHead(200);
        res.end(JSON.stringify({
          index: lastUsedServiceCard.index,
          name: lastUsedServiceCard.name,
          time: lastUsedServiceCard.time,
          found: (lastUsedServiceCard.index >= 0),
          // 调试信息（帮助排查问题）
          debug: {
            serverVersion: 'v1.0.0-45',
            apiVersion: 'v1.0.0-45',
            message: lastUsedServiceCard.index >= 0 ?
              '✅ 已找到后台服务卡片' :
              '⚠️ 未找到。请在服务器端点击任意一个服务卡片后重试'
          }
        }));

      } else if (pathname === '/api/bookmarks' && req.method === 'GET') {
        const bookmarks = shared.loadBookmarksForAPI();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, bookmarks: bookmarks, count: bookmarks.length }));

      // ============================================================
      // 🔒 [已废弃] /api/crawl-bookmark/{index}
      //    2026-06-12 起：服务卡片全部改为「Preview + 选择器抓取」模式，
      //    不再使用扫整页 DOM 后人工拼 Markdown 的方式。
      //    保留下面的代码保留源码作为历史记录，实际请求会返回"已废弃"错误。
      // } else if (pathname.match(/^\/api\/crawl-bookmark\/(\d+)$/) && req.method === 'POST') {
      //   const match = pathname.match(/^\/api\/crawl-bookmark\/(\d+)$/);
      //   const index = parseInt(match[1]);
      //   let body = '';
      //   req.on('data', chunk => { body += chunk; });
      //   req.on('end', () => {
      //     try {
      //       const payload = body ? JSON.parse(body) : {};
      //       const customMessage = payload.presetMessage || null;
      //       crawlBookmarkByIndex(index, customMessage)
      //         .then((result) => {
      //           res.writeHead(200);
      //           res.end(JSON.stringify(result));
      //         })
      //         .catch((error) => {
      //           res.writeHead(500);
      //           res.end(JSON.stringify({ error: error.message }));
      //         });
      //     } catch (parseError) {
      //       res.writeHead(400);
      //       res.end(JSON.stringify({ error: '请求体 JSON 解析失败: ' + parseError.message }));
      //     }
      //   });
      //
      } else if (pathname.match(/^\/api\/crawl-bookmark\/(\d+)$/) && req.method === 'POST') {
        // 返回明确的"已废弃"响应，避免调用方收到 404 时误以为接口"找不到
        res.writeHead(410);
        res.end(JSON.stringify({ error: '[已废弃] 此接口不再使用，请改用 preview-bookmark + capture-element-content 组合方式' }));

      } else if (pathname.match(/^\/api\/preview-bookmark\/(\d+)$/) && req.method === 'POST') {
        const match = pathname.match(/^\/api\/preview-bookmark\/(\d+)$/);
        const index = parseInt(match[1]);

        // 🆕 v1.0.0-37: 记录最后使用的服务卡片信息
        try {
          const bookmarks = shared.loadBookmarksForAPI();
          if (bookmarks && bookmarks[index]) {
            lastUsedServiceCard.index = index;
            lastUsedServiceCard.name = bookmarks[index].name || 'Unknown';
            lastUsedServiceCard.time = new Date().toISOString();
            console.log('[Main] [API] 📍 已记录最后使用的服务卡片: [' + index + '] ' + lastUsedServiceCard.name);
          }
        } catch (e) {
          console.warn('[Main] [API] ⚠️ 记录服务卡片信息失败:', e.message);
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const customMessage = payload.presetMessage || null;
            const customAttachment = payload.attachment || null;  // 📎 新增：接收附件参数
            // 🔧 【关键修复】从 payload 中读取 replySelector/heartbeatSelector/monitorTimeout
            //    前端直接从 selectedServiceCard 对象中取这些字段，确保参数正确
            const _params = {
              replySelector: payload.replySelector || '',
              heartbeatSelector: payload.heartbeatSelector || '',
              monitorTimeout: payload.monitorTimeout || 0
            };
            console.log('[Main] [API] preview-bookmark: payload params - replySelector:', _params.replySelector, 'heartbeatSelector:', _params.heartbeatSelector, 'monitorTimeout:', _params.monitorTimeout, 'ms');
            console.log('[Main] [API] 📎 preview-bookmark: attachment:', customAttachment ? customAttachment.name + ' (' + customAttachment.size + ' bytes)' : '(无)');
            shared.previewBookmarkByIndex(index, customMessage, _params, customAttachment)
              .then((result) => {
                res.writeHead(200);
                res.end(JSON.stringify(result));
              })
              .catch((error) => {
                res.writeHead(500);
                res.end(JSON.stringify({ error: error.message }));
              });
          } catch (parseError) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '请求体 JSON 解析失败: ' + parseError.message }));
          }
        });

      } else if (pathname === '/api/capture-element-content' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const bookmarkIndex = payload.bookmarkIndex;
            if (bookmarkIndex === undefined || bookmarkIndex === null) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: '缺少 bookmarkIndex 参数' }));
              return;
            }
            // 🔧 从 payload 中读取前端传过来的选择器和超时时间
            //    前端直接从 selectedServiceCard 对象中取的，确保字段值正确
            const _params = {
              replySelector: payload.replySelector || '',
              heartbeatSelector: payload.heartbeatSelector || '',
              monitorTimeout: payload.monitorTimeout || 0
            };
            console.log('[Main] [API] capture-element-content: payload params - replySelector:', _params.replySelector, 'heartbeatSelector:', _params.heartbeatSelector, 'monitorTimeout:', _params.monitorTimeout, 'ms');
            shared.captureElementContentByIndex(bookmarkIndex, _params)
              .then((result) => {
                res.writeHead(200);
                res.end(JSON.stringify(result));
              })
              .catch((error) => {
                res.writeHead(500);
                res.end(JSON.stringify({ error: error.message }));
              });
          } catch (parseError) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '请求体 JSON 解析失败: ' + parseError.message }));
          }
        });

      } else if (pathname === '/api/inject-message-to-webview' && req.method === 'POST') {
        console.log('🎯🎯🎯 [Main] [API] ✅✅✅ 收到 inject-message-to-webview 请求！✅✅✅');
        console.log('🎯🎯🎯 [Main] [API] 请求时间:', new Date().toISOString());
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const message = payload.message || '';
            const serviceCardIndex = payload.serviceCardIndex || 0;
            // 📎 支持多附件（attachments 数组或单个 attachment 对象）
            let attachment = null;
            if (payload.attachments && Array.isArray(payload.attachments) && payload.attachments.length > 0) {
              attachment = payload.attachments;  // 新格式：数组
            } else if (payload.attachment) {
              attachment = payload.attachment;    // 旧格式：单个对象
            }

            console.log('🎯🎯🎀 [Main] [API] 📨 收到的消息内容:', message.substring(0, 100));
            console.log('🎯🎯🎀 [Main] [API] 消息总长度:', message.length);
            console.log('🎯🎯🎀 [Main] [API] 📋 服务卡片索引:', serviceCardIndex);
            if (Array.isArray(attachment)) {
              console.log('🎯🎯🎀 [Main] [API] 📎 附件数量:', attachment.length);
              attachment.forEach((att, i) => {
                console.log(`🎯🎯🎀 [Main] [API]   [${i}] ${att.name} (${att.size} bytes)`);
              });
            } else {
              console.log('🎯🎯🎀 [Main] [API] 📎 附件信息:', attachment ? attachment.name + ' (' + attachment.size + ' bytes)' : '(无附件)');
            }
            console.log('📌 [Main] [API] 🔐 当前运行版本: v' + APP_VERSION);  // ✨ 显示版本号

            if (!message) {
              console.error('❌❌❌ [Main] [API] 错误：消息为空！');
              res.writeHead(400);
              res.end(JSON.stringify({ error: '缺少 message 参数', version: APP_VERSION }));  // ✨ 返回版本号
              return;
            }

            console.log('✅✅✅ [Main] [API] 开始调用 injectMessageToWebview 函数...');

            shared.injectMessageToWebview(message, serviceCardIndex, attachment)
              .then((result) => {
                // ✨ 在响应中附加版本号
                result.version = APP_VERSION;
                res.writeHead(200);
                res.end(JSON.stringify(result));
              })
              .catch((error) => {
                console.error('[Main] [API] inject-message-to-webview 失败:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ error: error.message, version: APP_VERSION }));  // ✨ 返回版本号
              });
          } catch (parseError) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '请求体 JSON 解析失败: ' + parseError.message }));
          }
        });

      } else if (pathname === '/api/send-email' && req.method === 'POST') {
        console.log('[Main] [API] 收到发送邮件请求');
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const to = payload.to;
            const subject = payload.subject;
            const content = payload.content;
            const saveCopy = payload.saveCopy !== false;

            if (!to || !subject || !content) {
              res.writeHead(400);
              res.end(JSON.stringify({ success: false, error: '缺少必要参数：to, subject, content' }));
              return;
            }

            shared.sendEmailViaSMTP(to, subject, content, saveCopy)
              .then((result) => {
                res.writeHead(200);
                res.end(JSON.stringify(result));
              })
              .catch((error) => {
                console.error('[Main] [API] 发送邮件失败:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: error.message }));
              });
          } catch (parseError) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '请求体 JSON 解析失败: ' + parseError.message }));
          }
        });

      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: '未找到该接口' }));
      }
    });

    apiServer.listen(API_PORT, '0.0.0.0', () => {
      apiServerRunning = true;
      console.log(`[API Server] HTTP API 服务已启动，端口: ${API_PORT}`);
      console.log('🎯🎯🎯 [API Server] ✅✅✅ 新API路由已注册：/api/inject-message-to-webview ✅✅✅');
      console.log('🎯🎯🎀 [API Server] 现在可以通过 POST /api/inject-message-to-webview 注入消息到 webview！');
      console.log('📌 [API Server] 当前版本: v' + APP_VERSION);  // ✨ 显示版本号
      resolve({ success: true, message: 'API 服务器启动成功', port: API_PORT, version: APP_VERSION });
    });

    apiServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject({ success: false, message: `端口 ${API_PORT} 已被占用` });
      } else {
        reject({ success: false, message: err.message });
      }
    });
  });
}

function stopAPIServer() {
  return new Promise((resolve) => {
    if (!apiServer || !apiServerRunning) {
      resolve({ success: true, message: 'API 服务器已经停止' });
      return;
    }

    apiServer.close(() => {
      apiServerRunning = false;
      apiServer = null;
      console.log('[API Server] HTTP API 服务已关闭');
      resolve({ success: true, message: 'API 服务器已停止' });
    });
  });
}

function getAPIServerStatus() {
  return {
    running: apiServerRunning,
    port: API_PORT
  };
}

function init(injectedShared) {
  shared = injectedShared || {};
  if (!shared.lastUsedServiceCard) {
    shared.lastUsedServiceCard = { index: -1, name: '', time: null };
  }

  ipcMain.handle('start-api-server', async () => {
    try {
      return await startAPIServer();
    } catch (error) {
      return error;
    }
  });

  ipcMain.handle('stop-api-server', async () => {
    return await stopAPIServer();
  });

  ipcMain.handle('get-api-status', () => {
    return getAPIServerStatus();
  });
}

module.exports = { init, startAPIServer, stopAPIServer, getAPIServerStatus, getApiServerRunning: () => apiServerRunning };
