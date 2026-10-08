"""核心邏輯測試：全部使用固定測試資料，不連網。"""
from datetime import date, datetime, timezone

import pandas as pd
import pytest

from lib import core
from lib.core import CoreError, resample_rows


def make_df(dates, closes=None, adj=None, vol=100):
    closes = closes or [100.0 + i for i in range(len(dates))]
    adj = adj or closes
    return pd.DataFrame(
        {"Close": closes, "Adj Close": adj, "Volume": [vol] * len(dates)},
        index=pd.DatetimeIndex(pd.to_datetime(dates)),
    )


def bdays(start, end):
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, end)]


# ---------------------------------------------------------------- 週（與雅虎一致：日期標第一個交易日、收盤取最後一個交易日）

def test_weekly_label_is_first_trading_day_monday_key():
    df = make_df(bdays("2026-08-17", "2026-08-28"))
    rows = resample_rows(df, "1wk", "2026-08-17", "2026-08-28")
    assert [r["date"] for r in rows] == ["2026-08-17", "2026-08-24"]
    assert [r["combinedKey"] for r in rows] == ["2026-08-17", "2026-08-24"]


def test_weekly_monday_holiday_label_is_tuesday_key_stays_monday():
    dates = [d for d in bdays("2026-08-17", "2026-08-28") if d != "2026-08-17"]
    rows = resample_rows(make_df(dates), "1wk", "2026-08-17", "2026-08-28")
    assert rows[0]["date"] == "2026-08-18"
    assert rows[0]["combinedKey"] == "2026-08-17"


def test_weekly_value_is_last_trading_day_of_week():
    df = make_df(
        bdays("2026-08-17", "2026-08-21"),
        closes=[10, 11, 12, 13, 14],
        adj=[9, 10, 11, 12, 13],
        vol=100,
    )
    (row,) = resample_rows(df, "1wk", "2026-08-17", "2026-08-21")
    assert row["date"] == "2026-08-17"          # 標第一個交易日
    assert row["close"] == 14 and row["adjClose"] == 13  # 值是最後一個交易日
    assert row["volume"] == 500                 # 成交量加總


def test_weekly_friday_holiday_value_is_thursday():
    dates = [d for d in bdays("2026-08-17", "2026-08-28") if d != "2026-08-21"]
    df = make_df(dates, closes=[float(i) for i in range(len(dates))])
    rows = resample_rows(df, "1wk", "2026-08-17", "2026-08-28")
    assert rows[0]["close"] == 3.0  # 週四（該週第 4 個交易日）


def test_weekly_prior_period_is_exactly_one_row():
    # 起始日 2026-08-20（週四）：前一期 = 8/10 那週，更早的丟掉
    df = make_df(bdays("2026-07-27", "2026-08-28"))
    rows = resample_rows(df, "1wk", "2026-08-20", "2026-08-28")
    flags = [r["flag"] for r in rows]
    assert flags.count(core.FLAG_PRIOR) == 1
    assert rows[0]["flag"] == core.FLAG_PRIOR
    assert rows[0]["date"] == "2026-08-10"
    # 起始日所在的那一週（8/17 週）屬於範圍內，日期標該週第一個交易日 8/17
    assert rows[1]["date"] == "2026-08-17"
    assert rows[1]["flag"] == ""


def test_weekly_partial_when_end_is_monday():
    # 題目情境：結束日 2026-08-31 是週一，最後一週只有 1 天，值取截至結束日最新的一天
    df = make_df(bdays("2026-08-17", "2026-08-31"))
    rows = resample_rows(df, "1wk", "2026-08-17", "2026-08-31")
    last = rows[-1]
    assert last["date"] == "2026-08-31"
    assert last["combinedKey"] == "2026-08-31"
    assert last["flag"] == core.FLAG_PARTIAL
    assert all(r["flag"] != core.FLAG_PARTIAL for r in rows[:-1])


def test_weekly_partial_value_is_latest_day_so_far():
    df = make_df(bdays("2026-08-24", "2026-09-04"), closes=[float(i) for i in range(10)])
    rows = resample_rows(df, "1wk", "2026-08-24", "2026-09-02")  # 結束日週三
    last = rows[-1]
    assert last["date"] == "2026-08-31"          # 該週第一個交易日
    assert last["close"] == 7.0                  # 截至 9/2 的最新一天
    assert last["flag"] == core.FLAG_PARTIAL


def test_weekly_end_on_friday_is_not_partial():
    df = make_df(bdays("2026-08-17", "2026-08-28"))
    rows = resample_rows(df, "1wk", "2026-08-17", "2026-08-28")
    assert rows[-1]["flag"] == ""


def test_weekly_end_on_friday_holiday_is_not_partial():
    dates = [d for d in bdays("2026-08-17", "2026-08-28") if d != "2026-08-28"]
    rows = resample_rows(make_df(dates), "1wk", "2026-08-17", "2026-08-28")
    assert rows[-1]["date"] == "2026-08-24"
    assert rows[-1]["flag"] == ""


# ---------------------------------------------------------------- 月

def test_monthly_label_first_trading_day_key_first_of_month():
    df = make_df(bdays("2026-06-01", "2026-08-31"))
    rows = resample_rows(df, "1mo", "2026-06-01", "2026-08-31")
    assert [r["date"] for r in rows] == ["2026-06-01", "2026-07-01", "2026-08-03"]  # 8/1 是週六
    assert [r["combinedKey"] for r in rows] == ["2026-06-01", "2026-07-01", "2026-08-01"]


def test_monthly_value_is_last_trading_day_of_month():
    # 2026-05-31 是週日，該月最後交易日是 5/29
    df = make_df(bdays("2026-05-01", "2026-06-30"), closes=[float(i) for i in range(43)])
    rows = resample_rows(df, "1mo", "2026-05-01", "2026-06-30")
    may_days = [d for d in bdays("2026-05-01", "2026-05-31")]
    assert rows[0]["date"] == "2026-05-01"
    assert rows[0]["close"] == float(len(may_days) - 1)


def test_monthly_partial_and_prior():
    df = make_df(bdays("2026-05-01", "2026-08-12"))
    rows = resample_rows(df, "1mo", "2026-07-01", "2026-08-12")
    assert rows[0]["flag"] == core.FLAG_PRIOR and rows[0]["combinedKey"] == "2026-06-01"
    assert rows[-1]["flag"] == core.FLAG_PARTIAL
    assert rows[-1]["combinedKey"] == "2026-08-01"


# ---------------------------------------------------------------- 年

def test_yearly():
    df = make_df(bdays("2023-01-02", "2026-06-30"))
    rows = resample_rows(df, "1y", "2024-01-01", "2026-06-30")
    assert rows[0]["flag"] == core.FLAG_PRIOR and rows[0]["combinedKey"] == "2023-01-01"
    assert rows[0]["date"] == "2023-01-02"
    assert rows[1]["combinedKey"] == "2024-01-01"
    assert rows[1]["date"] == "2024-01-01"
    assert rows[-1]["combinedKey"] == "2026-01-01"
    assert rows[-1]["flag"] == core.FLAG_PARTIAL


# ---------------------------------------------------------------- 日

def test_daily_prior_is_last_day_before_start():
    df = make_df(bdays("2026-08-17", "2026-08-28"))
    rows = resample_rows(df, "1d", "2026-08-20", "2026-08-28")
    assert rows[0]["flag"] == core.FLAG_PRIOR and rows[0]["date"] == "2026-08-19"
    assert [r["flag"] for r in rows].count(core.FLAG_PRIOR) == 1


def test_daily_intraday_flag():
    df = make_df(bdays("2026-08-24", "2026-08-28"))
    rows = resample_rows(df, "1d", "2026-08-24", "2026-08-28",
                         today_local=date(2026, 8, 28), market_closed=False)
    assert rows[-1]["flag"] == core.FLAG_INTRADAY
    rows = resample_rows(df, "1d", "2026-08-24", "2026-08-28",
                         today_local=date(2026, 8, 28), market_closed=True)
    assert rows[-1]["flag"] == ""
    # 最後一筆不是今天 → 不算盤中
    rows = resample_rows(df, "1d", "2026-08-24", "2026-08-28",
                         today_local=date(2026, 8, 29), market_closed=False)
    assert rows[-1]["flag"] == ""


def test_data_after_end_is_dropped():
    df = make_df(bdays("2026-08-17", "2026-09-04"))
    rows = resample_rows(df, "1d", "2026-08-17", "2026-08-21")
    assert rows[-1]["date"] == "2026-08-21"


def test_timezone_aware_index_keeps_local_date():
    idx = pd.DatetimeIndex(["2026-08-27", "2026-08-28"]).tz_localize("Asia/Tokyo")
    df = pd.DataFrame({"Close": [1.0, 2.0], "Adj Close": [1.0, 2.0], "Volume": [1, 1]}, index=idx)
    rows = resample_rows(df, "1d", "2026-08-27", "2026-08-28")
    assert [r["date"] for r in rows] == ["2026-08-27", "2026-08-28"]


def test_empty_frame():
    assert resample_rows(pd.DataFrame(), "1wk", "2026-01-01", "2026-02-01") == []


def test_bad_interval():
    with pytest.raises(CoreError) as e:
        resample_rows(make_df(["2026-01-02"]), "1h", "2026-01-01", "2026-02-01")
    assert e.value.code == "BAD_REQUEST"


# ---------------------------------------------------------------- 不連網的整合測試

class FakeYF:
    """假的 yfinance：記錄 download 的參數，回傳有配息（Close != Adj Close）的資料。"""

    def __init__(self):
        self.kwargs = None

    def Ticker(self, symbol):
        class T:
            history_metadata = {
                "symbol": symbol, "longName": "Fake Co", "currency": "USD",
                "exchangeName": "NYQ", "exchangeTimezoneName": "America/New_York",
                "firstTradeDate": 0,
                "currentTradingPeriod": {"regular": {"end": 0}},
            }
        return T()

    def download(self, symbol, **kwargs):
        self.kwargs = kwargs
        dates = bdays("2026-08-10", "2026-08-31")
        n = len(dates)
        return make_df(dates, closes=[100.0 + i for i in range(n)],
                       adj=[95.0 + i for i in range(n)])


def test_auto_adjust_false_and_close_differs_from_adj_close(monkeypatch):
    fake = FakeYF()
    monkeypatch.setattr(core, "_yf", lambda: fake)
    out = core.get_history("FAKE", "2026-08-17", "2026-08-31", "1wk",
                           now_utc=datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert fake.kwargs["auto_adjust"] is False
    assert fake.kwargs["interval"] == "1d"
    row = out["rows"][-1]
    assert row["close"] != row["adjClose"]
    assert len(out["rows"]) == len(out["combinedKeys"])
    assert out["unit"] == "price"


def test_tnx_unit(monkeypatch):
    monkeypatch.setattr(core, "_yf", lambda: FakeYF())
    out = core.get_history("^TNX", "2026-08-17", "2026-08-31", "1wk",
                           now_utc=datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert out["unit"] == "yield_pct"


def test_fetch_range_has_buffer_and_end_plus_one(monkeypatch):
    fake = FakeYF()
    monkeypatch.setattr(core, "_yf", lambda: fake)
    core.get_history("FAKE", "2026-08-17", "2026-08-31", "1wk",
                     now_utc=datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert fake.kwargs["start"] == "2026-08-03"  # 起始日往前 14 天
    assert fake.kwargs["end"] == "2026-09-01"    # 結束日 + 1 天


def test_start_must_be_before_end():
    with pytest.raises(CoreError) as e:
        core.get_history("FAKE", "2026-08-31", "2026-08-31", "1wk")
    assert e.value.code == "BAD_REQUEST"


def test_invalid_symbol(monkeypatch):
    class Bad:
        def Ticker(self, s):
            class T:
                history_metadata = {}
            return T()
    monkeypatch.setattr(core, "_yf", lambda: Bad())
    with pytest.raises(CoreError) as e:
        core.get_meta("XXXXX")
    assert e.value.code == "INVALID_SYMBOL"


def test_empty_data_with_valid_symbol_is_blocked(monkeypatch):
    class Empty(FakeYF):
        def download(self, symbol, **kw):
            return pd.DataFrame()
    fake = Empty()
    # firstTradeDate=0 → 1970，結束日不早於它，所以判為 YAHOO_BLOCKED
    monkeypatch.setattr(core, "_yf", lambda: fake)
    with pytest.raises(CoreError) as e:
        core.get_history("FAKE", "2026-08-17", "2026-08-31", "1wk")
    assert e.value.code == "YAHOO_BLOCKED"


def test_first_date_from_timezone_aware_timestamp(monkeypatch):
    ts = pd.Timestamp("1962-01-02 09:30:00", tz="America/New_York")

    class Y:
        def Ticker(self, s):
            class T:
                history_metadata = {"symbol": s, "firstTradeDate": ts, "currency": "USD"}
            return T()
    monkeypatch.setattr(core, "_yf", lambda: Y())
    assert core.get_meta("MMM")["firstDate"] == "1962-01-02"
