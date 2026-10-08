"""核心邏輯：抓雅虎日資料、轉成週／月／年、標註 Flag。

不依賴 Vercel。轉頻率的函式 (resample_rows) 是純函式，可不連網測試。
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import pandas as pd

INTERVALS = ("1d", "1wk", "1mo", "1y")
BUFFER_DAYS = {"1d": 10, "1wk": 14, "1mo": 40, "1y": 400}
YIELD_SYMBOLS = {"^TNX"}

FLAG_PRIOR = "Prior period"
FLAG_PARTIAL = "Partial"
FLAG_INTRADAY = "Intraday"


class CoreError(Exception):
    """code: YAHOO_BLOCKED | INVALID_SYMBOL | NO_DATA_IN_RANGE | BAD_REQUEST | INTERNAL"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- 日期工具

def _to_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()


def period_key(d: date, interval: str) -> date:
    """該日所屬週期在 Combined 分頁的對齊日期（週五／月底／12-31／當日）。"""
    if interval == "1d":
        return d
    if interval == "1wk":  # 等同 W-FRI：週六、週日歸入下一個週五
        return d + timedelta(days=(4 - d.weekday()) % 7)
    if interval == "1mo":
        return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
    if interval == "1y":
        return date(d.year, 12, 31)
    raise CoreError("BAD_REQUEST", f"不支援的頻率：{interval}")


# ---------------------------------------------------------------- 轉頻率（純函式）

def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    """統一成：index=去時區的日期，欄位 Close / Adj Close / Volume。"""
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["Close", "Adj Close", "Volume"], index=pd.DatetimeIndex([]))
    df = df.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)  # 保留交易所當地日期，不轉成 UTC
    df.index = pd.DatetimeIndex(df.index).normalize()
    if "Adj Close" not in df.columns:
        df["Adj Close"] = df["Close"]
    if "Volume" not in df.columns:
        df["Volume"] = 0
    df = df[["Close", "Adj Close", "Volume"]]
    df = df[df["Close"].notna()].copy()
    df["Adj Close"] = df["Adj Close"].fillna(df["Close"])
    df["Volume"] = df["Volume"].fillna(0)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def resample_rows(
    df: pd.DataFrame,
    interval: str,
    start,
    end,
    today_local: Optional[date] = None,
    market_closed: bool = True,
) -> list[dict]:
    """把日資料轉成指定頻率，回傳 rows（含 date / combinedKey / flag）。

    - 週期內：最後一筆的 Close、Adj Close；Volume 加總；date = 實際最後交易日
    - 週期歸屬：該期最後交易日 >= start 才算在範圍內
    - Prior period：最後交易日 < start 的最後一期（只留一期）
    - Partial：最後一期的對齊日 > end（結束日落在週期中間）
    - Intraday：日資料、最後一筆 = 當地今天、且尚未收盤
    """
    if interval not in INTERVALS:
        raise CoreError("BAD_REQUEST", f"不支援的頻率：{interval}")
    start_d, end_d = _to_date(start), _to_date(end)
    df = normalize_frame(df)
    df = df[df.index <= pd.Timestamp(end_d)]
    if df.empty:
        return []

    periods = []  # [key, last_date, close, adj, volume]
    cur_key = None
    for ts, r in df.iterrows():
        d = ts.date()
        k = period_key(d, interval)
        if k != cur_key:
            periods.append([k, d, float(r["Close"]), float(r["Adj Close"]), float(r["Volume"])])
            cur_key = k
        else:
            p = periods[-1]
            p[1], p[2], p[3] = d, float(r["Close"]), float(r["Adj Close"])
            p[4] += float(r["Volume"])

    before = [p for p in periods if p[1] < start_d]
    inside = [p for p in periods if p[1] >= start_d]
    chosen = ([(before[-1], FLAG_PRIOR)] if before else []) + [(p, "") for p in inside]

    rows = []
    for i, (p, flag) in enumerate(chosen):
        is_last = i == len(chosen) - 1
        if is_last and not flag:
            if interval == "1d":
                if today_local is not None and p[1] == today_local and not market_closed:
                    flag = FLAG_INTRADAY
            elif p[0] > end_d:
                flag = FLAG_PARTIAL
        rows.append({
            "date": p[1].isoformat(),
            "close": p[2],
            "adjClose": p[3],
            "volume": int(round(p[4])),
            "flag": flag,
            "combinedKey": p[0].isoformat(),
        })
    return rows


# ---------------------------------------------------------------- 連網部分

def _classify_exception(e: Exception) -> CoreError:
    low = str(e).lower()
    if "429" in low or "too many requests" in low or "rate limit" in low:
        return CoreError("YAHOO_BLOCKED", "雅虎財經回應請求過多或封鎖，請稍後再試或改用本機版")
    return CoreError("INTERNAL", str(e)[:300])


def _yf():
    import yfinance as yf
    return yf


def get_meta(symbol: str) -> dict:
    """查代號資訊；查無代號丟 INVALID_SYMBOL。"""
    symbol = (symbol or "").strip()
    if not symbol:
        raise CoreError("INVALID_SYMBOL", "請輸入代號")
    yf = _yf()
    try:
        meta = yf.Ticker(symbol).history_metadata
    except Exception as e:
        err = _classify_exception(e)
        if err.code == "INTERNAL":
            raise CoreError("INVALID_SYMBOL", f"查無代號：{symbol}")
        raise err
    if not meta or not meta.get("symbol"):
        raise CoreError("INVALID_SYMBOL", f"查無代號：{symbol}")
    first = meta.get("firstTradeDate")
    first_date = None
    if isinstance(first, (int, float)):
        first_date = datetime.fromtimestamp(first, tz=timezone.utc).date().isoformat()
    elif isinstance(first, (datetime, date)):  # yfinance 回傳帶時區的 Timestamp，date() 即交易所當地日期
        first_date = first.date().isoformat() if isinstance(first, datetime) else first.isoformat()
    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency"),
        "exchange": meta.get("exchangeName"),
        "timezone": meta.get("exchangeTimezoneName"),
        "firstDate": first_date,
        "regularEnd": ((meta.get("currentTradingPeriod") or {}).get("regular") or {}).get("end"),
    }


def fetch_daily(symbol: str, start, end, interval: str) -> pd.DataFrame:
    """抓日資料。一律 auto_adjust=False，才有分開的 Close 與 Adj Close。"""
    yf = _yf()
    start_d, end_d = _to_date(start), _to_date(end)
    fetch_start = start_d - timedelta(days=BUFFER_DAYS[interval])
    fetch_end = end_d + timedelta(days=1)  # yfinance 的 end 不含當天
    try:
        return yf.download(
            symbol,
            start=fetch_start.isoformat(),
            end=fetch_end.isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=False,
            progress=False,
            multi_level_index=False,
        )
    except Exception as e:
        raise _classify_exception(e)


def get_history(symbol: str, start, end, interval: str, now_utc: Optional[datetime] = None) -> dict:
    if interval not in INTERVALS:
        raise CoreError("BAD_REQUEST", f"不支援的頻率：{interval}")
    start_d, end_d = _to_date(start), _to_date(end)
    if start_d >= end_d:
        raise CoreError("BAD_REQUEST", "起始日必須早於結束日")

    meta = get_meta(symbol)  # 先確認代號存在
    df = fetch_daily(symbol, start_d, end_d, interval)
    if df is None or len(df) == 0:
        first = meta.get("firstDate")
        if first and end_d < _to_date(first):
            raise CoreError("NO_DATA_IN_RANGE", f"{symbol} 在此期間沒有資料（最早資料日 {first}）")
        raise CoreError("YAHOO_BLOCKED", "代號有效但雅虎沒有回傳資料，可能被暫時封鎖，請稍後再試或改用本機版")

    today_local, market_closed = None, True
    if interval == "1d":
        now_utc = now_utc or datetime.now(timezone.utc)
        if now_utc.tzinfo is None:
            now_utc = now_utc.replace(tzinfo=timezone.utc)
        try:
            from zoneinfo import ZoneInfo
            today_local = now_utc.astimezone(ZoneInfo(meta["timezone"])).date()
        except Exception:
            today_local = None
        reg_end = meta.get("regularEnd")
        market_closed = now_utc.timestamp() >= reg_end if isinstance(reg_end, (int, float)) else True

    rows = resample_rows(df, interval, start_d, end_d, today_local, market_closed)
    if not any(r["flag"] != FLAG_PRIOR for r in rows):
        raise CoreError("NO_DATA_IN_RANGE", f"{symbol} 在 {start_d} ~ {end_d} 沒有資料")

    return {
        "symbol": symbol,
        "name": meta["name"],
        "currency": meta["currency"],
        "exchange": meta["exchange"],
        "unit": "yield_pct" if symbol in YIELD_SYMBOLS else "price",
        "rows": [{k: v for k, v in r.items() if k != "combinedKey"} for r in rows],
        "combinedKeys": [r["combinedKey"] for r in rows],
    }
