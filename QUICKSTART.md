# 🌌 无限空间·AI智控台 - 快速启动指南

## 环境要求

- macOS / Windows / Linux
- Node.js 18+
- Electron 28+

## 方法一：使用 npm 安装（推荐）

```bash
# 1. 进入项目目录
cd /Users/chincharles/myProgram/electron-crawler

# 2. 安装依赖
npm install

# 3. 启动应用
npm start
```

如果 Electron 下载较慢，可使用淘宝镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/
npm install --registry=https://registry.npmmirror.com
npm start
```

## 方法二：全局 Electron

```bash
npm install -g electron
electron .
```

## 开发模式

```bash
npm run dev
```

开发模式会自动打开主窗口和渲染进程的开发者工具。

## 首次使用五步法

1. **启动应用**：运行 `npm start`。
2. **添加网点**：点击「添加网点」，输入 AI 网页名称与 URL（如豆包、文心一言、Kimi）。
3. **绑定工作区**：点击网点卡片「发送」或在工作区标签页切换，将网点绑定到当前工作区。
4. **发送消息**：在卡片输入框或浮动视窗输入消息，按 `Enter` 或点击「发送」。
5. **抓取回复**：等待 AI 回复后，点击 webview 工具栏「获取」，或配置自动选择器实现自动抓取。

## 全局快捷键

| 快捷键 | 作用 |
|--------|------|
| `Shift + Cmd/Ctrl + F` | 唤起浮动视窗「卡片」页签 |
| `Shift + Cmd/Ctrl + G` | 唤起浮动视窗「通用」页签 |

## 工作区说明

- `MAIN` 为默认工作区。
- 可额外创建 `01` ~ `20` 共 20 个子工作区。
- 每个工作区独立保存绑定的网点、选择器、缩放模式。
- 切换工作区时自动恢复该工作区的网点设定。

## 排程功能

1. 打开「排程」面板。
2. 点击「新增排程」，输入执行指令、选择执行方式、设置延迟与优先级。
3. 保存后，排程会按设定时间自动执行，并可将结果通过邮件发送。

## HTTP API 快速测试

启动应用后，API 服务器默认在 `http://localhost:3000` 运行：

```bash
# 查看状态
curl http://localhost:3000/api/status

# 获取网点列表
curl http://localhost:3000/api/bookmarks

# 向第 0 个网点注入消息
curl -X POST http://localhost:3000/api/preview-bookmark/0 \
  -H 'Content-Type: application/json' \
  -d '{"presetMessage":"你好"}'
```

## 常见问题

### Q: 为什么 Electron 安装失败？
A: Electron 需要从 GitHub 下载二进制文件，国内网络可能不稳定。解决方法：使用淘宝镜像、使用 VPN、或手动下载 Electron 二进制文件。

### Q: 安装后如何验证？
A: 运行 `npx electron --version`，如果显示版本号说明安装成功。

### Q: 如何知道应用是否启动成功？
A: 启动后会打开标题为「无限空间·AI智控台 vX.Y.Z-N」的窗口，控制台会显示版本横幅与 API 服务器启动日志。

### Q: AI 网页无法自动注入消息？
A: 请确认：
- 网点已正确保存并预览；
- 网页已完全加载；
- 输入框可见且可交互；
- 如目标站有反自动化检测，可尝试「外部浏览器」模式。

---

**完整说明请查看 [README.md](./README.md)**
