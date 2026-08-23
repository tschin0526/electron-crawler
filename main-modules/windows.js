/**
 * 窗口管理与 UI IPC 模组
 * 从 main.js 拆分而来
 */
const { BrowserWindow, ipcMain, clipboard, nativeImage, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 应用根目录（本模组位于 main-modules/ 子目录，回退一级即 electron-crawler 根）
const APP_ROOT = path.join(__dirname, '..');

let mainWindow = null;
let elementViewerWindow = null;
let domTreeViewWindow = null;
let aiResponseViewerWindow = null;

// 🆕 B方案：邮件详情窗口主题跟随主程式统一控制
//    主进程维护全局工作区黑夜模式状态，并跟踪所有已打开的邮件详情窗口，
//    主题切换时主动通知它们，无需重启即可实时跟随。
let workspaceDarkModeEnabled = false;
const emailDetailWindows = new Set();
const cardWindows = new Set();

// 把当前工作区主题（dark/light）应用到所有已打开的邮件详情窗口
function applyWorkspaceThemeToEmailDetails(dark) {
  emailDetailWindows.forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(
        `document.body.classList.toggle('dark', ${dark ? 'true' : 'false'});`
      ).catch(() => {});
    }
  });
}

let APP_VERSION = '';
let apiServerModule = null;
let setMainWindowCallback = () => {};

// 选择器测试结果回调映射（用于等待异步结果）
const selectorTestCallbacks = new Map();
let selectorTestSeq = 0;

function createElementViewerWindow() {
  if (elementViewerWindow) {
    elementViewerWindow.focus();
    return elementViewerWindow;
  }

  elementViewerWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '📊 Webview 元素结构查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  elementViewerWindow.loadFile('src/element-viewer.html');

  if (process.argv.includes('--dev')) {
    elementViewerWindow.webContents.openDevTools();
  }

  elementViewerWindow.on('closed', () => {
    elementViewerWindow = null;
  });

  return elementViewerWindow;
}

function createDomTreeViewWindow() {
  if (domTreeViewWindow) {
    domTreeViewWindow.focus();
    return domTreeViewWindow;
  }

  domTreeViewWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: ' DOM 树形结构查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  domTreeViewWindow.loadFile('src/dom-tree-viewer.html');

  if (process.argv.includes('--dev')) {
    domTreeViewWindow.webContents.openDevTools();
  }

  domTreeViewWindow.on('closed', () => {
    domTreeViewWindow = null;
  });

  return domTreeViewWindow;
}

function createAiResponseViewerWindow() {
  if (aiResponseViewerWindow) {
    aiResponseViewerWindow.focus();
    return aiResponseViewerWindow;
  }

  aiResponseViewerWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: '📥 AI 回复查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  aiResponseViewerWindow.loadFile('src/ai-response-viewer.html');

  if (process.argv.includes('--dev')) {
    aiResponseViewerWindow.webContents.openDevTools();
  }

  aiResponseViewerWindow.on('closed', () => {
    aiResponseViewerWindow = null;
  });

  return aiResponseViewerWindow;
}

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

  const windowWidth = Math.round(screenWidth * 0.95);
  const windowHeight = Math.round(screenHeight * 0.95);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    title: '无限空间·AI智控台 v' + APP_VERSION,  // ✨ 显示版本号
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      disableBlinkFeatures: 'SameSiteByDefaultCookies,CookieWithoutSameSite',
      webviewTag: true
    },
    icon: path.join(APP_ROOT, 'icon.png'),
    show: true,
    backgroundColor: '#ffffff'
  });

  // 同步主窗口引用回 main.js（供其他模组/逻辑访问）
  setMainWindowCallback(mainWindow);

  mainWindow.loadFile('src/crawler-window.html');

  // ✨ 动态设置窗口标题（确保版本号显示，覆盖 HTML 的 title）
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.setTitle('无限空间·AI智控台 v' + APP_VERSION);
      console.log('📌 [Main] 窗口标题已设置为: v' + APP_VERSION);
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindowCallback(null);
  });
}

function init(shared) {
  // shared.app — Electron app 实例（本模组已自行 require，保留以兼容旧接口）
  // shared.APP_VERSION — 应用版本号
  // shared.apiServerModule — API 服务器模组（用于 get-app-info）
  // shared.setMainWindow — 设置主窗口的回调
  APP_VERSION = shared.APP_VERSION;
  apiServerModule = shared.apiServerModule;
  setMainWindowCallback = shared.setMainWindow || (() => {});

  // 🆕 主窗口最小化与恢复（用于截图区域录制时隐藏窗口）
  ipcMain.handle('minimize-main-window', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('restore-main-window', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
        mainWindow.focus();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-element-viewer', async (event, data) => {
    try {
      const viewer = createElementViewerWindow();

      // 每次都要发送最新数据（不管窗口是否已存在）
      // 等待查看器窗口加载完成后发送数据
      if (viewer.webContents.isLoading()) {
        viewer.webContents.once('did-finish-load', () => {
          viewer.webContents.send('set-element-data', data);
        });
      } else {
        // 窗口已加载，直接发送新数据
        viewer.webContents.send('set-element-data', data);
      }

      return { success: true, message: '查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] 打开查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('open-email-detail', async (event, url) => {
    try {
      console.log('[Main] 打开邮件详情窗口:', url);

      // 解析 URL 中的 hash 数据
      const urlObj = new URL(url);
      const hash = urlObj.hash;

      // 构建 email-detail.html 的完整路径
      const emailDetailPath = path.join(APP_ROOT, 'src', 'plugins', 'email', 'email-detail.html');
      const fullUrl = `file://${emailDetailPath}${hash}`;

      const detailWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: '邮件详情',
        frame: true,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // 🆕 跟踪此窗口，主题切换时主动通知它
      emailDetailWindows.add(detailWindow);
      detailWindow.on('closed', () => {
        emailDetailWindows.delete(detailWindow);
      });

      // 🆕 加载完成后，按主程式当前主题设置 body.dark（跟随统一控制）
      detailWindow.webContents.once('did-finish-load', () => {
        detailWindow.webContents.executeJavaScript(
          `document.body.classList.toggle('dark', ${workspaceDarkModeEnabled ? 'true' : 'false'});`
        ).catch(() => {});
      });

      detailWindow.loadURL(fullUrl);
      detailWindow.setMenuBarVisibility(false);

      return { success: true };
    } catch (error) {
      console.error('[Main] 打开邮件详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 卡片 markdown 新窗口：[文字](win:ID) 点击后，在独立窗口里渲染该卡片的 markdown
  // 数据走 URL hash（base64url），与 open-email-detail 同思路：避免 IPC 接收、无需 preload
  ipcMain.handle('open-card-window', async (event, payload) => {
    try {
      const { id, title, html, dark } = payload || {};
      if (!id) return { success: false, error: '缺少卡片 id' };
      const winPath = path.join(APP_ROOT, 'src', 'plugins', 'todolist', 'card-markdown-window.html');
      const json = JSON.stringify({
        title: title || ('卡片：' + id),
        html: html || '',
        dark: !!dark,
      });
      const encoded = Buffer.from(json, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const fullUrl = `file://${winPath}#${encoded}`;
      const win = new BrowserWindow({
        width: 760,
        height: 820,
        title: title || ('卡片：' + id),
        frame: true,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      cardWindows.add(win);
      win.on('closed', () => cardWindows.delete(win));
      win.loadURL(fullUrl);
      win.setMenuBarVisibility(false);
      return { success: true };
    } catch (error) {
      console.error('[Main] 打开卡片 markdown 窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 B方案：渲染进程切换工作区黑夜模式后，主动同步到主进程并通知所有邮件详情窗口
  ipcMain.handle('set-workspace-theme', async (event, payload) => {
    try {
      const dark = !!(payload && payload.dark);
      workspaceDarkModeEnabled = dark;
      applyWorkspaceThemeToEmailDetails(dark);
      console.log('[Main] 工作区主题已同步到主进程:', dark ? '黑夜' : '白天');
      return { success: true, dark };
    } catch (error) {
      console.error('[Main] 同步工作区主题失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('refresh-element-viewer', async (event) => {
    try {
      if (!elementViewerWindow) {
        return { success: false, error: '元素查看器窗口未打开' };
      }

      // 通知渲染进程执行刷新
      mainWindow.webContents.send('request-element-refresh');

      return { success: true, message: '已请求刷新' };
    } catch (error) {
      console.error('[Main] 刷新元素查看器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 监听渲染进程发来的刷新数据
  ipcMain.on('element-refresh-data', (event, data) => {
    console.log('[Main] 收到 element-refresh-data 数据');
    console.log('[Main] 数据 keys:', data ? Object.keys(data) : 'null');
    console.log('[Main] allTextElements 数量:', data && data.allTextElements ? data.allTextElements.length : 0);

    if (elementViewerWindow) {
      elementViewerWindow.webContents.send('set-element-data', data);
      console.log('[Main] 已转发数据到元素查看器');
    } else {
      console.log('[Main] 元素查看器窗口不存在');
    }
  });

  ipcMain.handle('open-ai-response-viewer', async (event, data) => {
    try {
      const viewer = createAiResponseViewerWindow();

      if (data) {
        // 等待查看器窗口加载完成后发送数据
        viewer.webContents.once('did-finish-load', () => {
          viewer.webContents.send('set-response-data', data);
        });

        // 如果已经加载完成，直接发送
        if (!viewer.webContents.isLoading()) {
          viewer.webContents.send('set-response-data', data);
        }
      }

      return { success: true, message: 'AI 回复查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] 打开 AI 回复查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-loading', async (event, message) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-loading', message);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置加载状态失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-data', async (event, data) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-response-data', data);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置 AI 回复数据失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-error', async (event, errorMessage) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-error', errorMessage);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置错误状态失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-selector', async (event, selector) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-selector', selector);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置选择器失败:', error);
      throw error;
    }
  });

  // 测试选择器：从元素查看器发送，转发到主智控台窗口执行
  ipcMain.handle('test-selector', async (event, data) => {
    try {
      const selector = typeof data === 'string' ? data : data.selector;
      const expectedContent = typeof data === 'string' ? null : (data.expectedContent || null);
      const sourceWindowId = event.sender.id; // 记录请求来源窗口
      console.log('[Main] 收到测试选择器请求:', selector, expectedContent ? '（包含期望内容）' : '');

      // 生成唯一请求ID
      const requestId = `test-${Date.now()}-${++selectorTestSeq}`;

      // 创建 Promise 等待结果
      const resultPromise = new Promise((resolve, reject) => {
        // 10秒超时
        const timeout = setTimeout(() => {
          selectorTestCallbacks.delete(requestId);
          reject(new Error('测试超时'));
        }, 10000);

        selectorTestCallbacks.set(requestId, { resolve, reject, timeout, sourceWindowId });
      });

      if (mainWindow) {
        // 通知主智控台窗口执行测试，附带请求ID
        mainWindow.webContents.send('test-selector', {
          selector,
          expectedContent,
          requestId
        });
      }

      // 等待 renderer 返回结果
      return await resultPromise;
    } catch (error) {
      console.error('[Main] 测试选择器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 接收 renderer 返回的测试结果（使用 handle 而非 on，以响应 invoke 调用）
  ipcMain.handle('selector-test-result', (event, data) => {
    const { requestId, success, content, error } = data;
    const callback = selectorTestCallbacks.get(requestId);
    if (callback) {
      clearTimeout(callback.timeout);
      selectorTestCallbacks.delete(requestId);

      if (success) {
        callback.resolve({ success: true, content });
      } else {
        callback.resolve({ success: false, error });
      }
    }
    return { received: true };
  });

  // ========== DOM 树查看器相关 IPC ==========

  ipcMain.handle('open-dom-tree-viewer', async (event, data) => {
    try {
      console.log('[Main] 🟢 收到打开 DOM 树查看器请求');
      console.log('[Main]  数据是否存在:', !!data);
      if (data) {
        console.log('[Main] 🌳 树数据大小:', data.tree ? JSON.stringify(data.tree).length : 0, '字节');
        console.log('[Main] 🌐 URL:', data.url);
      }

      const viewer = createDomTreeViewWindow();
      console.log('[Main]  窗口创建/获取完成，isLoading:', viewer.webContents.isLoading());

      // 每次都要发送最新数据（不管窗口是否已存在）
      // 等待查看器窗口加载完成后发送数据
      if (viewer.webContents.isLoading()) {
        console.log('[Main] ⏳ 窗口加载中，等待 did-finish-load 事件');
        viewer.webContents.once('did-finish-load', () => {
          console.log('[Main] ✅ 窗口加载完成，发送数据');
          viewer.webContents.send('set-dom-tree-data', data);
        });
      } else {
        // 窗口已加载，直接发送新数据
        console.log('[Main] ✅ 窗口已加载，直接发送数据');
        viewer.webContents.send('set-dom-tree-data', data);
      }

      return { success: true, message: 'DOM 树查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] ❌ 打开 DOM 树查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('refresh-dom-tree', async (event) => {
    try {
      if (!mainWindow) {
        return { success: false, error: '主窗口未打开' };
      }

      // 通知主智控台窗口重新获取 DOM 树
      mainWindow.webContents.send('request-dom-tree-refresh');

      return { success: true, message: '已请求刷新 DOM 树' };
    } catch (error) {
      console.error('[Main] 刷新 DOM 树失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 监听渲染进程发来的 DOM 树刷新数据
  ipcMain.on('dom-tree-refresh-data', (event, data) => {
    console.log('[Main] 收到 dom-tree-refresh-data 数据');

    if (domTreeViewWindow) {
      domTreeViewWindow.webContents.send('set-dom-tree-data', data);
      console.log('[Main] 已转发数据到 DOM 树查看器');
    } else {
      console.log('[Main] DOM 树查看器窗口不存在');
    }
  });

  // ============================================================
  // 🔒 [已废弃] 'crawl-page' IPC Handler
  //    2026-06-12 起：服务卡片全部改为「Preview + 选择器抓取」模式，
  //    不再使用按 URL 直接扫整页 DOM 的方式。
  // ============================================================
  // ipcMain.handle('crawl-page', async (event, options) => {
  //   try {
  //     const targetUrl = typeof options === 'string' ? options : options.url;
  //     const customHeaders = typeof options === 'object' && options.headers ? options.headers : null;
  //
  //     return await crawlPageInternal(targetUrl, customHeaders);
  //   } catch (error) {
  //     console.error('[Main] 爬取失败:', error);
  //     throw error;
  //   }
  // });

  // 占位，防止语法错误（上面的函数已废弃）
  ipcMain.handle('crawl-page', async () => {
    throw new Error('[已废弃] crawl-page IPC 接口不再使用，请改用 preview-bookmark + capture-element-content 组合方式');
  });

  ipcMain.handle('save-data', async (event, data, filename) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存智控数据',
        defaultPath: filename || 'ai-console-data.json',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        fs.writeFileSync(result.filePath, content, 'utf8');
        console.log('[Main] 数据已保存:', result.filePath);
        return { success: true, path: result.filePath };
      }

      return { success: false, message: '用户取消保存' };
    } catch (error) {
      console.error('[Main] 保存失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-app-info', () => {
    const apiStatus = apiServerModule.getAPIServerStatus();
    return {
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      apiServerRunning: apiStatus.running,
      apiPort: apiStatus.port
    };
  });

  // 🆕 将 Base64 图片数据写入系统剪贴板（用于 Kimi 等平台的附件上传）
  ipcMain.handle('write-image-to-clipboard', async (event, base64Data, imageName) => {
    console.log('[Main] 📋 收到 write-image-to-clipboard 请求！');
    console.log('[Main] 图片名称:', imageName);

    try {
      // 解析 Base64 数据
      let imageData;
      if (base64Data.startsWith('data:')) {
        // 如果是 data URL，去掉前缀
        const base64String = base64Data.split(',')[1];
        imageData = nativeImage.createFromDataURL(base64Data);
      } else {
        // 纯 Base64 字符串
        imageData = nativeImage.createFromDataURL(`data:image/png;base64,${base64Data}`);
      }

      // 写入剪贴板
      clipboard.writeImage(imageData);

      console.log('[Main] ✅ 图片已成功写入系统剪贴板！');
      console.log('[Main]   尺寸:', imageData.getSize());

      return { success: true, message: '图片已写入剪贴板' };
    } catch (error) {
      console.error('[Main] ❌ 写入剪贴板失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-text-to-clipboard', async (event, text) => {
    console.log('[Main] 📋 收到 write-text-to-clipboard 请求！');
    console.log('[Main] 文本内容预览:', text.substring(0, 50) + '...');

    try {
      clipboard.writeText(text);
      console.log('[Main] ✅ 文本已成功写入系统剪贴板！');
      return { success: true, message: '文本已写入剪贴板' };
    } catch (error) {
      console.error('[Main] ❌ 写入剪贴板失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('activate-main-window', async () => {
    console.log('[Main] 🖥️ 收到 activate-main-window 请求！');

    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('[Main] ❌ 主窗口不存在');
        return { success: false, error: '主窗口不存在' };
      }

      mainWindow.show();
      mainWindow.focus();

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      console.log('[Main] ✅ 主窗口已激活！');
      return { success: true, message: '主窗口已激活' };
    } catch (error) {
      console.error('[Main] ❌ 激活主窗口失败:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { init, createWindow, getMainWindow: () => mainWindow };
