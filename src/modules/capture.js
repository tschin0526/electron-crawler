/**
 * 选择器抓取与AI回复抓取模组
 * 从 renderer.js 拆分而来
 * 包含：选择器策略生成、内容抓取、手动监控、AI回复抓取、DOM树查看
 * 依赖：showStatus, bookmarks, getCurrentWebview, appendChatMessage, sendEmailAfterReply（来自其他模组）
 */
// 生成选择器策略列表（从精确到模糊）
function generateSelectorStrategies(selector) {
  const strategies = [];

  if (!selector || !selector.trim()) {
    return [];
  }

  const cleanSelector = selector.trim();

  // 策略1：优先提取 data 属性选择器（最稳定，不受 Tailwind 类名变化影响）
  const dataAttrs = cleanSelector.match(/\[[\w-]+=["'][^"']+["']\]/g);
  if (dataAttrs && dataAttrs.length > 0) {
    const dataOnlyAttrs = dataAttrs.filter(attr => attr.includes('data-'));
    if (dataOnlyAttrs.length > 0) {
      const lastDataAttr = dataOnlyAttrs[dataOnlyAttrs.length - 1];
      const tagMatch = cleanSelector.match(/^([a-zA-Z][\w-]*)/);
      const tag = tagMatch ? tagMatch[1] : 'div';
      strategies.push(tag + lastDataAttr);
    }
  }

  // 策略2：提取包含 ID 的部分
  const idMatch = cleanSelector.match(/#[\w-]+/);
  if (idMatch) {
    strategies.push(idMatch[0]);
  }

  // 策略3：简化选择器 - 只保留最后几层（更灵活）
  const parts = cleanSelector.split(' > ');
  if (parts.length > 4) {
    strategies.push(parts.slice(-3).join(' > '));
    strategies.push(parts.slice(-2).join(' > '));
    strategies.push(parts[parts.length - 1]);
  } else if (parts.length > 2) {
    strategies.push(parts.slice(-2).join(' > '));
    strategies.push(parts[parts.length - 1]);
  } else if (parts.length > 1) {
    strategies.push(parts[parts.length - 1]);
  }

  // 策略4：清理最后一层的 Tailwind 类，只保留有意义的部分
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    const cleanedLast = simplifyClassSelector(lastPart);
    if (cleanedLast && cleanedLast !== lastPart) {
      strategies.push(cleanedLast);
      if (parts.length > 1) {
        strategies.push(parts[parts.length - 2] + ' > ' + cleanedLast);
      }
    }
  }

  // 策略5：原始选择器（放在后面，因为它最容易失败）
  strategies.push(cleanSelector);

  // 去重（保持顺序）
  const unique = [];
  const seen = new Set();
  for (const s of strategies) {
    if (s && !seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  }

  console.log('[Renderer] 📋 生成', unique.length, '个选择器策略');
  return unique;
}

// 简化选择器中的 class 部分（清理 Tailwind 通用类）
function simplifyClassSelector(selectorPart) {
  if (!selectorPart) return '';
  
  // 提取标签名
  const tagMatch = selectorPart.match(/^([a-zA-Z][\w-]*)/);
  const tag = tagMatch ? tagMatch[1] : 'div';
  
  // 提取所有 class
  const classMatch = selectorPart.match(/\.[\w-]+/g);
  if (!classMatch) return '';
  
  // 过滤掉常见的 Tailwind 通用类
  const commonTailwind = [
    '.flex', '.flex-row', '.flex-col', '.flex-grow', '.flex-shrink',
    '.w-full', '.max-w-full', '.min-w-0', '.min-w-full',
    '.h-full', '.max-h-full',
    '.overflow-y-auto', '.overflow-hidden', '.overflow-x-auto',
    '.relative', '.absolute',
    '.space-y-0', '.space-y-2', '.space-y-3', '.space-y-4',
    '.mx-auto', '.my-auto',
    '.font-sans', '.font-mono',
    '.text-sm', '.text-base', '.text-lg',
    '.p-0', '.p-2', '.p-3', '.p-4', '.px-2', '.px-3', '.px-4', '.py-2', '.py-3', '.py-4',
    '.m-0', '.m-2', '.m-4',
    '.rounded', '.rounded-lg', '.rounded-md',
    '.shadow', '.shadow-sm',
    '.bg-white', '.bg-gray-50', '.bg-gray-100',
    '.border', '.border-gray-200',
    '.gap-2', '.gap-3', '.gap-4',
    '.items-center', '.items-start', '.items-end',
    '.justify-center', '.justify-between',
    '.text-left', '.text-center', '.text-right',
    '.whitespace-nowrap', '.truncate',
    '.inline-flex', '.inline-block',
    '.block', '.inline',
    '.cursor-pointer',
    '.focus:outline-none', '.focus:ring-2',
    '.hover:bg-gray-50', '.hover:text-blue-600',
    '.transition', '.duration-200',
    '.resize-none',
    '.antialiased',
    '.tracking-tight', '.tracking-wide',
    '.leading-normal', '.leading-relaxed',
    '.break-words', '.break-all',
  ];
  
  const meaningfulClasses = classMatch.filter(c => !commonTailwind.includes(c));
  
  if (meaningfulClasses.length === 0) {
    return tag; // 只有标签名
  }
  
  // 只取最有意义的 2-3 个类
  return tag + meaningfulClasses.slice(0, 3).join('');
}

// 使用自定义选择器获取AI回复
async function captureWithCustomSelector(webview, selector, expectedContent = null) {
  console.log('[Renderer]  【自定义选择器】使用:', selector);

  // 先验证选择器
  if (!isValidCssSelector(selector)) {
    console.log('[Renderer] ️ 选择器包含无效语法，尝试清理...');
    const sanitized = sanitizeSelector(selector);

    if (!sanitized) {
      console.error('[Renderer] ❌ 选择器清理后为空，无法执行');
      return { success: false, error: '选择器包含非标准语法且无法清理' };
    }

    console.log('[Renderer] 🧹 清理后的选择器:', sanitized);
    selector = sanitized;
  }

  try {
    // 生成多个选择器策略：从精确到模糊
    const selectorStrategies = generateSelectorStrategies(selector);
    console.log('[Renderer] 📋 选择器策略列表:', selectorStrategies);
    
    // 按优先级依次尝试每个策略
    for (let i = 0; i < selectorStrategies.length; i++) {
      const currentSelector = selectorStrategies[i];
      console.log(`[Renderer]  尝试策略 ${i + 1}/${selectorStrategies.length}:`, currentSelector);
      
      const escapedSelector = currentSelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      // ✨ 升级：同时获取 innerHTML（保留格式）和 textContent（纯文本）
      const jsCode = "(function() { var expectedContent = " + (expectedContent ? JSON.stringify(expectedContent) : 'null') + "; try { console.log('[Webview] 查找选择器:', '" + escapedSelector + "'); var elements = document.querySelectorAll('" + escapedSelector + "'); if (!elements.length) { return { success: false, error: '未找到匹配元素' }; } console.log('[Webview] 找到', elements.length, '个匹配元素'); var targetEl = null; for (var idx = 0; idx < elements.length; idx++) { var candidate = elements[idx]; if (!candidate) continue; var style = window.getComputedStyle(candidate); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue; var text = candidate.innerText || candidate.textContent || ''; text = text.trim(); if (text.length >= 1) { targetEl = candidate; } } if (!targetEl) { return { success: false, error: '未找到可见元素' }; } console.log('[Webview] 选择最后一个可见的元素，索引:', elements.length - 1); var clone = targetEl.cloneNode(true); var refEls = clone.querySelectorAll('[class*=reference], [class*=search-result], [class*=source-link], [class*=citation], [class*=think-tag], [class*=think-content], [class*=tool-call]'); refEls.forEach(function(el) { el.remove(); }); var refBtns = clone.querySelectorAll('button, a'); refBtns.forEach(function(btn) { var t = (btn.innerText || '').trim(); if (/\\d+\\s*个网页/.test(t) || /参考|来源|引用|search|source|citation/i.test(t)) { btn.remove(); } }); var text = clone.innerText || clone.textContent || ''; var html = clone.innerHTML || ''; text = text.replace(/^思考完成[：:]\\\\s*/i, ''); text = text.replace(/^准备输出结果[：:]\\\\s*/i, ''); text = text.trim(); const isVisible = targetEl.offsetWidth > 0 && targetEl.offsetHeight > 0; if (text && text.length >= 1 && isVisible) { console.log('[Webview] ✅ 找到符合条件的元素'); return { success: true, content: text, html: html, element: { tag: targetEl.tagName ? targetEl.tagName.toLowerCase() : 'unknown', id: targetEl.id || '', className: targetEl.className || '' } }; } else { console.log('[Webview] ⚠️ 元素内容不足或不可见'); return { success: false, error: '元素内容不足（<1字符）或不可见' }; } } catch (e) { console.error('[Webview] 执行错误:', e); return { success: false, error: e.toString() }; } })();";
      
      const result = await webview.executeJavaScript(jsCode);
      
      if (result && result.success) {
        console.log('[Renderer] ✅ 策略', i + 1, '成功！');
        return result;
      }
      
      console.log('[Renderer] ⚠️ 策略', i + 1, '失败:', result?.error);
    }
    
    console.log('[Renderer] ❌ 所有', selectorStrategies.length, '个选择器策略均失败');
    return { success: false, error: '所有选择器策略均未找到匹配元素，页面结构可能已更新' };
    
  } catch (error) {
    console.error('[Renderer] ❌ executeJavaScript 抛出异常:', error);
    return { success: false, error: 'executeJavaScript 异常: ' + error.message };
  }
}

// 手动获取AI回复（点击工具栏按钮触发）
async function startManualMonitoring() {
  console.log('[Renderer] 📥 === 开始获取AI回复流程 ===');
  console.log('[Renderer] 📊 初始状态:');
  console.log('[Renderer]   - window.currentBookmarkIndex:', window.currentBookmarkIndex);
  console.log('[Renderer]   - window.currentReplySelector:', window.currentReplySelector);
  console.log('[Renderer]   - window.currentPresetMessage:', window.currentPresetMessage ? '(有预设消息)' : '(无)');
  
  const webview = getCurrentWebview();
  if (!webview) {
    showStatus('❌ 未找到网页预览组件', 'error');
    return;
  }
  
  // 获取当前URL，判断是哪个平台
  let currentUrl = '';
  try {
    currentUrl = await webview.getURL();
    console.log('[Renderer] 📌 当前webview URL:', currentUrl);
  } catch (e) {
    console.warn('[Renderer] 获取URL失败:', e);
  }
  
  // 先清除主界面可能存在的旧结果
  const oldResponseContainer = document.getElementById('capturedResponseContainer');
  if (oldResponseContainer) {
    oldResponseContainer.remove();
  }
  
  // 打开独立窗口
  try {
    await window.electronAPI.openAiResponseViewer();
    // 等待一小段时间确保查看器窗口完全加载
    await new Promise(resolve => setTimeout(resolve, 300));
  } catch (e) {
    console.error('[Renderer] 打开 AI 回复查看器失败:', e);
  }
  
  // 立即将选择器值发送到 AI 回复查看器（在设置加载状态之前）
  try {
    console.log('[Renderer] 📡 提前发送选择器到查看器（初始值）');
    await window.electronAPI.setAiResponseSelector('(获取中...)');
  } catch (e) {
    console.error('[Renderer]  发送初始选择器失败:', e);
  }
  
  // 显示加载状态
  try {
    await window.electronAPI.setAiResponseLoading('正在获取 AI 回复...');
  } catch (e) {
    console.error('[Renderer] 设置加载状态失败:', e);
  }
  
  showStatus(' 正在获取 AI 回复...', 'info');
  
  // 通过 IPC 重新加载最新的书签数据，确保使用最新的选择器配置
  let customSelector = '';
  let heartbeatSelector = '';
  let monitorTimeout = 0;
  let debugMsg = '';
  let freshBookmarks = [];
  
  try {
    // 从主进程重新加载书签数据（书签存在文件中，不是 localStorage）
    freshBookmarks = await window.electronAPI.loadBookmarks();
    console.log('[Renderer] 📋 书签总数:', freshBookmarks ? freshBookmarks.length : 0);
    console.log('[Renderer] 📋 当前书签索引 (window.currentBookmarkIndex):', window.currentBookmarkIndex);
    console.log('[Renderer] 📋 当前 URL:', currentUrl);
    
    // 打印所有书签的 URL 和选择器（调试用）
    if (freshBookmarks && freshBookmarks.length > 0) {
      freshBookmarks.forEach((bm, idx) => {
        console.log(`[Renderer] 📌 书签[${idx}]: ${bm.name} | URL: ${bm.url} | 选择器: ${bm.replySelector || '(空)'}${bm.heartbeatSelector ? ' | 💓: ' + bm.heartbeatSelector : ''}`);
      });
    }
    
    // 优先使用当前工作区的 bookmarkIndex，确保使用正确工作区的网点设定
    const wsBookmarkIndex = workspaces[currentWorkspaceId]?.bookmarkIndex;
    const currentIndex = (wsBookmarkIndex !== null && wsBookmarkIndex !== undefined) ? wsBookmarkIndex : window.currentBookmarkIndex;
    
    console.log('[Renderer] 🔍 书签查找调试信息:');
    console.log('[Renderer]   - 当前工作区:', currentWorkspaceId);
    console.log('[Renderer]   - 工作区 bookmarkIndex:', wsBookmarkIndex);
    console.log('[Renderer]   - 全局 currentBookmarkIndex:', window.currentBookmarkIndex);
    console.log('[Renderer]   - 最终使用 currentIndex:', currentIndex);
    console.log('[Renderer]   - freshBookmarks.length:', freshBookmarks ? freshBookmarks.length : 0);
    
    // 方法 1：通过索引查找（最可靠）—— 同时获取 replySelector 和 heartbeatSelector
    if (freshBookmarks && currentIndex !== undefined && currentIndex !== null && freshBookmarks[currentIndex]) {
      customSelector = freshBookmarks[currentIndex].replySelector || '';
      heartbeatSelector = freshBookmarks[currentIndex].heartbeatSelector || '';
      monitorTimeout = freshBookmarks[currentIndex].monitorTimeout || 0;
      debugMsg = `书签：${freshBookmarks[currentIndex].name || '未知'}（索引 ${currentIndex}）`;
      console.log('[Renderer] ✅ 方法 1 成功：通过索引找到书签');
      console.log('[Renderer]   - 书签名称:', freshBookmarks[currentIndex].name);
      console.log('[Renderer]   - replySelector:', customSelector);
      console.log('[Renderer]   - heartbeatSelector:', heartbeatSelector);
      console.log('[Renderer]   - monitorTimeout:', monitorTimeout);
    }
    
    // 方法 2：如果索引方式失败，通过 URL 匹配查找（同时获取 replySelector 和 heartbeatSelector）
    if (!customSelector && !heartbeatSelector && currentUrl && freshBookmarks && freshBookmarks.length > 0) {
      console.log('[Renderer] 🔄 方法 1 失败，尝试方法 2：通过 URL 匹配...');
      
      // 提取当前域名
      const getCurrentHostname = () => {
        try {
          return new URL(currentUrl).hostname.toLowerCase();
        } catch {
          return currentUrl.toLowerCase().split('/')[2] || '';
        }
      };
      
      const currentHostname = getCurrentHostname();
      console.log('[Renderer]  当前域名:', currentHostname);
      
      for (const bm of freshBookmarks) {
        if (!bm.url) continue;
        
        try {
          const bookmarkHostname = new URL(bm.url).hostname.toLowerCase();
          console.log(`[Renderer] 📍 比较：当前 "${currentHostname}" vs 书签 "${bookmarkHostname}" | 书签名: ${bm.name} | 选择器: ${bm.replySelector || '(空)'}`);
          
          if (currentHostname === bookmarkHostname) {
            customSelector = bm.replySelector || '';
            heartbeatSelector = bm.heartbeatSelector || '';
            monitorTimeout = bm.monitorTimeout || 0;
            debugMsg = `书签：${bm.name || '未知'}（域名匹配）`;
            console.log('[Renderer] ✅ 方法 2 成功：通过域名匹配找到书签:', bm.name);
            console.log('[Renderer]   - replySelector:', customSelector);
            console.log('[Renderer]   - heartbeatSelector:', heartbeatSelector);
            break;
          }
        } catch (e) {
          console.warn(`[Renderer]  解析书签 URL 失败: ${bm.url}`, e);
        }
      }
    }
    
    if (!debugMsg && freshBookmarks && freshBookmarks.length > 0) {
      debugMsg = `未匹配（索引：${currentIndex ?? 'null'}，总数：${freshBookmarks.length}）`;
    } else if (!freshBookmarks || freshBookmarks.length === 0) {
      debugMsg = '无书签数据';
    }
    
  } catch (e) {
    debugMsg = `加载失败：${e.message}`;
    console.error('[Renderer] ❌ 加载书签数据失败:', e);
  }

  // 💓：更新监控全局变量（heartbeatSelector 优先用于监控，replySelector 用于内容抓取）
  if (heartbeatSelector) {
    window.__monitorHeartbeatSelector = heartbeatSelector;
    console.log('[Renderer] 💓 更新监控心跳选择器:', heartbeatSelector);
  }
  if (customSelector) {
    window.__monitorReplySelector = customSelector;
    console.log('[Renderer] 🎯 更新监控回复选择器:', customSelector);
  } else if (window.currentReplySelector) {
    window.__monitorReplySelector = window.currentReplySelector;
    console.log('[Renderer] 🎯 使用后备回复选择器:', window.currentReplySelector);
  }
  // ⏱️：更新监控超时时间（AI 思考较慢的站点设置更长的超时）
  if (monitorTimeout && monitorTimeout > 0) {
    window.__monitorTimeout = monitorTimeout;
    console.log('[Renderer] ⏱️ 更新监控超时时间:', monitorTimeout, 'ms');
  }
  
  // 如果从主进程加载失败，尝试使用 window.currentReplySelector 作为后备
  if (!customSelector) {
    debugMsg += ` 🔄 后备：${window.currentReplySelector || '(空)'}`;
    customSelector = window.currentReplySelector || '';
    console.log('[Renderer]  使用后备选择器:', customSelector);
  }
  
  console.log('[Renderer]  最终使用的自定义选择器:', customSelector);
  console.log('[Renderer] 💓 最终使用的心跳选择器:', heartbeatSelector);

  // 永久显示调试信息在状态栏（显示内容抓取的选择器 + 监控用心跳选择器）
  const selectorValue = customSelector || '(空)';
  const heartbeatValue = heartbeatSelector || '(空)';
  const fullDebugMsg = `${debugMsg} | 选择器：${selectorValue}${heartbeatSelector ? ` | 💓监控：${heartbeatValue}` : ''}`;
  showStatus(fullDebugMsg, customSelector ? 'success' : 'warning');

  // 立即将选择器值发送到 AI 回复查看器
  try {
    console.log('[Renderer] 📡 发送选择器到查看器:', customSelector);
    console.log('[Renderer] 📊 选择器详细信息:', {
      customSelector: customSelector,
      heartbeatSelector: heartbeatSelector,
      customSelectorType: typeof customSelector,
      customSelectorLength: customSelector.length,
      debugMsg: debugMsg,
      currentIndex: currentIndex,
      fallbackSelector: window.currentReplySelector
    });

    // 发送选择器到查看器（内容抓取始终用 customSelector，heartbeat 仅用于监控）
    await window.electronAPI.setAiResponseSelector(customSelector || '');
    console.log('[Renderer] ✅ 选择器已发送到查看器');
    
    // 再次确认发送成功
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('[Renderer] ✅ 选择器发送确认完成');
  } catch (e) {
    console.error('[Renderer] ❌ 发送选择器失败:', e);
    console.error('[Renderer]  错误堆栈:', e.stack);
  }
  
  // 判断平台名称
  let platformName = 'AI 平台';
  if (currentUrl.includes('yiyan.baidu.com')) {
    platformName = '文心一言';
  } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
    platformName = '豆包';
  } else if (currentUrl.includes('finance.sina.com.cn') || currentUrl.includes('sina.com.cn')) {
    platformName = '新浪财经';
  } else if (currentUrl.includes('chatglm.cn') || currentUrl.includes('z.ai')) {
    platformName = '智谱清言';
  } else if (currentUrl.includes('deepseek.com')) {
    platformName = 'DeepSeek';
  } else if (currentUrl.includes('yuanbao.tencent.com') || currentUrl.includes('yuanbao.qq.com')) {
    platformName = '腾讯元宝';
  } else if (currentUrl.includes('tongyi.aliyun.com') || currentUrl.includes('qianwen.aliyun.com')) {
    platformName = '通义千问';
  }
  
  try {
    let capturedResult = null;
    
    // 优先使用自定义选择器
    if (customSelector) {
      console.log('[Renderer] 🎯 【优先】使用自定义选择器:', customSelector);
      const customResult = await captureWithCustomSelector(webview, customSelector);
      if (customResult && customResult.success) {
        // 自定义选择器获取成功，创建回复对象
        const now = new Date().toISOString();
        capturedResult = {
          content: customResult.content,
          html: customResult.html || '',  // ✨ 新增：保留 HTML 格式
          timestamp: now,
          url: currentUrl,
          platform: platformName,
          responseDuration: 0,
          selector: customSelector
        };
        console.log('[Renderer] ✅ 【自定义选择器】获取成功！');
      } else {
        // 自定义选择器获取失败，直接报错
        console.error('[Renderer] ❌ 【自定义选择器】获取失败:', customResult?.error);
        const errorMsg = `自定义选择器 "${customSelector}" 未找到内容: ${customResult?.error || '未知错误'}`;
        
        try {
          await window.electronAPI.setAiResponseError(errorMsg);
        } catch (e) {}
        
        showStatus(`❌ ${errorMsg}`, 'error');
        return;
      }
    }
    
    // 如果没有自定义选择器，或者自定义选择器失败了，使用默认逻辑
    if (!capturedResult) {
      // 检查是否是 AI 平台
      const isAIPlatform = currentUrl.includes('yiyan.baidu.com') || 
                          currentUrl.includes('doubao.com') || 
                          currentUrl.includes('doubao.cn') ||
                          currentUrl.includes('chatglm.cn') ||
                          currentUrl.includes('deepseek.com');
      
      if (isAIPlatform) {
        // AI 平台：使用专属函数
        let result = null;
        
        if (currentUrl.includes('yiyan.baidu.com')) {
          console.log('[Renderer] 🎯 【文心一言专属】调用 wenXinCaptureAIResponse()');
          result = await wenXinCaptureAIResponse(webview, 180000);
        } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
          console.log('[Renderer] 🎯 【豆包专属】调用 doubaoCaptureAIResponse()');
          result = await doubaoCaptureAIResponse(webview, 180000);
        } else {
          console.log('[Renderer] 🎯 【通用平台】调用 captureAIResponse()');
          result = await captureAIResponse(webview, 180000);
        }
        
        if (result && result.content) {
          capturedResult = {
            content: result.content,
            html: result.html || '',  // ✨ 新增：保留 HTML 格式（如果有）
            timestamp: result.timestamp || new Date().toISOString(),
            url: currentUrl,
            platform: platformName,
            responseDuration: result.responseDuration
          };
        }
      } else {
        // 非 AI 平台：提示用户设置自定义选择器
        console.warn('[Renderer] ⚠️ 非 AI 平台，请设置自定义选择器');
        showStatus('⚠️ 当前不是 AI 平台，请在书签编辑中设置「自定义回复选择器」', 'warning');
        try {
          await window.electronAPI.setAiResponseError('⚠️ 当前不是 AI 平台，请设置自定义回复选择器');
        } catch (e) {}
        return;
      }
    }
    
    // 如果获取成功，显示结果
    if (capturedResult && capturedResult.content) {
      // 只在独立窗口显示结果，不在主界面显示
      // displayCapturedResponse(capturedResult);
      
      // 发送数据到独立窗口
      try {
        await window.electronAPI.setAiResponseData(capturedResult);
      } catch (e) {
        console.error('[Renderer] 发送数据到 AI 回复查看器失败:', e);
      }
      
      const charCount = capturedResult.content.length;
      showStatus(`✅ 成功捕获 AI 回复（${charCount} 字符）`, 'success');
      console.log('[Renderer] ✅ === AI 回复获取完成 ===');
    } else {
      const errorMsg = '未获取到 AI 回复内容';
      
      try {
        await window.electronAPI.setAiResponseError(errorMsg);
      } catch (e) {
        console.error('[Renderer] 发送错误到 AI 回复查看器失败:', e);
      }
      
      showStatus('⚠️ ' + errorMsg, 'warning');
      console.warn('[Renderer] ⚠️ === AI 回复获取失败 ===');
    }
  } catch (error) {
    console.error('[Renderer] ❌ === AI 回复获取错误 ===', error);
    
    try {
      await window.electronAPI.setAiResponseError('获取 AI 回复时出错: ' + error.message);
    } catch (e) {
      console.error('[Renderer] 发送错误到 AI 回复查看器失败:', e);
    }
    
    showStatus('❌ 获取 AI 回复时出错: ' + error.message, 'error');
  }
}

// 🆕 获取按钮下拉菜单控制（动态创建到 document.body 以覆盖 webview）
let _monitorDropdownEl = null;

function toggleMonitorDropdown(wsId) {
  const wsSuffix = wsId !== 'MAIN' ? `-${wsId}` : '';

  // 如果已存在，切换显示
  if (_monitorDropdownEl) {
    const isSame = _monitorDropdownEl.dataset.wsId === wsId;
    _monitorDropdownEl.remove();
    _monitorDropdownEl = null;
    if (isSame) return; // 点击同一个按钮，关闭即可
  }

  // 获取按钮位置
  const btn = document.getElementById(`manualMonitorBtn${wsSuffix}`);
  if (!btn) return;
  const rect = btn.getBoundingClientRect();

  // 创建下拉菜单（跟随黑夜模式）
  const isDark = typeof workspaceDarkModeEnabled !== 'undefined' && workspaceDarkModeEnabled;
  const menuBg = isDark ? '#1e293b' : 'white';
  const menuBorder = isDark ? '#334155' : '#e2e8f0';
  const menuText = isDark ? '#f1f5f9' : '#1e293b';
  const hoverBg = isDark ? '#334155' : '#f1f5f9';

  const menu = document.createElement('div');
  menu.dataset.wsId = wsId;
  menu.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.bottom + 4}px;
    background: ${menuBg};
    border: 1px solid ${menuBorder};
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    min-width: 180px;
    z-index: 999999;
    font-size: 13px;
    padding: 4px 0;
    color: ${menuText};
  `;

  const item1 = document.createElement('div');
  item1.textContent = ' 获取内容';
  item1.style.cssText = 'padding: 8px 16px; cursor: pointer; transition: background 0.15s;';
  item1.addEventListener('mouseenter', () => { item1.style.background = hoverBg; });
  item1.addEventListener('mouseleave', () => { item1.style.background = 'transparent'; });
  item1.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    _monitorDropdownEl = null;
    startManualMonitoring();
  });

  const item2 = document.createElement('div');
  item2.textContent = '📧 发邮件 (获取内容)';
  item2.style.cssText = 'padding: 8px 16px; cursor: pointer; transition: background 0.15s;';
  item2.addEventListener('mouseenter', () => { item2.style.background = hoverBg; });
  item2.addEventListener('mouseleave', () => { item2.style.background = 'transparent'; });
  item2.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    _monitorDropdownEl = null;
    startManualMonitoringAndEmail(wsId);
  });

  const item3 = document.createElement('div');
  item3.textContent = '📝 建立 ToDo 卡片 (获取内容)';
  item3.style.cssText = 'padding: 8px 16px; cursor: pointer; transition: background 0.15s;';
  item3.addEventListener('mouseenter', () => { item3.style.background = hoverBg; });
  item3.addEventListener('mouseleave', () => { item3.style.background = 'transparent'; });
  item3.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.remove();
    _monitorDropdownEl = null;
    startManualMonitoringAndTodo(wsId);
  });

  menu.appendChild(item1);
  menu.appendChild(item2);
  menu.appendChild(item3);
  document.body.appendChild(menu);
  _monitorDropdownEl = menu;
}

function closeMonitorDropdown(wsId) {
  if (_monitorDropdownEl) {
    _monitorDropdownEl.remove();
    _monitorDropdownEl = null;
  }
}

// 点击页面其他地方关闭下拉菜单
document.addEventListener('click', (e) => {
  if (_monitorDropdownEl && !_monitorDropdownEl.contains(e.target) && !e.target.closest('#manualMonitorBtn') && !e.target.closest('[id^="manualMonitorBtn-"]')) {
    _monitorDropdownEl.remove();
    _monitorDropdownEl = null;
  }
});

// 🆕 获取内容并发送邮件
async function startManualMonitoringAndEmail(wsId) {
  console.log('[Renderer]  === 开始获取内容并发送邮件流程 ===');

  const webview = getCurrentWebview();
  if (!webview) {
    showStatus('❌ 未找到网页预览组件', 'error');
    return;
  }

  // 获取当前URL
  let currentUrl = '';
  try {
    currentUrl = await webview.getURL();
  } catch (e) {
    console.warn('[Renderer] 获取URL失败:', e);
  }

  // 清除旧结果
  const oldResponseContainer = document.getElementById('capturedResponseContainer');
  if (oldResponseContainer) {
    oldResponseContainer.remove();
  }

  showStatus('📧 正在获取内容...', 'info');

  // 通过 IPC 重新加载最新的书签数据
  let customSelector = '';
  let heartbeatSelector = '';
  let monitorTimeout = 0;
  let debugMsg = '';
  let freshBookmarks = [];

  try {
    freshBookmarks = await window.electronAPI.loadBookmarks();

    const wsBookmarkIndex = workspaces[currentWorkspaceId]?.bookmarkIndex;
    const currentIndex = (wsBookmarkIndex !== null && wsBookmarkIndex !== undefined) ? wsBookmarkIndex : window.currentBookmarkIndex;

    // 方法 1：通过索引查找
    if (freshBookmarks && currentIndex !== undefined && currentIndex !== null && freshBookmarks[currentIndex]) {
      customSelector = freshBookmarks[currentIndex].replySelector || '';
      heartbeatSelector = freshBookmarks[currentIndex].heartbeatSelector || '';
      monitorTimeout = freshBookmarks[currentIndex].monitorTimeout || 0;
      debugMsg = `书签：${freshBookmarks[currentIndex].name || '未知'}（索引 ${currentIndex}）`;
    }

    // 方法 2：通过 URL 匹配
    if (!customSelector && !heartbeatSelector && currentUrl && freshBookmarks && freshBookmarks.length > 0) {
      const getCurrentHostname = () => {
        try { return new URL(currentUrl).hostname.toLowerCase(); } catch { return currentUrl.toLowerCase().split('/')[2] || ''; }
      };
      const currentHostname = getCurrentHostname();

      for (const bm of freshBookmarks) {
        if (!bm.url) continue;
        try {
          const bookmarkHostname = new URL(bm.url).hostname.toLowerCase();
          if (currentHostname === bookmarkHostname) {
            customSelector = bm.replySelector || '';
            heartbeatSelector = bm.heartbeatSelector || '';
            monitorTimeout = bm.monitorTimeout || 0;
            debugMsg = `书签：${bm.name || '未知'}（域名匹配）`;
            break;
          }
        } catch (e) {}
      }
    }

    if (!customSelector) {
      customSelector = window.currentReplySelector || '';
    }
  } catch (e) {
    debugMsg = `加载失败：${e.message}`;
  }

  // 更新监控全局变量
  if (heartbeatSelector) window.__monitorHeartbeatSelector = heartbeatSelector;
  if (customSelector) window.__monitorReplySelector = customSelector;
  if (monitorTimeout && monitorTimeout > 0) window.__monitorTimeout = monitorTimeout;

  const selectorValue = customSelector || '(空)';
  const heartbeatValue = heartbeatSelector || '(空)';
  const fullDebugMsg = `${debugMsg} | 选择器：${selectorValue}${heartbeatSelector ? ` | 💓监控：${heartbeatValue}` : ''}`;
  showStatus(fullDebugMsg, customSelector ? 'success' : 'warning');

  // 判断平台名称
  let platformName = 'AI 平台';
  if (currentUrl.includes('yiyan.baidu.com')) platformName = '文心一言';
  else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) platformName = '豆包';
  else if (currentUrl.includes('chatglm.cn') || currentUrl.includes('z.ai')) platformName = '智谱清言';
  else if (currentUrl.includes('deepseek.com')) platformName = 'DeepSeek';
  else if (currentUrl.includes('yuanbao.tencent.com') || currentUrl.includes('yuanbao.qq.com')) platformName = '腾讯元宝';
  else if (currentUrl.includes('tongyi.aliyun.com') || currentUrl.includes('qianwen.aliyun.com')) platformName = '通义千问';

  let capturedContent = '';
  let capturedHtml = ''; // 保留HTML格式用于邮件发送

  try {
    // 优先使用自定义选择器
    if (customSelector) {
      const customResult = await captureWithCustomSelector(webview, customSelector);
      if (customResult && customResult.success) {
        capturedContent = customResult.content;
        capturedHtml = customResult.html || ''; // 保留HTML
      } else {
        showStatus(` 自定义选择器未找到内容: ${customResult?.error || '未知错误'}`, 'error');
        return;
      }
    } else {
      // 没有自定义选择器，使用默认逻辑
      const isAIPlatform = currentUrl.includes('yiyan.baidu.com') ||
                          currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn') ||
                          currentUrl.includes('chatglm.cn') || currentUrl.includes('deepseek.com');

      if (isAIPlatform) {
        let result = null;
        if (currentUrl.includes('yiyan.baidu.com')) {
          result = await wenXinCaptureAIResponse(webview, 180000);
        } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
          result = await doubaoCaptureAIResponse(webview, 180000);
        } else {
          result = await captureAIResponse(webview, 180000);
        }
        if (result && result.content) {
          capturedContent = result.content;
        }
      } else {
        showStatus('⚠️ 当前不是 AI 平台，请在书签编辑中设置「自定义回复选择器」', 'warning');
        return;
      }
    }

    if (!capturedContent) {
      showStatus('⚠️ 未获取到内容', 'warning');
      return;
    }

    // 获取成功，弹出收件人对话框
    const charCount = capturedContent.length;
    showStatus(`✅ 成功获取内容（${charCount} 字符），请输入收件人`, 'success');

    const recipients = await showEmailRecipientDialog('');
    if (!recipients || !recipients.trim()) {
      showStatus('📧 已取消发送邮件', 'info');
      return;
    }

    // 发送邮件（使用统一发送函数，与浮动视窗共用同一套逻辑）
    showStatus('📧 正在发送邮件...', 'info');
    const subject = `[获取内容] ${platformName} - ${new Date().toLocaleString('zh-CN')}`;
    let contentHtml;
    if (capturedHtml) {
      // 使用HTML格式，完整渲染管线（与元素查看器保持一致）
      // 🆕 cleanHtmlWhitespace 现在返回 { html, mathBlocks }
      const { html: cleanedHtml, mathBlocks } = cleanHtmlWhitespace(capturedHtml);
      let styledHtml = cleanedHtml;
      styledHtml = formatJsonBlocks(styledHtml);
      styledHtml = injectInlineStyles(styledHtml);
      // 🆕 最后渲染 KaTeX 公式（在 injectInlineStyles 之后，避免样式污染）
      styledHtml = renderKaTeXPlaceholders(styledHtml, mathBlocks);
      contentHtml = styledHtml;
    } else {
      // 纯文本：用 <pre> 包裹保留格式
      contentHtml = `<pre style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; font-size: 13px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; word-break: break-all;">${capturedContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    }

    await sendUnifiedEmail(recipients, subject, currentUrl, null, contentHtml, charCount);
  } catch (error) {
    console.error('[Renderer] ❌ 获取内容并发送邮件失败:', error);
    const statusMsg = '❌ 获取内容并发送邮件失败: ' + error.message;
    showStatus(statusMsg, 'error', undefined, true);
    addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients: '' });
  }
}

// 🆕 获取内容并建立 ToDo 卡片
async function startManualMonitoringAndTodo(wsId) {
  console.log('[Renderer]  === 开始获取内容并建立 ToDo 卡片流程 ===');

  const webview = getCurrentWebview();
  if (!webview) {
    showStatus('❌ 未找到网页预览组件', 'error');
    return;
  }

  // 获取当前URL
  let currentUrl = '';
  try {
    currentUrl = await webview.getURL();
  } catch (e) {
    console.warn('[Renderer] 获取URL失败:', e);
  }

  // 清除旧结果
  const oldResponseContainer = document.getElementById('capturedResponseContainer');
  if (oldResponseContainer) {
    oldResponseContainer.remove();
  }

  showStatus('📝 正在获取内容...', 'info');

  // 通过 IPC 重新加载最新的书签数据
  let customSelector = '';
  let heartbeatSelector = '';
  let monitorTimeout = 0;
  let debugMsg = '';
  let freshBookmarks = [];

  try {
    freshBookmarks = await window.electronAPI.loadBookmarks();

    const wsBookmarkIndex = workspaces[currentWorkspaceId]?.bookmarkIndex;
    const currentIndex = (wsBookmarkIndex !== null && wsBookmarkIndex !== undefined) ? wsBookmarkIndex : window.currentBookmarkIndex;

    // 方法 1：通过索引查找
    if (freshBookmarks && currentIndex !== undefined && currentIndex !== null && freshBookmarks[currentIndex]) {
      customSelector = freshBookmarks[currentIndex].replySelector || '';
      heartbeatSelector = freshBookmarks[currentIndex].heartbeatSelector || '';
      monitorTimeout = freshBookmarks[currentIndex].monitorTimeout || 0;
      debugMsg = `书签：${freshBookmarks[currentIndex].name || '未知'}（索引 ${currentIndex}）`;
    }

    // 方法 2：通过 URL 匹配
    if (!customSelector && !heartbeatSelector && currentUrl && freshBookmarks && freshBookmarks.length > 0) {
      const getCurrentHostname = () => {
        try { return new URL(currentUrl).hostname.toLowerCase(); } catch { return currentUrl.toLowerCase().split('/')[2] || ''; }
      };
      const currentHostname = getCurrentHostname();

      for (const bm of freshBookmarks) {
        if (!bm.url) continue;
        try {
          const bookmarkHostname = new URL(bm.url).hostname.toLowerCase();
          if (currentHostname === bookmarkHostname) {
            customSelector = bm.replySelector || '';
            heartbeatSelector = bm.heartbeatSelector || '';
            monitorTimeout = bm.monitorTimeout || 0;
            debugMsg = `书签：${bm.name || '未知'}（域名匹配）`;
            break;
          }
        } catch (e) {}
      }
    }

    if (!customSelector) {
      customSelector = window.currentReplySelector || '';
    }
  } catch (e) {
    debugMsg = `加载失败：${e.message}`;
  }

  // 更新监控全局变量
  if (heartbeatSelector) window.__monitorHeartbeatSelector = heartbeatSelector;
  if (customSelector) window.__monitorReplySelector = customSelector;
  if (monitorTimeout && monitorTimeout > 0) window.__monitorTimeout = monitorTimeout;

  const selectorValue = customSelector || '(空)';
  const heartbeatValue = heartbeatSelector || '(空)';
  const fullDebugMsg = `${debugMsg} | 选择器：${selectorValue}${heartbeatSelector ? ` | 监控：${heartbeatValue}` : ''}`;
  showStatus(fullDebugMsg, customSelector ? 'success' : 'warning');

  let capturedContent = '';
  let capturedHtml = '';

  try {
    // 优先使用自定义选择器
    if (customSelector) {
      const customResult = await captureWithCustomSelector(webview, customSelector);
      if (customResult && customResult.success) {
        capturedContent = customResult.content;
        capturedHtml = customResult.html || '';
      } else {
        showStatus(` 自定义选择器未找到内容: ${customResult?.error || '未知错误'}`, 'error');
        return;
      }
    } else {
      // 没有自定义选择器，使用默认逻辑
      const isAIPlatform = currentUrl.includes('yiyan.baidu.com') ||
                          currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn') ||
                          currentUrl.includes('chatglm.cn') || currentUrl.includes('deepseek.com');

      if (isAIPlatform) {
        let result = null;
        if (currentUrl.includes('yiyan.baidu.com')) {
          result = await wenXinCaptureAIResponse(webview, 180000);
        } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
          result = await doubaoCaptureAIResponse(webview, 180000);
        } else {
          result = await captureAIResponse(webview, 180000);
        }
        if (result && result.content) {
          capturedContent = result.content;
        }
      } else {
        showStatus('⚠️ 当前不是 AI 平台，请在书签编辑中设置「自定义回复选择器」', 'warning');
        return;
      }
    }

    if (!capturedContent) {
      showStatus('⚠️ 未获取到内容', 'warning');
      return;
    }

    // 获取成功，显示确认对话框
    const charCount = capturedContent.length;
    const previewContent = capturedContent.length > 200 ? capturedContent.substring(0, 200) + '...' : capturedContent;
    
    const confirmMsg = `📝 已成功获取内容（${charCount} 字符）\n\n` +
      `来源：${currentUrl || '未知'}\n` +
      `内容预览：\n${previewContent}\n\n` +
      `确认要建立 ToDo 卡片吗？\n` +
      `（将自动添加标签 #DOM获取）`;
    
    // 使用自定义确认对话框（如果存在）或原生 confirm
    let confirmed = false;
    if (typeof window.showCustomConfirm === 'function') {
      confirmed = await window.showCustomConfirm(confirmMsg);
    } else {
      confirmed = confirm(confirmMsg);
    }
    
    if (!confirmed) {
      showStatus('⏹️ 已取消建立 ToDo 卡片', 'info');
      return;
    }

    showStatus(`📝 正在建立 ToDo 卡片（${charCount} 字符）...`, 'info');

    // 构建带来源/时间信息的 HTML 内容（与邮件插件一致）
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const sourceUrl = currentUrl || '';

    // 优先使用 HTML 格式，否则使用纯文本
    let htmlContent = '';
    if (capturedHtml) {
      htmlContent = `<div style="background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px;font-size:13px;color:#94a3b8;">
        <div style="margin-bottom:4px;"><strong style="color:#e2e8f0;">【来源】</strong> <a href="${sourceUrl}" style="color:#60a5fa;text-decoration:none;">${sourceUrl}</a></div>
        <div><strong style="color:#e2e8f0;">【获取时间】</strong> ${timeStr}</div>
      </div>
      ${capturedHtml}`;
    } else {
      htmlContent = `<div style="background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px;font-size:13px;color:#94a3b8;">
        <div style="margin-bottom:4px;"><strong style="color:#e2e8f0;">【来源】</strong> ${sourceUrl}</div>
        <div><strong style="color:#e2e8f0;">【获取时间】</strong> ${timeStr}</div>
      </div>
      <div style="white-space:pre-wrap;">${capturedContent}</div>`;
    }

    // 查找 TodoList 插件 webview
    const panels = document.querySelectorAll('.workspace-panel');
    let todoWebview = null;
    for (const panel of panels) {
      const wv = panel.querySelector('webview');
      if (wv && wv.src && (wv.src.includes('todolist') || wv.src.includes('plugins/todolist'))) {
        todoWebview = wv;
        break;
      }
    }

    if (!todoWebview) {
      showStatus('❌ 未找到 ToDoList 插件，请先在某个页签中加载 ToDoList 插件', 'error');
      return;
    }

    // 通过 webview.executeJavaScript 调用 TodoList 插件的全局函数
    // 自动添加 #DOM获取 标签
    const result = await todoWebview.executeJavaScript(`
      (async () => {
        try {
          const result = await window.addTodoFromExternal(${JSON.stringify(capturedContent)}, ['DOM获取'], ${JSON.stringify(htmlContent)});
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ success: false, message: err.message });
        }
      })()
    `);

    const parsed = JSON.parse(result);
    if (parsed.success) {
      showStatus(`✅ 已建立 ToDo 卡片（${charCount} 字符）`, 'success');
    } else {
      showStatus(`❌ 建立 ToDo 卡片失败: ${parsed.message}`, 'error');
    }
  } catch (error) {
    console.error('[Renderer] ❌ 获取内容并建立 ToDo 卡片失败:', error);
    const statusMsg = '❌ 获取内容并建立 ToDo 卡片失败: ' + error.message;
    showStatus(statusMsg, 'error', undefined, true);
  }
}

// ========== 监控动画系统 ==========
let monitoringPanel = null;
let monitoringTimer = null;
let monitoringStartTime = null;

// 显示监控面板
function showMonitoringPanel() {
  // 如果已存在，先移除
  hideMonitoringPanel();
  
  const webviewContainer = getCurrentWebviewContainer();
  if (!webviewContainer) return;
  
  // 创建监控面板容器
  monitoringPanel = document.createElement('div');
  monitoringPanel.id = 'monitoringPanel';
  monitoringPanel.innerHTML = `
    <style>
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(0.95); }
      }
      
      @keyframes progressStripe {
        0% { background-position: 0 0; }
        100% { background-position: 40px 0; }
      }
      
      .monitoring-container {
        margin-top: 16px;
        background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
        border: 2px solid #93c5fd;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.2);
        animation: pulse 2s ease-in-out infinite;
      }
      
      .monitoring-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }
      
      .monitoring-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 18px;
        font-weight: 700;
        color: #1e40af;
      }
      
      .spinner {
        width: 32px;
        height: 32px;
        border: 4px solid #bfdbfe;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      
      .timer-badge {
        font-size: 13px;
        background: #1e40af;
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-family: 'Monaco', 'Consolas', monospace;
      }
      
      .status-box {
        background: white;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        border-left: 4px solid #3b82f6;
      }
      
      .status-text {
        font-size: 15px;
        color: #1e40af;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .progress-section {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-top: 16px;
      }
      
      .progress-item {
        background: white;
        border-radius: 8px;
        padding: 14px;
        text-align: center;
      }
      
      .progress-label {
        font-size: 12px;
        color: #64748b;
        margin-bottom: 6px;
        font-weight: 600;
      }
      
      .progress-value {
        font-size: 22px;
        font-weight: 700;
        color: #2563eb;
        font-family: 'Monaco', 'Consolas', monospace;
      }
      
      .stability-bar {
        margin-top: 16px;
        background: white;
        border-radius: 8px;
        padding: 16px;
      }
      
      .stability-label {
        font-size: 13px;
        color: #475569;
        margin-bottom: 10px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .progress-bar-bg {
        width: 100%;
        height: 12px;
        background: #e2e8f0;
        border-radius: 6px;
        overflow: hidden;
        position: relative;
      }
      
      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #60a5fa);
        border-radius: 6px;
        transition: width 0.3s ease;
        position: relative;
        overflow: hidden;
      }
      
      .progress-bar-fill::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255,255,255,0.3) 10px,
          rgba(255,255,255,0.3) 20px
        );
        animation: progressStripe 1s linear infinite;
      }
      
      .preview-text {
        margin-top: 16px;
        background: #f8fafc;
        border-radius: 8px;
        padding: 14px;
        max-height: 120px;
        overflow-y: auto;
        border: 1px solid #e2e8f0;
      }
      
      .preview-label {
        font-size: 12px;
        color: #64748b;
        margin-bottom: 8px;
        font-weight: 600;
      }
      
      .preview-content {
        font-size: 13px;
        color: #334155;
        line-height: 1.6;
        font-family: 'Monaco', 'Consolas', monospace;
        word-break: break-all;
      }
    </style>
    
    <div class="monitoring-container">
      <div class="monitoring-header">
        <div class="monitoring-title">
          <div class="spinner"></div>
          <span> 正在获取 AI 回复</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="timer-badge" id="monitoringTimer">00:00</div>
          <button onclick="stopMonitoring()" title="停止监控" style="padding: 4px 12px; border: none; border-radius: 16px; background: #ef4444; color: white; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">️ 停止</button>
        </div>
      </div>
      
      <div class="status-box" id="monitoringStatusBox">
        <div class="status-text" id="monitoringStatusText">
          🔍 初始化监控...
        </div>
      </div>
      
      <div class="progress-section">
        <div class="progress-item">
          <div class="progress-label">⏱️ 已等待时间</div>
          <div class="progress-value" id="monitoringElapsed">0.0s</div>
        </div>
        <div class="progress-item">
          <div class="progress-label">🔄 检测次数</div>
          <div class="progress-value" id="monitoringCheckCount">0</div>
        </div>
        <div class="progress-item">
          <div class="progress-label">✅ 稳定计数</div>
          <div class="progress-value" id="monitoringStableCount">0/24</div>
        </div>
        <div class="progress-item">
          <div class="progress-label">📝 已捕获字符</div>
          <div class="progress-value" id="monitoringCharCount">0</div>
        </div>
      </div>
      
      <div class="stability-bar">
        <div class="stability-label">
          <span> 稳定性进度（需要连续 24 次稳定检测）</span>
          <span id="monitoringProgressPercent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="monitoringProgressBar" style="width: 0%;"></div>
        </div>
      </div>
      
      <div class="stability-bar" id="stayTimeBar" style="display: none;">
        <div class="stability-label">
          <span>⏱️ 内容停留时间（需 ≥ 15 秒确保完整）</span>
          <span id="monitoringStayPercent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="monitoringStayBarFill" style="width: 0%; background: linear-gradient(90deg, #8b5cf6, #a78bfa);"></div>
        </div>
      </div>
      
      <div class="stability-bar" id="noGrowthBar" style="display: none;">
        <div class="stability-label">
          <span> 内容不增长时间（需 ≥ 10 秒确保无追加）</span>
          <span id="monitoringNoGrowthPercent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="monitoringNoGrowthBarFill" style="width: 0%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>
        </div>
      </div>
      
      <div class="preview-text" id="monitoringPreview" style="display: none;">
        <div class="preview-label">📄 实时预览：</div>
        <div class="preview-content" id="monitoringPreviewContent"></div>
      </div>
    </div>
  `;
  
  webviewContainer.parentNode.insertBefore(monitoringPanel, webviewContainer.nextSibling);
  
  // 记录开始时间
  monitoringStartTime = Date.now();
  
  // 启动计时器更新
  if (monitoringTimer) clearInterval(monitoringTimer);
  monitoringTimer = setInterval(updateMonitoringTimer, 100);
  
  // 滚动到可见区域
  setTimeout(() => {
    monitoringPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// 更新计时器显示
function updateMonitoringTimer() {
  if (!monitoringStartTime || !monitoringPanel) return;
  
  const elapsed = (Date.now() - monitoringStartTime) / 1000;
  const timerEl = document.getElementById('monitoringTimer');
  const elapsedEl = document.getElementById('monitoringElapsed');
  
  if (timerEl) {
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    timerEl.textContent = 
      String(minutes).padStart(2, '0') + ':' + 
      String(seconds).padStart(2, '0');
  }
  
  if (elapsedEl) {
    elapsedEl.textContent = elapsed.toFixed(1) + 's';
  }
}

// 更新监控面板状态
function updateMonitoringPanel(status) {
  if (!monitoringPanel) return;
  
  const statusTextEl = document.getElementById('monitoringStatusText');
  const checkCountEl = document.getElementById('monitoringCheckCount');
  const stableCountEl = document.getElementById('monitoringStableCount');
  const charCountEl = document.getElementById('monitoringCharCount');
  const progressBarEl = document.getElementById('monitoringProgressBar');
  const progressPercentEl = document.getElementById('monitoringProgressPercent');
  const previewEl = document.getElementById('monitoringPreview');
  const previewContentEl = document.getElementById('monitoringPreviewContent');
  
  // 新增：停留时间进度条元素
  const stayTimeBar = document.getElementById('stayTimeBar');
  const stayBarFill = document.getElementById('monitoringStayBarFill');
  const stayPercentEl = document.getElementById('monitoringStayPercent');
  
  // 新增：内容不增长进度条元素
  const noGrowthBar = document.getElementById('noGrowthBar');
  const noGrowthBarFill = document.getElementById('monitoringNoGrowthBarFill');
  const noGrowthPercentEl = document.getElementById('monitoringNoGrowthPercent');
  
  // 更新状态文字和图标
  if (statusTextEl) {
    let icon = '🔍';
    let text = '正在监控...';
    
    switch(status.state) {
      case 'waiting':
        icon = '⏳';
        text = '等待 AI 开始回复...';
        break;
      case 'loading':
        icon = '⚡';
        text = 'AI 正在生成回复...';
        break;
      case 'detecting':
        icon = '🔎';
        // 显示三进度信息
        if (status.progressInfo) {
          const pi = status.progressInfo;
          text = `检测到回复 (稳定 ${pi.stablePercent}% | 不增长 ${pi.noGrowthPercent || 0}%)...`;
        } else {
          text = `检测到回复内容 (${status.stableCount || 0}/24 稳定)...`;
        }
        break;
      case 'stable':
        icon = '✅';
        text = `稳定性检查 ${status.stableCount || 0}/12`;
        break;
      case 'completed':
        icon = '🎉';
        text = '✨ 回复已完整捕获！';
        break;
      case 'timeout':
        icon = '⚠️';
        text = '⏰ 超时，已捕获部分内容';
        break;
      case 'error':
        icon = '❌';
        text = status.message || '发生错误';
        break;
      default:
        icon = '🔄';
        text = status.message || '监控中...';
    }
    
    statusTextEl.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
  }
  
  // 更新统计数据
  if (checkCountEl && status.checkCount !== undefined) {
    checkCountEl.textContent = status.checkCount;
  }
  
  if (stableCountEl && status.stableCount !== undefined) {
    stableCountEl.textContent = `${status.stableCount}/24`;
  }
  
  if (charCountEl && status.charCount !== undefined) {
    charCountEl.textContent = status.charCount.toLocaleString();
  }
  
  // 更新稳定性进度条（阈值改为 24）
  if (progressBarEl && status.stableCount !== undefined) {
    const percent = Math.min((status.stableCount / 24) * 100, 100);
    progressBarEl.style.width = percent + '%';
    
    // 根据进度改变颜色
    if (percent >= 100) {
      progressBarEl.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
    } else if (percent >= 66) {
      progressBarEl.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    } else if (percent >= 33) {
      progressBarEl.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
    }
  }
  
  if (progressPercentEl && status.stableCount !== undefined) {
    const percent = Math.min(Math.round((status.stableCount / 24) * 100), 100);
    progressPercentEl.textContent = percent + '%';
  }
  
  // 更新停留时间进度条（新增）
  if (stayTimeBar && stayBarFill && stayPercentEl) {
    if (status.progressInfo && status.state === 'detecting') {
      // 显示停留时间进度条
      stayTimeBar.style.display = 'block';
      const stayPercent = Math.min(status.progressInfo.stayPercent || 0, 100);
      stayBarFill.style.width = stayPercent + '%';
      stayPercentEl.textContent = stayPercent + '%';
      
      // 停留时间进度条颜色
      if (stayPercent >= 100) {
        stayBarFill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
      } else if (stayPercent >= 70) {
        stayBarFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
      } else {
        stayBarFill.style.background = 'linear-gradient(90deg, #8b5cf6, #a78bfa)';
      }
    } else if (status.state === 'waiting' || status.state === 'loading') {
      // 还没检测到内容或正在加载，隐藏停留时间条
      stayTimeBar.style.display = 'none';
    } else if (status.state === 'completed') {
      // 完成，显示 100%
      stayTimeBar.style.display = 'block';
      stayBarFill.style.width = '100%';
      stayBarFill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
      stayPercentEl.textContent = '100% ✓';
    }
  }
  
  // 更新内容不增长进度条（新增）
  if (noGrowthBar && noGrowthBarFill && noGrowthPercentEl) {
    if (status.progressInfo && status.state === 'detecting') {
      // 显示不增长进度条
      noGrowthBar.style.display = 'block';
      const noGrowthPercent = Math.min(status.progressInfo.noGrowthPercent || 0, 100);
      noGrowthBarFill.style.width = noGrowthPercent + '%';
      noGrowthPercentEl.textContent = noGrowthPercent + '%';
      
      // 不增长进度条颜色
      if (noGrowthPercent >= 100) {
        noGrowthBarFill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
      } else if (noGrowthPercent >= 70) {
        noGrowthBarFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
      } else {
        noGrowthBarFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
      }
    } else if (status.state === 'waiting' || status.state === 'loading') {
      // 还没检测到内容或正在加载，隐藏不增长时间条
      noGrowthBar.style.display = 'none';
    } else if (status.state === 'completed') {
      // 完成，显示 100%
      noGrowthBar.style.display = 'block';
      noGrowthBarFill.style.width = '100%';
      noGrowthBarFill.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
      noGrowthPercentEl.textContent = '100% ✓';
    }
  }
  
  // 更新预览内容
  if (previewEl && previewContentEl && status.preview) {
    previewEl.style.display = 'block';
    previewContentEl.textContent = status.preview.length > 200 
      ? status.preview.substring(0, 200) + '...' 
      : status.preview;
  }
}

// 隐藏监控面板
function hideMonitoringPanel() {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
  }
  
  if (monitoringPanel) {
    monitoringPanel.remove();
    monitoringPanel = null;
  }
  
  monitoringStartTime = null;
}

// 停止监控（用户主动中断）
function stopMonitoring() {
  console.log('[Renderer] ️ 用户主动停止监控...');
  
  // 清理 webview 中的定时器
  const webview = getCurrentWebview();
  if (webview) {
    try {
      webview.executeJavaScript(`
        if (window.__captureIntervalId) {
          clearInterval(window.__captureIntervalId);
          window.__captureIntervalId = null;
        }
      `).catch(() => {});
    } catch (e) {}
  }
  
  // 隐藏监控面板
  hideMonitoringPanel();
  
  // 显示提示
  showStatus('️ 监控已停止', 'error');
}

// ========== AI 回复抓取功能 ==========
let capturedResponse = null; // 存储抓取到的 AI 回复

// 抓取 AI 的回复内容
async function captureAIResponse(webview, timeout = 30000) {
  console.log('[CaptureResponse]  开始抓取 AI 回复...');
  
  // 🚀 第一优先级：如果页面已有大量内容，直接秒回（不等待任何监控）
  try {
    const instantCheck = await webview.executeJavaScript(`
      (function() {
        // 优先找：最后一个AI消息（从后往前找）
        const prioritySelectors = [
          // 最新的AI回复（从后往前找）
          '[class*="assistant"]:last-child',
          '[class*="ai-message"]:last-child',
          '[class*="model-response"]:last-child',
          '[class*="response"]:last-child',
          '.markdown-body:last-child',
          // 文心一言特定选择器
          '[class*="markdown"]:last-child',
          // DeepSeek 特定选择器
          '[class*="deepseek"]:last-child',
          '[class*="ds-message"]:last-child',
          '[class*="ds-content"]:last-child',
          '[class*="ds-response"]:last-child',
          // 豆包特定选择器
          '[class*="doubao"]:last-child',
          '[class*="db-message"]:last-child',
          // 智谱AI特定选择器
          '[class*="zhipu"]:last-child',
          '[class*="chatglm"]:last-child',
          '[class*="glm-message"]:last-child',
          // 元宝特定选择器（腾讯混元）
          '[class*="yuanbao"]:last-child',
          '[class*="yb-message"]:last-child',
          '[class*="hunyuan"]:last-child',
          // 通义千问特定选择器
          '[class*="tongyi"]:last-child',
          '[class*="qwen"]:last-child',
          // 通用选择器
          '[class*="message"]:last-child',
          '[class*="content"]:last-child',
          '[class*="text"]:last-child',
          '[class*="bubble"]:last-child'
        ];
        
        let maxText = '';
        let usedSelector = '';
        
        // 策略1：从后往前找消息列表中的内容
        const messageListSelectors = [
          '[class*="message-list"]',
          '[class*="chat-messages"]',
          '[class*="messages-container"]',
          '[class*="conversation"]',
          '[role="log"]',
          '[class*="chat-wrapper"]',
          '[class*="chat-content"]'
        ];
        
        let messageContainer = null;
        for (const listSel of messageListSelectors) {
          try {
            const container = document.querySelector(listSel);
            if (container) {
              messageContainer = container;
              break;
            }
          } catch(e) {}
        }
        
        // 如果找到消息容器，从最后一个开始找
        if (messageContainer) {
          const allMessages = messageContainer.querySelectorAll('[class*="message"], [class*="item"], [class*="bubble"], [class*="chat-item"], [class*="dialog"], [class*="response"], [class*="assistant"], .markdown-body');
          
          let validCandidates = [];
          
          // 先收集所有有效候选人
          for (let i = allMessages.length - 1; i >= 0; i--) {
            try {
              const el = allMessages[i];
              
              // 检查是否是思考过程（跳过）
              const elClass = el.className || '';
              const elId = el.id || '';
              const elText = el.innerText || el.textContent || '';
              
              // 如果有明显的思考标识，跳过
              const isThinking = (
                elClass.toLowerCase().includes('thinking') ||
                elClass.toLowerCase().includes('thought') ||
                elClass.toLowerCase().includes('think') ||
                elClass.toLowerCase().includes('reasoning') ||
                elId.toLowerCase().includes('thinking') ||
                elId.toLowerCase().includes('thought') ||
                elText.toLowerCase().includes('思考') ||
                elText.toLowerCase().includes('thinking') ||
                elText.toLowerCase().includes('thought') ||
                elText.toLowerCase().includes('让我') ||
                elText.toLowerCase().includes('我来') ||
                elText.toLowerCase().includes('首先')
              );
              
              if (!isThinking) {
                const text = el.innerText || el.textContent;
                if (text && text.trim().length > 80) {
                  validCandidates.push({
                    text: text.trim(),
                    index: i,
                    el: el
                  });
                }
              }
            } catch(e) {}
          }
          
          // 从有效候选人中选第一个（最新的非思考内容）
          if (validCandidates.length > 0) {
            // 优先选最后一个（因为从后往前找）
            maxText = validCandidates[0].text;
            usedSelector = 'message-list-item-' + validCandidates[0].index;
          }
        }
        
        // 如果消息容器策略没找到，用备用选择器
        if (!maxText || maxText.length < 80) {
          let validCandidates = [];
          
          for (const sel of prioritySelectors) {
            try {
              const els = document.querySelectorAll(sel);
              // 从后往前找
              for (let i = els.length - 1; i >= 0; i--) {
                const el = els[i];
                
                // 检查是否是思考过程（跳过）
                const elClass = el.className || '';
                const elId = el.id || '';
                const elText = el.innerText || el.textContent || '';
                
                const isThinking = (
                  elClass.toLowerCase().includes('thinking') ||
                  elClass.toLowerCase().includes('thought') ||
                  elClass.toLowerCase().includes('think') ||
                  elClass.toLowerCase().includes('reasoning') ||
                  elId.toLowerCase().includes('thinking') ||
                  elId.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('思考') ||
                  elText.toLowerCase().includes('thinking') ||
                  elText.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('让我') ||
                  elText.toLowerCase().includes('我来') ||
                  elText.toLowerCase().includes('首先')
                );
                
                if (!isThinking) {
                  const text = el.innerText || el.textContent;
                  if (text && text.trim().length > 80) {
                    validCandidates.push({
                      text: text.trim(),
                      index: i,
                      selector: sel
                    });
                  }
                }
              }
            } catch(e) {}
          }
          
          // 从有效候选人中选
          if (validCandidates.length > 0) {
            // 选最长的内容（通常最终答案更长）
            validCandidates.sort((a, b) => b.text.length - a.text.length);
            maxText = validCandidates[0].text;
            usedSelector = validCandidates[0].selector;
          }
        }
        
        // 检查是否有加载指示器
        const loadingIndicators = document.querySelectorAll(
          '[class*="loading"], [class*="spinner"], [class*="typing"], [aria-busy="true"], [class*="generating"], [class*="pending"]'
        );
        
        // 检查是否有AI完成的标志（复制按钮、点赞等）
        const completionIndicators = document.querySelectorAll(
          '[class*="copy"], [class*="regenerate"], [class*="retry"], [class*="action-bar"], [class*="message-actions"], [class*="toolbar"], [class*="actions"]'
        );
        
        // 调试信息
        console.log('[CaptureDebug]');
        console.log('  找到内容:', maxText ? maxText.substring(0, 150) : '(无)');
        console.log('  内容长度:', maxText.length);
        console.log('  使用选择器:', usedSelector);
        console.log('  有加载指示:', loadingIndicators.length > 0);
        console.log('  有完成指示:', completionIndicators.length > 0);
        
        return {
          content: maxText,
          contentLength: maxText.length,
          usedSelector: usedSelector,
          hasLoadingIndicators: loadingIndicators.length > 0,
          hasCompletionIndicators: completionIndicators.length > 0
        };
      })();
    `);
    
    // 如果检测到内容（>200字符），或者检测到AI完成标志（复制按钮、点赞等），或者没有加载指示器，直接秒回！
    if (instantCheck && instantCheck.content && (
      instantCheck.contentLength > 200 || 
      instantCheck.hasCompletionIndicators || 
      !instantCheck.hasLoadingIndicators
    )) {
      console.log('[CaptureResponse] 🚀 检测到内容（' + instantCheck.contentLength + ' 字符），直接秒回！');
      console.log('[CaptureResponse] 使用选择器: ' + instantCheck.usedSelector);
      console.log('[CaptureResponse] 是否有加载指示器: ' + instantCheck.hasLoadingIndicators);
      console.log('[CaptureResponse] 是否有完成标志: ' + instantCheck.hasCompletionIndicators);
      console.log('[CaptureResponse] 内容预览: ' + instantCheck.content.substring(0, 100) + '...');
      // 尝试获取预记录的时间（如果持续监控脚本已记录了真实时间）
      const timeRecord = await webview.executeJavaScript(`
        (function() {
          if (window.__aiTimeRecord) {
            return {
              questionSentTime: window.__aiTimeRecord.questionSentTime,
              responseStartTime: window.__aiTimeRecord.responseStartTime,
              responseCompleteTime: window.__aiTimeRecord.responseCompleteTime,
              hasRecord: !!(window.__aiTimeRecord.questionSentTime || window.__aiTimeRecord.responseStartTime)
            };
          }
          return null;
        })();
      `);
      
      const now = new Date().toISOString();
      
      // 如果有预记录的时间，使用它；否则使用当前时间
      const questionSentTime = timeRecord?.hasRecord && timeRecord.questionSentTime 
        ? timeRecord.questionSentTime 
        : null;
      const responseStartTime = timeRecord?.hasRecord && timeRecord.responseStartTime 
        ? timeRecord.responseStartTime 
        : now;
      const responseCompleteTime = timeRecord?.hasRecord && timeRecord.responseCompleteTime 
        ? timeRecord.responseCompleteTime 
        : now;
      
      const capturedResponse = {
        content: instantCheck.content,
        timestamp: responseCompleteTime,
        questionSentTime: questionSentTime,
        responseStartTime: responseStartTime,
        responseCompleteTime: responseCompleteTime,
        responseDuration: (timeRecord?.hasRecord && timeRecord.responseStartTime && timeRecord.responseCompleteTime)
          ? (new Date(timeRecord.responseCompleteTime) - new Date(timeRecord.responseStartTime)) / 1000
          : 0,
        totalDuration: (timeRecord?.hasRecord && timeRecord.questionSentTime && timeRecord.responseCompleteTime)
          ? (new Date(timeRecord.responseCompleteTime) - new Date(timeRecord.questionSentTime)) / 1000
          : 0,
        status: 'instant_capture',
        elapsed: 0,
        isInstantMode: true,
        hasPreRecordedTime: !!timeRecord?.hasRecord
      };
      
      // 不在 captureAIResponse 内部调用 displayCapturedResponse
      // displayCapturedResponse(capturedResponse);
      const timeInfo = timeRecord?.hasRecord 
        ? '（使用预记录时间）' 
        : '（无预记录时间，仅提取内容）';
      showStatus(`✅ 已捕获 AI 回复（${instantCheck.contentLength} 字符）- 即时秒回模式${timeInfo}`, 'success');
      return capturedResponse;
    }
  } catch (e) {
    console.log('[CaptureResponse] 即时检查失败，将使用完整监控模式:', e);
  }
  
  // 第二优先级：检查是否有持续监控预记录的时间（非联动模式：AI 已完成）
  try {
    const preRecorded = await webview.executeJavaScript(`
      (function() {
        if (window.__aiTimeRecord && window.__aiTimeRecord.responseCompleteTime) {
          return {
            questionSentTime: window.__aiTimeRecord.questionSentTime,
            responseStartTime: window.__aiTimeRecord.responseStartTime,
            responseCompleteTime: window.__aiTimeRecord.responseCompleteTime,
            isComplete: true
          };
        }
        return null;
      })();
    `);
    
    if (preRecorded && preRecorded.isComplete) {
      console.log('[CaptureResponse] 检测到预记录的时间（非联动模式），直接使用...');
      
      // 提取 AI 回复内容（用同样的优化逻辑）
      const content = await webview.executeJavaScript(`
        (function() {
          // 优先策略：从后往前找消息列表
          const messageListSelectors = [
            '[class*="message-list"]',
            '[class*="chat-messages"]',
            '[class*="messages-container"]',
            '[class*="conversation"]',
            '[role="log"]',
            '[class*="chat-wrapper"]',
            '[class*="chat-content"]'
          ];
          
          let messageContainer = null;
          for (const listSel of messageListSelectors) {
            try {
              const container = document.querySelector(listSel);
              if (container) {
                messageContainer = container;
                break;
              }
            } catch(e) {}
          }
          
          if (messageContainer) {
            const allMessages = messageContainer.querySelectorAll('[class*="message"], [class*="item"], [class*="bubble"], [class*="chat-item"], [class*="dialog"], [class*="response"], [class*="assistant"], .markdown-body');
            
            let validCandidates = [];
            
            for (let i = allMessages.length - 1; i >= 0; i--) {
              try {
                const el = allMessages[i];
                
                // 检查是否是思考过程（跳过）
                const elClass = el.className || '';
                const elId = el.id || '';
                const elText = el.innerText || el.textContent || '';
                
                const isThinking = (
                  elClass.toLowerCase().includes('thinking') ||
                  elClass.toLowerCase().includes('thought') ||
                  elClass.toLowerCase().includes('think') ||
                  elClass.toLowerCase().includes('reasoning') ||
                  elId.toLowerCase().includes('thinking') ||
                  elId.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('思考') ||
                  elText.toLowerCase().includes('thinking') ||
                  elText.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('让我') ||
                  elText.toLowerCase().includes('我来') ||
                  elText.toLowerCase().includes('首先')
                );
                
                if (!isThinking) {
                  const text = el.innerText || el.textContent;
                  if (text && text.trim().length > 80) {
                    validCandidates.push(text.trim());
                  }
                }
              } catch(e) {}
            }
            
            if (validCandidates.length > 0) {
              return validCandidates[0]; // 最新的非思考内容
            }
          }
          
          // 备用策略：使用位置过滤找 .markdown-body
          const viewportWidth = window.innerWidth;
          const sidebarThreshold = viewportWidth * 0.35;
          
          const markdownElements = document.querySelectorAll('.markdown-body');
          
          let validCandidates = [];
          
          if (markdownElements.length > 0) {
            for (let i = markdownElements.length - 1; i >= 0; i--) {
              try {
                const markdown = markdownElements[i];
                const rect = markdown.getBoundingClientRect();
                
                if (rect.left < sidebarThreshold) continue;
                if (rect.width === 0 || rect.height === 0) continue;
                
                // 检查是否是思考过程（跳过）
                const elClass = markdown.className || '';
                const elId = markdown.id || '';
                const elText = markdown.innerText || markdown.textContent || '';
                
                const isThinking = (
                  elClass.toLowerCase().includes('thinking') ||
                  elClass.toLowerCase().includes('thought') ||
                  elClass.toLowerCase().includes('think') ||
                  elClass.toLowerCase().includes('reasoning') ||
                  elId.toLowerCase().includes('thinking') ||
                  elId.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('思考') ||
                  elText.toLowerCase().includes('thinking') ||
                  elText.toLowerCase().includes('thought') ||
                  elText.toLowerCase().includes('让我') ||
                  elText.toLowerCase().includes('我来') ||
                  elText.toLowerCase().includes('首先')
                );
                
                if (!isThinking) {
                  const text = markdown.innerText || markdown.textContent;
                  if (text && text.trim().length > 20) {
                    validCandidates.push(text.trim());
                  }
                }
              } catch(e) {}
            }
            
            if (validCandidates.length > 0) {
              return validCandidates[0]; // 最新的非思考内容
            }
          }
          
          return null;
        })();
      `);
      
      if (content && content.length > 10) {
        const responseDuration = preRecorded.responseStartTime
          ? (new Date(preRecorded.responseCompleteTime) - new Date(preRecorded.responseStartTime)) / 1000
          : null;
        const totalDuration = preRecorded.questionSentTime
          ? (new Date(preRecorded.responseCompleteTime) - new Date(preRecorded.questionSentTime)) / 1000
          : null;
        
        const capturedResponse = {
          content: content,
          timestamp: preRecorded.responseCompleteTime,
          questionSentTime: preRecorded.questionSentTime,
          responseStartTime: preRecorded.responseStartTime,
          responseCompleteTime: preRecorded.responseCompleteTime,
          responseDuration: responseDuration,
          totalDuration: totalDuration,
          status: 'completed',
          elapsed: responseDuration ? responseDuration * 1000 : 0
        };
        
        // 不在 captureAIResponse 内部调用 displayCapturedResponse
        // displayCapturedResponse(capturedResponse);
        showStatus(`✅ 已捕获 AI 回复（${content.length} 字符）- 使用预记录时间`, 'success');
        console.log('[CaptureResponse]  发问题: ' + preRecorded.questionSentTime);
        console.log('[CaptureResponse] 📥 AI 开始: ' + preRecorded.responseStartTime);
        console.log('[CaptureResponse] 🏁 AI 结束: ' + preRecorded.responseCompleteTime);
        
        // 重置预记录（准备下次监控）
        await webview.executeJavaScript(`
          if (window.__aiTimeRecord) {
            window.__aiTimeRecord.questionSentTime = null;
            window.__aiTimeRecord.responseStartTime = null;
            window.__aiTimeRecord.responseCompleteTime = null;
            window.__aiTimeRecord.aiContentDetected = false;
            window.__aiTimeRecord.lastContentLength = 0;
            window.__aiTimeRecord.contentGrowCount = 0;
            window.__aiTimeRecord.contentStableCount = 0;
          }
        `);
        
        return capturedResponse;
      }
    }
  } catch (e) {
    console.log('[CaptureResponse] 检查预记录时间失败，将使用完整监控模式:', e);
  }
  
  // 显示监控面板
  showMonitoringPanel();
  updateMonitoringPanel({ state: 'waiting', message: '正在初始化监控...' });
  
  let checkCount = 0;
  let pollingTimer = null;
  
  // 在 webview 中注入状态存储和监控脚本
  const initScript = `
    (function() {
      // 初始化状态对象
      window.__captureState = {
        state: 'initializing',
        stableCount: 0,
        elapsed: 0,
        charCount: 0,
        preview: '',
        isLoading: false,
        hasContent: false,
        questionSentTime: null,      // 发问题的时间（绝对时间戳，由 MutationObserver 检测）
        responseStartTime: null,     // AI 开始回复的时间（绝对时间戳）
        responseCompleteTime: null,  // AI 回复完成的时间（绝对时间戳）
        firstContentTime: null,      // 首次检测到内容的时间
        lastContentChangeTime: 0,    // 最后一次内容变化的时间
        lastCharCount: 0,            // 上一次的字符数
        minContentStayTime: 15000,   // 内容最少停留时间 15 秒
        minNoGrowthTime: 10000,      // 内容不再增长的最少时间 10 秒
        stableThreshold: 24,         // 稳定性阈值提高到 24 次（12秒）
        lastHeight: 0,               // 上次内容高度
        heightStableCount: 0,        // 高度稳定计数
        heightStableThreshold: 16,   // 高度需要稳定 8 秒（16次）
        messageObserver: null,       // MutationObserver 实例
        initialMessageCount: 0       // 初始化时的消息总数
      };
      
      // 获取当前消息总数（用于检测新消息）
      function getCurrentMessageCount() {
        const selectors = [
          '[class*="message-list"]',
          '[class*="chat-messages"]',
          '[class*="messages-container"]',
          '[class*="conversation"]',
          '[role="log"]',
          '[class*="chat-wrapper"]',
          '[class*="chat-content"]',
          '.chat-message',
          '[class*="z-chat"]',
          '[class*="chat-item"]'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            return el.querySelectorAll('[class*="message"], [class*="item"], [class*="bubble"], [class*="chat-item"], [class*="dialog"], [class*="response"], [class*="assistant"], [class*="user"]').length;
          }
        }
        return document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-item"]').length;
      }
      
      // 设置 MutationObserver 检测新消息
      function setupMessageObserver() {
        const state = window.__captureState;
        
        // 记录初始消息数
        state.initialMessageCount = getCurrentMessageCount();
        console.log('[Capture] 📊 初始消息数: ' + state.initialMessageCount);
        
        // 尝试找到消息容器
        const containerSelectors = [
          '[class*="message-list"]',
          '[class*="chat-messages"]',
          '[class*="messages-container"]',
          '[class*="conversation"]',
          '[role="log"]',
          '[class*="chat-wrapper"]',
          '[class*="chat-content"]'
        ];
        
        let targetNode = null;
        for (const selector of containerSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            targetNode = el;
            break;
          }
        }
        
        if (!targetNode) {
          // 兜底：使用 body 作为观察目标
          targetNode = document.body;
        }
        
        const observer = new MutationObserver(function(mutations) {
          // 检查是否有新消息被添加
          const currentCount = getCurrentMessageCount();
          
          if (currentCount > state.initialMessageCount) {
            // 有新消息被添加
            if (!state.questionSentTime) {
              // 第一条新消息 = 用户发送的问题
              state.questionSentTime = new Date().toISOString();
              console.log('[Capture] 📤 检测到用户发送问题: ' + state.questionSentTime);
            }
            
            // 更新消息计数
            state.initialMessageCount = currentCount;
          }
        });
        
        observer.observe(targetNode, {
          childList: true,
          subtree: true
        });
        
        state.messageObserver = observer;
        console.log('[Capture] 👁️ MutationObserver 已启动，正在监控消息变化...');
      }
      
      // 查找聊天消息容器（多种可能的选择器）
      function findMessageContainer() {
        const selectors = [
          // 智谱AI特定选择器（生成中和已完成）
          '[class*="zhipu"] [class*="message"]',
          '[class*="chat-wrapper"]',
          '[class*="chat-content"]',
          '[class*="messages-container"]',
          '[class*="conversation"] [class*="message"]',
          '[class*="chat"] [class*="response"]',
          '[data-testid*="message"]',
          '[data-testid*="chat"]',
          '.message-content',
          '.chat-message',
          '[class*="z-chat"]',
          '[class*="chat-item"]',
          '[class*="chat-box"]',
          '[class*="dialog"]',
          '[class*="conversation"]',
          '[class*="assistant"]',
          '[class*="assistant-message"]',
          '[class*="ai-message"]',
          '[class*="model-response"]',
          '[class*="model-message"]',
          // 通用选择器
          '[class*="message-list"]',
          '[class*="chat-messages"]',
          '[class*="conversation"]',
          '[class*="message-container"]',
          '[role="log"]',
          '.markdown-body',
          '[class*="response"]',
          '[class*="answer"]'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.children.length > 0) {
            console.log('[Capture] 找到消息容器:', selector);
            return el;
          }
        }
        
        // 兜底1：查找所有可能的消息元素
        const messages = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-item"], [class*="zhipu"] div, [class*="response-text"], [class*="content"], [class*="text"]');
        if (messages.length > 0) {
          console.log('[Capture] 兜底找到', messages.length, '个消息元素');
          return { messages: Array.from(messages), isFallback: true };
        }
        
        // 兜底2：查找包含代码块或较长文本的 div（适用于已完成的消息）
        const codeBlocks = document.querySelectorAll('pre, code, .code-block, [class*="code"]');
        if (codeBlocks.length > 0) {
          console.log('[Capture] 找到代码块，尝试提取内容');
          const parentDivs = Array.from(codeBlocks).map(el => el.closest('div')).filter(Boolean);
          const uniqueDivs = [...new Set(parentDivs.map(d => d.getAttribute('data-unique') || d.outerHTML.slice(0, 100)))];
          if (uniqueDivs.length > 0) {
            return { messages: parentDivs, isFallback: true };
          }
        }
        
        // 终极兜底：查找页面中所有包含较长文本的 div（适用于已完成的消息）
        const allDivs = document.querySelectorAll('div');
        const textDivs = Array.from(allDivs).filter(div => {
          const text = div.innerText || div.textContent;
          return text && text.length > 50 && div.children.length > 0;
        });
        if (textDivs.length > 0) {
          console.log('[Capture] 终极兜底找到', textDivs.length, '个包含文本的div');
          return { messages: textDivs, isFallback: true };
        }
        
        console.log('[Capture] 未找到任何消息容器');
        return null;
      }
      
      function extractLatestResponse() {
        const container = findMessageContainer();
        
        if (!container) return null;
        
        if (container.isFallback) {
          const msgs = container.messages;
          if (msgs.length === 0) return null;
          const lastMsg = msgs[msgs.length - 1];
          return lastMsg.innerText || lastMsg.textContent || null;
        }
        
        const allText = container.innerText || container.textContent;
        if (!allText) return null;
        
        const lines = allText.split('\\n').filter(line => line.trim());
        if (lines.length === 0) return null;
        
        return lines.join('\\n');
      }
      
      function isLoading() {
        const loadingIndicators = document.querySelectorAll(
          '[class*="loading"], [class*="spinner"], [class*="typing"], [aria-busy="true"]'
        );
        return loadingIndicators.length > 0;
      }
      
      // 检测 AI 回复交互按钮（复制、点赞、重新生成等）
      function hasActionButtons() {
        const buttonSelectors = [
          // 通用选择器
          '[class*="action-bar"]',
          '[class*="message-actions"]',
          '[class*="response-actions"]',
          '[class*="feedback"]',
          '[class*="action-btn"]',
          '[class*="regenerate"]',
          '[class*="copy-btn"]',
          '[class*="like-btn"]',
          '[class*="dislike-btn"]',
          '[class*="share-btn"]',
          '[class*="more-btn"]',
          '[class*="retry"]',
          '[class*="replay"]',
          '[class*="icon-regenerate"]',
          '[class*="icon-copy"]',
          '[class*="icon-like"]',
          // DeepSeek 可能的选择器
          '[data-testid*="copy"]',
          '[data-testid*="regenerate"]',
          '[data-testid*="feedback"]',
          // 通义千问可能的选择器
          '[class*="operate"]',
          '[class*="action-icon"]',
          // 豆包可能的选择器
          '[class*="toolbar"]',
          '[class*="msg-toolbar"]',
          // 智谱AI可能的选择器
          '[class*="zhipu-action"]',
          '[class*="action-tools"]',
          // 通用图标容器
          'div[class*="actions"]',
          'div[class*="operations"]'
        ];
        
        for (const selector of buttonSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            // 确保按钮是可见的（不是隐藏的）
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              return true;
            }
          }
        }
        
        return false;
      }
      
      // 检测内容高度是否稳定
      function checkHeightStability() {
        const container = findMessageContainer();
        if (!container) return 0;
        
        let currentHeight = 0;
        if (container.isFallback) {
          // fallback 模式，取最后一条消息的高度
          const msgs = container.messages;
          if (msgs.length > 0) {
            const lastMsg = msgs[msgs.length - 1];
            currentHeight = lastMsg.scrollHeight || lastMsg.offsetHeight || 0;
          }
        } else {
          currentHeight = container.scrollHeight || container.offsetHeight || 0;
        }
        
        const state = window.__captureState;
        
        if (currentHeight === state.lastHeight && currentHeight > 0) {
          state.heightStableCount++;
        } else {
          state.heightStableCount = 0;
          state.lastHeight = currentHeight;
        }
        
        return state.heightStableCount;
      }
      
      // 更新状态函数（智能等待模式）
      window.__updateCaptureState = function() {
        const state = window.__captureState;
        state.elapsed += 500; // 每次调用增加 500ms
        
        const currentResponse = extractLatestResponse();
        state.isLoading = isLoading();
        state.hasActionButtons = hasActionButtons(); // 检测交互按钮
        state.heightStableCount = checkHeightStability(); // 检测高度稳定
        state.hasContent = !!currentResponse && currentResponse.length > 10;
        
        if (state.hasContent) {
          // 记录首次检测到内容的时间
          if (!state.firstContentTime) {
            state.firstContentTime = state.elapsed;
            state.responseStartTime = new Date().toISOString(); // 记录 AI 开始回复的绝对时间
            console.log('[Capture] 🎯 首次检测到内容，开始智能等待模式');
            console.log('[Capture] 📅 AI 开始回复时间: ' + state.responseStartTime);
          }
          
          state.charCount = currentResponse.length;
          state.preview = currentResponse.substring(0, 200);
          
          // 检测内容是否增长
          if (state.charCount !== state.lastCharCount) {
            state.lastContentChangeTime = state.elapsed;
            state.lastCharCount = state.charCount;
          }
          
          // 计算内容已停留时间
          const contentStayTime = state.elapsed - state.firstContentTime;
          
          // 计算内容不再增长的时间
          const noGrowthTime = state.lastContentChangeTime > 0 
            ? state.elapsed - state.lastContentChangeTime 
            : 0;
          
          if (state.isLoading) {
            state.state = 'loading';
            state.stableCount = 0; // 正在生成，重置稳定计数
            state.heightStableCount = 0; // 重置高度稳定计数
          } else {
            state.stableCount++;
            
            // 优先检测：交互按钮出现（最可靠的完成标志）
            const hasButtons = state.hasActionButtons;
            
            // 高度是否稳定（至少 8 秒）
            const isHeightStable = state.heightStableCount >= state.heightStableThreshold;
            
            // 内容是否不再增长（至少 10 秒）
            const isNoGrowth = noGrowthTime >= state.minNoGrowthTime;
            
            // 智能完成条件（满足以下任一条件即可）：
            // 条件 A（最高优先级）：检测到交互按钮 + 高度稳定 + 内容不再增长 + 无加载指示器
            const completedByButtons = hasButtons && isHeightStable && isNoGrowth && !state.isLoading;
            
            // 条件 B（备用方案）：稳定计数 + 内容停留时间 + 内容不再增长
            const isStableEnough = state.stableCount >= state.stableThreshold;
            const hasStayedLongEnough = contentStayTime >= state.minContentStayTime;
            const completedByStability = isStableEnough && hasStayedLongEnough && isNoGrowth;
            
            console.log(
              '[Capture] 检测: 按钮=' + (hasButtons ? '✓' : '✗') +
              ' | 高度稳定: ' + state.heightStableCount + '/' + state.heightStableThreshold +
              ' | 稳定: ' + state.stableCount + '/' + state.stableThreshold + 
              ' | 停留: ' + (contentStayTime/1000).toFixed(1) + 's/' + (state.minContentStayTime/1000).toFixed(1) + 's' +
              ' | 不增长: ' + (noGrowthTime/1000).toFixed(1) + 's/' + (state.minNoGrowthTime/1000).toFixed(1) + 's' +
              ' | 字符: ' + state.charCount
            );
            
            if (completedByButtons || completedByStability) {
              state.state = 'completed';
              state.finalContent = currentResponse;
              const completionMethod = completedByButtons ? '交互按钮+高度+不增长' : '稳定性+不增长';
              console.log('[Capture] ✅ 完成！方式: ' + completionMethod + ' | 总耗时: ' + (state.elapsed/1000).toFixed(1) + 's');
            } else {
              // 显示当前进度
              const stablePercent = Math.round((state.stableCount / state.stableThreshold) * 100);
              const stayPercent = Math.round((contentStayTime / state.minContentStayTime) * 100);
              const heightPercent = Math.round((state.heightStableCount / state.heightStableThreshold) * 100);
              const noGrowthPercent = Math.round((noGrowthTime / state.minNoGrowthTime) * 100);
              state.state = 'detecting';
              state.progressInfo = {
                stablePercent: stablePercent,
                stayPercent: stayPercent,
                heightPercent: heightPercent,
                noGrowthPercent: noGrowthPercent,
                stayTime: contentStayTime,
                noGrowthTime: noGrowthTime
              };
            }
          }
        } else {
          // 没有内容或内容太短
          state.stableCount = 0;
          state.charCount = 0;
          state.preview = '';
          
          // 如果之前有内容但现在没了（不太可能），重置首次检测时间
          if (state.firstContentTime && !currentResponse) {
            console.log('[Capture] ⚠️ 内容消失，重置计时器');
            state.firstContentTime = null;
          }
          
          state.state = state.elapsed > ${timeout} ? 'timeout' : 'waiting';
        }
        
        return state;
      };
      
      // 启动定时更新
      window.__captureIntervalId = setInterval(() => {
        window.__updateCaptureState();
      }, 500);
      
      // 启动 MutationObserver 检测消息变化
      setupMessageObserver();
      
      return true;
    })();
  `;
  
  try {
    // 初始化监控脚本
    await webview.executeJavaScript(initScript);
    console.log('[CaptureResponse] ✅ 监控脚本已初始化');
    
    updateMonitoringPanel({ 
      state: 'waiting', 
      message: '等待 AI 开始回复...',
      checkCount: 0,
      stableCount: 0,
      charCount: 0
    });
    
    // 开始轮询状态
    return new Promise((resolve, reject) => {
      pollingTimer = setInterval(async () => {
        try {
          checkCount++;
          
          // 读取 webview 内部的状态
          const state = await webview.executeJavaScript('window.__captureState');
          
          if (!state) {
            console.warn('[CaptureResponse] 无法读取状态');
            return;
          }
          
          // 更新监控面板 UI
          updateMonitoringPanel({
            state: state.state,
            checkCount: checkCount,
            stableCount: state.stableCount || 0,
            charCount: state.charCount || 0,
            preview: state.preview || ''
          });
          
          // 检查是否完成或超时
          if (state.state === 'completed') {
            clearInterval(pollingTimer);
            
            // 停止 webview 内部的定时器
            try {
              await webview.executeJavaScript(`
                if (window.__captureIntervalId) {
                  clearInterval(window.__captureIntervalId);
                }
              `);
            } catch (e) {}
            
            // 隐藏监控面板，显示结果
            setTimeout(() => hideMonitoringPanel(), 1000);
            
            const finalContent = state.finalContent || '';
            
            // 计算时间差（使用 MutationObserver 检测到的真实时间）
            const responseCompleteTime = new Date().toISOString();
            
            // 将 responseCompleteTime 注入到 webview 状态中
            state.responseCompleteTime = responseCompleteTime;
            
            // 使用 MutationObserver 检测到的时间计算耗时
            const responseDuration = state.responseStartTime 
              ? (new Date(responseCompleteTime) - new Date(state.responseStartTime)) / 1000
              : null;
            const totalDuration = state.questionSentTime 
              ? (new Date(responseCompleteTime) - new Date(state.questionSentTime)) / 1000
              : null;
            
            capturedResponse = {
              content: finalContent,
              timestamp: responseCompleteTime,
              questionSentTime: state.questionSentTime,
              responseStartTime: state.responseStartTime,
              responseCompleteTime: responseCompleteTime,
              responseDuration: responseDuration,
              totalDuration: totalDuration,
              status: 'completed',
              elapsed: state.elapsed
            };
            
            // 不在 captureAIResponse 内部调用 displayCapturedResponse
            // displayCapturedResponse(capturedResponse);
            resolve(capturedResponse);
            
          } else if (state.state === 'timeout' || state.elapsed >= timeout) {
            clearInterval(pollingTimer);
            
            try {
              await webview.executeJavaScript(`
                if (window.__captureIntervalId) {
                  clearInterval(window.__captureIntervalId);
                }
              `);
            } catch (e) {}
            
            hideMonitoringPanel();
            
            // 尝试获取部分内容
            const partialContent = await webview.executeJavaScript(`
              (function() {
                const container = document.querySelector('[class*="message-list"], [class*="chat-messages"], .markdown-body');
                return container ? (container.innerText || container.textContent) : null;
              })();
            `);
            
            if (partialContent && partialContent.length > 10) {
              const responseCompleteTime = new Date().toISOString();
              state.responseCompleteTime = responseCompleteTime;
              
              const responseDuration = state.responseStartTime 
                ? (new Date(responseCompleteTime) - new Date(state.responseStartTime)) / 1000
                : null;
              const totalDuration = state.questionSentTime 
                ? (new Date(responseCompleteTime) - new Date(state.questionSentTime)) / 1000
                : null;
              
              capturedResponse = {
                content: partialContent,
                timestamp: responseCompleteTime,
                questionSentTime: state.questionSentTime,
                responseStartTime: state.responseStartTime,
                responseCompleteTime: responseCompleteTime,
                responseDuration: responseDuration,
                totalDuration: totalDuration,
                status: 'timeout_with_content',
                elapsed: state.elapsed
              };
              
              // 不在 captureAIResponse 内部调用 displayCapturedResponse
              // displayCapturedResponse(capturedResponse);
              resolve(capturedResponse);
            } else {
              updateMonitoringPanel({ 
                state: 'error', 
                message: '⏰ 等待回复超时，未捕获到内容' 
              });
              
              setTimeout(() => hideMonitoringPanel(), 2000);
              resolve(null);
            }
          }
          
        } catch (pollError) {
          console.error('[CaptureResponse] 轮询错误:', pollError);
        }
      }, 400); // 每 400ms 轮询一次（比内部检测稍快）
      
      // 设置超时保险
      setTimeout(() => {
        if (pollingTimer) {
          clearInterval(pollingTimer);
          pollingTimer = null;
          
          hideMonitoringPanel();
          updateMonitoringPanel({ state: 'timeout', message: '⏰ 监控超时' });
          
          setTimeout(() => hideMonitoringPanel(), 2000);
          resolve(null);
        }
      }, timeout + 5000); // 比设定超时多 5 秒的保险时间
      
    });
    
  } catch (error) {
    console.error('[CaptureResponse] ❌ 抓取 AI 回复出错:', error);
    hideMonitoringPanel();
    updateMonitoringPanel({ state: 'error', message: error.message });
    setTimeout(() => hideMonitoringPanel(), 2000);
    return null;
  }
}

// 显示抓取到的 AI 回复结果
function displayCapturedResponse(response) {
  if (!response || !response.content) {
    console.warn('[DisplayResponse] 没有可显示的回复内容');
    return;
  }
  
  // 创建或更新结果显示区域
  let responseContainer = document.getElementById('capturedResponseContainer');
  
  if (!responseContainer) {
    // 在 webview 容器下方创建结果显示区域
    const webviewContainer = getCurrentWebviewContainer();
    if (!webviewContainer) return;
    
    responseContainer = document.createElement('div');
    responseContainer.id = 'capturedResponseContainer';
    responseContainer.style.cssText = `
      margin-top: 16px;
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #86efac;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
    `;
    
    webviewContainer.parentNode.insertBefore(responseContainer, webviewContainer.nextSibling);
  }
  
  // 格式化时间戳
  const timeStr = new Date(response.timestamp).toLocaleTimeString('zh-TW');
  const questionTimeStr = response.questionSentTime ? new Date(response.questionSentTime).toLocaleTimeString('zh-TW') : '--:--:--';
  const responseStartTimeStr = response.responseStartTime ? new Date(response.responseStartTime).toLocaleTimeString('zh-TW') : '--:--:--';
  const responseEndTimeStr = response.responseCompleteTime ? new Date(response.responseCompleteTime).toLocaleTimeString('zh-TW') : '--:--:--';
  
  // 判断内容类型并格式化显示
  let formattedContent = escapeHtml(response.content);
  
  // 如果是 JSON 格式，尝试美化显示
  try {
    const jsonTest = JSON.parse(response.content);
    if (jsonTest) {
      formattedContent = '<pre style="background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.6;">' + escapeHtml(JSON.stringify(jsonTest, null, 2)) + '</pre>';
    }
  } catch (e) {
    // 不是 JSON，保持原样
  }
  
  responseContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 style="margin: 0; font-size: 16px; color: #166534; display: flex; align-items: center; gap: 8px;">
        🤖 AI 回复已捕获
        <span style="font-size: 11px; background: #166534; color: white; padding: 2px 8px; border-radius: 12px;">
          ${timeStr}
        </span>
      </h3>
      <div style="display: flex; gap: 8px;">
        <button onclick="copyCapturedResponse()" style="padding: 6px 14px; border: none; border-radius: 6px; background: #3b82f6; color: white; cursor: pointer; font-size: 13px; font-weight: 600;" title="复制到剪贴板">
          📋 复制
        </button>
        <button onclick="saveCapturedResponse()" style="padding: 6px 14px; border: none; border-radius: 6px; background: #10b981; color: white; cursor: pointer; font-size: 13px; font-weight: 600;" title="保存为文件">
          💾 保存
        </button>
        <button onclick="exportCapturedResponse('json')" style="padding: 6px 14px; border: none; border-radius: 6px; background: #8b5cf6; color: white; cursor: pointer; font-size: 13px; font-weight: 600;" title="导出为 JSON">
          📥 导出JSON
        </button>
        <button onclick="closeCapturedResponse()" style="padding: 6px 14px; border: none; border-radius: 6px; background: #ef4444; color: white; cursor: pointer; font-size: 13px; font-weight: 600;" title="关闭">
          ✕ 关闭
        </button>
      </div>
    </div>
    <div style="background: white; border-radius: 8px; padding: 16px; max-height: 600px; overflow-y: auto; border: 1px solid #bbf7d0;">
      <div style="font-size: 14px; color: #1f2937; line-height: 1.8; white-space: pre-wrap; word-break: break-word;">
        ${formattedContent}
      </div>
    </div>
    <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: #15803d;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <span>📊 字符数: ${response.content.length}</span>
        <span>📝 状态: ${response.status === 'completed' ? '✅ 完成' : '⏳ 部分完成'}</span>
      </div>
      <div style="display: flex; gap: 12px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid #bbf7d0;">
        <span>📤 发问题时间: ${questionTimeStr}</span>
        <span>📥 AI 开始回复: ${responseStartTimeStr}</span>
        <span>🏁 回复结束时间: ${responseEndTimeStr}</span>
      </div>
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <span>⏱️ AI 回复耗时: ${(response.responseDuration !== undefined && response.responseDuration !== null) ? (response.responseDuration).toFixed(1) + 's' : '无法计算'}</span>
        <span>️ 总耗时: ${(response.totalDuration !== undefined && response.totalDuration !== null) ? (response.totalDuration).toFixed(1) + 's' : '无法计算'}</span>
      </div>
    </div>
  `;
  
  // 滚动到可见区域
  responseContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  showStatus('✅ 已成功捕获 AI 回复 (' + response.content.length + ' 字符)', 'success');
}

// 复制抓取的回复到剪贴板
async function copyCapturedResponse() {
  if (!capturedResponse || !capturedResponse.content) {
    showStatus('❌ 没有可复制的内容', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(capturedResponse.content);
    showStatus('✅ 已复制到剪贴板', 'success');
  } catch (error) {
    // 备用方案
    const textArea = document.createElement('textarea');
    textArea.value = capturedResponse.content;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showStatus('✅ 已复制到剪贴板', 'success');
  }
}

// 保存抓取的回复为文件
async function saveCapturedResponse() {
  if (!capturedResponse || !capturedResponse.content) {
    showStatus('❌ 没有可保存的内容', 'error');
    return;
  }
  
  try {
    const filename = 'ai-response-' + new Date().toISOString().slice(0, 19).replace(/[:-]/g, '') + '.txt';
    const result = await window.electronAPI.saveData(capturedResponse.content, filename);
    
    if (result.success) {
      showStatus('💾 已保存到：' + result.path, 'success');
    } else {
      showStatus('❌ 保存失败：' + (result.message || '用户取消'), 'error');
    }
  } catch (error) {
    showStatus('❌ 保存失败：' + error.message, 'error');
  }
}

// 导出抓取的回复为指定格式
async function exportCapturedResponse(format) {
  if (!capturedResponse || !capturedResponse.content) {
    showStatus('❌ 没有可导出的内容', 'error');
    return;
  }
  
  try {
    let data, filename;
    
    if (format === 'json') {
      // 包装成 JSON 格式导出
      const exportData = {
        metadata: {
          source: window.currentPreviewUrl || 'unknown',
          captured_at: capturedResponse.timestamp,
          elapsed_ms: capturedResponse.elapsed,
          char_count: capturedResponse.content.length
        },
        content: capturedResponse.content,
        parsed_content: null
      };
      
      try {
        exportData.parsed_content = JSON.parse(capturedResponse.content);
      } catch (e) {
        // 内容不是有效 JSON
      }
      
      data = JSON.stringify(exportData, null, 2);
      filename = 'ai-response-export-' + new Date().toISOString().slice(0, 19).replace(/[:-]/g, '') + '.json';
    } else {
      data = capturedResponse.content;
      filename = 'ai-response-' + Date.now() + '.txt';
    }
    
    const result = await window.electronAPI.saveData(data, filename);
    
    if (result.success) {
      showStatus('📥 已导出到：' + result.path, 'success');
    } else {
      showStatus('❌ 导出失败：' + (result.message || '用户取消'), 'error');
    }
  } catch (error) {
    showStatus('❌ 导出失败：' + error.message, 'error');
  }
}

// 关闭抓取结果显示
function closeCapturedResponse() {
  const container = document.getElementById('capturedResponseContainer');
  if (container) {
    container.remove();
  }
}

// ========== 查看 DOM 树形结构（全新实现）==========
// 本地版 DOM 树构建（从当前渲染层 DOM 构建，适合 LLM/desktop-app 对话面板等非 webview 内容）
function buildDomTreeLocal(rootNode, sourceUrl) {
  try {
    function buildSimpleSelector(el) {
      if (!el || !el.tagName) return '';
      var tag = el.tagName.toLowerCase();
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        var c = el.className.trim().split(/\s+/).filter(x => x);
        if (c.length) return tag + '.' + c.slice(0, 3).join('.');
      }
      return tag;
    }
    function buildDomTree(node, depth, maxD) {
      if (!node || node.nodeType !== 1 || depth >= maxD) return null;
      var tag = node.tagName.toLowerCase();
      if (/^(script|style|noscript|meta|link)$/i.test(tag)) return null;
      var tree = { tag: tag, id: node.id || '', className: '', innerText: '', dataset: {}, images: [], links: [], inputs: [], buttons: [], tables: [], jsons: [], children: [] };
      if (node.className && typeof node.className === 'string') tree.className = node.className.trim();
      var txt = (node.innerText || '').trim();
      if (txt) tree.innerText = txt;
      if (node.attributes) for (var i = 0; i < node.attributes.length; i++) {
        var at = node.attributes[i];
        if (at && at.name && at.name.indexOf('data-') === 0 && at.value) tree.dataset[at.name.replace(/^data-/, '')] = at.value;
      }
      if (tag === 'img') {
        var s = node.getAttribute('src') || '', a = node.getAttribute('alt') || '';
        if (s) tree.images.push({ src: s, alt: a });
      } else {
        var ci = node.querySelectorAll('img');
        for (var g = 0; g < Math.min(ci.length, 10); g++) tree.images.push({ src: ci[g].getAttribute('src') || '', alt: ci[g].getAttribute('alt') || '' });
      }
      if (tag === 'a') {
        var h = node.getAttribute('href') || '', t = (node.innerText || '').trim(), tg = node.getAttribute('target') || '';
        if (h) tree.links.push({ href: h, text: t, target: tg, selector: buildSimpleSelector(node) });
      } else {
        var cl = node.querySelectorAll('a[href]');
        for (var l = 0; l < Math.min(cl.length, 10); l++) tree.links.push({ href: cl[l].getAttribute('href') || '', text: (cl[l].innerText || '').trim(), target: cl[l].getAttribute('target') || '', selector: buildSimpleSelector(cl[l]) });
      }
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        tree.inputs.push({ tag: tag, type: tag === 'input' ? (node.getAttribute('type') || 'text') : tag, name: node.getAttribute('name') || '', id: node.id || '', value: (node.value || '').trim(), placeholder: node.getAttribute('placeholder') || '', selector: buildSimpleSelector(node) });
      } else {
        var ci2 = node.querySelectorAll('input, textarea, select');
        for (var inp = 0; inp < Math.min(ci2.length, 10); inp++) { var c = ci2[inp], ct = c.tagName.toLowerCase(); tree.inputs.push({ tag: ct, type: ct === 'input' ? (c.getAttribute('type') || 'text') : ct, name: c.getAttribute('name') || '', id: c.id || '', value: (c.value || '').trim(), placeholder: c.getAttribute('placeholder') || '', selector: buildSimpleSelector(c) }); }
      }
      if (tag === 'button' || (tag === 'input' && /^(button|submit|reset)$/i.test(node.getAttribute('type') || ''))) {
        tree.buttons.push({ tag: tag, type: tag === 'input' ? (node.getAttribute('type') || 'button') : 'button', name: node.getAttribute('name') || '', id: node.id || '', text: (node.innerText || node.getAttribute('value') || '').trim(), selector: buildSimpleSelector(node) });
      } else if (tag === 'a' && node.className && /(button|btn)/i.test(String(node.className))) {
        tree.buttons.push({ tag: 'a', type: 'link-button', name: node.getAttribute('name') || '', id: node.id || '', text: (node.innerText || '').trim(), href: node.getAttribute('href') || '', selector: buildSimpleSelector(node) });
      } else {
        var cb = node.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
        for (var btn = 0; btn < Math.min(cb.length, 10); btn++) tree.buttons.push({ tag: cb[btn].tagName.toLowerCase(), type: cb[btn].tagName.toLowerCase() === 'input' ? (cb[btn].getAttribute('type') || 'button') : 'button', name: cb[btn].getAttribute('name') || '', id: cb[btn].id || '', text: (cb[btn].innerText || cb[btn].getAttribute('value') || '').trim(), selector: buildSimpleSelector(cb[btn]) });
      }
      if (tag === 'table') {
        var td_ = [], r_ = node.querySelectorAll('tr');
        for (var tr = 0; tr < Math.min(r_.length, 20); tr++) { var rd = [], cs = r_[tr].querySelectorAll('td, th'); for (var td = 0; td < Math.min(cs.length, 10); td++) rd.push((cs[td].innerText || cs[td].textContent || '').trim().substring(0, 50)); if (rd.length) td_.push(rd); }
        if (td_.length) tree.tables.push({ rows: td_, selector: buildSimpleSelector(node) });
      } else {
        var ct_ = node.querySelectorAll('table');
        for (var tb = 0; tb < Math.min(ct_.length, 5); tb++) { var cd = [], r2 = ct_[tb].querySelectorAll('tr'); for (var tr2 = 0; tr2 < Math.min(r2.length, 20); tr2++) { var rd2 = [], c2 = r2[tr2].querySelectorAll('td, th'); for (var td2 = 0; td2 < Math.min(c2.length, 10); td2++) rd2.push((c2[td2].innerText || c2[td2].textContent || '').trim().substring(0, 50)); if (rd2.length) cd.push(rd2); } if (cd.length) tree.tables.push({ rows: cd, selector: buildSimpleSelector(ct_[tb]) }); }
      }
      var nt_ = (node.innerText || node.textContent || '').trim(), fs_ = new Set();
      function tryParseJson(text, src) {
        if (!text || text.length < 10) return; text = text.trim();
        if ((text.startsWith('{') || text.startsWith('[')) && !fs_.has(text.substring(0, 50))) {
          try { var p = JSON.parse(text); fs_.add(text.substring(0, 50)); tree.jsons.push({ type: typeof p, source: src, preview: text.substring(0, 500), full: text.length > 2000 ? text.substring(0, 2000) : text, isTruncated: text.length > 2000, length: text.length, selector: buildSimpleSelector(node) }); return true; }
          catch (e) { var rx = /\{[\s\S]*?"[^"]*"\s*:[\s\S]*?\}|\[[\s\S]*?\]/g, mx = text.match(rx); if (mx) for (var m = 0; m < Math.min(mx.length, 5); m++) { if (mx[m].length > 20 && !fs_.has(mx[m].substring(0, 50))) { try { fs_.add(mx[m].substring(0, 50)); tree.jsons.push({ type: 'object', source: src + ' (片段)', preview: mx[m].substring(0, 500), full: mx[m].length > 2000 ? mx[m].substring(0, 2000) : mx[m], isTruncated: mx[m].length > 2000, length: mx[m].length, selector: buildSimpleSelector(node) }); JSON.parse(mx[m]); } catch (_) {} } } }
        }
      }
      tryParseJson(nt_, 'innerText');
      if (/^(script|pre|code)$/i.test(tag)) { tryParseJson(node.textContent || '', tag); }
      else { var st_ = node.querySelectorAll('script, pre, code'); for (var st = 0; st < Math.min(st_.length, 10); st++) tryParseJson(st_[st].textContent || '', st_[st].tagName.toLowerCase()); }
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) { var ch = buildDomTree(kids[i], depth + 1, maxD); if (ch) tree.children.push(ch); }
      return tree;
    }
    var dom = buildDomTree(rootNode, 0, 50);
    return { success: true, tree: dom, url: sourceUrl || 'desktop-app-chat-panel' };
  } catch (e) { return { success: false, error: e.stack || String(e) }; }
}

async function openDomTreeView() {
  console.log('[DomTreeView] === 开始获取 DOM 树形结构 ===');

  // ✅ 优先检测：若当前工作区显示的是 LLM/桌面APP对话面板（非 webview 内容），直接从渲染层 DOM 构建
  var activeWsPanel = document.querySelector('.workspace-panel[data-ws="' + currentWorkspaceId + '"].active-ws') || document.querySelector('.workspace-panel[data-ws="' + currentWorkspaceId + '"]');
  var chatPanel = activeWsPanel && activeWsPanel.querySelector('.desktop-app-chat-panel');
  if (chatPanel && getComputedStyle(chatPanel).display !== 'none') {
    try {
      showStatus(' 正在获取对话面板 DOM 树...', 'info');
      var d = buildDomTreeLocal(chatPanel, 'desktop-app-chat-panel');
      if (d && d.success) {
        await window.electronAPI.openDomTreeView({ tree: d.tree, url: d.url });
        showStatus(' 已打开对话面板 DOM 树查看器', 'success');
        return;
      }
    } catch (err) {
      console.error('[DomTreeView] ❌ 对话面板 DOM 失败:', err);
    }
  }

  const webview = getCurrentWebview();
  if (!webview) {
    showStatus(' 未找到网页预览组件', 'error');
    return;
  }

  try {
    showStatus(' 正在获取 DOM 树...', 'info');
    
    const domTreeData = await webview.executeJavaScript(`
      (function() {
        try {
          function buildSimpleSelector(el) {
            if (!el || !el.tagName) return '';
            var tag = el.tagName.toLowerCase();
            if (el.id) return '#' + el.id;
            if (el.className && typeof el.className === 'string') {
              var classes = el.className.trim().split(/\s+/).filter(c => c);
              if (classes.length > 0) return tag + '.' + classes.slice(0, 3).join('.');
            }
            return tag;
          }
          
          function buildDomTree(node, depth, maxD) {
            if (!node || node.nodeType !== 1 || depth >= maxD) return null;
            
            var tag = node.tagName.toLowerCase();
            if (/^(script|style|noscript|meta|link)$/i.test(tag)) return null;
            
            var tree = {
              tag: tag,
              id: node.id || '',
              className: '',
              innerText: '',
              dataset: {},
              images: [],
              links: [],
              inputs: [],
              buttons: [],
              tables: [],
              jsons: [],
              children: []
            };
            
            if (node.className && typeof node.className === 'string') {
              tree.className = node.className.trim();
            }
            
            var txt = (node.innerText || '').trim();
            if (txt) {
              tree.innerText = txt;
            }
            
            if (node.attributes) {
              for (var i = 0; i < node.attributes.length; i++) {
                var attr = node.attributes[i];
                if (attr && attr.name && attr.name.indexOf('data-') === 0 && attr.value) {
                  tree.dataset[attr.name.replace(/^data-/, '')] = attr.value;
                }
              }
            }
            
            // 收集图片（img 标签）
            if (tag === 'img') {
              var imgSrc = node.getAttribute('src') || '';
              var imgAlt = node.getAttribute('alt') || '';
              if (imgSrc) {
                tree.images.push({ src: imgSrc, alt: imgAlt });
              }
            } else {
              // 收集子元素中的图片
              var childImgs = node.querySelectorAll('img');
              for (var g = 0; g < Math.min(childImgs.length, 10); g++) {
                var childImg = childImgs[g];
                var childSrc = childImg.getAttribute('src') || '';
                var childAlt = childImg.getAttribute('alt') || '';
                if (childSrc) {
                  tree.images.push({ src: childSrc, alt: childAlt });
                }
              }
            }
            
            // 收集超链接（a 标签）
            if (tag === 'a') {
              var linkHref = node.getAttribute('href') || '';
              var linkText = (node.innerText || '').trim();
              if (linkHref) {
                tree.links.push({ href: linkHref, text: linkText });
              }
            } else {
              // 收集子元素中的超链接
              var childLinks = node.querySelectorAll('a');
              for (var l = 0; l < Math.min(childLinks.length, 10); l++) {
                var childLink = childLinks[l];
                var childHref = childLink.getAttribute('href') || '';
                var childLinkText = (childLink.innerText || '').trim();
                if (childHref) {
                  tree.links.push({ href: childHref, text: childLinkText });
                }
              }
            }
            
            // 收集输入框（input, textarea, select）
            if (/^(input|textarea|select)$/i.test(tag)) {
              var inputType = node.getAttribute('type') || (tag === 'textarea' ? 'textarea' : (tag === 'select' ? 'select' : 'text'));
              var inputName = node.getAttribute('name') || '';
              var inputId = node.id || '';
              var inputPlaceholder = node.getAttribute('placeholder') || '';
              var inputValue = node.value || '';
              
              tree.inputs.push({
                tag: tag,
                type: inputType,
                name: inputName,
                id: inputId,
                placeholder: inputPlaceholder,
                value: inputValue,
                selector: buildSimpleSelector(node)
              });
            } else {
              // 收集子元素中的输入框
              var childInputs = node.querySelectorAll('input, textarea, select');
              for (var inp = 0; inp < Math.min(childInputs.length, 10); inp++) {
                var childInput = childInputs[inp];
                var childType = childInput.getAttribute('type') || (childInput.tagName === 'TEXTAREA' ? 'textarea' : (childInput.tagName === 'SELECT' ? 'select' : 'text'));
                var childName = childInput.getAttribute('name') || '';
                var childId = childInput.id || '';
                var childPlaceholder = childInput.getAttribute('placeholder') || '';
                var childValue = childInput.value || '';
                
                tree.inputs.push({
                  tag: childInput.tagName.toLowerCase(),
                  type: childType,
                  name: childName,
                  id: childId,
                  placeholder: childPlaceholder,
                  value: childValue,
                  selector: buildSimpleSelector(childInput)
                });
              }
            }
            
            // 收集按钮（button, input[type="button"], input[type="submit"], a 标签按钮）
            if (/^(button)$/i.test(tag) || (tag === 'input' && /^(button|submit|reset)$/i.test(node.getAttribute('type') || ''))) {
              var btnType = tag === 'input' ? (node.getAttribute('type') || 'button') : 'button';
              var btnName = node.getAttribute('name') || '';
              var btnId = node.id || '';
              var btnText = (node.innerText || node.getAttribute('value') || '').trim();
              
              tree.buttons.push({
                tag: tag,
                type: btnType,
                name: btnName,
                id: btnId,
                text: btnText,
                selector: buildSimpleSelector(node)
              });
            } else if (tag === 'a' && /\bbutton|btn\b/i.test(node.className || '')) {
              // 也收集看起来像按钮的 a 标签
              var linkBtnName = node.getAttribute('name') || '';
              var linkBtnId = node.id || '';
              var linkBtnText = (node.innerText || '').trim();
              var linkBtnHref = node.getAttribute('href') || '';
              
              tree.buttons.push({
                tag: 'a',
                type: 'link-button',
                name: linkBtnName,
                id: linkBtnId,
                text: linkBtnText,
                href: linkBtnHref,
                selector: buildSimpleSelector(node)
              });
            } else {
              // 收集子元素中的按钮
              var childButtons = node.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
              for (var btn = 0; btn < Math.min(childButtons.length, 10); btn++) {
                var childBtn = childButtons[btn];
                var childBtnTag = childBtn.tagName.toLowerCase();
                var childBtnType = childBtnTag === 'input' ? (childBtn.getAttribute('type') || 'button') : 'button';
                var childBtnName = childBtn.getAttribute('name') || '';
                var childBtnId = childBtn.id || '';
                var childBtnText = (childBtn.innerText || childBtn.getAttribute('value') || '').trim();
                
                tree.buttons.push({
                  tag: childBtnTag,
                  type: childBtnType,
                  name: childBtnName,
                  id: childBtnId,
                  text: childBtnText,
                  selector: buildSimpleSelector(childBtn)
                });
              }
              
              // 也收集看起来像按钮的 a 标签
              var childLinkButtons = node.querySelectorAll('a.button, a.btn, a[class*="button"], a[class*="btn"]');
              for (var lbtn = 0; lbtn < Math.min(childLinkButtons.length, 5); lbtn++) {
                var childLinkBtn = childLinkButtons[lbtn];
                var childLinkBtnName = childLinkBtn.getAttribute('name') || '';
                var childLinkBtnId = childLinkBtn.id || '';
                var childLinkBtnText = (childLinkBtn.innerText || '').trim();
                var childLinkBtnHref = childLinkBtn.getAttribute('href') || '';
                
                tree.buttons.push({
                  tag: 'a',
                  type: 'link-button',
                  name: childLinkBtnName,
                  id: childLinkBtnId,
                  text: childLinkBtnText,
                  href: childLinkBtnHref,
                  selector: buildSimpleSelector(childLinkBtn)
                });
              }
            }
            
            // 收集表格（table 标签）
            if (tag === 'table') {
              var tableRows = node.querySelectorAll('tr');
              var tableData = [];
              for (var tr = 0; tr < Math.min(tableRows.length, 20); tr++) {
                var row = tableRows[tr];
                var cells = row.querySelectorAll('td, th');
                var rowData = [];
                for (var td = 0; td < Math.min(cells.length, 10); td++) {
                  rowData.push((cells[td].innerText || '').trim());
                }
                tableData.push(rowData);
              }
              
              if (tableData.length > 0) {
                tree.tables.push({
                  rows: tableData.length,
                  cols: tableData[0] ? tableData[0].length : 0,
                  data: tableData,
                  selector: buildSimpleSelector(node)
                });
              }
            } else {
              // 收集子元素中的表格
              var childTables = node.querySelectorAll('table');
              for (var tbl = 0; tbl < Math.min(childTables.length, 5); tbl++) {
                var childTable = childTables[tbl];
                var childTableRows = childTable.querySelectorAll('tr');
                var childTableData = [];
                for (var ctr = 0; ctr < Math.min(childTableRows.length, 20); ctr++) {
                  var crow = childTableRows[ctr];
                  var ccells = crow.querySelectorAll('td, th');
                  var crowData = [];
                  for (var ctd = 0; ctd < Math.min(ccells.length, 10); ctd++) {
                    crowData.push((ccells[ctd].innerText || '').trim());
                  }
                  childTableData.push(crowData);
                }
                
                if (childTableData.length > 0) {
                  tree.tables.push({
                    rows: childTableData.length,
                    cols: childTableData[0] ? childTableData[0].length : 0,
                    data: childTableData,
                    selector: buildSimpleSelector(childTable)
                  });
                }
              }
            }
            
            // 收集 JSON 数据（更智能地查找 JSON）
            // 1. 检查节点的文本内容
            var nodeText = (node.innerText || node.textContent || '').trim();
            var foundJsons = new Set(); // 避免重复
            
            function tryParseJson(text, source) {
              if (!text || text.length < 10) return;
              text = text.trim();
              
              // 检查是否以 JSON 开头
              if ((text.startsWith('{') || text.startsWith('[')) && !foundJsons.has(text.substring(0, 50))) {
                try {
                  var parsed = JSON.parse(text);
                  foundJsons.add(text.substring(0, 50));
                  tree.jsons.push({
                    type: typeof parsed,
                    source: source,
                    preview: text.substring(0, 500),
                    full: text.length > 2000 ? text.substring(0, 2000) : text,
                    isTruncated: text.length > 2000,
                    length: text.length,
                    selector: buildSimpleSelector(node)
                  });
                  return true;
                } catch (e) {
                  // 尝试在文本中查找 JSON 片段
                  var jsonRegex = /\{[\s\S]*?"[^"]*"\s*:[\s\S]*?\}|\[[\s\S]*?\]/g;
                  var matches = text.match(jsonRegex);
                  if (matches) {
                    for (var m = 0; m < Math.min(matches.length, 5); m++) {
                      var matchText = matches[m].trim();
                      if (matchText.length > 20 && !foundJsons.has(matchText.substring(0, 50))) {
                        try {
                          var parsedMatch = JSON.parse(matchText);
                          foundJsons.add(matchText.substring(0, 50));
                          tree.jsons.push({
                            type: typeof parsedMatch,
                            source: source + ' (片段)',
                            preview: matchText.substring(0, 500),
                            full: matchText.length > 2000 ? matchText.substring(0, 2000) : matchText,
                            isTruncated: matchText.length > 2000,
                            length: matchText.length,
                            selector: buildSimpleSelector(node)
                          });
                        } catch (e2) {
                          // 忽略无法解析的
                        }
                      }
                    }
                  }
                }
              }
            }
            
            // 检查当前节点
            tryParseJson(nodeText, 'innerText');
            
            // 2. 如果是 script 或 pre 标签，特别检查
            if (/^(script|pre|code)$/i.test(tag)) {
              var scriptContent = node.textContent || '';
              if (scriptContent && scriptContent !== nodeText) {
                tryParseJson(scriptContent, tag);
              }
            }
            
            // 3. 检查 data-* 属性中的 JSON
            if (node.attributes) {
              for (var attrIdx = 0; attrIdx < node.attributes.length; attrIdx++) {
                var attr = node.attributes[attrIdx];
                if (attr && attr.name && attr.name.indexOf('data-') === 0 && attr.value) {
                  var attrValue = attr.value.trim();
                  if (attrValue.length > 10 && (attrValue.startsWith('{') || attrValue.startsWith('['))) {
                    tryParseJson(attrValue, attr.name);
                  }
                }
              }
            }
            
            // 4. 收集子元素中的 JSON（只检查 script, pre, code 标签）
            if (!/^(script|pre|code)$/i.test(tag)) {
              var scriptTags = node.querySelectorAll('script, pre, code');
              for (var st = 0; st < Math.min(scriptTags.length, 10); st++) {
                var scriptTag = scriptTags[st];
                var scriptText = scriptTag.textContent || '';
                if (scriptText && scriptText.length > 10) {
                  tryParseJson(scriptText, scriptTag.tagName.toLowerCase());
                }
              }
            }
            
            var kids = node.children || [];
            for (var i = 0; i < kids.length; i++) {
              var ch = buildDomTree(kids[i], depth + 1, maxD);
              if (ch) tree.children.push(ch);
            }
            
            return tree;
          }
          
          var domTree = document.body ? buildDomTree(document.body, 0, 50) : null;
          return { success: true, tree: domTree, url: window.location.href };
        } catch (e) {
          return { success: false, error: e && e.stack ? e.stack : String(e) };
        }
      })();
    `);
    
    if (domTreeData && domTreeData.success) {
      console.log('[DomTreeView] ✅ 成功获取 DOM 树！');
      console.log('[DomTreeView] 📊 树数据大小:', JSON.stringify(domTreeData.tree).length, '字节');
      console.log('[DomTreeView] 🌐 URL:', domTreeData.url);
      console.log('[DomTreeView] 📤 准备打开 DOM 树查看器...');
      await window.electronAPI.openDomTreeView({
        tree: domTreeData.tree,
        url: domTreeData.url
      });
      console.log('[DomTreeView] ✅ IPC 调用完成');
      showStatus(' 已打开 DOM 树查看器窗口', 'success');
    } else {
      showStatus(' 获取 DOM 树失败：' + (domTreeData.error || ''), 'error');
    }
  } catch (error) {
    console.error('[DomTreeView]  获取 DOM 树失败:', error, error && error.stack);
    showStatus(' 获取 DOM 树失败：' + (error.stack || error.message || String(error)), 'error');
  }
}

// 监听 DOM 树刷新请求
if (window.electronAPI && window.electronAPI.onDomTreeRefreshRequest) {
  window.electronAPI.onDomTreeRefreshRequest(async () => {
    console.log('[DomTreeView] 收到刷新请求，重新获取 DOM 树');
    await openDomTreeView();
  });
}

// ========== 查看 webview 元素结构（保留旧函数，备用）==========
async function showWebviewElementStructure() {
  console.log('[ElementViewer] === 开始获取 webview 元素结构 ===');
  
  const webview = getCurrentWebview();
  if (!webview) {
    showStatus(' 未找到网页预览组件', 'error');
    return;
  }
  
  try {
    showStatus(' 正在获取元素结构...', 'info');
    
    const structureData = await webview.executeJavaScript(`
      (function() {
        try {
          function isTailwind(name) {
            if (!name) return true;
            if (/[\\[\\]&]/.test(name)) return true;
            for (var i = 0; i < name.length; i++) {
              if (name.charCodeAt(i) < 32 || name.charCodeAt(i) === 127) return true;
            }
            var patterns = [
              /^(flex|block|inline|hidden|absolute|relative|fixed|sticky)$/,
              /^(w|h|m|p|mx|my|mt|mb|ml|mr|px|py|pt|pb|pl|pr|gap|space)-/,
              /^(text|font|bg|border|rounded|shadow|opacity|z)-/,
              /^(overflow|whitespace|break|truncate|line-clamp)-/,
              /^(items|justify|content|self|align)-/,
              /^(col|row|grid|table)-/,
              /^(min|max)-/,
              /^(hover|focus|active|disabled|group-hover|peer-focus):/,
              /^\\d/, /^\\d+px$/, /^\\d+rem$/, /^\\[.*\\]$/
            ];
            for (var p = 0; p < patterns.length; p++) {
              if (patterns[p].test(name)) return true;
            }
            return false;
          }
          
          function makeSelectors(el) {
            var sels = [];
            if (!el || !el.tagName) return sels;
            var tag = el.tagName.toLowerCase();
            if (el.attributes) {
              for (var i = 0; i < el.attributes.length; i++) {
                var a = el.attributes[i];
                if (a && a.name && a.name.indexOf('data-') === 0 && a.value) {
                  sels.push(tag + '[' + a.name + '="' + a.value + '"]');
                }
              }
            }
            if (el.id) {
              sels.push('#' + el.id);
            }
            if (el.className && typeof el.className === 'string') {
              var classes = el.className.trim().split(/\\s+/);
              var good = [];
              for (var j = 0; j < classes.length; j++) {
                if (!isTailwind(classes[j])) good.push(classes[j]);
              }
              if (good.length > 0) {
                sels.push(tag + '.' + good.join('.'));
              }
            }
            var path = [];
            var node = el;
            var d = 0;
            while (node && node.tagName && d < 4) {
              var part = node.tagName.toLowerCase();
              if (node.id) {
                part = '#' + node.id;
                path.unshift(part);
                break;
              }
              if (node.className && typeof node.className === 'string') {
                var c = node.className.trim().split(/\\s+/)[0];
                if (c && !isTailwind(c)) part += '.' + c;
              }
              path.unshift(part);
              node = node.parentNode;
              d++;
            }
            if (path.length > 1) sels.push(path.join(' > '));
            var seen = {};
            var out = [];
            for (var k = 0; k < sels.length; k++) {
              if (sels[k] && !seen[sels[k]]) { seen[sels[k]] = true; out.push(sels[k]); }
            }
            return out;
          }
          
          var allEls = document.querySelectorAll('p,div,span,li,td,th,h1,h2,h3,h4,h5,h6,section,article,pre,blockquote,dd,dt');
          var results = [];
          for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            try {
              var style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
              var text = (el.innerText || '').trim();
              if (!text || text.length < 50) continue;
              var sels = makeSelectors(el);
              if (sels.length === 0) continue;
              results.push({
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                className: (el.className && typeof el.className === 'string') ? el.className : '',
                selector: sels[0],
                candidates: sels,
                innerText: text,
                textLength: text.length
              });
            } catch (e) { continue; }
          }
          var seen = {};
          var unique = [];
          for (var j = 0; j < results.length; j++) {
            var fp = results[j].innerText.substring(0, 100);
            if (!seen[fp]) { seen[fp] = true; unique.push(results[j]); }
          }
          unique.sort(function(a, b) { return b.textLength - a.textLength; });
          results = unique.slice(0, 20);
          
          function buildTree(node, depth, maxD) {
            if (!node || node.nodeType !== 1 || depth >= maxD) return null;
            var tag = node.tagName.toLowerCase();
            if (/^(script|style|noscript|meta|link|svg)$/.test(tag)) return null;
            var tree = { tag: tag, id: node.id || '', className: '', innerText: '', children: [] };
            if (node.className && typeof node.className === 'string') tree.className = node.className;
            var txt = (node.innerText || '').trim();
            if (txt) tree.innerText = txt.substring(0, 200);
            var kids = node.children || [];
            for (var i = 0; i < kids.length && tree.children.length < 8; i++) {
              var ch = buildTree(kids[i], depth + 1, maxD);
              if (ch) tree.children.push(ch);
            }
            return tree;
          }
          
          var bodyTree = document.body ? buildTree(document.body, 0, 4) : null;
          return { success: true, textElements: results, bodyTree: bodyTree, url: window.location.href };
        } catch (e) {
          return { success: false, error: e && e.stack ? e.stack : String(e) };
        }
      })();
    `);
    
    if (structureData && structureData.success) {
      console.log('[ElementViewer]  成功获取元素结构！');
      console.log('[ElementViewer]  提取了', structureData.textElements.length, '个文本元素');
      await window.electronAPI.openElementViewer({
        allTextElements: structureData.textElements || [],
        textElements: structureData.textElements || [],
        bodyTree: structureData.bodyTree,
        url: structureData.url
      });
      showStatus(' 已打开元素查看器窗口', 'success');
    } else {
      showStatus(' 获取结构失败：' + (structureData.error || ''), 'error');
    }
  } catch (error) {
    console.error('[ElementViewer]  获取结构失败:', error, error && error.stack);
    showStatus(' 获取结构失败：' + (error.stack || error.message || String(error)), 'error');
  }
}

// 挂载到 window 以便 onclick 内联事件和其他模组调用
window.generateSelectorStrategies = generateSelectorStrategies;
window.simplifyClassSelector = simplifyClassSelector;
window.captureWithCustomSelector = captureWithCustomSelector;
window.startManualMonitoring = startManualMonitoring;
window.toggleMonitorDropdown = toggleMonitorDropdown;
window.closeMonitorDropdown = closeMonitorDropdown;
window.startManualMonitoringAndEmail = startManualMonitoringAndEmail;
window.showMonitoringPanel = showMonitoringPanel;
window.updateMonitoringTimer = updateMonitoringTimer;
window.updateMonitoringPanel = updateMonitoringPanel;
window.hideMonitoringPanel = hideMonitoringPanel;
window.stopMonitoring = stopMonitoring;
window.captureAIResponse = captureAIResponse;
window.displayCapturedResponse = displayCapturedResponse;
window.copyCapturedResponse = copyCapturedResponse;
window.saveCapturedResponse = saveCapturedResponse;
window.exportCapturedResponse = exportCapturedResponse;
window.closeCapturedResponse = closeCapturedResponse;
window.openDomTreeView = openDomTreeView;
window.showWebviewElementStructure = showWebviewElementStructure;
