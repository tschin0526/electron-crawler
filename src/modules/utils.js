/**
 * 通用工具函数模组
 * 从 renderer.js 拆分而来
 */

// HTML 转义
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 截断 URL
function truncateUrl(url) {
  if (!url) return '';
  return url.length > 60 ? url.substring(0, 60) + '...' : url;
}

// 转义正则表达式
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 顏色名解析（2026-11-09）：支援中文色名、英文 CSS keyword、hex、rgb/rgba/hsl ──
//   中文色卡：日常場景覆蓋即可，不求全；使用者可隨時用 hex 繞過。
//   精確匹配（key 是中文）→ 找不到 → 透傳給 CSS（讓瀏覽器自己判斷）。
const CN_COLORS = {
  '红': '#e74c3c', '橙': '#e67e22', '黄': '#f1c40f', '金': '#d4af37',
  '粉': '#ff6b9d', '紫': '#8e44ad', '蓝': '#3498db', '浅蓝': '#aed6f1',
  '深蓝': '#1d4d7a', '绿': '#27ae60', '深绿': '#1d4d3a', '浅绿': '#82d9a6',
  '青': '#1abc9c', '灰': '#95a5a6', '黑': '#2c3e50', '白': '#ecf0f1',
  '卡其': '#bdb76b', '棕': '#8b5a2b', '酒红': '#722f37', '米': '#f5f0dc'
};
// 解析顏色字串：中文色名 → hex；hex/rgb/rgba/hsl → 原樣透傳；其餘交給 CSS。
//   空字串 / 純空白 → 回傳空字串（表示「未設定」，CSS 走 var 兜底）。
function resolveColorName(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  if (CN_COLORS[s]) return CN_COLORS[s];                    // 中文精確匹配
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;  // hex
  if (/^(rgb|rgba|hsl|hsla)\s*\(/i.test(s)) return s;      // 函式型
  return s;                                                  // CSS keyword 等原樣透傳
}
// 從 gp 標記字串裡提取 fg/bg/anim/rail 屬性。
//   anim 僅接受 pulse、scan、data...glitch 九種；rail=斜栏|直栏|>形栏|圆弧栏#色A#色B。
//   註：key 本身必須是「不含 | 的字串」，| 之後才算屬性段。
const GP_RAIL_STYLES = ['斜栏', '直栏', '>形栏', '圆弧栏'];
function parseGpAttrs(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { key: '', fg: '', bg: '', anim: '', railStyle: '', railA: '', railB: '' };
  const pipe = s.indexOf('|');
  const key = (pipe < 0 ? s : s.slice(0, pipe)).trim();
  let fg = '', bg = '', anim = '', railStyle = '', railA = '', railB = '';
  if (pipe >= 0) {
    const attrStr = s.slice(pipe + 1);
    const pairs = attrStr.split(',');
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = pair.slice(0, eq).trim().toLowerCase();
      const v = pair.slice(eq + 1).trim();
      if (k === 'fg') fg = resolveColorName(v);
      else if (k === 'bg') bg = resolveColorName(v);
      else if (k === 'anim' && /^(pulse|scan|data|aurora|orbit|arc|holo|signal|glitch)$/.test(v)) anim = v;
      else if (k === 'rail') {
        const parts = v.split('#');
        if (parts.length >= 3 && GP_RAIL_STYLES.indexOf(parts[0].trim()) >= 0) {
          railStyle = parts[0].trim();
          railA = resolveColorName(parts[1].trim());
          railB = resolveColorName(parts[2].trim());
        }
      }
    }
  }
  return { key: key, fg: fg, bg: bg, anim: anim, railStyle: railStyle, railA: railA, railB: railB };
}
// 從一整行文字裡（可能是 fence open 行，也可能是行尾 gp 行）提取 gp attrs。
//   優先匹配「塊級」整行 {gpX|...} 標記，其次匹配行尾 {gpX|...}。
//   回傳：{ key, fg, bg, anim, railStyle, railA, railB }，找不到 → 回傳空屬性。
function extractGpAttrsFromLine(line) {
  const s = String(line == null ? '' : line);
  let m = s.trim().match(/^\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}[ \t]*$/i);
  if (m) return parseGpAttrs(m[1]);
  m = s.match(/\{[ \t]*(?:group|gp)[ \t]*:?[ \t]*([^{}]*)\}(?=[ \t]*(?:\[\[[^\]]*\]\][ \t]*)*$)/i);
  if (m) return parseGpAttrs(m[1]);
  return { key: '', fg: '', bg: '', anim: '', railStyle: '', railA: '', railB: '' };
}

// 挂载到 window，确保 HTML onclick 和其他模组可以访问
window.escapeHtml = escapeHtml;
window.truncateUrl = truncateUrl;
window.escapeRegex = escapeRegex;
window.resolveColorName = resolveColorName;
window.parseGpAttrs = parseGpAttrs;
window.extractGpAttrsFromLine = extractGpAttrsFromLine;
