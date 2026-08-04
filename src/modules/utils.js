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

// 挂载到 window，确保 HTML onclick 和其他模组可以访问
window.escapeHtml = escapeHtml;
window.truncateUrl = truncateUrl;
window.escapeRegex = escapeRegex;
