// 构建外层脚本（在 renderer 进程执行）- v42 极简版
var outerScriptLines = [
  '(function() {',
  '  try {',
  "    console.log('[Inject-Outer] v42 极简版开始...');",
  '    var wv = document.getElementById("previewWebview");',
  '    if (!wv) return JSON.stringify({success:false, error:"找不到webview"});',
  '',
  "    return wv.executeJavaScript(' + JSON.stringify(innerScript) + ')",
  '      .then(function(r) {',
  "        console.log('[Inject-Outer] ✅ innerScript 执行完成:', r);",
  '        return r;',
  '      })',
  '      .catch(function(e) {',
  "        return JSON.stringify({success:false, error:'executeJavaScript错误:'+e.message});",
  '      });',
  '  } catch(e) {',
  "    return JSON.stringify({success:false, error:e.message});",
  '  }',
  '})()'
];

var outerScript = outerScriptLines.join('\n');
console.log('[Main] [API] 外层脚本长度:', outerScript.length);

const resultStr = await mainWindow.webContents.executeJavaScript(outerScript);
let result;
try { result = JSON.parse(resultStr); } catch(e) { result = { success: false, error: '解析失败' }; }

console.log('[Main] [API] injectMessageToWebview 注入结果:', JSON.stringify(result));

result.serviceCardIndex = serviceCardIndex;
console.log('[Main] [API] 📋 附加 serviceCardIndex 到结果:', serviceCardIndex);

if (!result.success) {
  return result;
}

// v42: 如果有附件，单独执行上传（顺序执行，不在 Promise 链中）
if (hasAttachment && attachment && attachment.data) {
  console.log('[Main] [API] 📎📎📎 v42: 检测到附件，开始单独的 Step 2...');
  console.log('[Main] [API] 附件:', attachment.name, '(' + attachment.size + ' bytes)');

  try {
    const attachUploadScript = `
      (function() {
        try {
          console.log("[Attach-v42] 创建 file input...");
          const fi = document.createElement("input");
          fi.type = "file";
          fi.style.cssText = "display:none;position:absolute;left:-9999px";
          document.body.appendChild(fi);
          console.log("[Attach-v42] ✅ File input 已创建");

          return new Promise(function(resolve) {
            setTimeout(function() {
              fi.click();
              console.log("[Attach-v42] ✅ File input 已点击");
              resolve("✅ 已触发 select-file");
            }, 1000);
          });
        } catch(e) {
          return "❌ " + e.message;
        }
      })()
    `;

    const attachResult = await mainWindow.webContents.executeJavaScript(`
      (function() {
        var wv = document.getElementById("previewWebview");
        if (!wv) return JSON.stringify({error:"no webview"});
        return wv.executeJavaScript(${JSON.stringify(attachUploadScript)})
          .then(function(r) { return r; })
          .catch(function(e) { return "❌ " + e.message; });
      })()
    `);

    console.log('[Main] [API] ✅ 附件脚本返回:', attachResult);
    console.log('[Main] [API] ⏳ 等待附件处理 (10秒)...');
    await new Promise(r => setTimeout(r, 10000));
    console.log('[Main] [API] ✅ 等待完成');
  } catch (attachErr) {
    console.error('[Main] [API] ⚠️ 附件失败:', attachErr.message);
  }
} else {
  console.log('[Main] [API] ℹ️ 无附件');
}
