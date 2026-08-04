# 桌面APP自动化脚本引擎 — 开发规划案

> **版本**: v1.0  
> **日期**: 2026-07-07  
> **项目**: 无限空间·AI智控台

---

## 目录

1. [项目目标与核心概念](#1-项目目标与核心概念)
2. [定位点系统 — 数据结构](#2-定位点系统--数据结构)
3. [通用工具一：录制定位点工具](#3-通用工具一录制定位点工具)
4. [通用工具二：回放与数据查看工具](#4-通用工具二回放与数据查看工具)
5. [通用工具三：自动化脚本设定作业](#5-通用工具三自动化脚本设定作业)
6. [网点卡片与通用工具的绑定机制](#6-网点卡片与通用工具的绑定机制)
7. [浮动视窗自动执行脚本](#7-浮动视窗自动执行脚本)
8. [JXA 脚本解释器](#8-jxa-脚本解释器)
9. [自然语言解析器](#9-自然语言解析器)
10. [数据存储方案](#10-数据存储方案)
11. [开发阶段划分](#11-开发阶段划分)
12. [已知风险与对策](#12-已知风险与对策)
13. [附录：现有代码映射表](#附录现有代码映射表)

---

## 1. 项目目标与核心概念

### 1.1 现状问题

目前无限空间·AI智控台中，**桌面APP自动化操作（如千问A、豆包A）的 JXA 脚本全部写死在 main.js 中**。每新增一个 APP，就需要修改 `ipcMain.handle` 函数、手写大段 JXA 代码、调整坐标比例参数。这导致：

- 代码难以维护 — 同类操作在多个函数中重复（如「移动游标+点击」在至少6处重复）
- 新增APP成本高 — 每个APP都需要单独开发、调试 JXA 脚本
- 调试不直观 — 坐标用 `w*0.5, h*0.7` 等比例表达，难以理解
- 无法灵活调整 — 修改操作流程必须改代码并重启应用

### 1.2 目标

> **将所有 JXA 自动化操作从「写死代码」改为「数据驱动脚本」**。用户通过简单的自然语言描述操作流程，系统自动解析为结构化指令并执行。新增APP只需校准定位点 + 编写脚本，无需改动 `main.js`。

### 1.3 三个核心概念

| 概念 | 说明 | 类比 |
|---|---|---|
| **定位点 (Anchor)** | APP画面上的固定坐标位置，相对于窗口左上角的偏移量。每张卡片保存最多10个定位点 | 地图上的「地标」 |
| **操作指令 (Action)** | 一条原子操作，如「移到定位点N」「按键盘Cmd+V」「滚动向下N次」 | 动作指令 |
| **脚本 (Script)** | 由多条操作指令组成的有序序列，完成一个完整的自动化任务 | 操作说明书 |

---

## 2. 定位点系统 — 数据结构

### 2.1 定位点定义

每个桌面APP类型的网点卡片拥有**10个独立定位点**，存储相对于窗口左上角的偏移坐标。校准时用户将游标放到目标位置，系统自动换算为偏移量并保存。

| 编号 | 默认用途 | 备注 |
|---|---|---|
| 定位点1 | 窗口正中心 | 点击获取焦点 |
| 定位点2 | 输入框区域 | 粘贴消息前点击 |
| 定位点3 | 「复制」按钮 | 悬停弹出菜单 |
| 定位点4 | 「复制为Markdown」菜单项 | 点击执行复制 |
| 定位点5 | 输入区恢复焦点 | 操作完后点回输入区 |
| 定位点6 | 预留 | 用户自定义 |
| 定位点7 | 预留 | 用户自定义 |
| 定位点8 | 预留 | 用户自定义 |
| 定位点9 | 预留 | 用户自定义 |
| 定位点10 | 预留 | 用户自定义 |

### 2.2 坐标换算公式

```javascript
// 保存时（校准工具）：
偏移坐标 = 游标屏幕坐标 - 窗口左上角屏幕坐标

// 执行时（脚本解释器）：
实际屏幕坐标 = 窗口当前左上角屏幕坐标 + 定位点偏移坐标

// 举例：
// 校准时窗口在(1150, 160)，游标在(1450, 680)
// → 定位点N = (300, 520)
// 执行时窗口移动到(500, 100)
// → 实际点击坐标 = (500+300, 100+520) = (800, 620)
```

### 2.3 JSON 数据结构

```json
{
  "anchors": [
    { "id": 1, "name": "窗口中心",   "offsetX": 475, "offsetY": 460, "enabled": true },
    { "id": 2, "name": "输入框",     "offsetX": 300, "offsetY": 520, "enabled": true },
    { "id": 3, "name": "复制按钮",   "offsetX": 820, "offsetY": 110, "enabled": true },
    { "id": 4, "name": "Markdown项", "offsetX": 820, "offsetY": 165, "enabled": true },
    { "id": 5, "name": "输入区焦点", "offsetX": 300, "offsetY": 736, "enabled": true },
    { "id": 6, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 7, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 8, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 9, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id":10, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false }
  ],
  "window": {
    "width": 950,
    "height": 920,
    "x": 0,
    "y": 0
  }
}
```

---

## 3. 通用工具一：录制定位点工具

### 3.1 用途

替代现有代码中的 `desktop-app-calibrate-copy-btn`（校准坐标法）。用户依次将游标放到APP画面上的目标位置，系统读取坐标并保存为定位点偏移量。

### 3.2 操作流程

```
用户点击「校准(坐标法)」
    ↓
系统开启目标APP
    ↓
读取窗口位置与大小
    ↓
弹出校准面板
    ↓
用户选择要校准的定位点（1~10任选）
    ↓
系统提示：5秒内将游标移到目标位置
    ↓
用户移动游标 → 5秒倒计时结束
    ↓
系统读取游标屏幕坐标
    ↓
换算：偏移 = 游标坐标 - 窗口位置
    ↓
保存到卡片的 anchors 数据
    ↓
继续校准下一个？（是/否）
    ↓
校准完成
```

### 3.3 功能规格

| 功能点 | 规格说明 |
|---|---|
| 校准入口 | APP 菜单中的「校准(坐标法)」菜单项 |
| 定位点选择 | 面板中显示10个定位点编号，用户勾选要校准的点位 |
| 倒计时 | 每个点位给予 5 秒时间移动游标 |
| 坐标读取 | 用 `$.NSEvent.mouseLocation` + `$.NSScreen.mainScreen.frame.size.height` 做坐标系转换 |
| 实时反馈 | 校准面板上用绿色/红色指示当前点位是否已校准 |
| 点位命名 | 每个定位点可由用户自定义名称（默认用途名可编辑） |
| 批量校准 | 支持一次勾选多个点位，依次连续校准 |
| 数据保存 | 校准结果即时保存到卡片的 `anchors` 字段，无需手动保存 |

### 3.4 UI 布局

> **校准面板设计**：在卡片工作区中弹出一个模态面板，左侧显示10个定位点列表（编号 + 名称 + 启用状态），右侧显示当前选中的定位点的偏移坐标值和编辑按钮。底部有「开始校准」「完成」按钮。校准过程中，对应点位高亮并显示倒计时进度条。

---

## 4. 通用工具二：回放与数据查看工具

### 4.1 用途

替代现有代码中的 `desktop-app-replay-calibration`。让用户肉眼确认每个定位点是否指向正确的画面位置。

### 4.2 功能规格

#### 4.2.1 定位点回放

| 功能点 | 规格说明 |
|---|---|
| 入口 | APP 菜单中的「回放定位点」菜单项 |
| 回放方式 | 开启APP → 依次将游标移到每个已启用的定位点上 → 每个停留 2 秒 |
| 游标标记 | 可选：在每个定位点上短暂显示一个醒目的标记圆圈 |
| 支持部分回放 | 用户可勾选要回放的定位点（不必全部回放） |
| 中断 | 用户按 ESC 可立即中断回放 |

#### 4.2.2 定位点数据查看

| 功能点 | 规格说明 |
|---|---|
| 入口 | APP 菜单中的「定位点数据」菜单项 |
| 显示内容 | 10个定位点的编号、名称、偏移坐标(offsetX, offsetY)、启用状态 |
| 编辑功能 | 直接修改偏移坐标值、修改名称、启用/禁用点位 |
| 预览 | 鼠标悬停在某个点位上时，在APP画面上显示预计位置 |
| 导入/导出 | 支持将定位点数据导出为 JSON，或从 JSON 导入（便于跨卡片复制配置） |

### 4.3 回放流程

```
用户点击「回放定位点」
    ↓
显示点位选择面板
    ↓
用户选择要回放的点位
    ↓
开启目标APP
    ↓
设定窗口大小和位置
    ↓
移到第1个选中的定位点 → 游标停留2秒 + 显示标记
    ↓
移到下一个定位点 → 停留2秒
    ↓
...循环直到全部回放完毕
    ↓
回放完成
```

---

## 5. 通用工具三：自动化脚本设定作业

### 5.1 用途

新增的通用工具。用户用**自然语言编写操作脚本**，系统解析并保存为结构化 JSON。替代目前写死在 `main.js` 中的 JXA 脚本。

### 5.2 脚本编辑器 UI

> **脚本编辑面板**：在卡片工作区中提供「脚本设定」入口，打开一个文本编辑区域（类textarea），用户在左侧写入自然语言脚本，右侧实时显示解析后的结构化 JSON 预览。底部有「解析」「测试」「保存」按钮。

### 5.3 自然语言指令集

系统支持以下自然语言指令格式：

| 自然语言写法 | 指令类型 | 参数 | 对应的 JXA 操作 |
|---|---|---|---|
| `开启APP` | `activateApp` | — | `app.activate()` |
| `设定窗口大小为 WxH` | `setWindow` | width, height | `win.size = [W, H]` |
| `将窗口移到屏幕 X, Y` | `setWindowPos` | x, y | `win.position = [X, Y]` |
| `将游标移到 定位点N，按一下鼠标左键` | `moveAndClick` | anchorId | `CGWarpMouseCursorPosition` + `LeftMouseDown/Up` |
| `将游标移到 定位点N，停 N 秒` | `moveAndHover` | anchorId, duration | `CGWarpMouseCursorPosition` + `delay` + `MouseMoved` |
| `将游标移到 定位点N，滚动画面内容向下 N 次` | `moveAndScroll` | anchorId, times | `CGWarpMouseCursorPosition` + `ScrollWheelEvent` x N |
| `按键盘 Cmd+A` | `keystroke` | key, modifiers | `se.keystroke("a", {using:["command down"]})` |
| `按键盘 Enter` | `keystroke` | key | `se.keystroke(String.fromCharCode(13))` |
| `按键盘 ESC` | `keystroke` | key | `se.keystroke(String.fromCharCode(27))` |
| `按键盘 Shift+Tab` | `keystroke` | key, modifiers | `se.keystroke('\t', {using:'shift down'})` |
| `等待 N 秒` | `delay` | seconds | `delay(N)` |
| `粘贴剪贴板内容` | `clipboardPaste` | — | `se.keystroke('v', {using:'command down'})` |
| `复制选中内容到剪贴板` | `clipboardCopy` | — | `se.keystroke('c', {using:'command down'})` |

### 5.4 脚本示例

#### 示例 A：千问A — 发送消息并复制为Markdown

```
# 千问A 发送消息并获取回答
开启APP
设定窗口大小为 950×920
将游标移到 定位点2 的坐标上，按一下鼠标左键
按键盘 Cmd+A
按键盘 Cmd+V
按键盘 Enter
等待 15 秒
将游标移到 定位点1 的坐标上，按一下鼠标左键
将游标移到 定位点1 的坐标上，滚动画面内容向下 20 次
将游标移到 定位点3 的坐标上，停 1.2 秒
将游标移到 定位点4 的坐标上，按一下鼠标左键
将游标移到 定位点5 的坐标上，按一下鼠标左键
```

#### 示例 B：豆包A — 发送消息并复制回答（无复制为Markdown菜单）

```
# 豆包A 发送消息并获取回答
开启APP
设定窗口大小为 950×920
将游标移到 定位点2 的坐标上，按一下鼠标左键
按键盘 Cmd+A
按键盘 Cmd+V
按键盘 Enter
等待 15 秒
将游标移到 定位点1 的坐标上，按一下鼠标左键
将游标移到 定位点1 的坐标上，滚动画面内容向下 20 次
按键盘 Shift+Tab
按键盘 Cmd+A
按键盘 Cmd+C
按键盘 Tab
按键盘 ESC
```

#### 示例 C：千问A — 一键复制为Markdown（不发消息）

```
# 一键复制为Markdown
开启APP
设定窗口大小为 950×920
将游标移到 定位点1 的坐标上，按一下鼠标左键
将游标移到 定位点1 的坐标上，滚动画面内容向下 20 次
将游标移到 定位点3 的坐标上，停 1.2 秒
将游标移到 定位点4 的坐标上，按一下鼠标左键
将游标移到 定位点5 的坐标上，按一下鼠标左键
```

### 5.5 解析后的 JSON 结构

```json
{
  "name": "发送消息并复制为Markdown",
  "steps": [
    { "action": "activateApp" },
    { "action": "setWindow", "width": 950, "height": 920 },
    { "action": "moveAndClick", "anchorId": 2 },
    { "action": "keystroke", "key": "a", "modifiers": ["command"] },
    { "action": "keystroke", "key": "v", "modifiers": ["command"] },
    { "action": "keystroke", "key": "enter" },
    { "action": "delay", "seconds": 15 },
    { "action": "moveAndClick", "anchorId": 1 },
    { "action": "moveAndScroll", "anchorId": 1, "times": 20 },
    { "action": "moveAndHover", "anchorId": 3, "duration": 1.2 },
    { "action": "moveAndClick", "anchorId": 4 },
    { "action": "moveAndClick", "anchorId": 5 }
  ]
}
```

### 5.6 每张卡片支持多套脚本

> **设计要点**：每张卡片不只有一套脚本，而是支持**命名脚本列表**。例如千问A可以有：
>
> - `发送并获取回答` — 点击「发送」按钮时执行
> - `复制为Markdown` — 点击APP菜单「复制为Markdown」时执行
> - `只发送不获取回答` — 特殊场景使用

```json
{
  "scripts": [
    { "id": "send-and-copy", "name": "发送并获取回答", "trigger": "send", "steps": [...] },
    { "id": "copy-markdown", "name": "复制为Markdown", "trigger": "copyMarkdown", "steps": [...] },
    { "id": "send-only", "name": "只发送", "trigger": "manual", "steps": [...] }
  ]
}
```

---

## 6. 网点卡片与通用工具的绑定机制

### 6.1 绑定关系

```
网点卡片（如千问A）
    │
    ├── APP 菜单按钮
    │     ├── 开启APP                  → 执行 trigger=activate 的脚本
    │     ├── 移动游标到中间           → 执行 moveAndHover(定位点1)
    │     ├── 校准(坐标法)             → 工具一：录制定位点
    │     ├── 回放定位点               → 工具二：回放与查看
    │     ├── 定位点数据               → 工具二：回放与查看
    │     ├── 脚本设定                 → 工具三：脚本设定
    │     ├── 测试脚本                 → 工具三：脚本设定
    │     └── 复制为Markdown           → 执行 trigger=copyMarkdown 的脚本
    │
    ├── 卡片专属数据
    │     ├── anchors（10个定位点）
    │     ├── scripts（多套脚本）
    │     └── window（窗口设定）
    │
    └── 浮动视窗「发送」按钮           → 执行 trigger=send 的脚本
```

### 6.2 APP 菜单改造

| 现有菜单项 | 改造后 | 绑定的工具/脚本 |
|---|---|---|
| 开启APP | 保留不变 | 直接调用 activateApp |
| 移动游标到中间 | 保留不变 | 直接调用 moveAndHover(定位点1) |
| 复制为Markdown（旧） | 脚本执行（新） | 执行 trigger=copyMarkdown 的脚本 |
| 校准(坐标法)（旧） | 录制定位点（新） | 工具一 |
| —（不存在） | 回放定位点（新增） | 工具二 |
| —（不存在） | 定位点数据（新增） | 工具二 |
| —（不存在） | 脚本设定（新增） | 工具三 |
| —（不存在） | 测试脚本（新增） | 工具三 |

### 6.3 双向感知机制

| 感知方向 | 机制 | 场景举例 |
|---|---|---|
| **工具 → 卡片** | 工具通过传入的卡片 index 读取卡片数据（anchors、scripts、window） | 校准工具保存定位点时，写入对应卡片的 anchors |
| **卡片 → 工具** | 卡片菜单点击时，将自身 index 传给工具函数 | 点击「回放定位点」时，传入卡片 index，工具读取该卡片的 anchors |
| **脚本 → 定位点** | 脚本中引用「定位点N」时，解释器从卡片的 anchors 中查找对应坐标 | 脚本第8步「移到定位点3」，解释器查 anchors[2] 的 offsetX/offsetY |
| **脚本 → 窗口设定** | 脚本中引用「设定窗口大小」时，从卡片的 window 字段读取 | 脚本第2步「设定窗口大小为950x920」 |

---

## 7. 浮动视窗自动执行脚本

### 7.1 现有流程

浮动视窗的「发送」按钮触发 `crawlBookmarkByIndex()` → 判断 `cardType === 'desktop-app'` → 调用 `desktopAppAutoSend()` → 调用 `desktop-app-send-message` IPC → 执行写死的 JXA。

### 7.2 新流程

```
浮动视窗 点击发送
    ↓
crawlBookmarkByIndex
    ↓
判断 cardType
    ↓
├─ webview → 现有 webview 流程
│
└─ desktop-app → 查找 trigger=send 的脚本
                    ↓
                找到脚本？
                    ├─ 是 → JXA 脚本解释器
                    │         ↓
                    │       将脚本 steps 逐一翻译为 JXA
                    │         ↓
                    │       串行执行 JXA
                    │         ↓
                    │       返回执行结果
                    │         ↓
                    │       将回答追加到对话历史
                    │
                    └─ 否 → 提示用户先设定脚本
```

### 7.3 触发器机制

> **核心设计**：每套脚本有一个 `trigger` 字段，标识该脚本在什么场景下被自动调用。

| trigger 值 | 触发场景 | 说明 |
|---|---|---|
| `send` | 浮动视窗点击「发送」按钮 | 发送消息并获取回答 |
| `copyMarkdown` | APP菜单点击「复制为Markdown」 | 只复制不发送 |
| `activate` | APP菜单点击「开启APP」 | 开启APP的定制流程 |
| `manual` | 脚本设定面板中手动点击「测试」 | 不自动触发，仅手动执行 |

### 7.4 脚本执行时的参数注入

脚本执行时，系统自动注入以下变量：

```json
{
  "presetMessage": "阿勒泰有什么特色?",
  "clipboard": "(pbcopy 已预设)",
  "bundleName": "Qianwen",
  "cardIndex": 0
}
```

---

## 8. JXA 脚本解释器

### 8.1 架构

脚本解释器是一个**通用的 ipcMain.handle 函数**，接收卡片的 anchors + scripts 数据，将 steps 数组逐一翻译为 JXA 代码并串行执行。

```
输入：脚本 JSON + 定位点数据 + 窗口数据
    ↓
JXA 代码生成器
    ↓
完整 JXA 脚本字符串
    ↓
osascript -l JavaScript -e
    ↓
执行结果
```

### 8.2 解释器函数签名

```javascript
ipcMain.handle('run-automation-script', async (event, data) => {
  // data = {
  //   appName: "Qianwen",
  //   anchors: [...],
  //   window: { width, height, x, y },
  //   steps: [
  //     { action: "activateApp" },
  //     { action: "moveAndClick", anchorId: 2 },
  //     { action: "keystroke", key: "a", modifiers: ["command"] },
  //     ...
  //   ]
  // }
});
```

### 8.3 每种 action 的 JXA 代码生成规则

| action | 生成的 JXA 代码片段 |
|---|---|
| `activateApp` | `var app = Application(bundleName); app.activate(); delay(0.5); var se = Application('System Events'); var proc = se.processes.byName(bundleName); proc.frontmost = true; delay(0.3);` |
| `setWindow` | `var win = proc.windows[0]; win.size = [W, H]; delay(0.3);` |
| `moveAndClick` | `var winPos = win.position(); var winSize = win.size(); var targetX = winPos[0] + offsetX; var targetY = winPos[1] + offsetY; var pt = $.CGPointMake(targetX, targetY); $.CGWarpMouseCursorPosition(pt); delay(0.2); var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap, down); delay(0.1); var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap, up); delay(0.3);` |
| `moveAndHover` | 移到定位点 + MouseMoved 模拟事件 + delay(duration) |
| `moveAndScroll` | 移到定位点 + CGEventCreateScrollWheelEvent x times |
| `keystroke` | `se.keystroke(key, { using: modifiers }); delay(0.5);` |
| `delay` | `delay(seconds);` |

### 8.4 公共 JXA 前置代码

以下代码在每个脚本执行前自动注入，无需用户编写：

```javascript
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
var app = Application('${bundleName}');
app.activate();
delay(0.5);
var se = Application('System Events');
var proc = se.processes.byName('${bundleName}');
proc.frontmost = true;
delay(0.3);

// 等待窗口加载
var win = null;
for (var retry = 0; retry < 20; retry++) {
  try { win = proc.windows[0]; if (win) break; } catch(e) {}
  delay(0.3);
}
if (!win) { 'error: 无法获取窗口'; }
```

---

## 9. 自然语言解析器

### 9.1 解析策略

采用**关键词规则引擎 + 正则匹配**，不依赖 LLM，确保离线可用、确定性高。

### 9.2 解析规则（按优先级排序）

```javascript
// 规则1: 开启APP
/^开启APP$/
  →  { action: "activateApp" }

// 规则2: 设定窗口大小
/设定窗口大小为\s*(\d+)\s*[x×]\s*(\d+)/
  →  { action: "setWindow", width: $1, height: $2 }

// 规则3: 将窗口移到
/将窗口移到屏幕\s*(\d+)\s*[,，]\s*(\d+)/
  →  { action: "setWindowPos", x: $1, y: $2 }

// 规则4: 移到定位点 + 按左键
/将游标移到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*按一下鼠标左键/
  →  { action: "moveAndClick", anchorId: $1 }

// 规则5: 移到定位点 + 停N秒
/将游标移到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*停\s*([\d.]+)\s*秒/
  →  { action: "moveAndHover", anchorId: $1, duration: parseFloat($2) }

// 规则6: 移到定位点 + 滚动向下N次
/将游标移到\s*定位点(\d+)\s*[的]?坐标上[，,]?\s*滚动画面内容向下\s*(\d+)\s*次/
  →  { action: "moveAndScroll", anchorId: $1, times: parseInt($1) }

// 规则7: 按键盘 组合键
/按键盘\s*(Cmd|Shift|Ctrl|Alt)\+([\w]+)/
  →  { action: "keystroke", key: $2.toLowerCase(), modifiers: [$1_map] }

// 规则8: 按键盘 单键
/按键盘\s*(Enter|ESC|Tab|Space)/
  →  { action: "keystroke", key: $1_keyMap }

// 规则9: 等待N秒
/等待\s*([\d.]+)\s*秒/
  →  { action: "delay", seconds: parseFloat($1) }

// 规则10: 注释行
/^\s*#/  →  跳过（不生成指令）

// 规则11: 空行
/^\s*$/  →  跳过
```

### 9.3 解析错误处理

| 错误类型 | 处理方式 |
|---|---|
| 无法匹配的行 | 在解析预览中用红色标注该行，提示用户检查语法 |
| 引用了未校准的定位点 | 橙色警告，提示「定位点N尚未校准，执行时将跳过」 |
| 参数格式错误 | 红色标注，提示具体错误原因（如「停 N 秒」中N不是数字） |
| 缺少必需参数 | 红色标注，提示缺少什么参数 |

---

## 10. 数据存储方案

### 10.1 存储位置

所有数据保存在 Electron 的 `userData` 目录下：

```
~/Library/Application Support/无限空间·AI智控台/

automation/
  cards/
    card_0.json          # 千问A 的完整配置
    card_1.json          # 豆包A 的完整配置
    card_2.json          # 其他APP...
  templates/
    copy_btn.png         # 图像识别模板（兼容旧方案）
    md_item.png
  export/                # 导出的 JSON 文件
```

### 10.2 单张卡片完整 JSON 结构

```json
{
  "index": 0,
  "name": "千问A",
  "appName": "Qianwen",
  "bundleName": "Qianwen",
  "type": "desktop-app",

  "window": {
    "width": 950,
    "height": 920,
    "x": 0,
    "y": 0
  },

  "anchors": [
    { "id": 1, "name": "窗口中心",   "offsetX": 475, "offsetY": 460, "enabled": true },
    { "id": 2, "name": "输入框",     "offsetX": 300, "offsetY": 520, "enabled": true },
    { "id": 3, "name": "复制按钮",   "offsetX": 820, "offsetY": 110, "enabled": true },
    { "id": 4, "name": "Markdown项", "offsetX": 820, "offsetY": 165, "enabled": true },
    { "id": 5, "name": "输入区焦点", "offsetX": 300, "offsetY": 736, "enabled": true },
    { "id": 6, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 7, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 8, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 9, "name": "预留",       "offsetX":   0, "offsetY":   0, "enabled": false },
    { "id": 10, "name": "预留",      "offsetX":   0, "offsetY":   0, "enabled": false }
  ],

  "scripts": [
    {
      "id": "send-and-copy",
      "name": "发送并获取回答",
      "trigger": "send",
      "naturalText": "# 千问A 发送消息并获取回答\n开启APP\n...",
      "steps": [
        { "action": "activateApp" },
        { "action": "setWindow", "width": 950, "height": 920 },
        { "action": "moveAndClick", "anchorId": 2 },
        { "action": "keystroke", "key": "a", "modifiers": ["command"] },
        { "action": "keystroke", "key": "v", "modifiers": ["command"] },
        { "action": "keystroke", "key": "enter" },
        { "action": "delay", "seconds": 15 },
        { "action": "moveAndClick", "anchorId": 1 },
        { "action": "moveAndScroll", "anchorId": 1, "times": 20 },
        { "action": "moveAndHover", "anchorId": 3, "duration": 1.2 },
        { "action": "moveAndClick", "anchorId": 4 },
        { "action": "moveAndClick", "anchorId": 5 }
      ]
    },
    {
      "id": "copy-markdown",
      "name": "复制为Markdown",
      "trigger": "copyMarkdown",
      "naturalText": "...",
      "steps": [...]
    }
  ],

  "imageTemplates": {
    "copyBtn": "templates/card_0_copy.png",
    "mdBtn": "templates/card_0_md.png"
  },

  "presetMessage": "阿勒泰有什么特色?",
  "url": "https://tongyi.aliyun.com/qianwen/"
}
```

---

## 11. 开发阶段划分

### 阶段 1：数据层 — 定位点系统与存储

| 项目 | 内容 |
|---|---|
| **目标** | 建立定位点数据结构、读写持久化 |
| **任务** | 定义 anchors JSON schema；实现读写文件（userData/automation/cards/card_N.json）；数据迁移（从现有 bookmarks 中的 copyBtnRatio/mdBtnRatio 迁移到新 anchors 格式） |
| **预估** | 1-2 天 |

### 阶段 2：JXA 解释器 — 核心引擎

| 项目 | 内容 |
|---|---|
| **目标** | 实现通用的 JXA 脚本解释器，接收 steps 数组生成并执行 JXA |
| **任务** | 新增 `run-automation-script` IPC handler；实现每种 action 的 JXA 代码生成函数；公共前置代码注入；错误处理与超时机制 |
| **预估** | 2-3 天 |

### 阶段 3：工具一 — 录制定位点

| 项目 | 内容 |
|---|---|
| **目标** | 用新的通用校准工具替代现有 `desktop-app-calibrate-copy-btn` |
| **任务** | 校准面板 UI（点位选择、倒计时、实时反馈）；校准逻辑（读取坐标、换算偏移、保存）；回退兼容（同时保留图像识别法作为备选） |
| **预估** | 1-2 天 |

### 阶段 4：工具二 — 回放与数据查看

| 项目 | 内容 |
|---|---|
| **目标** | 用新的回放工具替代现有 `desktop-app-replay-calibration` |
| **任务** | 回放功能（选择性回放、ESC中断）；数据查看面板（显示/编辑坐标、导入导出）；预览功能（悬停显示位置） |
| **预估** | 1-2 天 |

### 阶段 5：工具三 — 脚本设定

| 项目 | 内容 |
|---|---|
| **目标** | 实现自然语言脚本编辑器、解析器、测试执行 |
| **任务** | 自然语言解析器（正则规则引擎）；脚本编辑面板 UI（左侧文本 + 右侧 JSON 预览）；解析错误高亮；测试执行按钮；脚本列表管理（新增/删除/切换脚本）；将千问A和豆包A现有流程改写为脚本 |
| **预估** | 2-3 天 |

### 阶段 6：卡片绑定与菜单改造

| 项目 | 内容 |
|---|---|
| **目标** | 将三大工具集成到每张卡片的 APP 菜单中 |
| **任务** | APP 菜单下拉选项改造（新增菜单项、替换旧菜单项）；双向感知机制实现；浮动视窗「发送」按钮改用脚本引擎 |
| **预估** | 1-2 天 |

### 阶段 7：测试与优化

| 项目 | 内容 |
|---|---|
| **目标** | 端到端测试、性能优化、边界情况处理 |
| **任务** | 千问A 全流程测试；豆包A 全流程测试；窗口移动/缩放后的坐标准确性测试；解析器边界用例测试；旧数据迁移验证 |
| **预估** | 1-2 天 |

> **总计预估：9-16 个工作日**

---

## 12. 已知风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| APP 窗口结构更新后定位点失效 | 坐标偏移，点击不到目标 | 提供快速重新校准功能；支持一键回放验证；可导出定位点备份 |
| macOS 权限不足（辅助功能/Automation） | JXA 脚本无法执行 | 启动时检测权限状态；无权限时弹出引导提示；权限检查放在脚本执行前 |
| APP 窗口启动慢 | 获取不到窗口导致失败 | 保留现有的重试机制（最多20次 x 0.3秒 = 6秒）；可在脚本中插入额外的等待步骤 |
| 自然语言解析歧义 | 用户写法不在预设规则中 | 解析失败时明确提示哪些行未匹配；提供语法参考文档（内嵌在编辑面板中）；未来可扩展为 LLM 辅助解析 |
| 旧数据迁移兼容 | 现有的 copyBtnRatio/mdBtnRatio 数据需要迁移 | 编写迁移脚本自动转换；迁移后的旧字段保留但标记为 deprecated |
| 脚本执行中途失败 | 部分步骤执行、部分未执行 | 记录已执行到第几步；提供「从第N步继续」选项；重要操作前插入检查点 |
| JXA 串行脚本超时 | AI 回答时间超过预设等待时间 | 脚本中的等待步骤时间可配置；超时后返回错误但已执行的步骤结果保留 |

---

## 附录：现有代码映射表

以下表格列出本项目将替代的所有现有代码，供开发时参考。

| 现有 IPC Handler | 功能 | 新方案中的替代 |
|---|---|---|
| `desktop-app-send-message` | 发送消息到APP + 获取回答 | 脚本引擎 + trigger=send 的脚本 |
| `desktop-app-activate` | 开启APP | 脚本引擎 + activateApp action |
| `desktop-app-move-cursor` | 移动游标到窗口中间 | 脚本引擎 + moveAndHover(定位点1) |
| `desktop-app-move-copy-btn` | 移动游标到复制按钮 | 脚本引擎 + moveAndHover(定位点3) |
| `desktop-app-calibrate-copy-btn` | 校准复制按钮位置 | 工具一：通用录制定位点 |
| `desktop-app-replay-calibration` | 回放校准定位点 | 工具二：回放与数据查看 |
| `desktop-app-click-copy-markdown` | 一键复制为Markdown | 脚本引擎 + trigger=copyMarkdown 的脚本 |
| `desktop-app-copy-markdown-by-image` | 图像识别版复制为Markdown | 保留为备选方案 |
| `desktop-app-capture-template` | 采集模板图片 | 保留为备选方案 |
| `desktop-app-find-template` | 图像识别查找模板 | 保留为备选方案 |
| `desktop-app-get-ui-elements` | 获取UI元素列表 | 保留为调试工具 |

---

> **文档结束**