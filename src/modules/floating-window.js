/**
 * 浮动视窗模组
 * 从 renderer.js 拆分而来
 * 包含：浮动视窗核心、通用页签、历史记录、聊天右键菜单
 * 依赖：bookmarks, escapeHtml, sendEmailViaPlugin, sendToCard, addFloatHistoryEntry（来自其他模组）
 * 被依赖：showStatus, floatHistory, addFloatHistoryEntry（被几乎所有模组调用）
 */
// 显示状态消息
function showStatus(message, type, cardIndex, skipFloatHistory) {
  //  🆕 浮动在顶端的状态框（无跑马灯，2秒后自动折叠）
  const statusBoxFloating = document.getElementById('statusBoxInline');
  if (statusBoxFloating) {
    // 记录所有浮动视窗系统提示消息（无论是否处于交互状态，确保历史页签不遗漏）
    if (!skipFloatHistory) {
      addFloatHistoryEntry({
        type: type || 'info',
        source: '系统',
        message: message || ''
      });
    }

    //  如果用户已与浮动视窗交互（输入中），仅更新消息文本，不打断用户
    //  但仍然设置定时器，如果用户停止交互后自动关闭
    if (statusBoxFloating._userInteracted) {
      const msgEl = statusBoxFloating.querySelector('.status-msg-text');
      if (msgEl) {
        msgEl.textContent = message;
      }
      // 更新类型样式
      statusBoxFloating.className = 'status-box-floating ' + (type || 'info') + ' expanded';
      
      // 系统消息仍然启动定时器（3秒后检查用户是否还在交互）
      if (statusBoxFloating._collapseTimer) {
        clearTimeout(statusBoxFloating._collapseTimer);
      }
      statusBoxFloating._collapseTimer = setTimeout(() => {
        if (statusBoxFloating) {
          // 如果用户停止了交互，则关闭窗口
          if (!statusBoxFloating._userInteracted) {
            statusBoxFloating.classList.remove('expanded');
            statusBoxFloating.classList.add('collapsed');
            const savedLeft = localStorage.getItem('statusFloatingLeft');
            const savedTop = localStorage.getItem('statusFloatingTop');
            if (savedLeft) statusBoxFloating.style.left = savedLeft;
            if (savedTop) statusBoxFloating.style.top = savedTop;
            updateCollapsedCardName();
          }
          // 如果用户还在交互，不再自动关闭（用户接管）
          statusBoxFloating._collapseTimer = null;
        }
      }, 3000);
      return;
    }

    // 清除之前的折叠定时器
    if (statusBoxFloating._collapseTimer) {
      clearTimeout(statusBoxFloating._collapseTimer);
    }

    // 保存通用页签的消息（防止重建 HTML 时丢失）
    const generalTextarea = document.getElementById('mini_general_msg');
    const savedGeneralMsg = generalTextarea ? generalTextarea.value : '';

    // 直接显示文本，不使用跑马灯
    const escapedMessage = escapeHtml(message);
    const wsActiveIdx = workspaceActiveCards[currentWorkspaceId];
    const effectiveIndex = (cardIndex !== undefined && cardIndex !== null) ? cardIndex
      : (wsActiveIdx !== undefined && wsActiveIdx !== null ? wsActiveIdx : currentActiveCardIndex);
    let miniCardHtml = '';
    if (effectiveIndex >= 0 && effectiveIndex < bookmarks.length) {
      miniCardHtml = renderMiniCard(effectiveIndex);
      statusBoxFloating.classList.add('has-card');
    } else {
      statusBoxFloating.classList.remove('has-card');
    }

    // 构建可折叠的 HTML 结构（页签：卡片 / 通用）
    statusBoxFloating.innerHTML = `
      <span class="status-toggle"></span>
      <span class="collapsed-card-name" id="collapsedCardName"></span>
      <div class="status-text-full">
        <span class="status-msg-text" id="statusMsgText" onclick="event.stopPropagation(); toggleMsgExpand()">${escapedMessage}<span class="status-expand-indicator"> ▼</span></span>
        <div class="status-tabs" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
          <button class="status-tab active" data-tab="card" onclick="event.stopPropagation(); switchStatusTab('card')">卡片</button>
          <button class="status-tab" data-tab="general" onclick="event.stopPropagation(); switchStatusTab('general')">通用</button>
          <button class="status-tab" data-tab="history" onclick="event.stopPropagation(); switchStatusTab('history')">历史</button>
        </div>
        <div class="status-tab-content status-tab-card">
          ${miniCardHtml}
        </div>
        <div class="status-tab-content status-tab-general" style="display:none;">
          <div class="status-mini-editable" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
            <textarea id="mini_general_msg"
              class="mini-textarea"
              placeholder="输入通用讯息..."
              onfocus="this.classList.add('focused'); event.stopPropagation(); var sb=document.getElementById('statusBoxInline'); if(sb){sb._userInteracted=true; if(sb._collapseTimer){clearTimeout(sb._collapseTimer);sb._collapseTimer=null;}}"
              oninput="var sb=document.getElementById('statusBoxInline'); if(sb) sb._userInteracted=true;"
              onblur="if(!dropdownSelecting) { this.classList.remove('focused'); closeGeneralDropdown(); }"
              ondblclick="event.stopPropagation(); showGeneralMsgDropdown(this);"
              onmousedown="event.stopPropagation()"
              onclick="event.stopPropagation()"
              onpaste="event.stopPropagation(); handlePasteGeneral(event); setTimeout(() => { renderGeneralAttachments(); }, 100)"
              ondragover="event.stopPropagation(); event.preventDefault()"
              ondragleave="event.stopPropagation()"
              ondrop="event.stopPropagation(); event.preventDefault(); handleDropGeneral(event); setTimeout(() => { renderGeneralAttachments(); }, 100)"
              onkeydown="if(!(event.shiftKey && event.metaKey && (event.key === 'F' || event.key === 'G'))) event.stopPropagation(); handleGeneralTextareaKeydown(event, this);"
            ></textarea>
            <div id="generalMsgDropdown" class="general-dropdown" style="display:none;"></div>
            <div class="mini-editbar" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
              <button class="mini-file-btn" onclick="event.stopPropagation(); document.getElementById('mini_general_file').click()" title="粘贴附件（最多10个）">📎</button>
              <input type="file" id="mini_general_file" style="display:none"
                onchange="event.stopPropagation(); miniHandleFileSelectGeneral(this)"
                accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv" multiple />
              <span class="mini-att-count" id="mini_general_att_count">0/10</span>
              <button class="mini-copy-btn" onclick="event.stopPropagation(); miniCopyGeneralMsg()" title="复制讯息">📋</button>
              <button class="mini-clear-btn" onclick="event.stopPropagation(); miniClearGeneralAll()" title="清除讯息和附件">✕</button>
              <button class="mini-send-btn" onclick="event.stopPropagation(); miniSendGeneral()" title="调用 sendToCard(message, attachments)：解析讯息匹配卡片名称，设置讯息与附件到该卡片，自动执行继续对话">发送</button>
            </div>
            <div class="mini-attachments" id="mini_general_att" style="display:none;"></div>
            <div class="mini-email-recipients" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
              <span class="mini-email-label">收件人</span>
              <input type="text" id="mini_email_recipients" class="mini-email-input" placeholder="输入邮箱地址，多个用逗号分隔（收到AI回复后自动发送）" value="" oninput="floatEmailRecipients=this.value; localStorage.setItem('floatEmailRecipients', this.value)" ondblclick="event.stopPropagation(); showRecipientDropdown();" onblur="if(!dropdownSelecting) { closeRecipientDropdown(); }" />
              <div id="recipientDropdown" class="general-dropdown" style="display:none;"></div>
            </div>
            <div class="mini-toggle-container">
              <span class="mini-toggle-label">当下页签</span>
              <input type="checkbox" id="mini_auto_switch_general" class="mini-toggle-switch" onchange="event.stopPropagation(); toggleAutoScheduleMode('general', this.checked)" />
              <span class="mini-toggle-label">自动调度</span>
              <button class="mini-path-btn" onclick="event.stopPropagation(); showExecutionPath()" title="查看执行路径">📝 路径</button>
            </div>
          </div>
        </div>
        <div class="status-tab-content status-tab-history" style="display:none;">
          <div class="status-history-toolbar" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
            <input id="historySearchInput" type="text" placeholder=" 搜索消息内容、卡片名称或收件人..." oninput="event.stopPropagation(); renderMessageHistory(this.value);" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" />
            <div style="position: relative; display: inline-block;">
              <button onclick="event.stopPropagation(); toggleClearDropdown();" title="清空历史记录">清空</button>
              <div id="clearHistoryDropdown" style="display: none; position: absolute; top: 100%; right: 0; margin-top: 4px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10001; min-width: 120px; padding: 4px 0;">
                <div onclick="event.stopPropagation(); clearHistoryByType('系统'); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">清空 系统讯息</div>
                <div onclick="event.stopPropagation(); clearHistoryByType('通用'); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">清空 通用讯息</div>
                <div onclick="event.stopPropagation(); clearMessageHistory(); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #dc2626; border-top: 1px solid #f1f5f9;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">清空 全部讯息</div>
              </div>
            </div>
          </div>
          <div id="mini_history_list" class="mini-history-list"></div>
          <div id="mini_history_empty" class="mini-history-empty" style="display:none;">暂无历史记录</div>
        </div>
      </div>
      <div class="status-resize-handle"></div>
    `;

    // 恢复通用页签的消息
    const newGeneralTextarea = document.getElementById('mini_general_msg');
    if (newGeneralTextarea && savedGeneralMsg) {
      newGeneralTextarea.value = savedGeneralMsg;
    }

    // 恢复自动调度模式的 toggle switch 状态
    const generalToggle = document.getElementById('mini_auto_switch_general');
    if (generalToggle) {
      generalToggle.checked = autoScheduleMode['general'] || false;
    }
    if (effectiveIndex >= 0 && effectiveIndex < bookmarks.length) {
      const cardToggle = document.getElementById(`mini_auto_switch_${effectiveIndex}`);
      if (cardToggle) {
        cardToggle.checked = autoScheduleMode[effectiveIndex] || false;
      }
    }

    // 设置类型样式（消息显示模式，不显示作业区）
    statusBoxFloating.className = 'status-box-floating ' + (type || 'info') + ' msg-only';
    statusBoxFloating.style.display = 'flex';

    // 重新触发出现动画
    statusBoxFloating.style.animation = 'none';
    statusBoxFloating.offsetHeight; // 触发 reflow
    statusBoxFloating.style.animation = 'slideDownFadeInLeft 0.4s ease-out';

    // 🔑 3秒后自动折叠（如果用户没有交互）
    statusBoxFloating._collapseTimer = setTimeout(() => {
      if (statusBoxFloating) {
        // 如果用户已经接管（通过快捷键打开或点击展开），不自动关闭
        if (!statusBoxFloating._userInteracted) {
          statusBoxFloating.classList.remove('msg-only', 'expanded');
          statusBoxFloating.classList.add('collapsed');
          statusBoxFloating._userInteracted = false;
          // 恢复拖拽保存的位置
          const savedLeft = localStorage.getItem('statusFloatingLeft');
          const savedTop = localStorage.getItem('statusFloatingTop');
          if (savedLeft) statusBoxFloating.style.left = savedLeft;
          if (savedTop) statusBoxFloating.style.top = savedTop;
          // 🆕 更新小圆球内的卡片名称显示
          updateCollapsedCardName();
        }
        statusBoxFloating._collapseTimer = null;
      }
    }, 3000);
  }

  // 保留原来的状态框（兼容性）
  const statusBox = document.getElementById('statusBox');
  if (statusBox) {
    statusBox.textContent = message;
    statusBox.className = 'status-box ' + (type || 'info');
    statusBox.style.display = 'block';
  }
}

// 折叠浮动视窗
function collapseFloatingWindow() {
  const statusBox = document.getElementById('statusBoxInline');
  if (!statusBox) return;
  if (statusBox.classList.contains('collapsed')) return;
  statusBox.classList.remove('expanded');
  statusBox.classList.add('collapsed');
  statusBox._userInteracted = false;
  if (statusBox._collapseTimer) {
    clearTimeout(statusBox._collapseTimer);
    statusBox._collapseTimer = null;
  }
  const savedLeft = localStorage.getItem('statusFloatingLeft');
  const savedTop = localStorage.getItem('statusFloatingTop');
  if (savedLeft) statusBox.style.left = savedLeft;
  if (savedTop) statusBox.style.top = savedTop;
  updateCollapsedCardName();
}

// 🆕 浮动视窗拖拽调整大小（右下角手柄）— 使用 rAF 防抖，消除粘滞感
(function initFloatingResize() {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  let box = null;
  let rafId = null;

  function resizeFrame(e) {
    if (!isResizing || !box) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(220, Math.min(window.innerWidth * 0.8, startWidth + delta));
    box.style.width = newWidth + 'px';
    rafId = null;
  }

  document.addEventListener('mousedown', function(e) {
    const handle = e.target.closest('.status-resize-handle');
    if (!handle) return;
    isResizing = true;
    box = handle.parentElement;
    startX = e.clientX;
    startWidth = box.offsetWidth;
    // 立即设置 cursor 和阻止选中文本（在 mousedown 时一次性完成）
    document.body.style.setProperty('--drag-cursor', 'nwse-resize', 'important');
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    // 防止拖拽时其他元素抢夺事件
    document.body.style.pointerEvents = 'auto';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isResizing || !box) return;
    e.preventDefault();
    // 用 requestAnimationFrame 合并连续的 mousemove，避免高频 DOM 写入导致卡顿
    if (!rafId) {
      rafId = requestAnimationFrame(function() { resizeFrame(e); });
    }
  });

  document.addEventListener('mouseup', function() {
    if (!isResizing) return;
    isResizing = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // 保存宽度（仅在展开状态）
    if (box && !box.classList.contains('collapsed')) {
      localStorage.setItem('statusFloatingWidth', box.offsetWidth);
    }
    box = null;
  });

  // 兜底：防止鼠标移出窗口后卡住拖拽状态
  window.addEventListener('blur', function() {
    if (isResizing) {
      isResizing = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (box && !box.classList.contains('collapsed')) {
        localStorage.setItem('statusFloatingWidth', box.offsetWidth);
      }
      box = null;
    }
  });
})();


// 🆕 每个工作区独立的活跃卡片索引（防止跨工作区污染）
const workspaceActiveCards = {};
let currentActiveCardIndex = -1;

function getCurrentActiveCardInfo() {
  const wsIndex = workspaceActiveCards[currentWorkspaceId];
  const idx = (wsIndex !== undefined && wsIndex !== null) ? wsIndex : currentActiveCardIndex;
  if (idx >= 0 && idx < bookmarks.length) {
    const card = bookmarks[idx];
    return { name: card.name, index: idx };
  }
  return null;
}

function setCurrentActiveCard(index) {
  currentActiveCardIndex = index;
  // 不设置 workspaceActiveCards，只在卡片真正使用时才设置
  // 🆕 更新小圆球内的卡片名称显示
  updateCollapsedCardName();
}

// 🆕 更新小圆球内的卡片名称显示
function updateCollapsedCardName() {
  const nameSpan = document.getElementById('collapsedCardName');
  if (!nameSpan) return;

  if (currentActiveCardIndex >= 0 && currentActiveCardIndex < bookmarks.length) {
    const card = bookmarks[currentActiveCardIndex];
    // 截取名称前6个字符，支持换行显示
    const name = card.name || '';
    const displayName = name.length > 6 ? name.substring(0, 6) : name;
    nameSpan.textContent = displayName;
  } else {
    nameSpan.textContent = '';
  }
}

// 🆕 渲染迷你卡片（用于浮动视窗中显示当前作用中的卡片克隆，带完整操作按钮）
function renderMiniCard(index) {
  if (index < 0 || index >= bookmarks.length) return '';
  const bookmark = bookmarks[index];
  const truncatedUrl = truncateUrl(bookmark.url);
  const categoryLabel = categoryLabels[bookmark.category] || bookmark.category || '通用';

  // 预览/监控提示
  let previewHint = '';
  if (bookmark.previewOnly) {
    previewHint = `<div class="status-mini-hint status-mini-preview">🌐 只预览网页</div>`;
  }
  let monitorHint = '';
  if (bookmark.previewOnly) {
    monitorHint = `<div class="status-mini-hint status-mini-monitor">手动监控</div>`;
  }

  // 预设消息（可编辑 textarea + 附件区域）— 所有卡片都显示输入框
  let editableAreaHtml = '';
  if (bookmark.previewOnly || true) {
    const presetValue = bookmark.presetMessage || '';
    const attachments = Array.isArray(bookmark.attachments) ? bookmark.attachments : (bookmark.attachment ? [bookmark.attachment] : []);

    // 附件缩略图
    let attachmentThumbs = '';
    if (attachments.length > 0) {
      const thumbs = attachments.map((att, attIdx) => {
        const isImage = att.type && att.type.startsWith('image/');
        const tooltip = `${att.name} (${(att.size / 1024).toFixed(1)}KB)`;
        if (isImage) {
          return `<span class="mini-att-thumb" title="${escapeHtml(tooltip)}" onclick="previewAttachment(${index}, ${attIdx})">
            <img src="${att.data}" alt="${escapeHtml(att.name)}" />
            <button class="mini-att-rm" onclick="event.stopPropagation(); miniRemoveAttachment(${index}, ${attIdx})" title="移除">✕</button>
          </span>`;
        } else {
          return `<span class="mini-att-thumb mini-att-file" title="${escapeHtml(tooltip)}">
            📎 ${escapeHtml(att.name.substring(0, 6))}
            <button class="mini-att-rm" onclick="event.stopPropagation(); miniRemoveAttachment(${index}, ${attIdx})" title="移除">✕</button>
          </span>`;
        }
      }).join('');
      attachmentThumbs = `<div class="mini-attachments" id="mini_att_${index}" onclick="event.stopPropagation()">${thumbs}</div>`;
    } else {
      attachmentThumbs = `<div class="mini-attachments" id="mini_att_${index}" style="display:none;"></div>`;
    }

    editableAreaHtml = `
      <div class="status-mini-editable" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        <textarea id="mini_msg_${index}"
          class="mini-textarea"
          placeholder="输入预设消息..."
          onfocus="this.classList.add('focused'); event.stopPropagation(); var sb=document.getElementById('statusBoxInline'); if(sb){sb._userInteracted=true; if(sb._collapseTimer){clearTimeout(sb._collapseTimer);sb._collapseTimer=null;}}"
          oninput="var sb=document.getElementById('statusBoxInline'); if(sb) sb._userInteracted=true;"
          onblur="this.classList.remove('focused'); miniSaveMsg(${index})"
          onmousedown="event.stopPropagation()"
          onclick="event.stopPropagation()"
          onpaste="event.stopPropagation(); handlePaste(event, ${index}); setTimeout(() => { renderMiniCardRefresh(${index}); }, 100)"
          ondragover="event.stopPropagation(); event.preventDefault()"
          ondragleave="event.stopPropagation()"
          ondrop="event.stopPropagation(); event.preventDefault(); handleDrop(event, ${index}); setTimeout(() => { renderMiniCardRefresh(${index}); }, 100)"
          onkeydown="if(!(event.shiftKey && event.metaKey && (event.key === 'F' || event.key === 'G'))) event.stopPropagation(); if(event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.blur(); miniSaveMsg(${index}); continueConversationWrapper(${index}); } if(event.key === 'ArrowUp') { event.preventDefault(); miniNavigateCardHistory(${index}, -1); } if(event.key === 'ArrowDown') { event.preventDefault(); miniNavigateCardHistory(${index}, 1); }"
        >${escapeHtml(presetValue)}</textarea>
        <div class="mini-editbar" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
          <button class="mini-file-btn" onclick="event.stopPropagation(); document.getElementById('mini_file_${index}').click()" title="粘贴附件（最多10个）">📎</button>
          <input type="file" id="mini_file_${index}" style="display:none"
            onchange="event.stopPropagation(); miniHandleFileSelect(${index}, this)"
            accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv" multiple />
          <span class="mini-att-count">${attachments.length}/10</span>
          <button class="mini-copy-btn" onclick="event.stopPropagation(); miniCopyMsg(${index})" title="复制讯息">📋</button>
          <button class="mini-clear-btn" onclick="event.stopPropagation(); miniClearAll(${index})" title="清除讯息和附件">✕</button>
          <button class="mini-send-btn" onclick="event.stopPropagation(); document.getElementById('mini_msg_${index}').blur(); miniSaveMsg(${index}); continueConversationWrapper(${index})" title="发送">发送</button>
        </div>
        ${attachmentThumbs}
        <div class="mini-toggle-container">
          <span class="mini-toggle-label">当下页签</span>
          <input type="checkbox" id="mini_auto_switch_${index}" class="mini-toggle-switch" ${autoScheduleMode[index] ? 'checked' : ''} onchange="event.stopPropagation(); toggleAutoScheduleMode(${index}, this.checked)" />
          <span class="mini-toggle-label">自动调度</span>
        </div>
      </div>`;
  }

  // AI Chat 标识
  let aiChatBadge = '';
  if (bookmark.previewOnly) {
    aiChatBadge = `<div class="status-mini-aichat">🤖 web版AI Chat</div>`;
  }

  // 备注
  let noteHtml = '';
  if (bookmark.note) {
    const notePreview = bookmark.note.length > 30 ? bookmark.note.substring(0, 30) + '...' : bookmark.note;
    noteHtml = `<div class="status-mini-note">📝 ${escapeHtml(notePreview)}</div>`;
  }

  return `
    <div class="status-mini-card" data-card-index="${index}" onclick="event.stopPropagation()">
      <div class="status-mini-card-header">
        <span class="status-mini-card-title">${escapeHtml(bookmark.name)}</span>
        <span class="status-mini-card-category category-${bookmark.category}">${categoryLabel}</span>
      </div>
      <div class="status-mini-actions">
        <button class="mini-btn mini-btn-crawl" onclick="event.stopPropagation(); crawlBookmarkByIndex(${index})" title="${bookmark.previewOnly ? '⚡️ 快速预览' : '爬取'}">${bookmark.previewOnly ? '<span>新开<br>对话</span>' : '🕷️'}</button>
        <button class="mini-btn mini-btn-webview" onclick="event.stopPropagation(); openBookmarkWebviewOnly(${index})" title="开启网页"><span>纯开<br>网页</span></button>
        <button class="mini-btn mini-btn-chat" onclick="event.stopPropagation(); continueConversationWrapper(${index})" title="继续对话"><span>继续<br>对话</span></button>
        <button class="mini-btn mini-btn-check" onclick="event.stopPropagation(); checkAIBtnClickHandler(${index})" title="检查AI"><span>一致<br>检查</span></button>
        <button class="mini-btn mini-btn-edit" onclick="event.stopPropagation(); editBookmark(${index})" title="编辑">✏️</button>
        <button class="mini-btn mini-btn-del" onclick="event.stopPropagation(); deleteBookmark(${index})" title="删除">🗑️</button>
      </div>
      <div class="status-mini-card-url" title="${escapeHtml(bookmark.url)}">🔗 ${escapeHtml(truncatedUrl)}</div>
      ${previewHint}
      ${editableAreaHtml}
      ${monitorHint}
      ${aiChatBadge}
      ${noteHtml}
    </div>`;
}

// 🆕 迷你卡片专用：保存预设消息
function miniSaveMsg(index) {
  if (index < 0 || index >= bookmarks.length) return;
  const textarea = document.getElementById(`mini_msg_${index}`);
  if (!textarea) return;
  bookmarks[index].presetMessage = textarea.value;
  saveBookmarksToStorage();
}

// 🆕 迷你卡片专用：刷新迷你卡片内容（不重建整个浮动框）
function renderMiniCardRefresh(index) {
  // 找到当前浮动框中的迷你卡片并更新其 HTML
  const miniCard = document.querySelector('.status-mini-card');
  if (!miniCard) return;
  const newIndex = parseInt(miniCard.getAttribute('data-card-index'));
  const targetIndex = (index !== undefined) ? index : newIndex;
  if (targetIndex < 0 || targetIndex >= bookmarks.length) return;
  // 只替换迷你卡片内部，保留外层讯息和折叠按钮
  miniCard.outerHTML = renderMiniCard(targetIndex);
}

// 🆕 迷你卡片专用：处理文件选择
async function miniHandleFileSelect(index, fileInput) {
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;

  const currentAttachments = getAttachmentsArray(index);
  if (currentAttachments.length + files.length > 10) {
    showStatus(`❌ 附件总数不能超过10个（当前${currentAttachments.length}个，欲添加${files.length}个）`, 'error', index);
    return;
  }

  for (const file of files) {
    await processAttachmentFile(file, index);
  }

  // 重置 input 以便重复选择同一文件
  fileInput.value = '';

  // 刷新迷你卡片附件显示
  renderMiniCardRefresh(index);

  // 同时刷新原始卡片附件显示
  renderAttachments(index);
}

// 🆕 迷你卡片专用：移除附件
function miniRemoveAttachment(index, attachmentIndex) {
  removeAttachment(index, attachmentIndex);
  // 移除后刷新迷你卡片
  setTimeout(() => renderMiniCardRefresh(index), 50);
}

// 🆕 迷你卡片专用：清除所有讯息和附件
function miniClearAll(index) {
  if (index < 0 || index >= bookmarks.length) return;
  // 清除数据
  bookmarks[index].presetMessage = '';
  if (Array.isArray(bookmarks[index].attachments)) {
    bookmarks[index].attachments = [];
  }
  saveBookmarksToStorage();
  // 同步到正规卡片 DOM
  const regularTextarea = document.getElementById(`presetMsg_${index}`);
  if (regularTextarea) regularTextarea.value = '';
  renderAttachments(index);
  // 刷新迷你卡片显示
  renderMiniCardRefresh(index);
}

// 🆕 迷你卡片专用：复制输入区讯息到剪贴板
function miniCopyMsg(index) {
  const textarea = document.getElementById(`mini_msg_${index}`);
  if (!textarea) return;
  const text = textarea.value.trim();
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector(`.mini-copy-btn[onclick*="${index}"]`);
      if (btn) {
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = '📋'; }, 1000);
      }
    }).catch(() => {
      // fallback: 选中文字让用户手动复制
      textarea.select();
    });
  }
}

// 🆕 通用页签：页签切换
function switchStatusTab(tabName) {
  const tabs = document.querySelectorAll('.status-tab');
  const cardContent = document.querySelector('.status-tab-card');
  const generalContent = document.querySelector('.status-tab-general');
  const historyContent = document.querySelector('.status-tab-history');
  if (!tabs.length) return;
  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
  if (cardContent) cardContent.style.display = (tabName === 'card') ? '' : 'none';
  if (generalContent) generalContent.style.display = (tabName === 'general') ? '' : 'none';
  if (historyContent) historyContent.style.display = (tabName === 'history') ? '' : 'none';
  if (tabName === 'general') {
    setTimeout(() => {
      const ta = document.getElementById('mini_general_msg');
      if (ta) ta.focus();
    }, 50);
  } else if (tabName === 'history') {
    setTimeout(() => {
      const searchInput = document.getElementById('historySearchInput');
      if (searchInput) searchInput.focus();
      renderMessageHistory(searchInput ? searchInput.value : '');
    }, 50);
  }
}

// 展开/收起浮动视窗中的讯息文字
function toggleMsgExpand() {
  const msgText = document.getElementById('statusMsgText');
  if (!msgText) return;
  msgText.classList.toggle('expanded');
  const indicator = msgText.querySelector('.status-expand-indicator');
  if (indicator) {
    indicator.textContent = msgText.classList.contains('expanded') ? ' ▲' : ' ▼';
  }
}

/**
 * 构建默认通用页签内容（初始展开时使用，无活跃卡片）
 */
function buildDefaultGeneralContent() {
  // 保存当前通用页签的消息和 toggle switch 状态
  const existingTextarea = document.getElementById('mini_general_msg');
  const savedMsg = existingTextarea ? existingTextarea.value : '';
  
  return `
    <span class="status-toggle"></span>
    <div class="status-text-full">
      <span class="status-msg-text">💬 浮动视窗</span>
      <div class="status-tabs" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        <button class="status-tab" data-tab="card" onclick="event.stopPropagation(); switchStatusTab('card')">卡片</button>
        <button class="status-tab active" data-tab="general" onclick="event.stopPropagation(); switchStatusTab('general')">通用</button>
        <button class="status-tab" data-tab="history" onclick="event.stopPropagation(); switchStatusTab('history')">历史</button>
      </div>
      <div class="status-tab-content status-tab-card" style="display:none;">
      </div>
      <div class="status-tab-content status-tab-general">
        <div class="status-mini-editable" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
          <textarea id="mini_general_msg"
            class="mini-textarea"
            placeholder="输入通用讯息..."
            onfocus="this.classList.add('focused'); event.stopPropagation(); var sb=document.getElementById('statusBoxInline'); if(sb&&sb._collapseTimer){clearTimeout(sb._collapseTimer);sb._collapseTimer=null;}"
            onblur="if(!dropdownSelecting) { this.classList.remove('focused'); closeGeneralDropdown(); }"
            ondblclick="event.stopPropagation(); showGeneralMsgDropdown(this);"
            onmousedown="event.stopPropagation()"
            onclick="event.stopPropagation()"
            onpaste="event.stopPropagation(); handlePasteGeneral(event); setTimeout(() => { renderGeneralAttachments(); }, 100)"
            ondragover="event.stopPropagation(); event.preventDefault()"
            ondragleave="event.stopPropagation()"
            ondrop="event.stopPropagation(); event.preventDefault(); handleDropGeneral(event); setTimeout(() => { renderGeneralAttachments(); }, 100)"
            onkeydown="event.stopPropagation(); handleGeneralTextareaKeydown(event, this);"
          >${escapeHtml(savedMsg)}</textarea>
          <div id="generalMsgDropdown" class="general-dropdown" style="display:none;"></div>
          <div class="mini-editbar" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
            <button class="mini-file-btn" onclick="event.stopPropagation(); document.getElementById('mini_general_file').click()" title="粘贴附件（最多10个）">📎</button>
            <input type="file" id="mini_general_file" style="display:none"
              onchange="event.stopPropagation(); miniHandleFileSelectGeneral(this)"
              accept="image/*,.pdf,.doc,.docx,.txt,.json,.csv" multiple />
            <span class="mini-att-count" id="mini_general_att_count">0/10</span>
            <button class="mini-copy-btn" onclick="event.stopPropagation(); miniCopyGeneralMsg()" title="复制讯息">📋</button>
            <button class="mini-clear-btn" onclick="event.stopPropagation(); miniClearGeneralAll()" title="清除讯息和附件">✕</button>
            <button class="mini-send-btn" onclick="event.stopPropagation(); miniSendGeneral()" title="调用 sendToCard(message, attachments)：解析讯息匹配卡片名称，设置讯息与附件到该卡片，自动执行继续对话">发送</button>
          </div>
          <div class="mini-attachments" id="mini_general_att" style="display:none;"></div>
          <div class="mini-email-recipients" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
            <span class="mini-email-label">收件人</span>
            <input type="text" id="mini_email_recipients" class="mini-email-input" placeholder="输入邮箱地址，多个用逗号分隔（收到AI回复后自动发送）" value="" oninput="floatEmailRecipients=this.value; localStorage.setItem('floatEmailRecipients', this.value)" ondblclick="event.stopPropagation(); showRecipientDropdown();" onblur="if(!dropdownSelecting) { closeRecipientDropdown(); }" />
            <div id="recipientDropdown" class="general-dropdown" style="display:none;"></div>
          </div>
          <div class="mini-toggle-container">
            <span class="mini-toggle-label">当下页签</span>
            <input type="checkbox" id="mini_auto_switch_general" class="mini-toggle-switch" ${autoScheduleMode['general'] ? 'checked' : ''} onchange="event.stopPropagation(); toggleAutoScheduleMode('general', this.checked)" />
            <span class="mini-toggle-label">自动调度</span>
            <button class="mini-path-btn" onclick="event.stopPropagation(); showExecutionPath()" title="查看执行路径">📝 路径</button>
          </div>
        </div>
      </div>
      <div class="status-tab-content status-tab-history" style="display:none;">
        <div class="status-history-toolbar" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
          <input id="historySearchInput" type="text" placeholder=" 搜索消息内容、卡片名称或收件人..." oninput="event.stopPropagation(); renderMessageHistory(this.value);" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" />
          <div style="position: relative; display: inline-block;">
            <button onclick="event.stopPropagation(); toggleClearDropdown();" title="清空历史记录">清空</button>
            <div id="clearHistoryDropdown" style="display: none; position: absolute; top: 100%; right: 0; margin-top: 4px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10001; min-width: 120px; padding: 4px 0;">
              <div onclick="event.stopPropagation(); clearHistoryByType('系统'); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">清空 系统讯息</div>
              <div onclick="event.stopPropagation(); clearHistoryByType('通用'); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #334155;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">清空 通用讯息</div>
              <div onclick="event.stopPropagation(); clearMessageHistory(); toggleClearDropdown();" style="padding: 6px 12px; font-size: 12px; cursor: pointer; color: #dc2626; border-top: 1px solid #f1f5f9;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">清空 全部讯息</div>
            </div>
          </div>
        </div>
        <div id="mini_history_list" class="mini-history-list"></div>
        <div id="mini_history_empty" class="mini-history-empty" style="display:none;">暂无历史记录</div>
      </div>
    </div>
    <div class="status-resize-handle"></div>
  `;
}

//  通用页签：附件数据（独立于卡片）
let generalAttachments = [];
//  浮动视窗：邮件收件人（逗号分隔的多个邮箱地址），从 localStorage 恢复
let floatEmailRecipients = localStorage.getItem('floatEmailRecipients') || '';


// 🆕 聊天气泡右键菜单
let _chatContextMenuEl = null;

function showChatBubbleContextMenu(e, answer, bookmarkName, question) {
  // 移除旧菜单
  if (_chatContextMenuEl) {
    _chatContextMenuEl.remove();
    _chatContextMenuEl = null;
  }

  const menu = document.createElement('div');
  menu.style.cssText = `
    position: fixed;
    left: ${e.clientX}px;
    top: ${e.clientY}px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    padding: 4px 0;
    z-index: 99999;
    min-width: 160px;
    font-size: 13px;
  `;

  const items = [
    { label: '📧 发出邮件', action: async () => {
      const recipients = await showEmailRecipientDialog('');
      if (!recipients || !recipients.trim()) return;
      const result = await sendEmailViaPlugin(recipients, `[AI回复] ${bookmarkName}`, answer);
      if (result.success) {
        const statusMsg = `📧 邮件发送成功（${recipients}）`;
        showStatus(statusMsg, 'success', undefined, true);
        addFloatHistoryEntry({ source: '系统', type: 'success', message: statusMsg, recipients });
      } else {
        const statusMsg = ` 邮件发送失败：${result.message}`;
        showStatus(statusMsg, 'error', undefined, true);
        addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients });
      }
    }},
    { label: '📋 复制内容', action: () => {
      navigator.clipboard.writeText(answer).then(() => {
        showStatus('📋 已复制到剪贴板', 'success');
      });
    }},
  ];

  items.forEach(item => {
    const div = document.createElement('div');
    div.textContent = item.label;
    div.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      transition: background 0.15s;
    `;
    div.addEventListener('mouseenter', () => { div.style.background = '#f1f5f9'; });
    div.addEventListener('mouseleave', () => { div.style.background = 'transparent'; });
    div.addEventListener('click', () => {
      menu.remove();
      _chatContextMenuEl = null;
      item.action();
    });
    menu.appendChild(div);
  });

  document.body.appendChild(menu);
  _chatContextMenuEl = menu;

  // 点击其他地方关闭菜单
  const closeHandler = () => {
    menu.remove();
    _chatContextMenuEl = null;
    document.removeEventListener('click', closeHandler);
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}
// 🆕 通用页签：历史消息记录（支持上下键导航）
let generalHistory = [];
let generalHistoryIndex = -1;
const MAX_HISTORY_SIZE = 50;

// 🆕 通用页签：上下键导航历史消息
function miniNavigateHistory(direction) {
  const textarea = document.getElementById('mini_general_msg');
  const emailInput = document.getElementById('mini_email_recipients');
  if (!textarea || generalHistory.length === 0) return;
  
  let entry = null;
  if (direction === -1) {
    // 上键：查看上一条历史
    if (generalHistoryIndex < generalHistory.length - 1) {
      generalHistoryIndex++;
      entry = generalHistory[generalHistoryIndex];
    }
  } else {
    // 下键：查看下一条历史
    if (generalHistoryIndex > 0) {
      generalHistoryIndex--;
      entry = generalHistory[generalHistoryIndex];
    } else if (generalHistoryIndex === 0) {
      // 回到最开始，清空输入框
      generalHistoryIndex = -1;
      textarea.value = '';
      if (emailInput) {
        emailInput.value = floatEmailRecipients;
      }
    }
  }

  if (entry) {
    textarea.value = entry.message || '';
    if (emailInput) {
      emailInput.value = entry.recipients || '';
      floatEmailRecipients = entry.recipients || '';
    }
  }

  // 将光标移到末尾
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// 🆕 卡片页签：历史消息记录（每个卡片独立）
let cardHistory = {};  // { index: { history: [], index: -1 } }

// 🆕 浮动视窗：历史记录（系统消息 + 发送记录）
let floatHistory = [];
const MAX_FLOAT_HISTORY = 150;
const FLOAT_HISTORY_STORAGE_KEY = 'floatingWindowMessageHistory';

async function saveFloatHistory() {
  try {
    if (window.electronAPI && window.electronAPI.savePluginData) {
      await window.electronAPI.savePluginData('float-history', floatHistory);
    } else {
      localStorage.setItem(FLOAT_HISTORY_STORAGE_KEY, JSON.stringify(floatHistory));
    }
  } catch (error) {
    console.warn('[History] 保存浮动视窗历史失败:', error);
  }
}

async function loadFloatHistory() {
  try {
    let data = [];
    
    if (window.electronAPI && window.electronAPI.loadPluginData) {
      const result = await window.electronAPI.loadPluginData('float-history');
      if (result && result.success && Array.isArray(result.data)) {
        data = result.data;
        console.log(`[History] 从 JSON 文件加载浮动视窗历史: ${data.length} 条`);
      }
    }
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      const raw = localStorage.getItem(FLOAT_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          data = parsed;
          if (window.electronAPI && window.electronAPI.savePluginData) {
            await window.electronAPI.savePluginData('float-history', data);
            localStorage.removeItem(FLOAT_HISTORY_STORAGE_KEY);
            console.log('[History] 浮动视窗历史已从 localStorage 迁移到 JSON 文件');
          }
        }
      }
    }
    
    if (Array.isArray(data)) {
      // 为旧数据补 timestamp，确保排序稳定
      const now = Date.now();
      floatHistory = data.slice(0, MAX_FLOAT_HISTORY).map((entry, idx) => {
        if (entry.timestamp) return entry;
        const parsed = entry.time ? new Date(entry.time).getTime() : 0;
        return {
          ...entry,
          timestamp: parsed || (now - (data.length - idx) * 1000)
        };
      });
    }
  } catch (error) {
    console.warn('[History] 加载浮动视窗历史失败:', error);
    floatHistory = [];
  }
}

function addFloatHistoryEntry(entry) {
  if (!entry || (!entry.message && !entry.cardName && !entry.recipients)) return;
  const historyEntry = {
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    type: entry.type || 'info',
    source: entry.source || '系统',
    cardName: entry.cardName || '',
    recipients: entry.recipients || '',
    message: entry.message || '',
    timestamp: Date.now()
  };
  floatHistory.push(historyEntry);
  if (floatHistory.length > MAX_FLOAT_HISTORY) {
    floatHistory = floatHistory.slice(-MAX_FLOAT_HISTORY);
  }
  saveFloatHistory();
  const activeHistoryTab = document.querySelector('.status-tab.active[data-tab="history"]');
  if (activeHistoryTab) {
    renderMessageHistory(document.getElementById('historySearchInput')?.value || '');
  }
}

function renderMessageHistory(filter = '') {
  const list = document.getElementById('mini_history_list');
  const empty = document.getElementById('mini_history_empty');
  if (!list) return;
  const query = (filter || '').trim().toLowerCase();
  const items = floatHistory.filter(entry => {
    if (!query) return true;
    return entry.message.toLowerCase().includes(query)
      || (entry.cardName && entry.cardName.toLowerCase().includes(query))
      || (entry.recipients && entry.recipients.toLowerCase().includes(query))
      || entry.source.toLowerCase().includes(query)
      || entry.type.toLowerCase().includes(query);
  }).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  list.innerHTML = items.map(entry => `
    <div class="mini-history-item">
      <div class="mini-history-item-header">
        <span class="mini-history-item-time">${escapeHtml(entry.time)}</span>
        <span class="mini-history-item-source">${escapeHtml(entry.source)}</span>
        ${entry.cardName ? `<span class="mini-history-item-card">卡片：${escapeHtml(entry.cardName)}</span>` : ''}
      </div>
      <div class="mini-history-item-message">${escapeHtml(entry.message)}</div>
      ${entry.recipients ? `<div class="mini-history-item-detail">收件人：${escapeHtml(entry.recipients)}</div>` : ''}
    </div>`).join('');
  if (empty) {
    empty.style.display = items.length === 0 ? '' : 'none';
  }
}

function clearMessageHistory() {
  floatHistory = [];
  saveFloatHistory();
  renderMessageHistory(document.getElementById('historySearchInput')?.value || '');
  showStatus('✅ 已删除所有浮动视窗历史记录', 'success', undefined, true);
}

// 切换清空下拉选单
function toggleClearDropdown() {
  const dropdown = document.getElementById('clearHistoryDropdown');
  if (!dropdown) return;
  if (dropdown.style.display === 'none' || !dropdown.style.display) {
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
}

// 按类型清空历史记录
function clearHistoryByType(type) {
  if (type === '系统') {
    floatHistory = floatHistory.filter(entry => entry.source !== '系统');
    saveFloatHistory();
    renderMessageHistory(document.getElementById('historySearchInput')?.value || '');
    showStatus('✅ 已清空系统讯息', 'success', undefined, true);
  } else if (type === '通用') {
    floatHistory = floatHistory.filter(entry => entry.source !== '通用');
    saveFloatHistory();
    renderMessageHistory(document.getElementById('historySearchInput')?.value || '');
    showStatus('✅ 已清空通用讯息', 'success', undefined, true);
  }
}

// 导出到 window，供 HTML onclick 访问
window.toggleClearDropdown = toggleClearDropdown;
window.clearHistoryByType = clearHistoryByType;

function saveFloatingCardSendHistory(index) {
  const textarea = document.getElementById(`mini_msg_${index}`);
  const message = textarea ? textarea.value.trim() : '';
  if (!message) return;
  const card = bookmarks[index];
  addFloatHistoryEntry({
    type: 'sent',
    source: '卡片',
    cardName: (card && card.name) ? card.name : '',
    recipients: '',
    message
  });
}

// 🆕 卡片页签：保存历史消息
function saveCardHistory(index, message) {
  if (!cardHistory[index]) {
    cardHistory[index] = { history: [], index: -1 };
  }
  // 移除重复的历史记录
  cardHistory[index].history = cardHistory[index].history.filter(h => h !== message);
  // 添加到开头
  cardHistory[index].history.unshift(message);
  // 限制历史记录数量
  if (cardHistory[index].history.length > MAX_HISTORY_SIZE) {
    cardHistory[index].history = cardHistory[index].history.slice(0, MAX_HISTORY_SIZE);
  }
  // 重置历史索引
  cardHistory[index].index = -1;
}

// 🆕 卡片页签：上下键导航历史消息
function miniNavigateCardHistory(index, direction) {
  const textarea = document.getElementById(`mini_msg_${index}`);
  if (!textarea || !cardHistory[index] || cardHistory[index].history.length === 0) return;
  
  if (direction === -1) {
    // 上键：查看上一条历史
    if (cardHistory[index].index < cardHistory[index].history.length - 1) {
      cardHistory[index].index++;
      textarea.value = cardHistory[index].history[cardHistory[index].index];
    }
  } else {
    // 下键：查看下一条历史
    if (cardHistory[index].index > 0) {
      cardHistory[index].index--;
      textarea.value = cardHistory[index].history[cardHistory[index].index];
    } else if (cardHistory[index].index === 0) {
      // 回到最开始，清空输入框
      cardHistory[index].index = -1;
      textarea.value = '';
    }
  }
  // 将光标移到末尾
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// 🆕 通用页签：渲染附件缩略图
function renderGeneralAttachments() {
  const container = document.getElementById('mini_general_att');
  const countSpan = document.getElementById('mini_general_att_count');
  if (!container) return;
  if (countSpan) countSpan.textContent = `${generalAttachments.length}/10`;
  if (generalAttachments.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'flex';
  const thumbs = generalAttachments.map((att, attIdx) => {
    const isImage = att.type && att.type.startsWith('image/');
    const tooltip = `${att.name} (${(att.size / 1024).toFixed(1)}KB)`;
    if (isImage) {
      return `<span class="mini-att-thumb" title="${escapeHtml(tooltip)}" onclick="previewGeneralAttachment(${attIdx})">
        <img src="${att.data}" alt="${escapeHtml(att.name)}" />
        <button class="mini-att-rm" onclick="event.stopPropagation(); miniRemoveGeneralAttachment(${attIdx})" title="移除">✕</button>
      </span>`;
    } else {
      return `<span class="mini-att-thumb mini-att-file" title="${escapeHtml(tooltip)}">
        📎 ${escapeHtml(att.name.substring(0, 6))}
        <button class="mini-att-rm" onclick="event.stopPropagation(); miniRemoveGeneralAttachment(${attIdx})" title="移除">✕</button>
      </span>`;
    }
  }).join('');
  container.innerHTML = thumbs;
}

// 🆕 通用页签：预览附件
function previewGeneralAttachment(attIdx) {
  if (attIdx < 0 || attIdx >= generalAttachments.length) return;
  const att = generalAttachments[attIdx];
  if (att.type && att.type.startsWith('image/')) {
    const w = window.open('');
    if (w) w.document.write(`<img src="${att.data}" style="max-width:100%;" />`);
  }
}

// 🆕 通用页签：移除附件
function miniRemoveGeneralAttachment(attIdx) {
  if (attIdx < 0 || attIdx >= generalAttachments.length) return;
  generalAttachments.splice(attIdx, 1);
  renderGeneralAttachments();
}

// 🆕 通用页签：处理文件选择
function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      resolve(e.target.result);
    };
    reader.readAsDataURL(file);
  });
}

async function miniHandleFileSelectGeneral(fileInput) {
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;
  for (const file of files) {
    if (generalAttachments.length >= 10) break;
    const data = await readFileAsDataURL(file);
    generalAttachments.push({
      name: file.name,
      size: file.size,
      type: file.type,
      data: data,
      path: file.path || file.webkitRelativePath || ''
    });
  }
  fileInput.value = '';
  renderGeneralAttachments();
}

// 🆕 通用页签：处理粘贴
function handlePasteGeneral(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file && generalAttachments.length < 10) {
        const reader = new FileReader();
        reader.onload = function(e) {
          generalAttachments.push({
            name: `粘贴图片_${Date.now()}.png`,
            size: file.size,
            type: file.type,
            data: e.target.result
          });
          renderGeneralAttachments();
        };
        reader.readAsDataURL(file);
      }
    }
  }
}

// 🆕 通用页签：处理拖拽
async function handleDropGeneral(event) {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    if (generalAttachments.length >= 10) break;
    const data = await readFileAsDataURL(file);
    generalAttachments.push({
      name: file.name,
      size: file.size,
      type: file.type,
      data: data
    });
  }
}

// 🆕 通用页签：复制讯息
function miniCopyGeneralMsg() {
  const textarea = document.getElementById('mini_general_msg');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.mini-copy-btn[onclick*="miniCopyGeneralMsg"]');
      if (btn) {
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = '📋'; }, 1000);
      }
    }).catch(() => {
      textarea.select();
    });
  }
}

// 🆕 通用页签：清除讯息和附件
function miniClearGeneralAll() {
  const textarea = document.getElementById('mini_general_msg');
  if (textarea) textarea.value = '';
  generalAttachments = [];
  renderGeneralAttachments();
}

//  网点卡片「发送」按钮：将预设消息填入通用页签并切换过去
function sendToGeneralTab(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;

  //  大模型 API 类型：通过 API Key 直接调用大模型
  if (bookmark.type === 'llm-api') {
    crawlBookmarkByIndex(index);
    return;
  }

  // HTTP Get 分类：保存股票代号并执行 HTTP GET 请求
  if (bookmark.category === 'http-get') {
    const cardTextarea = document.getElementById(`presetMsg_${index}`);
    const stockCodes = cardTextarea ? cardTextarea.value.trim() : '';
    // 保存股票代号到 presetMessage
    bookmark.presetMessage = stockCodes;
    saveBookmarksToStorage();
    executeHttpGet(index, stockCodes);
    return;
  }

  // 优先读取卡片上当前输入的讯息（未保存的），其次才是已保存的预设消息
  const cardTextarea = document.getElementById(`presetMsg_${index}`);
  const currentMsg = cardTextarea ? cardTextarea.value.trim() : '';
  const presetMsg = currentMsg || bookmark.presetMessage || '';

  if (!presetMsg) {
    showStatus('⚠️ 请先输入消息', 'warning');
    return;
  }

  // 展开浮动视窗
  const statusBox = document.getElementById('statusBoxInline');
  if (statusBox) {
    statusBox.classList.remove('collapsed');
    statusBox.classList.add('expanded');
    statusBox._userInteracted = true;
  }

  // 切换到通用页签
  switchStatusTab('general');

  // 填入 "卡片名" 讯息
  const textarea = document.getElementById('mini_general_msg');
  if (textarea) {
    textarea.value = `"${bookmark.name}" ${presetMsg}`.trim();
  }

  // 直接执行发送（参考排程执行逻辑，不需要再按一次发送按钮）
  miniSendGeneral();
}

// 🆕 通用页签：发送（解析讯息找出对应卡片，自动执行继续对话）
async function miniSendGeneral() {
  const textarea = document.getElementById('mini_general_msg');
  const message = textarea ? textarea.value.trim() : '';
  if (!message && generalAttachments.length === 0) {
    showStatus('⚠️ 请先输入消息或添加附件', 'warning');
    return;
  }

  // 🆕 先写入通用讯息历史记录（此时 timestamp 最早，符合实际动作时序）
  const historyMessage = message || '📎 附件发送';
  addFloatHistoryEntry({
    type: 'sent',
    source: '通用',
    cardName: '',
    recipients: floatEmailRecipients || '',
    message: historyMessage
  });
  if (message) {
    // 移除重复的历史记录
    generalHistory = generalHistory.filter(h => h.message !== message || h.recipients !== (floatEmailRecipients || ''));
    // 添加到开头
    generalHistory.unshift({ message, recipients: floatEmailRecipients || '' });
    // 限制历史记录数量
    if (generalHistory.length > MAX_HISTORY_SIZE) {
      generalHistory = generalHistory.slice(0, MAX_HISTORY_SIZE);
    }
    // 重置历史索引
    generalHistoryIndex = -1;
  }

  // 自动调度模式：执行前自动选择工作区（通用页签）
  await autoScheduleBeforeExecute('general', message);
  // 调用统一接口，跳过自动调度（已经执行过了）
  const result = await sendToCard(message, generalAttachments, { skipAutoSchedule: true });
  if (result.ok) {
    // ✅ 已发送给：状态提示不写入历史（避免在邮件发送之后才写入，造成时序错乱）
    showStatus(`✅ 已发送给「${result.cardName}」`, 'success', result.index, true);

    // 🆕 补登通用讯息历史记录（带上匹配到的卡片名）
    if (result.cardName) {
      const lastEntry = floatHistory[floatHistory.length - 1];
      if (lastEntry && lastEntry.source === '通用' && lastEntry.message === historyMessage && !lastEntry.cardName) {
        lastEntry.cardName = result.cardName;
        saveFloatHistory();
      }
    }

    // 清空通用页签
    if (textarea) textarea.value = '';
    generalAttachments = [];
    renderGeneralAttachments();
    // 发送成功后折叠浮动视窗
    collapseFloatingWindow();
  } else {
    showStatus(`❌ ${result.error}`, 'error');
  }
}

// 🆕 通用页签 textarea 键盘事件处理（问号触发下拉 + 下拉打开时键盘导航）
function handleGeneralTextareaKeydown(event, textarea) {
  // 通过 textarea 的下一个兄弟元素获取对应的 dropdown（避免多个同名 ID 冲突）
  const dropdown = textarea.nextElementSibling;
  const isOpen = dropdown && dropdown.classList.contains('general-dropdown') && dropdown.style.display !== 'none';

  if (isOpen) {
    // 下拉已打开，处理键盘导航
    const items = dropdown.querySelectorAll('.dropdown-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      window._dropdownKeyboardIndex = Math.min(window._dropdownKeyboardIndex + 1, items.length - 1);
      items.forEach((item, idx) => item.classList.toggle('highlighted', idx === window._dropdownKeyboardIndex));
      items[window._dropdownKeyboardIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      window._dropdownKeyboardIndex = Math.max(window._dropdownKeyboardIndex - 1, 0);
      items.forEach((item, idx) => item.classList.toggle('highlighted', idx === window._dropdownKeyboardIndex));
      items[window._dropdownKeyboardIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeGeneralDropdown();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.isComposing) {
      event.preventDefault();
      const idx = window._dropdownKeyboardIndex || 0;
      if (idx >= 0 && idx < items.length) {
        window.selectGeneralMsg(idx);
      }
    }
  } else {
    // 下拉未打开，检测问号触发（支持半角 ? 和全角 ？）
    if ((event.key === '?' || event.key === '？') && textarea.value.trim() === '') {
      event.preventDefault();
      showGeneralMsgDropdown(textarea);
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.isComposing) {
      event.preventDefault();
      miniSendGeneral();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (typeof miniNavigateHistory === 'function') miniNavigateHistory(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (typeof miniNavigateHistory === 'function') miniNavigateHistory(1);
    }
  }
}

// 🆕 通用页签：显示讯息历史下拉选单
function showGeneralMsgDropdown(textarea) {
  // 定位当前触发双击的 textarea 及其对应的下拉选单（避免页面中有多个同名 ID）
  const targetTextarea = textarea || document.querySelector('#mini_general_msg:focus') || document.querySelector('#mini_general_msg');
  if (!targetTextarea) return;
  const dropdown = targetTextarea.nextElementSibling;
  if (!dropdown || !dropdown.classList.contains('general-dropdown')) return;

  // 先移除旧的 document 监听
  if (window._generalMsgDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._generalMsgDropdownOutsideHandler);
    window._generalMsgDropdownOutsideHandler = null;
  }

  // 每次双击都重新从 floatHistory 读取，按时间戳降序排列，按讯息内容去重
  const generalEntries = floatHistory
    .filter(entry => (entry.source === '通用' || (!entry.source && !entry.cardName)) && (entry.message || '').trim())
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const uniqueMap = new Map();
  generalEntries.forEach(entry => {
    const key = (entry.message || '').trim();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, entry);
    }
  });
  const uniqueEntries = Array.from(uniqueMap.values());

  if (uniqueEntries.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">暂无历史记录</div>';
  } else {
    dropdown.innerHTML = uniqueEntries.map((entry, idx) => `
      <div class="dropdown-item" onmousedown="event.stopPropagation(); event.preventDefault(); window.selectGeneralMsg(${idx});" title="${escapeHtml(entry.message)}">
        <div class="dropdown-item-time">${escapeHtml(entry.time)}</div>
        <div class="dropdown-item-content">${escapeHtml(entry.message)}</div>
        ${entry.recipients ? `<div class="dropdown-item-recipients"> ${escapeHtml(entry.recipients)}</div>` : ''}
      </div>
    `).join('');
  }

  // 使用 fixed 定位，避免被父层 overflow:hidden 裁切，并启用滚动
  dropdown.style.position = 'fixed';
  dropdown.style.zIndex = '10000';
  dropdown.style.maxHeight = '300px';
  dropdown.style.overflowY = 'auto';
  const rect = targetTextarea.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.style.display = 'block';

  // 点击下拉选单内部不关闭，点击外部关闭
  dropdown.onmousedown = function(e) { e.stopPropagation(); e.preventDefault(); };

  // 延迟绑定 document mousedown，避免本次双击立即触发关闭
  setTimeout(() => {
    window._generalMsgDropdownOutsideHandler = function(e) {
      if (dropdown.contains(e.target)) return;
      if (targetTextarea.contains(e.target)) return;
      closeGeneralDropdown();
    };
    document.addEventListener('mousedown', window._generalMsgDropdownOutsideHandler);
  }, 0);

  // 🆕 初始化键盘导航索引，高亮第一个选项
  window._dropdownKeyboardIndex = 0;
  const items = dropdown.querySelectorAll('.dropdown-item');
  if (items.length > 0) {
    items[0].classList.add('highlighted');
  }
}

// 🆕 通用页签：选择讯息
function selectGeneralMsg(index) {
  // 与 showGeneralMsgDropdown 使用同样的去重逻辑
  const generalEntries = floatHistory
    .filter(entry => (entry.source === '通用' || (!entry.source && !entry.cardName)) && (entry.message || '').trim())
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const uniqueMap = new Map();
  generalEntries.forEach(entry => {
    const key = (entry.message || '').trim();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, entry);
    }
  });
  const uniqueEntries = Array.from(uniqueMap.values());
  const entry = uniqueEntries[index];
  if (!entry) return;
  
  // 找到可见的 textarea（处理重复 ID 的情况）
  const textareas = document.querySelectorAll('#mini_general_msg');
  const textarea = Array.from(textareas).find(el => {
    const parent = el.closest('.status-tab-content');
    return parent && parent.style.display !== 'none';
  }) || textareas[0];
  
  if (textarea) {
    textarea.value = entry.message;
    // 同时恢复收件人
    if (entry.recipients) {
      const recipientInputs = document.querySelectorAll('#mini_email_recipients');
      const recipientInput = Array.from(recipientInputs).find(el => {
        const parent = el.closest('.status-tab-content');
        return parent && parent.style.display !== 'none';
      }) || recipientInputs[0];
      if (recipientInput) {
        recipientInput.value = entry.recipients;
        floatEmailRecipients = entry.recipients;
        localStorage.setItem('floatEmailRecipients', entry.recipients);
      }
    }
  }
  
  closeGeneralDropdown();
  // 重置标志位
  setTimeout(() => { dropdownSelecting = false; }, 100);
}

// 🆕 通用页签：关闭讯息下拉选单
function closeGeneralDropdown() {
  document.querySelectorAll('#generalMsgDropdown').forEach(dropdown => {
    dropdown.style.cssText = 'display:none;';
  });
  if (window._generalMsgDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._generalMsgDropdownOutsideHandler);
    window._generalMsgDropdownOutsideHandler = null;
  }
  // 🆕 清理键盘导航监听
  if (window._dropdownKeyboardHandler) {
    document.removeEventListener('keydown', window._dropdownKeyboardHandler);
    window._dropdownKeyboardHandler = null;
  }
  window._dropdownKeyboardIndex = 0;
}

//  通用页签：显示收件人历史下拉选单
function showRecipientDropdown() {
  const dropdown = document.getElementById('recipientDropdown');
  if (!dropdown) return;

  // 先移除旧的 document 监听
  if (window._recipientDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._recipientDropdownOutsideHandler);
    window._recipientDropdownOutsideHandler = null;
  }

  // 筛选 source='通用' 且有收件人的历史记录
  const generalEntries = floatHistory.filter(entry => entry.source === '通用' && entry.recipients);

  // 去重：按收件人地址去重，保留最新的记录
  const uniqueMap = new Map();
  generalEntries.forEach(entry => {
    if (!uniqueMap.has(entry.recipients)) {
      uniqueMap.set(entry.recipients, entry);
    }
  });
  const uniqueEntries = Array.from(uniqueMap.values());

  if (uniqueEntries.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">暂无历史记录</div>';
  } else {
    dropdown.innerHTML = uniqueEntries.map((entry, idx) => `
      <div class="dropdown-item" onmousedown="event.stopPropagation(); event.preventDefault(); window.selectRecipient(${idx});" title="${escapeHtml(entry.recipients)}">
        <div class="dropdown-item-time">${escapeHtml(entry.time)}</div>
        <div class="dropdown-item-content">${escapeHtml(entry.recipients)}</div>
      </div>
    `).join('');
  }

  dropdown.style.display = 'block';

  // 点击下拉选单内部不关闭
  dropdown.onmousedown = function(e) { e.stopPropagation(); e.preventDefault(); };

  // 延迟绑定 document mousedown，避免本次双击立即触发关闭
  setTimeout(() => {
    window._recipientDropdownOutsideHandler = function(e) {
      if (dropdown.contains(e.target)) return;
      const input = document.getElementById('mini_email_recipients');
      if (input && input.contains(e.target)) return;
      closeRecipientDropdown();
    };
    document.addEventListener('mousedown', window._recipientDropdownOutsideHandler);
  }, 0);
}

// 🆕 通用页签：选择收件人
function selectRecipient(index) {
  const generalEntries = floatHistory.filter(entry => entry.source === '通用' && entry.recipients);
  
  // 去重：按收件人地址去重，保留最新的记录
  const uniqueMap = new Map();
  generalEntries.forEach(entry => {
    if (!uniqueMap.has(entry.recipients)) {
      uniqueMap.set(entry.recipients, entry);
    }
  });
  const uniqueEntries = Array.from(uniqueMap.values());
  
  const entry = uniqueEntries[index];
  if (!entry) return;
  
  // 找到可见的收件人输入框（处理重复 ID 的情况）
  const recipientInputs = document.querySelectorAll('#mini_email_recipients');
  const recipientInput = Array.from(recipientInputs).find(el => {
    const parent = el.closest('.status-tab-content');
    return parent && parent.style.display !== 'none';
  }) || recipientInputs[0];
  
  if (recipientInput) {
    recipientInput.value = entry.recipients;
    floatEmailRecipients = entry.recipients;
    localStorage.setItem('floatEmailRecipients', entry.recipients);
  }
  
  closeRecipientDropdown();
  // 重置标志位
  setTimeout(() => { dropdownSelecting = false; }, 100);
}

//  通用页签：关闭收件人下拉选单
function closeRecipientDropdown() {
  const dropdowns = document.querySelectorAll('#recipientDropdown');
  dropdowns.forEach(d => { d.style.display = 'none'; });
  if (window._recipientDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._recipientDropdownOutsideHandler);
    window._recipientDropdownOutsideHandler = null;
  }
}

// 挂载到 window 以便 onclick 内联事件调用
window.selectGeneralMsg = selectGeneralMsg;
window.selectRecipient = selectRecipient;
window.showGeneralMsgDropdown = showGeneralMsgDropdown;
window.showRecipientDropdown = showRecipientDropdown;
window.closeGeneralDropdown = closeGeneralDropdown;
window.closeRecipientDropdown = closeRecipientDropdown;
window.handleGeneralTextareaKeydown = handleGeneralTextareaKeydown;

// 🆕 防止 blur 时关闭下拉菜单的标志位（必须用 window 属性，因为 inline onblur 在全局作用域引用）
window.dropdownSelecting = false;

// 将关键 let/const 变量挂载到 window，确保其他模组（email.js, scheduler.js, renderer.js 等）
// 通过 window.xxx 或直接变量名访问时都能正确读写（getter/setter 闭包持有真实变量引用）
Object.defineProperty(window, 'floatHistory', { get: () => floatHistory, set: v => { floatHistory = v; }, configurable: true });
Object.defineProperty(window, 'generalAttachments', { get: () => generalAttachments, set: v => { generalAttachments = v; }, configurable: true });
Object.defineProperty(window, 'floatEmailRecipients', { get: () => floatEmailRecipients, set: v => { floatEmailRecipients = v; }, configurable: true });
Object.defineProperty(window, 'generalHistory', { get: () => generalHistory, set: v => { generalHistory = v; }, configurable: true });
Object.defineProperty(window, 'generalHistoryIndex', { get: () => generalHistoryIndex, set: v => { generalHistoryIndex = v; }, configurable: true });
Object.defineProperty(window, 'cardHistory', { get: () => cardHistory, set: v => { cardHistory = v; }, configurable: true });
Object.defineProperty(window, 'currentActiveCardIndex', { get: () => currentActiveCardIndex, set: v => { currentActiveCardIndex = v; }, configurable: true });
Object.defineProperty(window, 'workspaceActiveCards', { get: () => workspaceActiveCards, configurable: true });
