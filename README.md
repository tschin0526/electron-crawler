# 🌌 无限空间·AI智控台

基于 Electron 的桌面 AI 智控中枢，**无跨域限制**，可在一个窗口中同时管理多个 AI 服务、网页网点、桌面 APP 自动化、HTTP 数据接口与定时排程。

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| 🤖 多 AI 平台对话 | 支持豆包、文心一言、Kimi、DeepSeek、通义千问、智谱等网页版 AI 的自动注入与回复抓取 |
| 🌐 真实浏览器渲染 | 使用 Chromium webview，完整渲染 SPA，可绕过 CORS / X-Frame-Options / CSP |
| 🖥️ 多工作区 | MAIN + 20 个子工作区，每个工作区独立 webview、独立网点绑定、独立缩放模式 |
| ⚡ 浮动视窗 | 全局悬浮输入面板，支持「卡片 / 通用 / 历史」三页签，全局快捷键 `Shift+Cmd/Ctrl+F` / `G` 唤起 |
| 📅 定时排程 | 启动时执行、一次性、每日、每周、每月、每小时、间隔重复等多种触发方式 |
| 📧 邮件通知 | 通过邮件插件 + iCloud SMTP 自动发送 AI 回复，独立发送历史 |
| 🖱️ 桌面 APP 自动化 | 基于 RobotJS / Koffi 的窗口激活、定位点录制、脚本回放、图像识别 |
| 📊 HTTP 数据接口 | 内置股票行情（腾讯/新浪/台股）等 API 调用与 Markdown 渲染 |
| 🔌 插件系统 | 邮件、HTTP-Get、待办清单等插件，通过本地 webview 加载 |
| 🌐 HTTP API | 端口 `3000`，供外部智控实验室调用：预览网点、注入消息、抓取回复、发送邮件 |

## 📁 项目结构

```
electron-crawler/
├── main.js                      # Electron 主进程入口
├── preload.js                   # 渲染进程安全 IPC 桥梁
├── package.json                 # 项目依赖与脚本
├── main-modules/                # 主进程功能模组
│   ├── api-server.js            # 内置 HTTP API 服务
│   ├── api-data.js              # HTTP 请求、编码转换、注入/抓取/格式化
│   ├── desktop-automation.js    # 桌面 APP 自动化（RobotJS/Koffi）
│   ├── ipc-storage.js           # 文件持久化、IPC 处理、插件数据
│   └── windows.js               # 窗口管理与辅助查看器
├── src/
│   ├── crawler-window.html      # 主窗口 UI
│   ├── renderer.js              # 渲染进程核心：工作区、webview 缩放、数据渲染
│   ├── modules/                 # 渲染进程模组
│   │   ├── bookmarks.js         # 网点卡片管理
│   │   ├── workspace.js         # 工作区切换与 webview 容器
│   │   ├── floating-window.js   # 浮动视窗（卡片/通用/历史）
│   │   ├── scheduler.js         # 排程任务管理
│   │   ├── capture.js           # 选择器策略与 AI 回复抓取
│   │   ├── ai-platforms.js      # 各 AI 平台自动发送适配
│   │   ├── http-get.js          # HTTP Get 执行与股票数据解析
│   │   ├── email.js             # 邮件发送与 Markdown 转 HTML
│   │   ├── desktop-app.js       # 桌面 APP 自动化 UI
│   │   └── utils.js             # 通用工具函数
│   ├── plugins/                 # 插件页面
│   │   ├── email/               # 邮件插件
│   │   ├── http-get/            # HTTP Get 展示插件
│   │   └── todolist/            # 待办清单插件
│   └── data/                    # 内置配置
│       └── stock-config.json    # 股票代码映射
├── docs/                        # 文档
│   └── scheduler-proposal.md    # 排程功能说明
├── scripts/                     # 辅助脚本
│   ├── capture_template.py      # 屏幕模板采集
│   └── find_template.py         # 屏幕模板查找
├── README.md                    # 本文件
├── QUICKSTART.md                # 快速启动指南
└── VERSION_LOG.md               # 版本更新日志
```

## 🚀 快速开始

```bash
# 1. 进入项目目录
cd /Users/chincharles/myProgram/electron-crawler

# 2. 安装依赖（国内建议使用淘宝镜像）
npm install

# 3. 启动应用
npm start

# 4. 开发模式（自动打开开发者工具）
npm run dev
```

## 📌 主要使用流程

1. **添加网点**：点击「添加网点」，保存常用 AI 网页或 HTTP 接口。
2. **选择工作区**：MAIN 或 01~20 子工作区，每个工作区可绑定不同网点。
3. **发送消息**：
   - 在卡片输入框输入消息后按 `Enter` / 点击「发送」；
   - 或使用全局快捷键 `Shift+Cmd/Ctrl+F` 唤起浮动视窗发送。
4. **抓取 AI 回复**：点击 webview 工具栏「获取」按钮，或配置自动监控选择器后由系统自动抓取。
5. **排程执行**：在排程面板新增任务，支持定时向指定 AI 发送消息并邮件通知结果。
6. **数据导出**：支持 JSON / CSV 导出爬取结果。

## 🔌 内置 HTTP API

应用启动后监听 `0.0.0.0:3000`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务状态 |
| GET | `/api/bookmarks` | 获取网点列表 |
| GET | `/api/current-service-card` | 当前识别到的服务卡片 |
| POST | `/api/preview-bookmark/{index}` | 预览指定网点 |
| POST | `/api/capture-element-content` | 抓取指定网点回复元素 |
| POST | `/api/inject-message-to-webview` | 向指定网点 webview 注入消息 |
| POST | `/api/send-email` | 发送邮件 |

## ⚙️ 关键配置

| 配置项 | 位置 | 说明 |
|--------|------|------|
| 网点数据 | `~/Library/Application Support/无限空间·AI智控台/bookmarks.json` | 用户保存的网点卡片 |
| 排程数据 | `项目目录/data/schedules.json` | 排程任务 |
| 排程日志 | `项目目录/data/scheduler-logs.json` | 执行日志 |
| 插件数据 | `项目目录/data/{plugin}.json` | 插件持久化数据 |
| 股票配置 | `src/data/stock-config.json` | 股票名称/代码映射 |

> 开发模式数据目录为 `项目目录/data/`；打包模式为应用包同级 `../data/`。

## 🛡️ 安全与合规

1. **合法使用**：请确保爬取与自动化行为符合目标网站的服务条款与 robots.txt。
2. **频率控制**：避免短时间内大量请求，以免对目标服务器造成压力。
3. **数据隐私**：不要爬取涉及隐私或敏感信息的数据。
4. **凭据管理**：SMTP 等敏感配置建议通过环境变量或外部配置文件管理，不要硬编码在源码中。

## 🐛 常见问题

### Q: 启动时提示 "Electron 未找到"
A: 请先运行 `npm install` 安装依赖。

### Q: 访问某些网站失败
A: 部分网站可能有反访问机制（验证码、IP 限制、浏览器检测），可尝试「外部浏览器」模式或在网点设置自定义 User-Agent / Referer。

### Q: 如何修改默认窗口大小
A: 编辑 `main-modules/windows.js`，修改 `createWindow()` 中的尺寸逻辑。

## 📝 版本日志

详见 [VERSION_LOG.md](./VERSION_LOG.md)。

## 📄 许可证

MIT License

---

**祝你使用愉快！** 🎉
