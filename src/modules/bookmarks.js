/**
 * 书签管理模组
 * 从 renderer.js 拆分而来
 * 依赖：showStatus, escapeHtml, addFloatHistoryEntry（来自 renderer.js / utils.js）
 * 被依赖：bookmarks, bookmarkHeadersMap, editingBookmarkId, collapsedStatesCache（全局变量，其他模组通过 window 访问）
 *
 * 注意：本文件只包含函数定义，不包含变量声明。
 * let bookmarks / bookmarkHeadersMap / editingBookmarkId / bookmarksVisible / collapsedStatesCache
 * 以及 const categoryLabels / DEFAULT_BOOKMARKS 均保留在 renderer.js 中，
 * 通过共享的全局词法环境供本文件的函数访问。
 */

// 保存网点到文件系统（通过 IPC）
async function saveBookmarksToStorage() {
  try {
    const result = await window.electronAPI.saveBookmarks(bookmarks);
    if (!result.success) {
      console.error('[Renderer] 保存网点失败:', result.error);
      showStatus('❌ 保存网点失败：' + result.error, 'error');
    }
  } catch (error) {
    console.error('[Renderer] 保存网点失败:', error);
    showStatus('❌ 保存网点失败：' + error.message, 'error');
  }
}

// 模糊搜索网点
function filterBookmarks(keyword) {
  const searchTerm = keyword.trim().toLowerCase();
  const cards = document.querySelectorAll('.bookmark-card');
  
  cards.forEach(card => {
    const cardName = card.querySelector('.bookmark-card-title')?.textContent || '';
    const cardUrl = card.querySelector('.bookmark-card-url')?.textContent || '';
    
    const matchName = cardName.toLowerCase().includes(searchTerm);
    const matchUrl = cardUrl.toLowerCase().includes(searchTerm);
    
    if (!searchTerm || matchName || matchUrl) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
  
  // 显示/隐藏空状态
  const visibleCards = document.querySelectorAll('.bookmark-card:not([style*="display: none"])');
  const emptyState = document.getElementById('emptyBookmarks');
  if (emptyState && visibleCards.length === 0) {
    emptyState.innerHTML = `
      <span style="font-size: 32px;">🔍</span>
      <p style="margin-top: 8px; color: #94a3b8;">未找到匹配的网点，试试其他关键词</p>
    `;
    emptyState.style.display = 'flex';
  } else if (emptyState) {
    emptyState.style.display = 'none';
  }
}

// 渲染网点卡片
function renderBookmarks() {
  const container = document.getElementById('bookmarksContainer');
  const emptyState = document.getElementById('emptyBookmarks');
  
  if (bookmarks.length === 0) {
    container.innerHTML = `
      <div class="empty-bookmarks" id="emptyBookmarks">
        <span style="font-size: 32px;">📌</span>
        <p style="margin-top: 8px; color: #94a3b8;">暂无常用网点，点击"添加网点"保存常用网址</p>
      </div>
    `;
    return;
  }

  let html = '';
  bookmarks.forEach(function(bookmark, index) {
    const categoryLabel = categoryLabels[bookmark.category] || categoryLabels.other;
    const truncatedUrl = bookmark.url.length > 50 ? bookmark.url.substring(0, 50) + '...' : bookmark.url;
    
    // 构建自定义 headers 对象并存储到全局映射
    const customHeaders = {};
    if (bookmark.referer) {
      customHeaders.Referer = bookmark.referer;
    }
    if (bookmark.userAgent) {
      customHeaders['User-Agent'] = bookmark.userAgent;
    }
    
    // 存储到全局映射（使用 URL 作为 key）
    const headersKey = `bookmark_${index}`;
    if (Object.keys(customHeaders).length > 0) {
      bookmarkHeadersMap[headersKey] = customHeaders;
    } else {
      delete bookmarkHeadersMap[headersKey];
    }
    const hasCustomHeaders = Object.keys(customHeaders).length > 0;
    
    // 显示自定义 headers 提示
    let headersHint = '';
    if (hasCustomHeaders) {
      headersHint = `<div style="margin-top: 4px; font-size: 10px; color: #667eea;">🔐 自定义请求头已设置</div>`;
    }
    
    // 显示只预览提示
    let previewHint = '';
    if (bookmark.previewOnly) {
      previewHint = `<div style="margin-top: 4px; font-size: 10px; color: #059669;">🌐 只预览网页</div>`;
    }
    
    // 显示预设消息输入框（含附件功能）
    // HTTP Get 分类也显示输入框（用于输入股票代号等参数）
    let presetMessageInput = '';
    if (bookmark.previewOnly || bookmark.category === 'http-get') {
      const presetValue = bookmark.presetMessage || '';
      const attachments = Array.isArray(bookmark.attachments) ? bookmark.attachments : (bookmark.attachment ? [bookmark.attachment] : []);

      // 生成多附件缩略图显示（横向排列，小尺寸）
      let attachmentDisplay = '';
      if (attachments.length > 0) {
        const thumbnails = attachments.map((att, attIndex) => {
          const isImage = att.type && att.type.startsWith('image/');
          const tooltipText = `${att.name}\n大小: ${(att.size / 1024).toFixed(1)} KB\n类型: ${att.type || '未知'}`;

          if (isImage) {
            return `<div class="attachment-thumb attachment-thumb-image" style="position: relative; display: inline-block; margin: 2px;">
              <img src="${att.data}"
                   alt="${escapeHtml(att.name)}"
                   style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 2px solid #0ea5e9; cursor: pointer; transition: all 0.2s;"
                   onmouseover="this.style.transform='scale(1.1)'; this.style.boxShadow='0 4px 12px rgba(14,165,233,0.3)'"
                   onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"
                   title="${escapeHtml(tooltipText)}"
                   onclick="previewAttachment(${index}, ${attIndex})" />
              <button class="attachment-remove-btn" onclick="removeAttachment(${index}, ${attIndex}); event.stopPropagation();"
                      style="position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; background: #dc2626; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; padding: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                      title="移除此附件">✕</button>
            </div>`;
          } else {
            return `<div class="attachment-thumb attachment-thumb-file" style="position: relative; display: inline-flex; align-items: center; justify-content: center; margin: 2px; width: 60px; height: 60px; background: linear-gradient(135deg, #f0f9ff 0%,#e0f2fe 100%); border-radius: 6px; border: 2px solid #0ea5e9; cursor: pointer;"
                 title="${escapeHtml(tooltipText)}">
              <span style="font-size: 24px;">📎</span>
              <button class="attachment-remove-btn" onclick="removeAttachment(${index}, ${attIndex}); event.stopPropagation();"
                      style="position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; background: #dc2626; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; padding: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                      title="移除此附件">✕</button>
            </div>`;
          }
        }).join('');

        attachmentDisplay = `<div id="attachment_${index}" style="margin-top: 6px; padding: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
            ${thumbnails}
            ${attachments.length >= 10 ? '<span style="font-size: 10px; color: #94a3b8; margin-left: 4px;">（已达上限10个）</span>' : ''}
          </div>
        </div>`;
      } else {
        attachmentDisplay = `<div id="attachment_${index}" style="display: none;"></div>`;
      }

      // HTTP Get 卡片：添加股票价格输入表格
      let stockPriceTable = '';
      if (bookmark.category === 'http-get') {
        stockPriceTable = `<div id="stockPriceTable_${index}" style="margin-top: 6px; display: none;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left;">股票</th>
                <th style="border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; width: 100px;">最近交易价格（-号=卖出）</th>
              </tr>
            </thead>
            <tbody id="stockPriceBody_${index}"></tbody>
          </table>
        </div>`;
      }

      // 历史讯息下拉选单容器（所有卡片类型通用）
      let cardMsgDropdown = `<div class="card-msg-dropdown" id="cardMsgDropdown_${index}" style="display: none; position: fixed; z-index: 10000; background: white; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 300px; overflow-y: auto;"></div>`;

      presetMessageInput = `<div style="margin-top: 8px;" id="attachmentContainer_${index}">
        <div style="position: relative;" id="dropZone_${index}">
          <textarea id="presetMsg_${index}"
            data-category="${escapeHtml(bookmark.category)}"
            data-card-name="${escapeHtml(bookmark.name)}"
            placeholder="预设消息...（支持粘贴图片 Ctrl+V 或拖拽文件，最多10个附件）"
            style="width: 100%; padding: 8px 10px; padding-right: 40px; border: 2px dashed #e2e8f0; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #7c3aed; background: #faf5ff; resize: vertical; min-height: 60px; max-height: 200px; outline: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; transition: all 0.2s;"
            onfocus="this.style.borderColor='#667eea'; this.style.background='#f5f0ff'; this.style.borderStyle='solid';"
            onblur="this.style.borderColor='#e2e8f0'; this.style.background='#faf5ff'; this.style.borderStyle='dashed';"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendToGeneralTab(${index});} handleCardMsgKeydown(event, ${index});"
            oninput="if(this.dataset.category==='http-get'){onHttpGetInput(${index});}"
            ondblclick="event.stopPropagation(); showCardMsgDropdown(this, ${index});"
            onpaste="handlePaste(event, ${index})"
            ondragover="handleDragOver(event, ${index})"
            ondragleave="handleDragLeave(event, ${index})"
            ondrop="handleDrop(event, ${index})"
          >${escapeHtml(presetValue)}</textarea>
          <button class="attachment-btn" onclick="selectAttachment(${index})"
            title="添加附件（或粘贴图片/拖拽文件）\n最多支持10个附件">📎</button>
        </div>
        ${cardMsgDropdown}
        ${stockPriceTable}
        ${attachmentDisplay}
        <input type="file" id="fileInput_${index}" style="display: none;" onchange="handleAttachmentSelect(${index}, this)" accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv" multiple />
      </div>`;
    }
    
    // 显示外部浏览器模式提示
    let externalBrowserHint = '';
    if (bookmark.externalBrowser) {
      externalBrowserHint = `<div style="margin-top: 4px; font-size: 10px; color: #dc2626; font-weight: 600;"> 外部浏览器</div>`;
    }
    
    // 显示监控标识（仅手动监控）
    let monitorHint = '';
    if (bookmark.previewOnly) {
      monitorHint = `<div style="margin-top: 4px; font-size: 10px; color: #059669;"> 手动监控</div>`;
    }
    
    const cardType = bookmark.type || 'webview';
    const isDesktopApp = cardType === 'desktop-app';
    const isLlmApi = cardType === 'llm-api';
    const cardBgStyle = bookmark.bgColor ? `background-color: ${bookmark.bgColor};` : '';

    // LLM API 卡片显示信息
    const llmApiInfo = isLlmApi ? `<div class="bookmark-card-url" title="大模型 API">🤖 ${escapeHtml(bookmark.llmProvider || 'tongyi')} · ${escapeHtml(bookmark.llmModel || '')}</div>` : '';

    html += `
      <div class="bookmark-card ${isBookmarkCollapsed(index) ? 'collapsed' : ''} ${isDesktopApp ? 'desktop-app-card' : ''}" data-id="${index}" data-type="${cardType}" style="${cardBgStyle}">
        <button class="bookmark-card-fold-btn" onclick="toggleBookmarkCard(${index})" title="折叠/展开"></button>
        <div class="bookmark-card-header">
          <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
            <div class="bookmark-card-title">${escapeHtml(bookmark.name)}</div>
            ${isDesktopApp ? `<div class="app-dropdown-wrapper" style="position: relative; flex-shrink: 0;">
              <button class="bookmark-card-btn app-menu-btn" onclick="toggleAppMenu(event, ${index})" title="APP 操作菜单" style="width: 26px; height: 26px; border-radius: 4px; background: #fef3c7; color: #b45309; border: 1px solid #d1d5db; font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; min-width: 0;">APP</button>
              <div class="app-dropdown-menu" id="appMenu_${index}" style="display: none; position: absolute; top: 100%; right: 0; margin-top: 2px; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); z-index: 1000; min-width: 120px; padding: 2px 0;">
                <div class="app-dropdown-item" onclick="appMenuActivate(${index})" style="padding: 4px 10px; font-size: 10px; cursor: pointer; white-space: nowrap; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">开启APP</div>
                <div class="app-dropdown-item" onclick="appMenuScriptSettings(${index})" style="padding: 4px 10px; font-size: 10px; cursor: pointer; white-space: nowrap; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">脚本设定作业</div>
              </div>
            </div>` : ''}
          </div>
          <div class="bookmark-card-actions">
            ${!isDesktopApp ? `<button class="bookmark-card-btn send-to-general" onclick="sendToGeneralTab(${index})" title="发送到通用页签执行（继续对话/新开对话自动判断）"><span class="send-to-general-text">发送</span></button>` : `<button class="bookmark-card-crawl" onclick="crawlBookmarkByIndex(${index})" title="⚡ 发送到APP"><span class="crawl-text">发送</span></button>`}
            ${!isDesktopApp && !isLlmApi ? `<button class="bookmark-card-btn check-ai" onclick="checkAIBtnClickHandler(${index})" title="✓ 检查当前对话AI（对比卡片AI与webview中的AI是否相同）"><span class="check-ai-text">一致<br>检查</span></button>` : ''}
            <button class="bookmark-card-btn edit" onclick="editBookmark(${index})" title="编辑">✏️</button>
            <button class="bookmark-card-btn delete" onclick="deleteBookmark(${index})" title="删除">🗑️</button>
          </div>
        </div>
        <div class="bookmark-card-body">
          ${isLlmApi ? llmApiInfo : (!isDesktopApp ? `<div class="bookmark-card-url" title="${escapeHtml(bookmark.url)}"> ${escapeHtml(truncatedUrl)}</div>` : `<div class="bookmark-card-url" title="桌面APP">🖥️ 桌面APP · ${escapeHtml(bookmark.appName || bookmark.name)}</div>`)}
          ${headersHint}
          ${previewHint}
          ${presetMessageInput}
          ${externalBrowserHint}
          ${monitorHint}
          <div class="bookmark-card-footer">
            <span class="bookmark-card-category category-${bookmark.category}">${categoryLabel}</span>
          </div>
          ${bookmark.note ? `<div style="margin-top: 8px; font-size: 11px; color: #94a3b8;">📝 ${escapeHtml(bookmark.note)}</div>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// 显示添加网点模态框
function showAddBookmarkModal(editIndex) {
  const modal = document.getElementById('bookmarkModal');
  const modalTitle = document.getElementById('modalTitle');
  
  // 清空表单
  document.getElementById('bookmarkName').value = '';
  document.getElementById('bookmarkUrl').value = '';
  document.getElementById('bookmarkCategory').value = 'general';
  document.getElementById('bookmarkNote').value = '';
  document.getElementById('bookmarkReferer').value = '';
  document.getElementById('bookmarkUserAgent').value = '';
  document.getElementById('bookmarkPreviewOnly').checked = false;
  document.getElementById('bookmarkPresetMessage').value = '';
  document.getElementById('bookmarkExternalBrowser').checked = false;
  document.getElementById('bookmarkReplySelector').value = '';
  document.getElementById('bookmarkHeartbeatSelector').value = '';
  document.getElementById('bookmarkMonitorTimeout').value = '';
  document.getElementById('bookmarkAppName').value = '';
  document.getElementById('bookmarkSendMethod').value = 'clipboard';
  document.getElementById('bookmarkActivateDelay').value = '500';
  document.getElementById('bookmarkWaitAnswerDelay').value = '15000';
  document.getElementById('bookmarkWinWidth').value = '950';
  document.getElementById('bookmarkWinHeight').value = '920';
  document.getElementById('bookmarkWinX').value = '0';
  document.getElementById('bookmarkWinY').value = '0';
  document.getElementById('bookmarkCopyBtnX').value = '';
  document.getElementById('bookmarkCopyBtnY').value = '';
  document.getElementById('bookmarkMdBtnX').value = '';
  document.getElementById('bookmarkMdBtnY').value = '';
  document.getElementById('bookmarkLlmProvider').value = 'tongyi';
  if (typeof updateLlmModelOptions === 'function') updateLlmModelOptions();
  document.getElementById('bookmarkLlmModel').value = '';
  document.getElementById('bookmarkLlmApiKey').value = '';
  
  // 默认选中 webview 类型
  const typeRadios = document.querySelectorAll('input[name="bookmarkType"]');
  typeRadios.forEach(radio => {
    radio.checked = radio.value === 'webview';
  });

  // 隐藏预设消息容器（默认）
  const presetMessageContainer = document.getElementById('presetMessageContainer');
  if (presetMessageContainer) {
    presetMessageContainer.style.display = 'none';
  }
  
  // 默认显示网页相关设置，隐藏桌面APP设置
  updateBookmarkModalVisibility('webview');
  
  if (editIndex !== undefined && editIndex !== null) {
    // 编辑模式
    editingBookmarkId = editIndex;
    const bookmark = bookmarks[editIndex];
    modalTitle.textContent = '✏️ 编辑常用网点';
    document.getElementById('bookmarkName').value = bookmark.name || '';
    document.getElementById('bookmarkUrl').value = bookmark.url || '';
    document.getElementById('bookmarkCategory').value = bookmark.category || 'general';
    document.getElementById('bookmarkNote').value = bookmark.note || '';
    document.getElementById('bookmarkReferer').value = bookmark.referer || '';
    document.getElementById('bookmarkUserAgent').value = bookmark.userAgent || '';
    document.getElementById('bookmarkPreviewOnly').checked = bookmark.previewOnly || false;
    document.getElementById('bookmarkPresetMessage').value = bookmark.presetMessage || '';
    document.getElementById('bookmarkExternalBrowser').checked = bookmark.externalBrowser || false;
    document.getElementById('bookmarkReplySelector').value = bookmark.replySelector || '';
    document.getElementById('bookmarkHeartbeatSelector').value = bookmark.heartbeatSelector || '';
    document.getElementById('bookmarkMonitorTimeout').value = bookmark.monitorTimeout || '';
    document.getElementById('bookmarkAutoMonitor').checked = bookmark.autoMonitor !== false; // 默认 true
    
    const cardType = bookmark.type || 'webview';
    document.getElementById('bookmarkAppName').value = bookmark.appName || '';
    document.getElementById('bookmarkSendMethod').value = bookmark.sendMethod || 'clipboard';
    document.getElementById('bookmarkActivateDelay').value = bookmark.activateDelay || '500';
    document.getElementById('bookmarkWaitAnswerDelay').value = bookmark.waitAnswerDelay || '15000';
    document.getElementById('bookmarkWinWidth').value = (bookmark.appWindowSize && bookmark.appWindowSize.w) || '950';
    document.getElementById('bookmarkWinHeight').value = (bookmark.appWindowSize && bookmark.appWindowSize.h) || '920';
    document.getElementById('bookmarkWinX').value = (bookmark.appWindowPos && bookmark.appWindowPos.x) || '0';
    document.getElementById('bookmarkWinY').value = (bookmark.appWindowPos && bookmark.appWindowPos.y) || '0';
    document.getElementById('bookmarkCopyBtnX').value = (bookmark.copyBtnRatio && bookmark.copyBtnRatio.x) || '';
    document.getElementById('bookmarkCopyBtnY').value = (bookmark.copyBtnRatio && bookmark.copyBtnRatio.y) || '';
    document.getElementById('bookmarkMdBtnX').value = (bookmark.mdBtnRatio && bookmark.mdBtnRatio.x) || '';
    document.getElementById('bookmarkMdBtnY').value = (bookmark.mdBtnRatio && bookmark.mdBtnRatio.y) || '';
    document.getElementById('bookmarkLlmProvider').value = bookmark.llmProvider || 'tongyi';
    // ✅ 程序化赋值后必须刷新模型下拉，否则仍然显示上一次提供商的模型列表（导致填错模型名）
    if (typeof updateLlmModelOptions === 'function') updateLlmModelOptions();
    document.getElementById('bookmarkLlmModel').value = bookmark.llmModel || '';
    document.getElementById('bookmarkLlmApiKey').value = bookmark.llmApiKey || '';
    
    typeRadios.forEach(radio => {
      radio.checked = radio.value === cardType;
    });
    
    // 根据类型控制显示
    updateBookmarkModalVisibility(cardType);
    
    // 根据预览模式控制预设消息字段的显示
    if (presetMessageContainer) {
      presetMessageContainer.style.display = bookmark.previewOnly ? 'block' : 'none';
    }
    // 设置色卡选择器为当前卡片的背景色
    setBookmarkColorPicker(bookmark.bgColor || '');
    const customSelectorContainer = document.getElementById('customSelectorContainer');
    if (customSelectorContainer) {
      customSelectorContainer.style.display = bookmark.previewOnly ? 'block' : 'none';
    }
    const heartbeatSelectorContainer = document.getElementById('heartbeatSelectorContainer');
    if (heartbeatSelectorContainer) {
      heartbeatSelectorContainer.style.display = bookmark.previewOnly ? 'block' : 'none';
    }
    const monitorTimeoutContainer = document.getElementById('monitorTimeoutContainer');
    if (monitorTimeoutContainer) {
      monitorTimeoutContainer.style.display = bookmark.previewOnly ? 'block' : 'none';
    }
  } else {
    // 添加模式
    editingBookmarkId = null;
    modalTitle.textContent = '➕ 添加常用网点';
    
    // 如果当前输入框有URL，自动填充
    const currentUrl = document.getElementById('urlInput').value.trim();
    if (currentUrl) {
      document.getElementById('bookmarkUrl').value = currentUrl;
      document.getElementById('bookmarkName').value = '网点 ' + (bookmarks.length + 1);
    }
    
    // 重置色卡选择器为默认（白色）
    setBookmarkColorPicker('');
  }
  
  modal.style.display = 'flex';
  
  // 应用黑夜模式（如果已开启）
  if (typeof applyBookmarkModalDarkMode === 'function') {
    applyBookmarkModalDarkMode();
  }
}

// 编辑网点
function editBookmark(index) {
  showAddBookmarkModal(index);
}

// 关闭模态框
function closeBookmarkModal() {
  const modal = document.getElementById('bookmarkModal');
  modal.style.display = 'none';
  editingBookmarkId = null;
}

// 保存网点
async function saveBookmark() {
  const name = document.getElementById('bookmarkName').value.trim();
  const url = document.getElementById('bookmarkUrl').value.trim();
  const category = document.getElementById('bookmarkCategory').value;
  const note = document.getElementById('bookmarkNote').value.trim();
  const referer = document.getElementById('bookmarkReferer').value.trim();
  const userAgent = document.getElementById('bookmarkUserAgent').value.trim();
  const previewOnly = document.getElementById('bookmarkPreviewOnly').checked;
  const presetMessage = document.getElementById('bookmarkPresetMessage')?.value?.trim() || '';
  
  // 获取卡片类型
  const typeRadios = document.querySelectorAll('input[name="bookmarkType"]:checked');
  const cardType = typeRadios.length > 0 ? typeRadios[0].value : 'webview';
  
  // 获取桌面APP相关配置
  const appName = document.getElementById('bookmarkAppName')?.value?.trim() || '';
  const sendMethod = document.getElementById('bookmarkSendMethod')?.value || 'clipboard';
  const activateDelay = parseInt(document.getElementById('bookmarkActivateDelay')?.value) || 500;
  const waitAnswerDelay = parseInt(document.getElementById('bookmarkWaitAnswerDelay')?.value) || 15000;
  const winWidth = parseInt(document.getElementById('bookmarkWinWidth')?.value) || 950;
  const winHeight = parseInt(document.getElementById('bookmarkWinHeight')?.value) || 920;
  const winX = parseInt(document.getElementById('bookmarkWinX')?.value) || 0;
  const winY = parseInt(document.getElementById('bookmarkWinY')?.value) || 0;
  const copyBtnX = parseFloat(document.getElementById('bookmarkCopyBtnX')?.value);
  const copyBtnY = parseFloat(document.getElementById('bookmarkCopyBtnY')?.value);
  const mdBtnX = parseFloat(document.getElementById('bookmarkMdBtnX')?.value);
  const mdBtnY = parseFloat(document.getElementById('bookmarkMdBtnY')?.value);

  // 获取大模型 API 相关配置
  const llmProvider = document.getElementById('bookmarkLlmProvider')?.value || 'tongyi';
  const llmModel = document.getElementById('bookmarkLlmModel')?.value?.trim() || '';
  const llmApiKey = document.getElementById('bookmarkLlmApiKey')?.value?.trim() || '';
  
  // 验证必填字段
  if (!name) {
    showStatus('❌ 请输入网点名称', 'error');
    return;
  }
  
  // 🆕 检查是否有重复名称
  const existingIndex = bookmarks.findIndex(b => b.name === name && b.name !== (editingBookmarkId !== null ? bookmarks[editingBookmarkId].name : ''));
  if (existingIndex !== -1) {
    showStatus('❌ 已存在同名网点："' + name + '"', 'error');
    return;
  }
  
  if (cardType === 'webview' && !url) {
    showStatus('❌ 请输入网址 URL', 'error');
    return;
  }
  
  if (cardType === 'desktop-app' && !appName) {
    showStatus('❌ 请输入 APP 名称', 'error');
    return;
  }

  if (cardType === 'llm-api' && (!llmApiKey || !llmModel)) {
    showStatus('❌ 请输入 API Key 和模型', 'error');
    return;
  }
  
  // 确保 URL 有协议（仅 webview 类型，排除 file:// 协议）
  let targetUrl = url;
  if (cardType === 'webview' && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    targetUrl = 'https://' + url;
  }
  
  const bookmarkData = {
    name: name,
    url: targetUrl,
    type: cardType,
    category: category,
    note: note,
    bgColor: getSelectedBookmarkColor(),
    referer: referer,
    userAgent: userAgent,
    previewOnly: previewOnly,
    presetMessage: presetMessage,
    replySelector: document.getElementById('bookmarkReplySelector')?.value?.trim() || '',
    heartbeatSelector: document.getElementById('bookmarkHeartbeatSelector')?.value?.trim() || '',
    monitorTimeout: parseInt(document.getElementById('bookmarkMonitorTimeout')?.value) || null,
    externalBrowser: document.getElementById('bookmarkExternalBrowser')?.checked || false,
    autoMonitor: document.getElementById('bookmarkAutoMonitor')?.checked ?? true,
    appName: appName,
    sendMethod: sendMethod,
    activateDelay: activateDelay,
    waitAnswerDelay: waitAnswerDelay,
    appWindowSize: { w: winWidth, h: winHeight },
    appWindowPos: { x: winX, y: winY },
    copyBtnRatio: (copyBtnX !== undefined && copyBtnY !== undefined) ? { x: copyBtnX, y: copyBtnY } : undefined,
    mdBtnRatio: (mdBtnX !== undefined && mdBtnY !== undefined) ? { x: mdBtnX, y: mdBtnY } : undefined,
    llmProvider: llmProvider,
    llmModel: llmModel,
    llmApiKey: llmApiKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  if (editingBookmarkId !== null) {
    // 更新现有网点
    bookmarkData.createdAt = bookmarks[editingBookmarkId].createdAt;
    // 保留附件数据
    bookmarkData.attachments = bookmarks[editingBookmarkId].attachments || [];
    // 保留脚本和定位点数据（修复：编辑网点时丢失脚本问题）
    bookmarkData.scripts = bookmarks[editingBookmarkId].scripts || [];
    bookmarkData.anchors = bookmarks[editingBookmarkId].anchors || [];
    bookmarks[editingBookmarkId] = bookmarkData;
    showStatus('✅ 网点已更新', 'success');
  } else {
    // 添加新网点
    bookmarkData.attachments = [];
    bookmarks.push(bookmarkData);
    showStatus('✅ 网点已添加', 'success');
  }
  
  // 保存并重新渲染（异步）
  await saveBookmarksToStorage();
  renderBookmarks();
  closeBookmarkModal();
}

// 选择附件
function selectAttachment(index) {
  const fileInput = document.getElementById(`fileInput_${index}`);
  if (fileInput) {
    fileInput.click();
  }
}

// 处理附件选择（支持多文件）
async function handleAttachmentSelect(index, fileInput) {
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;

  // 检查是否会超过10个限制
  const currentAttachments = getAttachmentsArray(index);
  if (currentAttachments.length + files.length > 10) {
    showStatus(`❌ 附件总数不能超过10个（当前${currentAttachments.length}个，欲添加${files.length}个）`, 'error');
    fileInput.value = '';
    return;
  }

  // 处理每个文件
  for (const file of files) {
    await processAttachmentFile(file, index);
  }

  fileInput.value = '';
}

// 移除指定索引的附件
function removeAttachment(index, attachmentIndex) {
  if (index >= 0 && index < bookmarks.length) {
    const attachments = getAttachmentsArray(index);

    if (attachmentIndex >= 0 && attachmentIndex < attachments.length) {
      const removedAttachment = attachments.splice(attachmentIndex, 1)[0];
      const attachmentName = removedAttachment?.name || '未知文件';

      // 更新存储（使用新格式）
      bookmarks[index].attachments = attachments;
      delete bookmarks[index].attachment; // 删除旧格式
      saveBookmarksToStorage();

      // 重新渲染附件显示
      renderAttachments(index);

      showStatus(`✅ 已移除附件：${attachmentName}`, 'success');
    }
  }
}

// 预览附件（点击缩略图时）
function previewAttachment(index, attachmentIndex) {
  const attachments = getAttachmentsArray(index);

  if (attachmentIndex >= 0 && attachmentIndex < attachments.length) {
    const attachment = attachments[attachmentIndex];

    if (attachment.type && attachment.type.startsWith('image/')) {
      // 创建模态框显示大图
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 10000; cursor: pointer;
      `;
      modal.onclick = () => document.body.removeChild(modal);

      const img = document.createElement('img');
      img.src = attachment.data;
      img.alt = attachment.name;
      img.style.cssText = `
        max-width: 90vw; max-height: 90vh; object-fit: contain;
        border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      `;

      const info = document.createElement('div');
      info.textContent = `${attachment.name} (${(attachment.size / 1024).toFixed(1)} KB)`;
      info.style.cssText = `
        position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.7); color: white; padding: 8px 16px;
        border-radius: 6px; font-size: 13px;
      `;

      modal.appendChild(img);
      modal.appendChild(info);
      document.body.appendChild(modal);
    }
  }
}

// 处理剪贴板粘贴事件（支持图片和文件）
async function handlePaste(event, index) {
  const items = event.clipboardData?.items;
  if (!items) return;

  // 检查是否会超过10个限制
  const currentAttachments = getAttachmentsArray(index);
  if (currentAttachments.length >= 10) {
    showStatus('❌ 附件数量已达上限（10个）', 'error');
    event.preventDefault();
    return;
  }

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      event.preventDefault();
      const file = items[i].getAsFile();
      if (file) {
        await processAttachmentFile(file, index);
      }
      break;
    }
  }
}

// 处理拖拽悬停事件
function handleDragOver(event, index) {
  event.preventDefault();
  event.stopPropagation();
  const dropZone = document.getElementById(`dropZone_${index}`);
  if (dropZone) {
    dropZone.style.borderColor = '#667eea';
    dropZone.style.background = '#f5f0ff';
  }
}

// 处理拖拽放下事件（支持多文件）
async function handleDrop(event, index) {
  event.preventDefault();
  event.stopPropagation();

  const dropZone = document.getElementById(`dropZone_${index}`);
  if (dropZone) {
    dropZone.style.borderColor = '#e2e8f0';
    dropZone.style.background = '#faf5ff';
  }

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  // 检查是否会超过10个限制
  const currentAttachments = getAttachmentsArray(index);
  if (currentAttachments.length + files.length > 10) {
    showStatus(`❌ 附件总数不能超过10个（当前${currentAttachments.length}个，欲添加${files.length}个）`, 'error');
    return;
  }

  // 处理每个文件
  for (const file of files) {
    await processAttachmentFile(file, index);
  }
}

// 处理附件文件（统一处理文件选择、粘贴、拖拽）- 添加到数组
async function processAttachmentFile(file, index) {
  // 检查文件大小（限制 10MB）
  if (file.size > 10 * 1024 * 1024) {
    showStatus(`❌ 文件 "${file.name}" 大小超过 10MB 限制`, 'error');
    return null;
  }

  // 检查是否已达到10个限制
  const currentAttachments = getAttachmentsArray(index);
  if (currentAttachments.length >= 10) {
    showStatus('❌ 附件数量已达上限（10个）', 'error');
    return null;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const attachmentData = {
        name: file.name,
        size: file.size,
        type: file.type,
        data: e.target.result
      };

      // 存储到 bookmark 的 attachments 数组
      if (index >= 0 && index < bookmarks.length) {
        // 确保是数组格式
        if (!Array.isArray(bookmarks[index].attachments)) {
          bookmarks[index].attachments = [];

          // 如果有旧格式的单个附件，迁移过来
          if (bookmarks[index].attachment) {
            bookmarks[index].attachments.push(bookmarks[index].attachment);
            delete bookmarks[index].attachment;
          }
        }

        // 添加新附件
        bookmarks[index].attachments.push(attachmentData);
        saveBookmarksToStorage();

        // 更新显示（重新渲染所有附件）
        renderAttachments(index);

        showStatus(`✅ 已添加附件：${file.name} (${currentAttachments.length + 1}/10)`, 'success');
      }
      resolve(attachmentData);
    };

    reader.onerror = function() {
      showStatus(`❌ 文件 "${file.name}" 读取失败`, 'error');
      resolve(null);
    };

    reader.readAsDataURL(file);
  });
}

// 渲染附件显示（重新生成缩略图）
function renderAttachments(index) {
  const attachmentDiv = document.getElementById(`attachment_${index}`);
  if (!attachmentDiv) return;

  const attachments = getAttachmentsArray(index);

  if (attachments.length === 0) {
    attachmentDiv.style.display = 'none';
    attachmentDiv.innerHTML = '';
    return;
  }

  // 生成缩略图HTML（与 renderBookmarks 中相同的逻辑）
  const thumbnails = attachments.map((att, attIndex) => {
    const isImage = att.type && att.type.startsWith('image/');
    const tooltipText = `${att.name}\n大小: ${(att.size / 1024).toFixed(1)} KB\n类型: ${att.type || '未知'}`;

    if (isImage) {
      return `<div style="position: relative; display: inline-block; margin: 2px;">
        <img src="${att.data}"
             alt="${escapeHtml(att.name)}"
             style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 2px solid #0ea5e9; cursor: pointer; transition: all 0.2s;"
             onmouseover="this.style.transform='scale(1.1)'; this.style.boxShadow='0 4px 12px rgba(14,165,233,0.3)'"
             onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"
             title="${escapeHtml(tooltipText)}"
             onclick="previewAttachment(${index}, ${attIndex})" />
        <button onclick="removeAttachment(${index}, ${attIndex}); event.stopPropagation();"
                style="position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; background: #dc2626; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; padding: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                title="移除此附件">✕</button>
      </div>`;
    } else {
      return `<div style="position: relative; display: inline-flex; align-items: center; justify-content: center; margin: 2px; width: 60px; height: 60px; background: linear-gradient(135deg, #f0f9ff 0%,#e0f2fe 100%); border-radius: 6px; border: 2px solid #0ea5e9; cursor: pointer;"
           title="${escapeHtml(tooltipText)}">
        <span style="font-size: 24px;">📎</span>
        <button onclick="removeAttachment(${index}, ${attIndex}); event.stopPropagation();"
                style="position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; background: #dc2626; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; padding: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                title="移除此附件">✕</button>
      </div>`;
    }
  }).join('');

  attachmentDiv.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
      ${thumbnails}
      ${attachments.length >= 10 ? '<span style="font-size: 10px; color: #94a3b8; margin-left: 4px;">（已达上限10个）</span>' : ''}
    </div>
  `;
  attachmentDiv.style.display = 'block';
}

// 删除网点
async function deleteBookmark(index) {
  if (confirm('确定要删除这个网点吗？')) {
    const deletedName = bookmarks[index].name;
    bookmarks.splice(index, 1);
    await saveBookmarksToStorage();
    renderBookmarks();
    showStatus(`✅ 已删除网点：${deletedName}`, 'success');
  }
}

// 切换网点区域显示/隐藏
function toggleBookmarksSection() {
  const section = document.getElementById('bookmarksSection');
  const tabs = document.querySelector('.bookmarks-tabs');
  const bookmarksPanel = document.getElementById('bookmarksContainer');
  const schedulePanel = document.getElementById('scheduleContainer');

  bookmarksVisible = !bookmarksVisible;

  if (bookmarksVisible) {
    tabs.style.display = 'flex';
    bookmarksPanel.style.display = bookmarksPanel.dataset.active === 'true' ? 'grid' : 'none';
    schedulePanel.style.display = schedulePanel.dataset.active === 'true' ? 'block' : 'none';
    section.classList.remove('collapsed');
  } else {
    tabs.style.display = 'none';
    bookmarksPanel.style.display = 'none';
    schedulePanel.style.display = 'none';
    section.classList.add('collapsed');
  }

  // 保存区块折叠状态到 localStorage
  saveBookmarksSectionState(bookmarksVisible);
}

function switchBookmarksTab(tabName) {
  const tabs = document.querySelectorAll('.bookmarks-tab');
  const bookmarksPanel = document.getElementById('bookmarksContainer');
  const schedulePanel = document.getElementById('scheduleContainer');
  const bookmarksBtnsGroup = document.getElementById('bookmarksBtnsGroup');
  const scheduleBtnsGroup = document.getElementById('scheduleBtnsGroup');

  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  if (tabName === 'bookmarks') {
    bookmarksPanel.style.display = 'grid';
    schedulePanel.style.display = 'none';
    bookmarksPanel.dataset.active = 'true';
    schedulePanel.dataset.active = 'false';
    bookmarksBtnsGroup.style.display = 'flex';
    scheduleBtnsGroup.style.display = 'none';
  } else {
    bookmarksPanel.style.display = 'none';
    schedulePanel.style.display = 'block';
    bookmarksPanel.dataset.active = 'false';
    schedulePanel.dataset.active = 'true';
    bookmarksBtnsGroup.style.display = 'none';
    scheduleBtnsGroup.style.display = 'flex';
    loadSchedules();
  }
}

// 保存区块折叠状态
function saveBookmarksSectionState(isVisible) {
  try {
    localStorage.setItem('bookmarksSectionVisible', JSON.stringify(isVisible));
  } catch (e) {
    console.error('[Renderer] 保存区块折叠状态失败:', e);
  }
}

// 重置为默认网点
async function resetToDefaultBookmarks() {
  const currentCount = bookmarks.length;

  // 确认对话框
  const confirmed = confirm(
    `⚠️ 确认重置为默认网点？\n\n` +
    `当前共有 ${currentCount} 个自定义网点将被删除！\n\n` +
    `将替换为以下 ${DEFAULT_BOOKMARKS.length} 个默认网点：\n` +
    DEFAULT_BOOKMARKS.map((b, i) => `${i + 1}. ${b.name} (${b.category})`).join('\n') +
    `\n\n此操作不可撤销，确定要继续吗？`
  );

  if (!confirmed) return;

  try {
    // 清空当前数据
    bookmarks = [];
    bookmarkHeadersMap = {};
    collapsedStatesCache = {};

    // 设置默认网点（DEFAULT_BOOKMARKS 已使用与运行时一致的扁平结构）
    const now = new Date().toISOString();
    DEFAULT_BOOKMARKS.forEach((defaultBookmark, index) => {
      bookmarks.push({
        ...defaultBookmark,
        attachments: [],
        id: Date.now() + index,
        createdAt: now,
        updatedAt: now
      });

      // 保存自定义 headers（使用与 renderBookmarks 相同的 key 格式）
      const headersKey = `bookmark_${index}`;
      const customHeaders = {};
      if (defaultBookmark.referer) customHeaders.Referer = defaultBookmark.referer;
      if (defaultBookmark.userAgent) customHeaders['User-Agent'] = defaultBookmark.userAgent;
      if (Object.keys(customHeaders).length > 0) {
        bookmarkHeadersMap[headersKey] = customHeaders;
      }
    });

    // 保存到文件系统
    await window.electronAPI.saveBookmarks(bookmarks);

    // 保存 headers map 到文件系统
    await window.electronAPI.saveHeadersMap(bookmarkHeadersMap);

    // 清除折叠状态缓存
    await window.electronAPI.saveCollapsedStates({});
    collapsedStatesCache = {};

    // 重新渲染
    renderBookmarks();

    showStatus(`✅ 已重置为 ${DEFAULT_BOOKMARKS.length} 个默认网点`, 'success');
    console.log('[Renderer] ✅ 已成功重置为默认网点');
    console.log('[Renderer] Headers Map:', JSON.stringify(bookmarkHeadersMap, null, 2));

  } catch (error) {
    console.error('[Renderer] 重置默认网点失败:', error);
    showStatus('❌ 重置失败: ' + error.message, 'error');
  }
}

// 切换单个网点的折叠状态
function toggleBookmarkCard(index) {
  const card = document.querySelector(`.bookmark-card[data-id="${index}"]`);
  if (!card) return;

  card.classList.toggle('collapsed');
  const isCollapsed = card.classList.contains('collapsed');

  // 使用卡片名称作为唯一标识
  if (bookmarks[index]) {
    const bookmarkName = bookmarks[index].name;
    collapsedStatesCache[bookmarkName] = isCollapsed;

    // 异步保存到文件系统（不阻塞 UI）
    saveCollapsedStatesToFile();
    console.log(`[Renderer] ✅ 卡片状态已更新: "${bookmarkName}" = ${isCollapsed ? '折叠' : '展开'}`);
  }
}

// 检查网点是否处于折叠状态（从内存缓存读取）
function isBookmarkCollapsed(index) {
  if (!bookmarks[index]) return false;
  const bookmarkName = bookmarks[index].name;
  return collapsedStatesCache[bookmarkName] === true;
}

// 保存折叠状态到文件系统（通过 IPC）
async function saveCollapsedStatesToFile() {
  try {
    await window.electronAPI.saveCollapsedStates(collapsedStatesCache);
  } catch (error) {
    console.error('[Renderer] 保存折叠状态失败:', error);
  }
}

// 将所有函数挂载到 window，供 HTML onclick 及其他模组访问
window.saveBookmarksToStorage = saveBookmarksToStorage;
window.filterBookmarks = filterBookmarks;
window.renderBookmarks = renderBookmarks;
window.showAddBookmarkModal = showAddBookmarkModal;
window.editBookmark = editBookmark;
window.closeBookmarkModal = closeBookmarkModal;
window.saveBookmark = saveBookmark;
window.selectAttachment = selectAttachment;
window.handleAttachmentSelect = handleAttachmentSelect;
window.removeAttachment = removeAttachment;
window.previewAttachment = previewAttachment;
window.handlePaste = handlePaste;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.processAttachmentFile = processAttachmentFile;
window.renderAttachments = renderAttachments;
window.deleteBookmark = deleteBookmark;
window.toggleBookmarksSection = toggleBookmarksSection;
window.switchBookmarksTab = switchBookmarksTab;
window.saveBookmarksSectionState = saveBookmarksSectionState;
window.resetToDefaultBookmarks = resetToDefaultBookmarks;
window.toggleBookmarkCard = toggleBookmarkCard;
window.isBookmarkCollapsed = isBookmarkCollapsed;
window.saveCollapsedStatesToFile = saveCollapsedStatesToFile;
