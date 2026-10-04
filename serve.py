#!/usr/bin/env python3
"""开发用静态服务器：每个响应都带 Cache-Control: no-store，浏览器永远拿到最新的文件。

页面每次加载都会用 /v<时间戳>/src/... 这样的新路径去取脚本（见 index.html），
这里把 /v<数字>/ 前缀去掉再找文件，浏览器里缓存过的脚本永远不会被命中。
开发版面板里调的参数会 POST 到 /__tuning，存成项目根目录的 tuning.json（页面启动时读它当默认值）。

用法：python3 serve.py [端口，默认 8000]
"""
import functools
import json
import http.server
import os
import re
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def translate_path(self, path):
        return super().translate_path(re.sub(r'^/v\d+/', '/', path))

    def do_GET(self):
        # 不回 304：忽略浏览器的条件请求，总是给完整的新文件
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers:
                del self.headers[h]
        super().do_GET()

    # 开发面板把调好的参数存回项目里的 tuning.json（只接受本机发来的请求）
    def do_POST(self):
        if self.path.split('?')[0] != '/__tuning' or self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(403)
            return
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length < 200_000:
            self.send_error(400)
            return
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            self.send_error(400)
            return
        path = os.path.join(self.directory, 'tuning.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        self.send_response(204)
        self.end_headers()

    # 不发 Last-Modified，避免浏览器走条件缓存
    def send_header(self, keyword, value):
        if keyword.lower() == 'last-modified':
            return
        super().send_header(keyword, value)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'在伊犁草原放羊：http://localhost:{port}')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
