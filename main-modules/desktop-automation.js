/**
 * 桌面自动化与 Webview 消息注入模组
 * 从 main.js 拆分而来
 * 包含：桌面APP自动化（AppleScript/JXA）、webview 消息注入、内容抓取
 */
const { ipcMain, app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let getMainWindow;
let APP_VERSION;
let loadBookmarksForAPI;
let lastUsedServiceCard;

async function findAppBundleName(appName) {
  const { execSync } = require('child_process');
  
  try {
    // 先用 mdfind 搜索匹配的应用
    const result = execSync(`mdfind 'kMDItemKind == "Application" && (kMDItemDisplayName == "${appName}" || kMDItemFSName == "*${appName}*")'`, { timeout: 5000 });
    const paths = result.toString().trim().split('\n').filter(p => p);
    
    if (paths.length > 0) {
      const appPath = paths[0];
      const bundleName = appPath.split('/').pop().replace('.app', '');
      console.log(`[Main]    通过 mdfind 找到应用: ${bundleName} (${appPath})`);
      return bundleName;
    }
  } catch (e) {
    console.log('[Main]    mdfind 未找到匹配应用');
  }
  
  // 尝试直接检查 /Applications/ 目录
  try {
    const result = execSync(`ls /Applications/ | grep -i "${appName.replace(/"/g, '\\"')}"`, { timeout: 3000 });
    const bundles = result.toString().trim().split('\n').filter(p => p.endsWith('.app'));
    
    if (bundles.length > 0) {
      const bundleName = bundles[0].replace('.app', '');
      console.log(`[Main]    在 /Applications/ 找到应用: ${bundleName}`);
      return bundleName;
    }
  } catch (e) {
    console.log('[Main]    /Applications/ 未找到匹配应用');
  }
  
  // 尝试用户输入的名称
  try {
    execSync(`open -a "${appName}"`, { timeout: 3000 });
    console.log('[Main]    用户输入的名称可用');
    return appName;
  } catch (e) {
    console.log('[Main]    用户输入的名称不可用');
  }
  
  return null;
}

async function previewBookmarkByIndex(index, customMessage, params, attachment = null) {
  const mainWindow = getMainWindow();
  // 🆕 v1.0.0-37: 记录当前使用的服务卡片（用于"识别后台服务"功能）
  try {
    const bookmarksAll = loadBookmarksForAPI();
    const currentBookmark = bookmarksAll[index];
    if (currentBookmark) {
      lastUsedServiceCard.index = index;
      lastUsedServiceCard.name = currentBookmark.name || 'Unknown';
      lastUsedServiceCard.time = new Date().toISOString();
      console.log('[Main] 📍 已更新当前服务卡片: [' + index + '] ' + lastUsedServiceCard.name);
    }
  } catch (e) {
    console.warn('[Main] ⚠️ 记录服务卡片失败:', e.message);
  }

  // 🔧 【关键修复】同时从两个地方读取字段
  //   1. params：前端直接传的（来自 payload.replySelector / .heartbeatSelector / .monitorTimeout）
  //   2. bookmarks.json：磁盘文件中的（作为兜底）
  const bookmarksAll = loadBookmarksForAPI();
  const bookmark = bookmarksAll[index] || {};

  // 🔍 【关键调试】把两个来源的字段都打印到主进程控制台
  console.log('[Main] [API] 📋 === preview-bookmark 调试信息 ===');
  console.log('[Main] [API] params (from frontend):', JSON.stringify(params || {}).substring(0, 300));
  console.log('[Main] [API] bookmark (from disk, index=' + index + '):', JSON.stringify(bookmark).substring(0, 500));
  console.log('[Main] [API] bookmarks.json 总条数:', bookmarksAll.length);

  // 🔧 【核心修复】优先使用 params（前端直接传的），其次从 bookmark 读
  const _replySelector = (params && params.replySelector) || bookmark.replySelector || bookmark.reply_selector || '';
  const _heartbeatSelector = (params && params.heartbeatSelector) || bookmark.heartbeatSelector || bookmark.heartbeat_selector || '';
  const _monitorTimeout = (params && params.monitorTimeout) || bookmark.monitorTimeout || bookmark.monitor_timeout || 0;

  console.log('[Main] [API] ✅ 最终使用 - replySelector:', _replySelector);
  console.log('[Main] [API] ✅ 最终使用 - heartbeatSelector:', _heartbeatSelector || '(无)');
  console.log('[Main] [API] ✅ 最终使用 - monitorTimeout:', _monitorTimeout, 'ms');
  console.log('[Main] [API] 卡片名称:', bookmark.name, 'URL:', bookmark.url);
  console.log('[Main] [API] 预设消息:', customMessage || '(无)');
  const url = bookmark.url;
  const presetMessage = customMessage || bookmark.presetMessage || '';
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const safeMsg = presetMessage.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  const jsCode = `(function() {
    try {
      const urlInput = document.getElementById('urlInput');
      if (urlInput) urlInput.value = '${safeUrl}';
      
      window.currentPreviewUrl = '${safeUrl}';
      window.currentPresetMessage = '${safeMsg}';
      // 📎 支持多附件数组（兼容旧格式）
      const _attachments = ${attachment ? (Array.isArray(attachment) ? JSON.stringify(attachment) : JSON.stringify([attachment])) : '[]'};
      window.currentPresetAttachments = _attachments;
      window.currentPresetAttachment = _attachments.length > 0 ? _attachments[0] : null;  // 兼容旧代码
      window.currentBookmarkIndex = ${index};
      window.currentReplySelector = '${_replySelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';
      window.__monitorHeartbeatSelector = '${_heartbeatSelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';
      window.__monitorReplySelector = '${_replySelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';
      window.__monitorTimeout = ${_monitorTimeout};
      
      document.getElementById('dataSection').style.display = 'block';
      document.getElementById('emptyState').style.display = 'none';
      
      document.querySelectorAll('.tab').forEach(tab => {
        if (tab.getAttribute('data-tab') === 'webpreview') {
          tab.style.display = '';
          tab.classList.add('active');
        } else {
          tab.style.display = 'none';
        }
      });
      window.currentTab = 'webpreview';
      
      const webview = document.getElementById('previewWebview');
      if (webview) {
        // 🔧 关键修复：先清理 webview 内部的旧状态变量，防止第二次调用时被干扰
        try {
          webview.executeJavaScript('delete window.__expandedElements; delete window.__apiMonitorObserver; delete window.__apiMonitorTargetNode; delete window.__lastDomChangeTime; delete window.__expandedThinkingCount; if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__activityMonitor){window.__activityMonitor.stop && window.__activityMonitor.stop(); delete window.__activityMonitor;}');
        } catch(e) {}
        // 🔧 关键修复：使用 reload() 强制重新加载（loadURL 对相同 URL 不重新加载，dom-ready 不触发）
        webview.loadURL('${safeUrl}');
        setTimeout(function() { try { webview.reload(); } catch(e) {} }, 100);
      }
      
      if (typeof renderData === 'function') renderData('webpreview');
      if (typeof showStatus === 'function') showStatus(' 已在网页预览中打开：${bookmark.name.replace(/'/g, "\\'")}' + ('${safeMsg}' ? ' (含预设消息)' : ''), 'success');
      
      return JSON.stringify({ success: true, message: '已在主窗口中打开预览' });
    } catch(e) {
      return JSON.stringify({ success: false, error: e.message });
    }
  })();`;

  const resultStr = await mainWindow.webContents.executeJavaScript(jsCode);
  let result;
  try { result = JSON.parse(resultStr); } catch(e) { result = { success: false, error: '解析失败' }; }

  return {
    success: result && result.success,
    message: result && result.message ? result.message : '已在 AI智控台 主窗口中打开预览',
    bookmark: {
      index: index,
      name: bookmark.name,
      url: bookmark.url,
      category: bookmark.category,
      customMessage: customMessage || null,
      previewedAt: new Date().toISOString(),
      // 🔑 返回完整卡片参数供前端显示诊断信息
      replySelector: bookmark.replySelector || '',
      heartbeatSelector: bookmark.heartbeatSelector || '',
      monitorTimeout: bookmark.monitorTimeout || 0
    }
  };
}

async function waitForWebActivityToSettle(opts) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不存在');
  }

  const replySelector = (opts && opts.replySelector) || '';
  const heartbeatSelector = (opts && opts.heartbeatSelector) || '';
  const monitorTimeout = (opts && opts.monitorTimeout) || 0;

  console.log('[Main] [API] 调用 renderer.js 封装的网页活动监控功能...');
  console.log('[Main] [API] 传入参数 - replySelector:', replySelector, 'heartbeatSelector:', heartbeatSelector, 'monitorTimeout:', monitorTimeout, 'ms');

  // 第一步：启动监控（在 renderer 中设置轮询，直接传入完整参数）
  const startJs = `
    (function() {
      if (typeof waitForActivityToComplete === 'function') {
        return waitForActivityToComplete(
          ${JSON.stringify(replySelector || '')},
          ${JSON.stringify(heartbeatSelector || '')},
          ${monitorTimeout || 0}
        );
      } else {
        return JSON.stringify({ success: false, error: 'waitForActivityToComplete 函数不存在' });
      }
    })();
  `;

  const startResult = await mainWindow.webContents.executeJavaScript(startJs, true);
  let startData;
  try { startData = JSON.parse(startResult); } catch(e) { startData = { success: false, error: '解析失败' }; }

  if (!startData.success) {
    console.error('[Main] [API] 启动监控失败:', startData.error);
    return { status: 'idle', message: '启动监控失败: ' + startData.error };
  }

  if (!startData.polling) {
    console.error('[Main] [API] 监控未启动');
    return { status: 'idle', message: '监控未启动' };
  }

  console.log('[Main] [API] 监控已启动，等待网页活动结束...');

  // 第二步：轮询检查 window.__apiMonitorResult（等待最多 120 秒）
  let lastLogTime = 0;
  let lastCheckResult = null;
  for (let i = 0; i < 240; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));

    const checkResultJs = `window.__apiMonitorResult || 'null'`;
    const resultStr = await mainWindow.webContents.executeJavaScript(checkResultJs);
    
    // 每 5 秒输出一次状态
    if (Date.now() - lastLogTime >= 5000) {
      console.log('[Main] [API] 等待中... (第', (i + 1) * 0.5, '秒), 上次结果:', lastCheckResult);
      lastLogTime = Date.now();
    }
    
    if (resultStr && resultStr !== 'null') {
      console.log('[Main] [API] 收到监控结果:', resultStr);
      lastCheckResult = resultStr;
      let result;
      try { result = JSON.parse(resultStr); } catch(e) { result = { success: false, error: '解析失败' }; }

      if (result.success) {
        console.log('[Main] [API] 网页活动已结束，内容长度:', result.result.contentLength);
        console.log('[Main] [API] 监控方法:', result.result.method);
        // 🛑 清理结果 + 清理 webview 内部的展开计时器（防止 AI 回复结束后还反复点击）
        await mainWindow.webContents.executeJavaScript(`
          delete window.__apiMonitorResult;
          (function(){ try { var wv = document.getElementById('previewWebview'); if(wv){ wv.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();} if(window.__activityMonitor && window.__activityMonitor.stop){window.__activityMonitor.stop();}');} } catch(e){} })();
        `);
        return {
          status: 'idle',
          message: '网页活动已结束',
          contentLength: result.result.contentLength,
          activityCount: result.result.activityCount,
          method: result.result.method
        };
      } else {
        console.log('[Main] [API] 监控返回失败:', result.error);
        // 🛑 失败路径也清理展开计时器
        try { await mainWindow.webContents.executeJavaScript(`(function(){ try { var wv = document.getElementById('previewWebview'); if(wv){ wv.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}');} } catch(e){} })();`); } catch(e) {}
        // 如果监控失败，也返回 idle 让程序继续
        return {
          status: 'idle',
          message: '监控失败: ' + (result.error || '未知错误'),
          method: result.result ? result.result.method : 'unknown'
        };
      }
    }
  }

  // 超时
  console.log('[Main] [API] 监控超时');
  // 🛑 超时路径也清理展开计时器
  await mainWindow.webContents.executeJavaScript(`
    delete window.__apiMonitorResult;
    clearInterval(window.__apiMonitorPollTimer);
    (function(){ try { var wv = document.getElementById('previewWebview'); if(wv){ wv.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();} if(window.__activityMonitor && window.__activityMonitor.stop){window.__activityMonitor.stop();}');} } catch(e){} })();
  `);
  return {
    status: 'active',
    message: '网页活动监控超时'
  };
}

async function injectMessageToWebview(message, serviceCardIndex = 0, attachment = null) {
  const mainWindow = getMainWindow();
  console.log('🚀🚀🚀 [Main] [API] injectMessageToWebview 函数被调用！');
  console.log('🚀🚀🚀 [Main] [API] 参数 message 类型:', typeof message);
  console.log('🚀🚀🚀 [Main] [API] 参数 message 长度:', message ? message.length : 'null/undefined');
  console.log('🚀🚀🚀 [Main] [API] 参数 serviceCardIndex:', serviceCardIndex);

  // 📎 支持多附件数组或单个附件对象
  let attachments = [];
  if (Array.isArray(attachment)) {
    attachments = attachment;  // 新格式：数组
    console.log('🚀🚀🚀 [Main] [API] 📎 附件数量:', attachments.length);
    attachments.forEach((att, i) => {
      console.log(`🚀🚀🚀 [Main] [API]   [${i}] ${att.name} (${att.size} bytes)`);
    });
  } else if (attachment && attachment.data) {
    attachments = [attachment];  // 旧格式：单个对象，转为数组
    console.log('🚀🚀🚀 [Main] [API] 参数 attachment:', attachment.name + ' (' + attachment.size + ' bytes)');
  } else {
    console.log('🚀🚀🚀 [Main] [API] 参数 attachment: (无)');
  }

  console.log('📌 [Main] [API] 🔐 函数执行版本: v' + APP_VERSION);

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('❌❌❌ [Main] [API] 主窗口不存在或已销毁！');
    throw new Error('主窗口不存在，请先打开 AI智控台 主界面');
  }

  console.log('✅✅✅ [Main] [API] 主窗口状态正常，继续执行...');

  var safeMsgJSON = JSON.stringify(message);

  console.log('[Main] [API] 🎯 injectMessageToWebview: 开始注入消息到 webview 输入框...');
  console.log('[Main] [API] 消息内容:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));

  // ============================================================
  // 🆕 附件处理：如果有附件，先传递给主进程并准备上传（支持多附件）
  // ============================================================
  if (attachments.length > 0) {
    console.log(`🎯🎯🎀 [Main] [API] 📎 检测到 ${attachments.length} 个附件，开始处理上传...`);

    // 目前只处理第一个附件（后续可扩展为循环处理所有附件）
    const firstAttachment = attachments[0];
    console.log('🎯🎯🎀 [Main] [API] 正在处理第一个附件:', firstAttachment.name);

    try {
      mainWindow.webContents.send('set-pending-attachment', firstAttachment);
      console.log('✅✅✅ [Main] [API] 第一个附件数据已发送给主进程（等待 select-file 拦截）');
    } catch (sendErr) {
      console.warn('[Main] [API] ⚠️ 发送附件数据失败:', sendErr.message);
    }

    // 🔧 确保预览窗口的 webview 已设置文件选择拦截器
    try {
      const { BrowserWindow } = require('electron');
      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        if (win.webContents && win !== mainWindow) {
          win.webContents.executeJavaScript(`
            (function() {
              var wv = document.getElementById('content-area') || document.getElementById('previewWebview') || document.querySelector('webview');
              if (wv) {
                console.log('[SetupCheck] 找到 webview, URL:', wv.getURL ? wv.getURL() : 'unknown');
                return { found: true, hasWebview: true };
              }
              return { found: false };
            })()
          `).then(result => {
            if (result && result.hasWebview) {
              console.log('[Main] [API] ✅ 预览窗口有 webview');
            }
          }).catch(e => {});
          break;
        }
      }
    } catch (e) {
      console.warn('[Main] [API] ⚠️ 检查预览窗口失败:', e.message);
    }
  }

  var safeMsgJSON = JSON.stringify(message);
  var hasAttachment = attachments.length > 0;

  // 构建内层脚本（在 webview 内部执行）- 使用数组拼接避免转义问题
  var innerScriptLines = [
    '(async function() {',
    '  try {',
    "    console.log('[Inject-Inside] ===== 开始注入流程 =====');",
    '',
    '    var message = ' + safeMsgJSON + ';',
    '    var hasAttachment = ' + (hasAttachment ? 'true' : 'false') + ';',

    '',
    '    // 🔍 查找输入框（支持多种类型：textarea, contenteditable div, input 等）    // 🔍 查找输入框（支持多种类型：textarea, contenteditable div, input 等）',
    "    console.log('[Inject-Inside] 开始查找输入框...');",
    '',
    '    var possibleSelectors = [',
    "      '[class*=\"chat-input-editor\"]',   // 🎯 Kimi 专属，优先匹配",
    "      'textarea[placeholder*=\\\"发消息\\\"]',",
    "      'textarea[placeholder*=\\\"消息\\\"]',",
    "      'textarea[placeholder*=\\\"输入\\\"]',",
    "      'textarea[placeholder*=\\\"请输入\\\"]',",
    "      'textarea[class*=\\\"input\\\"]',",
    "      'textarea[class*=\\\"editor\\\"]',",
    "      'div[contenteditable=\\\"true\\\"]',     // ← 关键！支持元宝等AI平台",
    "      '[role=\\\"textbox\\\"]',                  // ← ARIA 角色",
    "      'textarea',                               // 兜底：所有textarea",
    "      'input[type=\\\"text\\\"]'                 // 文本输入框",
    '    ];',
    '',
    '    var inputEl = null;',
    '    var foundSelector = null;',
    '',
    '    for (var i = 0; i < possibleSelectors.length; i++) {',
    '      try {',
    '        var els = document.querySelectorAll(possibleSelectors[i]);',
    "        console.log('[Inject-Inside] 选择器 [' + i + '] ' + possibleSelectors[i] + ': 找到', els.length, '个元素');",
    '',
    '        if (els.length > 0) {',
    '          // 如果找到多个，选择面积最大的可见元素',
    '          var maxArea = 0;',
    '          for (var j = 0; j < els.length; j++) {',
    '            var rect = els[j].getBoundingClientRect();',
    '            if (rect.width > 0 && rect.height > 0 && rect.width * rect.height > maxArea) {',
    '              maxArea = rect.width * rect.height;',
    '              inputEl = els[j];',
    '              foundSelector = possibleSelectors[i];',
    '            }',
    '          }',
    '',
    '          if (inputEl) {',
    "            console.log('[Inject-Inside] ✅ 找到输入框!');",
    "            console.log('[Inject-Inside] 选择器:', foundSelector);",
    "            console.log('[Inject-Inside] 标签:', inputEl.tagName);",
    "            console.log('[Inject-Inside] 类名:', (inputEl.className || '').substring(0, 80));",
    "            console.log('[Inject-Inside] 尺寸:', Math.round(inputEl.getBoundingClientRect().width), 'x', Math.round(inputEl.getBoundingClientRect().height));",
    '            break;',
    '          }',
    '        }',
    '      } catch(e) {',
    "        console.warn('[Inject-Inside] 选择器错误:', e.message);",
    '        continue;',
    '      }',
    '    }',
    '',
    '    if (!inputEl) {',
    "      return JSON.stringify({success:false, error:'找不到输入框（已尝试所有选择器）', step:'find-input'});",
    '    }',
    "",
    "    console.log('[Inject-Inside] ✅ 最终选择输入框成功');",
    '',
    '    // 🔥🔥🔥 关键修复：强制聚焦输入框（解决焦点不在输入区导致消息无法发送的问题）',
    "    console.log('[Inject-Inside] 🎯 开始强制聚焦输入框...');",
    '',
    '    // 步骤1：滚动到输入框可见区域',
    '    inputEl.scrollIntoView({ behavior: "smooth", block: "center" });',
    '    await new Promise(r => setTimeout(r, 300));',
    '',
    '    // 步骤2：点击输入框（模拟用户点击）',
    '    inputEl.click();',
    '    await new Promise(r => setTimeout(r, 200));',
    '',
    '    // 步骤3：调用 focus() 方法',
    '    inputEl.focus();',
    "    console.log('[Inject-Inside] ✅ 已执行 click() + focus()');",
    '',
    '    // 步骤4：验证焦点是否真的在输入框上',
    '    var activeElement = document.activeElement;',
    "    console.log('[Inject-Inside] 当前焦点元素:', activeElement ? activeElement.tagName : 'null');",
    "    console.log('[Inject-Inside] 是否是输入框:', activeElement === inputEl);",
    '',
    '    // 如果焦点不在输入框上，再次尝试',
    '    if (activeElement !== inputEl) {',
    "      console.log('[Inject-Inside] ⚠️ 焦点未在输入框上，再次尝试...');",
    '      inputEl.focus();',
    '      await new Promise(r => setTimeout(r, 300));',
    '      activeElement = document.activeElement;',
    "      console.log('[Inject-Inside] 第二次尝试后焦点元素:', activeElement ? activeElement.tagName : 'null');",
    '    }',
    '',
    "    console.log('[Inject-Inside] ✅✅✅ 输入框聚焦完成');",
    '',
    '    // 根据输入框类型和平台注入文本',
    '    try {',
    '      var tagName = inputEl.tagName.toUpperCase();',
    "      console.log('[Inject-Inside] 输入框类型:', tagName);",
    '',
    '      // 🔍 检测是否是文心一言（需要特殊处理）',
    '      var currentUrl = window.location.href;',
    '      var isWenXin = currentUrl.includes("yiyan.baidu.com") || currentUrl.includes("yiyian.baidu.com");',
    "      console.log('[Inject-Inside] 平台检测:', isWenXin ? '✅ 文心一言' : '⚪ 其他平台');",
    '',
    '      if (tagName === "TEXTAREA" || tagName === "INPUT") {',
    "        console.log('[Inject-Inside] 使用原生 setter 注入...');",
    '        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;',
    '        setter.call(inputEl, ' + safeMsgJSON + ');',
    '        inputEl.dispatchEvent(new Event("input", {bubbles:true}));',
    '        inputEl.dispatchEvent(new Event("change", {bubbles:true}));',
    '        inputEl.dispatchEvent(new Event("blur", {bubbles:true}));',
    '        inputEl.dispatchEvent(new Event("focus", {bubbles:true}));',
    "        console.log('[Inject-Inside] ✅ textarea/input 文本已注入! 当前值:', inputEl.value);",
    '      } else if (isWenXin) {',
    "        console.log('[Inject-Inside] 🎯 使用文心一言专用逐字输入模拟...');",
    '        inputEl.focus();',
    '',
    '        // 清空现有内容',
    "        inputEl.textContent = '';",
    '        inputEl.dispatchEvent(new Event("input", {bubbles:true}));',
    '',
    "        console.log('[Inject-Inside] 开始逐字输入:', ' + safeMsgJSON + ');",
    '',
    '        // 逐字输入（完全复制 wenXinAutoSend 的逻辑）',
    '        for (var charIdx = 0; charIdx < ' + safeMsgJSON + '.length; charIdx++) {',
    '          var char = ' + safeMsgJSON + '[charIdx];',
    '          var keyCode = char.charCodeAt(0);',
    '',
    '          // beforeinput 事件',
    '          var beforeInputEv = new InputEvent(\'beforeinput\', {',
    '            bubbles: true,',
    '            cancelable: true,',
    '            inputType: \'insertText\',',
    '            data: char',
    '          });',
    '          inputEl.dispatchEvent(beforeInputEv);',
    '',
    '          // keydown 事件',
    '          var keydownEv = new KeyboardEvent(\'keydown\', {',
    '            key: char,',
    '            code: char.length === 1 ? \'Key\' + char.toUpperCase() : \'Enter\',',
    '            keyCode: keyCode,',
    '            which: keyCode,',
    '            bubbles: true,',
    '            cancelable: true',
    '          });',
    '          inputEl.dispatchEvent(keydownEv);',
    '',
    '          // keypress 事件',
    '          var keypressEv = new KeyboardEvent(\'keypress\', {',
    '            key: char,',
    '            code: char.length === 1 ? \'Key\' + char.toUpperCase() : \'Enter\',',
    '            keyCode: keyCode,',
    '            which: keyCode,',
    '            bubbles: true,',
    '            cancelable: true',
    '          });',
    '          inputEl.dispatchEvent(keypressEv);',
    '',
    '          // 插入字符节点（关键！）',
    '          var textNode = document.createTextNode(char);',
    '          inputEl.appendChild(textNode);',
    '',
    '          // input 事件（使用 InputEvent）',
    '          var inputEv = new InputEvent(\'input\', {',
    '            bubbles: true,',
    '            cancelable: true,',
    '            inputType: \'insertText\',',
    '            data: char',
    '          });',
    '          inputEl.dispatchEvent(inputEv);',
    '',
    '          // keyup 事件',
    '          var keyupEv = new KeyboardEvent(\'keyup\', {',
    '            key: char,',
    '            code: char.length === 1 ? \'Key\' + char.toUpperCase() : \'Enter\',',
    '            keyCode: keyCode,',
    '            which: keyCode,',
    '            bubbles: true,',
    '            cancelable: true',
    '          });',
    '          inputEl.dispatchEvent(keyupEv);',
    '',
    '          // 每5个字符暂停一下（避免过快）',
    '          if (charIdx % 5 === 0) {',
    '            await new Promise(function(r) { setTimeout(r, 10); });',
    '          }',
    '        }',
    '',
    "        console.log('[Inject-Inside] ✅ 文心一言逐字输入完成!');",
    '',
    '        // 最后触发完整的事件序列',
    '        inputEl.dispatchEvent(new Event("input", { bubbles: true }));',
    '        inputEl.dispatchEvent(new Event("change", { bubbles: true }));',
    '        inputEl.dispatchEvent(new Event("blur", { bubbles: true }));',
    "        console.log('[Inject-Inside] ✅ 文心一言文本已注入! 当前内容:', inputEl.textContent);",
    '      } else {',
    "        console.log('[Inject-Inside] contenteditable 输入框（Kimi），使用 Copy-Paste 方式...');",
    '        // 先清空输入框',
    '        inputEl.focus();',
    "        document.execCommand('selectAll', false, null);",
    "        document.execCommand('delete', false, null);",
    '',
    '        // 🎯 方式 A: Clipboard API + paste 事件（最可靠！）',
    '        try {',
    "          console.log('[Inject-Inside] 📋 使用 navigator.clipboard.writeText + paste...');",
    '          await navigator.clipboard.writeText(' + safeMsgJSON + ');',
    "          console.log('[Inject-Inside] ✅ 已写入剪贴板');",
    '',
    '          // 触发 paste 事件',
    "          var pasteEvent = new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:null});",
    '          inputEl.dispatchEvent(pasteEvent);',
    '',
    '          // 也模拟 Ctrl+V / Cmd+V',
    "          var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;",
    "          var keydownPaste = new KeyboardEvent('keydown', {key:'v', code:'KeyV', keyCode:86, which:86, ctrlKey:!isMac, metaKey:isMac, bubbles:true, cancelable:true});",
    "          var keypressPaste = new KeyboardEvent('keypress', {key:'v', code:'KeyV', keyCode:86, which:86, ctrlKey:!isMac, metaKey:isMac, bubbles:true, cancelable:true});",
    "          var keyupPaste = new KeyboardEvent('keyup', {key:'v', code:'KeyV', keyCode:86, which:86, ctrlKey:!isMac, metaKey:isMac, bubbles:true, cancelable:true});",
    '          inputEl.dispatchEvent(keydownPaste);',
    '          inputEl.dispatchEvent(keypressPaste);',
    "          document.execCommand('paste');",
    '          inputEl.dispatchEvent(keyupPaste);',
    "          console.log('[Inject-Inside] ✅ paste 事件已触发');",
    '        } catch(e) { console.log(\'[Inject-Inside] ⚠️ Clipboard API 失败:\', e.message); }',
    '',
    '        // 🎯 方式 B: execCommand insertText 兜底',
    '        try {',
    "          var currentText = inputEl.textContent || inputEl.innerText;",
    "          if (!currentText || currentText.trim().length === 0) {" +
    "            console.log('[Inject-Inside] 📋 使用 execCommand insertText 兜底...');",
    '            inputEl.focus();',
    "            document.execCommand('insertText', false, " + safeMsgJSON + ");",
    "            console.log('[Inject-Inside] ✅ execCommand insertText 完成');",
    '          }',
    '        } catch(e2) {',
    "          console.log('[Inject-Inside] ⚠️ execCommand 也失败，最后尝试 textContent...');",
    '          inputEl.textContent = ' + safeMsgJSON + ';',
    '        }',
    '',
    '        // 触发事件链确保 React 状态更新',
    "        inputEl.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, inputType:'insertText', data: " + safeMsgJSON + "}));",
    "        inputEl.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data: " + safeMsgJSON + "}));",
    "        inputEl.dispatchEvent(new Event('input', {bubbles:true}));",
    "        inputEl.dispatchEvent(new Event('change', {bubbles:true}));",
    "        console.log('[Inject-Inside] ✅ contenteditable 注入完成');",
    '      }',
    '',
    '      // ⏰ 关键：等待 React 状态更新（与直接发送模式一致！）',
    "      console.log('[Inject-Inside] ⏰ 等待 React 状态更新...');",
    '      await new Promise(r => setTimeout(r, 3000));  // 等3秒',
    '',
    '      // 再次触发 input 事件确保消息被识别',
    '      inputEl.dispatchEvent(new Event("input", {bubbles:true}));',
    '      inputEl.dispatchEvent(new Event("change", {bubbles:true}));',
    "      console.log('[Inject-Inside] ✅ 已触发 input/change 事件确保消息识别');",
    '',
    '      // ⏰ 再等待一下',
    '      await new Promise(r => setTimeout(r, 1000));  // 再等1秒',
    '',
    "      console.log('[Inject-Inside] ✅✅✅ 注入完成！当前值:', tagName === 'TEXTAREA' || tagName === 'INPUT' ? inputEl.value : inputEl.textContent);",
    '    } catch(e) {',
    "      return JSON.stringify({success:false, error:'注入失败:'+e.message, step:'inject'});",
    '    }',
    '',
    "    return JSON.stringify({success:true, message:'消息已注入到输入框', autoSent:false, needClickSend:true, inputType:tagName});",
    '',
    '  } catch(err) {',
    "    console.error('[Inject-Inside] ❌ 错误:', err.message);",
    "    return JSON.stringify({success:false, error:err.message, step:'error'});",
    '  }',
    '})()'
  ];

  var innerScript = innerScriptLines.join('\n');
  console.log('[Main] [API] 内层脚本长度:', innerScript.length);

  // 构建外层脚本（在 renderer 进程执行）- v39 分离式方案
  //    Step 1: 执行 innerScript（注入消息，已验证可行）
  //    Step 2: 如有附件，单独执行简单的 file input 脚本
  var outerScriptLines = [
    '(function() {',
    '  try {',
    "    console.log('[Inject-Outer] 开始执行 (v39 分离式方案)...');",
    '    var wv = document.getElementById("previewWebview");',
    '    if (!wv) return JSON.stringify({success:false, error:"找不到webview"});',
    '',
    "    console.log('[Inject-Outer] URL:', wv.getURL());",
    '',
    "    console.log('[Inject-Outer] 🚀 Step 1: 执行消息注入脚本...');",
    '    return wv.executeJavaScript(' + JSON.stringify(innerScript) + ')',
    '      .then(function(injectResult) {',
    "        console.log('[Inject-Outer] ✅ Step 1 完成 (消息注入):', injectResult);",
    '',
    '        var hasAttach = ' + (hasAttachment ? 'true' : 'false') + ';',
    "        console.log('[Inject-Outer] 🔍 检查 hasAttach 变量:', hasAttach, '(类型:', typeof hasAttach, ')');",
    '',
    '        if (hasAttach) {',
        "          console.log('[Inject-Outer] 📎 Step 2: 检测到附件，开始上传...');",
        '',
          // 独立的、简单的附件上传脚本（使用 JSON.stringify 安全编码）
        '          var attachScript = ' + JSON.stringify([
            '(function() {',
            '  try {',
            '    console.log("[Attach] 创建隐藏的 file input...");',
            '    const fi = document.createElement("input");',
            '    fi.type = "file";',
            '    fi.style.cssText = "display:none;position:absolute;left:-9999px";',
            '    document.body.appendChild(fi);',
            '    console.log("[Attach] ✅ File input 已创建");',
            '',
            '    return new Promise(function(resolve) {',
            '      setTimeout(function() {',
            '        fi.click();',
            '        console.log("[Attach] ✅ File input 已点击 (触发 select-file)");',
            '        resolve("✅ 已触发文件选择");',
            '      }, 800);',
            '    });',
            '  } catch(e) {',
            '    console.error("[Attach] ❌ 错误:", e.message);',
            '    return "❌ " + e.message;',
            '  }',
            '})()'
        ].join('\n')) + ';',
        '',
        '          return wv.executeJavaScript(attachScript)',
    '            .then(function(attachResult) {',
    "              console.log('[Inject-Outer] ✅ Step 2 完成 (附件上传):', attachResult);",
    '',
              // 等待附件处理完成
    '              return new Promise(function(resolve) {',
    '                setTimeout(function() {',
    "                  console.log('[Inject-Outer] ⏳ 等待附件处理完成 (8秒)...');",
    '                  resolve(injectResult);',
    '                }, 8000);',
    '              });',
    '            })',
    '            .catch(function(attachErr) {',
    "              console.error('[Inject-Outer] ⚠️ Step 2 附件上传失败（继续）:', attachErr.message);",
    '              return injectResult;  // 即使附件失败也返回主结果',
    '            });',
    '        } else {',
    "          console.log('[Inject-Outer] ℹ️ 无附件，跳过 Step 2');",
    '          return injectResult;',
    '        }',
    '      })',
    '      .catch(function(e) {',
    "        console.error('[Inject-Outer] ❌ Step 1 失败:', e.message);",
    "        return JSON.stringify({success:false, error:'executeJavaScript错误:'+e.message});",
    '      });',
    '  } catch(e) {',
    "    return JSON.stringify({success:false, error:e.message});",
    '  }',
    '})()'
  ];

  // ============================================================
  // 🆕 v43: 极简方案 - 直接调用 doubaoAutoSend（与直接发送模式100%一致）
  //    不再使用 innerScript/outerScript 的复杂注入方式
  // ============================================================

  console.log('[Main] [API] 🚀🚀🚀 [v43] 使用 doubaoAutoSend 方案（与直接发送模式完全一致）');
  console.log('[Main] [API] 消息内容:', message);
  if (attachment) {
    console.log('[Main] [API] 📎 附件信息:', attachment.name, '(' + attachment.size + ' bytes)');
  }

  let result;

  try {
    // 🔧 根据平台选择不同的发送函数
    //    Kimi 使用 kimiAutoSend（sendInputEvent 方式），其他平台使用 doubaoAutoSend
    const bookmarksAll = loadBookmarksForAPI();
    const cardConfig = bookmarksAll[serviceCardIndex] || {};
    const cardUrl = (cardConfig.url || '').toLowerCase();
    const isKimi = cardUrl.includes('kimi.com') || cardUrl.includes('kimi.moonshot.cn') || cardUrl.includes('moonshot.cn');

    console.log('[Main] [API] 🎯 平台检测:', isKimi ? '✅ Kimi（使用 autoSendPresetMessage/kimiAutoSend）' : '⚪ 其他平台（使用 doubaoAutoSend）');
    console.log('[Main] [API] 卡片URL:', cardUrl);

    let sendResult;

    if (isKimi) {
      // 🎯 Kimi: 完全内联的处理逻辑（使用 sendInputEvent，保持当前对话上下文）
      //    不依赖 kimiAutoSend/autoSendPresetMessage 函数调用，避免作用域问题

      // 🆕 附件处理：如果有附件，先通过 Clipboard API 粘贴到 Kimi
      const attachmentData = attachment && attachment.data ? attachment : null;
      const hasKimiAttachment = !!(attachmentData && attachmentData.data);

      console.log('[Main] [API] 📎 Kimi 附件状态:', hasKimiAttachment ? '有附件: ' + (attachmentData.name || 'unnamed') : '无附件');

      sendResult = await mainWindow.webContents.executeJavaScript(`
        (async function() {
          const wv = document.getElementById('previewWebview');
          if (!wv) return JSON.stringify({success:false, error:'找不到webview'});

          const currentUrl = wv.getURL ? wv.getURL() : 'unknown';
          console.log('[Inject-Continue-Kimi] 当前 webview URL:', currentUrl);

          const message = ${JSON.stringify(message)};
          console.log('[Inject-Continue-Kimi] 🎯 开始 Kimi 内联注入, 消息:', message);

          // ========== 📎 附件处理（如果有的话） ==========
          const _attachment = ${attachmentData ? JSON.stringify(attachmentData) : 'null'};
          let attachUploadResult = null;

          if (_attachment && _attachment.data) {
            console.log('[Inject-Continue-Kimi] 📎📎📎 检测到附件！开始粘贴上传...');
            console.log('[Inject-Continue-Kimi] 附件名称:', _attachment.name);
            console.log('[Inject-Continue-Kimi] 附件类型:', _attachment.type);

            try {
              // 方式 A: 通过 Electron IPC 调用主进程的 clipboard API 写入图片
              //    然后在 webview 中触发 paste
              const clipResult = await window.electronAPI.invoke('paste-image-to-webview', {
                url: 'kimi.com',
                imageData: _attachment.data,   // base64 数据
                imageName: _attachment.name || 'image.png',
                imageType: _attachment.type || 'image/png'
              });
              console.log('[Inject-Continue-Kimi] 📎 paste-image-to-webview 结果:', JSON.stringify(clipResult));
              attachUploadResult = clipResult;

              // 等待 Kimi 处理粘贴的附件
              await new Promise(r => setTimeout(r, 1000));
            } catch(attachErr) {
              console.error('[Inject-Continue-Kimi] 📎❌ 附件粘贴失败:', attachErr.message);
              attachUploadResult = { success: false, error: attachErr.message };
            }
          } else {
            console.log('[Inject-Continue-Kimi] ℹ️ 无附件数据，跳过附件步骤');
          }

          // ========== Step 1: 聚焦输入框 ==========
          let focusResult;
          try {
            focusResult = await wv.executeJavaScript(\`
              (function() {
                const selectors = [
                  '[class*="chat-input-editor"]',
                  'div[contenteditable="true"]',
                  '[role="textbox"]',
                  'textarea'
                ];
                let input = null;
                let foundSelector = '';
                for (const sel of selectors) {
                  input = document.querySelector(sel);
                  if (input) { foundSelector = sel; break; }
                }
                if (!input) return { success: false, error: '未找到输入框', tried: selectors };
                input.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                return { success: true, selector: foundSelector };
              })()
            \`);
            console.log('[Inject-Continue-Kimi] Step1 聚焦结果:', JSON.stringify(focusResult));
          } catch(e) {
            console.error('[Inject-Continue-Kimi] Step1 聚焦失败:', e.message);
            return JSON.stringify({success: false, error: 'Step1 聚焦失败: ' + e.message});
          }

          if (!focusResult || !focusResult.success) {
            return JSON.stringify(focusResult || {success:false, error:'聚焦失败'});
          }

          // 等待聚焦完成
          await new Promise(r => setTimeout(r, 300));

          // 🔧🔧🔧 增强型修复：在输入消息前，清空输入框以消除可能的 "vV" 字符泄漏 🔧🔧🔧
          try {
            const cleanupResult = await wv.executeJavaScript(\`
              (function() {
                // 查找 Kimi 输入框
                const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
                if (!input) return { success: false, error: '未找到输入框' };

                // 获取当前文本内容（用于调试）
                const textBeforeCleanup = input.textContent || input.value || '';

                // 清空输入框
                input.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);

                // 验证是否清空成功
                const textAfterCleanup = input.textContent || input.value || '';

                return {
                  success: true,
                  textBeforeCleanup: textBeforeCleanup,
                  textAfterCleanup: textAfterCleanup,
                  cleaned: textBeforeCleanup.length > 0 && textAfterCleanup.length === 0
                };
              })()
            \`);
            console.log('[Inject-Continue-Kimi] 🔧 输入框清理结果:', JSON.stringify(cleanupResult));

            if (cleanupResult.textBeforeCleanup && cleanupResult.textBeforeCleanup.trim()) {
              console.warn('[Inject-Continue-Kimi] ⚠️ 发现残留文本并被清理:', JSON.stringify(cleanupResult.textBeforeCleanup));
            }
          } catch (cleanupErr) {
            console.error('[Inject-Continue-Kimi] ❌ 输入框清理失败（非致命）:', cleanupErr.message);
          }

          await new Promise(r => setTimeout(r, 200));  // 等待清理完成

          // Step 2: 使用 sendInputEvent 输入消息
          let typeResult;
          try {
            console.log('[Inject-Continue-Kimi] Step2 调用 type-message-to-webview...');
            typeResult = await window.electronAPI.invoke('type-message-in-webview', {
              url: 'kimi.com',
              message: message
            });
            console.log('[Inject-Continue-Kimi] Step2 输入结果:', JSON.stringify(typeResult));
          } catch(e) {
            console.error('[Inject-Continue-Kimi] Step2 输入失败:', e.message);
            return JSON.stringify({success: false, error: 'Step2 输入失败: ' + e.message});
          }

          // 🔧 增强型：如果有附件，等待更长时间让 Kimi 处理附件
          const continueWaitTime = attachUploadResult && attachUploadResult.success ? 1500 : 500;
          console.log('[Inject-Continue-Kimi] ⏳ 等待 React 处理' + (attachUploadResult && attachUploadResult.success ? '（含附件处理）' : '') + '... (' + continueWaitTime + 'ms)');
          await new Promise(r => setTimeout(r, continueWaitTime));

          // 🔧🔧🔧 在按 Enter 前，再次确保焦点在输入框 🔧🔧🔧
          try {
            const preEnterFocus = await wv.executeJavaScript(\`
              (function() {
                const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
                if (input) {
                  input.focus();
                  return { focused: true };
                }
                return { focused: false, error: '未找到输入框' };
              })()
            \`);
            console.log('[Inject-Continue-Kimi] 🔐 按 Enter 前聚焦结果:', JSON.stringify(preEnterFocus));
          } catch (preFocusErr) {
            console.error('[Inject-Continue-Kimi] ❌ 按 Enter 前聚焦失败:', preFocusErr.message);
          }

          await new Promise(r => setTimeout(r, 200));  // 等待聚焦生效

          // Step 3: 使用 sendInputEvent 按 Enter 发送（三重保障）
          let enterResult;
          try {
            console.log('[Inject-Continue-Kimi] Step3 调用 press-enter-in-webview...');
            enterResult = await window.electronAPI.invoke('press-enter-in-webview', {
              url: 'kimi.com'
            });
            console.log('[Inject-Continue-Kimi] Step3 Enter 结果:', JSON.stringify(enterResult));
          } catch(e) {
            console.error('[Inject-Continue-Kimi] Step3 Enter 失败:', e.message);
            // 兜底：尝试 JS click
            try {
              const fallback = await wv.executeJavaScript(\`
                (function() {
                  const btns = document.querySelectorAll('[class*="chat-input"] button, button[aria-label*="发送"]');
                  for (const btn of btns) { if (btn.offsetWidth > 0) { btn.click(); return {success:true, method:'button'}; } }
                  return {success:false, error:'未找到按钮'};
                })()
              \`);
              enterResult = fallback;
              console.log('[Inject-Continue-Kimi] Step3 兜底结果:', JSON.stringify(enterResult));
            } catch(e2) {
              return JSON.stringify({success: false, error: 'Step3 发送失败: ' + e.message});
            }
          }

          return JSON.stringify({
            success: true,
            method: 'kimi-inline-sendInputEvent',
            attachment: attachUploadResult,  // 📎 附件上传结果
            focus: focusResult,
            type: typeResult,
            enter: enterResult,
            platform: 'kimi'
          });
        })()
      `);
    } else {
      // 其他平台: 使用 doubaoAutoSend
      sendResult = await mainWindow.webContents.executeJavaScript(`
        (async function() {
          const wv = document.getElementById('previewWebview');
          if (!wv) return JSON.stringify({success:false, error:'找不到webview'});

          if (typeof doubaoAutoSend !== 'function') {
            return JSON.stringify({success:false, error:'doubaoAutoSend 函数不存在'});
          }

          const attachment = ${attachment ? JSON.stringify(attachment) : 'null'};
          const message = ${JSON.stringify(message)};

          console.log('[Inject-v43] 调用 doubaoAutoSend...');
          const result = await doubaoAutoSend(wv, message, attachment);
          console.log('[Inject-v43] doubaoAutoSend 返回:', JSON.stringify(result));

          return JSON.stringify(result);
        })()
      `);
    }

    result = JSON.parse(sendResult);
    console.log('[Main] [API] ✅ doubaoAutoSend 结果:', JSON.stringify(result));

  } catch (e) {
    console.error('[Main] [API] ❌ doubaoAutoSend 执行失败:', e.message);
    result = { success: false, error: 'doubaoAutoSend错误:' + e.message };
  }

  // 附加 serviceCardIndex
  result.serviceCardIndex = serviceCardIndex;
  console.log('[Main] [API] 📋 附加 serviceCardIndex 到结果:', serviceCardIndex);

  // 🆕 v43: doubaoAutoSend 成功时，标记 autoSent = true（用于触发后续的监控逻辑）
  if (result.success) {
    result.autoSent = true;
    result.needClickSend = false;  // 已经发送了，不需要再点击发送按钮
    console.log('[Main] [API] ✅✅✅ doubaoAutoSend 成功，设置 autoSent=true');
  }

  // ============================================================
  // ✨ 新功能：等待 AI 回复并抓取结果（与直接发送模式完全一致）
  //    使用心跳监控 + 稳定检测 + 选择器抓取
  // ============================================================
  if (result.autoSent) {
    console.log('[Main] [API] 🔄 消息已自动发送，开始使用完整监控逻辑等待 AI 回复...');

    const captureIndex = result.serviceCardIndex || 0;

    console.log('[Main] [API] 📡 准备调用 captureElementContentByIndex, index:', captureIndex);

    try {
      // ✅ 关键修复：从 bookmarks.json 读取该服务卡片的配置（与直接发送模式一致）
      const bookmarksAll = loadBookmarksForAPI();
      const bookmarkConfig = bookmarksAll[captureIndex] || {};

      // 🔧 优先级：前端传入参数 > bookmarks.json 配置 > 平台自动检测默认值
      let _replySelector = (bookmarkConfig.replySelector || bookmarkConfig.reply_selector || '').trim();
      const _heartbeatSelector = bookmarkConfig.heartbeatSelector || bookmarkConfig.heartbeat_selector || '#chat-container';
      const _monitorTimeout = bookmarkConfig.monitorTimeout || bookmarkConfig.monitor_timeout || 20000;

      // 🆕 平台自动检测：如果 replySelector 为空，根据 URL 自动设置默认值
      if (!_replySelector && bookmarkConfig.url) {
        const cardUrl = bookmarkConfig.url.toLowerCase();
        const platformDefaults = {
          'kimi.com': '[role="listitem"], [class*="message-bubble"], .markdown-body, main',
          'kimi.moonshot.cn': '[role="listitem"], [class*="message-bubble"], .markdown-body, main',
          'moonshot.cn': '[role="listitem"], [class*="message-bubble"], .markdown-body, main',
          'deepseek.com': '[class*="message-content"], [class*="chat-message"], .markdown-body',
          'doubao.com': '[class*="message-content"], [class*="text-container"]',
          'yiyan.baidu.com': '[class*="message-content"], .markdown-body',
        };
        for (const [platform, selector] of Object.entries(platformDefaults)) {
          if (cardUrl.includes(platform)) {
            _replySelector = selector;
            console.log('[Main] [API] 🎯 injectMessageToWebview: 检测到平台 (' + platform + ')，使用默认 replySelector:', selector);
            break;
          }
        }
      }

      // 最终兜底
      if (!_replySelector) {
        _replySelector = '.markdown-prose';
      }

      console.log('[Main] [API] 🎯 抓取参数配置：');
      console.log('[Main] [API]   - replySelector:', _replySelector);
      console.log('[Main] [API]   - heartbeatSelector:', _heartbeatSelector);
      console.log('[Main] [API]   - monitorTimeout:', _monitorTimeout, 'ms');
      console.log('[Main] [API]   - 卡片名称:', bookmarkConfig.name || '(未知)');
      console.log('[Main] [API]   - 卡片URL:', (bookmarkConfig.url || '').substring(0, 80));

      const captureResult = await captureElementContentByIndex(captureIndex, {
        replySelector: _replySelector,
        heartbeatSelector: _heartbeatSelector,
        monitorTimeout: _monitorTimeout
      });

      console.log('[Main] [API] ✅✅✅ 抓取到 AI 回复（完整监控）！');

      // 将抓取到的内容合并到结果中
      result.captureResult = captureResult;
      result.hasContent = true;

      // 📌 新增：回传实际使用的参数信息（供前端显示）
      result.captureParams = {
        bookmarkIndex: captureIndex,
        cardName: bookmarkConfig.name || '(未知)',
        cardUrl: bookmarkConfig.url || '',
        replySelector: _replySelector,
        heartbeatSelector: _heartbeatSelector,
        monitorTimeout: _monitorTimeout,
        capturedAt: new Date().toISOString(),
        contentLength: (captureResult.content || '').length,
        htmlLength: (captureResult.html || '').length
      };

      console.log('[Main] [API] 📊 抓取结果统计：');
      console.log('[Main] [API]   - 文本长度:', result.captureParams.contentLength, '字符');
      console.log('[Main] [API]   - HTML 长度:', result.captureParams.htmlLength, '字符');
      console.log('[Main] [API]   - 抓取时间:', result.captureParams.capturedAt);

    } catch(captureErr) {
      console.warn('[Main] [API] ⚠️ 抓取 AI 回复失败:', captureErr.message);
      console.warn('[Main] [API] 错误详情:', captureErr.stack || '');
      result.hasContent = false;
      result.captureError = captureErr.message;
    }
  }

  console.log('[Main] [API] injectMessageToWebview 最终结果:', JSON.stringify(result));

  return result;
}

// ============================================================
// ✨ 新函数：抓取当前已加载页面的内容（用于注入模式）
//    不依赖 bookmarkIndex，直接操作 previewWebview
// ============================================================
async function captureCurrentPageContent(params) {
  const mainWindow = getMainWindow();
  console.log('🎯🎯🎯 [Main] [API] captureCurrentPageContent 开始执行！');
  console.log('🎯🎯🎀 [Main] [API] 参数:', JSON.stringify(params || {}).substring(0, 200));

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不存在');
  }

  const replySelector = (params && params.replySelector) || '.markdown-prose';
  const heartbeatSelector = (params && params.heartbeatSelector) || '#chat-container';
  const monitorTimeout = (params && params.monitorTimeout) || 20000;

  console.log('[Main] [API] 📋 选择器配置:');
  console.log('[Main] [API]   - replySelector:', replySelector);
  console.log('[Main] [API]   - heartbeatSelector:', heartbeatSelector);
  console.log('[Main] [API]   - monitorTimeout:', monitorTimeout, 'ms');

  // 构建内层抓取脚本（在 webview 内部执行）
  var innerCaptureLines = [
    '(function() {',
    "  console.log('[Inject-Capture-Inside] 开始内部抓取...');",
    '',
    '  return new Promise(function(resolve) {',
    '    setTimeout(function() {',
    '      try {',
    '        var selector = ' + JSON.stringify(replySelector) + ';',
    "        var elements = document.querySelectorAll(selector);",
    "        console.log('[Inject-Capture-Inside] 找到元素数量:', elements.length);",
    '',
    '        if (elements.length === 0) {',
    "          resolve(JSON.stringify({success:false, error:'未找到匹配元素', selector:selector}));",
    '          return;',
    '        }',
    '',
    '        var lastEl = elements[elements.length - 1];',
    '        var text = lastEl.innerText || lastEl.textContent || "";',
    '        var html = lastEl.innerHTML || "";',
    '',
    "        console.log('[Inject-Capture-Inside] ✅ 抓取成功！文本长度:', text.length);",
    "        console.log('[Inject-Capture-Inside] ✅ HTML 长度:', html.length);",
    '',
    '        resolve(JSON.stringify({',
    '          success:true,',
    '          content:text.trim(),',
    '          html:html,',
    '          elementCount:elements.length',
    '        }));',
    '',
    '      } catch(err) {',
    "        resolve(JSON.stringify({success:false, error:err.message}));",
    '      }',
    '    }, 1000);',
    '  });',
    '})()'
  ];

  var innerCaptureScript = innerCaptureLines.join('\n');
  console.log('[Main] [API] 内层抓取脚本长度:', innerCaptureScript.length);

  // 构建外层脚本（在 renderer 进程执行）
  var outerCaptureLines = [
    '(function() {',
    '  try {',
    "    console.log('[Inject-Capture] ===== 开始抓取当前页面内容 =====');",
    '',
    '    var webview = document.getElementById("previewWebview");',
    '    if (!webview) {',
    "      return JSON.stringify({success:false, error:'找不到 previewWebview'});",
    '    }',
    '',
    "    console.log('[Inject-Capture] 找到 webview, URL:', webview.getURL());",
    '',
    '    return webview.executeJavaScript(' + JSON.stringify(innerCaptureScript) + ')',
    '      .then(function(result) {',
    "        console.log('[Inject-Capture] ✅ 抓取完成:', result);",
    '        return result;',
    '      })',
    '      .catch(function(err) {',
    "        console.error('[Inject-Capture] ❌ 抓取失败:', err.message);",
    "        return JSON.stringify({success:false, error:'executeJavaScript错误:'+err.message});",
    '      });',
    '',
    '  } catch(e) {',
    "    return JSON.stringify({success:false, error:e.message});",
    '  }',
    '})()'
  ];

  var monitorScript = outerCaptureLines.join('\n');
  console.log('[Main] [API] 外层抓取脚本长度:', monitorScript.length);

  try {
    const resultStr = await mainWindow.webContents.executeJavaScript(monitorScript);
    let result;
    try { result = JSON.parse(resultStr); } catch(e) { result = { success: false, error: '解析失败' }; }

    console.log('[Main] [API] 📦 抓取结果:', JSON.stringify(result).substring(0, 500));

    if (!result.success) {
      throw new Error(result.error || '抓取失败');
    }

    // 返回与直接发送格式一致的结果
    return {
      success: true,
      content: result.content,
      html: result.html,
      elementCount: result.elementCount,
      parsedData: {
        text: result.content,
        html: result.html
      }
    };

  } catch(error) {
    console.error('[Main] [API] ❌ captureCurrentPageContent 错误:', error);
    throw error;
  }
}

async function captureElementContentByIndex(bookmarkIndex, params) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不存在，请先打开 AI智控台 主界面');
  }

  if (bookmarkIndex === undefined || bookmarkIndex === null) {
    throw new Error('缺少 bookmarkIndex 参数');
  }

  // 🔧 【关键修复】同时从两个地方读取字段，取有值的那个
  //   1. params：前端直接传的（来自 selectedServiceCard，字段名和值 100% 正确）
  //   2. bookmarks.json：磁盘文件中的（作为兜底）
  const bookmarksAll = loadBookmarksForAPI();
  const bookmark = bookmarksAll[bookmarkIndex] || {}; // 即使索引不对也不抛错，用空对象兜底

  // 🔍 【关键调试】把两个来源的字段都打印到主进程控制台
  console.log('[Main] [API] 📋 === capture-element-content 调试信息 ===');
  console.log('[Main] [API] params (from frontend):', JSON.stringify(params || {}).substring(0, 300));
  console.log('[Main] [API] bookmark (from disk, index=' + bookmarkIndex + '):', JSON.stringify(bookmark).substring(0, 500));
  console.log('[Main] [API] bookmarks.json 总条数:', bookmarksAll.length);

  // 🔧 【核心修复】优先使用 params（前端直接传的），其次从 bookmark 读
  //    这样即使 bookmark 索引不对、字段名不对，也能用前端传的正确值
  const replySelector = (params && params.replySelector) || bookmark.replySelector || bookmark.reply_selector || '';
  const heartbeatSelector = (params && params.heartbeatSelector) || bookmark.heartbeatSelector || bookmark.heartbeat_selector || '';
  const monitorTimeout = (params && params.monitorTimeout) || bookmark.monitorTimeout || bookmark.monitor_timeout || 0;

  console.log('[Main] [API] ✅ 最终使用 - replySelector:', replySelector);
  console.log('[Main] [API] ✅ 最终使用 - heartbeatSelector:', heartbeatSelector || '(无)');
  console.log('[Main] [API] ✅ 最终使用 - monitorTimeout:', monitorTimeout, 'ms');

  // 🆕 如果 replySelector 为空，尝试根据 URL 自动检测平台并使用默认选择器
  let finalReplySelector = replySelector;
  if (!finalReplySelector && bookmark.url) {
    const cardUrl = bookmark.url.toLowerCase();
    const defaultSelectors = {
      // Kimi: AI 回复消息容器（使用 role="listitem" + 文本内容过滤）
      'kimi.com': '[role="listitem"], [class*="message-bubble"], [class*="assistant-message"], [class*="ai-reply"], .markdown-body, main',
      'kimi.moonshot.cn': '[role="listitem"], [class*="message-bubble"], [class*="assistant-message"], [class*="ai-reply"], .markdown-body, main',
      'moonshot.cn': '[role="listitem"], [class*="message-bubble"], [class*="assistant-message"], [class*="ai-reply"], .markdown-body, main',
      // DeepSeek
      'deepseek.com': '[class*="message-content"], [class*="chat-message"], [class*="markdown"]',
      // 豆包/字节系
      'doubao.com': '[class*="message-content"], [class*="chat-message"], [class*="text-container"]',
      // 文心一言
      'yiyan.baidu.com': '[class*="message-content"], [class*="chat-message"], [class*="markdown-body"]',
      // 通用的 AI 聊天平台回退选择器
      '_default': '[class*="message-content"], [class*="chat-message"] [class*="content"], [class*="ai-reply"], [class*="response-content"], main, article, [role="main"]'
    };

    for (const [platform, selector] of Object.entries(defaultSelectors)) {
      if (cardUrl.includes(platform)) {
        finalReplySelector = selector;
        console.log('[Main] [API] 🎯 检测到 AI 平台 (' + platform + ')，使用默认 replySelector:', selector);
        break;
      }
    }

    // 如果还是没找到（不应该发生），使用最通用的选择器
    if (!finalReplySelector) {
      finalReplySelector = defaultSelectors['_default'];
      console.log('[Main] [API] ⚠️ 未识别的平台，使用通用默认 replySelector:', finalReplySelector);
    }
  }

  if (!finalReplySelector) {
    throw new Error('该卡片未设置自定义回复选择器 (replySelector) 且无法自动检测平台');
  }

  // 🔍 监控用心跳选择器优先：有 heartbeatSelector 用它，没有则 fallback 到 replySelector
  const monitorSelector = heartbeatSelector || finalReplySelector;
  const monitorSource = heartbeatSelector ? 'heartbeatSelector（💓监控）' : 'finalReplySelector（🎯内容）';

  console.log('[Main] [API] 获取元素内容 - 卡片:', bookmark.name);
  console.log('[Main] [API]   - finalReplySelector (内容抓取用):', finalReplySelector);
  console.log('[Main] [API]   - heartbeatSelector (监控用):', heartbeatSelector || '(未设置，将用 finalReplySelector 监控)');
  console.log('[Main] [API]   - monitorTimeout (稳定判定时间):', monitorTimeout ? monitorTimeout + 'ms' : '(未设置，默认 15000ms)');
  console.log('[Main] [API]   - 实际监控使用的选择器:', monitorSelector, '(' + monitorSource + ')');

  // 🔧 【核心修复】把 bookmark 中读到的字段注入 window 变量
  //    只有 bookmark 中有非空值的字段才注入，空值保留之前 preview-bookmark 注入的有效值
  try {
    await mainWindow.webContents.executeJavaScript(`(function(){
      // 1. 清理旧状态
      try { delete window.__apiMonitorResult; } catch(e) {}
      try { clearInterval(window.__apiMonitorPollTimer); } catch(e) {}
      try { window.__apiMonitorPollTimer = null; } catch(e) {}
      // 2. 🔧 【关键】有非空值才注入，避免覆盖 preview-bookmark 之前注入的有效值
      var _hs = ${JSON.stringify(heartbeatSelector || '')};
      var _rs = ${JSON.stringify(finalReplySelector || '')};
      var _mt = ${monitorTimeout || 0};
      if (_hs) window.__monitorHeartbeatSelector = _hs;
      if (_rs) window.__monitorReplySelector = _rs;
      if (_mt && _mt > 0) window.__monitorTimeout = _mt;
      console.log('[Main] [API] ✅ 已设置监控参数:', {
        heartbeatSelector: window.__monitorHeartbeatSelector,
        replySelector: window.__monitorReplySelector,
        monitorTimeout: window.__monitorTimeout
      });
      // 3. 清理 webview 内部的旧状态
      var wv = document.getElementById('previewWebview');
      if (wv) {
        wv.executeJavaScript('delete window.__expandedElements; delete window.__apiMonitorObserver; delete window.__apiMonitorTargetNode; delete window.__lastDomChangeTime; delete window.__expandedThinkingCount; delete window.__apiMonitorUseMutation; delete window.__apiMonitorTargetFound; delete window.__apiMonitorInitTime; if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__activityMonitor){try{window.__activityMonitor.stop && window.__activityMonitor.stop();}catch(e){} delete window.__activityMonitor;}').catch(function(){});
      }
    })();`);
  } catch(e) { /* 忽略清理错误 */ }

  // 第一步：先监控网页活动状态（直接传入所有选择器和超时参数，由 renderer 内部处理优先级和降级）
  console.log('[Main] [API] 开始网页活动监控 - finalReplySelector:', finalReplySelector, '- heartbeatSelector:', heartbeatSelector, '- monitorTimeout:', monitorTimeout, 'ms');
  const activityResult = await waitForWebActivityToSettle({
    replySelector: finalReplySelector,
    heartbeatSelector: heartbeatSelector,
    monitorTimeout: monitorTimeout
  });
  console.log('[Main] [API] 网页活动监控结果:', activityResult.status, activityResult.message);

  // 🛑 额外清理：确保 webview 内部的展开计时器被停止（防止 AI 回复结束后还反复点击折叠面板）
  try {
    await mainWindow.webContents.executeJavaScript(`(function(){
      try {
        var wv = document.getElementById('previewWebview');
        if (wv) {
          wv.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();} if(window.__activityMonitor && window.__activityMonitor.stop){window.__activityMonitor.stop();}');
        }
      } catch(e) {}
    })();`);
  } catch(e) { /* 忽略清理错误 */ }

  // 如果网页还在活动中，返回提示信息让前端等待
  if (activityResult.status === 'active') {
    return {
      success: false,
      waiting: true,
      message: '网页还在活动中（网页还在执行任务！）',
      bookmark: {
        index: bookmarkIndex,
        name: bookmark.name,
        url: bookmark.url,
        category: bookmark.category
      }
    };
  }

  // 第二步：网页活动已稳定，执行元素内容获取
  console.log('[Main] [API] 网页活动已稳定，开始获取元素内容');

  const safeSelector = finalReplySelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  // 📌 注意：「正在思考」折叠面板的展开已移到 waitForActivityToComplete（即监控阶段）
  //    这样能确保：1)在监控开始时就展开思考内容；2)监控逻辑能看到完整的内容变化；3)最后抓取时内容已是展开状态

  const jsCode = `(async function() {
    try {
      const webview = document.getElementById('previewWebview');
      if (!webview) {
        return JSON.stringify({ success: false, error: '未找到 previewWebview 元素' });
      }

      var currentUrl = webview.getURL();
      if (!currentUrl) {
        return JSON.stringify({ success: false, error: '网页预览尚未加载，请先预览卡片' });
      }

      const selector = '${safeSelector}';
      const escapedSelector = selector.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");

      const captureJs = "(function() { try { console.log('[Webview] 查找选择器:', '" + escapedSelector + "'); var elements = document.querySelectorAll('" + escapedSelector + "'); if (!elements.length) { return JSON.stringify({ success: false, error: '未找到匹配元素' }); } console.log('[Webview] 找到', elements.length, '个匹配元素'); var targetEl = null; var candidates = []; for (var idx = 0; idx < elements.length; idx++) { var candidate = elements[idx]; if (!candidate) continue; var style = window.getComputedStyle(candidate); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue; var text = candidate.innerText || candidate.textContent || ''; text = text.trim(); if (text && text.length >= 10) { candidates.push({ el: candidate, text: text, len: text.length, index: idx }); } } console.log('[Webview] 可见且有效的候选元素:', candidates.length, '个'); if (candidates.length === 0) { return JSON.stringify({ success: false, error: '未找到可见的有效元素' }); } targetEl = candidates[candidates.length - 1].el; console.log('[Webview] ✅ 选择最后一个有效元素（索引:', candidates[candidates.length - 1].index, ', 长度:', candidates[candidates.length - 1].len, ')'); var text = targetEl.innerText || targetEl.textContent || ''; text = text.replace(/^思考完成[：:]\\\\s*/i, ''); text = text.replace(/^准备输出结果[：:]\\\\s*/i, ''); text = text.trim(); var elementHtml = targetEl.innerHTML || ''; const isVisible = targetEl.offsetWidth > 0 && targetEl.offsetHeight > 0; if (text && text.length >= 10 && isVisible) { console.log('[Webview] 找到符合条件的元素'); console.log('[Webview] HTML长度:', elementHtml.length); return JSON.stringify({ success: true, content: text, html: elementHtml, element: { tag: targetEl.tagName ? targetEl.tagName.toLowerCase() : 'unknown', id: targetEl.id || '', className: targetEl.className || '' }, length: text.length }); } else { return JSON.stringify({ success: false, error: '元素内容不足（<10字符）或不可见' }); } } catch (e) { console.error('[Webview] 执行错误:', e); return JSON.stringify({ success: false, error: e.toString() }); } })();";

      return webview.executeJavaScript(captureJs, true);
    } catch(e) {
      return JSON.stringify({ success: false, error: e.toString() });
    }
  })();`;

  const resultStr = await mainWindow.webContents.executeJavaScript(jsCode);
  let result;
  try { result = JSON.parse(resultStr); } catch(e) { result = { success: false, error: '解析失败: ' + e.message }; }

  if (!result || !result.success) {
    throw new Error(result && result.error ? result.error : '获取元素内容失败');
  }

  // 🔍 最后：获取 webview 内部的实际监控状态（用于诊断显示给用户）
  var webviewDebug = null;
  try {
    webviewDebug = await mainWindow.webContents.executeJavaScript(`(function(){
      try {
        var wv = document.getElementById('previewWebview');
        if(!wv) return { error: 'previewWebview 不存在' };
        var debugStr = wv.executeJavaScript('(function(){ return JSON.stringify({ monitorTargetNodeTag: window.__apiMonitorTargetNode ? window.__apiMonitorTargetNode.tagName : null, monitorTargetNodeTextLen: window.__apiMonitorTargetNode ? (window.__apiMonitorTargetNode.innerText || "").length : 0, lastDomChangeTime: window.__lastDomChangeTime || 0, secondsSinceLastChange: window.__lastDomChangeTime ? Math.round((Date.now() - window.__lastDomChangeTime)/1000) : null, idleTimeout: window.__apiMonitorIdleTimeout || null, selectorSource: window.__apiMonitorSelectorSource || null, useMutation: window.__apiMonitorUseMutation || false, expandedThinkingCount: window.__expandedThinkingCount || 0 }); })();');
        return JSON.parse(debugStr);
      } catch(e) { return { error: e.toString() }; }
    })();`);
  } catch(e) { /* 忽略诊断错误 */ }

  // 🔍 【关键改进】判断每个参数的实际来源
  //    params 优先（前端直接传的），其次 bookmarks.json，最后是默认值
  function resolveField(fieldName) {
    const paramVal = params && params[fieldName];
    const bookmarkVal = bookmark[fieldName] || bookmark[fieldName.replace(/([A-Z])/g, '_$1').toLowerCase()] || '';
    if (paramVal) return { value: paramVal, source: '前端 params' };
    if (bookmarkVal) return { value: bookmarkVal, source: '后端 bookmarks.json' };
    return { value: '', source: '默认（空）' };
  }
  const _rs = resolveField('finalReplySelector');
  const _hs = resolveField('heartbeatSelector');
  const _mt = resolveField('monitorTimeout');

  return {
    success: true,
    content: result.content || '',
    html: result.html || result.elementHtml || '',
    element: result.element || null,
    length: result.length || 0,
    bookmark: {
      index: bookmarkIndex,
      name: bookmark.name,
      url: bookmark.url,
      category: bookmark.category,
      replySelector: finalReplySelector,
      heartbeatSelector: heartbeatSelector || '',
      monitorTimeout: monitorTimeout || 0
    },
    // 🔍 诊断信息：清晰显示"实际使用的参数来源"
    debugInfo: {
      // 前端直接传的参数（实际起作用的）
      _rawParams: JSON.parse(JSON.stringify(params || {})),
      // 后端 bookmarks.json 读到的参数（作为兜底）
      _rawBookmark: JSON.parse(JSON.stringify(bookmark)),
      // 每个字段的实际使用值和来源
      replySelector: finalReplySelector,
      replySelectorSource: _rs.source,
      heartbeatSelector: heartbeatSelector || '',
      heartbeatSelectorSource: _hs.source,
      monitorTimeoutMs: monitorTimeout || 0,
      monitorTimeoutSource: _mt.source,
      actualMonitorSelector: monitorSelector,
      monitorSelectorSource: monitorSource,
      activityMonitorStatus: activityResult.status,
      activityMonitorMessage: activityResult.message,
      webviewInternalState: webviewDebug || {},
      capturedAt: new Date().toISOString()
    },
    capturedAt: new Date().toISOString()
  };
}

function init(shared) {
  getMainWindow = shared.getMainWindow;
  APP_VERSION = shared.APP_VERSION;
  loadBookmarksForAPI = shared.loadBookmarksForAPI;
  lastUsedServiceCard = shared.lastUsedServiceCard;

ipcMain.handle('desktop-app-send-message', async (event, data) => {
  const { appName, message, method = 'clipboard', activateDelay = 500, waitAnswerDelay = 15000, copyXRatio, copyYRatio, mdXRatio, mdYRatio, inputFocusXRatio = 0.5, inputFocusYRatio = 0.8, winWidth = 950, winHeight = 920, winX = 0, winY = 0 } = data;

  try {
    console.log(`[Main] 🖥️ 桌面APP发送消息: ${appName}`);
    console.log(`[Main]    消息内容: ${message.substring(0, 50)}...`);
    console.log(`[Main]    复制按钮比例: x=${copyXRatio}, y=${copyYRatio}`);
    console.log(`[Main]    Markdown项比例: x=${mdXRatio}, y=${mdYRatio}`);

    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '桌面APP自动化仅支持 macOS 系统' };
    }

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"，请检查应用名称是否正确` };
    }

    // 用 pbcopy 设置剪贴板
    const clipboardScript = `printf '%s' "${message.replace(/'/g, "'\\''").replace(/"/g, '\\"')}" | pbcopy`;
    execSync(clipboardScript, { shell: '/bin/bash', timeout: 5000 });
    console.log('[Main]    已设置剪贴板内容');

    // 激活应用
    const activateScript = `
      tell application "${bundleName}"
        activate
      end tell
    `;
    execSync(`osascript -e '${activateScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 });
    console.log('[Main]    已激活应用');

    // 等待应用激活
    await new Promise(resolve => setTimeout(resolve, activateDelay));

    // 使用 JXA (JavaScript for Automation) 执行，确保严格串行
    const waitSec = Math.max(waitAnswerDelay / 1000, 5);
    const totalTimeout = Math.max((waitSec + 20) * 1000, 60000);

    // 如果有校准比例，用游标定位点击复制为Markdown；否则用旧的快捷键方式
    const useImageClick = copyXRatio && copyYRatio && mdXRatio && mdYRatio;
    console.log(`[Main]    复制方式: ${useImageClick ? '游标定位点击复制为Markdown' : '快捷键方式(Cmd+A+C)'}`);

    let script;
    if (useImageClick) {
      script = `
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.5);

      // 等待窗口加载（最多6秒）
      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      // Step 0: 设置窗口大小和位置
      win.size = [${winWidth}, ${winHeight}];
      win.position = [${winX}, ${winY}];
      delay(0.3);

      // Step 1: 点击输入框确保焦点（独立视窗中间偏下位置）
      var w = win.size()[0];
      var h = win.size()[1];
      win.click({ at: [w * 0.5, h * 0.7] });
      se.keystroke("a", { using: ["command down"] });
      delay(0.5);

      // Step 2: 粘贴消息到输入框
      se.keystroke('v', { using: 'command down' });
      delay(0.5);

      // Step 3: 按回车发送
      se.keystroke(String.fromCharCode(13));
      delay(0.5);

      // Step 4: 等待 AI 回答完成（${waitSec} 秒）
      delay(${waitSec});

      // Step 5: 游标定位点击复制为Markdown
      ObjC.import('CoreGraphics');
      ObjC.import('AppKit');

      var winPos = win.position();
      var winSize = win.size();

      // 前置步骤：移到窗口中间并点击（确保窗口有焦点）
      var centerX = winPos[0] + winSize[0] * 0.5;
      var centerY = winPos[1] + winSize[1] * 0.5;
      var centerPoint = $.CGPointMake(centerX, centerY);
      $.CGWarpMouseCursorPosition(centerPoint);
      delay(0.2);

      // 点击窗口中间
      var clickDown = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, centerPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, clickDown);
      delay(0.1);
      var clickUp = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, centerPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, clickUp);
      delay(0.3);

      // 滚动到最底部（使用鼠标滚轮快速滚动）
      for (var i = 0; i < 20; i++) {
        var scrollEvent = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, -150, 0);
        $.CGEventPost($.kCGHIDEventTap, scrollEvent);
        delay(0.05);
      }
      delay(0.3);

      // 5.1 移到复制按钮
      var copyX = winPos[0] + winSize[0] * ${copyXRatio};
      var copyY = winPos[1] + winSize[1] * ${copyYRatio};
      var point1 = $.CGPointMake(copyX, copyY);
      $.CGWarpMouseCursorPosition(point1);

      // 模拟鼠标移动事件（触发悬停检测）
      var offset = 3;
      var movePoint1 = $.CGPointMake(copyX + offset, copyY + offset);
      var moveEvent1 = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, movePoint1, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvent1);
      delay(0.05);
      var movePoint2 = $.CGPointMake(copyX, copyY);
      var moveEvent2 = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, movePoint2, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvent2);

      delay(1.2);

      // 5.2 移到复制为Markdown菜单项
      var mdX = winPos[0] + winSize[0] * ${mdXRatio};
      var mdY = winPos[1] + winSize[1] * ${mdYRatio};
      var point2 = $.CGPointMake(mdX, mdY);
      $.CGWarpMouseCursorPosition(point2);

      // 同样模拟移动事件
      var movePoint3 = $.CGPointMake(mdX + offset, mdY + offset);
      var moveEvent3 = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, movePoint3, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvent3);
      delay(0.05);
      var movePoint4 = $.CGPointMake(mdX, mdY);
      var moveEvent4 = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, movePoint4, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, moveEvent4);

      delay(0.2);

      // 5.3 点击鼠标左键
      var clickPoint = $.CGPointMake(mdX, mdY);
      var event = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, clickPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, event);
      delay(0.1);
      var eventUp = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, clickPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, eventUp);

      //delay(2.0);

      // 5.4 将游标移到输入区，点击恢复焦点
      // 重新获取窗口位置和大小，确保坐标准确（与复制为Markdown路径一致）
      winPos = win.position();
      winSize = win.size();
      var inputX = winPos[0] + winSize[0] * ${inputFocusXRatio};
      var inputY = winPos[1] + winSize[1] * ${inputFocusYRatio};
      var inputPoint = $.CGPointMake(inputX, inputY);
      $.CGWarpMouseCursorPosition(inputPoint);
      //delay(5.0);
      var inputClickDown = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, inputPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, inputClickDown);
      delay(0.1);
      var inputClickUp = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, inputPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, inputClickUp);

      'done';
    `;
    } else {
      script = `
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.5);

      // 等待窗口加载（最多6秒）
      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      // Step 0: 设置窗口大小和位置
      win.size = [${winWidth}, ${winHeight}];
      win.position = [${winX}, ${winY}];
      delay(0.3);

      // Step 1: 点击输入框确保焦点（独立视窗中间偏下位置）
      var w = win.size()[0];
      var h = win.size()[1];
      win.click({ at: [w * 0.5, h * 0.7] });
      se.keystroke("a", { using: ["command down"] });
      delay(0.5);

      // Step 2: 粘贴消息到输入框
      se.keystroke('v', { using: 'command down' });
      delay(0.5);

      // Step 3: 按回车发送
      se.keystroke(String.fromCharCode(13));
      delay(0.5);

      // Step 4: 等待 AI 回答完成（${waitSec} 秒）
      delay(${waitSec});

      // Step 4.5: 前置准备 - 点击画面中间并滚动到底部
      ObjC.import('CoreGraphics');
      ObjC.import('AppKit');
      var winPos = win.position();
      var winSize = win.size();
      var centerX = winPos[0] + winSize[0] * 0.5;
      var centerY = winPos[1] + winSize[1] * 0.5;
      var centerPoint = $.CGPointMake(centerX, centerY);
      $.CGWarpMouseCursorPosition(centerPoint);
      delay(0.2);
      var clickDown = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, centerPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, clickDown);
      delay(0.1);
      var clickUp = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, centerPoint, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, clickUp);
      delay(0.3);
      // 滚动到最底部
      for (var i = 0; i < 20; i++) {
        var scrollEvent = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, -150, 0);
        $.CGEventPost($.kCGHIDEventTap, scrollEvent);
        delay(0.05);
      }
      delay(0.3);

      // Step 5: 按 Shift+Tab 让焦点离开输入区
      se.keystroke('\\t', { using: 'shift down' });
      delay(0.5);      

      // Step 6: 按 Cmd+A 全选回答内容
      se.keystroke('a', { using: 'command down' });
      delay(0.5);

      // Step 7: 按 Cmd+C 复制到剪贴板
      se.keystroke('c', { using: 'command down' });
      delay(3.0);

      // Step 8: 按 Tab 让游标回到输入区
      se.keystroke('\\t');   
      delay(0.5);

      // Step 9: 按 ESC 关闭独立视窗
      se.keystroke(String.fromCharCode(27));
    `;
    }

    console.log(`[Main]    开始执行串行 JXA 脚本（超时${totalTimeout}ms）`);
    execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: totalTimeout });
    console.log('[Main]    JXA 脚本执行完成');

    // 等待输入区点击完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 将焦点转回 Electron 应用（单独执行，避免超时）
    try {
      execSync(`osascript -e 'tell application "无限空间·AI智控台" to activate'`, { timeout: 5000 });
      console.log('[Main]    已将焦点转回 Electron');
    } catch (e) {
      try {
        execSync(`osascript -e 'tell application "Electron" to activate'`, { timeout: 5000 });
        console.log('[Main]    已将焦点转回 Electron');
      } catch (e2) {
        console.log('[Main]    ️ 转回 Electron 失败（不影响结果）');
      }
    }

    // 等待剪贴板更新
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 获取剪贴板内容
    const clipboardContent = execSync('pbpaste', { timeout: 5000 }).toString().trim();
    console.log(`[Main]    剪贴板内容长度: ${clipboardContent.length} 字符`);
    console.log(`[Main]    剪贴板内容预览: ${clipboardContent.substring(0, 300)}`);

    if (clipboardContent.length === 0) {
      console.log('[Main]    ⚠️ 剪贴板为空，可能复制失败');
    }

    console.log('[Main] ✅ 桌面APP消息发送成功并获取回答');
    return {
      success: true,
      answer: clipboardContent,
      answerPreview: clipboardContent.substring(0, 200) + '...'
    };

  } catch (error) {
    console.error('[Main] ❌ 桌面APP消息发送失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('desktop-app-activate', async (event, appName) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    
    if (os.platform() !== 'darwin') {
      return { success: false, error: '桌面APP自动化仅支持 macOS 系统' };
    }
    
    const bundleName = await findAppBundleName(appName);
    
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }
    
    // 用 AppleScript 激活应用（比 open -a 更好，能保留窗口状态和焦点）
    const activateScript = `
      tell application "${bundleName}"
        activate
      end tell
    `;
    execSync(`osascript -e '${activateScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 });
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 移动游标到复制按钮
ipcMain.handle('desktop-app-move-copy-btn', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '桌面APP自动化仅支持 macOS 系统' };
    }

    const appName = typeof data === 'string' ? data : data.appName;
    const xRatio = data.xRatio;
    const yRatio = data.yRatio;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    // 如果有保存的比例，直接用比例计算
    if (xRatio !== undefined && yRatio !== undefined) {
      const script = `
        var app = Application('${bundleName}');
        app.activate();
        delay(0.5);
        var se = Application('System Events');
        var proc = se.processes.byName('${bundleName}');
        proc.frontmost = true;
        delay(0.3);
        var win = null;
        for (var retry = 0; retry < 20; retry++) {
          try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
          delay(0.3);
        }
        if (!win) { throw new Error('error: 无法获取窗口'); }
        var winPos = win.position();
        var winSize = win.size();
        var targetX = winPos[0] + winSize[0] * ${xRatio};
        var targetY = winPos[1] + winSize[1] * ${yRatio};
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(targetX, targetY);
        $.CGWarpMouseCursorPosition(point);
        'moved to ' + Math.round(targetX) + ',' + Math.round(targetY);
      `;
      const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }).toString().trim();
      console.log(`[Main]    按比例移动游标: ${result}`);
      return { success: true };
    }

    // 没有保存的比例，尝试用 UI 元素查找（降级方案）
    const script = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.5);
      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }
      var winPos = win.position();
      var winSize = win.size();

      function collectElements(el, arr, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 20) return;
        try {
          var role = el.role();
          var p = el.position();
          var s = el.size();
          var desc = '';
          try { desc = el.description(); } catch(e) {}
          var title = '';
          try { title = el.title(); } catch(e) {}
          var subrole = '';
          try { subrole = el.subrole(); } catch(e) {}
          arr.push({x: p[0], y: p[1], w: s[0], h: s[1], role: role, subrole: subrole, desc: desc, title: title, depth: depth});
        } catch(e) { return; }
        try {
          var children = el.UIElements();
          for (var i = 0; i < children.length; i++) {
            collectElements(children[i], arr, depth + 1);
          }
        } catch(e) {}
      }

      var allEls = [];
      collectElements(win, allEls);
      var total = allEls.length;

      var copyBtn = null;

      // 方法1：用"复制"关键字查找
      for (var i = 0; i < allEls.length; i++) {
        var b = allEls[i];
        var text = (b.desc || '') + ' ' + (b.title || '') + ' ' + (b.subrole || '');
        if (text.indexOf('复制') >= 0 || text.indexOf('copy') >= 0 || text.indexOf('Copy') >= 0) {
          copyBtn = b;
          break;
        }
      }

      // 方法2：相对位置法 — 找输入框上方一排最左边的按钮
      if (!copyBtn) {
        var textFields = allEls.filter(function(e) {
          return e.role === 'AXTextField' || e.role === 'AXTextArea';
        });

        if (textFields.length > 0) {
          textFields.sort(function(a, b) { return b.y - a.y; });
          var inputField = textFields[0];

          var targetY = inputField.y - 56;
          var tolerance = 40;

          var rowBtns = allEls.filter(function(e) {
            if (e.role !== 'AXButton' && e.subrole.indexOf('Button') < 0) return false;
            var btnCenterY = e.y + e.h / 2;
            return btnCenterY < inputField.y && Math.abs(btnCenterY - targetY) < tolerance && e.w > 5 && e.h > 5;
          });

          if (rowBtns.length === 0) {
            rowBtns = allEls.filter(function(e) {
              if (e.w < 8 || e.h < 8) return false;
              if (e.w > 200 || e.h > 200) return false;
              var btnCenterY = e.y + e.h / 2;
              return btnCenterY < inputField.y && Math.abs(btnCenterY - targetY) < tolerance;
            });
          }

          if (rowBtns.length > 0) {
            rowBtns.sort(function(a, b) { return a.x - b.x; });
            copyBtn = rowBtns[0];
          }
        }
      }

      if (copyBtn) {
        var btnCx = copyBtn.x + copyBtn.w / 2;
        var btnCy = copyBtn.y + copyBtn.h / 2;
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(btnCx, btnCy);
        $.CGWarpMouseCursorPosition(point);
        'found total=' + total + ' role=' + copyBtn.role + ' at ' + btnCx + ',' + btnCy;
      } else {
        'not found, total=' + total;
      }
    `;
    const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
    console.log(`[Main]    复制按钮查找结果: ${result}`);
    if (result.indexOf('found') >= 0) {
      return { success: true };
    } else {
      return { success: false, error: '未找到复制按钮，请先校准位置' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 校准复制按钮位置：step=1 校准复制按钮，step=2 校准复制为Markdown菜单项
// 录制定位点：开启APP，等待用户移动游标，返回偏移坐标
ipcMain.handle('desktop-app-record-anchor', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const delaySeconds = data.delay || 5;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    // 先用 AppleScript 激活应用（更可靠）
    try {
      execSync(`osascript -e 'tell application "${bundleName}" to activate'`, { timeout: 10000 });
      console.log(`[Main] 已激活应用: ${bundleName}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      console.error(`[Main] 激活应用失败:`, e.message);
    }

    const script = `
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(1);

      var win = null;
      for (var retry = 0; retry < 30; retry++) {
        try {
          win = proc.windows[0];
          var _s = win.size();
          break;
        } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      delay(${delaySeconds});
      
      win = null;
      for (var retry = 0; retry < 10; retry++) {
        try {
          win = proc.windows[0];
          var _s2 = win.size();
          break;
        } catch (e) { win = null; }
        delay(0.1);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      var winPos = win.position();
      var winSize = win.size();
      ObjC.import('AppKit');
      var mouse = $.NSEvent.mouseLocation;
      var screenH = $.NSScreen.mainScreen.frame.size.height;
      var mouseYTop = screenH - mouse.y;
      var offsetX = mouse.x - winPos[0];
      var offsetY = mouseYTop - winPos[1];
      'offsetX:' + offsetX.toFixed(2) + ',offsetY:' + offsetY.toFixed(2) + ',winWidth:' + winSize[0] + ',winHeight:' + winSize[1] + ',winX:' + winPos[0] + ',winY:' + winPos[1];
    `;
    const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 30000 }).toString().trim();
    console.log(`[Main] 录制定位点结果: ${result}`);

    const xMatch = result.match(/offsetX:([\d.]+)/);
    const yMatch = result.match(/offsetY:([\d.]+)/);
    const wMatch = result.match(/winWidth:(\d+)/);
    const hMatch = result.match(/winHeight:(\d+)/);
    const xPosMatch = result.match(/winX:([\d.]+)/);
    const yPosMatch = result.match(/winY:([\d.]+)/);
    if (!xMatch || !yMatch) {
      return { success: false, error: '录制定位点失败，无法解析坐标' };
    }

    const offsetX = parseFloat(xMatch[1]);
    const offsetY = parseFloat(yMatch[1]);
    const winWidth = wMatch ? parseInt(wMatch[1]) : 950;
    const winHeight = hMatch ? parseInt(hMatch[1]) : 920;
    const winX = xPosMatch ? parseFloat(xPosMatch[1]) : 0;
    const winY = yPosMatch ? parseFloat(yPosMatch[1]) : 0;

    console.log(`[Main] 定位点偏移: offsetX=${offsetX.toFixed(2)}, offsetY=${offsetY.toFixed(2)}`);
    console.log(`[Main] 窗口大小: ${winWidth}x${winHeight}, 位置: (${winX}, ${winY})`);
    return { success: true, offsetX, offsetY, winWidth, winHeight, winX, winY };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 回放单个定位点：开启APP，将游标移到指定偏移位置并停留
ipcMain.handle('desktop-app-replay-anchor', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const offsetX = data.offsetX;
    const offsetY = data.offsetY;
    const winWidth = data.winWidth || 950;
    const winHeight = data.winHeight || 920;
    const duration = data.duration || 2;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    const script = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);

      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      win.size = [${winWidth}, ${winHeight}];
      delay(0.3);

      var winPos = win.position();
      var targetX = winPos[0] + ${offsetX};
      var targetY = winPos[1] + ${offsetY};

      // CGWarpMouseCursorPosition 与 win.position() 同为左上角原点，无需转换 Y
      ObjC.import('CoreGraphics');
      var pt = $.CGPointMake(targetX, targetY);
      $.CGWarpMouseCursorPosition(pt);
      delay(${duration});
      'success';
    `;
    const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
    console.log(`[Main] 回放定位点结果: ${result}`);

    if (result === 'success') {
      return { success: true };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取APP窗口信息（位置和大小）
ipcMain.handle('desktop-app-get-window-info', async (event, appName) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    const script = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);

      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      var winPos = win.position();
      var winSize = win.size();
      'x:' + winPos[0] + ',y:' + winPos[1] + ',width:' + winSize[0] + ',height:' + winSize[1];
    `;
    const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
    console.log(`[Main] 获取窗口信息结果: ${result}`);

    const xMatch = result.match(/x:([\d.]+)/);
    const yMatch = result.match(/y:([\d.]+)/);
    const wMatch = result.match(/width:(\d+)/);
    const hMatch = result.match(/height:(\d+)/);
    if (!xMatch || !yMatch || !wMatch || !hMatch) {
      return { success: false, error: '无法解析窗口信息' };
    }

    const x = parseFloat(xMatch[1]);
    const y = parseFloat(yMatch[1]);
    const width = parseInt(wMatch[1]);
    const height = parseInt(hMatch[1]);

    console.log(`[Main] 窗口信息: 位置(${x}, ${y}), 大小(${width}x${height})`);
    return { success: true, x, y, width, height };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 设置APP窗口信息（位置和大小）
ipcMain.handle('desktop-app-set-window-info', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const x = data.x || 0;
    const y = data.y || 0;
    const width = data.width || 950;
    const height = data.height || 920;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    const script = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);

      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      win.size = [${width}, ${height}];
      delay(0.3);
      win.position = [${x}, ${y}];
      delay(0.3);
      'success';
    `;
    const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
    console.log(`[Main] 设置窗口信息结果: ${result}`);

    if (result === 'success') {
      return { success: true };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// JXA 脚本解释器：接收 steps 数组，生成并执行 JXA 代码
// 支持分段执行：按 Cmd+V 分割成多个小脚本，执行前设置剪贴板（使用 Electron clipboard API）
ipcMain.handle('run-automation-script', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const { clipboard } = require('electron');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const anchors = data.anchors || [];
    const steps = data.steps || [];
    const windowSettings = data.window || { width: 950, height: 920, x: 0, y: 0 };

    // 补充设置步骤的 isCopyButton 属性：根据定位点的 isCopyButton 属性
    // 这样可以确保即使前端没有正确设置 step.isCopyButton，也能根据 anchor.isCopyButton 来识别复制按钮步骤
    for (const step of steps) {
      if (step.anchorId && step.anchorId > 0) {
        const anchor = anchors.find(a => a.id === step.anchorId);
        if (anchor && (anchor.isCopyButton === true || anchor.isCopyButton === 'true' || anchor.isCopyButton === 1)) {
          step.isCopyButton = true;
        }
      }
    }
    console.log('[Main] 📋 步骤 isCopyButton 补充设置完成，复制按钮步骤数: ' + steps.filter(s => s.isCopyButton === true).length);

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    // 第一步：激活应用并调整窗口大小和位置（使用 JXA 脚本，与「应用窗口」按钮相同）
    try {
      const { execSync } = require('child_process');
      const os = require('os');
      
      if (os.platform() === 'darwin') {
        const winScript = `
          var app = Application('${bundleName}');
          app.activate();
          delay(0.5);
          var se = Application('System Events');
          var proc = se.processes.byName('${bundleName}');
          proc.frontmost = true;
          delay(0.3);

          var win = null;
          for (var retry = 0; retry < 20; retry++) {
            try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
            delay(0.3);
          }
          if (!win) { throw new Error('error: 无法获取窗口'); }

          win.size = [${windowSettings.width}, ${windowSettings.height}];
          delay(0.3);
          win.position = [${windowSettings.x}, ${windowSettings.y}];
          delay(0.3);
          'success';
        `;
        
        const result = execSync(`osascript -l JavaScript -e '${winScript.replace(/'/g, "'\\''")}'`, { timeout: 15000 }).toString().trim();
        console.log(`[Main] 设置窗口信息结果: ${result}`);
        
        if (result === 'success') {
          console.log(`[Main] ✅ 已初始化窗口: ${windowSettings.width}x${windowSettings.height}, 位置: (${windowSettings.x}, ${windowSettings.y})`);
        } else {
          console.warn(`[Main] ⚠️ 窗口设置未成功: ${result}`);
        }
      } else {
        execSync(`osascript -e 'tell application "${bundleName}" to activate'`, { timeout: 10000 });
        console.log(`[Main] 已激活应用: ${bundleName}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.error(`[Main] 设置窗口失败:`, e.message);
    }

    // 找到所有 Cmd+V 步骤的位置和对应的粘贴内容（跳过已标记为 skip 的步骤）
    const pasteSteps = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.skip && step.action === 'keystroke' && step.pasteContent && step.modifiers && step.modifiers.includes('cmd') && step.key === 'v') {
        pasteSteps.push({ index: i, content: step.pasteContent });
      }
    }

    // 找到所有复制按钮步骤的位置（跳过已标记为 skip 的步骤）
    // 注意：isCopyButton 可能是布尔值或字符串，需要做宽松检测
    function isCopyButtonStep(step) {
      if (!step) return false;
      if (step.isCopyButton === true) return true;
      if (step.isCopyButton === 'true') return true;
      if (step.isCopyButton === 1) return true;
      return false;
    }
    
    const copyButtonSteps = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.skip && isCopyButtonStep(step)) {
        copyButtonSteps.push({ index: i });
      }
    }
    console.log('[Main] 📋 找到 ' + copyButtonSteps.length + ' 个复制按钮步骤:', copyButtonSteps.map(s => '步骤' + (s.index + 1)).join(', '));
    // 打印所有步骤的简要信息用于调试
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      console.log('[Main]   步骤' + (i + 1) + ': action=' + s.action + ', anchorId=' + s.anchorId + ', isCopyButton=' + s.isCopyButton + ', skip=' + s.skip);
    }

    // 合并粘贴步骤和复制按钮步骤，作为分割点
    const splitPoints = [
      ...pasteSteps.map(p => ({ index: p.index, type: 'paste', content: p.content })),
      ...copyButtonSteps.map(c => ({ index: c.index, type: 'copyButton' }))
    ].sort((a, b) => a.index - b.index);

    // 将步骤分割成多个片段
    const segments = [];
    let startIndex = 0;
    for (const splitPoint of splitPoints) {
      if (splitPoint.index > startIndex) {
        segments.push({ steps: steps.slice(startIndex, splitPoint.index), clipboardContent: null });
      }
      if (splitPoint.type === 'paste') {
        segments.push({ steps: [steps[splitPoint.index]], clipboardContent: splitPoint.content });
      } else if (splitPoint.type === 'copyButton') {
        segments.push({ steps: [steps[splitPoint.index]], clipboardContent: null });
      }
      startIndex = splitPoint.index + 1;
    }
    if (startIndex < steps.length) {
      segments.push({ steps: steps.slice(startIndex), clipboardContent: null });
    }
    if (segments.length === 0) {
      segments.push({ steps: steps, clipboardContent: null });
    }

    console.log(`[Main] 脚本分割为 ${segments.length} 个片段`);

    // 复制按钮只执行一次：在 Node.js 层面控制
    const fs = require('fs');
    const path = require('path');
    
    // 找到所有复制按钮步骤（使用 isCopyButtonStep 函数确保检测正确）
    const copyBtnStepIndices = steps.map((s, i) => isCopyButtonStep(s) ? i : -1).filter(i => i >= 0);
    console.log('[Main] isCopyButton 检测结果:', copyBtnStepIndices.map(i => '步骤' + (i+1)));
    if (copyBtnStepIndices.length <= 1) {
      console.log('[Main] 只有一个或没有复制按钮步骤，无需跳过');
    }
    
    // 标记是否已找到成功的复制按钮
    let copyButtonSucceeded = false;

    const generateJxaCode = (segmentSteps) => {
      let code = '';
      code += `var se = Application('System Events');\n`;
      code += `var proc = se.processes.byName('${bundleName}');\n`;
      code += `delay(0.5);\n\n`;
      code += `var win = null;\n`;
      code += `for (var retry = 0; retry < 30; retry++) {\n`;
      code += `  try {\n`;
      code += `    win = proc.windows[0];\n`;
      code += `    var _s = win.size();\n`;
      code += `    break;\n`;
      code += `  } catch(e) { win = null; }\n`;
      code += `  delay(0.3);\n`;
      code += `}\n`;
      code += `if (!win) { throw new Error('error: 无法获取窗口，请确保 ${bundleName} 已打开且有可见窗口'); }\n\n`;
      code += `// 确保窗口有焦点\n`;
      code += `proc.frontmost = true;\n`;
      code += `delay(0.3);\n\n`;

      let hasImportedObjC = false;
      const importObjC = `ObjC.import('CoreGraphics');\nObjC.import('AppKit');\nObjC.import('Foundation');\n`;

      for (let i = 0; i < segmentSteps.length; i++) {
        const step = segmentSteps[i];
        
        if (step.skip) {
          code += `// Step ${i+1}: ${step.action} (已跳过)\n\n`;
          continue;
        }
        
        // 生成动作代码到临时变量
        let actionCode = '';
        const origCode = code;
        code = '';
        
        switch (step.action) {
          case 'activateApp':
            code += `proc.frontmost = true;\ndelay(0.5);\n`;
            break;
          case 'setWindow':
            code += `win.size = [${step.width}, ${step.height}];\ndelay(0.3);\n`;
            break;
          case 'setWindowPos':
            code += `win.position = [${step.x}, ${step.y}];\ndelay(0.3);\n`;
            break;
          case 'moveAndClick': {
            if (!hasImportedObjC) { code += importObjC; hasImportedObjC = true; }
            const anchor = anchors.find(a => a.id === step.anchorId);
            if (anchor) {
              code += `var winPos = win.position();\n`;
              code += `var targetX = winPos[0] + ${anchor.offsetX};\n`;
              code += `var targetY = winPos[1] + ${anchor.offsetY};\n`;
              code += `var pt = $.CGPointMake(targetX, targetY);\n`;
              code += `$.CGWarpMouseCursorPosition(pt);\ndelay(0.2);\n`;
              if (!step.noClick) {
                code += `var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft);\n`;
                code += `$.CGEventPost($.kCGHIDEventTap, down);\ndelay(0.1);\n`;
                code += `var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft);\n`;
                code += `$.CGEventPost($.kCGHIDEventTap, up);\ndelay(0.3);\n`;
              }
            } else {
              code += `// 定位点${step.anchorId}未找到，跳过\n`;
            }
            break;
          }
          case 'moveAndHover': {
            if (!hasImportedObjC) { code += importObjC; hasImportedObjC = true; }
            const anchor = anchors.find(a => a.id === step.anchorId);
            if (anchor) {
              code += `var winPos = win.position();\n`;
              code += `var targetX = winPos[0] + ${anchor.offsetX};\n`;
              code += `var targetY = winPos[1] + ${anchor.offsetY};\n`;
              code += `var pt = $.CGPointMake(targetX, targetY);\n`;
              code += `$.CGWarpMouseCursorPosition(pt);\n`;
              code += `delay(${step.duration});\n`;
            } else {
              code += `// 定位点${step.anchorId}未找到，跳过\n`;
            }
            break;
          }
          case 'moveAndScroll': {
            if (!hasImportedObjC) { code += importObjC; hasImportedObjC = true; }
            const direction = step.direction || 'down';
            const times = step.times || 5;
            const isWheel = step.wheel || false;
            
            if (step.anchorId && step.anchorId > 0) {
              const anchor = anchors.find(a => a.id === step.anchorId);
              if (anchor) {
                code += `var winPos = win.position();\n`;
                code += `var targetX = winPos[0] + ${anchor.offsetX};\n`;
                code += `var targetY = winPos[1] + ${anchor.offsetY};\n`;
                code += `var pt = $.CGPointMake(targetX, targetY);\n`;
                code += `$.CGWarpMouseCursorPosition(pt);\ndelay(0.2);\n`;
              }
            }
            
            let deltaY = 0;
            let deltaX = 0;
            const scrollAmount = isWheel ? 150 : 150;
            switch (direction) {
              case 'up': deltaY = scrollAmount; break;
              case 'down': deltaY = -scrollAmount; break;
              case 'left': deltaX = scrollAmount; break;
              case 'right': deltaX = -scrollAmount; break;
            }
            code += `for (var s = 0; s < ${times}; s++) {\n`;
            code += `  var scrollEv = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, ${deltaY}, ${deltaX});\n`;
            code += `  $.CGEventPost($.kCGHIDEventTap, scrollEv);\n`;
            code += `  delay(0.05);\n`;
            code += `}\n`;
            code += `delay(0.3);\n`;
            break;
          }
          case 'keystroke': {
            const key = step.key;
            const mods = step.modifiers || [];
            const keyCodeMap = {
              'enter': 36, 'return': 36, 'escape': 53, 'esc': 53,
              'tab': 48, 'space': 49, 'backspace': 51, 'delete': 117,
              'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96,
              'f6': 97, 'f7': 98, 'f8': 100, 'f9': 101, 'f10': 109,
              'f11': 103, 'f12': 111, 'up': 126, 'down': 125,
              'left': 123, 'right': 124, 'home': 115, 'end': 119,
              'pageup': 116, 'pagedown': 121
            };
            const jxaMods = mods.map(m => {
              const map = { 'cmd': 'command', 'ctrl': 'control', 'shift': 'shift', 'alt': 'option' };
              return map[m] || m;
            });
            const modStr = jxaMods.length > 0 
              ? `, {using: ['${jxaMods.map(m => m + ' down').join('\', \'')}']}` 
              : '';
            
            if (keyCodeMap[key] !== undefined) {
              code += `se.keyCode(${keyCodeMap[key]}${modStr});\n`;
            } else {
              code += `se.keystroke('${key}'${modStr});\n`;
            }
            code += `delay(0.5);\n`;
            break;
          }
          case 'delay':
            code += `delay(${step.seconds});\n`;
            break;
          case 'clipboardPaste':
            code += `se.keystroke('v', {using: ['command down']});\ndelay(0.5);\n`;
            break;
          case 'clipboardCopy':
            code += `se.keystroke('c', {using: ['command down']});\ndelay(0.5);\n`;
            break;
          case 'open_app':
            code += `var mailApp = Application('Mail');\n`;
            code += `mailApp.activate();\n`;
            code += `delay(1);\n`;
            break;
          case 'new_email':
            code += `var mailApp = Application('Mail');\n`;
            code += `mailApp.make(new MailMessage());\n`;
            code += `delay(0.5);\n`;
            break;
          case 'set_sender': {
            const sender = step.target;
            code += `var mailApp = Application('Mail');\n`;
            code += `var account = mailApp.accounts.byName('${sender.split('@')[0]}');\n`;
            code += `if (account) {\n`;
            code += `  var messages = mailApp.messages;\n`;
            code += `  var msg = messages[messages.length - 1];\n`;
            code += `  msg.sender = account;\n`;
            code += `}\n`;
            code += `delay(0.3);\n`;
            break;
          }
          case 'set_to': {
            const to = step.target;
            code += `var mailApp = Application('Mail');\n`;
            code += `var messages = mailApp.messages;\n`;
            code += `var msg = messages[messages.length - 1];\n`;
            code += `msg.toRecipients.push('${to}');\n`;
            code += `delay(0.3);\n`;
            break;
          }
          case 'set_subject': {
            const subject = step.target;
            code += `var mailApp = Application('Mail');\n`;
            code += `var messages = mailApp.messages;\n`;
            code += `var msg = messages[messages.length - 1];\n`;
            code += `msg.subject = '${subject.replace(/'/g, "\\'")}';\n`;
            code += `delay(0.3);\n`;
            break;
          }
          case 'set_body': {
            const body = step.target;
            code += `var mailApp = Application('Mail');\n`;
            code += `var messages = mailApp.messages;\n`;
            code += `var msg = messages[messages.length - 1];\n`;
            code += `msg.content = '${body.replace(/'/g, "\\'").replace(/\\n/g, "\\\\n")}';\n`;
            code += `delay(0.3);\n`;
            break;
          }
          case 'send_email':
            code += `var mailApp = Application('Mail');\n`;
            code += `var messages = mailApp.messages;\n`;
            code += `var msg = messages[messages.length - 1];\n`;
            code += `mailApp.send(msg);\n`;
            code += `delay(1);\n`;
            break;
          case 'close_window':
            code += `se.keystroke('w', {using: ['command down']});\n`;
            code += `delay(0.5);\n`;
            break;
          default:
            code += `// 未知动作: ${step.action}\n`;
        }
        
        actionCode = code;
        code = origCode;
        
        // 直接添加动作代码（skip 的步骤已在循环开头 continue）
        code += `// Step ${i+1}: ${step.action}\n`;
        code += actionCode;

        code += `\n`;
      }

      code += `'success';\n`;
      return code;
    };

    const setClipboard = (content) => {
      if (!content) return;
      
      console.log(`[Main] setClipboard 开始处理内容: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
      
      if (content.startsWith('[文件]')) {
        const filePath = content.replace(/^\[文件\]\s*/, '').trim();
        console.log(`[Main] 文件路径: "${filePath}"`);
        
        try {
          const { execFileSync } = require('child_process');
          const fs = require('fs');
          
          if (!fs.existsSync(filePath)) {
            console.error(`[Main] 文件不存在: ${filePath}`);
            return;
          }
          
          const stat = fs.statSync(filePath);
          console.log(`[Main] 文件大小: ${stat.size} bytes`);
          
          const script = `set the clipboard to POSIX file "${filePath}" as alias`;
          console.log(`[Main] 执行 AppleScript: ${script}`);
          
          execFileSync('osascript', ['-e', script], { timeout: 5000 });
          console.log(`[Main] ✅ 文件剪贴板已设置: ${filePath}`);
          
          const formats = clipboard.availableFormats();
          console.log(`[Main] 剪贴板当前格式:`, formats);
          
          const files = clipboard.readFile();
          console.log(`[Main] 剪贴板读取文件:`, files);
        } catch (e) {
          console.error(`[Main] ❌ 设置文件剪贴板失败:`, e.message);
          
          try {
            const { nativeImage } = require('electron');
            const img = nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
              clipboard.writeImage(img);
              console.log(`[Main] 📷 备选方案: 图片已写入剪贴板`);
              const formats = clipboard.availableFormats();
              console.log(`[Main] 剪贴板当前格式:`, formats);
            } else {
              console.error(`[Main] ❌ 备选方案失败: NativeImage 创建为空`);
            }
          } catch (e2) {
            console.error(`[Main] ❌ 备选方案失败:`, e2.message);
          }
        }
      } else {
        try {
          clipboard.writeText(content);
          console.log(`[Main] ✅ 文本剪贴板已设置，长度: ${content.length}`);
          const formats = clipboard.availableFormats();
          console.log(`[Main] 剪贴板当前格式:`, formats);
        } catch (e) {
          console.error(`[Main] ❌ 设置文本剪贴板失败:`, e.message);
        }
      }
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // 如果已经找到成功的复制按钮，标记后续所有复制按钮步骤为跳过
      if (copyButtonSucceeded) {
        for (const step of segment.steps) {
          if (isCopyButtonStep(step)) {
            step.skip = true;
            console.log('[Main] ✅ 复制按钮已成功，标记步骤为 skip: ' + (step.action || 'unknown') + ' (anchorId=' + step.anchorId + ')');
          }
        }
      }
      
      // 过滤掉已跳过的步骤，确保不会执行
      const activeSteps = segment.steps.filter(s => !s.skip);
      
      // 如果这个片段包含未跳过的复制按钮步骤，执行前记录剪贴板内容
      let clipboardBefore = '';
      const hasCopyButtonInSegment = activeSteps.some(s => isCopyButtonStep(s));
      if (hasCopyButtonInSegment) {
        console.log('[Main] 📋 片段 ' + (i + 1) + ' 包含 ' + activeSteps.filter(s => isCopyButtonStep(s)).length + ' 个未跳过的复制按钮步骤，执行前记录剪贴板...');
        try {
          clipboardBefore = execSync('pbpaste', { timeout: 5000 }).toString();
          console.log('[Main] 执行前剪贴板内容长度: ' + clipboardBefore.length + ' 字符');
        } catch (e) {
          console.error('[Main] 读取剪贴板失败:', e.message);
        }
      }
      
      if (activeSteps.length === 0) {
        console.log('[Main] ⏭️  片段 ' + (i + 1) + ' 所有步骤已跳过，不执行 JXA');
        continue;
      }
      
      if (segment.clipboardContent) {
        console.log(`[Main] 执行片段 ${i + 1}/${segments.length}（${activeSteps.length} 个有效步骤），设置剪贴板内容: ${segment.clipboardContent.substring(0, 50)}...`);
        setClipboard(segment.clipboardContent);
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('[Main] 剪贴板设置完成，开始执行片段 ' + (i + 1));
      } else {
        console.log('[Main] 执行片段 ' + (i + 1) + '/' + segments.length + '（' + activeSteps.length + ' 个有效步骤）');
      }

      const code = generateJxaCode(activeSteps);
      // 估算执行时间（秒）：延迟步骤 + 移动悬停步骤 + 其他步骤（每个0.5秒）
      const estimatedTime = activeSteps.reduce((sum, s) => {
        if (s.action === 'delay') return sum + s.seconds;
        if (s.action === 'moveAndHover') return sum + (s.duration || 1);
        return sum + 0.5;
      }, 0) + 5; // 额外加5秒缓冲
      
      // 超时时间：至少3分钟，或估算时间的2倍（取较大值）
      // 原因：scrollDown等复杂操作实际耗时可能远超估算
      const timeout = Math.max(180000, estimatedTime * 2000);
      console.log(`[Main] 📊 片段 ${i + 1} 估算时间: ${estimatedTime}秒, 超时设置: ${timeout / 1000}秒`);

      try {
        // 用临时文件执行 JXA，避免 shell 单引号转义破坏代码
        const tmpFile = path.join(os.tmpdir(), 'ai-console-seg-' + i + '.jxa');
        fs.writeFileSync(tmpFile, code, 'utf-8');
        console.log('[Main] 片段 ' + (i + 1) + ' JXA 代码已写入: ' + tmpFile + ' (' + code.length + ' 字符)');
        const result = execSync('osascript -l JavaScript "' + tmpFile + '"', { timeout: timeout }).toString().trim();
        console.log('[Main] 片段 ' + (i + 1) + ' 执行结果: ' + result);
        
        if (result.startsWith('error:')) {
          return { success: false, error: result };
        }
      } catch (error) {
        console.error('[Main] 片段 ' + (i + 1) + ' 执行失败:', error.message);
        return { success: false, error: error.message };
      }
      
      // 如果这个片段包含复制按钮步骤，执行后检查剪贴板是否变化
      if (hasCopyButtonInSegment) {
        console.log('[Main] 📋 复制按钮步骤已执行，等待2秒后检查剪贴板...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒让复制完成
        try {
          const clipboardAfter = execSync('pbpaste', { timeout: 5000 }).toString();
          console.log('[Main] 执行后剪贴板内容长度: ' + clipboardAfter.length + ' 字符');
          
          // 检查剪贴板是否有新内容（不同于执行前）
          const hasNewContent = clipboardAfter.length > 0 && clipboardAfter !== clipboardBefore;
          
          if (hasNewContent) {
            console.log('[Main] ✅ 剪贴板有新内容，复制成功！后续复制按钮步骤将被跳过');
            copyButtonSucceeded = true;
          } else {
            console.log('[Main] ⚠️ 剪贴板无新内容，将继续执行下一个复制按钮步骤');
          }
        } catch (e) {
          console.error('[Main] 读取剪贴板失败:', e.message);
        }
      }
    }

    let clipboardContent = '';
    try {
      clipboardContent = execSync('pbpaste', { timeout: 5000 }).toString();
      console.log(`[Main] 剪贴板内容长度: ${clipboardContent.length} 字符`);
    } catch (e) {
      console.error(`[Main] 读取剪贴板失败:`, e.message);
    }

    return { success: true, steps: steps.length, clipboardContent: clipboardContent };
  } catch (error) {
    console.error(`[Main] 脚本执行失败:`, error.message);
    return { success: false, error: error.message };
  }
});

// 采集模板图片：等待5秒后以游标为中心裁剪图片
ipcMain.handle('desktop-app-capture-template', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const outputPath = data.outputPath;
    const size = data.size || 44;
    const delay = data.delay || 5;

    const scriptPath = path.join(__dirname, '..', 'scripts', 'capture_template.py');
    const cmd = `python3 "${scriptPath}" "${outputPath}" ${size} ${delay}`;
    const result = execSync(cmd, { timeout: 30000 }).toString().trim();
    console.log(`[Main]    采集模板结果: ${result}`);

    const parsed = JSON.parse(result);
    return parsed;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 图像识别查找模板：在窗口区域内查找模板图片
ipcMain.handle('desktop-app-find-template', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const path = require('path');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const templatePath = data.templatePath;
    const appName = data.appName;
    const threshold = data.threshold || 0.75;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    // 先激活 APP 并获取窗口位置
    const winScript = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);
      var win = proc.windows[0];
      var p = win.position();
      var s = win.size();
      p[0] + ',' + p[1] + ',' + s[0] + ',' + s[1];
    `;
    const winResult = execSync(`osascript -l JavaScript -e '${winScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 }).toString().trim();
    const parts = winResult.split(',');
    const winX = parseInt(parts[0]);
    const winY = parseInt(parts[1]);
    const winW = parseInt(parts[2]);
    const winH = parseInt(parts[3]);

    // 用图像识别在窗口区域内查找模板
    const scriptPath = path.join(__dirname, '..', 'scripts', 'find_template.py');
    const cmd = `python3 "${scriptPath}" "${templatePath}" ${winX} ${winY} ${winW} ${winH} ${threshold}`;
    const result = execSync(cmd, { timeout: 60000 }).toString().trim();
    console.log(`[Main]    图像识别结果: ${result}`);

    const parsed = JSON.parse(result);
    if (parsed.error) {
      return { success: false, error: parsed.error };
    }
    if (parsed.found) {
      return { success: true, x: parsed.center_x, y: parsed.center_y, confidence: parsed.confidence };
    } else {
      return { success: false, error: '未找到匹配的模板' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 图像识别版：一键复制为Markdown
ipcMain.handle('desktop-app-copy-markdown-by-image', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const path = require('path');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const copyTemplate = data.copyTemplate;
    const mdTemplate = data.mdTemplate;
    const threshold = data.threshold || 0.7;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    // 激活 APP
    const activateScript = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);
      var win = proc.windows[0];
      var p = win.position();
      var s = win.size();
      p[0] + ',' + p[1] + ',' + s[0] + ',' + s[1];
    `;
    const winResult = execSync(`osascript -l JavaScript -e '${activateScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 }).toString().trim();
    const parts = winResult.split(',');
    const winX = parseInt(parts[0]);
    const winY = parseInt(parts[1]);
    const winW = parseInt(parts[2]);
    const winH = parseInt(parts[3]);

    const findScriptPath = path.join(__dirname, '..', 'scripts', 'find_template.py');

    // 第一步：找复制按钮
    console.log(`[Main]    图像识别: 查找复制按钮...`);
    const cmd1 = `python3 "${findScriptPath}" "${copyTemplate}" ${winX} ${winY} ${winW} ${winH} ${threshold}`;
    const r1 = JSON.parse(execSync(cmd1, { timeout: 60000 }).toString().trim());
    if (!r1.found) {
      return { success: false, error: '未找到复制按钮' };
    }
    console.log(`[Main]    找到复制按钮: ${r1.center_x},${r1.center_y} (${r1.confidence})`);

    // 移动到复制按钮
    const move1Script = `
      ObjC.import('CoreGraphics');
      var point = $.CGPointMake(${r1.center_x}, ${r1.center_y});
      $.CGWarpMouseCursorPosition(point);
      'done';
    `;
    execSync(`osascript -l JavaScript -e '${move1Script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });

    // 等待下拉菜单出现
    console.log(`[Main]    等待下拉菜单...`);
    execSync('sleep 1.2', { timeout: 5000 });

    // 第二步：找复制为Markdown菜单项
    console.log(`[Main]    图像识别: 查找复制为Markdown...`);
    const cmd2 = `python3 "${findScriptPath}" "${mdTemplate}" ${winX} ${winY} ${winW} ${winH} ${threshold}`;
    const r2 = JSON.parse(execSync(cmd2, { timeout: 60000 }).toString().trim());
    if (!r2.found) {
      return { success: false, error: '未找到复制为Markdown菜单项' };
    }
    console.log(`[Main]    找到Markdown菜单项: ${r2.center_x},${r2.center_y} (${r2.confidence})`);

    // 移动到菜单项并点击
    const clickScript = `
      ObjC.import('CoreGraphics');
      var point = $.CGPointMake(${r2.center_x}, ${r2.center_y});
      $.CGWarpMouseCursorPosition(point);
      delay(0.2);
      var event = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, event);
      delay(0.1);
      var eventUp = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, eventUp);
      'done';
    `;
    execSync(`osascript -l JavaScript -e '${clickScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 });

    return { success: true, copyConfidence: r1.confidence, mdConfidence: r2.confidence };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 采集模板图片并返回 userData 路径
ipcMain.handle('desktop-app-capture-template-v2', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const path = require('path');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const index = data.index;
    const step = data.step;
    const size = data.size || 44;
    const delay = data.delay || 5;

    const userDataPath = app.getPath('userData');
    const outputPath = path.join(userDataPath, `template_${index}_${step}.png`);

    const scriptPath = path.join(__dirname, '..', 'scripts', 'capture_template.py');
    const cmd = `python3 "${scriptPath}" "${outputPath}" ${size} ${delay}`;
    const result = execSync(cmd, { timeout: 30000 }).toString().trim();
    console.log(`[Main]    采集模板 step${step} 结果: ${result}`);

    const parsed = JSON.parse(result);
    if (parsed.success) {
      parsed.templatePath = outputPath;
    }
    return parsed;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 🆕 截取屏幕指定区域（纯 Node.js 实现，使用 macOS screencapture -R）
ipcMain.handle('desktop-app-capture-region', async (event, data) => {
  try {
    const os = require('os');
    const path = require('path');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const { x, y, width, height } = data;
    if (width <= 0 || height <= 0) {
      return { success: false, error: '截图区域宽度和高度必须大于 0' };
    }

    const userDataPath = app.getPath('userData');
    const capturesDir = path.join(userDataPath, 'captures');
    if (!fs.existsSync(capturesDir)) {
      fs.mkdirSync(capturesDir, { recursive: true });
    }

    const filename = data.filename || `region_${Date.now()}.png`;
    const outputPath = path.join(capturesDir, filename);

    const cmd = `screencapture -x -R${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)} "${outputPath}"`;
    console.log('[Main]    执行区域截图:', cmd);
    execSync(cmd, { timeout: 15000 });

    const base64 = fs.readFileSync(outputPath).toString('base64');

    return {
      success: true,
      imagePath: outputPath,
      base64: `data:image/png;base64,${base64}`,
      region: { x, y, width, height }
    };
  } catch (error) {
    console.error('[Main]    区域截图失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 🆕 截图前预览：激活 APP、套用窗口设置，获取实际窗口位置后移动游标到截图左上角停留 2 秒
// 返回实际屏幕坐标，让截图使用真实窗口位置而非过期的 stored window 坐标
ipcMain.handle('desktop-app-preview-capture-region', async (event, data) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data.appName;
    const winX = data.winX || 0;
    const winY = data.winY || 0;
    const winWidth = data.winWidth || 950;
    const winHeight = data.winHeight || 920;
    const offsetX = data.offsetX || 0;
    const offsetY = data.offsetY || 0;
    const duration = data.duration || 2;

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    const script = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.5);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.3);

      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      win.size = [${winWidth}, ${winHeight}];
      delay(0.3);
      win.position = [${winX}, ${winY}];
      delay(0.3);

      var winPos = win.position();
      var targetX = winPos[0] + ${offsetX};
      var targetY = winPos[1] + ${offsetY};

      // CGWarpMouseCursorPosition 与 win.position() 同为左上角原点，无需转换 Y
      ObjC.import('CoreGraphics');
      var pt = $.CGPointMake(targetX, targetY);
      $.CGWarpMouseCursorPosition(pt);
      delay(${duration});

      JSON.stringify({
        success: true,
        x: targetX,
        y: targetY,
        winPos: winPos
      });
    `;

    const output = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 20000, encoding: 'utf8' }).trim();
    const lines = output.split('\\n');
    const jsonLine = lines[lines.length - 1];
    const result = JSON.parse(jsonLine);
    console.log('[Main] 截图区域预览完成，实际左上角:', result);
    return result;
  } catch (error) {
    console.error('[Main] 截图区域预览失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 🆕 记录截图区域左上角：参考「录制当前定位点」，不创建 Electron 全屏窗口，
// 而是隐藏主窗口、激活目标 APP，倒计时后记录当前鼠标位置作为左上角坐标。
ipcMain.handle('desktop-app-select-region', async (event, data) => {
  try {
    const os = require('os');
    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }

    const appName = data && data.appName ? data.appName : '';
    if (!appName) {
      return { success: false, error: '未指定应用名称' };
    }

    const bundleName = await findAppBundleName(appName);
    if (!bundleName) {
      return { success: false, error: `找不到应用 "${appName}"` };
    }

    const duration = (data && data.duration) ? data.duration : 3;

    const jxaScript = `
      var app = Application('${bundleName}');
      app.activate();
      delay(0.6);
      var se = Application('System Events');
      var proc = se.processes.byName('${bundleName}');
      proc.frontmost = true;
      delay(0.4);

      var win = null;
      for (var retry = 0; retry < 20; retry++) {
        try { win = proc.windows[0]; var _s = win.size(); break; } catch (e) { win = null; }
        delay(0.3);
      }
      if (!win) { throw new Error('error: 无法获取窗口'); }

      var winPos = win.position();

      ObjC.import('Cocoa');
      delay(${duration});

      var loc = $.NSEvent.mouseLocation;
      var screenH = $.NSScreen.mainScreen.frame.size.height;
      // NSEvent.mouseLocation 是左下角原点，需转成左上角原点才能与 win.position() 统一
      var locYTop = screenH - loc.y;
      JSON.stringify({
        success: true,
        point: { x: loc.x, y: locYTop },
        winPos: winPos
      });
    `;

    console.log(`[Main]    开始记录截图区域左上角，目标APP: ${appName}，倒计时: ${duration}秒`);
    const output = execSync(`osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\\''")}'`, {
      timeout: 15000,
      encoding: 'utf8'
    }).trim();

    console.log('[Main]    记录结果原始输出:', output);

    // 解析 JSON 结果
    const lines = output.split('\\n');
    const jsonLine = lines[lines.length - 1];
    const result = JSON.parse(jsonLine);
    return result;
  } catch (error) {
    console.error('[Main]    记录截图区域左上角失败:', error.message);
    return { success: false, error: error.message || '记录鼠标位置失败' };
  }
});

// 检查 APP 是否存在
ipcMain.handle('desktop-app-check-exists', async (event, appName) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    
    if (os.platform() !== 'darwin') {
      return { exists: false, error: '仅支持 macOS 系统' };
    }
    
    // 用 mdfind 搜索应用（更可靠）
    try {
      const result = execSync(`mdfind 'kMDItemKind == "Application" && (kMDItemDisplayName == "${appName}" || kMDItemFSName == "*${appName}*")'`, { timeout: 5000 });
      const paths = result.toString().trim().split('\n').filter(p => p);
      
      if (paths.length > 0) {
        const appPath = paths[0];
        const bundleName = appPath.split('/').pop().replace('.app', '');
        return { 
          exists: true,
          appName: appName,
          bundleName: bundleName,
          appPath: appPath
        };
      }
    } catch (e) {
      console.log('[Main]    mdfind 未找到匹配应用');
    }
    
    // 尝试直接检查 /Applications/ 目录
    try {
      const result = execSync(`ls /Applications/ | grep -i "${appName.replace(/"/g, '\\"')}"`, { timeout: 3000 });
      const bundles = result.toString().trim().split('\n').filter(p => p.endsWith('.app'));
      
      if (bundles.length > 0) {
        const bundleName = bundles[0].replace('.app', '');
        return { 
          exists: true,
          appName: appName,
          bundleName: bundleName,
          appPath: `/Applications/${bundles[0]}`
        };
      }
    } catch (e) {
      console.log('[Main]    /Applications/ 未找到匹配应用');
    }
    
    return { 
      exists: false,
      appName: appName,
      message: `未找到应用 "${appName}"，请检查应用名称`
    };
    
  } catch (error) {
    console.error('[Main] 检查APP存在失败:', error.message);
    return { exists: false, error: error.message };
  }
});

// 测试 APP UI 元素（用于调试）
ipcMain.handle('desktop-app-get-ui-elements', async (event, appName) => {
  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    
    if (os.platform() !== 'darwin') {
      return { success: false, error: '仅支持 macOS 系统' };
    }
    
    let bundleName = appName;
    
    try {
      execSync(`open -a "${bundleName}"`, { timeout: 3000 });
    } catch (e) {
      const searchResult = execSync(`ls /Applications/ | grep -i "${bundleName}"`, { timeout: 3000 });
      const bundles = searchResult.toString().trim().split('\n').filter(p => p.endsWith('.app'));
      if (bundles.length > 0) {
        bundleName = bundles[0].replace('.app', '');
      }
    }
    
    execSync(`open -a "${bundleName}"`, { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 先点击复制按钮（需要先找到位置）
    const clickScript = path.join(os.tmpdir(), 'click-copy-btn.scpt');
    const clickContent = `
      tell application "System Events"
        tell application process "${bundleName}"
          set winPos to position of window 1
          set winSize to size of window 1
          set clickX to (item 1 of winPos) + 280
          set clickY to (item 2 of winPos) + (item 2 of winSize) - 85
          click at {clickX, clickY}
          return "点击位置:{" & clickX & ", " & clickY & "}"
        end tell
      end tell
    `;
    fs.writeFileSync(clickScript, clickContent);
    execSync(`osascript "${clickScript}"`, { timeout: 5000 });
    fs.unlinkSync(clickScript);
    
    // 等待菜单弹出
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // 查找所有弹出的菜单
    const menuScript = path.join(os.tmpdir(), 'find-menu.scpt');
    const menuContent = `
      tell application "System Events"
        tell application process "${bundleName}"
          try
            return name of every menu item of every menu of window 1
          on error
            try
              return name of every menu item of every pop up button of window 1
            on error
              return name of every UI element of window 1 whose class is menu item
            end try
          end try
        end tell
      end tell
    `;
    fs.writeFileSync(menuScript, menuContent);
    
    let menuItems = [];
    try {
      const result = execSync(`osascript "${menuScript}"`, { timeout: 5000 });
      menuItems = result.toString().trim().split(', ');
    } catch (e) {
      menuItems = ['获取菜单失败'];
    }
    
    fs.unlinkSync(menuScript);
    
    console.log(`[UI测试] ${bundleName} 菜单项目列表:`);
    menuItems.forEach((item, i) => {
      console.log(`  [${i}] "${item}"`);
    });
    
    // 尝试选择"复制为Markdown"
    if (menuItems.some(item => item.includes('Markdown'))) {
      const selectScript = path.join(os.tmpdir(), 'select-markdown.scpt');
      const selectContent = `
        tell application "System Events"
          key code 36
        end tell
      `;
      fs.writeFileSync(selectScript, selectContent);
      execSync(`osascript "${selectScript}"`, { timeout: 3000 });
      fs.unlinkSync(selectScript);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      const clipboardContent = execSync('pbpaste', { timeout: 3000 });
      
      return { 
        success: true, 
        bundleName: bundleName,
        menuItems: menuItems,
        clipboardContent: clipboardContent.toString().trim().substring(0, 500) + '...'
      };
    }
    
    return { 
      success: true, 
      bundleName: bundleName,
      menuItems: menuItems,
      message: '未找到包含Markdown的菜单项'
    };
    
  } catch (error) {
    console.error('[Main] 获取UI元素失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 🆕 使用 webContents.sendInputEvent() 模拟真实键盘输入（解决 Kimi 等 React SPA 的输入问题）
ipcMain.handle('type-message-in-webview', async (event, data) => {
  try {
    const { url, message } = data;
    if (!message || !message.trim()) {
      return { success: false, error: '消息为空' };
    }

    const { webContents } = require('electron');
    const allWebContents = webContents.getAllWebContents();

    let targetWebContents = null;
    for (const wc of allWebContents) {
      try {
        const wcUrl = wc.getURL();
        if (url && wcUrl.includes(url)) {
          targetWebContents = wc;
          console.log('[Main] 🎯 找到目标 webContents, URL:', wcUrl);
          break;
        }
      } catch(e) {}
    }

    if (!targetWebContents) {
      console.log('[Main] ❌ 未找到匹配 URL 的 webContents, URL:', url);
      return { success: false, error: '未找到匹配的 webContents' };
    }

    console.log('[Main] ⌨️ 开始使用 sendInputEvent 输入消息, 长度:', message.length);

    // 逐字符输入（模拟真实键盘输入，生成 isTrusted: true 事件）
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      const keyCode = char.charCodeAt(0);

      targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: char });
      targetWebContents.sendInputEvent({ type: 'char', keyCode: char });
      targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: char });

      // 每 5 个字符暂停一下，避免输入太快
      if (i % 5 === 0) {
        await new Promise(r => setTimeout(r, 30));
      }
    }

    console.log('[Main] ✅ sendInputEvent 输入完成');
    return { success: true, charCount: message.length };
  } catch (e) {
    console.error('[Main] type-message-in-webview 失败:', e);
    return { success: false, error: e.message };
  }
});

// 🆕 使用 webContents.sendInputEvent() 按回车键（解决 Kimi 发送按钮问题）
ipcMain.handle('press-enter-in-webview', async (event, data) => {
  try {
    const { url } = data;

    const { webContents } = require('electron');
    const allWebContents = webContents.getAllWebContents();

    let targetWebContents = null;
    for (const wc of allWebContents) {
      try {
        const wcUrl = wc.getURL();
        if (url && wcUrl.includes(url)) {
          targetWebContents = wc;
          console.log('[Main] 🎯 找到目标 webContents 按 Enter, URL:', wcUrl);
          break;
        }
      } catch(e) {}
    }

    if (!targetWebContents) {
      console.log('[Main] ❌ 未找到匹配 URL 的 webContents 按 Enter, URL:', url);
      return { success: false, error: '未找到匹配的 webContents' };
    }

    console.log('[Main] ↩️ 使用 sendInputEvent 按 Enter 键（增强版 - 三重保障）...');

    // 🔧🔧🔧 增强型修复：三重保障机制 🔧🔧🔧
    
    // 🛡️ 第 1 重：确保焦点在输入框上
    try {
      await targetWebContents.executeJavaScript(`
        (function() {
          // 查找并聚焦输入框
          const input = document.querySelector('[class*="chat-input-editor"]') 
                     || document.querySelector('div[contenteditable="true"]')
                     || document.querySelector('[role="textbox"]')
                     || document.querySelector('textarea');
          if (input) {
            input.focus();
            return { focused: true, tag: input.tagName };
          }
          return { focused: false };
        })()
      `);
      console.log('[Main] ↩️ [第1重] 确保输入框聚焦完成');
    } catch (focusErr) {
      console.log('[Main] ↩️ [第1重] 聚焦失败（非致命）:', focusErr.message);
    }

    await new Promise(r => setTimeout(r, 100));  // 等待聚焦生效

    // 🛡️ 第 2 重：多次尝试按 Enter 键（最多 3 次）
    let enterSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Main] ↩️ [第2重] 尝试 ${attempt}/3 按 Enter 键...`);

      // 按 Enter 键（模拟真实键盘输入）
      targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      targetWebContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      targetWebContents.sendInputEvent({ type: 'char', keyCode: '\n' });
      targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

      // 等待一下看是否发送成功
      await new Promise(r => setTimeout(r, 800));

      // 检查输入框是否还有内容（如果清空了说明发送成功）
      try {
        const checkResult = await targetWebContents.executeJavaScript(`
          (function() {
            const input = document.querySelector('[class*="chat-input-editor"]') 
                       || document.querySelector('div[contenteditable="true"]');
            if (!input) return { checked: false };
            
            const text = (input.textContent || input.value || '').trim();
            const hasContent = text.length > 0;
            
            return { 
              checked: true, 
              hasContent: hasContent,
              textLength: text.length,
              isEmpty: !hasContent
            };
          })()
        `);

        console.log(`[Main] ↩️ [第2重] 尝试 ${attempt} 结果:`, JSON.stringify(checkResult));

        if (checkResult.isEmpty || !checkResult.hasContent) {
          // 输入框已清空，说明消息已发送成功
          enterSuccess = true;
          console.log(`[Main] ↩️✅ 第 ${attempt} 次尝试成功！消息已发送`);
          break;
        } else {
          console.log(`[Main] ↩️⚠️ 第 ${attempt} 次尝试后输入框仍有内容，准备重试...`);
        }
      } catch (checkErr) {
        console.log(`[Main] ↩️ [第2重] 检查失败（尝试 ${attempt}）:`, checkErr.message);
      }

      if (attempt < 3) {
        // 再次确保焦点
        try {
          await targetWebContents.executeJavaScript(`
            (function() {
              const input = document.querySelector('[class*="chat-input-editor"]') 
                         || document.querySelector('div[contenteditable="true"]');
              if (input) input.focus();
            })()
          `);
        } catch(e) {}
        
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // 🛡️ 第 3 重：如果 Enter 键都失败，尝试点击发送按钮
    if (!enterSuccess) {
      console.warn('[Main] ↩️ [第3重] Enter 键未生效，尝试点击发送按钮...');
      
      try {
        const clickResult = await targetWebContents.executeJavaScript(`
          (function() {
            // 多种可能的发送按钮选择器
            const buttonSelectors = [
              '[class*="chat-input"] button',
              '[class*="input-area"] button',
              'button[aria-label*="发送"]',
              'button[aria-label*="send"]',
              'button[class*="send"]',
              'button[class*="submit"]',
              // Kimi 特殊选择器
              'svg[class*="send"]',
              '[data-testid="send-button"]'
            ];
            
            for (const sel of buttonSelectors) {
              try {
                const elements = document.querySelectorAll(sel);
                for (const btn of elements) {
                  // 检查按钮是否可见
                  if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                    btn.click();
                    return { success: true, method: 'button-click', selector: sel };
                  }
                }
              } catch(e) {}
            }
            
            return { success: false, error: '未找到可见的发送按钮' };
          })()
        `);
        
        console.log('[Main] ↩️ [第3重] 点击按钮结果:', JSON.stringify(clickResult));
        
        if (clickResult.success) {
          enterSuccess = true;
          console.log('[Main] ↩️✅ [第3重] 发送按钮点击成功！');
        }
      } catch (clickErr) {
        console.error('[Main] ↩️ [第3重] 点击按钮失败:', clickErr.message);
      }
    }

    if (enterSuccess) {
      console.log('[Main] ✅ Enter 键/发送按钮触发成功（三重保障）');
      return { success: true, method: 'triple-guarantee' };
    } else {
      console.warn('[Main] ⚠️ Enter 键/发送按钮均未成功（请检查 Kimi 状态）');
      return { success: false, error: '所有发送方式均未生效', attempts: 3 };
    }
  } catch (e) {
    console.error('[Main] press-enter-in-webview 失败:', e);
    return { success: false, error: e.message };
  }
});

// 🆕 智谱专用 Enter 发送（完全绕过 executeJavaScript，只使用 sendInputEvent）
ipcMain.handle('press-enter-zhipu', async (event, data) => {
  try {
    const { url } = data;

    const { webContents } = require('electron');
    const allWebContents = webContents.getAllWebContents();

    let targetWebContents = null;
    for (const wc of allWebContents) {
      try {
        const wcUrl = wc.getURL();
        if (url && wcUrl.includes(url)) {
          targetWebContents = wc;
          console.log('[Main] 🎯 找到目标 webContents 按 Enter (智谱), URL:', wcUrl);
          break;
        }
      } catch(e) {}
    }

    if (!targetWebContents) {
      console.log('[Main] ❌ 未找到匹配 URL 的 webContents 按 Enter (智谱), URL:', url);
      return { success: false, error: '未找到匹配的 webContents' };
    }

    console.log('[Main] ↩️ 智谱专用：使用 sendInputEvent 按 Enter 键（无 executeJavaScript）...');

    // 多次尝试按 Enter 键（最多 3 次）
    let enterSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Main] ↩️ 智谱 尝试 ${attempt}/3 按 Enter 键...`);

      // 按 Enter 键（模拟真实键盘输入）
      targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      targetWebContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      targetWebContents.sendInputEvent({ type: 'char', keyCode: '\n' });
      targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

      // 等待发送生效
      await new Promise(r => setTimeout(r, 1000));

      // 检查 webContents 是否还在（页面没有跳转/崩溃）
      try {
        const currentUrl = targetWebContents.getURL();
        console.log(`[Main] ️ 智谱 尝试 ${attempt} 后 URL:`, currentUrl);
        // 如果页面没有变化，说明可能没发送成功，继续重试
        enterSuccess = true; // 只要没有报错就认为成功
        break;
      } catch (e) {
        console.log(`[Main] ️ 智谱 尝试 ${attempt} 检查失败:`, e.message);
      }

      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (enterSuccess) {
      console.log('[Main] ✅ 智谱 Enter 键触发成功');
      return { success: true, method: 'zhipu-sendInputEvent' };
    } else {
      console.warn('[Main] ⚠️ 智谱 Enter 键未成功');
      return { success: false, error: 'Enter 键未生效', attempts: 3 };
    }
  } catch (e) {
    console.error('[Main] press-enter-zhipu 失败:', e);
    return { success: false, error: e.message };
  }
});

// 🆕 使用 sendInputEvent 按 Tab 键（将焦点导航到 AI 输入框）
ipcMain.handle('press-tab-in-webview', async (event, data) => {
  try {
    const { url } = data;

    const { webContents } = require('electron');
    const allWebContents = webContents.getAllWebContents();

    let targetWebContents = null;
    for (const wc of allWebContents) {
      try {
        const wcUrl = wc.getURL();
        if (url && wcUrl.includes(url)) {
          targetWebContents = wc;
          console.log('[Main] 🎯 找到目标 webContents 按 Tab, URL:', wcUrl);
          break;
        }
      } catch(e) {}
    }

    if (!targetWebContents) {
      console.log('[Main] ❌ 未找到匹配 URL 的 webContents 按 Tab, URL:', url);
      return { success: false, error: '未找到匹配的 webContents' };
    }

    console.log('[Main] ⇥ 使用 sendInputEvent 按 Tab 键...');
    targetWebContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    targetWebContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });

    console.log('[Main] ✅ Tab 键触发成功');
    return { success: true, method: 'sendInputEvent-Tab' };
  } catch (e) {
    console.error('[Main] press-tab-in-webview 失败:', e);
    return { success: false, error: e.message };
  }
});

// 🆕 使用 Clipboard API 粘贴图片到 webview（解决 Kimi 等平台的附件上传问题）
ipcMain.handle('paste-image-to-webview', async (event, data) => {
  try {
    const { url, imageData, imageName, imageType } = data;
    if (!imageData || !imageData.trim()) {
      return { success: false, error: '图片数据为空' };
    }

    console.log('[Main] 📎📎📎 paste-image-to-webview: 开始处理...');
    console.log('[Main] 📎 图片名称:', imageName || 'image.png');
    console.log('[Main] 📎 图片类型:', imageType || 'image/png');
    console.log('[Main] 📎 数据长度:', imageData.length);

    const { webContents } = require('electron');
    const allWebContents = webContents.getAllWebContents();

    // 找到目标 webContents
    let targetWc = null;
    for (const wc of allWebContents) {
      try {
        if (url && wc.getURL().includes(url)) {
          targetWc = wc;
          console.log('[Main] 📎 找到目标 webContents:', wc.getURL());
          break;
        }
      } catch(e) {}
    }

    if (!targetWc) {
      console.log('[Main] 📎❌ 未找到匹配的 webContents');
      return { success: false, error: '未找到匹配的 webContents' };
    }

    // 将 base64 转换为 Buffer，然后写入剪贴板
    const { nativeImage } = require('electron');
    const { clipboard } = require('electron');

    // 移除 base64 前缀（如果有）
    let base64Data = imageData;
    const base64Match = imageData.match(/^data:[^;]+;base64,(.+)$/);
    if (base64Match) {
      base64Data = base64Match[1];
    }

    // 创建 Buffer 和 NativeImage
    const buffer = Buffer.from(base64Data, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    
    if (img.isEmpty()) {
      console.error('[Main] 📎❌ NativeImage 创建失败（数据可能不是有效图片）');
      return { success: false, error: '无效的图片数据' };
    }

    // 写入系统剪贴板
    clipboard.writeImage(img);
    console.log('[Main] 📎✅ 图片已写入系统剪贴板');

    // 在 webview 中触发 paste 事件
    await new Promise(r => setTimeout(r, 200));  // 等待剪贴板写入完成

    // 先聚焦输入框
    await targetWc.executeJavaScript(`
      (function() {
        const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
        if (input) { input.focus(); return true; }
        return false;
      })()
    `);

    await new Promise(r => setTimeout(r, 300));

    // 触发粘贴事件
    // 🔧🔧🔧 关键修复（三层保护）🔧🔧🔧
    //    第 1 层：只发送 keyDown + keyUp（绝对不发送 char！char 会输入文字 "vV"）
    //    第 2 层：使用 executeJavaScript 触发 execCommand('paste') 作为补充
    //    第 3 层：粘贴后立即检查并清理输入框中的意外文本
    const isMac = process.platform === 'darwin';

    // 🛡️ 第 1 层：sendInputEvent 只发 keyDown/keyUp（不会输入文字）
    console.log('[Main] 📎 [第1层] 发送 Ctrl+V / Cmd+V 键盘事件（无 char）...');
    targetWc.sendInputEvent({ type: 'keyDown', keyCode: 'v', modifiers: isMac ? ['meta'] : ['control'] });
    targetWc.sendInputEvent({ type: 'keyUp', keyCode: 'v', modifiers: isMac ? ['meta'] : ['control'] });

    // 🛡️ 第 2 层：在 webview 内部执行 paste 命令（直接从系统剪贴板读取）
    let pasteResult = null;
    try {
      console.log('[Main] 📎 [第2层] 执行 execCommand("paste") ...');
      pasteResult = await targetWc.executeJavaScript(`
        (function() {
          // 确保焦点在输入框上
          const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
          if (input) { input.focus(); }

          // 尝试执行 paste 命令（这会读取系统剪贴板中的图片）
          const success = document.execCommand('paste');
          return { success: success, focused: !!input };
        })()
      `);
      console.log('[Main] 📎 execCommand(paste) 结果:', JSON.stringify(pasteResult));
    } catch (pasteErr) {
      console.log('[Main] 📎 execCommand(paste) 失败（可能正常）:', pasteErr.message);
    }

    // 🛡️ 第 3 层：等待粘贴完成后，检查并清理可能的 "vV" 字符泄漏
    await new Promise(r => setTimeout(r, 500));  // 等待粘贴处理完成

    try {
      console.log('[Main] 📎 [第3层] 检查并清理可能的字符泄漏...');
      const cleanupCheck = await targetWc.executeJavaScript(`
        (function() {
          const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
          if (!input) return { checked: false, error: '未找到输入框' };

          const text = (input.textContent || input.value || '').trim();

          // 检查是否有意外的纯文本（非图片内容）
          // 如果只有 "vV"、"v"、"V" 等短字符串，很可能是字符泄漏
          const suspiciousPatterns = /^vV?$/i;
          const isSuspicious = suspiciousPatterns.test(text) && text.length <= 2;

          if (isSuspicious && text.length > 0) {
            // 发现可疑的字符泄漏，清理它
            input.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);

            return {
              checked: true,
              foundLeakage: true,
              leakedText: text,
              cleaned: true,
              message: '✅ 已清理字符泄漏: "' + text + '"'
            };
          }

          return {
            checked: true,
            foundLeakage: false,
            currentText: text,
            message: '✅ 未发现字符泄漏'
          };
        })()
      `);
      console.log('[Main] 📎 [第3层] 清理检查结果:', JSON.stringify(cleanupCheck));

      if (cleanupCheck.foundLeakage) {
        console.warn('[Main] 📎⚠️ 发现并清理了字符泄漏:', cleanupCheck.leakedText);
      }
    } catch (cleanupErr) {
      console.log('[Main] 📎 [第3层] 清理检查失败（非致命）:', cleanupErr.message);
    }

    console.log('[Main] 📎✅ 已触发 Ctrl+V / Cmd+V 粘贴事件（三层保护，无 char 泄漏）');
    return { success: true, method: 'clipboard-paste-3layer-protection', pasteResult: pasteResult };

  } catch (e) {
    console.error('[Main] 📎 paste-image-to-webview 失败:', e);
    return { success: false, error: e.message };
  }
});
  return {
    previewBookmarkByIndex,
    captureElementContentByIndex,
    injectMessageToWebview,
  };
}

module.exports = { init };
