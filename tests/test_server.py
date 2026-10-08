from lib import core, server


def test_missing_param():
    status, body = server.handle_request("/api/history?symbol=SPY")
    assert status == 400 and body["error"] == "BAD_REQUEST"


def test_bad_date_format():
    status, body = server.handle_request("/api/history?symbol=SPY&start=abc&end=2026-01-01&interval=1wk")
    assert status == 400 and body["error"] == "BAD_REQUEST"


def test_unknown_route():
    status, body = server.handle_request("/api/nope")
    assert status == 404


def test_invalid_symbol_maps_to_404(monkeypatch):
    def boom(symbol):
        raise core.CoreError("INVALID_SYMBOL", "查無代號：X")
    monkeypatch.setattr(core, "get_meta", boom)
    status, body = server.handle_request("/api/validate?symbol=X")
    assert status == 404 and body["valid"] is False and body["error"] == "INVALID_SYMBOL"


def test_validate_ok(monkeypatch):
    monkeypatch.setattr(core, "get_meta", lambda s: {
        "name": "3M", "currency": "USD", "exchange": "NYQ", "firstDate": "1962-01-02"})
    status, body = server.handle_request("/api/validate?symbol=MMM")
    assert status == 200 and body == {
        "valid": True, "name": "3M", "currency": "USD", "exchange": "NYQ", "firstDate": "1962-01-02"}


def test_blocked_maps_to_503(monkeypatch):
    def boom(*a, **k):
        raise core.CoreError("YAHOO_BLOCKED", "blocked")
    monkeypatch.setattr(core, "get_history", boom)
    status, body = server.handle_request("/api/history?symbol=SPY&start=2026-01-01&end=2026-02-01&interval=1wk")
    assert status == 503 and body["error"] == "YAHOO_BLOCKED"


def test_vercel_rewrite_route_param(monkeypatch):
    monkeypatch.setattr(core, "get_meta", lambda s: {
        "name": "3M", "currency": "USD", "exchange": "NYQ", "firstDate": None})
    status, body = server.handle_request("/api/index?_r=validate&symbol=MMM")
    assert status == 200 and body["valid"] is True
