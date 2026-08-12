/**
 * API Key 管理器 (AiApiKeyManager) - 多 Key 版本
 *
 * 功能：
 * - 管理 AI 服务提供商的多个 API Key（阿里云百炼、智谱GLM）
 * - 支持 Key 的添加、删除、设为默认
 * - 自动轮询：当前 Key 失败时自动切换到下一个
 * - 选择默认使用的 AI 提供商和模型版本
 * - 测试指定 API Key 有效性
 *
 * 技术栈：
 * - React 18 (函数组件 + Hooks)
 * - FloatingWindowReact (React 版浮动视窗)
 */

(function() {
  'use strict';

  // ===== 检查依赖 =====
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
    console.error('[AI-APIKey] React 或 ReactDOM 未加载！');
    return;
  }

  if (typeof FloatingWindowReact === 'undefined') {
    console.error('[AI-APIKey] FloatingWindowReact 未加载！');
    return;
  }

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;
  var createElement = React.createElement;

  // ===== AI 提供商配置 =====
  var PROVIDERS = {
    tongyi: {
      id: 'tongyi',
      name: '阿里云百炼大模型 (Qwen-VL)',
      company: '阿里云',
      description: '阿里云百炼平台通义千问多模态大模型，支持图像理解与识别',
      freeQuota: '免费额度：新用户赠送 100万 tokens',
      registerUrl: 'https://dashscope.console.aliyun.com/',
      docUrl: 'https://help.aliyun.com/zh/dashscope/',
      models: [
        { id: 'qwen-vl-max-latest', name: 'Qwen-VL-Max-Latest', desc: '最新最强版' },
        { id: 'qwen-vl-plus-latest', name: 'Qwen-VL-Plus-Latest', desc: '增强版' },
        { id: 'qwen-vl-max', name: 'Qwen-VL-Max', desc: '稳定版' }
      ],
      defaultModel: 'qwen-vl-max-latest'
    },
    zhipu: {
      id: 'zhipu',
      name: '智谱 GLM-4V',
      company: '智谱AI',
      description: '智谱AI GLM-4V 视觉大模型，支持图像识别与理解',
      freeQuota: '免费额度：新用户赠送 50万 tokens，GLM-4.6V-Flash完全免费',
      registerUrl: 'https://open.bigmodel.cn/',
      docUrl: 'https://open.bigmodel.cn/dev/api',
      models: [
        { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash', desc: '✅ 免费·最新版' },
        { id: 'glm-4v-flash', name: 'GLM-4V-Flash', desc: '✅ 免费·稳定版' },
        { id: 'glm-4v-plus', name: 'GLM-4V-Plus', desc: '⭐ 付费·精准版' },
        { id: 'glm-4v', name: 'GLM-4V', desc: '🚀 付费·最强版' }
      ],
      defaultModel: 'glm-4.6v-flash'
    },
    fangzhou: {
      id: 'fangzhou',
      name: '方舟大模型 (火山方舟)',
      company: '字节跳动',
      description: '字节跳动火山方舟多模态大模型，支持图像理解与识别',
      freeQuota: '免费额度：新用户赠送免费额度',
      registerUrl: 'https://www.volcengine.com/product/ark',
      docUrl: 'https://www.volcengine.com/docs/82379',
      models: [
        { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao-Seed-2-0-Lite-260428', desc: '✅ 已验证可工作' },
        { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao-Seed-2-0-Pro-260215', desc: '✅ 已验证可工作' },
        { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao-Seed-2-0-Mini-260428', desc: '✅ 已验证可工作' },
        { id: 'doubao-seed-2-0-code-preview-260215', name: 'Doubao-Seed-2-0-Code-Preview-260215', desc: '✅ 已验证可工作' }
      ],
      defaultModel: 'doubao-seed-2-0-lite-260428'
    }
  };

  // ===== 主应用组件 =====
  function AiApiKeyManagerApp(props) {
    var _useState1 = useState(loadSettings()),
        settings = _useState1[0],
        setSettings = _useState1[1];

    var _useState2 = useState(null),
        testResult = _useState2[0],
        setTestResult = _useState2[1];

    var _useState3 = useState(false),
        isTesting = _useState3[0],
        setIsTesting = _useState3[1];

    // 新 Key 输入框的状态（提升到组件顶层，避免在嵌套函数中使用 Hooks）
    var _useState4 = useState({ tongyi: '', zhipu: '', fangzhou: '' }),
        newKeyValues = _useState4[0],
        setNewKeyValues = _useState4[1];

    // 新 Key 名称输入框的状态
    var _useState5 = useState({ tongyi: '', zhipu: '', fangzhou: '' }),
        newKeyNames = _useState5[0],
        setNewKeyNames = _useState5[1];

    // 更新指定提供商的输入框值
    function updateNewKeyValue(provider, value) {
      var updated = Object.assign({}, newKeyValues);
      updated[provider] = value;
      setNewKeyValues(updated);
    }

    // 清空指定提供商的输入框值
    function clearNewKeyValue(provider) {
      updateNewKeyValue(provider, '');
    }

    // 更新指定提供商的名称输入框值
    function updateNewKeyName(provider, value) {
      var updated = Object.assign({}, newKeyNames);
      updated[provider] = value;
      setNewKeyNames(updated);
    }

    // 清空指定提供商的名称输入框值
    function clearNewKeyName(provider) {
      updateNewKeyName(provider, '');
    }

    // 加载设置（支持新旧格式兼容）
    function loadSettings() {
      try {
        // 先尝试加载新格式（多 Key + 名称）
        var saved = localStorage.getItem('ai_ocr_settings');
        if (saved) {
          var parsed = JSON.parse(saved);

          // 检测是否为新格式（apiKeys 是对象且包含数组）
          if (parsed.apiKeys && typeof parsed.apiKeys === 'object') {
            var tongyiKeys = parsed.apiKeys.tongyi;
            var zhipuKeys = parsed.apiKeys.zhipu;

            // 如果已经是对象数组格式（带名称），直接使用
            if (Array.isArray(tongyiKeys) && Array.isArray(zhipuKeys) &&
                (tongyiKeys.length === 0 || typeof tongyiKeys[0] === 'object') &&
                (zhipuKeys.length === 0 || typeof zhipuKeys[0] === 'object')) {

              // 确保有 activeKeyIndex 字段
      if (!parsed.activeKeyIndex) {
        parsed.activeKeyIndex = { tongyi: 0, zhipu: 0, fangzhou: 0 };
      }
      // 确保有 models 字段
      if (!parsed.models) {
        parsed.models = {
          tongyi: PROVIDERS.tongyi.defaultModel,
          zhipu: PROVIDERS.zhipu.defaultModel,
          fangzhou: PROVIDERS.fangzhou.defaultModel
        };
      }
              return parsed;
            }

            // 旧格式转换：字符串数组 → 对象数组（添加名称）
            if (Array.isArray(tongyiKeys) || Array.isArray(zhipuKeys)) {
              console.log('[AI-APIKey] 检测到旧格式（字符串数组），正在迁移到带名称的格式...');

              function convertToNamedKeys(keysArray) {
                if (!Array.isArray(keysArray)) return [];
                return keysArray.map(function(key, index) {
                  return {
                    key: key,
                    name: 'Key #' + (index + 1)
                  };
                });
              }

              return {
                provider: parsed.provider || 'tongyi',
                apiKeys: {
                  tongyi: convertToNamedKeys(tongyiKeys),
                  zhipu: convertToNamedKeys(zhipuKeys),
                  fangzhou: convertToNamedKeys(parsed.apiKeys?.fangzhou)
                },
                activeKeyIndex: {
                  tongyi: 0,
                  zhipu: 0,
                  fangzhou: 0
                },
                models: parsed.models || {
                  tongyi: PROVIDERS.tongyi.defaultModel,
                  zhipu: PROVIDERS.zhipu.defaultModel,
                  fangzhou: PROVIDERS.fangzhou.defaultModel
                }
              };
            }

            // 更旧的格式：单个字符串 → 对象数组
            if (typeof tongyiKeys === 'string' || typeof zhipuKeys === 'string') {
              console.log('[AI-APIKey] 检测到旧格式（单个字符串），正在迁移到多 Key 格式...');

              function stringToNamedKey(keyStr) {
                if (!keyStr || !keyStr.trim()) return [];
                return [{ key: keyStr.trim(), name: '默认 Key' }];
              }

              return {
                provider: parsed.provider || 'tongyi',
                apiKeys: {
                  tongyi: stringToNamedKey(tongyiKeys),
                  zhipu: stringToNamedKey(zhipuKeys),
                  fangzhou: stringToNamedKey(parsed.apiKeys?.fangzhou)
                },
                activeKeyIndex: { tongyi: 0, zhipu: 0, fangzhou: 0 },
                models: parsed.models || {
                  tongyi: PROVIDERS.tongyi.defaultModel,
                  zhipu: PROVIDERS.zhipu.defaultModel,
                  fangzhou: PROVIDERS.fangzhou.defaultModel
                }
              };
            }
          }
        }

        // 如果没有保存的数据，尝试加载旧的独立存储格式
        var qwenKey = localStorage.getItem('ai_parser_qwen_key') || '';
        var zhipuKey = localStorage.getItem('ai_parser_zhipu_key') || '';
        var model = localStorage.getItem('ai_parser_model') || 'qwen';

        // 尝试加载已保存的模型版本
        var savedModels = localStorage.getItem('ai_parser_models');
        var models = { tongyi: PROVIDERS.tongyi.defaultModel, zhipu: PROVIDERS.zhipu.defaultModel };
        if (savedModels) {
          try {
            models = JSON.parse(savedModels);
          } catch(e) {}
        }

        return {
          provider: model === 'qwen' ? 'tongyi' : 'zhipu',
          apiKeys: {
            tongyi: qwenKey.trim() ? [{ key: qwenKey, name: '默认 Key' }] : [],
            zhipu: zhipuKey.trim() ? [{ key: zhipuKey, name: '默认 Key' }] : [],
            fangzhou: []
          },
          activeKeyIndex: { tongyi: 0, zhipu: 0, fangzhou: 0 },
          models: models
        };
      } catch(e) {
        console.error('[AI-APIKey] 加载设置失败:', e);
        return {
          provider: 'tongyi',
          apiKeys: { tongyi: [], zhipu: [], fangzhou: [] },
          activeKeyIndex: { tongyi: 0, zhipu: 0, fangzhou: 0 },
          models: { tongyi: PROVIDERS.tongyi.defaultModel, zhipu: PROVIDERS.zhipu.defaultModel, fangzhou: PROVIDERS.fangzhou.defaultModel }
        };
      }
    }

    // 保存设置（保持向后兼容）
    var saveSettings = useCallback(function(newSettings) {
      setSettings(newSettings);

      // 保存新格式（完整数据，包含名称）
      localStorage.setItem('ai_ocr_settings', JSON.stringify(newSettings));

      // 同时保存到旧格式（兼容性）：只保存当前激活的 Key
      var activeTongyiInfo = getActiveKeyInfo(newSettings, 'tongyi');
      var activeZhipuInfo = getActiveKeyInfo(newSettings, 'zhipu');
      var activeFangzhouInfo = getActiveKeyInfo(newSettings, 'fangzhou');

      localStorage.setItem('ai_parser_qwen_key', activeTongyiInfo?.key || '');
      localStorage.setItem('ai_parser_zhipu_key', activeZhipuInfo?.key || '');
      localStorage.setItem('ai_parser_fangzhou_key', activeFangzhouInfo?.key || '');
      localStorage.setItem('ai_parser_model', newSettings.provider === 'tongyi' ? 'qwen' : 'zhipu');

      // 📢 通知其他组件（如聊天助手）模型已切换
      try {
        window.dispatchEvent(new CustomEvent('ai:modelChanged', {
          detail: { 
            provider: newSettings.provider,
            model: newSettings.provider === 'tongyi' ? 'qwen' : 'zhipu'
          }
        }));
        console.log('[AI-KeyMgr] 📢 已触发 ai:modelChanged 事件');
      } catch(e) {
        console.warn('[AI-KeyMgr] ⚠️ 触发事件失败:', e);
      }

      // 保存当前激活的 Key 名称（供主界面显示）
      localStorage.setItem('ai_parser_active_key_name_tongyi', activeTongyiInfo?.name || '');
      localStorage.setItem('ai_parser_active_key_name_zhipu', activeZhipuInfo?.name || '');
      var activeFangzhouInfo = getActiveKeyInfo(newSettings, 'fangzhou');
      localStorage.setItem('ai_parser_active_key_name_fangzhou', activeFangzhouInfo?.name || '');

      // 保存模型版本选择
      if (newSettings.models) {
        localStorage.setItem('ai_parser_models', JSON.stringify(newSettings.models));
      }

      console.log('[AI-APIKey] 设置已保存:', {
        provider: newSettings.provider,
        tongyiKeysCount: (newSettings.apiKeys.tongyi || []).length,
        zhipuKeysCount: (newSettings.apiKeys.zhipu || []).length,
        activeTongyiIndex: newSettings.activeKeyIndex?.tongyi,
        activeZhipuIndex: newSettings.activeKeyIndex?.zhipu,
        activeTongyiName: activeTongyiInfo?.name,
        activeZhipuName: activeZhipuInfo?.name
      });
    }, []);

    // 获取当前激活的 API Key 信息（包含 key 和 name）
    function getActiveKeyInfo(settingsObj, provider) {
      var keys = settingsObj.apiKeys[provider] || [];
      var index = settingsObj.activeKeyIndex?.[provider] || 0;

      // 边界检查
      if (index >= keys.length) {
        index = 0;
      }

      return keys[index] || null;
    }

    // 获取当前激活的 API Key 字符串（向后兼容）
    function getActiveApiKey(settingsObj, provider) {
      var keyInfo = getActiveKeyInfo(settingsObj, provider);
      return keyInfo ? (keyInfo.key || '') : '';
    }

    // 添加新的 API Key（带名称）
    var addApiKey = useCallback(function(provider, apiKey, keyName) {
      if (!apiKey || apiKey.trim() === '') return;

      apiKey = apiKey.trim();

      // 处理名称：如果没有提供或为空，使用默认名称
      if (!keyName || !keyName.trim()) {
        var existingKeys = settings.apiKeys[provider] || [];
        keyName = 'Key #' + (existingKeys.length + 1);
      } else {
        keyName = keyName.trim().substring(0, 12); // 限制最多12个字符
      }

      var newSettings = Object.assign({}, settings, {
        apiKeys: Object.assign({}, settings.apiKeys, {}),
        activeKeyIndex: Object.assign({}, settings.activeKeyIndex || {})
      });

      // 初始化数组（如果不存在）
      if (!Array.isArray(newSettings.apiKeys[provider])) {
        newSettings.apiKeys[provider] = [];
      }

      // 检查是否已存在相同的 Key（避免重复添加）
      var isDuplicate = newSettings.apiKeys[provider].some(function(item) {
        return item.key === apiKey;
      });

      if (!isDuplicate) {
        newSettings.apiKeys[provider].push({
          key: apiKey,
          name: keyName
        });

        // 如果这是第一个 Key，设置为激活状态
        if (newSettings.apiKeys[provider].length === 1) {
          newSettings.activeKeyIndex[provider] = 0;
        }
      }

      saveSettings(newSettings);
    }, [settings, saveSettings]);

    // 更新指定 Key 的名称
    var updateKeyName = useCallback(function(provider, index, newName) {
      if (!newName || !newName.trim()) return;

      newName = newName.trim().substring(0, 12); // 限制最多12个字符

      var newSettings = Object.assign({}, settings, {
        apiKeys: Object.assign({}, settings.apiKeys, {})
      });

      if (Array.isArray(newSettings.apiKeys[provider]) && newSettings.apiKeys[provider][index]) {
        newSettings.apiKeys[provider][index].name = newName;
        saveSettings(newSettings);
      }
    }, [settings, saveSettings]);

    // 删除指定的 API Key
    var removeApiKey = useCallback(function(provider, index) {
      var newSettings = Object.assign({}, settings, {
        apiKeys: Object.assign({}, settings.apiKeys, {}),
        activeKeyIndex: Object.assign({}, settings.activeKeyIndex || {})
      });

      if (Array.isArray(newSettings.apiKeys[provider])) {
        newSettings.apiKeys[provider].splice(index, 1);

        // 调整激活索引
        if (newSettings.activeKeyIndex[provider] >= newSettings.apiKeys[provider].length) {
          newSettings.activeKeyIndex[provider] = Math.max(0, newSettings.apiKeys[provider].length - 1);
        }
      }

      saveSettings(newSettings);
    }, [settings, saveSettings]);

    // 设置当前激活的 Key
    var setActiveKey = useCallback(function(provider, index) {
      var newSettings = Object.assign({}, settings, {
        activeKeyIndex: Object.assign({}, settings.activeKeyIndex || {})
      });
      newSettings.activeKeyIndex[provider] = index;
      saveSettings(newSettings);
    }, [settings, saveSettings]);

    // 切换默认提供商
    var changeProvider = useCallback(function(provider) {
      saveSettings(Object.assign({}, settings, { provider: provider }));
    }, [settings, saveSettings]);

    // 更新模型版本
    var changeModel = useCallback(function(provider, modelId) {
      var newSettings = Object.assign({}, settings, {
        models: Object.assign({}, settings.models || {}, {})
      });
      newSettings.models[provider] = modelId;
      saveSettings(newSettings);
    }, [settings, saveSettings]);

    // 测试指定的 API Key
    var testApiKey = useCallback(function(provider, keyIndex) {
      var keys = settings.apiKeys[provider] || [];
      if (keys.length === 0) {
        setTestResult({ success: false, message: '请先添加 API Key！' });
        return;
      }

      // 如果未指定索引，使用当前激活的 Key
      if (keyIndex === undefined || keyIndex === null) {
        keyIndex = settings.activeKeyIndex?.[provider] || 0;
      }

      var apiKeyInfo = keys[keyIndex];
      if (!apiKeyInfo) {
        setTestResult({ success: false, message: '无效的 API Key 索引！' });
        return;
      }

      var apiKey = apiKeyInfo.key || apiKeyInfo; // 兼容新旧格式
      var keyName = apiKeyInfo.name || ('Key #' + (keyIndex + 1)); // 使用自定义名称或默认名称

      setIsTesting(true);
      setTestResult(null);

      setTimeout(function() {
        try {
          if (provider === 'tongyi') {
            testTongyiAPI(apiKey, keyName);
          } else if (provider === 'zhipu') {
            testZhipuAPI(apiKey, keyName);
          } else if (provider === 'fangzhou') {
            testFangzhouAPI(apiKey, keyName);
          }
        } catch(err) {
          setIsTesting(false);
          setTestResult({ success: false, message: '测试失败: ' + err.message });
        }
      }, 100);
    }, [settings]);

    // 测试通义千问 API
    function testTongyiAPI(apiKey, keyName) {
      var modelId = (settings.models && settings.models.tongyi) || 'qwen-vl-max';
      
      fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: modelId,
          input: {
            messages: [{
              role: 'user',
              content: [{ text: '请回复"测试成功"' }]
            }]
          }
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        setIsTesting(false);

        if (data.output && data.output.choices) {
          setTestResult({
            success: true,
            message: '✅ 阿里云百炼 API Key「' + keyName + '」验证成功！',
            details: '模型：' + modelId + ' | Key「' + keyName + '」响应正常，可以使用'
          });
        } else if (data.code) {
          setTestResult({
            success: false,
            message: '❌ 阿里云百炼 API Key「' + keyName + '」无效或已过期',
            details: '模型：' + modelId + ' | [' + data.code + '] ' + (data.message || '')
          });
        } else {
          setTestResult({ success: false, message: '❌ 返回数据异常' });
        }
      })
      .catch(function(err) {
        setIsTesting(false);
        setTestResult({
          success: false,
          message: '❌ 阿里云百炼 API Key「' + keyName + '」网络错误',
          details: '模型：' + modelId + ' | ' + err.message
        });
      });
    }

    // 测试智谱 API
    function testZhipuAPI(apiKey, keyName) {
      var modelId = (settings.models && settings.models.zhipu) || 'glm-4v-flash';
      
      fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: '请回复"测试成功"' }]
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        setIsTesting(false);

        if (data.choices && data.choices.length > 0) {
          setTestResult({
            success: true,
            message: '✅ 智谱 GLM API Key「' + keyName + '」验证成功！',
            details: '模型：' + modelId + ' | Key「' + keyName + '」响应正常，可以使用'
          });
        } else if (data.error) {
          setTestResult({
            success: false,
            message: '❌ 智谱 GLM API Key「' + keyName + '」无效或已过期',
            details: '模型：' + modelId + ' | ' + (data.error.message || '')
          });
        } else {
          setTestResult({ success: false, message: '❌ 返回数据异常' });
        }
      })
      .catch(function(err) {
        setIsTesting(false);
        setTestResult({
          success: false,
          message: '❌ 智谱 GLM API Key「' + keyName + '」网络错误',
          details: '模型：' + modelId + ' | ' + err.message
        });
      });
    }

    // 测试方舟 API
    function testFangzhouAPI(apiKey, keyName) {
      var modelId = (settings.models && settings.models.fangzhou) || 'doubao-seed-2.0-lite';
      
      fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: modelId,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: '请回复"测试成功"'
                }
              ]
            }
          ]
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        setIsTesting(false);

        if (data.error) {
          setTestResult({
            success: false,
            message: '❌ 方舟大模型 API Key「' + keyName + '」无效或已过期',
            details: '模型：' + modelId + ' | ' + (data.error.message || JSON.stringify(data.error))
          });
        } else if (data.output) {
          setTestResult({
            success: true,
            message: '✅ 方舟大模型 API Key「' + keyName + '」验证成功！',
            details: '模型：' + modelId + ' | Key「' + keyName + '」响应正常，可以使用'
          });
        } else {
          setTestResult({ success: false, message: '❌ 返回数据异常', details: '模型：' + modelId + ' | ' + JSON.stringify(data) });
        }
      })
      .catch(function(err) {
        setIsTesting(false);
        setTestResult({
          success: false,
          message: '❌ 方舟大模型 API Key「' + keyName + '」网络错误',
          details: '模型：' + modelId + ' | ' + err.message
        });
      });
    }

    // 渲染提供商卡片（支持多 Key）
    function renderProviderCard(providerId) {
      var provider = PROVIDERS[providerId];
      var isDefault = settings.provider === providerId;
      var keys = settings.apiKeys[providerId] || [];
      var activeIndex = settings.activeKeyIndex?.[providerId] || 0;
      var hasKeys = keys.length > 0;

      return createElement('div', {
        key: providerId,
        style: {
          border: '2px solid ' + (isDefault ? '#3b82f6' : '#e2e8f0'),
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '16px',
          background: isDefault ? '#eff6ff' : 'white',
          transition: 'all 0.3s ease',
          position: 'relative'
        }
      },

        // 默认标识
        isDefault && createElement('div', {
          style: {
            position: 'absolute',
            top: '-10px',
            right: '20px',
            background: '#3b82f6',
            color: 'white',
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600
          }
        }, '🎯 默认使用'),

        // 提供商标题
        createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px'
          }
        },
          createElement('div', null,
            createElement('h4', {
              style: {
                margin: 0,
                fontSize: '17px',
                color: '#1e293b',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }
            },
              providerId === 'tongyi' ? '☁️' : (providerId === 'zhipu' ? '🧠' : '🚀'),
              provider.name,
              createElement('span', {
                style: {
                  fontSize: '12px',
                  color: '#64748b',
                  fontWeight: 400,
                  background: '#f1f5f9',
                  padding: '2px 8px',
                  borderRadius: '4px'
                }
              }, hasKeys ? keys.length + ' 个 Key' : '未配置')
            ),
            createElement('p', {
              style: {
                margin: '6px 0 0 0',
                fontSize: '13px',
                color: '#64748b'
              }
            }, provider.description)
          ),

          // 选择为默认按钮
          !isDefault && createElement('button', {
            onClick: function() { changeProvider(providerId); },
            style: {
              padding: '6px 14px',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#0369a1',
              fontWeight: 500
            }
          }, '设为默认')
        ),

        // 免费额度提示
        createElement('div', {
          style: {
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#166534'
          }
        }, '💚 ', provider.freeQuota),

        // ========== 多 Key 列表区域 ==========
        hasKeys ? createElement('div', { style: { marginBottom: '16px' } },

          // Key 列表标题
          createElement('div', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px'
            }
          },
            createElement('label', {
              style: {
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155'
              }
            }, '🔑 API Key 列表'),
            createElement('span', {
              style: {
                fontSize: '11px',
                color: '#64748b'
              }
            }, '自动轮询：当前 Key 失败时自动切换下一个')
          ),

          // Key 列表
          createElement('div', {
            style: {
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fafafa'
            }
          },
            keys.map(function(keyInfo, index) {
              var isActive = index === activeIndex;
              var keyValue = keyInfo.key || keyInfo; // 兼容新旧格式
              var keyName = keyInfo.name || ('Key #' + (index + 1));

              return createElement('div', {
                key: index,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: index < keys.length - 1 ? '1px solid #e2e8f0' : 'none',
                  background: isActive ? '#dbeafe' : 'transparent',
                  transition: 'background 0.2s ease'
                }
              },

                // 激活状态标识
                createElement('div', {
                  style: {
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isActive ? '#3b82f6' : '#cbd5e1',
                    marginRight: '10px',
                    flexShrink: 0
                  }
                }),

                // Key 名称 + 内容（脱敏显示）
                createElement('div', {
                  style: {
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    overflow: 'hidden'
                  }
                },

                  // 名称行
                  createElement('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }
                  },
                    createElement('span', {
                      style: {
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#1e293b',
                        maxWidth: '150px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }
                    }, keyName),

                    isActive && createElement('span', {
                      style: {
                        fontSize: '10px',
                        color: '#3b82f6',
                        fontWeight: 600,
                        background: '#bfdbfe',
                        padding: '1px 6px',
                        borderRadius: '3px'
                      }
                    }, '当前使用')
                  ),

                  // Key 值行（脱敏）
                  createElement('div', {
                    style: {
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: '#64748b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }
                  }, maskApiKey(keyValue))
                ),

                // 操作按钮组
                createElement('div', {
                  style: {
                    display: 'flex',
                    gap: '6px',
                    marginLeft: '10px'
                  }
                },

                  // 设为当前使用按钮（如果不是当前的）
                  !isActive && createElement('button', {
                    onClick: function() { setActiveKey(providerId, index); },
                    title: '设为当前使用',
                    style: {
                      padding: '4px 10px',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 500
                    }
                  }, '使用'),

                  // 测试按钮
                  createElement('button', {
                    onClick: function() { testApiKey(providerId, index); },
                    disabled: isTesting,
                    title: '测试此 Key',
                    style: {
                      padding: '4px 10px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isTesting ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      fontWeight: 500,
                      opacity: isTesting ? 0.6 : 1
                    }
                  }, isTesting ? '⏳' : '测试'),

                  // 删除按钮
                  createElement('button', {
                    onClick: function() {
                      if (confirm('确定要删除此 API Key 吗？')) {
                        removeApiKey(providerId, index);
                      }
                    },
                    title: '删除此 Key',
                    style: {
                      padding: '4px 10px',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 500
                    }
                  }, '删除')
                )
              );
            })
          )
        ) :

        // 无 Key 时显示提示
        createElement('div', {
          style: {
            padding: '20px',
            textAlign: 'center',
            background: '#f8fafc',
            border: '2px dashed #cbd5e1',
            borderRadius: '6px',
            marginBottom: '16px',
            color: '#64748b',
            fontSize: '13px'
          }
        }, '📭 暂无 API Key，请在下方添加'),

        // ========== 添加新 Key 区域 ==========
        createElement('div', { style: { marginBottom: '12px' } },
          createElement('label', {
            style: {
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '6px'
            }
          }, hasKeys ? '➕ 添加新的 API Key' : 'API Key'),

          // 名称输入框
          createElement('div', {
            style: {
              display: 'flex',
              gap: '8px',
              marginBottom: '8px'
            }
          },
            createElement('input', {
              type: 'text',
              value: newKeyNames[providerId] || '',
              onChange: function(e) { updateNewKeyName(providerId, e.target.value); },
              placeholder: '名称（可选，最多12字符）...',
              maxLength: 12,
              style: {
                flex: '0 0 180px',
                padding: '8px 12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '13px',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.3s ease'
              },
              onFocus: function(e) { e.target.style.borderColor = '#3b82f6'; },
              onBlur: function(e) { e.target.style.borderColor = '#cbd5e1'; }
            }),
            createElement('span', {
              style: {
                display: 'flex',
                alignItems: 'center',
                fontSize: '11px',
                color: '#94a3b8'
              }
            }, '💡 方便识别管理')
          ),

          // Key 值输入框 + 添加按钮
          createElement('div', {
            style: {
              display: 'flex',
              gap: '8px'
            }
          },
            createElement('input', {
              type: 'password',
              value: newKeyValues[providerId] || '',
              onChange: function(e) { updateNewKeyValue(providerId, e.target.value); },
              placeholder: '请输入新的 API Key...',
              onKeyDown: function(e) {
                var currentValue = newKeyValues[providerId] || '';
                var currentName = newKeyNames[providerId] || '';
                if (e.key === 'Enter' && currentValue.trim()) {
                  addApiKey(providerId, currentValue, currentName);
                  clearNewKeyValue(providerId);
                  clearNewKeyName(providerId);
                }
              },
              style: {
                flex: 1,
                padding: '10px 12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.3s ease'
              },
              onFocus: function(e) { e.target.style.borderColor = '#3b82f6'; },
              onBlur: function(e) { e.target.style.borderColor = '#cbd5e1'; }
            }),
            createElement('button', {
              onClick: function() {
                var currentValue = newKeyValues[providerId] || '';
                var currentName = newKeyNames[providerId] || '';
                if (currentValue.trim()) {
                  addApiKey(providerId, currentValue, currentName);
                  clearNewKeyValue(providerId);
                  clearNewKeyName(providerId);
                }
              },
              disabled: !(newKeyValues[providerId] || '').trim(),
              style: {
                padding: '10px 18px',
                background: (newKeyValues[providerId] || '').trim() ? '#3b82f6' : '#94a3b8',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: (newKeyValues[providerId] || '').trim() ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap'
              }
            }, '添加')
          )
        ),

        // 模型版本选择
        createElement('div', { style: { marginBottom: '12px' } },
          createElement('label', {
            style: {
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '6px'
            }
          }, '🤖 模型版本'),
          
          // 所有提供商：仅下拉选择
          createElement('div', null,
            createElement('select', {
              value: (settings.models && settings.models[providerId]) || provider.defaultModel,
              onChange: function(e) { changeModel(providerId, e.target.value); },
              style: {
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
                outline: 'none',
                backgroundColor: 'white',
                cursor: 'pointer',
                transition: 'border-color 0.3s ease'
              },
              onFocus: function(e) { e.target.style.borderColor = '#3b82f6'; },
              onBlur: function(e) { e.target.style.borderColor = '#cbd5e1'; }
            },
              provider.models.map(function(model) {
                return createElement('option', { key: model.id, value: model.id },
                  model.name + ' - ' + model.desc
                );
              })
            ),
            createElement('div', {
              style: {
                marginTop: '4px',
                fontSize: '11px',
                color: (settings.models && settings.models[providerId]) === provider.defaultModel || !settings.models || !settings.models[providerId]
                  ? '#16a34a'
                  : '#ea580c',
                fontWeight: 500
              }
            }, (!settings.models || !settings.models[providerId] || settings.models[providerId] === provider.defaultModel)
            ? '✅ 默认推荐模型'
            : '⚠️ 已切换为自定义模型')
          )
        ),

        // 快速操作按钮
        createElement('div', {
          style: {
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flexWrap: 'wrap'
          }
        },

          // 测试当前激活的 Key
          hasKeys && createElement('button', {
            onClick: function() { testApiKey(providerId, activeIndex); },
            disabled: isTesting,
            style: {
              padding: '8px 18px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isTesting ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              opacity: isTesting ? 0.6 : 1
            }
          }, isTesting ? '⏳ 测试中...' : '🔍 测试「' + (keys[activeIndex]?.name || ('Key #' + (activeIndex + 1))) + '」'),

          // 配置状态
          hasKeys && createElement('span', {
            style: {
              fontSize: '13px',
              color: '#10b981',
              fontWeight: 500
            }
          }, '✓ 已配置 ' + keys.length + ' 个 Key'),

          // 获取更多 Key 的链接
          createElement('a', {
            href: provider.registerUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            style: {
              marginLeft: 'auto',
              fontSize: '13px',
              color: '#3b82f6',
              textDecoration: 'none',
              fontWeight: 500
            }
          }, '获取 API Key →')
        )
      );
    }

    // API Key 脱敏显示
    function maskApiKey(key) {
      if (!key || key.length <= 12) return '••••••••••••';
      return key.substring(0, 6) + '••••••••' + key.substring(key.length - 4);
    }

    // 渲染测试结果
    var renderTestResult = function() {
      if (!testResult) return null;

      return createElement('div', {
        style: {
          marginTop: '20px',
          padding: '14px 16px',
          borderRadius: '8px',
          background: testResult.success ? '#f0fdf4' : '#fef2f2',
          border: '1px solid ' + (testResult.success ? '#bbf7d0' : '#fecaca')
        }
      },
        createElement('div', {
          style: {
            fontSize: '14px',
            fontWeight: 600,
            color: testResult.success ? '#166534' : '#dc2626',
            marginBottom: testResult.details ? '6px' : '0'
          }
        }, testResult.message),
        testResult.details && createElement('div', {
          style: {
            fontSize: '13px',
            color: testResult.success ? '#15803d' : '#991b1b'
          }
        }, testResult.details)
      );
    };

    // 渲染帮助信息
    var renderHelpInfo = function() {
      return createElement('details', { style: { marginTop: '24px' } },
        createElement('summary', {
          style: {
            cursor: 'pointer',
            fontSize: '14px',
            color: '#64748b',
            fontWeight: 500,
            padding: '8px 0'
          }
        }, '💡 如何获取免费的 API Key？'),

        createElement('div', {
          style: {
            marginTop: '12px',
            padding: '16px',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }
        },
          createElement('h4', { style: { margin: '0 0 12px 0', fontSize: '15px', color: '#334155' } }, '快速注册指南'),

          createElement('div', { style: { marginBottom: '16px' } },
            createElement('strong', { style: { color: '#0369a1' } }, '1. 阿里云百炼（阿里云）'),
            createElement('ol', {
              style: {
                margin: '8px 0',
                paddingLeft: '20px',
                fontSize: '13px',
                color: '#475569',
                lineHeight: '1.8'
              }
            },
              createElement('li', null, '访问 ', createElement('a', { href: 'https://dashscope.console.aliyun.com/', target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6' } }, '阿里云百炼控制台')),
              createElement('li', null, '登录或注册阿里云账号（支持支付宝登录）'),
              createElement('li', null, '进入「API-KEY管理」页面'),
              createElement('li', null, '创建新的 API Key 并复制'),
              createElement('li', null, '💡 可以创建多个 Key，分别用于不同用途')
            )
          ),

          createElement('div', null,
            createElement('strong', { style: { color: '#7c3aed' } }, '2. 智谱 GLM（智谱AI）'),
            createElement('ol', {
              style: {
                margin: '8px 0',
                paddingLeft: '20px',
                fontSize: '13px',
                color: '#475569',
                lineHeight: '1.8'
              }
            },
              createElement('li', null, '访问 ', createElement('a', { href: 'https://open.bigmodel.cn/', target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6' } }, '智谱AI开放平台')),
              createElement('li', null, '注册账号（支持手机号注册）'),
              createElement('li', null, '进入「API密钥」管理页面'),
              createElement('li', null, '创建新的 API Key 并复制'),
              createElement('li', null, '💡 推荐使用 GLM-4.6V-Flash 模型，完全免费')
            )
          ),

          createElement('div', { style: { marginTop: '16px' } },
            createElement('strong', { style: { color: '#f59e0b' } }, '3. 方舟大模型（字节跳动）'),
            createElement('ol', {
              style: {
                margin: '8px 0',
                paddingLeft: '20px',
                fontSize: '13px',
                color: '#475569',
                lineHeight: '1.8'
              }
            },
              createElement('li', null, '访问 ', createElement('a', { href: 'https://www.volcengine.com/product/ark', target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6' } }, '火山引擎方舟平台')),
              createElement('li', null, '注册账号（支持手机号注册）'),
              createElement('li', null, '进入「API密钥」管理页面，创建新的 API Key 并复制'),
              createElement('li', null, '在我们的应用中选择默认模型 doubao-seed-2-0-lite-260428 先测试'),
              createElement('li', null, '如上述模型不可用，请在方舟控制台「模型广场」创建推理接入点'),
              createElement('li', null, '复制接入点ID（格式如 ep-xxxxx）并粘贴到模型输入框中')
            )
          ),

          createElement('div', {
            style: {
              marginTop: '16px',
              padding: '12px',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#92400e'
            }
          }, '🎯 使用技巧：添加多个 Key 后，系统会自动轮询。当某个 Key 额度用完或失效时，会自动切换到下一个可用 Key！')
        )
      );
    };

    // 主渲染
    return createElement('div', {
      className: 'ai-apikey-manager',
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        overflowY: 'auto'
      }
    },

      // 标题
      createElement('h3', {
        style: {
          margin: '0 0 20px 0',
          fontSize: '19px',
          color: '#1e293b',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }
      }, '🔑 AI API Key 管理（多 Key 版本）'),

      // 提供商卡片列表
      renderProviderCard('tongyi'),
      renderProviderCard('zhipu'),
      renderProviderCard('fangzhou'),

      // 测试结果
      renderTestResult(),

      // 帮助信息
      renderHelpInfo()
    );
  }

  // ===== 错误边界组件 =====
  function ErrorBoundary(props) {
    var _useState = useState({ hasError: false, error: null }),
        state = _useState[0],
        setState = _useState[1];

    useEffect(function() {
      var originalHandler = window.onerror;
      window.onerror = function(message, source, lineno, colno, error) {
        setState({ hasError: true, error: error });
        if (originalHandler) originalHandler.apply(this, arguments);
      };
      return function() { window.onerror = originalHandler; };
    }, []);

    if (state.hasError) {
      return createElement('div', {
        style: { padding: '40px', textAlign: 'center', color: '#dc2626' }
      },
        createElement('h3', null, '❌ 组件出错'),
        createElement('button', {
          onClick: function() { setState({ hasError: false, error: null }); },
          style: {
            marginTop: '16px',
            padding: '8px 24px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }
        }, '重试')
      );
    }

    return props.children;
  }

  // ===== 插件管理器 =====
  function AiApiKeyManager() {
    this.reactRoot = null;
    this.container = null;
  }

  AiApiKeyManager.prototype.open = function() {
    console.log('[AI-APIKey] 打开 API Key 管理窗口（多 Key 版本）');

    try {
      // 如果窗口已存在，先关闭
      if (this.container) {
        this.close();
      }

      var container = document.createElement('div');
      container.id = 'ai-apikey-manager-container';
      // 注意：不设置 position/top/left/z-index，避免创建堆叠上下文限制子元素
      // FloatingWindowReact 组件会自行管理 position 和 z-index，支持点击置顶功能
      document.body.appendChild(container);
      this.container = container;

      if (!ReactDOM) throw new Error('ReactDOM 未定义');
      if (!FloatingWindowReact) throw new Error('FloatingWindowReact 未定义');

      var root = ReactDOM.createRoot(container);
      this.reactRoot = root;
      
      var self = this;

      root.render(
        createElement(FloatingWindowReact, {
          title: 'AI API Key 管理（多 Key）',
          sourceFile: 'aiApiKeyManager.js',
          width: '650px',
          height: '750px',
          draggable: true,
          closeAnimation: 'fade',
          onClose: function() { self.close(); }
        },
          createElement(ErrorBoundary, null,
            createElement(AiApiKeyManagerApp, null)
          )
        )
      );

      console.log('[AI-APIKey] ✅ 窗口已打开');

    } catch(err) {
      console.error('[AI-APIKey] ❌ 打开窗口失败:', err.message);
      alert('❌ 打开 API Key 管理窗口失败！\n\n错误信息: ' + err.message);
    }
  };
  
  AiApiKeyManager.prototype.close = function() {
    console.log('[AI-APIKey] 关闭 API Key 管理窗口');
    
    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch(e) {
        console.error('[AI-APIKey] 卸载组件失败:', e);
      }
      this.reactRoot = null;
    }
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  };

  /**
   * 获取当前激活的 API Key（供外部调用）
   * @param {string} provider - 服务商 ('tongyi' | 'zhipu' | 'fangzhou')
   * @returns {string} 当前激活的 API Key 字符串
   */
  AiApiKeyManager.prototype.getActiveApiKey = function(provider) {
    try {
      var saved = localStorage.getItem('ai_ocr_settings');
      if (saved) {
        var settings = JSON.parse(saved);
        var keys = settings.apiKeys?.[provider] || [];
        var index = settings.activeKeyIndex?.[provider] || 0;

        if (index >= keys.length) index = 0;
        var keyInfo = keys[index];

        // 新格式：对象 { key, name }
        if (keyInfo && typeof keyInfo === 'object') {
          return keyInfo.key || '';
        }

        // 旧格式：字符串
        return keyInfo || '';
      }

      // 回退到旧格式
      var legacyKey = localStorage.getItem(
        provider === 'tongyi' ? 'ai_parser_qwen_key' : (provider === 'zhipu' ? 'ai_parser_zhipu_key' : 'ai_parser_fangzhou_key')
      );
      return legacyKey || '';
    } catch(e) {
      console.error('[AI-APIKey] 获取激活 Key 失败:', e);
      return '';
    }
  };

  /**
   * 获取当前激活的 API Key 信息（包含名称）
   * @param {string} provider - 服务商 ('tongyi' | 'zhipu' | 'fangzhou')
   * @returns {Object} { key: string, name: string } 或 null
   */
  AiApiKeyManager.prototype.getActiveKeyInfo = function(provider) {
    try {
      var saved = localStorage.getItem('ai_ocr_settings');
      if (saved) {
        var settings = JSON.parse(saved);
        var keys = settings.apiKeys?.[provider] || [];
        var index = settings.activeKeyIndex?.[provider] || 0;

        if (index >= keys.length) index = 0;
        return keys[index] || null;
      }

      // 回退到旧格式
      var legacyKey = localStorage.getItem(
        provider === 'tongyi' ? 'ai_parser_qwen_key' : (provider === 'zhipu' ? 'ai_parser_zhipu_key' : 'ai_parser_fangzhou_key')
      );

      if (legacyKey) {
        return { key: legacyKey, name: '默认 Key' };
      }

      return null;
    } catch(e) {
      console.error('[AI-APIKey] 获取激活 Key 信息失败:', e);
      return null;
    }
  };

  /**
   * 获取当前激活 Key 的名称
   * @param {string} provider - 服务商 ('tongyi' | 'zhipu' | 'fangzhou')
   * @returns {string} Key 名称
   */
  AiApiKeyManager.prototype.getActiveKeyName = function(provider) {
    try {
      // 优先从专门的存储读取
      var storedName = localStorage.getItem(
        'ai_parser_active_key_name_' + provider
      );
      if (storedName) return storedName;

      // 否则从完整设置中获取
      var info = this.getActiveKeyInfo(provider);
      return info?.name || '';
    } catch(e) {
      console.error('[AI-APIKey] 获取 Key 名称失败:', e);
      return '';
    }
  };

  /**
   * 标记当前 Key 失败并切换到下一个（自动轮询）
   * @param {string} provider - 服务商 ('tongyi' | 'zhipu' | 'fangzhou')
   * @returns {string} 下一个可用的 API Key，如果没有则返回空字符串
   */
  AiApiKeyManager.prototype.rotateToNextKey = function(provider) {
    try {
      var saved = localStorage.getItem('ai_ocr_settings');
      if (!saved) return '';

      var settings = JSON.parse(saved);
      var keys = settings.apiKeys?.[provider] || [];

      if (keys.length <= 1) {
        console.warn('[AI-APIKey] ' + provider + ' 只有 ' + keys.length + ' 个 Key，无法轮询');
        return this.getActiveApiKey(provider);
      }

      var currentIndex = settings.activeKeyIndex?.[provider] || 0;
      var nextIndex = (currentIndex + 1) % keys.length;

      // 更新激活索引
      if (!settings.activeKeyIndex) {
        settings.activeKeyIndex = {};
      }
      settings.activeKeyIndex[provider] = nextIndex;

      // 保存设置
      localStorage.setItem('ai_ocr_settings', JSON.stringify(settings));

      // 同步更新旧格式（兼容性）
      var nextKey = keys[nextIndex];
      localStorage.setItem(
        provider === 'tongyi' ? 'ai_parser_qwen_key' : (provider === 'zhipu' ? 'ai_parser_zhipu_key' : 'ai_parser_fangzhou_key'),
        nextKey || ''
      );

      console.log('[AI-APIKey] 🔁 ' + provider + ' Key 轮询: #' + (currentIndex + 1) + ' → #' + (nextIndex + 1));

      // 触发 storage 事件通知其他组件
      window.dispatchEvent(new StorageEvent('storage', {
        key: provider === 'tongyi' ? 'ai_parser_qwen_key' : (provider === 'zhipu' ? 'ai_parser_zhipu_key' : 'ai_parser_fangzhou_key'),
        newValue: nextKey
      }));

      return nextKey || '';
    } catch(e) {
      console.error('[AI-APIKey] Key 轮询失败:', e);
      return '';
    }
  };

  /**
   * 获取所有 API Keys（用于调试）
   * @param {string} provider - 服务商 ('tongyi' | 'zhipu' | 'fangzhou')
   * @returns {Object} { keys: string[], activeIndex: number }
   */
  AiApiKeyManager.prototype.getAllApiKeys = function(provider) {
    try {
      var saved = localStorage.getItem('ai_ocr_settings');
      if (saved) {
        var settings = JSON.parse(saved);
        return {
          keys: settings.apiKeys?.[provider] || [],
          activeIndex: settings.activeKeyIndex?.[provider] || 0
        };
      }
      return { keys: [], activeIndex: 0 };
    } catch(e) {
      console.error('[AI-APIKey] 获取所有 Keys 失败:', e);
      return { keys: [], activeIndex: 0 };
    }
  };

  // ===== 注册到全局 =====
  window.AiApiKeyManager = new AiApiKeyManager();

  console.log('[AI-APIKey] ========================================');
  console.log('[AI-APIKey] API Key 管理器已加载（多 Key 版本）');
  console.log('[AI-APIKey] 支持提供商: 阿里云百炼大模型、智谱 GLM、方舟大模型');
  console.log('[AI-APIKey] 功能: 多 Key 管理 · 自动轮询 · 向后兼容');
  console.log('[AI-APIKey] ========================================');

})();
