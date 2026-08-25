/**
 * 无限空间·AI智控台 - 预加载脚本
 * 
 * 功能：
 * 1. 在渲染进程和主进程之间搭建桥梁
 * 2. 暴露安全的 API 给渲染进程使用
 */

const { contextBridge, ipcRenderer, shell } = require('electron');

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 爬取网页
  crawlPage: (url) => ipcRenderer.invoke('crawl-page', url),
  
  // 保存数据
  saveData: (data, filename) => ipcRenderer.invoke('save-data', data, filename),
  
  // 获取应用信息
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // 启动 API 服务器
  startAPIServer: () => ipcRenderer.invoke('start-api-server'),
  
  // 停止 API 服务器
  stopAPIServer: () => ipcRenderer.invoke('stop-api-server'),
  
  // 获取 API 服务器状态
  getAPIStatus: () => ipcRenderer.invoke('get-api-status'),
  
  // 加载常用爬取网点
  loadBookmarks: () => ipcRenderer.invoke('load-bookmarks'),
  
  // 保存常用爬取网点
  saveBookmarks: (bookmarks) => ipcRenderer.invoke('save-bookmarks', bookmarks),

  // 加载卡片折叠状态
  loadCollapsedStates: () => ipcRenderer.invoke('load-collapsed-states'),

  // 保存卡片折叠状态
  saveCollapsedStates: (collapsedStates) => ipcRenderer.invoke('save-collapsed-states', collapsedStates),

  // 加载自定义 Headers Map
  loadHeadersMap: () => ipcRenderer.invoke('load-headers-map'),

  // 保存自定义 Headers Map
  saveHeadersMap: (headersMap) => ipcRenderer.invoke('save-headers-map', headersMap),

  // 打开网页预览新窗口
  openWebPreview: (url) => ipcRenderer.invoke('open-web-preview', url),
  
  // 打开外部浏览器窗口（解决千问等 SPA 兼容性问题）
  openExternalBrowser: (url) => ipcRenderer.invoke('openExternalBrowser', url),
  
  // 使用系统默认浏览器打开
  openExternal: (url) => shell.openExternal(url),
  
  // 打开元素查看器
  openElementViewer: (data) => ipcRenderer.invoke('open-element-viewer', data),
  
  // 打开邮件详情窗口
  openEmailDetail: (url) => ipcRenderer.invoke('open-email-detail', url),
  
  // 刷新元素查看器数据
  refreshElementViewer: () => ipcRenderer.invoke('refresh-element-viewer'),
  
  // 发送刷新数据到主进程
  sendElementRefreshData: (data) => ipcRenderer.send('element-refresh-data', data),
  
  // 监听主进程的刷新请求
  onElementRefreshRequest: (callback) => {
    ipcRenderer.on('request-element-refresh', () => callback());
  },
  
  // 监听测试选择器请求
  onTestSelector: (callback) => {
    ipcRenderer.on('test-selector', (event, selector) => callback(selector));
  },
  
  // 监听元素查看器数据更新
  onElementViewerUpdate: (callback) => {
    ipcRenderer.on('set-element-data', (event, data) => callback(data));
  },
  
  // 移除元素查看器监听
  removeElementViewerUpdateListener: (callback) => {
    ipcRenderer.removeListener('set-element-data', callback);
  },
  
  // 打开 AI 回复查看器
  openAiResponseViewer: (data) => ipcRenderer.invoke('open-ai-response-viewer', data),
  
  // 设置 AI 回复查看器加载状态
  setAiResponseLoading: (message) => ipcRenderer.invoke('set-ai-response-loading', message),
  
  // 设置 AI 回复查看器数据
  setAiResponseData: (data) => ipcRenderer.invoke('set-ai-response-data', data),
  
  // 设置 AI 回复查看器错误
  setAiResponseError: (errorMessage) => ipcRenderer.invoke('set-ai-response-error', errorMessage),
  
  // 设置 AI 回复查看器选择器
  setAiResponseSelector: (selector) => ipcRenderer.invoke('set-ai-response-selector', selector),
  
  // 发送任意 IPC 消息到主进程（用于附件上传等）
  send: (channel, data) => {
    const validChannels = ['set-pending-attachment', 'element-refresh-data', 'email-response'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // 🆕 向宿主页面发送消息（webview 内使用，触发宿主 webview 元素的 ipc-message 事件）
  sendToHost: (channel, data) => {
    ipcRenderer.sendToHost(channel, data);
  },

  // 🆕 将 Base64 图片数据写入系统剪贴板（用于 Kimi 等平台）
  writeImageToClipboard: (base64Data, imageName) => ipcRenderer.invoke('write-image-to-clipboard', base64Data, imageName),
  
  // 🆕 将文本写入系统剪贴板（用于桌面APP脚本执行前准备消息）
  writeTextToClipboard: (text) => ipcRenderer.invoke('write-text-to-clipboard', text),
  
  // 🆕 激活主窗口（脚本执行完毕后回到主程式画面）
  activateMainWindow: () => ipcRenderer.invoke('activate-main-window'),
  
  // 通用 invoke 方法
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  },
  
  // 打开 DOM 树查看器
  openDomTreeView: (data) => ipcRenderer.invoke('open-dom-tree-viewer', data),
  
  // 刷新 DOM 树
  refreshDomTree: () => ipcRenderer.invoke('refresh-dom-tree'),
  
  // 发送 DOM 树刷新数据
  sendDomTreeRefreshData: (data) => ipcRenderer.send('dom-tree-refresh-data', data),
  
  // 监听 DOM 树刷新请求
  onDomTreeRefreshRequest: (callback) => {
    ipcRenderer.on('request-dom-tree-refresh', () => callback());
  },
  
  // 监听事件
  onCrawlComplete: (callback) => {
    ipcRenderer.on('crawl-complete', (event, data) => callback(data));
  },
  
  // 移除事件监听
  removeCrawlCompleteListener: (callback) => {
    ipcRenderer.removeListener('crawl-complete', callback);
  },

  // 🆕 v1.0.0-45: 通知主进程记录当前服务卡片（用于"识别后台服务"功能）
  setCurrentServiceCard: (index) => ipcRenderer.invoke('set-current-service-card', index),

  // 🆕 监听全局快捷键触发的浮动视窗切换（卡片页签）
  onToggleFloatingWindow: (callback) => {
    ipcRenderer.on('toggle-floating-window', () => callback());
  },

  // 🆕 监听全局快捷键触发的浮动视窗切换（通用页签）
  onToggleFloatingWindowGeneral: (callback) => {
    ipcRenderer.on('toggle-floating-window-general', () => callback());
  },

  // 🆕 移除浮动视窗切换监听
  removeToggleFloatingWindowListener: (callback) => {
    ipcRenderer.removeListener('toggle-floating-window', callback);
  },

  // ========== 排程设定相关 API ==========
  loadSchedules: () => ipcRenderer.invoke('load-schedules'),
  saveSchedules: (schedules) => ipcRenderer.invoke('save-schedules', schedules),
  loadSchedulerLogs: () => ipcRenderer.invoke('load-scheduler-logs'),
  saveSchedulerLogs: (logs) => ipcRenderer.invoke('save-scheduler-logs', logs),

  // ========== 桌面APP自动化相关 API ==========
  desktopAppSendMessage: (data) => ipcRenderer.invoke('desktop-app-send-message', data),
  desktopAppActivate: (appName) => ipcRenderer.invoke('desktop-app-activate', appName),
  desktopAppMoveToCopyBtn: (data) => ipcRenderer.invoke('desktop-app-move-copy-btn', data),
  desktopAppCaptureTemplate: (data) => ipcRenderer.invoke('desktop-app-capture-template-v2', data),
  desktopAppFindTemplate: (data) => ipcRenderer.invoke('desktop-app-find-template', data),
  desktopAppCopyMarkdownByImage: (data) => ipcRenderer.invoke('desktop-app-copy-markdown-by-image', data),
  desktopAppCheckExists: (appName) => ipcRenderer.invoke('desktop-app-check-exists', appName),
  desktopAppGetUIElements: (appName) => ipcRenderer.invoke('desktop-app-get-ui-elements', appName),
  desktopAppRecordAnchor: (data) => ipcRenderer.invoke('desktop-app-record-anchor', data),
  desktopAppReplayAnchor: (data) => ipcRenderer.invoke('desktop-app-replay-anchor', data),
  desktopAppGetWindowInfo: (appName) => ipcRenderer.invoke('desktop-app-get-window-info', appName),
  desktopAppSetWindowInfo: (data) => ipcRenderer.invoke('desktop-app-set-window-info', data),
  desktopAppRunScript: (data) => ipcRenderer.invoke('run-automation-script', data),
  // 🆕 区域截图与可视化框选
  desktopAppCaptureRegion: (data) => ipcRenderer.invoke('desktop-app-capture-region', data),
  desktopAppSelectRegion: (data) => ipcRenderer.invoke('desktop-app-select-region', data),
  desktopAppPreviewCaptureRegion: (data) => ipcRenderer.invoke('desktop-app-preview-capture-region', data),
  resolveSelectRegion: (result) => ipcRenderer.send('desktop-app-select-region-result', result),
  minimizeMainWindow: () => ipcRenderer.invoke('minimize-main-window'),
  restoreMainWindow: () => ipcRenderer.invoke('restore-main-window'),
  // 🆕 脚本数据独立存储
  loadScriptsData: () => ipcRenderer.invoke('load-scripts-data'),
  saveScriptsData: (data) => ipcRenderer.invoke('save-scripts-data', data),
 // 打开文件对话框
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  previewFile: (filePath) => ipcRenderer.invoke('preview-file', filePath),
  
  // 插件数据存储（JSON 文件）
  loadPluginData: (pluginName) => ipcRenderer.invoke('load-plugin-data', pluginName),
  savePluginData: (pluginName, data) => ipcRenderer.invoke('save-plugin-data', pluginName, data),

  // ToDo 卡片独立文件存储
  loadTodos: () => ipcRenderer.invoke('load-todos'),
  saveTodos: (todos) => ipcRenderer.invoke('save-todos', todos),
  deleteTodoFile: (todoId) => ipcRenderer.invoke('delete-todo-file', todoId),
  archiveTodo: (todoId) => ipcRenderer.invoke('archive-todo', todoId),
  getArchivedCount: () => ipcRenderer.invoke('get-archived-count'),
  renameTodoFile: (oldId, newId) => ipcRenderer.invoke('rename-todo-file', oldId, newId),
  // 📋 列出 todos 资料目录下所有 todo-{id}.json 的文件元数据（前端「文件列表」下拉）
  listTodoFiles: () => ipcRenderer.invoke('list-todo-files'),

  // 读取股票配置（HTTP Get 智能识别用）
  readStockConfig: () => ipcRenderer.invoke('read-stock-config'),

  // HTTP GET API 调用
  apiCall: (config) => ipcRenderer.invoke('api-call', config)
});

console.log('[Preload] 预加载脚本已加载');
