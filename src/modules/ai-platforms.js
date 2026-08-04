/**
 * AI平台自动发送模组
 * 从 renderer.js 拆分而来
 * 包含各AI平台（文心、豆包、讯飞、Kimi、千问等）的自动发送和回复抓取函数
 * 依赖：showStatus, bookmarks（来自 renderer.js）
 */
// 注入轻量级持续监控脚本（自动记录 AI 开始/结束时间）
async function injectPersistentAITimeMonitor(webview) {
  try {
    // 先检查是否已经注入过
    const alreadyInjected = await webview.executeJavaScript(`
      (function() {
        return !!(window.__aiTimeMonitorInjected);
      })();
    `);
    
    if (alreadyInjected) {
      console.log('[PersistentMonitor] 监控脚本已存在，跳过注入');
      return;
    }
    
    const monitorScript = `
      (function() {
        if (window.__aiTimeMonitorInjected) return;
        window.__aiTimeMonitorInjected = true;
        
        // 时间记录对象
        window.__aiTimeRecord = {
          questionSentTime: null,       // 用户发送问题的时间
          responseStartTime: null,      // AI 开始回复的时间
          responseCompleteTime: null,   // AI 回复完成的时间
          lastContentLength: 0,         // 上次检查的内容长度
          contentGrowCount: 0,          // 内容增长计数
          contentStableCount: 0,        // 内容稳定计数
          isMonitoring: false,          // 是否正在监控一轮对话
          lastCheckTime: 0,             // 上次检查的时间戳
          aiContentDetected: false,     // 是否检测到 AI 内容
          previousMessageCount: 0       // 上次的消息总数
        };
        
        // 提取所有消息文本（用于检测新消息）
        function getAllMessageTexts() {
          const selectors = [
            '[class*="message"]',
            '[class*="bubble"]',
            '[class*="chat-item"]',
            '[class*="dialog"]',
            '[class*="response"]',
            '[class*="assistant"]',
            '[class*="user"]',
            '[class*="item"]',
            // DeepSeek 特定选择器
            '[class*="deepseek"]',
            '[class*="ds-message"]',
            '[class*="deep-seek"]',
            '[class*="ds-content"]'
          ];
          let texts = [];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            els.forEach(el => {
              const t = el.innerText || el.textContent;
              if (t && t.trim().length > 5) texts.push(t.trim());
            });
          }
          return texts;
        }
        
        // 检测 AI 回复内容（包含 DeepSeek 选择器）
        function getAIResponseText() {
          // 策略：使用位置过滤 - 侧边栏在左侧，聊天内容在右侧
          const viewportWidth = window.innerWidth;
          const sidebarThreshold = viewportWidth * 0.35; // 页面左侧35%视为侧边栏
          
          const markdownElements = document.querySelectorAll('.markdown-body');
          if (markdownElements.length > 0) {
            // 从后向前查找（最新的 AI 回复优先）
            for (let i = markdownElements.length - 1; i >= 0; i--) {
              const markdown = markdownElements[i];
              
              // 获取元素位置
              const rect = markdown.getBoundingClientRect();
              
              // 关键：只接受在页面右侧的内容（排除左侧边栏）
              if (rect.left < sidebarThreshold) continue;
              
              // 确保元素可见
              if (rect.width === 0 || rect.height === 0) continue;
              
              const text = markdown.innerText || markdown.textContent;
              if (text && text.trim().length > 20) {
                return text.trim();
              }
            }
          }
          
          return null;
        }
        
        // 检测是否正在加载/生成中
        function isLoading() {
          const indicators = document.querySelectorAll(
            '[class*="loading"], [class*="spinner"], [class*="typing"], [aria-busy="true"], [class*="generating"], [class*="pending"]'
          );
          return indicators.length > 0;
        }
        
        // 检测是否有交互按钮（回复完成标志）
        function hasActionButtons() {
          const selectors = [
            // 通用选择器
            '[class*="action-bar"]',
            '[class*="message-actions"]',
            '[class*="copy-btn"]',
            '[class*="regenerate"]',
            '[class*="toolbar"]',
            'div[class*="actions"]',
            // 豆包特定选择器
            '[class*="doubao-action"]',
            '[class*="msg-toolbar"]',
            // 智谱AI特定选择器
            '[class*="zhipu-action"]',
            '[class*="action-tools"]',
            // 元宝特定选择器（腾讯混元）
            '[class*="yuanbao-action"]',
            '[class*="hunyuan-action"]',
            '[class*="chat-actions"]',
            // 通义千问特定选择器
            '[class*="tongyi-action"]',
            '[class*="qwen-action"]',
            // DeepSeek 特定选择器
            '[class*="deepseek-action"]',
            '[class*="ds-action"]',
            '[class*="deep-seek-action"]',
            '[class*="ds-buttons"]',
            // 更通用的完成标志
            'button[class*="copy"]',
            'button[class*="regenerate"]',
            'button[class*="retry"]'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden') return true;
            }
          }
          return false;
        }
        
        // 主监控函数
        function monitorTick() {
          const record = window.__aiTimeRecord;
          const now = Date.now();
          
          // 获取当前所有消息
          const allTexts = getAllMessageTexts();
          const currentCount = allTexts.length;
          
          // 检测是否有新消息（用户发送问题）
          if (currentCount > record.previousMessageCount && record.previousMessageCount > 0) {
            if (!record.questionSentTime) {
              record.questionSentTime = new Date().toISOString();
              console.log('[PersistentMonitor]  检测到用户发送问题: ' + record.questionSentTime);
            }
            // 重置监控状态，准备检测 AI 回复
            record.aiContentDetected = false;
            record.responseStartTime = null;
            record.responseCompleteTime = null;
            record.lastContentLength = 0;
            record.contentGrowCount = 0;
            record.contentStableCount = 0;
          }
          record.previousMessageCount = currentCount;
          
          // 如果还没有记录发送时间，尝试从已有消息中推断（页面加载时已有对话的情况）
          if (!record.questionSentTime && currentCount >= 2) {
            record.questionSentTime = new Date().toISOString();
            console.log('[PersistentMonitor] 📤 推断用户已发送问题: ' + record.questionSentTime);
          }
          
          // 获取 AI 回复内容
          const aiText = getAIResponseText();
          
          if (aiText && aiText.length > 10) {
            // 检测到 AI 内容
            if (!record.aiContentDetected) {
              record.aiContentDetected = true;
              record.responseStartTime = new Date().toISOString();
              console.log('[PersistentMonitor] 📥 AI 开始回复: ' + record.responseStartTime);
            }
            
            // 检测内容是否增长
            if (aiText.length > record.lastContentLength) {
              record.contentGrowCount++;
              record.contentStableCount = 0;
              record.lastContentLength = aiText.length;
            } else {
              record.contentStableCount++;
            }
            
            // 判断是否完成
            const isStable = record.contentStableCount >= 10; // 连续10次（20秒）内容不变
            const hasButtons = hasActionButtons();
            const notLoading = !isLoading();
            
            // 对于内容较长且稳定的情况，即使有加载指示器也强制完成（DeepSeek 等平台需要）
            const isContentLargeAndStable = record.contentStableCount >= 10 && aiText.length > 1000;
            
            if (((isStable || hasButtons) && notLoading) || isContentLargeAndStable) {
              if (!record.responseCompleteTime) {
                record.responseCompleteTime = new Date().toISOString();
                console.log('[PersistentMonitor] 🏁 AI 回复完成: ' + record.responseCompleteTime);
                console.log('[PersistentMonitor] 📊 AI 回复耗时: ' + 
                  ((new Date(record.responseCompleteTime) - new Date(record.responseStartTime)) / 1000).toFixed(1) + 's');
              }
            }
          } else {
            // 没有检测到 AI 内容，重置
            if (record.aiContentDetected && !record.responseCompleteTime) {
              // 内容消失了，可能是页面刷新或新对话
              record.aiContentDetected = false;
              record.responseStartTime = null;
              record.lastContentLength = 0;
              record.contentGrowCount = 0;
              record.contentStableCount = 0;
            }
          }
          
          record.lastCheckTime = now;
        }
        
        // 每 2 秒检查一次
        window.__aiTimeMonitorInterval = setInterval(monitorTick, 2000);
        
        // 立即执行一次
        monitorTick();
        
        console.log('[PersistentMonitor] 👁️ 轻量级 AI 时间监控已启动（每2秒检查一次）');
      })();
    `;
    
    await webview.executeJavaScript(monitorScript);
    console.log('[PersistentMonitor] ✅ 持续监控脚本已注入');
  } catch (e) {
    console.error('[PersistentMonitor] 注入监控脚本失败:', e);
  }
}

// ========== 文心一言专用函数 - wenXin前缀 ==========
async function wenXinAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] [wenXinAutoSend 被调用:');
  console.log('[Renderer]   - message:', message ? `"${message.substring(0, 50)}..."` : '(空)');
  console.log('[Renderer]   - attachment:', attachment ? attachment.name : '(无)');
  
  const attachmentData = attachment ? JSON.stringify(attachment) : 'null';
  
  const script = `
    (async function() {
      const message = ${JSON.stringify(message)};
      const attachmentData = ${attachmentData};
      const hasMessage = message && message.trim().length > 0;
      const hasAttachment = attachmentData !== null;
      
      console.log('[wenXin] ================================');
      console.log('[wenXin] 开始处理文心一言');
      console.log('[wenXin] 有消息:', hasMessage);
      console.log('[wenXin] 有附件:', hasAttachment);
      console.log('[wenXin] ================================');
      
      // 查找输入框
      const possibleSelectors = [
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="输入"]',
        'textarea[class*="input"]',
        'textarea[class*="editor"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'textarea',
        'input[type="text"]'
      ];
      
      let inputElement = null;
      for (const selector of possibleSelectors) {
        inputElement = document.querySelector(selector);
        if (inputElement) {
          console.log('[wenXin] 找到输入框:', selector);
          break;
        }
      }
      
      if (!inputElement) {
        return { success: false, error: '未找到输入框' };
      }
      
      // 先处理附件（如果有）
      if (hasAttachment) {
        try {
          console.log('[wenXin] ================================');
          console.log('[wenXin] 检测到附件，开始处理上传...');
          console.log('[wenXin] 附件信息:', attachmentData.name, attachmentData.size, 'bytes');
          console.log('[wenXin] ================================');
          
          // 将 Base64 数据转换为 File 对象
          console.log('[wenXin] 正在转换附件数据...');
          const base64Data = attachmentData.data.split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const file = new File([byteArray], attachmentData.name, { type: attachmentData.type });
          console.log('[wenXin] ✅ 文件对象已创建:', file.name, file.size, 'bytes');
          
          // 先聚焦到输入框
          inputElement.focus();
          await new Promise(r => setTimeout(r, 800));
          
          let uploadSuccess = false;
          
          // 方法1: 尝试使用 navigator.clipboard API 写入文件
          if (navigator.clipboard && navigator.clipboard.write && !uploadSuccess) {
            console.log('[wenXin] 尝试使用 Clipboard API 写入文件...');
            try {
              const clipboardItem = new ClipboardItem({
                [file.type]: file
              });
              await navigator.clipboard.write([clipboardItem]);
              console.log('[wenXin] ✅ 文件已写入剪贴板');
              
              await new Promise(r => setTimeout(r, 500));
              
              // 触发粘贴事件
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true
              });
              inputElement.dispatchEvent(pasteEvent);
              console.log('[wenXin] ✅ 已触发 paste 事件');
              
              uploadSuccess = true;
              await new Promise(r => setTimeout(r, 3000));
            } catch (e) {
              console.log('[wenXin] Clipboard API 写入失败:', e);
            }
          }
          
          // 方法2: 使用 DataTransfer + 自定义事件
          if (!uploadSuccess) {
            console.log('[wenXin] 尝试 DataTransfer 方案...');
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            console.log('[wenXin] DataTransfer 已创建，文件数量:', dataTransfer.items.length);
            
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true
            });
            Object.defineProperty(pasteEvent, 'clipboardData', {
              value: dataTransfer,
              writable: false
            });
            console.log('[wenXin] ✅ 粘贴事件已创建');
            
            inputElement.dispatchEvent(pasteEvent);
            console.log('[wenXin] ✅ 已触发 paste 事件');
            
            uploadSuccess = true;
          }
          
          // 触发 input 事件
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[wenXin] ✅ 已触发 input 和 change 事件');
          
          // 等待文心一言处理文件 - 延长等待时间到12秒
          console.log('[wenXin] 等待文心一言处理附件...');
          await new Promise(r => setTimeout(r, 12000));
          
          // 检查是否有文件预览元素出现
          const filePreviews = document.querySelectorAll('[class*="file"], [class*="upload"], [class*="image"]');
          console.log('[wenXin] 找到的文件预览元素数量:', filePreviews.length);
          
          console.log('[wenXin] 文件处理完成');
          console.log('[wenXin] ================================');
        } catch (error) {
          console.error('[wenXin] ❌ 附件上传过程中发生错误:', error);
        }
      }
      
      // 再处理文字消息（如果有）
      if (hasMessage) {
        // 文心一言：需要模拟人类逐字输入
        inputElement.focus();
        
        // 🔑 先清空输入框原有内容（避免追加导致重复）
        console.log('[wenXin] 检查并清空输入框原有内容...');
        const originalValue = inputElement.value || inputElement.textContent || '';
        if (originalValue.trim().length > 0) {
          console.log('[wenXin] 输入框有旧内容，清空中:', originalValue.substring(0, 30));
          inputElement.textContent = '';
          inputElement.value = '';
          await new Promise(r => setTimeout(r, 300));
          // 再次确认清空
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 200));
          console.log('[wenXin] 输入框已清空');
        }
        
        console.log('[wenXin] [文心一言] 开始模拟逐字输入...');
        
        // 逐字输入（模拟真实用户打字）
        for (let i = 0; i < message.length; i++) {
          const char = message[i];
          const keyCode = char.charCodeAt(0);
          
          // 每个字符都触发完整的键盘事件序列
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char
          });
          inputElement.dispatchEvent(beforeInput);
          
          const keydownEvent = new KeyboardEvent('keydown', {
            key: char,
            code: char.length === 1 ? 'Key' + char.toUpperCase() : 'Enter',
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keydownEvent);
          
          const keypressEvent = new KeyboardEvent('keypress', {
            key: char,
            code: char.length === 1 ? 'Key' + char.toUpperCase() : 'Enter',
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keypressEvent);
          
          // 插入字符
          const textNode = document.createTextNode(char);
          inputElement.appendChild(textNode);
          
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char
          });
          inputElement.dispatchEvent(inputEvent);
          
          const keyupEvent = new KeyboardEvent('keyup', {
            key: char,
            code: char.length === 1 ? 'Key' + char.toUpperCase() : 'Enter',
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keyupEvent);
          
          if (i % 5 === 0) {
            await new Promise(function(r) { setTimeout(r, 10); });
          }
        }
        
        console.log('[wenXin] [文心一言] 逐字输入完成');
        
        // 最后触发完整的事件序列
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
      } else if (hasAttachment) {
        // 只有附件没有文字的情况：输入一个空格来激活发送按钮
        console.log('[wenXin] 只有附件，输入一个空格激活发送按钮...');
        
        const char = ' ';
        const keyCode = 32;
        
        // 触发完整的键盘事件序列
        inputElement.focus();
        
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char
        });
        inputElement.dispatchEvent(beforeInput);
        
        const keydownEvent = new KeyboardEvent('keydown', {
          key: char,
          code: 'Space',
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        });
        inputElement.dispatchEvent(keydownEvent);
        
        const keypressEvent = new KeyboardEvent('keypress', {
          key: char,
          code: 'Space',
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        });
        inputElement.dispatchEvent(keypressEvent);
        
        // 插入字符
        const textNode = document.createTextNode(char);
        inputElement.appendChild(textNode);
        
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char
        });
        inputElement.dispatchEvent(inputEvent);
        
        const keyupEvent = new KeyboardEvent('keyup', {
          key: char,
          code: 'Space',
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        });
        inputElement.dispatchEvent(keyupEvent);
        
        // 最后触发完整的事件序列
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
        
        console.log('[wenXin] 空格输入完成');
      }
      
      console.log('[wenXin] 设置值完成，当前值:', inputElement.value || inputElement.textContent);
      
      // 等待 React 更新
      console.log('[wenXin] 等待 React 状态更新...');
      await new Promise(r => setTimeout(r, 3000));
      
      // 再次触发 input 事件
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
      
      // 尝试按 Enter 键
      inputElement.focus();
      const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const keypressEvent = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const keyupEvent = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      
      inputElement.dispatchEvent(keydownEvent);
      inputElement.dispatchEvent(keypressEvent);
      inputElement.dispatchEvent(keyupEvent);
      console.log('[wenXin] 已发送 Enter 键');
      
      // 等待 Enter 事件生效
      await new Promise(r => setTimeout(r, 2000));
      
      // 触发 input 事件确保消息被识别
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[wenXin] 已触发 input/change 事件确保消息识别');
      
      // 再等待一下
      await new Promise(r => setTimeout(r, hasAttachment ? 3000 : 1000));
      
      // 尝试点击发送按钮（文心一言优先的选择器）
      const buttonSelectors = [
        // 文心一言特有的选择器
        'button svg[class*="icon-send"]',
        'button[class*="sendIcon"]',
        'button[class*="icon_send"]',
        'div[class*="sendIcon"] button',
        'div[class*="send-icon"] button',
        'div[class*="sendIcon"]',
        'div[class*="icon-send"]',
        // 通用选择器
        'button[aria-label="发送"]',
        'button[aria-label*="发送"]',
        'button svg[class*="send"]',
        'button svg[class*="arrow"]',
        'div[class*="send"] button',
        'div[class*="submit"] button',
        'button[class*="send-button"]',
        'button[class*="sendBtn"]',
        'button[class*="arrow-up"]',
        'button[class*="arrowUp"]',
        'button[class*="up-arrow"]',
        '[class*="send-button"]',
        '[class*="send-btn"]',
        'button[type="submit"]',
        'button[title*="发送"]',
        'button:has(svg)',
        'button[class*="send"]',
        'button[class*="submit"]',
        'button:last-of-type'
      ];
      
      let sendButton = null;
      for (const selector of buttonSelectors) {
        try {
          sendButton = document.querySelector(selector);
          if (sendButton && sendButton.offsetParent !== null && !sendButton.disabled) {
            console.log('[wenXin] 找到发送按钮:', selector);
            break;
          }
          sendButton = null;
        } catch (e) { continue; }
      }
      
      if (!sendButton) {
        const inputRect = inputElement.getBoundingClientRect();
        const allButtons = Array.from(document.querySelectorAll('button'));
        sendButton = allButtons.find(btn => {
          const rect = btn.getBoundingClientRect();
          return !btn.disabled &&
                 rect.left > inputRect.right - 50 && rect.left < inputRect.right + 150 &&
                 Math.abs(rect.top - inputRect.top) < 80 && rect.width > 20 && rect.width < 80;
        });
        if (sendButton) console.log('[wenXin] 通过位置找到发送按钮');
      }
      
      let messageSent = false;
      
      if (sendButton) {
        console.log('[wenXin] 找到发送按钮，准备点击...');
        
        // 先聚焦到输入框
        inputElement.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // 多种点击方式尝试
        const clickAttempts = [
          () => { sendButton.click(); },
          () => { sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); }
        ];
        
        for (let attempt = 0; attempt < clickAttempts.length; attempt++) {
          try {
            clickAttempts[attempt]();
            console.log('[wenXin] 点击尝试', attempt + 1);
            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            console.error('[wenXin] 点击尝试失败:', e);
          }
        }
        
        console.log('[wenXin] ✅ 已尝试多次点击发送按钮');
        messageSent = true;
      } else {
        console.log('[wenXin] 未找到发送按钮，将按 Enter 键发送');
        
        // 聚焦输入框
        inputElement.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // 多次尝试按 Enter
        for (let attempt = 0; attempt < 3; attempt++) {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(enterEvent);
          
          const enterUpEvent = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(enterUpEvent);
          
          console.log('[wenXin] Enter 尝试', attempt + 1);
          await new Promise(r => setTimeout(r, 300));
        }
        
        console.log('[wenXin] ✅ 已多次尝试按 Enter 键发送');
        messageSent = true;
      }
      
      // 持续清空策略
      if (messageSent) {
        setTimeout(() => {
          console.log('[wenXin] [文心一言] 启动持续清空策略（5秒）...');
          
          let clearCount = 0;
          const totalDuration = 5000;
          const interval = 200;
          const startTime = Date.now();
          
          const clearIntervalId = setInterval(() => {
            try {
              const elapsed = Date.now() - startTime;
              if (elapsed > totalDuration) {
                clearInterval(clearIntervalId);
                console.log('[wenXin] [文心一言] 持续清空完成！共执行', clearCount, '次');
                return;
              }
              
              clearCount++;
              inputElement.focus();
              
              // 每次清空都执行：全选 + 空格 + 全选 + 删除
              const selection = window.getSelection();
              selection.removeAllRanges();
              const range = document.createRange();
              range.selectNodeContents(inputElement);
              selection.addRange(range);
              document.execCommand('insertText', false, ' ');
              inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' ' }));
              
              setTimeout(() => {
                try {
                  const selection2 = window.getSelection();
                  selection2.removeAllRanges();
                  const range2 = document.createRange();
                  range2.selectNodeContents(inputElement);
                  selection2.addRange(range2);
                  document.execCommand('delete');
                  inputElement.textContent = '';
                  inputElement.innerHTML = '';
                  while (inputElement.firstChild) {
                    inputElement.removeChild(inputElement.firstChild);
                  }
                  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                } catch (e) {}
              }, 50);
              
            } catch (e) {
              console.error('[wenXin] [文心一言] 清空失败:', e);
            }
          }, interval);
        }, 300);
      }
      
      return { success: true, method: sendButton ? 'button' : 'enter', platform: 'wenXin' };
    })();
  `;
  
  try {
    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 文心一言自动发送结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] 文心一言自动发送失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 豆包专用：发送消息 ==========
async function doubaoAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] doubaoAutoSend 被调用:');
  console.log('[Renderer]   - message:', message ? `"${message.substring(0, 50)}..."` : '(空)');
  console.log('[Renderer]   - attachment:', attachment ? attachment.name : '(无)');
  
  const attachmentData = attachment ? JSON.stringify(attachment) : 'null';
  
  const script = `
    (async function() {
      const message = ${JSON.stringify(message)};
      const attachmentData = ${attachmentData};
      
      // 如果有附件，先处理文件上传
      if (attachmentData) {
        try {
          console.log('[doubao] ================================');
          console.log('[doubao] 检测到附件，开始处理上传...');
          console.log('[doubao] 附件信息:', attachmentData.name, attachmentData.size, 'bytes');
          console.log('[doubao] ================================');
          
          const inputElement = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
          if (inputElement) {
            const className = typeof inputElement.className === 'string' ? inputElement.className : (inputElement.className?.baseVal || '');
            console.log('[doubao] 找到输入框:', inputElement.tagName, className.substring(0, 50));
            
            // 将 Base64 数据转换为 File 对象
            console.log('[doubao] 正在转换附件数据...');
            const base64Data = attachmentData.data.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const file = new File([byteArray], attachmentData.name, { type: attachmentData.type });
            console.log('[doubao] ✅ 文件对象已创建:', file.name, file.size, 'bytes');
            
            // 先聚焦到输入框
            inputElement.focus();
            await new Promise(r => setTimeout(r, 800));
            
            let uploadSuccess = false;
            
            // 方法1: 尝试使用 navigator.clipboard API 写入文件
            if (navigator.clipboard && navigator.clipboard.write && !uploadSuccess) {
              console.log('[doubao] 尝试使用 Clipboard API 写入文件...');
              try {
                const clipboardItem = new ClipboardItem({
                  [file.type]: file
                });
                await navigator.clipboard.write([clipboardItem]);
                console.log('[doubao] ✅ 文件已写入剪贴板');
                
                await new Promise(r => setTimeout(r, 500));
                
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true
                });
                inputElement.dispatchEvent(pasteEvent);
                console.log('[doubao] ✅ 已触发 paste 事件');
                
                uploadSuccess = true;
                await new Promise(r => setTimeout(r, 3000));
              } catch (e) {
                console.log('[doubao] Clipboard API 写入失败:', e);
              }
            }
            
            // 方法2: 使用 DataTransfer + 自定义事件
            if (!uploadSuccess) {
              console.log('[doubao] 尝试 DataTransfer 方案...');
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              console.log('[doubao] DataTransfer 已创建，文件数量:', dataTransfer.items.length);
              
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true
              });
              Object.defineProperty(pasteEvent, 'clipboardData', {
                value: dataTransfer,
                writable: false
              });
              console.log('[doubao] ✅ 粘贴事件已创建');
              
              inputElement.dispatchEvent(pasteEvent);
              console.log('[doubao] ✅ 已触发 paste 事件');
              
              uploadSuccess = true;
            }
            
            // 对于 contenteditable div，还需要触发 input 事件
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[doubao] ✅ 已触发 input 和 change 事件');
            
            // 等待处理文件
            console.log('[doubao] 等待处理附件...');
            await new Promise(r => setTimeout(r, 8000));
            
            // 检查输入框状态
            const content = inputElement.tagName === 'TEXTAREA' ? inputElement.value : inputElement.textContent;
            console.log('[doubao] 输入框当前内容:', content?.substring(0, 100));
            
            // 检查是否有文件预览元素出现
            const filePreviews = document.querySelectorAll('[class*="file"], [class*="upload"], [class*="image"]');
            console.log('[doubao] 找到的文件预览元素数量:', filePreviews.length);
            
            if (!content || content.trim().length === 0) {
              console.log('[doubao] 输入框内容为空，等待更长时间...');
              await new Promise(r => setTimeout(r, 5000));
            }
          } else {
            console.log('[doubao] 未找到输入框');
          }
          
          console.log('[doubao] 文件处理完成');
          console.log('[doubao] ================================');
        } catch (error) {
          console.error('[doubao] ❌ 附件上传过程中发生错误:', error);
        }
      }
      
      // 🔍 查找输入框（改进版：支持 Kimi/豆包/DeepSeek 多平台）
      const currentUrl = window.location.href;
      const isKimi = currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('kimi.com') || currentUrl.includes('moonshot.cn');
      console.log('[doubao] 平台检测:', isKimi ? '✅ Kimi（需要特殊处理）' : '⚪ 其他平台');

      const possibleSelectors = [
        '[class*="chat-input-editor"]',   // 🎯 Kimi 专属，优先匹配
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="输入"]',
        'textarea[class*="input"]',
        'textarea[class*="editor"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'textarea',
        'input[type="text"]'
      ];
      
      let inputElement = null;
      let usedSelector = null;
      for (let i = 0; i < possibleSelectors.length; i++) {
        const selector = possibleSelectors[i];
        inputElement = document.querySelector(selector);
        if (inputElement) {
          usedSelector = selector;
          console.log('[doubao] ✅ 找到输入框:', selector, '标签:', inputElement.tagName);
          break;
        }
      }
      
      if (!inputElement) {
        return { success: false, error: '未找到输入框' };
      }
      
      // 使用 React 兼容的方式设置值（改进版：支持 Kimi）
      if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        ).set;
        nativeTextAreaValueSetter.call(inputElement, message);

        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
        inputElement.dispatchEvent(new Event('focus', { bubbles: true }));

        if (inputElement._valueTracker) {
          inputElement._valueTracker.setValue(message);
        }
      } else {
        // 🔴 Kimi 和其他使用 contenteditable 的平台
        // 使用 DataTransfer + paste 事件方式（不依赖 Clipboard API，最可靠！）
        console.log('[doubao] 🎯 contenteditable 输入框（Kimi），使用 DataTransfer + paste 方式注入...');

        // 先清空输入框
        inputElement.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        await new Promise(r => setTimeout(r, 200));

        // 🎯 方式 A: 使用 DataTransfer 构造 paste 事件（最可靠！不依赖 Clipboard API）
        try {
          console.log('[doubao] 📋 方式 A: 使用 DataTransfer + ClipboardEvent paste...');
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', message);
          console.log('[doubao] ✅ DataTransfer 已创建，数据已设置');

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer
          });
          inputElement.dispatchEvent(pasteEvent);
          console.log('[doubao] ✅ paste 事件已触发（带 DataTransfer）');

          await new Promise(r => setTimeout(r, 500));

          // 检查是否成功
          const currentText = inputElement.textContent || inputElement.innerText;
          if (currentText && currentText.trim().length > 0) {
            console.log('[doubao] ✅ DataTransfer paste 方式成功！当前内容:', currentText.substring(0, 50));
          } else {
            console.log('[doubao] ⚠️ DataTransfer paste 可能未生效，尝试其他方式...');
          }
        } catch(e) {
          console.log('[doubao] ⚠️ DataTransfer paste 失败:', e.message);
        }

        // 🎯 方式 B: execCommand insertText
        const currentText2 = inputElement.textContent || inputElement.innerText;
        if (!currentText2 || currentText2.trim().length === 0) {
          console.log('[doubao] 📋 方式 B: 使用 execCommand insertText...');
          try {
            inputElement.focus();
            document.execCommand('insertText', false, message);
            console.log('[doubao] ✅ execCommand insertText 完成');
          } catch(e2) {
            console.log('[doubao] ⚠️ execCommand 失败');
          }
        }

        // 🎯 方式 C: 逐字符输入（最终兜底，模拟真实键盘输入）
        const currentText3 = inputElement.textContent || inputElement.innerText;
        if (!currentText3 || currentText3.trim().length === 0) {
          console.log('[doubao] 📋 方式 C: 逐字符输入（最终兜底）...');
          inputElement.focus();
          for (let charIdx = 0; charIdx < message.length; charIdx++) {
            const char = message[charIdx];
            const keyCode = char.charCodeAt(0);

            inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));
            inputElement.dispatchEvent(new KeyboardEvent('keypress', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));

            // 插入文本节点
            const textNode = document.createTextNode(char);
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(textNode);
              range.setStartAfter(textNode);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              inputElement.appendChild(textNode);
            }

            inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));

            if (charIdx % 10 === 0) await new Promise(r => setTimeout(r, 10));
          }
          console.log('[doubao] ✅ 逐字符输入完成');
        }

        // 触发事件链确保 React 状态更新
        inputElement.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: message }));
        inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[doubao] ✅ contenteditable 注入完成');
      }

      console.log('[doubao] ✅ 设置值完成，当前值:', inputElement.value || inputElement.textContent);
      
      // 等待 React 更新
      console.log('[doubao] 等待 React 状态更新...');
      await new Promise(r => setTimeout(r, 3000));
      
      // 再次触发 input 事件
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
      
      // 尝试按 Enter 键
      inputElement.focus();
      const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const keypressEvent = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const keyupEvent = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      
      inputElement.dispatchEvent(keydownEvent);
      inputElement.dispatchEvent(keypressEvent);
      inputElement.dispatchEvent(keyupEvent);
      console.log('[doubao] 已发送 Enter 键');
      
      // 等待 Enter 事件生效
      await new Promise(r => setTimeout(r, 2000));
      
      // 触发 input 事件确保消息被识别
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[doubao] 已触发 input/change 事件确保消息识别');
      
      // 再等待一下
      await new Promise(r => setTimeout(r, attachmentData ? 3000 : 1000));
      
      // 尝试点击发送按钮（支持 Kimi/豆包/DeepSeek 多平台）
      const buttonSelectors = [
        // 🎯 Kimi 专属选择器
        '[class*="chat-input"] button',
        '[class*="chat-input"] [class*="send"]',
        '[class*="input-area"] button',
        'button[aria-label*="发送"]',
        'button[aria-label*="send"]',
        'button[class*="send-button"]',
        'button[class*="sendIcon"]',
        'button[class*="send-icon"]',
        'button[class*="sendBtn"]',
        'button[class*="arrow-up"]',
        'button[class*="arrowUp"]',
        'button[class*="up-arrow"]',
        '[class*="send-button"]',
        '[class*="send-btn"]',
        'button[type="submit"]',
        'button[title*="发送"]',
        'button:has(svg)',
        'button[class*="send"]',
        'button[class*="submit"]',
        'button:last-of-type'
      ];
      
      let sendButton = null;
      for (const selector of buttonSelectors) {
        try {
          sendButton = document.querySelector(selector);
          if (sendButton && sendButton.offsetParent !== null && !sendButton.disabled) {
            console.log('[doubao] 找到发送按钮:', selector);
            break;
          }
          sendButton = null;
        } catch (e) { continue; }
      }
      
      if (!sendButton) {
        const inputRect = inputElement.getBoundingClientRect();
        const allButtons = Array.from(document.querySelectorAll('button'));
        sendButton = allButtons.find(btn => {
          const rect = btn.getBoundingClientRect();
          return !btn.disabled &&
                 rect.left > inputRect.right - 50 && rect.left < inputRect.right + 150 &&
                 Math.abs(rect.top - inputRect.top) < 80 && rect.width > 20 && rect.width < 80;
        });
        if (sendButton) console.log('[doubao] 通过位置找到发送按钮');
      }
      
      let messageSent = false;
      
      if (sendButton) {
        console.log('[doubao] 找到发送按钮，准备点击...');
        
        // 先聚焦到输入框
        inputElement.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // 多种点击方式尝试
        const clickAttempts = [
          () => { sendButton.click(); },
          () => { sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); },
          () => { sendButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); }
        ];
        
        for (let attempt = 0; attempt < clickAttempts.length; attempt++) {
          try {
            clickAttempts[attempt]();
            console.log('[doubao] 点击尝试', attempt + 1);
            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            console.error('[doubao] 点击尝试失败:', e);
          }
        }
        
        console.log('[doubao] ✅ 已尝试多次点击发送按钮');
        messageSent = true;
      } else {
        console.log('[doubao] 未找到发送按钮，将按 Enter 键发送');
        
        // 聚焦输入框
        inputElement.focus();
        await new Promise(r => setTimeout(r, 300));
        
        // 尝试按 Enter 键
        for (let attempt = 0; attempt < 3; attempt++) {
          const keydownEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keydownEvent);
          
          const keypressEvent = new KeyboardEvent('keypress', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keypressEvent);
          
          const keyupEvent = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(keyupEvent);
          
          console.log('[doubao] Enter 尝试', attempt + 1);
          await new Promise(r => setTimeout(r, 300));
        }
        
        console.log('[doubao] ✅ 已多次尝试按 Enter 键发送');
        messageSent = true;
      }
      
      return { success: true, method: sendButton ? 'button' : 'enter', platform: 'doubao' };
    })();
  `;
  
  try {
    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 豆包自动发送结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] 豆包自动发送失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 文心一言专用：获取AI回复 ==========
async function wenXinCaptureAIResponse(webview, timeout = 30000) {
  console.log('[wenXinCapture] 📥 开始抓取 文心一言 AI 回复（寻找最终答案）...');
  
  try {
    // 🚀 文心一言专属：找带有反馈按钮的消息（最终答案）！
    const fullContent = await webview.executeJavaScript(`
      (function() {
        console.log('[wenXinCaptureJS] 🚀 开始获取文心一言完整回复数据...');
        
        // 反馈按钮选择器（复制、重新生成、点赞、分享等）
        const feedbackButtonSelectors = [
          '[class*="copy"]', '[class*="regenerate"]', '[class*="retry"]', 
          '[class*="share"]', '[class*="like"]', '[class*="thumbs"]',
          '[aria-label*="复制"]', '[aria-label*="重新生成"]', 
          '[aria-label*="分享"]', '[aria-label*="点赞"]',
          'button:has(svg[class*="copy"])', 'button:has(svg[class*="refresh"])',
          'button:has(svg[class*="share"])', 'button:has(svg[class*="thumb"])'
        ];
        
        // 1. 先找消息容器
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
        let usedContainerSelector = '';
        
        for (const listSel of messageListSelectors) {
          try {
            const container = document.querySelector(listSel);
            if (container) {
              messageContainer = container;
              usedContainerSelector = listSel;
              console.log('[wenXinCaptureJS] ✅ 找到消息容器:', listSel);
              break;
            }
          } catch(e) {}
        }
        
        // 2. 如果找到消息容器，收集所有AI消息，并找带有反馈按钮的！
        if (messageContainer) {
          const allMessages = messageContainer.querySelectorAll('[class*="message"], [class*="item"], [class*="bubble"], [class*="chat-item"], [class*="dialog"], [class*="response"], [class*="assistant"], [class*="markdown"], .markdown-body');
          
          console.log('[wenXinCaptureJS] 📋 找到消息数量:', allMessages.length);
          
          // 先收集所有消息
          const allCandidates = [];
          
          for (let i = allMessages.length - 1; i >= 0; i--) {
            try {
              const el = allMessages[i];
              const text = el.innerText || el.textContent;
              
              if (text && text.trim().length > 100) {
                // 检查这个元素附近是否有反馈按钮
                let hasFeedbackButtons = false;
                const parent = el.parentElement;
                const nextSib = el.nextElementSibling;
                const prevSib = el.previousElementSibling;
                
                for (const btnSel of feedbackButtonSelectors) {
                  try {
                    if (el.querySelector(btnSel) || 
                        (parent && parent.querySelector(btnSel)) || 
                        (nextSib && nextSib.querySelector(btnSel)) || 
                        (prevSib && prevSib.querySelector(btnSel))) {
                      hasFeedbackButtons = true;
                      break;
                    }
                  } catch(e) {}
                }
                
                allCandidates.push({
                  index: i,
                  element: el,
                  text: text.trim(),
                  length: text.trim().length,
                  hasButtons: hasFeedbackButtons
                });
                
                console.log('[wenXinCaptureJS] 消息[' + i + ']: 长度=' + text.trim().length + ', 有反馈按钮=' + hasFeedbackButtons);
              }
            } catch(e) {}
          }
          
          console.log('[wenXinCaptureJS] 有效候选消息数:', allCandidates.length);
          
          // 策略1：优先找有反馈按钮的消息（最终答案！）
          const withButtons = allCandidates.filter(c => c.hasButtons);
          if (withButtons.length > 0) {
            console.log('[wenXinCaptureJS] ✅ 找到 ' + withButtons.length + ' 个带反馈按钮的消息！');
            console.log('[wenXinCaptureJS] 内容预览:', withButtons[0].text.substring(0, 200));
            
            return {
              success: true,
              content: withButtons[0].text,
              from: 'with-feedback-buttons',
              index: withButtons[0].index,
              selector: usedContainerSelector
            };
          }
          
          // 策略2：如果没有带反馈按钮的，就找最长的那个
          if (allCandidates.length > 0) {
            allCandidates.sort((a, b) => b.length - a.length);
            console.log('[wenXinCaptureJS] ⚠️ 没找到带反馈按钮的，返回最长的消息，长度:', allCandidates[0].length);
            console.log('[wenXinCaptureJS] 内容预览:', allCandidates[0].text.substring(0, 200));
            
            return {
              success: true,
              content: allCandidates[0].text,
              from: 'longest-message',
              index: allCandidates[0].index,
              selector: usedContainerSelector
            };
          }
        }
        
        // 3. 如果消息容器策略没找到，用备用选择器找
        console.log('[wenXinCaptureJS] 没找到消息容器，用备用策略...');
        
        // 尝试找有反馈按钮的元素的父级
        for (const btnSel of feedbackButtonSelectors) {
          try {
            const btn = document.querySelector(btnSel);
            if (btn) {
              let el = btn.parentElement;
              for (let level = 0; level < 5 && el; level++) {
                const text = el.innerText || el.textContent;
                if (text && text.trim().length > 100) {
                  console.log('[wenXinCaptureJS] ✅ 从反馈按钮向上找到内容，长度:', text.length);
                  console.log('[wenXinCaptureJS] 内容预览:', text.substring(0, 200));
                  
                  return {
                    success: true,
                    content: text.trim(),
                    from: 'feedback-button-parent',
                    selector: btnSel
                  };
                }
                el = el.parentElement;
              }
            }
          } catch(e) {}
        }
        
        // 4. 最后一招：返回所有可见的长文本合并
        console.log('[wenXinCaptureJS] ⚠️ 最后策略：返回body文本');
        return {
          success: true,
          content: document.body.innerText || '',
          from: 'body-text',
          selector: 'body'
        };
      })();
    `);
    
    if (fullContent && fullContent.success && fullContent.content) {
      console.log('[wenXinCapture] ✅ 成功获取内容！');
      console.log('[wenXinCapture] 内容来源:', fullContent.from);
      console.log('[wenXinCapture] 使用选择器:', fullContent.selector);
      console.log('[wenXinCapture] 内容长度:', fullContent.content.length);
      console.log('[wenXinCapture] 完整内容预览:', fullContent.content.substring(0, 300) + '...');
      
      const now = new Date().toISOString();
      
      const capturedResponse = {
        content: fullContent.content,
        timestamp: now,
        questionSentTime: null,
        responseStartTime: now,
        responseCompleteTime: now,
        responseDuration: 0,
        totalDuration: 0,
        status: 'wenxin_instant_capture',
        elapsed: 0,
        isInstantMode: true,
        hasPreRecordedTime: false
      };
      
      // 不在 wenXinCaptureAIResponse 内部调用 displayCapturedResponse
      // displayCapturedResponse(capturedResponse);
      showStatus(`✅ 已捕获 文心一言 AI 回复（${fullContent.content.length} 字符，来源：${fullContent.from}）`, 'success');
      return capturedResponse;
    }
  } catch (e) {
    console.log('[wenXinCapture] ❌ 抓取失败:', e);
  }
  
  // 如果专属代码失败，调用通用函数作为 fallback
  console.log('[wenXinCapture] ⚠️ 专属代码失败，调用通用 captureAIResponse()');
  return await captureAIResponse(webview, timeout);
}

// ========== 豆包专用：获取AI回复 ==========
async function doubaoCaptureAIResponse(webview, timeout = 30000) {
  console.log('[doubaoCapture] 📥 开始抓取 豆包 AI 回复...');
  
  try {
    const fullContent = await webview.executeJavaScript(`
      (function() {
        console.log('[doubaoCaptureJS] 🚀 开始获取豆包完整回复数据...');
        
        // 豆包的反馈按钮选择器（复制、重新生成等）
        const feedbackButtonSelectors = [
          '[class*="copy"]', '[class*="regenerate"]', '[class*="retry"]',
          '[class*="share"]', '[class*="like"]', '[class*="thumbs"]',
          '[aria-label*="复制"]', '[aria-label*="重新生成"]',
          '[aria-label*="分享"]', '[aria-label*="点赞"]',
          'button:has(svg[class*="copy"])', 'button:has(svg[class*="refresh"])',
          'button:has(svg[class*="share"])', 'button:has(svg[class*="thumb"])'
        ];
        
        // 豆包的消息容器选择器
        const messageListSelectors = [
          '[class*="message-list"]',
          '[class*="chat-messages"]',
          '[class*="messages-container"]',
          '[class*="conversation"]',
          '[role="log"]',
          '[class*="chat-wrapper"]',
          '[class*="chat-content"]',
          '[class*="message-list-container"]'
        ];
        
        let messageContainer = null;
        let usedContainerSelector = '';
        
        for (const listSel of messageListSelectors) {
          try {
            const container = document.querySelector(listSel);
            if (container) {
              messageContainer = container;
              usedContainerSelector = listSel;
              console.log('[doubaoCaptureJS] ✅ 找到消息容器:', listSel);
              break;
            }
          } catch(e) {}
        }
        
        if (messageContainer) {
          const allMessages = messageContainer.querySelectorAll('[class*="message"], [class*="item"], [class*="bubble"], [class*="chat-item"], [class*="dialog"], [class*="response"], [class*="assistant"], [class*="markdown"], .markdown-body');
          
          console.log('[doubaoCaptureJS] 📋 找到消息数量:', allMessages.length);
          
          const allCandidates = [];
          
          for (let i = allMessages.length - 1; i >= 0; i--) {
            try {
              const el = allMessages[i];
              const text = el.innerText || el.textContent;
              
              if (text && text.trim().length > 100) {
                // 检查这个元素附近是否有反馈按钮
                let hasFeedbackButtons = false;
                const parent = el.parentElement;
                const nextSib = el.nextElementSibling;
                const prevSib = el.previousElementSibling;
                
                for (const btnSel of feedbackButtonSelectors) {
                  try {
                    if (el.querySelector(btnSel) || 
                        (parent && parent.querySelector(btnSel)) || 
                        (nextSib && nextSib.querySelector(btnSel)) || 
                        (prevSib && prevSib.querySelector(btnSel))) {
                      hasFeedbackButtons = true;
                      break;
                    }
                  } catch(e) {}
                }
                
                allCandidates.push({
                  index: i,
                  element: el,
                  text: text.trim(),
                  length: text.trim().length,
                  hasButtons: hasFeedbackButtons
                });
                
                console.log('[doubaoCaptureJS] 消息[' + i + ']: 长度=' + text.trim().length + ', 有反馈按钮=' + hasFeedbackButtons);
              }
            } catch(e) {}
          }
          
          console.log('[doubaoCaptureJS] 有效候选消息数:', allCandidates.length);
          
          // 策略1：优先找有反馈按钮的消息（最终答案！）
          const withButtons = allCandidates.filter(c => c.hasButtons);
          if (withButtons.length > 0) {
            console.log('[doubaoCaptureJS] ✅ 找到 ' + withButtons.length + ' 个带反馈按钮的消息！');
            console.log('[doubaoCaptureJS] 内容预览:', withButtons[0].text.substring(0, 200));
            
            return {
              success: true,
              content: withButtons[0].text,
              from: 'with-feedback-buttons',
              index: withButtons[0].index,
              selector: usedContainerSelector
            };
          }
          
          // 策略2：如果没有带反馈按钮的，就找最长的那个
          if (allCandidates.length > 0) {
            allCandidates.sort((a, b) => b.length - a.length);
            console.log('[doubaoCaptureJS] ⚠️ 没找到带反馈按钮的，返回最长的消息，长度:', allCandidates[0].length);
            console.log('[doubaoCaptureJS] 内容预览:', allCandidates[0].text.substring(0, 200));
            
            return {
              success: true,
              content: allCandidates[0].text,
              from: 'longest-message',
              index: allCandidates[0].index,
              selector: usedContainerSelector
            };
          }
        }
        
        // 策略3：尝试找有反馈按钮的元素的父级
        console.log('[doubaoCaptureJS] 没找到消息容器，用备用策略...');
        for (const btnSel of feedbackButtonSelectors) {
          try {
            const btn = document.querySelector(btnSel);
            if (btn) {
              let el = btn.parentElement;
              for (let level = 0; level < 5 && el; level++) {
                const text = el.innerText || el.textContent;
                if (text && text.trim().length > 100) {
                  console.log('[doubaoCaptureJS] ✅ 从反馈按钮向上找到内容，长度:', text.length);
                  console.log('[doubaoCaptureJS] 内容预览:', text.substring(0, 200));
                  
                  return {
                    success: true,
                    content: text.trim(),
                    from: 'feedback-button-parent',
                    selector: btnSel
                  };
                }
                el = el.parentElement;
              }
            }
          } catch(e) {}
        }
        
        // 最后策略：返回body文本
        console.log('[doubaoCaptureJS] ⚠️ 最后策略：返回body文本');
        return {
          success: true,
          content: document.body.innerText || '',
          from: 'body-text',
          selector: 'body'
        };
      })();
    `);
    
    if (fullContent && fullContent.success && fullContent.content) {
      console.log('[doubaoCapture] ✅ 成功获取内容！');
      console.log('[doubaoCapture] 内容来源:', fullContent.from);
      console.log('[doubaoCapture] 使用选择器:', fullContent.selector);
      console.log('[doubaoCapture] 内容长度:', fullContent.content.length);
      console.log('[doubaoCapture] 完整内容预览:', fullContent.content.substring(0, 300) + '...');
      
      const now = new Date().toISOString();
      
      const capturedResponse = {
        content: fullContent.content,
        timestamp: now,
        questionSentTime: null,
        responseStartTime: now,
        responseCompleteTime: now,
        responseDuration: 0,
        totalDuration: 0,
        status: 'doubao_instant_capture',
        elapsed: 0,
        isInstantMode: true,
        hasPreRecordedTime: false
      };
      
      // 不在 doubaoCaptureAIResponse 内部调用 displayCapturedResponse
      // displayCapturedResponse(capturedResponse);
      showStatus(`✅ 已捕获 豆包 AI 回复（${fullContent.content.length} 字符，来源：${fullContent.from}）`, 'success');
      return capturedResponse;
    }
  } catch (e) {
    console.log('[doubaoCapture] ❌ 抓取失败:', e);
  }
  
  // 如果专属代码失败，调用通用函数作为 fallback
  console.log('[doubaoCapture] ⚠️ 专属代码失败，调用通用 captureAIResponse()');
  return await captureAIResponse(webview, timeout);
}

// ========== 讯飞星火专用发送函数 ==========
async function xfyunAutoSend(webview, message, attachment = null) {
  console.log('[xfyun] ================================');
  console.log('[xfyun] 🚀 开始讯飞星火专用发送流程');
  console.log('[xfyun] 消息内容:', message.substring(0, 50) + (message.length > 50 ? '...' : ''));
  console.log('[xfyun] ================================');

  const script = `
    (async function() {
      const message = ${JSON.stringify(message)};
      console.log('[xfyun] 🔍 查找讯飞星火输入框...');

      // 讯飞星火使用 textarea 或 contenteditable div 作为输入框
      // 🔑 关键：讯飞星火用 textarea，不是 contenteditable！选择器按优先级排序
      const selectors = [
        // 🔥🔥🔥 最优先：textarea（讯飞星火实际使用的是 textarea）
        'textarea',
        'textarea[placeholder]',
        'textarea[class*="input"]',
        'textarea[class*="editor"]',
        // 其次：contenteditable div（部分页面可能用）
        'div[contenteditable="true"][placeholder]',
        'div[contenteditable="true"]',
        '[class*="editor"]',
        '[class*="input-area"] [contenteditable="true"]',
        '[role="textbox"]'
      ];

      let inputElement = null;
      for (const sel of selectors) {
        inputElement = document.querySelector(sel);
        if (inputElement) {
          const rect = inputElement.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            console.log('[xfyun] ✅ 找到输入框:', sel, inputElement.tagName,
              (inputElement.className || '').substring(0, 40));
            break;
          }
          inputElement = null;
        }
      }

      if (!inputElement) {
        console.error('[xfyun] ❌ 未找到输入框！');
        return { success: false, error: '未找到输入框', platform: 'xfyun' };
      }

      // 步骤1：滚动到可见区域 + 聚焦
      console.log('[xfyun] 📍 步骤1: 聚焦输入框...');
      inputElement.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(r => setTimeout(r, 300));

      // 点击激活（触发平台 UI）
      inputElement.click();
      await new Promise(r => setTimeout(r, 200));

      // focus
      inputElement.focus();
      await new Promise(r => setTimeout(r, 300));

      // 验证焦点
      const active = document.activeElement;
      console.log('[xfyun] 焦点状态:', active === inputElement ? '✅ 正确' : '⚠️ 不在输入框', active?.tagName);

      // 步骤2：注入消息（根据输入框类型选择不同策略）
      console.log('[xfyun] 📝 步骤2: 注入消息...');
      const isTextarea = inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT';
      console.log('[xfyun] 输入框类型:', isTextarea ? 'textarea/input' : 'contenteditable');

      try {
        if (isTextarea) {
          // ========== textarea / INPUT 处理（React 兼容版）==========
          console.log('[xfyun] 使用 React 兼容的 textarea 注入方式...');

          // 获取原生 setter（绕过 React 的控制）
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;

          // 步骤A：聚焦 + 清空
          inputElement.focus();
          await new Promise(r => setTimeout(r, 200));

          if (nativeSetter) {
            nativeSetter.call(inputElement, '');
          } else {
            inputElement.value = '';
          }
          // 清空后立即触发事件通知 React
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[xfyun] 已清空 textarea');
          await new Promise(r => setTimeout(r, 300));

          // 步骤B：注入消息（核心！）
          inputElement.focus();

          if (nativeSetter) {
            nativeSetter.call(inputElement, message);
          } else {
            inputElement.value = message;
          }

          // 🔥🔥🔥 关键：触发完整的事件链让 React 检测到值变化
          // React 16+ 监听 InputEvent 的 inputType 属性
          const reactEvents = [
            new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: message }),
            new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: message }),
            new Event('input', { bubbles: true }),
            new Event('change', { bubbles: true })
          ];

          for (const evt of reactEvents) {
            inputElement.dispatchEvent(evt);
          }

          // 额外：模拟键盘输入事件（某些 React 版本监听这些）
          inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: message[0] || 'a', bubbles: true }));
          inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: message[0] || 'a', bubbles: true }));

          await new Promise(r => setTimeout(r, 500));

          // 验证注入结果（DOM 层面）
          const currentVal = inputElement.value;
          console.log('[xfyun] ✅ textarea DOM 值:', currentVal ? currentVal.substring(0, 50) : '(空)');

          if (!currentVal || currentVal.trim().length === 0) {
            console.warn('[xfyun] ⚠️ setter 方式未生效，尝试 execCommand...');
            inputElement.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, message);
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          }

        } else {
          // ========== contenteditable div 处理 ==========
          console.log('[xfyun] 使用 contenteditable 注入方式（DataTransfer paste）...');

          // 先清空现有内容（用 range 方式，安全不破坏 Quill/Delta 状态）
          try {
            const sel = window.getSelection();
            if (sel && inputElement.childNodes.length > 0) {
              const range = document.createRange();
              range.selectNodeContents(inputElement);
              sel.removeAllRanges();
              sel.addRange(range);
              range.deleteContents();
              console.log('[xfyun] 已清空 contenteditable 输入框');
            }
          } catch (clearErr) {
            console.warn('[xfyun] 清空时出错（非致命）:', clearErr.message);
          }

          await new Promise(r => setTimeout(r, 200));

          // 使用 DataTransfer 粘贴方式注入文本
          const dt = new DataTransfer();
          dt.setData('text/plain', message);
          const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });

          // 再次确保焦点在输入框上
          inputElement.focus();

          inputElement.dispatchEvent(pasteEvent);
          await new Promise(r => setTimeout(r, 500));

          // 验证注入结果
          const currentText = inputElement.textContent || inputElement.innerText;
          if (currentText && currentText.trim().length > 0) {
            console.log('[xfyun] ✅ contenteditable 消息注入成功！当前内容:', currentText.substring(0, 50));
          } else {
            console.warn('[xfyun] ⚠️ DataTransfer paste 可能未生效，尝试 execCommand...');
            inputElement.focus();
            document.execCommand('insertText', false, message);
            await new Promise(r => setTimeout(r, 300));
          }
        }

      } catch (injectErr) {
        console.error('[xfyun] ❌ 消息注入失败:', injectErr.message);
        return { success: false, error: '消息注入失败: ' + injectErr.message, platform: 'xfyun' };
      }

      // 触发事件链确保 React/Vue 状态更新
      inputElement.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: message }));
      inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));

      // 等待框架处理
      console.log('[xfyun] ⏳ 等待框架处理...');
      await new Promise(r => setTimeout(r, 1500));

      // 步骤3：查找并点击发送按钮
      console.log('[xfyun] 🚀 步骤3: 查找发送按钮...');

      // 排除非发送按钮的函数
      function isNonSendButton(btn) {
        if (!btn) return false;
        const text = (btn.textContent || btn.innerText || '').trim();
        const title = (btn.title || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
        const combined = (text + ' ' + title + ' ' + ariaLabel).toLowerCase();

        const excludeKeywords = [
          '工具', 'tool', '搜索', 'search', '联网', '网络',
          '写作', 'write', '编程', 'code', '解题', 'solve',
          '深度思考', 'deepthink', '附件', 'attach', '上传', 'upload',
          '@', 'plus', '+', '添加', 'add', '更多', 'more',
          '设置', 'setting', '选项', 'option', '菜单', 'menu',
          '自动模式', 'auto', '麦克风', 'microphone', 'mic',
          '语音', 'voice', '录音', 'record'
        ];

        for (const kw of excludeKeywords) {
          if (combined.includes(kw)) return true;
        }

        if (btn.getAttribute('aria-haspopup') === 'true' ||
            btn.getAttribute('aria-expanded') !== null) {
          return true;
        }

        return false;
      }

      // 🔥🔥🔥 讯飞星火专用：直接用位置策略找最右侧的按钮（最可靠！）
      // 从截图看布局：[自动模式 >] ............ [+] [🎤] [↑发送]
      // ↑发送按钮永远在最右边
      let sendButton = null;

      // 策略1：位置查找（最优先，对讯飞星火最可靠）
      const inputRect = inputElement.getBoundingClientRect();
      const allButtons = Array.from(document.querySelectorAll('button'));

      // 收集所有候选按钮并记录详细信息
      const candidateButtons = allButtons
        .filter(btn => {
          try {
            if (btn.disabled) return false;
            if (isNonSendButton(btn)) return false;
            const rect = btn.getBoundingClientRect();
            // 必须可见且有合理尺寸
            if (rect.width < 10 || rect.width > 100) return false;
            if (rect.height < 10 || rect.height > 100) return false;
            // 必须在输入框附近（垂直方向）
            if (Math.abs(rect.top - inputRect.top) > 120) return false;
            // 必须在输入框右侧或内部
            if (rect.left < inputRect.left - 50) return false;
            return true;
          } catch (e) { return false; }
        })
        .map(btn => ({
          btn,
          rect: btn.getBoundingClientRect(),
          text: (btn.textContent || '').trim().substring(0, 15),
          html: btn.outerHTML.substring(0, 80)
        }));

      // 按 left 坐标从大到小排序（最右边的排第一）
      candidateButtons.sort((a, b) => b.rect.left - a.rect.left);

      console.log('[xfyun] 找到 ' + candidateButtons.length + ' 个候选按钮:');
      candidateButtons.forEach(function(c, i) {
        console.log('[xfyun]   [' + i + '] left=' + c.rect.left.toFixed(0) + ' top=' + c.rect.top.toFixed(0) + ' ' +
          c.rect.width.toFixed(0) + 'x' + c.rect.height.toFixed(0) + ' text="' + c.text + '" html="' + c.html + '"');
      });

      if (candidateButtons.length > 0) {
        // 取最右侧的按钮作为发送按钮
        sendButton = candidateButtons[0].btn;
        console.log('[xfyun] ✅ 选择最右侧按钮作为发送按钮:',
          candidateButtons[0].text, JSON.stringify(candidateButtons[0].rect));
      }

      // 策略2：如果位置查找失败，用选择器查找（备用）
      if (!sendButton) {
        console.log('[xfyun] ⚠️ 位置查找未找到按钮，尝试选择器...');
        const sendSelectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="send"]',
          'button[title*="发送"]',
          'button[class*="send"]',
          'button[class*="submit"]',
          'button:has(svg)',
          'button:last-of-type'
        ];

        for (const selector of sendSelectors) {
          try {
            const candidates = document.querySelectorAll(selector);
            for (const candidate of candidates) {
              if (candidate.offsetParent !== null &&
                  !candidate.disabled &&
                  !isNonSendButton(candidate)) {
                sendButton = candidate;
                console.log('[xfyun] 通过选择器找到:', selector,
                  '文本:', (candidate.textContent||'').trim().substring(0,20),
                  '位置:', JSON.stringify(candidate.getBoundingClientRect()));
                break;
              }
            }
            if (sendButton) break;
          } catch (e) { continue; }
        }
      }

      // 步骤4：执行发送（🔥 策略：textarea 优先用 Enter，contenteditable 优先用按钮）
      let messageSent = false;
      let sendMethod = 'unknown';

      if (isTextarea) {
        // ========== textarea：优先用 Enter 键发送（最可靠）==========
        console.log('[xfyun] 🚀 [textarea 模式] 优先使用 Enter 键发送...');
        inputElement.focus();
        await new Promise(r => setTimeout(r, 300));

        const enterEvents = [
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
          new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
          new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
        ];

        for (const evt of enterEvents) {
          inputElement.dispatchEvent(evt);
        }
        messageSent = true;
        sendMethod = 'enter-textarea';
        console.log('[xfyun] ✅ 已按 Enter 键发送（textarea 模式）');

        // 短暂等待 Enter 生效，如果没生效再尝试按钮（从2s降到500ms）
        await new Promise(r => setTimeout(r, 500));

        // 检查消息是否还在输入框（说明 Enter 没有发送成功）
        const valAfterEnter = inputElement.value || '';
        if (valAfterEnter.trim().length > 0 && sendButton) {
          console.log('[xfyun] ⚠️ Enter 未发送成功（消息仍在），尝试点击发送按钮...');
          sendButton.scrollIntoView({ behavior: 'instant', block: 'center' });
          await new Promise(r => setTimeout(r, 200));
          sendButton.click();
          await new Promise(r => setTimeout(r, 300));
          sendButton.click();
          sendMethod = 'button-fallback';
          console.log('[xfyun] ✅ 已点击发送按钮（备用）');
        }

      } else {
        // ========== contenteditable：优先用按钮点击 ==========
        if (sendButton) {
          console.log('[xfyun] 🎯 点击发送按钮...');
          sendButton.scrollIntoView({ behavior: 'instant', block: 'center' });
          await new Promise(r => setTimeout(r, 200));
          sendButton.click();
          await new Promise(r => setTimeout(r, 500));
          sendButton.click();  // 双击保障
          messageSent = true;
          sendMethod = 'button';
          console.log('[xfyun] ✅ 已点击发送按钮');
        } else {
          console.log('[xfyun] ⚠️ 未找到发送按钮，尝试 Enter 键发送...');
          inputElement.focus();
          await new Promise(r => setTimeout(r, 200));

          const enterEvents = [
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
            new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
            new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
          ];

          for (const evt of enterEvents) {
            inputElement.dispatchEvent(evt);
          }
          messageSent = true;
          sendMethod = 'enter-contenteditable';
          console.log('[xfyun] ✅ 已按 Enter 键发送');
        }
      }

      // 🔍 最终诊断日志
      console.log('[xfyun] ================================');
      console.log('[xfyun] 📊 发送完成！汇总信息:');
      console.log('[xfyun]   - 输入框类型:', isTextarea ? 'TEXTAREA' : 'contenteditable');
      console.log('[xfyun]   - 发送方式:', sendMethod);
      console.log('[xfyun]   - 发送结果:', messageSent ? '✅ 成功' : '❌ 失败');
      var finalContent = isTextarea ? (inputElement.value || '') : (inputElement.textContent || inputElement.innerText || '');
      console.log('[xfyun]   - 输入框剩余内容:', finalContent ? finalContent.substring(0, 50) : '(空)');
      console.log('[xfyun] ================================');

      // 安全清空（延迟1秒，异步不影响返回）
      if (messageSent) {
        setTimeout(() => {
          try {
            const content = inputElement.textContent || inputElement.innerText || '';
            if (content && content.trim().length > 0) {
              inputElement.focus();
              const sel = window.getSelection();
              if (sel) {
                const range = document.createRange();
                range.selectNodeContents(inputElement);
                sel.removeAllRanges();
                sel.addRange(range);
                range.deleteContents();
              }
              inputElement.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('[xfyun] 🧹 已清空输入框');
            }
          } catch (e) {}
        }, 1000);
      }

      return { success: true, method: sendButton ? 'button' : 'enter', platform: 'xfyun' };
    })();
  `;

  try {
    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 讯飞星火自动发送结果:', result);
    return result;
  } catch (err) {
    console.error('[Renderer] ❌ 讯飞星火发送脚本执行失败:', err.message);
    return { success: false, error: err.message, platform: 'xfyun' };
  }
}

// ========== 其他AI平台通用函数 ==========
async function generalAutoSend(webview, message, attachment = null) {
  const attachmentData = attachment ? JSON.stringify(attachment) : 'null';
  
  const script = `
    (async function() {
      const message = ${JSON.stringify(message)};
      const attachmentData = ${attachmentData};
      
      // 如果有附件，先处理文件上传
      if (attachmentData) {
        try {
          console.log('[general] ================================');
          console.log('[general] 检测到附件，开始处理上传...');
          console.log('[general] 附件信息:', attachmentData.name, attachmentData.size, 'bytes');
          console.log('[general] ================================');
          
          const inputElement = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
          if (inputElement) {
            const className = typeof inputElement.className === 'string' ? inputElement.className : (inputElement.className?.baseVal || '');
            console.log('[general] 找到输入框:', inputElement.tagName, className.substring(0, 50));
            
            // 将 Base64 数据转换为 File 对象
            console.log('[general] 正在转换附件数据...');
            const base64Data = attachmentData.data.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const file = new File([byteArray], attachmentData.name, { type: attachmentData.type });
            console.log('[general] ✅ 文件对象已创建:', file.name, file.size, 'bytes');
            
            // 先聚焦到输入框
            inputElement.focus();
            await new Promise(r => setTimeout(r, 800));
            
            let uploadSuccess = false;
            
            // 方法1: 尝试使用 navigator.clipboard API 写入文件
            if (navigator.clipboard && navigator.clipboard.write && !uploadSuccess) {
              console.log('[general] 尝试使用 Clipboard API 写入文件...');
              try {
                const clipboardItem = new ClipboardItem({
                  [file.type]: file
                });
                await navigator.clipboard.write([clipboardItem]);
                console.log('[general] ✅ 文件已写入剪贴板');
                
                await new Promise(r => setTimeout(r, 500));
                
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true
                });
                inputElement.dispatchEvent(pasteEvent);
                console.log('[general] ✅ 已触发 paste 事件');
                
                uploadSuccess = true;
                await new Promise(r => setTimeout(r, 3000));
              } catch (e) {
                console.log('[general] Clipboard API 写入失败:', e);
              }
            }
            
            // 方法2: 使用 DataTransfer + 自定义事件
            if (!uploadSuccess) {
              console.log('[general] 尝试 DataTransfer 方案...');
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              console.log('[general] DataTransfer 已创建，文件数量:', dataTransfer.items.length);
              
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true
              });
              Object.defineProperty(pasteEvent, 'clipboardData', {
                value: dataTransfer,
                writable: false
              });
              console.log('[general] ✅ 粘贴事件已创建');
              
              inputElement.dispatchEvent(pasteEvent);
              console.log('[general] ✅ 已触发 paste 事件');
              
              uploadSuccess = true;
            }
            
            // 对于 contenteditable div，还需要触发 input 事件
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[general] ✅ 已触发 input 和 change 事件');
            
            // 等待处理文件
            console.log('[general] 等待处理附件...');
            await new Promise(r => setTimeout(r, 8000));
            
            // 检查输入框状态
            const content = inputElement.tagName === 'TEXTAREA' ? inputElement.value : inputElement.textContent;
            console.log('[general] 输入框当前内容:', content?.substring(0, 100));
            
            // 检查是否有文件预览元素出现
            const filePreviews = document.querySelectorAll('[class*="file"], [class*="upload"], [class*="image"]');
            console.log('[general] 找到的文件预览元素数量:', filePreviews.length);
            
            if (!content || content.trim().length === 0) {
              console.log('[general] 输入框内容为空，等待更长时间...');
              await new Promise(r => setTimeout(r, 5000));
            }
          } else {
            console.log('[general] 未找到输入框');
          }
          
          console.log('[general] 文件处理完成');
          console.log('[general] ================================');
        } catch (error) {
          console.error('[general] ❌ 附件上传过程中发生错误:', error);
        }
      }
      
      // 🔍 查找输入框（改进版：支持 Kimi/DeepSeek/豆包 多平台，带重试逻辑）
      const currentUrl = window.location.href;
      const isKimi = currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('kimi.com') || currentUrl.includes('moonshot.cn');
      console.log('[general] 平台检测:', isKimi ? '✅ Kimi（需要特殊处理）' : '⚪ 其他平台');
      console.log('[general] 当前URL:', currentUrl);

      const possibleSelectors = [
        '[class*="chat-input-editor"]',   // 🎯 Kimi 专属，优先匹配
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="输入"]',
        'textarea[class*="input"]',
        'textarea[class*="editor"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'textarea',
        'input[type="text"]'
      ];
      
      // 🔄 重试逻辑：Kimi 等 SPA 可能需要更长时间渲染输入框
      let inputElement = null;
      let foundSelector = null;
      const maxRetries = isKimi ? 10 : 3;
      const retryDelay = 1000;
      
      for (let retry = 0; retry < maxRetries; retry++) {
        for (const selector of possibleSelectors) {
          inputElement = document.querySelector(selector);
          if (inputElement) {
            console.log('[general] ✅ 找到输入框:', selector, '(重试', retry, '次)');
            foundSelector = selector;
            break;
          }
        }
        if (inputElement) break;
        
        console.log('[general] ⏳ 未找到输入框，等待', retryDelay, 'ms后重试... (', retry + 1, '/', maxRetries, ')');
        await new Promise(r => setTimeout(r, retryDelay));
      }
      
      if (!inputElement) {
        return { success: false, error: '未找到输入框' };
      }
      
      // 使用 React 兼容的方式设置值（改进版：支持 Kimi contenteditable）
      if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 
          'value'
        ).set;
        nativeTextAreaValueSetter.call(inputElement, message);
        
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
        inputElement.dispatchEvent(new Event('focus', { bubbles: true }));
        
        if (inputElement._valueTracker) {
          inputElement._valueTracker.setValue(message);
        }
      } else {
        // 🔴 Kimi 和其他使用 contenteditable 的平台
        // 使用 DataTransfer + paste 事件方式（不依赖 Clipboard API，最可靠！）
        console.log('[general] 🎯 contenteditable 输入框（Kimi），使用 DataTransfer + paste 方式注入...');

        // 先清空输入框
        inputElement.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        await new Promise(r => setTimeout(r, 200));

        // 🎯 方式 A: 使用 DataTransfer 构造 paste 事件（最可靠！不依赖 Clipboard API）
        try {
          console.log('[general] 📋 方式 A: 使用 DataTransfer + ClipboardEvent paste...');
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', message);
          console.log('[general] ✅ DataTransfer 已创建，数据已设置');

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer
          });
          inputElement.dispatchEvent(pasteEvent);
          console.log('[general] ✅ paste 事件已触发（带 DataTransfer）');

          await new Promise(r => setTimeout(r, 500));

          // 检查是否成功
          const currentText = inputElement.textContent || inputElement.innerText;
          if (currentText && currentText.trim().length > 0) {
            console.log('[general] ✅ DataTransfer paste 方式成功！当前内容:', currentText.substring(0, 50));
          } else {
            console.log('[general] ⚠️ DataTransfer paste 可能未生效，尝试其他方式...');
          }
        } catch(e) {
          console.log('[general] ⚠️ DataTransfer paste 失败:', e.message);
        }

        // 🎯 方式 B: execCommand insertText
        const currentText2 = inputElement.textContent || inputElement.innerText;
        if (!currentText2 || currentText2.trim().length === 0) {
          console.log('[general] 📋 方式 B: 使用 execCommand insertText...');
          try {
            inputElement.focus();
            document.execCommand('insertText', false, message);
            console.log('[general] ✅ execCommand insertText 完成');
          } catch(e2) {
            console.log('[general] ⚠️ execCommand 失败');
          }
        }

        // 🎯 方式 C: 逐字符输入（最终兜底，模拟真实键盘输入）
        const currentText3 = inputElement.textContent || inputElement.innerText;
        if (!currentText3 || currentText3.trim().length === 0) {
          console.log('[general] 📋 方式 C: 逐字符输入（最终兜底）...');
          inputElement.focus();
          for (let charIdx = 0; charIdx < message.length; charIdx++) {
            const char = message[charIdx];
            const keyCode = char.charCodeAt(0);

            inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));
            inputElement.dispatchEvent(new KeyboardEvent('keypress', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));

            // 插入文本节点
            const textNode = document.createTextNode(char);
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(textNode);
              range.setStartAfter(textNode);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              inputElement.appendChild(textNode);
            }

            inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: char, keyCode: keyCode, bubbles: true, cancelable: true }));

            if (charIdx % 10 === 0) await new Promise(r => setTimeout(r, 10));
          }
          console.log('[general] ✅ 逐字符输入完成');
        }

        // 触发事件链确保 React 状态更新
        inputElement.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: message }));
        inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[general] ✅ contenteditable 注入完成');
      }
      
      console.log('[general] 设置值完成，当前值:', inputElement.value || inputElement.textContent);
      
      // 等待 React 更新
      console.log('[general] 等待 React 状态更新...');
      await new Promise(r => setTimeout(r, 3000));
      
      // 再次触发 input 事件
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
      
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[general] 已触发 input/change 事件确保消息识别');
      
      await new Promise(r => setTimeout(r, attachmentData ? 3000 : 1000));
      
      // 尝试点击发送按钮（支持 Kimi/DeepSeek/豆包/元宝 多平台）
      // 🔴🔴🔴 关键修复：排除非发送按钮（工具菜单、@联网搜索等），防止点到错误按钮！

      // 排除函数：识别已知的非发送按钮
      function isNonSendButton(btn) {
        if (!btn) return false;
        const text = (btn.textContent || btn.innerText || '').trim();
        const title = (btn.title || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
        const combined = (text + ' ' + title + ' ' + ariaLabel).toLowerCase();

        // 🚫 明确排除的非发送按钮关键词
        const excludeKeywords = [
          '工具', 'tool', '搜索', 'search', '联网', '网络',
          '写作', 'write', '编程', 'code', '解题', 'solve',
          '深度思考', 'deepthink', '附件', 'attach', '上传', 'upload',
          '@', 'plus', '+', '添加', 'add', '更多', 'more',
          '设置', 'setting', '选项', 'option', '菜单', 'menu'
        ];

        for (const kw of excludeKeywords) {
          if (combined.includes(kw)) {
            return true;
          }
        }

        // 🚫 检查是否是下拉菜单按钮（通过样式或属性判断）
        // 下拉菜单按钮通常有特定的 class 或 aria-haspopup 属性
        if (btn.getAttribute('aria-haspopup') === 'true' ||
            btn.getAttribute('aria-expanded') !== null ||
            (btn.className && typeof btn.className === 'string' &&
             (btn.className.includes('dropdown') || btn.className.includes('popup') ||
              btn.className.includes('menu') || btn.className.includes('tool')))) {
          return true;
        }

        return false;
      }

      const buttonSelectors = [
        // 🔥🔥🔥 最优先：精确匹配发送按钮（按优先级排序）
        'button[aria-label*="发送"]',
        'button[aria-label*="send"]',
        'button[title*="发送"]',
        'button[class*="send-button"]',
        'button[class*="sendBtn"]',
        'button[class*="submit-btn"]',
        '[class*="send-button"]',
        '[class*="send-btn"]',

        // 🎯 Kimi 专属选择器
        '[class*="chat-input"] [class*="send"]',
        '[class*="input-area"] [class*="send"]',

        // 箭头图标按钮（发送按钮通常是向上箭头）
        'button[class*="arrow-up"]',
        'button[class*="arrowUp"]',
        'button[class*="up-arrow"]',
        'button[type="submit"]',

        // ⚠️ 最后才尝试通用选择器（需要配合 isNonSendButton 过滤）
        '[class*="chat-input"] button',
        'button[class*="send"]',
        'button[class*="submit"]',
        'button:has(svg)',
        'button:last-of-type'
      ];

      let sendButton = null;
      for (const selector of buttonSelectors) {
        try {
          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (candidate.offsetParent !== null &&
                !candidate.disabled &&
                !isNonSendButton(candidate)) {
              sendButton = candidate;
              console.log('[general] 找到发送按钮:', selector, '文本:', (candidate.textContent||'').trim().substring(0,20));
              break;
            }
          }
          if (sendButton) break;
        } catch (e) { continue; }
      }

      // 🔧 位置辅助查找（作为最后手段，也要过滤非发送按钮）
      if (!sendButton) {
        const inputRect = inputElement.getBoundingClientRect();
        const allButtons = Array.from(document.querySelectorAll('button'));

        // 按距离输入框右侧从近到远排序（发送按钮通常在最右边）
        const sortedButtons = allButtons
          .filter(btn => !btn.disabled && !isNonSendButton(btn))
          .map(btn => ({ btn, rect: btn.getBoundingClientRect() }))
          .filter(({ rect }) =>
            rect.width > 10 && rect.width < 100 &&
            Math.abs(rect.top - inputRect.top) < 100 &&
            rect.left > inputRect.left  // 在输入框右侧或内部
          )
          .sort((a, b) => b.rect.left - a.rect.left);  // 从右到左排序

        if (sortedButtons.length > 0) {
          // 取最右边的按钮（最可能是发送按钮）
          sendButton = sortedButtons[0].btn;
          console.log('[general] 通过位置找到发送按钮（最右侧）:', (sendButton.textContent||'').trim().substring(0,20));
        }
      }
      
      let messageSent = false;
      
      if (sendButton) {
        sendButton.click();
        console.log('[general] ✅ 已点击发送按钮');
        messageSent = true;
      } else {
        console.log('[general] 未找到发送按钮，将按 Enter 键发送');
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        inputElement.dispatchEvent(enterEvent);
        
        const enterUpEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        inputElement.dispatchEvent(enterUpEvent);
        
        console.log('[general] ✅ 已按 Enter 键发送');
        messageSent = true;
      }

      // 🔧 清空输入框（延迟更久，且使用安全方式）
      if (messageSent) {
        setTimeout(() => {
          try {
            // 检查内容是否还在（平台可能已经自动清空了）
            const currentContent = inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT'
              ? inputElement.value
              : (inputElement.textContent || inputElement.innerText || '');

            if (currentContent && currentContent.trim().length > 0) {
              // 内容还在，需要清空
              if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
                // 原生输入框：用 setter 清空
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                )?.set || Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                )?.set;
                if (nativeSetter) {
                  nativeSetter.call(inputElement, '');
                } else {
                  inputElement.value = '';
                }
              } else {
                // contenteditable / Quill：用 range 方式安全清空
                inputElement.focus();
                try {
                  const sel = window.getSelection();
                  if (sel) {
                    const range = document.createRange();
                    range.selectNodeContents(inputElement);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    range.deleteContents();
                  } else {
                    inputElement.textContent = '';
                  }
                } catch (e) {
                  inputElement.textContent = '';
                }
              }

              inputElement.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('[general] 🧹 已安全清空输入框');
            } else {
              console.log('[general] 🧹 输入框已被平台自动清空，无需操作');
            }
          } catch (clearErr) {
            console.log('[general] 🧹 清空输入框时出错（非致命）:', clearErr.message);
          }
        }, 3000);  // 🔑 延迟3秒，确保平台已处理完发送
      }
      
      return { success: true, method: sendButton ? 'button' : 'enter', platform: 'general' };
    })();
  `;
  
  try {
    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 通用AI自动发送结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] 通用AI自动发送失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== Kimi 专用发送函数（使用 sendInputEvent 模拟真实键盘输入） ==========
async function kimiAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] 🎯 Kimi 专用发送函数（sendInputEvent 方式）');
  console.log('[Renderer]   - 消息:', message);
  console.log('[Renderer]   - 附件:', attachment ? (attachment.name || '有附件') : '无附件');

  // Step 1: 使用 executeJavaScript 聚焦 Kimi 输入框
  try {
    const focusResult = await webview.executeJavaScript(`
      (function() {
        // Kimi 专属选择器
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
          if (input) {
            foundSelector = sel;
            break;
          }
        }
        
        if (!input) {
          return { success: false, error: '未找到输入框', tried: selectors };
        }
        
        // 聚焦输入框
        input.focus();
        
        // 清空已有内容
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        
        return { success: true, selector: foundSelector, tagName: input.tagName };
      })();
    `);
    
    console.log('[Renderer] Kimi 输入框聚焦结果:', focusResult);
    
    if (!focusResult.success) {
      console.error('[Renderer] ❌ 未找到 Kimi 输入框:', focusResult);
      return focusResult;
    }
  } catch (e) {
    console.error('[Renderer] ❌ 聚焦 Kimi 输入框失败:', e);
    return { success: false, error: e.message };
  }

  // ========== 📎 Step 1.5: 如果有附件，先粘贴图片到 Kimi ==========
  let attachUploadResult = null;
  if (attachment && attachment.data) {
    console.log('[Renderer] 📎📎📎 检测到附件！开始粘贴上传...');
    console.log('[Renderer]   - 附件名称:', attachment.name || 'unnamed');
    console.log('[Renderer]   - 附件类型:', attachment.type || 'unknown');

    try {
      attachUploadResult = await window.electronAPI.invoke('paste-image-to-webview', {
        url: 'kimi.com',
        imageData: attachment.data,
        imageName: attachment.name || 'image.png',
        imageType: attachment.type || 'image/png'
      });
      console.log('[Renderer] 📎 paste-image-to-webview 结果:', JSON.stringify(attachUploadResult));

      // 等待 Kimi 处理粘贴的附件
      await new Promise(r => setTimeout(r, 1500));
    } catch (attachErr) {
      console.error('[Renderer] 📎❌ 附件粘贴失败:', attachErr.message);
      attachUploadResult = { success: false, error: attachErr.message };
    }
  } else {
    console.log('[Renderer] ℹ️ 无附件数据，跳过附件步骤');
  }

  // Step 2: 等待一下确保聚焦完成（和附件处理都完成）
  await new Promise(r => setTimeout(r, 300));

  // 🔧🔧🔧 增强型修复：在输入消息前，再次清空输入框以消除可能的 "vV" 字符泄漏 🔧🔧🔧
  try {
    const cleanupResult = await webview.executeJavaScript(`
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
    `);
    console.log('[Renderer] 🔧 输入框清理结果:', JSON.stringify(cleanupResult));

    if (cleanupResult.textBeforeCleanup && cleanupResult.textBeforeCleanup.trim()) {
      console.warn('[Renderer] ⚠️ 发现残留文本并被清理:', JSON.stringify(cleanupResult.textBeforeCleanup));
    }
  } catch (cleanupErr) {
    console.error('[Renderer] ❌ 输入框清理失败（非致命）:', cleanupErr.message);
  }

  await new Promise(r => setTimeout(r, 200));  // 等待清理完成

  // Step 3: 使用 sendInputEvent 通过主进程逐字符输入
  try {
    console.log('[Renderer] ⌨️ 调用主进程 sendInputEvent 输入消息...');
    const typeResult = await window.electronAPI.invoke('type-message-in-webview', {
      url: 'kimi.com',
      message: message
    });
    console.log('[Renderer] sendInputEvent 结果:', typeResult);
    
    if (!typeResult.success) {
      console.error('[Renderer] ❌ sendInputEvent 失败:', typeResult);
      return typeResult;
    }
  } catch (e) {
    console.error('[Renderer] ❌ 调用 type-message-in-webview 失败:', e);
    return { success: false, error: e.message };
  }

  // Step 4: 等待 React 处理输入
  // 🔧 增强型：如果有附件，等待更长时间让 Kimi 处理附件
  const waitTime = attachUploadResult && attachUploadResult.success ? 1500 : 500;
  console.log(`[Renderer] ⏳ 等待 React 处理${attachUploadResult && attachUploadResult.success ? '（含附件处理）' : ''}... (${waitTime}ms)`);
  await new Promise(r => setTimeout(r, waitTime));

  // 🔧🔧🔧 在按 Enter 前，再次确保焦点在输入框 🔧🔧🔧
  try {
    const preEnterFocus = await webview.executeJavaScript(`
      (function() {
        const input = document.querySelector('[class*="chat-input-editor"]') || document.querySelector('div[contenteditable="true"]');
        if (input) {
          input.focus();
          return { focused: true };
        }
        return { focused: false, error: '未找到输入框' };
      })()
    `);
    console.log('[Renderer] 🔐 按 Enter 前聚焦结果:', JSON.stringify(preEnterFocus));
  } catch (preFocusErr) {
    console.error('[Renderer] ❌ 按 Enter 前聚焦失败:', preFocusErr.message);
  }

  await new Promise(r => setTimeout(r, 200));  // 等待聚焦生效

  // Step 5: 使用 sendInputEvent 按 Enter 键发送（和输入一样用操作系统级别的真实事件）
  try {
    console.log('[Renderer] ↩️ 调用主进程 sendInputEvent 按 Enter 发送...');
    const enterResult = await window.electronAPI.invoke('press-enter-in-webview', {
      url: 'kimi.com'
    });
    console.log('[Renderer] sendInputEvent Enter 结果:', enterResult);
    
    if (enterResult && enterResult.success) {
      console.log('[Renderer] ✅ 消息发送成功！');
    } else {
      console.warn('[Renderer] ⚠️ 消息可能未发送成功，返回结果:', JSON.stringify(enterResult));
    }
    
    return enterResult;
  } catch (e) {
    console.error('[Renderer] ❌ sendInputEvent Enter 失败:', e);
    // 兜底：尝试 JavaScript 方式点击发送按钮
    try {
      const fallbackResult = await webview.executeJavaScript(`
        (function() {
          const buttonSelectors = [
            '[class*="chat-input"] button',
            '[class*="input-area"] button',
            'button[aria-label*="发送"]',
            'button[class*="send"]'
          ];
          
          for (const sel of buttonSelectors) {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
              if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                btn.click();
                return { success: true, method: 'button-fallback' };
              }
            }
          }
          return { success: false, error: '未找到发送按钮' };
        })();
      `);
      console.log('[Renderer] 兜底发送结果:', fallbackResult);
      return fallbackResult;
    } catch (e2) {
      console.error('[Renderer] ❌ 兜底也失败:', e2);
      return { success: false, error: e2.message };
    }
  }
}

// ========== 新增：千问专用发送函数 ==========
async function qwenAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] 🎯 千问专用发送函数');
  console.log('[Renderer]   - 消息:', message);
  console.log('[Renderer]   - 附件:', attachment ? (attachment.name || '有附件') : '无附件');

  let attachUploadResult = null;
  if (attachment && attachment.data) {
    console.log('[Renderer] 📎📎📎 检测到附件！开始粘贴上传...');
    try {
      attachUploadResult = await window.electronAPI.invoke('paste-image-to-webview', {
        url: 'qianwen.aliyun.com',
        imageData: attachment.data,
        imageName: attachment.name || 'image.png',
        imageType: attachment.type || 'image/png'
      });
      console.log('[Renderer] 📎 paste-image-to-webview 结果:', JSON.stringify(attachUploadResult));
      await new Promise(r => setTimeout(r, 1500));
    } catch (attachErr) {
      console.error('[Renderer] 📎❌ 附件粘贴失败:', attachErr.message);
      attachUploadResult = { success: false, error: attachErr.message };
    }
  } else {
    console.log('[Renderer] ℹ️ 无附件数据，跳过附件步骤');
  }

  await new Promise(r => setTimeout(r, 300));

  try {
    const script = `
      (async function() {
        const message = ${JSON.stringify(message)};
        
        let inputElement = null;
        const selectors = [
          'textarea[placeholder*="向千问提问"]',
          'textarea[placeholder*="提问"]',
          'textarea[placeholder*="消息"]',
          'textarea[placeholder*="输入"]',
          'textarea',
          'div[contenteditable="true"]',
          '[role="textbox"]'
        ];
        
        for (const sel of selectors) {
          inputElement = document.querySelector(sel);
          if (inputElement) break;
        }
        
        if (!inputElement) {
          return { success: false, error: '未找到输入框' };
        }
        
        inputElement.focus();
        await new Promise(r => setTimeout(r, 200));
        
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeSetter.call(inputElement, message);
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          inputElement.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await new Promise(r => setTimeout(r, 200));
          
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', message);
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer
          });
          inputElement.dispatchEvent(pasteEvent);
          await new Promise(r => setTimeout(r, 500));
          
          inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        await new Promise(r => setTimeout(r, 1000));
        
        let sendButton = null;
        const buttonSelectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="send"]',
          'button[class*="send"]',
          '[class*="chat-input"] button',
          'button[type="submit"]'
        ];
        
        for (const sel of buttonSelectors) {
          const btns = document.querySelectorAll(sel);
          for (const btn of btns) {
            if (btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.disabled) {
              sendButton = btn;
              break;
            }
          }
          if (sendButton) break;
        }
        
        if (sendButton) {
          sendButton.click();
        } else {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(enterEvent);
        }
        
        setTimeout(() => {
          try {
            const currentContent = inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT'
              ? inputElement.value
              : (inputElement.textContent || inputElement.innerText || '');
            if (currentContent && currentContent.trim().length > 0) {
              if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                )?.set || Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                )?.set;
                if (nativeSetter) {
                  nativeSetter.call(inputElement, '');
                } else {
                  inputElement.value = '';
                }
              } else {
                inputElement.focus();
                const sel = window.getSelection();
                if (sel) {
                  const range = document.createRange();
                  range.selectNodeContents(inputElement);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  range.deleteContents();
                } else {
                  inputElement.textContent = '';
                }
              }
              inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch (clearErr) {
            console.log('[qwen] 🧹 清空输入框时出错（非致命）:', clearErr.message);
          }
        }, 2000);
        
        return { success: true, method: sendButton ? 'button' : 'enter' };
      })()
    `;

    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 千问发送结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] ❌ 千问发送失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 新增：网易云音乐专用发送函数 ==========
async function neteaseMusicAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] 🎵 网易云音乐专用发送函数');
  console.log('[Renderer]   - 搜索内容:', message);

  try {
    const script = `
      (async function() {
        const searchText = ${JSON.stringify(message)};
        
        const inputElement = document.querySelector('#srch');
        if (!inputElement) {
          return { success: false, error: '未找到搜索框 #srch' };
        }
        
        inputElement.focus();
        await new Promise(r => setTimeout(r, 200));
        
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(inputElement, searchText);
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        
        await new Promise(r => setTimeout(r, 500));
        
        let searchButton = null;
        const buttonSelectors = [
          'button.srchbtn',
          'a.srchbtn',
          '.srchbtn',
          '#srchbtn',
          'button[class*="search"]',
          'a[class*="search"]',
          '[class*="search-btn"]'
        ];
        
        for (const sel of buttonSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
            searchButton = btn;
            break;
          }
        }
        
        if (searchButton) {
          searchButton.click();
          return { success: true, method: 'button' };
        } else {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(enterEvent);
          return { success: true, method: 'enter' };
        }
      })()
    `;

    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] 网易云音乐搜索结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] ❌ 网易云音乐搜索失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 新增：QQ音乐专用发送函数 ==========
async function qqMusicAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] 🎵 QQ音乐专用发送函数');
  console.log('[Renderer]   - 搜索内容:', message);

  try {
    const script = `
      (async function() {
        const searchText = ${JSON.stringify(message)};
        
        let inputElement = null;
        const inputSelectors = [
          'input.search_input__input',
          'input.earch_input__input',
          'input[placeholder*="搜索音乐"]',
          'input[placeholder*="搜索"]',
          '.search_input input',
          '.search-input input'
        ];
        
        for (const sel of inputSelectors) {
          inputElement = document.querySelector(sel);
          if (inputElement) break;
        }
        
        if (!inputElement) {
          return { success: false, error: '未找到搜索框' };
        }
        
        inputElement.focus();
        await new Promise(r => setTimeout(r, 200));
        
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(inputElement, searchText);
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        
        await new Promise(r => setTimeout(r, 500));
        
        let searchButton = null;
        const buttonSelectors = [
          'button.search_input__btn',
          'button.earch_input__btn',
          'button[class*="search"]',
          '.search_input button',
          '.search-btn'
        ];
        
        for (const sel of buttonSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.disabled) {
            searchButton = btn;
            break;
          }
        }
        
        if (searchButton) {
          searchButton.click();
          return { success: true, method: 'button' };
        } else {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true
          });
          inputElement.dispatchEvent(enterEvent);
          return { success: true, method: 'enter' };
        }
      })()
    `;

    const result = await webview.executeJavaScript(script);
    console.log('[Renderer] QQ音乐搜索结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] ❌ QQ音乐搜索失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 新增：桌面APP专用发送函数 ==========
async function desktopAppAutoSend(appName, message, options = {}) {
  console.log('[Renderer] 🖥️ 桌面APP专用发送函数');
  console.log('[Renderer]   - APP名称:', appName);
  console.log('[Renderer]   - 消息内容:', message.substring(0, 50) + '...');
  console.log('[Renderer]   - 复制按钮比例:', options.copyXRatio, options.copyYRatio);
  console.log('[Renderer]   - Markdown项比例:', options.mdXRatio, options.mdYRatio);
  console.log('[Renderer]   - 输入焦点比例:', options.inputFocusXRatio, options.inputFocusYRatio);

  try {
    const result = await window.electronAPI.desktopAppSendMessage({
      appName: appName,
      message: message,
      method: options.method || 'clipboard',
      activateDelay: options.activateDelay || 500,
      waitAnswerDelay: options.waitAnswerDelay || 15000,
      copyXRatio: options.copyXRatio,
      copyYRatio: options.copyYRatio,
      mdXRatio: options.mdXRatio,
      mdYRatio: options.mdYRatio,
      inputFocusXRatio: options.inputFocusXRatio,
      inputFocusYRatio: options.inputFocusYRatio,
      winWidth: options.winWidth || 950,
      winHeight: options.winHeight || 920,
      winX: options.winX || 0,
      winY: options.winY || 0
    });

    console.log('[Renderer] 桌面APP发送结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] ❌ 桌面APP发送失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 新增：只上传附件到输入框（不发送） ==========
async function uploadAttachmentToInput(webview, attachment) {
  console.log('[Renderer] 📎 [uploadAttachmentToInput] 开始上传附件到输入框...');
  console.log('[Renderer] 📎 附件信息:', attachment.name, '(' + attachment.size + ' bytes)');

  const currentUrl = webview.getURL ? webview.getURL() : '';
  const isKimi = currentUrl.includes('kimi.com') || currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('moonshot.cn');
  const isDoubao = currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn');
  const isWenXin = currentUrl.includes('yiyan.baidu.com') || currentUrl.includes('yiyian.baidu.com');

  const attachmentData = JSON.stringify(attachment);

  const uploadScript = `
    (async function() {
      const attachmentData = ${attachmentData};
      
      try {
        console.log('[uploadAttachment] ================================');
        console.log('[uploadAttachment] 开始处理附件上传到输入框...');
        console.log('[uploadAttachment] 附件:', attachmentData.name, attachmentData.size, 'bytes');
        
        const inputElement = document.querySelector('textarea') 
          || document.querySelector('div[contenteditable="true"]')
          || document.querySelector('[class*="chat-input-editor"]');
        
        if (!inputElement) {
          return { success: false, error: '未找到输入框' };
        }

        // 🔥🔥🔥 关键修复：强制聚焦输入框（解决焦点不在输入区导致附件无法粘贴的问题）
        console.log('[uploadAttachment] 🎯 开始强制聚焦输入框...');

        // 步骤1：滚动到输入框可见区域
        inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 300));

        // 步骤2：点击输入框（模拟用户点击）
        inputElement.click();
        await new Promise(r => setTimeout(r, 200));

        // 步骤3：调用 focus() 方法
        inputElement.focus();
        console.log('[uploadAttachment] ✅ 已执行 click() + focus()');

        // 步骤4：验证焦点是否真的在输入框上
        let activeElement = document.activeElement;
        console.log('[uploadAttachment] 当前焦点元素:', activeElement ? activeElement.tagName : 'null');
        console.log('[uploadAttachment] 是否是输入框:', activeElement === inputElement);

        // 如果焦点不在输入框上，再次尝试
        if (activeElement !== inputElement) {
          console.log('[uploadAttachment] ⚠️ 焦点未在输入框上，再次尝试...');
          inputElement.focus();
          await new Promise(r => setTimeout(r, 300));
          activeElement = document.activeElement;
          console.log('[uploadAttachment] 第二次尝试后焦点元素:', activeElement ? activeElement.tagName : 'null');
        }

        console.log('[uploadAttachment] ✅✅✅ 输入框聚焦完成');

        // 额外等待确保焦点稳定
        await new Promise(r => setTimeout(r, 500));
        
        // 将 Base64 数据转换为 File 对象
        const base64Data = attachmentData.data.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const file = new File([byteArray], attachmentData.name, { type: attachmentData.type });
        
        console.log('[uploadAttachment] ✅ 文件对象已创建:', file.name, file.size, 'bytes');
        
        let uploadSuccess = false;
        
        // 方法1: 使用 Clipboard API (适用于 Kimi 等平台)
        if ((navigator.clipboard && navigator.clipboard.write) || ${isKimi}) {
          try {
            console.log('[uploadAttachment] 尝试 Clipboard API / 剪贴板粘贴方式...');

            // 对于 Kimi：使用主进程的 clipboard API 写入图片到系统剪贴板
            if (${isKimi}) {
              console.log('[uploadAttachment] 🎯 Kimi 平台：使用 Electron 主进程写入剪贴板...');

              // 调用主进程 API 将图片写入系统剪贴板
              const clipboardResult = await window.electronAPI.writeImageToClipboard(attachmentData.data, attachmentData.name);
              console.log('[uploadAttachment] 📋 主进程剪贴板写入结果:', clipboardResult);

              if (clipboardResult && clipboardResult.success) {
                // 等待剪贴板数据就绪
                await new Promise(r => setTimeout(r, 500));

                // 触发 Ctrl+V 粘贴事件（从系统剪贴板读取图片）
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true
                });
                inputElement.dispatchEvent(pasteEvent);

                uploadSuccess = true;
                console.log('[uploadAttachment] ✅ Kimi: 已通过系统剪贴板粘贴图片');
              } else {
                console.error('[uploadAttachment] ❌ Kimi: 剪贴板写入失败:', clipboardResult?.error);
              }
            } else {
              // 其他平台：使用 Clipboard API
              const clipboardItem = new ClipboardItem({
                [file.type]: file
              });
              await navigator.clipboard.write([clipboardItem]);
              console.log('[uploadAttachment] ✅ 文件已写入浏览器剪贴板');
              
              await new Promise(r => setTimeout(r, 300));
              
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true
              });
              inputElement.dispatchEvent(pasteEvent);
              
              uploadSuccess = true;
              console.log('[uploadAttachment] ✅ 已触发 paste 事件');
            }
            
            await new Promise(r => setTimeout(r, 2000));
          } catch (e) {
            console.log('[uploadAttachment] Clipboard API 失败:', e.message);
          }
        }
        
        // 方法2: DataTransfer + paste 事件（通用方案）
        if (!uploadSuccess) {
          try {
            console.log('[uploadAttachment] 尝试 DataTransfer 方案...');
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true
            });
            Object.defineProperty(pasteEvent, 'clipboardData', {
              value: dataTransfer,
              writable: false
            });
            
            inputElement.dispatchEvent(pasteEvent);
            uploadSuccess = true;
            console.log('[uploadAttachment] ✅ DataTransfer paste 成功');
          } catch (e) {
            console.error('[uploadAttachment] DataTransfer 方案失败:', e);
          }
        }
        
        // 触发输入事件确保状态更新
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 等待附件处理完成
        console.log('[uploadAttachment] ⏳ 等待附件处理完成...');
        await new Promise(r => setTimeout(r, 2500));
        
        // 检查输入框状态
        const content = inputElement.tagName === 'TEXTAREA' 
          ? inputElement.value 
          : inputElement.textContent;
        console.log('[uploadAttachment] 输入框当前内容长度:', content?.length || 0);
        
        console.log('[uploadAttachment] ================================');
        return { 
          success: uploadSuccess, 
          method: uploadSuccess ? (${isKimi} ? 'kimi-clipboard' : 'clipboard-api/datatransfer') : 'failed',
          inputContentLength: content?.length || 0
        };
        
      } catch (error) {
        console.error('[uploadAttachment] ❌ 附件上传失败:', error);
        return { success: false, error: error.message };
      }
    })();
  `;

  try {
    const result = await webview.executeJavaScript(uploadScript);
    console.log('[Renderer] 📎 [uploadAttachmentToInput] 结果:', result);
    return result;
  } catch (e) {
    console.error('[Renderer] 📎 [uploadAttachmentToInput] 执行失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 智谱专用发送函数（使用 sendInputEvent 模拟真实键盘输入） ==========
async function zhipuAutoSend(webview, message, attachment = null) {
  console.log('[Renderer] 🎯 智谱专用发送函数（sendInputEvent 方式）');
  console.log('[Renderer]   - 消息:', message);

  // Step 1: 使用 OS 级别 focus（不依赖 executeJavaScript）
  console.log('[Renderer] 🎯 Step 1: 使用 webview.focus() 获得 OS 级别焦点...');
  webview.focus();
  await new Promise(r => setTimeout(r, 500));

  // Step 1.5: 聚焦 AI 输入框（和豆包一样，直接 focus + click）
  try {
    console.log('[Renderer] 🎯 Step 1.5: 聚焦 AI 输入框...');
    await webviewExec(webview, `
      (function() {
        const input = document.querySelector('textarea[placeholder*="有什么我能帮您的"]')
                   || document.querySelector('textarea[placeholder*="消息"]')
                   || document.querySelector('textarea[placeholder*="输入"]')
                   || document.querySelector('textarea');
        if (input) {
          input.focus();
          input.click();
          return { focused: true };
        }
        return { focused: false };
      })()
    `, 5000);
  } catch (e) {
    console.warn('[Renderer] ️ Step 1.5 聚焦异常:', e.message);
  }
  await new Promise(r => setTimeout(r, 300));

  // Step 2: 使用 sendInputEvent 通过主进程逐字符输入（完全绕过 executeJavaScript）
  try {
    console.log('[Renderer] ⌨️ Step 2: 调用主进程 sendInputEvent 输入消息...');
    const typeResult = await window.electronAPI.invoke('type-message-in-webview', {
      url: 'chat.z.ai',
      message: message
    });
    console.log('[Renderer] sendInputEvent 结果:', typeResult);
    if (!typeResult.success) return typeResult;
  } catch (e) {
    console.error('[Renderer] ❌ 调用 type-message-in-webview 失败:', e);
    return { success: false, error: e.message };
  }

  // Step 3: 等待 React 处理输入
  await new Promise(r => setTimeout(r, 500));

  // Step 4: 使用智谱专用 sendInputEvent 按 Enter 键发送（完全绕过 executeJavaScript）
  try {
    console.log('[Renderer] ️ Step 4: 调用智谱专用 press-enter-zhipu...');
    const enterResult = await window.electronAPI.invoke('press-enter-zhipu', {
      url: 'chat.z.ai'
    });
    console.log('[Renderer] press-enter-zhipu 结果:', enterResult);
    return enterResult;
  } catch (e) {
    console.error('[Renderer] ❌ press-enter-zhipu 失败:', e);
    return { success: false, error: e.message };
  }
}

// ========== 主函数：根据 URL 判断调用哪个函数 ==========
async function autoSendPresetMessage(webview, message, attachment = null) {
  // 获取当前URL
  const currentUrl = webview.getURL();

  // 判断是否是文心一言
  const isWenXin = currentUrl.includes('yiyan.baidu.com') || currentUrl.includes('yiyian.baidu.com');
  // 判断是否是豆包
  const isDoubao = currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn');
  // 🆕 判断是否是 Kimi
  const isKimi = currentUrl.includes('kimi.com') || currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('moonshot.cn');
  // 🆕 判断是否是讯飞星火
  const isXfyun = currentUrl.includes('xfyun.cn') || currentUrl.includes('xinghuo.xfyun');
  // 🆕 判断是否是千问
  const isQwen = currentUrl.includes('qianwen.aliyun.com') || currentUrl.includes('tongyi.aliyun.com') || currentUrl.includes('qwen.cn') || currentUrl.includes('www.qianwen.com');
  // 🆕 判断是否是智谱
  const isZhipu = currentUrl.includes('chat.z.ai') || currentUrl.includes('zhipuai.cn') || currentUrl.includes('chatglm.cn');
  // 🆕 判断是否是网易云音乐
  const isNeteaseMusic = currentUrl.includes('music.163.com');
  // 🆕 判断是否是QQ音乐
  const isQQMusic = currentUrl.includes('y.qq.com') || currentUrl.includes('qqmusic');

  if (isWenXin) {
    console.log('[Renderer] 检测到文心一言，调用文心一言专用函数');
    return await wenXinAutoSend(webview, message, attachment);
  } else if (isDoubao) {
    console.log('[Renderer] 检测到豆包，调用豆包专用函数');
    return await doubaoAutoSend(webview, message, attachment);
  } else if (isKimi) {
    console.log('[Renderer] 🎯 检测到 Kimi，调用 Kimi 专用函数（sendInputEvent）');
    return await kimiAutoSend(webview, message, attachment);
  } else if (isXfyun) {
    console.log('[Renderer] 🎯 检测到讯飞星火，调用讯飞星火专用函数');
    return await xfyunAutoSend(webview, message, attachment);
  } else if (isQwen) {
    console.log('[Renderer] 🎯 检测到千问，调用千问专用函数');
    return await qwenAutoSend(webview, message, attachment);
  } else if (isZhipu) {
    console.log('[Renderer] 🎯 检测到智谱，调用智谱专用函数（sendInputEvent）');
    return await zhipuAutoSend(webview, message, attachment);
  } else if (isNeteaseMusic) {
    console.log('[Renderer] 🎵 检测到网易云音乐，调用网易云音乐专用函数');
    return await neteaseMusicAutoSend(webview, message, attachment);
  } else if (isQQMusic) {
    console.log('[Renderer] 🎵 检测到QQ音乐，调用QQ音乐专用函数');
    return await qqMusicAutoSend(webview, message, attachment);
  } else {
    console.log('[Renderer] 检测到其他平台，调用通用函数');
    return await generalAutoSend(webview, message, attachment);
  }
}
// 将所有函数挂载到 window，供 HTML onclick 及其他模组访问
window.injectPersistentAITimeMonitor = injectPersistentAITimeMonitor;
window.wenXinAutoSend = wenXinAutoSend;
window.doubaoAutoSend = doubaoAutoSend;
window.wenXinCaptureAIResponse = wenXinCaptureAIResponse;
window.doubaoCaptureAIResponse = doubaoCaptureAIResponse;
window.xfyunAutoSend = xfyunAutoSend;
window.generalAutoSend = generalAutoSend;
window.kimiAutoSend = kimiAutoSend;
window.qwenAutoSend = qwenAutoSend;
window.zhipuAutoSend = zhipuAutoSend;
window.neteaseMusicAutoSend = neteaseMusicAutoSend;
window.qqMusicAutoSend = qqMusicAutoSend;
window.desktopAppAutoSend = desktopAppAutoSend;
window.uploadAttachmentToInput = uploadAttachmentToInput;
window.autoSendPresetMessage = autoSendPresetMessage;
