#!/usr/bin/env python3
"""Fix the KaTeX rendering pipeline in workspace.js"""

with open('/Users/chincharles/myProgram/electron-crawler/src/modules/workspace.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find boundaries
start = content.find('// HTML 清理函数（与 ai-response-viewer.html 中的 cleanHtmlWhitespace 保持一致）')
end = content.find('// JSON 格式化函数', start)

if start == -1 or end == -1:
    print(f'ERROR: Could not find markers. start={start}, end={end}')
    exit(1)

new_code = r'''// HTML 清理函数（与 ai-response-viewer.html 中的 cleanHtmlWhitespace 保持一致）
//  返回 { html, mathBlocks }：html 含 %%KATEX_N%% 占位符，mathBlocks 供调用方在 injectInlineStyles 之后渲染
function cleanHtmlWhitespace(html) {
    // 🆕 步骤0: 提取 KaTeX 公式为占位符（在清理前先保存数学公式）
    const mathBlocks = [];
    let cleaned = html;

    // 提取 <span class="katex"> 中的 LaTeX 公式（从 annotation 中获取）
    cleaned = cleaned.replace(/<span class="katex[^"]*"[^>]*>[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>/gi,
        (match, latex) => {
            const idx = mathBlocks.length;
            mathBlocks.push({ formula: latex.trim(), display: false });
            return `%%KATEX_${idx}%%`;
        });

    // 提取 <math> 元素中的 LaTeX 公式（从 annotation 中获取）
    cleaned = cleaned.replace(/<math[^>]*>[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/math>/gi,
        (match, latex) => {
            const idx = mathBlocks.length;
            mathBlocks.push({ formula: latex.trim(), display: true });
            return `%%KATEX_${idx}%%`;
        });

    // 提取 $$...$$ 显示模式公式
    cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ formula: formula.trim(), display: true });
        return `%%KATEX_${idx}%%`;
    });

    // 提取 $...$ 行内公式（排除 $$）
    cleaned = cleaned.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push({ formula: formula.trim(), display: false });
        return `%%KATEX_${idx}%%`;
    });

    if (mathBlocks.length > 0) {
        console.log(`[Workspace] 🧮 提取到 ${mathBlocks.length} 个 KaTeX 公式`);
    }

    // 检测是否为"脏HTML"（包含大量Tailwind类名或框架特定标记）
    const isDirtyHtml = /(?:dark:text-|max-w-|flex flex-|border-\[|rounded-|bg-\[|text-\[|p-\[|m-\[)/.test(cleaned);

    if (isDirtyHtml) {
        // 移除所有 Tailwind 类名（但保留标签本身）
        cleaned = cleaned.replace(/\s*class="[^"]*(?:dark:text-|max-w-|flex flex-|border-\[|rounded-|bg-\[|text-\[|p-\[|m-\[)[^"]*"/gi, '');
        cleaned = cleaned.replace(/\s*class="[^"]*\b(?:text-|bg-|p-|m-|w-|h-|flex|grid|gap-|rounded|shadow|opacity|transform|transition|duration|ease|hover:|focus:|active:)[^"]*"/gi, '');

        // 移除非文本内容块（Tailwind专属）
        // 🆕 注意：不再移除 <math> 和 <span class="katex">，因为已在步骤0中提取为占位符
        const dirtyRemovePatterns = [
            /<svg[\s\S]*?<\/svg>/gi,
            /<canvas[^>]*><\/canvas>/gi,
            /<script[\s\S]*?<\/script>/gi,
            /<style[\s\S]*?<\/style>/gi,
            /<button[\s\S]*?<\/button>/gi,
            /<input[^>]*>/gi,
            /<i class="icon[\s\S]*?<\/i>/gi,
            /<animate[\s\S]*?<\/animate>/gi,
            /\s+d="[^"]*"/g,
            /data:image\/[^;]+;base64,[^"'\s]*/g,
            /(?:viewBox|d|path|points)="[^"]{50,}"/g
        ];
        dirtyRemovePatterns.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '');
        });
    }

    // 对所有 style 属性进行基础安全清理
    cleaned = cleaned.replace(/style="[^"]*"/gi, function(match) {
        let newStyle = match
            .replace(/text-align:\s*[^;]+;?/gi, '')
            .replace(/background(?:-color)?\s*:\s*[^;]+;?/gi, '')
            .replace(/padding(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/margin(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/display:\s*(?:block|flex|inline-flex|grid|inline-block|table|inline-table)[^;]*;?/gi, '')
            .replace(/border(?:-top|-bottom|-left|-right)?\s*:\s*[^;]+;?/gi, '')
            .replace(/border-radius:\s*[^;]+;?/gi, '')
            .replace(/box-shadow:\s*[^;]+;?/gi, '')
            .replace(/(?:min-|max-)?width:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%)|auto)[^;]*;?/gi, '')
            .replace(/(?:min-|max-)?height:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%)|auto)[^;]*;?/gi, '')
            .replace(/position:\s*(?:absolute|relative|fixed|sticky)[^;]*;?/gi, '')
            .replace(/(?:top|bottom|left|right):\s*[^;]+;?/gi, '')
            .replace(/z-index:\s*[^;]+;?/gi, '')
            .replace(/float:\s*[^;]+;?/gi, '')
            .replace(/clear:\s*[^;]+;?/gi, '')
            .replace(/overflow(?:-x|-y)?:\s*[^;]+;?/gi, '')
            .replace(/opacity:\s*[^;]+;?/gi, '')
            .replace(/transform:\s*[^;]+;?/gi, '')
            .replace(/var\(--[^)]+\)/gi, '')
            .replace(/rgba?\([^)]+\)/gi, '');
        newStyle = newStyle.replace(/;\s*;/g, ';').replace(/^style="\s*;\s*/, 'style="').replace(/\s*;\s*"$/, '"');
        if (/^style="\s*"?$/.test(newStyle)) return '';
        return newStyle;
    });

    // 移除非文本内容块（标准清理）
    // 🆕 注意：不再移除 <math> 和 <span class="katex">，因为已在步骤0中提取为占位符
    const standardRemovePatterns = [
        /<svg[\s\S]*?<\/svg>/gi,
        /<canvas[^>]*><\/canvas>/gi,
        /<script[\s\S]*?<\/script>/gi,
        /<style[\s\S]*?<\/style>/gi,
        /<button[\s\S]*?<\/button>/gi,
        /<input[^>]*>/gi,
        /<i class="icon[\s\S]*?<\/i>/gi,
        /<animate[\s\S]*?<\/animate>/gi,
        /\s+d="[^"]*"/g,
        /data:image\/[^;]+;base64,[^"'\s]*/g,
        /(?:viewBox|d|path|points)="[^"]{50,}"/g
    ];
    standardRemovePatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // 移除标签间的多余空白
    cleaned = cleaned
        .replace(/>\s+</g, '><')
        .replace(/\n\s*\n/g, '\n')
        .replace(/^\s+|\s+$/g, '');

    // 🆕 返回 { html, mathBlocks }，由调用方在 injectInlineStyles 之后调用 renderKaTeXPlaceholders
    return { html: cleaned, mathBlocks };
}

/**
 * 🔄 用 KaTeX 重新渲染占位符公式
 * ⚠️ 必须在 injectInlineStyles 之后调用，避免样式污染 KaTeX 内部标签
 */
function renderKaTeXPlaceholders(html, mathBlocks) {
    if (!mathBlocks || mathBlocks.length === 0) return html;

    if (typeof katex !== 'undefined') {
        return html.replace(/%%KATEX_(\d+)%%/g, (match, idx) => {
            const block = mathBlocks[parseInt(idx)];
            if (!block) return match;
            try {
                return katex.renderToString(block.formula, {
                    displayMode: block.display,
                    throwOnError: false,
                    strict: false
                });
            } catch (e) {
                console.warn('[Workspace] KaTeX 渲染失败:', block.formula, e.message);
                return `<code style="background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-family:monospace;">${block.formula}</code>`;
            }
        });
    } else {
        // KaTeX 未加载，显示原始公式
        return html.replace(/%%KATEX_(\d+)%%/g, (match, idx) => {
            const block = mathBlocks[parseInt(idx)];
            return block ? `<code>${block.formula}</code>` : match;
        });
    }
}

'''

content = content[:start] + new_code + content[end:]

with open('/Users/chincharles/myProgram/electron-crawler/src/modules/workspace.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('workspace.js updated successfully')
