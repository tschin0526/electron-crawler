/**
 * 数据抓取与格式化模组
 * 从 main.js 拆分而来
 * 包含：HTTP 请求、数据格式化、编码转换等
 */
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const url = require('url');

function aggressiveClean(obj, visited = new Set()) {
  // 防止循环引用
  if (obj === null || obj === undefined) {
    return obj;
  }

  // 基本类型直接返回
  const type = typeof obj;
  if (type !== 'object') {
    return obj;
  }

  // 检查是否已经访问过（处理循环引用）
  const objId = Object.prototype.toString.call(obj);
  if (visited.has(obj)) {
    return '[Circular]';
  }
  visited.add(obj);

  // 处理数组
  if (Array.isArray(obj)) {
    return obj
      .map((item, index) => {
        try {
          return aggressiveClean(item, visited);
        } catch (e) {
          console.log(`[Main] 清理数组元素 [${index}] 失败:`, e.message);
          return null;
        }
      })
      .filter(item => item !== null && item !== undefined);
  }

  // 处理对象 - 只保留安全的属性
  const safeObj = {};

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

    try {
      let value = obj[key];

      // 跳过函数
      if (typeof value === 'function') continue;

      // 跳过 DOM 相关对象
      if (value instanceof Node ||
          value instanceof Window ||
          value instanceof Document ||
          value instanceof Event ||
          value instanceof EventTarget) {
        console.log(`[Main] 跳过 DOM/事件对象: ${key}`);
        continue;
      }

      // 只保留基本类型和普通对象
      if (value === null || value === undefined) {
        safeObj[key] = value;
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        safeObj[key] = value;
      } else if (typeof value === 'object') {
        // 递归处理嵌套对象
        safeObj[key] = aggressiveClean(value, visited);
      } else {
        // 其他类型（Symbol, BigInt 等）转为字符串
        safeObj[key] = String(value);
      }
    } catch (e) {
      console.log(`[Main] 无法处理属性 "${key}":`, e.message);
    }
  }

  return safeObj;
}

// ============================================================
// 🎯 公共子函数库（两种模式共享）v1.0.0-20
//    从 injectMessageToWebview 中提取的公共逻辑
// ============================================================

/**
 * 子函数 A：注入消息到输入框
 * @param {string} message - 要注入的消息内容
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function injectMessageToInputBox(message) {
  console.log('🔧 [Shared] injectMessageToInputBox 开始执行');
  console.log('🔧 [Shared] 消息长度:', message ? message.length : 'null');

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不存在');
  }

  const safeMsgJSON = JSON.stringify(message);

  var innerLines = [
    '(function() {',
    '  try {',
    "    console.log('[Shared-Inject] 查找输入框...');",
    '',
    '    // 🔍 检测当前平台（是否为 Kimi）',
    '    var currentUrl = window.location.href;',
    '    var isKimi = currentUrl.includes("kimi.moonshot.cn") || currentUrl.includes("kimi.com") || currentUrl.includes("moonshot.cn");',
    "    console.log('[Shared-Inject] 当前平台:', isKimi ? '✅ Kimi (需要特殊处理)' : '⚪ 其他平台');",
    '',
    '    // 🎯 改进的输入框查找策略（优先级从高到低）',
    '    var possibleSelectors = [',
    "      '[class*=\"chat-input-editor\"]',  // 🎯 Kimi 专属",
    "      'textarea[placeholder*=\"发消息\"]',",
    "      'textarea[placeholder*=\"消息\"]',",
    "      'textarea[placeholder*=\"输入\"]',",
    "      'textarea[class*=\"input\"]',",
    "      'textarea[class*=\"editor\"]',",
    "      'div[contenteditable=\"true\"]',",
    "      '[role=\"textbox\"]',",
    "      'textarea',",
    "      'input[type=\"text\"]'",
    '    ];',
    '',
    '    var inputEl = null;',
    '    var foundSelector = null;',
    '',
    '    for (var i = 0; i < possibleSelectors.length; i++) {',
    '      try {',
    '        var els = document.querySelectorAll(possibleSelectors[i]);',
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
    '          if (inputEl) break;',
    '        }',
    '      } catch(e) { continue; }',
    '    }',
    '',
    '    if (!inputEl) {',
    "      return JSON.stringify({success:false, error:'找不到输入框（已尝试所有选择器）'});",
    '    }',
    '',
    "    console.log('[Shared-Inject] ✅ 找到输入框:', foundSelector, '标签:', inputEl.tagName);",
    '    inputEl.focus();',
    '',
    '    // 🚀 根据输入框类型设置内容',
    '    try {',
    '      var tagName = inputEl.tagName.toUpperCase();',
    '      if (tagName === "TEXTAREA" || tagName === "INPUT") {',
    "        console.log('[Shared-Inject] 原生输入框，使用 setter...');",
    '        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;',
    '        setter.call(inputEl, ' + safeMsgJSON + ');',
    '        inputEl.dispatchEvent(new Event("input", {bubbles:true}));',
    '        inputEl.dispatchEvent(new Event("change", {bubbles:true}));',
    '      } else {',
    "        console.log('[Shared-Inject] contenteditable 输入框（Kimi），使用 Copy-Paste 方式...');",
    '        // 先清空输入框',
    '        inputEl.focus();',
    "        document.execCommand('selectAll', false, null);",
    "        document.execCommand('delete', false, null);",
    '',
    '        // 🎯 方式 A: Clipboard API + paste 事件（最可靠！）',
    '        try {',
    "          console.log('[Shared-Inject] 📋 使用 navigator.clipboard.writeText + paste...');",
    '          await navigator.clipboard.writeText(' + safeMsgJSON + ');',
    "          console.log('[Shared-Inject] ✅ 已写入剪贴板');",
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
    "          console.log('[Shared-Inject] ✅ paste 事件已触发');",
    '        } catch(e) { console.log(\'[Shared-Inject] ⚠️ Clipboard API 失败:\', e.message); }',
    '',
    '        // 🎯 方式 B: execCommand insertText 兜底',
    '        try {',
    "          var currentText = inputEl.textContent || inputEl.innerText;",
    "          if (!currentText || currentText.trim().length === 0) {",
    "            console.log('[Shared-Inject] 📋 使用 execCommand insertText 兜底...');",
    '            inputEl.focus();',
    "            document.execCommand('insertText', false, " + safeMsgJSON + ");",
    "            console.log('[Shared-Inject] ✅ execCommand insertText 完成');",
    '          }',
    '        } catch(e2) {',
    "          console.log('[Shared-Inject] ⚠️ execCommand 也失败，最后尝试 textContent...');",
    '          inputEl.textContent = ' + safeMsgJSON + ';',
    '        }',
    '',
    '        // 触发事件链确保 React 状态更新',
    "        inputEl.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, inputType:'insertText', data: " + safeMsgJSON + "}));",
    "        inputEl.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data: " + safeMsgJSON + "}));",
    "        inputEl.dispatchEvent(new Event('input', {bubbles:true}));",
    "        inputEl.dispatchEvent(new Event('change', {bubbles:true}));",
    "        console.log('[Shared-Inject] ✅ contenteditable 注入完成');",
    '      }',
    "      console.log('[Shared-Inject] ✅ 文本已注入!');",
    '      return JSON.stringify({success:true, inputType:tagName});',
    '    } catch(e) {',
    "      return JSON.stringify({success:false, error:'注入失败:'+e.message});",
    '    }',
    '  } catch(err) {',
    "    return JSON.stringify({success:false, error:err.message});",
    '  }',
    '})()'
  ];

  var outerLines = [
    '(function() {',
    '  try {',
    "    console.log('[Shared-Inject-Outer] 执行注入...');",
    '    var wv = document.getElementById("previewWebview");',
    '    if (!wv) return JSON.stringify({success:false, error:"找不到webview"});',
    '',
    '    return wv.executeJavaScript(' + JSON.stringify(innerLines.join('\n')) + ')',
    '      .then(r => r)',
    '      .catch(e => JSON.stringify({success:false, error:e.message}));',
    '  } catch(e) {',
    "    return JSON.stringify({success:false, error:e.message});",
    '  }',
    '})()'
  ];

  const resultStr = await mainWindow.webContents.executeJavaScript(outerLines.join('\n'));
  let result;
  try { result = JSON.parse(resultStr); } catch(e) { result = { success: false }; }

  console.log('🔧 [Shared] injectMessageToInputBox 结果:', result.success ? '✅ 成功 (' + (result.inputType || '') + ')' : '❌ 失败 - ' + (result.error || '未知错误'));
  return result;
}

/**
 * 子函数 B：点击发送按钮（支持多平台：豆包/文心一言/通用）
 * @returns {Promise<{autoSent: boolean}>}
 */
/**
 * 子函数 B：点击发送按钮（完全复制 doubaoAutoSend 的成功逻辑）
 * @returns {Promise<{autoSent: boolean}>}
 */
async function clickSendButton() {
  console.log('🔧 [Shared] clickSendButton 开始执行（支持 Kimi/豆包/文心一言 多平台）');

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不存在');
  }

  var innerLines = [
    '(async function() {',
    '  try {',
    "    console.log('[Shared-SendBtn-Inside] 开始智能发送流程...');",
    '',
    '    // 🔍 检测当前平台',
    '    const currentUrl = window.location.href;',
    '    const isDoubao = currentUrl.includes("doubao.com") || currentUrl.includes("doubao.cn");',
    '    const isWenXin = currentUrl.includes("yiyan.baidu.com") || currentUrl.includes("yiyian.baidu.com");',
    '    const isDeepSeek = currentUrl.includes("deepseek.com");',
    '    const isKimi = currentUrl.includes("kimi.moonshot.cn") || currentUrl.includes("kimi.com") || currentUrl.includes("moonshot.cn");',
    '',
    "    console.log('[Shared-SendBtn-Inside] 当前URL:', currentUrl.substring(0, 80));",
    "    console.log('[Shared-SendBtn-Inside] 平台检测:', isDoubao ? '✅ 豆包' : isWenXin ? '✅ 文心一言' : isDeepSeek ? '✅ DeepSeek' : isKimi ? '✅ Kimi' : '⚪ 其他');",
    '',
    '    // Step 1: 查找输入框（支持多平台，优先级从高到低）',
    '    const possibleSelectors = [',
    "      '[class*=\"chat-input-editor\"]',   // 🎯 Kimi 专属",
    "      'textarea[placeholder*=\"发消息\"]',",
    "      'textarea[placeholder*=\"消息\"]',",
    "      'textarea[placeholder*=\"输入\"]',",
    "      'textarea[class*=\"input\"]',",
    "      'textarea[class*=\"editor\"]',",
    "      'div[contenteditable=\"true\"]',",
    "      '[role=\"textbox\"]',",
    "      'textarea',",
    "      'input[type=\"text\"]'",
    '    ];',
    '',
    '    let inputElement = null;',
    '    for (const selector of possibleSelectors) {',
    '      inputElement = document.querySelector(selector);',
    '      if (inputElement) {',
    "        console.log('[Shared-SendBtn-Inside] ✅ 找到输入框:', selector);",
    '        break;',
    '      }',
    '    }',
    '',
    '    if (!inputElement) {',
    "      return JSON.stringify({autoSent: false, error: '未找到输入框'});",
    '    }',
    '',
    "    console.log('[Shared-SendBtn-Inside] 输入框信息:', inputElement.tagName, inputElement.className?.substring(0, 50) || '');",
    '',
    '    // Step 2: 聚焦输入框并按 Enter 键',
    '    inputElement.focus();',
    '    await new Promise(r => setTimeout(r, 100));',
    '',
    '    const keydownEvent = new KeyboardEvent(\'keydown\', { key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true });',
    '    const keypressEvent = new KeyboardEvent(\'keypress\', { key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true });',
    '    const keyupEvent = new KeyboardEvent(\'keyup\', { key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true });',
    '',
    '    inputElement.dispatchEvent(keydownEvent);',
    '    inputElement.dispatchEvent(keypressEvent);',
    '    inputElement.dispatchEvent(keyupEvent);',
    "    console.log('[Shared-SendBtn-Inside] ✅ 已发送 Enter 键（第一次尝试）');",
    '',
    '    // Step 3: 等待 Enter 事件生效',
    '    await new Promise(r => setTimeout(r, 2000));',
    '',
    '    // Step 4: 触发 input 事件确保消息被识别',
    '    inputElement.dispatchEvent(new Event(\'input\', { bubbles: true }));',
    '    inputElement.dispatchEvent(new Event(\'change\', { bubbles: true }));',
    "    console.log('[Shared-SendBtn-Inside] ✅ 已触发 input/change 事件确保消息识别');",
    '',
    '    // Step 5: 再等待一下',
    '    await new Promise(r => setTimeout(r, 1000));',
    '',
    '    // Step 6: 尝试点击发送按钮（支持多平台，包括 Kimi）',
    '    const buttonSelectors = [',
    "      'button[class*=\"send-button\"]',",
    "      'button[class*=\"sendIcon\"]',",
    "      'button[class*=\"send-icon\"]',",
    "      'button[class*=\"sendBtn\"]',",
    "      'button[class*=\"arrow-up\"]',",
    "      'button[class*=\"arrowUp\"]',",
    "      'button[class*=\"up-arrow\"]',",
    "      '[class*=\"send-button\"]',",
    "      '[class*=\"send-btn\"]',",
    "      'button[type=\"submit\"]',",
    "      'button[title*=\"发送\"]',",
    "      'button:has(svg)',",
    "      'button[class*=\"send\"]',",
    "      'button[class*=\"submit\"]',",
    "      '[class*=\"chat-input\"] button',  // 🎯 Kimi: 在聊天输入区域内的按钮",
    "      'button:last-of-type'",
    '    ];',
    '',
    '    let sendButton = null;',
    '    for (const selector of buttonSelectors) {',
    '      try {',
    '        sendButton = document.querySelector(selector);',
    '        if (sendButton && sendButton.offsetParent !== null && !sendButton.disabled) {',
    "          console.log('[Shared-SendBtn-Inside] ✅ 找到发送按钮:', selector);",
    '          break;',
    '        }',
    '        sendButton = null;',
    '      } catch (e) { continue; }',
    '    }',
    '',
    '    // Step 7: 如果没找到按钮，通过位置查找（Kimi 等平台通用）',
    '    if (!sendButton) {',
    "      console.log('[Shared-SendBtn-Inside] 通过选择器未找到按钮，尝试位置查找...');",
    '      const inputRect = inputElement.getBoundingClientRect();',
    '      const allButtons = Array.from(document.querySelectorAll(\'button\'));',
    '      sendButton = allButtons.find(btn => {',
    '        const rect = btn.getBoundingClientRect();',
    '        return !btn.disabled &&',
    '               rect.left > inputRect.right - 50 && rect.left < inputRect.right + 150 &&',
    '               Math.abs(rect.top - inputRect.top) < 80 && rect.width > 20 && rect.width < 80;',
    '      });',
    '      if (sendButton) {',
    "        console.log('[Shared-SendBtn-Inside] ✅ 通过位置找到发送按钮');",
    '      }',
    '    }',
    '',
    '    let messageSent = false;',
    '',
    '    // Step 8: 如果找到按钮，使用多种点击方式尝试',
    '    if (sendButton) {',
    "      console.log('[Shared-SendBtn-Inside] 🚀 找到发送按钮，准备点击...');",
    '      inputElement.focus();',
    '      await new Promise(r => setTimeout(r, 300));',
    '',
    '      const clickAttempts = [',
    '        () => { sendButton.click(); },',
    '        () => { sendButton.dispatchEvent(new MouseEvent(\'mousedown\', { bubbles: true })); },',
    '        () => { sendButton.dispatchEvent(new MouseEvent(\'mouseup\', { bubbles: true })); },',
    '        () => { sendButton.dispatchEvent(new MouseEvent(\'click\', { bubbles: true })); },',
    '        () => { sendButton.dispatchEvent(new MouseEvent(\'pointerdown\', { bubbles: true })); },',
    '        () => { sendButton.dispatchEvent(new MouseEvent(\'pointerup\', { bubbles: true })); }',
    '      ];',
    '',
    '      for (let attempt = 0; attempt < clickAttempts.length; attempt++) {',
    '        try {',
    '          clickAttempts[attempt]();',
    "          console.log('[Shared-SendBtn-Inside] 点击尝试', attempt + 1);",
    '          await new Promise(r => setTimeout(r, 200));',
    '        } catch (e) {',
    "          console.error('[Shared-SendBtn-Inside] 点击尝试失败:', e);",
    '        }',
    '      }',
    "      console.log('[Shared-SendBtn-Inside] ✅ 已尝试多次点击发送按钮');",
    '      messageSent = true;',
    '    } else {',
    "      console.log('[Shared-SendBtn-Inside] 未找到发送按钮，将按 Enter 键发送');",
    '      inputElement.focus();',
    '      await new Promise(r => setTimeout(r, 300));',
    '',
    '      // 多次尝试按 Enter 键',
    '      for (let attempt = 0; attempt < 3; attempt++) {',
    '        const keydownEvent = new KeyboardEvent(\'keydown\', {',
    '          key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true',
    '        });',
    '        inputElement.dispatchEvent(keydownEvent);',
    '',
    '        const keypressEvent = new KeyboardEvent(\'keypress\', {',
    '          key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true',
    '        });',
    '        inputElement.dispatchEvent(keypressEvent);',
    '',
    '        const keyupEvent = new KeyboardEvent(\'keyup\', {',
    '          key: \'Enter\', code: \'Enter\', keyCode: 13, which: 13, bubbles: true, cancelable: true',
    '        });',
    '        inputElement.dispatchEvent(keyupEvent);',
    "        console.log('[Shared-SendBtn-Inside] Enter 尝试', attempt + 1);",
    '        await new Promise(r => setTimeout(r, 300));',
    '      }',
    "      console.log('[Shared-SendBtn-Inside] ✅ 已多次尝试按 Enter 键发送');",
    '      messageSent = true;',
    '    }',
    '',
    "    return JSON.stringify({autoSent: messageSent, method: sendButton ? 'button+多次点击' : 'enter+多次重试', platform: isKimi ? 'kimi' : (isDoubao ? 'doubao' : (isWenXin ? 'wenxin' : (isDeepSeek ? 'deepseek' : 'other')))});",
    '  } catch(e) {',
    "    console.error('[Shared-SendBtn-Inside] ❌ 发送过程出错:', e);",
    "    return JSON.stringify({autoSent: false, error: e.message});",
    '  }',
    '})()'
  ];

  var outerLines = [
    '(function() {',
    '  try {',
    '    var wv = document.getElementById("previewWebview");',
    '    if (!wv) return JSON.stringify({autoSent:false, error:"找不到webview"});',
    '',
    '    return wv.executeJavaScript(' + JSON.stringify(innerLines.join('\n')) + ')',
    '      .then(r => r)',
    '      .catch(e => JSON.stringify({autoSent:false, error:e.message}));',
    '  } catch(e) {',
    "    return JSON.stringify({autoSent:false, error:e.message});",
    '  }',
    '})()'
  ];

  const resultStr = await mainWindow.webContents.executeJavaScript(outerLines.join('\n'));
  let result;
  try { result = JSON.parse(resultStr); } catch(e) { result = { autoSent: false }; }

  console.log('🔧 [Shared] clickSendButton 结果:', result.autoSent ? '✅ 已发送 (' + (result.method || '') + ')' : '❌ 发送失败 - ' + (result.error || '未知错误'));
  return result;
}

/**
 * 子函数 C：心跳监控 + 抓取回复
 * @param {number} bookmarkIndex - 书签索引（用于调用 captureElementContentByIndex）
 * @param {Object} params - 监控参数
 * @param {string} params.replySelector - 回复内容选择器
 * @param {string} params.heartbeatSelector - 心跳监控选择器
 * @param {number} params.monitorTimeout - 监控超时时间（ms）
 * @returns {Promise<Object>} - 抓取到的回复内容
 */
async function monitorAndCaptureReply(bookmarkIndex, params) {
  console.log('🔧 [Shared] monitorAndCaptureReply 开始执行');
  console.log('🔧 [Shared] bookmarkIndex:', bookmarkIndex);
  console.log('🔧 [Shared] 参数:', JSON.stringify(params || {}).substring(0, 150));

  const replySelector = (params && params.replySelector) || '.markdown-prose';
  const heartbeatSelector = (params && params.heartbeatSelector) || '#chat-container';
  const monitorTimeout = (params && params.monitorTimeout) || 20000;

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('🔧 [Shared] 调用 captureElementContentByIndex...');
  
  const captureResult = await captureElementContentByIndex(bookmarkIndex, {
    replySelector: replySelector,
    heartbeatSelector: heartbeatSelector,
    monitorTimeout: monitorTimeout
  });

  console.log('🔧 [Shared] ✅ 抓取完成！');
  return captureResult;
}

// 清理数据以便 IPC 通信（保守方法）
function cleanDataForIPC(obj, depth = 0) {
  // 防止无限递归
  if (depth > 10) {
    return '[Max Depth Reached]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // 基本类型直接返回
  if (typeof obj !== 'object') {
    return obj;
  }

  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => cleanDataForIPC(item, depth + 1));
  }

  // 处理对象
  const cleanedObj = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      try {
        const value = obj[key];

        // 跳过函数
        if (typeof value === 'function') {
          continue;
        }

        // 跳过 DOM 节点
        if (value instanceof Node || value instanceof Window || value instanceof Document) {
          console.log(`[Main] 跳过 DOM 节点: ${key}`);
          continue;
        }

        // 递归清理嵌套对象
        cleanedObj[key] = cleanDataForIPC(value, depth + 1);
      } catch (e) {
        console.log(`[Main] 无法清理属性 ${key}:`, e.message);
      }
    }
  }
  return cleanedObj;
}

// 检测是否为 API 类型 URL（返回 JSON 数据的接口）
function isApiUrl(targetUrl) {
  const apiPatterns = [
    /\/api\//i,
    /\.json/i,
    /sinajs\.cn.*list=/i,                   // 新浪实时行情（GBK 编码）
    /hq\.sinajs\.cn/i,                      // 新浪实时行情简写
    /finance\.sina\.com\.cn.*json/i         // 新浪 K线/历史数据 JSON 接口
  ];
  
  return apiPatterns.some(pattern => pattern.test(targetUrl));
}

// 检测是否为标准 UTF-8 JSON 接口（可直接用 HTTP 请求，无需浏览器）
function isUtf8Api(targetUrl) {
  const utf8Patterns = [
    /finance\.sina\.com\.cn.*json_v2/i,         // 新浪 K线 JSON 接口（UTF-8）
    /finance\.sina\.com\.cn.*api\/json/i        // 新浪其他 JSON 接口
  ];
  
  return utf8Patterns.some(pattern => pattern.test(targetUrl));
}

/**
 * 台股专用：直接 HTTP 请求（基于已验证的可工作代码）
 * 
 * 参考代码（用户提供的可工作版本）：
 * - 使用 https.request() 直接发送 HTTP 请求
 * - 支持 Referer 和 User-Agent 自定义头
 * - 返回 JSON 数据并格式化
 */
async function fetchTwseDataDirect(targetUrl, customHeaders) {
  console.log('[Main] [台股HTTP模式] 开始请求:', targetUrl);
  
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          ...(customHeaders || {})
        },
        timeout: 15000
      };
      
      console.log('[Main] [台股HTTP模式] 请求配置:', {
        hostname: options.hostname,
        path: options.path,
        hasReferer: !!options.headers.Referer,
        hasUserAgent: !!options.headers['User-Agent']
      });
      
      const req = https.request(options, (res) => {
        let data = '';
        
        console.log('[Main] [台股HTTP模式] 响应状态码:', res.statusCode);
        
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log('[Main] [台股HTTP模式] 重定向到:', res.headers.location);
          fetchTwseDataDirect(res.headers.location, customHeaders)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            console.log('[Main] [台股HTTP模式] 收到数据，长度:', data.length);
            console.log('[Main] [台股HTTP模式] 数据预览:', data.substring(0, 200));
            
            const jsonData = JSON.parse(data);
            console.log('[Main] [台股HTTP模式] JSON 解析成功');
            
            const formattedData = formatTwseStockData(targetUrl, jsonData, customHeaders);
            
            resolve(formattedData);
            
          } catch (parseError) {
            console.error('[Main] [台股HTTP模式] JSON 解析失败:', parseError.message);
            reject(new Error(`台股数据解析失败: ${parseError.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[Main] [台股HTTP模式] 请求错误:', error.message);
        reject(new Error(`台股请求失败: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('台股请求超时（15 秒）'));
      });
      
      req.end();
      
    } catch (urlError) {
      reject(new Error(`URL 解析失败: ${urlError.message}`));
    }
  });
}

// 直接抓取 API 接口数据（适用于返回 JSON 的 API）
async function fetchApiData(targetUrl, customHeaders) {
  console.log('[Main] 检测到 API 类型 URL，使用直接请求模式:', targetUrl);
  
  // 检测是否为需要特殊编码处理的 URL（如新浪财经使用 GBK 编码)
  const isGbkEncoded = targetUrl.includes('sinajs.cn') || targetUrl.includes('sina.com.cn');
  
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        ...(customHeaders || {})
      },
      timeout: 15000
    };
    
    // 新浪财经需要指定 Accept-Charset 或使用 GBK 处理
    if (isGbkEncoded) {
      options.headers['Accept-Charset'] = 'gbk, gb2312, utf-8';
    }
    
    console.log('[Main] API 请求选项:', JSON.stringify({
      url: targetUrl,
      headers: options.headers,
      isGbkEncoded: isGbkEncoded
    }, null, 2));
    
    const req = httpModule.request(options, (res) => {
      // 对于 GBK 编码的响应，收集 Buffer 而非字符串
      const chunks = [];
      
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log('[Main] API 重定向到:', res.headers.location);
        fetchApiData(res.headers.location, customHeaders)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        try {
          // 合并所有 chunk
          const buffer = Buffer.concat(chunks);
          
          let data;
          
          // 根据编码类型处理数据
          if (isGbkEncoded) {
            // 新浪财经等使用 GBK/GB2312 编码
            console.log('[Main] 检测到 GBK 编码，进行编码转换...');
            
            // 方法1：尝试从 content-type 获取编码
            const contentType = res.headers['content-type'] || '';
            let charset = 'utf-8';
            
            if (contentType.includes('charset=')) {
              charset = contentType.split('charset=')[1].trim().toLowerCase();
              console.log('[Main] 服务器声明编码:', charset);
            }
            
            // 如果是 gbk/gb2312，进行转换
            if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
              data = gbkBufferToString(buffer);
              console.log('[Main] GBK 转 UTF-8 成功，长度:', data.length);
            } else {
              // 默认尝试 GBK 转换（因为新浪财经通常不声明正确编码）
              try {
                data = gbkBufferToString(buffer);
                // 验证转换结果是否包含可读的中文字符
                if (/[\u4e00-\u9fa5]/.test(data)) {
                  console.log('[Main] GBK 自动检测成功');
                } else {
                  console.log('[Main] GBK 转换后无中文字符，回退到 UTF-8');
                  data = buffer.toString('utf-8');
                }
              } catch (gbkError) {
                console.warn('[Main] GBK 转换失败，使用 UTF-8:', gbkError.message);
                data = buffer.toString('utf-8');
              }
            }
          } else {
            // 其他 API 使用 UTF-8
            data = buffer.toString('utf-8');
          }
          
          console.log('[Main] 原始数据预览 (前200字符):', data.substring(0, 200));
          
          // 尝试解析 JSON
          let jsonData;
          
          // 台股 API 返回标准 JSON
          if (targetUrl.includes('twse.com.tw')) {
            jsonData = JSON.parse(data);
          } else if (isGbkEncoded) {
            // 新浪财经返回的是 JavaScript 变量赋值格式
            // 直接传递原始字符串给格式化函数处理
            jsonData = data; // 保留原始文本供 formatSinaStockData 解析
          } else {
            jsonData = JSON.parse(data);
          }
          
          console.log('[Main] API 数据获取成功:', typeof jsonData);
          
          // 将 API 数据格式化为统一的数据结构
          const formattedData = formatApiResponse(targetUrl, jsonData, customHeaders);
          
          resolve(formattedData);
          
        } catch (parseError) {
          console.error('[Main] 数据解析失败:', parseError.message);
          
          // 如果是 GBK 编码且解析失败，作为纯文本处理
          const buffer = Buffer.concat(chunks);
          let textData;
          
          if (isGbkEncoded) {
            try {
              textData = gkbBufferToString(buffer);
            } catch (e) {
              textData = buffer.toString('utf-8');
            }
          } else {
            textData = buffer.toString('utf-8');
          }
          
          resolve(formatTextResponse(targetUrl, textData));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('[Main] API 请求失败:', error.message);
      reject(new Error(`API 请求失败：${error.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('API 请求超时（15 秒）'));
    });
    
    req.end();
  });
}

/**
 * 将 GBK 编码的 Buffer 转换为 UTF-8 字符串
 * 实现简化的 GBK → UTF-8 转换（覆盖常用中文字符）
 */
function gbkBufferToString(buffer) {
  // 使用 latin1 读取（单字节映射），然后处理多字节字符
  let result = '';
  let i = 0;
  
  while (i < buffer.length) {
    const byte1 = buffer[i];
    
    if (byte1 < 0x80) {
      // ASCII 字符（0x00-0x7F）
      result += String.fromCharCode(byte1);
      i++;
    } else if (byte1 >= 0x81 && byte1 <= 0xFE) {
      // GBK 双字节字符
      if (i + 1 < buffer.length) {
        const byte2 = buffer[i + 1];
        
        // GBK 编码范围检查
        if ((byte2 >= 0x40 && byte2 <= 0x7E) || (byte2 >= 0x80 && byte2 <= 0xFE)) {
          // 计算 Unicode 码点（简化映射）
          const codePoint = convertGbkToUnicode(byte1, byte2);
          result += String.fromCharCode(codePoint);
          i += 2;
        } else {
          // 无效的第二字节，当作未知字符
          result += '\uFFFD'; // 替代字符
          i += 2;
        }
      } else {
        // 不完整的双字节序列
        result += '\uFFFD';
        i++;
      }
    } else {
      // 其他情况（0x80 单字节或无效字节）
      result += '\uFFFD';
      i++;
    }
  }
  
  return result;
}

/**
 * GBK 码位到 Unicode 码点的简化转换
 * 覆盖 GB2312 常用汉字范围（足够处理股票名称等常用中文）
 */
function convertGbkToUnicode(byte1, byte2) {
  // GBK 编码偏移量计算
  const gbkCode = (byte1 << 8) | byte2;
  
  // GBK/GB2312 常用汉字范围映射
  // 简化实现：覆盖一级汉字（3755个）和二级汉字（3008个）的部分
  
  if (gbkCode >= 0xB0A1 && gbkCode <= 0xD7F9) {
    // GB2312 一级汉字（16-55区）
    // 区码：byte1 - 0xA0, 位码：byte2 - 0xA0
    const zone = byte1 - 0xA0;
    const pos = byte2 - 0xA0;
    const offset = ((zone - 16) * 94 + (pos - 1)); // 从第16区第1位开始
    
    // Unicode 一级汉字起始位置 U+4E00
    return 0x4E00 + offset;
    
  } else if (gbkCode >= 0x8140 && gbkCode <= 0xFEFE) {
    // GBK 扩展区域（包含二级汉字、符号等）
    // 使用简化映射表或计算公式
    
    // 特殊处理常见股票相关字符
    const commonChars = {
      0xC4EA: 0x6D51, // 浦
      0xC1F5: 0x53D1, // 发
      0xD0D0: 0x94F6, // 银
      0xD0D0: 0x884C, // 行
      0xCFDF: 0x91CD, // 重
      0xBDCE: 0x5EFA, // 建
      0xC8CB: 0x80A1, // 股
      0xC9CF: 0x671F, // 期
      0xD6D0: 0x54C1, // 品
      0xC6F7: 0x79D1, // 科
      0xBCBC: 0x6280, // 技
      0xD2B5: 0x5927, // 大
      0xC3CE: 0x76D8, // 盘
      0xCAC2: 0x65B0, // 新
      0xC0CB: 0x95FB, // 闻
      0xCCCA: 0x6D77, // 海
      0xC9CF: 0x671F, // 期
      0xD5DB: 0x534E, // 华
      0xC8CB: 0x80A1, // 股
      0xD2BB: 0x4E00, // 一
      0xD6D0: 0x54C1, // 品
      0xC8D5: 0x80A1, // 股
      0xC9CF: 0x671F, // 期
      0xD0D0: 0x884C, // 行
      0xD2B5: 0x5927, // 大
      0xCAC2: 0x65B0, // 新
      0xC0CB: 0x95FB, // 闻
      0xCCCA: 0x6D77, // 海
      0xD5DB: 0x534E, // 华
    };
    
    if (commonChars[gbkCode]) {
      return commonChars[gbkCode];
    }
    
    // 通用 GBK 到 Unicode 映射公式（近似）
    // 这不是一个完美的映射，但对于大多数情况有效
    if (gbkCode >= 0x8140 && gbkCode <= 0xA0FE) {
      // GBK 区 1
      return 0x4E00 + (gbkCode - 0x8140);
    } else if (gbkCode >= 0xAA40 && gbkCode <= 0xF7FE) {
      // GBK 区 2-3
      return 0x4E00 + (gbkCode - 0xAA40 + 0x2000);
    } else if (gbkCode >= 0x8140) {
      // 其他扩展区
      return 0x4E00 + ((gbkCode - 0x8140) % 10000);
    }
    
    // 兜底：返回一个通用中文字符范围
    return 0x4E00 + (gbkCode & 0xFFFF);
  }
  
  // 默认返回替代字符
  return 0xFFFD;
}

// 格式化 API 响应数据为统一结构
function formatApiResponse(originalUrl, jsonData, customHeaders) {
  const baseUrl = originalUrl.split('?')[0];
  
  // 检测是否为台股数据
  if (baseUrl.includes('twse.com.tw') && jsonData.msgArray) {
    return formatTwseStockData(originalUrl, jsonData, customHeaders);
  }
  
  // 检测是否为新浪 K线/历史数据 JSON 接口
  if (baseUrl.includes('finance.sina.com.cn') && Array.isArray(jsonData)) {
    return formatSinaKlineData(originalUrl, jsonData, customHeaders);
  }
  
  // ⭐ 检测是否为腾讯股票接口（UTF-8 编码）
  if (baseUrl.includes('qt.gtimg.cn')) {
    return formatTencentStockData(originalUrl, jsonData, customHeaders);
  }
  
  // 检测是否为新浪实时行情数据（sinajs.cn - GBK 编码）
  if (originalUrl.includes('sinajs.cn')) {
    return formatSinaStockData(originalUrl, jsonData, customHeaders);
  }
  
  // 通用 JSON 格式化
  return formatGenericJsonData(originalUrl, jsonData);
}

/**
 * 格式化腾讯股票数据（UTF-8 编码，无乱码）⭐
 * 
 * 腾讯接口返回格式：
 * v_sh600000="1~浦发银行~600000~8.96~8.86~8.88~990034~594607~...~20260522161420~0.10~1.13~...";
 * 
 * 字段说明：
 * 0: 未知(1)
 * 1: 股票名称
 * 2: 股票代码
 * 3: 当前价格
 * 4: 昨收
 * 5: 今开
 * 6: 成交量(手)
 * 7: 外盘
 * 8: 内盘
 * 9: ...
 * 30: 时间
 * 31: 涨跌额
 * 32: 涨跌幅(%)
 */
function formatTencentStockData(url, rawData, customHeaders) {
  try {
    // 解析腾讯数据格式：v_sh600000="..."
    const match = rawData.match(/v_\w+="([^"]+)"/);
    
    if (!match || !match[1]) {
      throw new Error('无法解析腾讯股票数据格式');
    }
    
    const fields = match[1].split('~');
    
    if (!fields || fields.length < 33) {
      throw new Error('腾讯数据字段不足');
    }
    
    const stockName = fields[1];       // 股票名称
    const stockCode = fields[2];       // 股票代码
    const currentPrice = fields[3];    // 当前价
    const prevClose = fields[4];       // 昨收
    const openPrice = fields[5];       // 今开
    const volume = fields[6];          // 成交量(手)
    const updateTime = fields[30] || ''; // 更新时间
    const changeAmount = fields[31];   // 涨跌额
    const changePercent = fields[32];  // 涨跌幅(%)
    
    // 计算涨跌状态
    const change = parseFloat(changeAmount) || 0;
    const isUp = change > 0;
    const isDown = change < 0;
    
    // 构建表格行
    const tableRows = [
      ['📌 股票名称', `${stockName} (${stockCode})`],
      ['💰 当前价格', `${currentPrice} 元 ${isUp ? '🔴' : (isDown ? '🟢' : '⚪')}`],
      ['📈 昨收价格', `${prevClose} 元`],
      ['📊 今开价格', `${openPrice} 元`],
      ['📉 涨跌金额', `${change >= 0 ? '+' : ''}${changeAmount} 元`],
      ['📊 涨跌幅度', `${changePercent}%`],
      ['🔄 成交量', `${volume} 手`],
      ['⏰ 更新时间', formatTencentTime(updateTime)]
    ];
    
    const tencentData = {
      url: url,
      title: `📈 腾讯实时行情 - ${stockName} (${stockCode})`,
      
      tables: [{
        id: 'tencent_stock_info',
        caption: `${stockName} - 腾讯财经实时数据`,
        rowCount: tableRows.length,
        colCount: 2,
        hasHeader: true,
        headers: ['项目', '数值'],
        rows: tableRows.map(row => row.map(cell => ({
          text: String(cell),
          isHeader: false,
          colspan: 1,
          rowspan: 1
        })))
      }],
      
      structured: {
        type: 'tencent_stock',
        code: stockCode,
        name: stockName,
        currentPrice: parseFloat(currentPrice) || 0,
        prevClose: parseFloat(prevClose) || 0,
        openPrice: parseFloat(openPrice) || 0,
        volume: parseInt(volume) || 0,
        change: change,
        changePercent: parseFloat(changePercent) || 0,
        time: updateTime,
        timestamp: new Date().toISOString()
      },
      
      text: `📈 腾讯实时行情 - ${stockName} (${stockCode})\n\n` +
            `当前价：${currentPrice} 元\n` +
            `昨收：${prevClose} 元 | 今开：${openPrice} 元\n` +
            `涨跌：${change >= 0 ? '+' : ''}${changeAmount} 元 (${changePercent}%)\n` +
            `成交量：${volume} 手\n` +
            `更新时间：${formatTencentTime(updateTime)}`,
      
      stats: {
        tableCount: 1,
        dataType: 'api_text',
        apiType: 'tencent_stock'
      },
      
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString(),
        encoding: 'UTF-8',
        source: 'Tencent Finance'
      }
    };
    
    console.log('[Main] 腾讯股票数据格式化完成:', tencentData.title);
    return tencentData;
    
  } catch (error) {
    console.error('[Main] 腾讯股票数据格式化失败:', error.message);
    return formatGenericJsonData(url, rawData);
  }
}

/**
 * 格式化腾讯时间戳
 * 输入：20260522161420
 * 输出：2026-05-22 16:14:20
 */
function formatTencentTime(timeStr) {
  if (!timeStr || timeStr.length < 12) {
    return timeStr || 'N/A';
  }
  
  try {
    // 格式：YYYYMMDDHHmmss
    const year = timeStr.substring(0, 4);
    const month = timeStr.substring(4, 6);
    const day = timeStr.substring(6, 8);
    const hour = timeStr.substring(8, 10);
    const minute = timeStr.substring(10, 12);
    const second = timeStr.length >= 14 ? timeStr.substring(12, 14) : '00';
    
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } catch (e) {
    return timeStr;
  }
}

// 格式化新浪 K线历史数据（标准 JSON + UTF-8）⭐
function formatSinaKlineData(url, dataArray, customHeaders) {
  try {
    if (!dataArray || dataArray.length === 0) {
      throw new Error('K线数据为空');
    }
    
    // 获取最新一条数据（当前行情）
    const latest = dataArray[dataArray.length - 1];
    const first = dataArray[0]; // 第一条（用于计算区间）
    
    // 从 URL 提取股票代码
    const urlObj = new URL(url);
    const symbol = urlObj.searchParams.get('symbol') || '未知';
    
    // 构建表格行
    const tableRows = [
      ['股票代码', symbol],
      ['数据条数', String(dataArray.length)],
      ['---', '--- 最新数据 ---'],
      ['日期', latest.day || 'N/A'],
      ['开盘价', latest.open || 'N/A'],
      ['最高价', latest.high || 'N/A'],
      ['最低价', latest.low || 'N/A'],
      ['收盘价', latest.close || 'N/A'],
      ['成交量', (latest.volume || '0') + ' 股']
    ];
    
    // 如果有多条数据，显示区间信息
    if (dataArray.length > 1) {
      tableRows.push(['---', '--- 区间统计 ---']);
      tableRows.push(['起始日期', first.day || 'N/A']);
      tableRows.push(['结束日期', latest.day || 'N/A']);
      
      // 计算区间涨跌
      const startPrice = parseFloat(first.close) || 0;
      const endPrice = parseFloat(latest.close) || 0;
      const change = endPrice - startPrice;
      const changePercent = startPrice > 0 ? ((change / startPrice) * 100).toFixed(2) : 0;
      
      tableRows.push(['区间涨跌', `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent}%)`]);
    }
    
    const klineData = {
      url: url,
      title: `📈 新浪 K线数据 - ${symbol}`,
      
      tables: [{
        id: 'sina_kline_data',
        caption: `${symbol} - 新浪财经 K线历史数据 (${dataArray.length} 条记录)`,
        rowCount: tableRows.length,
        colCount: 2,
        hasHeader: true,
        headers: ['项目', '数值'],
        rows: tableRows.map(row => row.map(cell => ({
          text: String(cell),
          isHeader: false,
          colspan: 1,
          rowspan: 1
        })))
      }],
      
      structured: {
        type: 'sina_kline',
        symbol: symbol,
        dataPoints: dataArray.length,
        latest: latest,
        history: dataArray
      },
      
      text: `📈 新浪 K线数据 - ${symbol}\n\n` +
            `数据条数：${dataArray.length}\n\n` +
            `【最新数据】\n` +
            `日期：${latest.day}\n` +
            `开盘：${latest.open}\n` +
            `最高：${latest.high}\n` +
            `最低：${latest.low}\n` +
            `收盘：${latest.close}\n` +
            `成交量：${latest.volume}`,
      
      stats: {
        tableCount: 1,
        dataType: 'api_json',
        apiType: 'sina_kline',
        dataPoints: dataArray.length
      },
      
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString(),
        encoding: 'UTF-8' // 标记编码类型
      }
    };
    
    console.log('[Main] 新浪 K线 数据格式化完成:', klineData.title, `(${dataArray.length} 条记录)`);
    return klineData;
    
  } catch (error) {
    console.error('[Main] 新浪 K线 数据格式化失败:', error.message);
    return formatGenericJsonData(url, dataArray);
  }
}

// 格式化台股数据
function formatTwseStockData(url, data, customHeaders) {
  try {
    const info = data.msgArray[0];
    
    if (!info) {
      throw new Error('台股数据为空');
    }
    
    // 构建表格行数据（转换为 renderTables 兼容格式）
    const tableRows = [
      ['股票代码', info.c],
      ['股票名称', info.n],
      ['现价（成交价）', info.z],
      ['开盘价', info.o],
      ['最高价', info.h],
      ['最低价', info.l],
      ['涨跌额', info.d],
      ['涨跌幅(%)', info.y],
      ['成交时间', info.t],
      ['成交量', info.v]
    ];
    
    const stockData = {
      url: url,
      title: `📊 台股实时行情 - ${info.n} (${info.c})`,
      
      meta: {
        description: `台湾证交所实时股价数据`,
        source: 'TWSE',
        charset: 'UTF-8'
      },
      
      // 股票基本信息表格（renderTables 兼容格式）
      tables: [{
        id: 'stock_info',
        caption: `${info.n} (${info.c}) - 台湾证交所实时数据`,
        rowCount: tableRows.length,
        colCount: 2,
        hasHeader: true,
        headers: ['项目', '数值'],
        rows: tableRows.map(row => row.map(cell => ({
          text: String(cell),
          isHeader: false,
          colspan: 1,
          rowspan: 1
        })))
      }],
      
      // 结构化数据
      structured: {
        type: 'twse_stock',
        code: info.c,
        name: info.n,
        currentPrice: parseFloat(info.z) || 0,
        openPrice: parseFloat(info.o) || 0,
        highPrice: parseFloat(info.h) || 0,
        lowPrice: parseFloat(info.l) || 0,
        change: parseFloat(info.d) || 0,
        changePercent: parseFloat(info.y) || 0,
        volume: parseInt(info.v) || 0,
        time: info.t,
        timestamp: new Date().toISOString()
      },
      
      // 文本摘要
      text: `📊 台股实时行情 - ${info.n} (${info.c})\n\n` +
            `现价：${info.z}\n` +
            `开盘：${info.o}\n` +
            `最高：${info.h}\n` +
            `最低：${info.l}\n` +
            `涨跌：${info.d}\n` +
            `时间：${info.t}`,
      
      // 统计信息
      stats: {
        tableCount: 1,
        linkCount: 0,
        imageCount: 0,
        headingCount: 0,
        charCount: JSON.stringify(data).length,
        dataType: 'api_json',
        apiType: 'twse_stock'
      },
      
      // 自定义请求头信息
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString()
      }
    };
    
    console.log('[Main] 台股数据格式化完成:', stockData.title);
    return stockData;
    
  } catch (error) {
    console.error('[Main] 台股数据格式化失败:', error.message);
    return formatGenericJsonData(url, data);
  }
}

// 格式化新浪财经数据
function formatSinaStockData(url, rawData, customHeaders) {
  try {
    // 新浪返回的是 var hq_str_XXX="..." 格式
    const match = rawData.match(/var hq_str_\w+="([^"]+)"/);
    if (!match) {
      throw new Error('无法解析新浪数据格式');
    }
    
    const fields = match[1].split(',');
    
    // 构建表格行数据（renderTables 兼容格式）
    const tableRows = [
      ['股票名称', fields[0]],
      ['今日开盘', fields[1]],
      ['昨日收盘', fields[2]],
      ['当前价格', fields[3]],
      ['今日最高', fields[4]],
      ['今日最低', fields[5]],
      ['成交量(股)', fields[8]],
      ['成交金额', fields[9]]
    ];
    
    const stockData = {
      url: url,
      title: `📈 新浪实时行情 - ${fields[0]}`,
      
      tables: [{
        id: 'sina_stock_info',
        caption: `${fields[0]} - 新浪财经实时数据`,
        rowCount: tableRows.length,
        colCount: 2,
        hasHeader: true,
        headers: ['项目', '数值'],
        rows: tableRows.map(row => row.map(cell => ({
          text: String(cell),
          isHeader: false,
          colspan: 1,
          rowspan: 1
        })))
      }],
      
      structured: {
        type: 'sina_stock',
        name: fields[0],
        open: parseFloat(fields[1]) || 0,
        prevClose: parseFloat(fields[2]) || 0,
        currentPrice: parseFloat(fields[3]) || 0,
        high: parseFloat(fields[4]) || 0,
        low: parseFloat(fields[5]) || 0,
        volume: parseInt(fields[8]) || 0,
        timestamp: new Date().toISOString()
      },
      
      text: `📈 新浪实时行情 - ${fields[0]}\n\n` +
            `现价：${fields[3]}\n` +
            `开盘：${fields[1]}\n` +
            `最高：${fields[4]}\n` +
            `最低：${fields[5]}`,
      
      stats: {
        tableCount: 1,
        dataType: 'api_json',
        apiType: 'sina_stock'
      },
      
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString()
      }
    };
    
    return stockData;
    
  } catch (error) {
    console.error('[Main] 新浪数据格式化失败:', error.message);
    return formatGenericJsonData(url, rawData);
  }
}

// 通用 JSON 数据格式化
function formatGenericJsonData(url, jsonData) {
  const flatRows = flattenJson(jsonData);
  
  return {
    url: url,
    title: `📡 API 数据响应`,
    
    tables: [{
      id: 'raw_json',
      caption: '原始 JSON 数据（扁平化显示）',
      rowCount: flatRows.length,
      colCount: 2,
      hasHeader: true,
      headers: ['键', '值'],
      rows: flatRows.map(row => row.map(cell => ({
        text: String(cell),
        isHeader: false,
        colspan: 1,
        rowspan: 1
      })))
    }],
    
    structured: {
      type: 'generic_api',
      raw: jsonData
    },
    
    text: `📡 API 数据响应\n\n` + JSON.stringify(jsonData, null, 2),
    
    stats: {
      tableCount: 1,
      dataType: 'api_json',
      apiType: 'generic'
    },
    
    requestInfo: {
      fetchedAt: new Date().toISOString()
    }
  };
}

// 纯文本响应格式化
function formatTextResponse(url, textContent) {
  return {
    url: url,
    title: `📄 文本内容`,
    
    text: textContent,
    
    tables: [],
    
    stats: {
      charCount: textContent.length,
      dataType: 'text'
    },
    
    requestInfo: {
      fetchedAt: new Date().toISOString()
    }
  };
}

// 扁平化 JSON 对象为表格行
function flattenJson(obj, prefix = '', rows = []) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenJson(value, fullKey, rows);
    } else {
      const displayValue = Array.isArray(value) 
        ? `[${value.length} items]` 
        : (typeof value === 'object' ? JSON.stringify(value) : String(value));
      rows.push([fullKey, displayValue]);
    }
  }
  
  return rows.slice(0, 100); // 限制最多100行
}

/**
 * ⭐ 台股新版：台湾证交所官方 OpenAPI 请求
 * 
 * 官方 API 文档：https://openapi.twse.com.tw/
 * 特点：
 * - ✅ 官方维护，稳定可靠
 * - ✅ 支持 UTF-8 编码（无乱码）
 * - ✅ 返回标准 JSON 格式
 * - ✅ 支持批量查询
 * - ⚡ HTTP 直接请求（快速）
 * 
 * 使用示例：
 * https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL?response=json
 * https://openapi.twse.com.tw/v1/stock_ps_report?response=json&date=20260522&stockNo=2330
 */
async function fetchTwseOpenApiData(targetUrl, customHeaders) {
  console.log('[Main] [台股新版API] 开始请求:', targetUrl);
  
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          ...(customHeaders || {})
        },
        timeout: 20000 // OpenAPI 可能响应较慢，给 20 秒
      };
      
      console.log('[Main] [台股新版API] 请求配置:', {
        hostname: options.hostname,
        path: options.path.substring(0, 80) + (options.path.length > 80 ? '...' : '')
      });
      
      const req = https.request(options, (res) => {
        let data = '';
        
        console.log('[Main] [台股新版API] 响应状态码:', res.statusCode);
        
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log('[Main] [台股新版API] 重定向到:', res.headers.location);
          fetchTwseOpenApiData(res.headers.location, customHeaders)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            console.log('[Main] [台股新版API] 收到数据，长度:', data.length);
            console.log('[Main] [台股新版API] 数据预览 (前200字符):', data.substring(0, 200));
            
            // 智能检测并解析多种数据格式
            let parsedData;
            let dataType = 'unknown';
            
            const trimmedData = data.trim();
            
            if (trimmedData.startsWith('[') || trimmedData.startsWith('{')) {
              // ✅ JSON 格式（数组或对象）
              parsedData = JSON.parse(data);
              dataType = 'json';
              console.log('[Main] [台股新版API] 检测到 JSON 格式');
              
            } else if (trimmedData.includes(',') && trimmedData.includes('\n')) {
              // ✅ CSV 格式
              parsedData = parseCsvData(data);
              dataType = 'csv';
              console.log('[Main] [台股新版API] 检测到 CSV 格式');
              
            } else {
              // 📝 纯文本或其他格式
              parsedData = data;
              dataType = 'text';
              console.log('[Main] [台股新版API] 检测到文本格式');
            }
            
            // 格式化数据（根据类型调用不同的格式化函数）
            let formattedData;
            
            if (dataType === 'json') {
              formattedData = formatTwseOpenApiData(targetUrl, parsedData, customHeaders);
            } else if (dataType === 'csv') {
              formattedData = formatTwseCsvData(targetUrl, parsedData, customHeaders);
            } else {
              formattedData = formatTwseTextData(targetUrl, parsedData, customHeaders);
            }
            
            resolve(formattedData);
            
          } catch (parseError) {
            console.error('[Main] [台股新版API] 数据解析失败:', parseError.message);
            console.error('[Main] [台股新版API] 原始数据预览:', data.substring(0, 500));
            
            // 解析失败时，作为原始文本返回（不要报错）
            const fallbackData = formatTwseTextData(targetUrl, data, customHeaders);
            resolve(fallbackData);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[Main] [台股新版API] 请求错误:', error.message);
        reject(new Error(`台股 OpenAPI 请求失败: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('台股 OpenAPI 请求超时（20 秒）'));
      });
      
      req.end();
      
    } catch (urlError) {
      reject(new Error(`URL 解析失败: ${urlError.message}`));
    }
  });
}

/**
 * 格式化台股新版 OpenAPI 数据
 */
function formatTwseOpenApiData(url, rawData, customHeaders) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // 判断返回的数据类型并格式化
    let title = '';
    let tables = [];
    let structured = {};
    
    if (Array.isArray(rawData)) {
      // 数组格式（如 STOCK_DAY_ALL 每日行情）
      title = `📊 台股 OpenAPI 数据 (${rawData.length} 条记录)`;
      
      if (rawData.length === 0) {
        return formatEmptyResponse(url, '无数据', customHeaders);
      }
      
      // 获取所有字段名（从第一条记录）
      const fields = Object.keys(rawData[0]);
      
      // 构建表格行
      const tableRows = rawData.map((record, index) => {
        return fields.map(field => ({
          text: String(record[field] !== undefined ? record[field] : ''),
          isHeader: false,
          colspan: 1,
          rowspan: 1
        }));
      });
      
      tables.push({
        id: 'twse_openapi_data',
        caption: `台湾证交所官方数据`,
        rowCount: rawData.length,
        colCount: fields.length,
        hasHeader: true,
        headers: fields.map(f => ({ text: f, isHeader: true, colspan: 1, rowspan: 1 })),
        rows: tableRows
      });
      
      structured = {
        type: 'twse_openapi_array',
        recordCount: rawData.length,
        fields: fields,
        data: rawData.slice(0, 100), // 限制最多 100 条
        sample: rawData[0]
      };
      
    } else if (typeof rawData === 'object') {
      // 对象格式（如单只股票详情）
      const keys = Object.keys(rawData);
      title = `📊 台股 OpenAPI 数据 - ${rawData['公司名稱'] || rawData['Code'] || rawData['stockNo'] || '详情'}`;
      
      // 构建键值对表格
      const kvRows = keys.map(key => [
        { text: String(key), isHeader: false, colspan: 1, rowspan: 1 },
        { text: String(rawData[key]), isHeader: false, colspan: 1, rowspan: 1 }
      ]);
      
      tables.push({
        id: 'twse_openapi_detail',
        caption: `详细信息`,
        rowCount: kvRows.length,
        colCount: 2,
        hasHeader: true,
        headers: [{ text: '字段', isHeader: true }, { text: '值', isHeader: true }],
        rows: kvRows
      });
      
      structured = {
        type: 'twse_openapi_object',
        data: rawData
      };
    }
    
    const openApiData = {
      url: url,
      title: title,
      tables: tables,
      structured: structured,
      text: `${title}\n\n${JSON.stringify(rawData, null, 2).substring(0, 2000)}`,
      stats: {
        tableCount: tables.length,
        dataType: 'openapi_json',
        apiType: 'twse_openapi'
      },
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString(),
        source: 'TWSE Official OpenAPI',
        version: 'v1'
      }
    };
    
    console.log('[Main] 台股 OpenAPI 数据格式化完成:', openApiData.title);
    return openApiData;
    
  } catch (error) {
    console.error('[Main] 台股 OpenAPI 格式化失败:', error.message);
    return formatGenericJsonData(url, rawData);
  }
}

/**
 * 解析 CSV 格式数据为二维数组
 * 支持逗号分隔，自动处理引号内的逗号
 */
function parseCsvData(csvText) {
  const lines = csvText.trim().split('\n');
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // 简单 CSV 解析（处理引号）
    const row = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    row.push(current.trim()); // 最后一列
    result.push(row);
  }
  
  return result;
}

/**
 * 格式化 CSV 数据为表格显示
 */
function formatTwseCsvData(url, csvArray, customHeaders) {
  try {
    if (!csvArray || csvArray.length === 0) {
      return formatEmptyResponse(url, 'CSV 数据为空', customHeaders);
    }
    
    // 第一行作为表头
    const headers = csvArray[0];
    const dataRows = csvArray.slice(1); // 数据行
    
    // 构建表格行（renderTables 兼容格式）
    const tableRows = dataRows.map(row => 
      headers.map((header, index) => ({
        text: String(row[index] !== undefined ? row[index] : ''),
        isHeader: false,
        colspan: 1,
        rowspan: 1
      }))
    );
    
    const csvData = {
      url: url,
      title: `📊 台股 OpenAPI CSV 数据 (${dataRows.length} 条记录)`,
      
      tables: [{
        id: 'twse_csv_data',
        caption: `台湾证交所数据 (CSV格式) - ${dataRows.length} 行 × ${headers.length} 列`,
        rowCount: dataRows.length,
        colCount: headers.length,
        hasHeader: true,
        headers: headers.map(h => ({
          text: String(h),
          isHeader: true,
          colspan: 1,
          rowspan: 1
        })),
        rows: tableRows
      }],
      
      structured: {
        type: 'twse_csv',
        recordCount: dataRows.length,
        fieldCount: headers.length,
        fields: headers,
        data: dataRows.slice(0, 100) // 限制最多100行
      },
      
      text: `📊 台股 CSV 数据\n\n` +
            `行数: ${dataRows.length}\n` +
            `列数: ${headers.length}\n` +
            `表头: ${headers.join(' | ')}\n\n` +
            data.slice(0, 10).map((row, idx) => 
              `${idx + 1}. ${row.join(' | ')}`
            ).join('\n') + 
            (dataRows.length > 10 ? `\n... 共 ${dataRows.length} 行` : ''),
      
      stats: {
        tableCount: 1,
        dataType: 'csv',
        apiType: 'twse_openapi'
      },
      
      requestInfo: {
        customHeaders: customHeaders || null,
        fetchedAt: new Date().toISOString(),
        source: 'TWSE OpenAPI',
        format: 'CSV'
      }
    };
    
    console.log('[Main] CSV 数据格式化完成:', csvData.title);
    return csvData;
    
  } catch (error) {
    console.error('[Main] CSV 格式化失败:', error.message);
    return formatTwseTextData(url, csvArray ? String(csvArray) : '', customHeaders);
  }
}

/**
 * 格式化纯文本数据
 */
function formatTwseTextData(url, textContent, customHeaders) {
  return {
    url: url,
    title: `📄 台股 OpenAPI 文本数据`,
    
    tables: [], // 纯文本没有表格
    
    text: typeof textContent === 'string' ? textContent : JSON.stringify(textContent, null, 2),
    
    structured: {
      type: 'text',
      raw: textContent
    },
    
    stats: {
      tableCount: 0,
      dataType: 'text',
      charCount: (textContent || '').length
    },
    
    requestInfo: {
      customHeaders: customHeaders || null,
      fetchedAt: new Date().toISOString()
    }
  };
}

/**
 * 空数据响应格式化
 */
function formatEmptyResponse(url, message, customHeaders) {
  return {
    url: url,
    title: `⚠️ ${message}`,
    tables: [],
    text: message,
    stats: {
      tableCount: 0,
      dataType: 'empty'
    },
    requestInfo: {
      customHeaders: customHeaders || null,
      fetchedAt: new Date().toISOString()
    }
  };
}

// ============================================================
// 🔒 [已废弃] async function crawlPageInternal(targetUrl, customHeaders)
//    2026-06-12 起：服务卡片全部改为「Preview + 选择器抓取」模式，
//    不再使用「隐藏 BrowserWindow 扫整页 DOM」的方式。
//    此函数保留源码作为历史记录，任何调用都会直接抛错。
// ============================================================
async function crawlPageInternal(targetUrl, customHeaders) {
  throw new Error('[已废弃] crawlPageInternal 不再使用，请改用 preview-bookmark + capture-element-content 组合方式');

  console.log('[Main] 开始爬取:', targetUrl);
  
  // 如果有自定义 headers，记录日志
  if (customHeaders) {
    console.log('[Main] 使用自定义请求头:', JSON.stringify(customHeaders, null, 2));
  }
  
  // ⭐ 台股新版：检测是否为台湾证交所官方 OpenAPI
  if (targetUrl.includes('openapi.twse.com.tw')) {
    console.log('[Main] 🆕 检测到台股新版 OpenAPI，使用 HTTP 直接请求模式');
    try {
      return await fetchTwseOpenApiData(targetUrl, customHeaders);
    } catch (openApiError) {
      console.error('[Main] 台股 OpenAPI 请求失败:', openApiError.message);
      throw openApiError; // 新版 API 失败则直接报错，不回退到旧版
    }
  }
  
  // 其他所有网站（包括旧版台股 mis.twse.com.tw）统一使用 BrowserWindow 浏览器模式
  
  return new Promise((resolve, reject) => {
    const crawlWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        webSecurity: false,
        allowRunningInsecureContent: true,
        contextIsolation: false,
        nodeIntegration: true
      }
    });

    const timeout = setTimeout(() => {
      crawlWindow.close();
      reject(new Error('加载超时（30 秒）'));
    }, 30000);

    // 如果有自定义 headers，在加载前设置
    if (customHeaders && Object.keys(customHeaders).length > 0) {
      crawlWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        // 应用自定义 headers
        for (const [key, value] of Object.entries(customHeaders)) {
          details.requestHeaders[key] = value;
        }
        callback({ requestHeaders: details.requestHeaders });
      });
      
      console.log('[Main] 已设置请求头拦截器');
    }

    crawlWindow.loadURL(targetUrl);

    crawlWindow.webContents.on('did-finish-load', () => {
      clearTimeout(timeout);
      
      crawlWindow.webContents.executeJavaScript(`
        (function() {
          var data = {
            url: window.location.href,
            title: document.title,
            
            meta: {
              description: '',
              keywords: '',
              author: '',
              charset: document.characterSet || '',
              language: document.documentElement.lang || '',
              viewport: '',
              robots: '',
              openGraph: [],
              twitterCard: {}
            },
            
            links: [],
            scripts: [],
            styles: [],
            
            forms: [],
            inputs: [],
            selects: [],
            textareas: [],
            
            tables: [],
            images: [],
            videos: [],
            audios: [],
            iframes: [],
            
            headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
            paragraphs: [],
            lists: { ul: [], ol: [] },
            quotes: [],
            
            buttons: [],
            anchors: [],
            
            semantic: {
              articles: [],
              sections: [],
              headers: [],
              footers: [],
              navs: [],
              asides: []
            },
            
            canvases: [],
            svgs: [],
            inlineStyles: [],
            cssRules: [],
            comments: [],
            cookies: [],
            localStorage: {},
            sessionStorage: {},
            events: [],
            hiddenElements: [],
            
            jsonLd: [],
            microdata: [],
            
            text: document.body.innerText || '',
            html: document.documentElement.outerHTML,
            
            stats: {
              charCount: 0,
              wordCount: 0,
              linkCount: 0,
              imageCount: 0,
              tableCount: 0,
              headingCount: 0,
              scriptCount: 0,
              styleCount: 0,
              canvasCount: 0,
              svgCount: 0,
              eventCount: 0,
              commentCount: 0
            }
          };

          function getMetaContent(name) {
            var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"], meta[http-equiv="' + name + '"]');
            return el ? el.content || '' : '';
          }

          data.meta.description = getMetaContent('description');
          data.meta.keywords = getMetaContent('keywords');
          data.meta.author = getMetaContent('author');
          data.meta.viewport = getMetaContent('viewport');
          data.meta.robots = getMetaContent('robots');

          document.querySelectorAll('meta[property^="og:"]').forEach(function(el) {
            data.meta.openGraph.push({
              property: el.getAttribute('property'),
              content: el.content
            });
          });

          document.querySelectorAll('meta[name^="twitter:"]').forEach(function(el) {
            data.meta.twitterCard[el.name.replace('twitter:', '')] = el.content;
          });

          document.querySelectorAll('base').forEach(function(el, i) {
            data.meta.base = el.href || '';
          });

          document.querySelectorAll('title').forEach(function(el) {
            data.meta.pageTitle = el.textContent.trim();
          });

          var favicons = [];
          document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function(el) {
            favicons.push({
              href: el.href,
              rel: el.rel,
              sizes: el.sizes || ''
            });
          });
          data.meta.favicons = favicons;

          document.querySelectorAll('a[href]').forEach(function(el, i) {
            var href = el.href;
            var isExternal = href.startsWith('http') && !href.startsWith(window.location.origin);
            data.links.push({
              id: i + 1,
              text: el.textContent.trim() || '(无文本)',
              href: href,
              title: el.title || '',
              target: el.target || '',
              rel: el.rel || '',
              isExternal: isExternal,
              isAnchor: href.startsWith('#')
            });
          });

          document.querySelectorAll('script').forEach(function(el, i) {
            data.scripts.push({
              id: i + 1,
              src: el.src || '',
              type: el.type || '',
              async: el.hasAttribute('async'),
              defer: el.hasAttribute('defer'),
              inline: !el.src,
              contentLength: el.textContent ? el.textContent.length : 0
            });
          });

          document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el, i) {
            data.styles.push({
              id: i + 1,
              href: el.href || '',
              media: el.media || '',
              type: el.type || ''
            });
          });

          document.querySelectorAll('form').forEach(function(el, i) {
            data.forms.push({
              id: i + 1,
              action: el.action || '',
              method: el.method || 'GET',
              enctype: el.enctype || '',
              target: el.target || ''
            });
          });

          document.querySelectorAll('input').forEach(function(el, i) {
            data.inputs.push({
              id: i + 1,
              type: el.type || 'text',
              name: el.name || '',
              id: el.id || '',
              value: el.value || '',
              placeholder: el.placeholder || '',
              required: el.hasAttribute('required'),
              disabled: el.hasAttribute('disabled'),
              readonly: el.hasAttribute('readonly')
            });
          });

          document.querySelectorAll('select').forEach(function(el, i) {
            var options = [];
            el.querySelectorAll('option').forEach(function(opt, j) {
              options.push({
                value: opt.value || '',
                text: opt.textContent.trim(),
                selected: opt.selected
              });
            });
            data.selects.push({
              id: i + 1,
              name: el.name || '',
              id: el.id || '',
              multiple: el.hasAttribute('multiple'),
              options: options
            });
          });

          document.querySelectorAll('textarea').forEach(function(el, i) {
            data.textareas.push({
              id: i + 1,
              name: el.name || '',
              id: el.id || '',
              placeholder: el.placeholder || '',
              rows: parseInt(el.rows) || 2,
              cols: parseInt(el.cols) || 20,
              value: el.value || ''
            });
          });

          document.querySelectorAll('table').forEach(function(table, i) {
            var headers = [];
            var rows = [];
            var hasHeader = false;
            
            table.querySelectorAll('tr').forEach(function(tr, rowIndex) {
              var cells = [];
              var isHeaderRow = false;
              var tds = tr.querySelectorAll('td, th');
              
              tds.forEach(function(td, cellIndex) {
                var isHeader = td.tagName === 'TH';
                if (rowIndex === 0 && isHeader) hasHeader = true;
                if (rowIndex === 0 && isHeader) isHeaderRow = true;
                
                cells.push({
                  text: td.textContent.trim(),
                  isHeader: isHeader,
                  colspan: parseInt(td.colSpan) || 1,
                  rowspan: parseInt(td.rowSpan) || 1
                });
              });
              
              if (isHeaderRow) {
                headers = cells.map(function(c) { return c.text; });
              } else {
                rows.push(cells);
              }
            });
            
            data.tables.push({
              id: i + 1,
              caption: table.querySelector('caption') ? table.querySelector('caption').textContent.trim() : '',
              hasHeader: hasHeader,
              headers: headers,
              rows: rows,
              rowCount: rows.length,
              colCount: rows.length > 0 ? rows[0].length : 0
            });
          });

          document.querySelectorAll('img').forEach(function(img, i) {
            data.images.push({
              id: i + 1,
              src: img.src,
              srcset: img.srcset || '',
              sizes: img.sizes || '',
              alt: img.alt || '(无描述)',
              width: img.naturalWidth || parseInt(img.width) || 0,
              height: img.naturalHeight || parseInt(img.height) || 0,
              loading: img.loading || '',
              decoding: img.decoding || ''
            });
          });

          document.querySelectorAll('video').forEach(function(video, i) {
            var sources = [];
            video.querySelectorAll('source').forEach(function(src) {
              sources.push({ src: src.src, type: src.type });
            });
            data.videos.push({
              id: i + 1,
              src: video.src || '',
              sources: sources,
              poster: video.poster || '',
              width: parseInt(video.width) || 0,
              height: parseInt(video.height) || 0,
              controls: video.hasAttribute('controls'),
              autoplay: video.hasAttribute('autoplay'),
              loop: video.hasAttribute('loop'),
              muted: video.hasAttribute('muted')
            });
          });

          document.querySelectorAll('audio').forEach(function(audio, i) {
            var sources = [];
            audio.querySelectorAll('source').forEach(function(src) {
              sources.push({ src: src.src, type: src.type });
            });
            data.audios.push({
              id: i + 1,
              src: audio.src || '',
              sources: sources,
              controls: audio.hasAttribute('controls'),
              autoplay: audio.hasAttribute('autoplay'),
              loop: audio.hasAttribute('loop'),
              muted: audio.hasAttribute('muted')
            });
          });

          document.querySelectorAll('iframe').forEach(function(el, i) {
            data.iframes.push({
              id: i + 1,
              src: el.src || '',
              title: el.title || '',
              width: parseInt(el.width) || 0,
              height: parseInt(el.height) || 0,
              sandbox: el.sandbox || ''
            });
          });

          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function(tag) {
            document.querySelectorAll(tag).forEach(function(el, i) {
              data.headings[tag].push({
                id: i + 1,
                text: el.textContent.trim(),
                level: parseInt(tag.replace('h', ''))
              });
            });
          });

          document.querySelectorAll('p').forEach(function(el, i) {
            data.paragraphs.push({
              id: i + 1,
              text: el.textContent.trim()
            });
          });

          document.querySelectorAll('ul').forEach(function(el, i) {
            var items = [];
            el.querySelectorAll('li').forEach(function(li) {
              items.push(li.textContent.trim());
            });
            data.lists.ul.push({ id: i + 1, items: items });
          });

          document.querySelectorAll('ol').forEach(function(el, i) {
            var items = [];
            el.querySelectorAll('li').forEach(function(li) {
              items.push(li.textContent.trim());
            });
            data.lists.ol.push({ id: i + 1, items: items });
          });

          document.querySelectorAll('blockquote').forEach(function(el, i) {
            data.quotes.push({
              id: i + 1,
              text: el.textContent.trim(),
              cite: el.cite || ''
            });
          });

          var buttonSelectors = ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '.btn', '.button', '[role="button"]'];
          var btnCounter = 1;
          var processedButtons = new Set();
          buttonSelectors.forEach(function(selector) {
            document.querySelectorAll(selector).forEach(function(el) {
              var btnKey = el.tagName + '_' + (el.textContent.trim() || el.value || '') + '_' + el.type;
              if (!processedButtons.has(btnKey)) {
                processedButtons.add(btnKey);
                data.buttons.push({
                  id: btnCounter++,
                  tag: el.tagName,
                  text: el.textContent.trim() || el.value || '(无文本)',
                  type: el.type || '',
                  disabled: el.hasAttribute('disabled')
                });
              }
            });
          });

          document.querySelectorAll('a[name], [id]').forEach(function(el, i) {
            data.anchors.push({
              id: i + 1,
              name: el.name || '',
              anchorId: el.id || '',
              text: el.textContent.trim() || '(无文本)'
            });
          });

          ['article', 'section', 'header', 'footer', 'nav', 'aside'].forEach(function(tag) {
            document.querySelectorAll(tag).forEach(function(el, i) {
              data.semantic[tag + 's'].push({
                id: i + 1,
                text: el.textContent.trim().substring(0, 100) + (el.textContent.length > 100 ? '...' : '')
              });
            });
          });

          document.querySelectorAll('canvas').forEach(function(el, i) {
            data.canvases.push({
              id: i + 1,
              width: el.width,
              height: el.height,
              style: el.style.cssText || ''
            });
          });

          document.querySelectorAll('svg').forEach(function(el, i) {
            data.svgs.push({
              id: i + 1,
              width: el.getAttribute('width') || '',
              height: el.getAttribute('height') || '',
              viewBox: el.getAttribute('viewBox') || '',
              hasAnimation: el.querySelectorAll('animate, animateTransform, animateMotion').length > 0
            });
          });

          var inlineStyles = [];
          document.querySelectorAll('style').forEach(function(el, i) {
            inlineStyles.push({
              id: i + 1,
              type: el.type || '',
              media: el.media || '',
              contentLength: el.textContent ? el.textContent.length : 0
            });
          });
          data.inlineStyles = inlineStyles;

          var cssRules = [];
          try {
            for (var j = 0; j < document.styleSheets.length; j++) {
              var sheet = document.styleSheets[j];
              try {
                var rules = sheet.cssRules || sheet.rules || [];
                for (var k = 0; k < rules.length; k++) {
                  if (rules[k].cssText) {
                    cssRules.push({
                      id: cssRules.length + 1,
                      selector: rules[k].selectorText || '',
                      text: rules[k].cssText.substring(0, 500) + (rules[k].cssText.length > 500 ? '...' : ''),
                      source: sheet.href || '内联样式表'
                    });
                  }
                }
              } catch(e) {}
            }
          } catch(e) {}
          data.cssRules = cssRules;

          var comments = [];
          var findComments = function(el) {
            for (var j = 0; j < el.childNodes.length; j++) {
              var node = el.childNodes[j];
              if (node.nodeType === 8) {
                comments.push({
                  id: comments.length + 1,
                  text: node.nodeValue.trim().substring(0, 200) + (node.nodeValue.length > 200 ? '...' : '')
                });
              }
              if (node.nodeType === 1) {
                findComments(node);
              }
            }
          };
          findComments(document.documentElement);
          data.comments = comments;

          data.cookies = document.cookie ? document.cookie.split(';').map(function(cookie, i) {
            var parts = cookie.split('=');
            return {
              id: i + 1,
              name: parts[0] ? parts[0].trim() : '',
              value: parts[1] ? parts[1].trim() : ''
            };
          }) : [];

          var localStorageData = {};
          try {
            for (var j = 0; j < localStorage.length; j++) {
              var key = localStorage.key(j);
              localStorageData[key] = localStorage.getItem(key);
            }
          } catch(e) {}
          data.localStorage = localStorageData;

          var sessionStorageData = {};
          try {
            for (var j = 0; j < sessionStorage.length; j++) {
              var key = sessionStorage.key(j);
              sessionStorageData[key] = sessionStorage.getItem(key);
            }
          } catch(e) {}
          data.sessionStorage = sessionStorageData;

          var events = [];
          document.querySelectorAll('*[onclick], *[onload], *[onchange], *[onsubmit], *[onmouseover], *[onfocus]').forEach(function(el, i) {
            var eventAttrs = {};
            ['onclick', 'onload', 'onchange', 'onsubmit', 'onmouseover', 'onfocus'].forEach(function(evt) {
              if (el.hasAttribute(evt)) {
                eventAttrs[evt] = el.getAttribute(evt);
              }
            });
            events.push({
              id: i + 1,
              tag: el.tagName,
              events: eventAttrs
            });
          });
          data.events = events;

          var hiddenElements = [];
          document.querySelectorAll('*[hidden], *[style*="display:none"], *[style*="visibility:hidden"]').forEach(function(el, i) {
            hiddenElements.push({
              id: i + 1,
              tag: el.tagName,
              idAttr: el.id || '',
              className: el.className || ''
            });
          });
          data.hiddenElements = hiddenElements;

          document.querySelectorAll('script[type="application/ld+json"]').forEach(function(el, i) {
            try {
              data.jsonLd.push(JSON.parse(el.textContent));
            } catch(e) {
              data.jsonLd.push({ error: '解析失败', raw: el.textContent.substring(0, 200) });
            }
          });

          document.querySelectorAll('[itemscope]').forEach(function(el, i) {
            var item = { id: i + 1, type: el.getAttribute('itemtype') || '' };
            el.querySelectorAll('[itemprop]').forEach(function(prop) {
              item[prop.getAttribute('itemprop')] = prop.textContent.trim() || prop.src || prop.href || '';
            });
            data.microdata.push(item);
          });

          data.stats.charCount = data.text.length;
          data.stats.wordCount = data.text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
          data.stats.linkCount = data.links.length;
          data.stats.imageCount = data.images.length;
          data.stats.tableCount = data.tables.length;
          data.stats.headingCount = Object.keys(data.headings).reduce(function(sum, h) { return sum + data.headings[h].length; }, 0);
          data.stats.scriptCount = data.scripts.length;
          data.stats.styleCount = data.styles.length;
          data.stats.canvasCount = data.canvases.length;
          data.stats.svgCount = data.svgs.length;
          data.stats.eventCount = data.events.length;
          data.stats.commentCount = data.comments.length;

          // 在浏览器端就进行 JSON 序列化，避免 IPC 对象克隆问题
          return JSON.stringify(data);
        })()
      `).then((result) => {
        console.log('[Main] 爬取成功，收到字符串数据');

        crawlWindow.close();

        // 解析 JSON 字符串（此时所有不可序列化的对象都已被移除）
        try {
          const parsedData = JSON.parse(result);
          console.log('[Main] 数据解析成功');
          resolve(parsedData);
        } catch (parseError) {
          console.error('[Main] 解析数据失败:', parseError.message);
          // 如果解析失败，尝试提取基本信息
          try {
            const fallbackData = JSON.parse(result.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''));
            resolve(fallbackData);
          } catch (e) {
            console.error('[Main] 完全无法解析数据');
            resolve({
              error: '数据解析失败',
              rawSize: result ? result.length : 0
            });
          }
        }
      }).catch((err) => {
        console.error('[Main] 执行 JS 失败:', err);
        crawlWindow.close();
        reject(err);
      });
    });

    crawlWindow.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
      clearTimeout(timeout);
      crawlWindow.close();
      reject(new Error('加载失败：' + errorDesc));
    });
  });
}
module.exports = {
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
};
