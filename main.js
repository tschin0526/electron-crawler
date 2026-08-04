/**
 * 无限空间·AI智控台 - 主进程
 *
 * 功能：
 * 1. 创建浏览器窗口（禁用 Web 安全限制）
 * 2. 提供 IPC 通信接口
 * 3. 支持访问任何网站（无跨域限制）
 * 4. 内置 HTTP API 服务器（供网页版智控实验室调用）
 */

// ============================================================
// 📌 版本号系统（每次修改代码后请递增！）
//    格式：主版本.次版本.修订-修改序号
//    修改序号：每次功能修改+1
// ============================================================
const APP_VERSION = '1.0.0-45';  // 🎯 新增"识别后台服务"功能：自动检测并选择当前使用的服务卡片

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  无限空间·AI智控台                              ║');
console.log('║  版本: ' + APP_VERSION.padEnd(38) + '║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');

// 数据抓取与格式化模组（从 main.js 拆分而来）
const {
  aggressiveClean,
  injectMessageToInputBox,
  clickSendButton,
  monitorAndCaptureReply,
  cleanDataForIPC,
  isApiUrl,
  isUtf8Api,
  fetchApiData,
  fetchTwseDataDirect,
  fetchTwseOpenApiData,
  formatApiResponse,
  formatTencentStockData,
  formatSinaStockData,
  formatTwseStockData,
  formatGenericJsonData,
  formatTextResponse,
  flattenJson,
  parseCsvData,
  formatTwseCsvData,
  formatTwseTextData,
  formatEmptyResponse,
  gbkBufferToString,
  convertGbkToUnicode,
  formatTencentTime,
  formatSinaKlineData,
  formatTwseOpenApiData,
  crawlPageInternal
} = require('./main-modules/api-data.js');

let mainWindow;

// API 服务器模组（从 main.js 拆分而来，通过 init 注入依赖）
const apiServerModule = require('./main-modules/api-server.js');

// 🆕 v1.0.0-37: 存储最后使用的服务卡片索引（用于"识别后台服务"功能）
//    使用可变对象以便与 api-server 模组共享实时状态
const lastUsedServiceCard = { index: -1, name: '', time: null };

// 窗口管理与 UI IPC 模组（从 main.js 拆分而来，通过 init 注入依赖）
const windowsModule = require('./main-modules/windows.js');
windowsModule.init({
  app,
  APP_VERSION,
  apiServerModule,
  setMainWindow: (win) => { mainWindow = win; },
});

app.whenReady().then(() => {
  windowsModule.createWindow();

  // 注册全局快捷键：Shift+Command+F（卡片页签）
  const retF = globalShortcut.register('Shift+Command+F', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[GlobalShortcut] Shift+Command+F 触发');
      mainWindow.webContents.send('toggle-floating-window');
    }
  });
  if (!retF) {
    console.log('[GlobalShortcut] Shift+Command+F 注册失败，可能被其他应用占用');
  } else {
    console.log('[GlobalShortcut] Shift+Command+F 注册成功');
  }

  // 注册全局快捷键：Shift+Command+G（通用页签）
  const retG = globalShortcut.register('Shift+Command+G', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[GlobalShortcut] Shift+Command+G 触发');
      mainWindow.webContents.send('toggle-floating-window-general');
    }
  });
  if (!retG) {
    console.log('[GlobalShortcut] Shift+Command+G 注册失败，可能被其他应用占用');
  } else {
    console.log('[GlobalShortcut] Shift+Command+G 注册成功');
  }

  // 🆕 使用 web-contents-created 监听 webview 的键盘事件
  // 仅处理 webview 内的按键（主窗口的按键由 DOM keydown 处理，避免双重触发）
  app.on('web-contents-created', (event, contents) => {
    contents.on('before-input-event', (inputEvent, input) => {
      // 只处理 webview 内的按键，主窗口的交给 DOM keydown
      if (contents.getType() !== 'webview') return;

      // Shift+Command+F → 展开浮动视窗（卡片页签）
      if (input.key.toLowerCase() === 'f' &&
          input.shift &&
          (input.meta || input.control)) {
        inputEvent.preventDefault();
        console.log('[Keyboard] 捕获到 Shift+Cmd/Ctrl+F (来源:', contents.getType(), ') - 已由全局快捷键处理，跳过');
        return;
      }
      // Shift+Command+G → 展开浮动视窗（通用页签）
      if (input.key.toLowerCase() === 'g' &&
          input.shift &&
          (input.meta || input.control)) {
        inputEvent.preventDefault();
        console.log('[Keyboard] 捕获到 Shift+Cmd/Ctrl+G (来源:', contents.getType(), ') - 已由全局快捷键处理，跳过');
        return;
      }
    });
  });
  console.log('[Keyboard] 全局 before-input-event 已注册（含 webview 支持）');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowsModule.createWindow();
    }
  });

  apiServerModule.init({
    APP_VERSION,
    lastUsedServiceCard,
    loadBookmarksForAPI,
    previewBookmarkByIndex,
    captureElementContentByIndex,
    injectMessageToWebview,
    sendEmailViaSMTP
  });

  apiServerModule.startAPIServer().then((result) => {
    console.log(result.message);
  }).catch((error) => {
    console.error('[API Server] 启动失败:', error.message);
  });
});

app.on('window-all-closed', () => {
  // 注销全局快捷键
  globalShortcut.unregisterAll();
  apiServerModule.stopAPIServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ========== 窗口管理与 UI IPC（已拆分到 main-modules/windows.js） ==========

// ========== 常用服务网点数据持久化（已拆分到 main-modules/ipc-storage.js） ==========
const ipcStorage = require('./main-modules/ipc-storage.js');
const { loadBookmarksForAPI } = ipcStorage;

// 插件数据目录：开发模式项目目录/data/，打包模式应用包同级目录/data/
let PLUGINS_DATA_DIR;
if (app.isPackaged) {
  const appPath = app.getPath('exe');
  const appDir = path.dirname(appPath);
  PLUGINS_DATA_DIR = path.join(appDir, '../data');
} else {
  PLUGINS_DATA_DIR = path.join(__dirname, '../data');
}

ipcStorage.init({
  PLUGINS_DATA_DIR,
  getMainWindow: () => mainWindow,
  setCurrentServiceCard: (index, name) => {
    lastUsedServiceCard.index = index;
    lastUsedServiceCard.name = name;
    lastUsedServiceCard.time = new Date().toISOString();
  },
});

// ========== 桌面自动化模组（从 main.js 拆分而来） ==========
const desktopAutomation = require('./main-modules/desktop-automation.js');
const {
  previewBookmarkByIndex,
  captureElementContentByIndex,
  injectMessageToWebview,
} = desktopAutomation.init({
  getMainWindow: () => mainWindow,
  APP_VERSION,
  loadBookmarksForAPI,
  lastUsedServiceCard,
});

async function sendEmailViaSMTP(to, subject, content) {
  return new Promise((resolve, reject) => {
    try {
      const nodemailer = require('nodemailer');

      const transporter = nodemailer.createTransport({
        host: 'smtp.mail.me.com',
        port: 587,
        secure: false,
        auth: {
          user: 'tschin0526@me.com',
          pass: 'nkls-dqgj-rled-knab'
        }
      });

      const mailOptions = {
        from: '"Chin Charles" <tschin0526@me.com>',
        to: to,
        subject: subject,
        text: content
      };

      console.log('[Main] 通过 SMTP 发送邮件到:', to);
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('[Main] SMTP 发送邮件失败:', error.message);
          reject(error);
        } else {
          console.log('[Main] 邮件发送成功, MessageID:', info.messageId);
          resolve({ success: true, message: '邮件发送成功', messageId: info.messageId });
        }
      });
    } catch (error) {
      console.error('[Main] 发送邮件失败:', error.message);
      reject(error);
    }
  });
}

// load-bookmarks IPC handler / loadBookmarksForAPI / getBookmarkByIndex
// 已拆分到 main-modules/ipc-storage.js

// ============================================================
// 🔒 [已废弃] 根据索引访问网点（使用扫整页 DOM 模式）
//    2026-06-12 起：服务卡片全部改为「Preview + 选择器抓取」模式。
// ============================================================
// async function crawlBookmarkByIndex(index, customMessage) {
//   const bookmark = getBookmarkByIndex(index);
//   if (!bookmark) {
//     throw new Error('找不到索引为 ' + index + ' 的服务卡片');
//   }
//
//   console.log('[Main] [API] 开始爬取卡片:', bookmark.name, bookmark.url);
//   console.log('[Main] [API] 自定义消息:', customMessage || '(无)');
//
//   const customHeaders = {};
//   if (bookmark.referer) {
//     customHeaders['Referer'] = bookmark.referer;
//   }
//   if (bookmark.userAgent) {
//     customHeaders['User-Agent'] = bookmark.userAgent;
//   }
//
//   const result = await crawlPageInternal(bookmark.url, Object.keys(customHeaders).length > 0 ? customHeaders : null);
//
//   result._bookmarkInfo = {
//     index: index,
//     name: bookmark.name,
//     url: bookmark.url,
//     category: bookmark.category,
//     customMessage: customMessage || null,
//     crawledAt: new Date().toISOString()
//   };
//
//   return result;
// }

// 占位，防止未定义引用（实际不会执行到）
async function crawlBookmarkByIndex() {
  throw new Error('[已废弃] crawlBookmarkByIndex 不再使用，请改用 preview-bookmark + capture-element-content 组合方式');
}

// save-bookmarks / load-plugin-data / save-plugin-data / set-current-service-card
// 以及 PLUGINS_DATA_DIR 声明 已拆分到 main-modules/ipc-storage.js

// load-headers-map / save-headers-map / openExternalBrowser / open-web-preview
// / load-collapsed-states / save-collapsed-states / open-file-dialog / preview-file
// / formatFileSize / load-schedules / save-schedules / load-scheduler-logs / save-scheduler-logs
// 已拆分到 main-modules/ipc-storage.js

console.log('[Main] 无限空间·AI智控台已启动');
