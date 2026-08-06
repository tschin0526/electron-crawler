/**
 * 工作区管理与活动监控模组
 * 从 renderer.js 拆分而来
 * 包含：工作区切换、展开视图、活动监控、Markdown渲染、DOM树查看
 * 依赖：showStatus, bookmarks, workspaces, addFloatHistoryEntry, floatHistory（来自其他模组）
 */
let currentWorkspaceId = 'MAIN';

// 获取按正确顺序排列的工作区 ID 列表：MAIN, 01, 02, ..., 20
function getSortedWorkspaceIds() {
  const ids = Object.keys(workspaces);
  const main = ids.filter(id => id === 'MAIN');
  const numeric = ids.filter(id => id !== 'MAIN');
  numeric.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return main.concat(numeric);
}

function initWorkspaceContainers() {
  const container = document.getElementById('dataContainer');
  if (!container) return;

  // 为每个工作区创建独立的 div，按正确顺序（MAIN, 01, 02, ..., 20）
  getSortedWorkspaceIds().forEach(wsId => {
    const wsDiv = document.createElement('div');
    wsDiv.setAttribute('data-ws', wsId);
    wsDiv.className = 'workspace-panel';
    wsDiv.style.display = wsId === 'MAIN' ? 'block' : 'none';
    wsDiv.style.position = 'relative';
    
    // 为每个工作区创建 webview（隐藏状态），确保 hover 时能捕获截图
    const wsSuffix = wsId !== 'MAIN' ? `-${wsId}` : '';
    const webviewId = `previewWebview${wsSuffix}`;
    const containerId = `webviewContainer${wsSuffix}`;
    
    wsDiv.innerHTML = `
      <div class="ws-expand-header" data-ws-header="${wsId}" onclick="onExpandHeaderClick('${wsId}')">
        <span class="ws-expand-dot idle"></span>
        <span class="ws-expand-name">${wsId}</span>
        <span class="ws-expand-status">空闲</span>
        <button class="ws-expand-close" data-ws-close="${wsId}" onclick="event.stopPropagation(); closeWorkspace('${wsId}')" title="关闭工作区">✕</button>
      </div>
      <div class="ws-expand-body">
        <div class="ai-workspace-empty" id="empty-${wsId}">
          <span>💬</span>
          <p>点击上方的 AI 网点卡片开始对话</p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">当前工作区: ${wsId}</p>
        </div>
        <div class="webview-container" id="${containerId}" style="display: none;">
          <div class="webview-toolbar">
            <div class="toolbar-scroll-container">
              <input type="text" id="webviewUrlInput${wsSuffix}" placeholder="网址..." />
              <button class="toolbar-btn" onclick="loadWebviewUrl()">加载</button>
              <button class="toolbar-btn" onclick="refreshWebview()" title="刷新">刷新</button>
              <button class="toolbar-btn" onclick="goBackWebview()" title="后退">后退</button>
              <button class="toolbar-btn" onclick="goForwardWebview()" title="前进">前进</button>
              <button class="toolbar-btn toolbar-btn-green" id="manualMonitorBtn${wsSuffix}" onclick="toggleMonitorDropdown('${wsId}')" title="获取元素内容">获取 </button>
              <button class="toolbar-btn toolbar-btn-gray" id="activityMonitorBtn${wsSuffix}" onclick="toggleActivityMonitor()" title="点击后开始监控网页活动" style="position: relative;">监控</button>
              <button class="toolbar-btn toolbar-btn-purple" onclick="openDomTreeView()" title="查看 DOM 树形结构">DOM</button>
              <button class="toolbar-btn" id="zoomModeBtn${wsSuffix}" onclick="toggleWorkspaceZoomMode('${wsId}')" title="切换显示模式：视口/缩放" style="background: #fce7f3; color: #be185d;">视口</button>
              <button class="toolbar-btn" onclick="zoomWorkspace('${wsId}', 1.1)" title="放大窗口">+</button>
              <button class="toolbar-btn" onclick="zoomWorkspace('${wsId}', 0.9)" title="缩小窗口">−</button>
              <button class="toolbar-btn toolbar-btn-red" onclick="closeWorkspace('${wsId}')" title="关闭工作区">✕</button>
            </div>
          </div>
          <div id="webviewWrapper${wsSuffix}" style="width: 100%; height: calc(100% - 32px); overflow: hidden;">
            <div class="webview-loading" id="webviewLoading${wsSuffix}">
              <div class="loading-spinner"></div>
              <p>正在加载网页...</p>
            </div>
            <webview
              id="${webviewId}"
              src="about:blank"
              allowpopups
              enableblinkfeatures=AutomationControlled
              disablewebsecurity
              allowrunninginsecurecontent
              preload="../preload.js"
              webpreferences="allowFileAccessFromFileUrls=true,nodeIntegration=false,contextIsolation=true"
              style="width: 100%; height: 100%;"
            ></webview>
          </div>
        </div>
      </div>
      <!-- 拖动手柄（仅缩放模式显示） -->
      <div class="resize-handle" id="resizeHandle-${wsId}" data-ws="${wsId}"></div>
    `;
    container.appendChild(wsDiv);

    // 右下角弧形粗线条描边（放在 body 下，JS 实时同步位置）
    const cornerHighlight = document.createElement('div');
    cornerHighlight.className = 'ws-corner-highlight';
    cornerHighlight.setAttribute('data-ws', wsId);
    document.body.appendChild(cornerHighlight);

    // 立即定位并显示手柄
    setTimeout(() => positionCornerHighlight(wsId), 50);

    // 为每个工作区的 webview 初始化事件监听
    const wvLoadingId = `webviewLoading${wsSuffix}`;
    setTimeout(() => initWebviewEvents(webviewId, wvLoadingId), 100);
  });

  // 初始化工作区页签的 hover/click 事件（延迟确保 DOM 就绪）
  setTimeout(() => {
    console.log('[Workspace] 初始化页签事件...');
    initWorkspaceTabEvents();
  }, 500);
}

function switchWorkspace(workspaceId) {
  if (!workspaces[workspaceId] || workspaceId === currentWorkspaceId) return;

  if (expandViewEnabled) {
    document.querySelectorAll('.workspace-panel').forEach(panel => {
      panel.classList.toggle('active-ws', panel.getAttribute('data-ws') === workspaceId);
    });
    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
    if (targetPanel) {
      targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    const currentPanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
    if (currentPanel) currentPanel.style.display = 'none';

    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
    if (targetPanel) {
      const container = document.getElementById('dataContainer');
      if (container) {
        calcStdDimensions();
        const containerRect = container.getBoundingClientRect();
        const containerW = containerRect.width;
        const panelH = wsStdH;
        
        container.style.height = (panelH + 10) + 'px';
        container.style.minHeight = (panelH + 10) + 'px';
        container.style.position = 'relative';
        
        const dataSection = document.getElementById('dataSection');
        const aiWorkspaceHeader = document.querySelector('.ai-workspace-header');
        const headerHeight = aiWorkspaceHeader ? aiWorkspaceHeader.offsetHeight : 0;
        if (dataSection) {
          dataSection.style.height = (panelH + headerHeight + 20) + 'px';
          dataSection.style.minHeight = (panelH + headerHeight + 20) + 'px';
        }
        
        targetPanel.style.setProperty('position', 'absolute', 'important');
        targetPanel.style.setProperty('left', '0', 'important');
        targetPanel.style.setProperty('top', '0', 'important');
        targetPanel.style.setProperty('right', 'auto', 'important');
        targetPanel.style.setProperty('bottom', 'auto', 'important');
        targetPanel.style.setProperty('margin', '0', 'important');
        targetPanel.style.setProperty('width', containerW + 'px', 'important');
        targetPanel.style.setProperty('height', panelH + 'px', 'important');
        targetPanel.style.setProperty('max-height', panelH + 'px', 'important');
        targetPanel.style.setProperty('transform', 'none', 'important');
        targetPanel.style.setProperty('overflow', 'hidden', 'important');
        
        const webviewContainer = targetPanel.querySelector('.webview-container');
        if (webviewContainer) {
          webviewContainer.style.setProperty('height', '100%', 'important');
          webviewContainer.style.setProperty('min-height', '0', 'important');
        }
        const wsExpandBody = targetPanel.querySelector('.ws-expand-body');
        if (wsExpandBody) {
          wsExpandBody.style.setProperty('height', '100%', 'important');
        }
      }
      targetPanel.style.display = 'block';
    }
  }

  document.querySelectorAll('.ai-workspace-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-workspace') === workspaceId);
  });

  currentWorkspaceId = workspaceId;

  const ws = workspaces[workspaceId];
  const wsBookmarkIndex = ws.bookmarkIndex;
  if (wsBookmarkIndex !== null && wsBookmarkIndex !== undefined) {
    window.currentBookmarkIndex = wsBookmarkIndex;
    window.currentReplySelector = ws.replySelector || '';
    window.__monitorHeartbeatSelector = ws.heartbeatSelector || '';
    window.__monitorReplySelector = ws.replySelector || '';
    window.__monitorTimeout = ws.monitorTimeout || 0;
    console.log(`[Workspace] 恢复工作区 ${workspaceId} 的设定: bookmarkIndex=${wsBookmarkIndex}, replySelector=${ws.replySelector || '(空)'}`);
  } else {
    window.currentBookmarkIndex = null;
    window.currentReplySelector = '';
    window.__monitorHeartbeatSelector = '';
    window.__monitorReplySelector = '';
    console.log(`[Workspace] 工作区 ${workspaceId} 无网点记录，已清除全局选择器变量`);
  }

  console.log(`[Workspace] 切换到工作区: ${workspaceId}`);
}

// 切换工作区但不恢复旧设定（用于自动调度场景，避免污染即将配置的新 AI）
function switchWorkspaceWithoutRestore(workspaceId) {
  if (!workspaces[workspaceId] || workspaceId === currentWorkspaceId) return;

  if (expandViewEnabled) {
    document.querySelectorAll('.workspace-panel').forEach(panel => {
      panel.classList.toggle('active-ws', panel.getAttribute('data-ws') === workspaceId);
    });
    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
    if (targetPanel) {
      targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    const currentPanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
    if (currentPanel) currentPanel.style.display = 'none';

    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
    if (targetPanel) {
      const container = document.getElementById('dataContainer');
      if (container) {
        calcStdDimensions();
        const containerRect = container.getBoundingClientRect();
        const containerW = containerRect.width;
        const panelH = wsStdH;
        
        container.style.height = (panelH + 10) + 'px';
        container.style.minHeight = (panelH + 10) + 'px';
        container.style.position = 'relative';
        
        const dataSection = document.getElementById('dataSection');
        const aiWorkspaceHeader = document.querySelector('.ai-workspace-header');
        const headerHeight = aiWorkspaceHeader ? aiWorkspaceHeader.offsetHeight : 0;
        if (dataSection) {
          dataSection.style.height = (panelH + headerHeight + 20) + 'px';
          dataSection.style.minHeight = (panelH + headerHeight + 20) + 'px';
        }
        
        targetPanel.style.setProperty('position', 'absolute', 'important');
        targetPanel.style.setProperty('left', '0', 'important');
        targetPanel.style.setProperty('top', '0', 'important');
        targetPanel.style.setProperty('right', 'auto', 'important');
        targetPanel.style.setProperty('bottom', 'auto', 'important');
        targetPanel.style.setProperty('margin', '0', 'important');
        targetPanel.style.setProperty('width', containerW + 'px', 'important');
        targetPanel.style.setProperty('height', panelH + 'px', 'important');
        targetPanel.style.setProperty('max-height', panelH + 'px', 'important');
        targetPanel.style.setProperty('transform', 'none', 'important');
        targetPanel.style.setProperty('overflow', 'hidden', 'important');
        
        const webviewContainer = targetPanel.querySelector('.webview-container');
        if (webviewContainer) {
          webviewContainer.style.setProperty('height', '100%', 'important');
          webviewContainer.style.setProperty('min-height', '0', 'important');
        }
        const wsExpandBody = targetPanel.querySelector('.ws-expand-body');
        if (wsExpandBody) {
          wsExpandBody.style.setProperty('height', '100%', 'important');
        }
      }
      targetPanel.style.display = 'block';

      // 🔑 强制重排，确保内部内容正确渲染
      void targetPanel.offsetHeight;

      // 🔑 桌面APP工作区：确保对话面板正确显示
      const chatPanel = targetPanel.querySelector('.desktop-app-chat-panel');
      if (chatPanel) {
        chatPanel.style.setProperty('position', 'absolute', 'important');
        chatPanel.style.setProperty('left', '0', 'important');
        chatPanel.style.setProperty('top', '0', 'important');
        chatPanel.style.setProperty('width', '100%', 'important');
        chatPanel.style.setProperty('height', '100%', 'important');
        chatPanel.style.setProperty('display', 'flex', 'important');
        chatPanel.style.setProperty('flex-direction', 'column', 'important');
        const chatMessages = chatPanel.querySelector('.chat-messages');
        if (chatMessages) {
          chatMessages.style.setProperty('flex', '1', 'important');
          chatMessages.style.setProperty('overflow-y', 'auto', 'important');
          chatMessages.style.setProperty('min-height', '0', 'important');
        }
      }
    }
  }

  document.querySelectorAll('.ai-workspace-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-workspace') === workspaceId);
  });

  currentWorkspaceId = workspaceId;

  // 不恢复旧设定，清除全局变量
  window.currentBookmarkIndex = null;
  window.currentReplySelector = '';
  window.__monitorHeartbeatSelector = '';
  window.__monitorReplySelector = '';
  window.__monitorTimeout = 0;

  // 🔑 关键修复：切换工作区后，加载该工作区的 webview URL
  const ws = workspaces[workspaceId];
  if (ws && ws.wsUrl) {
    loadWorkspaceWebview(workspaceId);
  }

  // 🔑 更新弧形手柄位置
  if (expandViewEnabled) {
    setTimeout(() => updateAllCornerHighlights(), 100);
  }
  
  console.log(`[Workspace] 切换工作区 ${workspaceId}（不恢复旧设定）`);
}

// 展开模式下点击标题栏：检查是否活跃，滚动到对应面板
function onExpandHeaderClick(workspaceId) {
  const ws = workspaces[workspaceId];
  const isActive = ws && (ws.status === 'running' || ws.status === 'waiting');
  if (!isActive) {
    showStatus('当前页签中没有活动中的页面！', 'warning');
    return;
  }
  const targetPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (targetPanel) {
    targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  switchWorkspace(workspaceId);
}

function getCurrentWorkspacePanel() {
  return document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
}

function getCurrentWebview() {
  const wsSuffix = currentWorkspaceId !== 'MAIN' ? `-${currentWorkspaceId}` : '';
  const panel = getCurrentWorkspacePanel();
  return panel ? panel.querySelector(`#previewWebview${wsSuffix}`) : null;
}

function getCurrentWebviewContainer() {
  const wsSuffix = currentWorkspaceId !== 'MAIN' ? `-${currentWorkspaceId}` : '';
  const panel = getCurrentWorkspacePanel();
  return panel ? panel.querySelector(`#webviewContainer${wsSuffix}`) : null;
}

function getCurrentWebviewUrlInput() {
  const wsSuffix = currentWorkspaceId !== 'MAIN' ? `-${currentWorkspaceId}` : '';
  const panel = getCurrentWorkspacePanel();
  return panel ? panel.querySelector(`#webviewUrlInput${wsSuffix}`) : null;
}

function getCurrentActivityMonitorBtn() {
  const wsSuffix = currentWorkspaceId !== 'MAIN' ? `-${currentWorkspaceId}` : '';
  const panel = getCurrentWorkspacePanel();
  return panel ? panel.querySelector(`#activityMonitorBtn${wsSuffix}`) : null;
}

function getCurrentWebviewLoading() {
  const wsSuffix = currentWorkspaceId !== 'MAIN' ? `-${currentWorkspaceId}` : '';
  const panel = getCurrentWorkspacePanel();
  return panel ? panel.querySelector(`#webviewLoading${wsSuffix}`) : null;
}

function updateWorkspaceStatus(workspaceId, status) {
  if (!workspaces[workspaceId]) return;
  workspaces[workspaceId].status = status;

  const dot = document.getElementById(`ws-dot-${workspaceId}`);
  if (dot) {
    dot.className = 'workspace-status-dot ' + status;
  }

  // 展开模式下，更新对应面板的状态标识，并显示/隐藏面板
  if (expandViewEnabled) {
    const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
    if (panel) {
      if (status === 'running' || status === 'waiting') {
        panel.style.display = 'block';
        // 加载该工作区的 webview URL（如果尚未加载）
        loadWorkspaceWebview(workspaceId);
        // 新面板显示后，重新应用比例（延迟确保布局完成）
        setTimeout(() => applyExpandRatio(), 50);
      } else if (status === 'idle') {
        panel.style.display = 'none';
      }
    }
    updateExpandHeaders();
  }
}

// 加载指定工作区的 webview（用于展开模式下显示非当前工作区的内容）
function loadWorkspaceWebview(workspaceId) {
  const ws = workspaces[workspaceId];
  if (!ws || !ws.wsUrl) return;

  // 如果已经加载过，跳过（避免重复加载导致页面刷新）
  if (loadedWebviewWorkspaces.has(workspaceId)) return;

  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const webviewId = `previewWebview${wsSuffix}`;
  const containerId = `webviewContainer${wsSuffix}`;
  const emptyId = `empty-${workspaceId}`;

  // 从工作区面板中查找元素，避免找到其他工作区的同名元素
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) return;

  const webview = panel.querySelector(`#${webviewId}`);
  const webviewContainer = panel.querySelector(`#${containerId}`);
  const emptyEl = panel.querySelector(`#${emptyId}`);

  if (!webview || !webviewContainer) return;

  // 显示 webview 容器，隐藏空状态
  if (emptyEl) emptyEl.style.display = 'none';
  webviewContainer.style.display = 'block';

  // 加载 URL（只加载一次）
  try {
    webview.loadURL(ws.wsUrl);
    loadedWebviewWorkspaces.add(workspaceId); // 标记为已加载
  } catch (e) {
    console.error(`[Renderer] 加载工作区 ${workspaceId} webview 失败:`, e);
  }
}

// 更新工作区页签上显示的网点名称（代号下方，最小号字体）
function updateWorkspaceTabName(workspaceId, name) {
  if (!workspaces[workspaceId]) return;
  workspaces[workspaceId].title = name || '';
  const nameEl = document.getElementById(`ws-name-${workspaceId}`);
  if (nameEl) {
    nameEl.textContent = name || '';
  }
}

// 自动调度模式状态存储（key: cardIndex, value: boolean）
const autoScheduleMode = { 'general': true }; // 默认开启自动调度

// 切换自动调度模式
function toggleAutoScheduleMode(index, enabled) {
  autoScheduleMode[index] = enabled;
  if (enabled) {
    console.log(`[AutoSchedule] 卡片 ${index} 已启用自动调度模式`);
  } else {
    console.log(`[AutoSchedule] 卡片 ${index} 已关闭自动调度模式`);
  }
  
  // 更新所有对应的 toggle switch 控件状态
  if (index === 'general') {
    // 通用页签切换时，同步更新所有卡片页签的 toggle switch
    const generalSwitches = document.querySelectorAll('#mini_auto_switch_general');
    generalSwitches.forEach(sw => { sw.checked = enabled; });
    
    // 更新所有卡片页签的 toggle switch
    bookmarks.forEach((_, idx) => {
      const cardSwitches = document.querySelectorAll(`#mini_auto_switch_${idx}`);
      cardSwitches.forEach(sw => { sw.checked = enabled; });
    });
    
    // 同步所有卡片的自动调度模式状态
    bookmarks.forEach((_, idx) => {
      autoScheduleMode[idx] = enabled;
    });
  } else {
    const switches = document.querySelectorAll(`#mini_auto_switch_${index}`);
    switches.forEach(sw => { sw.checked = enabled; });
  }
}

// 查找或创建工作区（自动调度模式使用）
function findOrCreateWorkspaceForAI(bookmark) {
  const aiName = bookmark.name;
  
  // 先查找是否有工作区正在运行该 AI
  for (const [wsId, ws] of Object.entries(workspaces)) {
    if (ws.title === aiName && ws.status === 'running') {
      console.log(`[AutoSchedule] 找到正在运行 ${aiName} 的工作区: ${wsId}`);
      return wsId;
    }
  }
  
  // 再查找是否有工作区配置了该 AI（但可能处于 idle 状态）
  for (const [wsId, ws] of Object.entries(workspaces)) {
    if (ws.title === aiName) {
      console.log(`[AutoSchedule] 找到配置了 ${aiName} 的工作区: ${wsId}`);
      return wsId;
    }
  }
  
  // 找不到则选择代号最小的空闲工作区（bookmarkIndex 为 null 表示从未使用过）
  const sortedWorkspaces = getSortedWorkspaceIds();
  
  for (const wsId of sortedWorkspaces) {
    const ws = workspaces[wsId];
    // 空闲工作区：状态为 idle 且没有配置任何 AI
    if (ws.status === 'idle' && (ws.bookmarkIndex === null || ws.bookmarkIndex === undefined)) {
      console.log(`[AutoSchedule] 使用空闲工作区: ${wsId}`);
      return wsId;
    }
  }
  
  // 如果没有完全空闲的工作区，选择状态为 idle 的工作区（可能有历史配置）
  for (const wsId of sortedWorkspaces) {
    if (workspaces[wsId].status === 'idle') {
      console.log(`[AutoSchedule] 使用空闲工作区（有历史配置）: ${wsId}`);
      return wsId;
    }
  }
  
  // 所有工作区都在运行，返回当前工作区
  console.log(`[AutoSchedule] 所有工作区都在运行，使用当前工作区: ${currentWorkspaceId}`);
  return currentWorkspaceId;
}

// 自动调度模式：执行前自动选择工作区
function autoScheduleBeforeExecute(index, message = '') {
  if (!autoScheduleMode[index]) {
    console.log(`[AutoSchedule] 卡片 ${index} 未启用自动调度，使用当前工作区`);
    return Promise.resolve();
  }
  
  // 通用页签：先解析消息找到对应的卡片
  let bookmark = null;
  if (index === 'general') {
    if (!message) {
      console.log(`[AutoSchedule] 通用页签无消息，使用当前工作区`);
      return Promise.resolve();
    }
    const matched = findCardByName(message);
    console.log(`[AutoSchedule] 通用页签 findCardByName 结果:`, matched ? { index: matched.index, name: matched.name, method: matched.method, prefixToRemove: matched.prefixToRemove } : null);
    if (!matched) {
      console.log(`[AutoSchedule] 通用页签无法匹配卡片，使用当前工作区`);
      return Promise.resolve();
    }
    bookmark = bookmarks[matched.index];
  } else {
    bookmark = bookmarks[index];
  }
  
  if (!bookmark) {
    console.log(`[AutoSchedule] 卡片不存在`);
    return Promise.resolve();
  }
  
  // 🔑 桌面APP类型的卡片也需要工作区（用于显示对话历史），但不加载 webview
  const isDesktopApp = bookmark.type === 'desktop-app';
  
  const targetWorkspaceId = findOrCreateWorkspaceForAI(bookmark);
  
  console.log(`[AutoSchedule] 📍 当前工作区: ${currentWorkspaceId}, 目标工作区: ${targetWorkspaceId}`);
  
  if (targetWorkspaceId !== currentWorkspaceId) {
    console.log(`[AutoSchedule] 🔄 需要切换工作区: ${currentWorkspaceId} → ${targetWorkspaceId}`);
    console.log(`[AutoSchedule] 📋 切换前工作区状态:`, {
      currentWorkspaceId,
      targetWorkspaceId,
      targetWsTitle: workspaces[targetWorkspaceId]?.title,
      targetWsBookmarkIndex: workspaces[targetWorkspaceId]?.bookmarkIndex,
      targetWsStatus: workspaces[targetWorkspaceId]?.status,
      targetWsUrl: workspaces[targetWorkspaceId]?.wsUrl
    });
    
    // 🔑 关键修复：切换工作区前，先设置目标工作区的 URL 和配置
    const targetWs = workspaces[targetWorkspaceId];
    if (targetWs) {
      // 设置工作区的 URL 为卡片的 URL
      targetWs.wsUrl = bookmark.url || '';
      // 设置工作区的配置
      targetWs.bookmarkIndex = bookmarks.indexOf(bookmark);
      targetWs.title = bookmark.name;
      targetWs.replySelector = bookmark.replySelector || '';
      targetWs.heartbeatSelector = bookmark.heartbeatSelector || '';
      targetWs.monitorTimeout = bookmark.monitorTimeout || 0;
      
      console.log(`[AutoSchedule] 🔧 已设置工作区 ${targetWorkspaceId} 的配置:`, {
        wsUrl: targetWs.wsUrl,
        bookmarkIndex: targetWs.bookmarkIndex,
        title: targetWs.title
      });
    }
    
    // 🔑 切换工作区时不恢复旧设定，避免污染全局变量
    switchWorkspaceWithoutRestore(targetWorkspaceId);
    
    console.log(`[AutoSchedule] ✅ 切换后工作区状态:`, {
      currentWorkspaceId,
      globalBookmarkIndex: window.currentBookmarkIndex,
      globalReplySelector: window.currentReplySelector
    });
    
    // 等待工作区切换和 webview 加载完成
    return new Promise(resolve => setTimeout(resolve, 500));
  } else {
    console.log(`[AutoSchedule] ⚠️ 目标工作区与当前工作区相同，无需切换`);
    // 🔑 即使不切换工作区，也要确保当前工作区的 URL 和配置正确
    const currentWs = workspaces[currentWorkspaceId];
    if (currentWs) {
      currentWs.wsUrl = bookmark.url || '';
      currentWs.bookmarkIndex = bookmarks.indexOf(bookmark);
      currentWs.title = bookmark.name;
      currentWs.replySelector = bookmark.replySelector || '';
      currentWs.heartbeatSelector = bookmark.heartbeatSelector || '';
      currentWs.monitorTimeout = bookmark.monitorTimeout || 0;
      
      // 🔑 桌面APP类型不加载 webview，显示对话历史面板
      if (bookmark.type !== 'desktop-app') {
        loadWorkspaceWebview(currentWorkspaceId);
      } else {
        console.log(`[AutoSchedule] 🖥️ 桌面APP类型卡片，显示对话面板`);
        showDesktopAppChatPanel(currentWorkspaceId, bookmark);
      }
    }
  }
  
  return Promise.resolve();
}

// 桌面APP类型卡片：显示对话历史面板
function showDesktopAppChatPanel(workspaceId, bookmark) {
  console.log(`[DesktopApp] 🖥️ 显示对话历史面板: ${workspaceId}, ${bookmark.name}`);

  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) {
    console.error(`[DesktopApp] ❌ 找不到工作区面板: ${workspaceId}`);
    return;
  }

  // 隐藏空状态提示和 webview 容器
  const emptyDiv = panel.querySelector(`#empty-${workspaceId}`);
  if (emptyDiv) emptyDiv.style.display = 'none';

  const webviewContainer = panel.querySelector('.webview-container');
  if (webviewContainer) webviewContainer.style.display = 'none';

  // 隐藏展开模式的 header 和 body（对话面板自带 header）
  const wsExpandHeader = panel.querySelector('.ws-expand-header');
  if (wsExpandHeader) wsExpandHeader.style.display = 'none';
  const wsExpandBody = panel.querySelector('.ws-expand-body');
  if (wsExpandBody) wsExpandBody.style.display = 'none';

  // 检查是否已有对话面板
  let chatPanel = panel.querySelector('.desktop-app-chat-panel');

  if (!chatPanel) {
    chatPanel = document.createElement('div');
    chatPanel.className = 'desktop-app-chat-panel';
    chatPanel.style.cssText = `
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: absolute;
      left: 0;
      top: 0;
      z-index: 10;
    `;

    chatPanel.innerHTML = `
      <div class="chat-header" style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      ">
        <span style="font-size: 20px;">🖥️</span>
        <span>${bookmark.name} - 桌面APP对话</span>
        <span style="margin-left: auto; font-size: 11px; opacity: 0.9;">历史记录</span>
      </div>
      <div class="chat-messages" style="
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      ">
        <div style="text-align: center; color: #94a3b8; font-size: 12px; padding: 20px;">
          💬 开始对话吧！发送的消息和接收的回答都会显示在这里
        </div>
      </div>
    `;

    panel.appendChild(chatPanel);
    console.log(`[DesktopApp] ✅ 创建对话历史面板`);
  } else {
    console.log(`[DesktopApp] ✅ 对话历史面板已存在`);
  }

  // 确保对话面板始终正确显示
  chatPanel.style.setProperty('position', 'absolute', 'important');
  chatPanel.style.setProperty('left', '0', 'important');
  chatPanel.style.setProperty('top', '0', 'important');
  chatPanel.style.setProperty('width', '100%', 'important');
  chatPanel.style.setProperty('height', '100%', 'important');
  chatPanel.style.setProperty('display', 'flex', 'important');
  chatPanel.style.setProperty('flex-direction', 'column', 'important');
  chatPanel.style.setProperty('z-index', '10', 'important');

  // 更新工作区状态
  updateWorkspaceStatus(workspaceId, 'idle');
  updateWorkspaceTabName(workspaceId, bookmark.name);
}

// 增量内容提取：以问句为锚点，提取问句之后的内容作为本次回复
function extractIncrementalAnswer(fullAnswer, question) {
  if (!fullAnswer || !question) return fullAnswer || '';
  
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) return fullAnswer;
  
  const questionIndex = fullAnswer.indexOf(trimmedQuestion);
  
  if (questionIndex === -1) {
    console.log(`[DesktopApp] ⚠️ 问句未在回答中找到，返回全文（${fullAnswer.length}字）`);
    return fullAnswer;
  }
  
  let incremental = fullAnswer.substring(questionIndex + trimmedQuestion.length);
  incremental = incremental.replace(/^[\s\n\r]+/, '');
  incremental = incremental.replace(/发消息或按住空格说话\.\.\.?$/, '').trim();
  
  console.log(`[DesktopApp] ✅ 增量提取: 全文${fullAnswer.length}字 → 增量${incremental.length}字`);
  
  return incremental || fullAnswer;
}

// HTML 清理函数（与 ai-response-viewer.html 中的 cleanHtmlWhitespace 保持一致）
//  返回 { html, mathBlocks }：html 含 %%KATEX_N%% 占位符，mathBlocks 供调用方在 injectInlineStyles 之后渲染
function cleanHtmlWhitespace(html) {
    //  步骤0: 提取 KaTeX 公式为占位符（在清理前先保存数学公式）
    const mathBlocks = [];
    let cleaned = html;

    // 🆕 使用 DOMParser 正确解析 KaTeX HTML（避免正则表达式无法处理嵌套 span 的问题）
    // KaTeX 生成结构: <span class="katex"><span class="katex-mathml"><math><annotation>...</annotation></math></span><span class="katex-html">...</span></span>
    // 正则表达式 [\s\S]*? 会匹配到内层 </span>，导致提取到错误的 annotation 内容
    if (typeof document !== 'undefined' && typeof DOMParser !== 'undefined') {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div id="root">${cleaned}</div>`, 'text/html');
            const root = doc.getElementById('root');
            
            // 查找所有 .katex-display 容器（显示模式公式）
            const displayFormulas = root.querySelectorAll('.katex-display');
            displayFormulas.forEach(container => {
                const annotation = container.querySelector('annotation[encoding="application/x-tex"]');
                if (annotation && annotation.textContent) {
                    const formula = annotation.textContent.trim();
                    const idx = mathBlocks.length;
                    mathBlocks.push({ formula, display: true });
                    const placeholder = document.createElement('span');
                    placeholder.textContent = `%%KATEX_${idx}%%`;
                    container.parentNode.replaceChild(placeholder, container);
                }
            });
            
            // 查找所有剩余的 .katex 元素（行内公式，不在 .katex-display 内）
            const inlineFormulas = root.querySelectorAll('.katex');
            inlineFormulas.forEach(katexEl => {
                if (katexEl.closest('.katex-display')) return;
                
                const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]');
                if (annotation && annotation.textContent) {
                    const formula = annotation.textContent.trim();
                    const idx = mathBlocks.length;
                    mathBlocks.push({ formula, display: false });
                    const placeholder = document.createElement('span');
                    placeholder.textContent = `%%KATEX_${idx}%%`;
                    katexEl.parentNode.replaceChild(placeholder, katexEl);
                }
            });
            
            cleaned = root.innerHTML;
            
            if (mathBlocks.length > 0) {
                console.log(`[Workspace] 🧮 通过 DOMParser 提取到 ${mathBlocks.length} 个 KaTeX 公式`);
            }
        } catch (e) {
            console.warn('[Workspace] DOMParser 提取 KaTeX 失败，回退到正则表达式:', e.message);
        }
    }

    // 如果 DOMParser 未可用或失败，回退到正则表达式方法
    if (mathBlocks.length === 0 && cleaned.includes('class="katex')) {
        cleaned = cleaned.replace(
            /<span class="katex[^"]*"[^>]*>[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>/gi,
            (match, latex) => {
                const idx = mathBlocks.length;
                mathBlocks.push({ formula: latex.trim(), display: false });
                return `%%KATEX_${idx}%%`;
            }
        );

        cleaned = cleaned.replace(
            /<math[^>]*>[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/math>/gi,
            (match, latex) => {
                const idx = mathBlocks.length;
                mathBlocks.push({ formula: latex.trim(), display: true });
                return `%%KATEX_${idx}%%`;
            }
        );
    }

    // 提取 $$...$$ 显示模式公式
    cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ formula: formula.trim(), display: true });
        return `%%KATEX_${idx}%%`;
    });

    // 提取 $...$ 行内公式（排除 $$）
    cleaned = cleaned.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ formula: formula.trim(), display: false });
        return `%%KATEX_${idx}%%`;
    });

    if (mathBlocks.length > 0) {
        console.log(`[Workspace] 🧮 提取到 ${mathBlocks.length} 个 KaTeX 公式`);
    }

    // 检测是否为"脏HTML"（包含大量Tailwind类名或框架特定标记）
    const isDirtyHtml = /(?:dark:text-|max-w-|flex flex-|border-\[|rounded-|bg-\[|text-\[|p-\[|m-\[)/.test(cleaned);

    if (isDirtyHtml) {
        // 移除所有 Tailwind 类名（但保留标签本身）
        cleaned = cleaned.replace(/\s*class="[^"]*(?:dark:text-|max-w-|flex flex-|border-\[|rounded-|bg-\[|text-\[|p-\[|m-\[)[^"]*"/gi, '');
        cleaned = cleaned.replace(/\s*class="[^"]*\b(?:text-|bg-|p-|m-|w-|h-|flex|grid|gap-|rounded|shadow|opacity|transform|transition|duration|ease|hover:|focus:|active:)[^"]*"/gi, '');

        // 移除非文本内容块（Tailwind专属）
        // 🆕 注意：不再移除 <math> 和 <span class="katex">，因为已在步骤0中提取为占位符
        const dirtyRemovePatterns = [
            /<svg[\s\S]*?<\/svg>/gi,
            /<canvas[^>]*><\/canvas>/gi,
            /<script[\s\S]*?<\/script>/gi,
            /<style[\s\S]*?<\/style>/gi,
            /<button[\s\S]*?<\/button>/gi,
            /<input[^>]*>/gi,
            /<i class="icon[\s\S]*?<\/i>/gi,
            /<animate[\s\S]*?<\/animate>/gi,
            /\s+d="[^"]*"/g,
            /data:image\/[^;]+;base64,[^"'\s]*/g,
            /(?:viewBox|d|path|points)="[^"]{50,}"/g
        ];
        dirtyRemovePatterns.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '');
        });
    }

    // 对所有 style 属性进行基础安全清理
    cleaned = cleaned.replace(/style="[^"]*"/gi, function(match) {
        let newStyle = match
            .replace(/text-align:\s*[^;]+;?/gi, '')
            .replace(/background(?:-color)?\s*:\s*[^;]+;?/gi, '')
            .replace(/padding(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/margin(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/display:\s*(?:block|flex|inline-flex|grid|inline-block|table|inline-table)[^;]*;?/gi, '')
            .replace(/border(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/border-radius:\s*[^;]+;?/gi, '')
            .replace(/box-shadow:\s*[^;]+;?/gi, '')
            .replace(/(?:min-|max-)?width:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%)|auto)[^;]*;?/gi, '')
            .replace(/(?:min-|max-)?height:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%)|auto)[^;]*;?/gi, '')
            .replace(/position:\s*(?:absolute|relative|fixed|sticky)[^;]*;?/gi, '')
            .replace(/(?:top|bottom|left|right):\s*[^;]+;?/gi, '')
            .replace(/z-index:\s*[^;]+;?/gi, '')
            .replace(/float:\s*[^;]+;?/gi, '')
            .replace(/clear:\s*[^;]+;?/gi, '')
            .replace(/overflow(?:-x|-y)?:\s*[^;]+;?/gi, '')
            .replace(/opacity:\s*[^;]+;?/gi, '')
            .replace(/transform:\s*[^;]+;?/gi, '')
            .replace(/var\(--[^)]+\)/gi, '')
            .replace(/rgba?\([^)]+\)/gi, '');
        newStyle = newStyle.replace(/;\s*;/g, ';').replace(/^style="\s*;\s*/, 'style="').replace(/\s*;\s*"$/, '"');
        if (/^style="\s*"?$/.test(newStyle)) return '';
        return newStyle;
    });

    // 移除非文本内容块（标准清理）
    // 🆕 注意：不再移除 <math> 和 <span class="katex">，因为已在步骤0中提取为占位符
    const standardRemovePatterns = [
        /<svg[\s\S]*?<\/svg>/gi,
        /<canvas[^>]*><\/canvas>/gi,
        /<script[\s\S]*?<\/script>/gi,
        /<style[\s\S]*?<\/style>/gi,
        /<button[\s\S]*?<\/button>/gi,
        /<input[^>]*>/gi,
        /<i class="icon[\s\S]*?<\/i>/gi,
        /<animate[\s\S]*?<\/animate>/gi,
        /\s+d="[^"]*"/g,
        /data:image\/[^;]+;base64,[^"'\s]*/g,
        /(?:viewBox|d|path|points)="[^"]{50,}"/g
    ];
    standardRemovePatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // 移除标签间的多余空白
    cleaned = cleaned
        .replace(/>\s+</g, '><')
        .replace(/\n\s*\n/g, '\n')
        .replace(/^\s+|\s+$/g, '');

    // 🆕 返回 { html, mathBlocks }，由调用方在 injectInlineStyles 之后调用 renderKaTeXPlaceholders
    return { html: cleaned, mathBlocks };
}

/**
 * 🔄 用 KaTeX 重新渲染占位符公式
 * ⚠️ 必须在 injectInlineStyles 之后调用，避免样式污染 KaTeX 内部标签
 */
function renderKaTeXPlaceholders(html, mathBlocks) {
    if (!mathBlocks || mathBlocks.length === 0) return html;

    if (typeof katex !== 'undefined') {
        return html.replace(/%%KATEX_(\d+)%%/g, (match, idx) => {
            const block = mathBlocks[parseInt(idx)];
            if (!block) return match;
            try {
                return katex.renderToString(block.formula, {
                    displayMode: block.display,
                    throwOnError: false,
                    strict: false
                });
            } catch (e) {
                console.warn('[Workspace] KaTeX 渲染失败:', block.formula, e.message);
                return `<code style="background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-family:monospace;">${block.formula}</code>`;
            }
        });
    } else {
        // KaTeX 未加载，显示原始公式
        return html.replace(/%%KATEX_(\d+)%%/g, (match, idx) => {
            const block = mathBlocks[parseInt(idx)];
            return block ? `<code>${block.formula}</code>` : match;
        });
    }
}

// JSON 格式化函数（与 ai-response-viewer.html 中的 formatJsonBlocks 保持一致）
function formatJsonBlocks(html) {
    let result = html;

    // 策略1: 查找 <pre><code> 标准结构
    result = result.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (match, codeContent) => {
        return processCodeBlock(codeContent);
    });

    // 策略2: 如果没找到 <pre><code>，查找独立的 <pre>
    if (result === html) {
        result = result.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
            return processCodeBlock(content);
        });
    }

    return result;
}

function processCodeBlock(codeContent) {
    // 解码 HTML 实体
    let decoded = codeContent
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

    // 如果包含HTML标签，提取纯文本
    let plainText = decoded;
    if (decoded.includes('<') && decoded.includes('>')) {
        plainText = decoded
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    // 尝试解析和格式化JSON
    try {
        const jsonObj = JSON.parse(plainText);
        const formatted = JSON.stringify(jsonObj, null, 2);
        const escaped = formatted
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        return `<pre style="background: #f8f9fa !important; color: #24292e !important; padding: 16px !important; border-radius: 6px !important; border: 1px solid #e1e4e8 !important; margin: 16px 0 !important; font-family: 'SFMono-Regular', Consolas, monospace !important; font-size: 13px !important; line-height: 1.6 !important; white-space: pre !important; overflow-x: auto !important;"><code style="background: none !important; color: inherit !important; padding: 0 !important;">${escaped}</code></pre>`;
    } catch (e) {
        // JSON 格式化失败，返回原始内容
        return `<pre style="background: #f8f9fa !important; color: #24292e !important; padding: 16px !important; border-radius: 6px !important; border: 1px solid #e1e4e8 !important; overflow-x: auto !important; margin: 16px 0 !important; font-family: 'SFMono-Regular', Consolas, monospace !important; font-size: 13px !important; line-height: 1.6 !important; white-space: pre-wrap !important; word-break: break-all !important;">${decoded}</pre>`;
    }
}

// 内联样式注入函数（与 ai-response-viewer.html 中的 injectInlineStyles 保持一致）
function injectInlineStyles(html) {
    const styles = {
        'h1': 'font-size: 26px !important; font-weight: 800 !important; color: #1e40af !important; margin: 24px 0 16px 0 !important; padding-bottom: 8px !important; border-bottom: 3px solid #2563eb !important;',
        'h2': 'font-size: 22px !important; font-weight: 700 !important; color: #1e3a8a !important; margin: 20px 0 12px 0 !important; padding-bottom: 6px !important; border-bottom: 2px solid #60a5fa !important;',
        'h3': 'font-size: 18px !important; font-weight: 700 !important; color: #2563eb !important; margin: 16px 0 10px 0 !important;',
        'h4': 'font-size: 16px !important; font-weight: 600 !important; color: #3b82f6 !important; margin: 14px 0 8px 0 !important;',
        'a': 'display: inline !important; text-align: left !important; color: #2563eb !important; text-decoration: underline !important; font-weight: 500 !important;',
        'a_citation': 'display: inline-block !important; text-align: center !important; border: 1.5px solid #475569 !important; border-radius: 50% !important; min-width: 18px !important; height: 18px !important; line-height: 15px !important; font-size: 10px !important; font-weight: 600 !important; color: #475569 !important; text-decoration: none !important; margin: 0 1px !important; vertical-align: baseline !important; background: transparent !important; padding: 0 !important;',
        'sup': 'font-size: 10px !important; vertical-align: super !important; line-height: 1 !important; color: #64748b !important;',
        'strong': 'background: linear-gradient(120deg, #fef3c7 0%, #fde68a 100%) !important; color: #7c2d12 !important; padding: 2px 6px !important; border-radius: 4px !important; font-weight: 700 !important;',
        'code': 'background: #fee2e2 !important; color: #dc2626 !important; padding: 2px 6px !important; border-radius: 4px !important; border: 1px solid #fca5a5 !important; font-family: "SFMono-Regular", Consolas, monospace !important; font-size: 13px !important; font-weight: 500 !important;',
        'pre': 'background: #f8f9fa !important; color: #24292e !important; padding: 16px !important; border-radius: 6px !important; border: 1px solid #e1e4e8 !important; overflow-x: auto !important; margin: 16px 0 !important; font-family: "SFMono-Regular", Consolas, monospace !important; font-size: 13px !important; line-height: 1.6 !important; white-space: pre-wrap !important; word-break: break-all !important;',
        'ul': 'padding-left: 28px !important; margin: 12px 0 !important;',
        'ol': 'padding-left: 28px !important; margin: 12px 0 !important;',
        'li': 'margin: 6px 0 !important; line-height: 1.7 !important; font-size: 14px !important; color: #1f2937 !important;',
        'blockquote': 'border-left: 4px solid #3b82f6 !important; padding: 10px 16px !important; margin: 16px 0 !important; background: #f8fafc !important; color: #4b5563 !important; font-style: italic !important; border-radius: 0 6px 6px 0 !important;',
        'p': 'margin: 10px 0 !important; line-height: 1.7 !important; font-size: 14px !important;',
        'table': 'width: 100% !important; border-collapse: collapse !important; margin: 16px 0 !important; background: white !important; border-radius: 8px !important; overflow: hidden !important; box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important; border: 1px solid #e5e7eb !important; table-layout: fixed !important;',
        'thead': 'background: #f1f5f9 !important; color: #1e293b !important;',
        'tbody': 'background: white !important;',
        'tr': 'border-bottom: 1px solid #e5e7eb !important; transition: background 0.2s !important;',
        'th': 'padding: 8px 10px !important; text-align: center !important; font-weight: 600 !important; font-size: 12px !important; letter-spacing: 0.3px !important; border-right: 1px solid rgba(255,255,255,0.2) !important; word-break: break-all !important;',
        'td': 'padding: 8px 10px !important; font-size: 12px !important; color: #1e293b !important; border-right: 1px solid #f3f4f6 !important; text-align: center !important; vertical-align: middle !important; word-break: break-all !important;'
    };

    let result = html;

    //  使用 DOMParser 直接遍历 DOM 树并应用样式，避免字符串匹配问题
    // KaTeX 生成嵌套结构: <span class="katex"><span class="katex-html"><span class="base"><span class="mrel">=</span></span></span></span>
    // 正则方法无法正确跳过内层元素，必须用 DOM 解析
    if (typeof document !== 'undefined' && typeof DOMParser !== 'undefined') {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div id="root">${result}</div>`, 'text/html');
            const root = doc.getElementById('root');
            
            // 递归应用样式到所有非 KaTeX 元素
            function applyStylesToElement(el) {
                // 跳过 KaTeX 容器及其所有后代
                // 检查元素本身或其任何祖先是否有 katex 类
                let isInsideKatex = false;
                let parent = el;
                while (parent) {
                    if (parent.classList && (parent.classList.contains('katex') || parent.classList.contains('katex-display'))) {
                        isInsideKatex = true;
                        break;
                    }
                    parent = parent.parentElement;
                }
                if (isInsideKatex) {
                    return;
                }
                
                const tagName = el.tagName.toLowerCase();
                const style = styles[tagName];
                
                if (style) {
                    // 对于 <a> 标签特殊处理
                    if (tagName === 'a') {
                        const trimmedText = el.textContent.trim();
                        const isSimpleDigit = /^\d{1,2}$/.test(trimmedText);
                        const isHyphenDigit = /^-?\s*\d{1,2}\s*-?$/.test(trimmedText);
                        const isMultiDigit = /^-?\s*\d{1,2}\s*-\s*\d{1,2}\s*-?$/.test(trimmedText);
                        const isCitation = isSimpleDigit || isHyphenDigit || isMultiDigit;
                        
                        const styleToUse = isCitation ? (styles['a_citation'] || styles['a']) : styles['a'];
                        el.setAttribute('style', styleToUse);
                    } else {
                        // 其他标签：追加或设置 style
                        const existingStyle = el.getAttribute('style') || '';
                        el.setAttribute('style', existingStyle ? `${existingStyle} ${style}` : style);
                    }
                }
                
                // 递归处理子元素
                for (const child of el.children) {
                    applyStylesToElement(child);
                }
            }
            
            applyStylesToElement(root);
            result = root.innerHTML;
        } catch (e) {
            console.warn('[Workspace] DOMParser 应用内联样式失败，回退到正则表达式:', e.message);
            // 回退到原始正则表达式方法（但可能破坏 KaTeX）
            // <a> 标签单独处理
            result = result.replace(/<a(\s[^>]*)?>([\s\S]*?)<\/a>/gi, (match, attrs, innerHtml) => {
                let cleanedAttrs = (attrs || '').replace(/style\s*=\s*"[^"]*"/gi, '').trim();
                const innerText = (innerHtml || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
                const trimmedText = innerText.trim();
                const isSimpleDigit = /^\d{1,2}$/.test(trimmedText);
                const isHyphenDigit = /^-?\s*\d{1,2}\s*-?$/.test(trimmedText);
                const isMultiDigit = /^-?\s*\d{1,2}\s*-\s*\d{1,2}\s*-?$/.test(trimmedText);
                const isCitation = isSimpleDigit || isHyphenDigit || isMultiDigit;
                let styleToUse;
                let displayContent;
                if (isCitation) {
                    styleToUse = styles['a_citation'] || styles['a'];
                    const digitsOnly = trimmedText.replace(/[-\s]/g, '');
                    displayContent = digitsOnly || trimmedText;
                } else {
                    styleToUse = styles['a'];
                    displayContent = innerHtml;
                }
                if (cleanedAttrs && cleanedAttrs.length > 0) {
                    return `<a style="${styleToUse}" ${cleanedAttrs}>${displayContent}</a>`;
                } else {
                    return `<a style="${styleToUse}">${displayContent}</a>`;
                }
            });

            // 其他标签（跳过 KaTeX 渲染的元素）
            Object.keys(styles).forEach(tag => {
                if (tag === 'a' || tag === 'a_citation') return;
                const style = styles[tag];
                const regex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
                result = result.replace(regex, (match, attrs) => {
                    if (match.includes('katex') || match.includes('KaTeX')) {
                        return match;
                    }
                    
                    if (tag === 'sup') {
                        return match.replace(/style\s*=\s*"[^"]*"/gi, '').replace(/<sup(\s|>)/i, (m, sep) => {
                            return `<sup style="${style}"${sep === '>' ? '>' : sep}`;
                        });
                    }
                    if (attrs && attrs.indexOf('style=') > -1) {
                        return match.replace(/style="([^"]*)"/i, `style="$1 ${style}"`);
                    } else {
                        return `<${tag}${attrs || ''} style="${style}">`;
                    }
                });
            });
        }
    } else {
        // 回退到原始正则表达式方法
        // <a> 标签单独处理
        result = result.replace(/<a(\s[^>]*)?>([\s\S]*?)<\/a>/gi, (match, attrs, innerHtml) => {
            let cleanedAttrs = (attrs || '').replace(/style\s*=\s*"[^"]*"/gi, '').trim();
            const innerText = (innerHtml || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
            const trimmedText = innerText.trim();
            const isSimpleDigit = /^\d{1,2}$/.test(trimmedText);
            const isHyphenDigit = /^-?\s*\d{1,2}\s*-?$/.test(trimmedText);
            const isMultiDigit = /^-?\s*\d{1,2}\s*-\s*\d{1,2}\s*-?$/.test(trimmedText);
            const isCitation = isSimpleDigit || isHyphenDigit || isMultiDigit;
            let styleToUse;
            let displayContent;
            if (isCitation) {
                styleToUse = styles['a_citation'] || styles['a'];
                const digitsOnly = trimmedText.replace(/[-\s]/g, '');
                displayContent = digitsOnly || trimmedText;
            } else {
                styleToUse = styles['a'];
                displayContent = innerHtml;
            }
            if (cleanedAttrs && cleanedAttrs.length > 0) {
                return `<a style="${styleToUse}" ${cleanedAttrs}>${displayContent}</a>`;
            } else {
                return `<a style="${styleToUse}">${displayContent}</a>`;
            }
        });

        // 其他标签（跳过 KaTeX 渲染的元素）
        Object.keys(styles).forEach(tag => {
            if (tag === 'a' || tag === 'a_citation') return;
            const style = styles[tag];
            const regex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
            result = result.replace(regex, (match, attrs) => {
                if (match.includes('katex') || match.includes('KaTeX')) {
                    return match;
                }
                
                if (tag === 'sup') {
                    return match.replace(/style\s*=\s*"[^"]*"/gi, '').replace(/<sup(\s|>)/i, (m, sep) => {
                        return `<sup style="${style}"${sep === '>' ? '>' : sep}`;
                    });
                }
                if (attrs && attrs.indexOf('style=') > -1) {
                    return match.replace(/style="([^"]*)"/i, `style="$1 ${style}"`);
                } else {
                    return `<${tag}${attrs || ''} style="${style}">`;
                }
            });
        });
    }

    return result;
}

// 完整 Markdown 渲染（支持标题、粗体、斜体、删除线、分隔线、列表、任务清单、行内代码、代码块、表格、引用、链接、图片）
function renderMarkdown(text) {
  if (!text) return '';

  // 第1步：提取代码块，避免内部内容被其他规则处理
  const codeBlocks = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    const highlighted = escapeHtml(code.trimEnd());
    const langLabel = lang ? `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">${escapeHtml(lang)}</div>` : '';
    codeBlocks.push(`<div style="background:#1e293b;color:#e2e8f0;padding:10px 12px;border-radius:6px;font-family:monospace;font-size:12px;line-height:1.6;overflow-x:auto;margin:8px 0;white-space:pre-wrap;">${langLabel}${highlighted}</div>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // 第2步：提取链接和图片为占位符（必须在 escapeHtml 之前，否则方括号/圆括号会被转义）
  const inlineElements = [];
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const idx = inlineElements.length;
    inlineElements.push(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;border-radius:4px;margin:4px 0;">`);
    return `%%INLINE_${idx}%%`;
  });
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const idx = inlineElements.length;
    inlineElements.push(`<a href="${escapeHtml(url)}" style="color:#3b82f6;text-decoration:underline;" target="_blank">${escapeHtml(text)}</a>`);
    return `%%INLINE_${idx}%%`;
  });
  
  console.log(`[Markdown] 🔗 提取了 ${inlineElements.length} 个链接/图片:`, inlineElements);
  console.log(`[Markdown] 📝 提取后的文本片段:`, processed.substring(0, 500));

  // 第3步：HTML 转义
  processed = escapeHtml(processed);

  // 第3.5步：自动链接（将纯文本 URL 转换为可点击链接）
  // 匹配 http:// 或 https:// 开头的 URL
  processed = processed.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" style="color:#3b82f6;text-decoration:underline;" target="_blank">$1</a>');

  // 第4步：行内格式（在表格/块级处理之前）
  // 删除线 ~~text~~
  processed = processed.replace(/~~(.+?)~~/g, '<del style="text-decoration:line-through;color:#94a3b8;">$1</del>');
  // 粗体 **text**
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 斜体 *text*（不与粗体冲突）
  processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // 行内代码 `code`
  processed = processed.replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:12px;font-family:monospace;">$1</code>');

  // 第4步：按行处理块级元素
  const lines = processed.split('\n');
  const result = [];
  let inTable = false;
  let tableRows = [];
  let tableHeaders = [];
  let inBlockquote = false;
  let blockquoteLines = [];
  let inUl = false;
  let inOl = false;
  let olStartNum = 0;

  function flushBlockquote() {
    if (inBlockquote) {
      result.push(`<blockquote style="border-left:3px solid #fbbf24;padding:6px 12px;margin:8px 0;background:#fffbeb;border-radius:0 4px 4px 0;font-size:13px;color:#78350f;">${blockquoteLines.join('<br>')}</blockquote>`);
      blockquoteLines = [];
      inBlockquote = false;
    }
  }
  function flushUl() {
    if (inUl) {
      result.push('</div>');
      inUl = false;
    }
  }
  function flushOl() {
    if (inOl) {
      result.push('</div>');
      inOl = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块占位符
    const cbMatch = trimmed.match(/^%%CODEBLOCK_(\d+)%%$/);
    if (cbMatch) {
      flushBlockquote(); flushUl(); flushOl();
      if (inTable) { result.push(renderTable(tableHeaders, tableRows, inlineElements)); tableHeaders = []; tableRows = []; inTable = false; }
      result.push(codeBlocks[parseInt(cbMatch[1])]);
      continue;
    }

    // 表格行
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      flushBlockquote(); flushUl(); flushOl();
      if (/^\|[\s:]*-+[\s:]*\|/.test(trimmed)) continue;
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) { tableHeaders = cells; inTable = true; }
      else { tableRows.push(cells); }
      continue;
    } else if (inTable) {
      result.push(renderTable(tableHeaders, tableRows, inlineElements));
      tableHeaders = []; tableRows = []; inTable = false;
    }

    // 标题
    const h3m = trimmed.match(/^### (.+)$/);
    const h2m = trimmed.match(/^## (.+)$/);
    const h1m = trimmed.match(/^# (.+)$/);
    if (h3m || h2m || h1m) {
      flushBlockquote(); flushUl(); flushOl();
      if (h3m) result.push(`<h3 style="margin:10px 0 4px;font-size:14px;font-weight:700;">${h3m[1]}</h3>`);
      else if (h2m) result.push(`<h2 style="margin:12px 0 4px;font-size:15px;font-weight:700;">${h2m[1]}</h2>`);
      else result.push(`<h1 style="margin:14px 0 4px;font-size:16px;font-weight:700;">${h1m[1]}</h1>`);
      continue;
    }

    // 分隔线
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushBlockquote(); flushUl(); flushOl();
      result.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:10px 0;">');
      continue;
    }

    // 引用 > text
    const bqm = trimmed.match(/^&gt;\s*(.+)$/);
    if (bqm) {
      flushUl(); flushOl();
      if (!inBlockquote) { inBlockquote = true; blockquoteLines = []; }
      blockquoteLines.push(bqm[1]);
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // 任务清单 - [x] / - [ ]
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s*(.+)$/);
    if (taskMatch) {
      flushBlockquote(); flushOl();
      const checked = taskMatch[1] !== ' ';
      if (!inUl) { result.push('<div style="margin:4px 0;">'); inUl = true; }
      result.push(`<div style="padding-left:16px;display:flex;align-items:flex-start;gap:6px;"><span style="flex-shrink:0;">${checked ? '☑' : ''}</span><span>${taskMatch[2]}</span></div>`);
      continue;
    }

    // 无序列表 * 或 -
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushBlockquote(); flushOl();
      if (!inUl) { result.push('<div style="margin:4px 0;">'); inUl = true; }
      result.push(`<div style="padding-left:16px;position:relative;"><span style="position:absolute;left:4px;">•</span>${ulMatch[1]}</div>`);
      continue;
    } else if (inUl) {
      flushUl();
    }

    // 有序列表 1. 2. 3.
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      flushBlockquote(); flushUl();
      if (!inOl) { olStartNum = parseInt(olMatch[1]); result.push('<div style="margin:4px 0;">'); inOl = true; }
      const num = olStartNum + (tableRows.length || result.filter(r => r.includes('style="padding-left:24px"')).length);
      result.push(`<div style="padding-left:24px;position:relative;"><span style="position:absolute;left:4px;font-weight:600;">${olMatch[1]}.</span>${olMatch[2]}</div>`);
      continue;
    } else if (inOl) {
      flushOl();
    }

    // 普通文本行
    flushBlockquote(); flushUl(); flushOl();
    if (trimmed === '') {
      result.push('<br>');
    } else {
      result.push(trimmed);
    }
  }

  // 收尾
  if (inTable) result.push(renderTable(tableHeaders, tableRows, inlineElements));
  flushBlockquote(); flushUl(); flushOl();

  let html = result.join('\n');

  // 恢复代码块占位符
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`%%CODEBLOCK_${idx}%%`, block);
  });

  // 恢复链接/图片占位符
  inlineElements.forEach((el, idx) => {
    html = html.replace(`%%INLINE_${idx}%%`, el);
  });

  return html;
}

// 渲染 Markdown 表格为 HTML
function renderTable(headers, rows, inlineElements) {
  if (headers.length === 0) return '';
  let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:12px;">';
  html += '<thead><tr>';
  headers.forEach(h => {
    const restoredH = h.replace(/%%INLINE_(\d+)%%/g, (_, idx) => {
      if (inlineElements && inlineElements[parseInt(idx)]) return inlineElements[parseInt(idx)];
      return _;
    });
    html += `<th style="border:1px solid #e2e8f0;padding:6px 8px;background:#f8fafc;font-weight:600;text-align:left;">${restoredH}</th>`;
  });
  html += '</tr></thead>';
  html += '<tbody>';
  rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => {
      const restoredCell = cell.replace(/%%INLINE_(\d+)%%/g, (_, idx) => {
        if (inlineElements && inlineElements[parseInt(idx)]) return inlineElements[parseInt(idx)];
        return _;
      });
      html += `<td style="border:1px solid #e2e8f0;padding:6px 8px;text-align:left;">${restoredCell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// 追加对话消息到桌面APP对话历史面板
function appendChatMessage(workspaceId, bookmark, message, answer, attachments = []) {
  console.log(`[DesktopApp] 💬 追加对话消息: ${workspaceId}`);

  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) {
    console.error(`[DesktopApp] ❌ 找不到工作区面板: ${workspaceId}`);
    return;
  }

  // 🔑 确保工作区面板可见
  panel.style.display = 'block';

  const chatPanel = panel.querySelector('.desktop-app-chat-panel');
  if (!chatPanel) {
    console.error(`[DesktopApp] ❌ 找不到对话面板`);
    return;
  }

  // 🔑 确保聊天面板可见
  chatPanel.style.setProperty('display', 'flex', 'important');
  chatPanel.style.setProperty('position', 'absolute', 'important');
  chatPanel.style.setProperty('left', '0', 'important');
  chatPanel.style.setProperty('top', '0', 'important');
  chatPanel.style.setProperty('width', '100%', 'important');
  chatPanel.style.setProperty('height', '100%', 'important');
  chatPanel.style.setProperty('z-index', '10', 'important');

  const messagesContainer = chatPanel.querySelector('.chat-messages');
  if (!messagesContainer) {
    console.error(`[DesktopApp] ❌ 找不到消息容器`);
    return;
  }

  const initialHint = messagesContainer.querySelector('div[style*="text-align: center"]');
  if (initialHint) {
    initialHint.remove();
  }

  const incrementalAnswer = extractIncrementalAnswer(answer, message);
  
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  // 创建消息气泡
  const messageBubble = document.createElement('div');
  messageBubble.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: fadeIn 0.3s ease-in;
  `;
  
  // 发送的消息
  const sentDiv = document.createElement('div');
  sentDiv.style.cssText = `
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 8px;
  `;
  const attachmentHtml = attachments.length > 0 ? attachments.map(att => {
    if (att.type && att.type.startsWith('image/') && att.data) {
      return `<div style="margin-top: 6px; border-radius: 8px; overflow: hidden; max-width: 150px;">
        <img src="${att.data}" alt="${escapeHtml(att.name)}" style="width: 100%; height: auto; display: block;" />
        <div style="font-size: 10px; opacity: 0.8; padding: 4px; background: rgba(0,0,0,0.2); text-align: center;">${escapeHtml(att.name)}</div>
      </div>`;
    } else {
      return `<div style="margin-top: 6px; padding: 6px 10px; background: rgba(255,255,255,0.2); border-radius: 6px; font-size: 11px; display: flex; align-items: center; gap: 6px;">
        📎 <span>${escapeHtml(att.name || '附件')}</span>
      </div>`;
    }
  }).join('') : '';

  sentDiv.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 10px 14px;
      border-radius: 16px 16px 4px 16px;
      max-width: 70%;
      word-wrap: break-word;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    ">
      <div style="margin-bottom: 4px;">${escapeHtml(message)}</div>
      ${attachmentHtml}
      <div style="font-size: 10px; opacity: 0.8; text-align: right; margin-top: 4px;">${timestamp}</div>
    </div>
    <div style="
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    ">👤</div>
  `;
  
  // 接收的回答
  const receivedDiv = document.createElement('div');
  receivedDiv.style.cssText = `
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    gap: 8px;
  `;
  receivedDiv.innerHTML = `
    <div style="
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    ">🤖</div>
    <div style="
      background: white;
      color: #1e293b;
      padding: 10px 14px;
      border-radius: 16px 16px 16px 4px;
      max-width: 70%;
      word-wrap: break-word;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      border: 1px solid #e2e8f0;
    ">
      <div style="margin-bottom: 4px;">${renderMarkdown(incrementalAnswer)}</div>
      <div style="font-size: 10px; color: #94a3b8; text-align: right;">${timestamp}</div>
    </div>
  `;
  
  messageBubble.appendChild(sentDiv);
  messageBubble.appendChild(receivedDiv);
  messagesContainer.appendChild(messageBubble);

  // 🆕 右键菜单：在 AI 回复气泡上右键弹出菜单
  const answerBubble = receivedDiv.querySelector('div[style*="background: white"]');
  if (answerBubble) {
    answerBubble.style.cursor = 'context-menu';
    answerBubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showChatBubbleContextMenu(e, incrementalAnswer, bookmark.name, message);
    });
  }

  // 滚动到底部（延迟确保 DOM 渲染完成）
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  });

  // 🔑 强制重排，确保内容正确显示
  void panel.offsetHeight;

  console.log(`[DesktopApp] ✅ 已追加对话消息`);
}

// 查房功能：检查所有工作区状态并以表格子窗口显示
function checkWorkspacesStatus() {
  const workspaceStatus = {};
  getSortedWorkspaceIds().forEach(wsId => {
    const ws = workspaces[wsId];
    const wsSuffix = wsId !== 'MAIN' ? `-${wsId}` : '';
    const panel = document.querySelector(`.workspace-panel[data-ws="${wsId}"]`);
    const webview = panel ? panel.querySelector(`#previewWebview${wsSuffix}`) : null;
    let url = '';
    try {
      url = webview?.getURL() || '';
    } catch (e) {
      url = '';
    }
    workspaceStatus[wsId] = {
      id: wsId,
      name: ws.title || '',
      status: ws.status || 'idle',
      bookmarkIndex: ws.bookmarkIndex,
      replySelector: ws.replySelector || '',
      heartbeatSelector: ws.heartbeatSelector || '',
      monitorTimeout: ws.monitorTimeout || 0,
      hasWebview: !!webview,
      webviewUrl: url,
      isActive: wsId === currentWorkspaceId
    };
  });

  const statusJson = JSON.stringify(workspaceStatus, null, 2);
  console.log('[Workspace] 查房结果:', statusJson);

  showWorkspaceStatusTable(workspaceStatus);
}

// 执行路径预判断函数（逻辑与实际执行一致，包含 toggle switch 设定）
function predictExecutionPath(message) {
  const isAutoSchedule = autoScheduleMode['general'] || false;
  
  const result = {
    message: message,
    matchedCard: null,
    targetAI: null,
    targetWorkspace: null,
    isAutoSchedule: isAutoSchedule,
    pathDescription: '',
    details: []
  };
  
  result.details.push(isAutoSchedule ? `🔄 当前模式: 自动调度` : `🔒 当前模式: 当下页签`);
  
  // 1. 解析消息中的AI名称
  const matched = findCardByName(message);
  
  if (matched) {
    result.matchedCard = bookmarks[matched.index];
    result.targetAI = result.matchedCard;
    result.details.push(`✅ 消息中匹配到AI: ${matched.name}`);
    
    if (isAutoSchedule) {
      // 自动调度模式：查找工作区
      const targetWorkspaceId = findOrCreateWorkspaceForAI(result.matchedCard);
      result.targetWorkspace = workspaces[targetWorkspaceId];
      
      if (result.targetWorkspace.title === matched.name) {
        result.details.push(`✅ 自动调度：找到配置了「${matched.name}」的工作区: ${targetWorkspaceId}`);
        if (targetWorkspaceId !== currentWorkspaceId) {
          result.details.push(`🔄 将自动切换到工作区 ${targetWorkspaceId}`);
        }
      } else {
        result.details.push(`✅ 自动调度：使用空闲工作区: ${targetWorkspaceId}（将配置为「${matched.name}」）`);
        if (targetWorkspaceId !== currentWorkspaceId) {
          result.details.push(`🔄 将自动切换到工作区 ${targetWorkspaceId}`);
        }
      }
      
      result.pathDescription = `[自动调度] 消息「${message}」中包含AI名称「${matched.name}」，将在工作区 ${targetWorkspaceId} 中执行${targetWorkspaceId !== currentWorkspaceId ? '（自动切换）' : ''}`;
    } else {
      // 当下页签模式：使用当前工作区
      const currentWs = workspaces[currentWorkspaceId];
      result.targetWorkspace = currentWs;
      
      if (currentWs.title === matched.name) {
        result.details.push(`✅ 当下页签：当前工作区 ${currentWorkspaceId} 已配置「${matched.name}」，直接执行`);
        result.pathDescription = `[当下页签] 消息「${message}」中包含AI名称「${matched.name}」，在当前工作区 ${currentWorkspaceId} 中执行`;
      } else {
        result.details.push(`⚠️ 当下页签：当前工作区 ${currentWorkspaceId} 配置的是「${currentWs.title || '无'}」，而非「${matched.name}」`);
        result.details.push(`✅ 将在当前工作区 ${currentWorkspaceId} 中重新打开「${matched.name}」`);
        result.pathDescription = `[当下页签] 消息「${message}」中包含AI名称「${matched.name}」，将在当前工作区 ${currentWorkspaceId} 中重新打开「${matched.name}」`;
      }
    }
  } else {
    result.details.push(`⚠️ 消息中未匹配到AI名称`);
    
    if (isAutoSchedule) {
      // 自动调度模式：优先使用当前工作区的AI
      const currentWs = workspaces[currentWorkspaceId];
      if (currentWs && currentWs.bookmarkIndex !== null && currentWs.bookmarkIndex !== undefined) {
        result.targetAI = bookmarks[currentWs.bookmarkIndex];
        result.targetWorkspace = currentWs;
        
        result.details.push(`✅ 自动调度：当前工作区 ${currentWorkspaceId} 配置了AI: ${result.targetAI.name}`);
        result.details.push(`✅ 将在当前工作区 ${currentWorkspaceId} 中执行「${result.targetAI.name}」对话`);
        
        result.pathDescription = `[自动调度] 消息「${message}」未指定AI，将在当前工作区 ${currentWorkspaceId} 中执行「${result.targetAI.name}」对话`;
      } else if (currentActiveCardIndex >= 0 && currentActiveCardIndex < bookmarks.length) {
        result.targetAI = bookmarks[currentActiveCardIndex];
        
        // 自动调度：查找该AI的工作区
        const targetWorkspaceId = findOrCreateWorkspaceForAI(result.targetAI);
        result.targetWorkspace = workspaces[targetWorkspaceId];
        
        result.details.push(`⚠️ 当前工作区无AI配置，回退到上一个活跃卡片：${result.targetAI.name}`);
        result.details.push(`✅ 自动调度：${targetWorkspaceId === currentWorkspaceId ? '在当前工作区执行' : `切换到工作区 ${targetWorkspaceId}`}`);
        
        result.pathDescription = `[自动调度] 消息「${message}」未指定AI，回退到「${result.targetAI.name}」，${targetWorkspaceId === currentWorkspaceId ? '在当前工作区执行' : `切换到工作区 ${targetWorkspaceId} 执行`}`;
      } else {
        result.details.push(`❌ 无法执行：无可用的AI配置`);
        result.pathDescription = `[自动调度] 无法执行：消息未指定AI，且无可用的AI配置`;
      }
    } else {
      // 当下页签模式：使用当前工作区的AI
      const currentWs = workspaces[currentWorkspaceId];
      if (currentWs && currentWs.bookmarkIndex !== null && currentWs.bookmarkIndex !== undefined) {
        result.targetAI = bookmarks[currentWs.bookmarkIndex];
        result.targetWorkspace = currentWs;
        
        result.details.push(`✅ 当下页签：当前工作区 ${currentWorkspaceId} 配置了AI: ${result.targetAI.name}`);
        result.details.push(`✅ 将在当前工作区 ${currentWorkspaceId} 中执行「${result.targetAI.name}」对话`);
        
        result.pathDescription = `[当下页签] 消息「${message}」未指定AI，将在当前工作区 ${currentWorkspaceId} 中执行「${result.targetAI.name}」对话`;
      } else if (currentActiveCardIndex >= 0 && currentActiveCardIndex < bookmarks.length) {
        result.targetAI = bookmarks[currentActiveCardIndex];
        result.targetWorkspace = currentWs;
        
        result.details.push(`⚠️ 当前工作区无AI配置，回退到上一个活跃卡片：${result.targetAI.name}`);
        result.details.push(`✅ 当下页签：将在当前工作区 ${currentWorkspaceId} 中执行「${result.targetAI.name}」对话`);
        
        result.pathDescription = `[当下页签] 消息「${message}」未指定AI，当前工作区无配置，回退到「${result.targetAI.name}」在当前工作区执行`;
      } else {
        result.details.push(`❌ 无法执行：无可用的AI配置`);
        result.pathDescription = `[当下页签] 无法执行：消息未指定AI，且无可用的AI配置`;
      }
    }
  }
  
  return result;
}

// 显示执行路径描述
function showExecutionPath() {
  const textarea = document.getElementById('mini_general_msg');
  const message = textarea ? textarea.value.trim() : '';
  
  if (!message) {
    showStatus('⚠️ 请先输入消息内容', 'warning');
    return;
  }
  
  const prediction = predictExecutionPath(message);
  
  let detailsHtml = prediction.details.map(d => `<div style="padding: 4px 0;">${d}</div>`).join('');
  
  const modal = document.createElement('div');
  modal.className = 'execution-path-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    padding: 20px;
    width: 90%;
    max-width: 500px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">
      <h2 style="font-size: 16px; margin: 0; color: #374151;">📝 执行路径预测</h2>
      <button onclick="this.closest('.execution-path-modal').remove()" style="background: #ef4444; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;">✕ 关闭</button>
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">输入消息:</div>
      <div style="font-size: 13px; padding: 8px; background: #f3f4f6; border-radius: 6px; word-break: break-all;">${escapeHtml(message)}</div>
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">执行路径:</div>
      <div style="font-size: 13px; padding: 8px; background: #eff6ff; border-radius: 6px; color: #1e40af;">${escapeHtml(prediction.pathDescription)}</div>
    </div>
    <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">详细步骤:</div>
    <div style="font-size: 12px; padding: 8px; background: #f9fafb; border-radius: 6px;">
      ${detailsHtml}
    </div>
  `;
  
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
  `;
  overlay.onclick = () => {
    modal.remove();
    overlay.remove();
  };
  
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
}

function showWorkspaceStatusTable(statusData) {
  const tableHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">
        <h2 style="font-size: 16px; margin: 0; color: #374151;">🔍 工作区查房结果</h2>
        <button onclick="this.closest('.workspace-status-modal').remove()" style="background: #ef4444; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;">✕ 关闭</button>
      </div>
      <div style="max-height: 500px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">工作区</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">状态</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">AI网点名称</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">回复选择器</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">网址</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600; color: #374151;">活跃</th>
            </tr>
          </thead>
          <tbody>
            ${Object.keys(statusData).map(wsId => {
              const ws = statusData[wsId];
              const statusColor = ws.status === 'running' ? '#10b981' : ws.status === 'idle' ? '#6b7280' : '#f59e0b';
              const statusText = ws.status === 'running' ? '运行中' : ws.status === 'idle' ? '空闲' : '未知';
              return `
                <tr style="background: ${ws.isActive ? '#eff6ff' : '#ffffff'}; hover: background: #f3f4f6;">
                  <td style="border: 1px solid #e5e7eb; padding: 8px;">${wsId}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 8px;"><span style="color: ${statusColor}; font-weight: 500;">${statusText}</span></td>
                  <td style="border: 1px solid #e5e7eb; padding: 8px;">${ws.name || '-'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 8px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ws.replySelector}">${ws.replySelector || '-'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ws.webviewUrl}">${ws.webviewUrl || '-'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 8px;">${ws.isActive ? '✓' : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px;">
        <button onclick="copyWorkspaceStatus()" style="background: #6366f1; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer;">📋 复制 JSON</button>
      </div>
    </div>
  `;

  const modal = document.createElement('div');
  modal.className = 'workspace-status-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    padding: 20px;
    width: 90%;
    max-width: 1000px;
    max-height: 70vh;
    z-index: 10000;
    overflow: hidden;
  `;
  modal.innerHTML = tableHtml;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
  `;
  overlay.onclick = () => {
    modal.remove();
    overlay.remove();
  };

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  window._currentWorkspaceStatus = statusData;
}

function copyWorkspaceStatus() {
  if (!window._currentWorkspaceStatus) return;
  const jsonStr = JSON.stringify(window._currentWorkspaceStatus, null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    showStatus('✅ 已复制工作区状态 JSON', 'success');
  }).catch(err => {
    showStatus('❌ 复制失败', 'error');
  });
}

function toggleAIWorkspace() {
  const dataSection = document.getElementById('dataSection');
  if (dataSection) {
    const isCollapsed = dataSection.classList.toggle('collapsed');
    if (isCollapsed) {
      document.querySelectorAll('.ws-corner-highlight').forEach(el => {
        el.style.display = 'none';
      });
    } else {
      setTimeout(() => updateAllCornerHighlights(), 100);
    }
  }
}

// ========== 工作区缩图、展开显示与关闭功能 ==========

// hover 缩图定时器
let hoverThumbnailTimer = null;
// hover 期间持续刷新缩图的定时器
let thumbnailRefreshTimer = null;
// 当前 hover 的工作区 ID（用于防止异步回调乱序）
let hoveredWorkspaceId = null;
// hover 工具提示 DOM 元素（动态创建，挂在 body 下避免 CSS 干扰）
let _hoverTooltipEl = null;

// 切换展开显示模式
function toggleExpandView() {
  expandViewEnabled = !expandViewEnabled;
  const container = document.getElementById('dataContainer');
  const btn = document.getElementById('expandToggleBtn');
  const ratioBtn = document.getElementById('expandRatioBtn');

  if (expandViewEnabled) {
    container.classList.add('expanded');
    container.style.height = '';
    container.style.minHeight = '';
    container.style.position = '';
    
    const dataSection = document.getElementById('dataSection');
    if (dataSection) {
      dataSection.style.height = '';
      dataSection.style.minHeight = '';
    }
    
    if (btn) {
      btn.textContent = '展开';
      btn.title = '关闭所有工作区的展开显示';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '700';
      btn.classList.add('btn-success');
      btn.classList.remove('btn-primary');
    }
    // 显示比例切换按钮
    if (ratioBtn) {
      ratioBtn.style.display = '';
      ratioBtn.textContent = expandRatioLabels[expandRatioIndex];
    }
    // 只显示有任务执行中的工作区，按正确顺序排列
    const sortedIds = getSortedWorkspaceIds();
    let hasActive = false;
    sortedIds.forEach(wsId => {
      const ws = workspaces[wsId];
      const panel = document.querySelector(`.workspace-panel[data-ws="${wsId}"]`);
      if (!panel) return;
      const isRunning = ws.status === 'running' || ws.status === 'waiting';
      // 桌面版卡片工作区也始终显示（状态为 idle 但已配置了桌面APP卡片）
      const isDesktopAppWs = ws.bookmarkIndex != null && bookmarks[ws.bookmarkIndex] && bookmarks[ws.bookmarkIndex].type === 'desktop-app';
      const isActive = isRunning || isDesktopAppWs;
      panel.style.display = isActive ? 'block' : 'none';
      if (isActive) hasActive = true;
    });
    // 如果没有任何活跃工作区，至少显示当前工作区
    if (!hasActive) {
      const currentPanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
      if (currentPanel) currentPanel.style.display = 'block';
    }
    updateExpandHeaders();
    // 高亮当前工作区
    const activePanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
    if (activePanel) activePanel.classList.add('active-ws');
    // 应用当前比例
    applyExpandRatio();
    // 恢复手柄显示
    setTimeout(() => updateAllCornerHighlights(), 100);
    document.querySelectorAll('.resize-handle').forEach(el => {
      el.style.display = '';
    });
  } else {
    container.classList.remove('expanded');
    container.classList.remove('ratio-1-8');
    if (btn) {
      btn.textContent = '页签';
      btn.title = '展开所有执行中工作区的页面';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '700';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-success');
    }
    if (ratioBtn) ratioBtn.style.display = 'none';
    
    calcStdDimensions();
    const containerRect = container.getBoundingClientRect();
    const containerW = containerRect.width;
    const panelH = wsStdH;
    
    const dataSection = document.getElementById('dataSection');
    const aiWorkspaceHeader = document.querySelector('.ai-workspace-header');
    const headerHeight = aiWorkspaceHeader ? aiWorkspaceHeader.offsetHeight : 0;
    
    container.style.height = (panelH + 10) + 'px';
    container.style.minHeight = (panelH + 10) + 'px';
    container.style.position = 'relative';
    
    if (dataSection) {
      dataSection.style.height = (panelH + headerHeight + 20) + 'px';
      dataSection.style.minHeight = (panelH + headerHeight + 20) + 'px';
    }
    
    document.querySelectorAll('.workspace-panel').forEach(panel => {
      const wsId = panel.getAttribute('data-ws');
      if (wsId === currentWorkspaceId) {
        panel.style.display = 'block';
        panel.style.setProperty('position', 'absolute', 'important');
        panel.style.setProperty('left', '0', 'important');
        panel.style.setProperty('top', '0', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
        panel.style.setProperty('margin', '0', 'important');
        panel.style.setProperty('width', containerW + 'px', 'important');
        panel.style.setProperty('height', panelH + 'px', 'important');
        panel.style.setProperty('max-height', panelH + 'px', 'important');
        panel.style.setProperty('transform', 'none', 'important');
        panel.style.setProperty('overflow', 'hidden', 'important');
        
        const webviewContainer = panel.querySelector('.webview-container');
        if (webviewContainer) {
          webviewContainer.style.setProperty('height', '100%', 'important');
          webviewContainer.style.setProperty('min-height', '0', 'important');
        }
        const wsExpandBody = panel.querySelector('.ws-expand-body');
        if (wsExpandBody) {
          wsExpandBody.style.setProperty('height', '100%', 'important');
        }
      } else {
        panel.style.display = 'none';
        panel.style.width = '';
        panel.style.height = '';
        panel.style.maxHeight = '';
      }
      panel.classList.remove('active-ws');
    });
    
    document.querySelectorAll('.ws-corner-highlight').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.resize-handle').forEach(el => {
      el.style.display = 'none';
    });
  }
}

// 循环切换展开比例：全展 → 1/2 → 1/4 → 全展
function cycleExpandRatio() {
  expandRatioIndex = (expandRatioIndex + 1) % expandRatioLabels.length;
  const ratioBtn = document.getElementById('expandRatioBtn');
  if (ratioBtn) ratioBtn.textContent = expandRatioLabels[expandRatioIndex];
  applyExpandRatio();
}

// 应用展开比例（Masonry 紧凑布局 - 绝对定位，临近吸附）
function applyExpandRatio() {
  if (!expandViewEnabled) return;
  const container = document.getElementById('dataContainer');
  if (!container) return;

  calcStdDimensions();

  const visiblePanels = Array.from(container.querySelectorAll('.workspace-panel')).filter(p => p.style.display !== 'none');
  if (visiblePanels.length === 0) return;

  // 清除比例 class 和 grid 样式
  container.classList.remove('ratio-2-2', 'ratio-3-3');
  container.style.gridTemplateColumns = '';

  const GAP = 8;
  const containerRect = container.getBoundingClientRect();
  const containerW = containerRect.width;

  let stdBaseW, stdBaseH;

  if (expandRatioIndex === 0) {
    stdBaseW = containerW;
    stdBaseH = wsStdH;
  } else if (expandRatioIndex === 1) {
    stdBaseW = Math.floor((containerW - GAP) / 2);
    stdBaseH = Math.floor(wsStdH * 0.5);
  } else {
    stdBaseW = Math.floor((containerW - GAP * 2) / 3);
    stdBaseH = Math.floor(wsStdH * 0.33);
  }

  console.log(`[applyExpandRatio] mode=${expandRatioLabels[expandRatioIndex]}, containerW=${containerW}, stdBaseW=${stdBaseW}, stdBaseH=${stdBaseH}`);

  // 收集每个面板的尺寸（直接用设置的值，不测量 offsetHeight）
  const panelData = visiblePanels.map(p => {
    const wsId = p.getAttribute('data-ws');
    const custom = _customPanelSizes[wsId];
    return {
      el: p,
      wsId,
      w: custom ? custom.w : stdBaseW,
      h: custom ? custom.h : stdBaseH
    };
  });

  // 行式装箱算法：卡片紧贴排列，行满才换行，实现真正的左右边缘吸附
  const rows = []; // 每行: { y, items: [{x, w, h, el}], height }

  panelData.forEach(pd => {
    let placed = false;

    // 尝试放入现有行
    for (const row of rows) {
      const rowUsedW = row.items.reduce((sum, it) => sum + it.w + GAP, 0) - GAP;
      if (rowUsedW + pd.w + GAP <= containerW + GAP) {
        // 可以放入此行
        const x = rowUsedW + GAP;
        row.items.push({ x, w: pd.w, h: pd.h, el: pd.el });
        if (pd.h > row.height) row.height = pd.h;
        placed = true;
        break;
      }
    }

    // 没有合适的行，创建新行
    if (!placed) {
      const y = rows.length === 0 ? 0 : rows.reduce((max, r) => Math.max(max, r.y + r.height + GAP), 0);
      rows.push({
        y,
        items: [{ x: 0, w: pd.w, h: pd.h, el: pd.el }],
        height: pd.h
      });
    }
  });

  // 应用绝对定位
  rows.forEach(row => {
    row.items.forEach(it => {
      it.el.style.setProperty('position', 'absolute', 'important');
      it.el.style.setProperty('left', it.x + 'px', 'important');
      it.el.style.setProperty('top', row.y + 'px', 'important');
      it.el.style.setProperty('right', 'auto', 'important');
      it.el.style.setProperty('bottom', 'auto', 'important');
      it.el.style.setProperty('margin', '0', 'important');
      it.el.style.setProperty('width', it.w + 'px', 'important');
      it.el.style.setProperty('height', it.h + 'px', 'important');
      it.el.style.setProperty('max-height', it.h + 'px', 'important');
    });
  });

  // 容器高度 = 最后一行底部
  const totalH = rows.length > 0
    ? rows.reduce((max, r) => Math.max(max, r.y + r.height), 0) + GAP
    : 0;

  container.style.position = 'relative';
  container.style.display = 'block';
  container.style.height = totalH + 'px';
  container.style.minHeight = totalH + 'px';

  console.log(`[applyExpandRatio] masonry done, rows=${rows.length}, totalH=${totalH}`);

  // 面板尺寸变化后，重新应用 zoomFactor 和更新手柄
  setTimeout(() => {
    applyAllWebviewZooms();
    updateAllCornerHighlights();
  }, 100);
  setTimeout(() => {
    updateAllCornerHighlights();
  }, 300);
  setTimeout(() => {
    updateAllCornerHighlights();
  }, 600);
}

// ====== 拖动手柄调整面板尺寸 ======
let _resizeState = null;
const _customPanelSizes = {}; // 记录每个面板的自定义尺寸 { wsId: { w, h } }

// 定位右下角弧形描边到面板右下角（fixed 定位 + getBoundingClientRect）
function positionCornerHighlight(wsId) {
  const panel = document.querySelector(`.workspace-panel[data-ws="${wsId}"]`);
  const highlight = document.querySelector(`.ws-corner-highlight[data-ws="${wsId}"]`);
  if (!panel || !highlight) return;

  const panelRect = panel.getBoundingClientRect();
  // 面板未渲染或尺寸为 0 时不显示手柄
  if (panelRect.width < 50 || panelRect.height < 50) {
    highlight.style.display = 'none';
    return;
  }

  highlight.style.display = 'block';

  const highlightSize = 20;
  const left = panelRect.right - highlightSize;
  const top = panelRect.bottom - highlightSize;

  highlight.style.left = Math.max(0, left) + 'px';
  highlight.style.top = Math.max(0, top) + 'px';
}

// 更新所有可见的右下角弧形描边
function updateAllCornerHighlights() {
  if (!expandViewEnabled) return;
  getSortedWorkspaceIds().forEach(wsId => {
    const panel = document.querySelector(`.workspace-panel[data-ws="${wsId}"]`);
    if (panel && panel.style.display !== 'none') {
      // 检查弧形手柄是否存在，如果不存在则创建
      let highlight = document.querySelector(`.ws-corner-highlight[data-ws="${wsId}"]`);
      if (!highlight) {
        highlight = document.createElement('div');
        highlight.className = 'ws-corner-highlight';
        highlight.setAttribute('data-ws', wsId);
        document.body.appendChild(highlight);
        console.log(`[CornerHighlight] 为工作区 ${wsId} 创建弧形手柄`);
      }
      positionCornerHighlight(wsId);
    }
  });
}

// 滚动时同步弧形描边位置（容器有 overflow-y: auto，滚动发生在容器上）
function setupCornerHighlightScrollListener() {
  const container = document.getElementById('dataContainer');
  if (!container) return;
  container.addEventListener('scroll', () => {
    if (expandViewEnabled) updateAllCornerHighlights();
  });
  document.addEventListener('scroll', () => {
    if (expandViewEnabled) updateAllCornerHighlights();
  }, true);
}

function initResizeHandles() {
  document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.resize-handle, .ws-corner-highlight');
    if (!handle) return;

    e.preventDefault();
    e.stopPropagation();

    const wsId = handle.getAttribute('data-ws');
    const panel = document.querySelector(`.workspace-panel[data-ws="${wsId}"]`);
    if (!panel) return;

    if (handle.classList.contains('resize-handle')) {
      handle.classList.add('active');
    }

    // 用 width !important 强制覆盖 Grid 1fr 约束
    panel.style.setProperty('width', panel.offsetWidth + 'px', 'important');
    panel.style.setProperty('height', panel.offsetHeight + 'px', 'important');
    panel.style.setProperty('max-height', panel.offsetHeight + 'px', 'important');

    _resizeState = {
      wsId,
      panel,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startW: panel.offsetWidth,
      startH: panel.offsetHeight
    };
  });

  document.addEventListener('mousemove', (e) => {
    if (!_resizeState) return;

    const { panel, startX, startY, startW, startH } = _resizeState;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newW = Math.max(200, startW + dx);
    const newH = Math.max(150, startH + dy);

    panel.style.setProperty('width', newW + 'px', 'important');
    panel.style.setProperty('height', newH + 'px', 'important');
    panel.style.setProperty('max-height', newH + 'px', 'important');

    updateAllCornerHighlights();
    applyWebviewZoom(_resizeState.wsId);
  });

  document.addEventListener('mouseup', () => {
    if (!_resizeState) return;
    if (_resizeState.handle.classList.contains('resize-handle')) {
      _resizeState.handle.classList.remove('active');
    }
    // 保存自定义尺寸
    const wsId = _resizeState.wsId;
    const panel = _resizeState.panel;
    _customPanelSizes[wsId] = { w: panel.offsetWidth, h: panel.offsetHeight };
    _resizeState = null;
    // 重新布局所有卡片，避免拖大的卡片与相邻卡片重叠
    applyExpandRatio();
  });
}

// 更新展开模式下的标题栏状态
function updateExpandHeaders() {
  if (!expandViewEnabled) return;
  getSortedWorkspaceIds().forEach(wsId => {
    const header = document.querySelector(`.ws-expand-header[data-ws-header="${wsId}"]`);
    if (!header) return;
    const ws = workspaces[wsId];
    const dot = header.querySelector('.ws-expand-dot');
    const statusEl = header.querySelector('.ws-expand-status');
    const nameEl = header.querySelector('.ws-expand-name');

    if (dot) {
      dot.className = 'ws-expand-dot ' + (ws.status || 'idle');
    }
    if (statusEl) {
      const statusMap = { running: '运行中', waiting: '等待中', idle: '空闲', done: '已完成' };
      statusEl.textContent = statusMap[ws.status] || '空闲';
    }
    if (nameEl && ws.title && ws.title !== wsId) {
      nameEl.textContent = `${wsId} - ${ws.title}`;
    }
  });
}

// 获取或创建 hover 工具提示
function getHoverTooltip() {
  if (_hoverTooltipEl) return _hoverTooltipEl;

  const el = document.createElement('div');
  el.id = 'wsThumbnailTooltip';
  el.className = 'ws-thumbnail-tooltip';
  el.innerHTML = `
    <img id="wsTooltipImg" src="" alt="缩图" />
    <div class="ws-tooltip-label" id="wsTooltipLabel"></div>
  `;
  document.body.appendChild(el);
  _hoverTooltipEl = el;
  return el;
}

// 初始化工作区页签的 hover 和点击事件
function initWorkspaceTabEvents() {
  console.log('[Workspace] 开始绑定页签事件...');
  getSortedWorkspaceIds().forEach(wsId => {
    const tab = document.querySelector(`.ai-workspace-tab[data-workspace="${wsId}"]`);
    if (!tab) {
      console.warn(`[Workspace] 未找到页签: ${wsId}`);
      return;
    }

    // hover 事件
    tab.addEventListener('mouseenter', (e) => {
      console.log(`[Workspace] mouseenter: ${wsId}`);
      onTabMouseEnter(wsId, e);
    });
    tab.addEventListener('mouseleave', () => {
      console.log(`[Workspace] mouseleave: ${wsId}`);
      onTabMouseLeave();
    });

    // 点击呼吸圆点关闭工作区
    const dot = document.getElementById(`ws-dot-${wsId}`);
    if (dot) {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        closeWorkspace(wsId);
      });
      dot.title = '点击关闭/重置此工作区';
      console.log(`[Workspace] 绑定圆点事件: ${wsId}`);
    } else {
      console.warn(`[Workspace] 未找到圆点: ws-dot-${wsId}`);
    }
  });
  console.log('[Workspace] 页签事件绑定完成');
}

// 关闭/重置工作区
function closeWorkspace(workspaceId) {
  if (!workspaces[workspaceId]) return;

  // 确认弹窗
  const wsName = workspaces[workspaceId].title || workspaceId;
  if (!confirm(`确定要关闭工作区 ${workspaceId}${wsName !== workspaceId ? '（' + wsName + '）' : ''} 吗？\n\n这将清除该工作区的网页内容和AI网点设定。`)) {
    return;
  }

  const ws = workspaces[workspaceId];

  // 重置工作区状态
  ws.status = 'idle';
  ws.bookmarkIndex = null;
  ws.title = workspaceId;
  ws.replySelector = '';
  ws.heartbeatSelector = '';
  ws.monitorTimeout = 0;
  ws.wsUrl = ''; // 🔑 关键修复：清除 URL，防止 renderWebPreview 使用旧 URL

  // 清除该工作区的活跃卡片记忆，防止关闭后回退到旧卡片
  delete workspaceActiveCards[workspaceId];
  currentActiveCardIndex = -1;

  // 更新状态圆点
  updateWorkspaceStatus(workspaceId, 'idle');

  // 清除页签名称
  const nameEl = document.getElementById(`ws-name-${workspaceId}`);
  if (nameEl) nameEl.textContent = '';

  // 清除 webview 内容
  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const closePanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  const webview = closePanel ? closePanel.querySelector(`#previewWebview${wsSuffix}`) : null;
  if (webview) {
    try {
      webview.loadURL('about:blank');
    } catch (e) {
      console.log(`[Workspace] 清除 webview 失败:`, e);
    }
  }

  // 清除桌面APP对话面板
  if (closePanel) {
    const chatPanel = closePanel.querySelector('.desktop-app-chat-panel');
    if (chatPanel) {
      chatPanel.remove();
      console.log(`[Workspace] 已清除工作区 ${workspaceId} 的桌面APP对话面板`);
    }
  }

  // 清除 webview URL 输入框
  const urlInput = closePanel ? closePanel.querySelector(`#webviewUrlInput${wsSuffix}`) : null;
  if (urlInput) urlInput.value = '';

  // 从已加载集合中移除，以便下次重新加载
  loadedWebviewWorkspaces.delete(workspaceId);

  // 清除右下角拖动手柄
  const cornerHighlight = document.querySelector(`.ws-corner-highlight[data-ws="${workspaceId}"]`);
  if (cornerHighlight) cornerHighlight.remove();

  // 🔑 关键修复：清除全局 webview 引用，防止跨工作区污染
  if (window._monitorWebview) {
    try {
      const monitorUrl = window._monitorWebview.getURL ? window._monitorWebview.getURL() : '';
      // 只清除属于当前工作区的 webview 引用
      const wsPanel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
      const wsWebview = wsPanel ? wsPanel.querySelector('webview') : null;
      if (wsWebview && window._monitorWebview === wsWebview) {
        window._monitorWebview = null;
        console.log(`[Workspace] 已清除工作区 ${workspaceId} 的 _monitorWebview 引用`);
      }
    } catch (e) {
      console.warn(`[Workspace] 清除 _monitorWebview 失败:`, e);
    }
  }

  console.log(`[Workspace] 工作区 ${workspaceId} 已关闭/重置`);
  showStatus(`✅ 工作区 ${workspaceId} 已关闭`, 'success');
}

// 获取工作区 webview 的截图
async function captureWorkspaceThumbnail(workspaceId) {
  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const webviewId = `previewWebview${wsSuffix}`;
  
  // 从工作区面板中查找 webview，避免找到其他工作区的同名元素
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  const webview = panel ? panel.querySelector(`#${webviewId}`) : document.getElementById(webviewId);
  
  if (!webview) {
    console.log(`[Thumbnail] webview 不存在: ${webviewId}`);
    return null;
  }

  try {
    const url = webview.getURL();
    if (!url || url === 'about:blank') {
      console.log(`[Thumbnail] webview URL 为空或 about:blank: ${workspaceId}`);
      return null;
    }

    if (typeof webview.capturePage !== 'function') {
      console.error(`[Thumbnail] webview.capturePage 不是函数! webview 类型: ${webview.tagName}`);
      return null;
    }

    const image = await webview.capturePage();
    console.log(`[Thumbnail] 捕获成功: ${workspaceId}, size=${image.getSize().width}x${image.getSize().height}`);
    return { dataUrl: image.toDataURL(), url, workspaceId };
  } catch (e) {
    console.error(`[Thumbnail] 捕获工作区 ${workspaceId} 缩图失败:`, e.message || e);
    return null;
  }
}

// hover 进入工作区页签
async function onTabMouseEnter(workspaceId, event) {
  console.log(`[Thumbnail] onTabMouseEnter: ${workspaceId}`);
  // 记录当前 hover 的工作区 ID
  hoveredWorkspaceId = workspaceId;
  
  if (hoverThumbnailTimer) {
    clearTimeout(hoverThumbnailTimer);
    hoverThumbnailTimer = null;
  }
  // 清除之前的刷新定时器
  if (thumbnailRefreshTimer) {
    clearInterval(thumbnailRefreshTimer);
    thumbnailRefreshTimer = null;
  }

  const tooltip = getHoverTooltip();
  const tooltipImg = document.getElementById('wsTooltipImg');
  const tooltipLabel = document.getElementById('wsTooltipLabel');
  if (!tooltip || !tooltipImg || !tooltipLabel) {
    console.error(`[Thumbnail] 工具提示元素创建失败!`);
    return;
  }

  const ws = workspaces[workspaceId];
  if (!ws) {
    console.error(`[Thumbnail] 工作区不存在: ${workspaceId}`);
    return;
  }
  const wsName = ws.title || workspaceId;
  const wsStatus = ws.status || 'idle';
  const statusText = wsStatus === 'running' ? '运行中' : wsStatus === 'waiting' ? '等待中' : '空闲';

  tooltipLabel.textContent = `${workspaceId}${wsName !== workspaceId ? ' - ' + wsName : ''} [${statusText}]`;
  tooltipImg.src = '';

  // 定位 tooltip（相对于视口）
  const rect = event.currentTarget.getBoundingClientRect();
  tooltip.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
  tooltip.style.top = (rect.bottom + 8) + 'px';
  tooltip.style.display = 'block';

  // 立即捕获一次缩图
  const result = await captureWorkspaceThumbnail(workspaceId);
  // 检查是否仍然是当前 hover 的工作区（防止异步回调乱序）
  if (result && hoveredWorkspaceId === workspaceId) {
    tooltipImg.src = result.dataUrl;
  }

  // 对活跃工作区启动每 2 秒的持续刷新（使用递归 setTimeout 替代 setInterval，更可靠）
  if (wsStatus === 'running' || wsStatus === 'waiting') {
    console.log(`[Thumbnail] 启动刷新循环: ${workspaceId}`);
    const refreshLoop = async () => {
      // 检查是否仍然是当前 hover 的工作区
      if (hoveredWorkspaceId !== workspaceId) {
        console.log(`[Thumbnail] 刷新循环终止: ${workspaceId} (hoveredWorkspaceId=${hoveredWorkspaceId})`);
        return;
      }
      const fresh = await captureWorkspaceThumbnail(workspaceId);
      if (fresh && hoveredWorkspaceId === workspaceId) {
        tooltipImg.src = fresh.dataUrl;
        console.log(`[Thumbnail] 刷新成功: ${workspaceId}`);
      }
      // 2 秒后继续刷新
      thumbnailRefreshTimer = setTimeout(refreshLoop, 2000);
    };
    refreshLoop();
  }
}

// hover 离开工作区页签
function onTabMouseLeave() {
  // 清除 hover 工作区 ID
  hoveredWorkspaceId = null;
  // 清除刷新定时器
  if (thumbnailRefreshTimer) {
    clearTimeout(thumbnailRefreshTimer);
    thumbnailRefreshTimer = null;
  }
  hoverThumbnailTimer = setTimeout(() => {
    const tooltip = _hoverTooltipEl;
    if (tooltip) {
      tooltip.style.display = 'none';
      const img = document.getElementById('wsTooltipImg');
      if (img) img.src = '';
    }
  }, 150);
}

// ========== Webview 辅助函数 ==========

// 加载 Webview URL
function loadWebviewUrl() {
  const urlInput = getCurrentWebviewUrlInput();
  const webview = getCurrentWebview();
  const loading = getCurrentWebviewLoading();

  if (!urlInput || !webview) return;

  let url = urlInput.value.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  if (loading) loading.style.display = 'block';
  webview.loadURL(url);

  // 更新工作区对象的 URL
  workspaces[currentWorkspaceId].wsUrl = url;
}

// 刷新 Webview
function refreshWebview() {
  const webview = getCurrentWebview();
  const loading = getCurrentWebviewLoading();
  
  if (webview) {
    if (loading) loading.style.display = 'block';
    webview.reload();
  }
}

// 网页活动监控
let activityMonitorState = {
  active: false,
  observer: null,
  networkTimer: null,
  domReadyTimer: null,
  animationFrame: null,
  lastActivityTime: 0,
  idleTimeout: 3000, // 3秒无活动判定为静止
  activityCount: 0,
  pollTimer: null
};

/**
 * 🆕 等待网页内容稳定（可复用 Promise 函数）
 * @param {Webview} webview - 要监控的 webview 元素
 * @param {number} idleTimeout - 空闲超时时间（毫秒），默认使用卡片自定义值或 15000ms
 * @returns {Promise<{stable: boolean, activityCount: number}>}
 */
async function waitForContentStable(webview, idleTimeout, heartbeatSelector) {
  // 🆕 改用 waitForActivityToComplete（与手动监控按钮相同的完整逻辑）
  //    包含：心跳选择器降级链、自动展开思考面板、选择器未找到时等待元素出现
  const timeout = idleTimeout || (window.__monitorTimeout && window.__monitorTimeout > 0 ? window.__monitorTimeout : 15000);
  const replySelector = window.currentReplySelector || '';
  console.log(`[Monitor] ⏳ 开始监控网页活动（使用 waitForActivityToComplete），超时=${timeout/1000}秒，心跳=${heartbeatSelector || '(无)'}`);

  // 🔑 关键修复：先清理旧的监控结果，防止误判
  try { delete window.__apiMonitorResult; } catch(e) {}
  try { clearInterval(window.__apiMonitorPollTimer); } catch(e) {}
  try { window.__apiMonitorPollTimer = null; } catch(e) {}

  // 等待一小段时间确保清理完成
  await new Promise(resolve => setTimeout(resolve, 100));

  // 调用 waitForActivityToComplete（它会设置 window.__apiMonitorResult 当监控完成时）
  waitForActivityToComplete(webview, replySelector, heartbeatSelector, timeout);

  // 轮询等待监控完成（等待至少3秒后才开始检查，避免误判）
  return new Promise((resolve) => {
    let pollCount = 0;
    const maxPolls = Math.ceil(timeout / 1000) + 30; // 额外留余量
    const minWaitSeconds = 3; // 至少等待3秒

    const pollInterval = setInterval(() => {
      pollCount++;

      // 至少等待 minWaitSeconds 秒后才开始检查
      if (pollCount < minWaitSeconds) {
        return;
      }

      if (window.__apiMonitorResult) {
        clearInterval(pollInterval);
        try {
          const parsed = JSON.parse(window.__apiMonitorResult);
          const stable = parsed && parsed.success === true;
          console.log(`[Monitor] ✅ 内容监控完成（${pollCount}秒，stable=${stable}, 方法: ${parsed.result?.method || '未知'}）`);
          // 清理
          try { delete window.__apiMonitorResult; } catch(e) {}
          resolve({
            stable,
            activityCount: pollCount,
            pollSeconds: pollCount,
            method: parsed.result?.method,
            result: parsed.result,
            error: stable ? undefined : parsed.error || parsed.result?.error
          });
        } catch(e) {
          resolve({ stable: false, activityCount: pollCount, pollSeconds: pollCount, error: e.message });
        }
        return;
      }

      // 超时保护
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        console.log(`[Monitor] ⏱️ 监控超时（${maxPolls}秒）`);
        try { delete window.__apiMonitorResult; } catch(e) {}
        resolve({ stable: false, activityCount: pollCount, pollSeconds: pollCount, timeout: true });
      }
    }, 1000);
  });
}

function toggleActivityMonitor() {
  const btn = getCurrentActivityMonitorBtn();
  if (!btn) return;

  if (activityMonitorState.active) {
    // ⏹️ 停止监控 —— 从 activityMonitorState 取出之前保存的选择器信息显示
    stopActivityMonitor();
    btn.style.background = '#6b7280';
    btn.style.animation = '';
    btn.innerHTML = '监控';
    let stopMsg = '✅ 网页活动已结束，内容已稳定';
    if (activityMonitorState.usedSelector) {
      stopMsg += `（根据${activityMonitorState.selectorSource}: \`${activityMonitorState.usedSelector}\`）`;
    }
    showStatus(stopMsg, 'success');
  } else {
    // ▶️ 启动监控 —— startActivityMonitor 内部会调用 showStatus 显示带选择器的消息
    startActivityMonitor();
    btn.style.background = '#f59e0b';
    btn.style.animation = 'pulse 1.5s infinite';
    btn.innerHTML = '监控';
  }
}

function startActivityMonitor() {
  // 🔧 关键修复：每次调用先清理所有旧状态，防止被之前的结果干扰
  try { delete window.__apiMonitorResult; } catch(e) {}
  try { clearInterval(window.__apiMonitorPollTimer); } catch(e) {}
  try { window.__apiMonitorPollTimer = null; } catch(e) {}

  const webview = getCurrentWebview();
  if (!webview) {
    showStatus(' 未找到网页预览元素', 'error');
    return;
  }

  // 🔧 关键修复：先清理 webview 内部的旧状态变量
  try {
    webview.executeJavaScript('delete window.__expandedElements; delete window.__apiMonitorObserver; delete window.__apiMonitorTargetNode; delete window.__lastDomChangeTime; delete window.__expandedThinkingCount; delete window.__apiMonitorUseMutation; delete window.__apiMonitorTargetFound; delete window.__apiMonitorInitTime; if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__activityMonitor){try{window.__activityMonitor.stop && window.__activityMonitor.stop();}catch(e){} delete window.__activityMonitor;}').catch(() => {});
  } catch(e) {}

  // 🔍 确定监控用的选择器（优先 heartbeatSelector，其次 replySelector，最后用默认硬编码）
  const heartbeatSel = window.__monitorHeartbeatSelector || '';
  const replySel = window.__monitorReplySelector || window.currentReplySelector || '';
  const monitorSelector = heartbeatSel || replySel || '';
  const selectorSource = heartbeatSel ? 'heartbeatSelector（💓）' : (replySel ? 'replySelector（🎯）' : '默认选择器（兜底）');

  console.log('[Renderer] 🔍 === 网页活动监控启动 ===');
  console.log('[Renderer]   - 使用的选择器:', monitorSelector || '(无 - 用默认)');
  console.log('[Renderer]   - 选择器来源:', selectorSource);
  console.log('[Renderer]   - heartbeatSelector:', heartbeatSel || '(未设置)');
  console.log('[Renderer]   - replySelector:', replySel || '(未设置)');

  // 💡 在状态消息中显示所根据的选择器名称
  let monitorMsg = '🔍 已开始网页活动监控';
  if (monitorSelector) {
    monitorMsg += `（根据${selectorSource}: \`${monitorSelector}\`）`;
  } else {
    monitorMsg += '（无自定义选择器，用默认逻辑）';
  }
  showStatus(monitorMsg, 'info');

  // ⏱️ idleTimeout：优先使用卡片自定义的监控超时，默认 15000ms（15秒）
  //    如果 window.__monitorTimeout 有值（由 previewBookmarkByIndex 或 captureElementContentByIndex 设置），使用它
  //    智谱等需要长时间思考的 AI 站点需要设置更长的时间（如 20-30 秒）
  const customIdleTimeout = (window.__monitorTimeout && window.__monitorTimeout > 0) ? window.__monitorTimeout : 15000;

  activityMonitorState = {
    active: true,
    observer: null,
    networkTimer: null,
    domReadyTimer: null,
    animationFrame: null,
    lastActivityTime: Date.now(),
    idleTimeout: customIdleTimeout,
    activityCount: 0,
    usedSelector: monitorSelector || '',
    selectorSource: selectorSource
  };

  // 🔓 0. 先展开「正在思考」折叠面板（AI 正在回复中的思考内容，不展开就不会出现在 DOM 中）
  //    核心改进：用 WeakSet 记录已点击元素，只点击一次，彻底避免 toggle 反复。
  //    同时，对每个「正在思考」候选元素，先找可点击的父元素（箭头/按钮），找不到再点击自身。
  //    永远不要同时点击 cand 和 parent（那会造成 toggle 反复！）
  (async () => {
    try {
      const expandThinkingJs = [
        '(function() {',
        '  try {',
        '    if (!window.__expandedElements) window.__expandedElements = new WeakSet();',
        '    var clicked = 0;',
        '    function findClickableParent(el) {',
        '      var current = el;',
        '      for (var layer = 0; layer < 8 && current && current.parentNode; layer++) {',
        '        current = current.parentNode;',
        '        if (!current || current.nodeType !== 1) continue;',
        '        if (window.__expandedElements.has(current)) return current;',
        '        var cs = window.getComputedStyle(current);',
        '        if (cs.display === "none" || cs.visibility === "hidden") continue;',
        '        var cName = (current.className || "").toString();',
        '        var isCursorPointer = cs.cursor === "pointer";',
        '        var isClickableTag = /^(BUTTON|A|DIV|SPAN|SUMMARY|LABEL|LI)$/.test(current.tagName);',
        '        var hasExpandClass = /(toggle|expand|collapse|clickable|interactive|reasoning|thinking|caret|arrow|chevron)/i.test(cName + " " + (current.getAttribute("role") || "") + " " + (current.getAttribute("data-state") || ""));',
        '        if (isCursorPointer || (isClickableTag && hasExpandClass)) { return current; }',
        '      }',
        '      return null;',
        '    }',
        '    // 策略 A：找到文字内容为「正在思考」的元素',
        '    //   只点一次（由 WeakSet 保证），点完后把 cand 和 target 都加入 WeakSet，防止下一轮误点击',
        '    var allTextEls = document.body.querySelectorAll(\'*\');',
        '    for (var k = 0; k < allTextEls.length; k++) {',
        '      var cand = allTextEls[k];',
        '      if (!cand || cand.nodeType !== 1) continue;',
        '      if (window.__expandedElements.has(cand)) continue;',
        '      var style = window.getComputedStyle(cand);',
        '      if (style.display === "none" || style.visibility === "hidden") continue;',
        '      if (cand.offsetWidth === 0 || cand.offsetHeight === 0) continue;',
        '      var children = cand.children ? cand.children.length : 0;',
        '      if (children > 3) continue;',
        '      var candText = (cand.innerText || cand.textContent || "").trim();',
        '      if (!candText || candText.length > 30) continue;',
        '      if (!/正在思考|thinking|reasoning/i.test(candText)) continue;',
        '      if (/思考过程|已完成|生成完毕|完整结果|对话完成|已生成|结束/i.test(candText)) continue;',
        '      // 🎯 只点一次：优先点可点击父元素（箭头/按钮），没有父元素则点自身',
        '      var target = findClickableParent(cand) || cand;',
        '      if (window.__expandedElements.has(target)) continue;',
        '      try {',
        '        target.click();',
        '        clicked++;',
        '        window.__expandedElements.add(target);',
        '        window.__expandedElements.add(cand);',
        '      } catch(e) {}',
        '    }',
        '    // 策略 B：通过 class 名匹配 reasoning/thinking 类折叠容器',
        '    try {',
        '      var reasoningEls = document.querySelectorAll(\'[class*="reasoning"], [class*="thinking"], [class*="思考"], [data-state="collapsed"]\');',
        '      for (var n = 0; n < reasoningEls.length; n++) {',
        '        var rEl = reasoningEls[n];',
        '        if (window.__expandedElements.has(rEl)) continue;',
        '        var rStyle = window.getComputedStyle(rEl);',
        '        if (rStyle.display === "none" || rStyle.visibility === "hidden") continue;',
        '        var rText = (rEl.innerText || rEl.textContent || "").trim();',
        '        if (/思考过程|已完成|生成完毕|完整结果|对话完成/i.test(rText)) continue;',
        '        try { rEl.click(); clicked++; window.__expandedElements.add(rEl); } catch(e) {',
        '          try {',
        '            if (rEl.firstElementChild && !window.__expandedElements.has(rEl.firstElementChild)) {',
        '              rEl.firstElementChild.click(); clicked++; window.__expandedElements.add(rEl.firstElementChild);',
        '            }',
        '          } catch(e2) {}',
        '        }',
        '      }',
        '    } catch(e) {}',
        '    return JSON.stringify({ success: true, clicked: clicked });',
        '  } catch(e) { return JSON.stringify({ success: false, error: e.toString() }); }',
        '})();'
      ].join('\n');

      const expandResultStr = await webview.executeJavaScript(expandThinkingJs);
      const expandResult = (typeof expandResultStr === 'string' && expandResultStr) ? JSON.parse(expandResultStr) : (expandResultStr || {});
      console.log('[Renderer] 🔓 尝试展开「正在思考」面板 - 结果:', expandResult);
      if (expandResult && expandResult.clicked && expandResult.clicked > 0) {
        showStatus(`🔍 已开始网页活动监控（展开 ${expandResult.clicked} 个「正在思考」面板）`, 'info');
      } else {
        showStatus(`🔍 已开始网页活动监控（根据${selectorSource}: \`${monitorSelector}\`）`, 'info');
      }
    } catch(e) {
      console.warn('[Renderer] ⚠️ 展开「正在思考」面板失败（不影响主流程）:', e.message);
    }
  })();

  // 1. 注入 MutationObserver 监控脚本到 webview（优先用心跳选择器，其次自定义回复选择器）
  //    🔓 关键修复：把 expandThinkingPanels 函数也注入到 webview 内部，让它在监控期间持续展开「正在思考」
  const injectJs = [
    '(function() {',
    '  if (window.__activityMonitor) { window.__activityMonitor.stop(); }',
    '  ',
    '  // 🔓 展开「正在思考」折叠面板的函数（核心改进：用 WeakSet 记录已点击元素，完全无 setInterval 轮询）',
    '  function expandThinkingPanels() {',
    '    try {',
    '      // 🚀 关键改进1：用 WeakSet 记录已点击元素，确保每个元素只点击一次',
    '      if (!window.__expandedElements) window.__expandedElements = new WeakSet();',
    '      var clicked = 0;',
    '      function findClickableParent(el) {',
    '        var current = el;',
    '        for (var layer = 0; layer < 5 && current && current.parentNode; layer++) {',
    '          current = current.parentNode;',
    '          if (!current || current.nodeType !== 1) continue;',
    '          var cs = window.getComputedStyle(current);',
    '          if (cs.display === "none" || cs.visibility === "hidden") continue;',
    '          var cName = (current.className || "").toString();',
    '          var isCursorPointer = cs.cursor === "pointer";',
    '          var isClickableTag = /^(BUTTON|A|DIV|SPAN|SUMMARY|LABEL)$/.test(current.tagName);',
    '          var hasExpandClass = /(toggle|expand|collapse|clickable|interactive|reasoning|thinking)/i.test(cName + " " + (current.getAttribute("role") || ""));',
    '          if (isCursorPointer || (isClickableTag && hasExpandClass)) { return current; }',
    '        }',
    '        return null;',
    '      }',
    '      // 🚀 关键改进2：isCollapsed 默认 true（智谱等网站没有 aria-expanded 属性），用 WeakSet 做防重复点击',
    '      function isCollapsed(el) {',
    '        var ae = el.getAttribute ? el.getAttribute("aria-expanded") : null;',
    '        if (ae === "true") return false;   // 明确已展开 → 不要点',
    '        if (ae === "false") return true;   // 明确已折叠 → 需要点',
    '        // 父元素上查找',
    '        var p = el.parentNode;',
    '        for (var i = 0; i < 5 && p && p.nodeType === 1; i++) {',
    '          var pa = p.getAttribute ? p.getAttribute("aria-expanded") : null;',
    '          if (pa === "true") return false;',
    '          if (pa === "false") return true;',
    '          p = p.parentNode;',
    '        }',
    '        // 🚀 关键改进3：无 aria-expanded 属性时默认 true（点击），',
    '        // 依靠 WeakSet（window.__expandedElements）保证每个元素只点击一次，阻止 toggle 反复',
    '        return true;',
    '      }',
    '      // 策略1：文字匹配「正在思考/thinking/reasoning」',
    '      var allEls = document.body ? document.body.querySelectorAll("*") : [];',
    '      for (var k = 0; k < allEls.length; k++) {',
    '        var cand = allEls[k];',
    '        if (!cand || cand.nodeType !== 1) continue;',
    '        if (window.__expandedElements.has(cand)) continue;  // 已点击过，跳过',
    '        var cs2 = window.getComputedStyle(cand);',
    '        if (cs2.display === "none" || cs2.visibility === "hidden") continue;',
    '        if (cand.offsetWidth === 0 || cand.offsetHeight === 0) continue;',
    '        var ch = cand.children ? cand.children.length : 0;',
    '        if (ch > 3) continue;',
    '        var txt = (cand.innerText || cand.textContent || "").trim();',
    '        if (!txt || txt.length > 30) continue;',
    '        if (!/正在思考|thinking|reasoning/i.test(txt)) continue;',
    '        if (/思考过程|已完成|生成完毕|完整结果/i.test(txt)) continue;   // 🚀 跳过已完成状态（不是可折叠的思考节点）',
    '        if (!isCollapsed(cand)) continue;',
    '        var target = findClickableParent(cand) || cand;',
    '        if (window.__expandedElements.has(target)) continue;  // 目标元素已点过',
    '        try { target.click(); clicked++; window.__expandedElements.add(target); window.__expandedElements.add(cand); } catch(e) {}',
    '      }',
    '      // 策略2：class 名 reasoning/thinking/思考',
    '      try {',
    '        var reasoningEls = document.querySelectorAll(\'[class*="reasoning"], [class*="thinking"], [class*="思考"]\');',
    '        for (var n = 0; n < reasoningEls.length; n++) {',
    '          var rEl = reasoningEls[n];',
    '          if (window.__expandedElements.has(rEl)) continue;  // 已点击过，跳过',
    '          var rStyle = window.getComputedStyle(rEl);',
    '          if (rStyle.display === "none" || rStyle.visibility === "hidden") continue;',
    '          if (rEl.offsetWidth === 0 || rEl.offsetHeight === 0) continue;',
    '          if (!isCollapsed(rEl)) continue;',
    '          try { rEl.click(); clicked++; window.__expandedElements.add(rEl); } catch(e) { try { if (rEl.firstElementChild && !window.__expandedElements.has(rEl.firstElementChild)) { rEl.firstElementChild.click(); clicked++; window.__expandedElements.add(rEl.firstElementChild); } } catch(e2) {} }',
    '        }',
    '      } catch(e) {}',
    '      if (clicked > 0) { window.__expandedThinkingCount = (window.__expandedThinkingCount || 0) + clicked; }',
    '    } catch(e) {}',
    '  }',
    '  expandThinkingPanels();   // 🚀 先立即执行一次',
    '  // 🚀 然后每 2 秒扫描一次（AI 思考节点是动态出现的，需要持续扫描新节点）。',
    '  //    用 WeakSet（window.__expandedElements）保证每个元素只点一次，彻底避免 toggle 反复。',
    '  if (!window.__expandThinkingTimer) { window.__expandThinkingTimer = setInterval(expandThinkingPanels, 2000); }',
    '  ',
    '  var targetNode = null;',
    '  var activityCount = 0;',
    '  var customSelector = ' + JSON.stringify(monitorSelector) + ';',
    '  ',
    '  // 优先使用传入的选择器（heartbeatSelector 或 replySelector）',
    '  if (customSelector) {',
    '    try {',
    '      var found = document.querySelector(customSelector);',
    '      if (found) {',
    '        targetNode = found;',
    '        console.log("[ActivityMonitor] ✅ 使用自定义选择器监控:", customSelector);',
    '      } else {',
    '        console.log("[ActivityMonitor] ⚠️ 自定义选择器未找到元素，等待出现后重试...");',
    '      }',
    '    } catch(e) {',
    '      console.log("[ActivityMonitor] ❌ querySelector异常:", e.toString());',
    '    }',
    '  }',
    '  ',
    '  // 如果没找到自定义目标，尝试默认 AI 回复容器',
    '  if (!targetNode) {',
    '    var selectors = [".markdown-body", ".message-ai", ".ai-content", ".chat-content", "[class*=\\"ai\\"].content"];',
    '    for (var i = 0; i < selectors.length; i++) {',
    '      var el = document.querySelector(selectors[i]);',
    '      if (el) { targetNode = el; break; }',
    '    }',
    '  }',
    '  ',
    '  // 如果没找到特定容器，使用 document.body',
    '  if (!targetNode) targetNode = document.body;',
    '  ',
    '  window.__lastDomChangeTime = Date.now();',
    '  ',
    '  var observer = new MutationObserver(function(mutations) {',
    '    activityCount++;',
    '    window.__lastDomChangeTime = Date.now();',
    '    setTimeout(expandThinkingPanels, 500); // 🔓 DOM 变化后也尝试展开',
    '  });',
    '  ',
    '  observer.observe(targetNode, {',
    '    childList: true,',
    '    characterData: true,',
    '    subtree: true',
    '  });',
    '  ',
    '  window.__activityMonitor = {',
    '    observer: observer,',
    '    targetNode: targetNode,',
    '    activityCount: 0,',
    '    start: function() {',
    '      window.__lastDomChangeTime = Date.now();',
    '    },',
    '    getState: function() {',
    '      var timeSinceChange = Date.now() - (window.__lastDomChangeTime || 0);',
    `      if (timeSinceChange >= ${customIdleTimeout}) return { state: "idle", activityCount: activityCount };`,
    '      return { state: "active", activityCount: activityCount };',
    '    },',
    '    reset: function() {',
    '      window.__lastDomChangeTime = Date.now();',
    '    },',
    '    stop: function() {',
    '      if (observer) observer.disconnect();',
    '      if (window.__expandThinkingTimer) { clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer = null; }',
    '      delete window.__activityMonitor;',
    '    }',
    '  };',
    '})();'
  ].join('\n');

  webview.executeJavaScript(injectJs).catch(() => {});

  // 启动 webview 内部监控
  setTimeout(() => {
    webview.executeJavaScript('window.__activityMonitor && window.__activityMonitor.start();').catch(() => {});
  }, 1500);

  // 主窗口轮询 webview 状态
  activityMonitorState.pollTimer = setInterval(() => {
    if (!activityMonitorState.active) return;
    
    webview.executeJavaScript('window.__activityMonitor && JSON.stringify(window.__activityMonitor.getState());').then((result) => {
      try {
        const state = JSON.parse(result);
        if (state.state === 'active') {
          activityMonitorState.activityCount = state.activityCount;
          updateMonitorButton('active');
        } else if (state.state === 'idle') {
          stopActivityMonitor();
          updateMonitorButton('completed');
        }
      } catch(e) {
        // ignore parse errors
      }
    }).catch(() => {});
  }, 1000);
}

function stopActivityMonitor() {
  if (activityMonitorState.pollTimer) {
    clearInterval(activityMonitorState.pollTimer);
    activityMonitorState.pollTimer = null;
  }
  if (activityMonitorState.observer) {
    activityMonitorState.observer.stop();
  }
  if (activityMonitorState.networkTimer) {
    clearInterval(activityMonitorState.networkTimer);
  }
  if (activityMonitorState.animationFrame) {
    cancelAnimationFrame(activityMonitorState.animationFrame);
  }
  // 🛑 清理 webview 内部的展开计时器（防止 AI 回复结束后还在反复点击）
  const wv = getCurrentWebview();
  if (wv) {
    try {
      wv.executeJavaScript('(function(){ if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();} if(window.__activityMonitor && window.__activityMonitor.stop){window.__activityMonitor.stop();} })();');
    } catch(e) {}
  }
  activityMonitorState.active = false;
  // 清理 webview 中的监控脚本
  const webview = getCurrentWebview();
  if (webview) {
    webview.executeJavaScript('window.__activityMonitor && window.__activityMonitor.stop();').catch(() => {});
  }
}

function updateMonitorButton(state) {
  const btn = getCurrentActivityMonitorBtn();
  if (!btn) return;
  
  if (state === 'active') {
    btn.style.background = '#f59e0b';
    btn.style.animation = 'pulse 1.5s infinite';
    btn.innerHTML = '监控';
  } else if (state === 'completed') {
    btn.style.background = '#10b981';
    btn.style.animation = '';
    btn.innerHTML = '完成';
    // 💡 结束时也显示所根据的选择器名称
    let completeMsg = '✅ 网页活动已结束，内容已稳定';
    if (activityMonitorState.usedSelector) {
      completeMsg += `（根据${activityMonitorState.selectorSource}: \`${activityMonitorState.usedSelector}\`）`;
    }
    showStatus(completeMsg, 'success');
    
    // 3秒后恢复默认状态
    setTimeout(() => {
      if (!activityMonitorState.active) {
        btn.style.background = '#6b7280';
        btn.innerHTML = '监控';
      }
    }, 3000);
  }
}

/**
 * 网页活动监控封装函数（供 API 调用）
 * 复用 UI 按钮的监控逻辑，在 renderer 中轮询 webview 状态
 * 返回 JSON 字符串结果
 * 
 * 增强功能：如果设定了 replySelector，使用 MutationObserver 监听特定区域
 */
function waitForActivityToComplete(webview, replySelector, heartbeatSelector, monitorTimeout) {
  // 🔧 关键修复：每次调用先清理所有旧状态
  try { delete window.__apiMonitorResult; } catch(e) {}
  try { clearInterval(window.__apiMonitorPollTimer); } catch(e) {}
  try { window.__apiMonitorPollTimer = null; } catch(e) {}

  const targetWebview = webview || getCurrentWebview();
  if (!targetWebview) {
    return JSON.stringify({ success: false, error: '未找到 webview' });
  }

  try {
    targetWebview.executeJavaScript('delete window.__expandedElements; delete window.__apiMonitorObserver; delete window.__apiMonitorTargetNode; delete window.__lastDomChangeTime; delete window.__expandedThinkingCount; if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__activityMonitor){window.__activityMonitor.stop && window.__activityMonitor.stop(); delete window.__activityMonitor;}').catch(() => {});
  } catch(e) {}

  // 🔧 【核心修复】参数优先级：直接传入的参数 > window 变量 > 默认值
  var heartbeatSel = heartbeatSelector || window.__monitorHeartbeatSelector || '';
  var replySel = replySelector || window.__monitorReplySelector || '';
  var apiMonitorIdleTimeout = (monitorTimeout && monitorTimeout > 0) || (window.__monitorTimeout && window.__monitorTimeout > 0)
    ? Math.max(monitorTimeout || 0, window.__monitorTimeout || 0)
    : 15000;
  var selector = heartbeatSel || replySel || '';
  var selectorSource = heartbeatSel ? 'heartbeatSelector（💓）' : (replySel ? 'replySelector（🎯）' : '默认选择器（兜底）');
  console.log('[API-Monitor] 监听选择器:', selector || '(无 - 使用全页面监控)');
  console.log('[API-Monitor] 选择器来源:', selectorSource, '| heartbeat:', heartbeatSel || '(无)', '| reply:', replySel || '(无)');
  console.log('[API-Monitor] 监控稳定判定时间:', apiMonitorIdleTimeout, 'ms');

  // 根据是否有选择器，采用不同的监控策略
  if (selector) {
    // === 方案 A：使用 MutationObserver 监听特定选择器 ===
    console.log('[API-Monitor] 使用 MutationObserver 监听特定选择器:', selector);
    
    // 🔓 核心修复：把展开逻辑直接写到 webview 内部的监控脚本里
    //    同时支持 selector 降级（heartbeat → reply → body）
    var mutationObserverJs = [
      '(function() {',
      '  var heartbeatSelector = ' + JSON.stringify(heartbeatSel) + ';',
      '  var replySelector = ' + JSON.stringify(replySel) + ';',
      '  var idleTimeout = ' + apiMonitorIdleTimeout + ';',
      '  var selectorSource = ' + JSON.stringify(selectorSource) + ';',
      '  ',
      '  // 🔓 关键改进：在 webview 内部支持 selector 降级',
      '  //    先尝试 heartbeatSelector，如果找不到就用 replySelector，再找不到就用 body',
      '  var selector = heartbeatSelector || replySelector || "";',
      '  if (!selector) { selector = "body"; selectorSource = "body（兜底）"; }',
      '  ',
      '  // 🔧 关键修复：在 webview 内部先清理所有旧状态，防止第二次监控时被干扰',
      '  delete window.__expandedElements;',
      '  delete window.__apiMonitorObserver;',
      '  delete window.__apiMonitorTargetNode;',
      '  delete window.__lastDomChangeTime;',
      '  delete window.__expandedThinkingCount;',
      '  delete window.__apiMonitorUseMutation;',
      '  delete window.__apiMonitorTargetFound;',
      '  delete window.__apiMonitorInitTime;',
      '  delete window.__apiMonitorIdleTimeout;',
      '  delete window.__apiMonitorSelectorSource;',
      '  if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}',
      '  if(window.__activityMonitor){try{window.__activityMonitor.stop && window.__activityMonitor.stop();}catch(e){} delete window.__activityMonitor;}',
      '  ',
      '  // 🛠 把监控参数写入 webview 内部的 window，方便诊断',
      '  window.__apiMonitorIdleTimeout = idleTimeout;',
      '  window.__apiMonitorSelectorSource = selectorSource;',
      '  console.log("[Webview-Monitor] 🎯 监控参数 - selector:", selector, "- source:", selectorSource, "- idleTimeout:", idleTimeout, "ms");',
      '  ',
      '  // 🔓 展开「正在思考」折叠面板的函数（核心改进：WeakSet 防重复点击 + setInterval 持续扫描新节点）',
      '  function expandThinkingPanels() {',
      '    try {',
      '      if (!window.__expandedElements) window.__expandedElements = new WeakSet();',
      '      var clicked = 0;',
      '      function findClickableParent(el) {',
      '        var current = el;',
      '        for (var layer = 0; layer < 5 && current && current.parentNode; layer++) {',
      '          current = current.parentNode;',
      '          if (!current || current.nodeType !== 1) continue;',
      '          var cs = window.getComputedStyle(current);',
      '          if (cs.display === "none" || cs.visibility === "hidden") continue;',
      '          var cName = (current.className || "").toString();',
      '          var isCursorPointer = cs.cursor === "pointer";',
      '          var isClickableTag = /^(BUTTON|A|DIV|SPAN|SUMMARY|LABEL)$/.test(current.tagName);',
      '          var hasExpandClass = /(toggle|expand|collapse|clickable|interactive|reasoning|thinking)/i.test(cName + " " + (current.getAttribute("role") || ""));',
      '          if (isCursorPointer || (isClickableTag && hasExpandClass)) { return current; }',
      '        }',
      '        return null;',
      '      }',
      '      function isCollapsed(el) {',
      '        var ae = el.getAttribute ? el.getAttribute("aria-expanded") : null;',
      '        if (ae === "true") return false;   // 明确展开的，不点击',
      '        if (ae === "false") return true;   // 明确折叠的，要点击',
      '        var p = el.parentNode;',
      '        for (var i = 0; i < 5 && p && p.nodeType === 1; i++) {',
      '          var pa = p.getAttribute ? p.getAttribute("aria-expanded") : null;',
      '          if (pa === "true") return false;',
      '          if (pa === "false") return true;',
      '          p = p.parentNode;',
      '        }',
      '        return true;   // 🚀 无 aria-expanded 属性：默认按折叠处理（智谱等网站不使用此属性）',
      '      }',
      '      var allEls = document.body ? document.body.querySelectorAll("*") : [];',
      '      for (var k = 0; k < allEls.length; k++) {',
      '        var cand = allEls[k];',
      '        if (!cand || cand.nodeType !== 1) continue;',
      '        if (window.__expandedElements.has(cand)) continue;   // 🚀 WeakSet：已点击过的元素直接跳过',
      '        var cs2 = window.getComputedStyle(cand);',
      '        if (cs2.display === "none" || cs2.visibility === "hidden") continue;',
      '        if (cand.offsetWidth === 0 || cand.offsetHeight === 0) continue;',
      '        var ch = cand.children ? cand.children.length : 0;',
      '        if (ch > 3) continue;',
      '        var txt = (cand.innerText || cand.textContent || "").trim();',
      '        if (!txt || txt.length > 30) continue;',
      '        if (!/正在思考|thinking|reasoning/i.test(txt)) continue;',
      '        if (/思考过程|已完成|生成完毕|完整结果/i.test(txt)) continue;   // 🚀 跳过已完成状态（不是可折叠的思考节点）',
      '        if (!isCollapsed(cand)) continue;',
      '        var target = findClickableParent(cand) || cand;',
      '        if (window.__expandedElements.has(target)) continue;',
      '        try { target.click(); clicked++; window.__expandedElements.add(target); window.__expandedElements.add(cand); } catch(e) {}',
      '      }',
      '      try {',
      '        var reasoningEls = document.querySelectorAll(\'[class*="reasoning"], [class*="thinking"], [class*="思考"]\');',
      '        for (var n = 0; n < reasoningEls.length; n++) {',
      '          var rEl = reasoningEls[n];',
      '          if (window.__expandedElements.has(rEl)) continue;   // 🚀 WeakSet：已点击过的元素直接跳过',
      '          var rStyle = window.getComputedStyle(rEl);',
      '          if (rStyle.display === "none" || rStyle.visibility === "hidden") continue;',
      '          if (rEl.offsetWidth === 0 || rEl.offsetHeight === 0) continue;',
      '          if (!isCollapsed(rEl)) continue;',
      '          try { rEl.click(); clicked++; window.__expandedElements.add(rEl); } catch(e) { try { if (rEl.firstElementChild && !window.__expandedElements.has(rEl.firstElementChild)) { rEl.firstElementChild.click(); clicked++; window.__expandedElements.add(rEl.firstElementChild); } } catch(e2) {} }',
      '        }',
      '      } catch(e) {}',
      '      if (clicked > 0) { window.__expandedThinkingCount = (window.__expandedThinkingCount || 0) + clicked; }',
      '    } catch(e) {}',
      '  }',
      '  expandThinkingPanels();   // 🚀 先立即执行一次',
    '  // 🚀 然后每 2 秒扫描一次（AI 思考节点是动态出现的，需要持续扫描新节点）。',
    '  //    用 WeakSet（window.__expandedElements）保证每个元素只点一次，彻底避免 toggle 反复。',
    '  if (!window.__expandThinkingTimer) { window.__expandThinkingTimer = setInterval(expandThinkingPanels, 2000); }',
      '',
      '  // 🔓 第一步：查找目标元素（支持降级：heartbeat → reply → body）',
      '  var targetNode = null;',
      '  var selectorsToTry = [];',
      '  if (heartbeatSelector) selectorsToTry.push({ sel: heartbeatSelector, source: "heartbeatSelector" });',
      '  if (replySelector) selectorsToTry.push({ sel: replySelector, source: "replySelector" });',
      '  selectorsToTry.push({ sel: "body", source: "body（兜底）" });',
      '  ',
      '  for (var si = 0; si < selectorsToTry.length; si++) {',
      '    try {',
      '      targetNode = document.querySelector(selectorsToTry[si].sel);',
      '    } catch(e2) { targetNode = null; }',
      '    if (targetNode) {',
      '      selector = selectorsToTry[si].sel;',
      '      selectorSource = selectorsToTry[si].source;',
      '      console.log("[Webview-Monitor] ✅ 找到监控元素: " + selector + " (" + selectorSource + ")");',
      '      break;',
      '    }',
      '  }',
      '  ',
      '  if (!targetNode) {',
      '    console.error("[Webview-Monitor] ❌ 所有选择器都找不到元素，使用 document.body");',
      '    targetNode = document.body;',
      '    selector = "body";',
      '    selectorSource = "body（兜底）";',
      '  }',
      '  ',
      '  // 第二步：等待 1 秒，确保页面开始输出内容',
      '  // 这可以避免在内容刚开始生成就启动监听导致过早结束',
      '  var startTime = Date.now();',
      '  window.__apiMonitorUseMutation = true;',
      '  window.__apiMonitorTargetFound = true;',
      '  window.__apiMonitorInitTime = startTime;',
      '  ',
      '  // 第三步：创建 MutationObserver（但暂不启动）',
      '  try {',
      '    var observer = new MutationObserver(function(mutations) {',
      '      window.__lastDomChangeTime = Date.now();',
      '      // 🔓 每次检测到 DOM 变化时也尝试展开一次（新的思考面板可能刚出现）',
      '      setTimeout(expandThinkingPanels, 500);',
      '    });',
      '    ',
      '    // 保存观察器引用以便后续清理',
      '    window.__apiMonitorObserver = observer;',
      '    window.__apiMonitorTargetNode = targetNode;',
      '  } catch(e) {',
      '    return JSON.stringify({ success: false, error: "MutationObserver创建失败: " + e.toString() });',
      '  }',
      '  ',
      '  return JSON.stringify({ success: true, selector: selector, initTime: startTime });',
      '})();'
    ].join('\n');

    // 使用 Promise 包装异步逻辑
    console.log('[API-Monitor] 开始执行 MutationObserver 注入 (async IIFE)');
    (async function() {
      console.log('[API-Monitor] Async IIFE 已启动');

      // 等待注入完成后再启动轮询
      var injectResult = null;
      try {
        console.log('[API-Monitor] 即将执行 targetWebview.executeJavaScript...');
        injectResult = await targetWebview.executeJavaScript(mutationObserverJs);
        console.log('[API-Monitor] MutationObserver 注入结果:', injectResult);
        
        // 解析结果
        var result;
        try {
          result = JSON.parse(injectResult);
        } catch(e) {
          result = { success: false, error: '解析失败: ' + e.toString() };
        }
        
        // 如果注入失败（通常是因为元素还未加载），等待元素出现后重试
        if (!result.success) {
          console.log('[API-Monitor] 注入失败:', result.error, '，等待元素出现后重试...');
          
          // 等待元素出现的脚本
          var waitForElementJs = [
            '(function() {',
            '  return new Promise(function(resolve) {',
            '    var selector = ' + JSON.stringify(selector) + ';',
            '    var timeout = 30000; // 最多等待30秒',
            '    var startTime = Date.now();',
            '    ',
            '    // 先检查元素是否已经存在',
            '    if (document.querySelector(selector)) {',
            '      resolve(true);',
            '      return;',
            '    }',
            '    ',
            '    // 使用 MutationObserver 监听 DOM 变化',
            '    var observer = new MutationObserver(function(mutations, obs) {',
            '      if (document.querySelector(selector)) {',
            '        obs.disconnect();',
            '        resolve(true);',
            '      } else if (Date.now() - startTime > timeout) {',
            '        obs.disconnect();',
            '        resolve(false);',
            '      }',
            '    });',
            '    ',
            '    observer.observe(document.documentElement, {',
            '      childList: true,',
            '      subtree: true',
            '    });',
            '    ',
            '    // 超时保护',
            '    setTimeout(function() {',
            '      observer.disconnect();',
            '      resolve(false);',
            '    }, timeout);',
            '  });',
            '})();'
          ].join('\n');
          
          // 等待元素出现
          var elementFound = await targetWebview.executeJavaScript(waitForElementJs);
          console.log('[API-Monitor] 元素等待结果:', elementFound);
          
          if (!elementFound) {
            console.error('[API-Monitor] 等待元素超时');
            // 🛑 清理 webview 内部的展开计时器
            try { targetWebview.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}'); } catch(e) {}
            window.__apiMonitorResult = JSON.stringify({
              success: true,
              result: { status: 'idle', contentLength: 0, activityCount: 0, method: '等待元素超时' }
            });
            return;
          }
          
          // 元素已出现，再次尝试注入 MutationObserver
          console.log('[API-Monitor] 元素已出现，重新注入 MutationObserver...');
          injectResult = await targetWebview.executeJavaScript(mutationObserverJs);
          console.log('[API-Monitor] MutationObserver 重新注入结果:', injectResult);
          
          // 再次解析结果
          try {
            result = JSON.parse(injectResult);
          } catch(e) {
            result = { success: false, error: '解析失败: ' + e.toString() };
          }
          
          if (!result.success) {
            console.error('[API-Monitor] 第二次注入仍然失败:', result.error);
            try { targetWebview.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}'); } catch(e) {}
            window.__apiMonitorResult = JSON.stringify({
              success: true,
              result: { status: 'idle', contentLength: 0, activityCount: 0, method: '注入失败: ' + result.error }
            });
            return;
          }
        }
        
      } catch(e) {
        console.error('[API-Monitor] 注入 MutationObserver 失败:', e);
        // 🛑 清理 webview 内部的展开计时器
        try { targetWebview.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}'); } catch(e2) {}
        // 注入失败，直接完成
        window.__apiMonitorResult = JSON.stringify({
          success: true,
          result: { status: 'idle', contentLength: 0, activityCount: 0, method: '注入失败: ' + e.toString() }
        });
        return;
      }

      console.log('[API-Monitor] 注入完成，等待 2000ms 确保页面开始输出内容...');
      // 等待 2 秒，确保页面已经开始输出内容，然后再启动监听
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });

      console.log('[API-Monitor] 启动 MutationObserver 监听...');
      // 启动 MutationObserver 监听
      try {
        await targetWebview.executeJavaScript(`(function() {
          if (window.__apiMonitorObserver && window.__apiMonitorTargetNode) {
            window.__apiMonitorObserver.observe(window.__apiMonitorTargetNode, {
              childList: true,
              characterData: true,
              subtree: true
            });
            window.__lastDomChangeTime = Date.now();
            console.log('[MutationObserver] 监听已启动');
            return true;
          }
          return false;
        })();`);
      } catch(e) {
        console.error('[API-Monitor] 启动监听失败:', e);
      }

      console.log('[API-Monitor] 开始轮询检查...');
      // 轮询检查 DOM 变化（最多等待 120 秒）
      var maxPolls = 240;
      var pollCount = 0;
      var pollTimer = setInterval(function() {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(pollTimer);
        console.error('[API-Monitor] 轮询超时，强制完成');
        // 🛑 清理 webview 内部的展开计时器
        try { targetWebview.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();}'); } catch(e) {}
        window.__apiMonitorResult = JSON.stringify({
          success: true,
          result: {
            status: 'idle',
            contentLength: 0,
            activityCount: 0,
            method: 'MutationObserver (超时)'
          }
        });
        return;
      }
      
      targetWebview.executeJavaScript('(function() { return JSON.stringify({ lastChange: window.__lastDomChangeTime || 0, useMutation: window.__apiMonitorUseMutation || false }); })();').then(function(result) {
        try {
          var data = JSON.parse(result);
          if (!data.lastChange || data.lastChange === 0) {
            console.log('[API-Monitor] __lastDomChangeTime 未设置，继续等待... (轮询', pollCount + ')');
            return;
          }
          var timeSinceChange = Date.now() - data.lastChange;
          
          console.log('[API-Monitor] 距最后变化:', timeSinceChange + 'ms', '(useMutation:', data.useMutation + ')');
          
          // 如果超过设置的时间没有变化，认为完成（默认 15000ms，可通过卡片的 monitorTimeout 自定义）
          if (timeSinceChange >= apiMonitorIdleTimeout) {
            clearInterval(pollTimer);
            console.log('[API-Monitor] 判定完成！方法: MutationObserver');
            // 🛑 监控结束后立即清理 webview 内部的展开计时器（防止 AI 回复结束后还反复点击）
            try {
              targetWebview.executeJavaScript('(function(){ if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__apiMonitorObserver){window.__apiMonitorObserver.disconnect();} })();');
            } catch(e) {}
            window.__apiMonitorResult = JSON.stringify({
              success: true,
              result: {
                status: 'idle',
                contentLength: 0,
                activityCount: 0,
                method: 'MutationObserver'
              }
            });
          }
        } catch(e) {
          console.error('[API-Monitor] 解析失败:', e);
        }
      }).catch(function(e) {
        console.error('[API-Monitor] 轮询失败:', e);
      });
    }, 1000);
    })();

  } else {
    // === 方案 B：使用原有的全页面内容长度监控 ===
    console.log('[API-Monitor] 使用全页面内容长度监控');
    
    // 🔓 同样把展开逻辑注入到 webview 内部的监控脚本中
    // 注入监控脚本到 webview
    var injectJs = [
      '(function() {',
      '  // 🔧 关键修复：先彻底清理旧状态，不要 return（防止第二次调用时旧的 __activityMonitor 阻止新监控启动）',
      '  var idleTimeout = ' + apiMonitorIdleTimeout + ';',
      '  delete window.__expandedElements;',
      '  delete window.__apiMonitorObserver;',
      '  delete window.__apiMonitorTargetNode;',
      '  delete window.__lastDomChangeTime;',
      '  delete window.__expandedThinkingCount;',
      '  delete window.__apiMonitorUseMutation;',
      '  delete window.__apiMonitorTargetFound;',
      '  delete window.__apiMonitorInitTime;',
      '  delete window.__apiMonitorIdleTimeout;',
      '  delete window.__apiMonitorSelectorSource;',
      '  if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;}',
      '  if(window.__activityMonitor){try{window.__activityMonitor.stop && window.__activityMonitor.stop();}catch(e){} delete window.__activityMonitor;}',
      '  ',
      '  // 🛠 把监控参数写入 webview 内部的 window（方案',
      '  window.__apiMonitorIdleTimeout = idleTimeout;',
      '  window.__apiMonitorSelectorSource = "replySelector + 全页面内容长度监控（无 heartbeatSelector）";',
      '  console.log("[Webview-Monitor] 🎯 监控参数 - 全页面内容长度监控 - idleTimeout: " + idleTimeout + "ms");',
      '  ',
      '  // 🔓 展开「正在思考」折叠面板的函数（核心改进：WeakSet 防重复点击 + setInterval 持续扫描新节点）',
      '  function expandThinkingPanels() {',
      '    try {',
      '      if (!window.__expandedElements) window.__expandedElements = new WeakSet();',
      '      var clicked = 0;',
      '      function findClickableParent(el) {',
      '        var current = el;',
      '        for (var layer = 0; layer < 5 && current && current.parentNode; layer++) {',
      '          current = current.parentNode;',
      '          if (!current || current.nodeType !== 1) continue;',
      '          var cs = window.getComputedStyle(current);',
      '          if (cs.display === "none" || cs.visibility === "hidden") continue;',
      '          var cName = (current.className || "").toString();',
      '          var isCursorPointer = cs.cursor === "pointer";',
      '          var isClickableTag = /^(BUTTON|A|DIV|SPAN|SUMMARY|LABEL)$/.test(current.tagName);',
      '          var hasExpandClass = /(toggle|expand|collapse|clickable|interactive|reasoning|thinking)/i.test(cName + " " + (current.getAttribute("role") || ""));',
      '          if (isCursorPointer || (isClickableTag && hasExpandClass)) { return current; }',
      '        }',
      '        return null;',
      '      }',
      '      function isCollapsed(el) {',
      '        var ae = el.getAttribute ? el.getAttribute("aria-expanded") : null;',
      '        if (ae === "true") return false;   // 明确展开的，不点击',
      '        if (ae === "false") return true;   // 明确折叠的，要点击',
      '        var p = el.parentNode;',
      '        for (var i = 0; i < 5 && p && p.nodeType === 1; i++) {',
      '          var pa = p.getAttribute ? p.getAttribute("aria-expanded") : null;',
      '          if (pa === "true") return false;',
      '          if (pa === "false") return true;',
      '          p = p.parentNode;',
      '        }',
      '        return true;   // 🚀 无 aria-expanded 属性：默认按折叠处理（智谱等网站不使用此属性）',
      '      }',
      '      var allEls = document.body ? document.body.querySelectorAll("*") : [];',
      '      for (var k = 0; k < allEls.length; k++) {',
      '        var cand = allEls[k];',
      '        if (!cand || cand.nodeType !== 1) continue;',
      '        if (window.__expandedElements.has(cand)) continue;   // 🚀 WeakSet：已点击过的元素直接跳过',
      '        var cs2 = window.getComputedStyle(cand);',
      '        if (cs2.display === "none" || cs2.visibility === "hidden") continue;',
      '        if (cand.offsetWidth === 0 || cand.offsetHeight === 0) continue;',
      '        var ch = cand.children ? cand.children.length : 0;',
      '        if (ch > 3) continue;',
      '        var txt = (cand.innerText || cand.textContent || "").trim();',
      '        if (!txt || txt.length > 30) continue;',
      '        if (!/正在思考|thinking|reasoning/i.test(txt)) continue;',
      '        if (/思考过程|已完成|生成完毕|完整结果/i.test(txt)) continue;   // 🚀 跳过已完成状态（不是可折叠的思考节点）',
      '        if (!isCollapsed(cand)) continue;',
      '        var target = findClickableParent(cand) || cand;',
      '        if (window.__expandedElements.has(target)) continue;',
      '        try { target.click(); clicked++; window.__expandedElements.add(target); window.__expandedElements.add(cand); } catch(e) {}',
      '      }',
      '      try {',
      '        var reasoningEls = document.querySelectorAll(\'[class*="reasoning"], [class*="thinking"], [class*="思考"]\');',
      '        for (var n = 0; n < reasoningEls.length; n++) {',
      '          var rEl = reasoningEls[n];',
      '          if (window.__expandedElements.has(rEl)) continue;   // 🚀 WeakSet：已点击过的元素直接跳过',
      '          var rStyle = window.getComputedStyle(rEl);',
      '          if (rStyle.display === "none" || rStyle.visibility === "hidden") continue;',
      '          if (rEl.offsetWidth === 0 || rEl.offsetHeight === 0) continue;',
      '          if (!isCollapsed(rEl)) continue;',
      '          try { rEl.click(); clicked++; window.__expandedElements.add(rEl); } catch(e) { try { if (rEl.firstElementChild && !window.__expandedElements.has(rEl.firstElementChild)) { rEl.firstElementChild.click(); clicked++; window.__expandedElements.add(rEl.firstElementChild); } } catch(e2) {} }',
      '        }',
      '      } catch(e) {}',
      '      if (clicked > 0) { window.__expandedThinkingCount = (window.__expandedThinkingCount || 0) + clicked; }',
      '    } catch(e) {}',
      '  }',
      '  expandThinkingPanels();   // 🚀 先立即执行一次',
    '  // 🚀 然后每 2 秒扫描一次（AI 思考节点是动态出现的，需要持续扫描新节点）。',
    '  //    用 WeakSet（window.__expandedElements）保证每个元素只点一次，彻底避免 toggle 反复。',
    '  if (!window.__expandThinkingTimer) { window.__expandThinkingTimer = setInterval(expandThinkingPanels, 2000); }',
      '',
      '  var lastLength = 0;',
      '  var lastChangeTime = 0;',
      '  var activityCount = 0;',
      '  function getLength() {',
      '    var b = document.body;',
      '    if (!b) return 0;',
      '    return (b.innerText || b.textContent || "").length;',
      '  }',
      '  window.__activityMonitor = {',
      '    start: function() { lastLength = getLength(); lastChangeTime = Date.now(); },',
      '    check: function() {',
      '      expandThinkingPanels();',
      '      var len = getLength();',
      '      if (len !== lastLength) { lastLength = len; lastChangeTime = Date.now(); activityCount++; return "active"; }',
      '      else {',
      '        var stableMs = Date.now() - lastChangeTime;',
      '        if (stableMs >= idleTimeout) return "idle";',
      '        return "stable (" + Math.floor(stableMs / 1000) + "s/" + Math.floor(idleTimeout / 1000) + "s)";',
      '      }',
      '    },',
      '    getState: function() { return { state: this.check(), activityCount: activityCount, contentLength: lastLength }; }',
      '  };',
      '})();'
    ].join('\n');

    webview.executeJavaScript(injectJs).catch(function() {});

    // 启动 webview 内部监控
    setTimeout(function() {
      webview.executeJavaScript('window.__activityMonitor && window.__activityMonitor.start();').catch(function() {});
    }, 1500);

    // 在 renderer 中轮询 webview 状态
    var pollTimer = setInterval(function() {
      webview.executeJavaScript('window.__activityMonitor && JSON.stringify(window.__activityMonitor.getState());').then(function(result) {
        try {
          var state = JSON.parse(result);
          console.log('[API-Monitor] 状态:', state.state, '活动次数:', state.activityCount, '内容长度:', state.contentLength);
          
          if (state.state === 'idle') {
            clearInterval(pollTimer);
            // 🛑 清理 webview 内部的展开计时器
            try { webview.executeJavaScript('if(window.__expandThinkingTimer){clearInterval(window.__expandThinkingTimer); window.__expandThinkingTimer=null;} if(window.__activityMonitor && window.__activityMonitor.stop){window.__activityMonitor.stop();}'); } catch(e) {}
            window.__apiMonitorResult = JSON.stringify({
              success: true,
              result: {
                status: 'idle',
                contentLength: state.contentLength,
                activityCount: state.activityCount,
                method: 'content-length'
              }
            });
          }
        } catch(e) {
          console.error('[API-Monitor] 解析失败:', e);
        }
      }).catch(function(e) {
        console.error('[API-Monitor] 轮询失败:', e);
      });
    }, 1500);
  }

  return JSON.stringify({ success: true, polling: true });
}

// Webview 后退
function goBackWebview() {
  const webview = getCurrentWebview();
  if (webview && webview.canGoBack()) {
    webview.goBack();
  }
}

// Webview 前进
function goForwardWebview() {
  const webview = getCurrentWebview();
  if (webview && webview.canGoForward()) {
    webview.goForward();
  }
}

// 初始化 Webview 事件监听
function initWebviewEvents(webviewId, loadingId) {
  const webview = document.getElementById(webviewId);
  const loading = document.getElementById(loadingId);

  if (!webview) return;

  // 记录上一个有效 URL（用于 SPA 网站恢复）
  let lastValidUrl = webview.src || '';

  webview.addEventListener('did-start-loading', () => {
    if (loading) loading.style.display = 'block';
  });

  // 🆕 处理 window.open（支持邮件详情窗口等）
  webview.addEventListener('new-window', (event) => {
    const url = event.url;
    console.log('[Renderer] webview new-window:', url);
    
    // 邮件详情窗口
    if (url && url.includes('email-detail.html')) {
      event.preventDefault();
      if (window.electronAPI && window.electronAPI.openEmailDetail) {
        window.electronAPI.openEmailDetail(url).catch(err => {
          console.error('[Renderer] 打开邮件详情失败:', err);
        });
      }
    }
    // 其他 URL 允许默认行为（在系统浏览器打开）
  });

  webview.addEventListener('did-stop-loading', () => {
    if (loading) loading.style.display = 'none';
    // 页面加载完成后，应用 zoomFactor 让 webview 适配面板大小
    // 从 webviewId 提取工作区 ID
    const wsMatch = webviewId.match(/^previewWebview(?:-(.+))?$/);
    if (wsMatch) {
      const wsId = wsMatch[1] || 'MAIN';
      setTimeout(() => applyWebviewZoom(wsId), 200);
    }
    // 黑夜模式或白天模式切换后，确保插件页面 body.dark 状态正确
    if (isOurWebview(webview)) {
      setTimeout(() => {
        if (workspaceDarkModeEnabled) {
          webview.executeJavaScript(`document.body.classList.add('dark');`).catch(() => {});
        } else {
          webview.executeJavaScript(`document.body.classList.remove('dark');`).catch(() => {});
        }
      }, 500);
    }
  });

  webview.addEventListener('did-fail-load', (event) => {
    if (loading) loading.style.display = 'none';
    console.error('[Renderer] Webview 加载失败:', event);
    
    // 对于 SPA 网站（如千问），加载失败可能是因为导航问题
    // 不显示错误提示，让用户可以继续使用
    if (event.errorCode === -3 || event.errorCode === -6) {
      // ERR_ABORTED (-3) 或 ERR_FILE_NOT_FOUND (-6) 通常是 SPA 导航问题
      console.log('[Renderer] ⚠️ 可能是 SPA 导航问题，忽略错误');
      return;
    }
    
    showStatus('❌ 网页加载失败', 'error');
  });

  // 🆕 监听页面内导航（关键！解决千问等 SPA 问题）
  webview.addEventListener('did-navigate-in-page', (event) => {
    console.log('[Renderer] 页面内导航:', event.url);
    
    // 更新地址栏
    const urlInput = getCurrentWebviewUrlInput();
    if (urlInput && event.url) {
      urlInput.value = event.url;
    }
    
    // 记录有效 URL
    if (event.url && event.url !== 'about:blank') {
      lastValidUrl = event.url;
    }
  });

  // 🆕 监听主框架导航
  webview.addEventListener('did-navigate', (event) => {
    console.log('[Renderer] 主导航:', event.url);
    
    // 更新地址栏
    const urlInput = getCurrentWebviewUrlInput();
    if (urlInput && event.url) {
      urlInput.value = event.url;
    }
    
    // 记录有效 URL
    if (event.url && event.url !== 'about:blank') {
      lastValidUrl = event.url;
    }
  });
  
  webview.addEventListener('dom-ready', async () => {
    console.log('[Renderer] 🚀 dom-ready 事件触发了！');
    if (loading) loading.style.display = 'none';

    // 如果开启了工作区黑夜模式，注入暗色 CSS
    if (workspaceDarkModeEnabled) {
      await applyWorkspaceDarkModeToWebview(webview);
    }

    // 更新地址栏
    const urlInput = getCurrentWebviewUrlInput();
    if (urlInput) {
      urlInput.value = webview.getURL();
    }
    
    // 自动滚动到 webview 容器（确保 AI Chat 能正常执行）
    setTimeout(() => {
      const webviewContainer = getCurrentWebviewContainer();
      if (webviewContainer) {
        webviewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        console.log('[Renderer] 已自动滚动到 webview 容器');
      }
    }, 500);

    // 注入轻量级持续监控脚本（自动记录 AI 开始/结束时间）
    await injectPersistentAITimeMonitor(webview);

    // 🔥🔥🔥 自动聚焦输入区（必须在 injectPersistentAITimeMonitor 之后！否则焦点会被抢走）
    // 延迟1秒：等 SPA 渲染 + 监控脚本注入完成（⚡️场景不需要等太久）
    setTimeout(async () => {
      try {
        // 🔑🔑🔑 关键：先聚焦 webview 本身！（Electron webview 必须先获得渲染进程焦点，内部元素的游标才会显示）
        webview.focus();
        console.log('[Renderer] 🎯 已聚焦 webview 本身');
        await new Promise(r => setTimeout(r, 200));

        const focusResult = await webview.executeJavaScript(`
          (async () => {
            // 短暂等待 SPA 基本渲染（autoSendPresetMessage 会再做完整等待）
            await new Promise(r => setTimeout(r, 500));

            // 查找输入框（支持多种选择器）
            let inputEl = document.querySelector('textarea')
              || document.querySelector('div[contenteditable="true"]')
              || document.querySelector('[class*="chat-input-editor"]')
              || document.querySelector('[class*="editor"]')
              || document.querySelector('[contenteditable]')
              || document.querySelector('[role="textbox"]')
              || document.querySelector('input[type="text"]');

            if (!inputEl) {
              console.log('[AutoFocus] 未找到输入框');
              return { success: false, error: '未找到输入框' };
            }

            // 滚动到可见区域
            inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            await new Promise(r => setTimeout(r, 300));

            // 点击 + 聚焦
            inputEl.click();
            await new Promise(r => setTimeout(r, 200));
            inputEl.focus();
            await new Promise(r => setTimeout(r, 500));

            // 🔥 最终保障：再次 focus（防止被其他脚本抢走）
            inputEl.focus();
            await new Promise(r => setTimeout(r, 300));

            // 验证焦点
            const active = document.activeElement;
            console.log('[AutoFocus] ✅ 输入框:', inputEl.tagName, (inputEl.className||'').substring(0,40), '焦点成功:', active === inputEl);
            return {
              success: true,
              tag: inputEl.tagName,
              isActive: active === inputEl,
              placeholder: inputEl.placeholder || ''
            };
          })()
        `);
        console.log('[Renderer] 🎯 AutoFocus 结果:', JSON.stringify(focusResult));

        // 🔑🔑🔑 再次聚焦 webview（确保渲染进程焦点在 webview 上）
        webview.focus();
        console.log('[Renderer] 🎯 已再次聚焦 webview（最终保障）');
      } catch (focusErr) {
        console.warn('[Renderer] 🎯 AutoFocus 失败:', focusErr.message);
      }
    }, 3000);

    // 监听主进程的刷新请求
  window.electronAPI.onElementRefreshRequest(async () => {
    console.log('[Renderer] 🔄 收到刷新请求，开始获取最新元素结构...');
    
    const webview = getCurrentWebview();
    if (!webview) {
      console.error('[Renderer] 未找到 webview');
      return;
    }
    
    try {
      console.log('[ElementViewer] 开始执行 webview.executeJavaScript...');
      
      const structureData = await webview.executeJavaScript(`
        (function() {
          try {
            function escapeCssIdentifier(value) {
              if (!value) return '';
              // 如果包含 &、[、] 等特殊字符，直接返回空（说明是 Tailwind 特殊类名，应被过滤）
              if (value.indexOf('&') !== -1 || value.indexOf('[') !== -1 || value.indexOf(']') !== -1) {
                return '';
              }
              if (window.CSS && CSS.escape) {
                try { return CSS.escape(value); } catch (e) {}
              }
              return String(value).replace(/([^a-zA-Z0-9_-])/g, function(match) { return '\\\\' + match; });
            }

            function getClassNames(el) {
              if (!el) return [];
              var raw;
              if (el.className && typeof el.className === 'string') {
                raw = el.className.trim().split(/\s+/);
              } else if (el.classList && el.classList.length) {
                try { raw = Array.prototype.slice.call(el.classList); } catch (e) { return []; }
              } else {
                return [];
              }
              // 过滤掉 Tailwind CSS 的任意值类名（包含方括号的）和 CSS 嵌套语法（包含 & 的）
              // 同时过滤掉包含反斜杠、换行符等特殊字符的类名
              // 使用字符码检查避免转义字符在序列化时被破坏
              var hasInvalidChars = function(s) {
                for (var i = 0; i < s.length; i++) {
                  var code = s.charCodeAt(i);
                  // 过滤: \ [ ] & 和不可打印字符(0-31, 127)
                  if (code === 92 || code === 91 || code === 93 || code === 38 || code < 32 || code === 127) {
                    return true;
                  }
                }
                return false;
              };
              return raw.filter(function(c) {
                return !!c && !hasInvalidChars(c);
              });
            }

            function buildSimpleSelector(el) {
              if (!el || el.nodeType !== 1) return '';
              if (el.id) return '#' + escapeCssIdentifier(el.id);
              var tag = el.tagName.toLowerCase();
              var classes = getClassNames(el);
              if (classes.length > 0) {
                return tag + '.' + classes.map(escapeCssIdentifier).join('.');
              }
              return tag;
            }

            function buildPathSelector(el) {
              var parts = [];
              var node = el;
              while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
                var part = node.tagName.toLowerCase();
                if (node.id) {
                  part = '#' + escapeCssIdentifier(node.id);
                  parts.unshift(part);
                  break;
                }
                var classes = getClassNames(node);
                if (classes.length > 0) {
                  part += '.' + classes.slice(0, 2).map(escapeCssIdentifier).join('.');
                }
                try {
                  var parent = node.parentNode;
                  if (parent && parent.children) {
                    var sameTag = 0;
                    var index = 1;
                    for (var k = 0; k < parent.children.length; k++) {
                      var sibling = parent.children[k];
                      if (sibling.tagName === node.tagName) {
                        sameTag += 1;
                        if (sibling === node) index = sameTag;
                      }
                    }
                    if (sameTag > 1) part += ':nth-of-type(' + index + ')';
                  }
                } catch (e) {}
                parts.unshift(part);
                node = node.parentNode;
              }
              return parts.join(' > ');
            }

            function generateCssSelector(el) {
              var selector = buildSimpleSelector(el);
              if (selector && selector !== 'div' && selector !== 'span' && selector !== 'p') {
                return selector;
              }
              return buildPathSelector(el);
            }

            function buildNodeTree(node, depth, maxDepth) {
              if (typeof maxDepth === 'undefined') maxDepth = 6;
              if (!node || depth > maxDepth) return null;
              if (node.nodeType !== Node.ELEMENT_NODE) return null;
              var tagName = node.tagName ? node.tagName.toLowerCase() : 'text';
              if (/^(script|style|noscript|meta|link|svg|canvas|iframe|video|audio|source|track|wbr|picture)$/.test(tagName)) {
                return null;
              }

              var result = {
                tag: tagName,
                id: node.id || '',
                classList: [],
                innerText: '',
                isVisible: true,
                children: []
              };

              if (node.className && typeof node.className === 'string') {
                result.classList = node.className.split(/\s+/).filter(function(c) { return c.trim(); });
              }

              try {
                var style = window.getComputedStyle(node);
                result.isVisible = style.display !== 'none' && style.visibility !== 'hidden';
              } catch (e) {
                result.isVisible = true;
              }

              if (result.isVisible && node.innerText) {
                result.innerText = node.innerText;
              }

              var children = node.children || [];
              for (var i = 0; i < children.length && result.children.length < 20; i++) {
                var child = buildNodeTree(children[i], depth + 1, maxDepth);
                if (child) result.children.push(child);
              }
              return result;
            }

            var nodeCandidates = document.body ? document.body.querySelectorAll('p,div,span,li,td,th,h1,h2,h3,h4,h5,h6,section,article,pre,blockquote,dd,dt') : [];
            var allTextElements = [];
            for (var i = 0; i < nodeCandidates.length; i++) {
              var el = nodeCandidates[i];
              try {
                var text = el.innerText || '';
                if (!text || text.length <= 200) continue;

                var style;
                try {
                  style = window.getComputedStyle(el);
                } catch (styleErr) {
                  continue;
                }
                if (style.display === 'none' || style.visibility === 'hidden') continue;

                // 生成多个候选选择器，按优先级排序（id > 精确 class > 部分 class > 短路径）
                var candidates = [];
                try {
                  if (el.id) candidates.push('#' + escapeCssIdentifier(el.id));

                  var elClasses = getClassNames(el);
                  if (elClasses && elClasses.length > 0) {
                    candidates.push((el.tagName ? el.tagName.toLowerCase() : '') + '.' + elClasses.map(escapeCssIdentifier).join('.'));
                    candidates.push((el.tagName ? el.tagName.toLowerCase() : '') + '.' + elClasses.slice(0,2).map(escapeCssIdentifier).join('.'));
                  }

                  try {
                    for (var ai = 0; ai < el.attributes.length; ai++) {
                      var at = el.attributes[ai];
                      if (!at || !at.name) continue;
                      var an = at.name.toLowerCase();
                      if (an.indexOf('data-') === 0 || an === 'role' || an === 'name') {
                        var val = at.value || '';
                        if (val && val.length < 60) {
                          // 属性值在引号内，只需转义引号本身，不需要 CSS.escape
                          var escapedVal = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                          candidates.push((el.tagName ? el.tagName.toLowerCase() : '') + '[' + an + '="' + escapedVal + '"]');
                        }
                      }
                    }
                  } catch(attrErr) {}

                  (function() {
                    var parts = [];
                    var node = el;
                    var depth = 0;
                    while (node && node.nodeType === 1 && node.tagName && node.tagName.toLowerCase() !== 'html' && depth < 6) {
                      var part = node.tagName.toLowerCase();
                      if (node.id) {
                        part = '#' + escapeCssIdentifier(node.id);
                        parts.unshift(part);
                        break;
                      }
                      var cls = getClassNames(node) || [];
                      if (cls.length > 0) part += '.' + cls.slice(0,2).map(escapeCssIdentifier).join('.');
                      try {
                        var p = node.parentNode;
                        if (p && p.children) {
                          var same = 0; var idx = 1;
                          for (var kk = 0; kk < p.children.length; kk++) {
                            if (p.children[kk].tagName === node.tagName) {
                              same += 1;
                              if (p.children[kk] === node) idx = same;
                            }
                          }
                          if (same > 1) part += ':nth-of-type(' + idx + ')';
                        }
                      } catch(e) {}
                      parts.unshift(part);
                      node = node.parentNode;
                      depth++;
                    }
                    if (parts.length) candidates.push(parts.join(' > '));
                  })();

                  var fallback = generateCssSelector(el);
                  if (fallback) candidates.push(fallback);
                } catch(genErr) {
                  candidates = [generateCssSelector(el)];
                }

                var seen = new Set();
                var finalCandidates = [];
                for (var ci = 0; ci < candidates.length && finalCandidates.length < 6; ci++) {
                  var c = candidates[ci];
                  if (!c) continue;
                  if (!seen.has(c)) { seen.add(c); finalCandidates.push(c); }
                }

                var className = '';
                if (el.className) {
                  if (typeof el.className === 'string') className = el.className;
                  else if (el.className.baseVal !== undefined) className = el.className.baseVal;
                }

                allTextElements.push({
                  tag: el.tagName ? el.tagName.toLowerCase() : 'text',
                  id: el.id || '',
                  className: className,
                  selector: finalCandidates[0] || (el.tagName ? el.tagName.toLowerCase() : ''),
                  candidates: finalCandidates,
                  innerText: text,
                  textLength: text.length
                });
              } catch (iterErr) {
                continue;
              }
            }

            var bodyTree = null;
            try {
              if (document.body) bodyTree = buildNodeTree(document.body, 0);
            } catch (e) {
              bodyTree = null;
            }

            return {
              success: true,
              allTextElements: allTextElements,
              bodyTree: bodyTree,
              url: window.location.href
            };
          } catch (e) {
            return { success: false, error: (e && e.stack) ? e.stack : (e ? e.toString() : 'Unknown error'), allTextElements: [], bodyTree: null, url: '' };
          }
        })();
      `);
      
      console.log('[ElementViewer] webview.executeJavaScript 返回类型:', typeof structureData);
      console.log('[ElementViewer] webview.executeJavaScript 返回:', structureData ? JSON.stringify(structureData).substring(0, 200) : 'null');
      
      if (!structureData || structureData.success === false) {
        console.error('[ElementViewer] Webview 执行失败:', structureData?.error);
        return;
      }
      
      console.log('[ElementViewer] 提取到', structureData.allTextElements.length, '个元素');

      // 尝试快速验证候选选择器，给出一个可用的 workingSelector（最多测试前 20 个元素，每个元素最多 4 个候选）
      try {
        const toTest = Math.min(structureData.allTextElements.length, 20);
        for (let ti = 0; ti < toTest; ti++) {
          const el = structureData.allTextElements[ti];
          if (!el || !el.candidates || !el.candidates.length) continue;
          for (let ci = 0; ci < Math.min(el.candidates.length, 4); ci++) {
            const cand = el.candidates[ci];
            try {
              const res = await captureWithCustomSelector(webview, cand, el.innerText ? el.innerText.substring(0, 80) : null);
              if (res && res.success) { el.workingSelector = cand; break; }
            } catch (e) { continue; }
          }
        }
      } catch (verifyErr) {
        console.warn('[ElementViewer] 验证候选选择器时出错:', verifyErr);
      }

      window.electronAPI.sendElementRefreshData(structureData);
      console.log('[ElementViewer] 已发送数据到主进程');
    } catch (error) {
      console.error('[Renderer] 获取元素结构失败:', error);
    }
  });
  
  // 监听测试选择器请求（从元素查看器发送）
  window.electronAPI.onTestSelector(async (data) => {
    // 兼容旧格式（字符串）和新格式（对象）
    const selector = typeof data === 'string' ? data : (data.selector || '');
    const expectedContent = typeof data === 'string' ? null : (data.expectedContent || null);
    const requestId = typeof data === 'object' ? (data.requestId || null) : null;
    console.log('[Renderer]  收到测试选择器请求:', selector, expectedContent ? '（包含期望内容）' : '', requestId ? `requestId=${requestId}` : '');
    
    const webview = getCurrentWebview();
    if (!webview) {
      console.error('[Renderer] 未找到 webview');
      // 如果有 requestId，发送失败结果回 main
      if (requestId) {
        window.electronAPI.invoke('selector-test-result', { requestId, success: false, error: '未找到 webview' }).catch(() => {});
      }
      return;
    }
    
    // 获取当前 URL
    let currentUrl = '';
    try {
      currentUrl = await webview.getURL();
    } catch (e) {
      console.warn('[Renderer] 获取 URL 失败:', e);
    }
    
    // 判断平台名称
    let platformName = '测试平台';
    if (currentUrl.includes('sina.com.cn')) {
      platformName = '新浪财经';
    } else if (currentUrl.includes('yiyan.baidu.com')) {
      platformName = '文心一言';
    } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
      platformName = '豆包';
    }
    
    try {
      // 执行选择器获取内容
      const customResult = await captureWithCustomSelector(webview, selector, expectedContent);
      
      // 场景1：来自 ai-response-viewer 的测试（有 requestId）
      // 只发送测试结果回 main，直接返回，不再执行下面的 element-viewer 逻辑
      // 避免双重数据流导致主进程的 Promise 超时
      if (requestId) {
        if (customResult && customResult.success) {
          window.electronAPI.invoke('selector-test-result', { 
            requestId, 
            success: true, 
            content: customResult.content 
          }).catch(() => {});
        } else {
          window.electronAPI.invoke('selector-test-result', { 
            requestId, 
            success: false, 
            error: customResult?.error || '未知错误' 
          }).catch(() => {});
        }
        return; // 直接返回，不继续执行 element-viewer 逻辑
      }
      
      // 场景2：来自 element-viewer 的测试（无 requestId）
      // 打开 AI 回复查看器并显示结果（原有逻辑）
      await window.electronAPI.openAiResponseViewer();
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 发送选择器到查看器
      await window.electronAPI.setAiResponseSelector(selector);
      
      // 设置加载状态
      await window.electronAPI.setAiResponseLoading('正在测试选择器...');
      
      if (customResult && customResult.success) {
        // 获取成功，显示结果
        const capturedResult = {
          content: customResult.content,
          html: customResult.html || '',  // ✨ 新增：保留 HTML 格式
          timestamp: new Date().toISOString(),
          url: currentUrl,
          platform: platformName,
          responseDuration: 0,
          selector: selector
        };
        
        await window.electronAPI.setAiResponseData(capturedResult);
        console.log('[Renderer] ✅ 测试选择器获取成功！');
      } else {
        // 获取失败，显示错误
        const errorMsg = `自定义选择器 "${selector}" 未找到内容: ${customResult?.error || '未知错误'}`;
        await window.electronAPI.setAiResponseError(errorMsg);
        console.error('[Renderer] ❌ 测试选择器失败:', customResult?.error);
      }
    } catch (error) {
      console.error('[Renderer] ❌ 测试选择器异常:', error);
      // 如果有 requestId，发送错误结果后直接返回
      if (requestId) {
        window.electronAPI.invoke('selector-test-result', { 
          requestId, 
          success: false, 
          error: error.message 
        }).catch(() => {});
        return; // 直接返回
      }
      try {
        await window.electronAPI.setAiResponseError('测试选择器时出错: ' + error.message);
      } catch (e) {}
    }
  });
  
  // 检查是否有预设消息或附件需要自动发送
  const presetMessage = window.currentPresetMessage;

  // 📎 兼容新旧格式：优先使用新数组格式，否则使用旧单对象格式
  const presetAttachments = window.currentPresetAttachments || [];
  const presetAttachmentLegacy = window.currentPresetAttachment;

  console.log('[Renderer] 🔍 检查预设消息和附件:');
  console.log('[Renderer]   - 预设消息:', presetMessage);
  console.log('[Renderer]   - 预设消息是否有内容:', presetMessage && presetMessage.trim() ? '✅ 是' : '❌ 否');
  console.log('[Renderer]   - 附件数组长度:', presetAttachments.length);

  // 判断是否有内容需要发送
  const hasMessage = presetMessage && presetMessage.trim();
  const hasAttachments = presetAttachments.length > 0 || presetAttachmentLegacy;

  if (hasMessage || hasAttachments) {
    console.log('[Renderer] ✅ 检测到预设消息或附件，准备自动发送...');
    if (hasMessage) {
      console.log('[Renderer] 预设消息内容:', presetMessage.substring(0, 50) + (presetMessage.length > 50 ? '...' : ''));
    }
    if (presetAttachments.length > 0) {
      console.log(`[Renderer] 📎 检测到 ${presetAttachments.length} 个附件:`);
      presetAttachments.forEach((att, i) => {
        console.log(`[Renderer]   [${i}] ${att.name} (${att.size} bytes)`);
      });
    } else if (presetAttachmentLegacy) {
      console.log('[Renderer] 📎 检测到旧格式附件:', presetAttachmentLegacy.name);
    }

    try {
      // 等待一段时间确保页面完全渲染（Kimi 等 SPA 需要更长时间）
      const webviewUrl = webview.getURL ? webview.getURL() : '';
      const isKimiPage = webviewUrl.includes('kimi.com') || webviewUrl.includes('kimi.moonshot.cn') || webviewUrl.includes('moonshot.cn');
      // ⚡️ 场景：dom-ready 后已等过 1s+聚焦，这里只需短等待即可
      const waitTime = isKimiPage ? 3000 : 500;
      console.log('[Renderer] ⏳ 等待', waitTime, 'ms 让页面完全渲染...', isKimiPage ? '(Kimi SPA 需要更长时间)' : '');
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // 🆕🆕🆕 优化后的多附件处理流程：
      //    阶段一：循环上传所有附件到输入框（不上传、不发送）
      //    阶段二：一次性发送消息（包含所有已上传的附件）
      if (hasAttachments) {
        const allAttachments = presetAttachments.length > 0
          ? presetAttachments
          : (presetAttachmentLegacy ? [presetAttachmentLegacy] : []);

        console.log(`[Renderer] 🚀🚀🚀 开始处理 ${allAttachments.length} 个附件...`);
        console.log('[Renderer] 📋 执行计划:');
        console.log('[Renderer]   阶段一: 循环上传所有附件到输入框（不触发AI回复）');
        console.log('[Renderer]   阶段二: 输入文字消息 + 点击发送（一次性发出所有内容）');

        // ========== 阶段一：循环上传所有附件 ==========
        for (let i = 0; i < allAttachments.length; i++) {
          const currentAttachment = allAttachments[i];
          console.log(`[Renderer] 📎 [${i + 1}/${allAttachments.length}] 上传附件到输入框: ${currentAttachment.name}`);

          try {
            // 步骤1: 将当前附件数据传递给主进程（用于 Kimi 等平台的剪贴板操作）
            window.electronAPI.send('set-pending-attachment', currentAttachment);

            // 步骤2: 短暂等待确保主进程接收完成
            await new Promise(resolve => setTimeout(resolve, 500));

            // 步骤3: 调用新函数：只上传附件到输入框，**不发送**
            const uploadResult = await uploadAttachmentToInput(webview, currentAttachment);

            console.log(`[Renderer]   ✅ 第 ${i + 1} 个附件上传结果:`, uploadResult);

            // 步骤4: 等待附件在输入框中渲染完成
            const uploadWaitTime = isKimiPage ? 3000 : 2500;
            console.log(`[Renderer]   ⏳ 等待 ${uploadWaitTime}ms 让附件渲染...`);
            await new Promise(resolve => setTimeout(resolve, uploadWaitTime));

          } catch (attachError) {
            console.error(`[Renderer] ❌ 第 ${i + 1} 个附件 (${currentAttachment.name}) 上传失败:`, attachError);
            // 继续处理下一个附件，不中断整个流程
          }
        }

        console.log(`[Renderer] ✅✅✅ 阶段一完成！${allAttachments.length} 个附件全部上传到输入框`);
        console.log('[Renderer] 🔄 现在进入阶段二：统一发送...');
      }

      // ========== 阶段二：一次性发送消息（包含所有已上传的附件） ==========
      try {
        if (hasMessage) {
          console.log('[Renderer] 💬 [阶段二] 输入文字消息并发送...');
          console.log('[Renderer]   消息内容:', presetMessage.substring(0, 50) + (presetMessage.length > 50 ? '...' : ''));

          // 调用 autoSendPresetMessage：
          //   - message: 文字消息内容
          //   - attachment: null（因为附件已经在阶段一上传到输入框了）
          //   这个函数会：输入文字 → 按 Enter → 点击发送按钮
          const sendResult = await autoSendPresetMessage(webview, presetMessage, null);

          console.log('[Renderer] 📊 [阶段二] 发送结果:', sendResult);
        } else {
          // 如果没有文字消息，但有附件，也需要触发发送
          console.log('[Renderer] 💬 [阶段二] 无文字消息，但需要点击发送按钮发送附件...');

          // 创建一个空的发送操作（只按 Enter 或点击发送按钮）
          const sendOnlyResult = await webview.executeJavaScript(`
            (async function() {
              try {
                // 查找输入框
                const inputEl = document.querySelector('textarea') 
                  || document.querySelector('div[contenteditable="true"]')
                  || document.querySelector('[class*="chat-input-editor"]');
                
                if (!inputEl) return { success: false, error: '未找到输入框' };
                
                inputEl.focus();
                
                // 尝试多种方式触发发送
                // 方式1: 按 Enter 键
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                
                // 等待一下
                await new Promise(r => setTimeout(r, 1000));
                
                // 方式2: 点击发送按钮
                const buttonSelectors = [
                  '[class*="chat-input"] button',
                  '[class*="input-area"] button',
                  'button[aria-label*="发送"]',
                  'button[class*="send"]'
                ];
                
                for (const sel of buttonSelectors) {
                  const btn = document.querySelector(sel);
                  if (btn && btn.offsetParent !== null && !btn.disabled) {
                    btn.click();
                    return { success: true, method: 'button-click' };
                  }
                }
                
                return { success: true, method: 'enter-key' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[Renderer] 📊 [阶段二] 仅发送附件结果:', sendOnlyResult);
        }
      } catch (phase2Error) {
        console.error('[Renderer] ❌ 阶段二（发送）失败:', phase2Error);
        showStatus('⚠️ 发送失败，请手动操作', 'error');
      }
      window.currentPresetMessage = '';
      window.currentPresetAttachment = null;
      window.currentPresetAttachments = [];

      // 显示成功状态
      const totalAttachments = presetAttachments.length > 0
        ? presetAttachments.length
        : (presetAttachmentLegacy ? 1 : 0);

      if (totalAttachments > 0 && hasMessage) {
        showStatus(`✅ 已发送消息+${totalAttachments}个附件，请查看网页端`, 'success');
      } else if (totalAttachments > 0) {
        showStatus(`✅ 已发送${totalAttachments}个附件，请查看网页端`, 'success');
      } else {
        showStatus(`💬 已自动发送预设消息，请点击「📥 获取AI回复」按钮`, 'success');
      }

      // 保存 webview 引用供手动监控使用
      window._monitorWebview = webview;
    } catch (error) {
      console.error('[Renderer] 自动发送预设消息失败:', error);
      showStatus('⚠️ 自动发送失败，请手动输入消息', 'error');
    }
  }
  });  // 关闭 dom-ready 事件监听器
}

// ========== 工作区黑夜模式 ==========
let workspaceDarkModeEnabled = false;
const workspaceDarkModeCssKeys = new Map(); // webviewId -> cssKey

const WORKSPACE_DARK_CSS = `
  html {
    filter: invert(1) hue-rotate(180deg);
  }
  img, video, svg, canvas, iframe, picture {
    filter: invert(1) hue-rotate(180deg);
  }
`;

function updateWorkspaceThemeButton() {
  const btn = document.getElementById('workspaceThemeToggle');
  if (btn) {
    btn.textContent = workspaceDarkModeEnabled ? '☀️ 白天' : '🌙 黑夜';
  }
}

// 判断是否为我们自己开发的页面（ToDoList、邮件插件、HTTP Get）
function isOurWebview(webview) {
  if (!webview) return false;
  const url = (typeof webview.getURL === 'function' ? webview.getURL() : webview.src) || '';
  return url.includes('/src/plugins/') || url.includes('/plugins/');
}

async function applyWorkspaceDarkModeToWebview(webview) {
  if (!webview) return;
  const webviewId = webview.id;
  if (!webviewId) return;

  // 外部网页（豆包/千问/deepseek等）完全不受黑夜模式影响，直接跳过
  if (!isOurWebview(webview)) return;

  try {
    // 先移除旧的 CSS（清理残留）
    if (workspaceDarkModeCssKeys.has(webviewId)) {
      try {
        await webview.removeInsertedCSS(workspaceDarkModeCssKeys.get(webviewId));
      } catch (e) {
        // 忽略移除失败的错误
      }
      workspaceDarkModeCssKeys.delete(webviewId);
    }

    // 对我们自己开发的页面：用 executeJavaScript 切换 body.dark 类（插件自带 dark CSS）
    try {
      await webview.executeJavaScript(`document.body.classList.add('dark');`);
      console.log('[Renderer] 已为插件页面添加 dark 类:', webviewId);
    } catch (e) {
      console.warn('[Renderer] 为插件页面添加 dark 类失败:', webviewId, e.message);
    }
  } catch (error) {
    console.error('[Renderer] 应用黑夜模式失败:', webviewId, error);
  }
}

async function removeWorkspaceDarkModeFromWebview(webview) {
  if (!webview) return;
  const webviewId = webview.id;
  if (!webviewId) return;

  // 外部网页完全不受黑夜模式影响，直接跳过
  if (!isOurWebview(webview)) return;

  try {
    // 清理可能残留的 CSS
    if (workspaceDarkModeCssKeys.has(webviewId)) {
      await webview.removeInsertedCSS(workspaceDarkModeCssKeys.get(webviewId));
      workspaceDarkModeCssKeys.delete(webviewId);
    }

    // 对插件页面移除 dark 类
    try {
      await webview.executeJavaScript(`document.body.classList.remove('dark');`);
      console.log('[Renderer] 已为插件页面移除 dark 类:', webviewId);
    } catch (e) {
      console.warn('[Renderer] 为插件页面移除 dark 类失败:', webviewId, e.message);
    }
  } catch (error) {
    console.error('[Renderer] 移除黑夜模式失败:', webviewId, error);
  }
}

async function applyWorkspaceDarkModeToAll() {
  document.body.classList.add('workspace-dark');
  const webviews = document.querySelectorAll('webview[id^="previewWebview"]');
  for (const webview of webviews) {
    await applyWorkspaceDarkModeToWebview(webview);
  }
}

async function removeWorkspaceDarkModeFromAll() {
  document.body.classList.remove('workspace-dark');
  const webviews = document.querySelectorAll('webview[id^="previewWebview"]');
  for (const webview of webviews) {
    await removeWorkspaceDarkModeFromWebview(webview);
  }
}

async function toggleWorkspaceDarkMode() {
  workspaceDarkModeEnabled = !workspaceDarkModeEnabled;
  localStorage.setItem('workspaceDarkMode', workspaceDarkModeEnabled ? '1' : '0');
  updateWorkspaceThemeButton();
  if (workspaceDarkModeEnabled) {
    await applyWorkspaceDarkModeToAll();
    showStatus('🌙 已开启工作区黑夜模式', 'success');
  } else {
    await removeWorkspaceDarkModeFromAll();
    showStatus('☀️ 已关闭工作区黑夜模式', 'success');
  }
}

function loadWorkspaceDarkMode() {
  const saved = localStorage.getItem('workspaceDarkMode');
  workspaceDarkModeEnabled = saved === '1';
  updateWorkspaceThemeButton();
  if (workspaceDarkModeEnabled) {
    // 延迟应用，等 webview 初始化完成
    setTimeout(() => applyWorkspaceDarkModeToAll(), 1000);
  }
}

// ========== 挂载到 window ==========
// 挂载被 HTML onclick/onchange 内联事件引用的函数
window.switchWorkspace = switchWorkspace;
window.switchWorkspaceWithoutRestore = switchWorkspaceWithoutRestore;
window.onExpandHeaderClick = onExpandHeaderClick;
window.closeWorkspace = closeWorkspace;
window.loadWebviewUrl = loadWebviewUrl;
window.refreshWebview = refreshWebview;
window.goBackWebview = goBackWebview;
window.goForwardWebview = goForwardWebview;
window.toggleActivityMonitor = toggleActivityMonitor;
window.toggleAutoScheduleMode = toggleAutoScheduleMode;
window.checkWorkspacesStatus = checkWorkspacesStatus;
window.showExecutionPath = showExecutionPath;
window.copyWorkspaceStatus = copyWorkspaceStatus;
window.toggleAIWorkspace = toggleAIWorkspace;
window.toggleExpandView = toggleExpandView;
window.cycleExpandRatio = cycleExpandRatio;

// 挂载被其他模组（renderer.js 等）调用的公开 API 函数
window.getSortedWorkspaceIds = getSortedWorkspaceIds;
window.initWorkspaceContainers = initWorkspaceContainers;
window.initWorkspaceTabEvents = initWorkspaceTabEvents;
window.initResizeHandles = initResizeHandles;
window.setupCornerHighlightScrollListener = setupCornerHighlightScrollListener;
window.initWebviewEvents = initWebviewEvents;
window.getCurrentWorkspacePanel = getCurrentWorkspacePanel;
window.getCurrentWebview = getCurrentWebview;
window.getCurrentWebviewContainer = getCurrentWebviewContainer;
window.getCurrentWebviewUrlInput = getCurrentWebviewUrlInput;
window.getCurrentActivityMonitorBtn = getCurrentActivityMonitorBtn;
window.getCurrentWebviewLoading = getCurrentWebviewLoading;
window.updateWorkspaceStatus = updateWorkspaceStatus;
window.loadWorkspaceWebview = loadWorkspaceWebview;
window.updateWorkspaceTabName = updateWorkspaceTabName;
window.findOrCreateWorkspaceForAI = findOrCreateWorkspaceForAI;
window.autoScheduleBeforeExecute = autoScheduleBeforeExecute;
window.showDesktopAppChatPanel = showDesktopAppChatPanel;
window.appendChatMessage = appendChatMessage;
window.startActivityMonitor = startActivityMonitor;
window.stopActivityMonitor = stopActivityMonitor;
window.waitForContentStable = waitForContentStable;
window.waitForActivityToComplete = waitForActivityToComplete;
window.captureWorkspaceThumbnail = captureWorkspaceThumbnail;
window.updateExpandHeaders = updateExpandHeaders;
window.updateAllCornerHighlights = updateAllCornerHighlights;
window.applyExpandRatio = applyExpandRatio;
window.positionCornerHighlight = positionCornerHighlight;
window.predictExecutionPath = predictExecutionPath;
window.showWorkspaceStatusTable = showWorkspaceStatusTable;
window.renderMarkdown = renderMarkdown;
window.toggleWorkspaceDarkMode = toggleWorkspaceDarkMode;
window.loadWorkspaceDarkMode = loadWorkspaceDarkMode;

// 共享变量挂载到 window（getter/setter 闭包持有真实变量引用，确保跨模组读写一致）
Object.defineProperty(window, 'currentWorkspaceId', { get: () => currentWorkspaceId, set: v => { currentWorkspaceId = v; }, configurable: true });
Object.defineProperty(window, 'autoScheduleMode', { get: () => autoScheduleMode, configurable: true });
