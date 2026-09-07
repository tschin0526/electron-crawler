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
import os
import ssl
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

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
