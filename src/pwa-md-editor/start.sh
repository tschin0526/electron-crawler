#!/usr/bin/env bash
# ==============================================================================
#  MD 编辑器 Lite —— 一键启动（含 iPhone Safari 使用说明）
#
#  用法：
#    ./start.sh                 启动 HTTPS 服务（局域网可访问，iPhone 能装 PWA）
#    ./start.sh --local         只本机访问（127.0.0.1）
#    ./start.sh --http          纯 HTTP 模式（iPhone 只能编辑，装不了 PWA）
#    ./start.sh --send-cert     打开 AirDrop 用的根证书（首次给 iPhone 装证书时用）
#    ./start.sh --trust-mac     把本地 CA 装进 Mac 信任库（消除 Mac 上的证书警告）
#    ./start.sh --port 9000     换端口
#
#  停止服务：Ctrl-C
# ==============================================================================

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT=8443
HTTP_PORT=8080
BIND="0.0.0.0"
MODE="https"

# Apple Silicon 的 Homebrew 不在默认 PATH 里，mkcert / qrencode 会找不到
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
MKCERT="/opt/homebrew/bin/mkcert"
[ -x "$MKCERT" ] || MKCERT="$(command -v mkcert || true)"

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_R=$'\033[0m'
C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'

# ---------------------------------------------------------------- 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)     BIND="127.0.0.1"; shift ;;
    --http)      MODE="http"; shift ;;
    --port)      PORT="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --send-cert)
      CA_DIR="$("$MKCERT" -CAROOT 2>/dev/null)"
      echo "${C_GREEN}请把 rootCA.pem 通过 AirDrop 传到 iPhone：${C_R}"
      echo "  $CA_DIR/rootCA.pem"
      open -R "$CA_DIR/rootCA.pem"
      exit 0
      ;;
    --trust-mac) "$MKCERT" -install; exit 0 ;;
    -h|--help)   sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1（用 --help 看用法）"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------- 局域网 IP
get_lan_ip() {
  for iface in en0 en1 en2 en3; do
    local ip; ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$ip" ] && { echo "$ip"; return; }
  done
  # 兜底：默认路由出口网卡
  route get default 2>/dev/null | awk '/interface:/{print $2}' | while read -r i; do
    ipconfig getifaddr "$i" 2>/dev/null || true
  done
}
LAN_IP="$(get_lan_ip | head -1)"

# ---------------------------------------------------------------- 证书准备
ensure_cert() {
  local need=0
  if [[ ! -f cert.pem || ! -f key.pem ]]; then
    need=1
  elif [[ -n "$LAN_IP" ]]; then
    # 路由器换了网段 / IP 变了 → 旧证书不含新 IP，必须重签。
    # 注意：macOS 自带的是 LibreSSL，不支持 `openssl x509 -ext`，只能用 -text + grep。
    openssl x509 -in cert.pem -noout -text 2>/dev/null \
      | grep -q "IP Address:${LAN_IP}" || need=1
  fi

  if [[ $need -eq 1 ]]; then
    if [[ -z "$MKCERT" ]]; then
      echo "${C_YELLOW}[!] 没装 mkcert，无法生成 HTTPS 证书，自动回退到 HTTP。${C_R}"
      echo "    装法：brew install mkcert"
      MODE="http"; return
    fi
    echo "${C_DIM}[i] 正在为 ${LAN_IP:-localhost} 签发本地证书...${C_R}"
    local names=(localhost 127.0.0.1 ::1)
    [[ -n "$LAN_IP" ]] && names+=("$LAN_IP")
    "$MKCERT" -cert-file cert.pem -key-file key.pem "${names[@]}" >/dev/null 2>&1 \
      || { echo "${C_YELLOW}[!] 证书签发失败，回退到 HTTP。${C_R}"; MODE="http"; }
  fi
}
[[ "$MODE" == "https" ]] && ensure_cert

# ---------------------------------------------------------------- 启动服务
if [[ "$MODE" == "https" ]]; then
  ACTUAL_PORT="$PORT"; SCHEME="https"
  SERVER_ARGS=(--port "$PORT" --bind "$BIND")
else
  ACTUAL_PORT="$HTTP_PORT"; SCHEME="http"
  SERVER_ARGS=(--http --http-port "$HTTP_PORT" --bind "$BIND")
fi

# 端口被占用就换一个
pick_free_port() {
  local p="$1"
  while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do
    p=$((p + 1))
  done
  echo "$p"
}
ACTUAL_PORT="$(pick_free_port "$ACTUAL_PORT")"
if [[ "$MODE" == "https" ]]; then
  SERVER_ARGS=(--port "$ACTUAL_PORT" --bind "$BIND")
else
  SERVER_ARGS=(--http --http-port "$ACTUAL_PORT" --bind "$BIND")
fi

PYBIN="$(command -v python3)"
LOG="$(mktemp -t pwa-server)"
"$PYBIN" serve.py "${SERVER_ARGS[@]}" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG"
  echo ""
  echo "${C_DIM}[i] 服务已停止${C_R}"
}
trap cleanup EXIT INT TERM

# 等服务起来
for _ in $(seq 1 40); do
  if curl -sk -o /dev/null --max-time 1 "${SCHEME}://127.0.0.1:${ACTUAL_PORT}/" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

# ---------------------------------------------------------------- 输出
LOCAL_URL="${SCHEME}://localhost:${ACTUAL_PORT}"
PHONE_URL="${SCHEME}://${LAN_IP:-<你的 Mac IP>}:${ACTUAL_PORT}"

clear 2>/dev/null || true
echo ""
echo "${C_BOLD}══════════════════════════════════════════════════════════════${C_R}"
echo "${C_BOLD}  MD 编辑器 Lite —— 服务已启动${C_R}"
echo "${C_BOLD}══════════════════════════════════════════════════════════════${C_R}"
echo ""
echo "  ${C_CYAN}电脑浏览器${C_R}      ${LOCAL_URL}"

if [[ "$BIND" == "0.0.0.0" ]]; then
echo "  ${C_CYAN}iPhone（同 WiFi）${C_R}  ${PHONE_URL}"
echo ""
# 二维码。qrencode 的 UTF8 模式用 ▀▄█ 实心块，任何终端都能看清；
# 没装 qrencode 才退回到 npx 方案。
if command -v qrencode >/dev/null 2>&1; then
  echo "  ${C_DIM}iPhone 相机扫这个二维码即可打开：${C_R}"
  qrencode -t UTF8 -m 1 "$PHONE_URL" 2>/dev/null | sed 's/^/  /'
elif command -v npx >/dev/null 2>&1; then
  QR="$(npx -y qrcode-terminal@0.12.0 "$PHONE_URL" 2>/dev/null || true)"
  if [[ -n "$QR" ]]; then
    echo "  ${C_DIM}iPhone 相机扫这个二维码即可打开：${C_R}"
    echo "$QR" | sed 's/^/  /'
  fi
fi
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "${C_BOLD}  iPhone Safari 首次配置（只需做一次，约 1 分钟）${C_R}"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  1) 把根证书传到 iPhone"
echo "     ${C_DIM}在本脚本同目录另开一个终端执行：${C_R}"
echo "     ${C_GREEN}./start.sh --send-cert${C_R}"
echo "     ${C_DIM}会自动弹出 Finder 并选中 rootCA.pem → 右键「共享 → AirDrop」到 iPhone${C_R}"
echo ""
echo "  2) iPhone 上安装并信任该证书（顺序不能反）"
echo "     ${C_DIM}设置 → 通用 → VPN 与设备管理 → 描述文件「mkcert …」→ 安装${C_R}"
echo "     ${C_DIM}设置 → 通用 → 关于本机 → 证书信任设置 → 打开「mkcert …」开关${C_R}"
echo "     ${C_YELLOW}※ 第 2 步不做的话，Safari 会拒绝注册 Service Worker，装不了 PWA${C_R}"
echo ""
echo "  3) iPhone Safari 打开  ${PHONE_URL}"
echo ""
echo "  4) 点底部「分享」→「添加到主屏幕」→ 得到独立 App 图标"
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "${C_BOLD}  以后每次使用（上面 4 步不用重做）${C_R}"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  1) 电脑上运行 ${C_GREEN}./start.sh${C_R}"
echo "  2) iPhone 点主屏幕图标直接用；${C_DIM}断网也能用（Service Worker 已缓存资源）${C_R}"
echo ""
else
echo "  ${C_DIM}当前是 --local 模式，只有这台 Mac 能访问，iPhone 连不上。${C_R}"
echo "  ${C_DIM}要让 iPhone 用，去掉 --local 重跑：${C_GREEN}./start.sh${C_R}"
echo ""
fi

if [[ "$MODE" == "http" ]]; then
  echo "${C_YELLOW}  ⚠ 当前是纯 HTTP 模式：iPhone 能编辑，但 Safari 不会注册 Service Worker，${C_R}"
  echo "${C_YELLOW}    无法「添加到主屏幕」，也没有离线能力。${C_R}"
  echo ""
fi

if [[ "$BIND" == "0.0.0.0" ]]; then
  echo "${C_DIM}  连不上？检查 Mac：系统设置 → 隐私与安全性 → 防火墙，允许 python3 接收传入连接。${C_R}"
  echo ""
fi

echo "${C_DIM}  停止服务：Ctrl-C     查看请求日志：tail -f $LOG${C_R}"
echo ""

wait "$SERVER_PID"
