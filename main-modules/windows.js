/**
 * 窗口管理与 UI IPC 模组
 * 从 main.js 拆分而来
 */
const { BrowserWindow, ipcMain, clipboard, nativeImage, app, dialog, screen, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
// 便利貼設定可攜 JSON 的轉換／驗證（與 LITE 共用同一份，見 src/pwa-md-editor/sticky-settings.js）
const StickySettings = require('../src/pwa-md-editor/sticky-settings.js');

// 应用根目录（本模组位于 main-modules/ 子目录，回退一级即 electron-crawler 根）
const APP_ROOT = path.join(__dirname, '..');

let mainWindow = null;
let stickyCalendarReadyWindowId = null;
let elementViewerWindow = null;
let domTreeViewWindow = null;
let aiResponseViewerWindow = null;
const stickyNoteWindows = new Map();   // 'noteKey#idx' -> BrowserWindow

// 🆕 B方案：邮件详情窗口主题跟随主程式统一控制
//    主进程维护全局工作区黑夜模式状态，并跟踪所有已打开的邮件详情窗口，
//    主题切换时主动通知它们，无需重启即可实时跟随。
let workspaceDarkModeEnabled = false;
const emailDetailWindows = new Set();
const cardWindows = new Set();

// 把当前工作区主题（dark/light）应用到所有已打开的邮件详情窗口
function applyWorkspaceThemeToEmailDetails(dark) {
  emailDetailWindows.forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(
        `document.body.classList.toggle('dark', ${dark ? 'true' : 'false'});`
      ).catch(() => {});
    }
  });
}

let APP_VERSION = '';
let apiServerModule = null;
let setMainWindowCallback = () => {};
// 🆕 插件资料目录（由 main.js 经 init 注入）：裸档名解析（resolve-doc-path）的默认查找目录，
//    与卡片存储目录（PLUGINS_DATA_DIR）保持一致
let PLUGINS_DATA_DIR = '';
let reloadViewRulesAfterOpen = null;   // 🆕 由 view-sticky-rules.js 注入：open-sticky-notes 后重载规则

// 选择器测试结果回调映射（用于等待异步结果）
const selectorTestCallbacks = new Map();
let selectorTestSeq = 0;

function createElementViewerWindow() {
  if (elementViewerWindow) {
    elementViewerWindow.focus();
    return elementViewerWindow;
  }

  elementViewerWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '📊 Webview 元素结构查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  elementViewerWindow.loadFile('src/element-viewer.html');

  if (process.argv.includes('--dev')) {
    elementViewerWindow.webContents.openDevTools();
  }

  elementViewerWindow.on('closed', () => {
    elementViewerWindow = null;
  });

  return elementViewerWindow;
}

function createDomTreeViewWindow() {
  if (domTreeViewWindow) {
    domTreeViewWindow.focus();
    return domTreeViewWindow;
  }

  domTreeViewWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: ' DOM 树形结构查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  domTreeViewWindow.loadFile('src/dom-tree-viewer.html');

  if (process.argv.includes('--dev')) {
    domTreeViewWindow.webContents.openDevTools();
  }

  domTreeViewWindow.on('closed', () => {
    domTreeViewWindow = null;
  });

  return domTreeViewWindow;
}

function createAiResponseViewerWindow() {
  if (aiResponseViewerWindow) {
    aiResponseViewerWindow.focus();
    return aiResponseViewerWindow;
  }

  aiResponseViewerWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: '📥 AI 回复查看器',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f0f2f5'
  });

  aiResponseViewerWindow.loadFile('src/ai-response-viewer.html');

  if (process.argv.includes('--dev')) {
    aiResponseViewerWindow.webContents.openDevTools();
  }

  aiResponseViewerWindow.on('closed', () => {
    aiResponseViewerWindow = null;
  });

  return aiResponseViewerWindow;
}

function createWindow(options = {}) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

  const windowWidth = Math.round(screenWidth * 0.95);
  const windowHeight = Math.round(screenHeight * 0.95);

  // 🆕 独立模式：./start.sh --todolist 时，主窗口直接加载 TodoList 插件入口
  //    其余参数照常启动完整智控台。TodoList 本身已是完整应用且只用 preload 暴露的
  //    electronAPI，无需任何插件侧改动；数据目录、子窗口（卡片/图片）照常可用。
  //    邮件按钮因依赖 webview 宿主桥接，在独立模式下由插件自身的 index.html 隐藏。
  const isTodolistMode = process.argv.includes('--todolist');
  const isCalendarMode = process.argv.includes('--calendar');
  const isStickyMode = process.argv.includes('--sticky');
  // --sticky 单独使用时（未带 --calendar/--todolist）：只显示桌面便利贴，
  // 主窗口（calendar 应用）不展开在画面上，仅停驻功能坞（Dock）。
  const isStickyOnly = isStickyMode && !isCalendarMode && !isTodolistMode;

  // 🆕 主题参数：--dark 强制暗色、--light 强制亮色。
  //    解析后作为查询参数透传给入口 HTML：独立模式由 TodoList 自身读取，主程序模式暂透传（留待后续接入）。
  let themeArg = null;
  if (process.argv.includes('--dark')) themeArg = 'dark';
  else if (process.argv.includes('--light')) themeArg = 'light';

  stickyCalendarReadyWindowId = null;
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    title: isCalendarMode ? '📅 行事历' : (isTodolistMode ? '📝 TodoList' : ('无限空间·AI智控台 v' + APP_VERSION)),  // ✨ 显示版本号
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      disableBlinkFeatures: 'SameSiteByDefaultCookies,CookieWithoutSameSite',
      webviewTag: true
    },
    icon: path.join(APP_ROOT, 'icon.png'),
    // --sticky 单独启动：主窗口隐藏，只让便利贴浮在桌面上，calendar 应用仅驻留 Dock
    show: typeof options.show === 'boolean' ? options.show : !isStickyOnly,
    backgroundColor: '#ffffff'
  });

  // 同步主窗口引用回 main.js（供其他模组/逻辑访问）
  setMainWindowCallback(mainWindow);

  if (isCalendarMode || isTodolistMode || isStickyMode) {
    // 🆕 独立模式：加载 TodoList（内含已迁移完整的行事历功能：列表/月/周/日视图、标签过滤、Todo 关联）。
    // 原独立「行事历插件」(src/plugins/calendar) 已删除；--calendar 现等价复用 TodoList 独立模式。
    // 🆕 --sticky：进入日历（后台加载 calendar.md 以便取得路径与便利贴清单）并自动弹出桌面便利贴窗口。
    //    --sticky 单独使用时主窗口已设为 show:false（仅驻留 Dock），画面上只显示便利贴；
    //    --calendar --sticky 同时使用时主窗口照常展开日历并叠加便利贴。
    const search = '?standalone=1' + ((isCalendarMode || isStickyMode) ? '&cal=1' : '') +
      (isStickyMode && !options.skipStickyRestore ? '&sticky=1' : '') + (themeArg ? '&theme=' + themeArg : '');
    mainWindow.loadFile('src/plugins/todolist/index.html', { search });
    console.log('📌 [Main] 独立模式：主窗口已加载 TodoList（standalone=1' + (themeArg ? '，主题=' + themeArg : '') + '）');
  } else {
    // 主程序模式：若带了 --dark/--light 也透传查询参数（当前 TodoList 之外的主界面有自己的主题切换，参数暂不影响主界面）
    const search = themeArg ? '?theme=' + themeArg : '';
    mainWindow.loadFile('src/crawler-window.html', search ? { search } : undefined);
  }

  // ✨ 动态设置窗口标题（确保版本号显示，覆盖 HTML 的 title）
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.setTitle(isCalendarMode ? '📅 行事历' : (isTodolistMode ? '📝 TodoList' : ('无限空间·AI智控台 v' + APP_VERSION)));
      console.log('📌 [Main] 窗口标题已设置为:', isCalendarMode ? '行事历（独立模式）' : (isTodolistMode ? 'TodoList（独立模式）' : ('v' + APP_VERSION)));
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stickyCalendarReadyWindowId = null;
    setMainWindowCallback(null);
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ show: true, skipStickyRestore: true });
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

function ensureMainWindowForBackgroundSave() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ show: false, skipStickyRestore: true });
  }
  return mainWindow;
}

// ============================================================
// 🆕 桌面便利贴（每张一个独立小窗口）
//    每张便利贴 = 一个 frameless 小窗，只占自己那一小块 → 不挡整个桌面，
//    拖动/缩放/关闭/改色/透明度/唤起主程式全部在贴纸本体上直接操作（无需主程式整理模式）。
//    状态（位置/尺寸/颜色/透明度）集中存 calendar.md 同目录 sticky-notes-state.json。
// ============================================================
const stickyNoteHtml = new Map();     // 'noteKey#idx' -> 主窗口渲染好的 Markdown HTML
const stickyNoteTitleHtml = new Map(); // 'noteKey#idx' -> 主窗口渲染好的标题 HTML（与列表行同一 tlRenderInlineMarkdown 管线）
// 🆕 便利贴来源元数据：'noteKey#idx' -> { notes, src, title, date, done, tags }
//   src＝该行程来自哪个 INCLUDE 外部文件（空＝calendar.md 正式档）；便利贴窗据此显示文档名徽标，
//   并在编辑时上报 src，让主窗口把结果写回对应文件而不是 calendar.md。
const stickyNoteMeta = new Map();

// 🆕 翻页显示模式：single window 循环多张便利贴
let stickyNoteOrder = [];          // 翻页顺序 [{key, idx}]（与 split 模式并行存在）
let stickyNoteCatalog = [];        // 本次 Calendar 会话中全部已设定的便利贴（含已关闭项）
let lastStickyCatalogSync = 0;     // 🆕 方案B：最近一次 sticky-note-sync 刷新目录的时间戳
let stickyOrderRefreshSeq = 0;     // 🆕 方案B：触发重算的请求序号
const STICKY_ORDER_REFRESH_TTL = 1200; // 🆕 方案B：目录近期已刷新则复用，避免频繁重算
let stickyNoteMode = 'split';       // 'split'（分体显示：每张一个独立小窗）/ 'flip'（翻页显示：单窗循环）
let stickyNoteFlipWindow = null;    // 翻页模式唯一的窗口
const FLIP_KEY = '__flip__', FLIP_IDX = 0; // 翻页窗几何专用 id（位置/尺寸独立，与「当前显示哪张」无关）
// 🆕 VIEW 便利贴（投影贴）：主程式把「全部行程里符合某个条件的行」汇总成这种合成贴。
//   两张来源：🔔 提醒（写死抓 [[remind:]]，key＝__view__）＋ 使用者自订的规则
//   （main-modules/view-sticky-rules.js 存的 JSON，key＝__view__:<规则 id>）。
//   它是 calendar.md 的「投影」，不是使用者新建的便利贴 → 主进程把关三件事：
//     ① 内容永不落盘（正文每次由日历窗现算；档案里只准存这张贴的外观／几何／清单开关，
//        那属于使用者对这张贴的偏好，跟一般便利贴同规则 —— 2026-10-27 使用者要求）；
//     ② 不可异动资料（保存回写、删除一律拒绝）；
//     ③ 浏览链路与普通便利贴相同（照进 catalog／order／清单／翻页）。
const VIEW_KEY = '__view__', VIEW_IDX = 0;
// ⚠️ 前缀判断，不是等值判断：新增一张自订投影贴就多一个 key，这里漏改＝它会被当普通便利贴写回档案。
const isViewKey = (key) => {
  const s = String(key == null ? '' : key);
  return s === VIEW_KEY || s.indexOf(VIEW_KEY + ':') === 0;
};
let stickyStateSaveTimer = null;    // 翻页状态（最后停留那张／清单开关）落盘去抖（与几何 persistPos 同节奏）
const pendingStickyEditSaves = new Map();
let stickyEditSaveSeq = 0;
const pendingStickyMenuCloses = new Map();
let stickyMenuCloseSeq = 0;
const pendingStickyRefreshes = new Map();

let stickyNoteFile = '';            // 当前 Calendar 档案绝对路径（便利贴存档写在同目录）
let stickyNoteState = null;         // null＝本次会话还没成功读到存档 → 绝不允许落盘（见 saveStickyNoteState）

function stickyStatePath() {
  return stickyNoteFile ? path.join(path.dirname(stickyNoteFile), 'sticky-notes-state.json') : '';
}
function stickyStateBadName(p) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return p + '.corrupt-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
    + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.json';
}
// ⚠️ 存档读不到／解析失败时，绝不可当成「没有设定」继续运作：
//    之前是 catch 后回传 {} → 之后任何一次存盘都会用 {} 覆盖整份档案，
//    使用者所有便利贴的颜色／字号／尺寸就这样被静默清空（2026-10-20 用户回馈）。
//    现在：先把原始字节改名保留成 .corrupt-* 副本（不是删，是留档），再弹讯息告知使用者。
//    同一路径只提醒一次，避免每次存盘都跳同一个视窗。
const stickyStateWarnedPaths = new Set();
function stickyStateUnreadable(p, raw, why) {
  if (stickyStateWarnedPaths.has(p)) return;
  stickyStateWarnedPaths.add(p);
  let kept = '';
  try {
    if (typeof raw === 'string' && raw.trim()) {
      kept = stickyStateBadName(p);
      fs.writeFileSync(kept, raw, 'utf8');
    }
  } catch (e) { kept = ''; }
  console.warn('[Main] ⚠️ 便利贴存档读不到（' + why + '）:', p);
  try {
    dialog.showMessageBox({
      type: 'warning',
      title: '便利贴设定档无法读取',
      message: '便利贴的设定存档（sticky-notes-state.json）' + why + '。',
      detail: (kept ? '原始内容已原样保留为：\n' + kept + '\n' : '原始档案里没有内容，没有可保留的字节。\n')
        + '程式会以空白设定继续运行；若你之前设定过颜色／字号／尺寸，请到上述副本档案确认还能不能捞回来。',
      buttons: ['我了解了'],
      defaultId: 0, noLink: true
    }).catch(() => {});
  } catch (e) { /* 弹不出来也不能阻塞开档 */ }
}
function parseStickyState(raw) {
  const j = JSON.parse(raw);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('内容不是设定对象');
  return j;
}
// canWrite：读不到档案时还能不能安全地重建它。
//   读档本身失败（权限／档案被系统移走）→ 里面可能还有资料，绝不覆写；
//   档案是空的／是解析不了的乱码 → 字节已保留副本（或本来就没字节），覆写不会额外弄丢任何东西。
function readStickyStateFile(p) {
  if (!p || !fs.existsSync(p)) return { ok: true, state: {}, text: '', canWrite: true };
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { stickyStateUnreadable(p, '', '读取失败（' + e.message + '）'); return { ok: false, state: {}, text: '', canWrite: false }; }
  if (!raw || !raw.trim()) { stickyStateUnreadable(p, raw, '是空的'); return { ok: false, state: {}, text: '', canWrite: true }; }
  try { return { ok: true, state: parseStickyState(raw), text: raw, canWrite: true }; }
  catch (e) { stickyStateUnreadable(p, raw, '内容解析失败（' + e.message + '）'); return { ok: false, state: {}, text: '', canWrite: true }; }
}
function loadStickyNoteState() {
  return readStickyStateFile(stickyStatePath()).state;
}
// 磁盘 ∪ 内存（内存优先，逐字段合并）：内存里没提到的 key／idx 一律保留，
// 所以哪怕本次会话只开了一张贴纸，存盘也不会把其他张贴纸的设定抹掉。
function mergeStickyState(disk, mem) {
  const cloneEntry = (it) => (it && typeof it === 'object') ? Object.assign({}, it) : it;
  const out = {};
  Object.keys(disk || {}).forEach((k) => {
    out[k] = Array.isArray(disk[k]) ? disk[k].map(cloneEntry) : disk[k];
  });
  Object.keys(mem || {}).forEach((k) => {
    if (!Array.isArray(mem[k])) { out[k] = mem[k]; return; }
    const base = Array.isArray(out[k]) ? out[k] : [];
    const arr = base.slice();
    mem[k].forEach((m, i) => { arr[i] = Object.assign({}, cloneEntry(arr[i]) || {}, cloneEntry(m) || {}); });
    out[k] = arr;
  });
  return out;
}
// 先写同档名 .tmp 再 rename 换过去：直接 writeFileSync 会先 truncate，
// 写入途中被强行退出／iCloud 档案同步插队 → 留下一份 0 字节的空档（设定等于被删）。
function writeStickyStateFile(p, text) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, p); }
  catch (e) { fs.writeFileSync(p, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) {} }
}
function saveStickyNoteState() {
  try {
    const p = stickyStatePath();
    if (!p || !stickyNoteState) return false;      // 还没读到存档 → 不写（宁可不存，也不覆盖）
    const disk = readStickyStateFile(p);
    if (!disk.canWrite) return false;              // 档案现在读不到且里面可能还有资料 → 冻存
    const merged = mergeStickyState(disk.state, stickyNoteState);
    // 🆕 投影贴（🔔 提醒／自定义 VIEW 贴）的「外观」照一般便利贴一样落盘（2026-10-27 使用者要求）：
    //    颜色／文字色／字号／透明度／尺寸／位置／只看未完成 都是使用者对这张贴的偏好，跟内容无关；
    //    不落盘的从来只有「内容」——正文每次由日历窗从 calendar.md 现算，档案里那几个字节是 ref 之外的东西。
    //    ⚠️ 若哪天要恢复剔除，只能剔除「要写出去的复本」，不能在 merged 上直接 delete：
    //    下一行 stickyNoteState = merged 会把内存里那份一起抹掉 → 本会话改的样式／位置当场读不回来。
    const text = JSON.stringify(merged, null, 2);
    if (disk.ok && disk.text === text) { stickyNoteState = merged; return true; }   // 内容没变就不重写档案（iCloud 目录里少一次无谓同步）
    writeStickyStateFile(p, text);
    stickyNoteState = merged;
    return true;
  } catch (e) {
    console.warn('[Main] 便利贴存档写入失败（本次不覆盖旧档）:', e);
    return false;
  }
}

// ===== 設定備份：可攜 JSON（與 LITE 互通）=====
// 桌面原生存檔 sticky-notes-state.json 本來就會自動讀寫；這兩個動作是給
// 「手機 ↔ 桌面」搬設定用的：匯出只含樣式／開關／頁次（幾何位置留在原生檔），
// 載入時也認得桌面原生檔（委由 StickySettings.normalize 轉換）。
function stickySettingsDialogParent() {
  if (stickyNoteMode === 'flip' && stickyNoteFlipWindow && !stickyNoteFlipWindow.isDestroyed()) {
    return stickyNoteFlipWindow;
  }
  for (const win of stickyNoteWindows.values()) {
    if (win && !win.isDestroyed()) return win;
  }
  return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
}
function peekNoteInst(key, idx) {
  const arr = stickyNoteState && stickyNoteState[key];
  const it = (Array.isArray(arr) && arr[idx] && typeof arr[idx] === 'object') ? arr[idx] : null;
  return it;
}
function buildStickyPortableSettings() {
  const notes = {};
  (stickyNoteCatalog || []).forEach((note) => {
    const identity = flipNoteIdentity(note);
    if (!identity || identity === '||0') return;
    const prefs = StickySettings.pickPrefs(peekNoteInst(note.key, note.idx));
    if (Object.keys(prefs).length) notes[identity] = prefs;
  });
  const flip = peekNoteInst(FLIP_KEY, FLIP_IDX) || {};
  return StickySettings.buildPortable({
    notes,
    hidden: Array.isArray(flip.flipHidden) ? flip.flipHidden : [],
    lastId: typeof flip.lastId === 'string' ? flip.lastId : '',
    lastIdx: Number.isFinite(+flip.lastIdx) ? +flip.lastIdx : 0
  }, stickyNoteFile ? path.basename(stickyNoteFile) : '', 'electron-crawler');
}
// 导入后让已开窗口立刻吃到新样式；翻页模式同时按新的关闭清单重算顺序
function refreshStickyWindowsAfterSettings() {
  if (stickyNoteMode === 'flip') {
    const hidden = flipHiddenSet();
    stickyNoteOrder = stickyNoteCatalog.filter((note) => !hidden.has(flipHiddenIdOf(note)));
    const win = stickyNoteFlipWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('sticky-note-order-updated', { order: stickyNoteOrder, skipRender: true });
      // 带上汇入档的「上次页次」：渲染端据此跳页，否则重绘会立刻把当前页写回 lastId／lastIdx，
      // 等于刚汇入的页次马上被旧值盖掉。
      const flip = peekNoteInst(FLIP_KEY, FLIP_IDX) || {};
      win.webContents.send('sticky-note-apply-state', {
        lastId: typeof flip.lastId === 'string' ? flip.lastId : '',
        lastIdx: Number.isFinite(+flip.lastIdx) ? +flip.lastIdx : 0
      });
    }
    return;
  }
  stickyNoteWindows.forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send('sticky-note-apply-state');
  });
}
ipcMain.handle('sticky-notes-export-settings', async () => {
  try {
    if (!stickyNoteFile || !stickyNoteState) return { ok: false, error: '尚未开启便利贴' };
    const win = stickySettingsDialogParent();
    const base = stickyNoteFile ? path.basename(stickyNoteFile).replace(/\.[^.]+$/, '') : 'calendar';
    const opts = {
      title: '汇出便利贴设定 JSON',
      defaultPath: path.join(path.dirname(stickyNoteFile), 'sticky-notes-settings-' + base + '.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const payload = buildStickyPortableSettings();
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return {
      ok: true,
      path: res.filePath,
      notes: Object.keys(payload.notes).length,
      hidden: payload.hidden.length
    };
  } catch (e) {
    console.warn('[Main] 便利贴设定汇出失败:', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.handle('sticky-notes-import-settings', async () => {
  try {
    if (!stickyNoteFile) return { ok: false, error: '尚未开启 calendar 档' };
    const win = stickySettingsDialogParent();
    const openOpts = {
      title: '载入便利贴设定 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const res = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts);
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const file = res.filePaths[0];
    let normalized = null;
    try {
      normalized = StickySettings.normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      return { ok: false, error: '设定档无法使用：' + ((e && e.message) || e) };
    }
    const data = normalized.store;
    const ids = Object.keys(data.notes);
    if (!ids.length && !data.hidden.length && !data.lastId) {
      return { ok: false, error: '这个 JSON 里没有便利贴设定' };
    }
    const catalogIds = new Set(stickyNoteCatalog.map((note) => flipNoteIdentity(note)));
    const matched = ids.filter((id) => catalogIds.has(id));
    const currentName = path.basename(stickyNoteFile);
    const mismatch = normalized.calendarFile
      && normalized.calendarFile.toLowerCase() !== currentName.toLowerCase();
    const detailLines = [
      '档案：' + path.basename(file),
      '样式：' + ids.length + ' 项（本档符合 ' + matched.length + ' 项）',
      '关闭清单：' + data.hidden.length + ' 项',
      '上次页次：第 ' + (data.lastIdx + 1) + ' 张'
    ];
    if (mismatch) {
      detailLines.push('⚠ 这份 JSON 来自「' + normalized.calendarFile + '」，与当前档「' + currentName + '」不同。');
    }
    detailLines.push('', '将以 JSON 的值取代本机现有的便利贴样式／开关／页次；',
      '窗口位置与尺寸不在可携档内，不会变动。此操作无法复原。');
    const detail = detailLines.join('\n');
    const confirmOpts = {
      type: 'warning',
      title: '载入便利贴设定',
      message: '确定要载入并取代目前的便利贴设定吗？',
      detail,
      buttons: ['取消', '载入并取代'],
      defaultId: 0,          // 安全默认：回车／Esc／关窗都等于「取消」，不会误取代
      cancelId: 0,
      noLink: true
    };
    const choice = win ? dialog.showMessageBoxSync(win, confirmOpts) : dialog.showMessageBoxSync(confirmOpts);
    if (choice !== 1) return { ok: false, canceled: true };

    if (!stickyNoteState) stickyNoteState = loadStickyNoteState();
    let applied = 0;
    stickyNoteCatalog.forEach((note) => {
      const identity = flipNoteIdentity(note);
      const prefs = data.notes[identity];
      if (!prefs) return;
      const it = noteInst(note.key, note.idx);
      Object.assign(it, prefs);
      if (stickyIdentityOf(note) !== '|' && !it._id) it._id = stickyIdentityOf(note);
      applied += 1;
    });
    const flip = noteInst(FLIP_KEY, FLIP_IDX);
    flip.flipHidden = data.hidden.slice();
    if (data.lastId) flip.lastId = data.lastId;
    flip.lastIdx = data.lastIdx;
    if (!saveStickyNoteState()) {
      return { ok: false, error: '设定存档目前无法写入，本次载入没有保存；请检查 sticky-notes-state.json 的存取权限' };
    }
    refreshStickyWindowsAfterSettings();
    return {
      ok: true,
      path: file,
      applied,
      notes: ids.length,
      matched: matched.length,
      hidden: data.hidden.length
    };
  } catch (e) {
    console.warn('[Main] 便利贴设定载入失败:', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
});
function noteWinId(key, idx) { return key + '#' + idx; }
// 记录/更新一张便利贴的来源元数据（notes＝原始 Markdown 备注，src＝INCLUDE 来源文件名，空＝calendar.md）
function rememberStickyMeta(note) {
  if (!note || typeof note.key !== 'string') return;
  const idx = +note.idx || 0;
  stickyNoteMeta.set(noteWinId(note.key, idx), {
    notes: (typeof note.notes === 'string') ? note.notes : '',
    src: (typeof note.src === 'string') ? note.src : '',
    title: (typeof note.title === 'string') ? note.title : '',
    date: (typeof note.date === 'string') ? note.date : '',
    endDate: (typeof note.endDate === 'string') ? note.endDate : '',
    color: (typeof note.color === 'string') ? note.color : '',
    done: !!note.done,
    tags: Array.isArray(note.tags) ? note.tags : []
  });
}

// 便利贴设定以前绑在 'evp{序号}' 这种「按 calendar.md 位置临时生成」的 key 上；
// Calendar 存盘会把 EVENT 按日期重排 → 同一张贴纸换了 key，颜色／字号／尺寸全部查不到
// （用户回馈「跑一次 --todolist 便利贴设定就被重置」就是这个）。
// 修法：每张贴纸在存档里带一个 _id（标题|日期），开贴时若新 key 查无设定，
// 就按 _id 把旧条目「复制」过去（旧条目只标记 migratedTo，不删，无损）。
function stickyIdentityOf(ref) {
  return String((ref && ref.title) || '') + '|' + String((ref && ref.date) || '');
}
// 🆕 翻页清单的「关」：按 标题|日期|idx 记身份（key 会被 Calendar 重排换掉，_id 也这样处理）。
//    存在翻页窗自己的条目（__flip__#0.flipHidden），下次开窗照这份名单过滤。
function flipNoteIdentity(note) {
  return stickyIdentityOf(note) + '|' + (+note.idx || 0);
}
function flipHiddenSet() {
  const it = stickyNoteState && Array.isArray(stickyNoteState[FLIP_KEY]) ? stickyNoteState[FLIP_KEY][FLIP_IDX] : null;
  const arr = it && Array.isArray(it.flipHidden) ? it.flipHidden : [];
  return new Set(arr.filter((x) => typeof x === 'string'));
}
// 投影贴按 key 记身份，不用「标题|日期|idx」：自订规则可以取同名，混在一起会互相开关。
const viewHiddenIdOf = (key) => 'k:' + String(key);
function flipHiddenIdOf(note) { return isViewKey(note && note.key) ? viewHiddenIdOf(note.key) : flipNoteIdentity(note); }
function setFlipHidden(note, hidden) {
  if (!note) return;
  if (!isViewKey(note.key) && stickyIdentityOf(note) === '|') return;   // 没标题也没日期 → 无法区分，只维持本次会话
  const id = flipHiddenIdOf(note);
  const it = noteInst(FLIP_KEY, FLIP_IDX);
  const arr = Array.isArray(it.flipHidden) ? it.flipHidden.slice() : [];
  const at = arr.indexOf(id);
  if (hidden && at < 0) arr.push(id);
  else if (!hidden && at >= 0) arr.splice(at, 1);
  else return;
  it.flipHidden = arr;
  scheduleStickyStateSave();
}
function scheduleStickyStateSave() {
  if (stickyStateSaveTimer) clearTimeout(stickyStateSaveTimer);
  stickyStateSaveTimer = setTimeout(() => { stickyStateSaveTimer = null; saveStickyNoteState(); }, 400);
}
function adoptStickyState(refs) {
  if (!stickyNoteState) stickyNoteState = loadStickyNoteState();
  const list = (refs || []).filter((r) => r && typeof r.key === 'string');
  const live = new Set(list.map((r) => noteWinId(r.key, r.idx)));
  const donors = new Map();
  Object.keys(stickyNoteState).forEach((k) => {
    const arr = stickyNoteState[k];
    if (!Array.isArray(arr)) return;
    arr.forEach((it, i) => {
      if (!it || !it._id || it.migratedTo) return;
      if (live.has(noteWinId(k, i))) return;
      if (!donors.has(it._id)) donors.set(it._id, { key: k, idx: i });
    });
  });
  list.forEach((r) => {
    const it = noteInst(r.key, r.idx);
    const id = stickyIdentityOf(r);
    if (!Object.keys(it).length) {
      const old = donors.get(id);
      if (old) {
        const src = stickyNoteState[old.key][old.idx];
        Object.keys(src).forEach((f) => { it[f] = src[f]; });
        src.migratedTo = noteWinId(r.key, r.idx);
        donors.delete(id);
      }
    }
    // 投影贴的 key 本身就稳定（__view__ / __view__:<规则id>，规则 id 存在 view-sticky-rules.json），
    // 不需要 _id 认领；反过来，若给它 _id，「这次没算出提醒」的 🔔 就会变成捐赠者，
    // 可能被某个同名行程认领走（等于把投影贴的样式抄给一张普通便利贴）。
    if (!isViewKey(r.key) && id !== '|' && !it._id) it._id = id;
  });
}

// 🆕 把某张便利贴窗口「当前实时 bounds」直接写回存档（不依赖 'moved' 事件／400ms 去抖）。
//    ⚠️ 背景：曾经只靠 win.on('moved')→内存＋400ms 去抖落盘，退出前最后一程拖动若没赶上
//    'moved' 派发／去抖还没跑，退出时写进档的就是上一次的旧位置 → 重启后便利贴「回到旧位置」。
//    现在 close/before-quit 时直接读 win.getBounds() 快照，位置绝不丢。id = noteWinId(key,idx)。
function captureStickyBoundsById(id, win) {
  try {
    if (!win || win.isDestroyed()) return;
    const sep = id.lastIndexOf('#');
    if (sep < 0) return;
    const key = id.slice(0, sep), idx = +id.slice(sep + 1) || 0;
    const b = win.getBounds();
    const it = noteInst(key, idx);
    it.x = b.x; it.y = b.y; it.w = b.width; it.h = b.height;
  } catch (e) { /* 只影响位置还原，不阻塞退出 */ }
}
function noteInst(key, idx) {
  if (!stickyNoteState) stickyNoteState = loadStickyNoteState();
  if (!Array.isArray(stickyNoteState[key])) stickyNoteState[key] = [];
  if (!stickyNoteState[key][idx]) stickyNoteState[key][idx] = {};
  return stickyNoteState[key][idx];
}
function stickyNotesAreOpen() {
  if (stickyNoteMode === 'flip') return !!(stickyNoteFlipWindow && !stickyNoteFlipWindow.isDestroyed());
  return Array.from(stickyNoteWindows.values()).some(win => win && !win.isDestroyed());
}
function notifyStickyNoteOpenState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sticky-note-state-changed', { isOpen: stickyNotesAreOpen() });
  }
}

// 🆕 还原本次启动前的位置，但必须夹回当前屏幕可见范围内：
//    上次退出时接的外接屏/副屏这次没接（或分辨率变了）→ 存档坐标可能落在屏幕外，
//    直接用会让便利贴「开不出来」（跑掉屏幕外）。故按当前任一显示器的工作区校正。
function clampToVisible(x, y, w, h) {
  const displays = (screen.getAllDisplays && screen.getAllDisplays().length)
    ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
  // 落在任一显示器工作区内（含部分可见）即视为合法
  for (const d of displays) {
    const a = d.workArea;
    if (x + w > a.x + 40 && x < a.x + a.width - 40 &&
        y + h > a.y && y < a.y + a.height - 40) return { x: Math.round(x), y: Math.round(y) };
  }
  // 否则夹回主显示器工作区（留边距，确保标题栏 ☰ 可点到）
  const p = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(Math.min(Math.max(x, p.x + 10), p.x + p.width - w - 10)),
    y: Math.round(Math.min(Math.max(y, p.y + 10), p.y + p.height - Math.min(h, 120) - 10))
  };
}

// 退出前先把所有还开着的便利贴「最终实时 bounds」快照进存档再落盘（不依赖 moved 事件/去抖）
app.on('before-quit', () => {
  try {
    stickyNoteWindows.forEach((win, id) => captureStickyBoundsById(id, win));
    saveStickyNoteState();
  } catch (e) {}
});

// 🆕 便利贴窗体导航护栏：贴纸里的链接一律先由渲染端拦截，再交主进程开「预览窗／图片窗／系统浏览器」，
//    所以「页面挤在贴纸宽度里、没有完整展开」（2026-10-20 用户回馈：点〔执行mcpTest〕）不该再发生。
//    这里只兜「渲染端漏接的协议」：javascript: / data: 等一律拦掉，避免贴纸被脚本导航走。
//    http(s) 与 file 仍放行 —— [文字](cur:URL) 的语义就是「在本窗体就地开启」，主窗体也是放行它，
//    便利贴跟着主窗体走（要完整画面请用普通链接，会开 1400x900 预览窗）。窗体复刻清单同 index.html 主窗体委托。
function guardStickyNoteNavigation(win) {
  win.webContents.on('will-navigate', (event, url) => {
    if (!/^(?:https?|file):\/\//i.test(url)) {
      console.warn('[Main] 便利贴窗体试图以非 http/file 协议导航，已拦截:', url);
      event.preventDefault();
    }
  });
  // 便利贴从不主动开窗（要开都由主进程建预览／图片窗），弹出一律 deny
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[Main] 便利贴窗体试图弹出新窗口，已拦截:', url);
    return { action: 'deny' };
  });
}

function createStickyNoteWindow(key, idx) {
  const id = noteWinId(key, idx);
  const exist = stickyNoteWindows.get(id);
  if (exist && !exist.isDestroyed()) return exist;

  const inst = noteInst(key, idx);
  const minimized0 = !!(inst && inst.minimized);
  const w = (typeof inst.w === 'number' && inst.w > 140) ? Math.round(inst.w) : 240;
  const h = minimized0 ? ((typeof inst.minH === 'number' && inst.minH > 20) ? Math.round(inst.minH) : 90)
                       : ((typeof inst.h === 'number' && inst.h > 90) ? Math.round(inst.h) : 170);
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  // 优先还原存档位置（上次关闭前的位置），并夹回当前屏幕可见范围
  const pos = clampToVisible(
    (typeof inst.x === 'number') ? inst.x : Math.round(60 + idx * 28),
    (typeof inst.y === 'number') ? inst.y : Math.round(60 + idx * 28),
    w, h
  );
  const x = pos.x, y = pos.y;

  const win = new BrowserWindow({
    width: w, height: h, x, y,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,        // 缩放走贴纸右下角自绘把手（IPC setBounds）
    movable: true,           // ⚠️ 必须为 true：拖动改用 OS 原生 -webkit-app-region: drag（movable:false 会禁掉系统拖拽通道）
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  // ⚠️ macOS 实测（Electron 28）：构造参数里的 x 会被系统「新窗落点策略」无视——y 生效、
  //    x 一律被放到系统自选落点（~221），造成「重启后便利贴向右移动一段距离」的假象。
  //    解法（已用最小 repro 实证）：建窗后立刻 setPosition 显式钉回存档位置。
  win.setPosition(x, y);
  const search = '?file=' + encodeURIComponent(stickyNoteFile) +
                 '&key=' + encodeURIComponent(key) +
                 '&idx=' + encodeURIComponent(String(idx));
  guardStickyNoteNavigation(win);   // 必须在 loadFile 前挂好，首帧导航也归护栏管
  win.loadFile('src/plugins/todolist/desktop-note.html', { search });
  // 图层层级＝一般视窗：不常驻最上层；点选这张便利贴时由 OS 自动提到最前，行为与普通视窗一致
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 移动窗口后回写位置
  // 移动窗口后回写位置：内存即时更新，但落盘「去抖」（拖动用 setPosition 会高频触发 moved，
  // 若每帧都同步重写整个 sticky-notes-state.json 会严重卡顿）。关闭窗口时再补一次确保不丢最后位置。
  let posSaveTimer = null;
  const persistPos = () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const it = noteInst(key, idx);
    it.x = b.x; it.y = b.y;
    if (posSaveTimer) clearTimeout(posSaveTimer);
    posSaveTimer = setTimeout(() => { saveStickyNoteState(); }, 400);
  };
  win.on('moved', persistPos);
  // close（销毁前）快照最终位置：'closed' 时窗口已销毁读不到 bounds，只剩内存旧值
  win.on('close', () => captureStickyBoundsById(id, win));
  win.on('closed', () => {
    if (posSaveTimer) clearTimeout(posSaveTimer);
    saveStickyNoteState();
    stickyNoteWindows.delete(id);
    notifyStickyNoteOpenState();
  });
  stickyNoteWindows.set(id, win);
  return win;
}

// 🆕 翻页模式：只建一个窗口（注册在 '__flip__#0'），循环显示 stickyNoteOrder 里的所有便利贴。
//    几何（位置/尺寸）独立存 '__flip__#0'，与「当前显示哪张」无关；颜色/透明度由渲染端按各便利贴自身状态保存。
function createFlipStickyWindow() {
  if (stickyNoteFlipWindow && !stickyNoteFlipWindow.isDestroyed()) stickyNoteFlipWindow.close();
  const id = noteWinId(FLIP_KEY, FLIP_IDX);
  const inst = noteInst(FLIP_KEY, FLIP_IDX);
  const minimized0 = !!(inst && inst.minimized);
  const w = (typeof inst.w === 'number' && inst.w > 140) ? Math.round(inst.w) : 240;
  const h = minimized0 ? ((typeof inst.minH === 'number' && inst.minH > 20) ? Math.round(inst.minH) : 90)
                       : ((typeof inst.h === 'number' && inst.h > 90) ? Math.round(inst.h) : 170);
  const pos = clampToVisible(
    (typeof inst.x === 'number') ? inst.x : Math.round(60),
    (typeof inst.y === 'number') ? inst.y : Math.round(60),
    w, h
  );
  const x = pos.x, y = pos.y;

  const win = new BrowserWindow({
    width: w, height: h, x, y,
    transparent: true, frame: false, skipTaskbar: true,
    resizable: false, movable: true, minimizable: false, maximizable: false,
    fullscreenable: false, hasShadow: false, show: true, backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
  });
  // ⚠️ 同分体窗：macOS 会无视构造 x，建窗后 setPosition 钉回存档位置（详见 createStickyNoteWindow 注释）
  win.setPosition(x, y);
  const search = '?mode=flip&file=' + encodeURIComponent(stickyNoteFile);
  guardStickyNoteNavigation(win);   // 必须在 loadFile 前挂好，首帧导航也归护栏管
  win.loadFile('src/plugins/todolist/desktop-note.html', { search });
  // 图层层级＝一般视窗：不常驻最上层；点选时由 OS 自动提到最前
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  let posSaveTimer = null;
  const persistPos = () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const it = noteInst(FLIP_KEY, FLIP_IDX);
    it.x = b.x; it.y = b.y;
    if (posSaveTimer) clearTimeout(posSaveTimer);
    posSaveTimer = setTimeout(() => { saveStickyNoteState(); }, 400);
  };
  win.on('moved', persistPos);
  // close（销毁前）快照最终位置（同分体窗：'closed' 读不到 bounds）
  win.on('close', () => {
    captureStickyBoundsById(id, win);
    if (stickyStateSaveTimer) { clearTimeout(stickyStateSaveTimer); stickyStateSaveTimer = null; saveStickyNoteState(); }
  });
  win.on('closed', () => {
    if (posSaveTimer) clearTimeout(posSaveTimer);
    saveStickyNoteState();
    stickyNoteWindows.delete(id);
    if (stickyNoteFlipWindow === win) stickyNoteFlipWindow = null;
    notifyStickyNoteOpenState();
  });
  stickyNoteWindows.set(id, win);
  stickyNoteFlipWindow = win;
  return win;
}

function closeAllStickyNoteWindows() {
  stickyNoteWindows.forEach(w => { if (w && !w.isDestroyed()) w.close(); });
  stickyNoteWindows.clear();
  stickyNoteFlipWindow = null;
}

// 渲染端请求开启/关闭桌面便利贴（传入 calendar.md 路径 + 要显示的便利贴清单 [{key,idx}] + mode）
ipcMain.handle('open-sticky-notes', (e, arg) => {
  try {
    closeAllStickyNoteWindows();
    stickyNoteFile = (arg && arg.file) || '';
    stickyNoteState = loadStickyNoteState();
    // 🆕 把 calendar.md 的目录写到 PLUGINS_DATA_DIR/data/calendar-dir.txt：
    //    LITE 版 serve.py 读这个 marker → 知道 view-sticky-rules.json 应该跟 calendar.md 同目录。
    //    用 .tmp + rename 避免写入中断留下空档（与其他存档同口径）。
    if (stickyNoteFile && PLUGINS_DATA_DIR) {
      try {
        const calDir = path.dirname(stickyNoteFile);
        const markerDir = path.join(PLUGINS_DATA_DIR, 'data');
        if (!fs.existsSync(markerDir)) fs.mkdirSync(markerDir, { recursive: true });
        const marker = path.join(markerDir, 'calendar-dir.txt');
        const tmp = marker + '.tmp';
        fs.writeFileSync(tmp, calDir, 'utf8');
        try { fs.renameSync(tmp, marker); } catch (err) { fs.writeFileSync(marker, calDir, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) {} }
      } catch (err0) { /* marker 写失败 → LITE 端 fallback 到 PLUGINS_DATA_DIR，不影响桌面版 */ }
    }
    // 🆕 关键：stickyNoteFile 刚设定好 → rulesPath() 现在能正确找到 calendar.md 同目录的 view-sticky-rules.json！
    //    但渲染端的 tlLoadCustomViewRules() 在启动时就 resolve 过了（那时候 stickyNoteFile 还是空 → fallback 到 PLUGINS_DATA_DIR 找不到档案 → 返回空规则）。
    //    所以主进程在这里主动调 reload + 推通知，让渲染端立刻拉一次最新规则。
    if (typeof reloadViewRulesAfterOpen === 'function') {
      try { reloadViewRulesAfterOpen(); } catch (e) { /* reload 失败不影响便利贴开启 */ }
    }
    const notes = (arg && Array.isArray(arg.notes)) ? arg.notes : [];
    stickyNoteHtml.clear();
    stickyNoteTitleHtml.clear();
    stickyNoteMeta.clear();
    notes.forEach(n => {
      if (n && typeof n.key === 'string') {
        stickyNoteHtml.set(noteWinId(n.key, +n.idx || 0), typeof n.html === 'string' ? n.html : '');
        stickyNoteTitleHtml.set(noteWinId(n.key, +n.idx || 0), typeof n.titleHtml === 'string' ? n.titleHtml : '');
        rememberStickyMeta(n);
      }
    });
    stickyNoteOrder = notes.filter(n => n && typeof n.key === 'string').map(n => ({
      key: n.key, idx: +n.idx || 0, title: typeof n.title === 'string' ? n.title : '',
      date: typeof n.date === 'string' ? n.date : '',
      endDate: typeof n.endDate === 'string' ? n.endDate : '',
      color: typeof n.color === 'string' ? n.color : '',
      done: !!n.done,
      tags: Array.isArray(n.tags) ? n.tags : [],
      // 🆕 外部 INCLUDE 来源文件名（草稿便利贴等）：空＝calendar.md 正式档
      src: typeof n.src === 'string' ? n.src : '',
      notes: typeof n.notes === 'string' ? n.notes : '',
      view: !!n.view,            // 🆕 VIEW 便利贴旗标（与 sticky-note-sync 的 normalized 同形，别在这里抹掉）
      // 🆕 启动通知旗标（VIEW 贴「通知讯息」）：翻页窗据此在启动时先闪烁显示这张贴
      notify: !!n.notify,
      notifySeconds: (typeof n.notifySeconds === 'number' && isFinite(n.notifySeconds)) ? n.notifySeconds : 15
    }));
    stickyNoteCatalog = stickyNoteOrder.slice();
    adoptStickyState(stickyNoteOrder);
    const mode = (arg && arg.mode === 'flip') ? 'flip' : 'split';
    stickyNoteMode = mode;
    let count = 0;
    if (mode === 'flip') {
      // 上次在翻页清单里关掉的，这次照样关着（key 重排过也认得出来）
      const hidden = flipHiddenSet();
      if (hidden.size) stickyNoteOrder = stickyNoteOrder.filter(note => !hidden.has(flipHiddenIdOf(note)));
      stickyNoteFlipWindow = null;
      // 全部被关掉时也开窗：窗口菜单里的「未开启」清单是唯一能把它们再打开的入口
      if (stickyNoteCatalog.length > 0) { createFlipStickyWindow(); count = stickyNoteFlipWindow ? 1 : 0; }
    } else {
      notes.forEach(n => { if (n && typeof n.key === 'string') createStickyNoteWindow(n.key, +n.idx || 0); });
      count = stickyNoteWindows.size;
    }
    notifyStickyNoteOpenState();
    return { ok: true, count, mode, pages: mode === 'flip' ? stickyNoteOrder.length : count };
  } catch (err) {
    console.warn('[Main] 开启桌面便利贴失败:', err);
    return { ok: false, error: String(err && err.message || err) };
  }
});
// 🆕 方案B：sticky-note-order 永远返回「现算」目录，而非陈旧快照。
//    返回前先请主程式重算（含 include 并入，见 index.html 的 tlOnStickyRefreshRequest），
//    等其把最新 refs 经 sticky-note-sync 推回、刷新 stickyNoteCatalog 后再返回。
//    为避免每处读取都重算（便利贴窗多处读取、含搜索框逐键），仅在目录近期未被写入/同步刷新时才触发。
function triggerStickyRefreshAndAwaitSync(timeoutMs) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      resolve(false); // Calendar 未開啟，拿现有目录兜底
      return;
    }
    let done = false;
    const onSync = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ipcMain.removeListener('sticky-note-sync', onSync);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      ipcMain.removeListener('sticky-note-sync', onSync);
      resolve(false); // 超时，拿现有目录兜底
    }, timeoutMs || 2000);
    ipcMain.once('sticky-note-sync', onSync); // 先挂监听，再发请求，避免漏掉回包
    mainWindow.webContents.send('sticky-note-refresh-request', {
      requestId: '__order_refresh__' + Date.now() + '_' + (++stickyOrderRefreshSeq)
    });
  });
}
async function ensureFreshStickyCatalog(timeoutMs) {
  if (Date.now() - lastStickyCatalogSync < STICKY_ORDER_REFRESH_TTL) return; // 近期已刷新，目录足够新
  await triggerStickyRefreshAndAwaitSync(timeoutMs);
  lastStickyCatalogSync = Date.now();
}

// 返回本次 Calendar 会话中全部已设定的便利贴，以及每张目前是否开启。
ipcMain.handle('sticky-note-order', async () => {
  await ensureFreshStickyCatalog(2000); // 🆕 方案B：返回前确保目录是现算的
  const flipOpen = stickyNoteFlipWindow && !stickyNoteFlipWindow.isDestroyed();
  const catalog = new Map(stickyNoteCatalog.map(note => [noteWinId(note.key, note.idx), note]));
  if (stickyNoteMode === 'flip') {
    stickyNoteOrder.forEach(note => {
      const id = noteWinId(note.key, note.idx);
      if (!catalog.has(id)) catalog.set(id, note);
    });
  }
  const notes = Array.from(catalog.values()).map(note => {
    let isOpen;
    if (stickyNoteMode === 'flip') {
      isOpen = !!(flipOpen && stickyNoteOrder.some(active => active.key === note.key && active.idx === note.idx));
    } else {
      const win = stickyNoteWindows.get(noteWinId(note.key, note.idx));
      isOpen = !!(win && !win.isDestroyed());
    }
    return Object.assign({}, note, { isOpen });
  });
  const notesById = new Map(notes.map(note => [noteWinId(note.key, note.idx), note]));
  const order = stickyNoteMode === 'flip'
    ? stickyNoteOrder.map(note => notesById.get(noteWinId(note.key, note.idx))).filter(Boolean)
    : notes.filter(note => note.isOpen);
  return { mode: stickyNoteMode, order, notes };
});
function requestStickyNoteClose(win) {
  const requestId = 'sticky-menu-close-' + Date.now() + '-' + (++stickyMenuCloseSeq);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingStickyMenuCloses.delete(requestId);
      resolve(false);
    }, 30000);
    pendingStickyMenuCloses.set(requestId, { resolve, timer, webContentsId: win.webContents.id });
    win.webContents.send('sticky-note-close-request', { requestId });
  });
}
ipcMain.handle('toggle-sticky-note', async (event, arg) => {
  if (!arg || typeof arg.key !== 'string') return { success: false };
  const idx = +arg.idx || 0;
  const note = stickyNoteCatalog.find(item => item.key === arg.key && item.idx === idx)
    || (stickyNoteMode === 'flip'
      ? stickyNoteOrder.find(item => item.key === arg.key && item.idx === idx)
      : null);
  if (!note) return { success: false };

  if (stickyNoteMode === 'flip') {
    const activeIndex = stickyNoteOrder.findIndex(item => item.key === arg.key && item.idx === idx);
    const currentWindow = stickyNoteFlipWindow;
    const closingLast = activeIndex >= 0 && stickyNoteOrder.length === 1;
    // 只有「关到没有东西可翻、窗口必须关掉」时才走关窗确认（内含未存改动先保存）；
    // 其余情况只更新清单，窗口保留，菜单不会因为切换一张就消失。
    if (closingLast && currentWindow && !currentWindow.isDestroyed() && !await requestStickyNoteClose(currentWindow)) {
      return { success: false, isOpen: true };
    }
    if (activeIndex >= 0) stickyNoteOrder.splice(activeIndex, 1);
    // 🆕 VIEW 贴位子固定在最前面：从清单关掉的投影贴再打开时插回头部（一般贴纸仍沿用「补到末端」）
    //    多张投影贴（🔔 ＋ 自订规则）都排在第一张普通贴之前，彼此保持「先开的在前」。
    else if (isViewKey(note.key)) {
      const firstNormal = stickyNoteOrder.findIndex((x) => !isViewKey(x.key));
      stickyNoteOrder.splice(firstNormal < 0 ? stickyNoteOrder.length : firstNormal, 0, note);
    }
    else stickyNoteOrder.push(note);
    setFlipHidden(note, activeIndex >= 0);
    if (closingLast) {
      if (currentWindow && !currentWindow.isDestroyed()) currentWindow.close();
      stickyNoteFlipWindow = null;
    } else if (stickyNoteOrder.length) {
      if (currentWindow && !currentWindow.isDestroyed()) {
        currentWindow.webContents.send('sticky-note-order-updated', { order: stickyNoteOrder });
      } else {
        createFlipStickyWindow();
      }
    }
    notifyStickyNoteOpenState();
    return { success: true, isOpen: activeIndex < 0 };
  }

  const id = noteWinId(arg.key, idx);
  const existing = stickyNoteWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (!await requestStickyNoteClose(existing)) return { success: false, isOpen: true };
    if (!existing.isDestroyed()) existing.close();
    notifyStickyNoteOpenState();
    return { success: true, isOpen: false };
  }

  const win = createStickyNoteWindow(note.key, note.idx);
  if (win && !win.isDestroyed()) {
    win.show();
    win.moveTop();
    win.focus();
    notifyStickyNoteOpenState();
    return { success: true, isOpen: true };
  }
  return { success: false, isOpen: false };
});
ipcMain.handle('sticky-note-menu-close-result', (event, payload) => {
  const pending = payload && pendingStickyMenuCloses.get(payload.requestId);
  if (!pending || pending.webContentsId !== event.sender.id) return { success: false };
  clearTimeout(pending.timer);
  pendingStickyMenuCloses.delete(payload.requestId);
  pending.resolve(!!payload.accepted);
  return { success: true };
});
// 把某张便利贴显示到最前：翻页模式→让它跳到该页；分体模式→显示对应窗口。返回是否成功。
//   「下拉清单点名称」「新建便利贴后跳到新贴」共用这一处（唯一入口，避免两套显示逻辑漂移）
function showStickyNoteAt(key, idx) {
  const i = +idx || 0;
  if (typeof key !== 'string' || !key) return false;
  let win;
  if (stickyNoteMode === 'flip') {
    win = stickyNoteFlipWindow;
    const pageIndex = stickyNoteOrder.findIndex(note => note.key === key && note.idx === i);
    if (!win || win.isDestroyed() || pageIndex < 0) return false;
    // 带上完整顺序＋key/idx：翻页窗的清单可能还停在开窗快照上（页次数字对不上），
    // 让它先对齐主进程的权威顺序再按 key+idx 定位，index 只作兜底
    win.webContents.send('sticky-note-show-page', {
      key, idx: i, index: pageIndex, order: stickyNoteOrder
    });
  } else {
    win = stickyNoteWindows.get(noteWinId(key, i));
    if (!win || win.isDestroyed()) return false;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
  return true;
}
ipcMain.handle('focus-sticky-note', (event, arg) => {
  if (!arg || typeof arg.key !== 'string') return { success: false };
  return { success: showStickyNoteAt(arg.key, +arg.idx || 0) };
});
// 建完便利贴立刻「翻到那一页」：sync（更新 stickyNoteOrder）与 create-result（回包）是两条 IPC，
//   同一渲染端保序，理论上 sync 先到；但翻页窗的重绘是异步的，且清单偶尔还在路上 →
//   第一次找不到就隔 80ms 再看，最多重试 6 次（≈0.5s）。仍找不到就放弃，不干扰用户后续操作。
function showStickyNoteAtRetry(key, idx, tries) {
  if (typeof key !== 'string' || !key) return false;
  if (showStickyNoteAt(key, idx)) return true;
  const left = typeof tries === 'number' ? tries : 6;
  if (left <= 0) return false;
  setTimeout(() => { showStickyNoteAtRetry(key, idx, left - 1); }, 80);
  return false;
}
// 🆕 便利贴窗查询当前显示模式（split / flip），用于下拉菜单高亮
ipcMain.handle('sticky-note-mode', () => ({ mode: stickyNoteMode }));
// 🆕 便利贴窗请求切换显示模式：转交主程式渲染端执行（模式记忆/重开逻辑集中在主程式 tlSetStickyMode）
ipcMain.handle('request-sticky-display-mode', (e, arg) => {
  const mode = (arg && arg.mode === 'flip') ? 'flip' : 'split';
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sticky-set-mode', { mode });
  return { ok: true, mode };
});
ipcMain.handle('close-sticky-notes', () => {
  closeAllStickyNoteWindows();
  stickyNoteHtml.clear(); stickyNoteTitleHtml.clear(); stickyNoteMeta.clear();
  stickyNoteFlipWindow = null; stickyNoteMode = 'split'; stickyNoteOrder = []; stickyNoteCatalog = [];
  notifyStickyNoteOpenState();
  return { ok: true };
});
// 单张便利贴：取主窗口渲染好的 Markdown HTML＋标题 HTML（避免便利贴自己复制一套 marked 管线）
//   同时回传来源元数据（notes/src/…）：外部 include 文件（如草稿文件）里的行程在便利贴窗本地解析不到，
//   编辑时必须靠这里的 notes 作权威内容，并靠 src 决定写回哪个文件。
ipcMain.handle('sticky-note-html', (e, arg) => {
  const id = noteWinId(String(arg && arg.key), +arg.idx || 0);
  const meta = stickyNoteMeta.get(id) || null;
  return {
    html: stickyNoteHtml.get(id) || '',
    titleHtml: stickyNoteTitleHtml.get(id) || '',
    notes: (meta && typeof meta.notes === 'string') ? meta.notes : null,
    src: (meta && typeof meta.src === 'string') ? meta.src : '',
    title: (meta && typeof meta.title === 'string') ? meta.title : '',
    date: (meta && typeof meta.date === 'string') ? meta.date : '',
    endDate: (meta && typeof meta.endDate === 'string') ? meta.endDate : '',
    color: (meta && typeof meta.color === 'string') ? meta.color : '',
    done: !!(meta && meta.done),
    tags: (meta && Array.isArray(meta.tags)) ? meta.tags : []
  };
});

// 🆕 邮件收件人历史：主进程单一存储，便利贴 / 主窗口 / 邮件插件三端共用
//    （便利贴窗是 file:// 不同 query 的独立 origin，renderer localStorage 不共享，故统一走 IPC）
const EMAIL_RECIPIENTS_FILE = 'email-recipients.json';
const EMAIL_RECIPIENTS_MAX = 50;
function emailRecipientsPath() {
  return PLUGINS_DATA_DIR ? path.join(PLUGINS_DATA_DIR, EMAIL_RECIPIENTS_FILE) : '';
}
function readEmailRecipients() {
  const p = emailRecipientsPath();
  if (!p) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(r => typeof r === 'string' && r.trim()) : [];
  } catch (e) { return []; }
}
function writeEmailRecipients(list) {
  const p = emailRecipientsPath();
  if (!p) return;
  try {
    const set = new Set(list.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim().toLowerCase()));
    const cleaned = Array.from(set).slice(-EMAIL_RECIPIENTS_MAX);
    fs.writeFileSync(p, JSON.stringify(cleaned, null, 2), 'utf8');
  } catch (e) {}
}
function appendEmailRecipients(recipients) {
  if (!recipients || !recipients.length) return;
  const existing = readEmailRecipients();
  const merged = existing.concat(recipients.map(r => String(r).trim().toLowerCase()).filter(Boolean));
  writeEmailRecipients(merged);
}
ipcMain.handle('email-recipients-get', () => readEmailRecipients());
ipcMain.handle('email-recipients-add', (event, recipients) => {
  appendEmailRecipients(recipients);
  return readEmailRecipients();
});

// 🆕 便利贴内容刷新：渲染端（主程式）把某张便利贴最新渲染结果推过来 → 中转给对应便利贴窗并刷新缓存
ipcMain.on('sticky-note-refresh', (e, arg) => {
  if (!arg || typeof arg.key !== 'string') return;
  const id = noteWinId(arg.key, +arg.idx || 0);
  rememberStickyMeta(arg);
  if (typeof arg.html === 'string') stickyNoteHtml.set(id, arg.html);
  if (typeof arg.titleHtml === 'string') stickyNoteTitleHtml.set(id, arg.titleHtml);
  // 翻页模式：唯一窗口即翻页窗（注册在 '__flip__#0'），与该刷新针对哪张便利贴无关
  const win = (stickyNoteMode === 'flip') ? stickyNoteFlipWindow : stickyNoteWindows.get(id);
  if (win && !win.isDestroyed()) win.webContents.send('sticky-note-refresh', arg);
});
ipcMain.on('sticky-note-sync', (e, arg) => {
  const refs = arg && Array.isArray(arg.notes) ? arg.notes : [];
  const previousCatalog = new Map(stickyNoteCatalog.map(note => [noteWinId(note.key, note.idx), note]));
  const previousOrder = new Map(stickyNoteOrder.map((note, index) => [noteWinId(note.key, note.idx), index]));
  const nextCatalog = [];
  const nextOrder = [];
  const nextIds = new Set();
  const flipHidden = stickyNoteMode === 'flip' ? flipHiddenSet() : null;
  // 事件重排后 key 会变（evpN 是按 calendar.md 位置的临时 id）→ 先按 _id 把旧设定搬过来再建窗
  adoptStickyState(refs.filter(r => r && typeof r.key === 'string')
    .map(r => ({ key: r.key, idx: +r.idx || 0, title: r.title, date: r.date })));

  refs.forEach(note => {
    if (!note || typeof note.key !== 'string') return;
    const idx = +note.idx || 0;
    const id = noteWinId(note.key, idx);
    const normalized = Object.assign({}, note, { idx });
    nextIds.add(id);
    nextCatalog.push(normalized);
    rememberStickyMeta(normalized);
    if (typeof note.html === 'string') stickyNoteHtml.set(id, note.html);
    if (typeof note.titleHtml === 'string') stickyNoteTitleHtml.set(id, note.titleHtml);

    if (stickyNoteMode === 'flip') {
      // 本会话见过的沿用当前开关；新出现的看持久化名单，关掉的不会被同步又打开
      const keep = previousCatalog.has(id) ? previousOrder.has(id) : !flipHidden.has(flipHiddenIdOf(normalized));
      if (keep) nextOrder.push(normalized);
    } else if (!previousCatalog.has(id)) {
      createStickyNoteWindow(note.key, idx);
    } else {
      const win = stickyNoteWindows.get(id);
      if (win && !win.isDestroyed()) win.webContents.send('sticky-note-refresh', normalized);
    }
  });

  // 分体窗口允许已开启的贴纸在设定移除后暂时保留；翻页清单则严格跟随 Calendar 当前设定。
  stickyNoteCatalog.forEach(note => {
    const id = noteWinId(note.key, note.idx);
    if (nextIds.has(id)) return;
    // 🆕 VIEW 贴没有「设定」可言：这一轮算出来没内容（提醒全被打勾／删掉）就直接收掉，
    //    否则它会以「保留旧窗口」的名义挂着一张过期的汇总。
    if (isViewKey(note.key)) {
      const stale = stickyNoteWindows.get(id);
      if (stale && !stale.isDestroyed()) stale.close();
      return;
    }
    if (stickyNoteMode !== 'flip') {
      const win = stickyNoteWindows.get(id);
      if (win && !win.isDestroyed()) nextCatalog.push(note);
    }
  });

  stickyNoteCatalog = nextCatalog;
  lastStickyCatalogSync = Date.now(); // 🆕 方案B：目录刚被刷新，供 sticky-note-order 去抖复用
  if (stickyNoteMode === 'flip') {
    stickyNoteOrder = nextOrder;
    if (stickyNoteFlipWindow && !stickyNoteFlipWindow.isDestroyed()) {
      if (stickyNoteOrder.length) {
        stickyNoteFlipWindow.webContents.send('sticky-note-order-updated', { order: stickyNoteOrder });
      } else {
        const win = stickyNoteFlipWindow;
        stickyNoteFlipWindow = null;
        win.close();
      }
    }
  }
  const catalogWindows = new Set(stickyNoteWindows.values());
  catalogWindows.forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send('sticky-note-catalog-updated');
  });
  notifyStickyNoteOpenState();
});
// 🆕 便利贴窗点「刷新」按钮 → 中继给主程式窗口，由它重新渲染该张并回推（便利贴窗无法直接渲染 Markdown）
ipcMain.on('sticky-note-refresh-request', (e, arg) => {
  const requestId = arg && arg.requestId;
  if (typeof requestId !== 'string' || !requestId) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    e.sender.send('sticky-note-refresh-result', { requestId, success: false, message: 'Calendar 未开启，无法刷新便利贴' });
    return;
  }
  const timer = setTimeout(() => {
    const pending = pendingStickyRefreshes.get(requestId);
    if (!pending) return;
    pendingStickyRefreshes.delete(requestId);
    if (!pending.webContents.isDestroyed()) {
      pending.webContents.send('sticky-note-refresh-result', {
        requestId,
        success: false,
        message: '刷新等待超时，请确认 Calendar 已开启后重试'
      });
    }
  }, 30000);
  pendingStickyRefreshes.set(requestId, { webContents: e.sender, calendarWebContentsId: mainWindow.webContents.id, timer });
  mainWindow.webContents.send('sticky-note-refresh-request', arg || {});
});
ipcMain.handle('sticky-note-refresh-complete', (e, arg) => {
  const requestId = arg && arg.requestId;
  const pending = typeof requestId === 'string' ? pendingStickyRefreshes.get(requestId) : null;
  if (!pending || pending.calendarWebContentsId !== e.sender.id) return { success: false };
  clearTimeout(pending.timer);
  pendingStickyRefreshes.delete(requestId);
  if (!pending.webContents.isDestroyed()) {
    pending.webContents.send('sticky-note-refresh-result', {
      requestId,
      success: !!arg.success,
      count: Number.isInteger(arg.count) ? arg.count : 0,
      message: typeof arg.message === 'string' ? arg.message : ''
    });
  }
  return { success: true };
});
// 🆕 便利贴「编辑模式」回写：唤醒 Calendar 后，由其渲染进程按既有流程写回 calendar.md
ipcMain.handle('sticky-note-save-edit', async (e, arg) => {
  try {
    if (!arg || typeof arg.key !== 'string' || typeof arg.notes !== 'string') {
      throw new Error('便利贴保存参数无效');
    }
    // 🆕 VIEW 便利贴是「🔔 提醒」汇总投影 → 没有可写回的原文，任何保存一律拒绝（渲染端也已收起编辑入口，这里是最后一道闸）
    if (isViewKey(arg.key)) throw new Error('这是自动汇总的预览便利贴（🔔 提醒／自定义 VIEW 便利贴），内容请改在来源行程里');
    if (!stickyNoteFile) throw new Error('Calendar 文件路径不可用，无法保存便利贴');
    const win = ensureMainWindowForBackgroundSave();
    const requestId = 'sticky-save-' + Date.now() + '-' + (++stickyEditSaveSeq);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingStickyEditSaves.delete(requestId);
        resolve({ success: false, error: 'Calendar 保存响应超时，请确认 Calendar 已打开后重试' });
      }, 30000);
      const pendingSave = {
        resolve,
        timer,
        webContentsId: win.webContents.id,
        sent: false,
        send: null
      };
      pendingStickyEditSaves.set(requestId, pendingSave);

      const sendSaveRequest = () => {
        const pending = pendingStickyEditSaves.get(requestId);
        if (!pending || pending.sent) return;
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          clearTimeout(pending.timer);
          pendingStickyEditSaves.delete(requestId);
          resolve({ success: false, error: 'Calendar 窗口已关闭，未能保存便利贴' });
          return;
        }
        pending.sent = true;
        win.webContents.send('sticky-note-edit', Object.assign({}, arg, {
          file: stickyNoteFile,
          requestId
        }));
      };
      pendingSave.send = sendSaveRequest;

      if (stickyCalendarReadyWindowId === win.webContents.id) {
        sendSaveRequest();
      }
    });
  } catch (error) {
    console.error('[Main] 便利贴保存失败:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('sticky-note-save-edit-result', (event, payload) => {
  const pending = payload && pendingStickyEditSaves.get(payload.requestId);
  if (!pending || pending.webContentsId !== event.sender.id) return { success: false, error: '保存请求无效' };
  clearTimeout(pending.timer);
  pendingStickyEditSaves.delete(payload.requestId);
  pending.resolve(payload.result || { success: false, error: 'Calendar 未返回保存结果' });
  return { success: true };
});
ipcMain.handle('sticky-calendar-ready', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== event.sender.id) {
    return { success: false };
  }
  stickyCalendarReadyWindowId = event.sender.id;
  pendingStickyEditSaves.forEach((pending) => {
    if (pending.webContentsId === event.sender.id && !pending.sent && pending.send) pending.send();
  });
  pendingStickyIncludeAdds.forEach((pending) => {
    if (pending.win.webContents.id === event.sender.id && !pending.sent && pending.send) pending.send();
  });
  return { success: true };
});

// ============================================================
// 🆕 便利贴工具内「新建便利贴」——直接写进被 include 的外部档（如 calendar-event-draft.md）
//   为什么不在这里自己拼 ## EVENT 块：序列化（tlEventToMarkdown）唯一可信来源在 calendar-editor.js，
//   主进程再抄一份必然漂移。所以：文件清单由主进程直接列目录（只需文件名，不解析），
//   真正落盘交给 Calendar 渲染端的 tlAppendEventToIncludeFile（只追加、不重写，已有测试覆盖）。
// ============================================================
const STICKY_INCLUDE_RE = /^calendar-.+\.md$/i;   // 与 calendar-editor 的 include 规则一致（排除 calendar.md）
let stickyCreateSeq = 0;
const pendingStickyCreates = new Map();           // requestId -> { resolve, timer, webContentsId, sent, send }

// 列出 calendar.md 同目录里可写入的 include 档（只要文件名＋大小，不读内容）
ipcMain.handle('sticky-note-create-files', () => {
  try {
    if (!stickyNoteFile) return { ok: false, error: 'Calendar 文件路径不可用', files: [] };
    const dir = path.dirname(stickyNoteFile);
    const files = fs.readdirSync(dir)
      .filter(name => STICKY_INCLUDE_RE.test(name) && name.toLowerCase() !== 'calendar.md')
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        let size = 0;
        try { size = fs.statSync(path.join(dir, name)).size; } catch (e) { size = 0; }
        return { name, size };
      });
    return { ok: true, dir, files };
  } catch (error) {
    return { ok: false, error: error.message, files: [] };
  }
});
// 新建：校验 → 交给 Calendar 渲染端写盘（带 requestId 往返）→ 成功后把新便利贴显示到发起者旁边
ipcMain.handle('sticky-note-create', async (e, arg) => {
  try {
    const title = String((arg && arg.title) || '').trim();
    const src = String((arg && arg.src) || '').trim();
    if (!title) throw new Error('请先填写便利贴标题');
    if (title.length > 200) throw new Error('标题最多 200 个字');
    // 只接受「同目录的 calendar-*.md」：既是规则一致，也是防目录穿越（src 会被拼进路径）
    if (!STICKY_INCLUDE_RE.test(src) || src.toLowerCase() === 'calendar.md' || /[\\/]/.test(src)) {
      throw new Error('请选择一个 include 进来的 calendar-*.md 文件');
    }
    if (!stickyNoteFile) throw new Error('Calendar 文件路径不可用');
    const win = ensureMainWindowForBackgroundSave();
    // 主窗若停在 AI 控制台／别的页面，就没有 Calendar 监听者：立刻给明确错误，不要让它干等 30 秒超时
    const url = win.webContents.getURL() || '';
    if (!url.includes('todolist/index.html')) {
      throw new Error('Calendar 当前未打开（主窗口不在 TodoList），请先打开 calendar.md 再试');
    }
    const requestId = 'sticky-create-' + Date.now() + '-' + (++stickyCreateSeq);
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingStickyCreates.delete(requestId);
        resolve({ ok: false, error: 'Calendar 响应超时，请确认 Calendar 已打开后重试' });
      }, 30000);
      const pending = { resolve, timer, webContentsId: win.webContents.id, sent: false, send: null };
      pendingStickyCreates.set(requestId, pending);
      const send = () => {
        const p = pendingStickyCreates.get(requestId);
        if (!p || p.sent) return;
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          clearTimeout(p.timer);
          pendingStickyCreates.delete(requestId);
          resolve({ ok: false, error: 'Calendar 窗口已关闭，未能新建便利贴' });
          return;
        }
        p.sent = true;
        win.webContents.send('new-sticky-note-request', { requestId, src, title, file: stickyNoteFile });
      };
      pending.send = send;
      // Calendar 已就绪就直接发；否则等它 sticky-calendar-ready（与保存同一套就绪门）
      if (stickyCalendarReadyWindowId === win.webContents.id) send();
    });
    if (result && result.ok) {
      // 新贴默认落在 (60,60)：分体模式下会与已有贴纸重叠 → 相对「发起新建的那张」错开一点再置前
      if (stickyNoteMode !== 'flip' && result.key) cascadeNewStickyWindow(result.key, +result.idx || 0, e.sender);
      // 建完就翻到这一页（用户明确要求）。第一次可能因为清单还没到而落空 → 短暂重试几次。
      showStickyNoteAtRetry(result.key, +result.idx || 0);
    }
    return result;
  } catch (error) {
    console.error('[Main] 新建便利贴失败:', error);
    return { ok: false, error: error.message };
  }
});
// 🆕 建立 calendar 档案成功后：转发给 Calendar 渲染端，把新建档自动勾选（＋）进 ## INCLUDE 区块。
//   为什么走渲染端：## INCLUDE 写在 calendar.md 缓冲里，落盘由渲染端 saveTask 统一负责（主进程不该直写缓冲，避免覆盖未保存改动）。
//   就绪门与「新建便利贴」同一套：Calendar 没就绪就等 sticky-calendar-ready 再发。
let stickyIncludeSeq = 0;
const pendingStickyIncludeAdds = new Map();   // id -> { win, name, file, sent, send }
function sendNewCalendarInclude(name, file) {
  try {
    const win = ensureMainWindowForBackgroundSave();
    const url = win.webContents.getURL() || '';
    if (!url.includes('todolist/index.html')) return; // 主窗不在 Todolist（Calendar）模式则跳过，用户可手动勾选
    const id = 'sticky-include-' + Date.now() + '-' + (++stickyIncludeSeq);
    const send = () => {
      const p = pendingStickyIncludeAdds.get(id);
      if (!p || p.sent) return;
      if (win.isDestroyed() || win.webContents.isDestroyed()) { pendingStickyIncludeAdds.delete(id); return; }
      p.sent = true;
      win.webContents.send('new-calendar-include-request', { name, file });
    };
    pendingStickyIncludeAdds.set(id, { win, name, file, sent: false, send });
    if (stickyCalendarReadyWindowId === win.webContents.id) send();
  } catch (e) {
    console.error('[Main] 转发自动勾选 include 失败:', e);
  }
}
// 🆕 建立新 calendar 档案（calendar-*.md）：便利贴菜单「＋ 建立 calendar 档案」→ 在当前 calendar 同目录生成骨架文件。
//   前缀固定 calendar-，后缀由用户给定；落盘后可在 Calendar 中独立打开，实现分档案管理便利贴。
ipcMain.handle('sticky-note-create-calendar', (e, arg) => {
  try {
    if (!stickyNoteFile) throw new Error('Calendar 文件路径不可用（请先打开 calendar.md 再试）');
    const suffixRaw = String((arg && arg.suffix) || '').trim();
    if (!suffixRaw) throw new Error('请先输入档案后缀');
    if (suffixRaw.length > 60) throw new Error('后缀最多 60 个字');
    // 防目录穿越 / 非法文件名：禁止路径分隔符与控制字符（其余可见字符允许，含中文）
    if (/[\\/:*?"<>|\x00-\x1f]/.test(suffixRaw)) throw new Error('后缀含非法字符（不能包含 \\ / : * ? " < > | 等）');
    const name = 'calendar-' + suffixRaw + '.md';
    const dir = path.dirname(stickyNoteFile);
    const full = path.join(dir, name);
    // 最终防线：规范化后必须仍落在原目录内（dir + 固定前缀 + 后缀 + .md，已禁分隔符故必然成立，这里再断言一次）
    if (path.dirname(full) !== dir) throw new Error('档案名不合法');
    if (fs.existsSync(full)) throw new Error('档案已存在：' + name);
    // 骨架：与 tlCalendarToMarkdown 对「空行事历」的输出同构——只放说明注释，
    //   不写空的 ## EVENT / ## HOLIDAY / ## DIARY / ## TAGS 区块标题。
    //   （空 ## EVENT 占位块会被 tlParseEvents 跳过，导致便利贴回写子事件时
    //    「原始标题数 ≠ 可解析事件数」的安全阀误判而拒写；且序列化器本来就不会为空的区段生成标题。）
    const skeleton = [
      '> 此 calendar 档案由便利贴菜单「＋ 建立 calendar 档案」生成。',
      '> 可在 Calendar 中独立打开，便利贴按本档案分别管理（分档案管理）。',
      '> 新增行程／便利贴后，会自动补齐对应的 ## EVENT 区块。',
      ''
    ].join('\n');
    fs.writeFileSync(full, skeleton, 'utf-8');
    // 🆕 建完即把新建档自动勾选（＋）进 ## INCLUDE 区块：转发给 Calendar 渲染端写回缓冲并落盘（就绪门同「新建便利贴」）
    sendNewCalendarInclude(name, full);
    return { ok: true, file: full, name };
  } catch (error) {
    console.error('[Main] 建立 calendar 档案失败:', error);
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('sticky-note-create-result', (event, payload) => {
  const requestId = payload && payload.requestId;
  const pending = typeof requestId === 'string' ? pendingStickyCreates.get(requestId) : null;
  if (!pending || pending.webContentsId !== event.sender.id) return { success: false };
  clearTimeout(pending.timer);
  pendingStickyCreates.delete(requestId);
  pending.resolve(payload.result || { ok: false, error: 'Calendar 未返回新建结果' });
  return { success: true };
});
// 🗑 便利贴「删除」：与「新建」同一套就绪门与安全性校验。
//   便利贴窗给的是 title/date/src（来源档由 src 决定：空＝calendar.md 正式档，非空＝include 档），
//   真正删块交给 Calendar 渲染端的 tlRemoveEventFromIncludeFile（include 档，外科手术式落盘）
//   或缓冲移除＋saveMdFile（calendar.md 正式档）。渲染端删完会发 sticky-note-sync 刷新清单，
//   翻页窗的 order-updated 会自动把当前页 clamp 到相邻张；分体窗由便利贴窗自行 close。
const STICKY_DELETE_RE = /^calendar-.+\.md$/i;   // 与 include 规则一致（排除 calendar.md）
let stickyDeleteSeq = 0;
const pendingStickyDeletes = new Map();          // requestId -> { resolve, timer, webContentsId, sent, send }
ipcMain.handle('sticky-note-delete', async (e, arg) => {
  try {
    // 🆕 VIEW 便利贴没有对应的行程可删（内容只是各行程的投影）
    if (arg && isViewKey(arg.key)) throw new Error('这是自动汇总的预览便利贴（🔔 提醒／自定义 VIEW 便利贴），没有对应的行程可以删除');
    const ev = (arg && arg.ev) || {};
    const title = String(ev.title || '').trim();
    const src = String(ev.src || '').trim();
    if (!title) throw new Error('缺少便利贴标题，无法定位要删除的行程');
    // 来源档校验：空＝calendar.md 正式档（允许删，因为是删当前这张正式档便利贴）；
    //   非空必须仍是「同目录的 calendar-*.md」，既是规则一致也防目录穿越。
    if (src && (!STICKY_DELETE_RE.test(src) || src.toLowerCase() === 'calendar.md' || /[\\/]/.test(src))) {
      throw new Error('来源文件无效，无法删除');
    }
    if (!stickyNoteFile) throw new Error('Calendar 文件路径不可用');
    const win = ensureMainWindowForBackgroundSave();
    const url = win.webContents.getURL() || '';
    if (!url.includes('todolist/index.html')) {
      throw new Error('Calendar 当前未打开（主窗口不在 TodoList），请先打开 calendar.md 再试');
    }
    const requestId = 'sticky-delete-' + Date.now() + '-' + (++stickyDeleteSeq);
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingStickyDeletes.delete(requestId);
        resolve({ ok: false, error: 'Calendar 响应超时，请确认 Calendar 已打开后重试' });
      }, 30000);
      const pending = { resolve, timer, webContentsId: win.webContents.id, sent: false, send: null };
      pendingStickyDeletes.set(requestId, pending);
      const send = () => {
        const p = pendingStickyDeletes.get(requestId);
        if (!p || p.sent) return;
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          clearTimeout(p.timer);
          pendingStickyDeletes.delete(requestId);
          resolve({ ok: false, error: 'Calendar 窗口已关闭，未能删除便利贴' });
          return;
        }
        p.sent = true;
        win.webContents.send('delete-sticky-note-request', { requestId, src, title, date: ev.date || '', file: stickyNoteFile });
      };
      pending.send = send;
      // Calendar 已就绪就直接发；否则等它 sticky-calendar-ready（与保存同一套就绪门）
      if (stickyCalendarReadyWindowId === win.webContents.id) send();
    });
    return result;
  } catch (error) {
    console.error('[Main] 删除便利贴失败:', error);
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('sticky-note-delete-result', (event, payload) => {
  const requestId = payload && payload.requestId;
  const pending = typeof requestId === 'string' ? pendingStickyDeletes.get(requestId) : null;
  if (!pending || pending.webContentsId !== event.sender.id) return { success: false };
  clearTimeout(pending.timer);
  pendingStickyDeletes.delete(requestId);
  pending.resolve(payload.result || { ok: false, error: 'Calendar 未返回删除结果' });
  return { success: true };
});
// 把新建出来的便利贴窗口错开到发起者右下方（避免与旧贴完全重叠，让用户一眼看见它出现了）
function cascadeNewStickyWindow(key, idx, senderWebContents) {
  try {
    const win = stickyNoteWindows.get(noteWinId(key, idx));
    if (!win || win.isDestroyed()) return;
    const from = senderWebContents ? BrowserWindow.fromWebContents(senderWebContents) : null;
    const base = (from && !from.isDestroyed()) ? from.getBounds() : null;
    const b = win.getBounds();
    const pos = clampToVisible(
      (base ? base.x : b.x) + 26,
      (base ? base.y : b.y) + 26,
      b.width, b.height
    );
    win.setPosition(pos.x, pos.y);
  } catch (error) { /* 摆放失败不影响新建结果 */ }
}
// 🆕 便利贴「发邮件」：便利贴窗 → 本进程 → 找到邮件插件 webview → 调 window.sendEmailByPlugin
//   （与主窗口 renderer.js 的 sendEmailViaPlugin 同一函数：FormData POST localhost:5003/send_email，
//     并写邮件插件自己的发送历史）。收件人/主题/正文由便利贴窗的浮层收集后传来。
//   两条路径，按邮件插件是否加载自动分流：
//     ① 主程序模式：邮件插件以 webview 跑在某个工作区页签 → sendEmailByPlugin（写邮件插件历史）
//     ② --sticky 独立模式：根本没有邮件插件 → 主进程按同一契约直连邮件服务（见下方兜底函数）
// 📧 邮件服务直连兜底：multipart/form-data POST 到 localhost:5003/send_email。
// 发件人账号/密码统一由 emailService/email-config.json 维护，客户端（便利贴/邮件插件）不再写死。
const STICKY_EMAIL_SERVICE_URL = 'http://localhost:5003/send_email';
// 主进程按邮件插件同一契约直连邮件服务：multipart/form-data POST，字段
// receiver_email / subject / body；返回 JSON { status, message }。
// 用手写 multipart + http 模块（不依赖 Node 全局 fetch/FormData 的实验性 API）。
function postStickyEmailViaService(recipients, subject, body) {
  return new Promise((resolve) => {
    const boundary = '----StickyNoteEmail' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const fields = [
      ['receiver_email', recipients.join(',')],
      ['subject', subject],
      ['body', body]
    ];
    const chunks = [];
    fields.forEach((field) => {
      chunks.push(Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + field[0] + '"\r\n\r\n' +
        String(field[1]) + '\r\n', 'utf8'));
    });
    chunks.push(Buffer.from('--' + boundary + '--\r\n', 'utf8'));
    const payload = Buffer.concat(chunks);

    let target;
    try {
      target = new URL(STICKY_EMAIL_SERVICE_URL);
    } catch (error) {
      resolve({ success: false, message: '邮件服务地址无效' });
      return;
    }
    const req = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: (target.pathname || '/') + (target.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': payload.length
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let result = null;
        try { result = JSON.parse(raw); } catch (error) { result = null; }
        if (result && result.status === 'success') {
          resolve({ success: true, message: result.message || '邮件发送成功' });
        } else {
          resolve({
            success: false,
            message: (result && result.message) ? result.message : ('邮件服务返回异常（HTTP ' + res.statusCode + '）')
          });
        }
      });
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ success: false, message: '邮件服务无响应（' + STICKY_EMAIL_SERVICE_URL + '）' });
    });
    req.on('error', (error) => {
      resolve({ success: false, message: '无法连接邮件服务（' + STICKY_EMAIL_SERVICE_URL + '）：' + error.message });
    });
    req.end(payload);
  });
}
ipcMain.handle('sticky-note-send-email', async (event, arg) => {
  try {
    const recipients = (arg && Array.isArray(arg.recipients))
      ? arg.recipients.filter((r) => typeof r === 'string' && r.trim())
      : [];
    if (recipients.length === 0) return { success: false, message: '收件人为空' };
    const subject = (arg && typeof arg.subject === 'string') ? arg.subject : '';
    const body = (arg && typeof arg.body === 'string') ? arg.body : '';
    if (!subject.trim()) return { success: false, message: '主题不能为空' };

    // 邮件插件以 <webview> 形式跑在某个工作区页签里：枚举全部 webContents（含 webview guest）找它。
    // ⚠️ 必须精确匹配 index.html——邮件详情窗加载的是同目录的 email-detail.html，不能误判。
    const emailWc = webContents.getAllWebContents().find((wc) => {
      try { return /plugins[\\/]email[\\/]index\.html/.test(wc.getURL() || ''); } catch (err) { return false; }
    });
    // ② 没有邮件插件（--sticky 独立模式）：主进程按同一契约直连邮件服务
    if (!emailWc) {
      console.log('[Main] 便利贴发邮件：未找到邮件插件 webview，改由主进程直连邮件服务（' + STICKY_EMAIL_SERVICE_URL + '）');
      return await postStickyEmailViaService(recipients, subject, body);
    }

    const sendResult = emailWc.executeJavaScript(`
      (async () => {
        try {
          const result = await window.sendEmailByPlugin(${JSON.stringify(recipients)}, ${JSON.stringify(subject)}, ${JSON.stringify(body)});
          return JSON.stringify(result || { success: false, message: '邮件插件无响应' });
        } catch (err) {
          return JSON.stringify({ success: false, message: (err && err.message) ? err.message : String(err) });
        }
      })()
    `).then((json) => {
      try { return JSON.parse(json); } catch (err) { return { success: false, message: '邮件插件返回无法解析' }; }
    }).catch((err) => ({ success: false, message: (err && err.message) ? err.message : String(err) }));
    // 兜底超时（邮件服务无响应时别让便利贴一直转圈）
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve({ success: false, message: '邮件发送超时，请重试' }), 60000);
    });
    return await Promise.race([sendResult, timeout]);
  } catch (error) {
    console.error('[Main] 便利贴发送邮件失败:', error);
    return { success: false, message: (error && error.message) ? error.message : String(error) };
  }
});
ipcMain.handle('sticky-notes-count', () => ({ count: stickyNoteWindows.size }));

// 单张便利贴：读取自身状态（位置/尺寸/颜色/透明度）
ipcMain.handle('sticky-note-get', (e, arg) => {
  const it = noteInst(String(arg && arg.key), +arg.idx || 0);
  return Object.assign({}, it);
});
// 单张便利贴：保存状态补丁 {key, idx, patch:{x,y,w,h,color,opacity}}
ipcMain.handle('sticky-note-set', (e, arg) => {
  const key = String(arg && arg.key), idx = +arg.idx || 0;
  const it = noteInst(key, idx);
  Object.assign(it, (arg && arg.patch) || {});
  saveStickyNoteState();
  return true;
});
// 单张便利贴：窗口几何操作（翻页模式指向唯一的翻页窗）
ipcMain.handle('sticky-note-bounds', (e, arg) => {
  const win = (stickyNoteMode === 'flip') ? stickyNoteFlipWindow
                                         : stickyNoteWindows.get(noteWinId(String(arg && arg.key), +arg.idx || 0));
  if (!win || win.isDestroyed()) return null;
  const b = win.getBounds();
  if (arg && typeof arg.x === 'number' && typeof arg.y === 'number') win.setPosition(Math.round(arg.x), Math.round(arg.y));
  if (arg && typeof arg.width === 'number' && typeof arg.height === 'number') {
    // 高度下限 48：给「最小化小卡」（~85px）留出空间；常规缩放下限由渲染端 .rz 把手自己保证（MIN_H=90）
    win.setBounds({ x: b.x, y: b.y, width: Math.max(140, Math.round(arg.width)), height: Math.max(48, Math.round(arg.height)) });
  }
  return win.getBounds();
});
// 🆕 拖动用：单向、无回传（ipcRenderer.send），避免 invoke 的来回等待造成迟滞；落盘去抖见 persistPos
ipcMain.on('sticky-note-move', (e, arg) => {
  const win = stickyNoteWindows.get(noteWinId(String(arg && arg.key), +arg.idx || 0));
  if (!win || win.isDestroyed()) return;
  if (arg && typeof arg.x === 'number' && typeof arg.y === 'number') win.setPosition(Math.round(arg.x), Math.round(arg.y));
});
// 🆕 翻页模式：记住最后停留的那张（存在翻页窗自己的设定条目里，与几何同一份存档）。
//   只更新内存＋去抖落盘：翻页本身很频繁，不必每翻一张就写一次 iCloud 目录；
//   关窗／退出时由 close 处理立即 flush（见 createFlipStickyWindow）。
ipcMain.on('sticky-note-flip-position', (e, arg) => {
  if (!arg || typeof arg.lastKey !== 'string') return;
  const it = noteInst(FLIP_KEY, FLIP_IDX);
  it.lastKey = arg.lastKey;
  it.lastIdx = +arg.lastIdx || 0;
  if (arg && typeof arg.lastId === 'string') it.lastId = arg.lastId;
  scheduleStickyStateSave();
});
// 单张便利贴：关闭这一张（仅本次；重新开启会按 ×N 回来）。
ipcMain.handle('sticky-note-close', (e, arg) => {
  if (stickyNoteMode === 'flip') {
    if (!arg || typeof arg.key !== 'string') return false;
    const idx = +arg.idx || 0;
    const activeIndex = stickyNoteOrder.findIndex(note => note.key === arg.key && note.idx === idx);
    if (activeIndex < 0) return true;

    stickyNoteOrder.splice(activeIndex, 1);
    const win = stickyNoteFlipWindow;
    if (win && !win.isDestroyed()) {
      if (stickyNoteOrder.length) {
        win.webContents.send('sticky-note-order-updated', { order: stickyNoteOrder });
      } else {
        stickyNoteFlipWindow = null;
        win.close();
      }
    }
    notifyStickyNoteOpenState();
    return true;
  }

  const win = stickyNoteWindows.get(noteWinId(String(arg && arg.key), +arg.idx || 0));
  if (win && !win.isDestroyed()) win.close();
  return true;
});
// 单张便利贴：唤起主程式（显示/聚焦主窗口，并让 TodoList 打开该事件）
// action='edit'（缺省）→ 打开行程编辑框；action='scroll' → 只滚动定位到该行程（不打开编辑框）；
// action='new' → 打开「新增行程」表单（预填 sticky=1 + 写入当前便利贴的来源档），用于在 include 档里新建便利贴
// 单张便利贴：唤起主程式（显示/聚焦主窗口，并让 TodoList 打开该事件）
// action='edit'（缺省）→ 打开行程编辑框；action='scroll' → 只滚动定位到该行程（不打开编辑框）
// ⚠️ 「新建便利贴」不走这里：它在便利贴窗内自己开浮层 → sticky-note-create（不必把用户带到 Calendar 表单）。
ipcMain.handle('wake-main-from-note', (e, arg) => {
  const win = showMainWindow();
  const channel = (arg && arg.action === 'scroll') ? 'scroll-sticky-event' : 'open-sticky-event';
  const notifySticky = () => {
    if (!win.isDestroyed()) win.webContents.send(channel, { key: (arg && arg.key) || '' });
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', notifySticky);
  else notifySticky();
  return true;
});

// 🆕 便利贴：从便利贴菜单唤起指定主程序视图（仅开便利贴 --sticky 时主窗只驻 Dock，不显示）。
//   target='todolist' → 主窗切到 TodoList 独立模式（等同 ./start.sh --todolist）并显示/聚焦。
//   target='ai'       → 主窗切到 AI 智能控制台（等同 ./start.sh）并显示/聚焦。
// 若主窗已存在：当前就是目标视图则直接 show+focus（不重载、不丢状态）；否则 loadFile 到目标再显示。
// 若主窗已被销毁：先建一个隐藏窗（避免闪现错误内容），再 loadFile 到目标并 show。
function openMainViewFromNote(target) {
  let win = mainWindow;
  if (!win || win.isDestroyed()) {
    createWindow({ show: false, skipStickyRestore: true });
    win = mainWindow;
  }
  const url = win.webContents.getURL();
  if (target === 'todolist') {
    const isTarget = url.includes('todolist/index.html') && url.includes('standalone=1');
    if (!isTarget) win.loadFile('src/plugins/todolist/index.html', { search: '?standalone=1&cal=1' });
  } else { // 'ai'：AI 智能控制台（主程序默认入口）
    const isTarget = url.includes('crawler-window.html') && !url.includes('standalone=1');
    if (!isTarget) win.loadFile('src/crawler-window.html');
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

ipcMain.handle('open-todolist-from-note', () => openMainViewFromNote('todolist'));
ipcMain.handle('open-ai-console-from-note', () => openMainViewFromNote('ai'));

function init(shared) {
  // shared.app — Electron app 实例（本模组已自行 require，保留以兼容旧接口）
  // shared.APP_VERSION — 应用版本号
  // shared.apiServerModule — API 服务器模组（用于 get-app-info）
  // shared.setMainWindow — 设置主窗口的回调
  // shared.PLUGINS_DATA_DIR — 插件资料目录（裸档名解析的默认查找目录）
  APP_VERSION = shared.APP_VERSION;
  apiServerModule = shared.apiServerModule;
  setMainWindowCallback = shared.setMainWindow || (() => {});
  PLUGINS_DATA_DIR = shared.PLUGINS_DATA_DIR || '';

  // 🆕 主窗口最小化与恢复（用于截图区域录制时隐藏窗口）
  ipcMain.handle('minimize-main-window', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('restore-main-window', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
        mainWindow.focus();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-element-viewer', async (event, data) => {
    try {
      const viewer = createElementViewerWindow();

      // 每次都要发送最新数据（不管窗口是否已存在）
      // 等待查看器窗口加载完成后发送数据
      if (viewer.webContents.isLoading()) {
        viewer.webContents.once('did-finish-load', () => {
          viewer.webContents.send('set-element-data', data);
        });
      } else {
        // 窗口已加载，直接发送新数据
        viewer.webContents.send('set-element-data', data);
      }

      return { success: true, message: '查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] 打开查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('open-email-detail', async (event, url) => {
    try {
      console.log('[Main] 打开邮件详情窗口:', url);

      // 解析 URL 中的 hash 数据
      const urlObj = new URL(url);
      const hash = urlObj.hash;

      // 构建 email-detail.html 的完整路径
      const emailDetailPath = path.join(APP_ROOT, 'src', 'plugins', 'email', 'email-detail.html');
      const fullUrl = `file://${emailDetailPath}${hash}`;

      const detailWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: '邮件详情',
        frame: true,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // 🆕 跟踪此窗口，主题切换时主动通知它
      emailDetailWindows.add(detailWindow);
      detailWindow.on('closed', () => {
        emailDetailWindows.delete(detailWindow);
      });

      // 🆕 加载完成后，按主程式当前主题设置 body.dark（跟随统一控制）
      detailWindow.webContents.once('did-finish-load', () => {
        detailWindow.webContents.executeJavaScript(
          `document.body.classList.toggle('dark', ${workspaceDarkModeEnabled ? 'true' : 'false'});`
        ).catch(() => {});
      });

      detailWindow.loadURL(fullUrl);
      detailWindow.setMenuBarVisibility(false);

      return { success: true };
    } catch (error) {
      console.error('[Main] 打开邮件详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 卡片 markdown 新窗口：[文字](win:ID) 点击后，在独立窗口里渲染该卡片的 markdown
  // 数据走 URL hash（base64url），与 open-email-detail 同思路：避免 IPC 接收、无需 preload
  ipcMain.handle('open-card-window', async (event, payload) => {
    try {
      const { id, title, html, dark } = payload || {};
      if (!id) return { success: false, error: '缺少卡片 id' };
      const winPath = path.join(APP_ROOT, 'src', 'plugins', 'todolist', 'card-markdown-window.html');
      const json = JSON.stringify({
        title: title || ('卡片：' + id),
        html: html || '',
        dark: !!dark,
      });
      const encoded = Buffer.from(json, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const fullUrl = `file://${winPath}#${encoded}`;
      const win = new BrowserWindow({
        width: 760,
        height: 820,
        title: title || ('卡片：' + id),
        frame: true,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
          // 注入与主窗体相同的 preload，使 card-markdown-window.html 能调用 electronAPI.openWebPreview
          preload: path.join(APP_ROOT, 'preload.js'),
        },
      });
      cardWindows.add(win);
      win.on('closed', () => cardWindows.delete(win));
      win.loadURL(fullUrl);
      win.setMenuBarVisibility(false);

      // 🆕 markdown 渲染里的外链（普通外链 / ref-num 圆圈编号）点击 → 由渲染进程用「应用内独立窗体」
      //    （electronAPI.openWebPreview）打开；[文字](cur:URL)（在原浏览器开启）则由渲染进程放行、
      //    在本窗体内就地导航，故此处放行 http(s) 与 file；其余协议（如 javascript:）仍拦截，
      //    避免窗体被意外跳走，且绝不使用系统默认浏览器。
      win.webContents.on('will-navigate', (event, url) => {
        if (!/^(?:https?|file):\/\//i.test(url)) {
          event.preventDefault();
        }
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        return { action: /^https?:\/\//i.test(url) ? 'deny' : 'allow' };
      });
      return { success: true };
    } catch (error) {
      console.error('[Main] 打开卡片 markdown 窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 图片查看新窗体：[文字](win-img:URL) 点击后，在独立窗口里居中显示该图片
  // 数据走 URL hash（base64url），与 open-card-window 同思路：避免 IPC 接收、无需 preload
  const imageWindows = new Set();
  ipcMain.handle('open-image-window', async (event, payload) => {
    try {
      const { src, title } = payload || {};
      if (!src) return { success: false, error: '缺少图片 src' };
      const winPath = path.join(APP_ROOT, 'src', 'plugins', 'todolist', 'image-viewer.html');
      const json = JSON.stringify({ src, title: title || '图片' });
      const encoded = Buffer.from(json, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const fullUrl = `file://${winPath}#${encoded}`;
      const win = new BrowserWindow({
        width: 900,
        height: 700,
        title: title || '图片',
        frame: true,
        backgroundColor: '#0a0a0a',
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      imageWindows.add(win);
      win.on('closed', () => imageWindows.delete(win));
      win.loadURL(fullUrl);
      win.setMenuBarVisibility(false);
      return { success: true };
    } catch (error) {
      console.error('[Main] 打开图片窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 Emoji 速查表窗体：独立窗口完整列出全部 gemoji 短码与图样（搜索 / 分类 / 点击写入编辑器）。
  //    表情数据不经过 IPC —— 页面自行加载 vendor/gemoji-full.js（1870 条含分类），此处只传明暗主题。
  const emojiCheatSheetWindows = new Set();
  ipcMain.handle('open-emoji-cheatsheet', async (event, payload) => {
    try {
      const { dark } = payload || {};
      const winPath = path.join(APP_ROOT, 'src', 'plugins', 'todolist', 'emoji-cheatsheet.html');
      const json = JSON.stringify({ dark: !!dark });
      const encoded = Buffer.from(json, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const fullUrl = `file://${winPath}#${encoded}`;
      const win = new BrowserWindow({
        width: 1000,
        height: 760,
        title: 'Emoji 速查表',
        frame: true,
        webPreferences: {
          webSecurity: false,
          allowRunningInsecureContent: true,
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(APP_ROOT, 'preload.js'),
        },
      });
      emojiCheatSheetWindows.add(win);
      win.on('closed', () => emojiCheatSheetWindows.delete(win));
      win.loadURL(fullUrl);
      win.setMenuBarVisibility(false);
      return { success: true };
    } catch (error) {
      console.error('[Main] 打开 Emoji 速查表失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 Emoji 速查表 → 主窗口编辑器：把选中的 emoji 转发给主窗体，由主窗体插入光标处。
  //    主进程只做转发，不判断编辑器是否就绪；速查表侧无论转发与否都会自行复制一份到剪贴板兜底。
  ipcMain.handle('emoji-pick', async (event, payload) => {
    const { text } = payload || {};
    if (!text) return { success: false, error: '缺少内容' };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('emoji-pick-request', { text });
      return { success: true, delivered: true };
    }
    return { success: true, delivered: false };
  });

  // 🆕 裸档名解析：[文字](win:文件名) 只写档名时，默认在与卡片相同的资料目录（PLUGINS_DATA_DIR）查找，
  //    与 win:卡片ID 的定位逻辑保持一致。命中返回绝对路径，未命中返回 success:false。
  // 🆕 支持「裸档名 + 相对子路径 + ~/」：markdown 文件嵌入用 ```log logs/app.log 这类写法，
  //    基准目录仍是资料目录（与 win: 定位逻辑一致）。
  //    绝对路径由渲染进程直接交给 read-text-file，不走这里。
  ipcMain.handle('resolve-doc-path', async (event, payload) => {
    const name = (payload && payload.name) || '';
    if (!name) return { success: false, error: '空路径' };
    if (name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name) || /^file:\/\//i.test(name)) {
      return { success: false, error: '绝对路径无需解析' };
    }
    const dir = PLUGINS_DATA_DIR;
    if (!dir) return { success: false, error: '资料目录未配置' };
    let rel = name;
    if (rel === '~' || rel.startsWith('~/')) rel = path.join(os.homedir(), rel.slice(1));
    // 🆕 剥离多余的 data/ 前缀：PLUGINS_DATA_DIR 本身已是 xxx/data/，
    //    用户常写 data/scripts.txt（意为"项目 data 目录下的 scripts.txt"），
    //    若不剥离会拼成 xxx/data/data/scripts.txt 导致"文件不存在"。
    if (/^data[\\/]/i.test(rel)) rel = rel.replace(/^[Dd][Aa][Tt][Aa][\\/]+/, '');
    const full = path.resolve(dir, rel);
    // 路径穿越防护：解析结果必须仍在资料目录或用户目录内
    const base = path.resolve(dir);
    const home = path.resolve(os.homedir());
    const inside = (p, root) => p === root || p.startsWith(root + path.sep);
    if (!inside(full, base) && !inside(full, home)) {
      return { success: false, error: '路径越界：' + name };
    }
    if (!fs.existsSync(full)) return { success: false, error: '文件不存在：' + name };
    return { success: true, path: full };
  });

  // 🆕 文本文件读取：供渲染进程把 .md / 文本 / 代码文件显示在「应用内文档窗体」里。
  //    防护：仅限存在的普通文件、大小 ≤ 2MB、内容不含 NUL 字节（二进制拒绝）。
  ipcMain.handle('read-text-file', async (event, payload) => {
    try {
      const filePath = (payload && payload.path) || '';
      if (!filePath) return { success: false, error: '缺少文件路径' };
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { success: false, error: '不是普通文件' };
      if (stat.size > 2 * 1024 * 1024) return { success: false, error: '文件过大（>2MB），暂不支持显示' };
      const buf = fs.readFileSync(filePath);
      if (buf.indexOf(0) !== -1) return { success: false, error: '二进制文件，无法以文本显示' };
      return { success: true, content: buf.toString('utf8') };
    } catch (error) {
      console.error('[Main] 读取文本文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 🆕 B方案：渲染进程切换工作区黑夜模式后，主动同步到主进程并通知所有邮件详情窗口
  ipcMain.handle('set-workspace-theme', async (event, payload) => {
    try {
      const dark = !!(payload && payload.dark);
      workspaceDarkModeEnabled = dark;
      applyWorkspaceThemeToEmailDetails(dark);
      console.log('[Main] 工作区主题已同步到主进程:', dark ? '黑夜' : '白天');
      return { success: true, dark };
    } catch (error) {
      console.error('[Main] 同步工作区主题失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('refresh-element-viewer', async (event) => {
    try {
      if (!elementViewerWindow) {
        return { success: false, error: '元素查看器窗口未打开' };
      }

      // 通知渲染进程执行刷新
      mainWindow.webContents.send('request-element-refresh');

      return { success: true, message: '已请求刷新' };
    } catch (error) {
      console.error('[Main] 刷新元素查看器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 监听渲染进程发来的刷新数据
  ipcMain.on('element-refresh-data', (event, data) => {
    console.log('[Main] 收到 element-refresh-data 数据');
    console.log('[Main] 数据 keys:', data ? Object.keys(data) : 'null');
    console.log('[Main] allTextElements 数量:', data && data.allTextElements ? data.allTextElements.length : 0);

    if (elementViewerWindow) {
      elementViewerWindow.webContents.send('set-element-data', data);
      console.log('[Main] 已转发数据到元素查看器');
    } else {
      console.log('[Main] 元素查看器窗口不存在');
    }
  });

  ipcMain.handle('open-ai-response-viewer', async (event, data) => {
    try {
      const viewer = createAiResponseViewerWindow();

      if (data) {
        // 等待查看器窗口加载完成后发送数据
        viewer.webContents.once('did-finish-load', () => {
          viewer.webContents.send('set-response-data', data);
        });

        // 如果已经加载完成，直接发送
        if (!viewer.webContents.isLoading()) {
          viewer.webContents.send('set-response-data', data);
        }
      }

      return { success: true, message: 'AI 回复查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] 打开 AI 回复查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-loading', async (event, message) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-loading', message);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置加载状态失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-data', async (event, data) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-response-data', data);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置 AI 回复数据失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-error', async (event, errorMessage) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-error', errorMessage);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置错误状态失败:', error);
      throw error;
    }
  });

  ipcMain.handle('set-ai-response-selector', async (event, selector) => {
    try {
      if (aiResponseViewerWindow) {
        aiResponseViewerWindow.webContents.send('set-selector', selector);
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] 设置选择器失败:', error);
      throw error;
    }
  });

  // 测试选择器：从元素查看器发送，转发到主智控台窗口执行
  ipcMain.handle('test-selector', async (event, data) => {
    try {
      const selector = typeof data === 'string' ? data : data.selector;
      const expectedContent = typeof data === 'string' ? null : (data.expectedContent || null);
      const sourceWindowId = event.sender.id; // 记录请求来源窗口
      console.log('[Main] 收到测试选择器请求:', selector, expectedContent ? '（包含期望内容）' : '');

      // 生成唯一请求ID
      const requestId = `test-${Date.now()}-${++selectorTestSeq}`;

      // 创建 Promise 等待结果
      const resultPromise = new Promise((resolve, reject) => {
        // 10秒超时
        const timeout = setTimeout(() => {
          selectorTestCallbacks.delete(requestId);
          reject(new Error('测试超时'));
        }, 10000);

        selectorTestCallbacks.set(requestId, { resolve, reject, timeout, sourceWindowId });
      });

      if (mainWindow) {
        // 通知主智控台窗口执行测试，附带请求ID
        mainWindow.webContents.send('test-selector', {
          selector,
          expectedContent,
          requestId
        });
      }

      // 等待 renderer 返回结果
      return await resultPromise;
    } catch (error) {
      console.error('[Main] 测试选择器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 接收 renderer 返回的测试结果（使用 handle 而非 on，以响应 invoke 调用）
  ipcMain.handle('selector-test-result', (event, data) => {
    const { requestId, success, content, error } = data;
    const callback = selectorTestCallbacks.get(requestId);
    if (callback) {
      clearTimeout(callback.timeout);
      selectorTestCallbacks.delete(requestId);

      if (success) {
        callback.resolve({ success: true, content });
      } else {
        callback.resolve({ success: false, error });
      }
    }
    return { received: true };
  });

  // ========== DOM 树查看器相关 IPC ==========

  ipcMain.handle('open-dom-tree-viewer', async (event, data) => {
    try {
      console.log('[Main] 🟢 收到打开 DOM 树查看器请求');
      console.log('[Main]  数据是否存在:', !!data);
      if (data) {
        console.log('[Main] 🌳 树数据大小:', data.tree ? JSON.stringify(data.tree).length : 0, '字节');
        console.log('[Main] 🌐 URL:', data.url);
      }

      const viewer = createDomTreeViewWindow();
      console.log('[Main]  窗口创建/获取完成，isLoading:', viewer.webContents.isLoading());

      // 每次都要发送最新数据（不管窗口是否已存在）
      // 等待查看器窗口加载完成后发送数据
      if (viewer.webContents.isLoading()) {
        console.log('[Main] ⏳ 窗口加载中，等待 did-finish-load 事件');
        viewer.webContents.once('did-finish-load', () => {
          console.log('[Main] ✅ 窗口加载完成，发送数据');
          viewer.webContents.send('set-dom-tree-data', data);
        });
      } else {
        // 窗口已加载，直接发送新数据
        console.log('[Main] ✅ 窗口已加载，直接发送数据');
        viewer.webContents.send('set-dom-tree-data', data);
      }

      return { success: true, message: 'DOM 树查看器窗口已打开' };
    } catch (error) {
      console.error('[Main] ❌ 打开 DOM 树查看器失败:', error);
      throw error;
    }
  });

  ipcMain.handle('refresh-dom-tree', async (event) => {
    try {
      if (!mainWindow) {
        return { success: false, error: '主窗口未打开' };
      }

      // 通知主智控台窗口重新获取 DOM 树
      mainWindow.webContents.send('request-dom-tree-refresh');

      return { success: true, message: '已请求刷新 DOM 树' };
    } catch (error) {
      console.error('[Main] 刷新 DOM 树失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 监听渲染进程发来的 DOM 树刷新数据
  ipcMain.on('dom-tree-refresh-data', (event, data) => {
    console.log('[Main] 收到 dom-tree-refresh-data 数据');

    if (domTreeViewWindow) {
      domTreeViewWindow.webContents.send('set-dom-tree-data', data);
      console.log('[Main] 已转发数据到 DOM 树查看器');
    } else {
      console.log('[Main] DOM 树查看器窗口不存在');
    }
  });

  // ============================================================
  // 🔒 [已废弃] 'crawl-page' IPC Handler
  //    2026-06-12 起：服务卡片全部改为「Preview + 选择器抓取」模式，
  //    不再使用按 URL 直接扫整页 DOM 的方式。
  // ============================================================
  // ipcMain.handle('crawl-page', async (event, options) => {
  //   try {
  //     const targetUrl = typeof options === 'string' ? options : options.url;
  //     const customHeaders = typeof options === 'object' && options.headers ? options.headers : null;
  //
  //     return await crawlPageInternal(targetUrl, customHeaders);
  //   } catch (error) {
  //     console.error('[Main] 爬取失败:', error);
  //     throw error;
  //   }
  // });

  // 占位，防止语法错误（上面的函数已废弃）
  ipcMain.handle('crawl-page', async () => {
    throw new Error('[已废弃] crawl-page IPC 接口不再使用，请改用 preview-bookmark + capture-element-content 组合方式');
  });

  ipcMain.handle('save-data', async (event, data, filename) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存智控数据',
        defaultPath: filename || 'ai-console-data.json',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        fs.writeFileSync(result.filePath, content, 'utf8');
        console.log('[Main] 数据已保存:', result.filePath);
        return { success: true, path: result.filePath };
      }

      return { success: false, message: '用户取消保存' };
    } catch (error) {
      console.error('[Main] 保存失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-app-info', () => {
    const apiStatus = apiServerModule.getAPIServerStatus();
    return {
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      apiServerRunning: apiStatus.running,
      apiPort: apiStatus.port
    };
  });

  // 🆕 将 Base64 图片数据写入系统剪贴板（用于 Kimi 等平台的附件上传）
  ipcMain.handle('write-image-to-clipboard', async (event, base64Data, imageName) => {
    console.log('[Main] 📋 收到 write-image-to-clipboard 请求！');
    console.log('[Main] 图片名称:', imageName);

    try {
      // 解析 Base64 数据
      let imageData;
      if (base64Data.startsWith('data:')) {
        // 如果是 data URL，去掉前缀
        const base64String = base64Data.split(',')[1];
        imageData = nativeImage.createFromDataURL(base64Data);
      } else {
        // 纯 Base64 字符串
        imageData = nativeImage.createFromDataURL(`data:image/png;base64,${base64Data}`);
      }

      // 写入剪贴板
      clipboard.writeImage(imageData);

      console.log('[Main] ✅ 图片已成功写入系统剪贴板！');
      console.log('[Main]   尺寸:', imageData.getSize());

      return { success: true, message: '图片已写入剪贴板' };
    } catch (error) {
      console.error('[Main] ❌ 写入剪贴板失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-text-to-clipboard', async (event, text) => {
    console.log('[Main] 📋 收到 write-text-to-clipboard 请求！');
    console.log('[Main] 文本内容预览:', text.substring(0, 50) + '...');

    try {
      clipboard.writeText(text);
      console.log('[Main] ✅ 文本已成功写入系统剪贴板！');
      return { success: true, message: '文本已写入剪贴板' };
    } catch (error) {
      console.error('[Main] ❌ 写入剪贴板失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('activate-main-window', async () => {
    console.log('[Main] 🖥️ 收到 activate-main-window 请求！');

    try {
      showMainWindow();

      console.log('[Main] ✅ 主窗口已激活！');
      return { success: true, message: '主窗口已激活' };
    } catch (error) {
      console.error('[Main] ❌ 激活主窗口失败:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { init, createWindow, getMainWindow: () => mainWindow,
  // 🆕 暴露当前 calendar 档案绝对路径（给 view-sticky-rules.js 用，让规则档案跟 calendar.md 同目录）
  getStickyNoteFile: () => stickyNoteFile,
  // 🆕 让 view-sticky-rules.js 把 reloadAndNotify 注入进来（init 时序：windows 先 init，vsr 后 init）
  setViewRulesReloader: (fn) => { reloadViewRulesAfterOpen = typeof fn === 'function' ? fn : null; },
};
