/* ============================================================
 * 🗒 便利貼設定備份（可攜 JSON）——桌面與 LITE 共用同一套轉換
 * ------------------------------------------------------------
 * 目的：手機 LITE 的設定原本只存 localStorage，換 origin（port／LAN IP）
 *      或清網站資料就整份消失。改為可匯出成 calendar 同目錄的 JSON，
 *      換裝置／重開後再載入即可把值寫回 storage。
 *
 * 可攜格式（本檔輸出）：
 *   {
 *     "_format": "lite-sticky-prefs/v1",
 *     "calendarFile": "calendar.md",
 *     "notes": { "標題|日期|序號": { color, opacity, fontScale, fontColor, fontWeight, undoneChecksOnly, meteor } },
 *     "hidden": ["標題|日期|序號"],
 *     "lastId": "標題|日期|序號",
 *     "lastIdx": 3
 *   }
 *
 * 也認得桌面原生存檔 sticky-notes-state.json：
 *   { "evp36": [ { _id: "標題|日期", color, ... } ], "__flip__": [ { flipHidden, lastId, lastIdx } ] }
 *   逐筆轉成可攜格式（陣列索引＝該行程的第幾張便利貼）。
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StickySettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'lite-sticky-prefs/v1';

  function isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')); }
  function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  // 外框流星子物件：與 UI 相同的夾值＋白名單形狀；不信任外部 JSON，逐欄清洗
  function pickMeteor(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const shapes = ['comet', 'sharp', 'band', 'twin'];
    const out = {
      on: raw.on === true,
      follow: raw.follow === true,
      rainbow: raw.rainbow === true
    };
    if (isFiniteNum(raw.speed)) out.speed = Math.min(30, Math.max(3, Math.round(raw.speed)));
    if (isFiniteNum(raw.size)) out.size = Math.min(120, Math.max(4, Math.round(raw.size)));
    if (shapes.indexOf(raw.shape) >= 0) out.shape = raw.shape;
    if (isHex(raw.color)) out.color = raw.color;
    if (isFiniteNum(raw.flame)) out.flame = Math.min(200, Math.max(20, Math.round(raw.flame)));
    return out;
  }

  // 只收已知欄位並做與 UI 相同的夾值；未知欄位（幾何 x/y/w/h 等）不進可攜檔
  function pickPrefs(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    if (isHex(raw.color)) out.color = raw.color;
    if (isFiniteNum(raw.opacity)) out.opacity = Math.min(100, Math.max(20, Math.round(raw.opacity)));
    if (isFiniteNum(raw.fontScale)) out.fontScale = Math.min(2.5, Math.max(0.5, +raw.fontScale.toFixed(2)));
    if (isHex(raw.fontColor)) out.fontColor = raw.fontColor;
    if ([400, 600, 700].indexOf(raw.fontWeight) >= 0) out.fontWeight = raw.fontWeight;
    if (typeof raw.undoneChecksOnly === 'boolean') out.undoneChecksOnly = raw.undoneChecksOnly;
    // 🆕 外框流星：有設定過（raw.meteor 是物件）才進可攜檔，舊設定／無此欄的便利貼不受影響
    if (raw.meteor && typeof raw.meteor === 'object') out.meteor = pickMeteor(raw.meteor);
    return out;
  }

  function cleanHidden(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  }
  function cleanLastIdx(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }
  function updateNote(notes, identity, prefs) {
    if (!identity || !Object.keys(prefs).length) return;
    notes[identity] = Object.assign({}, notes[identity] || {}, prefs);
  }

  // 桌面 sticky-notes-state.json → 可攜 store
  // _id 已遷移的舊條目先併、現役條目後併 → 同名時現役設定勝出
  function desktopStateToStore(raw) {
    const notes = {};
    const collect = (wantMigrated) => {
      Object.keys(raw || {}).forEach((key) => {
        if (key === '__flip__') return;
        const arr = raw[key];
        if (!Array.isArray(arr)) return;
        arr.forEach((it, index) => {
          if (!it || typeof it !== 'object') return;
          if (typeof it._id !== 'string' || !it._id) return;
          if (!!it.migratedTo !== wantMigrated) return;
          updateNote(notes, it._id + '|' + (parseInt(index, 10) || 0), pickPrefs(it));
        });
      });
    };
    collect(true);
    collect(false);
    const flip = (Array.isArray(raw && raw.__flip__) && raw.__flip__[0]) || {};
    return {
      notes,
      hidden: cleanHidden(flip.flipHidden),
      lastId: typeof flip.lastId === 'string' ? flip.lastId : '',
      lastIdx: cleanLastIdx(flip.lastIdx)
    };
  }

  // 可攜 store → 正規化 store（不信任外部 JSON）
  function portableToStore(raw) {
    const notes = {};
    Object.keys((raw && raw.notes) || {}).forEach((identity) => {
      updateNote(notes, identity, pickPrefs(raw.notes[identity]));
    });
    return {
      notes,
      hidden: cleanHidden(raw && raw.hidden),
      lastId: raw && typeof raw.lastId === 'string' ? raw.lastId : '',
      lastIdx: cleanLastIdx(raw && raw.lastIdx)
    };
  }

  // 回傳 { format: 'portable'|'desktop', calendarFile, store }
  // 認不出格式、或檔案裡沒有任何設定時丟 Error（呼叫端直接顯示給使用者）。
  // ⚠️ 桌面原生檔的 key 只有 evp{序號} 與 __flip__；不可用「有沒有陣列」當判準，
  //    否則誤選任何含陣列的 JSON 都會被當成空設定檔 → 載入後把現有設定清空。
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('內容不是設定物件');
    }
    let out = null;
    if (raw.notes && typeof raw.notes === 'object' && !Array.isArray(raw.notes)) {
      out = {
        format: 'portable',
        calendarFile: typeof raw.calendarFile === 'string' ? raw.calendarFile : '',
        store: portableToStore(raw)
      };
    } else if (Object.keys(raw).some((k) => k === '__flip__' || /^evp\d+$/.test(k))) {
      out = { format: 'desktop', calendarFile: '', store: desktopStateToStore(raw) };
    }
    if (!out) throw new Error('認不出這種 JSON 格式（需要便利貼設定檔）');
    const store = out.store;
    if (!countNotes(store) && !store.hidden.length && !store.lastId) {
      throw new Error('這個檔案裡沒有任何便利貼設定');
    }
    return out;
  }

  function buildPortable(store, calendarFile, appName) {
    const src = store || {};
    const notes = {};
    Object.keys(src.notes || {}).forEach((identity) => {
      updateNote(notes, identity, pickPrefs(src.notes[identity]));
    });
    return {
      _format: FORMAT,
      _app: appName || '',
      calendarFile: calendarFile || '',
      exportedAt: new Date().toISOString(),
      notes,
      hidden: cleanHidden(src.hidden),
      lastId: typeof src.lastId === 'string' ? src.lastId : '',
      lastIdx: cleanLastIdx(src.lastIdx)
    };
  }

  function countNotes(store) {
    return Object.keys((store && store.notes) || {}).length;
  }

  return {
    FORMAT,
    pickPrefs,
    normalize,
    buildPortable,
    desktopStateToStore,
    countNotes
  };
});
