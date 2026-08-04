/**
 * 邮件功能模组
 * 从 renderer.js 拆分而来
 * 依赖：showStatus, addFloatHistoryEntry, floatEmailRecipients（来自 renderer.js）
 */

// 🆕 浮动视窗：收到AI回复后自动发送邮件
async function sendEmailAfterReply(bookmarkName, message, answer) {
  // 优先使用浮动视窗收件人，排程触发时使用排程收件人
  const recipients = floatEmailRecipients.trim() || String(window.scheduleEmailRecipientsValue || '').trim();
  if (!recipients) return; // 没有设置收件人，不发送

  const recipientList = recipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
  if (recipientList.length === 0) return;

  console.log(`[Email] 📧 自动发送邮件给 ${recipientList.join(', ')}...`);
  showStatus('📧 正在自动发送邮件...', 'info');

  try {
    const subject = `[AI回复] ${bookmarkName} - ${message.substring(0, 100)}`;
    const body = `【问题】\n${message}\n\n【AI回复】\n${answer}`;
    const result = await sendEmailViaPlugin(recipientList, subject, body);
    if (result.success) {
      const emailMsg = `📧 邮件已通过插件发送给 ${recipientList.join(', ')}`;
      showStatus(emailMsg, 'success', undefined, true);
      addFloatHistoryEntry({ source: '系统', type: 'success', message: emailMsg, recipients: recipientList.join(', ') });
    } else {
      const emailMsg = `📧 邮件发送失败：${result.message}`;
      showStatus(emailMsg, 'error', undefined, true);
      addFloatHistoryEntry({ source: '系统', type: 'error', message: emailMsg, recipients: recipientList.join(', ') });
    }
  } catch (error) {
    const emailMsg = ` 邮件发送失败：${error.message}`;
    showStatus(emailMsg, 'error', undefined, true);
    addFloatHistoryEntry({ source: '系统', type: 'error', message: emailMsg, recipients: recipients });
    console.error(`[Email] ❌ 邮件发送异常:`, error);
  }
}

// 🆕 查找邮件插件的 webview
function findEmailPluginWebview() {
  const panels = document.querySelectorAll('.workspace-panel');
  for (const panel of panels) {
    const webview = panel.querySelector('webview');
    if (webview && webview.src) {
      if (webview.src.includes('email') || webview.src.includes('plugins/email')) {
        console.log(`[Email] 📧 找到邮件插件 webview: ${webview.src}`);
        return webview;
      }
    }
  }
  return null;
}

// 🆕 通过邮件插件的 webview 调用 sendEmailByPlugin 函数（确保记录发送历史）
async function sendEmailViaPlugin(recipients, subject, body) {
  const recipientList = Array.isArray(recipients) ? recipients : recipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
  if (recipientList.length === 0) return { success: false, message: '收件人为空' };

  const emailWebview = findEmailPluginWebview();
  if (!emailWebview) {
    return { success: false, message: '未找到邮件插件，请先在某个页签中加载邮件插件' };
  }

  console.log(`[Email] 📧 通过 webview.executeJavaScript 调用 sendEmailByPlugin...`);

  try {
    // 使用 executeJavaScript 直接调用插件的全局函数（运行在主世界，可以访问 window.sendEmailByPlugin）
    const result = await emailWebview.executeJavaScript(`
      (async () => {
        try {
          const result = await window.sendEmailByPlugin(${JSON.stringify(recipientList)}, ${JSON.stringify(subject)}, ${JSON.stringify(body)});
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ success: false, message: err.message });
        }
      })()
    `);

    const parsed = JSON.parse(result);
    console.log(`[Email] 📧 邮件发送结果:`, parsed);
    return parsed;
  } catch (error) {
    console.error(`[Email] 📧 邮件发送异常:`, error);
    return { success: false, message: error.message };
  }
}

//  自定义弹窗替代 prompt（Electron 中 prompt 可能不工作）
function showEmailRecipientDialog(defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4); z-index: 999999;
      display: flex; align-items: center; justify-content: center;
    `;
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white; border-radius: 12px; padding: 24px;
      min-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;
    dialog.innerHTML = `
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 16px; color: #1e293b;">📧 发出邮件</div>
      <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">请输入收件人邮箱（多个用逗号分隔）：</div>
      <input type="text" id="_email_recipient_input" value="${defaultValue || ''}" placeholder="例如: user@example.com, user2@example.com"
        style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; outline: none;" />
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <button id="_email_cancel_btn" style="padding: 8px 20px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; cursor: pointer; font-size: 13px;">取消</button>
        <button id="_email_send_btn" style="padding: 8px 20px; border: none; border-radius: 8px; background: #667eea; color: white; cursor: pointer; font-size: 13px;">发送</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = document.getElementById('_email_recipient_input');
    input.focus();
    input.select();

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    document.getElementById('_email_cancel_btn').addEventListener('click', () => close(null));
    document.getElementById('_email_send_btn').addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
    });
  });
}

// ========== 统一邮件发送函数 ==========
// 将 Markdown/HTML 内容构建为邮件正文并发送，两条路径（浮动视窗 / 获取内容）共用

/**
 * 将 Markdown 文本转换为 HTML（支持表格、标题、列表、粗体）
 * 表格使用 table-layout: fixed，第 1 列 18%、第 2 列 12%、其余均分
 */
function markdownToHtml(md) {
  // 🆕 步骤0: 提取 LaTeX 公式（在转换前先保存数学公式）
  const mathBlocks = [];
  let preProcessed = md;

  // 提取 $$...$$ 显示模式公式
  preProcessed = preProcessed.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
    const idx = mathBlocks.length;
    mathBlocks.push({ formula: formula.trim(), display: true });
    return `%%MATHBLOCK_${idx}%%`;
  });

  // 提取 $...$ 行内公式（排除 $$）
  preProcessed = preProcessed.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (match, formula) => {
    const idx = mathBlocks.length;
    mathBlocks.push({ formula: formula.trim(), display: false });
    return `%%MATHBLOCK_${idx}%%`;
  });

  const lines = preProcessed.split('\n');
  let html = '';
  let inTable = false;
  let tableHeaderDone = false;

  // 处理 Markdown 内联格式：**粗体**（与 injectInlineStyles 保持一致）
  function processInline(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong style="background: linear-gradient(120deg, #fef3c7 0%, #fde68a 100%); color: #7c2d12; padding: 2px 6px; border-radius: 4px; font-weight: 700;">$1</strong>');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('|') && line.endsWith('|') && line.split('|').length > 2) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!inTable) {
        html += '<table style="border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 12px; table-layout: fixed;">';
        inTable = true;
        tableHeaderDone = false;
      }

      if (!tableHeaderDone) {
        const colCount = cells.length;
        const colWidths = [];
        if (colCount >= 2) {
          colWidths.push('18%');
          colWidths.push('12%');
          const remaining = 100 - 18 - 12;
          const eachWidth = (remaining / (colCount - 2)).toFixed(1) + '%';
          for (let j = 2; j < colCount; j++) colWidths.push(eachWidth);
        }
        html += '<colgroup>';
        colWidths.forEach(w => { html += `<col style="width: ${w};">`; });
        html += '</colgroup>';
        html += '<thead><tr>';
        cells.forEach(c => {
          html += `<th style="border: 1px solid #d1d5db; padding: 5px 6px; background: #f1f5f9; text-align: center; font-weight: 600; color: #1e293b; word-break: break-all;">${processInline(c)}</th>`;
        });
        html += '</tr></thead><tbody>';
        tableHeaderDone = true;
      } else {
        html += '<tr>';
        cells.forEach((c, ci) => {
          const align = ci === 0 ? 'left' : 'center';
          html += `<td style="border: 1px solid #d1d5db; padding: 5px 6px; color: #1e293b; text-align: ${align}; word-break: break-all;">${processInline(c)}</td>`;
        });
        html += '</tr>';
      }
    } else {
      if (inTable) { html += '</tbody></table>'; inTable = false; }
      if (line.startsWith('## ')) {
        html += `<h3 style="margin: 16px 0 8px 0; color: #2563eb; font-size: 15px;">${processInline(line.replace(/^##\s*/, ''))}</h3>`;
      } else if (line.startsWith('### ')) {
        html += `<h4 style="margin: 12px 0 6px 0; color: #3b82f6; font-size: 14px;">${processInline(line.replace(/^###\s*/, ''))}</h4>`;
      } else if (line.startsWith('#### ')) {
        html += `<h5 style="margin: 10px 0 5px 0; color: #2563eb; font-size: 13px; font-weight: 600;">${processInline(line.replace(/^####\s*/, ''))}</h5>`;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        html += `<p style="margin: 4px 0 4px 16px; color: #1e293b;">• ${processInline(line.replace(/^[-*]\s*/, ''))}</p>`;
      } else if (line === '') {
        html += '<br>';
      } else {
        html += `<p style="margin: 4px 0; color: #1e293b;">${processInline(line)}</p>`;
      }
    }
  }
  if (inTable) html += '</tbody></table>';

  // 🆕 步骤1: 重新渲染 KaTeX 公式
  if (mathBlocks.length > 0 && typeof katex !== 'undefined') {
    html = html.replace(/%%MATHBLOCK_(\d+)%%/g, (match, idx) => {
      const block = mathBlocks[parseInt(idx)];
      if (!block) return match;
      try {
        const rendered = katex.renderToString(block.formula, {
          displayMode: block.display,
          throwOnError: false,
          strict: false
        });
        // 🆕 添加内联样式包装，确保邮件客户端也能正确显示
        if (block.display) {
          return `<div style="text-align:center;margin:12px 0;padding:8px 0;background:#f8fafc;border-radius:6px;">${rendered}</div>`;
        } else {
          return `<span style="display:inline-block;vertical-align:middle;margin:0 2px;">${rendered}</span>`;
        }
      } catch (e) {
        console.warn('[Email] KaTeX 渲染失败:', block.formula, e.message);
        return `<code style="background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-family:monospace;">${block.formula}</code>`;
      }
    });
  } else if (mathBlocks.length > 0) {
    // KaTeX 未加载，显示原始公式
    html = html.replace(/%%MATHBLOCK_(\d+)%%/g, (match, idx) => {
      const block = mathBlocks[parseInt(idx)];
      return block ? `<code>${block.formula}</code>` : match;
    });
  }

  return html;
}

/**
 * 统一发送邮件：构建邮件正文 + 调用 sendEmailViaPlugin + 显示状态
 * @param {string|string[]} recipients - 收件人（字符串或数组）
 * @param {string} subject - 邮件主题
 * @param {string} sourceName - 来源名称（显示在邮件头部）
 * @param {string} queryText - 查询内容（显示在邮件头部，可选）
 * @param {string} contentHtml - 邮件正文 HTML 内容（已格式化）
 * @param {number} charCount - 字符数（用于状态提示）
 * @returns {Promise<object>} 发送结果
 */
async function sendUnifiedEmail(recipients, subject, sourceName, queryText, contentHtml, charCount) {
  const recipientList = Array.isArray(recipients) ? recipients : recipients.split(/[,，;]/).map(e => e.trim()).filter(e => e);
  if (recipientList.length === 0) return { success: false, message: '收件人为空' };

  const body = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; color: #1e293b; max-width: 800px;">
<div style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
<p style="margin: 4px 0;"><strong>【来源】</strong>${sourceName}</p>
${queryText ? `<p style="margin: 4px 0;"><strong>【查询】</strong>${queryText} &nbsp;&nbsp; <strong>【获取时间】</strong>${new Date().toLocaleString('zh-CN')}</p>` : `<p style="margin: 4px 0;"><strong>【获取时间】</strong>${new Date().toLocaleString('zh-CN')}</p>`}
</div>
${contentHtml}
</div>`;

  const result = await sendEmailViaPlugin(recipientList, subject, body);
  if (result.success) {
    const statusMsg = `📧 邮件已通过插件发送给 ${recipientList.join(', ')} (${charCount} 字符)`;
    showStatus(statusMsg, 'success', undefined, true);
    addFloatHistoryEntry({ source: '系统', type: 'success', message: statusMsg, recipients: recipientList.join(', ') });
  } else {
    const statusMsg = `📧 邮件发送失败：${result.message}`;
    showStatus(statusMsg, 'error', undefined, true);
    addFloatHistoryEntry({ source: '系统', type: 'error', message: statusMsg, recipients: recipientList.join(', ') });
  }
  return result;
}

// 挂载到 window
window.sendEmailAfterReply = sendEmailAfterReply;
window.findEmailPluginWebview = findEmailPluginWebview;
window.sendEmailViaPlugin = sendEmailViaPlugin;
window.markdownToHtml = markdownToHtml;
window.sendUnifiedEmail = sendUnifiedEmail;
window.showEmailRecipientDialog = showEmailRecipientDialog;
