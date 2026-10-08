"""本機版：同時提供靜態頁面與 /api。執行：python local_server.py，然後開 http://localhost:8000"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from lib.server import ApiHandler  # noqa: E402

STATIC = {"/", "/index.html", "/app.js", "/style.css"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        if self.path.startswith("/api/"):
            ApiHandler.do_GET(self)
        elif self.path.split("?")[0] in STATIC or self.path.startswith("/sample/PortfolioData_"):  # 只開放前端檔案，不暴露原始碼
            super().do_GET()
        else:
            self.send_error(404)

    _send_json = ApiHandler._send_json


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"本機版已啟動：http://localhost:{port}  （Ctrl+C 結束）")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
