/**
 * 无限空间·AI智控台 - 渲染进程脚本
 * 
 * 功能：
 * 1. 处理用户交互
 * 2. 调用 Electron API 访问网页
 * 3. 展示和导出数据
 */

// 全局数据
let crawledData = null;
let currentTab = 'links';
let apiServerRunning = false;

// 展开显示模式（默认展开，1/8 模式）
let expandViewEnabled = true;
let expandRatioIndex = 2; // 0=全展, 1=2/2, 2=3/3
const expandRatioLabels = ['全展', '2/2', '3/3'];

// 工作区标准尺寸（基于浏览器宽高 95%）
let wsStdH = 0;
let wsStdW = 0;

// webview 标准渲染尺寸（桌面版）
const WEBVIEW_STD_WIDTH = 1280;
const WEBVIEW_STD_HEIGHT = 800;

function calcStdDimensions() {
  wsStdH = Math.floor(window.innerHeight * 0.95);
  wsStdW = Math.floor(window.innerWidth * 0.95);
}

// 计算并应用 webview 的缩放（zoomFactor 模式）
// 让 webview 以标准桌面宽度渲染，然后用 CSS transform 缩放到面板大小
function applyWebviewZoom(workspaceId) {
  // 检查该工作区是否启用了缩放模式
  if (workspaces[workspaceId] && !workspaces[workspaceId].zoomMode) return;

  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) return;

  const webview = panel.querySelector(`#previewWebview${wsSuffix}`);
  if (!webview) return;

  // 获取面板实际尺寸（减去工具栏高度）
  const panelRect = panel.getBoundingClientRect();
  const panelW = panelRect.width;
  const panelH = panelRect.height - 45; // 减去工具栏
  if (panelW <= 0 || panelH <= 0) return;

  // 计算缩放比例
  const scaleX = panelW / WEBVIEW_STD_WIDTH;
  const scaleY = panelH / WEBVIEW_STD_HEIGHT;
  const scale = Math.min(scaleX, scaleY);

  // 设置 webview 以标准尺寸渲染
  webview.style.width = WEBVIEW_STD_WIDTH + 'px';
  webview.style.height = WEBVIEW_STD_HEIGHT + 'px';

  // 用 CSS transform 缩放到面板大小
  const wrapper = panel.querySelector(`#webviewWrapper${wsSuffix}`);
  if (wrapper) {
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';
    webview.style.transformOrigin = '0 0';
    webview.style.transform = `scale(${scale})`;
  }
}

// 重置 webview 为 viewport 模式（自然尺寸）
function resetWebviewZoom(workspaceId) {
  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) return;

  const webview = panel.querySelector(`#previewWebview${wsSuffix}`);
  if (!webview) return;

  // 恢复自然尺寸
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.style.transform = '';
  webview.style.transformOrigin = '';

  const wrapper = panel.querySelector(`#webviewWrapper${wsSuffix}`);
  if (wrapper) {
    wrapper.style.overflow = 'auto';
  }
}

// 对所有可见面板的 webview 应用 zoomFactor
function applyAllWebviewZooms() {
  if (!expandViewEnabled) return;
  const container = document.getElementById('dataContainer');
  if (!container) return;

  const visiblePanels = Array.from(container.querySelectorAll('.workspace-panel'))
    .filter(p => p.style.display !== 'none');

  visiblePanels.forEach(p => {
    const wsId = p.getAttribute('data-ws');
    if (wsId) {
      if (workspaces[wsId] && workspaces[wsId].zoomMode) {
        applyWebviewZoom(wsId);
      } else {
        resetWebviewZoom(wsId);
      }
    }
  });
}

// 切换单个工作的显示模式：Viewport / ZoomFactor
function toggleWorkspaceZoomMode(workspaceId) {
  if (!workspaces[workspaceId]) return;
  workspaces[workspaceId].zoomMode = !workspaces[workspaceId].zoomMode;

  // 更新该工作区工具栏中的按钮状态
  const wsSuffix = workspaceId !== 'MAIN' ? `-${workspaceId}` : '';
  const btn = document.getElementById(`zoomModeBtn${wsSuffix}`);
  if (btn) {
    btn.textContent = workspaces[workspaceId].zoomMode ? '缩放' : '视口';
    btn.style.background = workspaces[workspaceId].zoomMode ? '#d1fae5' : '#fce7f3';
    btn.style.color = workspaces[workspaceId].zoomMode ? '#047857' : '#be185d';
  }

  // 切换面板的 zoom-mode class（控制手柄显示）
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (panel) {
    if (workspaces[workspaceId].zoomMode) {
      panel.classList.add('zoom-mode');
    } else {
      panel.classList.remove('zoom-mode');
    }
  }

  // 立即应用新模式
  if (workspaces[workspaceId].zoomMode) {
    applyWebviewZoom(workspaceId);
  } else {
    resetWebviewZoom(workspaceId);
  }
}

function zoomWorkspace(workspaceId, factor) {
  if (!workspaces[workspaceId]) return;
  
  const panel = document.querySelector(`.workspace-panel[data-ws="${workspaceId}"]`);
  if (!panel) return;
  
  const currentW = panel.offsetWidth;
  const currentH = panel.offsetHeight;
  
  const newW = Math.max(200, Math.min(1500, currentW * factor));
  const newH = Math.max(150, Math.min(1200, currentH * factor));
  
  panel.style.setProperty('width', newW + 'px', 'important');
  panel.style.setProperty('height', newH + 'px', 'important');
  panel.style.setProperty('max-height', newH + 'px', 'important');
  
  _customPanelSizes[workspaceId] = { w: newW, h: newH };
  
  updateAllCornerHighlights();
  applyWebviewZoom(workspaceId);
  applyExpandRatio();
  
  console.log(`[Workspace] 工作区 ${workspaceId} 缩放: ${newW} x ${newH}`);
}

// 刷新页面
function refreshPage() {
  console.log('[Renderer] 正在刷新页面...');
  window.location.reload();
}

// 页面加载完成
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Renderer] 页面已加载');
  
  // 清除 localStorage 中残留的收件人（收件人必须每次手动输入，不能自动带出）
  localStorage.removeItem('floatEmailRecipients');
  floatEmailRecipients = '';

  // 初始化工作区容器
  initWorkspaceContainers();

  // 加载工作区黑夜模式设定
  if (typeof loadWorkspaceDarkMode === 'function') {
    loadWorkspaceDarkMode();
  }

  // 加载滚动锁定状态
  if (typeof loadScrollLockStates === 'function') {
    loadScrollLockStates();
  }

  // 初始化拖动手柄（包括弧形描边拖拽）
  initResizeHandles();

  // 滚动时同步弧形描边位置
  setupCornerHighlightScrollListener();

  // 初始化展开模式（默认 1/4 模式）
  if (expandViewEnabled) {
    const container = document.getElementById('dataContainer');
    if (container) {
      container.classList.add('expanded');
      const btn = document.getElementById('expandToggleBtn');
      if (btn) {
        btn.textContent = '展开';
        btn.title = '关闭所有工作区的展开显示';
        btn.style.fontSize = '11px';
        btn.style.fontWeight = '700';
        btn.classList.add('btn-success');
        btn.classList.remove('btn-primary');
      }
      const ratioBtn = document.getElementById('expandRatioBtn');
      if (ratioBtn) {
        ratioBtn.style.display = '';
        ratioBtn.textContent = expandRatioLabels[expandRatioIndex];
      }
      // 显示当前工作区
      const currentPanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
      if (currentPanel) currentPanel.style.display = 'block';
      updateExpandHeaders();
      const activePanel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
      if (activePanel) activePanel.classList.add('active-ws');
      applyExpandRatio();
    }
  }
  
  // 获取应用信息
  try {
    const appInfo = await window.electronAPI.getAppInfo();
    console.log('[Renderer] 应用信息:', appInfo);
    
    // 更新 API 服务器状态
    if (appInfo.apiServerRunning !== undefined) {
      apiServerRunning = appInfo.apiServerRunning;
      updateAPIStatus(apiServerRunning);
    }
  } catch (error) {
    console.error('[Renderer] 获取应用信息失败:', error);
  }

  // 绑定回车键事件
  document.getElementById('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      startCrawl();
    }
  });
  
  // 绑定卡片类型切换事件
  const typeRadios = document.querySelectorAll('input[name="bookmarkType"]');
  typeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      updateBookmarkModalVisibility(this.value);
    });
  });

  // 定时检查 API 服务器状态
  setInterval(checkAPIStatus, 3000);

  // 窗口大小变化时，重新应用 zoomFactor
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (expandViewEnabled) {
        applyExpandRatio();
      }
    }, 300);
  });

  // 启动时加载排程并启动检查器（延迟3秒确保应用完全就绪）
  setTimeout(async () => {
    await loadSchedules();
    executeStartupSchedules();
    startScheduleChecker();
  }, 3000);
});

// 检查 API 服务器状态
async function checkAPIStatus() {
  try {
    const status = await window.electronAPI.getAPIStatus();
    if (status.running !== apiServerRunning) {
      apiServerRunning = status.running;
      updateAPIStatus(apiServerRunning);
    }
  } catch (error) {
    console.error('[Renderer] 检查 API 状态失败:', error);
  }
}

// 更新 API 服务器状态显示
function updateAPIStatus(running) {
  const statusElement = document.getElementById('apiStatus');
  const toggleBtn = document.getElementById('apiToggleBtn');
  
  if (running) {
    statusElement.textContent = '🟢 运行中';
    statusElement.style.background = '#dcfce7';
    statusElement.style.color = '#166534';
    toggleBtn.textContent = '停止';
    toggleBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
  } else {
    statusElement.textContent = '🔴 已停止';
    statusElement.style.background = '#fef2f2';
    statusElement.style.color = '#dc2626';
    toggleBtn.textContent = '启动';
    toggleBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  }
}

// 切换 API 服务器状态
async function toggleAPIServer() {
  const toggleBtn = document.getElementById('apiToggleBtn');
  toggleBtn.disabled = true;
  
  try {
    let result;
    if (apiServerRunning) {
      result = await window.electronAPI.stopAPIServer();
    } else {
      result = await window.electronAPI.startAPIServer();
    }
    
    if (result.success) {
      apiServerRunning = !apiServerRunning;
      updateAPIStatus(apiServerRunning);
      showStatus(result.message, 'success');
    } else {
      showStatus('❌ ' + result.message, 'error');
    }
  } catch (error) {
    console.error('[Renderer] 切换 API 服务器失败:', error);
    showStatus('❌ 操作失败：' + error.message, 'error');
  } finally {
    toggleBtn.disabled = false;
  }
}

// 开始爬取
async function startCrawl() {
  const urlInput = document.getElementById('urlInput');
  const url = urlInput.value.trim();

  if (!url) {
    showStatus('请输入网址', 'error');
    return;
  }

  // 清除只预览模式的 URL（正常爬取时不使用）
  window.currentPreviewUrl = null;

  // 爬取前先清除当前数据
  clearResults(true);

  // 确保 URL 有协议
  let targetUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    targetUrl = 'https://' + url;
  }

  console.log('[Renderer] 开始爬取:', targetUrl);

  // 更新 UI
  const crawlBtn = document.getElementById('crawlBtn');
  crawlBtn.disabled = true;
  crawlBtn.innerHTML = '<span class="loading"></span>';
  crawlBtn.title = '爬取中...';
  
  showStatus('正在爬取网页，请稍候...', 'info');

  try {
    // 准备请求参数
    const crawlOptions = {
      url: targetUrl
    };
    
    // 如果有自定义 headers，添加到选项中
    if (window.currentCustomHeaders) {
      crawlOptions.headers = window.currentCustomHeaders;
      console.log('[Renderer] 使用自定义请求头:', window.currentCustomHeaders);
    }
    
    // 调用 Electron API 爬取网页
    const data = await window.electronAPI.crawlPage(crawlOptions);

    console.log('[Renderer] 爬取成功:', data);

    // 保存数据（直接使用返回的数据）
    crawledData = data;

    // 显示成功状态
    const stats = data.stats || {};
    showStatus(
      `✅ 爬取成功！链接:${stats.linkCount || 0} | 表格:${stats.tableCount || 0} | 图片:${stats.imageCount || 0} | 脚本:${stats.scriptCount || 0} | 标题:${stats.headingCount || 0}`,
      'success'
    );

    // 显示数据区域
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';
    document.getElementById('dataSection').style.display = 'block';

    // 更新 tabs 的可见性和数量显示
    updateTabsVisibility(data);

    // 渲染当前标签的数据
    renderData(currentTab);
    
  } catch (error) {
    console.error('[Renderer] 爬取失败:', error);
    showStatus('❌ 爬取失败：' + error.message, 'error');
  } finally {
    // 恢复按钮状态
    crawlBtn.disabled = false;
    crawlBtn.innerHTML = '🕷️';
    crawlBtn.title = '开始爬取';
  }
}

// 切换标签
function switchTab(tabName) {
  currentTab = tabName;

  // 更新标签样式
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.classList.remove('active');
    if (tab.getAttribute('data-tab') === tabName && tab.style.display !== 'none') {
      tab.classList.add('active');
    }
  });

  // 渲染数据
  renderData(tabName);
}

// 获取每个 tab 的数据数量
function getTabDataCount(tabName, data) {
  if (!data) return 0;

  switch (tabName) {
    case 'links':
      return (data.links || []).length;
    case 'tables':
      return (data.tables || []).length;
    case 'text':
      return (data.text || '').length > 0 ? 1 : 0;
    case 'images':
      return (data.images || []).length;
    case 'buttons':
      return (data.buttons || []).length;
    case 'meta':
      return Object.keys(data.meta || {}).length > 0 || (data.meta && data.meta.title) ? 1 : 0;
    case 'forms':
      const forms = data.forms || [];
      const inputs = data.inputs || [];
      const selects = data.selects || [];
      const textareas = data.textareas || [];
      return forms.length + inputs.length + selects.length + textareas.length;
    case 'headings':
      const headings = data.headings || {};
      return Object.keys(headings).reduce((sum, key) => sum + (headings[key] || []).length, 0);
    case 'media':
      const videos = data.videos || [];
      const audios = data.audios || [];
      const iframes = data.iframes || [];
      const scripts = data.scripts || [];
      const styles = data.styles || [];
      return videos.length + audios.length + iframes.length + scripts.length + styles.length;
    case 'semantic':
      const semantic = data.semantic || {};
      return Object.keys(semantic).reduce((sum, key) => sum + (semantic[key] || []).length, 0);
    case 'stats':
      return Object.keys(data.stats || {}).length > 0 ? 1 : 0;
    case 'keyword':
      return 1; // 总是显示关键字提取页签
    case 'webpreview':
      // 在只预览模式下，使用 window.currentPreviewUrl
      return (data?.url || crawledData?.url || window.currentPreviewUrl) ? 1 : 0;
    case 'canvases':
      return (data.canvases || []).length;
    case 'svgs':
      return (data.svgs || []).length;
    case 'cookies':
      return (data.cookies || []).length;
    case 'storage':
      const localStorage = data.localStorage || {};
      const sessionStorage = data.sessionStorage || {};
      return Object.keys(localStorage).length + Object.keys(sessionStorage).length;
    case 'events':
      return (data.events || []).length;
    case 'hidden':
      return (data.hiddenElements || []).length;
    case 'cssrules':
      return (data.cssRules || []).length;
    case 'comments':
      return (data.comments || []).length;
    case 'structured':
      const jsonLd = data.jsonLd || [];
      const microdata = data.microdata || [];
      return jsonLd.length + microdata.length;
    default:
      return 0;
  }
}

// 更新 tabs 的可见性和显示数量
function updateTabsVisibility(data) {
  const tabs = document.querySelectorAll('.tab');
  let firstVisibleTab = null;

  tabs.forEach(tab => {
    const tabName = tab.getAttribute('data-tab');
    const count = getTabDataCount(tabName, data);
    const originalText = tab.getAttribute('data-original-text') || tab.textContent.trim();

    // 保存原始文本（首次运行时）
    if (!tab.getAttribute('data-original-text')) {
      tab.setAttribute('data-original-text', originalText);
    }

    if (count > 0) {
      // 有数据：显示 tab 并添加数量
      tab.style.display = '';
      tab.textContent = originalText + '(' + count + ')';

      // 记录第一个有数据的 tab
      if (!firstVisibleTab) {
        firstVisibleTab = tabName;
      }
    } else {
      // 无数据：隐藏 tab
      tab.style.display = 'none';
    }
  });

  // 切换到第一个有数据的 tab（如果当前 tab 被隐藏了）
  if (firstVisibleTab) {
    const currentTabElement = document.querySelector('.tab[data-tab="' + currentTab + '"]');
    if (!currentTabElement || currentTabElement.style.display === 'none') {
      switchTab(firstVisibleTab);
    }
  }
}

// 渲染数据
function renderData(tabName) {
  // 优先渲染到当前工作区面板
  const container = getCurrentWorkspacePanel() || document.getElementById('dataContainer');
  
  // 如果是网页预览页签，即使没有爬取数据也要渲染（只预览模式）
  if (tabName === 'webpreview') {
    renderWebPreview(container);
    return;
  }
  
  // 其他页签需要爬取数据
  if (!crawledData) {
    return;
  }
  
  switch (tabName) {
    case 'links':
        renderLinks(container, crawledData.links || []);
        break;
    case 'tables':
        renderTables(container, crawledData.tables || []);
        break;
    case 'text':
        renderText(container, crawledData.text || '');
        break;
    case 'images':
        renderImages(container, crawledData.images || []);
        break;
    case 'buttons':
        renderButtons(container, crawledData.buttons || []);
        break;
    case 'meta':
        renderMeta(container, crawledData.meta || {});
        break;
    case 'forms':
        renderForms(container, crawledData);
        break;
    case 'headings':
        renderHeadings(container, crawledData.headings || {});
        break;
    case 'media':
        renderMedia(container, crawledData);
        break;
    case 'semantic':
        renderSemantic(container, crawledData.semantic || {});
        break;
    case 'stats':
        renderStats(container, crawledData.stats || {});
        break;
    case 'keyword':
        renderKeywordExtraction(container);
        break;
    case 'webpreview':
        renderWebPreview(container);
        break;
    case 'canvases':
        renderCanvases(container, crawledData.canvases || []);
        break;
    case 'svgs':
        renderSvgs(container, crawledData.svgs || []);
        break;
    case 'cookies':
        renderCookies(container, crawledData.cookies || []);
        break;
    case 'storage':
        renderStorage(container, crawledData);
        break;
    case 'events':
        renderEvents(container, crawledData.events || []);
        break;
    case 'hidden':
        renderHidden(container, crawledData.hiddenElements || []);
        break;
    case 'cssrules':
        renderCSSRules(container, crawledData.cssRules || []);
        break;
    case 'comments':
        renderComments(container, crawledData.comments || []);
        break;
    case 'structured':
        renderStructuredData(container, crawledData);
        break;
    default:
        renderLinks(container, crawledData.links || []);
  }
}

// 渲染链接
function renderLinks(container, links) {
  if (!links || links.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何链接</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>文本</th>
          <th>链接</th>
          <th>标题</th>
          <th>类型</th>
        </tr>
      </thead>
      <tbody>
  `;

  links.forEach(link => {
    const typeBadge = link.isExternal ? '<span class="badge external">外部</span>' : link.isAnchor ? '<span class="badge anchor">锚点</span>' : '<span class="badge internal">内部</span>';
    html += `
      <tr>
        <td>${link.id}</td>
        <td>${escapeHtml(link.text)}</td>
        <td><a href="${escapeHtml(link.href)}" target="_blank">${escapeHtml(truncateUrl(link.href))}</a></td>
        <td>${escapeHtml(link.title)}</td>
        <td>${typeBadge}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染表格
function renderTables(container, tables) {
  if (!tables || tables.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何表格</div>';
    return;
  }

  let html = '';
  
  tables.forEach((table) => {
    html += `<div class="table-card">`;
    html += `<h3 style="margin: 0 0 12px; color: #333; font-size: 14px;">表格 ${table.id} ${table.caption ? `- ${table.caption}` : ''} (${table.rowCount}行 × ${table.colCount}列)</h3>`;
    html += '<table class="data-table compact"><thead>';
    
    if (table.hasHeader && table.headers.length > 0) {
      html += '<tr>';
      table.headers.forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
      });
      html += '</tr></thead><tbody>';
    } else {
      html += '</thead><tbody>';
    }
    
    table.rows.forEach((row) => {
      html += '<tr>';
      row.forEach(cell => {
        const cellClass = cell.isHeader ? 'header-cell' : '';
        html += `<td class="${cellClass}" colspan="${cell.colspan}" rowspan="${cell.rowspan}">${escapeHtml(cell.text)}</td>`;
      });
      html += '</tr>';
    });
    
    html += '</tbody></table></div>';
  });

  container.innerHTML = html;
}

// 渲染文本
function renderText(container, text) {
  const stats = crawledData.stats || {};
  container.innerHTML = `
    <div style="margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 14px; color: #64748b;">📝 文本统计</span>
        <span style="font-size: 12px; color: #94a3b8;">字符数: ${stats.charCount || 0} | 词数: ${stats.wordCount || 0}</span>
      </div>
    </div>
    <div class="text-content">
      ${escapeHtml(text)}
    </div>
  `;
}

// 渲染图片
function renderImages(container, images) {
  if (!images || images.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何图片</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>预览</th>
          <th>描述</th>
          <th>尺寸</th>
          <th>URL</th>
        </tr>
      </thead>
      <tbody>
  `;

  images.forEach(img => {
    html += `
      <tr>
        <td>${img.id}</td>
        <td><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" class="img-preview"></td>
        <td>${escapeHtml(img.alt)}</td>
        <td>${img.width} × ${img.height}</td>
        <td><a href="${escapeHtml(img.src)}" target="_blank">${escapeHtml(truncateUrl(img.src))}</a></td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染按钮
function renderButtons(container, buttons) {
  if (!buttons || buttons.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何按钮</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>标签</th>
          <th>文本</th>
          <th>类型</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
  `;

  buttons.forEach(btn => {
    const disabledBadge = btn.disabled ? '<span class="badge disabled">禁用</span>' : '<span class="badge enabled">可用</span>';
    html += `
      <tr>
        <td>${btn.id}</td>
        <td>${escapeHtml(btn.tag)}</td>
        <td>${escapeHtml(btn.text)}</td>
        <td>${escapeHtml(btn.type)}</td>
        <td>${disabledBadge}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染元信息
function renderMeta(container, meta) {
  container.innerHTML = `
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">页面标题</span>
        <span class="meta-value">${escapeHtml(crawledData.title || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">页面编码</span>
        <span class="meta-value">${escapeHtml(meta.charset || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">页面语言</span>
        <span class="meta-value">${escapeHtml(meta.language || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">描述</span>
        <span class="meta-value">${escapeHtml(meta.description || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">关键词</span>
        <span class="meta-value">${escapeHtml(meta.keywords || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">作者</span>
        <span class="meta-value">${escapeHtml(meta.author || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">视口设置</span>
        <span class="meta-value">${escapeHtml(meta.viewport || '')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Robots</span>
        <span class="meta-value">${escapeHtml(meta.robots || '')}</span>
      </div>
    </div>
    
    ${meta.openGraph && meta.openGraph.length > 0 ? `
    <div class="section">
      <h3>📊 Open Graph 数据</h3>
      <table class="data-table compact">
        <thead><tr><th>属性</th><th>内容</th></tr></thead>
        <tbody>
          ${meta.openGraph.map(item => `<tr><td>${escapeHtml(item.property)}</td><td>${escapeHtml(item.content)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    ${Object.keys(meta.twitterCard || {}).length > 0 ? `
    <div class="section">
      <h3>🐦 Twitter Card 数据</h3>
      <table class="data-table compact">
        <thead><tr><th>属性</th><th>内容</th></tr></thead>
        <tbody>
          ${Object.entries(meta.twitterCard).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
  `;
}

// 渲染表单数据
function renderForms(container, data) {
  const forms = data.forms || [];
  const inputs = data.inputs || [];
  const selects = data.selects || [];
  const textareas = data.textareas || [];
  
  let html = '';
  
  if (forms.length > 0) {
    html += `
      <div class="section">
        <h3>📋 表单 (${forms.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>动作</th><th>方法</th><th>编码</th><th>目标</th></tr></thead>
          <tbody>
            ${forms.map(f => `<tr><td>${f.id}</td><td>${escapeHtml(f.action)}</td><td>${escapeHtml(f.method)}</td><td>${escapeHtml(f.enctype)}</td><td>${escapeHtml(f.target)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (inputs.length > 0) {
    html += `
      <div class="section">
        <h3>📝 输入框 (${inputs.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>值</th><th>占位符</th><th>必填</th></tr></thead>
          <tbody>
            ${inputs.map(i => `<tr><td>${i.id}</td><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.type)}</td><td>${escapeHtml(i.value)}</td><td>${escapeHtml(i.placeholder)}</td><td>${i.required ? '是' : '否'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (selects.length > 0) {
    html += `
      <div class="section">
        <h3>📜 下拉框 (${selects.length})</h3>
        ${selects.map(s => `
          <div class="select-card">
            <div style="font-weight: bold; margin-bottom: 8px;">${escapeHtml(s.name || s.id || `下拉框 ${s.id}`)}</div>
            <table class="data-table compact">
              <thead><tr><th>选项值</th><th>文本</th><th>选中</th></tr></thead>
              <tbody>${s.options.map(o => `<tr><td>${escapeHtml(o.value)}</td><td>${escapeHtml(o.text)}</td><td>${o.selected ? '✓' : ''}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  if (textareas.length > 0) {
    html += `
      <div class="section">
        <h3>📄 文本域 (${textareas.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>名称</th><th>占位符</th><th>行列</th><th>内容预览</th></tr></thead>
          <tbody>
            ${textareas.map(t => `<tr><td>${t.id}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.placeholder)}</td><td>${t.rows}×${t.cols}</td><td>${escapeHtml(t.value.substring(0, 50))}${t.value.length > 50 ? '...' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (!forms.length && !inputs.length && !selects.length && !textareas.length) {
    html = '<div class="empty-state">未找到任何表单元素</div>';
  }
  
  container.innerHTML = html;
}

// 渲染标题
function renderHeadings(container, headings) {
  let html = '';
  
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(tag => {
    const items = headings[tag] || [];
    if (items.length > 0) {
      html += `
        <div class="section">
          <h3>${'#'}${tag.replace('h', '')} 级标题 (${items.length})</h3>
          <table class="data-table compact">
            <thead><tr><th>ID</th><th>文本内容</th></tr></thead>
            <tbody>
              ${items.map(h => `<tr><td>${h.id}</td><td>${escapeHtml(h.text)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  });
  
  if (!html) {
    html = '<div class="empty-state">未找到任何标题</div>';
  }
  
  container.innerHTML = html;
}

// 渲染媒体资源
function renderMedia(container, data) {
  const videos = data.videos || [];
  const audios = data.audios || [];
  const iframes = data.iframes || [];
  const scripts = data.scripts || [];
  const styles = data.styles || [];
  
  let html = '';
  
  if (videos.length > 0) {
    html += `
      <div class="section">
        <h3>🎬 视频 (${videos.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>来源</th><th>尺寸</th><th>控制</th></tr></thead>
          <tbody>
            ${videos.map(v => `<tr><td>${v.id}</td><td><a href="${escapeHtml(v.src)}" target="_blank">${escapeHtml(truncateUrl(v.src))}</a></td><td>${v.width}×${v.height}</td><td>${v.controls ? '✓' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (audios.length > 0) {
    html += `
      <div class="section">
        <h3>🎵 音频 (${audios.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>来源</th><th>控制</th></tr></thead>
          <tbody>
            ${audios.map(a => `<tr><td>${a.id}</td><td><a href="${escapeHtml(a.src)}" target="_blank">${escapeHtml(truncateUrl(a.src))}</a></td><td>${a.controls ? '✓' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (iframes.length > 0) {
    html += `
      <div class="section">
        <h3>🖼️ 内嵌框架 (${iframes.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>来源</th><th>标题</th><th>尺寸</th></tr></thead>
          <tbody>
            ${iframes.map(i => `<tr><td>${i.id}</td><td><a href="${escapeHtml(i.src)}" target="_blank">${escapeHtml(truncateUrl(i.src))}</a></td><td>${escapeHtml(i.title)}</td><td>${i.width}×${i.height}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (scripts.length > 0) {
    html += `
      <div class="section">
        <h3>📜 脚本 (${scripts.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>来源</th><th>类型</th><th>异步</th><th>内联</th></tr></thead>
          <tbody>
            ${scripts.map(s => `<tr><td>${s.id}</td><td>${s.src ? `<a href="${escapeHtml(s.src)}" target="_blank">${escapeHtml(truncateUrl(s.src))}</a>` : '(内联脚本)'}</td><td>${escapeHtml(s.type)}</td><td>${s.async ? '✓' : ''}</td><td>${s.inline ? '✓' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (styles.length > 0) {
    html += `
      <div class="section">
        <h3>🎨 样式表 (${styles.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>来源</th><th>媒体</th></tr></thead>
          <tbody>
            ${styles.map(style => `<tr><td>${style.id}</td><td><a href="${escapeHtml(style.href)}" target="_blank">${escapeHtml(truncateUrl(style.href))}</a></td><td>${escapeHtml(style.media) || 'all'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (!html) {
    html = '<div class="empty-state">未找到任何媒体资源</div>';
  }
  
  container.innerHTML = html;
}

// 渲染语义标签
function renderSemantic(container, semantic) {
  const tags = ['articles', 'sections', 'headers', 'footers', 'navs', 'asides'];
  const tagNames = { articles: '文章', sections: '章节', headers: '页头', footers: '页脚', navs: '导航', asides: '侧边栏' };
  
  let html = '';
  
  tags.forEach(tag => {
    const items = semantic[tag] || [];
    if (items.length > 0) {
      html += `
        <div class="section">
          <h3>&lt;${tag.replace('s', '')}&gt; ${tagNames[tag]} (${items.length})</h3>
          <table class="data-table compact">
            <thead><tr><th>ID</th><th>内容预览</th></tr></thead>
            <tbody>
              ${items.map(item => `<tr><td>${item.id}</td><td>${escapeHtml(item.text)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  });
  
  if (!html) {
    html = '<div class="empty-state">未找到任何语义标签</div>';
  }
  
  container.innerHTML = html;
}

// 关键字提取功能
function renderKeywordExtraction(container) {
  container.innerHTML = `
    <div class="keyword-extraction-container">
      <div class="keyword-input-section">
        <input type="text" id="keywordInput" placeholder="请输入要搜索的关键字，例如：价格、名称、地址..." />
        <button onclick="executeKeywordSearch()">🔍 开始提取</button>
      </div>
      
      <div class="keyword-options">
        <label>
          <input type="checkbox" id="extractContext" checked>
          提取上下文内容
        </label>
        <label>
          <input type="checkbox" id="extractPrevious">
          包含关键字前面的内容
        </label>
        <label>
          <input type="number" id="contextLength" value="50" min="10" max="500" style="width: 60px;">
          上下文长度（字符）
        </label>
      </div>

      <div class="keyword-results" id="keywordResults">
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <p>请输入关键字并点击"开始提取"</p>
        </div>
      </div>
    </div>
  `;
}

// 执行关键字搜索
function executeKeywordSearch() {
  const keyword = document.getElementById('keywordInput').value.trim();
  if (!keyword) {
    showStatus('❌ 请输入关键字', 'error');
    return;
  }

  if (!crawledData) {
    showStatus('❌ 请先爬取网页数据', 'error');
    return;
  }

  console.log('[Renderer] 开始关键字提取:', keyword);

  const results = findKeywordsInDOM(keyword);
  displayKeywordResults(results, keyword);
}

// 在 DOM 中查找关键字
function findKeywordsInDOM(keyword) {
  const results = [];
  
  // 从爬取数据中提取文本内容
  const fullText = crawledData.text || '';
  const fullHTML = crawledData.html || '';
  
  // 1. 在文本中查找
  const textLines = fullText.split('\n').filter(line => line.trim());
  textLines.forEach((line, index) => {
    if (line.includes(keyword)) {
      results.push({
        type: '文本行',
        content: line,
        position: index + 1,
        source: 'text'
      });
    }
  });

  // 2. 在 HTML 中查找（更精确的 DOM 遍历）
  const htmlResults = findKeywordInHTML(keyword, fullHTML);
  results.push(...htmlResults);

  // 3. 在结构化数据中查找
  if (crawledData.tables) {
    crawledData.tables.forEach((table, tableIndex) => {
      table.rows?.forEach((row, rowIndex) => {
        row.cells?.forEach((cell, cellIndex) => {
          if (cell.includes(keyword)) {
            results.push({
              type: `表格 [${tableIndex + 1}] 行 ${rowIndex + 1} 列 ${cellIndex + 1}`,
              content: cell,
              source: 'table'
            });
          }
        });
      });
    });
  }

  // 4. 在超链接中查找
  if (crawledData.links) {
    crawledData.links.forEach((link, index) => {
      if (link.text?.includes(keyword)) {
        results.push({
          type: `超链接 [${index + 1}]`,
          content: `${link.text} → ${link.href}`,
          source: 'link'
        });
      }
    });
  }

  // 5. 在标题中查找
  if (crawledData.headings) {
    crawledData.headings.forEach((heading, index) => {
      if (heading.content?.includes(keyword)) {
        results.push({
          type: `标题 [${heading.level || 1}]`,
          content: heading.content,
          source: 'heading'
        });
      }
    });
  }

  // 去重
  const uniqueResults = [];
  const seen = new Set();
  results.forEach(result => {
    const key = `${result.type}:${result.content.substring(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(result);
    }
  });

  return uniqueResults;
}

// 在 HTML 中查找关键字（DOM 遍历）
function findKeywordInHTML(keyword, html) {
  const results = [];
  
  // 使用简单的字符串匹配查找关键字
  let position = 0;
  while (true) {
    position = html.indexOf(keyword, position);
    if (position === -1) break;

    // 找到包含关键字的上下文
    const contextLength = parseInt(document.getElementById('contextLength')?.value || '50');
    const start = Math.max(0, position - contextLength);
    const end = Math.min(html.length, position + keyword.length + contextLength);
    
    let context = html.substring(start, end);
    
    // 清理 HTML 标签，只保留文本
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = context;
    const textContent = tempDiv.textContent || tempDiv.innerText || '';

    // 查找 HTML 标签（用于显示来源）
    const tagMatch = html.substring(Math.max(0, position - 100), position).match(/<([a-z]+)[^>]*>/i);
    const tagName = tagMatch ? tagMatch[1] : 'unknown';

    results.push({
      type: `HTML 元素 [${tagName}]`,
      content: textContent.trim(),
      source: 'html',
      position: position
    });

    position += keyword.length;
  }

  return results;
}

// 显示关键字结果
function displayKeywordResults(results, keyword) {
  const resultsContainer = document.getElementById('keywordResults');
  
  if (results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">😔</div>
        <p>未找到包含"<strong>${escapeHtml(keyword)}</strong>"的内容</p>
      </div>
    `;
    return;
  }

  const highlightKeyword = (text) => {
    const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
    return escapeHtml(text).replace(regex, '<span class="keyword-highlight">$1</span>');
  };

  let html = `<div class="keyword-result-count">✅ 找到 ${results.length} 个匹配结果</div>`;

  results.forEach((result, index) => {
    html += `
      <div class="keyword-result-item">
        <div class="keyword-result-header">
          <span class="keyword-result-tag">${result.type}</span>
          <span style="font-size: 12px; color: #64748b;">#${index + 1}</span>
        </div>
        <div class="keyword-result-context">
          ${highlightKeyword(result.content)}
        </div>
      </div>
    `;
  });

  resultsContainer.innerHTML = html;
}


// 渲染统计数据
function renderStats(container, stats) {
  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.charCount || 0}</div>
        <div class="stat-label">字符数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.wordCount || 0}</div>
        <div class="stat-label">词数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.linkCount || 0}</div>
        <div class="stat-label">链接数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.imageCount || 0}</div>
        <div class="stat-label">图片数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.tableCount || 0}</div>
        <div class="stat-label">表格数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.headingCount || 0}</div>
        <div class="stat-label">标题数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.scriptCount || 0}</div>
        <div class="stat-label">脚本数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.styleCount || 0}</div>
        <div class="stat-label">样式数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.canvasCount || 0}</div>
        <div class="stat-label">画布数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.svgCount || 0}</div>
        <div class="stat-label">SVG数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.eventCount || 0}</div>
        <div class="stat-label">事件数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.commentCount || 0}</div>
        <div class="stat-label">注释数</div>
      </div>
    </div>
    
    <div class="section" style="margin-top: 16px;">
      <h3>🔗 当前页面信息</h3>
      <table class="data-table compact">
        <tbody>
          <tr><td>页面 URL</td><td><a href="${escapeHtml(crawledData.url || '')}" target="_blank">${escapeHtml(crawledData.url || '')}</a></td></tr>
          <tr><td>页面标题</td><td>${escapeHtml(crawledData.title || '')}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// 渲染画布
function renderCanvases(container, canvases) {
  if (!canvases || canvases.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何画布</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>宽度</th>
          <th>高度</th>
          <th>样式</th>
        </tr>
      </thead>
      <tbody>
  `;

  canvases.forEach(canvas => {
    html += `
      <tr>
        <td>${canvas.id}</td>
        <td>${canvas.width}</td>
        <td>${canvas.height}</td>
        <td>${escapeHtml(canvas.style.substring(0, 50))}${canvas.style.length > 50 ? '...' : ''}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染SVG
function renderSvgs(container, svgs) {
  if (!svgs || svgs.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何SVG</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>宽度</th>
          <th>高度</th>
          <th>视图框</th>
          <th>动画</th>
        </tr>
      </thead>
      <tbody>
  `;

  svgs.forEach(svg => {
    html += `
      <tr>
        <td>${svg.id}</td>
        <td>${svg.width}</td>
        <td>${svg.height}</td>
        <td>${escapeHtml(svg.viewBox)}</td>
        <td>${svg.hasAnimation ? '✓' : ''}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染Cookie
function renderCookies(container, cookies) {
  if (!cookies || cookies.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何Cookie</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>名称</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
  `;

  cookies.forEach(cookie => {
    html += `
      <tr>
        <td>${cookie.id}</td>
        <td>${escapeHtml(cookie.name)}</td>
        <td>${escapeHtml(cookie.value.substring(0, 100))}${cookie.value.length > 100 ? '...' : ''}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染存储
function renderStorage(container, data) {
  const localStorage = data.localStorage || {};
  const sessionStorage = data.sessionStorage || {};
  
  let html = '';
  
  if (Object.keys(localStorage).length > 0) {
    html += `
      <div class="section">
        <h3>💾 Local Storage (${Object.keys(localStorage).length})</h3>
        <table class="data-table compact">
          <thead><tr><th>键</th><th>值</th></tr></thead>
          <tbody>
            ${Object.entries(localStorage).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value.substring(0, 200))}${value.length > 200 ? '...' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (Object.keys(sessionStorage).length > 0) {
    html += `
      <div class="section">
        <h3>💿 Session Storage (${Object.keys(sessionStorage).length})</h3>
        <table class="data-table compact">
          <thead><tr><th>键</th><th>值</th></tr></thead>
          <tbody>
            ${Object.entries(sessionStorage).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value.substring(0, 200))}${value.length > 200 ? '...' : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (!html) {
    html = '<div class="empty-state">未找到任何Web Storage数据</div>';
  }
  
  container.innerHTML = html;
}

// 渲染事件
function renderEvents(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何内联事件</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>标签</th>
          <th>事件</th>
        </tr>
      </thead>
      <tbody>
  `;

  events.forEach(eventItem => {
    const eventList = Object.entries(eventItem.events).map(([key, value]) => `${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`).join('<br>');
    html += `
      <tr>
        <td>${eventItem.id}</td>
        <td>${escapeHtml(eventItem.tag)}</td>
        <td>${eventList}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染隐藏元素
function renderHidden(container, hiddenElements) {
  if (!hiddenElements || hiddenElements.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何隐藏元素</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>标签</th>
          <th>ID属性</th>
          <th>类名</th>
        </tr>
      </thead>
      <tbody>
  `;

  hiddenElements.forEach(el => {
    html += `
      <tr>
        <td>${el.id}</td>
        <td>${escapeHtml(el.tag)}</td>
        <td>${escapeHtml(el.idAttr)}</td>
        <td>${escapeHtml(el.className)}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染CSS规则
function renderCSSRules(container, rules) {
  if (!rules || rules.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何CSS规则</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>选择器</th>
          <th>规则内容</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
  `;

  rules.forEach(rule => {
    html += `
      <tr>
        <td>${rule.id}</td>
        <td>${escapeHtml(rule.selector)}</td>
        <td>${escapeHtml(rule.text)}</td>
        <td>${escapeHtml(rule.source)}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染注释
function renderComments(container, comments) {
  if (!comments || comments.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到任何HTML注释</div>';
    return;
  }

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>注释内容</th>
        </tr>
      </thead>
      <tbody>
  `;

  comments.forEach(comment => {
    html += `
      <tr>
        <td>${comment.id}</td>
        <td>${escapeHtml(comment.text)}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// 渲染结构化数据
function renderStructuredData(container, data) {
  const jsonLd = data.jsonLd || [];
  const microdata = data.microdata || [];
  
  let html = '';
  
  if (jsonLd.length > 0) {
    html += `
      <div class="section">
        <h3>📋 JSON-LD (${jsonLd.length})</h3>
        ${jsonLd.map((item, index) => `
          <div class="select-card">
            <div style="font-weight: bold; margin-bottom: 8px;">JSON-LD ${index + 1}</div>
            <pre style="font-size: 12px; line-height: 1.5; max-height: 200px; overflow-y: auto;">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  if (microdata.length > 0) {
    html += `
      <div class="section">
        <h3>🏷️ Microdata (${microdata.length})</h3>
        <table class="data-table compact">
          <thead><tr><th>ID</th><th>类型</th><th>属性</th></tr></thead>
          <tbody>
            ${microdata.map(item => `<tr><td>${item.id}</td><td>${escapeHtml(item.type)}</td><td>${Object.keys(item).filter(k => k !== 'id' && k !== 'type').map(k => `${k}: ${item[k]}`).join(', ')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (!html) {
    html = '<div class="empty-state">未找到任何结构化数据</div>';
  }
  
  container.innerHTML = html;
}

// 导出数据
async function exportData(format) {
  if (!crawledData) {
    showStatus('请先爬取数据', 'error');
    return;
  }

  try {
    let data, filename;

    if (format === 'json') {
      data = JSON.stringify(crawledData, null, 2);
      filename = 'ai-console-data.json';
    } else if (format === 'csv') {
      const headers = ['ID', '文本', '链接', '标题', '是否外部'];
      const rows = (crawledData.links || []).map(link => [
        link.id,
        `"${(link.text || '').replace(/"/g, '""')}"`,
        `"${(link.href || '').replace(/"/g, '""')}"`,
        `"${(link.title || '').replace(/"/g, '""')}"`,
        link.isExternal ? '是' : '否'
      ]);
      
      data = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      filename = 'ai-console-links.csv';
    }

    const result = await window.electronAPI.saveData(data, filename);
    
    if (result.success) {
      showStatus(`✅ 数据已保存到：${result.path}`, 'success');
    } else {
      showStatus('❌ 保存失败：' + (result.message || '用户取消'), 'error');
    }
  } catch (error) {
    console.error('[Renderer] 导出失败:', error);
    showStatus('❌ 导出失败：' + error.message, 'error');
  }
}

// 清除所有爬取结果
function clearResults(skipConfirm = false) {
  // 确认是否要清除（可选跳过）
  if (!skipConfirm && !confirm('确定要清除所有爬取结果吗？')) {
    return;
  }

  // 清空数据
  crawledData = null;

  // 重置当前标签
  currentTab = 'links';

  // 隐藏数据区域
  document.getElementById('dataSection').style.display = 'none';

  // 显示空状态（已移除，保留兼容）
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = '';

  // 清空数据容器
  document.getElementById('dataContainer').innerHTML = '';

  // 隐藏状态消息
  document.getElementById('statusBox').style.display = 'none';

  // 重置所有页签（恢复原始文本并显示所有页签）
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    // 恢复原始文本
    const originalText = tab.getAttribute('data-original-text');
    if (originalText) {
      tab.textContent = originalText;
      tab.removeAttribute('data-original-text');
    }

    // 显示所有页签
    tab.style.display = '';

    // 移除激活状态
    tab.classList.remove('active');
  });

  // 设置第一个页签为激活状态
  const firstTab = document.querySelector('.tab[data-tab="links"]');
  if (firstTab) {
    firstTab.classList.add('active');
  }

  console.log('[Renderer] 已清除所有爬取结果');
  showStatus('✅ 已清除所有爬取结果', 'success');
}


/**
 * 🚀 统一发送接口 — 外部程式可调用
 * 解析文字讯息找出对应的卡片，设置讯息和附件后自动执行"继续对话"
 *
 * @param {string} message - 文字讯息（如 "使用豆包，计算1+10的和的5次方！"）
 * @param {Array} [attachments=[]] - 附件数组，每个元素 { name, size, type, data }
 * @returns {Object} { ok: boolean, index?: number, cardName?: string, error?: string }
 */
async function sendToCard(message, attachments = [], options = {}) {
  if (!message && attachments.length === 0) {
    return { ok: false, error: '讯息和附件均为空' };
  }
  if (!bookmarks || bookmarks.length === 0) {
    return { ok: false, error: '没有可用的卡片' };
  }

  // 1. 从讯息中解析出卡片名称
  const matched = findCardByName(message);

  if (!matched) {
    // 🔑 关键修复：匹配不到时，优先使用当前工作区的AI
    const currentWs = workspaces[currentWorkspaceId];
    let fallbackIndex = null;
    
    // 优先使用当前工作区的AI
    if (currentWs && currentWs.bookmarkIndex !== null && currentWs.bookmarkIndex !== undefined) {
      fallbackIndex = currentWs.bookmarkIndex;
      console.log(`[sendToCard] 无法匹配卡片，使用当前工作区 ${currentWorkspaceId} 的AI`);
    } else {
      // 回退到当前工作区的活跃卡片（per-workspace，防止跨工作区污染）
      const wsActiveIdx = workspaceActiveCards[currentWorkspaceId];
      if (wsActiveIdx !== undefined && wsActiveIdx !== null && wsActiveIdx >= 0 && wsActiveIdx < bookmarks.length) {
        fallbackIndex = wsActiveIdx;
        console.log(`[sendToCard] 无法匹配卡片，回退到工作区 ${currentWorkspaceId} 的活跃卡片`);
      }
      // 不再回退到全局 currentActiveCardIndex，防止使用其他工作区的旧卡片
    }
    
    if (fallbackIndex !== null) {
      const fallbackName = bookmarks[fallbackIndex].name;
      const index = fallbackIndex;
      bookmarks[index].presetMessage = message;
      const regularTextarea = document.getElementById(`presetMsg_${index}`);
      if (regularTextarea) regularTextarea.value = message;
      const miniTextarea = document.getElementById(`mini_msg_${index}`);
      if (miniTextarea) miniTextarea.value = message;
      if (attachments.length > 0) {
        bookmarks[index].attachments = attachments.map(a => ({ ...a }));
      } else {
        bookmarks[index].attachments = [];
      }
      renderAttachments(index);
      saveBookmarksToStorage();
      showStatus(`📨 无法匹配卡片，使用上次的「${fallbackName}」发送...`, 'info', index);
      
      // 🔑 关键修复：只有在调用者未指定跳过自动调度时才执行
      if (!options.skipAutoSchedule) {
        await autoScheduleBeforeExecute(index, message);
      }

      try {
        await continueConversation(index);
      } catch (err) {
        console.error(`[sendToCard] 执行失败:`, err);
        showStatus(`❌ 发送给「${fallbackName}」失败: ${err.message}`, 'error');
        return { ok: false, index, cardName: fallbackName, fallback: true, error: err.message };
      }
      return { ok: true, index, cardName: fallbackName, fallback: true };
    }
    return { ok: false, error: `无法匹配到卡片，且没有上次使用的AI卡片` };
  }

  const { index, name, prefixToRemove, method } = matched;
  console.log(`[sendToCard] 匹配到卡片: ${name} (index=${index}, method=${method})`);
  console.log(`[sendToCard] prefixToRemove: "${prefixToRemove}" (length=${prefixToRemove.length})`);

  // 2. 设置讯息到目标卡片（如果是引号匹配，去除卡片名称前缀）
  let actualMessage = message;
  if (prefixToRemove && prefixToRemove.length > 0) {
    actualMessage = message.substring(prefixToRemove.length).trim();
    console.log(`[sendToCard] 引号匹配，去除前缀 "${prefixToRemove.trim()}"，发送内容: "${actualMessage}"`);
  }
  
  if (!actualMessage || actualMessage.length === 0) {
    console.log(`[sendToCard] 整个消息只是用来定位AI，不发送任何文字内容`);
  }
  
  console.log(`[sendToCard] 原始消息: "${message}"`);
  console.log(`[sendToCard] 处理后消息: "${actualMessage}"`);
  console.log(`[sendToCard] 卡片索引: ${index}`);
  console.log(`[sendToCard] 卡片名称: ${name}`);
  console.log(`[sendToCard] 卡片分类: ${bookmarks[index].category}`);

  // 保存消息到卡片（包括 HTTP Get 卡片，用户输入的股票代号也需要保存）
  bookmarks[index].presetMessage = actualMessage;
  console.log(`[sendToCard] bookmarks[${index}].presetMessage = "${bookmarks[index].presetMessage}"`);
  const regularTextarea = document.getElementById(`presetMsg_${index}`);
  if (regularTextarea) {
    regularTextarea.value = actualMessage;
    console.log(`[sendToCard] presetMsg_${index} value = "${regularTextarea.value}"`);
  } else {
    console.log(`[sendToCard] presetMsg_${index} 不存在`);
  }

  const miniTextarea = document.getElementById(`mini_msg_${index}`);
  if (miniTextarea) {
    miniTextarea.value = actualMessage;
    console.log(`[sendToCard] mini_msg_${index} value = "${miniTextarea.value}"`);
  }

  // 3. 设置附件到目标卡片
  if (attachments.length > 0) {
    bookmarks[index].attachments = attachments.map(a => ({ ...a }));
  } else {
    bookmarks[index].attachments = [];
  }
  renderAttachments(index);
  saveBookmarksToStorage();

  // 4. 自动执行"继续对话"
  setCurrentActiveCard(index);
  showStatus(`📨 正在发送给「${name}」...`, 'info', index);

  // HTTP Get 分类：跳过自动调度，直接执行 HTTP GET 请求
  if (bookmarks[index].category === 'http-get') {
    try {
      // 优先使用 actualMessage（来自浮动窗口的输入），其次从卡片输入框获取
      const stockCodes = actualMessage || (() => {
        const cardTextarea = document.getElementById(`presetMsg_${index}`);
        return cardTextarea ? cardTextarea.value.trim() : '';
      })();
      const httpResult = await executeHttpGet(index, stockCodes);

      // HTTP Get 执行完毕后，检查是否需要发送邮件
      const emailRecipients = floatEmailRecipients.trim() || String(window.scheduleEmailRecipientsValue || '').trim();
      if (emailRecipients && httpResult && httpResult.success && httpResult.markdownContent) {
        try {
          const recipientList = emailRecipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
          const subject = `[HTTP Get] ${bookmarks[index].name} - ${actualMessage.substring(0, 100)}`;

          // 使用统一邮件发送函数（与 capture.js 的获取内容共用同一套逻辑）
          const htmlContent = markdownToHtml(httpResult.markdownContent);
          await sendUnifiedEmail(recipientList, subject, bookmarks[index].name, actualMessage, htmlContent, httpResult.markdownContent.length);
        } catch (e) {
          console.error(`[Email] HTTP Get 邮件发送失败:`, e);
          const statusMsg = `📧 邮件发送失败：${e.message}`;
          showStatus(statusMsg, 'error', undefined, true);
          addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients: emailRecipients });
        }
      }

      return { ok: true, index, cardName: name };
    } catch (err) {
      console.error(`[sendToCard] HTTP Get 执行失败:`, err);
      showStatus(`❌ 执行「${name}」HTTP Get 失败: ${err.message}`, 'error');
      return { ok: false, index, cardName: name, error: err.message };
    }
  }

  // 🔑 关键修复：只有在调用者未指定跳过自动调度时才执行
  if (!options.skipAutoSchedule) {
    await autoScheduleBeforeExecute(index, actualMessage);
  }

  try {
    await continueConversation(index);
  } catch (err) {
    console.error(`[sendToCard] 执行失败:`, err);
    showStatus(`❌ 发送给「${name}」失败: ${err.message}`, 'error');
    return { ok: false, index, cardName: name, error: err.message };
  }

  return { ok: true, index, cardName: name };
}

/**
 * 🔍 从文字讯息中匹配对应的卡片（语义增强版）
 * 
 * 匹配策略（优先级从高到低）：
 * 1. 完全匹配：讯息 = 卡片名称
 * 2. 指定词匹配 + 角色分析：提取"使用/用/以"等指定词后的名称，分析上下文角色
 *    - 优先选择"执行者"角色（"使用XXX进行..."）
 *    - 跳过"被比较对象"角色（"使用XXX与YYY的..."）
 *    - 跳过"问句选项"角色（"是用XXX还是YYY"）
 * 3. 零样本分类：使用 BERT 模型进行语义判断（异步，需初始化）
 * 4. 包含匹配：讯息中包含卡片名称（名称长优先，排除被比较对象）
 * 5. 反向包含：卡片名称包含讯息关键词
 *
 * @param {string} message - 文字讯息
 * @returns {Object|null} { index, name, method } 或 null
 */
function findCardByName(message) {
  if (!message || !bookmarks || bookmarks.length === 0) return null;

  const msg = message.toLowerCase();

  // 1. 完全匹配（忽略大小写）
  for (let i = 0; i < bookmarks.length; i++) {
    const name = bookmarks[i].name || '';
    if (name && name.toLowerCase() === msg.trim()) {
      return { index: i, name, method: 'exact_match', prefixToRemove: '' };
    }
  }

  // 2. 检测引号包围的卡片名称（如 "智谱" 如何学习 或 "智谱"如何学习）
  // 支持各种引号：ASCII直引号("'), Unicode智能引号("",''), 中文引号(「」『』《》【】)
  const quotedPattern = /^[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]([^\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]+)[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]\s*/;
  const quotedMatch = message.match(quotedPattern);
  console.log(`[findCardByName] 引号匹配结果:`, quotedMatch ? { match: quotedMatch[0], keyword: quotedMatch[1], prefixToRemove: quotedMatch[0] } : null);
  if (quotedMatch) {
    const quotedKeyword = quotedMatch[1].trim();
    for (let i = 0; i < bookmarks.length; i++) {
      const name = bookmarks[i].name || '';
      if (name && name.toLowerCase() === quotedKeyword.toLowerCase()) {
        return { 
          index: i, 
          name, 
          method: 'quoted_match',
          prefixToRemove: quotedMatch[0]
        };
      }
    }
  }

  // 3. 指定词匹配 + 上下文角色分析
  const designateMatches = extractDesignateMatches(message);
  if (designateMatches.length > 0) {
    // 优先选择"执行者"角色
    const executor = designateMatches.find(m => m.role === 'executor');
    if (executor) {
      const card = findCardByKeyword(executor.keyword);
      if (card) return { ...card, method: 'designate_executor', prefixToRemove: '' };
    }
    
    // 如果没有明确的执行者，但有多个候选，继续到下一步
    // 被比较对象和问句选项会被后续逻辑排除
  }

  // 4. 包含匹配（讯息中包含卡片名称），排除被比较对象
  const excludeKeywords = designateMatches
    .filter(m => m.role === 'subject' || m.role === 'option')
    .map(m => m.keyword.toLowerCase());
  
  const candidates = [];
  for (let i = 0; i < bookmarks.length; i++) {
    const name = bookmarks[i].name || '';
    if (name && msg.includes(name.toLowerCase())) {
      const isExcluded = excludeKeywords.some(k => name.toLowerCase().includes(k));
      candidates.push({ 
        index: i, 
        name, 
        len: name.length,
        priority: isExcluded ? 0 : 1
      });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.len - a.len;
    });
    const highPriority = candidates.filter(c => c.priority === 1);
    if (highPriority.length > 0) {
      let prefixToRemove = '';
      const quotedMatch = message.match(/^[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011][^\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]+[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]\s*/);
      if (quotedMatch) {
        prefixToRemove = quotedMatch[0];
      }
      return { index: highPriority[0].index, name: highPriority[0].name, method: 'include_match', prefixToRemove };
    }
  }

  // 5. 反向包含（卡片名称包含讯息中的某个词）
  const keywords = message.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const kw of keywords) {
    for (let i = 0; i < bookmarks.length; i++) {
      const name = bookmarks[i].name || '';
      if (name.includes(kw)) {
        let prefixToRemove = '';
        const quotedMatch = message.match(/^[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011][^\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]+[\u0022\u0027\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011]\s*/);
        if (quotedMatch) {
          prefixToRemove = quotedMatch[0];
        }
        return { index: i, name, method: 'reverse_include', prefixToRemove };
      }
    }
  }

  return null;
}

/**
 * 提取所有指定词匹配，并分析上下文角色
 * @param {string} message - 用户讯息
 * @returns {Array} [{ keyword, role, context, index }]
 */
function extractDesignateMatches(message) {
  const matches = [];
  const pattern = /(?:请?\s*使用|用|给|让|叫|找|问|去|以|靠|借|通过|交由)\s*([^\s,，。！？、；：""''（）\[\]]+)/g;
  
  let match;
  while ((match = pattern.exec(message)) !== null) {
    const keyword = match[1].trim();
    const matchIndex = match.index;
    const matchedPhrase = match[0];
    
    const beforeStart = Math.max(0, matchIndex - 10);
    const before = message.slice(beforeStart, matchIndex);
    const afterStart = matchIndex + matchedPhrase.length;
    const after = message.slice(afterStart, Math.min(message.length, afterStart + 20));
    
    const role = analyzeRole(before, after, matchedPhrase);
    
    matches.push({ keyword, role, context: { before, after, matchedPhrase }, index: matchIndex });
  }
  
  return matches;
}

/**
 * 分析指定词匹配的上下文角色
 * @param {string} before - 匹配位置前面的文字
 * @param {string} after - 匹配位置后面的文字
 * @param {string} matchedPhrase - 匹配的完整短语
 * @returns {string} 'executor' | 'subject' | 'option' | 'unknown'
 */
function analyzeRole(before, after, matchedPhrase) {
  // 执行者：后面有"进行/来/去"等动词
  if (after.match(/^(进行|来|去|完成|执行|处理|分析|比较|计算|翻译|写|生成)/)) {
    return 'executor';
  }
  
  // 被比较对象：后面有"与/和/跟"连接词
  if (after.match(/^(与|和|跟|同|vs|versus|对比)/)) {
    return 'subject';
  }
  
  // 描述对象：后面有"的优缺点/的特点"
  if (after.match(/^(的|之)(优缺点|特点|性能|功能|能力|优劣)/)) {
    return 'subject';
  }
  
  // 问句选项：后面有"还是/或者"
  if (after.match(/^(还是|或者|或是)/) || before.match(/(还是|或者|或是)$/)) {
    return 'option';
  }
  
  // 前面有"比较"等词，可能是被比较对象
  if (before.match(/(比较|对比|分析|评价)$/)) {
    return 'subject';
  }
  
  return 'unknown';
}

/**
 * 根据关键词查找卡片
 * @param {string} keyword - 关键词
 * @returns {Object|null} { index, name }
 */
function findCardByKeyword(keyword) {
  if (!keyword || !bookmarks || bookmarks.length === 0) return null;
  
  const kw = keyword.toLowerCase();
  
  for (let i = 0; i < bookmarks.length; i++) {
    const name = bookmarks[i].name || '';
    if (name && name.toLowerCase() === kw) {
      return { index: i, name };
    }
  }
  
  for (let i = 0; i < bookmarks.length; i++) {
    const name = bookmarks[i].name || '';
    if (name && (name.toLowerCase().includes(kw) || kw.includes(name.toLowerCase()))) {
      return { index: i, name };
    }
  }
  
  return null;
}

/**
 * 异步语义匹配（使用零样本分类）
 * @param {string} message - 用户讯息
 * @returns {Promise<Object|null>} { index, name, score }
 */
async function asyncFindCardBySemantic(message) {
  if (!window._zeroShotClassifier || !window._zeroShotClassifierReady) {
    return null;
  }
  
  const cardNames = bookmarks.filter(b => b.name).map(b => b.name);
  if (cardNames.length === 0) return null;
  
  try {
    const result = await window._zeroShotClassifier(message, cardNames, { multi_label: false });
    const bestLabel = result.labels[0];
    const bestScore = result.scores[0];
    
    if (bestScore > 0.3) {
      const index = bookmarks.findIndex(b => b.name === bestLabel);
      if (index >= 0) {
        return { index, name: bestLabel, score: bestScore };
      }
    }
    return null;
  } catch (err) {
    console.error('[语义匹配] 错误:', err);
    return null;
  }
}

/**
 * 初始化零样本分类模型
 */
async function initZeroShotClassifier() {
  if (window._zeroShotClassifierInit) return;
  
  window._zeroShotClassifierInit = true;
  window._zeroShotClassifierReady = false;
  
  try {
    console.log('[语义匹配] 开始加载模型...');
    
    const transformers = await import('@xenova/transformers');
    const { pipeline } = transformers;
    
    window._zeroShotClassifier = await pipeline(
      'zero-shot-classification',
      'Xenova/bert-base-chinese',
      { 
        progress_callback: (progress) => {
          if (progress.status === 'progress') {
            console.log(`[语义匹配] 下载进度: ${Math.round(progress.progress * 100)}%`);
          }
        }
      }
    );
    
    window._zeroShotClassifierReady = true;
    console.log('[语义匹配] 模型加载完成！');
    
  } catch (err) {
    console.error('[语义匹配] 模型加载失败:', err);
    window._zeroShotClassifierReady = false;
  }
}

// 暴露到 window 供外部程式调用
window.sendToCard = sendToCard;
window.findCardByName = findCardByName;
window.asyncFindCardBySemantic = asyncFindCardBySemantic;
window.initZeroShotClassifier = initZeroShotClassifier;

// 🆕 同步迷你卡片的讯息到正规卡片（发送前调用，确保两边数据+DOM一致）
function syncMiniToRegular(index) {
  if (index < 0 || index >= bookmarks.length) return;
  const miniTextarea = document.getElementById(`mini_msg_${index}`);
  if (!miniTextarea) return;

  const miniValue = miniTextarea.value;
  
  if (!miniValue) return;

  // 1. 同步讯息到 bookmarks 数据 + 正规卡片 DOM
  bookmarks[index].presetMessage = miniValue;
  const regularTextarea = document.getElementById(`presetMsg_${index}`);
  if (regularTextarea && regularTextarea.value !== miniValue) {
    regularTextarea.value = miniValue;
  }

  // 2. 同步附件：重新渲染正规卡片的附件缩略图（确保 DOM 与数据一致）
  renderAttachments(index);
}

// ========== 常用爬取网点功能 ==========

// ========== 常用爬取网点管理功能 ==========
let bookmarks = [];
let bookmarkHeadersMap = {}; // 存储每个网点的自定义 headers
let editingBookmarkId = null;
let bookmarksVisible = true;
let collapsedStatesCache = {}; // 内存缓存：卡片折叠状态

// 分类标签映射
const categoryLabels = {
  general: '📌 通用',
  news: '📰 新闻',
  shopping: '🛒 购物',
  social: '💬 社交',
  tech: '💻 科技',
  finance: '💰 金融',
  education: '🎓 教育',
  weather: '🌤️ 天气',
  'ai-chat': '🤖 web版AI Chat',
  'ai-desktop': '🖥️ 桌面版AI Chat',
  'plugin-web': '🔌 内部插件web应用',
  'external-web': '🌐 外部web应用',
  'http-get': '📡 HTTP Get 调用',
  'api-call': ' API 调用',
  'desktop-app': '️ 桌面版APP',
  other: ' 其他'
};

// 页面加载时初始化网点数据
document.addEventListener('DOMContentLoaded', async function() {
  loadBookmarks();
  await loadFloatHistory();

  // 程式加载后直接显示浮动视窗（折叠态小圆球）
  const statusBoxInit = document.getElementById('statusBoxInline');
  if (statusBoxInit) {
    statusBoxInit.style.display = '';
    statusBoxInit.classList.remove('expanded');
    statusBoxInit.classList.add('collapsed', 'info');
    // 恢复保存的位置
    const savedLeft = localStorage.getItem('statusFloatingLeft');
    const savedTop = localStorage.getItem('statusFloatingTop');
    if (savedLeft) statusBoxInit.style.left = savedLeft;
    if (savedTop) statusBoxInit.style.top = savedTop;
    // 🆕 添加小圆球内的卡片名称显示元素
    const nameSpan = document.createElement('span');
    nameSpan.className = 'collapsed-card-name';
    nameSpan.id = 'collapsedCardName';
    statusBoxInit.appendChild(nameSpan);
  }

  // 浮动状态窗：点击切换展开/折叠 + 折叠态拖拽
  const statusBoxInline = document.getElementById('statusBoxInline');
  if (statusBoxInline) {
    let dragState = null;

    statusBoxInline.addEventListener('mousedown', function(e) {
      if (!this.classList.contains('collapsed')) return;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: this.offsetLeft,
        origTop: this.offsetTop,
        moved: false
      };
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragState.moved = true;
        const box = document.getElementById('statusBoxInline');
        if (box) {
          let newLeft = Math.max(0, Math.min(window.innerWidth - 28, dragState.origLeft + dx));
          let newTop = Math.max(0, Math.min(window.innerHeight - 28, dragState.origTop + dy));
          box.style.left = newLeft + 'px';
          box.style.top = newTop + 'px';
        }
      }
    });

    document.addEventListener('mouseup', function(e) {
      if (!dragState) return;
      const box = document.getElementById('statusBoxInline');
      if (dragState.moved && box) {
        localStorage.setItem('statusFloatingLeft', box.style.left);
        localStorage.setItem('statusFloatingTop', box.style.top);
        box._suppressClick = true;
      }
      dragState = null;
    });

    statusBoxInline.addEventListener('click', function(e) {
      e.stopPropagation();
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }
      if (this.classList.contains('collapsed')) {
        this.classList.remove('collapsed');
        this.classList.add('expanded');
        this.style.width = localStorage.getItem('statusFloatingWidth') || 'calc(100vw / 3)';
        // 如果内容为空（初始状态），填充通用页签
        const msgText = this.querySelector('.status-msg-text');
        if (!msgText || !this.querySelector('.status-tabs')) {
          this.innerHTML = buildDefaultGeneralContent();
        }
        // 如果没有活跃卡片，切换到通用页签
        const hasCard = this.querySelector('.status-tab-card') && this.querySelector('.status-tab-card').innerHTML.trim();
        if (!hasCard || currentActiveCardIndex < 0) {
          switchStatusTab('general');
        }
        // 从小圆圈位置展开，但确保不超出视窗边界
        const dotLeft = this.offsetLeft;
        const dotTop = this.offsetTop;
        const dotW = 28, dotH = 28;
        const boxW = parseInt(this.style.width) || (window.innerWidth / 3);
        // 预估展开高度（最多视窗高度的 80%）
        const maxBoxH = window.innerHeight * 0.8;
        let newLeft = dotLeft;
        let newTop = dotTop;
        // 右边界超出则向左展开
        if (newLeft + boxW > window.innerWidth - 8) {
          newLeft = Math.max(8, window.innerWidth - boxW - 8);
        }
        // 下边界超出则向上展开
        if (newTop + maxBoxH > window.innerHeight - 8) {
          newTop = Math.max(8, window.innerHeight - maxBoxH - 8);
        }
        this.style.left = newLeft + 'px';
        this.style.top = newTop + 'px';
        if (this._collapseTimer) clearTimeout(this._collapseTimer);
        // 自动聚焦到输入区
        setTimeout(() => {
          const generalTab = this.querySelector('.status-tab-general');
          const cardTab = this.querySelector('.status-tab-card');
          if (generalTab && generalTab.style.display !== 'none') {
            const ta = document.getElementById('mini_general_msg');
            if (ta) ta.focus();
          } else if (cardTab) {
            const ta = document.getElementById(`mini_msg_${currentActiveCardIndex}`);
            if (ta) ta.focus();
          }
        }, 100);
      } else if (this.classList.contains('msg-only')) {
        // 点击系统消息提示，切换到完整模式（用户接管）
        this.classList.remove('msg-only');
        this.classList.add('expanded');
        const savedWidth = localStorage.getItem('statusFloatingWidth');
        this.style.width = savedWidth ? savedWidth + 'px' : 'calc(100vw / 3)';
        this._userInteracted = true;
        if (this._collapseTimer) {
          clearTimeout(this._collapseTimer);
          this._collapseTimer = null;
        }
      } else {
        this.classList.remove('expanded');
        this.classList.add('collapsed');
        this._userInteracted = false;
        const savedLeft = localStorage.getItem('statusFloatingLeft');
        const savedTop = localStorage.getItem('statusFloatingTop');
        if (savedLeft) this.style.left = savedLeft;
        if (savedTop) this.style.top = savedTop;
        // 🆕 更新小圆球内的卡片名称显示
        updateCollapsedCardName();
      }
    });

    // 快捷键 Shift+Command+F / Shift+Command+G 已改为全局快捷键（在 main.js 中注册）
    // 这里不再处理 DOM keydown，避免重复触发
    // 全局快捷键通过 IPC 事件 toggle-floating-window 和 toggle-floating-window-general 触发
  }

  // 🆕 监听全局快捷键（主进程 before-input-event 触发）
  // 即使焦点在 webview 内也能响应 Shift+Command+F
  if (window.electronAPI && window.electronAPI.onToggleFloatingWindow) {
    window.electronAPI.onToggleFloatingWindow(function() {
      const box = document.getElementById('statusBoxInline');
      if (!box) return;

      console.log('[GlobalShortcut] 收到 toggle-floating-window 事件');

      if (box.classList.contains('collapsed')) {
        // 展开
        box.classList.remove('collapsed');
        box.classList.add('expanded');
        box.style.width = localStorage.getItem('statusFloatingWidth') || 'calc(100vw / 3)';
        // 如果内容为空（初始状态），填充通用页签
        const msgText = box.querySelector('.status-msg-text');
        if (!msgText || !box.querySelector('.status-tabs')) {
          box.innerHTML = buildDefaultGeneralContent();
        }
        // 如果没有活跃卡片，切换到通用页签
        const hasCard = box.querySelector('.status-tab-card') && box.querySelector('.status-tab-card').innerHTML.trim();
        if (!hasCard || currentActiveCardIndex < 0) {
          switchStatusTab('general');
        }
        // 从当前位置展开
        const dotLeft = box.offsetLeft;
        const dotTop = box.offsetTop;
        const boxW = parseInt(box.style.width) || (window.innerWidth / 3);
        const maxBoxH = window.innerHeight * 0.8;
        let newLeft = dotLeft;
        let newTop = dotTop;
        if (newLeft + boxW > window.innerWidth - 8) {
          newLeft = Math.max(8, window.innerWidth - boxW - 8);
        }
        if (newTop + maxBoxH > window.innerHeight - 8) {
          newTop = Math.max(8, window.innerHeight - maxBoxH - 8);
        }
        box.style.left = newLeft + 'px';
        box.style.top = newTop + 'px';
        if (box._collapseTimer) clearTimeout(box._collapseTimer);
        // 标记为用户主动打开，系统不会自动关闭
        box._userInteracted = true;
        // 自动聚焦到输入区
        setTimeout(() => {
          const generalTab = box.querySelector('.status-tab-general');
          const cardTab = box.querySelector('.status-tab-card');
          if (generalTab && generalTab.style.display !== 'none') {
            const ta = document.getElementById('mini_general_msg');
            if (ta) ta.focus();
          } else if (cardTab) {
            const ta = document.getElementById(`mini_msg_${currentActiveCardIndex}`);
            if (ta) ta.focus();
          }
        }, 100);
      } else {
        // 如果是 msg-only 状态，先切换到 expanded 再折叠
        if (box.classList.contains('msg-only')) {
          box.classList.remove('msg-only');
          box.classList.add('expanded');
        }
        // 折叠
        box.classList.remove('expanded');
        box.classList.add('collapsed');
        box._userInteracted = false;
        const savedLeft = localStorage.getItem('statusFloatingLeft');
        const savedTop = localStorage.getItem('statusFloatingTop');
        if (savedLeft) box.style.left = savedLeft;
        if (savedTop) box.style.top = savedTop;
        // 🆕 更新小圆球内的卡片名称显示
        updateCollapsedCardName();
      }
    });
    console.log('[GlobalShortcut] 已注册 IPC 监听器: toggle-floating-window');
  }

  // 🆕 Shift+Command+G → 展开浮动视窗并切换到通用页签（独立注册，不嵌套在 F 的 if 块内）
  if (window.electronAPI && window.electronAPI.onToggleFloatingWindowGeneral) {
    window.electronAPI.onToggleFloatingWindowGeneral(function() {
      const box = document.getElementById('statusBoxInline');
      if (!box) return;

      console.log('[GlobalShortcut] 收到 toggle-floating-window-general 事件');

      if (box.classList.contains('collapsed')) {
        // 展开
        box.classList.remove('collapsed');
        box.classList.add('expanded');
        box.style.width = localStorage.getItem('statusFloatingWidth') || 'calc(100vw / 3)';
        const msgText = box.querySelector('.status-msg-text');
        if (!msgText || !box.querySelector('.status-tabs')) {
          box.innerHTML = buildDefaultGeneralContent();
        }
        // 强制切换到通用页签
        switchStatusTab('general');
        // 从当前位置展开
        const dotLeft = box.offsetLeft;
        const dotTop = box.offsetTop;
        const boxW = parseInt(box.style.width) || (window.innerWidth / 3);
        const maxBoxH = window.innerHeight * 0.8;
        let newLeft = dotLeft;
        let newTop = dotTop;
        if (newLeft + boxW > window.innerWidth - 8) {
          newLeft = Math.max(8, window.innerWidth - boxW - 8);
        }
        if (newTop + maxBoxH > window.innerHeight - 8) {
          newTop = Math.max(8, window.innerHeight - maxBoxH - 8);
        }
        box.style.left = newLeft + 'px';
        box.style.top = newTop + 'px';
        if (box._collapseTimer) clearTimeout(box._collapseTimer);
        // 标记为用户主动打开，系统不会自动关闭
        box._userInteracted = true;
        // 聚焦通用输入区
        setTimeout(() => {
          const ta = document.getElementById('mini_general_msg');
          if (ta) ta.focus();
        }, 100);
      } else {
        // 如果是 msg-only 状态，先切换到 expanded 再折叠
        if (box.classList.contains('msg-only')) {
          box.classList.remove('msg-only');
          box.classList.add('expanded');
        }
        // 已展开状态：折叠
        box.classList.remove('expanded');
        box.classList.add('collapsed');
        box._userInteracted = false;
        const savedLeft = localStorage.getItem('statusFloatingLeft');
        const savedTop = localStorage.getItem('statusFloatingTop');
        if (savedLeft) box.style.left = savedLeft;
        if (savedTop) box.style.top = savedTop;
        updateCollapsedCardName();
      }
    });
    console.log('[GlobalShortcut] 已注册 IPC 监听器: toggle-floating-window-general');
  }
});

// 从文件系统加载网点（通过 IPC）
async function loadBookmarks() {
  // 先初始化为空数组（安全默认值）
  bookmarks = [];
  collapsedStatesCache = {};

  try {
    const data = await window.electronAPI.loadBookmarks();
    if (data && Array.isArray(data)) {
      bookmarks = data;
      console.log('[Renderer] ✅ 已加载', bookmarks.length, '个网点');
    }
  } catch (error) {
    console.error('[Renderer] 加载网点失败:', error);
  }

  // 尝试加载卡片折叠状态（失败不影响主功能）
  try {
    if (window.electronAPI && window.electronAPI.loadCollapsedStates) {
      collapsedStatesCache = await window.electronAPI.loadCollapsedStates();
      console.log('[Renderer] ✅ 已从文件加载折叠状态:', Object.keys(collapsedStatesCache).length, '个记录');
    }
  } catch (error) {
    console.warn('[Renderer] 加载折叠状态失败（使用默认值）:', error.message);
    collapsedStatesCache = {};
  }

  // 尝试加载自定义 headers map（失败不影响主功能）
  try {
    if (window.electronAPI && window.electronAPI.loadHeadersMap) {
      const loadedHeadersMap = await window.electronAPI.loadHeadersMap();
      if (loadedHeadersMap && Object.keys(loadedHeadersMap).length > 0) {
        bookmarkHeadersMap = loadedHeadersMap;
        console.log('[Renderer] ✅ 已从文件加载 Headers Map:', Object.keys(bookmarkHeadersMap).length, '个记录');
      }
    }
  } catch (error) {
    console.warn('[Renderer] 加载 Headers Map 失败（使用默认值）:', error.message);
    bookmarkHeadersMap = {};
  }

  // 渲染网点卡片
  renderBookmarks();

  // 恢复区块折叠状态
  try {
    const savedVisible = loadBookmarksSectionState();
    bookmarksVisible = savedVisible;

    const section = document.getElementById('bookmarksSection');
    const container = document.getElementById('bookmarksContainer');

    if (section && container) {
      if (!savedVisible) {
        container.style.display = 'none';
        section.classList.add('collapsed');
        console.log('[Renderer] ✅ 已恢复区块状态: 折叠');
      } else {
        container.style.display = 'grid';
        section.classList.remove('collapsed');
        console.log('[Renderer] ✅ 已恢复区块状态: 展开');
      }
    }

    const collapsedCount = Object.values(collapsedStatesCache).filter(v => v === true).length;
    console.log(`[Renderer] ✅ 当前有 ${collapsedCount}/${bookmarks.length} 个卡片处于折叠状态`);
  } catch (error) {
    console.error('[Renderer] 恢复区块状态失败:', error);
  }
}

// 更新书签模态框的显示/隐藏
function updateBookmarkModalVisibility(cardType) {
  const urlSection = document.getElementById('urlSectionContainer');
  const desktopAppSection = document.getElementById('desktopAppSectionContainer');
  const llmApiSection = document.getElementById('llmApiSectionContainer');
  const externalBrowserContainer = document.getElementById('externalBrowserContainer');
  const presetMessageContainer = document.getElementById('presetMessageContainer');
  const customSelectorContainer = document.getElementById('customSelectorContainer');
  const heartbeatSelectorContainer = document.getElementById('heartbeatSelectorContainer');
  const monitorTimeoutContainer = document.getElementById('monitorTimeoutContainer');
  const autoMonitorContainer = document.getElementById('autoMonitorContainer');
  
  if (cardType === 'desktop-app') {
    if (urlSection) urlSection.style.display = 'none';
    if (desktopAppSection) desktopAppSection.style.display = 'block';
    if (llmApiSection) llmApiSection.style.display = 'none';
    if (externalBrowserContainer) externalBrowserContainer.style.display = 'none';
    if (customSelectorContainer) customSelectorContainer.style.display = 'none';
    if (heartbeatSelectorContainer) heartbeatSelectorContainer.style.display = 'none';
    if (monitorTimeoutContainer) monitorTimeoutContainer.style.display = 'none';
    if (autoMonitorContainer) autoMonitorContainer.style.display = 'none';
  } else if (cardType === 'llm-api') {
    // 大模型 API 类型：显示 LLM 配置区域，隐藏 URL 和其他网页相关设置
    if (urlSection) urlSection.style.display = 'none';
    if (desktopAppSection) desktopAppSection.style.display = 'none';
    if (llmApiSection) llmApiSection.style.display = 'block';
    if (externalBrowserContainer) externalBrowserContainer.style.display = 'none';
    if (presetMessageContainer) presetMessageContainer.style.display = 'none';
    if (customSelectorContainer) customSelectorContainer.style.display = 'none';
    if (heartbeatSelectorContainer) heartbeatSelectorContainer.style.display = 'none';
    if (monitorTimeoutContainer) monitorTimeoutContainer.style.display = 'none';
    if (autoMonitorContainer) autoMonitorContainer.style.display = 'none';
  } else {
    if (urlSection) urlSection.style.display = 'block';
    if (desktopAppSection) desktopAppSection.style.display = 'none';
    // 网页模式下，其他选项由 previewOnly 控制
    const previewOnly = document.getElementById('bookmarkPreviewOnly')?.checked;
    if (externalBrowserContainer) externalBrowserContainer.style.display = previewOnly ? 'block' : 'none';
    if (presetMessageContainer) presetMessageContainer.style.display = previewOnly ? 'block' : 'none';
    if (customSelectorContainer) customSelectorContainer.style.display = previewOnly ? 'block' : 'none';
    if (heartbeatSelectorContainer) heartbeatSelectorContainer.style.display = previewOnly ? 'block' : 'none';
    if (monitorTimeoutContainer) monitorTimeoutContainer.style.display = previewOnly ? 'block' : 'none';
    if (autoMonitorContainer) autoMonitorContainer.style.display = previewOnly ? 'block' : 'none';
  }
}

// 网点卡片背景色选择
let selectedBookmarkColor = '';

function selectBookmarkColor(el, color) {
  selectedBookmarkColor = color;
  document.querySelectorAll('.bookmark-color-swatch').forEach(s => {
    s.style.borderColor = '#e2e8f0';
    s.style.boxShadow = 'none';
    s.textContent = '';
  });
  el.style.borderColor = '#667eea';
  el.style.boxShadow = '0 0 0 2px rgba(102,126,234,0.3)';
  if (!color) el.textContent = '✓';
}

// 获取当前选中的网点卡片背景色
function getSelectedBookmarkColor() {
  return selectedBookmarkColor;
}

// 设置网点卡片背景色选择器
function setBookmarkColorPicker(color) {
  selectedBookmarkColor = color;
  const swatches = document.querySelectorAll('.bookmark-color-swatch');
  swatches.forEach(s => {
    s.style.borderColor = '#e2e8f0';
    s.style.boxShadow = 'none';
    s.textContent = '';
  });
  let target = null;
  if (color) {
    for (const s of swatches) {
      if (s.getAttribute('data-color') === color) { target = s; break; }
    }
  }
  if (!target) target = swatches[0];
  if (target) {
    target.style.borderColor = '#667eea';
    target.style.boxShadow = '0 0 0 2px rgba(102,126,234,0.3)';
    if (!color) target.textContent = '✓';
  }
}

// 测试 APP 名称是否正确
async function testAppName() {
  const appName = document.getElementById('bookmarkAppName')?.value?.trim();
  const resultEl = document.getElementById('appNameTestResult');
  
  if (!appName) {
    if (resultEl) {
      resultEl.textContent = '⚠️ 请先输入 APP 名称';
      resultEl.style.color = '#f59e0b';
    }
    return;
  }
  
  if (resultEl) {
    resultEl.textContent = '⏳ 正在测试...';
    resultEl.style.color = '#6b7280';
  }
  
  try {
    const result = await window.electronAPI.desktopAppCheckExists(appName);
    console.log('[Renderer] APP 测试结果:', result);
    
    if (result.exists) {
      if (resultEl) {
        resultEl.textContent = `✅ APP「${appName}」存在，可以正常使用`;
        resultEl.style.color = '#10b981';
      }
    } else {
      if (resultEl) {
        resultEl.textContent = `❌ 找不到 APP「${appName}」，请检查名称是否正确`;
        resultEl.style.color = '#ef4444';
      }
    }
  } catch (err) {
    console.error('[Renderer] 测试 APP 失败:', err);
    if (resultEl) {
      resultEl.textContent = `❌ 测试失败: ${err.message}`;
      resultEl.style.color = '#ef4444';
    }
  }
}

// 获取附件数组（兼容旧数据格式）
function getAttachmentsArray(index) {
  if (index < 0 || index >= bookmarks.length) return [];

  const bookmark = bookmarks[index];

  // 新格式：attachments 数组
  if (Array.isArray(bookmark.attachments)) {
    return bookmark.attachments;
  }

  // 旧格式：单个 attachment 对象，转换为数组
  if (bookmark.attachment) {
    return [bookmark.attachment];
  }

  return [];
}

// 处理拖拽离开事件
function handleDragLeave(event, index) {
  event.preventDefault();
  event.stopPropagation();
  const dropZone = document.getElementById(`dropZone_${index}`);
  if (dropZone) {
    dropZone.style.borderColor = '#e2e8f0';
    dropZone.style.background = '#faf5ff';
  }
}

// 使用网点进行爬取（通过索引）
async function crawlBookmarkByIndex(index) {
  if (index < 0 || index >= bookmarks.length) {
    console.error('[Renderer] 无效的网点索引:', index);
    showStatus('❌ 网点数据错误', 'error');
    return;
  }
  
  const bookmark = bookmarks[index];
  
  // 🔑 先读取正规卡片的当前值，防止被迷你卡片覆盖
  const regularTextarea = document.getElementById(`presetMsg_${index}`);
  const currentRegularValue = regularTextarea ? regularTextarea.value : (bookmark.presetMessage || '');
  
  setCurrentActiveCard(index);
  
  // 🔑 同步迷你卡片的讯息到正规卡片（但只在正规卡片为空时）
  const miniTextarea = document.getElementById(`mini_msg_${index}`);
  if (miniTextarea && miniTextarea.value && !currentRegularValue) {
    syncMiniToRegular(index);
  }
  
  const cardType = bookmark.type || 'webview';
  
  // 🔑 桌面APP类型：使用脚本+讯息池方式发送消息到APP
  if (cardType === 'desktop-app') {
    console.log('[Renderer] 🖥️ 桌面APP类型，使用脚本+讯息池方式发送');
    
    let presetMessage = bookmarks[index].presetMessage || '';
    const presetMessageInput = document.getElementById(`presetMsg_${index}`);
    if (presetMessageInput && presetMessageInput.value.trim()) {
      presetMessage = presetMessageInput.value.trim();
    }
    const attachments = getAttachmentsArray(index);
    
    if (!presetMessage && attachments.length === 0) {
      showStatus('⚠️ 请先输入消息或添加附件', 'warning');
      return;
    }
    
    const appName = bookmark.appName || bookmark.name;
    
    // 🔑 桌面APP工作区强制使用页签模式（全屏显示对话历史）
    const wasExpandView = expandViewEnabled;
    if (wasExpandView) {
      expandViewEnabled = false;
    }

    // 🔑 先创建工作区（但不显示聊天面板）
    const targetWorkspaceId = findOrCreateWorkspaceForAI(bookmark);
    const targetWs = workspaces[targetWorkspaceId];
    if (targetWs) {
      targetWs.bookmarkIndex = index;
      targetWs.title = bookmark.name;
    }

    // 🔑 切换到对应工作区（让面板可见）
    if (targetWorkspaceId !== currentWorkspaceId) {
      switchWorkspaceWithoutRestore(targetWorkspaceId);
    }

    // 🔑 面板可见后再创建聊天面板（避免 height: 100% 解析为 0）
    setTimeout(() => {
      showDesktopAppChatPanel(targetWorkspaceId, bookmark);
    }, 100);

    try {
      showStatus(`📨 正在发送到「${bookmark.name}」APP...`, 'info', index);
      
      let result = null;
      const scripts = initScriptsForCard(index);
      const floatSendScript = scripts.find(s => s.trigger === 'floatSend');

      if (floatSendScript) {
        console.log(`[Renderer] 🖥️ 检测到浮动视窗发送触发器脚本: ${floatSendScript.name}`);
        
        const anchors = bookmark.anchors || [];
        const windowSettings = bookmark.window || { width: 950, height: 920, x: 0, y: 0 };
        
        const messages = [];
        if (presetMessage) {
          messages.push(presetMessage);
        }
        
        for (const att of attachments) {
          if (att.path) {
            messages.push(`[文件] ${att.path}`);
          }
        }
        
        const modifiedSteps = JSON.parse(JSON.stringify(floatSendScript.steps));
        let msgIndex = 0;
        let removeIndices = [];
        
        // 补充设置步骤的 isCopyButton 属性：根据定位点的 isCopyButton 属性
        // 确保即使步骤本身没有 isCopyButton 属性，也能根据定位点正确识别复制按钮步骤
        for (const step of modifiedSteps) {
          if (step.anchorId && step.anchorId > 0 && !step.isCopyButton) {
            const anchor = anchors.find(a => a.id === step.anchorId);
            if (anchor && anchor.isCopyButton) {
              step.isCopyButton = true;
            }
          }
        }
        console.log(`[Renderer] 🖥️ 📋 复制按钮步骤数: ${modifiedSteps.filter(s => s.isCopyButton).length}/${modifiedSteps.length}`);
        
        for (let i = 0; i < modifiedSteps.length; i++) {
          const step = modifiedSteps[i];
          if (step.action === 'keystroke' && step.modifiers && step.modifiers.includes('cmd') && step.key === 'v') {
            if (msgIndex < messages.length) {
              step.pasteContent = messages[msgIndex];
              msgIndex++;
            } else {
              removeIndices.push(i);
            }
          }
        }
        
        for (let i = removeIndices.length - 1; i >= 0; i--) {
          modifiedSteps.splice(removeIndices[i], 1);
        }
        
        console.log(`[Renderer] 🖥️ 📋 已配对 ${msgIndex} 条消息到 Cmd+V 步骤，${removeIndices.length} 个多余的 Cmd+V 已移除`);
        
        result = await window.electronAPI.desktopAppRunScript({
          appName: appName,
          anchors: anchors,
          window: windowSettings,
          steps: modifiedSteps
        });

        if (result && result.success) {
          showStatus(`✅ 脚本执行完成: ${floatSendScript.name}`, 'success');
          const answer = result.clipboardContent || result.answer || '(无回答)';
          appendChatMessage(targetWorkspaceId, bookmark, presetMessage, answer, attachments);
          sendEmailAfterReply(bookmark.name, presetMessage, answer);
        } else {
          showStatus(`❌ 脚本执行失败: ${result.error || '未知错误'}`, 'error');
        }
        
        await window.electronAPI.activateMainWindow();
        // 🔑 恢复原来的展开模式
        if (wasExpandView) {
          toggleExpandView();
          // 🔑 确保目标工作区面板可见
          setTimeout(() => {
            const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
            if (targetPanel) {
              targetPanel.style.display = 'block';
              targetPanel.classList.add('active-ws');
            }
          }, 50);
        }
      } else {
        console.log('[Renderer] 🖥️ 未检测到发送触发器脚本，使用默认发送方式');
        result = await desktopAppAutoSend(appName, presetMessage, {
          method: bookmark.sendMethod || 'clipboard',
          activateDelay: bookmark.activateDelay || 500,
          waitAnswerDelay: bookmark.waitAnswerDelay || 15000,
          copyXRatio: bookmark.copyBtnRatio ? bookmark.copyBtnRatio.x : undefined,
          copyYRatio: bookmark.copyBtnRatio ? bookmark.copyBtnRatio.y : undefined,
          mdXRatio: bookmark.mdBtnRatio ? bookmark.mdBtnRatio.x : undefined,
          mdYRatio: bookmark.mdBtnRatio ? bookmark.mdBtnRatio.y : undefined,
          inputFocusXRatio: bookmark.inputFocusRatio ? bookmark.inputFocusRatio.x : undefined,
          inputFocusYRatio: bookmark.inputFocusRatio ? bookmark.inputFocusRatio.y : undefined,
          winWidth: (bookmark.appWindowSize && bookmark.appWindowSize.w) || 950,
          winHeight: (bookmark.appWindowSize && bookmark.appWindowSize.h) || 920,
          winX: (bookmark.appWindowPos && bookmark.appWindowPos.x) || 0,
          winY: (bookmark.appWindowPos && bookmark.appWindowPos.y) || 0
        });

        if (result && result.success) {
          showStatus(`✅ 已发送到「${bookmark.name}」APP`, 'success');
          appendChatMessage(targetWorkspaceId, bookmark, presetMessage, result.answer || '(无回答)');
          sendEmailAfterReply(bookmark.name, presetMessage, result.answer || '(无回答)');
        } else {
          showStatus(`❌ 发送失败: ${result.error || '未知错误'}`, 'error');
        }
        
        await window.electronAPI.activateMainWindow();
        // 🔑 恢复原来的展开模式
        if (wasExpandView) {
          toggleExpandView();
          // 🔑 确保目标工作区面板可见
          setTimeout(() => {
            const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
            if (targetPanel) {
              targetPanel.style.display = 'block';
              targetPanel.classList.add('active-ws');
            }
          }, 50);
        }
      }
    } catch (err) {
      console.error('[Renderer] ❌ 桌面APP发送异常:', err);
      showStatus(` 发送异常: ${err.message}`, 'error');
    }

    return;
  }

  //  大模型 API 类型：通过 API Key 直接调用大模型
  if (cardType === 'llm-api') {
    console.log('[Renderer] 🤖 大模型 API 类型，使用 API Key 调用');

    let prompt = bookmarks[index].presetMessage || '';
    const presetMessageInput = document.getElementById(`presetMsg_${index}`);
    if (presetMessageInput && presetMessageInput.value.trim()) {
      prompt = presetMessageInput.value.trim();
    }

    if (!prompt) {
      showStatus('⚠️ 请先输入提示词', 'warning');
      return;
    }

    const llmProvider = bookmark.llmProvider || 'tongyi';
    const llmModel = bookmark.llmModel || '';
    const llmApiKey = bookmark.llmApiKey || '';

    if (!llmApiKey || !llmModel) {
      showStatus('⚠️ 请先编辑网点，填写 API Key 和模型', 'warning');
      return;
    }

    // 工作区强制使用页签模式（全屏显示对话历史）
    const wasExpandView = expandViewEnabled;
    if (wasExpandView) {
      expandViewEnabled = false;
    }

    const targetWorkspaceId = findOrCreateWorkspaceForAI(bookmark);
    const targetWs = workspaces[targetWorkspaceId];
    if (targetWs) {
      targetWs.bookmarkIndex = index;
      targetWs.title = bookmark.name;
    }

    if (targetWorkspaceId !== currentWorkspaceId) {
      switchWorkspaceWithoutRestore(targetWorkspaceId);
    }

    // 确保目标工作区面板可见
    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
    if (targetPanel) {
      targetPanel.style.display = 'block';
      targetPanel.classList.add('active-ws');
    }

    // 创建聊天面板（类似 desktop-app 的处理方式）
    setTimeout(() => {
      showDesktopAppChatPanel(targetWorkspaceId, bookmark);
      if (wasExpandView) {
        toggleExpandView();
        setTimeout(() => {
          const tp = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
          if (tp) { tp.style.display = 'block'; tp.classList.add('active-ws'); }
        }, 50);
      }
    }, 100);

    try {
      showStatus(` 正在调用「${bookmark.name}」...`, 'info', index);

      const response = await fetch('http://localhost:3000/api/call-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmProvider,
          model: llmModel,
          apiKey: llmApiKey,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const result = await response.json();

      if (result.success) {
        const answer = result.data.content || '(无响应内容)';
        showStatus(`✅ 「${bookmark.name}」调用成功`, 'success', index);
        // 等待面板创建完成后再追加消息
        setTimeout(() => {
          appendChatMessage(targetWorkspaceId, bookmark, prompt, answer, []);
        }, 300);
        sendEmailAfterReply(bookmark.name, prompt, answer);
      } else {
        const errorMsg = result.error || '未知错误';
        showStatus(`❌ 「${bookmark.name}」调用失败: ${errorMsg}`, 'error', index);
        setTimeout(() => {
          appendChatMessage(targetWorkspaceId, bookmark, prompt, '❌ 错误: ' + errorMsg, []);
        }, 300);
      }
    } catch (err) {
      console.error('[Renderer]  大模型 API 调用异常:', err);
      showStatus(`❌ 「${bookmark.name}」调用异常: ${err.message}`, 'error', index);
      setTimeout(() => {
        appendChatMessage(targetWorkspaceId, bookmark, prompt, '❌ 异常: ' + err.message, []);
      }, 300);
    }

    return;
  }

  // 自动调度模式：执行前自动选择工作区
  await autoScheduleBeforeExecute(index);
  
  const url = bookmark.url;
  
  // 从全局映射中获取自定义 headers
  const headersKey = `bookmark_${index}`;
  const customHeaders = bookmarkHeadersMap[headersKey] || null;
  
  console.log(`[Renderer] 点击爬取按钮: ${bookmark.name}`, customHeaders ? '(有自定义 headers)' : '');
  console.log(`[Renderer]  书签对象:`, bookmark);
  console.log(`[Renderer]  书签 attachment:`, bookmark.attachment);
  
  // 如果是只预览模式
  if (bookmark.previewOnly) {
    
    // 🆕 如果启用了外部浏览器模式，使用完整浏览器窗口打开
    if (bookmark.externalBrowser) {
      console.log('[Renderer] 🔓 检测到外部浏览器模式，使用 BrowserWindow 打开');
      showStatus('🔓 正在外部浏览器中打开...', 'info', index);

      try {
        // 调用主进程打开外部浏览器窗口
        const result = await window.electronAPI.openExternalBrowser(url);

        if (result.success) {
          showStatus(`✅ 已在外部浏览器中打开：${bookmark.name}`, 'success', index);
        } else {
          // 如果失败，回退到系统默认浏览器
          console.warn('[Renderer] ⚠️ 外部浏览器打开失败，尝试使用系统默认浏览器');
          await window.electronAPI.openExternal(url);
          showStatus(`✅ 已在系统默认浏览器中打开：${bookmark.name}`, 'success', index);
        }
      } catch (error) {
        console.error('[Renderer] ❌ 打开外部浏览器失败:', error);
        showStatus('❌ 打开失败：' + error.message, 'error', index);
      }
      
      return; // 直接返回，不执行后续的 webview 预览逻辑
    }
    
    console.log('[Renderer] ✅ 只预览模式，不会执行爬取操作');
    console.log('[Renderer] ✅ 直接在网页预览页签中显示网页');
    document.getElementById('urlInput').value = url;
    
    //  v1.0.0-45: 通知主进程记录当前服务卡片
    try {
      await window.electronAPI.setCurrentServiceCard(index);
      console.log('[Renderer] ✅ 已通知主进程记录当前服务卡片: [' + index + '] ' + bookmark.name);
    } catch (e) {
      console.warn('[Renderer] ⚠️ 通知主进程记录服务卡片失败:', e.message);
    }
    
    // 设置自定义 headers（如果需要）
    if (customHeaders) {
      window.currentCustomHeaders = customHeaders;
    } else {
      window.currentCustomHeaders = null;
    }
    
    // 设置 crawledData 的 URL 让 renderWebPreview 能获取到
    window.currentPreviewUrl = url;
    
    // 从输入框读取预设消息
    const textareaEl = document.getElementById(`presetMsg_${index}`);
    const currentPresetMessage = textareaEl ? textareaEl.value : (bookmark.presetMessage || '');
    
    // 存储预设消息和附件供 webview 使用
    window.currentPresetMessage = currentPresetMessage;
    window.currentPresetAttachments = getAttachmentsArray(index); // 使用新的数组格式
    window.currentBookmarkIndex = index;
    window.currentReplySelector = bookmark.replySelector || '';
    window.__monitorHeartbeatSelector = bookmark.heartbeatSelector || '';
    window.__monitorReplySelector = bookmark.replySelector || '';
    window.__monitorTimeout = bookmark.monitorTimeout || 0;

    console.log('[Renderer] 📋 当前书签配置:', {
      index,
      replySelector: bookmark.replySelector,
      heartbeatSelector: bookmark.heartbeatSelector,
      monitorTimeout: bookmark.monitorTimeout
    });

    console.log('[Renderer] 📋 书签点击时设置的预设内容:');
    console.log('[Renderer]   - 消息:', currentPresetMessage ? `"${currentPresetMessage.substring(0, 50)}${currentPresetMessage.length > 50 ? '...' : ''}"` : '(空)');
    console.log('[Renderer]   - 附件数量:', window.currentPresetAttachments.length);
    window.currentPresetAttachments.forEach((att, i) => {
      console.log(`[Renderer]     [${i}] 📎 ${att.name} (${att.size} bytes)`);
    });
    
    document.getElementById('dataSection').style.display = 'block';
    const es = document.getElementById('emptyState');
    if (es) es.style.display = 'none';

    // 更新当前工作区状态为运行中
    updateWorkspaceStatus(currentWorkspaceId, 'running');
    workspaces[currentWorkspaceId].bookmarkIndex = index;
    workspaces[currentWorkspaceId].title = bookmark.name;
    // 保存选择器设定到工作区对象，切换工作区时可恢复
    workspaces[currentWorkspaceId].replySelector = bookmark.replySelector || '';
    workspaces[currentWorkspaceId].heartbeatSelector = bookmark.heartbeatSelector || '';
    workspaces[currentWorkspaceId].monitorTimeout = bookmark.monitorTimeout || 0;
    // 更新页签上显示的网点名称
    updateWorkspaceTabName(currentWorkspaceId, bookmark.name);
    // 保存 URL 到工作区对象，供 renderWebPreview 使用
    workspaces[currentWorkspaceId].wsUrl = url;
    
    // 🔑 清理之前可能存在的桌面APP对话面板，确保显示网页预览
    const panel = document.querySelector(`.workspace-panel[data-ws="${currentWorkspaceId}"]`);
    if (panel) {
      const chatPanel = panel.querySelector('.desktop-app-chat-panel');
      if (chatPanel) {
        chatPanel.remove();
        console.log(`[Renderer] ✅ 已移除桌面APP对话面板`);
      }
      // 确保 webview 容器可见
      const webviewContainer = panel.querySelector('.webview-container');
      if (webviewContainer) webviewContainer.style.display = 'block';
      // 确保展开模式的 header 和 body 可见
      const wsExpandHeader = panel.querySelector('.ws-expand-header');
      if (wsExpandHeader) wsExpandHeader.style.display = '';
      const wsExpandBody = panel.querySelector('.ws-expand-body');
      if (wsExpandBody) wsExpandBody.style.display = '';
    }
    
    const allTabs = document.querySelectorAll('.tab');
    allTabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === 'webpreview') {
        tab.style.display = '';
        tab.classList.add('active');
      } else {
        tab.style.display = 'none';
      }
    });
    
    currentTab = 'webpreview';
    renderData('webpreview');
    
    showStatus(`🌐 已在 [${currentWorkspaceId}] 工作区中打开：${bookmark.name}${currentPresetMessage ? ' (含预设消息)' : ''}`, 'success', index);
    return;
  }
  
  // 调用原始的 crawlBookmark 函数
  crawlBookmark(url, customHeaders);
}

// 🔓 纯开启网页（不发送任何消息，不加载附件）
// ========== 新增：继续对话功能（简化版） ==========
async function continueConversation(index) {
  console.log('[Renderer] 💬 ========== [第N次点击] 开始执行 ==========');
  console.log('[Renderer] 💬 时间:', new Date().toLocaleTimeString());
  console.log('[Renderer] 💬 参数 index:', index);
  console.log('[Renderer] 💬 ===== 全局状态快照 =====');
  console.log('[Renderer] 💬   window._monitorWebview 类型:', typeof window._monitorWebview);
  console.log('[Renderer] 💬   window._monitorWebview 值:', window._monitorWebview);

  if (index < 0 || index >= bookmarks.length) {
    console.error('[Renderer] 💬 ❌ 无效索引');
    showStatus('❌ 网点数据错误', 'error');
    return;
  }

  const bookmark = bookmarks[index];
  console.log('[Renderer] 💬 书签:', bookmark.name);
  
  // 🔑 先判断卡片类型：桌面APP走 AppleScript 自动化（放在最前面，避免不必要的工作区操作）
  const cardType = bookmark.type || 'webview';
  console.log('[Renderer] 💬 卡片类型:', cardType);
  
  if (cardType === 'desktop-app') {
    console.log('[Renderer] 💬 🖥️ 检测到桌面APP类型，使用 AppleScript 自动化发送');
    
    // 读取当前卡片的预设消息和附件
    let presetMessage = bookmarks[index].presetMessage || '';
    const presetMessageInput = document.getElementById(`presetMsg_${index}`);
    if (presetMessageInput && presetMessageInput.value.trim()) {
      presetMessage = presetMessageInput.value.trim();
    }
    const attachments = getAttachmentsArray(index);
    
    console.log('[Renderer] 💬   - APP名称:', bookmark.appName || bookmark.name);
    console.log('[Renderer] 💬   - 消息:', presetMessage || '(空)');
    console.log('[Renderer] 💬   - 附件数:', attachments.length);
    
    if (!presetMessage && attachments.length === 0) {
      showStatus('⚠️ 请先输入消息或添加附件', 'warning');
      return;
    }
    
    //  先显示对话面板（即使还没发送，也让用户看到工作区卡片）
    const targetWorkspaceId = findOrCreateWorkspaceForAI(bookmark);
    const targetWs = workspaces[targetWorkspaceId];
    if (targetWs) {
      targetWs.bookmarkIndex = index;
      targetWs.title = bookmark.name;
    }
    // 🔑 桌面APP工作区强制使用页签模式（全屏显示对话历史）
    const wasExpandView2 = expandViewEnabled;
    if (wasExpandView2) {
      expandViewEnabled = false;
    }

    // 🔑 先切换到对应工作区（让面板可见），再显示聊天面板
    if (targetWorkspaceId !== currentWorkspaceId) {
      switchWorkspaceWithoutRestore(targetWorkspaceId);
    }

    // 🔑 面板可见后再创建聊天面板（避免面板被隐藏时创建导致不显示）
    setTimeout(() => {
      showDesktopAppChatPanel(targetWorkspaceId, bookmark);
    }, 100);

    try {
      showStatus(`📨 正在发送到「${bookmark.name}」APP...`, 'info', index);

      let result = null;
      const scripts = initScriptsForCard(index);
      const floatSendScript = scripts.find(s => s.trigger === 'floatSend');

      if (floatSendScript) {
        console.log(`[Renderer] 💬 🖥️ 检测到浮动视窗发送触发器脚本: ${floatSendScript.name}`);
        
        const anchors = bookmark.anchors || [];
        const windowSettings = bookmark.window || { width: 950, height: 920, x: 0, y: 0 };
        
        const messages = [];
        if (presetMessage) {
          messages.push(presetMessage);
        }
        
        for (const att of attachments) {
          if (att.path) {
            messages.push(`[文件] ${att.path}`);
          }
        }
        
        const modifiedSteps = JSON.parse(JSON.stringify(floatSendScript.steps));
        let msgIndex = 0;
        let removeIndices = [];
        
        for (let i = 0; i < modifiedSteps.length; i++) {
          const step = modifiedSteps[i];
          if (step.action === 'keystroke' && step.modifiers && step.modifiers.includes('cmd') && step.key === 'v') {
            if (msgIndex < messages.length) {
              step.pasteContent = messages[msgIndex];
              msgIndex++;
            } else {
              removeIndices.push(i);
            }
          }
        }
        
        for (let i = removeIndices.length - 1; i >= 0; i--) {
          modifiedSteps.splice(removeIndices[i], 1);
        }
        
        console.log(`[Renderer] 💬 📋 已配对 ${msgIndex} 条消息到 Cmd+V 步骤，${removeIndices.length} 个多余的 Cmd+V 已移除`);
        
        result = await window.electronAPI.desktopAppRunScript({
          appName: bookmark.appName || bookmark.name,
          anchors: anchors,
          window: windowSettings,
          steps: modifiedSteps
        });

        if (result && result.success) {
          showStatus(`✅ 浮动视窗触发器脚本执行完成: ${floatSendScript.name}`, 'success');
          const answer = result.clipboardContent || result.answer || '(无回答)';
          appendChatMessage(targetWorkspaceId, bookmark, presetMessage, answer, attachments);
          
          //  桌面APP模式：内容已通过脚本复制到剪贴板，无需监控网页内容稳定性，直接发送邮件
          const desktopEmailRecipients = floatEmailRecipients.trim() || String(window.scheduleEmailRecipientsValue || '').trim();
          if (desktopEmailRecipients) {
            setTimeout(async () => {
              const recipients = desktopEmailRecipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
              if (recipients.length === 0) return;

              try {
                const subject = `[AI回复] ${bookmark.name} - ${presetMessage.substring(0, 100)}`;
                const body = `【问题】\n${presetMessage}\n\n【AI回复】\n${answer}`;
                const statusMsg = `📧 正在发送邮件...`;
                showStatus(statusMsg, 'info', undefined, true);

                const emailResult = await sendEmailViaPlugin(recipients, subject, body);
                if (emailResult.success) {
                  const successMsg = `📧 邮件已通过插件发送给 ${recipients.join(', ')}`;
                  showStatus(successMsg, 'success', undefined, true);
                  addFloatHistoryEntry({ source: '系统', type: 'success', message: successMsg, recipients: recipients.join(', ') });
                } else {
                  const failMsg = `📧 邮件发送失败：${emailResult.message}`;
                  showStatus(failMsg, 'error', undefined, true);
                  addFloatHistoryEntry({ source: '系统', type: 'error', message: failMsg, recipients: recipients.join(', ') });
                }
              } catch (e) {
                const errorMsg = `📧 邮件发送失败：${e.message}`;
                showStatus(errorMsg, 'error', undefined, true);
                addFloatHistoryEntry({ source: '系统', type: 'error', message: errorMsg, recipients: recipients.join(', ') });
                console.error(`[Email] ❌ 邮件发送异常:`, e);
              }
            }, 2000);
          }
        } else {
          showStatus(`❌ 浮动视窗触发器脚本执行失败: ${result.error || '未知错误'}`, 'error');
        }
        
        await window.electronAPI.activateMainWindow();
        // 🔑 恢复原来的展开模式
        if (wasExpandView2) {
          toggleExpandView();
          // 🔑 确保目标工作区面板可见
          setTimeout(() => {
            const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
            if (targetPanel) {
              targetPanel.style.display = 'block';
              targetPanel.classList.add('active-ws');
            }
          }, 50);
        }
      } else {
        console.log('[Renderer] 💬 🖥️ 未检测到浮动视窗发送触发器脚本，使用默认发送方式');
        result = await desktopAppAutoSend(bookmark.appName || bookmark.name, presetMessage, {
          method: bookmark.sendMethod || 'clipboard',
          activateDelay: bookmark.activateDelay || 500,
          waitAnswerDelay: bookmark.waitAnswerDelay || 15000,
          copyXRatio: bookmark.copyBtnRatio ? bookmark.copyBtnRatio.x : undefined,
          copyYRatio: bookmark.copyBtnRatio ? bookmark.copyBtnRatio.y : undefined,
          mdXRatio: bookmark.mdBtnRatio ? bookmark.mdBtnRatio.x : undefined,
          mdYRatio: bookmark.mdBtnRatio ? bookmark.mdBtnRatio.y : undefined,
          inputFocusXRatio: bookmark.inputFocusRatio ? bookmark.inputFocusRatio.x : undefined,
          inputFocusYRatio: bookmark.inputFocusRatio ? bookmark.inputFocusRatio.y : undefined,
          winWidth: (bookmark.appWindowSize && bookmark.appWindowSize.w) || 950,
          winHeight: (bookmark.appWindowSize && bookmark.appWindowSize.h) || 920,
          winX: (bookmark.appWindowPos && bookmark.appWindowPos.x) || 0,
          winY: (bookmark.appWindowPos && bookmark.appWindowPos.y) || 0
        });

        if (result && result.success) {
          showStatus(`✅ 已发送到「${bookmark.name}」APP`, 'success');
          appendChatMessage(targetWorkspaceId, bookmark, presetMessage, result.answer || '(无回答)');
          sendEmailAfterReply(bookmark.name, presetMessage, result.answer || '(无回答)');
        } else {
          showStatus(`❌ 发送失败: ${result.error || '未知错误'}`, 'error');
        }
        
        await window.electronAPI.activateMainWindow();
        // 🔑 恢复原来的展开模式
        if (wasExpandView2) {
          toggleExpandView();
          // 🔑 确保目标工作区面板可见
          setTimeout(() => {
            const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
            if (targetPanel) {
              targetPanel.style.display = 'block';
              targetPanel.classList.add('active-ws');
            }
          }, 50);
        }
      }
    } catch (err) {
      console.error('[Renderer] 💬 ❌ 桌面APP发送异常:', err);
      showStatus(` 发送异常: ${err.message}`, 'error');
    }

    return;
  }

  // 🔑 大模型 API 类型：通过 API Key 直接调用大模型
  if (cardType === 'llm-api') {
    console.log('[Renderer] 💬 🤖 检测到大模型 API 类型，使用 API Key 调用');

    // 读取提示词（优先从卡片输入框获取）
    let prompt = bookmarks[index].presetMessage || '';
    const presetMessageInput = document.getElementById(`presetMsg_${index}`);
    if (presetMessageInput && presetMessageInput.value.trim()) {
      prompt = presetMessageInput.value.trim();
    }

    if (!prompt) {
      showStatus('⚠️ 请先输入提示词', 'warning');
      return;
    }

    const llmProvider = bookmark.llmProvider || 'tongyi';
    const llmModel = bookmark.llmModel || '';
    const llmApiKey = bookmark.llmApiKey || '';

    if (!llmApiKey || !llmModel) {
      showStatus('⚠️ 请先编辑网点，填写 API Key 和模型', 'warning');
      return;
    }

    // 工作区强制使用页签模式（全屏显示对话历史）
    const wasExpandView = expandViewEnabled;
    if (wasExpandView) {
      expandViewEnabled = false;
    }

    // 创建/切换工作区
    const targetWorkspaceId = findOrCreateWorkspaceForAI(bookmark);
    const targetWs = workspaces[targetWorkspaceId];
    if (targetWs) {
      targetWs.bookmarkIndex = index;
      targetWs.title = bookmark.name;
    }

    // 切换到目标工作区
    if (targetWorkspaceId !== currentWorkspaceId) {
      switchWorkspaceWithoutRestore(targetWorkspaceId);
    }

    // 确保目标工作区面板可见
    const targetPanel = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
    if (targetPanel) {
      targetPanel.style.display = 'block';
      targetPanel.classList.add('active-ws');
    }

    // 创建聊天面板
    setTimeout(() => {
      showDesktopAppChatPanel(targetWorkspaceId, bookmark);
      if (wasExpandView) {
        toggleExpandView();
        setTimeout(() => {
          const tp = document.querySelector(`.workspace-panel[data-ws="${targetWorkspaceId}"]`);
          if (tp) { tp.style.display = 'block'; tp.classList.add('active-ws'); }
        }, 50);
      }
    }, 100);

    try {
      showStatus(` 正在调用「${bookmark.name}」...`, 'info', index);

      const response = await fetch('http://localhost:3000/api/call-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmProvider,
          model: llmModel,
          apiKey: llmApiKey,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const result = await response.json();

      if (result.success) {
        const answer = result.data.content || '(无响应内容)';
        showStatus(`✅ 「${bookmark.name}」调用成功`, 'success', index);
        setTimeout(() => appendChatMessage(targetWorkspaceId, bookmark, prompt, answer, []), 300);
        sendEmailAfterReply(bookmark.name, prompt, answer);
      } else {
        const errorMsg = result.error || '未知错误';
        showStatus(`❌ 「${bookmark.name}」调用失败: ${errorMsg}`, 'error', index);
        setTimeout(() => appendChatMessage(targetWorkspaceId, bookmark, prompt, '❌ 错误: ' + errorMsg, []), 300);
      }
    } catch (err) {
      console.error('[Renderer] 💬 大模型 API 调用异常:', err);
      showStatus(`❌ 「${bookmark.name}」调用异常: ${err.message}`, 'error', index);
      setTimeout(() => appendChatMessage(targetWorkspaceId, bookmark, prompt, '❌ 异常: ' + err.message, []), 300);
    }

    return;
  }

  // 🔑 自动调度模式：保存工作区设定（确保切换工作区后能正确保存设定）
  updateWorkspaceStatus(currentWorkspaceId, 'running');
  workspaces[currentWorkspaceId].bookmarkIndex = index;
  workspaces[currentWorkspaceId].title = bookmark.name;
  workspaces[currentWorkspaceId].replySelector = bookmark.replySelector || '';
  workspaces[currentWorkspaceId].heartbeatSelector = bookmark.heartbeatSelector || '';
  workspaces[currentWorkspaceId].monitorTimeout = bookmark.monitorTimeout || 0;
  updateWorkspaceTabName(currentWorkspaceId, bookmark.name);

  // 读取当前卡片的预设消息和附件（优先从数据读取，避免 syncMiniToRegular 覆盖）
  let presetMessage = bookmarks[index].presetMessage || '';
  console.log(`[continueConversation] 从 bookmarks[${index}].presetMessage 读取: "${presetMessage}"`);
  const presetMessageInput = document.getElementById(`presetMsg_${index}`);
  if (presetMessageInput && presetMessageInput.value.trim()) {
    presetMessage = presetMessageInput.value.trim();
    console.log(`[continueConversation] 从 presetMsg_${index} 读取: "${presetMessage}"`);
  } else {
    console.log(`[continueConversation] presetMsg_${index} 为空或不存在`);
  }
  const attachments = getAttachmentsArray(index);

  console.log('[Renderer] 💬 配置:');
  console.log('[Renderer] 💬   - 消息:', presetMessage || '(空)');
  console.log('[Renderer] 💬   - 附件数:', attachments.length);

  // 验证是否有内容需要发送
  if (!presetMessage && attachments.length === 0) {
    console.warn('[Renderer] 💬 ⚠️ 无内容可发送');
    showStatus('⚠️ 请先输入消息或添加附件', 'warning');
    return;
  }

  console.log('[Renderer] 💬 ✅ 有内容，继续...');

  // 🔍 关键检查：是否有已打开的 webview
  // 🔑 关键修复：优先从当前工作区面板查找 webview，避免跨工作区污染
  let currentWebview = null;
  let webviewCheckDetails = {};

  console.log('[Renderer] 💬 🔍 开始查找 webview...');

  // 方法1：优先从当前工作区面板查找（最准确）
  const currentPanel = getCurrentWorkspacePanel();
  if (currentPanel) {
    const panelWebview = currentPanel.querySelector('webview');
    if (panelWebview) {
      try {
        const wvUrl = panelWebview.getURL ? panelWebview.getURL() : '';
        console.log('[Renderer] 💬 方法1 - 当前工作区面板 webview URL:', wvUrl);
        if (wvUrl && (wvUrl.startsWith('http') || wvUrl === 'about:blank')) {
          currentWebview = panelWebview;
          webviewCheckDetails.method = 'current-workspace-panel';
          console.log('[Renderer] 💬 ✅✅✅ 使用当前工作区面板的 webview');
        }
      } catch (e) {
        console.warn('[Renderer] 💬 方法1 失败:', e.message);
      }
    }
  }

  // 方法2：使用 getCurrentWebview() 函数（已按工作区隔离）
  if (!currentWebview) {
    const wsWebview = getCurrentWebview();
    if (wsWebview) {
      try {
        const wvUrl = wsWebview.getURL ? wsWebview.getURL() : '';
        console.log('[Renderer] 💬 方法2 - getCurrentWebview() URL:', wvUrl);
        if (wvUrl && (wvUrl.startsWith('http') || wvUrl === 'about:blank')) {
          currentWebview = wsWebview;
          webviewCheckDetails.method = 'getCurrentWebview';
          console.log('[Renderer] 💬 ✅✅✅ 通过 getCurrentWebview() 找到 webview');
        }
      } catch (e) {
        console.warn('[Renderer] 💬 方法2 失败:', e.message);
      }
    }
  }

  // 方法3：最后才使用全局 _monitorWebview（可能跨工作区）
  if (!currentWebview && window._monitorWebview) {
    try {
      const hasGetURL = typeof window._monitorWebview.getURL === 'function';
      if (hasGetURL) {
        const url = window._monitorWebview.getURL();
        console.log('[Renderer] 💬 方法3 - _monitorWebview URL:', url);
        if (url) {
          currentWebview = window._monitorWebview;
          webviewCheckDetails.method = 'global-monitor-webview';
          console.log('[Renderer] 💬 ⚠️ 使用全局 _monitorWebview（可能跨工作区）');
        }
      }
    } catch (e) {
      console.warn('[Renderer] 💬 方法3 失败:', e.message);
    }
  }

  // 方法4：从 DOM 中查找可见的 webview（最后手段）
  if (!currentWebview) {
    console.log('[Renderer] 💬 🔍🔍🔍 [后备方案] 开始从 DOM 中查找 webview...');
    
    try {
      const allWebviews = document.querySelectorAll('webview');
      console.log('[Renderer] 💬   全局 webview 数量:', allWebviews.length);
      
      for (let i = 0; i < allWebviews.length; i++) {
        const wv = allWebviews[i];
        try {
          const rect = wv.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;
          
          if (isVisible) {
            const wvUrl = wv.getURL ? wv.getURL() : '';
            if (wvUrl && (wvUrl.startsWith('http') || wvUrl === 'about:blank')) {
              currentWebview = wv;
              webviewCheckDetails.method = 'DOM-global-query';
              webviewCheckDetails.foundAtIndex = i;
              console.log(`[Renderer] 💬 ✅✅✅ 从全局 DOM 中找到可见 webview! [${i}]`);
              break;
            }
          }
        } catch (e) {
          // 忽略错误，继续下一个
        }
      }

      if (currentWebview) {
        console.log('[Renderer] 💬 ✅ 后备方案成功！找到 webview');
      } else {
        console.warn('[Renderer] 💬 ❌ 后备方案也失败：DOM 中未找到任何有效 webview');
      }

    } catch (domError) {
      console.error('[Renderer] 💬 ❌ DOM 查找过程出错:', domError.message);
    }
  }

  // 输出最终的检测结论
  console.log('[Renderer] 💬 ===== 检测结果汇总 =====');
  console.log('[Renderer] 💬   currentWebview:', currentWebview ? '✅ 有效' : '❌ 无效/不存在');
  console.log('[Renderer] 💬   详情:', JSON.stringify(webviewCheckDetails));
  console.log('[Renderer] 💬 ==============================');

  try {
    // 🔍🔍🔍 自动检查：卡片与当前 webview 的域名是否一致
    console.log('[Renderer] 💬 🔄 [自动检查] 开始比对卡片与 webview 域名...');

    let aiCheck = null;
    if (currentWebview) {
      // 有 webview 时才做域名比对
      aiCheck = await checkCurrentAIInWebview(index);
      console.log('[Renderer] 💬 🔄 [自动检查] 结果:', JSON.stringify(aiCheck));
    }

    let usedWebview = null;

    if (currentWebview && aiCheck && aiCheck.isMatch) {
      // ✅ 域名匹配：直接在当前 webview 中继续对话
      console.log('[Renderer] 💬 🔄 [自动检查] ✅ 域名匹配！直接继续对话');
      // 🔑 不在这里调用 showStatus！会抢走 webview 焦点，延迟到发送完成后显示

      // 🆕 自动滚动到 webview 容器（与闪电⚡️按钮保持一致的行为）
      setTimeout(() => {
        const webviewContainer = getCurrentWebviewContainer();
        if (webviewContainer) {
          webviewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          console.log('[Renderer] 💬 已自动滚动到 webview 容器');
        }
      }, 100);

      try {
        usedWebview = currentWebview;
        await continueInCurrentWebview(usedWebview, index, presetMessage, attachments);
        console.log('[Renderer] 💬 ✅ 模式 A 执行完成');
      } catch (modeAError) {
        usedWebview = null;
        console.error('[Renderer] 💬❌ 模式 A 失败:', modeAError);
        console.error('[Renderer] 💬❌ 堆栈:', modeAError.stack);
        showStatus('❌ 继续对话失败: ' + modeAError.message, 'error');
      }

    } else {
      // ❌ 域名不匹配 或 无 webview：先自动打开正确网页，再继续执行
      const reason = !currentWebview ? '无已打开的webview'
        : (aiCheck ? `域名不匹配（卡片:${aiCheck.cardAI} ≠ webview:${aiCheck.currentAI}）` : '检测失败');

      console.log(`[Renderer] 💬 🔄 [自动检查] ⚠️ ${reason}，将自动切换网页后继续`);
      showStatus(`💬 ${reason}，正在自动切换到 ${bookmarks[index].name}...`, 'warning', index);

      // 步骤1：调用"开启网页"功能切换到正确的 URL
      await openBookmarkWebviewOnly(index);

      // 步骤2：等待新 webview 加载完成（增加到3秒，确保页面完全渲染）
      console.log('[Renderer] 💬 🔄 等待新 webview 加载...');
      await new Promise(r => setTimeout(r, 3000)); // 等待 3 秒让页面加载

      // 步骤2.5：额外等待 + 重试查找（有些平台加载较慢）
      let newWebview = null;
      let retries = 0;
      const maxRetries = 5;  // 增加到5次重试
      while (!newWebview && retries < maxRetries) {
        retries++;
        console.log(`[Renderer] 💬 🔄 查找新 webview (第${retries}/${maxRetries}次)...`);

        // 🔧 方法1: 直接通过 ID 查找（最可靠！）
        newWebview = getCurrentWebview();
        if (newWebview) {
          try {
            const url = newWebview.getURL ? newWebview.getURL() : '';
            console.log(`[Renderer] 💬 🔄 [方法1-ID] previewWebview URL:`, url || '(空)');
            // 只要元素存在就使用（不强制要求 http URL，页面可能还在加载）
            if (url || url === '' || url === 'about:blank') {
              console.log(`[Renderer] 💬 🔄 ✅ 通过 ID 找到 previewWebview!`);
              break;  // 找到了，退出循环
            }
            newWebview = null;  // 重置，尝试其他方法
          } catch (e) {
            console.warn(`[Renderer] 💬 🔄 [方法1-ID] 异常:`, e.message);
            newWebview = null;
          }
        }

        // 🔧 方法2: _monitorWebview 全局变量
        if (!newWebview && window._monitorWebview) {
          try {
            const url = window._monitorWebview.getURL ? window._monitorWebview.getURL() : '';
            console.log(`[Renderer] 💬 🔄 [方法2-全局] _monitorWebview URL:`, url || '(空)');
            if (window._monitorWebview.tagName === 'WEBVIEW') {
              newWebview = window._monitorWebview;
              console.log(`[Renderer] 💬 🔄 ✅ 通过 _monitorWebview 找到!`);
              break;
            }
          } catch (e) {
            console.warn(`[Renderer] 💬 🔄 [方法2-全局] 异常:`, e.message);
          }
        }

        // 🔧 方法3: 从 webviewContainer 容器查找（修正容器ID！）
        if (!newWebview) {
          const containers = [
            getCurrentWebviewContainer(),    // ✅ 正确的容器ID
            document.getElementById('previewArea'),
            document.getElementById('content-area')
          ];

          for (const container of containers) {
            if (!container) continue;

            const webviews = container.querySelectorAll('webview');
            console.log(`[Renderer] 💬 🔄 [方法3-容器 ${container.id}] 找到 ${webviews.length} 个 webview`);

            for (let i = webviews.length - 1; i >= 0; i--) {
              try {
                const wv = webviews[i];
                const url = wv.getURL ? wv.getURL() : '';
                console.log(`[Renderer] 💬 🔄   webview[${i}] (${wv.id}) URL:`, url || '(空)');
                // 宽松条件：只要有尺寸就认为是有效的
                const rect = wv.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  newWebview = wv;
                  console.log(`[Renderer] 💬 🔄 ✅ 从容器 ${container.id} 找到可见 webview!`);
                  break;
                }
              } catch (e) {}
            }

            if (newWebview) break;
          }
        }

        // 🔧 方法4: 全局查找所有可见的 webview
        if (!newWebview) {
          const allWebviews = document.querySelectorAll('webview');
          for (let i = 0; i < allWebviews.length; i++) {
            try {
              const rect = allWebviews[i].getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                newWebview = allWebviews[i];
                console.log(`[Renderer] 💬 🔄 ✅ [方法4-全局] 找到可见 webview[${i}]!`);
                break;
              }
            } catch (e) {}
          }
        }

        if (!newWebview && retries < maxRetries) {
          const waitMs = 2000 * retries;  // 递增等待：2s, 4s, 6s, 8s, 10s
          console.log(`[Renderer] 💬 🔄 未找到，等待 ${waitMs}ms 后重试...`);
          await new Promise(r => setTimeout(r, waitMs));
        }
      }

      if (newWebview) {
        console.log('[Renderer] 💬 🔄 ✅ 找到新 webview，开始发送消息...');
        // 🔑 不在这里调用 showStatus！会抢走 webview 焦点

        // 自动滚动
        setTimeout(() => {
          const webviewContainer = getCurrentWebviewContainer();
          if (webviewContainer) webviewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

        try {
          await continueInCurrentWebview(newWebview, index, presetMessage, attachments);
          usedWebview = newWebview;
          console.log('[Renderer] 💬 ✅ 自动切换后执行完成');
        } catch (switchError) {
          usedWebview = null;
          console.error('[Renderer] 💬❌ 切换后执行失败:', switchError);
          showStatus('❌ 切换网页后发送消息失败: ' + switchError.message, 'error');
        }
      } else {
        console.warn('[Renderer] 💬 ⚠️ 切换后仍未找到有效 webview');
        showStatus('⚠️ 自动切换网页后未能找到有效的 webview', 'warning');
      }
    }

    // 🆕 统一邮件发送:无论路径 A 还是路径 B,发送完成后都执行（支持浮动视窗和排程触发）
    const emailRecipients = floatEmailRecipients.trim() || String(window.scheduleEmailRecipientsValue || '').trim();
    if (emailRecipients && usedWebview) {
      console.log(`[Email]  统一路径:等待 AI 回复稳定后自动获取内容并发送邮件...`);
      try {
        const recipientList = emailRecipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
        console.log(`[Email]  recipientList:`, recipientList);

        const customSelector = bookmarks[index].replySelector || window.currentReplySelector || '';
        const heartbeatSelector = bookmarks[index].heartbeatSelector || '';
        let monitorTimeout = bookmarks[index].monitorTimeout || 30000;
        if (monitorTimeout < 100) monitorTimeout = monitorTimeout * 1000;
        if (monitorTimeout < 15000) monitorTimeout = 15000;
        if (monitorTimeout > 120000) monitorTimeout = 120000;

        let capturedContent = '';
        let capturedHtml = '';
        let captureSuccess = false;

        try {
          const monitorResult = await waitForContentStable(usedWebview, monitorTimeout, heartbeatSelector);
          console.log(`[Email]  监控结果:`, monitorResult);
        } catch (monitorErr) {
          console.warn(`[Email] 📧 监控异常:`, monitorErr.message);
          await new Promise(r => setTimeout(r, 5000));
        }

        if (customSelector) {
          try {
            const captureResult = await captureWithCustomSelector(usedWebview, customSelector);
            if (captureResult && captureResult.success) {
              capturedContent = captureResult.content;
              capturedHtml = captureResult.html || '';
              captureSuccess = true;
              console.log(`[Email] 📧 获取成功,${capturedContent.length} 字符`);
            } else {
              console.warn(`[Email] 📧 获取失败:`, captureResult?.error);
            }
          } catch (captureErr) {
            console.warn(`[Email]  获取异常:`, captureErr.message);
          }
        } else {
          console.warn(`[Email] 📧 没有自定义选择器,无法获取内容`);
        }

        const subject = `[AI回复] ${bookmarks[index].name} - ${presetMessage.substring(0, 100)}`;
        let body;

        if (captureSuccess && capturedContent) {
          // 使用 capturedHtml（与元素查看器一致），清理参考链接
          let styledHtml = capturedHtml;
          // 清理 DeepSeek 参考链接按钮（"X 个网页"）
          styledHtml = styledHtml.replace(/<div[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
          styledHtml = styledHtml.replace(/<button[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');
          styledHtml = styledHtml.replace(/<div[^>]*>[\s\S]*?\d+\s*个网页[\s\S]*?<\/div>/gi, '');
          styledHtml = styledHtml.replace(/<a[^>]*href="[^"]*"[^>]*>[\s\S]*?\d+\s*个网页[\s\S]*?<\/a>/gi, '');
          styledHtml = styledHtml.replace(/<div[^>]*class="[^"]*(search-result|source|citation)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
          // 清理残留的 emoji 图标按钮（复制/刷新/点赞等）
          styledHtml = styledHtml.replace(/<button[^>]*title="[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');
          styledHtml = styledHtml.replace(/<div[^>]*class="[^"]*action[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
          // 完整渲染管线（与元素查看器保持一致）
          // 🆕 cleanHtmlWhitespace 现在返回 { html, mathBlocks }
          const { html: cleanedHtml, mathBlocks } = cleanHtmlWhitespace(styledHtml);
          styledHtml = cleanedHtml;
          styledHtml = formatJsonBlocks(styledHtml);
          styledHtml = injectInlineStyles(styledHtml);
          // 🆕 最后渲染 KaTeX 公式（在 injectInlineStyles 之后，避免样式污染）
          styledHtml = renderKaTeXPlaceholders(styledHtml, mathBlocks);
          
          const currentUrl = usedWebview.getURL ? usedWebview.getURL() : '';
          // 🆕 内嵌 KaTeX CSS，确保邮件在任何客户端都能正确显示数学公式
          const katexCSS = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">`;
          body = `${katexCSS}<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; color: #1e293b; max-width: 800px;">
<div style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
<p style="margin: 4px 0;"><strong>【来源】</strong><a href="${currentUrl}" style="color:#3b82f6;text-decoration:underline;">${currentUrl}</a></p>
<p style="margin: 4px 0;"><strong>【平台】</strong>${bookmarks[index].name} &nbsp;&nbsp; <strong>【获取时间】</strong>${new Date().toLocaleString('zh-CN')}</p>
</div>
${styledHtml}
</div>`;
        } else {
          body = `【问题】\n${presetMessage}\n\n【AI回复】\n(请查看工作区 ${bookmarks[index].name} 的最新回复)`;
        }

        const result = await sendEmailViaPlugin(recipientList, subject, body);
        console.log(`[Email] 📧 邮件发送结果:`, result);
        if (result.success) {
          const statusMsg = `📧 邮件已通过插件发送给 ${recipientList.join(', ')} (${captureSuccess ? capturedContent.length + ' 字符' : '无内容'})`;
          showStatus(statusMsg, 'success', undefined, true);
          addFloatHistoryEntry({ source: '系统', type: 'success', message: statusMsg, recipients: recipientList.join(', ') });
        } else {
          const statusMsg = `📧 邮件发送失败：${result.message}`;
          showStatus(statusMsg, 'error', undefined, true);
          addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients: recipientList.join(', ') });
        }
      } catch (e) {
        console.error(`[Email]  邮件发送失败:`, e);
        const statusMsg = `📧 邮件发送失败：${e.message}`;
        showStatus(statusMsg, 'error', undefined, true);
        addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients: recipientList.join(', ') });
      }
    }

    // 🆕 保存卡片历史消息
    if (presetMessage) {
      saveCardHistory(index, presetMessage);
    }
    
    console.log('[Renderer] 💬 ========== ✅ 全部完成 ==========');

  } catch (error) {
    console.error('[Renderer] 💬❌❌❌ 发生未预期的顶级错误:', error);
    console.error('[Renderer] 💬❌❌❌ 错误名称:', error.name);
    console.error('[Renderer] 💬❌❌❌ 错误消息:', error.message);
    console.error('[Renderer] 💬❌❌❌ 完整堆栈:', error.stack);
    showStatus('❌ 继续对话失败: ' + error.message, 'error');

    // 5秒后显示帮助信息
    setTimeout(() => {
      showStatus('💡 请查看控制台日志（Cmd+Option+I）获取详细错误信息', 'info');
    }, 5000);
  }
}

// 带超时的 webview.executeJavaScript 封装（防止 Electron webview JS 上下文繁忙时无限挂起）
function webviewExec(wv, code, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[Renderer] ️ webview.executeJavaScript 超时（' + timeoutMs + 'ms），强制继续');
      resolve({ success: false, error: 'executeJavaScript 超时' });
    }, timeoutMs);
    wv.executeJavaScript(code).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }).catch(err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 在当前 webview 中继续对话（不上传、不创建新对话）
async function continueInCurrentWebview(webview, index, presetMessage, attachments) {
  console.log('[Renderer] 💬 [continueInCurrentWebview] 函数开始...');
  console.log('[Renderer] 💬   webview:', webview);
  console.log('[Renderer] 💬   index:', index);
  console.log('[Renderer] 💬   消息长度:', presetMessage ? presetMessage.length : 0);
  console.log('[Renderer] 💬   附件数量:', attachments.length);

  try {
    // ===== 完全复制 crawlBookmarkByIndex 的设置逻辑 =====

    // 通知主进程记录当前服务卡片
    try {
      await window.electronAPI.setCurrentServiceCard(index);
    } catch (e) {
      console.warn('[Renderer] ⚠️ 通知主进程失败:', e.message);
    }

    // 设置自定义 headers
    const headersKey = `bookmark_${index}`;
    const customHeaders = bookmarkHeadersMap[headersKey] || null;
    window.currentCustomHeaders = customHeaders;

    // 设置预设消息和附件（与 ⚡️ 完全相同）
    window.currentPresetMessage = presetMessage;
    window.currentPresetAttachments = attachments;
    window.currentBookmarkIndex = index;
    window.currentReplySelector = bookmarks[index].replySelector || '';
    window.__monitorHeartbeatSelector = bookmarks[index].heartbeatSelector || '';
    window.__monitorReplySelector = bookmarks[index].replySelector || '';
    window.__monitorTimeout = bookmarks[index].monitorTimeout || 0;

    // 保存选择器设定到工作区对象，切换工作区时可恢复
    workspaces[currentWorkspaceId].bookmarkIndex = index;
    workspaces[currentWorkspaceId].replySelector = bookmarks[index].replySelector || '';
    workspaces[currentWorkspaceId].heartbeatSelector = bookmarks[index].heartbeatSelector || '';
    workspaces[currentWorkspaceId].monitorTimeout = bookmarks[index].monitorTimeout || 0;
    // 更新页签上显示的网点名称
    updateWorkspaceTabName(currentWorkspaceId, bookmarks[index].name);

    console.log('[Renderer]  [步骤1] 设置全局变量完成');

    // 🔑 注意：不在这里调用 showStatus！showStatus 会操作 DOM 抢走 webview 的焦点
    // 状态提示延迟到发送完成后再显示

    // ===== 核心区别：不调用 renderWebPreview()，直接使用已有的 webview =====

    // 等待页面稳定（💬 场景：webview 已加载，只需短等待）
    const webviewUrl = webview.getURL();  // ✅ 修复：使用参数名 webview，不是 currentWebview
    console.log('[Renderer] 💬 [步骤2] Webview URL:', webviewUrl);
    const isKimiPage = webviewUrl.includes('kimi.com') || webviewUrl.includes('moonshot.cn');
    const waitTime = isKimiPage ? 1500 : 300;
    console.log('[Renderer] 💬 [步骤3] 等待', waitTime, 'ms...');
    await new Promise(resolve => setTimeout(resolve, waitTime));
    console.log('[Renderer] 💬 [步骤4] 等待完成');

    // ========== 🔥🔥 强制聚焦输入框（轻量重试机制）==========
    // 检测智谱页面：JS 上下文繁忙，executeJavaScript 会超时，直接用 OS 级别 focus
    const isZhipuPage = webview.getURL().includes('chat.z.ai') || webview.getURL().includes('zhipuai.cn') || webview.getURL().includes('chatglm.cn');

    if (isZhipuPage) {
      console.log('[Renderer] 💬 [步骤4.5] 🎯 检测到智谱页面，跳过 executeJavaScript 聚焦，直接使用 webview.focus()...');
      webview.focus();
      await new Promise(r => setTimeout(r, 500));
    } else {

    let focusResult = null;
    const maxFocusRetries = 2;  // 只重试2次，避免累积过长延迟
    const retryDelays = [500, 800];  // 固定短间隔

    for (let focusRetry = 0; focusRetry < maxFocusRetries; focusRetry++) {
      try {
        console.log(`[Renderer] 💬 [步骤4.5] 聚焦尝试 ${focusRetry + 1}/${maxFocusRetries}...`);

        focusResult = await webviewExec(webview, `
          (async () => {
            let inputEl = document.querySelector('textarea')
              || document.querySelector('div[contenteditable="true"]')
              || document.querySelector('[class*="chat-input-editor"]')
              || document.querySelector('[class*="editor"]')
              || document.querySelector('[contenteditable]')
              || document.querySelector('[role="textbox"]')
              || document.querySelector('input[type="text"]');

            if (!inputEl) {
              return { success: false, error: '未找到任何输入框元素', activeTag: document.activeElement ? document.activeElement.tagName : 'null' };
            }

            const rect = inputEl.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && inputEl.offsetParent !== null;

            if (!isVisible) {
              return { success: false, error: '输入框不可见（可能还在渲染中）', retryable: true };
            }

            inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            await new Promise(r => setTimeout(r, 200));
            inputEl.click();
            await new Promise(r => setTimeout(r, 150));
            inputEl.focus();
            await new Promise(r => setTimeout(r, 300));

            return {
              success: true,
              tag: inputEl.tagName,
              className: inputEl.className ? inputEl.className.substring(0, 50) : '',
              isActive: document.activeElement === inputEl,
              activeTag: document.activeElement ? document.activeElement.tagName : 'null'
            };
          })()
        `);

        console.log(`[Renderer] 💬 [步骤4.5] 尝试 ${focusRetry + 1} 结果:`, JSON.stringify(focusResult));

        // 🔑 只要找到输入框且可见就认为成功（Electron webview 的 isActive 经常不准确）
        if (focusResult.success) {
          console.log(`[Renderer] 💬 [步骤4.5] ✅ 第 ${focusRetry + 1} 次聚焦完成！`);
          break;
        }

        // 失败但可重试
        if (focusResult.retryable || !focusResult.success) {
          const waitMs = retryDelays[focusRetry] || 800;
          console.log(`[Renderer] 💬 [步骤4.5] ⏳ 聚焦未成功，等待 ${waitMs}ms 后重试...`);
          await new Promise(r => setTimeout(r, waitMs));
        } else {
          break;
        }
      } catch (focusErr) {
        console.warn(`[Renderer] 💬 [步骤4.5] ⚠️ 第 ${focusRetry + 1} 次聚焦异常:`, focusErr.message);
        if (focusRetry < maxFocusRetries - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    console.log('[Renderer] 💬 [步骤4.5] 最终 Focus 结果:', JSON.stringify(focusResult));

    // 如果所有重试都失败，仍然继续（有些平台即使焦点报告不成功也能发送）
    if (!focusResult || !focusResult.success) {
      console.warn('[Renderer] 💬 [步骤4.5] ⚠️ 所有聚焦尝试均未成功，但仍尝试发送消息');
      // 对于智谱等 JS 上下文繁忙的页面，直接用 OS 级别 focus
      webview.focus();
      await new Promise(r => setTimeout(r, 500));
    }
    } // end if/else isZhipuPage
    // ========== 强制聚焦结束（带重试）==========

    // ========== 阶段一：上传所有附件 ==========
    if (attachments.length > 0) {
      console.log(`[Renderer] 💬 [阶段一] 上传 ${attachments.length} 个附件...`);

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        console.log(`[Renderer] 💬   [${i + 1}/${attachments.length}] ${att.name}`);

        try {
          console.log(`[Renderer] 💬     发送附件数据给主进程...`);
          window.electronAPI.send('set-pending-attachment', att);
          await new Promise(r => setTimeout(r, 500));
          console.log(`[Renderer] 💬     调用 uploadAttachmentToInput...`);
          await uploadAttachmentToInput(webview, att);  // ✅ 修复
          console.log(`[Renderer] 💬     等待渲染...`);
          await new Promise(r => setTimeout(r, 2500));
          console.log(`[Renderer] 💬     ✅ 完成`);
        } catch (err) {
          console.error(`[Renderer] 💬     ❌ ${att.name} 失败:`, err.message);
          console.error(`[Renderer] 💬     ❌ 堆栈:`, err.stack);
        }
      }
      console.log('[Renderer] 💬 ✅ [阶段一] 上传完成');
    } else {
      console.log('[Renderer] 💬 ℹ️ 无附件需要上传');
    }

    // ========== 阶段二：发送消息 ==========
    console.log('[Renderer] 💬 进入阶段二...');
    if (presetMessage) {
      console.log('[Renderer] 💬 [阶段二] 发送消息:', presetMessage.substring(0, 50));
      console.log('[Renderer] 💬 调用 autoSendPresetMessage...');
      await autoSendPresetMessage(webview, presetMessage, null);  // ✅ 修复
      console.log('[Renderer] 💬 ✅ autoSendPresetMessage 完成');
    } else if (attachments.length > 0) {
      // 只有附件没有文字，也要触发发送
      console.log('[Renderer] 💬 [阶段二] 仅发送附件（无文字）');
      console.log('[Renderer] 💬 调用 executeJavaScript 点击发送按钮...');
      const sendResult = await webviewExec(webview, `  // ✅ 修复
        (async () => {
          const inputEl = document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
          if (!inputEl) return { success: false, error: '未找到输入框' };
          inputEl.focus();
          inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
          await new Promise(r => setTimeout(r, 1000));
          const btn = document.querySelector('[class*="chat-input"] button') || document.querySelector('button[class*="send"]');
          if (btn && !btn.disabled) { btn.click(); return { success: true, method: 'button' }; }
          return { success: true, method: 'enter' };
        })()
      `);
      console.log('[Renderer] 💬 发送结果:', sendResult);
    } else {
      console.log('[Renderer] 💬 ⚠️ 无消息也无附件，跳过发送');
    }

    // 成功
    showStatus(`✅ 已继续发送（${attachments.length}个附件${presetMessage ? '+消息' : ''}）`, 'success');
    console.log('[Renderer] 💬✅✅✅ continueInCurrentWebview 执行完成');

  } catch (error) {
    console.error('[Renderer] 💬❌❌❌ continueInCurrentWebview 异常:', error);
    console.error('[Renderer] 💬❌❌❌ 错误堆栈:', error.stack);
    showStatus('❌ 继续对话失败: ' + error.message, 'error');
  }
}

// 包装器：防止 async 错误被吞掉
function continueConversationWrapper(index) {
  console.log('[Renderer] 💬 [Wrapper] 按钮被点击');

  setCurrentActiveCard(index);
  saveFloatingCardSendHistory(index);

  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;

  autoScheduleBeforeExecute(index)
    .then(() => continueConversation(index))
    .then(() => {
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
      collapseFloatingWindow();
    })
    .catch((err) => {
      console.error('[Renderer] 💬 [Wrapper] ❌ 未捕获错误:', err);
      showStatus('❌ 严重错误: ' + err.message, 'error');
      btn.textContent = originalText;
      btn.disabled = false;
    });
}

/**
 * 🔍 检测当前 webview 中正在使用的 AI Chat 类型
 *
 * @param {Object} webview - webview 元素对象
 * @returns {Promise<Object>} 返回检测结果对象：
 *   - aiName: string - AI 名称（如 "Kimi", "豆包", "文心一言", "通义千问" 等）
 *   - url: string - 当前 URL
 *   - platform: string - 平台标识（kimi/doubao/wenxin/qwen/other）
 */
async function detectCurrentAIInWebview(webview) {
  console.log('[Renderer] 🔍 [detectCurrentAIInWebview] 开始检测当前 AI...');

  try {
    if (!webview) {
      return { aiName: '未知', url: '', platform: 'unknown' };
    }

    const currentUrl = webview.getURL ? webview.getURL() : '';
    console.log('[Renderer] 🔍 当前 webview URL:', currentUrl);

    let aiName = '未知';
    let platform = 'other';

    // 根据 URL 识别不同的 AI 平台
    if (currentUrl.includes('kimi.moonshot.cn') || currentUrl.includes('kimi.com') || currentUrl.includes('moonshot.cn')) {
      aiName = 'Kimi (Moonshot)';
      platform = 'kimi';
    } else if (currentUrl.includes('doubao.com') || currentUrl.includes('doubao.cn')) {
      aiName = '豆包 (Doubao)';
      platform = 'doubao';
    } else if (currentUrl.includes('yiyan.baidu.com') || currentUrl.includes('yiyian.baidu.com')) {
      aiName = '文心一言 (WenXin)';
      platform = 'wenxin';
    } else if (currentUrl.includes('qianwen.aliyun.com') || currentUrl.includes('tongyi.aliyun.com') || currentUrl.includes('qwen.cn')) {
      aiName = '通义千问 (Qwen)';
      platform = 'qwen';
    } else if (currentUrl.includes('chat.z.ai') || currentUrl.includes('zhipuai.cn')) {
      aiName = '智谱清言 (ChatGLM)';
      platform = 'zhipu';
    } else if (currentUrl.includes('chat.sensetime.com')) {
      aiName = '商量 (SenseTime)';
      platform = 'sensetime';
    } else if (currentUrl.includes('chatglm.cn')) {
      aiName = '智谱 (ChatGLM)';
      platform = 'chatglm';
    } else if (currentUrl.includes('deepseek.com') || currentUrl.includes('chat.deepseek.com')) {
      aiName = 'DeepSeek';
      platform = 'deepseek';
    } else if (currentUrl.includes('yuanbao.tencent.com') || currentUrl.includes('yuanbao.cn')) {
      aiName = '元宝 (YuanBao)';
      platform = 'yuanbao';
    }

    const result = {
      aiName: aiName,
      url: currentUrl,
      platform: platform
    };

    console.log('[Renderer] 🔍 检测结果:', result);
    return result;

  } catch (error) {
    console.error('[Renderer] 🔍 检测失败:', error);
    return { aiName: '检测失败', url: '', platform: 'error' };
  }
}

/**
 * 🔍 从 URL 中提取主域名（用于 AI 比对）
 * @param {string} url - 完整的 URL
 * @returns {string} 主域名，如 "yuanbao.tencent.com"
 */
function extractMainDomain(url) {
  if (!url) return '';
  try {
    // 移除协议前缀
    let domain = url.replace(/^https?:\/\//, '').replace(/^\/\//, '');
    // 移除路径部分
    domain = domain.split('/')[0];
    // 移除端口号
    domain = domain.split(':')[0];
    return domain.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * 🎯 检查卡片 AI 与当前 webview AI 是否匹配（可复用函数）
 *
 * 核心逻辑：直接比较 卡片URL的主域名 与 webview当前URL的主域名
 * 无需维护任何 AI 平台列表！
 *
 * @param {number} index - 书签索引
 * @returns {Promise<Object>} 返回检查结果对象：
 *   - isMatch: boolean - 是否匹配（true=相同, false=不同）
 *   - cardAI: string - 卡片中的域名/AI名称
 *   - currentAI: string - 当前 webview 中的域名/AI名称
 *   - cardUrl: string - 卡片的完整URL
 *   - currentUrl: string - 当前webview的完整URL
 */
async function checkCurrentAIInWebview(index) {
  console.log('[Renderer] 🎯 [checkCurrentAIInWebview] 开始检查，索引:', index);

  const result = {
    isMatch: false,
    cardAI: '',
    currentAI: '',
    cardUrl: '',
    currentUrl: ''
  };

  try {
    // 获取卡片信息
    const bookmark = bookmarks[index];
    if (!bookmark || !bookmark.url) {
      result.cardAI = '无效卡片';
      result.currentAI = '无法检测';
      console.warn('[Renderer] 🎯 无效卡片或URL, 索引:', index);
      return result;
    }

    // 获取卡片的 URL 和主域名
    const cardUrl = bookmark.url;
    const cardDomain = extractMainDomain(cardUrl);
    result.cardUrl = cardUrl;
    result.cardAI = cardDomain || '未知域名';

    console.log('[Renderer] 🎯 卡片 URL:', cardUrl, '→ 主域名:', cardDomain);

    // 🔑 关键修复：优先从当前工作区面板查找 webview，避免跨工作区污染
    let currentWebview = null;

    // 方法1：优先从当前工作区面板查找（最准确）
    const currentPanel = getCurrentWorkspacePanel();
    if (currentPanel) {
      const panelWebview = currentPanel.querySelector('webview');
      if (panelWebview) {
        try {
          const wvUrl = panelWebview.getURL ? panelWebview.getURL() : '';
          if (wvUrl && wvUrl.startsWith('http')) {
            currentWebview = panelWebview;
            console.log('[Renderer] 🎯 ✅ 从当前工作区面板找到 webview');
          }
        } catch (e) {}
      }
    }

    // 方法2：使用 getCurrentWebview() 函数（已按工作区隔离）
    if (!currentWebview) {
      const wsWebview = getCurrentWebview();
      if (wsWebview) {
        try {
          const wvUrl = wsWebview.getURL ? wsWebview.getURL() : '';
          if (wvUrl && wvUrl.startsWith('http')) {
            currentWebview = wsWebview;
            console.log('[Renderer] 🎯 ✅ 通过 getCurrentWebview() 找到 webview');
          }
        } catch (e) {}
      }
    }

    // 方法3：最后才使用全局 _monitorWebview（可能跨工作区）
    if (!currentWebview && window._monitorWebview) {
      try {
        const url = window._monitorWebview.getURL ? window._monitorWebview.getURL() : '';
        if (url) {
          currentWebview = window._monitorWebview;
          console.log('[Renderer] 🎯 ⚠️ 使用全局 _monitorWebview（可能跨工作区）');
        }
      } catch (e) {}
    }

    if (!currentWebview) {
      result.currentAI = '无 webview';
      result.isMatch = false;
      return result;
    }

    // 获取 webview 的 URL 和主域名
    const currentUrl = currentWebview.getURL ? currentWebview.getURL() : '';
    const currentDomain = extractMainDomain(currentUrl);
    result.currentUrl = currentUrl;
    result.currentAI = currentDomain || '未知域名';

    console.log('[Renderer] 🎯 Webview URL:', currentUrl, '→ 主域名:', currentDomain);

    // 核心比对：直接比较主域名是否相同
    result.isMatch = (
      cardDomain !== '' &&
      currentDomain !== '' &&
      cardDomain === currentDomain
    );

    // 🆕 额外检查：如果主域名不匹配，检查是否属于同一平台（如百度的不同子域名）
    if (!result.isMatch) {
      const cardHostname = new URL(cardUrl).hostname.toLowerCase();
      const currentHostname = new URL(currentUrl).hostname.toLowerCase();
      
      // 检查是否有共同的二级域名（如 baidu.com）
      const cardParts = cardHostname.split('.').reverse();
      const currentParts = currentHostname.split('.').reverse();
      
      if (cardParts.length >= 2 && currentParts.length >= 2) {
        const cardBase = cardParts[0] + '.' + cardParts[1];
        const currentBase = currentParts[0] + '.' + currentParts[1];
        if (cardBase === currentBase) {
          console.log('[Renderer] 🎯 ⚠️ 主域名不匹配但基础域名相同:', cardBase);
          result.isMatch = true;
        }
      }
    }

    console.log('[Renderer] 🎯 检查完成:', result);
    return result;

  } catch (error) {
    console.error('[Renderer] 🎯 [checkCurrentAIInWebview] 错误:', error);
    result.currentAI = '检测出错';
    result.isMatch = false;
    return result;
  }
}

/**
 * 🔘 "检查AI"按钮点击事件处理函数
 */
async function checkAIBtnClickHandler(index) {
  console.log('[Renderer] 🔘 [检查AI] 按钮被点击, 索引:', index);

  // 立即显示"检测中"状态（确保用户看到响应）
  showStatus('🔍 正在检测当前对话AI...', 'info');

  // 安全获取按钮元素（兼容原始卡片和迷你卡片）
  let btn = null;
  if (event && event.target) {
    btn = event.target.closest('.check-ai') || event.target.closest('.mini-btn-check') || event.target;
  }
  const originalHTML = btn ? btn.innerHTML : '<span class="check-ai-text">一致<br>检查</span>';
  if (btn) {
    btn.innerHTML = '⏳';
    btn.disabled = true;
  }

  let checkResult = null;
  try {
    checkResult = await checkCurrentAIInWebview(index);

    if (checkResult.isMatch) {
      showStatus(`✅ 目前 webview中作用的是 ${checkResult.currentAI}，与卡片AI相同！`, 'success', index);
      console.log('[Renderer] 🔘 ✅ AI 匹配:', checkResult);
    } else {
      showStatus(`⚠️ 目前 webview中作用的是 ${checkResult.currentAI}（与卡片 ${checkResult.cardAI} 不同）`, 'warning', index);
      console.log('[Renderer] 🔘 ⚠️ AI 不匹配:', checkResult);
    }

  } catch (error) {
    console.error('[Renderer] 🔘 [检查AI] 错误:', error);
    showStatus('❌ 检查AI失败: ' + error.message, 'error', index);
    checkResult = null;
  } finally {
    // 无论成功或失败，都恢复按钮状态
    if (btn) {
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }, 1500);
    }
  }

  return checkResult;
}

async function openBookmarkWebviewOnly(index) {
  setCurrentActiveCard(index);
  if (index < 0 || index >= bookmarks.length) {
    console.error('[Renderer] 无效的网点索引:', index);
    showStatus('❌ 网点数据错误', 'error');
    return;
  }
  
  // 自动调度模式：执行前自动选择工作区
  await autoScheduleBeforeExecute(index);

  const bookmark = bookmarks[index];
  const url = bookmark.url;

  console.log(`[Renderer] 🔓 点击\"开启网页\"按钮: ${bookmark.name}`);
  console.log('[Renderer] 🔓 纯净模式：不发送消息、不加载附件');

  //  v1.0.0-45: 通知主进程记录当前服务卡片（用于"识别后台服务"功能）
  try {
    await window.electronAPI.setCurrentServiceCard(index);
    console.log('[Renderer] ✅ 已通知主进程记录当前服务卡片: [' + index + '] ' + bookmark.name);
  } catch (e) {
    console.warn('[Renderer] ⚠️ 通知主进程记录服务卡片失败:', e.message);
  }

  // 设置 URL 到输入框
  document.getElementById('urlInput').value = url;

  // 清空所有预设内容（关键！不发送任何消息）
  window.currentPreviewUrl = url;
  window.currentPresetMessage = '';  // 清空预设消息
  window.currentPresetAttachments = [];  // 清空附件数组
  window.currentBookmarkIndex = index;
  window.currentReplySelector = bookmark.replySelector || '';
  window.__monitorHeartbeatSelector = bookmark.heartbeatSelector || '';
  window.__monitorReplySelector = bookmark.replySelector || '';
  window.__monitorTimeout = bookmark.monitorTimeout || 0;
  window.currentCustomHeaders = null;

  // 保存选择器设定到工作区对象，切换工作区时可恢复
  workspaces[currentWorkspaceId].bookmarkIndex = index;
  workspaces[currentWorkspaceId].replySelector = bookmark.replySelector || '';
  workspaces[currentWorkspaceId].heartbeatSelector = bookmark.heartbeatSelector || '';
  workspaces[currentWorkspaceId].monitorTimeout = bookmark.monitorTimeout || 0;
  workspaces[currentWorkspaceId].wsUrl = url; // 保存 URL 到工作区对象
  // 更新页签上显示的网点名称
  updateWorkspaceTabName(currentWorkspaceId, bookmark.name);

  // 显示数据区域
  document.getElementById('dataSection').style.display = 'block';
  const es2 = document.getElementById('emptyState');
  if (es2) es2.style.display = 'none';

  // 只显示网页预览页签
  const allTabs = document.querySelectorAll('.tab');
  allTabs.forEach(tab => {
    if (tab.getAttribute('data-tab') === 'webpreview') {
      tab.style.display = '';
      tab.classList.add('active');
    } else {
      tab.style.display = 'none';
    }
  });

  // 切换到网页预览页签
  currentTab = 'webpreview';
  renderData('webpreview');

  // 🔓 不显示状态讯息（避免 showStatus 操作 DOM 抢走 webview 输入框焦点）
  // 焦点由 dom-ready 事件中的 AutoFocus 脚本负责
}

// 使用网点进行爬取
function crawlBookmark(url, customHeaders) {
  document.getElementById('urlInput').value = url;
  
  // 如果有自定义 headers，存储到全局变量供 startCrawl 使用
  if (customHeaders) {
    window.currentCustomHeaders = customHeaders;
    console.log('[Renderer] 设置自定义请求头:', customHeaders);
  } else {
    window.currentCustomHeaders = null;
  }
  
  startCrawl();
}

// 加载区块折叠状态
function loadBookmarksSectionState() {
  try {
    const saved = localStorage.getItem('bookmarksSectionVisible');
    if (saved !== null) {
      return JSON.parse(saved);
    }
    return true; // 默认展开
  } catch (e) {
    console.error('[Renderer] 加载区块折叠状态失败:', e);
    return true;
  }
}

// 默认爬取网点数据（与 saveBookmark 创建的字段结构一致）
const DEFAULT_BOOKMARKS = [
  {
    name: '新浪财经抓股价',
    url: 'http://hq.sinajs.cn/list=sh601088,sh601166,sz159611,sh562550',
    category: 'finance',
    note: '',
    referer: 'https://finance.sina.com.cn/',
    userAgent: '',
    previewOnly: false,
    externalBrowser: false,
    autoMonitor: true,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: 'twse',
    url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|tse_2317.tw|tse_1301.tw&json=1',
    category: 'finance',
    note: '多只（用 | 隔开）\ntwse 台积电 鸿海',
    referer: 'https://mis.twse.com.tw',
    userAgent: '',
    previewOnly: false,
    externalBrowser: false,
    autoMonitor: true,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '腾讯财经',
    url: 'https://qt.gtimg.cn/q=sh600519,sz002969,sh688449',
    category: 'finance',
    note: 'HTTP Get（腾讯证券抓即时股票行情）',
    referer: '',
    userAgent: '',
    previewOnly: false,
    externalBrowser: false,
    autoMonitor: true,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    category: 'ai-chat',
    note: '.container-qX9Csx.md-box-root',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '.container-qX9Csx.md-box-root',
    heartbeatSelector: '#chat-route-main',
    monitorTimeout: 10000
  },
  {
    name: '豆包APP',
    url: '',
    type: 'desktop-app',
    appName: '豆包',
    category: 'ai-chat',
    note: '桌面APP版（macOS AppleScript 自动化）',
    referer: '',
    userAgent: '',
    previewOnly: false,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: 0,
    sendMethod: 'clipboard',
    activateDelay: 500
  },
  {
    name: 'hao123',
    url: 'https://www.hao123.com',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '今天上海的天气',
    replySelector: 'body.sk_skin-color-green',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: 'deepseek',
    url: 'https://chat.deepseek.com/',
    category: 'ai-chat',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: true,
    presetMessage: '给我 网易云音乐 今年古风歌曲的排行 列表\n并在 列表中 给我 该歌曲的播放链接',
    replySelector: '.ds-markdown.ds-assistant-message-main-content',
    heartbeatSelector: 'div._7780f2e',
    monitorTimeout: 15000
  },
  {
    name: '千问(无法在broweerview中使用)',
    url: 'https://www.qianwen.com',
    category: 'ai-chat',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '今天 早盘的股市状况如何？',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '元宝',
    url: 'https://yuanbao.tencent.com/chat/naQivTmsDa',
    category: 'ai-chat',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '.hyc-common-markdown.hyc-common-markdown-style',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '智谱',
    url: 'https://chat.z.ai',
    category: 'ai-chat',
    note: '.markdown-prose\ndiv.pt-2.w-full',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '今天有哪些财经新闻？',
    replySelector: 'div.pt-2.w-full',
    heartbeatSelector: '#chat-container',
    monitorTimeout: 20000
  },
  {
    name: 'chatboxai',
    url: 'https://web.chatboxai.app/guide',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '文心一言',
    url: 'https://yiyan.baidu.com',
    category: 'ai-chat',
    note: '#eb_chat_viewer\n.custom-html.md-stream-desktop',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '我是找你 分析大盘！还有类股！',
    replySelector: '#eb_chat_viewer',
    heartbeatSelector: '#root',
    monitorTimeout: 8000
  },
  {
    name: '新浪财经',
    url: 'https://finance.sina.com.cn/stock/',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: true,
    presetMessage: '',
    replySelector: '#fin_bd_list',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: 'Microsoft Bing',
    url: 'https://cn.bing.com/',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '百度百科',
    url: 'https://baike.baidu.com/#home',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: 'CMoney投資網誌',
    url: 'https://cmnews.com.tw/article/cmoneyaicurator-b6851f86-663b-11f1-8c33-fdb6f46fe9c4',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: 'div.articleContent.break-words',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: '旺得富',
    url: 'https://wantrich.chinatimes.com/search/元大金%20收盘价',
    category: 'general',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: false,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: null
  },
  {
    name: 'Kimi',
    url: 'https://www.kimi.com/',
    category: 'ai-chat',
    note: 'https://www.kimi.com/\nhttps://kimi.moonshot.cn',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '东魁杨梅 与 仙居杨梅 不是同一个产区吗？\n浙江 还有 那些杨梅产区？',
    replySelector: 'div.segment-content-box',
    heartbeatSelector: '',
    monitorTimeout: 8000
  },
  {
    name: '商量',
    url: 'https://chat.sensetime.com',
    category: 'ai-chat',
    note: '商量 SenseChat（商汤）',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '⏳',
    replySelector: 'div.PopAI_mainContent__ihduj',
    heartbeatSelector: '',
    monitorTimeout: 11000
  },
  {
    name: '秘塔AI',
    url: 'https://metaso.cn',
    category: 'ai-chat',
    note: '基本上无法使用！（总是回报 您已主动终止）',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '抖音有网站？',
    replySelector: 'div.markdown-body.MuiBox-root',
    heartbeatSelector: '',
    monitorTimeout: 8500
  },
  {
    name: '腾讯混元',
    url: 'https://aistudio.tencent.com',
    category: 'ai-chat',
    note: '思考已停止！ <---总是发出这个讯息！！！\nhttps://aistudio.tencent.com\nhttps://hunyuan.tencent.com',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '为何 思考已停止？',
    replySelector: '',
    heartbeatSelector: '',
    monitorTimeout: 11000
  },
  {
    name: '讯飞星火',
    url: 'https://xinghuo.xfyun.cn/desk',
    category: 'ai-chat',
    note: '',
    referer: '',
    userAgent: '',
    previewOnly: true,
    externalBrowser: false,
    autoMonitor: false,
    presetMessage: '请提供 播放的链接',
    replySelector: '#chat-window',
    heartbeatSelector: '',
    monitorTimeout: 9500
  }
];

// 已加载 webview 的工作区集合（避免重复加载导致页面刷新）
const loadedWebviewWorkspaces = new Set();

// 渲染网页预览（使用 webview）
function renderWebPreview(container) {
  // 从容器获取工作区 ID（支持展开模式下的多工作区）
  const wsDiv = container.closest('.workspace-panel') || container;
  const wsId = wsDiv.getAttribute('data-ws') || currentWorkspaceId;
  const wsSuffix = wsId !== 'MAIN' ? `-${wsId}` : '';
  const webviewId = `previewWebview${wsSuffix}`;
  const containerId = `webviewContainer${wsSuffix}`;
  const urlInputId = `webviewUrlInput${wsSuffix}`;
  const loadingId = `webviewLoading${wsSuffix}`;

  // 优先使用工作区自己的 URL，避免使用被其他工作区覆盖的全局变量
  const ws = workspaces[wsId];
  const currentUrl = (ws && ws.wsUrl) || (wsId === currentWorkspaceId ? (window.currentPreviewUrl || crawledData?.url || document.getElementById('urlInput')?.value) : '');

  // 查找预创建的 webview 容器和空状态
  const webviewContainer = container.querySelector(`#${containerId}`);
  const emptyEl = container.querySelector(`#empty-${wsId}`);

  // 查找工作区标题栏
  const expandHeader = wsDiv.querySelector(`.ws-expand-header[data-ws-header="${wsId}"]`);

  if (!currentUrl) {
    // 没有 URL：显示空状态，隐藏 webview，显示标题栏
    if (emptyEl) emptyEl.style.display = 'block';
    if (webviewContainer) {
      webviewContainer.style.display = 'none';
    }
    if (expandHeader) expandHeader.style.display = '';
    return;
  }

  // 有 URL：显示 webview，隐藏空状态，隐藏标题栏
  if (emptyEl) emptyEl.style.display = 'none';
  if (webviewContainer) {
    webviewContainer.style.display = 'block';
  }
  if (expandHeader) expandHeader.style.display = 'none';

  // 更新 URL 输入框（从当前面板中查找，避免找到其他工作区的同名元素）
  const urlInput = container.querySelector(`#${urlInputId}`);
  if (urlInput) urlInput.value = escapeHtml(currentUrl);

  // 加载 URL 到预创建的 webview（从当前面板中查找，避免找到其他工作区的同名 webview）
  const webview = container.querySelector(`#${webviewId}`);
  if (webview) {
    try {
      const currentWvUrl = webview.getURL ? webview.getURL() : '';
      // URL 不同时重新加载，URL 相同时检查是否已加载过避免重复刷新
      if (currentWvUrl !== escapeHtml(currentUrl)) {
        webview.loadURL(escapeHtml(currentUrl));
        loadedWebviewWorkspaces.add(wsId);
        const loading = container.querySelector(`#${loadingId}`);
        if (loading) loading.style.display = 'block';
      } else if (!loadedWebviewWorkspaces.has(wsId)) {
        loadedWebviewWorkspaces.add(wsId);
      }
    } catch (e) {
      console.error(`[Renderer] 加载 webview 失败:`, e);
    }
  }
}

// 切换网页预览显示/隐藏（在输入框下方）
function toggleWebPreview() {
  const currentUrl = crawledData?.url || document.getElementById('urlInput')?.value;

  if (!currentUrl) {
    showStatus('❌ 请先输入网址', 'error');
    return;
  }

  // 自动补全协议（排除 file:// 协议）
  let url = currentUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    url = 'https://' + url;
  }

  console.log('[Renderer] 打开网页预览窗口:', url);

  // 调用主进程打开新窗口
  window.electronAPI.openWebPreview(url).then(result => {
    if (result.success) {
      console.log('[Renderer] ✅ 网页预览窗口已打开');
      showStatus('✅ 已在新窗口中打开网页预览', 'success');
    } else {
      console.error('[Renderer] ❌ 打开网页预览窗口失败:', result.error);
      showStatus('❌ 打开预览失败：' + result.error, 'error');
    }
  }).catch(error => {
    console.error('[Renderer]  调用 openWebPreview 失败:', error);
    showStatus('❌ 打开预览失败：' + error.message, 'error');
  });
}

console.log('[Renderer] 渲染进程脚本已加载');

// ========== AI 工作区管理 ==========
var workspaces = {
  'MAIN': { id: 'MAIN', title: 'MAIN', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '01': { id: '01', title: '01', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '02': { id: '02', title: '02', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '03': { id: '03', title: '03', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '04': { id: '04', title: '04', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '05': { id: '05', title: '05', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '06': { id: '06', title: '06', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '07': { id: '07', title: '07', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '08': { id: '08', title: '08', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '09': { id: '09', title: '09', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '10': { id: '10', title: '10', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '11': { id: '11', title: '11', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '12': { id: '12', title: '12', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '13': { id: '13', title: '13', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '14': { id: '14', title: '14', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '15': { id: '15', title: '15', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '16': { id: '16', title: '16', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '17': { id: '17', title: '17', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '18': { id: '18', title: '18', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '19': { id: '19', title: '19', status: 'idle', bookmarkIndex: null, zoomMode: false },
  '20': { id: '20', title: '20', status: 'idle', bookmarkIndex: null, zoomMode: false }
};
// 暴露为全局变量，供 workspace.js、http-get.js 等模组访问
window.workspaces = workspaces;

// 验证选择器是否为有效的 CSS 选择器
function isValidCssSelector(selector) {
  if (!selector || typeof selector !== 'string') return false;
  
  // 过滤掉包含非标准语法的伪选择器
  const invalidPatterns = [
    /&/,           // CSS 嵌套选择器中的 & 符号
    /:has\(/,      // :has() 伪类（部分环境不支持）
    /:is\(/,       // :is() 伪类
    /:where\(/,    // :where() 伪类
    /:not\([^)]*:/ // :not() 内包含伪类（可能导致问题）
  ];
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(selector)) {
      console.log('[Renderer] ⚠️ 选择器包含不支持的语法:', pattern, selector);
      return false;
    }
  }
  
  return true;
}

// 清理选择器：移除可能导致 querySelector 失败的非法语法
function sanitizeSelector(selector) {
  if (!selector || typeof selector !== 'string') return selector;
  
  let sanitized = selector;
  
  // 移除 & 符号及其周围可能的嵌套语法
  sanitized = sanitized.replace(/&\s*>/g, '').replace(/&\s*\+/g, '').replace(/&\s*~/g, '');
  sanitized = sanitized.replace(/^\s*&\s*/, '');
  
  // 移除 :has() 伪类
  sanitized = sanitized.replace(/:has\([^)]*\)/gi, '');
  
  // 移除 :is() 伪类
  sanitized = sanitized.replace(/:is\([^)]*\)/gi, '');
  
  // 移除 :where() 伪类
  sanitized = sanitized.replace(/:where\([^)]*\)/gi, '');
  
  // 如果选择器以 > 开头，移除它
  sanitized = sanitized.replace(/^\s*>/, '');
  
  // 清理多余的空格和分隔符
  sanitized = sanitized.replace(/\s*>\s*/g, ' > ');
  sanitized = sanitized.replace(/\s+/g, ' ');
  sanitized = sanitized.trim();
  
  // 如果清理后为空，返回 null
  return sanitized || null;
}

// ========== 显示元素结构界面 ==========
function displayElementStructure(structureData) {
  // 先移除旧的面板（如果有）
  const oldContainer = document.getElementById('elementStructureContainer');
  if (oldContainer) {
    oldContainer.remove();
  }
  
  const container = document.createElement('div');
  container.id = 'elementStructureContainer';
  container.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: 50%;
    background: white;
    border-top: 3px solid #6366f1;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
    z-index: 100000;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  container.innerHTML = `
    <div style="padding: 12px 16px; background: #6366f1; color: white; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
      <span style="font-weight: 600; font-size: 14px;">📊 Webview 元素结构查看器</span>
      <div style="display: flex; align-items: center; gap: 12px; flex: 1; max-width: 400px;">
        <input type="text" id="elementSearchInput" placeholder="🔍 搜索元素内容..." style="flex: 1; padding: 6px 12px; border-radius: 6px; border: none; font-size: 13px;">
        <button id="elementSearchPrevBtn" title="上一个" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer;">▲</button>
        <button id="elementSearchNextBtn" title="下一个" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer;">▼</button>
      </div>
      <span style="font-size: 12px; opacity: 0.9;">当前页面: ${structureData.url}</span>
      <button onclick="document.getElementById('elementStructureContainer').remove()" 
        style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">
        ✕ 关闭
      </button>
    </div>
    
    <div style="flex: 1; overflow-y: auto; background: #f8fafc;">
      <div style="padding: 12px; font-weight: 600; font-size: 13px; color: #475569; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; background: #f8fafc; display: flex; justify-content: space-between; align-items: center;">
        <span>🎯 找到的元素 (<span id="elementCount">${structureData.textElements.length}</span>个) - 按长度从长到短排列</span>
        <span id="searchResultInfo" style="font-size: 12px; color: #64748b;"></span>
      </div>
      <div id="textElementsList" style="padding: 12px;"></div>
    </div>
  `;
  
  document.body.appendChild(container);
  
  let currentMatchIndex = -1;
  let matchingElements = [];
  const itemElements = [];
  
  // 渲染元素列表
  const textElementsList = document.getElementById('textElementsList');
  for (let i = 0; i < structureData.textElements.length; i++) {
    const item = structureData.textElements[i];
    const itemDiv = document.createElement('div');
    itemDiv.className = 'element-item';
    itemDiv.dataset.index = i;
    itemDiv.dataset.text = item.innerText;
    itemDiv.style.cssText = `
      padding: 12px;
      margin: 8px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    `;
    itemDiv.onmouseenter = () => {
      itemDiv.style.borderColor = '#6366f1';
      itemDiv.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.1)';
    };
    itemDiv.onmouseleave = () => {
      itemDiv.style.borderColor = '#e5e7eb';
      itemDiv.style.boxShadow = 'none';
    };
    itemDiv.innerHTML = `
      <div style="font-weight: 600; color: #6366f1; margin-bottom: 6px; font-family: monospace;">
        <span style="color: #dc2626; font-size: 13px;">&lt;${item.tag}&gt;</span>
        ${item.id ? '<span style="color: #2563eb;"> #' + item.id + '</span>' : ''}
        ${item.className ? '<span style="color: #16a34a;"> .' + item.className.substring(0, 100) + '</span>' : ''}
      </div>
      <div class="element-content" style="color: #475569; font-size: 11px; max-height: 120px; overflow-y: auto; line-height: 1.5; background: #fafafa; padding: 8px; border-radius: 4px;">
        ${item.innerText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </div>
      <div style="font-size: 11px; color: #94a3b8; margin-top: 6px; display: flex; gap: 16px;">
        <span>📝 文本长度: <strong>${item.textLength}</strong> 字符</span>
      </div>
    `;
    textElementsList.appendChild(itemDiv);
    itemElements.push(itemDiv);
  }
  
  // 搜索功能
  const searchInput = document.getElementById('elementSearchInput');
  const searchPrevBtn = document.getElementById('elementSearchPrevBtn');
  const searchNextBtn = document.getElementById('elementSearchNextBtn');
  const searchResultInfo = document.getElementById('searchResultInfo');
  const elementCountSpan = document.getElementById('elementCount');
  
  function highlightMatches(searchText) {
    currentMatchIndex = -1;
    matchingElements = [];
    
    if (!searchText) {
      searchResultInfo.textContent = '';
      itemElements.forEach(el => {
        el.style.borderColor = '#e5e7eb';
        el.style.boxShadow = 'none';
        el.style.background = 'white';
      });
      return;
    }
    
    const searchLower = searchText.toLowerCase();
    
    itemElements.forEach((el, idx) => {
      const text = el.dataset.text.toLowerCase();
      if (text.includes(searchLower)) {
        matchingElements.push(idx);
      }
    });
    
    // 更新所有元素样式
    itemElements.forEach(el => {
      el.style.borderColor = '#e5e7eb';
      el.style.boxShadow = 'none';
      el.style.background = 'white';
    });
    
    if (matchingElements.length > 0) {
      searchResultInfo.textContent = `找到 ${matchingElements.length} 个匹配`;
      currentMatchIndex = 0;
      scrollToMatch(0);
    } else {
      searchResultInfo.textContent = '没有找到匹配';
    }
  }
  
  function scrollToMatch(index) {
    if (matchingElements.length === 0) return;
    
    // 清除之前的高亮
    matchingElements.forEach(idx => {
      itemElements[idx].style.borderColor = '#f59e0b';
      itemElements[idx].style.boxShadow = '0 0 0 2px rgba(245, 158, 11, 0.2)';
      itemElements[idx].style.background = '#fffbeb';
    });
    
    // 高亮当前匹配
    const targetIdx = matchingElements[index];
    itemElements[targetIdx].style.borderColor = '#dc2626';
    itemElements[targetIdx].style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.3)';
    itemElements[targetIdx].style.background = '#fef2f2';
    
    // 滚动到该元素
    itemElements[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // 更新信息
    searchResultInfo.textContent = `第 ${index + 1}/${matchingElements.length} 个匹配`;
  }
  
  // 输入框事件
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      highlightMatches(e.target.value);
    }, 300);
  });
  
  // 上一个按钮
  searchPrevBtn.addEventListener('click', () => {
    if (matchingElements.length > 0) {
      currentMatchIndex = (currentMatchIndex - 1 + matchingElements.length) % matchingElements.length;
      scrollToMatch(currentMatchIndex);
    }
  });
  
  // 下一个按钮
  searchNextBtn.addEventListener('click', () => {
    if (matchingElements.length > 0) {
      currentMatchIndex = (currentMatchIndex + 1) % matchingElements.length;
      scrollToMatch(currentMatchIndex);
    }
  });
}

// ========== 渲染树节点 ==========
function renderTreeNode(node, parentEl, depth) {
  if (!node) return;
  
  const nodeDiv = document.createElement('div');
  const indent = depth * 16;
  
  const isExpandable = node.children && node.children.length > 0;
  let isExpanded = depth < 2;  // 默认展开前2层
  
  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = `
    padding: 6px 8px;
    padding-left: ${indent + 8}px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 4px;
    margin: 2px 0;
    font-size: 12px;
    user-select: none;
  `;
  
  if (isExpandable) {
    const expandIcon = document.createElement('span');
    expandIcon.style.cssText = 'font-size: 10px; width: 14px; text-align: center;';
    expandIcon.textContent = isExpanded ? '▼' : '▶';
    headerDiv.appendChild(expandIcon);
  } else {
    const spacer = document.createElement('span');
    spacer.style.width = '14px';
    spacer.textContent = ' ';
    headerDiv.appendChild(spacer);
  }
  
  const tagSpan = document.createElement('span');
  tagSpan.style.cssText = 'font-family: monospace; font-weight: 600; color: #dc2626;';
  tagSpan.textContent = `<${node.tag}>`;
  headerDiv.appendChild(tagSpan);
  
  if (node.id) {
    const idSpan = document.createElement('span');
    idSpan.style.cssText = 'font-family: monospace; color: #2563eb;';
    idSpan.textContent = ` #${node.id}`;
    headerDiv.appendChild(idSpan);
  }
  
  if (node.classList && node.classList.length > 0) {
    const classSpan = document.createElement('span');
    classSpan.style.cssText = 'font-family: monospace; color: #16a34a; font-size: 11px;';
    classSpan.textContent = ` .${node.classList.join('.').substring(0, 60)}`;
    headerDiv.appendChild(classSpan);
  }
  
  if (node.innerText && node.innerText.trim().length > 0) {
    const textPreview = node.innerText.trim().substring(0, 80);
    const textSpan = document.createElement('span');
    textSpan.style.cssText = 'color: #64748b; font-size: 11px; margin-left: 8px;';
    textSpan.textContent = ` 「${textPreview}${textPreview.length === 80 ? '...' : ''}」`;
    headerDiv.appendChild(textSpan);
  }
  
  // 悬停效果
  headerDiv.onmouseenter = () => {
    headerDiv.style.background = '#eff6ff';
  };
  headerDiv.onmouseleave = () => {
    headerDiv.style.background = 'transparent';
  };
  
  const childrenContainer = document.createElement('div');
  childrenContainer.style.display = isExpanded ? 'block' : 'none';
  
  if (isExpandable) {
    headerDiv.onclick = () => {
      isExpanded = !isExpanded;
      childrenContainer.style.display = isExpanded ? 'block' : 'none';
      headerDiv.firstChild.textContent = isExpanded ? '▼' : '▶';
    };
  }
  
  nodeDiv.appendChild(headerDiv);
  nodeDiv.appendChild(childrenContainer);
  parentEl.appendChild(nodeDiv);
  
  // 渲染子节点
  if (node.children) {
    for (const child of node.children) {
      renderTreeNode(child, childrenContainer, depth + 1);
    }
  }
}
