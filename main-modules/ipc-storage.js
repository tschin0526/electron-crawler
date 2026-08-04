/**
 * 存储与文件 IPC 模组
 * 从 main.js 拆分而来
 * 包含：书签存储、插件数据、排程数据、折叠状态、文件对话框、网页预览窗口等
 */
const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const iconv = require('iconv-lite');

let BOOKMARKS_FILE;
let COLLAPSED_STATES_FILE;
let HEADERS_MAP_FILE;
let PLUGINS_DATA_DIR;
let getMainWindow;
let setCurrentServiceCard;

// 用于 API 服务器加载网点数据
function loadBookmarksForAPI() {
  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      const data = fs.readFileSync(BOOKMARKS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('[Main] API 加载网点失败:', error);
    return [];
  }
}

// 根据索引获取单个网点
function getBookmarkByIndex(index) {
  const bookmarks = loadBookmarksForAPI();
  if (index >= 0 && index < bookmarks.length) {
    return bookmarks[index];
  }
  return null;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 🆕 启动时迁移：把 bookmarks.json 中的 scripts 提取到 data/scripts.json
function migrateScriptsFromBookmarks() {
  try {
    if (!fs.existsSync(BOOKMARKS_FILE)) return;

    const scriptsFile = path.join(PLUGINS_DATA_DIR, 'scripts.json');
    if (fs.existsSync(scriptsFile)) {
      console.log('[Main] scripts.json 已存在，跳过迁移');
      return;
    }

    const data = fs.readFileSync(BOOKMARKS_FILE, 'utf8');
    const bookmarks = JSON.parse(data);
    if (!Array.isArray(bookmarks) || bookmarks.length === 0) return;

    const scriptsData = {};
    let migratedCount = 0;

    bookmarks.forEach(bm => {
      if (bm && Array.isArray(bm.scripts) && bm.scripts.length > 0) {
        const key = bm.name || `card_${bookmarks.indexOf(bm)}`;
        scriptsData[key] = bm.scripts;
        migratedCount += bm.scripts.length;
        console.log(`[Main] 迁移脚本数据: ${key} -> ${bm.scripts.length} 个脚本`);
      }
    });

    if (migratedCount > 0) {
      if (!fs.existsSync(PLUGINS_DATA_DIR)) {
        fs.mkdirSync(PLUGINS_DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(scriptsFile, JSON.stringify(scriptsData, null, 2), 'utf8');
      console.log(`[Main] ✅ 脚本数据迁移完成: ${migratedCount} 个脚本已保存到 ${scriptsFile}`);

      // 从 bookmarks.json 中移除 scripts 字段
      const sanitizedBookmarks = bookmarks.map(bm => {
        if (bm && typeof bm === 'object') {
          const { scripts, ...rest } = bm;
          return rest;
        }
        return bm;
      });
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(sanitizedBookmarks, null, 2), 'utf8');
      console.log('[Main] ✅ 已从 bookmarks.json 中移除 scripts 字段');
    } else {
      console.log('[Main] 无需迁移脚本数据');
    }
  } catch (error) {
    console.error('[Main] 脚本数据迁移失败:', error);
  }
}

function init(shared) {
  // shared.BOOKMARKS_FILE 等数据文件路径由本模组依据 userData 自行计算
  BOOKMARKS_FILE = path.join(app.getPath('userData'), 'bookmarks.json');
  COLLAPSED_STATES_FILE = path.join(app.getPath('userData'), 'collapsed-states.json');
  HEADERS_MAP_FILE = path.join(app.getPath('userData'), 'headers-map.json');
  PLUGINS_DATA_DIR = shared.PLUGINS_DATA_DIR;
  getMainWindow = shared.getMainWindow;
  setCurrentServiceCard = shared.setCurrentServiceCard;

  // ========== 常用爬取网点数据持久化 ==========
  ipcMain.handle('load-bookmarks', () => {
    try {
      if (fs.existsSync(BOOKMARKS_FILE)) {
        const data = fs.readFileSync(BOOKMARKS_FILE, 'utf8');
        const bookmarks = JSON.parse(data);
        // 🆕 脚本数据已迁移到 scripts.json，加载网点时清除 scripts 字段避免内存冲突
        if (Array.isArray(bookmarks)) {
          bookmarks.forEach(bm => {
            if (bm && typeof bm === 'object') {
              delete bm.scripts;
            }
          });
        }
        return bookmarks;
      }
      return [];
    } catch (error) {
      console.error('[Main] 加载网点失败:', error);
      return [];
    }
  });

  ipcMain.handle('save-bookmarks', async (event, bookmarks) => {
    try {
      const dir = path.dirname(BOOKMARKS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 🆕 脚本数据独立存储，保存网点时过滤掉 scripts 字段
      const sanitizedBookmarks = Array.isArray(bookmarks)
        ? bookmarks.map(bm => {
            if (bm && typeof bm === 'object') {
              const { scripts, ...rest } = bm;
              return rest;
            }
            return bm;
          })
        : bookmarks;
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(sanitizedBookmarks, null, 2), 'utf8');
      console.log('[Main] 网点已保存:', BOOKMARKS_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存网点失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 启动时自动迁移：将 bookmarks.json 中的 scripts 提取到 data/scripts.json
  migrateScriptsFromBookmarks();

  // ========== 插件数据存储（JSON 文件） ==========
  // 开发模式：项目目录/data/
  // 打包模式：应用包同级目录/data/（方便用户访问）
  ipcMain.handle('load-plugin-data', async (event, pluginName) => {
    try {
      const dataFile = path.join(PLUGINS_DATA_DIR, `${pluginName}.json`);

      if (!fs.existsSync(dataFile)) {
        console.log(`[Main] 插件数据文件不存在，返回空数据: ${dataFile}`);
        return { success: true, data: [] };
      }

      const data = fs.readFileSync(dataFile, 'utf8');
      const parsed = JSON.parse(data);
      console.log(`[Main] 插件数据加载成功: ${pluginName} (${Array.isArray(parsed) ? parsed.length : 'object'} 条记录)`);
      return { success: true, data: parsed };
    } catch (error) {
      console.error(`[Main] 加载插件数据失败 (${pluginName}):`, error);
      return { success: true, data: [] };
    }
  });

  ipcMain.handle('save-plugin-data', async (event, pluginName, data) => {
    try {
      if (!fs.existsSync(PLUGINS_DATA_DIR)) {
        fs.mkdirSync(PLUGINS_DATA_DIR, { recursive: true });
      }

      const dataFile = path.join(PLUGINS_DATA_DIR, `${pluginName}.json`);
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[Main] 插件数据已保存: ${dataFile}`);
      return { success: true };
    } catch (error) {
      console.error(`[Main] 保存插件数据失败 (${pluginName}):`, error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 脚本数据持久化（独立于 bookmarks.json，避免互相影响）
  const SCRIPTS_FILE = path.join(PLUGINS_DATA_DIR, 'scripts.json');

  ipcMain.handle('load-scripts-data', () => {
    try {
      if (fs.existsSync(SCRIPTS_FILE)) {
        const data = fs.readFileSync(SCRIPTS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        console.log('[Main] 脚本数据加载成功:', SCRIPTS_FILE);
        return { success: true, data: parsed };
      }
      return { success: true, data: {} };
    } catch (error) {
      console.error('[Main] 加载脚本数据失败:', error);
      return { success: false, error: error.message, data: {} };
    }
  });

  ipcMain.handle('save-scripts-data', async (event, data) => {
    try {
      if (!fs.existsSync(PLUGINS_DATA_DIR)) {
        fs.mkdirSync(PLUGINS_DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(data, null, 2), 'utf8');
      console.log('[Main] 脚本数据已保存:', SCRIPTS_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存脚本数据失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 股票配置读取（HTTP Get 智能识别用） ==========
  ipcMain.handle('read-stock-config', async () => {
    try {
      // 优先读取 userData 下的用户自定义配置，其次读取项目内置配置
      const userConfigFile = path.join(app.getPath('userData'), 'stock-config.json');
      const builtinConfigFile = path.join(__dirname, '..', 'src', 'data', 'stock-config.json');

      const configFile = fs.existsSync(userConfigFile) ? userConfigFile : builtinConfigFile;
      if (!fs.existsSync(configFile)) {
        console.log('[Main] 股票配置文件不存在:', configFile);
        return { success: true, data: { stocks: [] } };
      }

      const data = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(data);
      console.log(`[Main] 股票配置加载成功: ${configFile} (${parsed.stocks ? parsed.stocks.length : 0} 只股票)`);
      return { success: true, data: parsed };
    } catch (error) {
      console.error('[Main] 读取股票配置失败:', error);
      return { success: false, error: error.message, data: { stocks: [] } };
    }
  });

  //  v1.0.0-45: 新增 IPC 接口，让前端直接通知主进程记录当前服务卡片
  ipcMain.handle('set-current-service-card', async (event, index) => {
    try {
      const bookmarksAll = loadBookmarksForAPI();
      if (index >= 0 && index < bookmarksAll.length) {
        const bookmark = bookmarksAll[index];
        const name = bookmark.name || 'Unknown';
        setCurrentServiceCard(index, name);
        console.log('[Main] ✅ 已记录当前服务卡片: [' + index + '] ' + name);
        return { success: true, index: index, name: name };
      }
      return { success: false, error: '索引无效: ' + index };
    } catch (e) {
      console.error('[Main] 记录服务卡片失败:', e);
      return { success: false, error: e.message };
    }
  });

  // ========== 自定义 Headers 持久化 ==========
  ipcMain.handle('load-headers-map', () => {
    try {
      if (fs.existsSync(HEADERS_MAP_FILE)) {
        const data = fs.readFileSync(HEADERS_MAP_FILE, 'utf8');
        console.log('[Main] 已加载 Headers Map:', HEADERS_MAP_FILE);
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      console.error('[Main] 加载 Headers Map 失败:', error);
      return {};
    }
  });

  ipcMain.handle('save-headers-map', async (event, headersMap) => {
    try {
      const dir = path.dirname(HEADERS_MAP_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(HEADERS_MAP_FILE, JSON.stringify(headersMap, null, 2), 'utf8');
      console.log('[Main] Headers Map 已保存:', HEADERS_MAP_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存 Headers Map 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 外部浏览器（使用系统默认浏览器打开，绕过千问等 SPA 检测） ==========
  ipcMain.handle('openExternalBrowser', async (event, url) => {
    try {
      console.log('[Main] 🔓 使用系统默认浏览器打开:', url);

      await shell.openExternal(url);

      console.log('[Main] ✅ 已在系统默认浏览器中打开');
      return { success: true, message: '已在系统默认浏览器中打开' };

    } catch (error) {
      console.error('[Main]  打开浏览器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 网页预览新窗口 ==========
  ipcMain.handle('open-web-preview', async (event, url) => {
    try {
      console.log('[Main] 打开网页预览窗口:', url);

      // 创建新窗口（使用 frameless + 自定义标题栏）
      const previewWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: `网页预览`,
        frame: false,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          disableBlinkFeatures: 'SameSiteByDefaultCookies,CookieWithoutSameSite',
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: true,
        },
      });

      // 创建一个简单的 HTML 页面，包含地址栏和 webview
      const toolbarHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          #toolbar {
            height: 42px;
            background: #1e293b;
            display: flex;
            align-items: center;
            padding: 0 12px;
            gap: 10px;
            -webkit-app-region: drag;
            border-bottom: 1px solid #334155;
          }
          #toolbar .window-controls {
            display: flex;
            gap: 6px;
            -webkit-app-region: no-drag;
          }
          #toolbar .window-controls button {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
          }
          #toolbar .window-controls .close { background: #ef4444; }
          #toolbar .window-controls .minimize { background: #eab308; }
          #toolbar .window-controls .maximize { background: #22c55e; }
          #toolbar .url-bar {
            flex: 1;
            background: #334155;
            color: #e2e8f0;
            border: none;
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 13px;
            outline: none;
            -webkit-app-region: no-drag;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          #toolbar .url-bar:focus {
            background: #475569;
            color: #fff;
          }
          #content-area {
            height: calc(100% - 42px);
            width: 100%;
            border: none;
          }
        </style>
      </head>
      <body>
        <div id="toolbar">
          <div class="window-controls">
            <button class="close" onclick="window.close()"></button>
            <button class="minimize" onclick="ipcRenderer.send('minimize-window')"></button>
            <button class="maximize" onclick="ipcRenderer.send('maximize-window')"></button>
          </div>
          <input type="text" class="url-bar" id="url-bar" value="${url}" readonly>
        </div>
        <webview
          id="content-area"
          src="${url}"
          allowpopups
          enableblinkfeatures=AutomationControlled
          disablewebsecurity
          allowrunninginsecurecontent
          style="height:calc(100% - 42px);width:100%;"
        ></webview>
        <script>
          const { ipcRenderer } = require('electron');
          const webview = document.getElementById('content-area');
          const urlBar = document.getElementById('url-bar');

          // 防止 SPA 导航问题：监听并处理页面内导航
          let lastValidUrl = url;

          webview.addEventListener('did-navigate', (e) => {
            console.log('[Preview] did-navigate:', e.url);
            urlBar.value = e.url;
            if (e.url && e.url !== 'about:blank') {
              lastValidUrl = e.url;
            }
          });

          webview.addEventListener('did-navigate-in-page', (e) => {
            console.log('[Preview] did-navigate-in-page:', e.url);
            urlBar.value = e.url;
            if (e.url && e.url !== 'about:blank') {
              lastValidUrl = e.url;
            }
          });

          // 处理加载失败，恢复到上一个有效 URL
          webview.addEventListener('did-fail-load', (e) => {
            console.error('[Preview] did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL);
            // 如果是 SPA 导航导致的失败，尝试恢复
            if (lastValidUrl && lastValidUrl !== e.validatedURL) {
              console.log('[Preview] 尝试恢复到:', lastValidUrl);
              // 不自动恢复，让用户手动刷新
            }
          });

          // 页面标题更新
          webview.addEventListener('page-title-updated', (e) => {
            if (e.title) {
              document.title = e.title;
            }
          });

          webview.addEventListener('page-favicon-updated', (e) => {
            // Update window title with favicon if available
          });
        </script>
      </body>
      </html>
    `;

      // 加载工具栏页面
      previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHTML)}`);

      // 🆕 拦截 webview 的文件选择对话框，实现自动上传附件
      let pendingAttachment = null;
      let attachmentFilePath = null;

      // 🔧 全局函数：为指定的 webContents 设置文件选择拦截器
      function setupFileSelectorInterceptor(webContents) {
        if (!webContents) return;
        console.log('[Main] 📎 为 webContents 设置文件选择拦截器, ID:', webContents.id);

        // 移除旧的监听器（避免重复）
        webContents.removeAllListeners('select-file');

        // 监听 select-file 事件
        webContents.on('select-file', (event, filePaths, defaultPath, callback) => {
          console.log('[Main] ══════════════════════════════════════');
          console.log('[Main] 🎯🎯🎯 select-file 事件触发了！！！');
          console.log('[Main] 默认路径:', defaultPath);
          console.log('[Main] 待上传的附件:', pendingAttachment?.name);
          console.log('[Main] 附件文件路径:', attachmentFilePath);
          console.log('[Main] 文件是否存在:', fs.existsSync(attachmentFilePath || ''));
          console.log('[Main] ══════════════════════════════════════');

          if (pendingAttachment && attachmentFilePath && fs.existsSync(attachmentFilePath)) {
            console.log('[Main] ✅✅✅ 提供临时附件文件给 webview:', attachmentFilePath);
            event.preventDefault();
            callback([attachmentFilePath]);
            console.log('[Main] ✅✅✅ 已通过 callback 返回文件路径');
            return;
          }

          console.log('[Main] ⚠️ 没有待上传的附件，返回空数组');
          callback([]);
        });

        console.log('[Main] ✅ 文件选择拦截器已设置完成');
      }

      // 监听来自 renderer 进程的附件数据（全局监听，不依赖窗口状态）
      ipcMain.on('set-pending-attachment', async (event, attachmentData) => {
        console.log('[Main] 📨 收到 set-pending-attachment 事件！');
        console.log('[Main] 附件名称:', attachmentData?.name);
        console.log('[Main] 附件大小:', attachmentData?.size, 'bytes');
        pendingAttachment = attachmentData;

        // 将 Base64 数据写入临时文件
        if (attachmentData && attachmentData.data) {
          try {
            const tempDir = app.getPath('temp');
            attachmentFilePath = path.join(tempDir, 'ai-console-attachment-' + Date.now() + path.extname(attachmentData.name));

            // 解析 Base64 数据（去掉 data URL 前缀）
            const base64Data = attachmentData.data.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(attachmentFilePath, buffer);

            console.log('[Main] 附件已写入临时文件:', attachmentFilePath);
          } catch (e) {
            console.error('[Main] 写入临时文件失败:', e);
            attachmentFilePath = null;
          }
        }
      });

      // 监听 webview 附加事件，设置文件选择拦截器
      previewWindow.webContents.on('did-attach-webview', (event, webContents) => {
        console.log('[Main] 🌐 webview 已附加 (did-attach-webview)');
        console.log('[Main] webContents ID:', webContents.id);

        // 使用全局函数设置拦截器
        setupFileSelectorInterceptor(webContents);
      });

      // 监听窗口关闭时清理
      previewWindow.on('closed', () => {
        pendingAttachment = null;
        // 清理临时文件
        if (attachmentFilePath && fs.existsSync(attachmentFilePath)) {
          try {
            fs.unlinkSync(attachmentFilePath);
            console.log('[Main] 已清理临时附件文件');
          } catch (e) {}
        }
        attachmentFilePath = null;
      });

      // 窗口控制
      previewWindow.webContents.on('ipc-message', (event, channel) => {
        if (channel === 'minimize-window') {
          previewWindow.minimize();
        } else if (channel === 'maximize-window') {
          if (previewWindow.isMaximized()) {
            previewWindow.unmaximize();
          } else {
            previewWindow.maximize();
          }
        }
      });

      return { success: true };
    } catch (error) {
      console.error('[Main] 打开网页预览窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 卡片折叠状态持久化 ==========
  ipcMain.handle('load-collapsed-states', () => {
    try {
      if (fs.existsSync(COLLAPSED_STATES_FILE)) {
        const data = fs.readFileSync(COLLAPSED_STATES_FILE, 'utf8');
        console.log('[Main] 已加载折叠状态文件:', COLLAPSED_STATES_FILE);
        return JSON.parse(data);
      }
      console.log('[Main] 折叠状态文件不存在，返回空对象');
      return {};
    } catch (error) {
      console.error('[Main] 加载折叠状态失败:', error);
      return {};
    }
  });

  ipcMain.handle('save-collapsed-states', async (event, collapsedStates) => {
    try {
      const dir = path.dirname(COLLAPSED_STATES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(COLLAPSED_STATES_FILE, JSON.stringify(collapsedStates, null, 2), 'utf8');
      console.log('[Main] 折叠状态已保存:', COLLAPSED_STATES_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存折叠状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-file-dialog', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), options);
      return result;
    } catch (error) {
      console.error('[Main] 打开文件对话框失败:', error);
      return { canceled: true, filePaths: [] };
    }
  });

  ipcMain.handle('preview-file', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      console.error('[Main] 预览文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== HTTP GET API 调用 ==========
  ipcMain.handle('api-call', async (event, config) => {
    try {
      const { url, method = 'GET', headers = {}, body } = config;
      console.log('[Main] API 调用:', method, url);

      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const transport = isHttps ? https : http;

      // 检测是否为 GBK 编码的 API（腾讯/新浪股票行情）
      const isGbkUrl = /sinajs\.cn|qt\.gtimg\.cn|hq\.sinajs/i.test(url);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: headers
      };

      return new Promise((resolve, reject) => {
        const req = transport.request(options, (res) => {
          // GBK 编码的 API 收集 Buffer，否则收集字符串
          const chunks = [];
          res.on('data', chunk => { chunks.push(chunk); });
          res.on('end', () => {
            console.log('[Main] API 调用成功:', res.statusCode);
            const buffer = Buffer.concat(chunks);
            let data;

            if (isGbkUrl) {
              // 使用 iconv-lite 进行 GBK 解码
              try {
                data = iconv.decode(buffer, 'gbk');
                if (/[\u4e00-\u9fa5]/.test(data)) {
                  console.log('[Main] GBK 解码成功');
                } else {
                  data = buffer.toString('utf-8');
                }
              } catch (e) {
                data = buffer.toString('utf-8');
              }
            } else {
              data = buffer.toString('utf-8');
            }

            resolve({
              success: true,
              statusCode: res.statusCode,
              headers: res.headers,
              data: data
            });
          });
        });

        req.on('error', (error) => {
          console.error('[Main] API 调用失败:', error.message);
          resolve({ success: false, error: error.message });
        });

        req.setTimeout(30000, () => {
          req.destroy();
          resolve({ success: false, error: '请求超时（30秒）' });
        });

        if (body) {
          req.write(body);
        }
        req.end();
      });
    } catch (error) {
      console.error('[Main] API 调用异常:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 文件预览（打开系统默认程序） ==========
  ipcMain.handle('open-file', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }

      const stat = fs.statSync(filePath);
      const info = {
        exists: true,
        size: stat.size,
        sizeFormatted: formatFileSize(stat.size),
        isDirectory: stat.isDirectory(),
        mtime: stat.mtime.toLocaleString()
      };

      const { execFileSync } = require('child_process');
      execFileSync('open', [filePath]);

      return { success: true, info };
    } catch (error) {
      console.error('[Main] 文件预览失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ========== 排程数据持久化 ==========
  ipcMain.handle('load-schedules', () => {
    try {
      const SCHEDULES_FILE = path.join(PLUGINS_DATA_DIR, 'schedules.json');
      const OLD_SCHEDULES_FILE = path.join(app.getPath('userData'), 'schedules.json');

      let schedules = [];

      if (fs.existsSync(SCHEDULES_FILE)) {
        const data = fs.readFileSync(SCHEDULES_FILE, 'utf8');
        schedules = JSON.parse(data);
        console.log('[Main] 已加载排程文件:', SCHEDULES_FILE, '共', schedules.length, '条');
      }

      if (fs.existsSync(OLD_SCHEDULES_FILE)) {
        const oldData = fs.readFileSync(OLD_SCHEDULES_FILE, 'utf8');
        const oldSchedules = JSON.parse(oldData);

        if (oldSchedules.length > 0) {
          const newScheduleIds = new Set(schedules.map(s => s.id));
          const missingSchedules = oldSchedules.filter(s => !newScheduleIds.has(s.id));

          if (missingSchedules.length > 0) {
            schedules = [...missingSchedules, ...schedules];

            if (!fs.existsSync(PLUGINS_DATA_DIR)) {
              fs.mkdirSync(PLUGINS_DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf8');
            console.log('[Main] 已从旧路径迁移', missingSchedules.length, '条排程到:', SCHEDULES_FILE);
          }
        }
      }

      console.log('[Main] 排程数据加载完成，共', schedules.length, '条');
      return schedules;
    } catch (error) {
      console.error('[Main] 加载排程失败:', error);
      return [];
    }
  });

  ipcMain.handle('save-schedules', async (event, schedules) => {
    try {
      const SCHEDULES_FILE = path.join(PLUGINS_DATA_DIR, 'schedules.json');
      const dir = path.dirname(SCHEDULES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf8');
      console.log('[Main] 排程已保存:', SCHEDULES_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存排程失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('load-scheduler-logs', () => {
    try {
      const SCHEDULER_LOGS_FILE = path.join(PLUGINS_DATA_DIR, 'scheduler-logs.json');
      const OLD_SCHEDULER_LOGS_FILE = path.join(app.getPath('userData'), 'scheduler-logs.json');

      let logs = [];

      if (fs.existsSync(SCHEDULER_LOGS_FILE)) {
        const data = fs.readFileSync(SCHEDULER_LOGS_FILE, 'utf8');
        logs = JSON.parse(data);
        console.log('[Main] 已加载排程日志文件:', SCHEDULER_LOGS_FILE, '共', logs.length, '条');
      }

      if (fs.existsSync(OLD_SCHEDULER_LOGS_FILE)) {
        const oldData = fs.readFileSync(OLD_SCHEDULER_LOGS_FILE, 'utf8');
        const oldLogs = JSON.parse(oldData);

        if (oldLogs.length > 0) {
          const newLogIds = new Set(logs.map(l => l.id));
          const missingLogs = oldLogs.filter(l => !newLogIds.has(l.id));

          if (missingLogs.length > 0) {
            logs = [...logs, ...missingLogs];
            logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            if (!fs.existsSync(PLUGINS_DATA_DIR)) {
              fs.mkdirSync(PLUGINS_DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(SCHEDULER_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
            console.log('[Main] 已从旧路径迁移', missingLogs.length, '条日志到:', SCHEDULER_LOGS_FILE);
          }
        }
      }

      console.log('[Main] 排程日志加载完成，共', logs.length, '条');
      return logs;
    } catch (error) {
      console.error('[Main] 加载排程日志失败:', error);
      return [];
    }
  });

  ipcMain.handle('save-scheduler-logs', async (event, logs) => {
    try {
      const SCHEDULER_LOGS_FILE = path.join(PLUGINS_DATA_DIR, 'scheduler-logs.json');
      const dir = path.dirname(SCHEDULER_LOGS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(SCHEDULER_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
      console.log('[Main] 排程日志已保存:', SCHEDULER_LOGS_FILE);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存排程日志失败:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { init, loadBookmarksForAPI, getBookmarkByIndex, formatFileSize };
