"""API 路由與 HTTP 處理器。Vercel 函式與本機伺服器共用同一份。"""
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from lib import core

STATUS = {
    "BAD_REQUEST": 400,
    "INVALID_SYMBOL": 404,
    "NO_DATA_IN_RANGE": 404,
    "YAHOO_BLOCKED": 503,
    "INTERNAL": 500,
}


def handle_request(raw_path: str):
    """回傳 (HTTP 狀態碼, 要轉成 JSON 的 dict)。純函式，方便測試。"""
    u = urlparse(raw_path)
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    route = u.path.rstrip("/")
    # Vercel 的 rewrite 會把路徑改成 /api/index，原本的路由放在查詢參數 _r
    if q.get("_r"):
        route = "/api/" + q.pop("_r").strip("/")
    try:
        if route.endswith("/api/history"):
            for k in ("symbol", "start", "end", "interval"):
                if not q.get(k):
                    raise core.CoreError("BAD_REQUEST", f"缺少參數：{k}")
            try:
                return 200, core.get_history(q["symbol"].strip(), q["start"], q["end"], q["interval"])
            except ValueError:
                raise core.CoreError("BAD_REQUEST", "日期格式必須是 YYYY-MM-DD")
        if route.endswith("/api/validate"):
            meta = core.get_meta(q.get("symbol", ""))
            return 200, {
                "valid": True,
                "name": meta["name"],
                "currency": meta["currency"],
                "exchange": meta["exchange"],
                "firstDate": meta["firstDate"],
            }
        return 404, {"error": "NOT_FOUND", "message": "找不到此 API"}
    except core.CoreError as e:
        body = {"error": e.code, "message": e.message}
        if route.endswith("/api/validate"):
            body["valid"] = False
        return STATUS.get(e.code, 500), body
    except Exception as e:  # 不讓例外洩漏成 HTML 錯誤頁
        return 500, {"error": "INTERNAL", "message": str(e)[:300]}


class ApiHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, body = handle_request(self.path)
        self._send_json(status, body)

    def _send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)
