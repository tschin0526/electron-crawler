#!/bin/bash
# 无限空间·AI智控台 - 一键启动脚本

echo "️ 正在启动无限空间·AI智控台..."
cd /Users/chincharles/myProgram/electron-crawler
# "$@" 透传命令行参数，例如 ./start.sh --todolist 只启动 TodoList
npx electron --no-sandbox . "$@"