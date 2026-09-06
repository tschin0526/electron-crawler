/**
 * MD 編輯器 Lite - PWA 版本
 * 支持 iCloud 文件讀取與保存
 */

// 全局狀態
const state = {
  currentFile: null,
  isDirty: false,
  isPreviewMode: false,
  isDarkMode: false,
  lastContent: ''
};

// DOM 元素
const elements = {
  btnOpen: document.getElementById('btn-open'),
  btnSave: document.getElementById('btn-save'),
  btnPreview: document.getElementById('btn-preview'),
  btnTheme: document.getElementById('btn-theme'),
  fileInput: document.getElementById('file-input'),
  fileName: document.getElementById('file-name'),
  editor: document.getElementById('editor'),
  editorPane: document.getElementById('editor-pane'),
  previewPane: document.getElementById('preview-pane'),
  preview: document.getElementById('preview'),
  statusText: document.getElementById('status-text'),
  wordCount: document.getElementById('word-count'),
  toast: document.getElementById('toast')
};

// 初始化
function init() {
  loadSettings();
  setupEventListeners();
  updatePreview();
  updateWordCount();
  
  // 註冊 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW 註冊成功', reg))
      .catch(err => console.error('SW 註冊失敗', err));
  }
}

// 設置事件監聽
function setupEventListeners() {
  // 打開文件
  elements.btnOpen.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', handleFileSelect);

  // 保存文件
  elements.btnSave.addEventListener('click', handleSave);

  // 切換預覽
  elements.btnPreview.addEventListener('click', togglePreview);

  // 切換主題
  elements.btnTheme.addEventListener('click', toggleTheme);

  // 編輯器輸入
  elements.editor.addEventListener('input', () => {
    state.isDirty = elements.editor.value !== state.lastContent;
    updatePreview();
    updateWordCount();
    updateStatus();
  });

  // 鍵盤快捷鍵
  document.addEventListener('keydown', handleKeyboard);

  // 頁面卸載前提示
  window.addEventListener('beforeunload', handleBeforeUnload);
}

// 處理文件選擇
async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // 驗證文件類型
  if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown') && !file.name.endsWith('.txt')) {
    showToast('請選擇 Markdown 文件 (.md)', 'error');
    return;
  }

  try {
    showToast('正在讀取文件...', 'success');
    
    const content = await readFileAsText(file);
    
    // 更新狀態
    state.currentFile = {
      name: file.name,
      file: file,
      path: file.webkitRelativePath || file.name
    };
    state.lastContent = content;
    state.isDirty = false;
    
    // 更新 UI
    elements.editor.value = content;
    elements.fileName.textContent = file.name;
    updatePreview();
    updateWordCount();
    updateStatus();
    
    showToast(`已打開：${file.name}`, 'success');
    
    // 清空 input，允許重新選擇同一文件
    event.target.value = '';
    
  } catch (error) {
    console.error('讀取文件失敗:', error);
    showToast(`讀取失敗：${error.message}`, 'error');
  }
}

// 讀取文件內容
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('無法讀取文件'));
    reader.readAsText(file, 'UTF-8');
  });
}

// 保存文件
async function handleSave() {
  const content = elements.editor.value;
  
  // 如果是新文件（未打開過），直接下載
  if (!state.currentFile) {
    downloadFile(content, 'untitled.md');
    showToast('已下載新文件', 'success');
    state.isDirty = false;
    state.lastContent = content;
    return;
  }

  try {
    showToast('正在保存...', 'success');
    
    // 創建 Blob
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    
    // 使用 File System Access API（如果在支持環境）
    if ('showSaveFilePicker' in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: state.currentFile.name,
        types: [{
          description: 'Markdown 文件',
          accept: {
            'text/markdown': ['.md', '.markdown'],
            'text/plain': ['.txt']
          }
        }]
      });
      
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      state.isDirty = false;
      state.lastContent = content;
      showToast(`已保存：${state.currentFile.name}`, 'success');
      
    } else {
      // 回退到下載方式
      downloadFile(content, state.currentFile.name);
      state.isDirty = false;
      state.lastContent = content;
      showToast('已下載文件（請手動移動到 iCloud）', 'success');
    }
    
    updateStatus();
    
  } catch (error) {
    console.error('保存失敗:', error);
    if (error.name !== 'AbortError') {
      showToast(`保存失敗：${error.message}`, 'error');
    }
  }
}

// 下載文件
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// 切換預覽模式
function togglePreview() {
  state.isPreviewMode = !state.isPreviewMode;
  
  if (state.isPreviewMode) {
    elements.editorPane.classList.add('hidden');
    elements.previewPane.classList.add('active');
    elements.btnPreview.innerHTML = '<span class="icon">✏️</span><span class="label">編輯</span>';
  } else {
    elements.editorPane.classList.remove('hidden');
    elements.previewPane.classList.remove('active');
    elements.btnPreview.innerHTML = '<span class="icon">👁️</span><span class="label">預覽</span>';
  }
  
  updatePreview();
}

// 更新預覽
function updatePreview() {
  const content = elements.editor.value;
  
  if (state.isPreviewMode) {
    try {
      elements.preview.innerHTML = marked.parse(content);
      
      // 應用語法高亮
      elements.preview.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    } catch (error) {
      elements.preview.innerHTML = '<p class="error">預覽渲染失敗</p>';
    }
  }
}

// 切換暗色模式
function toggleTheme() {
  state.isDarkMode = !state.isDarkMode;
  document.body.classList.toggle('dark-mode', state.isDarkMode);
  elements.btnTheme.innerHTML = state.isDarkMode ? 
    '<span class="icon">☀️</span>' : 
    '<span class="icon">🌙</span>';
  saveSettings();
}

// 更新字數統計
function updateWordCount() {
  const content = elements.editor.value;
  const chars = content.length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const lines = content.split('\n').length;
  
  elements.wordCount.textContent = `${chars} 字元 | ${words} 詞 | ${lines} 行`;
}

// 更新狀態
function updateStatus() {
  const status = state.isDirty ? '● 未保存的更改' : '就緒';
  elements.statusText.textContent = status;
  elements.btnSave.disabled = !state.isDirty;
  elements.btnSave.style.opacity = state.isDirty ? '1' : '0.5';
}

// 處理鍵盤快捷鍵
function handleKeyboard(e) {
  // Ctrl/Cmd + S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
  
  // Ctrl/Cmd + O 打開
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    elements.fileInput.click();
  }
  
  // Ctrl/Cmd + P 預覽切換
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    togglePreview();
  }
  
  // Ctrl/Cmd + B 切換主題
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleTheme();
  }
}

// 頁面卸載前提示
function handleBeforeUnload(e) {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
}

// 顯示提示消息
function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3000);
}

// 本地存儲設置
function saveSettings() {
  localStorage.setItem('md-editor-theme', state.isDarkMode ? 'dark' : 'light');
}

function loadSettings() {
  const theme = localStorage.getItem('md-editor-theme');
  if (theme === 'dark') {
    state.isDarkMode = true;
    document.body.classList.add('dark-mode');
    elements.btnTheme.innerHTML = '<span class="icon">☀️</span>';
  }
}

// 啟動應用
document.addEventListener('DOMContentLoaded', init);
