# Yahoo 財經資料下載器 — 設計與實作紀錄

> 用途：投資組合管理期末報告（115(1) Portfolio Management Final Project）的資料收集工具
> 狀態：**已完成並上線**（2026-10-08）。網站 https://yahoo-downloader.vercel.app ，原始碼 https://github.com/Weifu-Chuang/yahoo-downloader
> 待辦：只剩驗收標準 1（人工比對數字），見第 4 節
> 本文件記錄目前實際的設計與做法；日後修改程式時請一併更新

---

## 0. 目標與範圍

**做什麼**：網頁小程式，從雅虎財經抓取指定標的的日／週／月／年收盤價，輸出成一個多分頁的 Excel 檔（.xlsx）。

**不做什麼**：
- 不算報酬率、平均數、共變異數、效率前緣等（分析在 Excel／Python 進行）
- 不換匯，各標的維持當地幣別
- 不提供 CSV 輸出
- 不接備用資料來源（只用雅虎財經）
- 不補值：某市場休市的期間一律留白

**使用者**：本人與同學，約 5 組 × 3 人，流量極小。

---

## 1. 設計決策

### 1.1 標的

**勾選清單（可多選，預設全部勾選）**：

| 類別 | 預設代號 | 可替換選項 | 幣別 | 備註 |
|---|---|---|---|---|
| 台灣加權指數 | `^TWII` | `0050.TW` | TWD | 0050 於 2025/6 一拆四，報酬一律用 Adj Close |
| 日經 225 | `^N225` | — | JPY | |
| S&P 500 | `SPY` | `VOO`、`^GSPC` | USD | |
| 美國以外成熟市場 | `VEU` | — | USD | |
| 新興市場 | `VWO` | — | USD | |
| 美國投資等級公司債 | `LQD` | — | USD | |
| 美國房地產 | `VNQ` | — | USD | |
| 黃金 | `GLD` | — | USD | |
| 大宗商品 | `DBC` | — | USD | |
| 美國 10 年期公債殖利率 | `^TNX` | — | — | 數值為殖利率 %（4.25 = 4.25%），不是價格 |

**個股輸入框**：固定 5 格，使用者自行輸入代號（例：`2330.TW`、`MMM`、`LVMUY`）。
- 輸入後即時驗證，顯示名稱、幣別、交易所、最早資料日期
- 代號無效、尚未驗證完成、未填滿 5 格，或與指數／其他個股重複時，不可下載

### 1.2 期間與頻率

使用者要選三件事：

1. **結束日**：預設「今天」（台北時間），可自訂
2. **期間（從結束日往前看多久）**，二選一：
   - 快速選擇：一週／一個月／一年／三年／五年／十年（預設「十年」，對應題目的 10 年期間）
   - 自訂起始日
3. **取值頻率**：日／週／月／年（日 daily、週 weekly、月 monthly、年 yearly）。報告主分析用週資料。

預設：結束日 = 今天、期間 = 十年、頻率 = 週。另有「套用期末報告期間」捷徑，直接填入 2016-09-01 ~ 2026-08-31 與週資料。

**鎖定規則：期間至少要涵蓋 2 個完整的取值週期，否則算不出報酬，該選項反灰不可選。**

| 取值頻率 | 一週 | 一個月 | 一年 | 三年 | 五年 | 十年 |
|---|---|---|---|---|---|---|
| 日 | 可選（約 5 筆） | 可選 | 可選 | 可選 | 可選 | 可選 |
| 週 | 鎖住 | 可選（約 4 筆） | 可選 | 可選 | 可選 | 可選 |
| 月 | 鎖住 | 鎖住 | 可選（12 筆） | 可選 | 可選 | 可選 |
| 年 | 鎖住 | 鎖住 | 鎖住 | 可選（3 筆） | 可選 | 可選 |

連動方式（雙向）：
- 先選頻率：不合理的快速選擇反灰。例：選「月」，「一週」「一個月」反灰。
- 先選期間：不合理的頻率反灰。例：選「一個月」，「月」「年」反灰。
- 滑鼠停在反灰選項上會顯示被鎖的原因。
- 自訂起始日：起始日與結束日之間至少要有 2 個完整週期（例如選「月」，兩日期至少相隔 2 個月）；起始日必須早於結束日。若太短，頻率自動改成較細的，並顯示一行提示。

**自動多抓前一期**：起始日之前的最後一期也抓進來，標註 `Prior period 前一期`，讓第一期報酬可以計算。

**結束日為「今天」**：每個標的各自抓到自己的最新收盤日，不強制對齊市場。

### 1.3 日期與取值定義

做法與雅虎財經的週／月／年資料一致：日期標期間起點，數值取期間最後一個交易日。

| 頻率 | 一組的範圍 | 期間 Period（對齊日） | 取值日 Trade Date（收盤價來自哪天） |
|---|---|---|---|
| 日 | 每個交易日 | 當天 | 當天 |
| 週 | 週一到週日 | 該週週一 | 該週最後一個交易日 |
| 月 | 整個月 | 該月 1 日 | 該月最後一個交易日 |
| 年 | 整個年度 | 該年 1/1 | 該年最後一個交易日 |

- Close、Adj Close 取取值日當天的值；成交量為整期加總。
- 結束日落在期中時，取值日是截至結束日最新的一天，並標 `Partial 未完整`。
- 週資料某週最後一個交易日若不是週五（例如週五休市），取值日就是週四。

**所有分頁（各標的分頁與兩個 Combined 分頁）的列完全相同**：
- 列 = 所有已下載標的的「期間」聯集，依日期排序。
- 某標的該期沒有交易（春節、聖誕節整週或整天休市）時，該列只填 Period，取值日與數值留白，Flag 標 `No trading 休市`。
- 標的尚未有資料的期間（例如上市前），Flag 標 `No data 無資料`。
- 所有標的都沒有交易的期間不會出現。
- 空白格不補值，Excel 計算報酬或共變異數前要自行處理（例如以 Flag 篩選）。

以上規則都寫在 `Info 說明` 分頁。

### 1.4 特殊列標註（`Flag 註記` 欄）

| 值 | 意義 |
|---|---|
| `Prior period 前一期` | 起始日之前多抓的一期，供計算第一期報酬 |
| `Partial 未完整` | 結束日落在週／月／年中間，該期資料不完整 |
| `Intraday 盤中` | 日資料最後一筆為當日尚未收盤的盤中價 |
| `No trading 休市` | 該標的在該期沒有交易（僅出現在各標的分頁） |
| `No data 無資料` | 該標的在該期之前尚無資料（僅出現在各標的分頁） |
| （空白） | 正常資料 |

**已決定**：`Partial 未完整` 的最後一期照常保留，收盤價使用截至結束日最新的一天。例如結束日 2026-08-31 是週一，最後一週只有一個交易日，期間與取值日都是 8/31，仍保留並計入報酬。

### 1.5 Excel 檔結構

**檔名**：`PortfolioData_{D|W|M|Y}_{起始日}_{結束日}.xlsx`，例：`PortfolioData_W_20160901_20260831.xlsx`

**分頁順序**：

1. `Info 說明`
2. `Combined_AdjClose`
3. `Combined_Close`
4. 各指數／ETF 分頁（依勾選清單順序）
5. 五檔個股分頁

**分頁名稱**：用代號（例：`^TWII`、`SPY`、`2330.TW`）。處理 Excel 限制：不可含 `: \ / ? * [ ]`，長度 ≤ 31 字元，重複時加尾碼。

**各標的分頁欄位**（第 1 列即為欄名，上方不放說明列）：

| `Period 期間` | `Trade Date 取值日` | `Close 收盤價` | `Adj Close 調整後收盤價` | `Volume 成交量` | `Flag 註記` |
|---|---|---|---|---|---|

- `^TNX` 分頁的價格欄名改為 `Yield (%) 殖利率` 與 `Adj Yield (%) 調整後殖利率`（兩欄數值相同）
- 日期格式 `YYYY-MM-DD`（存成 Excel 日期型別，不是文字）

**Combined 分頁欄位**：

| `Period 期間` | `^TWII` | `^N225` | `SPY` | … | `Flag 註記` |
|---|---|---|---|---|---|

- `Combined_AdjClose` 放 Adj Close（用於 A～C 節報酬統計）
- `Combined_Close` 放 Close（用於 D 節「不含股利」）
- Flag：該列任一標的有 Prior period／Partial／Intraday 就顯示（不含休市標註）

**`Info 說明` 分頁內容**：

上半部：每個標的一列

| 代號 Ticker | 名稱 Name | 類別 Category | 幣別 Currency | 單位 Unit | 第一筆取值日 First Trade Date | 最後一筆取值日 Last Trade Date | 有資料筆數 Rows | 備註 Notes |
|---|---|---|---|---|---|---|---|---|

- 第一筆取值日與筆數包含 Prior period 前一期；筆數不含休市的空白列
- 備註：`^TNX` 為殖利率、`0050.TW` 分割提醒、最後一期未完整、最後一筆為盤中價

下半部：說明文字（中英並列）
- 若有標的下載失敗，最前面列出未包含的代號
- 資料來源：Yahoo Finance、下載時間（台北時間）
- 頻率、使用者選擇的期間
- 第一筆取值日與筆數的算法
- 價格說明：Close = 未調整股利（已調整分割）；Adj Close = 調整分割與股利
- 幣別：各標的維持當地幣別，未換匯
- `^TNX` 為殖利率（%），非價格，不可直接計算報酬
- 兩個日期欄（Period、Trade Date）的意思
- 收盤價與成交量的取法
- 各分頁共用同一組列、休市與無資料的留白規則、空白格要自行處理
- Flag 各值意義

### 1.6 介面語言

- 網頁介面：中文
- Excel 內容：欄名與說明中英並列

### 1.7 補充決定

- 年頻率下限：「一年」配年頻率鎖住，年資料至少選三年
- 台股指數預設用 `^TWII`；S&P 500 預設用 `SPY`
- 雲端部署已完成，網站公開（已關閉 Vercel 的 Deployment Protection），同學可直接使用；本機版保留作為被雅虎封鎖時的備案
- 取值日標「最後一個交易日」，不標第一個交易日，避免日期與數值來源不一致
- 日期標示與雅虎財經的差異（刻意）：雅虎對台股（如 `^TWII`）的週資料日期標在週三、數值也與日資料對不上，所以一律由日資料自行轉換；雅虎週一或 1 日休市時仍標日曆日，我們的 Period 欄同樣標日曆日，實際交易日看 Trade Date

---

## 2. 技術架構

```
瀏覽器（public/index.html + app.js）
  │  每個標的一個請求，最多同時 4 個
  ▼
Vercel Python 函式（api/index.py）
  ├─ GET /api/history   抓單一標的歷史價格，回傳 JSON
  └─ GET /api/validate  驗證代號，回傳名稱、幣別等
  │
  ▼
Yahoo Finance（透過 yfinance）

瀏覽器收齊所有 JSON → 用 SheetJS 組成 .xlsx → 下載
```

**為什麼這樣設計**：Vercel 免費版單次回應有大小上限（約 4.5 MB）與執行時間上限。十年日資料 × 15 檔一次產生 Excel 可能超過。改成逐檔回傳 JSON、由瀏覽器組檔，沒有大小問題，還能顯示每檔進度。實測十年日資料單檔約 2500 筆、324 KB、約 1 秒。

### 2.1 專案結構

```
yahoo-downloader/
├── PLAN.md                 本文件
├── README.md               使用說明（本機執行、部署步驟、已知限制）
├── public/                 Vercel 只公開這個資料夾與 /api
│   ├── index.html          介面
│   ├── app.js              前端邏輯、組 Excel
│   └── style.css
├── lib/
│   ├── core.py             抓資料、轉頻率、標註 Flag（核心邏輯，不依賴 Vercel）
│   └── server.py           API 路由與 HTTP 處理器（Vercel 與本機共用）
├── api/
│   └── index.py            Vercel 入口（含 history、validate）
├── local_server.py         本機版：同時提供 public/ 與 /api，供 Vercel 被封鎖時使用
├── pyproject.toml          Vercel 入口設定與套件（[tool.vercel] entrypoint）
├── requirements.txt        yfinance、pandas
├── requirements-dev.txt    加上 pytest
├── vercel.json             maxDuration 與 /api 轉送（rewrites）
├── sample/
│   ├── make_sample.py      產生範例 Excel（假資料，僅供確認版面）
│   └── PortfolioData_W_20260803_20260831_SAMPLE.xlsx
├── tests/
│   ├── test_core.py        用固定測試資料，不連網
│   └── test_server.py      路由與錯誤碼
└── .gitignore
```

另有本機的 `poc/`（雲端可行性測試，已列入 `.gitignore`，不在 repo 內）。

### 2.2 後端 API 規格

**`GET /api/history`**

參數：

| 參數 | 範例 | 說明 |
|---|---|---|
| `symbol` | `^TWII` | 代號 |
| `start` | `2016-09-01` | 起始日（含） |
| `end` | `2026-08-31` | 結束日（含） |
| `interval` | `1d` / `1wk` / `1mo` / `1y` | 頻率 |

回傳：

```json
{
  "symbol": "^TWII",
  "name": "TSEC CAPITALIZATION WEIGHTED ST",
  "currency": "TWD",
  "exchange": "TAI",
  "unit": "price",
  "rows": [
    {"date": "2016-08-22", "tradeDate": "2016-08-26", "close": 9131.7, "adjClose": 9131.7, "volume": 8203900, "flag": "Prior period"},
    {"date": "2016-08-29", "tradeDate": "2016-09-02", "close": 8987.5, "adjClose": 8987.5, "volume": 9245700, "flag": ""}
  ],
  "combinedKeys": ["2016-08-22", "2016-08-29"]
}
```

- `combinedKeys` 是每一列的「期間 Period」（週資料為該週週一、月資料為月初、年資料為 1/1、日資料為當天），與 `rows` 一一對應。
- `tradeDate` 是取值日（Excel 的 Trade Date 欄）。
- `date` 是該期第一個交易日，僅供參考，Excel 不使用。
- `name` 取自雅虎，部分指數的名稱會被截斷（例如 `^TWII`），Info 分頁照實顯示。

錯誤回傳：`{"error": 代碼, "message": "..."}`，代碼與 HTTP 狀態碼：

| 代碼 | 狀態碼 | 意思 |
|---|---|---|
| `BAD_REQUEST` | 400 | 缺參數、日期格式錯、起始日不早於結束日、頻率不支援 |
| `INVALID_SYMBOL` | 404 | 代號查無 |
| `NO_DATA_IN_RANGE` | 404 | 該期間沒有資料 |
| `YAHOO_BLOCKED` | 503 | 雅虎回 429 或代號有效卻沒資料 |
| `INTERNAL` | 500 | 其他錯誤 |

**`GET /api/validate?symbol=MMM`**

成功回傳 `{"valid": true, "name": "3M Company", "currency": "USD", "exchange": "NYQ", "firstDate": "1962-01-02"}`；失敗回傳 `{"valid": false, "error": ..., "message": ...}`。

### 2.3 核心邏輯（`lib/core.py`）

1. **一律抓日資料，自行轉成週／月／年**（不用雅虎的週、月資料）
   - 理由：實測雅虎自己的台股週資料（如 `^TWII`）日期標在週三、數值與日資料對不上；美股（如 `SPY`）的週、月 Close 與自行轉換的結果完全一致。自行轉換才能各市場一致
   - `yf.download(symbol, start=..., end=..., interval="1d", auto_adjust=False, actions=False, progress=False, multi_level_index=False)`
   - **務必明確設 `auto_adjust=False`**，否則新版 yfinance 的 `Close` 會是調整後價格
2. **抓取範圍**：`start` 往前多抓一段緩衝（日：10 天、週：14 天、月：40 天、年：400 天），`end` + 1 天（yfinance 的 end 不含當天）
3. **時區**：雅虎回傳的時間戳記帶交易所時區，直接去掉時區保留交易所當地日期（不轉成 UTC）
4. **轉頻率**（純 Python 分組，不用 pandas 的頻率別名，避免版本差異）：
   - 週：依週一到週日分組；Period = 該週週一
   - 月：依月份分組；Period = 該月 1 日
   - 年：依年份分組；Period = 該年 1/1
   - 每組：`tradeDate` = 該組最後一個交易日，Close、Adj Close 取該日；Volume 加總
   - 期間歸屬：該組最後交易日 ≥ 起始日才算在範圍內（含起始日所在的那一期）
5. **Flag 判定**：
   - `Prior period`：最後交易日 < 起始日的最後一期（只保留一期，更早的丟掉）
   - `Partial`：最後一期的期末（週五／月底／12-31）晚於結束日
   - `Intraday`：日資料、最後一筆日期 = 交易所當地今天、且當地時間尚未過收盤
6. **^TNX**：`unit` 設為 `yield_pct`
7. **錯誤判定**：雅虎回 429 或空資料但代號有效 → `YAHOO_BLOCKED`；代號查無 → `INVALID_SYMBOL`

### 2.4 前端（`public/app.js`）

- 控制項連動鎖定規則（見 1.2）
- 下載流程：
  1. 驗證五檔個股代號都有效（按鈕在條件未滿足時停用，並列出原因）
  2. 依序抓取，最多同時 4 個請求；遇 429／`YAHOO_BLOCKED` 等 2 秒重試一次
  3. 畫面顯示每檔狀態：等待中／下載中／完成（筆數）／失敗（原因）
  4. 全部完成後，用 SheetJS 組 Excel：計算所有標的「期間」的聯集，依同一組列建立各標的分頁與兩個 Combined 分頁（缺值留白），最後建 Info 分頁
  5. 若有任何標的失敗，詢問使用者是否仍要下載其餘標的；選擇下載時，Info 分頁會註明哪些標的未包含
- 錯誤為 `YAHOO_BLOCKED` 時，顯示「雅虎財經暫時封鎖了雲端主機，請改用本機版」
- SheetJS 從官方 CDN 載入並固定版本：`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`（npm 上的 `xlsx` 是舊版，不要用）
- 日期欄以 Excel 日期序號寫入（避免時區位移），格式 `yyyy-mm-dd`

### 2.5 部署

- Vercel 專案 `yahoo-downloader`（團隊 gathergo），網址 https://yahoo-downloader.vercel.app
- `pyproject.toml`：`[tool.vercel] entrypoint = "api.index:handler"`，並在 `dependencies` 列出套件（新版 Vercel Python 執行環境只認單一入口）
- `vercel.json`：`/api/(.*)` 轉送到 `/api/index?_r=$1`（轉送後函式看到的路徑會變成 `/api/index`，原路由放在查詢參數 `_r`）；`maxDuration` 30 秒
- 靜態檔放在 `public/`
- 已關閉 Deployment Protection（`npx vercel project protection disable yahoo-downloader --sso`），網址公開
- 更新網站：在專案資料夾執行 `npx vercel deploy --prod`。Vercel 與 GitHub 尚未連動（`vercel git connect` 失敗，需到 Vercel 專案設定安裝 GitHub App），所以 push 後不會自動部署

---

## 3. 實作階段與紀錄

### 階段 0：雲端可行性 POC
- [x] 最小 Vercel Python 函式，用 yfinance 抓 `SPY`、`^TWII`、`^TNX`
- [x] 部署後三檔皆成功，每檔約 0.1 秒，雅虎沒有封鎖 Vercel
- [x] 正式版後續多次呼叫（含十年日資料、完整下載）皆成功
- 部署經驗：新版 Vercel 需在根目錄放 `pyproject.toml` 指定入口

### 階段 1：核心邏輯與單元測試
- [x] 專案結構、`.gitignore`、`requirements.txt`
- [x] `lib/core.py`（2.3 全部項目）
- [x] `tests/test_core.py`、`tests/test_server.py`：固定資料、不連網。涵蓋：
  - 週：Period 為週一、取值日為最後一個交易日、週五休市取週四、週一休市 Period 仍為週一
  - 月、年轉換同理
  - Prior period 只有一列、Partial 判定、結束日在週中時取最新一天
  - `auto_adjust=False` 確實生效（Close ≠ Adj Close）、抓取範圍含緩衝與 end+1
  - 路由、錯誤碼對應、Vercel 轉送參數
- **驗證**：`python -m pytest` 全數通過（目前 34 項）

### 階段 2：API 與本機伺服器
- [x] `lib/server.py`、`api/index.py`（history、validate 合併為單一入口）
- [x] `local_server.py`：`python local_server.py` 即可在 `http://localhost:8000` 使用完整功能（只開放 `public/` 內的前端檔案）
- **驗證**：`^TWII`、`SPY`、`^TNX`、`2330.TW` 皆 200；`XXXXX` 回 404 與中文錯誤訊息

### 階段 3：前端介面
- [x] `public/index.html`、`style.css`：中文介面、勾選清單、5 格個股輸入、期間與頻率控制項、下載摘要、進度清單
- [x] `public/app.js`：鎖定規則、驗證、併發抓取、組 Excel
- **驗證**：以無頭瀏覽器完整下載（週資料 15 檔、一檔模擬失敗後下載其餘 14 檔、月資料），用 openpyxl 開檔確認分頁順序、欄名、日期型別、`^TNX` 欄名、各分頁列數一致、休市留白與註記、Info 說明內容

### 階段 4：驗收（本機）
- 驗收標準 2（0050 分割）：已用真實資料確認，2025/4～8 週資料最大單週變動 −6.5%，沒有 −75% 的假暴跌
- 驗收標準 3（組合）：19 種可選的「頻率 × 期間」組合 × 2 個結束日共 36 次抓取全部成功；被鎖組合已在介面測試確認不可選
- 驗收標準 4（錯誤代號）：介面測試確認顯示中文錯誤且下載按鈕停用
- **待人工**：驗收標準 1，見第 4 節

### 階段 5：Git 與部署
- [x] 專案內 `git init`（與家目錄的 repo 分開），推上 GitHub 公開 repo
- [x] 部署到 Vercel 並公開
- [x] `README.md`
- [x] 驗收標準 5：以無頭瀏覽器在公開網址完成週資料下載（18 個分頁）
- [ ] Vercel 與 GitHub 自動連動（選配）

---

## 4. 驗收標準

1. 用題目期間（2016-09-01～2026-08-31）、週資料下載一次，抽 3 檔、每檔 3 個日期，與雅虎財經網頁上的數字比對一致 —— **尚待人工比對**（比對時注意：Excel 的 Trade Date 是收盤價來自的那一天，雅虎網頁看日資料收盤價比對最直接）
2. `0050.TW` 在 2025 年 6 月分割前後，Adj Close 沒有出現假暴跌（約 −75%） —— 已通過
3. 每一種「結束日 × 起始方式 × 頻率」組合都能正常下載；被鎖住的組合確實無法選取 —— 已通過
4. 輸入錯誤代號時有清楚的中文錯誤訊息，且無法送出 —— 已通過
5. 部署到 Vercel 的版本實際下載成功一次 —— 已通過（建議再用自己的瀏覽器下載一次）

---

## 5. 已知風險與注意事項

| 風險 | 影響 | 對策 |
|---|---|---|
| 雅虎封鎖 Vercel 的 IP | 雲端版無法下載 | 網頁顯示提示，改用 `local_server.py` 本機版 |
| 雅虎改版導致 yfinance 失效 | 全部無法下載 | `requirements.txt` 不鎖死 yfinance 版本，失效時先 `pip install -U yfinance`；雲端版需重新部署才會更新套件 |
| 程式碼放在 OneDrive 資料夾 | Git 檔案被鎖、`.git` 同步衝突 | 若出現 Git 怪錯誤，先暫停 OneDrive 同步再試；必要時把專案搬出 OneDrive |
| 各分頁含休市的空白列 | Excel 算報酬、共變異數時，空格會造成錯誤或配對錯位 | Info 分頁說明；以 Flag 欄篩選；報告主分析用週資料，週資料只有整週休市（如春節）才會留白 |
| LVMUY 等場外交易標的 | 成交稀少、某些日子沒有成交 | 保留 Volume 欄位供判斷；休市列會標 `No trading 休市` |
| 部分指數名稱被雅虎截斷 | Info 分頁名稱不完整（如 `^TWII`） | 照實顯示，不影響資料 |
| Vercel 與 GitHub 未連動 | 改程式後網站不會自動更新 | 手動執行 `npx vercel deploy --prod` |
| 網站公開且無登入 | 任何人都能呼叫 API，消耗額度 | 流量預期極小；若被濫用再重新開啟 Deployment Protection |

---

## 6. 寫報告時要記得說明的事（非程式工作）

- 資料來源：Yahoo Finance，下載日期
- A～C 節用 Adj Close（含股利），D 節用 Close（不含股利，依題目提示）
- 各標的維持當地幣別、未換匯（`^TWII`、`2330.TW` 為 TWD，`^N225` 為 JPY）
- `^TNX` 為年化殖利率（%），算夏普比率時換成週無風險利率：年殖利率 ÷ 100 ÷ 52
- 第一期報酬使用「前一期」價格計算
- 最後一期若標 `Partial 未完整`，要決定是否納入分析並在報告中說明
- 休市造成的空白列要說明處理方式（例如只用兩市場都有資料的期間計算共變異數）
- 跟老師確認台股指數用 `^TWII` 或 `0050` 是否有指定
