/**
 * MD 編輯器 Lite - PWA 版本
 * 支持 iCloud 文件讀取與保存
 */

// 視圖模式：edit = 只編輯 / preview = 只預覽 / split = 分屏（邊寫邊看）
const VIEWS = ['edit', 'preview', 'split'];

// 📌 應用版本號（單一可信來源）。
// 每次改動都要 +1，方便在手機上確認跑的是不是最新版（狀態列左下角會顯示）。
const APP_VERSION = '0.7.3';

// 可處理的文字檔副檔名白名單（對齊 todo 編輯器 TEXT_EXTS，取常用子集）
const TEXT_EXTS = [
  '.txt', '.text', '.log', '.csv', '.tsv',
  '.md', '.markdown', '.mdx',
  '.html', '.htm',
  '.json', '.json5', '.jsonc',
  '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.properties', '.cfg', '.xml',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.css', '.scss', '.less',
  '.py', '.rb', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.java', '.kt', '.go', '.rs', '.swift',
  '.php', '.lua', '.r', '.cs', '.scala', '.dart', '.ex', '.erl',
  '.env', '.gitignore', '.editorconfig', '.tex', '.rst', '.diff', '.patch'
];
const TEXT_EXTS_SET = new Set(TEXT_EXTS);
// 無副檔名但約定為文字檔的檔名
const TEXT_NOEXT = new Set([
  'makefile', 'dockerfile', 'rakefile', 'gemfile', 'vagrantfile', 'readme', 'license',
  'changelog', 'copying', 'install', 'authors', 'contributing', 'todo', 'news', 'changes'
]);

// 副檔名 → 檔案類別（決定預覽方式與 MIME）
function classifyFileType(name) {
  const lower = (name || '').toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) return 'md';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.json') || lower.endsWith('.json5') || lower.endsWith('.jsonc')) return 'json';
  return 'text';
}

// 判斷某檔名是否為可編輯的文字檔（副檔名白名單 or 無副檔名約定檔名）
function isTextFile(name) {
  const lower = (name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  // 有副檔名（含 .gitignore/.dockerignore 這類「副檔名即全名」的點檔）→ 查白名單
  if (dot >= 0) {
    const ext = lower.slice(dot);
    return TEXT_EXTS_SET.has(ext);
  }
  // 完全無點 → 查無副檔名約定檔名（Makefile / README …）
  return TEXT_NOEXT.has(lower);
}

// 判斷文字內容是否為 todo 卡片（符合 todo 編輯器的卡片結構）。
// 條件（對齊 openExternalFile）：解析後是物件 + 有 text 字串 + 含 todo 卡片特有字段
// （completed/tags/createdAt/updatedAt/attachments/bgColor 任一即可）。
function isTodoJson(content) {
  if (!content) return false;
  let obj;
  try { obj = JSON.parse(content); } catch (_) { return false; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.text !== 'string') return false;
  return ('completed' in obj) || ('tags' in obj) || ('createdAt' in obj) ||
         ('updatedAt' in obj) || ('attachments' in obj) || ('bgColor' in obj);
}

// 全局狀態
const state = {
  currentFile: null,
  isDirty: false,
  view: 'edit',
  isDarkMode: true,  // 預設暗色模式（無 localStorage 記錄 / 重置後即為黑夜模式）
  lastContent: '',
  // 🆕 todo 卡片模式：打開 todo-*.json（符合 todo 卡片結構）後進入此模式，
  //    編輯器只顯示 markdown 正文（text 字段）；存檔前把改後的 text 合回原物件
  //    再整體序列化，保留所有其它字段（tags/bgColor/attachments/createdAt/...）。
  todoMode: false,
  originalTodo: null  // 打開時的完整原始 todo 物件（保存時以此為基礎合併）
};

// DOM 元素
const elements = {
  btnOpen: document.getElementById('btn-open'),
  btnSave: document.getElementById('btn-save'),
  btnReset: document.getElementById('btn-reset'),
  btnTheme: document.getElementById('btn-theme'),
  fileInput: document.getElementById('file-input'),
  fileName: document.getElementById('file-name'),
  editor: document.getElementById('editor'),
  editorContainer: document.getElementById('editor-container'),
  preview: document.getElementById('preview'),
  tabbar: document.getElementById('tabbar'),
  statusText: document.getElementById('status-text'),
  wordCount: document.getElementById('word-count'),
  appVersion: document.getElementById('app-version'),
  toast: document.getElementById('toast')
};

// 初始化
function init() {
  loadSettings();
  setupEventListeners();
  restoreDraft();
  setView(state.view);
  updateWordCount();
  // 顯示版本號（狀態列左下角）
  if (elements.appVersion) {
    elements.appVersion.textContent = 'v' + APP_VERSION;
    elements.appVersion.title = 'MD 編輯器 Lite v' + APP_VERSION;
  }
  
  // 註冊 Service Worker（使用相對路徑，避免部署在子目錄時 404）
  if ('serviceWorker' in navigator) {
    const swPath = new URL('./sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swPath)
      .then(reg => console.log('SW 註冊成功', reg))
      .catch(err => console.warn('SW 註冊失敗（離線功能不可用）', err));
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

  // 重置：清除所有緩存並重新載入整個應用
  elements.btnReset.addEventListener('click', handleReset);

  // 視圖切換頁簽（事件委派，頁簽增減不用改這裡）
  elements.tabbar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setView(tab.dataset.view);
  });

  // 切換主題
  elements.btnTheme.addEventListener('click', toggleTheme);

  // 編輯器輸入
  elements.editor.addEventListener('input', () => {
    state.isDirty = elements.editor.value !== state.lastContent;
    updatePreview();
    updateWordCount();
    updateStatus();
  });

  // 點擊頁面其它地方關閉工具列下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-md-dropdown]')) closeAllMdDropdowns();
  });

  // 鍵盤快捷鍵
  document.addEventListener('keydown', handleKeyboard);

  // 頁面卸載前提示（桌面端有效；iOS Safari 忽略 beforeunload，改由 visibilitychange 兜底）
  window.addEventListener('beforeunload', handleBeforeUnload);

  // 🆕 iOS 移動端切後台/關閉時無法用 beforeunload，改在離開時自動保存到 localStorage 兜底
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.isDirty) {
      try {
        localStorage.setItem('md-editor-draft', elements.editor.value);
        localStorage.setItem('md-editor-draft-name', (state.currentFile && state.currentFile.name) || '');
      } catch (e) { /* 存儲滿/禁用時忽略 */ }
    }
  });
}

// ========== Markdown 工具列：一鍵插入標記 ==========

// 在編輯器光標處插入 before + 內容 + after。
// 有選中文字 → 包裹選中文字；無選中 → 插入占位符「文本」並選中，方便直接覆寫。
function insertMd(before, after) {
  const ta = elements.editor;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  const body = selected || '文本';
  const replacement = before + body + after;

  ta.value = ta.value.substring(0, start) + replacement + ta.value.substring(end);

  const savedScrollTop = ta.scrollTop;
  ta.focus({ preventScroll: true });
  const newCursor = start + before.length;
  // 有選中 → 光標落在包裹後；無選中 → 選中「文本」二字方便覆寫
  ta.setSelectionRange(newCursor, newCursor + body.length);
  ta.scrollTop = savedScrollTop;

  // 程序化修改要手動觸發 input，保持 isDirty / 預覽 / 字數統計同步
  ta.dispatchEvent(new Event('input', { bubbles: true }));

  closeAllMdDropdowns();
}

// 切換下拉菜單（點其它下拉或頁面空白自動關閉）
function toggleMdDropdown(btn) {
  const dropdown = btn.closest('[data-md-dropdown]');
  const wasOpen = dropdown && dropdown.classList.contains('open');
  closeAllMdDropdowns();
  if (dropdown && !wasOpen) {
    dropdown.classList.add('open');
    const menu = dropdown.querySelector('.md-dropmenu');
    if (menu) {
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = rect.left + 'px';
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          const vw = window.innerWidth || document.documentElement.clientWidth;
          if (rect.left + menu.offsetWidth > vw - 8) {
            menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + 'px';
          }
        });
      }
    }
  }
}

function closeAllMdDropdowns() {
  document.querySelectorAll('[data-md-dropdown].open').forEach((el) => {
    el.classList.remove('open');
    const menu = el.querySelector('.md-dropmenu');
    if (menu) { menu.style.top = ''; menu.style.left = ''; }
  });
}

// 處理文件選擇
async function handleFileSelect(event) {
  const file = event.target.files[0];

  // 🛡️ 立即清空 input，允許下次重選「同一文件」也能觸發 change（否則 iOS 會因 value 未變而不重發事件）。
  //    放在讀取之前（同步），避免異步讀取期間用戶再次選擇時 input 還未清空。
  event.target.value = '';

  if (!file) return;

  // 驗證文件類型：只收文字檔（對齊 todo 編輯器支援的類型）
  if (!isTextFile(file.name)) {
    showToast('不支援的檔案類型（僅支援文字檔：md / json / html / 程式碼 / csv …）', 'error');
    return;
  }

  try {
    showToast('正在讀取文件...', 'success');

    const content = await readFileAsText(file);

    // 🆕 事前解析：如果是 todo 卡片結構的 JSON，編輯器只載入 text 字段；
    //    原物件另存到 state.originalTodo，存檔時再合回去。
    //    這樣所有附加字段（tags/bgColor/attachments/createdAt/completedAt…）都不會被破壞。
    let editorContent = content;
    let todoMode = false;
    let originalTodo = null;
    if (classifyFileType(file.name) === 'json' && isTodoJson(content)) {
      originalTodo = JSON.parse(content);
      editorContent = originalTodo.text || '';
      todoMode = true;
      showToast(`已打開 todo 卡片：${file.name}（只編輯正文，原結構保存時合併）`, 'success');
    } else {
      showToast(`已打開：${file.name}`, 'success');
    }

    // 更新狀態
    state.currentFile = {
      name: file.name,
      file: file,
      path: file.webkitRelativePath || file.name,
      type: classifyFileType(file.name)
    };
    state.lastContent = editorContent;
    state.isDirty = false;
    state.todoMode = todoMode;
    state.originalTodo = originalTodo;

    // 更新 UI
    elements.editor.value = editorContent;
    elements.fileName.textContent = file.name;
    updateTodoModeBadge();   // 顯示「todo 卡片模式」徽章，讓用戶知道保存行為不同
    updatePreview();
    updateWordCount();
    updateStatus();

  } catch (error) {
    console.error('讀取文件失敗:', error);
    showToast(`讀取失敗：${error.message}`, 'error');
  }
}

// 顯示/隱藏 todo 卡片模式徽章（避免用戶存檔時不知道會合併原結構）
function updateTodoModeBadge() {
  const el = document.getElementById('todo-mode-badge');
  if (!el) return;
  el.style.display = state.todoMode ? '' : 'none';
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

// 重置：清除所有本地緩存（localStorage / Service Worker 快取）並重新載入整個應用。
// 用途：當 iCloud 檔案內容看起來「沒更新」時，釋放快取後整頁重載，強制回到乾淨狀態。
async function handleReset() {
  try {
    // 1) 清空本程式的 localStorage（主題/視圖/草稿等全部清除）
    localStorage.clear();

    // 2) 清空 Cache Storage（Service Worker 緩存，可能快取舊的 index.html/app.js）
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 3) 註銷 Service Worker（讓下次載入走全新註冊，避免舊 SW 繼續伺服舊資源）
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // 4) 強制重新載入（繞過 HTTP 快取）
    showToast('已清除所有快取，正在重新載入...', 'success');
    setTimeout(() => {
      window.location.reload();
    }, 300);
  } catch (error) {
    console.error('重置失敗:', error);
    // 即使部分步驟失敗，仍嘗試重載
    showToast('重置中，重新載入...', 'info');
    setTimeout(() => {
      window.location.reload();
    }, 300);
  }
}

// 保存文件
async function handleSave() {
  const rawContent = elements.editor.value;

  // 🆕 todo 卡片模式：把改後的正文合回原始物件再整體序列化，
  //    確保 tags / bgColor / attachments / createdAt / completedAt 等附加字段一個不丟。
  //    對齊 todo 編輯器 openExternalFile / saveExternalTodo 的「Object.assign」做法。
  let content = rawContent;
  let saveAsJson = false;  // todo 模式下要走 JSON.stringify
  if (state.todoMode && state.originalTodo) {
    const merged = Object.assign({}, state.originalTodo, {
      text: rawContent,
      updatedAt: Date.now()
    });
    content = JSON.stringify(merged, null, 2);
    saveAsJson = true;
  }

  // 如果是新文件（未打開過），提示輸入檔名後存出
  if (!state.currentFile) {
    const name = promptFilename('untitled.md');
    if (name === null) return; // 用戶取消
    const how = await saveViaMobile(content, name);
    state.isDirty = false;
    state.lastContent = rawContent;  // 編輯器層面仍記 rawContent
    state.currentFile = { name, file: null, path: name, type: classifyFileType(name) };
    elements.fileName.textContent = name;
    updateStatus();
    showToast(how === 'shared'
      ? '已送出存檔：在分享面板選「儲存到檔案」選位置即可'
      : '已下載新文件', 'success');
    return;
  }

  try {
    showToast(saveAsJson ? '正在合併保存 todo 卡片...' : '正在保存...', 'success');

    // 創建 Blob（按實際副檔名給對應 MIME）
    const blob = new Blob([content], { type: mimeFor(state.currentFile.name) + ';charset=utf-8' });

    // 🛡️ showSaveFilePicker 只有桌面 Chromium（Chrome/Edge/Opera）有；
    // Safari / Firefox / 所有行動端都沒有（MDN 相容性表確認）。
    // 先探測再用，避免在 iOS 上 await 到 undefined 直接拋 TypeError。
    const canPick = ('showSaveFilePicker' in window) && (typeof window.showSaveFilePicker === 'function');
    if (canPick) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: state.currentFile.name,
          types: [{
            description: '文字檔',
            accept: {
              'text/markdown': ['.md', '.markdown'],
              'text/plain': ['.txt', '.log', '.csv', '.tsv'],
              'text/html': ['.html', '.htm'],
              'application/json': ['.json', '.json5', '.jsonc']
            }
          }]
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        state.isDirty = false;
        state.lastContent = rawContent;
        // todo 模式成功保存後，把合併後的物件當成新的 originalTodo，便於後續再次保存時 baseline 正確
        if (saveAsJson) state.originalTodo = JSON.parse(content);
        showToast(saveAsJson
          ? `已合併保存 todo 卡片：${state.currentFile.name}`
          : `已保存：${state.currentFile.name}`, 'success');
      } catch (abortErr) {
        // 用戶在保存對話框點取消（AbortError）—— 靜默，不算錯誤
        if (abortErr && abortErr.name !== 'AbortError') throw abortErr;
      }
    } else {
      // 🍎 iOS / Android：沒有 showSaveFilePicker，
      // 首選系統分享面板（可選「儲存到檔案」直接覆蓋原檔），不行才退回下載
      const how = await saveViaMobile(content, state.currentFile.name);
      state.isDirty = false;
      state.lastContent = rawContent;
      // 行動端無法直接讀回保存後的內容，保留原 originalTodo；下次的保存仍以原結構為基礎
      if (saveAsJson) state.originalTodo = JSON.parse(content);
      showToast(saveAsJson
        ? (how === 'shared'
            ? '已送出 todo 卡片：在分享面板選「儲存到檔案」→ 選原位置 → 覆蓋'
            : '已下載 todo 卡片：點下載項 → 分享 → 儲存到檔案')
        : (how === 'shared'
            ? '已送出存檔：點「儲存到檔案」→ 選原位置 → 覆蓋'
            : '已下載文件：點下載項 → 分享 → 儲存到檔案 可存回 iCloud'), 'success');
    }

    updateStatus();

  } catch (error) {
    // 用戶在保存對話框/分享面板點取消 → 靜默，不算錯誤、也不標成已存檔
    if (error && error.name === 'AbortError') return;
    console.error('保存失敗:', error);
    showToast(`保存失敗：${error.message}`, 'error');
  }
}

// 詢問檔名（新文件保存時）；取消返回 null
function promptFilename(fallback) {
  let name = null;
  try {
    // 桌面端可用 prompt；移動端 PWA 環境 prompt 常被禁用，直接退回 fallback
    const input = window.prompt('請輸入檔名：', fallback);
    name = (input && input.trim()) ? input.trim() : null;
  } catch (e) {
    name = null;
  }
  if (!name) name = fallback;
  // 補副檔名：優先沿用當前文件的副檔名，否則補 .md
  const current = state.currentFile && state.currentFile.name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    const curExt = current ? current.slice(current.lastIndexOf('.')) : '';
    if (curExt && curExt.length > 1 && curExt !== '.') {
      name += curExt;
    } else {
      name += '.md';
    }
  }
  return name;
}

// 副檔名 → MIME（iOS 分享面板 / 下載靠它判斷存成什麼檔）
function mimeFor(filename) {
  const lower = (filename || '').toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const map = {
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.mdx': 'text/markdown',
    '.txt': 'text/plain', '.text': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.html': 'text/html', '.htm': 'text/html',
    '.json': 'application/json', '.json5': 'application/json', '.jsonc': 'application/json',
    '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain', '.ini': 'text/plain',
    '.conf': 'text/plain', '.config': 'text/plain', '.properties': 'text/plain',
    '.cfg': 'text/plain', '.xml': 'application/xml',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
    '.jsx': 'text/javascript', '.ts': 'text/plain', '.tsx': 'text/plain',
    '.vue': 'text/plain', '.svelte': 'text/plain',
    '.css': 'text/css', '.scss': 'text/css', '.less': 'text/css',
    '.py': 'text/x-python', '.rb': 'text/plain', '.sh': 'text/x-shellscript',
    '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript', '.fish': 'text/x-shellscript',
    '.ps1': 'text/plain', '.bat': 'text/plain', '.cmd': 'text/plain',
    '.sql': 'application/sql', '.graphql': 'text/plain', '.gql': 'text/plain',
    '.c': 'text/x-c', '.h': 'text/x-c', '.cpp': 'text/x-c++src', '.cc': 'text/x-c++src',
    '.hpp': 'text/x-c++src', '.java': 'text/x-java', '.kt': 'text/plain', '.go': 'text/plain',
    '.rs': 'text/plain', '.swift': 'text/plain',
    '.php': 'text/plain', '.lua': 'text/plain', '.r': 'text/plain', '.cs': 'text/plain',
    '.scala': 'text/plain', '.dart': 'text/plain', '.ex': 'text/plain', '.erl': 'text/plain',
    '.env': 'text/plain', '.gitignore': 'text/plain', '.editorconfig': 'text/plain',
    '.tex': 'text/plain', '.rst': 'text/plain', '.diff': 'text/plain', '.patch': 'text/plain'
  };
  return map[ext] || 'text/plain';
}

// 副檔名 → highlight.js 語言類別（非 md 檔在預覽裡用語法高亮）
function hljsLangFor(filename) {
  const lower = (filename || '').toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json', '.json5': 'json', '.jsonc': 'json',
    '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.vue': 'xml', '.svelte': 'xml',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.py': 'python', '.rb': 'ruby',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
    '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
    '.java': 'java', '.go': 'go', '.rs': 'rust', '.swift': 'swift',
    '.php': 'php', '.lua': 'lua', '.kt': 'kotlin', '.cs': 'csharp',
    '.scala': 'scala', '.dart': 'dart', '.ex': 'elixir', '.erl': 'erlang',
    '.r': 'r', '.diff': 'diff', '.patch': 'diff', '.ini': 'ini', '.toml': 'ini',
    '.md': 'markdown', '.markdown': 'markdown'
  };
  return map[ext] || '';
}

// 能否用系統分享面板傳「檔案」（iOS 15+ Safari 支援，是行動端唯一像樣的存檔出口）
function canShareFiles() {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    const probe = new File([''], 'probe.txt', { type: 'text/plain' });
    return !!navigator.canShare({ files: [probe] });
  } catch (e) {
    return false;
  }
}

// 透過系統分享面板把內容當檔案交出去（iOS 會彈原生面板，可「儲存到檔案」存回 iCloud Drive）
// 用戶在面板點取消會丟 AbortError，由外層統一靜默
//
// ⚠️ 重要：只传 files，不传 title。
// iOS 的「儲存到檔案」擴展會把 share 物件裡**每個字段**都算成一個待存項目：
// title 也算 1 項（變成一份純文字副檔名無副檔名的 .txt），
// 所以帶 title 時面板底部會顯示「保存為 2 項」並多存一個奇怪檔案。
// 檔名由 File 物件的 .name 屬性提供，iOS 儲存時自然用它，無需 title。
async function shareFile(content, filename) {
  const file = new File([content], filename, { type: mimeFor(filename) });
  await navigator.share({ files: [file] });
}

// 行動端保存路徑：優先分享面板，不支援才退回下載。回傳 'shared' | 'downloaded'
async function saveViaMobile(content, filename) {
  if (canShareFiles()) {
    await shareFile(content, filename);
    return 'shared';
  }
  downloadFile(content, filename);
  return 'downloaded';
}

// 下載文件（最後兜底）
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: mimeFor(filename) + ';charset=utf-8' });
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

// 切換視圖：edit / preview / split
function setView(view) {
  if (VIEWS.indexOf(view) === -1) view = 'edit';
  state.view = view;

  // 誰顯示完全交給 CSS（容器上的 data-view），JS 不逐個加減 class
  elements.editorContainer.dataset.view = view;

  elements.tabbar.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  updatePreview();
  saveSettings();
}

// 更新預覽
function updatePreview() {
  const content = elements.editor.value;

  // 預覽不可見時不浪費渲染（純編輯模式完全看不到）
  if (state.view === 'edit') return;

  // 🛡️ 防護：marked 與 hljs 都是外部 CDN，加載失敗時不讓整頁崩潰
  const hasMarked = (typeof marked !== 'undefined' && typeof marked.parse === 'function');
  const hasHljs = (typeof hljs !== 'undefined' && typeof hljs.highlightElement === 'function');

  // 非 Markdown 檔（json/html/code/csv…）：預覽直接顯示語法高亮的純文字，不跑 marked
  // 例外：todo 卡片模式（.json 但 text 字段是 Markdown）→ 仍當 Markdown 渲染
  const type = (state.currentFile && state.currentFile.type) || 'md';
  if (type !== 'md' && !state.todoMode) {
    const lang = hljsLangFor(state.currentFile ? state.currentFile.name : '');
    const langClass = lang ? ` class="language-${lang}"` : '';
    elements.preview.innerHTML = `<pre><code${langClass}>${escapeHtml(content || '')}</code></pre>`;
    if (hasHljs) {
      elements.preview.querySelectorAll('pre code').forEach((block) => {
        try { hljs.highlightElement(block); } catch (e) { /* 未註冊語言跳過 */ }
      });
    }
    return;
  }

  if (!hasMarked) {
    elements.preview.innerHTML = '<p class="error">Markdown 渲染庫未載入（請檢查網絡連線後重新整理）</p>';
    return;
  }

  try {
    elements.preview.innerHTML = marked.parse(content || '');

    // 應用語法高亮（僅在 hljs 可用時）
    if (hasHljs) {
      elements.preview.querySelectorAll('pre code').forEach((block) => {
        try {
          hljs.highlightElement(block);
        } catch (e) {
          // 未註冊的語言類別不影響整體渲染，跳過即可
        }
      });
    }
  } catch (error) {
    console.error('預覽渲染失敗:', error);
    elements.preview.innerHTML = '<p class="error">預覽渲染失敗：' + (error && error.message ? error.message : error) + '</p>';
  }
}

// HTML 跳脫（非 md 檔預覽時避免內容被當 HTML 解析）
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 切換暗色模式
function toggleTheme() {
  state.isDarkMode = !state.isDarkMode;
  document.body.classList.toggle('dark-mode', state.isDarkMode);
  saveSettings();
  // 主題切換後預覽區的程式碼高亮配色需重繪
  if (state.view !== 'edit') updatePreview();
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
  
  // Ctrl/Cmd + P 循環切換視圖（編輯 → 預覽 → 分屏）
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]);
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
  try {
    localStorage.setItem('md-editor-theme', state.isDarkMode ? 'dark' : 'light');
    localStorage.setItem('md-editor-view', state.view);
  } catch (e) { /* 私密模式/存儲禁用時忽略 */ }
}

function loadSettings() {
  let theme = null;
  try {
    theme = localStorage.getItem('md-editor-theme');
    const savedView = localStorage.getItem('md-editor-view');
    if (VIEWS.indexOf(savedView) !== -1) state.view = savedView;
  } catch (e) { /* 忽略 */ }
  // 預設暗色：只有「顯式存過 light」才切白天；其餘（無記錄 or dark）一律保持暗色。
  if (theme === 'light') {
    state.isDarkMode = false;
    document.body.classList.remove('dark-mode');
  } else {
    state.isDarkMode = true;
    document.body.classList.add('dark-mode');
  }
}

// 🆕 恢復上次離開時未保存的草稿（iOS 關閉頁面時自動備份）
function restoreDraft() {
  try {
    const draft = localStorage.getItem('md-editor-draft');
    if (draft != null && draft !== '') {
      const name = localStorage.getItem('md-editor-draft-name') || '';
      elements.editor.value = draft;
      if (name) {
        state.currentFile = { name, file: null, path: name };
        elements.fileName.textContent = name;
      }
      state.lastContent = draft;
      state.isDirty = false;
      updateStatus();
      // 恢復後清除草稿，避免下次重複覆蓋
      localStorage.removeItem('md-editor-draft');
      localStorage.removeItem('md-editor-draft-name');
      showToast('已恢復上次未保存的內容', 'info');
    }
  } catch (e) { /* 忽略 */ }
}

// 啟動應用（兼容兩種時序：DOM 已就緒直接執行，否則等 DOMContentLoaded）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
