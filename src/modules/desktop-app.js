/**
 * 桌面APP自动化与脚本编辑器模组
 * 从 renderer.js 拆分而来
 * 依赖：showStatus, bookmarks, saveBookmarksToStorage（来自 renderer.js / bookmarks.js）
 */

// APP 下拉菜单：切换显示/隐藏
function toggleAppMenu(event, index) {
  event.stopPropagation();
  const menu = document.getElementById(`appMenu_${index}`);
  if (!menu) return;
  const isVisible = menu.style.display !== 'none';
  // 先关闭所有 APP 菜单
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (!isVisible) {
    menu.style.display = 'block';
  }
}

// 点击页面其他区域关闭 APP 菜单
document.addEventListener('click', () => {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
});

// APP 菜单：开启APP
async function appMenuActivate(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  console.log(`[Renderer] ️ 开启APP: ${appName}`);
  try {
    const result = await window.electronAPI.desktopAppActivate(appName);
    if (result.success) {
      showStatus(`✅ 已开启 ${appName}`, 'success');
    } else {
      showStatus(`❌ 开启失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 开启失败: ${e.message}`, 'error');
  }
}



let currentRecordingCardIndex = -1;
let currentSelectedAnchorId = null;

// 🆕 脚本数据独立缓存（存储在 data/scripts.json，不再保存在 bookmarks.json 中）
let cardScriptsData = {};
let cardScriptsDataLoaded = false;

const defaultAnchorNames = [
  '窗口中心', '输入框', '复制按钮', 'Markdown项', '输入区焦点',
  '预留6', '预留7', '预留8', '预留9', '预留10'
];

// 🆕 加载所有卡片的脚本数据（从 data/scripts.json）
async function loadCardScriptsData() {
  try {
    const result = await window.electronAPI.loadScriptsData();
    if (result.success && result.data) {
      cardScriptsData = result.data;
    } else {
      cardScriptsData = {};
    }
    cardScriptsDataLoaded = true;
    console.log('[Renderer] 脚本数据加载完成，卡片数:', Object.keys(cardScriptsData).length);
  } catch (error) {
    console.error('[Renderer] 加载脚本数据失败:', error);
    cardScriptsData = {};
    cardScriptsDataLoaded = true;
  }
}

// 🆕 保存所有卡片的脚本数据（到 data/scripts.json）
async function saveCardScriptsData() {
  try {
    const result = await window.electronAPI.saveScriptsData(cardScriptsData);
    if (!result.success) {
      console.error('[Renderer] 保存脚本数据失败:', result.error);
      showStatus('❌ 保存脚本数据失败：' + result.error, 'error');
    }
    return result;
  } catch (error) {
    console.error('[Renderer] 保存脚本数据失败:', error);
    showStatus('❌ 保存脚本数据失败：' + error.message, 'error');
    return { success: false, error: error.message };
  }
}

// 🆕 获取指定卡片的脚本数组（如果不存在则初始化）
function getCardScripts(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return [];
  const key = bookmark.name || `card_${index}`;
  if (!cardScriptsData[key]) {
    cardScriptsData[key] = [];
  }
  return cardScriptsData[key];
}

function initAnchorsForCard(index) {
  if (!bookmarks[index].anchors || bookmarks[index].anchors.length === 0) {
    bookmarks[index].anchors = [];
    for (let i = 1; i <= 10; i++) {
      bookmarks[index].anchors.push({
        id: i,
        name: defaultAnchorNames[i - 1],
        offsetX: 0,
        offsetY: 0,
        enabled: i <= 5
      });
    }
  }
  return bookmarks[index].anchors;
}

function renderAnchorList(index) {
  const anchorList = document.getElementById('anchorList');
  if (!anchorList) return;
  
  const anchors = initAnchorsForCard(index);
  let html = '';
  
  anchors.forEach(anchor => {
    const isCalibrated = anchor.offsetX !== 0 || anchor.offsetY !== 0;
    const isSelected = currentSelectedAnchorId === anchor.id;
    
    html += `
      <div onclick="selectAnchor(${anchor.id})" 
        style="padding: 8px; border: 2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}; 
               border-radius: 6px; cursor: pointer; transition: all 0.2s;
               background: ${isSelected ? '#eff6ff' : 'transparent'};"
        onmouseover="this.style.borderColor='${isSelected ? '#3b82f6' : '#cbd5e1'}'"
        onmouseout="this.style.borderColor='${isSelected ? '#3b82f6' : '#e2e8f0'}'">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; font-weight: 600; color: #1e293b;">定位点${anchor.id}</span>
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isCalibrated ? '#22c55e' : '#cbd5e1'};"></span>
        </div>
        <div style="font-size: 10px; color: #64748b; margin-top: 2px;">${anchor.name}</div>
        ${isCalibrated ? `<div style="font-size: 10px; color: #22c55e; margin-top: 2px;">(${Math.round(anchor.offsetX)}, ${Math.round(anchor.offsetY)})</div>` : ''}
      </div>
    `;
  });
  
  anchorList.innerHTML = html;
}

function selectAnchor(id) {
  currentSelectedAnchorId = id;
  renderAnchorList(currentRecordingCardIndex);
  updateAnchorDetail();
}

function updateAnchorDetail() {
  const anchors = initAnchorsForCard(currentRecordingCardIndex);
  const anchor = anchors.find(a => a.id === currentSelectedAnchorId);
  
  const nameEl = document.getElementById('anchorDetailName');
  const coordsEl = document.getElementById('anchorDetailCoords');
  const statusEl = document.getElementById('anchorDetailStatus');
  const nameInput = document.getElementById('anchorNameInput');
  const isCopyButtonInput = document.getElementById('anchorIsCopyButton');
  
  if (anchor) {
    nameEl.textContent = `定位点${anchor.id}: ${anchor.name}`;
    coordsEl.textContent = anchor.offsetX !== 0 || anchor.offsetY !== 0 
      ? `${Math.round(anchor.offsetX)}, ${Math.round(anchor.offsetY)}` 
      : '--';
    statusEl.textContent = anchor.offsetX !== 0 || anchor.offsetY !== 0 ? '已校准' : '未校准';
    statusEl.style.color = anchor.offsetX !== 0 || anchor.offsetY !== 0 ? '#22c55e' : '#64748b';
    nameInput.value = anchor.name;
    isCopyButtonInput.checked = anchor.isCopyButton || false;
  } else {
    nameEl.textContent = '请选择一个定位点';
    coordsEl.textContent = '--';
    statusEl.textContent = '未校准';
    statusEl.style.color = '#64748b';
    nameInput.value = '';
    isCopyButtonInput.checked = false;
  }
}

function updateAnchorName() {
  if (currentSelectedAnchorId === null || currentRecordingCardIndex === -1) return;
  
  const nameInput = document.getElementById('anchorNameInput');
  const isCopyButtonInput = document.getElementById('anchorIsCopyButton');
  const newName = nameInput.value.trim();
  if (!newName) return;
  
  const anchors = initAnchorsForCard(currentRecordingCardIndex);
  const anchor = anchors.find(a => a.id === currentSelectedAnchorId);
  if (anchor) {
    anchor.name = newName;
    anchor.isCopyButton = isCopyButtonInput.checked;
    saveBookmarksToStorage();
    renderAnchorList(currentRecordingCardIndex);
    updateAnchorDetail();
    showStatus('✅ 定位点名称已更新', 'success');
  }
}

function clearAllAnchors() {
  if (!confirm('确定要清除所有定位点数据吗？')) return;
  
  const anchors = initAnchorsForCard(currentRecordingCardIndex);
  anchors.forEach(a => {
    a.offsetX = 0;
    a.offsetY = 0;
    a.enabled = a.id <= 5;
  });
  saveBookmarksToStorage();
  renderAnchorList(currentRecordingCardIndex);
  updateAnchorDetail();
  showStatus('✅ 已清除所有定位点', 'success');
}

function closeAnchorRecordModal() {
  const modal = document.getElementById('anchorRecordModal');
  modal.style.display = 'none';
  modal.style.zIndex = '';
  currentRecordingCardIndex = -1;
  currentSelectedAnchorId = null;
}

function updateWindowDisplay() {
  if (currentRecordingCardIndex === -1) return;
  
  const bookmark = bookmarks[currentRecordingCardIndex];
  const winPosEl = document.getElementById('windowPosDisplay');
  const winSizeEl = document.getElementById('windowSizeDisplay');
  
  if (bookmark.window) {
    winPosEl.textContent = `${Math.round(bookmark.window.x || 0)}, ${Math.round(bookmark.window.y || 0)}`;
    winSizeEl.textContent = `${bookmark.window.width || 950} × ${bookmark.window.height || 920}`;
  } else {
    winPosEl.textContent = '--';
    winSizeEl.textContent = '950 × 920 (默认)';
  }
}

async function recordWindowSettings() {
  if (currentRecordingCardIndex === -1) return;
  
  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;
  
  const confirmed = confirm(`即将录制「${appName}」的窗口设置\n\n1. 点击确定后会自动打开APP\n2. 您有5秒时间调整窗口位置和大小\n3. 倒计时结束后自动记录当前窗口信息\n\n点击确定开始？`);
  if (!confirmed) return;
  
  showStatus(`⏳ 正在打开「${appName}」...`, 'info');
  
  try {
    await window.electronAPI.desktopAppActivate(appName);
    
    const progressDiv = document.getElementById('recordingProgress');
    const statusEl = document.getElementById('recordingStatus');
    const barEl = document.getElementById('recordingProgressBar');
    const countdownEl = document.getElementById('recordingCountdown');
    
    progressDiv.style.display = 'block';
    statusEl.textContent = `⏳ 请在5秒内调整「${appName}」窗口的位置和大小...`;
    statusEl.style.color = '#3b82f6';
    barEl.style.width = '0%';
    
    let countdown = 5;
    countdownEl.textContent = `${countdown}秒`;
    
    const countdownInterval = setInterval(() => {
      countdown--;
      countdownEl.textContent = `${countdown}秒`;
      barEl.style.width = `${((5 - countdown) / 5) * 100}%`;
      if (countdown <= 0) clearInterval(countdownInterval);
    }, 1000);
    
    await new Promise(r => setTimeout(r, 5000));
    
    clearInterval(countdownInterval);
    barEl.style.width = '100%';
    
    showStatus(`⏳ 正在记录「${appName}」的窗口设置...`, 'info');
    
    const result = await window.electronAPI.desktopAppGetWindowInfo(appName);
    
    if (result.success) {
      if (!bookmark.window) {
        bookmark.window = {};
      }
      bookmark.window.x = result.x;
      bookmark.window.y = result.y;
      bookmark.window.width = result.width;
      bookmark.window.height = result.height;
      
      saveBookmarksToStorage();
      updateWindowDisplay();
      
      console.log(`[Renderer] 窗口设置录制完成: 位置(${result.x}, ${result.y}), 大小(${result.width}x${result.height})`);
      statusEl.textContent = `✅ 窗口设置录制成功！位置: (${Math.round(result.x)}, ${Math.round(result.y)}), 大小: ${result.width}×${result.height}`;
      statusEl.style.color = '#22c55e';
      countdownEl.textContent = '';
      
      showStatus(`✅ 窗口设置录制成功！位置: (${Math.round(result.x)}, ${Math.round(result.y)}), 大小: ${result.width}×${result.height}`, 'success');
      
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.color = '';
        barEl.style.width = '0%';
      }, 3000);
    } else {
      statusEl.textContent = `❌ 窗口设置录制失败: ${result.error}`;
      statusEl.style.color = '#dc2626';
      showStatus(`❌ 窗口设置录制失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 窗口设置录制失败: ${e.message}`, 'error');
  }
}

async function replayWindowSettings() {
  if (currentRecordingCardIndex === -1) return;
  
  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;
  
  if (!bookmark.window) {
    alert('尚未录制窗口设置，请先点击「录制窗口」！');
    return;
  }
  
  const confirmed = confirm(`即将应用「${appName}」的窗口设置\n\n位置: (${Math.round(bookmark.window.x || 0)}, ${Math.round(bookmark.window.y || 0)})\n大小: ${bookmark.window.width || 950} × ${bookmark.window.height || 920}\n\n点击确定后会打开APP并设置窗口到指定位置和大小。\n\n点击确定开始？`);
  if (!confirmed) return;
  
  showStatus(`🔄 正在应用「${appName}」的窗口设置...`, 'info');
  
  try {
    const result = await window.electronAPI.desktopAppSetWindowInfo({
      appName: appName,
      x: bookmark.window.x || 0,
      y: bookmark.window.y || 0,
      width: bookmark.window.width || 950,
      height: bookmark.window.height || 920
    });
    
    if (result.success) {
      showStatus(`✅ 窗口设置应用成功！`, 'success');
      alert(`✅ 窗口设置应用成功！\n\n「${appName}」已移动到指定位置并调整大小。`);
    } else {
      showStatus(`❌ 窗口设置应用失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 窗口设置应用失败: ${e.message}`, 'error');
  }
}

// 🆕 更新截图区域显示
function updateCaptureRegionDisplay() {
  const posEl = document.getElementById('captureRegionPosDisplay');
  const sizeEl = document.getElementById('captureRegionSizeDisplay');
  const widthInput = document.getElementById('captureRegionWidthInput');
  const heightInput = document.getElementById('captureRegionHeightInput');
  const previewEl = document.getElementById('captureRegionPreview');
  const previewContainer = document.getElementById('captureRegionPreviewContainer');
  if (!posEl) return;

  const bookmark = bookmarks[currentRecordingCardIndex];
  if (bookmark && bookmark.captureRegion) {
    const r = bookmark.captureRegion;
    posEl.textContent = `${Math.round(r.x || 0)}, ${Math.round(r.y || 0)}`;
    if (sizeEl) sizeEl.textContent = `${Math.round(r.width || 0)} × ${Math.round(r.height || 0)}`;
    if (widthInput) widthInput.value = r.width || '';
    if (heightInput) heightInput.value = r.height || '';
    if (previewEl && r.base64) {
      previewEl.src = r.base64;
      previewEl.style.display = 'block';
    }
    if (previewContainer && r.base64) {
      previewContainer.style.display = 'flex';
    }
  } else {
    posEl.textContent = '--';
    if (sizeEl) sizeEl.textContent = '--';
    if (widthInput) widthInput.value = '';
    if (heightInput) heightInput.value = '';
    if (previewEl) {
      previewEl.src = '';
      previewEl.style.display = 'none';
    }
    if (previewContainer) {
      previewContainer.style.display = 'none';
    }
  }
}

// 🆕 保存用户在 UI 输入的截图区域宽高
function saveCaptureRegionSize() {
  if (currentRecordingCardIndex === -1) return;

  const bookmark = bookmarks[currentRecordingCardIndex];
  const widthInput = document.getElementById('captureRegionWidthInput');
  const heightInput = document.getElementById('captureRegionHeightInput');
  if (!widthInput || !heightInput) return;

  const width = parseInt(widthInput.value, 10);
  const height = parseInt(heightInput.value, 10);

  if (!width || width <= 0 || !height || height <= 0) {
    alert('请输入有效的宽度和高度（必须大于0）');
    return;
  }

  if (!bookmark.captureRegion) {
    bookmark.captureRegion = { x: 0, y: 0 };
  }
  bookmark.captureRegion.width = width;
  bookmark.captureRegion.height = height;

  saveBookmarksToStorage();
  updateCaptureRegionDisplay();

  showStatus(`✅ 截图区域大小已保存: ${width} × ${height}`, 'success');
}

// 🆕 录制截图区域（可视化框选）
async function recordCaptureRegion() {
  if (currentRecordingCardIndex === -1) return;

  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;

  if (!bookmark.window) {
    alert('请先录制「窗口设置」，再录制截图区域！\n\n截图区域使用窗口相对坐标，窗口移动后仍能准确定位。');
    return;
  }

  const confirmed = confirm(`即将录制「${appName}」的截图区域左上角\n\n1. 点击确定后会隐藏本窗口并激活目标 APP\n2. 把鼠标移到目标区域左上角（有 3 秒倒计时）\n3. 回到本窗口在右侧输入宽度和高度\n\n点击确定开始？`);
  if (!confirmed) return;

  // 隐藏当前窗口，避免遮挡目标 APP
  await window.electronAPI.minimizeMainWindow?.().catch(() => {});

  try {
    showStatus(`⏳ 请在 3 秒内把鼠标移到「${appName}」目标区域左上角...`, 'info');

    const result = await window.electronAPI.desktopAppSelectRegion({
      appName: bookmark.appName || bookmark.name,
      duration: 3
    });

    // 恢复窗口
    await window.electronAPI.restoreMainWindow?.().catch(() => {});

    if (!result.success) {
      showStatus(`❌ 截图区域录制取消: ${result.error}`, 'error');
      return;
    }

    // 将屏幕绝对坐标换算为窗口相对坐标
    const winX = bookmark.window.x || 0;
    const winY = bookmark.window.y || 0;
    const relativeX = result.point.x - winX;
    const relativeY = result.point.y - winY;

    if (!bookmark.captureRegion) {
      bookmark.captureRegion = {};
    }
    bookmark.captureRegion.x = relativeX;
    bookmark.captureRegion.y = relativeY;
    // 宽度和高度保留原值或由用户在UI上输入
    if (!bookmark.captureRegion.width) bookmark.captureRegion.width = 100;
    if (!bookmark.captureRegion.height) bookmark.captureRegion.height = 60;

    saveBookmarksToStorage();
    updateCaptureRegionDisplay();

    console.log(`[Renderer] 截图区域左上角录制完成: 相对(${relativeX}, ${relativeY})`);
    showStatus(`✅ 左上角已记录！请在右侧输入宽高并保存`, 'success');
  } catch (e) {
    await window.electronAPI.restoreMainWindow?.().catch(() => {});
    showStatus(`❌ 截图区域录制失败: ${e.message}`, 'error');
  }
}

// 🆕 截取当前设定的区域
async function captureCurrentRegion() {
  if (currentRecordingCardIndex === -1) return;

  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;

  if (!bookmark.window || !bookmark.captureRegion) {
    alert('尚未录制窗口设置或截图区域！');
    return;
  }

  const winX = bookmark.window.x || 0;
  const winY = bookmark.window.y || 0;
  const r = bookmark.captureRegion;
  const expectedX = winX + (r.x || 0);
  const expectedY = winY + (r.y || 0);
  const width = r.width || 0;
  const height = r.height || 0;

  if (width <= 0 || height <= 0) {
    alert('截图区域大小无效！');
    return;
  }

  const confirmed = confirm(`即将截取「${appName}」的设定区域\n\n预期屏幕坐标: (${Math.round(expectedX)}, ${Math.round(expectedY)})\n大小: ${width} × ${height}\n\n点击确定后会激活 APP，将游标移动到实际截图左上角停留 2 秒，然后再执行截图。`);
  if (!confirmed) return;

  showStatus(`⏳ 正在准备「${appName}」截图...`, 'info');

  try {
    // 截图前隐藏主窗口并激活 APP，确保截取到正确内容
    await window.electronAPI.minimizeMainWindow?.().catch(() => {});

    // 先预览：激活 APP、套用窗口设置、获取实际窗口位置、移动游标到截图左上角停留 2 秒
    showStatus(`🖱️ 游标将移动到截图左上角并停留 2 秒...`, 'info');
    const previewResult = await window.electronAPI.desktopAppPreviewCaptureRegion({
      appName,
      winX,
      winY,
      winWidth: bookmark.window.width,
      winHeight: bookmark.window.height,
      offsetX: r.x || 0,
      offsetY: r.y || 0,
      duration: 2
    });

    if (!previewResult.success) {
      throw new Error(previewResult.error || '预览截图区域失败');
    }

    const screenX = previewResult.x;
    const screenY = previewResult.y;
    console.log('[Renderer] 使用实际截图坐标:', { screenX, screenY, winPos: previewResult.winPos });
    showStatus(`⏳ 正在截取「${appName}」的设定区域...`, 'info');

    const result = await window.electronAPI.desktopAppCaptureRegion({
      x: screenX,
      y: screenY,
      width,
      height,
      filename: `region_${bookmark.id || currentRecordingCardIndex}_${Date.now()}.png`
    });

    if (result.success) {
      bookmark.captureRegion.imagePath = result.imagePath;
      bookmark.captureRegion.base64 = result.base64;
      bookmark.captureRegion.lastCaptureTime = Date.now();
      await saveBookmarksToStorage();
      updateCaptureRegionDisplay();

      // 自动滚动到预览区域并高亮提示
      const previewContainer = document.getElementById('captureRegionPreviewContainer');
      if (previewContainer) {
        previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        previewContainer.style.animation = 'none';
        previewContainer.offsetHeight; // 触发重绘
        previewContainer.style.animation = 'pulse-green 1.5s ease-in-out 2';
      }

      showStatus(`✅ 截图成功！实际左上角: (${Math.round(screenX)}, ${Math.round(screenY)})`, 'success');
      console.log('[Renderer] 区域截图成功:', result.imagePath);
    } else {
      showStatus(`❌ 截图失败: ${result.error}`, 'error');
      console.error('[Renderer] 区域截图失败:', result.error);
    }
  } catch (e) {
    showStatus(`❌ 截图失败: ${e.message}`, 'error');
  } finally {
    await window.electronAPI.restoreMainWindow?.().catch(() => {});
  }
}

// 🆕 预览最近一次截图
async function previewCaptureRegion() {
  if (currentRecordingCardIndex === -1) return;

  const bookmark = bookmarks[currentRecordingCardIndex];
  if (!bookmark.captureRegion || !bookmark.captureRegion.base64) {
    alert('暂无截图预览，请先点击「截取当前区域」！');
    return;
  }

  // 打开新窗口预览完整尺寸图片
  const previewWindow = window.open('', '_blank', 'width=900,height=700,menubar=no,toolbar=no,location=no,status=no');
  if (previewWindow) {
    previewWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>截图预览</title>
        <style>
          body { margin: 0; padding: 20px; background: #1e293b; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
          h3 { color: #fff; margin: 0 0 12px; font-size: 14px; font-weight: 500; }
          img { max-width: 100%; max-height: calc(100vh - 80px); border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); background: #fff; }
          .info { color: #94a3b8; font-size: 12px; margin-top: 12px; }
        </style>
      </head>
      <body>
        <h3>截图区域预览</h3>
        <img src="${bookmark.captureRegion.base64}" alt="截图预览">
        <div class="info">${Math.round(bookmark.captureRegion.width || 0)} × ${Math.round(bookmark.captureRegion.height || 0)} px</div>
      </body>
      </html>
    `);
    previewWindow.document.close();
  } else {
    // 弹窗被拦截，回退到当前页面显示
    const previewContainer = document.getElementById('captureRegionPreviewContainer');
    if (previewContainer) {
      previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

async function startRecordingAnchors() {
  if (currentRecordingCardIndex === -1 || currentSelectedAnchorId === null) {
    alert('请先选择一个要录制的定位点！');
    return;
  }
  
  const anchors = initAnchorsForCard(currentRecordingCardIndex);
  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;
  const anchor = anchors.find(a => a.id === currentSelectedAnchorId);
  
  if (!anchor) {
    alert('选中的定位点不存在！');
    return;
  }
  
  const confirmed = confirm(`即将录制「定位点${anchor.id}: ${anchor.name}」\n\n1. 点击确定后会自动打开 ${appName}\n2. 请在5秒内将游标移动到目标位置\n\n点击确定开始录制？`);
  if (!confirmed) return;
  
  const progressDiv = document.getElementById('recordingProgress');
  const statusEl = document.getElementById('recordingStatus');
  const barEl = document.getElementById('recordingProgressBar');
  const countdownEl = document.getElementById('recordingCountdown');
  
  progressDiv.style.display = 'block';
  statusEl.textContent = `⏳ 正在录制「定位点${anchor.id}: ${anchor.name}」...`;
  barEl.style.width = '0%';
  
  let countdown = 5;
  countdownEl.textContent = `${countdown}秒`;
  
  const countdownInterval = setInterval(() => {
    countdown--;
    countdownEl.textContent = `${countdown}秒`;
    barEl.style.width = `${((5 - countdown) / 5) * 100}%`;
    if (countdown <= 0) clearInterval(countdownInterval);
  }, 1000);
  
  showStatus(`⏳ 正在录制「定位点${anchor.id}: ${anchor.name}」，5秒内移动游标...`, 'info');
  
  try {
    const result = await window.electronAPI.desktopAppRecordAnchor({
      appName: appName,
      delay: 5
    });
    
    clearInterval(countdownInterval);
    barEl.style.width = '100%';
    
    if (result.success) {
      anchor.offsetX = result.offsetX;
      anchor.offsetY = result.offsetY;
      anchor.enabled = true;
      
      if (!bookmark.window) {
        bookmark.window = { width: 950, height: 920, x: 0, y: 0 };
      }
      bookmark.window.width = result.winWidth || 950;
      bookmark.window.height = result.winHeight || 920;
      
      saveBookmarksToStorage();
      renderAnchorList(currentRecordingCardIndex);
      updateAnchorDetail();
      
      console.log(`[Renderer] 定位点${anchor.id}录制完成: (${result.offsetX}, ${result.offsetY})`);
      statusEl.textContent = `✅ 录制成功！定位点${anchor.id}: ${anchor.name} (${Math.round(result.offsetX)}, ${Math.round(result.offsetY)})`;
      statusEl.style.color = '#22c55e';
      countdownEl.textContent = '';
      
      showStatus(`✅ 定位点${anchor.id} - ${anchor.name} 录制成功！`, 'success');
      
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.color = '';
        barEl.style.width = '0%';
      }, 3000);
    } else {
      statusEl.textContent = `❌ 录制失败: ${result.error}`;
      statusEl.style.color = '#dc2626';
      showStatus(`❌ 定位点${anchor.id}录制失败: ${result.error}`, 'error');
    }
  } catch (e) {
    clearInterval(countdownInterval);
    statusEl.textContent = `❌ 录制失败: ${e.message}`;
    statusEl.style.color = '#dc2626';
    showStatus(`❌ 定位点${anchor.id}录制失败: ${e.message}`, 'error');
  }
}

async function replaySingleAnchor() {
  if (currentRecordingCardIndex === -1 || currentSelectedAnchorId === null) {
    alert('请先选择一个要回放的定位点！');
    return;
  }
  
  const anchors = initAnchorsForCard(currentRecordingCardIndex);
  const bookmark = bookmarks[currentRecordingCardIndex];
  const appName = bookmark.appName || bookmark.name;
  const anchor = anchors.find(a => a.id === currentSelectedAnchorId);
  
  if (!anchor) {
    alert('选中的定位点不存在！');
    return;
  }
  
  if (anchor.offsetX === 0 && anchor.offsetY === 0) {
    alert(`定位点${anchor.id}尚未录制，请先录制！`);
    return;
  }
  
  const confirmed = confirm(`即将回放「定位点${anchor.id}: ${anchor.name}」\n\n坐标: (${Math.round(anchor.offsetX)}, ${Math.round(anchor.offsetY)})\n\n点击确定后，游标会移动到该位置并停留2秒。\n\n点击确定开始回放？`);
  if (!confirmed) return;
  
  showStatus(`🔄 正在回放「定位点${anchor.id}: ${anchor.name}」...`, 'info');
  
  try {
    const result = await window.electronAPI.desktopAppReplayAnchor({
      appName: appName,
      offsetX: anchor.offsetX,
      offsetY: anchor.offsetY,
      winWidth: (bookmark.window && bookmark.window.width) || 950,
      winHeight: (bookmark.window && bookmark.window.height) || 920,
      duration: 2
    });
    
    if (result.success) {
      showStatus(`✅ 定位点${anchor.id} - ${anchor.name} 回放成功！`, 'success');
    } else {
      showStatus(`❌ 定位点${anchor.id}回放失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 定位点${anchor.id}回放失败: ${e.message}`, 'error');
  }
}

async function appMenuRecordAnchors(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;
  
  currentRecordingCardIndex = index;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  
  console.log(`[Renderer] 📍 录制定位点: ${appName}`);
  
  initAnchorsForCard(index);
  
  const modal = document.getElementById('anchorRecordModal');
  const title = document.getElementById('anchorRecordModalTitle');
  title.textContent = `📍 录制定位点 - ${bookmark.name}`;
  
  renderAnchorList(index);
  currentSelectedAnchorId = 1;
  updateAnchorDetail();
  updateWindowDisplay();
  updateCaptureRegionDisplay();

  modal.style.display = 'flex';
}

// ========== 自动化脚本设定作业 ==========

let currentScriptCardIndex = -1;
let currentEditingScriptId = null;

function addMessageRow() {
  const tbody = document.getElementById('messagePoolTableBody');
  const rowCount = tbody.children.length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">${rowCount}</td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="message-type-select" onchange="handleMessageTypeChange(this)">
        <option value="text">文字</option>
        <option value="file">文件</option>
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="text" class="message-content-input" placeholder="输入消息内容或文件路径" style="width: calc(100% - 70px); padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
      <button onclick="selectMessageFile(this)" style="padding: 2px 4px; font-size: 10px; border: none; background: #3b82f6; color: white; border-radius: 2px; cursor: pointer; margin-left: 4px;">选择</button>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 2px 4px; text-align: center;">
      <button onclick="previewMessageFile(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #10b981; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">👁</button>
      <button onclick="removeMessageRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #ef4444; color: white; border-radius: 2px; cursor: pointer;">×</button>
    </td>
  `;
  tbody.appendChild(tr);
  updateMessageRowNumbers();
}

function removeMessageRow(btn) {
  const tbody = document.getElementById('messagePoolTableBody');
  if (tbody.children.length <= 1) {
    alert('至少保留一条消息');
    return;
  }
  btn.closest('tr').remove();
  updateMessageRowNumbers();
}

function updateMessageRowNumbers() {
  const tbody = document.getElementById('messagePoolTableBody');
  Array.from(tbody.children).forEach((tr, i) => {
    tr.querySelector('td:first-child').textContent = i + 1;
  });
}

async function previewMessageFile(btn) {
  const row = btn.closest('tr');
  const typeSelect = row.querySelector('.message-type-select');
  const type = typeSelect.value;
  const content = row.querySelector('.message-content-input').value.trim();
  
  if (!content) {
    alert('请填写文件路径');
    return;
  }
  
  if (type !== 'file') {
    const isFilePath = content.startsWith('/') || content.match(/^[a-zA-Z]:\\/);
    if (!isFilePath) {
      alert('当前类型不是文件，请先切换为文件类型');
      return;
    }
    typeSelect.value = 'file';
    console.log('[Renderer] 自动切换类型为文件');
  }
  
  try {
    const result = await window.electronAPI.previewFile(content);
    if (result.success) {
      alert(`✅ 文件预览成功！\n\n文件名: ${content.split('/').pop()}\n大小: ${result.info.sizeFormatted}`);
      console.log('[Renderer] 文件预览成功:', result.info);
    } else {
      alert(`❌ 文件预览失败: ${result.error}`);
    }
  } catch (e) {
    alert(`❌ 文件预览失败: ${e.message}`);
  }
}

function clearMessagePool() {
  const tbody = document.getElementById('messagePoolTableBody');
  tbody.innerHTML = `
    <tr>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">1</td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <select class="message-type-select" onchange="handleMessageTypeChange(this)">
          <option value="text">文字</option>
          <option value="file">文件</option>
        </select>
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <input type="text" class="message-content-input" placeholder="输入消息内容或文件路径" style="width: calc(100% - 70px); padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
        <button onclick="selectMessageFile(this)" style="padding: 2px 4px; font-size: 10px; border: none; background: #3b82f6; color: white; border-radius: 2px; cursor: pointer; margin-left: 4px;">选择</button>
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 2px 4px; text-align: center;">
        <button onclick="removeMessageRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #ef4444; color: white; border-radius: 2px; cursor: pointer;">×</button>
      </td>
    </tr>
  `;
}

function handleMessageTypeChange(select) {
  const row = select.closest('tr');
  const input = row.querySelector('.message-content-input');
  if (select.value === 'file') {
    input.placeholder = '点击右侧按钮选择文件';
  } else {
    input.placeholder = '输入消息内容';
  }
}

async function selectMessageFile(btn) {
  const row = btn.closest('tr');
  const input = row.querySelector('.message-content-input');
  const typeSelect = row.querySelector('.message-type-select');
  try {
    const result = await window.electronAPI.openFileDialog({
      title: '选择文件',
      properties: ['openFile']
    });
    if (result.filePaths && result.filePaths.length > 0) {
      input.value = result.filePaths[0];
      if (typeSelect) {
        typeSelect.value = 'file';
      }
    }
  } catch (e) {
    console.error('选择文件失败:', e);
  }
}

function pairMessageWithCmdV() {
  const messageRows = document.querySelectorAll('#messagePoolTableBody tr');
  const actionRows = document.querySelectorAll('#scriptActionTableBody tr');
  
  const messages = [];
  messageRows.forEach(row => {
    const type = row.querySelector('.message-type-select').value;
    const content = row.querySelector('.message-content-input').value.trim();
    if (content) {
      messages.push({ type, content });
    }
  });
  
  let messageIndex = 0;
  let skippedCmdVCount = 0;
  actionRows.forEach(row => {
    const keyboardSelect = row.querySelector('.keyboard-select');
    const pasteInput = row.querySelector('.paste-content-input');
    const disabledCheckbox = row.querySelector('.disabled-checkbox');
    if (keyboardSelect && pasteInput && keyboardSelect.value === 'cmd+v') {
      if (messageIndex < messages.length) {
        const msg = messages[messageIndex];
        pasteInput.value = msg.type === 'file' ? `[文件] ${msg.content}` : msg.content;
        pasteInput.style.display = '';
        if (disabledCheckbox) {
          disabledCheckbox.checked = false;
        }
        messageIndex++;
      } else {
        if (disabledCheckbox) {
          disabledCheckbox.checked = true;
        }
        pasteInput.value = '';
        pasteInput.style.display = 'none';
        skippedCmdVCount++;
      }
    }
  });
  
  let alertMsg = `已配对 ${messageIndex} 条消息到 Cmd+V 步骤！`;
  if (skippedCmdVCount > 0) {
    alertMsg += `\n${skippedCmdVCount} 个多余的 Cmd+V 动作已自动停用！`;
  }
  alert(alertMsg);
  parseScriptLive();
}

function initScriptsForCard(index) {
  return getCardScripts(index);
}

function generateScriptId() {
  return 'script_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function parseNaturalLanguageScript(text) {
  const lines = text.split('\n');
  const steps = [];
  const errors = [];

  const modifierMap = {
    'Cmd': 'command',
    'Shift': 'shift',
    'Ctrl': 'control',
    'Alt': 'option'
  };

  const keyMap = {
    'Enter': String.fromCharCode(13),
    'ESC': String.fromCharCode(27),
    'Tab': '\t',
    'Space': ' '
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    if (line === '' || line.startsWith('#')) continue;

    let matched = false;

    // 规则1: 开启APP
    if (/^开启APP$/.test(line)) {
      steps.push({ action: 'activateApp' });
      matched = true;
    }

    // 规则2: 设定窗口大小
    if (!matched) {
      const m = line.match(/^设定窗口大小为\s*(\d+)\s*[x×]\s*(\d+)/);
      if (m) {
        steps.push({ action: 'setWindow', width: parseInt(m[1]), height: parseInt(m[2]) });
        matched = true;
      }
    }

    // 规则3: 将窗口移到
    if (!matched) {
      const m = line.match(/^将窗口移到屏幕\s*(\d+)\s*[,，]\s*(\d+)/);
      if (m) {
        steps.push({ action: 'setWindowPos', x: parseInt(m[1]), y: parseInt(m[2]) });
        matched = true;
      }
    }

    // 规则4: 移到定位点 + 按左键（完整格式）
    if (!matched) {
      const m = line.match(/^将游标移动?到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*按一下鼠标左键/);
      if (m) {
        steps.push({ action: 'moveAndClick', anchorId: parseInt(m[1]) });
        matched = true;
      }
    }

    // 规则4b: 移到定位点（简化格式，默认执行点击）
    if (!matched) {
      const m = line.match(/^将游标移动?到\s*定位点(\d+)/);
      if (m) {
        steps.push({ action: 'moveAndClick', anchorId: parseInt(m[1]) });
        matched = true;
      }
    }

    // 规则5: 移到定位点 + 停N秒
    if (!matched) {
      const m = line.match(/^将游标移动?到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*停\s*([\d.]+)\s*秒/);
      if (m) {
        steps.push({ action: 'moveAndHover', anchorId: parseInt(m[1]), duration: parseFloat(m[2]) });
        matched = true;
      }
    }

    // 规则6: 移到定位点 + 滚动向下N次
    if (!matched) {
      const m = line.match(/^将游标移动?到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*滚动画面内容向下\s*(\d+)\s*次/);
      if (m) {
        steps.push({ action: 'moveAndScroll', anchorId: parseInt(m[1]), times: parseInt(m[2]) });
        matched = true;
      }
    }

    // 规则7: 按键盘 组合键
    if (!matched) {
      const m = line.match(/^按键盘\s*(Cmd|Shift|Ctrl|Alt)\+([\w]+)/);
      if (m) {
        const mod = modifierMap[m[1]] || m[1].toLowerCase();
        let key = m[2].toLowerCase();
        if (keyMap[m[2]]) key = keyMap[m[2]];
        steps.push({ action: 'keystroke', key: key, modifiers: [mod] });
        matched = true;
      }
    }

    // 规则8: 按键盘 单键
    if (!matched) {
      const m = line.match(/^按键盘\s*(Enter|ESC|Tab|Space)/);
      if (m) {
        steps.push({ action: 'keystroke', key: keyMap[m[1]] || m[1].toLowerCase() });
        matched = true;
      }
    }

    // 规则9: 等待N秒
    if (!matched) {
      const m = line.match(/^等待\s*([\d.]+)\s*秒/);
      if (m) {
        steps.push({ action: 'delay', seconds: parseFloat(m[1]) });
        matched = true;
      }
    }

    // 规则10: 粘贴剪贴板内容
    if (!matched && /^粘贴剪贴板内容$/.test(line)) {
      steps.push({ action: 'clipboardPaste' });
      matched = true;
    }

    // 规则11: 复制选中内容到剪贴板
    if (!matched && /^复制选中内容到剪贴板$/.test(line)) {
      steps.push({ action: 'clipboardCopy' });
      matched = true;
    }

    if (!matched) {
      errors.push(`第${lineNum}行无法解析: ${line}`);
    }
  }

  return { steps, errors };
}

function generateJxaCode(bundleName, anchors, windowSettings, steps) {
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
  code += `if (!win) { throw new Error('error: 无法获取窗口'); }\n\n`;
  code += `// 确保窗口有焦点\n`;
  code += `proc.frontmost = true;\n`;
  code += `delay(0.3);\n\n`;

  let hasImportedObjC = false;
  const importObjC = `ObjC.import('CoreGraphics');\nObjC.import('AppKit');\nObjC.import('Foundation');\n`;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    code += `// Step ${i + 1}: ${step.action}\n`;

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
          code += `var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft);\n`;
          code += `$.CGEventPost($.kCGHIDEventTap, down);\ndelay(0.1);\n`;
          code += `var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft);\n`;
          code += `$.CGEventPost($.kCGHIDEventTap, up);\ndelay(0.3);\n`;
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
        if (step.pasteContent && mods.includes('cmd') && key === 'v') {
          code += `// 剪贴板内容将在执行前设置\n`;
          code += `// ${step.pasteContent.substring(0, 50)}${step.pasteContent.length > 50 ? '...' : ''}\n`;
        }
        if (mods.length > 0) {
          const jxaMods = mods.map(m => {
            const map = { 'cmd': 'command', 'ctrl': 'control', 'shift': 'shift', 'alt': 'option' };
            return map[m] || m;
          });
          const modStr = jxaMods.map(m => m + ' down').join('\', \'');
          if (keyCodeMap[key] !== undefined) {
            code += `se.keyCode(${keyCodeMap[key]}, {using: ['${modStr}']});\n`;
          } else {
            code += `se.keystroke('${key}', {using: ['${modStr}']});\n`;
          }
        } else {
          if (keyCodeMap[key] !== undefined) {
            code += `se.keyCode(${keyCodeMap[key]});\n`;
          } else {
            code += `se.keystroke('${key}');\n`;
          }
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
      default:
        code += `// 未知动作: ${step.action}\n`;
    }
    code += `\n`;
  }

  code += `'success';\n`;
  return code;
}

function parseScriptLive() {
  const rows = document.querySelectorAll('#scriptActionTableBody tr');
  const steps = [];
  const errors = [];

  rows.forEach((row, index) => {
    const disabledCheckbox = row.querySelector('.disabled-checkbox');
    if (disabledCheckbox && disabledCheckbox.checked) {
      return;
    }

    const anchorSelect = row.querySelector('.anchor-select');
    const mouseSelect = row.querySelector('.mouse-select');
    const keyboardSelect = row.querySelector('.keyboard-select');
    const waitInput = row.querySelector('.wait-input');
    const noteInput = row.querySelector('.note-input');

    const anchorId = anchorSelect ? parseInt(anchorSelect.value) : null;
    const mouseAction = mouseSelect ? mouseSelect.value : '';
    const keyboardAction = keyboardSelect ? keyboardSelect.value : '';
    const waitMs = waitInput ? parseInt(waitInput.value) || 0 : 0;

    const hasAnchor = anchorId !== null && anchorId > 0;
    const hasMouse = mouseAction && mouseAction !== '';
    const hasKeyboard = keyboardAction && keyboardAction !== '';

    let actionType = null;
    let actionData = {};

    if (hasAnchor && !hasMouse && !hasKeyboard) {
      actionType = 'moveAndClick';
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      actionData = { anchorId: anchorId, noClick: true };
      if (anchor && anchor.isCopyButton) {
        actionData.isCopyButton = true;
      }
    } else if (hasMouse && !hasAnchor && !hasKeyboard) {
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, explicitClick: true };
          break;
        case 'right':
          actionType = 'keystroke';
          actionData = { key: 'button', modifiers: ['control'] };
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, doubleClick: true };
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId || 0, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId || 0, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (hasKeyboard && !hasAnchor && !hasMouse) {
      const parts = keyboardAction.split('+');
      const pasteContentInput = row.querySelector('.paste-content-input');
      const pasteContent = pasteContentInput ? pasteContentInput.value : '';
      if (parts.length === 2) {
        actionType = 'keystroke';
        actionData = { key: parts[1], modifiers: [parts[0]] };
        if (parts[0] === 'cmd' && parts[1] === 'v' && pasteContent && pasteContent.trim() !== '') {
          actionData.pasteContent = pasteContent.trim();
        }
      } else {
        actionType = 'keystroke';
        actionData = { key: keyboardAction };
      }
    } else if (hasAnchor && hasMouse && !hasKeyboard) {
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, explicitClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'right':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, rightClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, doubleClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (!hasAnchor && !hasMouse && !hasKeyboard) {
      if (waitMs > 0) {
        actionType = 'delay';
        actionData = { seconds: waitMs / 1000 };
      }
    }

    if (actionType) {
      steps.push({ action: actionType, ...actionData });
      
      if (waitMs > 0 && actionType !== 'moveAndHover' && actionType !== 'delay') {
        steps.push({ action: 'delay', seconds: waitMs / 1000 });
      }
    }
  });

  const scriptName = document.getElementById('scriptName').value || '未命名脚本';
  const jsonObj = {
    name: scriptName,
    steps: steps
  };

  document.getElementById('scriptJsonPreview').textContent = JSON.stringify(jsonObj, null, 2);
  showJxaCode();
  document.getElementById('scriptParseErrors').style.display = 'none';
}

function addActionRow() {
  const tbody = document.getElementById('scriptActionTableBody');
  const rows = tbody.querySelectorAll('tr');
  const newIndex = rows.length + 1;

  const anchors = getAnchorsForCard(currentScriptCardIndex);
  let anchorOptions = '<option value="">-- 无 --</option>';
  anchors.forEach(a => {
    if (a.enabled) {
      anchorOptions += `<option value="${a.id}">定位点${a.id}: ${a.name}</option>`;
    }
  });

  const row = document.createElement('tr');
  row.innerHTML = `
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">${newIndex}</td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">
      <input type="checkbox" class="disabled-checkbox" onchange="parseScriptLive()">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="anchor-select" onchange="handleActionFieldChange(this)">
        ${anchorOptions}
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="mouse-select" onchange="handleActionFieldChange(this)">
        <option value="">-- 无 --</option>
        <optgroup label="点击操作">
          <option value="left">左键点击</option>
          <option value="right">右键点击</option>
          <option value="double">双击</option>
        </optgroup>
        <optgroup label="移动操作">
          <option value="hover">悬停</option>
        </optgroup>
        <optgroup label="向上滑动">
          <option value="scrollUp_5">向上滑动 5次</option>
          <option value="scrollUp_10">向上滑动 10次</option>
          <option value="scrollUp_20">向上滑动 20次</option>
          <option value="scrollUp_50">向上滑动 50次</option>
          <option value="scrollUp_200">向上滑动 200次</option>
        </optgroup>
        <optgroup label="向下滑动">
          <option value="scrollDown_5">向下滑动 5次</option>
          <option value="scrollDown_10">向下滑动 10次</option>
          <option value="scrollDown_20">向下滑动 20次</option>
          <option value="scrollDown_50">向下滑动 50次</option>
          <option value="scrollDown_200">向下滑动 200次</option>
        </optgroup>
        <optgroup label="向左滚动">
          <option value="scrollLeft_5">向左滚动 5次</option>
          <option value="scrollLeft_10">向左滚动 10次</option>
          <option value="scrollLeft_20">向左滚动 20次</option>
          <option value="scrollLeft_50">向左滚动 50次</option>
          <option value="scrollLeft_200">向左滚动 200次</option>
        </optgroup>
        <optgroup label="向右滚动">
          <option value="scrollRight_5">向右滚动 5次</option>
          <option value="scrollRight_10">向右滚动 10次</option>
          <option value="scrollRight_20">向右滚动 20次</option>
          <option value="scrollRight_50">向右滚动 50次</option>
          <option value="scrollRight_200">向右滚动 200次</option>
        </optgroup>
        <optgroup label="滚轮向上">
          <option value="scrollWheelUp_5">滚轮向上 5次</option>
          <option value="scrollWheelUp_10">滚轮向上 10次</option>
          <option value="scrollWheelUp_20">滚轮向上 20次</option>
          <option value="scrollWheelUp_50">滚轮向上 50次</option>
          <option value="scrollWheelUp_200">滚轮向上 200次</option>
        </optgroup>
        <optgroup label="滚轮向下">
          <option value="scrollWheelDown_5">滚轮向下 5次</option>
          <option value="scrollWheelDown_10">滚轮向下 10次</option>
          <option value="scrollWheelDown_20">滚轮向下 20次</option>
          <option value="scrollWheelDown_50">滚轮向下 50次</option>
          <option value="scrollWheelDown_200">滚轮向下 200次</option>
        </optgroup>
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="keyboard-select" onchange="handleActionFieldChange(this)">
        <option value="">-- 无 --</option>
        <optgroup label="基础按键">
          <option value="enter">Enter</option>
          <option value="escape">ESC</option>
          <option value="tab">Tab</option>
          <option value="space">空格</option>
          <option value="backspace">Backspace</option>
          <option value="delete">Delete</option>
          <option value="return">Return</option>
        </optgroup>
        <optgroup label="功能键">
          <option value="f1">F1</option>
          <option value="f2">F2</option>
          <option value="f3">F3</option>
          <option value="f4">F4</option>
          <option value="f5">F5</option>
          <option value="f6">F6</option>
          <option value="f7">F7</option>
          <option value="f8">F8</option>
          <option value="f9">F9</option>
          <option value="f10">F10</option>
          <option value="f11">F11</option>
          <option value="f12">F12</option>
        </optgroup>
        <optgroup label="组合键">
          <option value="cmd+a">Cmd+A</option>
          <option value="cmd+c">Cmd+C</option>
          <option value="cmd+v">Cmd+V</option>
          <option value="cmd+x">Cmd+X</option>
          <option value="cmd+s">Cmd+S</option>
          <option value="cmd+f">Cmd+F</option>
          <option value="cmd+z">Cmd+Z</option>
          <option value="shift+tab">Shift+Tab</option>
          <option value="shift+enter">Shift+Enter</option>
        </optgroup>
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="text" class="paste-content-input" placeholder="C+V内容" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px; display: none;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="number" class="wait-input" placeholder="0" min="0" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="text" class="note-input" placeholder="备注" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 2px 4px; text-align: center; white-space: nowrap;">
      <button onclick="previewActionFile(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #10b981; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">👁</button>
      <button onclick="insertActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #3b82f6; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">+</button>
      <button onclick="removeActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #ef4444; color: white; border-radius: 2px; cursor: pointer;">×</button>
    </td>
  `;
  tbody.appendChild(row);
  parseScriptLive();
}

function removeActionRow(btn) {
  const tbody = document.getElementById('scriptActionTableBody');
  const rows = tbody.querySelectorAll('tr');
  if (rows.length <= 1) {
    alert('至少保留一行！');
    return;
  }
  btn.closest('tr').remove();
  renumberActionRows();
  parseScriptLive();
}

async function previewActionFile(btn) {
  const row = btn.closest('tr');
  const pasteInput = row.querySelector('.paste-content-input');
  const content = pasteInput ? pasteInput.value.trim() : '';
  
  if (!content) {
    alert('请先填写C+V内容');
    return;
  }
  
  if (!content.startsWith('[文件]')) {
    alert('当前不是文件类型，请先在讯息池中选择文件并配对');
    return;
  }
  
  const filePath = content.replace(/^\[文件\]/, '').trim();
  
  try {
    const result = await window.electronAPI.previewFile(filePath);
    if (result.success) {
      alert(`✅ 文件预览成功！\n\n文件名: ${filePath.split('/').pop()}\n大小: ${result.info.sizeFormatted}`);
    } else {
      alert(`❌ 文件预览失败: ${result.error}`);
    }
  } catch (e) {
    alert(`❌ 文件预览失败: ${e.message}`);
  }
}

function insertActionRow(btn) {
  const tbody = document.getElementById('scriptActionTableBody');
  const currentRow = btn.closest('tr');
  const rows = tbody.querySelectorAll('tr');
  const currentIndex = Array.from(rows).indexOf(currentRow);
  
  const anchors = getAnchorsForCard(currentScriptCardIndex);
  let anchorOptions = '<option value="">-- 无 --</option>';
  anchors.forEach(a => {
    if (a.enabled) {
      anchorOptions += `<option value="${a.id}">定位点${a.id}: ${a.name}</option>`;
    }
  });

  const newRow = document.createElement('tr');
  newRow.innerHTML = `
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">${currentIndex + 2}</td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">
      <input type="checkbox" class="disabled-checkbox" onchange="parseScriptLive()">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="anchor-select" onchange="handleActionFieldChange(this)">
        ${anchorOptions}
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="mouse-select" onchange="handleActionFieldChange(this)">
        <option value="">-- 无 --</option>
        <optgroup label="点击操作">
          <option value="left">左键点击</option>
          <option value="right">右键点击</option>
          <option value="double">双击</option>
        </optgroup>
        <optgroup label="移动操作">
          <option value="hover">悬停</option>
        </optgroup>
        <optgroup label="向上滑动">
          <option value="scrollUp_5">向上滑动 5次</option>
          <option value="scrollUp_10">向上滑动 10次</option>
          <option value="scrollUp_20">向上滑动 20次</option>
          <option value="scrollUp_50">向上滑动 50次</option>
          <option value="scrollUp_200">向上滑动 200次</option>
        </optgroup>
        <optgroup label="向下滑动">
          <option value="scrollDown_5">向下滑动 5次</option>
          <option value="scrollDown_10">向下滑动 10次</option>
          <option value="scrollDown_20">向下滑动 20次</option>
          <option value="scrollDown_50">向下滑动 50次</option>
          <option value="scrollDown_200">向下滑动 200次</option>
        </optgroup>
        <optgroup label="向左滚动">
          <option value="scrollLeft_5">向左滚动 5次</option>
          <option value="scrollLeft_10">向左滚动 10次</option>
          <option value="scrollLeft_20">向左滚动 20次</option>
          <option value="scrollLeft_50">向左滚动 50次</option>
          <option value="scrollLeft_200">向左滚动 200次</option>
        </optgroup>
        <optgroup label="向右滚动">
          <option value="scrollRight_5">向右滚动 5次</option>
          <option value="scrollRight_10">向右滚动 10次</option>
          <option value="scrollRight_20">向右滚动 20次</option>
          <option value="scrollRight_50">向右滚动 50次</option>
          <option value="scrollRight_200">向右滚动 200次</option>
        </optgroup>
        <optgroup label="滚轮向上">
          <option value="scrollWheelUp_5">滚轮向上 5次</option>
          <option value="scrollWheelUp_10">滚轮向上 10次</option>
          <option value="scrollWheelUp_20">滚轮向上 20次</option>
          <option value="scrollWheelUp_50">滚轮向上 50次</option>
          <option value="scrollWheelUp_200">滚轮向上 200次</option>
        </optgroup>
        <optgroup label="滚轮向下">
          <option value="scrollWheelDown_5">滚轮向下 5次</option>
          <option value="scrollWheelDown_10">滚轮向下 10次</option>
          <option value="scrollWheelDown_20">滚轮向下 20次</option>
          <option value="scrollWheelDown_50">滚轮向下 50次</option>
          <option value="scrollWheelDown_200">滚轮向下 200次</option>
        </optgroup>
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <select class="keyboard-select" onchange="handleActionFieldChange(this)">
        <option value="">-- 无 --</option>
        <optgroup label="基础按键">
          <option value="enter">Enter</option>
          <option value="escape">ESC</option>
          <option value="tab">Tab</option>
          <option value="space">空格</option>
          <option value="backspace">Backspace</option>
          <option value="delete">Delete</option>
          <option value="return">Return</option>
        </optgroup>
        <optgroup label="功能键">
          <option value="f1">F1</option>
          <option value="f2">F2</option>
          <option value="f3">F3</option>
          <option value="f4">F4</option>
          <option value="f5">F5</option>
          <option value="f6">F6</option>
          <option value="f7">F7</option>
          <option value="f8">F8</option>
          <option value="f9">F9</option>
          <option value="f10">F10</option>
          <option value="f11">F11</option>
          <option value="f12">F12</option>
        </optgroup>
        <optgroup label="组合键">
          <option value="cmd+a">Cmd+A</option>
          <option value="cmd+c">Cmd+C</option>
          <option value="cmd+v">Cmd+V</option>
          <option value="cmd+x">Cmd+X</option>
          <option value="cmd+s">Cmd+S</option>
          <option value="cmd+f">Cmd+F</option>
          <option value="cmd+z">Cmd+Z</option>
          <option value="shift+tab">Shift+Tab</option>
          <option value="shift+enter">Shift+Enter</option>
        </optgroup>
      </select>
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="text" class="paste-content-input" placeholder="C+V内容" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px; display: none;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="number" class="wait-input" placeholder="0" min="0" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
      <input type="text" class="note-input" placeholder="备注" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
    </td>
    <td style="border: 1px solid #cbd5e1; padding: 2px 4px; text-align: center; white-space: nowrap;">
      <button onclick="previewActionFile(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #10b981; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">👁</button>
      <button onclick="insertActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #3b82f6; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">+</button>
      <button onclick="removeActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #ef4444; color: white; border-radius: 2px; cursor: pointer;">×</button>
    </td>
  `;

  currentRow.insertAdjacentElement('afterend', newRow);
  renumberActionRows();
  parseScriptLive();
}

function renumberActionRows() {
  const tbody = document.getElementById('scriptActionTableBody');
  const rows = tbody.querySelectorAll('tr');
  rows.forEach((row, index) => {
    row.querySelector('td:first-child').textContent = index + 1;
  });
}

function clearActionTable(confirmRequired = true) {
  if (confirmRequired && !confirm('确定要清空所有动作吗？')) return;
  const tbody = document.getElementById('scriptActionTableBody');
  tbody.innerHTML = '';
  addActionRow();
}

function handleActionFieldChange(select) {
  const row = select.closest('tr');
  const anchorSelect = row.querySelector('.anchor-select');
  const mouseSelect = row.querySelector('.mouse-select');
  const keyboardSelect = row.querySelector('.keyboard-select');
  const pasteContentInput = row.querySelector('.paste-content-input');

  const hasAnchor = anchorSelect.value !== '';
  const hasMouse = mouseSelect.value !== '';
  const hasKeyboard = keyboardSelect.value !== '';

  if (select === anchorSelect && hasAnchor) {
    mouseSelect.value = '';
    keyboardSelect.value = '';
    
    const anchors = getAnchorsForCard(currentScriptCardIndex);
    const anchorId = parseInt(anchorSelect.value);
    const anchor = anchors.find(a => a.id === anchorId);
    if (anchor && anchor.isCopyButton) {
      row.style.backgroundColor = '#eff6ff';
      row.title = 'isCopyButton: true';
    } else {
      row.style.backgroundColor = '';
      row.title = '';
    }
  } else if (select === mouseSelect && hasMouse) {
    keyboardSelect.value = '';
    row.style.backgroundColor = '';
    row.title = '';
  } else if (select === keyboardSelect && hasKeyboard) {
    mouseSelect.value = '';
    if (!hasMouse) {
      anchorSelect.value = '';
    }
    row.style.backgroundColor = '';
    row.title = '';
  }

  if (pasteContentInput) {
    if (keyboardSelect.value === 'cmd+v') {
      pasteContentInput.style.display = '';
    } else {
      pasteContentInput.style.display = 'none';
      pasteContentInput.value = '';
    }
  }

  parseScriptLive();
}

function getAnchorsForCard(cardIndex) {
  if (cardIndex < 0 || cardIndex >= bookmarks.length) return [];
  const card = bookmarks[cardIndex];
  if (!card.anchors) {
    card.anchors = [
      { id: 1, name: '窗口中心', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 2, name: '输入框', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 3, name: '复制按钮', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 4, name: 'Markdown项', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 5, name: '输入区焦点', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 6, name: '预留', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 7, name: '预留', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 8, name: '预留', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 9, name: '预留', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false },
      { id: 10, name: '预留', offsetX: 0, offsetY: 0, enabled: false, isCopyButton: false }
    ];
  }
  // 确保已有定位点都有 isCopyButton 属性（兼容旧数据）
  card.anchors.forEach(anchor => {
    if (anchor.isCopyButton === undefined) {
      anchor.isCopyButton = false;
    }
  });
  return card.anchors;
}

function renderScriptList() {
  const select = document.getElementById('scriptSelect');
  const scripts = initScriptsForCard(currentScriptCardIndex);

  let html = '<option value="">-- 新建脚本 --</option>';
  scripts.forEach(s => {
    html += `<option value="${s.id}" ${s.id === currentEditingScriptId ? 'selected' : ''}>${s.name} (${s.trigger})</option>`;
  });
  select.innerHTML = html;
}

function loadSelectedScript() {
  const select = document.getElementById('scriptSelect');
  const scriptId = select.value;

  if (!scriptId) {
    currentEditingScriptId = null;
    document.getElementById('scriptName').value = '';
    document.getElementById('scriptTrigger').value = 'manual';
    document.getElementById('scriptJsonPreview').textContent = '--';
    document.getElementById('scriptParseErrors').style.display = 'none';
    clearActionTable();
    return;
  }

  const scripts = initScriptsForCard(currentScriptCardIndex);
  const script = scripts.find(s => s.id === scriptId);
  if (script) {
    currentEditingScriptId = scriptId;
    document.getElementById('scriptName').value = script.name;
    document.getElementById('scriptTrigger').value = script.trigger || 'manual';
    loadStepsToTable(script.steps || []);
    parseScriptLive();
  }
}

function loadStepsToTable(steps) {
  const tbody = document.getElementById('scriptActionTableBody');
  tbody.innerHTML = '';

  if (steps.length === 0) {
    addActionRow();
    return;
  }

  const anchors = getAnchorsForCard(currentScriptCardIndex);
  let anchorOptions = '<option value="">-- 无 --</option>';
  anchors.forEach(a => {
    if (a.enabled) {
      anchorOptions += `<option value="${a.id}">定位点${a.id}: ${a.name}</option>`;
    }
  });

  steps.forEach((step, index) => {
    const row = document.createElement('tr');
    let anchorVal = '';
    let mouseVal = '';
    let keyboardVal = '';
    let waitVal = '';
    let pasteContentVal = '';
    let isCopyBtn = step.isCopyButton || false;

    switch (step.action) {
      case 'moveAndClick':
        anchorVal = step.anchorId || '';
        if (step.rightClick) {
          mouseVal = 'right';
        } else if (step.doubleClick) {
          mouseVal = 'double';
        } else if (step.explicitClick) {
          mouseVal = 'left';
        }
        break;
      case 'moveAndHover':
        anchorVal = step.anchorId || '';
        mouseVal = 'hover';
        waitVal = (step.duration || 1) * 1000;
        break;
      case 'moveAndScroll':
        anchorVal = step.anchorId || '';
        const dir = step.direction || 'down';
        const times = step.times || 5;
        if (step.wheel) {
          mouseVal = dir === 'up' ? `scrollWheelUp_${times}` : `scrollWheelDown_${times}`;
        } else {
          switch (dir) {
            case 'up': mouseVal = `scrollUp_${times}`; break;
            case 'down': mouseVal = `scrollDown_${times}`; break;
            case 'left': mouseVal = `scrollLeft_${times}`; break;
            case 'right': mouseVal = `scrollRight_${times}`; break;
          }
        }
        break;
      case 'keystroke':
        if (step.modifiers && step.modifiers.length > 0) {
          keyboardVal = step.modifiers[0] + '+' + step.key;
        } else {
          keyboardVal = step.key;
        }
        if (step.pasteContent) {
          pasteContentVal = step.pasteContent;
        }
        break;
      case 'delay':
        waitVal = (step.seconds || 1) * 1000;
        break;
    }

    row.innerHTML = `
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">${index + 1}</td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center;">
        <input type="checkbox" class="disabled-checkbox" onchange="parseScriptLive()">
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <select class="anchor-select" onchange="handleActionFieldChange(this)">
          ${anchorOptions.replace(`value="${anchorVal}"`, `value="${anchorVal}" selected`)}
        </select>
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <select class="mouse-select" onchange="handleActionFieldChange(this)">
          <option value="">-- 无 --</option>
          <optgroup label="点击操作">
            <option value="left" ${mouseVal === 'left' ? 'selected' : ''}>左键点击</option>
            <option value="right" ${mouseVal === 'right' ? 'selected' : ''}>右键点击</option>
            <option value="double" ${mouseVal === 'double' ? 'selected' : ''}>双击</option>
          </optgroup>
          <optgroup label="移动操作">
            <option value="hover" ${mouseVal === 'hover' ? 'selected' : ''}>悬停</option>
          </optgroup>
          <optgroup label="向上滑动">
            <option value="scrollUp_5" ${mouseVal === 'scrollUp_5' ? 'selected' : ''}>向上滑动 5次</option>
            <option value="scrollUp_10" ${mouseVal === 'scrollUp_10' ? 'selected' : ''}>向上滑动 10次</option>
            <option value="scrollUp_20" ${mouseVal === 'scrollUp_20' ? 'selected' : ''}>向上滑动 20次</option>
            <option value="scrollUp_50" ${mouseVal === 'scrollUp_50' ? 'selected' : ''}>向上滑动 50次</option>
            <option value="scrollUp_200" ${mouseVal === 'scrollUp_200' ? 'selected' : ''}>向上滑动 200次</option>
          </optgroup>
          <optgroup label="向下滑动">
            <option value="scrollDown_5" ${mouseVal === 'scrollDown_5' ? 'selected' : ''}>向下滑动 5次</option>
            <option value="scrollDown_10" ${mouseVal === 'scrollDown_10' ? 'selected' : ''}>向下滑动 10次</option>
            <option value="scrollDown_20" ${mouseVal === 'scrollDown_20' ? 'selected' : ''}>向下滑动 20次</option>
            <option value="scrollDown_50" ${mouseVal === 'scrollDown_50' ? 'selected' : ''}>向下滑动 50次</option>
            <option value="scrollDown_200" ${mouseVal === 'scrollDown_200' ? 'selected' : ''}>向下滑动 200次</option>
          </optgroup>
          <optgroup label="向左滚动">
            <option value="scrollLeft_5" ${mouseVal === 'scrollLeft_5' ? 'selected' : ''}>向左滚动 5次</option>
            <option value="scrollLeft_10" ${mouseVal === 'scrollLeft_10' ? 'selected' : ''}>向左滚动 10次</option>
            <option value="scrollLeft_20" ${mouseVal === 'scrollLeft_20' ? 'selected' : ''}>向左滚动 20次</option>
            <option value="scrollLeft_50" ${mouseVal === 'scrollLeft_50' ? 'selected' : ''}>向左滚动 50次</option>
            <option value="scrollLeft_200" ${mouseVal === 'scrollLeft_200' ? 'selected' : ''}>向左滚动 200次</option>
          </optgroup>
          <optgroup label="向右滚动">
            <option value="scrollRight_5" ${mouseVal === 'scrollRight_5' ? 'selected' : ''}>向右滚动 5次</option>
            <option value="scrollRight_10" ${mouseVal === 'scrollRight_10' ? 'selected' : ''}>向右滚动 10次</option>
            <option value="scrollRight_20" ${mouseVal === 'scrollRight_20' ? 'selected' : ''}>向右滚动 20次</option>
            <option value="scrollRight_50" ${mouseVal === 'scrollRight_50' ? 'selected' : ''}>向右滚动 50次</option>
            <option value="scrollRight_200" ${mouseVal === 'scrollRight_200' ? 'selected' : ''}>向右滚动 200次</option>
          </optgroup>
          <optgroup label="滚轮向上">
            <option value="scrollWheelUp_5" ${mouseVal === 'scrollWheelUp_5' ? 'selected' : ''}>滚轮向上 5次</option>
            <option value="scrollWheelUp_10" ${mouseVal === 'scrollWheelUp_10' ? 'selected' : ''}>滚轮向上 10次</option>
            <option value="scrollWheelUp_20" ${mouseVal === 'scrollWheelUp_20' ? 'selected' : ''}>滚轮向上 20次</option>
            <option value="scrollWheelUp_50" ${mouseVal === 'scrollWheelUp_50' ? 'selected' : ''}>滚轮向上 50次</option>
            <option value="scrollWheelUp_200" ${mouseVal === 'scrollWheelUp_200' ? 'selected' : ''}>滚轮向上 200次</option>
          </optgroup>
          <optgroup label="滚轮向下">
            <option value="scrollWheelDown_5" ${mouseVal === 'scrollWheelDown_5' ? 'selected' : ''}>滚轮向下 5次</option>
            <option value="scrollWheelDown_10" ${mouseVal === 'scrollWheelDown_10' ? 'selected' : ''}>滚轮向下 10次</option>
            <option value="scrollWheelDown_20" ${mouseVal === 'scrollWheelDown_20' ? 'selected' : ''}>滚轮向下 20次</option>
            <option value="scrollWheelDown_50" ${mouseVal === 'scrollWheelDown_50' ? 'selected' : ''}>滚轮向下 50次</option>
            <option value="scrollWheelDown_200" ${mouseVal === 'scrollWheelDown_200' ? 'selected' : ''}>滚轮向下 200次</option>
          </optgroup>
        </select>
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <select class="keyboard-select" onchange="handleActionFieldChange(this)">
          <option value="">-- 无 --</option>
          <optgroup label="基础按键">
            <option value="enter" ${keyboardVal === 'enter' ? 'selected' : ''}>Enter</option>
            <option value="escape" ${keyboardVal === 'escape' ? 'selected' : ''}>ESC</option>
            <option value="tab" ${keyboardVal === 'tab' ? 'selected' : ''}>Tab</option>
            <option value="space" ${keyboardVal === 'space' ? 'selected' : ''}>空格</option>
            <option value="backspace" ${keyboardVal === 'backspace' ? 'selected' : ''}>Backspace</option>
            <option value="delete" ${keyboardVal === 'delete' ? 'selected' : ''}>Delete</option>
            <option value="return" ${keyboardVal === 'return' ? 'selected' : ''}>Return</option>
          </optgroup>
          <optgroup label="功能键">
            <option value="f1" ${keyboardVal === 'f1' ? 'selected' : ''}>F1</option>
            <option value="f2" ${keyboardVal === 'f2' ? 'selected' : ''}>F2</option>
            <option value="f3" ${keyboardVal === 'f3' ? 'selected' : ''}>F3</option>
            <option value="f4" ${keyboardVal === 'f4' ? 'selected' : ''}>F4</option>
            <option value="f5" ${keyboardVal === 'f5' ? 'selected' : ''}>F5</option>
            <option value="f6" ${keyboardVal === 'f6' ? 'selected' : ''}>F6</option>
            <option value="f7" ${keyboardVal === 'f7' ? 'selected' : ''}>F7</option>
            <option value="f8" ${keyboardVal === 'f8' ? 'selected' : ''}>F8</option>
            <option value="f9" ${keyboardVal === 'f9' ? 'selected' : ''}>F9</option>
            <option value="f10" ${keyboardVal === 'f10' ? 'selected' : ''}>F10</option>
            <option value="f11" ${keyboardVal === 'f11' ? 'selected' : ''}>F11</option>
            <option value="f12" ${keyboardVal === 'f12' ? 'selected' : ''}>F12</option>
          </optgroup>
          <optgroup label="组合键">
            <option value="cmd+a" ${keyboardVal === 'cmd+a' ? 'selected' : ''}>Cmd+A</option>
            <option value="cmd+c" ${keyboardVal === 'cmd+c' ? 'selected' : ''}>Cmd+C</option>
            <option value="cmd+v" ${keyboardVal === 'cmd+v' ? 'selected' : ''}>Cmd+V</option>
            <option value="cmd+x" ${keyboardVal === 'cmd+x' ? 'selected' : ''}>Cmd+X</option>
            <option value="cmd+s" ${keyboardVal === 'cmd+s' ? 'selected' : ''}>Cmd+S</option>
            <option value="cmd+f" ${keyboardVal === 'cmd+f' ? 'selected' : ''}>Cmd+F</option>
            <option value="cmd+z" ${keyboardVal === 'cmd+z' ? 'selected' : ''}>Cmd+Z</option>
            <option value="shift+tab" ${keyboardVal === 'shift+tab' ? 'selected' : ''}>Shift+Tab</option>
            <option value="shift+enter" ${keyboardVal === 'shift+enter' ? 'selected' : ''}>Shift+Enter</option>
          </optgroup>
        </select>
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <input type="text" class="paste-content-input" placeholder="C+V内容" oninput="parseScriptLive()" value="${pasteContentVal.replace(/"/g, '&quot;')}" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px; ${keyboardVal === 'cmd+v' ? '' : 'display: none;'}">
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <input type="number" class="wait-input" placeholder="0" min="0" oninput="parseScriptLive()" value="${waitVal}" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 4px 6px;">
        <input type="text" class="note-input" placeholder="备注" oninput="parseScriptLive()" style="width: 100%; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; font-size: 11px;">
      </td>
      <td style="border: 1px solid #cbd5e1; padding: 2px 4px; text-align: center; white-space: nowrap;">
        <button onclick="previewActionFile(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #10b981; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">👁</button>
        <button onclick="insertActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #3b82f6; color: white; border-radius: 2px; cursor: pointer; margin-right: 2px;">+</button>
        <button onclick="removeActionRow(this)" style="padding: 2px 3px; font-size: 10px; border: none; background: #ef4444; color: white; border-radius: 2px; cursor: pointer;">×</button>
      </td>
    `;
    row.querySelector('.paste-content-input').value = pasteContentVal;
    
    // 优先使用步骤本身的 isCopyButton 属性，其次才检查定位点状态
    if (isCopyBtn) {
      row.style.backgroundColor = '#eff6ff';
      row.title = 'isCopyButton: true';
    } else if (anchorVal) {
      const anchor = anchors.find(a => a.id === parseInt(anchorVal));
      if (anchor && anchor.isCopyButton) {
        row.style.backgroundColor = '#eff6ff';
        row.title = 'isCopyButton: true';
      }
    }
    
    tbody.appendChild(row);
  });
}

function newScript() {
  currentEditingScriptId = null;
  document.getElementById('scriptName').value = '';
  document.getElementById('scriptTrigger').value = 'manual';
  document.getElementById('scriptJsonPreview').textContent = '--';
  document.getElementById('scriptParseErrors').style.display = 'none';
  document.getElementById('scriptSelect').value = '';
  clearActionTable(false);
  document.getElementById('scriptName').focus();
}

async function saveCurrentScript() {
  if (currentScriptCardIndex === -1) return;

  const name = document.getElementById('scriptName').value.trim();
  const trigger = document.getElementById('scriptTrigger').value;

  if (!name) {
    alert('请输入脚本名称！');
    return;
  }

  const rows = document.querySelectorAll('#scriptActionTableBody tr');
  const steps = [];

  rows.forEach((row, index) => {
    const anchorSelect = row.querySelector('.anchor-select');
    const mouseSelect = row.querySelector('.mouse-select');
    const keyboardSelect = row.querySelector('.keyboard-select');
    const waitInput = row.querySelector('.wait-input');

    const anchorId = anchorSelect ? parseInt(anchorSelect.value) : null;
    const mouseAction = mouseSelect ? mouseSelect.value : '';
    const keyboardAction = keyboardSelect ? keyboardSelect.value : '';
    const waitMs = waitInput ? parseInt(waitInput.value) || 0 : 0;

    const hasAnchor = anchorId !== null && anchorId > 0;
    const hasMouse = mouseAction && mouseAction !== '';
    const hasKeyboard = keyboardAction && keyboardAction !== '';

    let actionType = null;
    let actionData = {};

    if (hasAnchor && !hasMouse && !hasKeyboard) {
      actionType = 'moveAndClick';
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      actionData = { anchorId: anchorId, noClick: true };
      if (anchor && anchor.isCopyButton) {
        actionData.isCopyButton = true;
      }
    } else if (hasMouse && !hasAnchor && !hasKeyboard) {
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, explicitClick: true };
          break;
        case 'right':
          actionType = 'keystroke';
          actionData = { key: 'button', modifiers: ['control'] };
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, doubleClick: true };
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId || 0, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId || 0, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (hasKeyboard && !hasAnchor && !hasMouse) {
      const parts = keyboardAction.split('+');
      const pasteContentInput = row.querySelector('.paste-content-input');
      const pasteContent = pasteContentInput ? pasteContentInput.value : '';
      if (parts.length === 2) {
        actionType = 'keystroke';
        actionData = { key: parts[1], modifiers: [parts[0]] };
        if (parts[0] === 'cmd' && parts[1] === 'v' && pasteContent && pasteContent.trim() !== '') {
          actionData.pasteContent = pasteContent.trim();
        }
      } else {
        actionType = 'keystroke';
        actionData = { key: keyboardAction };
      }
    } else if (hasAnchor && hasMouse && !hasKeyboard) {
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, explicitClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'right':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, rightClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, doubleClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (!hasAnchor && !hasMouse && !hasKeyboard) {
      if (waitMs > 0) {
        actionType = 'delay';
        actionData = { seconds: waitMs / 1000 };
      }
    }

    if (actionType) {
      steps.push({ action: actionType, ...actionData });
      
      if (waitMs > 0 && actionType !== 'moveAndHover' && actionType !== 'delay') {
        steps.push({ action: 'delay', seconds: waitMs / 1000 });
      }
    }
  });

  if (steps.length === 0) {
    alert('请至少添加一个动作！');
    return;
  }

  const scripts = initScriptsForCard(currentScriptCardIndex);

  const existingScript = scripts.find(s => s.name === name && s.id !== currentEditingScriptId);
  if (existingScript) {
    alert(`脚本名称「${name}」已存在！请使用其他名称。`);
    return;
  }

  if (currentEditingScriptId) {
    const idx = scripts.findIndex(s => s.id === currentEditingScriptId);
    if (idx >= 0) {
      scripts[idx].name = name;
      scripts[idx].trigger = trigger;
      scripts[idx].steps = steps;
    }
  } else {
    const newScriptObj = {
      id: generateScriptId(),
      name: name,
      trigger: trigger,
      steps: steps
    };
    scripts.push(newScriptObj);
    currentEditingScriptId = newScriptObj.id;
  }

  await saveCardScriptsData();
  renderScriptList();
  showStatus(`✅ 脚本「${name}」已保存`, 'success');
}

async function deleteCurrentScript() {
  if (!currentEditingScriptId) {
    alert('请先选择要删除的脚本！');
    return;
  }

  if (!confirm('确定要删除当前脚本吗？')) return;

  const scripts = initScriptsForCard(currentScriptCardIndex);
  const idx = scripts.findIndex(s => s.id === currentEditingScriptId);
  if (idx >= 0) {
    const deletedName = scripts[idx].name;
    scripts.splice(idx, 1);
    await saveCardScriptsData();
    currentEditingScriptId = null;
    renderScriptList();
    newScript();
    showStatus(`✅ 脚本「${deletedName}」已删除`, 'success');
  }
}

function toggleJxaCode() {
  const container = document.getElementById('jxaCodeContainer');
  const btn = document.getElementById('toggleJxaCodeBtn');
  if (container.style.display === 'none') {
    showJxaCode();
  } else {
    container.style.display = 'none';
    btn.textContent = '显示代码';
  }
}

function showJxaCode() {
  if (currentScriptCardIndex === -1) return;

  const rows = document.querySelectorAll('#scriptActionTableBody tr');
  const steps = [];

  rows.forEach((row) => {
    const anchorSelect = row.querySelector('.anchor-select');
    const mouseSelect = row.querySelector('.mouse-select');
    const keyboardSelect = row.querySelector('.keyboard-select');
    const waitInput = row.querySelector('.wait-input');

    const anchorId = anchorSelect ? parseInt(anchorSelect.value) : null;
    const mouseAction = mouseSelect ? mouseSelect.value : '';
    const keyboardAction = keyboardSelect ? keyboardSelect.value : '';
    const waitMs = waitInput ? parseInt(waitInput.value) || 0 : 0;

    const hasAnchor = anchorId !== null && anchorId > 0;
    const hasMouse = mouseAction && mouseAction !== '';
    const hasKeyboard = keyboardAction && keyboardAction !== '';

    let actionType = null;
    let actionData = {};

    if (hasAnchor && !hasMouse && !hasKeyboard) {
      actionType = 'moveAndClick';
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      actionData = { anchorId: anchorId, noClick: true };
      if (anchor && anchor.isCopyButton) {
        actionData.isCopyButton = true;
      }
    } else if (hasMouse && !hasAnchor && !hasKeyboard) {
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, explicitClick: true };
          break;
        case 'right':
          actionType = 'keystroke';
          actionData = { key: 'button', modifiers: ['control'] };
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, doubleClick: true };
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId || 0, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId || 0, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (hasKeyboard && !hasAnchor && !hasMouse) {
      const parts = keyboardAction.split('+');
      const pasteContentInput = row.querySelector('.paste-content-input');
      const pasteContent = pasteContentInput ? pasteContentInput.value : '';
      if (parts.length === 2) {
        actionType = 'keystroke';
        actionData = { key: parts[1], modifiers: [parts[0]] };
        if (parts[0] === 'cmd' && parts[1] === 'v' && pasteContent && pasteContent.trim() !== '') {
          actionData.pasteContent = pasteContent.trim();
        }
      } else {
        actionType = 'keystroke';
        actionData = { key: keyboardAction };
      }
    } else if (hasAnchor && hasMouse && !hasKeyboard) {
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, explicitClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'right':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, rightClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, doubleClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (!hasAnchor && !hasMouse && !hasKeyboard) {
      if (waitMs > 0) {
        actionType = 'delay';
        actionData = { seconds: waitMs / 1000 };
      }
    }

    if (actionType) {
      steps.push({ action: actionType, ...actionData });
      
      if (waitMs > 0 && actionType !== 'moveAndHover' && actionType !== 'delay') {
        steps.push({ action: 'delay', seconds: waitMs / 1000 });
      }
    }
  });

  if (steps.length === 0) {
    const container = document.getElementById('jxaCodeContainer');
    container.textContent = '--';
    container.style.display = 'block';
    return;
  }

  const bookmark = bookmarks[currentScriptCardIndex];
  const appName = bookmark.appName || bookmark.name;
  const anchors = initAnchorsForCard(currentScriptCardIndex);
  const windowSettings = bookmark.window || { width: 950, height: 920 };

  const jxaCode = generateJxaCode(appName, anchors, windowSettings, steps);

  const container = document.getElementById('jxaCodeContainer');
  container.textContent = jxaCode;
  container.style.display = 'block';
}

async function testRunScript() {
  if (currentScriptCardIndex === -1) return;

  pairMessageWithCmdV();

  const rows = document.querySelectorAll('#scriptActionTableBody tr');
  const steps = [];

  // 获取当前卡片的定位点，用于补充设置步骤的 isCopyButton 属性
  const allAnchors = getAnchorsForCard(currentScriptCardIndex);

  rows.forEach((row) => {
    const disabledCheckbox = row.querySelector('.disabled-checkbox');
    if (disabledCheckbox && disabledCheckbox.checked) {
      return;
    }

    const anchorSelect = row.querySelector('.anchor-select');
    const mouseSelect = row.querySelector('.mouse-select');
    const keyboardSelect = row.querySelector('.keyboard-select');
    const waitInput = row.querySelector('.wait-input');

    const anchorId = anchorSelect ? parseInt(anchorSelect.value) : null;
    const mouseAction = mouseSelect ? mouseSelect.value : '';
    const keyboardAction = keyboardSelect ? keyboardSelect.value : '';
    const waitMs = waitInput ? parseInt(waitInput.value) || 0 : 0;

    const hasAnchor = anchorId !== null && anchorId > 0;
    const hasMouse = mouseAction && mouseAction !== '';
    const hasKeyboard = keyboardAction && keyboardAction !== '';

    let actionType = null;
    let actionData = {};

    if (hasAnchor && !hasMouse && !hasKeyboard) {
      actionType = 'moveAndClick';
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      actionData = { anchorId: anchorId, noClick: true };
      if (anchor && anchor.isCopyButton) {
        actionData.isCopyButton = true;
      }
    } else if (hasMouse && !hasAnchor && !hasKeyboard) {
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, explicitClick: true };
          break;
        case 'right':
          actionType = 'keystroke';
          actionData = { key: 'button', modifiers: ['control'] };
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: 0, doubleClick: true };
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId || 0, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId || 0, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId || 0, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (hasKeyboard && !hasAnchor && !hasMouse) {
      const parts = keyboardAction.split('+');
      const pasteContentInput = row.querySelector('.paste-content-input');
      const pasteContent = pasteContentInput ? pasteContentInput.value : '';
      if (parts.length === 2) {
        actionType = 'keystroke';
        actionData = { key: parts[1], modifiers: [parts[0]] };
        if (parts[0] === 'cmd' && parts[1] === 'v' && pasteContent && pasteContent.trim() !== '') {
          actionData.pasteContent = pasteContent.trim();
        }
      } else {
        actionType = 'keystroke';
        actionData = { key: keyboardAction };
      }
    } else if (hasAnchor && hasMouse && !hasKeyboard) {
      const anchors = getAnchorsForCard(currentScriptCardIndex);
      const anchor = anchors.find(a => a.id === anchorId);
      switch (mouseAction) {
        case 'left':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, explicitClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'right':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, rightClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'double':
          actionType = 'moveAndClick';
          actionData = { anchorId: anchorId, doubleClick: true };
          if (anchor && anchor.isCopyButton) {
            actionData.isCopyButton = true;
          }
          break;
        case 'hover':
          actionType = 'moveAndHover';
          actionData = { anchorId: anchorId, duration: waitMs / 1000 || 1 };
          break;
        case 'scrollUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5 };
          break;
        case 'scrollDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5 };
          break;
        case 'scrollLeft':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'left', times: 5 };
          break;
        case 'scrollRight':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'right', times: 5 };
          break;
        case 'scrollWheelUp':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'up', times: 5, wheel: true };
          break;
        case 'scrollWheelDown':
          actionType = 'moveAndScroll';
          actionData = { anchorId: anchorId, direction: 'down', times: 5, wheel: true };
          break;
        default: {
          const scrollMatch = mouseAction.match(/^scroll(Up|Down|Left|Right|WheelUp|WheelDown)_(\d+)$/);
          if (scrollMatch) {
            const dirMap = { 
              'Up': 'up', 'Down': 'down', 'Left': 'left', 'Right': 'right',
              'WheelUp': 'up', 'WheelDown': 'down'
            };
            actionType = 'moveAndScroll';
            actionData = { 
              anchorId: anchorId, 
              direction: dirMap[scrollMatch[1]], 
              times: parseInt(scrollMatch[2]),
              wheel: scrollMatch[1].startsWith('Wheel')
            };
          }
        }
      }
    } else if (!hasAnchor && !hasMouse && !hasKeyboard) {
      if (waitMs > 0) {
        actionType = 'delay';
        actionData = { seconds: waitMs / 1000 };
      }
    }

    if (actionType) {
      steps.push({ action: actionType, ...actionData });
      
      if (waitMs > 0 && actionType !== 'moveAndHover' && actionType !== 'delay') {
        steps.push({ action: 'delay', seconds: waitMs / 1000 });
      }
    }
  });

  if (steps.length === 0) {
    alert('没有可解析的步骤，无法执行！');
    return;
  }

  // 补充设置步骤的 isCopyButton 属性：根据定位点的 isCopyButton 属性
  // 确保即使步骤本身没有 isCopyButton 属性，也能根据定位点正确识别复制按钮步骤
  for (const step of steps) {
    if (step.anchorId && step.anchorId > 0 && !step.isCopyButton) {
      const anchor = allAnchors.find(a => a.id === step.anchorId);
      if (anchor && anchor.isCopyButton) {
        step.isCopyButton = true;
      }
    }
  }
  console.log(`[Renderer] 📋 步骤收集完成，共 ${steps.length} 个步骤，其中 ${steps.filter(s => s.isCopyButton).length} 个复制按钮步骤`);

  const bookmark = bookmarks[currentScriptCardIndex];
  const appName = bookmark.appName || bookmark.name;
  const anchors = initAnchorsForCard(currentScriptCardIndex);
  const windowSettings = bookmark.window || { width: 950, height: 920, x: 0, y: 0 };

  const confirmed = confirm(`即将测试执行脚本\n\n网点: ${bookmark.name}\nAPP: ${appName}\n步骤数: ${steps.length}\n\n点击确定开始执行？`);
  if (!confirmed) return;

  showStatus(`⏳ 正在执行脚本...`, 'info');

  try {
    const execResult = await window.electronAPI.desktopAppRunScript({
      appName: appName,
      anchors: anchors,
      window: windowSettings,
      steps: steps
    });

    if (execResult.success) {
      showStatus(`✅ 脚本执行完成！`, 'success');
      const clipboardContainer = document.getElementById('clipboardResultContainer');
      if (clipboardContainer && execResult.clipboardContent) {
        clipboardContainer.textContent = execResult.clipboardContent;
      } else if (clipboardContainer) {
        clipboardContainer.textContent = '--';
      }
      alert(`✅ 脚本执行完成！\n\n共执行 ${steps.length} 个步骤。`);
    } else {
      showStatus(`❌ 脚本执行失败`, 'error');
      const clipboardContainer = document.getElementById('clipboardResultContainer');
      if (clipboardContainer && execResult.clipboardContent) {
        clipboardContainer.textContent = execResult.clipboardContent;
      }
      showErrorDialog(execResult.error);
    }
    
    await window.electronAPI.activateMainWindow();
  } catch (e) {
    showStatus(`❌ 脚本执行失败: ${e.message}`, 'error');
    showErrorDialog(e.message);
    await window.electronAPI.activateMainWindow();
  }
}

function showErrorDialog(message) {
  const dialogId = 'errorDialog';
  let dialog = document.getElementById(dialogId);
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = dialogId;
    dialog.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 80%; max-width: 600px; max-height: 70vh;
      background: #1e293b; color: #e2e8f0; border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
      z-index: 9999; padding: 16px; border: 1px solid #334155;
      display: flex; flex-direction: column;
    `;
    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">
        <h3 style="margin: 0; color: #ef4444;">❌ 脚本执行失败</h3>
        <button onclick="document.getElementById('errorDialog').remove()" style="background: #334155; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;">关闭</button>
      </div>
      <div id="errorDialogContent" style="flex: 1; overflow-y: auto; font-family: monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap;"></div>
    `;
    document.body.appendChild(dialog);
  }
  document.getElementById('errorDialogContent').textContent = message;
}

function recordAnchorsFromScriptModal() {
  if (currentScriptCardIndex < 0) return;
  const index = currentScriptCardIndex;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  
  console.log(`[Renderer] 📍 录制定位点: ${appName}`);
  
  currentRecordingCardIndex = index;
  initAnchorsForCard(index);
  
  const modal = document.getElementById('anchorRecordModal');
  const title = document.getElementById('anchorRecordModalTitle');
  title.textContent = `📍 录制定位点 - ${bookmark.name}`;
  
  renderAnchorList(index);
  currentSelectedAnchorId = 1;
  updateAnchorDetail();
  updateWindowDisplay();
  updateCaptureRegionDisplay();

  modal.style.zIndex = '2000';
  modal.style.display = 'flex';
}

function closeScriptSettingsModal() {
  document.getElementById('scriptSettingsModal').style.display = 'none';
  currentScriptCardIndex = -1;
  currentEditingScriptId = null;
}

async function appMenuScriptSettings(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;

  // 🆕 确保脚本数据已加载
  if (!cardScriptsDataLoaded) {
    await loadCardScriptsData();
  }

  currentScriptCardIndex = index;
  const bookmark = bookmarks[index];

  console.log(`[Renderer] 📝 脚本设定作业: ${bookmark.name}`);

  initScriptsForCard(index);
  initAnchorsForCard(index);

  const modal = document.getElementById('scriptSettingsModal');
  const title = document.getElementById('scriptSettingsModalTitle');
  title.textContent = `📝 脚本设定作业 - ${bookmark.name}`;

  currentEditingScriptId = null;
  renderScriptList();

  const anchors = getAnchorsForCard(index);
  let anchorOptions = '<option value="">-- 无 --</option>';
  anchors.forEach(a => {
    if (a.enabled) {
      anchorOptions += `<option value="${a.id}">定位点${a.id}: ${a.name}</option>`;
    }
  });

  document.querySelectorAll('.anchor-select').forEach(select => {
    select.innerHTML = anchorOptions;
  });

  newScript();

  modal.style.display = 'flex';
}

// APP 菜单：采集复制按钮模板（图像识别法）
async function appMenuCaptureCopyBtn(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  console.log(`[Renderer] 📸 采集复制按钮模板: ${appName}`);

  const confirmed = confirm(`即将采集「复制」按钮模板\n\n1. 点击确定后会自动打开${appName}\n2. 请在5秒内把游标移到「复制」按钮上\n\n点击确定开始？`);
  if (!confirmed) return;

  showStatus(`🔄 正在打开${appName}...`, 'info');
  try {
    await window.electronAPI.desktopAppActivate(appName);
  } catch (e) {
    showStatus(`❌ 打开APP失败: ${e.message}`, 'error');
    return;
  }

  showStatus('⏳ 5秒内把游标移到「复制」按钮上...', 'info');

  try {
    const result = await window.electronAPI.desktopAppCaptureTemplate({
      index: index,
      step: 1,
      size: 44,
      delay: 5
    });
    if (result.success) {
      bookmarks[index].copyBtnTemplate = result.templatePath;
      saveBookmarksToStorage();
      showStatus('✅ 复制按钮模板采集完成！', 'success');
      console.log(`[Renderer] 模板保存: ${result.templatePath}`);
    } else {
      showStatus(`❌ 采集失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 采集失败: ${e.message}`, 'error');
  }
}

// APP 菜单：采集Markdown菜单项模板（图像识别法）
async function appMenuCaptureMdBtn(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  console.log(`[Renderer] 📸 采集Markdown菜单项模板: ${appName}`);

  const confirmed = confirm(`即将采集「复制为Markdown」菜单项模板\n\n1. 点击确定后会自动打开${appName}\n2. 请先手动悬停复制按钮，让下拉菜单出现\n3. 把游标移到「复制为Markdown」菜单项上\n4. 有5秒时间保持位置\n\n点击确定开始？`);
  if (!confirmed) return;

  showStatus(`🔄 正在打开${appName}...`, 'info');
  try {
    await window.electronAPI.desktopAppActivate(appName);
  } catch (e) {
    showStatus(`❌ 打开APP失败: ${e.message}`, 'error');
    return;
  }

  showStatus('⏳ 5秒内把游标移到「复制为Markdown」上...', 'info');

  try {
    const result = await window.electronAPI.desktopAppCaptureTemplate({
      index: index,
      step: 2,
      size: 44,
      delay: 5
    });
    if (result.success) {
      bookmarks[index].mdBtnTemplate = result.templatePath;
      saveBookmarksToStorage();
      showStatus('✅ Markdown菜单项模板采集完成！', 'success');
      console.log(`[Renderer] 模板保存: ${result.templatePath}`);
    } else {
      showStatus(`❌ 采集失败: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(`❌ 采集失败: ${e.message}`, 'error');
  }
}

// APP 菜单：复制为Markdown（图像识别版）
async function appMenuClickCopyMarkdownV2(index) {
  document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
  if (index < 0 || index >= bookmarks.length) return;
  const bookmark = bookmarks[index];
  const appName = bookmark.appName || bookmark.name;
  console.log(`[Renderer] 📋 复制为Markdown(图像识别): ${appName}`);

  if (!bookmark.copyBtnTemplate || !bookmark.mdBtnTemplate) {
    alert('❌ 请先采集两个模板：\n1. 采集:复制按钮\n2. 采集:Markdown项\n\n采集完成后再使用此功能。');
    return;
  }

  const confirmed = confirm(`即将执行「复制为Markdown」操作\n\n1. 会自动打开${appName}\n2. 图像识别查找复制按钮和Markdown菜单项\n3. 自动点击完成复制\n\n点击确定开始？`);
  if (!confirmed) return;

  showStatus(`🔄 正在打开${appName}...`, 'info');
  try {
    await window.electronAPI.desktopAppActivate(appName);
  } catch (e) {
    showStatus(`❌ 打开APP失败: ${e.message}`, 'error');
    return;
  }

  try {
    showStatus('🔍 图像识别查找中...', 'info');
    const result = await window.electronAPI.desktopAppCopyMarkdownByImage({
      appName: appName,
      copyTemplate: bookmark.copyBtnTemplate,
      mdTemplate: bookmark.mdBtnTemplate,
      threshold: 0.7
    });
    if (result.success) {
      showStatus(`✅ 已复制为Markdown！(置信度: ${result.mdConfidence})`, 'success');
    } else {
      alert(`❌ 操作失败: ${result.error}`);
      showStatus(`❌ 操作失败: ${result.error}`, 'error');
    }
  } catch (e) {
    alert(`❌ 操作失败: ${e.message}`);
    showStatus(`❌ 操作失败: ${e.message}`, 'error');
  }
}

// ========== 挂载到 window（供 HTML onclick 及其他模组调用） ==========
window.toggleAppMenu = toggleAppMenu;
window.appMenuActivate = appMenuActivate;
window.initAnchorsForCard = initAnchorsForCard;
window.renderAnchorList = renderAnchorList;
window.selectAnchor = selectAnchor;
window.updateAnchorDetail = updateAnchorDetail;
window.updateAnchorName = updateAnchorName;
window.clearAllAnchors = clearAllAnchors;
window.closeAnchorRecordModal = closeAnchorRecordModal;
window.updateWindowDisplay = updateWindowDisplay;
window.recordWindowSettings = recordWindowSettings;
window.replayWindowSettings = replayWindowSettings;
window.updateCaptureRegionDisplay = updateCaptureRegionDisplay;
window.recordCaptureRegion = recordCaptureRegion;
window.captureCurrentRegion = captureCurrentRegion;
window.previewCaptureRegion = previewCaptureRegion;
window.startRecordingAnchors = startRecordingAnchors;
window.replaySingleAnchor = replaySingleAnchor;
window.appMenuRecordAnchors = appMenuRecordAnchors;
window.addMessageRow = addMessageRow;
window.removeMessageRow = removeMessageRow;
window.updateMessageRowNumbers = updateMessageRowNumbers;
window.previewMessageFile = previewMessageFile;
window.clearMessagePool = clearMessagePool;
window.handleMessageTypeChange = handleMessageTypeChange;
window.selectMessageFile = selectMessageFile;
window.pairMessageWithCmdV = pairMessageWithCmdV;
window.initScriptsForCard = initScriptsForCard;
window.generateScriptId = generateScriptId;
window.parseNaturalLanguageScript = parseNaturalLanguageScript;
window.generateJxaCode = generateJxaCode;
window.parseScriptLive = parseScriptLive;
window.addActionRow = addActionRow;
window.removeActionRow = removeActionRow;
window.previewActionFile = previewActionFile;
window.insertActionRow = insertActionRow;
window.renumberActionRows = renumberActionRows;
window.clearActionTable = clearActionTable;
window.handleActionFieldChange = handleActionFieldChange;
window.getAnchorsForCard = getAnchorsForCard;
window.renderScriptList = renderScriptList;
window.loadSelectedScript = loadSelectedScript;
window.loadStepsToTable = loadStepsToTable;
window.newScript = newScript;
window.saveCurrentScript = saveCurrentScript;
window.deleteCurrentScript = deleteCurrentScript;
window.toggleJxaCode = toggleJxaCode;
window.showJxaCode = showJxaCode;
window.testRunScript = testRunScript;
window.showErrorDialog = showErrorDialog;
window.recordAnchorsFromScriptModal = recordAnchorsFromScriptModal;
window.closeScriptSettingsModal = closeScriptSettingsModal;
window.appMenuScriptSettings = appMenuScriptSettings;
window.appMenuCaptureCopyBtn = appMenuCaptureCopyBtn;
window.appMenuCaptureMdBtn = appMenuCaptureMdBtn;
window.appMenuClickCopyMarkdownV2 = appMenuClickCopyMarkdownV2;

// 全局变量挂载到 window（通过 getter 保持实时同步）
Object.defineProperty(window, 'currentRecordingCardIndex', { get: () => currentRecordingCardIndex, configurable: true });
Object.defineProperty(window, 'currentSelectedAnchorId', { get: () => currentSelectedAnchorId, configurable: true });
Object.defineProperty(window, 'currentScriptCardIndex', { get: () => currentScriptCardIndex, configurable: true });
Object.defineProperty(window, 'currentEditingScriptId', { get: () => currentEditingScriptId, configurable: true });
