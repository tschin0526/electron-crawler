/**
 * HTTP Get 调用执行模组
 * 用于执行 HTTP GET 请求，解析返回数据，并通过插件页面在工作区 webview 中显示
 * 依赖：showStatus, bookmarks, workspaces, findOrCreateWorkspaceForAI, loadWorkspaceWebview
 */

// ========== 股票配置缓存与智能识别 ==========
let stockConfigCache = null;
let stockConfigLoading = null;

// 加载股票配置（带缓存）
async function loadStockConfig() {
  if (stockConfigCache) return stockConfigCache;
  if (stockConfigLoading) return stockConfigLoading;

  stockConfigLoading = (async () => {
    try {
      if (!window.electronAPI || !window.electronAPI.readStockConfig) {
        console.warn('[HTTP-Get] readStockConfig API 不可用');
        stockConfigCache = { stocks: [] };
        return stockConfigCache;
      }
      const result = await window.electronAPI.readStockConfig();
      if (result.success && result.data && result.data.stocks) {
        stockConfigCache = result.data;
        console.log(`[HTTP-Get] 股票配置已加载: ${stockConfigCache.stocks.length} 只股票`);
      } else {
        stockConfigCache = { stocks: [] };
        console.warn('[HTTP-Get] 股票配置为空');
      }
      return stockConfigCache;
    } catch (err) {
      console.error('[HTTP-Get] 加载股票配置失败:', err);
      stockConfigCache = { stocks: [] };
      return stockConfigCache;
    } finally {
      stockConfigLoading = null;
    }
  })();

  return stockConfigLoading;
}

// 智能识别用户输入，将其转换为 sina_code 列表
// 支持的输入格式：
//   1. sina_code 直接格式：sh601166, sz002969, tw2891
//   2. 纯数字代码：601166, 002969, 2891（根据配置查找前缀）
//   3. 股票名称：兴业银行, 嘉美包装, 中信金
//   4. 混合输入（用逗号、空格、中文逗号分隔）：兴业银行,sh601166,中矿
async function resolveStockCodes(userInput) {
  if (!userInput || !userInput.trim()) return '';

  const config = await loadStockConfig();
  const stocks = config.stocks || [];

  // 建立查找索引：name -> sina_code, code -> sina_code
  const nameToSina = new Map();
  const codeToSina = new Map();
  for (const s of stocks) {
    if (s.name && s.sina_code) nameToSina.set(s.name, s.sina_code);
    if (s.code && s.sina_code) codeToSina.set(s.code, s.sina_code);
  }

  // 分隔输入：支持英文逗号、中文逗号、空格、换行
  const parts = userInput.split(/[,，\s\n]+/).map(p => p.trim()).filter(p => p);

  const resolved = [];
  const unresolved = [];

  for (const part of parts) {
    // 1. 已经是 sina_code 格式（sh/sz/tw + 数字）
    if (/^(sh|sz|tw)\d+$/i.test(part)) {
      resolved.push(part.toLowerCase());
      continue;
    }

    // 2. 纯数字代码 -> 查找配置
    if (/^\d+$/.test(part)) {
      const sina = codeToSina.get(part);
      if (sina) {
        resolved.push(sina);
        continue;
      }
    }

    // 3. 名称精确匹配
    if (nameToSina.has(part)) {
      resolved.push(nameToSina.get(part));
      continue;
    }

    // 4. 名称包含匹配（宽松匹配，如输入"兴业"匹配"兴业银行"）
    let matched = false;
    for (const [name, sina] of nameToSina) {
      if (name.includes(part) || part.includes(name)) {
        resolved.push(sina);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 5. 无法识别，原样保留（让 API 自己处理，可能是用户输入了配置外的代号）
    unresolved.push(part);
    resolved.push(part);
  }

  // 去重
  const unique = [...new Set(resolved)];

  console.log(`[HTTP-Get] 智能识别输入: "${userInput}"`);
  console.log(`[HTTP-Get] 分隔结果:`, parts);
  console.log(`[HTTP-Get] 解析结果:`, unique);
  if (unresolved.length > 0) {
    console.warn(`[HTTP-Get] ⚠️ 无法识别的输入（原样保留）:`, unresolved);
  }

  return unique.join(',');
}

// 解析新浪股票数据（var hq_str_sh601088="名称,今开,昨收,当前价,最高,最低,..." 格式）
function parseSinaStockData(rawText) {
  const lines = rawText.trim().split('\n').filter(l => l.trim());
  const stocks = [];

  for (const line of lines) {
    const match = line.match(/var\s+hq_str_(\w+)="([^"]+)"/);
    if (!match) continue;

    const fullCode = match[1];
    const dataStr = match[2];
    if (!dataStr.trim()) continue; // 空数据（如 var hq_str_sz0002738=""）
    const fields = dataStr.split(',');

    if (fields.length < 32) continue;

    const currentPrice = parseFloat(fields[3]) || 0;
    const prevClose = parseFloat(fields[2]) || 0;
    const change = currentPrice - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose * 100) : 0;

    // 保留原始字符串值，避免 toFixed 丢失精度
    stocks.push({
      code: fullCode,
      name: fields[0] || '',
      currentPrice: currentPrice,
      prevClose: prevClose,
      open: parseFloat(fields[1]) || 0,
      volume: parseInt(fields[8]) || 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      change: change,
      changePercent: changePercent,
      turnoverRate: 0,
      peRatio: 0,
      totalMarketValue: 0,
      circulatingMarketValue: 0,
      pbRatio: 0,
      limitUp: 0,
      limitDown: 0,
      amplitude: 0,
      time: (fields[30] || '') + ' ' + (fields[31] || ''),
      // 原始字符串值（保留原始小数位数）
      _raw: {
        currentPrice: fields[3],
        prevClose: fields[2],
        open: fields[1],
        high: fields[4],
        low: fields[5]
      }
    });
  }

  return stocks;
}

// 解析腾讯股票数据
function parseTencentStockData(rawText) {
  const lines = rawText.trim().split('\n').filter(l => l.trim());
  const stocks = [];

  for (const line of lines) {
    const match = line.match(/v_(\w+)="([^"]+)"/);
    if (!match) continue;

    const fullCode = match[1];
    const dataStr = match[2];
    const fields = dataStr.split('~');

    if (fields.length < 10) continue;

    stocks.push({
      code: fullCode,
      name: fields[1] || '',
      currentPrice: parseFloat(fields[3]) || 0,
      prevClose: parseFloat(fields[4]) || 0,
      open: parseFloat(fields[5]) || 0,
      volume: parseInt(fields[6]) || 0,
      high: parseFloat(fields[33]) || parseFloat(fields[41]) || 0,
      low: parseFloat(fields[34]) || parseFloat(fields[42]) || 0,
      change: parseFloat(fields[31]) || 0,
      changePercent: parseFloat(fields[32]) || 0,
      turnoverRate: parseFloat(fields[38]) || 0,
      peRatio: parseFloat(fields[39]) || 0,
      totalMarketValue: parseFloat(fields[44]) || parseFloat(fields[45]) || 0,
      circulatingMarketValue: parseFloat(fields[43]) || parseFloat(fields[44]) || 0,
      pbRatio: parseFloat(fields[46]) || 0,
      limitUp: parseFloat(fields[47]) || 0,
      limitDown: parseFloat(fields[48]) || 0,
      amplitude: parseFloat(fields[43]) || 0,
      time: fields[30] || '',
      _raw: {
        currentPrice: fields[3],
        prevClose: fields[4],
        open: fields[5],
        high: fields[33] || fields[41],
        low: fields[34] || fields[42]
      }
    });
  }

  return stocks;
}

// 解析 TWSE（台湾证券交易所）股票数据（JSON 格式）
function parseTwseStockData(rawText) {
  try {
    const jsonData = JSON.parse(rawText);
    if (!jsonData.msgArray || !Array.isArray(jsonData.msgArray)) return [];

    const stocks = [];
    for (const item of jsonData.msgArray) {
      // TWSE 字段说明（根据官方 API 文档）：
      // @: 股票完整代号, c: 股票代码(纯数字), n: 股票简称, nf: 公司全名
      // z: 最新成交价, y: 昨日收盘价, h: 今日最高价, l: 今日最低价
      // u: 涨停价, w: 跌停价, v: 成交量(张)
      // a: 卖五档价格(下划线分隔), b: 买五档价格(下划线分隔)
      // o: 开盘价, %: 最新成交时间
      // tv/ps/pz/bp: 旧版残留字段，一般为"-"或"0"

      const currentPrice = parseFloat(item.z) || (item.a ? parseFloat(item.a.split('_')[0]) : 0);
      const prevClose = parseFloat(item.y) || 0;
      const change = currentPrice - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose * 100) : 0;

      // 解析五档买卖价格
      const askPrices = (item.a || '').split('_').filter(v => v).map(v => parseFloat(v) || 0);
      const bidPrices = (item.b || '').split('_').filter(v => v).map(v => parseFloat(v) || 0);

      stocks.push({
        code: item['@'] || item.ch || '',
        name: item.n || item.nf || item.c || '',
        currentPrice: currentPrice,
        prevClose: prevClose,
        open: parseFloat(item.o) || 0,
        volume: parseInt(item.v) || 0,
        high: parseFloat(item.h) || currentPrice,
        low: parseFloat(item.l) || currentPrice,
        change: change,
        changePercent: changePercent,
        turnoverRate: 0,
        peRatio: 0,
        totalMarketValue: 0,
        circulatingMarketValue: 0,
        pbRatio: 0,
        limitUp: parseFloat(item.u) || 0,
        limitDown: parseFloat(item.w) || 0,
        amplitude: 0,
        time: item['%'] || item.t || '',
        askPrices: askPrices,
        bidPrices: bidPrices
      });
    }
    return stocks;
  } catch (e) {
    console.error('[HTTP-Get] TWSE JSON 解析失败:', e);
    return [];
  }
}

// 将股票数据转换为 Markdown
function stocksToMarkdown(stocks, userPrices) {
  if (stocks.length === 0) return '无数据';

  // 辅助函数：优先使用原始字符串值，保留原始小数位数
  function fmt(val, rawVal) {
    if (rawVal !== undefined && rawVal !== '' && rawVal !== '-') return rawVal;
    return val.toFixed(2);
  }

  // 判断是否有用户输入的价格
  const hasUserPrices = userPrices && Object.keys(userPrices).length > 0;

  let md = '## 📊 股票行情\n\n';
  if (hasUserPrices) {
    md += '| 名称 | 代码 | 当前价 | 涨跌 | 涨跌幅% | 今开 | 最高 | 最低 | 昨收 | 成交量(手) | 最近交易价 | 价差 | 价差% |\n';
    md += '|------|------|--------|------|---------|------|------|------|------|------------|------------|------|-------|\n';
  } else {
    md += '| 名称 | 代码 | 当前价 | 涨跌 | 涨跌幅% | 今开 | 最高 | 最低 | 昨收 | 成交量(手) |\n';
    md += '|------|------|--------|------|---------|------|------|------|------|------------|\n';
  }

  for (const s of stocks) {
    const sign = s.change >= 0 ? '+' : '';
    const r = s._raw || {};
    let row = `| ${s.name} | ${s.code} | ${fmt(s.currentPrice, r.currentPrice)} | ${sign}${s.change.toFixed(2)} | ${sign}${s.changePercent.toFixed(2)}% | ${fmt(s.open, r.open)} | ${fmt(s.high, r.high)} | ${fmt(s.low, r.low)} | ${fmt(s.prevClose, r.prevClose)} | ${s.volume.toLocaleString()} |`;

    if (hasUserPrices) {
      // 查找匹配的用户价格（通过代码、名称、包含关系匹配）
      let userPrice = null;
      for (const [key, val] of Object.entries(userPrices)) {
        const keyLower = key.toLowerCase();
        const codeLower = s.code.toLowerCase();
        const nameLower = s.name.toLowerCase();
        const valNameLower = val.name.toLowerCase();
        // 精确匹配代码或名称
        if (keyLower === codeLower || valNameLower === nameLower) {
          userPrice = val;
          break;
        }
        // 包含匹配：用户输入的名称包含股票名称，或股票名称包含用户输入
        if (nameLower.includes(keyLower) || keyLower.includes(nameLower) || valNameLower.includes(nameLower) || nameLower.includes(valNameLower)) {
          userPrice = val;
          break;
        }
      }

      if (userPrice) {
        const diff = s.currentPrice - userPrice.price;
        const diffPercent = userPrice.price > 0 ? (diff / userPrice.price * 100) : 0;
        const diffSign = diff >= 0 ? '+' : '';
        const actionLabel = userPrice.isSell ? '卖出' : '买入';
        row += ` ${userPrice.price.toFixed(2)}(${actionLabel}) | ${diffSign}${diff.toFixed(2)} | ${diffSign}${diffPercent.toFixed(2)}% |`;
      } else {
        row += ` - | - | - |`;
      }
    }

    md += row + '\n';
  }

  md += '\n---\n\n';
  md += '### 📈 详细数据\n\n';

  for (const s of stocks) {
    const r = s._raw || {};
    md += `#### ${s.name} (${s.code})\n\n`;
    md += `- **当前价格**: ${fmt(s.currentPrice, r.currentPrice)}\n`;
    md += `- **涨跌**: ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)} (${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%)\n`;
    md += `- **今开**: ${fmt(s.open, r.open)} | **最高**: ${fmt(s.high, r.high)} | **最低**: ${fmt(s.low, r.low)}\n`;
    md += `- **昨收**: ${fmt(s.prevClose, r.prevClose)}\n`;
    md += `- **成交量**: ${s.volume.toLocaleString()} 手\n`;
    md += `- **换手率**: ${s.turnoverRate.toFixed(2)}%\n`;
    md += `- **市盈率**: ${s.peRatio.toFixed(2)} | **市净率**: ${s.pbRatio.toFixed(2)}\n`;
    md += `- **总市值**: ${(s.totalMarketValue / 10000).toFixed(2)} 亿\n`;
    md += `- **流通市值**: ${(s.circulatingMarketValue / 10000).toFixed(2)} 亿\n`;
    md += `- **涨停价**: ${s.limitUp.toFixed(2)} | **跌停价**: ${s.limitDown.toFixed(2)}\n`;
    md += `- **更新时间**: ${s.time}\n\n`;
  }

  return md;
}

// HTTP Get 执行函数（stockCodes 为可选参数，由调用者传入用户输入的股票代号或名称）
async function executeHttpGet(index, stockCodes) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;

  showStatus(`⏳ 正在执行 HTTP GET: ${bookmark.name}`, 'info');

  try {
    // 构建请求 URL：优先使用传入的股票代号，否则从 bookmark.url 中提取
    let requestUrl = bookmark.url;
    console.log(`[HTTP-Get] 原始 bookmark.url: ${bookmark.url}`);
    console.log(`[HTTP-Get] 用户输入: "${stockCodes}"`);

    if (stockCodes && stockCodes.trim()) {
      // 智能识别：将用户输入（可能是名称、纯数字代码、或 sina_code）转换为 sina_code 列表
      const resolvedCodes = await resolveStockCodes(stockCodes.trim());
      console.log(`[HTTP-Get] 智能识别后的 sina_code: "${resolvedCodes}"`);

      if (resolvedCodes) {
        // 查找 q= 或 list= 或 ex_ch= 参数，支持 ?q=, &q=, /q=, ?list=, &list=, ?ex_ch=, &ex_ch= 等格式
        // 腾讯财经 URL 格式: https://qt.gtimg.cn/q=sh600519 (没有 ? 号)
        // 新浪财经 URL 格式: http://hq.sinajs.cn/list=sh601088,sh601166
        // TWSE URL 格式: https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw
        const qMatch = bookmark.url.match(/([?&/](?:q|list|ex_ch)=)/);
        console.log(`[HTTP-Get] 参数匹配结果:`, qMatch ? qMatch[0] : '未匹配');

        if (qMatch) {
          const baseUrl = bookmark.url.substring(0, qMatch.index + qMatch[1].length);
          let codesForUrl = resolvedCodes;

          // TWSE 特殊处理：将 tw2330,tw2317 转换为 tse_2330.tw|tse_2317.tw
          if (qMatch[1].includes('ex_ch')) {
            const twseCodes = resolvedCodes.split(',').map(code => {
              const m = code.match(/^tw(\d+)$/i);
              return m ? `tse_${m[1]}.tw` : code;
            });
            codesForUrl = twseCodes.join('|');
            console.log(`[HTTP-Get] TWSE 格式转换: ${resolvedCodes} -> ${codesForUrl}`);
          }

          requestUrl = baseUrl + codesForUrl;
          console.log(`[HTTP-Get] 提取的基础 URL: ${baseUrl}`);
        } else {
          // 如果没有 q= 或 list= 或 ex_ch= 参数，直接拼接
          requestUrl = bookmark.url + resolvedCodes;
          console.log(`[HTTP-Get] 无 q=/list=/ex_ch= 参数，直接拼接`);
        }
      }
    } else {
      // 没有传入股票代号，尝试从 bookmark.url 中提取（兼容旧配置）
      const qMatch = bookmark.url.match(/([?&/](?:q|list|ex_ch)=)/);
      if (qMatch) {
        const baseUrl = bookmark.url.substring(0, qMatch.index + qMatch[1].length);
        const codes = bookmark.url.substring(qMatch.index + qMatch[1].length);
        if (codes.trim()) {
          requestUrl = baseUrl + codes.trim();
          console.log(`[HTTP-Get] 使用默认股票代号: ${codes.trim()}`);
        }
      }
    }

    console.log(`[HTTP-Get] ✅ 最终请求 URL: ${requestUrl}`);

    const headers = {};
    if (bookmark.referer) headers['Referer'] = bookmark.referer;
    if (bookmark.userAgent) headers['User-Agent'] = bookmark.userAgent;

    const result = await window.electronAPI.apiCall({
      url: requestUrl,
      method: 'GET',
      headers: headers
    });

    if (!result.success) {
      showStatus(`❌ HTTP GET 失败: ${result.error}`, 'error');
      return;
    }

    const rawData = result.data;
    console.log(`[HTTP-Get] 原始数据长度: ${rawData.length} 字符`);
    console.log(`[HTTP-Get] 原始数据前 200 字符: ${rawData.substring(0, 200)}...`);

    // 解析数据
    let markdownContent = '';
    let parsedData = null;

    // 收集用户输入的股票价格（用于价差比较）
    const userPrices = collectStockPrices(index);
    console.log(`[HTTP-Get] 用户输入的价格:`, userPrices);

    if (rawData.includes('v_') && rawData.includes('~')) {
      parsedData = parseTencentStockData(rawData);
      markdownContent = stocksToMarkdown(parsedData, userPrices);
      console.log(`[HTTP-Get] ✅ 解析到 ${parsedData.length} 只股票（腾讯格式）`);
      parsedData.forEach(s => console.log(`  - ${s.name} (${s.code})`));
    } else if (/var\s+hq_str_\w+=/.test(rawData)) {
      parsedData = parseSinaStockData(rawData);
      markdownContent = stocksToMarkdown(parsedData, userPrices);
      console.log(`[HTTP-Get] ✅ 解析到 ${parsedData.length} 只股票（新浪格式）`);
      parsedData.forEach(s => console.log(`  - ${s.name} (${s.code})`));
    } else if (rawData.includes('msgArray')) {
      parsedData = parseTwseStockData(rawData);
      markdownContent = stocksToMarkdown(parsedData, userPrices);
      console.log(`[HTTP-Get] ✅ 解析到 ${parsedData.length} 只股票（TWSE 格式）`);
      parsedData.forEach(s => console.log(`  - ${s.name} (${s.code})`));
    } else {
      try {
        const jsonData = JSON.parse(rawData);
        markdownContent = '```json\n' + JSON.stringify(jsonData, null, 2) + '\n```';
      } catch (e) {
        markdownContent = '```\n' + rawData + '\n```';
      }
    }

    // 保存数据到插件存储
    const pluginData = {
      rawData: rawData,
      markdownContent: markdownContent,
      timestamp: new Date().toISOString()
    };

    // 读取现有数据并追加
    let existingData = [];
    try {
      const loadResult = await window.electronAPI.loadPluginData('http-get');
      if (loadResult.success && loadResult.data) {
        existingData = loadResult.data;
      }
    } catch (e) {
      console.log('[HTTP-Get] 无现有数据');
    }

    existingData.push(pluginData);
    // 只保留最近 10 条记录
    if (existingData.length > 10) {
      existingData = existingData.slice(-10);
    }

    await window.electronAPI.savePluginData('http-get', existingData);
    console.log('[HTTP-Get] ✅ 数据已保存到插件存储（共 ' + existingData.length + ' 条记录）');

    // 查找或创建工作区，加载插件页面
    await showHttpGetInWorkspace(index);

    showStatus(`✅ HTTP GET 成功: ${bookmark.name}`, 'success');

    // 记录到历史页签
    if (typeof addFloatHistoryEntry === 'function') {
      addFloatHistoryEntry({
        type: 'success',
        source: bookmark.name,
        cardName: bookmark.name,
        message: stockCodes || bookmark.presetMessage || ''
      });
    }

    return { success: true, markdownContent, rawData };
  } catch (error) {
    console.error('[HTTP-Get] 执行异常:', error);
    showStatus(` HTTP GET 异常: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// 在工作区中显示 HTTP Get 结果（完全复用 ToDoList 的 crawlBookmarkByIndex 流程）
async function showHttpGetInWorkspace(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;

  //  清除之前该 HTTP Get 占用的工作区（防止 findOrCreateWorkspaceForAI 找到旧的工作区）
  const sortedWorkspaces = getSortedWorkspaceIds();
  for (const wsId of sortedWorkspaces) {
    const ws = workspaces[wsId];
    if (ws && ws.bookmarkIndex === index) {
      console.log(`[HTTP-Get] 清除工作区 ${wsId} 的旧配置（原 bookmarkIndex=${index}）`);
      ws.bookmarkIndex = null;
      ws.title = '';
      ws.wsUrl = '';
      ws.status = 'idle';
      // 清除 webview 加载标记
      if (typeof loadedWebviewWorkspaces !== 'undefined') {
        loadedWebviewWorkspaces.delete(wsId);
      }
      // 更新页签名称
      updateWorkspaceTabName(wsId, '');
    }
  }

  //  寻找空闲工作区（bookmarkIndex 为 null 且 status 为 idle）
  let targetWsId = null;
  for (const wsId of sortedWorkspaces) {
    const ws = workspaces[wsId];
    if (ws && ws.status === 'idle' && (ws.bookmarkIndex === null || ws.bookmarkIndex === undefined)) {
      targetWsId = wsId;
      break;
    }
  }

  //  如果没有完全空闲的工作区，找任何 idle 的工作区
  if (!targetWsId) {
    for (const wsId of sortedWorkspaces) {
      if (workspaces[wsId].status === 'idle') {
        targetWsId = wsId;
        break;
      }
    }
  }

  console.log(`[HTTP-Get] 目标空闲工作区: ${targetWsId}, 当前工作区: ${currentWorkspaceId}`);

  //  切换到空闲工作区（让 crawlBookmarkByIndex 在空闲工作区上操作）
  if (targetWsId && targetWsId !== currentWorkspaceId) {
    switchWorkspaceWithoutRestore(targetWsId);
    console.log(`[HTTP-Get] 已切换到空闲工作区: ${targetWsId}`);
  }

  //  确保目标工作区的 webview 加载标记被清除（强制重新加载，解决"已有内容时不更新"的问题）
  const finalWsId = targetWsId || currentWorkspaceId;
  if (typeof loadedWebviewWorkspaces !== 'undefined') {
    loadedWebviewWorkspaces.delete(finalWsId);
    console.log(`[HTTP-Get] 已清除工作区 ${finalWsId} 的 webview 加载标记`);
  }

  // 插件页面路径（与 ToDoList/Email 插件一致）
  // 添加时间戳参数强制刷新，避免 webview 缓存旧页面
  const pluginPath = 'file:///Users/chincharles/myProgram/electron-crawler/src/plugins/http-get/index.html?t=' + Date.now();

  // 临时交换 bookmark.url 和 previewOnly，让 crawlBookmarkByIndex 走 previewOnly 流程
  const originalUrl = bookmark.url;
  const originalPreviewOnly = bookmark.previewOnly;
  bookmark.url = pluginPath;
  bookmark.previewOnly = true;

  console.log(`[HTTP-Get] 临时设置 bookmark.url = ${pluginPath}, previewOnly = true`);

  try {
    // 完全复用 ToDoList 的加载流程
    await crawlBookmarkByIndex(index);
    console.log('[HTTP-Get] crawlBookmarkByIndex 完成');
  } finally {
    // 恢复原始 bookmark 配置
    bookmark.url = originalUrl;
    bookmark.previewOnly = originalPreviewOnly;
    console.log('[HTTP-Get] 已恢复原始 bookmark 配置');
  }
}

// ========== 股票价格输入表格 ==========

// HTTP Get 卡片输入框 oninput 事件：解析股票列表并生成价格输入表格
async function onHttpGetInput(index) {
  const textarea = document.getElementById(`presetMsg_${index}`);
  const tableDiv = document.getElementById(`stockPriceTable_${index}`);
  const tbody = document.getElementById(`stockPriceBody_${index}`);
  if (!textarea || !tableDiv || !tbody) return;

  const input = textarea.value.trim();
  if (!input) {
    tableDiv.style.display = 'none';
    return;
  }

  const parts = input.split(/[,，\s\n]+/).map(p => p.trim()).filter(p => p);
  if (parts.length === 0) {
    tableDiv.style.display = 'none';
    return;
  }

  const config = await loadStockConfig();
  const stocks = config.stocks || [];

  const nameToInfo = new Map();
  const codeToInfo = new Map();
  for (const s of stocks) {
    if (s.name) nameToInfo.set(s.name, s);
    if (s.code) codeToInfo.set(s.code, s);
  }

  const resolvedStocks = [];
  for (const part of parts) {
    if (/^(sh|sz|tw)\d+$/i.test(part)) {
      const sinaLower = part.toLowerCase();
      const found = stocks.find(s => s.sina_code === sinaLower);
      resolvedStocks.push({ key: part, name: found ? found.name : part });
      continue;
    }
    if (/^\d+$/.test(part)) {
      const found = codeToInfo.get(part);
      if (found) {
        resolvedStocks.push({ key: part, name: found.name || part });
        continue;
      }
    }
    if (nameToInfo.has(part)) {
      const found = nameToInfo.get(part);
      resolvedStocks.push({ key: part, name: found.name || part });
      continue;
    }
    let matched = false;
    for (const [name, s] of nameToInfo) {
      if (name.includes(part) || part.includes(name)) {
        resolvedStocks.push({ key: part, name: s.name || part });
        matched = true;
        break;
      }
    }
    if (matched) continue;
    resolvedStocks.push({ key: part, name: part });
  }

  const seen = new Set();
  const uniqueStocks = resolvedStocks.filter(s => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });

  if (uniqueStocks.length === 0) {
    tableDiv.style.display = 'none';
    return;
  }

  let html = '';
  for (const s of uniqueStocks) {
    html += `<tr>
      <td style="border: 1px solid #e2e8f0; padding: 4px 6px; white-space: nowrap;">${s.name}</td>
      <td style="border: 1px solid #e2e8f0; padding: 4px 6px;">
        <input type="text" class="stock-price-input" data-stock="${s.key}" data-name="${s.name}"
          placeholder="输入价格（-号=卖出）"
          style="width: 100%; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 3px; font-size: 12px; outline: none;"
          onfocus="this.style.borderColor='#667eea'"
          onblur="this.style.borderColor='#cbd5e1'" />
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;
  tableDiv.style.display = 'block';
}

// 收集 HTTP Get 卡片中用户输入的股票价格
function collectStockPrices(index) {
  const tbody = document.getElementById(`stockPriceBody_${index}`);
  if (!tbody) return {};
  const prices = {};
  const inputs = tbody.querySelectorAll('.stock-price-input');
  for (const input of inputs) {
    const stock = input.getAttribute('data-stock');
    const name = input.getAttribute('data-name');
    const val = input.value.trim();
    if (val) {
      const isSell = val.startsWith('-');
      const price = parseFloat(val.replace(/^-/, ''));
      if (!isNaN(price)) {
        prices[stock] = { name, price, isSell };
      }
    }
  }
  return prices;
}

// ========== 历史讯息下拉选单 ==========

function stripCardPrefix(message, cardName) {
  if (!message || !cardName) return message;
  const trimmed = message.trim();
  const patterns = [
    new RegExp(`^["\u201c]${escapeRegex(cardName)}["\u201d]\\s*`),
    new RegExp(`^${escapeRegex(cardName)}\\s+`)
  ];
  for (const pattern of patterns) {
    const result = trimmed.replace(pattern, '');
    if (result !== trimmed) return result;
  }
  return trimmed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 显示卡片历史讯息下拉选单（从 textarea 的 data 属性读取卡片信息，所有卡片类型通用）
function showCardMsgDropdown(textarea, index) {
  const cardName = textarea.getAttribute('data-card-name') || '';

  const dropdown = document.getElementById(`cardMsgDropdown_${index}`);
  if (!dropdown) return;

  closeAllCardMsgDropdowns();

  const history = window.floatHistory || [];

  const entries = history
    .filter(entry => {
      const msg = (entry.message || '').trim();
      if (!msg) return false;
      if (entry.cardName === cardName) return true;
      if (entry.source === cardName) return true;
      if (msg.startsWith(`"${cardName}"`) || msg.startsWith(`\u201c${cardName}\u201d`) || msg.startsWith(`${cardName} `)) return true;
      return false;
    })
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const uniqueMap = new Map();
  for (const entry of entries) {
    const cleaned = stripCardPrefix(entry.message, cardName);
    const key = cleaned.trim();
    if (!key) continue;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { ...entry, _cleanedMessage: cleaned });
    }
  }
  const uniqueEntries = Array.from(uniqueMap.values());

  if (uniqueEntries.length === 0) {
    dropdown.innerHTML = '<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">暂无历史记录</div>';
  } else {
    dropdown.innerHTML = uniqueEntries.map((entry, idx) => `
      <div class="card-dropdown-item" data-index="${idx}"
        onmousedown="event.stopPropagation(); event.preventDefault(); selectCardMsg(${index}, ${idx});"
        style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.15s;"
        onmouseover="this.style.background='#f0f9ff'"
        onmouseout="this.style.background='transparent'">
        <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">${escapeHtml(entry.time || '')}</div>
        <div style="font-size: 13px; color: #1e293b;">${escapeHtml(entry._cleanedMessage)}</div>
        ${entry.recipients ? `<div style="font-size: 10px; color: #64748b; margin-top: 2px;"> ${escapeHtml(entry.recipients)}</div>` : ''}
      </div>
    `).join('');
  }

  // 关键修复：将下拉选单移到 body 下，避免受父容器 CSS 影响
  if (dropdown.parentNode !== document.body) {
    document.body.appendChild(dropdown);
  }

  // 使用 setTimeout 确保 DOM 完全更新后再定位（比 requestAnimationFrame 更可靠）
  setTimeout(() => {
    const rect = textarea.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = rect.width + 'px';
    dropdown.style.display = 'block';
  }, 50);

  // 立即注册外部点击关闭监听（不能延迟，否则 50ms 内的点击会被错过）
  window._cardMsgDropdownOutsideHandler = function(e) {
    if (dropdown.contains(e.target)) return;
    // 点击输入框时也关闭下拉选单
    closeCardMsgDropdown(index);
  };
  document.addEventListener('mousedown', window._cardMsgDropdownOutsideHandler);

  dropdown._entries = uniqueEntries;
  dropdown._cardIndex = index;

  window._cardDropdownKeyboardIndex = 0;
  highlightCardDropdownItem(index, 0);
}

// 高亮下拉选单中的选项
function highlightCardDropdownItem(cardIndex, itemIndex) {
  const dropdown = document.getElementById(`cardMsgDropdown_${cardIndex}`);
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.card-dropdown-item');
  items.forEach(item => item.style.background = 'transparent');
  if (items.length > 0) {
    const idx = Math.max(0, Math.min(itemIndex, items.length - 1));
    items[idx].style.background = '#e0f2fe';
    window._cardDropdownKeyboardIndex = idx;
  }
}

// 选择历史讯息
function selectCardMsg(cardIndex, itemIndex) {
  const dropdown = document.getElementById(`cardMsgDropdown_${cardIndex}`);
  if (!dropdown || !dropdown._entries) return;
  const entry = dropdown._entries[itemIndex];
  if (!entry) return;

  const textarea = document.getElementById(`presetMsg_${cardIndex}`);
  if (textarea) {
    textarea.value = entry._cleanedMessage;
    if (typeof onHttpGetInput === 'function') onHttpGetInput(cardIndex);
  }

  if (entry.recipients) {
    const recipientInput = document.getElementById(`recipientInput_${cardIndex}`);
    if (recipientInput) recipientInput.value = entry.recipients;
  }

  closeCardMsgDropdown(cardIndex);
}

// 关闭卡片历史讯息下拉选单
function closeCardMsgDropdown(index) {
  const dropdown = document.getElementById(`cardMsgDropdown_${index}`);
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    dropdown._entries = null;
  }
  if (window._cardMsgDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._cardMsgDropdownOutsideHandler);
    window._cardMsgDropdownOutsideHandler = null;
  }
}

// 关闭所有卡片历史讯息下拉选单
function closeAllCardMsgDropdowns() {
  document.querySelectorAll('.card-msg-dropdown').forEach(d => {
    d.style.display = 'none';
    d.innerHTML = '';
    d._entries = null;
  });
  if (window._cardMsgDropdownOutsideHandler) {
    document.removeEventListener('mousedown', window._cardMsgDropdownOutsideHandler);
    window._cardMsgDropdownOutsideHandler = null;
  }
}

// 键盘导航处理
function handleCardMsgKeydown(event, index) {
  const dropdown = document.getElementById(`cardMsgDropdown_${index}`);
  if (!dropdown || dropdown.style.display === 'none') {
    const isQuestionKey = event.key === '?' || (event.shiftKey && event.key === '/') || (event.shiftKey && event.code === 'Slash');
    if (isQuestionKey) {
      const textarea = document.getElementById(`presetMsg_${index}`);
      if (textarea && !textarea.value.trim()) {
        event.preventDefault();
        showCardMsgDropdown(textarea, index);
      }
    }
    return;
  }

  const items = dropdown.querySelectorAll('.card-dropdown-item');
  if (items.length === 0) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      window._cardDropdownKeyboardIndex = (window._cardDropdownKeyboardIndex || 0) + 1;
      if (window._cardDropdownKeyboardIndex >= items.length) window._cardDropdownKeyboardIndex = 0;
      highlightCardDropdownItem(index, window._cardDropdownKeyboardIndex);
      break;
    case 'ArrowUp':
      event.preventDefault();
      window._cardDropdownKeyboardIndex = (window._cardDropdownKeyboardIndex || 0) - 1;
      if (window._cardDropdownKeyboardIndex < 0) window._cardDropdownKeyboardIndex = items.length - 1;
      highlightCardDropdownItem(index, window._cardDropdownKeyboardIndex);
      break;
    case 'Escape':
      event.preventDefault();
      closeCardMsgDropdown(index);
      break;
    case 'Enter':
      if (!event.shiftKey) {
        event.preventDefault();
        selectCardMsg(index, window._cardDropdownKeyboardIndex || 0);
      }
      break;
  }
}

// 导出函数到 window，供 HTML onclick 及其他模组访问
window.onHttpGetInput = onHttpGetInput;
window.collectStockPrices = collectStockPrices;
window.showCardMsgDropdown = showCardMsgDropdown;
window.selectCardMsg = selectCardMsg;
window.closeCardMsgDropdown = closeCardMsgDropdown;
window.handleCardMsgKeydown = handleCardMsgKeydown;
