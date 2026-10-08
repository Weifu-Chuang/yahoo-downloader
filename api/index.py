"""Vercel 入口：/api/history 與 /api/validate 都由這個函式處理（路由在 lib/server.py）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.server import ApiHandler  # noqa: E402


class handler(ApiHandler):
    pass
