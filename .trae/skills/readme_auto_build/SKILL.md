---
name: "readme_auto_build"
description: "Automatically generates a standard README.md for the project. Invoke when user says '生成readme', '写项目说明', '完善项目介绍', or similar requests."
---

# README Auto Build

This skill automatically generates a comprehensive README.md file for the project by analyzing its structure, dependencies, and configuration.

## Trigger Conditions

Invoke this skill when the user says any of the following (or similar):
- "生成readme" / "生成 README"
- "写项目说明"
- "完善项目介绍"
- "创建 README"
- "更新项目文档"

## Execution Steps

### Step 1: Gather Project Information

Collect the following information from the project:

1. **Project Structure**: Run `ls -la` and `find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100` to understand the directory layout.
2. **Package.json**: Read `package.json` to extract:
   - Project name and description
   - Scripts (start, build, test, dev, etc.)
   - Dependencies and devDependencies
   - Engine requirements
3. **Tech Stack**: Identify the technology stack from:
   - Dependencies in package.json
   - Config files (vite.config.*, webpack.config.*, tsconfig.json, etc.)
   - Source file extensions (.ts, .tsx, .js, .jsx, .vue, .py, etc.)
4. **Existing README**: Read the current `README.md` (if exists) to preserve any custom content.

### Step 2: Generate README Content

Generate a standard README with the following sections (in Chinese, matching user's language):

```markdown
# [项目名称]

[项目简介 - 一句话描述项目是什么、做什么的]

## 功能特性

- [主要功能1]
- [主要功能2]
- ...

## 技术栈

- [技术1]：用途说明
- [技术2]：用途说明
- ...

## 环境要求

- Node.js >= [版本]
- [其他依赖]

## 快速开始

### 安装依赖

\`\`\`bash
npm install
\`\`\`

### 启动开发环境

\`\`\`bash
npm run dev
\`\`\`

### 构建生产版本

\`\`\`bash
npm run build
\`\`\`

### 运行测试

\`\`\`bash
npm test
\`\`\`

## 项目结构

\`\`\`
project-root/
├── src/              # 源代码目录
│   ├── main/         # 主进程代码
│   ├── renderer/     # 渲染进程代码
│   ── preload/      # 预加载脚本
├── public/           # 静态资源
── package.json      # 项目配置
└── README.md         # 项目说明
\`\`\`

## 部署方式

[根据项目类型提供部署说明，如 Electron 打包、Web 部署等]

## 许可证

[License 信息]
```

### Step 3: Write to File

Write the generated content to `README.md` in the project root directory. If a README.md already exists, inform the user and ask whether to overwrite or append.

### Step 4: Report Result

Tell the user:
- README.md 已生成/更新
- 包含的主要章节
- 文件路径

## Notes

- Always generate content in Chinese (matching user's language preference)
- Base all information on actual project files, do not fabricate
- If package.json doesn't exist, adapt the README format accordingly
- Keep the README concise and practical, avoid unnecessary verbosity
