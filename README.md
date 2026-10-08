# Yahoo 財經資料下載器

投資組合管理期末報告用的小工具。選好標的、期間與頻率，從雅虎財經抓收盤價，下載成一個多分頁的 Excel 檔。

設計細節見 [PLAN.md](PLAN.md)。

## 使用方式

1. 勾選指數與資產（預設全選）。台股指數可換 `0050.TW`，S&P 500 可換 `VOO` 或 `^GSPC`。
2. 輸入 5 檔個股代號（例：`2330.TW`、`MMM`、`LVMUY`）。輸入後會自動驗證，代號無效不能下載。
3. 選結束日、期間與頻率。灰色選項是被鎖住的，因為期間至少要涵蓋 2 個完整週期。
4. 按「下載 Excel」。按「套用期末報告期間」可一鍵填入 2016-09-01 ~ 2026-08-31 與週資料。

Excel 內容：`Info 說明`、`Combined_AdjClose`、`Combined_Close`，之後每個標的一個分頁。各欄位與對齊規則寫在檔案的 `Info 說明` 分頁。

## 本機執行（Windows）

需要 Python 3.10 以上。

```
pip install -r requirements.txt
python local_server.py
```

然後開啟 http://localhost:8000 。結束請按 Ctrl+C。

雲端版若被雅虎封鎖，就用這個本機版。

## 執行測試

```
pip install -r requirements-dev.txt
python -m pytest
```

測試全部使用固定資料，不連網。

## 部署到 Vercel

1. 把專案推上 GitHub。
2. 在 Vercel 匯入該 repo，框架選 Other，其餘維持預設。
3. 部署完成後開啟網址，下載一次確認。

入口設定在 `pyproject.toml`（`[tool.vercel] entrypoint`），路由轉送在 `vercel.json`。

## 已知限制

- 只用雅虎財經一個資料來源，沒有備用來源。
- 雅虎可能封鎖雲端主機。網頁會顯示「請改用本機版」。
- yfinance 是非官方套件，雅虎改版時可能失效。先試 `pip install -U yfinance`。
- 各標的維持當地幣別，不換匯。`^TNX` 是殖利率 %，不是價格。
- Combined 分頁某市場休市時留白，計算共變異數前要自行處理。
- 專案放在 OneDrive 時，Git 可能遇到檔案被鎖，必要時先暫停 OneDrive 同步。
