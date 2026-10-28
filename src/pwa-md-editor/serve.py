#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MD 编辑器 Lite —— 静态服务器（支持 HTTPS）

为什么要 HTTPS：
  iPhone Safari 只在「安全上下文」下注册 Service Worker。
  https://... 和 http://localhost 算安全上下文；http://192.168.x.x 不算，
  所以手机走局域网 HTTP 时 PWA 装不了、离线也用不了。

用法：
  python3 serve.py                     # HTTPS，默认 8443 端口（须先有 cert.pem/key.pem）
  python3 serve.py --port 9000         # 换端口
  python3 serve.py --http              # 强制纯 HTTP（仅调试，iPhone 无法装 PWA）
  python3 serve.py --bind 127.0.0.1    # 只本机

证书由 start.sh 用 mkcert 自动生成，无需手工干预。
"""

import argparse
import json
import os
import ssl
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# 🆕 桌面版主程式的插件数据目录（PLUGINS_DATA_DIR）：
#   main.js 里 PLUGINS_DATA_DIR = path.join(__dirname, '../data') → __dirname 是 electron-crawler/
#   → 往上一级到 myProgram/ → 拼 data → /Users/chincharles/myProgram/data/
#   注意：不是 electron-crawler/data/！差了一层！
PLUGINS_DATA_DIR = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'data'))   # src/pwa-md-editor → 3 级上到 myProgram/ → +data/
# calendar-dir.txt 放在 PLUGINS_DATA_DIR/data/ 下（与 sticky-notes-state.json 在同一 data 子目录层级）
CALENDAR_DIR_MARKER = os.path.join(PLUGINS_DATA_DIR, 'data', 'calendar-dir.txt')

def _resolve_rules_json_path():
    """解析 view-sticky-rules.json 的真实位置（跟 calendar.md 同目录）。"""
    # 1) 优先：主程式写的 calendar-dir.txt → 里面就是 calendar.md 的绝对目录
    try:
        if os.path.isfile(CALENDAR_DIR_MARKER):
            d = open(CALENDAR_DIR_MARKER, 'r', encoding='utf-8').read().strip()
            if d:
                cand = os.path.join(d, 'view-sticky-rules.json')
                if os.path.isfile(cand):
                    return cand
    except Exception:
        pass
    # 2) Fallback：PLUGINS_DATA_DIR/（旧档位置，或主程式还没写 marker）
    fallback = os.path.join(PLUGINS_DATA_DIR, 'view-sticky-rules.json')
    return fallback if os.path.isfile(fallback) else os.path.join(PLUGINS_DATA_DIR, 'view-sticky-rules.json')

def _resolve_vsr_js_path():
    """view-sticky-rules.js 引擎（纯 JS，从桌面版共享）。"""
    return os.path.abspath(os.path.join(HERE, '..', 'plugins', 'todolist', 'view-sticky-rules.js'))

# 🆕 跨目录共享资源的路径映射：LITE 版（纯浏览器）没有 Electron IPC，
#   但桌面版维护的 view-sticky-rules.json 和引擎 view-sticky-rules.js 都是纯档案，
#   通过静态服务器的特殊路由暴露给浏览器读取。
#   CROSS_PATHS 的值是「可调用」的 → 每次请求动态解析 calendar 目录。
CROSS_PATHS = {
    '/rules.json': lambda: _resolve_rules_json_path(),
    '/vsr.js': lambda: _resolve_vsr_js_path(),
}

# 补齐 / 修正 MIME，避免 Service Worker、manifest、图标被浏览器拒收
EXTRA_MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".md": "text/markdown",
    ".css": "text/css",
}


class NoCacheHandler(SimpleHTTPRequestHandler):
    """开发用：禁用 HTTP 缓存，改完代码刷新即生效。

    注意：这只影响网络层缓存，Service Worker 自己的 Cache Storage 不受影响，
    所以离线能力照常可测。
    """

    def do_GET(self):
        # 🆕 跨目录共享资源：/rules.json 和 /vsr.js 动态解析路径，
        #    其余路径走正常静态文件服务（基于 --dir 指定的目录）。
        clean = self.path.split('?', 1)[0].split('#', 1)[0]
        if clean in CROSS_PATHS:
            self._serve_cross_path(clean)
            return
        super().do_GET()

    def _serve_cross_path(self, url_path):
        """调用 CROSS_PATHS[url_path] 动态拿到绝对路径并返回。"""
        resolver = CROSS_PATHS[url_path]
        full = resolver() if callable(resolver) else resolver
        try:
            if not os.path.isfile(full):
                # 规则档案不存在 → 返回空 JSON 阵列（LITE 端能正常解析）
                if url_path == '/rules.json':
                    body = json.dumps({'version': 1, 'rules': []}).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.send_header('Cache-Control', 'no-store, must-revalidate')
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_error(404, 'Not Found: ' + full)
                return
            # 正常读取并返回
            with open(full, 'rb') as f:
                body = f.read()
            ctype = self.guess_type(url_path)
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Service-Worker-Allowed', '/')
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_error(500, 'Internal Error: ' + str(e))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_MIME:
            return EXTRA_MIME[ext]
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        # 缩短日志，别刷屏
        sys.stderr.write("  %s\n" % (fmt % args))


def build_server(bind, port, directory, use_https, cert, key):
    handler = partial(NoCacheHandler, directory=directory)
    httpd = ThreadingHTTPServer((bind, port), handler)
    httpd.daemon_threads = True

    if use_https:
        if not (os.path.isfile(cert) and os.path.isfile(key)):
            sys.exit(
                "[x] 找不到证书：%s / %s\n"
                "    请先执行 ./start.sh 让它自动生成，或指定 --http 走纯 HTTP。" % (cert, key)
            )
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certfile=cert, keyfile=key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    return httpd


def main():
    ap = argparse.ArgumentParser(description="MD 编辑器 Lite 静态服务器")
    ap.add_argument("--port", type=int, default=8443, help="HTTPS 端口（默认 8443）")
    ap.add_argument("--http-port", type=int, default=8080, help="HTTP 模式的端口（默认 8080）")
    ap.add_argument("--bind", default="0.0.0.0", help="绑定地址（默认 0.0.0.0，供局域网访问）")
    ap.add_argument("--http", action="store_true", help="纯 HTTP 模式")
    ap.add_argument("--dir", default=HERE, help="站点根目录")
    args = ap.parse_args()

    directory = os.path.abspath(args.dir)
    bind = args.bind
    port = args.http_port if args.http else args.port

    cert = os.path.join(directory, "cert.pem")
    key = os.path.join(directory, "key.pem")

    httpd = build_server(bind, port, directory, not args.http, cert, key)
    scheme = "http" if args.http else "https"
    print("[i] 服务目录：%s" % directory, flush=True)
    print("[i] 监听地址：%s://%s:%d" % (scheme, bind, port), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[i] 已停止")
