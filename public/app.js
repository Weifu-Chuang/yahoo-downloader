/* 前端：控制項連動、個股驗證、逐檔抓取、用 SheetJS 組成 Excel。 */
"use strict";

// ---------------------------------------------------------------- 資料定義
const ASSETS = [
  { id: "twii", label: "台灣加權指數", cur: "TWD", options: [["^TWII", "^TWII"], ["0050.TW", "0050.TW（元大台灣50）"]] },
  { id: "n225", label: "日經 225", cur: "JPY", options: [["^N225", "^N225"]] },
  { id: "spx", label: "S&P 500", cur: "USD", options: [["SPY", "SPY"], ["VOO", "VOO"], ["^GSPC", "^GSPC"]] },
  { id: "veu", label: "美國以外成熟市場", cur: "USD", options: [["VEU", "VEU"]] },
  { id: "vwo", label: "新興市場", cur: "USD", options: [["VWO", "VWO"]] },
  { id: "lqd", label: "美國投資等級公司債", cur: "USD", options: [["LQD", "LQD"]] },
  { id: "vnq", label: "美國房地產", cur: "USD", options: [["VNQ", "VNQ"]] },
  { id: "gld", label: "黃金", cur: "USD", options: [["GLD", "GLD"]] },
  { id: "dbc", label: "大宗商品", cur: "USD", options: [["DBC", "DBC"]] },
  { id: "tnx", label: "美國 10 年期公債殖利率", cur: "殖利率 %", options: [["^TNX", "^TNX"]] },
];

const LOOKBACKS = [
  { id: "1w", label: "一週" },
  { id: "1m", label: "一個月" },
  { id: "1y", label: "一年" },
  { id: "3y", label: "三年" },
  { id: "5y", label: "五年" },
  { id: "10y", label: "十年" },
];
const FREQS = [
  { id: "D", label: "日", name: "日資料" },
  { id: "W", label: "週", name: "週資料" },
  { id: "M", label: "月", name: "月資料" },
  { id: "Y", label: "年", name: "年資料" },
];
// 各頻率可選的「往回推」期間（期間至少涵蓋 2 個完整週期）
const ALLOWED = {
  D: ["1w", "1m", "1y", "3y", "5y", "10y"],
  W: ["1m", "1y", "3y", "5y", "10y"],
  M: ["1y", "3y", "5y", "10y"],
  Y: ["3y", "5y", "10y"],
};
const MIN_SPAN_TEXT = { D: "2 天", W: "2 週", M: "2 個月", Y: "2 年" };
const DEMO_STOCKS = ["2330.TW", "MMM", "AAPL", "JPM", "LVMUY"];

// ---------------------------------------------------------------- 日期工具（全部用 UTC，避免時區誤差）
const $ = (id) => document.getElementById(id);
const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d) => d.toISOString().slice(0, 10);
const compact = (s) => s.replace(/-/g, "");
const todayTaipei = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

function addMonths(d, n) {
  const day = d.getUTCDate();
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
function lookbackStart(endStr, lb) {
  const e = toUTC(endStr);
  if (lb === "1w") return new Date(e.getTime() - 7 * 864e5);
  if (lb === "1m") return addMonths(e, -1);
  if (lb === "1y") return addMonths(e, -12);
  if (lb === "3y") return addMonths(e, -36);
  if (lb === "5y") return addMonths(e, -60);
  return addMonths(e, -120);
}
// 自訂起始日：是否涵蓋至少 2 個完整週期
function spanOk(freq, startStr, endStr) {
  if (!startStr || !endStr) return false;
  const s = toUTC(startStr), e = toUTC(endStr);
  if (freq === "D") return e - s >= 2 * 864e5;
  if (freq === "W") return e - s >= 14 * 864e5;
  if (freq === "M") return addMonths(s, 2) <= e;
  return addMonths(s, 24) <= e;
}
function estimateRows(freq, s, e) {
  const days = (e - s) / 864e5;
  if (freq === "D") return Math.round(days * 5 / 7) + 1;
  if (freq === "W") return Math.round(days / 7) + 1;
  if (freq === "M") return Math.round(days / 30.44) + 1;
  return Math.round(days / 365.25) + 1;
}

// ---------------------------------------------------------------- 狀態
const state = {
  picked: Object.fromEntries(ASSETS.map((a) => [a.id, { on: true, sym: a.options[0][0] }])),
  stocks: Array(5).fill(null).map(() => ({ sym: "", status: "idle", msg: "" })),
  mode: "lookback", // lookback | custom
  lookback: "10y",
  start: "",
  freq: "W",
};

// ---------------------------------------------------------------- 畫面：標的
function renderAssets() {
  const ul = $("assets");
  ul.innerHTML = "";
  ASSETS.forEach((a) => {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = state.picked[a.id].on; cb.id = "a-" + a.id;
    cb.addEventListener("change", () => { state.picked[a.id].on = cb.checked; update(); });
    const lab = document.createElement("label");
    lab.htmlFor = cb.id;
    lab.innerHTML = `<span class="name">${a.label}</span> <span class="meta">${a.cur}</span>`;
    const tick = document.createElement("div");
    tick.className = "tick";
    if (a.options.length > 1) {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", a.label + " 代號");
      a.options.forEach(([v, t]) => sel.add(new Option(t, v)));
      sel.value = state.picked[a.id].sym;
      sel.addEventListener("change", () => { state.picked[a.id].sym = sel.value; update(); });
      tick.append(sel);
    } else {
      tick.innerHTML = `<strong>${a.options[0][0]}</strong>`;
    }
    li.append(cb, lab, tick);
    ul.append(li);
  });
}
$("all-on").onclick = () => setAllAssets(true);
$("all-off").onclick = () => setAllAssets(false);
function setAllAssets(v) {
  ASSETS.forEach((a) => (state.picked[a.id].on = v));
  renderAssets(); update();
}

// ---------------------------------------------------------------- 畫面：個股（驗證是真的）
function renderStocks() {
  const ol = $("stocks");
  ol.innerHTML = "";
  state.stocks.forEach((st, i) => {
    const li = document.createElement("li");
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = st.sym; inp.placeholder = "例：2330.TW";
    inp.autocomplete = "off"; inp.spellcheck = false;
    inp.setAttribute("aria-label", `個股 ${i + 1} 代號`);
    inp.id = "stock-" + i;
    const msg = document.createElement("div");
    msg.className = "status"; msg.id = "stock-msg-" + i;
    let timer;
    inp.addEventListener("input", () => {
      st.sym = inp.value.trim().toUpperCase();
      st.status = st.sym ? "pending" : "idle"; st.msg = "";
      paintStock(i); update();
      clearTimeout(timer);
      if (st.sym) timer = setTimeout(() => validateStock(i), 600);
    });
    inp.addEventListener("blur", () => { if (st.status === "pending") validateStock(i); });
    li.append(inp, msg);
    ol.append(li);
    paintStock(i);
  });
}
function paintStock(i) {
  const st = state.stocks[i];
  const inp = $("stock-" + i), msg = $("stock-msg-" + i);
  if (!inp) return;
  inp.className = st.status === "ok" ? "ok" : st.status === "bad" ? "bad" : "";
  msg.className = "status " + (st.status === "ok" ? "ok" : st.status === "bad" ? "bad" : "");
  msg.textContent =
    st.status === "pending" ? "驗證中…" :
    st.status === "ok" ? "✓ " + st.msg :
    st.status === "bad" ? "✗ " + st.msg : "";
}
async function validateStock(i) {
  const st = state.stocks[i];
  const sym = st.sym;
  if (!sym) return;
  st.status = "pending"; paintStock(i);
  try {
    const r = await fetch("/api/validate?symbol=" + encodeURIComponent(sym));
    const j = await r.json();
    if (st.sym !== sym) return; // 使用者已經改掉
    if (j.valid) {
      st.status = "ok";
      st.msg = `${j.name} · ${j.currency || "?"} · ${j.exchange || "?"}` + (j.firstDate ? ` · 最早資料 ${j.firstDate}` : "");
    } else {
      st.status = "bad";
      st.msg = j.error === "YAHOO_BLOCKED" ? "雅虎財經暫時無法連線，請稍後再試" : (j.message || "查無此代號");
    }
  } catch (e) {
    if (st.sym !== sym) return;
    st.status = "bad"; st.msg = "無法連線到伺服器（請用 python local_server.py 開啟本頁）";
  }
  paintStock(i); update();
}
$("fill-demo").onclick = () => {
  DEMO_STOCKS.forEach((s, i) => (state.stocks[i] = { sym: s, status: "pending", msg: "" }));
  renderStocks(); update();
  DEMO_STOCKS.forEach((_, i) => validateStock(i));
};
$("clear-stocks").onclick = () => {
  state.stocks = Array(5).fill(null).map(() => ({ sym: "", status: "idle", msg: "" }));
  renderStocks(); update();
};

// ---------------------------------------------------------------- 畫面：期間與頻率
function renderRadios(container, items, name, onPick) {
  container.innerHTML = "";
  items.forEach((it) => {
    const lab = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio"; r.name = name; r.value = it.id; r.id = `${name}-${it.id}`;
    r.addEventListener("change", () => onPick(it.id));
    const sp = document.createElement("span");
    sp.textContent = it.label;
    lab.append(r, sp);
    container.append(lab);
  });
}
let noticeText = "";
function setNotice(t) { noticeText = t; }

function pickLookback(id) {
  // 被鎖住的期間無法點選，所以點得到的一定與目前頻率相容
  state.mode = "lookback"; state.lookback = id;
  setNotice(""); update();
}
const lbName = (id) => LOOKBACKS.find((x) => x.id === id).label;
const freqName = (id) => FREQS.find((x) => x.id === id).name;

// 自訂起始日模式下，頻率變得不合理時，改用較細的頻率
function finerFreqFor() {
  const order = ["Y", "M", "W", "D"];
  const from = order.indexOf(state.freq);
  for (let i = Math.max(from, 0); i < order.length; i++) {
    if (spanOk(order[i], state.start, $("end").value)) return order[i];
  }
  return "D";
}
// 使用者點頻率時：若該頻率與目前期間衝突，改期間而不是改頻率
function onFreqClick(id) {
  if (state.mode === "lookback" && !ALLOWED[id].includes(state.lookback)) {
    const order = LOOKBACKS.map((x) => x.id);
    const cur = order.indexOf(state.lookback);
    state.lookback = ALLOWED[id].find((x) => order.indexOf(x) > cur) || ALLOWED[id][0];
    state.freq = id;
    setNotice(`${freqName(id)}至少要涵蓋 ${MIN_SPAN_TEXT[id]}，期間已自動改成「${lbName(state.lookback)}」。`);
    update();
  } else {
    state.freq = id; setNotice(""); update();
  }
}

function syncPeriodControls() {
  const end = $("end").value;
  // 頻率按鈕
  FREQS.forEach((f) => {
    const r = $("freq-" + f.id);
    if (state.mode === "lookback") {
      // 選了某個期間後，太短而算不出的頻率才鎖；其餘頻率點下去會自動調整期間
      r.disabled = !FREQS_OK_FOR_LOOKBACK(state.lookback).includes(f.id);
    } else {
      r.disabled = !spanOk(f.id, state.start, end);
    }
    r.checked = state.freq === f.id;
    r.parentElement.title = r.disabled ? lockReason(f.id) : "";
  });
  // 往回推按鈕
  LOOKBACKS.forEach((l) => {
    const r = $("lookback-" + l.id);
    r.disabled = !ALLOWED[state.freq].includes(l.id);
    r.checked = state.mode === "lookback" && state.lookback === l.id;
    r.parentElement.title = r.disabled ? `${freqName(state.freq)}至少要涵蓋 ${MIN_SPAN_TEXT[state.freq]}，「${l.label}」太短` : "";
  });
  $("mode-custom").checked = state.mode === "custom";
  $("start").value = state.mode === "custom" ? state.start : (end ? fmt(lookbackStart(end, state.lookback)) : "");
  $("start").disabled = false;
}
function FREQS_OK_FOR_LOOKBACK(lb) {
  return FREQS.filter((f) => ALLOWED[f.id].includes(lb)).map((f) => f.id);
}
function lockReason(f) {
  if (state.mode === "lookback") return `期間「${lbName(state.lookback)}」涵蓋不到 ${MIN_SPAN_TEXT[f]}，不能用${freqName(f)}`;
  return `起始日到結束日涵蓋不到 ${MIN_SPAN_TEXT[f]}，不能用${freqName(f)}`;
}

renderRadios($("lookback"), LOOKBACKS, "lookback", pickLookback);
renderRadios($("freq"), FREQS, "freq", onFreqClick);

$("mode-custom").onchange = () => {
  state.mode = "custom";
  state.start = $("start").value || fmt(lookbackStart($("end").value, state.lookback));
  if (!spanOk(state.freq, state.start, $("end").value)) state.freq = finerFreqFor();
  setNotice(""); update();
};
$("start").onchange = () => {
  state.mode = "custom"; state.start = $("start").value;
  const before = state.freq;
  if (!spanOk(state.freq, state.start, $("end").value)) {
    state.freq = finerFreqFor();
    if (state.freq !== before) setNotice(`起始日到結束日太短，頻率已自動改成「${freqName(state.freq)}」。`);
  } else setNotice("");
  update();
};
$("end").onchange = () => {
  if (state.mode === "custom" && !spanOk(state.freq, state.start, $("end").value)) {
    const before = state.freq; state.freq = finerFreqFor();
    if (state.freq !== before) setNotice(`起始日到結束日太短，頻率已自動改成「${freqName(state.freq)}」。`);
  } else setNotice("");
  update();
};
$("end-today").onclick = () => { $("end").value = todayTaipei(); setNotice(""); update(); };
$("preset").onclick = () => {
  $("end").value = "2026-08-31"; state.mode = "custom"; state.start = "2016-09-01"; state.freq = "W";
  setNotice(""); update();
};

// ---------------------------------------------------------------- 摘要與阻擋原因
function selectedSymbols() {
  const idx = ASSETS.filter((a) => state.picked[a.id].on).map((a) => state.picked[a.id].sym);
  const stocks = state.stocks.map((s) => s.sym).filter(Boolean);
  return [...idx, ...stocks];
}
function computeRange() {
  const end = $("end").value;
  if (!end) return null;
  const s = state.mode === "custom" ? state.start : fmt(lookbackStart(end, state.lookback));
  if (!s) return null;
  return { start: s, end };
}
function update() {
  const range = computeRange();
  const blockers = [];
  const idxCount = ASSETS.filter((a) => state.picked[a.id].on).length;
  if (idxCount === 0 && state.stocks.every((s) => !s.sym)) blockers.push("請至少選一個標的");
  state.stocks.forEach((s, i) => {
    if (!s.sym) blockers.push(`個股 ${i + 1} 尚未輸入代號`);
    else if (s.status === "bad") blockers.push(`個股 ${i + 1}（${s.sym}）代號無效`);
    else if (s.status !== "ok") blockers.push(`個股 ${i + 1}（${s.sym}）驗證中`);
  });
  // 代號重複會造成分頁名稱衝突
  const seen = new Map();
  ASSETS.filter((a) => state.picked[a.id].on).forEach((a) => seen.set(state.picked[a.id].sym.toUpperCase(), a.label));
  state.stocks.forEach((s, i) => {
    if (!s.sym) return;
    if (seen.has(s.sym)) blockers.push(`個股 ${i + 1}（${s.sym}）與「${seen.get(s.sym)}」重複`);
    else seen.set(s.sym, `個股 ${i + 1}`);
  });
  if (!$("end").value) blockers.push("請選結束日");
  if (range && toUTC(range.start) >= toUTC(range.end)) blockers.push("起始日必須早於結束日");
  if (range && toUTC(range.start) < toUTC(range.end) && !spanOk(state.freq, range.start, range.end)) blockers.push("期間太短，算不出報酬");
  // 去掉重複的「驗證中」只留一則
  const uniq = [...new Set(blockers)];

  syncPeriodControls();

  const n = selectedSymbols().length;
  $("s-count").textContent = n ? `${idxCount} 個指數／資產 + ${state.stocks.filter((s) => s.sym).length} 檔個股` : "-";
  if (range && toUTC(range.start) < toUTC(range.end)) {
    const f = state.freq;
    $("s-file").textContent = `PortfolioData_${f}_${compact(range.start)}_${compact(range.end)}.xlsx`;
    $("s-range").textContent = `${range.start} ~ ${range.end}`;
    $("s-freq").textContent = freqName(f);
    $("s-rows").textContent = `約 ${estimateRows(f, toUTC(range.start), toUTC(range.end))} 筆（另加前一期 1 筆）`;
  } else {
    ["s-file", "s-range", "s-freq", "s-rows"].forEach((id) => ($(id).textContent = "-"));
  }
  $("s-sheets").textContent = n ? `Info + Combined × 2 + ${n} 個標的 = ${n + 3} 個分頁` : "-";

  const ul = $("blockers");
  ul.innerHTML = "";
  uniq.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.append(li); });
  $("go").disabled = uniq.length > 0 || running;

  const nt = $("notice");
  nt.hidden = !noticeText; nt.textContent = noticeText;
}

// ---------------------------------------------------------------- 下載與組 Excel
let running = false;
let cancelled = false;
let lastWorkbook = null;
let lastFilename = "";
$("go").onclick = () => startDownload();
$("again").onclick = () => { if (lastWorkbook) XLSX.writeFile(lastWorkbook, lastFilename); };

const FREQ_INTERVAL = { D: "1d", W: "1wk", M: "1mo", Y: "1y" };
const FLAG_LABEL = {
  "Prior period": "Prior period 前一期",
  "Partial": "Partial 未完整",
  "Intraday": "Intraday 盤中",
};
const ERR_TEXT = {
  YAHOO_BLOCKED: "雅虎財經暫時封鎖了雲端主機，請改用本機版",
  INVALID_SYMBOL: "查無此代號",
  NO_DATA_IN_RANGE: "此期間沒有資料",
  BAD_REQUEST: "請求參數有誤",
  NETWORK: "無法連線到伺服器",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 要下載的標的（依畫面順序：指數與資產 → 個股）
function targets() {
  const out = [];
  ASSETS.forEach((a) => {
    if (state.picked[a.id].on) out.push({ sym: state.picked[a.id].sym, category: a.label, kind: "index" });
  });
  state.stocks.forEach((s) => { if (s.sym) out.push({ sym: s.sym, category: "個股 Stock", kind: "stock" }); });
  return out;
}

async function fetchOne(sym, range, interval) {
  const url = `/api/history?symbol=${encodeURIComponent(sym)}&start=${range.start}&end=${range.end}&interval=${interval}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let status, j;
    try {
      const r = await fetch(url);
      status = r.status; j = await r.json();
    } catch (e) {
      throw { code: "NETWORK", message: ERR_TEXT.NETWORK };
    }
    if (status === 200) return j;
    if ((status === 429 || j.error === "YAHOO_BLOCKED") && attempt === 0) { await sleep(2000); continue; } // 遇封鎖等 2 秒重試一次
    throw { code: j.error || "INTERNAL", message: ERR_TEXT[j.error] || j.message || "未知錯誤" };
  }
}

async function startDownload() {
  if (typeof XLSX === "undefined") { alert("Excel 元件（SheetJS）載入失敗，請確認網路連線後重新整理。"); return; }
  const list = targets();
  const range = computeRange();
  const interval = FREQ_INTERVAL[state.freq];
  running = true; cancelled = false; lastWorkbook = null; update();
  $("progress").hidden = false; $("decision").hidden = true; $("done").hidden = true; $("again").hidden = false;
  const ul = $("plist"); ul.innerHTML = "";
  const items = list.map((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="mono"></span><span class="st">等待中</span>`;
    li.querySelector(".mono").textContent = t.sym;
    ul.append(li);
    return { ...t, st: li.querySelector(".st"), data: null, error: null };
  });

  const queue = [...items];
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      it.st.textContent = "下載中…"; it.st.className = "st s-run";
      try {
        it.data = await fetchOne(it.sym, range, interval);
        it.st.className = "st s-done"; it.st.textContent = `完成（${it.data.rows.length} 筆）`;
      } catch (e) {
        it.error = e; it.st.className = "st s-fail"; it.st.textContent = "失敗：" + e.message;
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]); // 最多同時 4 個

  const ok = items.filter((x) => x.data);
  const failed = items.filter((x) => x.error);
  if (failed.length) {
    $("decision-msg").textContent = ok.length
      ? `${failed.length} 個標的下載失敗（${failed.map((x) => x.sym).join("、")}）。要仍然下載其餘 ${ok.length} 個標的嗎？`
      : "全部標的都下載失敗，沒有資料可以輸出。";
    $("decision").hidden = false;
    $("continue").hidden = ok.length === 0;
    await new Promise((resolve) => {
      $("continue").onclick = () => { $("decision").hidden = true; resolve(); };
      $("cancel").onclick = () => { cancelled = true; $("decision").hidden = true; resolve(); };
    });
  }
  if (!cancelled && ok.length) {
    const filename = $("s-file").textContent;
    try {
      lastWorkbook = buildWorkbook(ok, range, failed);
      lastFilename = filename;
      XLSX.writeFile(lastWorkbook, filename);
      $("done-msg").textContent = `完成，已下載 ${filename}（${ok.length + 3} 個分頁）。`;
      $("done").hidden = false;
    } catch (e) {
      $("done-msg").textContent = "組 Excel 時發生錯誤：" + e.message;
      $("again").hidden = true; $("done").hidden = false;
    }
  }
  running = false; update();
}

// ---- Excel 組裝
const serial = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5 + 25569; };
const dateCell = (iso) => ({ t: "n", v: serial(iso), z: "yyyy-mm-dd" });
const numCell = (v, z) => (v === null || v === undefined || Number.isNaN(v) ? null : { t: "n", v, z });
const flagText = (f) => (f ? FLAG_LABEL[f] || f : "");

function sheetName(sym, used) {
  let n = sym.replace(/[:\\/?*\[\]]/g, "_").slice(0, 31);
  let k = 2, base = n;
  while (used.has(n.toLowerCase())) n = base.slice(0, 28) + "_" + k++;
  used.add(n.toLowerCase());
  return n;
}

function buildWorkbook(ok, range, failed) {
  const wb = XLSX.utils.book_new();
  const used = new Set(["info 說明", "combined_adjclose", "combined_close"]);
  const NO_TRADING = "No trading 休市";
  const NO_DATA = "No data 無資料";

  // 所有分頁共用同一組列：所有已選標的的期間（對齊日）聯集
  const keySet = new Set();
  ok.forEach((it) => it.data.combinedKeys.forEach((k) => keySet.add(k)));
  const keys = [...keySet].sort();

  // 每個標的：期間對齊日 → 資料列
  const lookup = ok.map((it) => {
    const m = new Map();
    it.data.combinedKeys.forEach((k, i) => m.set(k, it.data.rows[i]));
    return m;
  });

  const sheets = [];
  ok.forEach((it, idx) => {
    const d = it.data;
    const isYield = d.unit === "yield_pct";
    const firstKey = d.combinedKeys[0];
    const aoa = [isYield
      ? ["Period 期間", "Trade Date 取值日", "Yield (%) 殖利率", "Adj Yield (%) 調整後殖利率", "Volume 成交量", "Flag 註記"]
      : ["Period 期間", "Trade Date 取值日", "Close 收盤價", "Adj Close 調整後收盤價", "Volume 成交量", "Flag 註記"]];
    keys.forEach((k) => {
      const r = lookup[idx].get(k);
      if (r) {
        aoa.push([dateCell(k), dateCell(r.tradeDate), numCell(r.close, "#,##0.00##"), numCell(r.adjClose, "#,##0.00##"),
          numCell(r.volume, "#,##0"), flagText(r.flag)]);
      } else {
        // 該標的這一期沒有資料：期間照填，其餘留白
        aoa.push([dateCell(k), null, null, null, null, k < firstKey ? NO_DATA : NO_TRADING]);
      }
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 22 }];
    sheets.push({ name: sheetName(it.sym, used), ws });
  });

  // Combined：同一組列，缺值留白
  function combined(field) {
    const aoa = [["Period 期間", ...ok.map((it) => it.sym), "Flag 註記"]];
    keys.forEach((k) => {
      const flags = [];
      const line = [dateCell(k)];
      lookup.forEach((m) => {
        const r = m.get(k);
        line.push(r ? numCell(r[field], "#,##0.00##") : null);
        if (r && r.flag && !flags.includes(flagText(r.flag))) flags.push(flagText(r.flag));
      });
      line.push(flags.join("; "));
      aoa.push(line);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 13 }, ...ok.map(() => ({ wch: 12 })), { wch: 22 }];
    return ws;
  }

  XLSX.utils.book_append_sheet(wb, buildInfo(ok, range, failed), "Info 說明");
  XLSX.utils.book_append_sheet(wb, combined("adjClose"), "Combined_AdjClose");
  XLSX.utils.book_append_sheet(wb, combined("close"), "Combined_Close");
  sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, s.ws, s.name));
  return wb;
}

function buildInfo(ok, range, failed) {
  const head = ["代號 Ticker", "名稱 Name", "類別 Category", "幣別 Currency", "單位 Unit",
    "第一筆取值日 First Trade Date", "最後一筆取值日 Last Trade Date", "有資料筆數 Rows", "備註 Notes"];
  const aoa = [head];
  ok.forEach((it) => {
    const d = it.data, rows = d.rows;
    const notes = [];
    if (d.unit === "yield_pct") notes.push("殖利率 %，非價格，不可直接計算報酬 / Yield in %, not a price");
    if (it.sym === "0050.TW") notes.push("2025/6 一拆四，報酬請用 Adj Close / 4-for-1 split in 2025-06, use Adj Close");
    if (rows.some((r) => r.flag === "Partial")) notes.push("最後一期未完整 / last period incomplete");
    if (rows.some((r) => r.flag === "Intraday")) notes.push("最後一筆為盤中價 / last row is intraday");
    aoa.push([it.sym, d.name, it.category, d.currency || "", d.unit === "yield_pct" ? "殖利率 % Yield" : "價格 Price",
      dateCell(rows[0].tradeDate), dateCell(rows[rows.length - 1].tradeDate), rows.length, notes.join("；")]);
  });

  const f = state.freq;
  const fname = { D: "日 Daily", W: "週 Weekly", M: "月 Monthly", Y: "年 Yearly" }[f];
  const modeText = state.mode === "custom" ? "自訂起始日 custom start date" : `往回推：${lbName(state.lookback)}`;
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
  const align = { D: "交易日 trading day", W: "該週週一 that week's Monday", M: "月初 first of the month", Y: "1/1" }[f];
  const text = [
    [`資料來源：Yahoo Finance；下載時間：${now}（台北時間）`, `Source: Yahoo Finance; downloaded at ${now} (Taipei time)`],
    [`頻率：${fname}；期間：${range.start} ~ ${range.end}（${modeText}）`, `Frequency: ${fname}; period: ${range.start} ~ ${range.end}`],
    ["第一筆取值日與筆數包含 Prior period 前一期，供計算第一期報酬；筆數只算有資料的列，不含休市的空白列", "First Trade Date and Rows include the Prior period row, used to compute the first return; Rows counts only rows with data, not blank no-trading rows"],
    ["Close = 未調整股利（已調整分割）；Adj Close = 調整分割與股利", "Close = not adjusted for dividends (split-adjusted); Adj Close = adjusted for splits and dividends"],
    ["幣別：各標的維持當地幣別，未換匯", "Currency: each series stays in its local currency; no FX conversion"],
    ["^TNX 為殖利率（%），不是價格，不可直接計算報酬", "^TNX is a yield in %, not a price; do not compute returns from it directly"],
    ["兩個日期欄：Period 期間 = 對齊日（日資料為當天、週資料為該週週一、月資料為該月 1 日、年資料為 1/1，與雅虎財經的日期標示相同），所有標的分頁與 Combined 分頁都一樣；Trade Date 取值日 = 收盤價實際來自哪一天（該期最後一個交易日；結束日落在期中時，為截至結束日最新的一天）", "Two date columns: Period = alignment date (the day for daily data, that week's Monday, the 1st of the month, or Jan 1; same as Yahoo Finance labels), identical in every ticker sheet and in Combined; Trade Date = the day Close/Adj Close actually come from (the LAST trading day of the period; the latest day up to the end date for an unfinished period)"],
    ["收盤價與調整後收盤價取該期最後一個交易日的值，成交量為整期加總", "Close and Adj Close are from the last trading day of the period; Volume is the total over the period"],
    [`Combined 對齊：日資料以交易日；週資料以該週週一；月資料以月初；年資料以 1/1（本檔：${align}）`,
      "Combined alignment: daily = trading day; weekly = that week's Monday; monthly = first of the month; yearly = Jan 1"],
    ["所有分頁的列相同：列 = 所有已下載標的的期間聯集。某標的該期沒有交易（例如春節、聖誕節整週或整天休市）時，該列只填 Period，取值日與數值留白，Flag 標 No trading 休市；標的尚未上市或尚無資料的期間標 No data 無資料。所有標的都沒有交易的期間不會出現", "All sheets share the same rows: the union of periods of all downloaded tickers. When a ticker has no trading in a period (e.g. a whole week or day closed), only Period is filled, Trade Date and values are blank, and Flag says No trading; periods before a ticker has data are flagged No data. Periods where every ticker is closed do not appear"],
    ["空白格不補值。以公式計算報酬或共變異數前，請自行處理（例如以 Flag 篩選掉空白列）", "Blank cells are not filled. Handle them yourself (e.g. filter out blank rows using Flag) before computing returns or covariances"],
    ["Flag：Prior period 前一期 = 起始日之前多抓的一期，供計算第一期報酬", "Flag: Prior period = one extra period before the start date, for computing the first return"],
    ["Flag：No trading 休市 = 該標的在該期沒有交易；No data 無資料 = 該標的在該期之前尚無資料", "Flag: No trading = the ticker has no trading in that period; No data = the ticker has no data before this period"],
    ["Flag：Partial 未完整 = 結束日落在週期中間，該期資料不完整（收盤價取截至結束日最新的一天）", "Flag: Partial = the end date falls inside the period; the period is incomplete (values are from the latest trading day up to the end date)"],
    ["Flag：Intraday 盤中 = 日資料最後一筆為當日尚未收盤的盤中價", "Flag: Intraday = the last daily row is an unfinished intraday price"],
  ];
  if (failed.length) {
    text.unshift([`注意：以下標的下載失敗，未包含在本檔：${failed.map((x) => x.sym).join("、")}`, `Note: these tickers failed and are NOT included: ${failed.map((x) => x.sym).join(", ")}`]);
  }
  aoa.push([]);
  text.forEach(([zh, en]) => { aoa.push([zh]); aoa.push([en]); });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 12 }, { wch: 46 }, { wch: 30 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 70 }];
  return ws;
}

// ---------------------------------------------------------------- 初始化
(function init() {
  $("end").value = todayTaipei();
  renderAssets();
  renderStocks();
  update();
})();
