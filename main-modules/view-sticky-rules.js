/* ============================================================
 * 🧩 自定义「VIEW 便利贴」规则：资料存档 ＋ 维护窗（主进程）
 * ------------------------------------------------------------
 * 定位：这是一个独立的插件档，跟便利贴本体（windows.js）不纠缠。
 *   · 资料：data/view-sticky-rules.json —— 全应用共用一份（不分 calendar 档案），
 *     因为投影贴抓的是「目前开启的那本行程」里的行，规则本身跟档无关。
 *   · 渲染：src/plugins/todolist/view-sticky-rules.js（引擎）＋
 *     view-sticky-rules.html（维护窗）。这里只管存／读／开窗／通知。
 *
 * 存档沿用便利贴的写法：先写 .tmp 再 rename 换过去。
 *   直接 writeFileSync 会先 truncate，写入途中被强退／iCloud 插队 → 留下 0 字节空档＝设定等于被删。
 * 读不到／解析失败 → 回传 null，让写入端拒绝覆盖（宁可不存，也不把使用者设定的规则洗掉）。
 * ============================================================ */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, '..');
const RULES_FILE = 'view-sticky-rules.json';

let PLUGINS_DATA_DIR = '';
let getMainWindow = null;
let getStickyNoteFile = null;   // 🆕 动态获取当前 calendar 档案路径（来自 windows.js）
let rulesWindow = null;

function rulesPath() {
  // 🆕 优先跟 sticky-notes-state.json 同目录（calendar.md 的 dirname）：
  //   sticky-notes-state.json 永远跟 calendar.md 同目录 → view-sticky-rules.json 也应该这样。
  //   calendar 路径可能还没设定（程式刚启动，用户还没开便利贴）→ fallback 到 PLUGINS_DATA_DIR。
  try {
    const calFile = (typeof getStickyNoteFile === 'function') ? getStickyNoteFile() : '';
    if (calFile) return path.join(path.dirname(calFile), RULES_FILE);
  } catch (e) { /* getStickyNoteFile 抛错 → 跳过，走 fallback */ }
  return path.join(PLUGINS_DATA_DIR || APP_ROOT, RULES_FILE);
}
function readRulesFile() {
  const p = rulesPath();
  try {
    if (!fs.existsSync(p)) return { ok: true, canWrite: true, rules: [] };
    const text = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(text);
    return { ok: true, canWrite: true, rules: Array.isArray(data) ? data : (Array.isArray(data && data.rules) ? data.rules : []) };
  } catch (e) {
    console.warn('[ViewStickyRules] 规则档案读不到／解析失败（本次不覆盖旧档）:', e);
    return { ok: false, canWrite: false, rules: [] };
  }
}
function writeRulesFile(rules) {
  const p = rulesPath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const text = JSON.stringify({ version: 1, rules: Array.isArray(rules) ? rules : [] }, null, 2);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    try { fs.renameSync(tmp, p); }
    catch (e) { fs.writeFileSync(p, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) {} }
    return { ok: true };
  } catch (e) {
    console.warn('[ViewStickyRules] 规则档案写入失败:', e);
    return { ok: false, error: e.message };
  }
}

// 通知日历窗（投影贴是在那边算的）：规则变了 → 重新拉一次并刷新便利贴清单
function notifyRulesChanged(rules) {
  try {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) win.webContents.send('view-sticky-rules-changed', rules || []);
  } catch (e) { /* 主窗还没起来／已关掉：下次开窗自然会读到最新档案 */ }
}

function openRulesWindow() {
  if (rulesWindow && !rulesWindow.isDestroyed()) {
    rulesWindow.focus();
    return rulesWindow;
  }
  rulesWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 760,
    minHeight: 480,
    title: '自定义 VIEW 便利贴维护作业',
    frame: true,
    webPreferences: {
      webSecurity: false,
      allowRunningInsecureContent: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(APP_ROOT, 'preload.js'),
    },
  });
  rulesWindow.on('closed', () => { rulesWindow = null; });
  rulesWindow.loadFile(path.join(APP_ROOT, 'src', 'plugins', 'todolist', 'view-sticky-rules.html'));
  rulesWindow.setMenuBarVisibility(false);
  return rulesWindow;
}

function init(shared) {
  PLUGINS_DATA_DIR = (shared && shared.PLUGINS_DATA_DIR) || '';
  getMainWindow = (shared && shared.getMainWindow) || null;
  getStickyNoteFile = (shared && shared.getStickyNoteFile) || null;

  // 读规则（渲染端启动时拉一次；维护窗打开时也拉一次）
  ipcMain.handle('vsr-list', async () => {
    const r = readRulesFile();
    return { success: true, rules: r.rules, readable: r.ok, path: rulesPath() };
  });

  // 存规则：整个阵列覆盖写入（维护窗是唯一写入端，规则条数少，不做合并）
  ipcMain.handle('vsr-save', async (event, rules) => {
    const cur = readRulesFile();
    if (!cur.canWrite) return { success: false, error: '规则档案目前读不到，可能还有资料 → 本次不覆盖' };
    const list = Array.isArray(rules) ? rules : [];
    const w = writeRulesFile(list);
    if (!w.ok) return { success: false, error: w.error };
    notifyRulesChanged(list);
    return { success: true, count: list.length };
  });

  // 维护窗入口（目前挂在便利贴窗的菜单上，以后也可以挂别处）
  ipcMain.handle('vsr-open', async () => {
    try {
      openRulesWindow();
      return { success: true };
    } catch (e) {
      console.error('[ViewStickyRules] 打开维护窗失败:', e);
      return { success: false, error: e.message };
    }
  });

  return {
    rulesPath,
    // 🆕 主进程在 open-sticky-notes 之后调这个：
    //    stickyNoteFile 刚设定好 → rulesPath() 现在能正确找到 calendar.md 同目录的 view-sticky-rules.json →
    //    重新读档案 + 推给渲染端，让它立刻把自定义 VIEW 贴加进翻页清单。
    reloadAndNotify() {
      const r = readRulesFile();
      notifyRulesChanged(r.rules);
    }
  };
}

module.exports = { init };
