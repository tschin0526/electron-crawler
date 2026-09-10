/**
 * MD 編輯器 Lite - PWA 版本
 * 支持 iCloud 文件讀取與保存
 */

// 視圖模式：edit = 只編輯 / preview = 只預覽 / split = 分屏（邊寫邊看）
const VIEWS = ['edit', 'preview', 'split', 'events'];

// 📌 應用版本號（單一可信來源）。
// 每次改動都要 +1，方便在手機上確認跑的是不是最新版（狀態列左下角會顯示）。
const APP_VERSION = '0.7.17';

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
  // 🆕 todo 卡片模式：開啟 todo-*.json（符合 todo 卡片結構）後進入此模式，
  //    編輯器只顯示 markdown 正文（text 字段）；存檔前把改後的 text 合回原物件
  //    再整體序列化，保留所有其它字段（tags/bgColor/attachments/createdAt/...）。
  todoMode: false,
  originalTodo: null,  // 開啟時的完整原始 todo 物件（保存時以此為基礎合併）
  // 📅 行程視圖（calendar.md 專用）
  calMode: 'list',              // 'list' | 'month'
  calCursor: new Date(),        // 月視圖當前月份
  calSelectedDate: null,        // 月視圖選中日期（YYYY-MM-DD）
  calEvents: [],                // 工作副本（含 uid；每次渲染/編輯前從編輯器緩衝重新解析）
  evFormUid: null,              // 編輯表單當前目標 uid（null = 新增）
  evFormColor: null             // 編輯表單當前選中顏色
};

// DOM 元素
const elements = {
  btnOpen: document.getElementById('btn-open'),
  btnSave: document.getElementById('btn-save'),
  btnReset: document.getElementById('btn-reset'),
  btnTheme: document.getElementById('btn-theme'),
  fileInput: document.getElementById('file-input'),
  fileName: document.getElementById('file-name'),
  tabEvents: document.getElementById('tab-events'),
  eventsList: document.getElementById('events-list'),
  evModeList: document.getElementById('ev-mode-list'),
  evModeMonth: document.getElementById('ev-mode-month'),
  evAddBtn: document.getElementById('ev-add-btn'),
  evMonthNav: document.getElementById('ev-month-nav'),
  evMonthTitle: document.getElementById('ev-month-title'),
  evPrevMonth: document.getElementById('ev-prev-month'),
  evNextMonth: document.getElementById('ev-next-month'),
  evTodayBtn: document.getElementById('ev-today-btn'),
  evMonthWrap: document.getElementById('ev-month-wrap'),
  evMonthGrid: document.getElementById('ev-month-grid'),
  evDayList: document.getElementById('ev-day-list'),
  evFormOverlay: document.getElementById('ev-form-overlay'),
  evFormTitle: document.getElementById('ev-form-title'),
  evFormDelete: document.getElementById('ev-form-delete'),
  evFormCancel: document.getElementById('ev-form-cancel'),
  evFormSave: document.getElementById('ev-form-save'),
  evFTitle: document.getElementById('ev-f-title'),
  evFDate: document.getElementById('ev-f-date'),
  evFAllday: document.getElementById('ev-f-allday'),
  evFDone: document.getElementById('ev-f-done'),
  evFStart: document.getElementById('ev-f-start'),
  evFEnd: document.getElementById('ev-f-end'),
  evFLocation: document.getElementById('ev-f-location'),
  evFColors: document.getElementById('ev-f-colors'),
  evFTags: document.getElementById('ev-f-tags'),
  evFNotes: document.getElementById('ev-f-notes'),
  evFResize: document.getElementById('ev-f-resize'),
  editor: document.getElementById('editor'),
  mdToolbar: document.getElementById('md-toolbar'),
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
      .then(reg => {
        console.log('SW 註冊成功', reg);
        // 🆕 檢測到新 SW 版本 → 等它接管後自動刷新一次，確保拿到最新資源
        //    （緩存優先策略下，若 SW 更新但頁面不刷新，會一直用舊快取）
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch(err => console.warn('SW 註冊失敗（離線功能不可用）', err));

    // 🆕 新 SW 接管後自動刷新，避免停留在舊頁面/舊緩存
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}

// 設置事件監聽
function setupEventListeners() {
  // 開啟文件
  elements.btnOpen.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', handleFileSelect);

  // 保存文件
  elements.btnSave.addEventListener('click', handleSave);

  // 重置：清除所有緩存並重新載入整個應用
  elements.btnReset.addEventListener('click', handleReset);

  // 📅 行程視圖（calendar.md）：模式切換 / 月曆導航 / 新增 / 條目編輯刪除（事件委派）
  if (elements.evModeList) elements.evModeList.addEventListener('click', () => setCalMode('list'));
  if (elements.evModeMonth) elements.evModeMonth.addEventListener('click', () => setCalMode('month'));
  if (elements.evAddBtn) elements.evAddBtn.addEventListener('click', () => openEventForm(null));
  if (elements.evPrevMonth) elements.evPrevMonth.addEventListener('click', () => { state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() - 1, 1); renderEventsContent(); });
  if (elements.evNextMonth) elements.evNextMonth.addEventListener('click', () => { state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() + 1, 1); renderEventsContent(); });
  if (elements.evTodayBtn) elements.evTodayBtn.addEventListener('click', () => { state.calCursor = new Date(); state.calSelectedDate = calendarFmtDate(new Date()); renderEventsContent(); });
  if (elements.evMonthGrid) elements.evMonthGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('.ev-cell[data-date]');
    if (!cell) return;
    state.calSelectedDate = cell.getAttribute('data-date');
    renderCalMonth(elements.editor.value);
  });
  // 條目「編輯/刪除」按鈕：列表視圖與月視圖日列表共用一套委派
  if (elements.eventsList) elements.eventsList.addEventListener('click', onEvListClick);
  if (elements.evDayList) elements.evDayList.addEventListener('click', onEvListClick);
  // 表單
  if (elements.evFormSave) elements.evFormSave.addEventListener('click', saveEventForm);
  if (elements.evFormCancel) elements.evFormCancel.addEventListener('click', closeEventForm);
  if (elements.evFormDelete) elements.evFormDelete.addEventListener('click', deleteEventFromForm);
  if (elements.evFAllday) elements.evFAllday.addEventListener('change', () => {
    elements.evFStart.disabled = elements.evFAllday.checked;
    elements.evFEnd.disabled = elements.evFAllday.checked;
  });
  if (elements.evFormOverlay) elements.evFormOverlay.addEventListener('click', (e) => {
    if (e.target === elements.evFormOverlay) closeEventForm(); // 點遮罩 = 取消
  });
  // ↕ 備註框高度拖拽手柄：iOS Safari 不支持 textarea 原生 resize，用 Pointer Events 自繪（觸屏/鼠標通用）
  if (elements.evFResize && elements.evFNotes) {
    elements.evFResize.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = elements.evFNotes.offsetHeight;
      const onMove = (ev) => {
        const h = Math.max(60, Math.min(420, startH + (ev.clientY - startY)));
        elements.evFNotes.style.height = h + 'px';
      };
      const onEnd = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }

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

// 構造 font-family 的 CSS 值：帶 fallback 鏈時按順序拼接，通用族名（serif/sans-serif/…）不加引號。
// MD 工具列共用，保證各處字體寫法一致（單一可信來源，對齊 todo 編輯器）。
function buildFontCssValue(name, fallbacks) {
  const list = [name].concat(fallbacks || []);
  return list.map(function (f) {
    const s = String(f);
    if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit)$/i.test(s)) return s;
    return "'" + s.replace(/'/g, "\\'") + "'";
  }).join(', ');
}

// 字體選擇器：把選中文字（或占位符）用 <span style="font-family:…"> 包裹。
// 用獨立函數避免 onclick 裡 font 名帶空格時的引號嵌套地獄。
function insertFont(family) {
  // 用 !important 確保覆蓋父元素繼承的 font-family（body 的 -apple-system 在 macOS 上就是 PingFang SC，
  // 不加 !important 時設苹方=設默認，看起來「沒效果」）
  const before = '<span style="font-family: ' + buildFontCssValue(family) + ' !important">';
  insertMd(before, '</span>');
}

// 字體選擇器（帶 fallback 鏈）：name 為首選字體，fallbacks 為候選回退列表。
function insertFontFamily(name, fallbacks, label) {
  const before = '<span style="font-family: ' + buildFontCssValue(name, fallbacks) + ' !important">';
  insertMd(before, '</span>');
}

// 自定義字體：讓用戶輸入任意 font-family（支持逗號分隔多個候選）
function insertCustomFont() {
  const input = window.prompt('輸入 font-family（可填多個，逗號分隔，如：Arial, sans-serif）', '');
  if (!input) return;
  const family = input.trim();
  if (!family) return;
  insertFont(family);
}

// 直接把「字面文本/字符」原樣寫到光標處（不經過 :短碼:，也不會套用「文本」占位符）。
// 供「HTML 實體」子菜單調用——這些項要插的就是空格字符或 HTML 實體文本（&nbsp; 等）本身，
// 而非把它們當作包裹選中文字的前/後綴，所以用單獨的 insertRaw 而非 insertMd。
function insertRaw(text) {
  if (!text) return;
  const ta = elements.editor;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  const savedScrollTop = ta.scrollTop;
  ta.focus({ preventScroll: true });
  const newCursor = start + text.length;
  ta.setSelectionRange(newCursor, newCursor);
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
      showToast(`已開啟 todo 卡片：${file.name}（只編輯正文，原結構保存時合併）`, 'success');
    } else {
      showToast(`已開啟：${file.name}`, 'success');
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

    // 🆕 開啟 .md 文件 → 自動切到「分屏」視圖，同時看到編輯與預覽。
    // 預設是 edit 視圖（純文字），用戶可能誤以為「沒預覽」；切到 split 立即展示 Markdown 渲染結果。
    // todo 卡片模式（json 但 text 是 md）也走 split，這樣能看到渲染效果；其他 json/html/程式碼 保持 edit。
    // 📅 calendar.md（行程應用數據文件）→ 自動切到「行程」視圖，只讀查看行程列表
    updateEventsTabVisibility();
    if (isCalendarMd()) {
      setView('events');
    } else if (state.currentFile.type === 'md' || state.todoMode) {
      setView('split');
    }

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

// ⚠️ 不提供「刷新（重读当前文件）」按钮：iOS 文件选择器返回的 File 對象是內容快照，
//    重讀拿不到 iCloud 的最新內容（永遠同一份），功能無意義。要拿最新內容請重新「開啟」文件。

// 重置：清除所有本地緩存（localStorage / Service Worker 快取）並重新載入整個應用。
// 用途：當 iCloud 檔案內容看起來「沒更新」時，釋放快取後整頁重載，強制回到乾淨狀態。
// 🛡️ 防誤按：需輸入授權碼 123456 才執行。
async function handleReset() {
  // 確認閘門：要求輸入 123456，未輸入正確授權碼一律中止。
  let input = null;
  try {
    input = window.prompt('此操作會清除所有快取並重新載入。\n請輸入授權碼 123456 以繼續：', '');
  } catch (_) {
    input = null;
  }
  if (input !== '123456') {
    showToast('已取消重置（授權碼不正確）', 'error');
    return;
  }

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

  // 如果是新文件（未開啟過），提示輸入檔名後存出
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

  // MD 編輯工具列（格式/字體/段落/表格計算/鏈接跳轉…）只在「要編輯文本」的視圖顯示：
  // edit（編輯文本）/ split（分屏，含編輯區）顯示；preview（MD 預覽）與 events（行事曆）隱藏。
  if (elements.mdToolbar) elements.mdToolbar.style.display = (view === 'edit' || view === 'split') ? '' : 'none';

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

  // 📅 行程視圖（calendar.md 專用）：渲染行程列表 / 月曆而非 markdown
  if (state.view === 'events') {
    renderEventsContent();
    return;
  }

  // 🛡️ 防護：hljs 是外部 CDN，加載失敗時不讓整頁崩潰（md 渲染管線自帶 marked 可用性檢查）
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

  // Markdown / todo 卡片模式：使用移植自 todo 編輯器的完整渲染管線
  // （calc/sort/cols/katex/emoji/圖片定寬高/並排圖組/目錄… 與主程式一致）。
  // 帶 force:true 表示這是「原文 → 渲染」而非已渲染 HTML 的再處理。
  if (typeof renderMarkdown !== 'function') {
    elements.preview.innerHTML = '<p class="error">Markdown 渲染管線未載入（請檢查網絡連線後重新整理）</p>';
    return;
  }

  try {
    elements.preview.innerHTML = renderMarkdown(content || '', { force: true });
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

// ===== 📅 行程視圖（calendar.md 專用，只讀查看） =====
// calendar.md 是行程應用（桌面版 calendar 插件）的數據文件：以 `## EVENT` 分隔的塊 + 反引號字段 + Remark 代碼塊。
// 解析邏輯與 calendar 插件的 parseMarkdownEvents 對齊（單向解析，本視圖不寫回）。

function isCalendarMd() {
  return !!(state.currentFile && String(state.currentFile.name || '').toLowerCase() === 'calendar.md');
}

// 顯示/隱藏「行程」頁簽；文件不是 calendar.md 時若停在行程視圖則退回分屏
function updateEventsTabVisibility() {
  if (!elements.tabEvents) return;
  const show = isCalendarMd();
  elements.tabEvents.style.display = show ? '' : 'none';
  if (!show && state.view === 'events') setView('split');
}

function parseCalendarArrField(s) {
  s = (s || '').trim();
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

function parseCalendarEventBlock(block, idx) {
  // 先把 Remark 代碼塊與字段頭部切開，避免備注內容干擾字段解析（與 calendar 插件一致）
  let remark = '';
  let head = block;
  const ri = block.indexOf('- Remark:');
  if (ri >= 0) {
    head = block.slice(0, ri);
    const after = block.slice(ri + '- Remark:'.length);
    const m = after.match(/```([\s\S]*)```/);
    if (m) {
      remark = m[1].replace(/^\n/, '').replace(/\n$/, '');
      if (remark.trim() === '') remark = '';
    }
  }
  const get = (name) => {
    const m = head.match(new RegExp('- ' + name + ': `([^`]*)`'));
    return m ? m[1] : '';
  };
  const title = get('title');
  if (!title) return null;
  let color = get('color').trim();
  if (color.length >= 2 && color[0] === '"' && color[color.length - 1] === '"') color = color.slice(1, -1);
  return {
    idx,
    uid: 'evp' + idx,  // 确定性 uid：同一內容多次解析結果一致，供編輯/刪除定位
    title,
    date: get('date'),
    allDay: get('allDay') === 'true',
    // 完成狀態：舊檔案沒有 - done 欄位 → 視為未設定 = 未完成
    done: get('done') === 'true',
    startTime: get('startTime'),
    endTime: get('endTime'),
    location: get('location'),
    color: color || '#3b82f6',
    tags: parseCalendarArrField(get('tags')),
    // 修復：此前缺讀 todoIds，往返保存會把 calendar 插件寫入的關聯卡片清空
    todoIds: parseCalendarArrField(get('todoIds')),
    notes: remark
  };
}

function parseCalendarEvents(md) {
  if (!md) return [];
  const events = [];
  const blocks = String(md).split(/^##[ \t]*EVENT[ \t]*$/m);
  for (let i = 0; i < blocks.length; i++) {
    const ev = parseCalendarEventBlock(blocks[i], i);
    if (ev) events.push(ev);
  }
  return events;
}

function calendarFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calendarTimeToMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

// 渲染行程列表：日期升序分組，過去行程淡化，今天高亮；每條帶「編輯/刪除」
function renderEventsList(content) {
  const list = elements.eventsList;
  if (!list) return;
  state.calEvents = parseCalendarEvents(content);
  if (!state.calEvents.length) {
    list.innerHTML = '<div class="ev-empty">尚未有行程<br><span style="font-size:12px">點右上「＋ 新增行程」，或編輯 calendar.md 原文（以 ## EVENT 分隔）</span></div>';
    return;
  }
  const today = calendarFmtDate(new Date());
  const sorted = sortedCalEvents(state.calEvents);

  let html = '';
  let lastDate = null;
  for (const ev of sorted) {
    if (ev.date !== lastDate) {
      lastDate = ev.date;
      html += calDateHeaderHtml(ev.date, today);
    }
    html += evItemHtml(ev, today);
  }
  list.innerHTML = html;
}

// 條目排序：日期升序 → 同日全天在前 → 開始時間
function sortedCalEvents(events) {
  return events.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return calendarTimeToMin(a.startTime) - calendarTimeToMin(b.startTime);
  });
}

function calDateHeaderHtml(date, today) {
  const m = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  let label = '日期未知';
  let week = '';
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    label = (+m[2]) + '月' + (+m[3]) + '日';
    week = WD[d.getDay()];
  }
  const isToday = date === today;
  return '<div class="ev-date' + (isToday ? ' today' : '') + '">' + label +
    (week ? '<span class="ev-week">週' + week + '</span>' : '') +
    (isToday ? '<span class="ev-today-badge">今天</span>' : '') +
    '</div>';
}

// 單條行程 HTML（列表視圖與月視圖日列表共用；含編輯/刪除按鈕，走事件委派）
function evItemHtml(ev, today) {
  const time = ev.allDay ? '全天' : ((ev.startTime || '') + (ev.endTime ? '-' + ev.endTime : ''));
  const past = ev.date < today;
  return '<div class="ev-item' + (past ? ' past' : '') + (ev.done ? ' done' : '') + '">' +
    '<input type="checkbox" class="ev-check" data-ev-done="' + escapeHtml(ev.uid) + '"' +
    (ev.done ? ' checked' : '') + ' title="勾選＝已完成">' +
    '<span class="ev-swatch" style="background:' + escapeHtml(ev.color) + '"></span>' +
    '<div class="ev-body">' +
    '<div class="ev-title">' + escapeHtml(ev.title) +
    (ev.tags && ev.tags.length ? '<span class="ev-tags">' + ev.tags.map(t => '#' + escapeHtml(t)).join(' ') + '</span>' : '') +
    '</div>' +
    '<div class="ev-meta">' + escapeHtml(time) + (ev.location ? ' · 📍' + escapeHtml(ev.location) : '') + '</div>' +
    (ev.notes ? '<div class="ev-notes">' + escapeHtml(ev.notes) + '</div>' : '') +
    '</div>' +
    '<div class="ev-actions">' +
    '<button type="button" data-ev-edit="' + escapeHtml(ev.uid) + '">編輯</button>' +
    '<button type="button" data-ev-del="' + escapeHtml(ev.uid) + '">刪除</button>' +
    '</div></div>';
}

// ===== 📅 行程月視圖 + 新增/編輯（寫回編輯緩衝，按頂欄「保存」落盤） =====

// 與桌面 calendar 插件完全一致的 11 色 iOS 色板
const CAL_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93'];

function genCalId() {
  return 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// 序列化：與桌面 calendar 插件的 eventToMarkdown/eventsToMarkdown 逐字節對齊（桌面端要能讀回）
function calMdEscape(s) {
  return String(s == null ? '' : s).replace(/`/g, "'");
}
function calEventToMarkdown(ev) {
  const tagsJson = JSON.stringify(Array.isArray(ev.tags) ? ev.tags : []);
  const todoJson = JSON.stringify(Array.isArray(ev.todoIds) ? ev.todoIds : []);
  const color = '"' + String(ev.color || '').replace(/^"|"$/g, '') + '"';
  let s = '## EVENT \n';
  s += '- title: `' + calMdEscape(ev.title) + '`\n';
  s += '- date: `' + calMdEscape(ev.date) + '`\n';
  s += '- allDay: `' + (ev.allDay ? 'true' : 'false') + '`\n';
  // 完成狀態：永遠顯式寫出（與桌面 calendar 插件同一欄位、同一順序）
  s += '- done: `' + (ev.done ? 'true' : 'false') + '`\n';
  s += '- startTime: `' + calMdEscape(ev.startTime) + '`\n';
  s += '- endTime: `' + calMdEscape(ev.endTime) + '`\n';
  s += '- location: `' + calMdEscape(ev.location) + '`\n';
  s += '- color: `' + color + '`\n';
  s += '- tags: `' + tagsJson + '`\n';
  s += '- todoIds: `' + todoJson + '`\n';
  s += '- Remark:\n```\n' + String(ev.notes || '') + '\n```\n';
  return s;
}
function calEventsToMarkdown(events) {
  const head = '# 日历行程\n\n> 每条行程以 `## EVENT` 分隔，字段值写在反引号内，Remark 用代码块保存多行备注。\n\n';
  if (!events || !events.length) return head;
  return head + events.map(calEventToMarkdown).join('\n');
}

// 視圖總入口（updatePreview 的 events 分支調用）：按模式渲染列表或月曆
function renderEventsContent() {
  if (!isCalendarMd()) return;
  syncEventsModeUI();
  const content = elements.editor.value;
  if (state.calMode === 'month') renderCalMonth(content);
  else renderEventsList(content);
}

function setCalMode(mode) {
  state.calMode = (mode === 'month') ? 'month' : 'list';
  if (state.calMode === 'month' && !state.calSelectedDate) state.calSelectedDate = calendarFmtDate(new Date());
  renderEventsContent();
}

// 同步工具欄按鈕態 + 列表/月容器可見性
function syncEventsModeUI() {
  const month = state.calMode === 'month';
  if (elements.evModeList) elements.evModeList.classList.toggle('active', !month);
  if (elements.evModeMonth) elements.evModeMonth.classList.toggle('active', month);
  if (elements.evMonthNav) elements.evMonthNav.style.display = month ? '' : 'none';
  if (elements.evMonthWrap) elements.evMonthWrap.style.display = month ? '' : 'none';
  if (elements.eventsList) elements.eventsList.style.display = month ? 'none' : '';
}

// 月曆：6x7 網格（週一開頭），單元格顯示日號 + 最多 2 條 chip + 溢出數；下方渲染選中日的行程列表
function renderCalMonth(content) {
  state.calEvents = parseCalendarEvents(content);
  const cur = state.calCursor;
  const y = cur.getFullYear(), m = cur.getMonth();
  if (elements.evMonthTitle) elements.evMonthTitle.textContent = y + '年' + (m + 1) + '月';
  const byDate = {};
  state.calEvents.forEach(ev => { (byDate[ev.date] = byDate[ev.date] || []).push(ev); });
  if (!state.calSelectedDate) state.calSelectedDate = calendarFmtDate(new Date());
  const todayStr = calendarFmtDate(new Date());
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // 週一開頭
  const start = new Date(y, m, 1 - offset);
  const HEADS = ['一', '二', '三', '四', '五', '六', '日'];
  let html = HEADS.map(h => '<div class="ev-mc-head">' + h + '</div>').join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = calendarFmtDate(d);
    const out = d.getMonth() !== m;
    const evs = sortedCalEvents(byDate[ds] || []);
    let chips = '';
    for (let j = 0; j < Math.min(2, evs.length); j++) {
      chips += '<div class="ev-chip' + (evs[j].done ? ' done' : '') + '"><span class="dot" style="background:' + escapeHtml(evs[j].color) + '"></span>' + (evs[j].done ? '✓ ' : '') + escapeHtml(evs[j].title) + '</div>';
    }
    if (evs.length > 2) chips += '<div class="ev-more">+' + (evs.length - 2) + '</div>';
    html += '<div class="ev-cell' + (out ? ' out' : '') + (ds === todayStr ? ' today' : '') + (ds === state.calSelectedDate ? ' selected' : '') + '" data-date="' + ds + '">' +
      '<span class="ev-daynum">' + d.getDate() + '</span>' + chips + '</div>';
  }
  if (elements.evMonthGrid) elements.evMonthGrid.innerHTML = html;
  renderCalDayList();
}

// 月視圖下方：選中日期的行程列表（含編輯/刪除 + 該日新增入口）
function renderCalDayList() {
  const list = elements.evDayList;
  if (!list) return;
  const ds = state.calSelectedDate || calendarFmtDate(new Date());
  const today = calendarFmtDate(new Date());
  const m = String(ds).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const evs = sortedCalEvents(state.calEvents.filter(e => e.date === ds));
  let html = '<div class="ev-date' + (ds === today ? ' today' : '') + '">' +
    (m ? (+m[2]) + '月' + (+m[3]) + '日' : '日期未知') +
    '<span class="ev-week">週' + WD[d.getDay()] + '</span>' +
    (ds === today ? '<span class="ev-today-badge">今天</span>' : '') +
    '<span class="ev-week">· ' + evs.length + ' 條</span>' +
    '<span class="ev-toolbar-flex"></span>' +
    '<button type="button" class="ev-day-add" data-ev-add-on="' + escapeHtml(ds) + '">＋ 此日新增</button>' +
    '</div>';
  if (!evs.length) {
    html += '<div class="ev-empty">這一天沒有行程</div>';
  } else {
    for (const ev of evs) html += evItemHtml(ev, today);
  }
  list.innerHTML = html;
}

// 條目操作（事件委派）：編輯 / 刪除 / 月視圖「此日新增」
function onEvListClick(e) {
  // 完成勾選框：切換 done → 寫回編輯緩衝（按頂欄「保存」才落盤）
  const doneChk = e.target.closest('[data-ev-done]');
  if (doneChk) { toggleEventDone(doneChk.getAttribute('data-ev-done'), doneChk.checked); return; }
  const editBtn = e.target.closest('[data-ev-edit]');
  if (editBtn) { openEventForm(editBtn.getAttribute('data-ev-edit')); return; }
  const delBtn = e.target.closest('[data-ev-del]');
  if (delBtn) { deleteEventByUid(delBtn.getAttribute('data-ev-del')); return; }
  const addBtn = e.target.closest('[data-ev-add-on]');
  if (addBtn) { openEventForm(null, addBtn.getAttribute('data-ev-add-on')); return; }
}

// 打開表單：uid 為 null = 新增（預設日期 = 月視圖選中日或今天）；uid 有值 = 編輯該條
function openEventForm(uid, defaultDate) {
  if (!isCalendarMd()) return;
  state.calEvents = parseCalendarEvents(elements.editor.value);
  state.evFormUid = null;
  let ev = null;
  if (uid) {
    ev = state.calEvents.find(x => x.uid === uid) || null;
    if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
    state.evFormUid = uid;
  }
  const today = calendarFmtDate(new Date());
  elements.evFormTitle.textContent = uid ? '編輯行程' : '新增行程';
  elements.evFTitle.value = ev ? ev.title : '';
  elements.evFDate.value = ev ? ev.date : (defaultDate || (state.calMode === 'month' ? state.calSelectedDate : today) || today);
  elements.evFAllday.checked = ev ? ev.allDay : false;
  // 完成狀態：新增預設未完成（舊檔案沒有 - done 欄位時解析也是未完成）
  elements.evFDone.checked = ev ? !!ev.done : false;
  elements.evFStart.value = ev ? ev.startTime : '';
  elements.evFEnd.value = ev ? ev.endTime : '';
  elements.evFStart.disabled = elements.evFAllday.checked;
  elements.evFEnd.disabled = elements.evFAllday.checked;
  elements.evFLocation.value = ev ? ev.location : '';
  state.evFormColor = ev ? ev.color : CAL_COLORS[0];
  elements.evFTags.value = ev && ev.tags ? ev.tags.join(', ') : '';
  elements.evFNotes.value = ev ? ev.notes : '';
  elements.evFormDelete.style.display = uid ? '' : 'none';
  renderEvColorSwatches();
  elements.evFormOverlay.style.display = 'flex';
  elements.evFTitle.focus();
}

function renderEvColorSwatches() {
  if (!elements.evFColors) return;
  elements.evFColors.innerHTML = CAL_COLORS.map(c =>
    '<span class="sw' + (c === state.evFormColor ? ' selected' : '') + '" data-color="' + c + '" style="background:' + c + '"></span>'
  ).join('');
  // 色板選擇（一次性委派，openEventForm 每次重建）
  elements.evFColors.onclick = (e) => {
    const sw = e.target.closest('.sw[data-color]');
    if (!sw) return;
    state.evFormColor = sw.getAttribute('data-color');
    elements.evFColors.querySelectorAll('.sw').forEach(x => x.classList.toggle('selected', x.getAttribute('data-color') === state.evFormColor));
  };
}

function closeEventForm() {
  if (elements.evFormOverlay) elements.evFormOverlay.style.display = 'none';
  state.evFormUid = null;
  state.evFormColor = null;
}

// 表單「寫入編輯內容」：校驗 → upsert 工作副本 → 重新序列化整份 calendar.md → 寫回編輯器緩衝（isDirty = true）
// ⚠️ 不直接落盤：iOS 無法直接寫原文件，走現有「保存」流程（分享面板 → 儲存到檔案 → 覆蓋）
function saveEventForm() {
  const title = elements.evFTitle.value.trim();
  const date = elements.evFDate.value;
  if (!title) { alert('請輸入標題'); elements.evFTitle.focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('請選擇日期'); elements.evFDate.focus(); return; }
  const allDay = elements.evFAllday.checked;
  const ev = {
    uid: state.evFormUid || genCalId(),
    title,
    date,
    allDay,
    done: elements.evFDone.checked,
    startTime: allDay ? '' : elements.evFStart.value,
    endTime: allDay ? '' : elements.evFEnd.value,
    location: elements.evFLocation.value.trim(),
    color: state.evFormColor || CAL_COLORS[0],
    tags: elements.evFTags.value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    notes: elements.evFNotes.value.replace(/\r\n/g, '\n')
  };
  // 以當前編輯器內容為基準重新解析（保留用戶可能手改過的其它條目），再 upsert
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const i = state.calEvents.findIndex(x => x.uid === ev.uid);
  if (i >= 0) state.calEvents[i] = ev;
  else state.calEvents.push(ev);
  applyEventsToEditor();
  closeEventForm();
  showToast('已寫入編輯內容，按頂欄「保存」存回文件', 'success');
}

// 刪除：confirm → 從工作副本移除 → 寫回編輯器緩衝
function deleteEventByUid(uid) {
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find(x => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  if (!window.confirm('確定刪除行程「' + ev.title + '」（' + ev.date + '）嗎？\n\n寫入後按「保存」才會真正存回文件。')) return;
  state.calEvents = state.calEvents.filter(x => x.uid !== uid);
  applyEventsToEditor();
  showToast('已刪除「' + ev.title + '」，按「保存」存回文件', 'success');
}

function deleteEventFromForm() {
  if (!state.evFormUid) return;
  const uid = state.evFormUid;
  closeEventForm();
  deleteEventByUid(uid);
}

// 清單上的「完成」勾選框：切換 done → 寫回編輯緩衝（applyEventsToEditor 內會重繪行程視圖）
function toggleEventDone(uid, done) {
  state.calEvents = parseCalendarEvents(elements.editor.value);
  const ev = state.calEvents.find(x => x.uid === uid);
  if (!ev) { showToast('找不到該條行程（內容可能已被修改）', 'error'); return; }
  ev.done = !!done;
  applyEventsToEditor();
  showToast(ev.done ? '已標記完成，按「保存」存回文件' : '已取消完成，按「保存」存回文件', 'success');
}

// 把工作副本序列化為 calendar.md 全文寫回編輯器緩衝；
// lastContent 不動 → isDirty = true → 頂欄「保存」亮起，由用戶決定何時落盤
function applyEventsToEditor() {
  elements.editor.value = calEventsToMarkdown(state.calEvents);
  state.isDirty = elements.editor.value !== state.lastContent;
  updateStatus();
  updateWordCount();
  updatePreview(); // 重新渲染行程列表 / 月曆
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
  
  // Ctrl/Cmd + O 開啟
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
      updateEventsTabVisibility(); // 📅 草稿若來自 calendar.md，恢復「行程」頁簽可見性
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
