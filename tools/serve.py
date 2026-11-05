#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TraderTrain 本地服务：静态站 + Dukascopy 历史数据下载 API。

替代 `python -m http.server`（端口固定 8733 —— vela 分支专用（8731 让给主仓库打包 exe）；IndexedDB 的 origin 依赖端口）。

用法:
    python tools/serve.py --port 8733 --root .

API:
    GET  /api/instruments                      → 可选标的（含中文名/类别/point 值）
    GET  /api/duka/job?symbol=XAUUSD&tf=M1&from=2024-01-01&to=2024-06-30&price=BID
                                               → {"id": "..."} 创建下载任务
    GET  /api/duka/job/<id>                    → 进度 {state,total,done,bars,error}
    GET  /api/duka/job/<id>/csv                → 合并后的 CSV（下载完成后）
    DELETE /api/duka/job/<id>                  → 取消 / 清理

数据源: https://datafeed.dukascopy.com 的 *_candles_min_1.bi5（LZMA 压缩，24B/根，UTC）
缓存:   <root>/.cache/duka/<SYMBOL>/<Y>/<M>/<D>.csv —— 断点续传，重跑不重复下载
"""
import argparse
import csv
import io
import json
import lzma
import os
import random
import re
import struct
import sys
import threading
import time
import urllib.error
import queue
import threading
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

REC = struct.Struct("!IIIIIf")          # time_offset, open, close, low, high, volume
BASE = "https://datafeed.dukascopy.com/datafeed"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.dukascopy.com/swiss/english/marketwatch/historical/",
}

# ---------------------------------------------------------------- 实时源（biquote）
BIQUOTE_BASE = "https://biquote.io/api"
BIQUOTE_ALIAS = {                      # 我们的代码 → biquote ticker
    "BTCUSDT": "BTCUSD", "ETHUSDT": "ETHUSD", "SOLUSDT": "SOLUSD",
    "BNBUSDT": "BNBUSD", "XRPUSDT": "XRPUSD", "DOGEUSDT": "DOGEUSD",
}


_LIVE_STREAMS = {}
_LIVE_STREAM_LOCK = threading.Lock()


def _live_stream_for(symbol):
    """每个品种一个后台轮询线程；所有 SSE 客户端共享同一份上游流量。"""
    sym = (symbol or "").upper()
    with _LIVE_STREAM_LOCK:
        st = _LIVE_STREAMS.get(sym)
        if st:
            return st
        st = {"subs": [], "bars": None, "err": None, "stop": False}
        _LIVE_STREAMS[sym] = st

    def loop():
        ticker = _biquote_ticker(sym)
        while not st["stop"]:
            t0 = time.time()
            bars, err = _biquote_ohlc(ticker, "1m", 5)
            if bars is not None:
                st["bars"] = bars
                st["err"] = None
                payload = json.dumps({"symbol": sym, "ticker": ticker, "source": "biquote",
                                      "at": int(time.time() * 1000), "bars": bars[-3:]}, ensure_ascii=False)
                for q in list(st["subs"]):
                    try:
                        q.put_nowait(payload)
                    except Exception:
                        pass
            else:
                st["err"] = err
            dt = 1.0 - (time.time() - t0)
            time.sleep(max(0.15, dt))

    threading.Thread(target=loop, daemon=True, name=f"live-{sym}").start()
    return st


def _biquote_ticker(code):
    code = (code or "").upper()
    if code in BIQUOTE_ALIAS:
        return BIQUOTE_ALIAS[code]
    if code.endswith("USDT"):
        return code[:-1]                       # XXXUSDT → XXXUSD
    return code


def _biquote_ohlc(ticker, interval="1m", limit=5, attempts=3, timeout=8):
    """取最近 N 根（含正在走的那根，isOpen=true）。返回 (bars, error)"""
    url = f"{BIQUOTE_BASE}/{ticker}/ohlc?interval={interval}&limit={max(1, min(1000, limit))}"
    last = None
    for _ in range(attempts):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                obj = json.loads(r.read())
            out = []
            for b in obj.get("bars", []):
                ts = int(datetime.fromisoformat(b["openTime"].replace("Z", "+00:00")).timestamp() * 1000)
                out.append({
                    "t": ts, "o": b["open"], "h": b["high"], "l": b["low"], "c": b["close"],
                    "v": b.get("tickVolume") or 0, "open": bool(b.get("isOpen")),
                })
            out.sort(key=lambda x: x["t"])      # biquote 返回是倒序，统一升序
            return out, None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(0.6)
    return None, last


# ---------------------------------------------------------------- 标的表
INSTRUMENTS = [
    # code, 中文名, 类别, point（价格 = raw / point）, source
    ("XAUUSD", "黄金/美元", "金属", 1000, "dukascopy"),
    ("XAGUSD", "白银/美元", "金属", 1000, "dukascopy"),
    ("XAUEUR", "黄金/欧元", "金属", 1000, "dukascopy"),
    ("XAGEUR", "白银/欧元", "金属", 1000, "dukascopy"),
    ("EURUSD", "欧元/美元", "外汇", 100000, "dukascopy"),
    ("GBPUSD", "英镑/美元", "外汇", 100000, "dukascopy"),
    ("USDJPY", "美元/日元", "外汇", 1000, "dukascopy"),
    ("USDCHF", "美元/瑞郎", "外汇", 100000, "dukascopy"),
    ("USDCAD", "美元/加元", "外汇", 100000, "dukascopy"),
    ("AUDUSD", "澳元/美元", "外汇", 100000, "dukascopy"),
    ("NZDUSD", "纽元/美元", "外汇", 100000, "dukascopy"),
    ("EURJPY", "欧元/日元", "外汇", 1000, "dukascopy"),
    ("GBPJPY", "英镑/日元", "外汇", 1000, "dukascopy"),
    ("AUDJPY", "澳元/日元", "外汇", 1000, "dukascopy"),
    ("CADJPY", "加元/日元", "外汇", 1000, "dukascopy"),
    ("CHFJPY", "瑞郎/日元", "外汇", 1000, "dukascopy"),
    ("EURGBP", "欧元/英镑", "外汇", 100000, "dukascopy"),
    ("EURAUD", "欧元/澳元", "外汇", 100000, "dukascopy"),
    ("EURCHF", "欧元/瑞郎", "外汇", 100000, "dukascopy"),
    ("GBPCHF", "英镑/瑞郎", "外汇", 100000, "dukascopy"),
    ("GBPAUD", "英镑/澳元", "外汇", 100000, "dukascopy"),
    ("AUDNZD", "澳元/纽元", "外汇", 100000, "dukascopy"),
    ("USDRUB", "美元/卢布", "外汇", 1000, "dukascopy"),
    ("DEUIDXEUR", "德国 DAX", "指数", 1000, "dukascopy"),
    ("USA500IDXUSD", "标普 500", "指数", 1000, "dukascopy"),
    ("USA30IDXUSD", "道琼斯 30", "指数", 1000, "dukascopy"),
    ("USATECHIDXUSD", "纳斯达克 100", "指数", 1000, "dukascopy"),
    ("JPNIDXJPY", "日经 225", "指数", 1000, "dukascopy"),
    ("GBRIDXGBP", "英国 FTSE 100", "指数", 1000, "dukascopy"),
    # 加密走 Binance 官方归档（真实成交量、7×24、2017 起）
    ("BTCUSDT", "比特币/USDT", "加密", 1, "binance"),
    ("ETHUSDT", "以太坊/USDT", "加密", 1, "binance"),
    ("SOLUSDT", "SOL/USDT", "加密", 1, "binance"),
    ("BNBUSDT", "BNB/USDT", "加密", 1, "binance"),
    ("XRPUSDT", "XRP/USDT", "加密", 1, "binance"),
    ("DOGEUSDT", "DOGE/USDT", "加密", 1, "binance"),
    ("ADAUSDT", "ADA/USDT", "加密", 1, "binance"),
    ("AVAXUSDT", "AVAX/USDT", "加密", 1, "binance"),
    ("LINKUSDT", "LINK/USDT", "加密", 1, "binance"),
    ("LTCUSDT", "LTC/USDT", "加密", 1, "binance"),
    ("DOTUSDT", "DOT/USDT", "加密", 1, "binance"),
    ("TRXUSDT", "TRX/USDT", "加密", 1, "binance"),
    ("TONUSDT", "TON/USDT", "加密", 1, "binance"),
    ("SUIUSDT", "SUI/USDT", "加密", 1, "binance"),
    ("APTUSDT", "APT/USDT", "加密", 1, "binance"),
    ("ARBUSDT", "ARB/USDT", "加密", 1, "binance"),
    ("OPUSDT", "OP/USDT", "加密", 1, "binance"),
    ("NEARUSDT", "NEAR/USDT", "加密", 1, "binance"),
    ("INJUSDT", "INJ/USDT", "加密", 1, "binance"),
]


CRYPTO_HINTS = ("BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT", "TRX", "TON", "SUI", "APT", "ARB", "OP", "NEAR", "INJ")


def is_crypto(symbol):
    """7×24 品种：周末照样有 K 线，不能按工作日跳"""
    sym = symbol.upper()
    return any(sym.startswith(h) for h in CRYPTO_HINTS) or sym.endswith("USDT")


def point_of(symbol):
    sym = symbol.upper()
    for code, _n, _c, pt, _src in INSTRUMENTS:
        if code == sym:
            return pt
    if any(k in sym for k in ("JPY", "RUB", "IDX", "XAG", "XAU")):
        return 1000
    if sym.startswith(("BTC", "ETH", "LTC", "XRP")):
        return 10
    return 100000


# ---------------------------------------------------------------- 下载核心
def _cache_path(root, symbol, d):
    return os.path.join(root, ".cache", "duka", symbol, f"{d.year}", f"{d.month:02d}", f"{d.day:02d}.csv")


def _fetch_day(symbol, d, price="BID", attempts=8, timeout=40):
    """取一天 M1，返回 [(ts, o, h, l, c, v)]；无数据（周末/节假日）返回 []"""
    url = f"{BASE}/{symbol}/{d.year}/{d.month - 1:02d}/{d.day:02d}/{price}_candles_min_1.bi5"
    delay = 1.0
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            break
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 404:
                return []
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(delay + random.random() * 0.4)
        delay = min(delay * 1.8, 20)
    else:
        raise RuntimeError(f"{d} 下载失败（{last}）")

    if not raw:
        return []
    try:
        data = lzma.decompress(raw, format=lzma.FORMAT_AUTO)
    except lzma.LZMAError:
        return []
    base_ts = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
    pv = point_of(symbol)
    out = []
    prev = None
    for off in range(0, len(data) - len(data) % 24, 24):
        t, o, c, lo, hi, v = REC.unpack_from(data, off)
        row = (o / pv, hi / pv, lo / pv, c / pv, round(v, 4))
        # Dukascopy 用“前值重复”填充休市时段，连续完全相同四价即为假 K 线
        if prev is not None and row[:4] == prev:
            continue
        prev = row[:4]
        out.append((base_ts + t, *row))
    return out


def _day_csv(symbol, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for ts, o, h, l, c, v in rows:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        w.writerow([dt.strftime("%Y-%m-%d %H:%M:%S"), f"{o:.5f}", f"{h:.5f}", f"{l:.5f}", f"{c:.5f}", v])
    return buf.getvalue()


JOBS = {}
JOB_LOCK = threading.Lock()


def _new_job(symbol, tf, d0, d1, price, root, source="dukascopy"):
    jid = f"{int(time.time()*1000):x}{random.randint(10,99)}"
    if source == "binance":
        units = _months_between(d0, d1)
    else:
        units = []
        skip_weekend = not is_crypto(symbol)         # 加密 7×24，周末不跳
        d = d0
        while d <= d1:
            if (not skip_weekend) or d.weekday() < 5:
                units.append(d)
            d += timedelta(days=1)
    job = {
        "id": jid, "symbol": symbol, "tf": tf, "price": price, "source": source,
        "from": d0.isoformat(), "to": d1.isoformat(),
        "state": "running", "total": len(units), "done": 0,
        "bars": 0, "skipped": 0, "error": None, "cancel": False,
        "csvPath": os.path.join(root, ".cache", "jobs", f"{symbol}_{tf}_{d0}_{d1}_{price}_{source}.csv"),
        "root": root,
    }
    with JOB_LOCK:
        JOBS[jid] = job
    target = _run_job_binance if source == "binance" else _run_job
    threading.Thread(target=target, args=(job, units), daemon=True).start()
    return job


def _run_job(job, days):
    """并发取每天的缓存，然后按日期顺序拼接成最终 CSV（顺序必须严格递增）"""
    symbol, root = job["symbol"], job["root"]
    tmp = job["csvPath"] + ".part"
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    try:
        if not days:
            raise RuntimeError("所选区间里没有工作日（Dukascopy 周末休市）；加密品种请选 Binance 源")
        # 1) 并发下载并写进每天一份的缓存
        fails = []
        with ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(_fetch_day_cached, root, symbol, d, job["price"]): d for d in days}
            for fut in as_completed(futs):
                if job["cancel"]:
                    for f2 in futs:
                        f2.cancel()
                    raise RuntimeError("已取消")
                d = futs[fut]
                try:
                    rows = fut.result()
                    if rows:
                        job["bars"] += len(rows)
                    else:
                        job["skipped"] += 1
                except Exception as e:
                    fails.append(f"{d}: {e}")
                job["done"] += 1

        # 2) 按日期顺序拼起来（缓存里已排好序）
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write("datetime,open,high,low,close,volume\n")
            for d in days:
                p = _cache_path(root, symbol, d)
                if not os.path.exists(p):
                    continue
                with open(p, encoding="utf-8") as g:
                    next(g, None)                     # 跳过表头
                    for line in g:
                        if line.strip():
                            f.write(line)
        os.replace(tmp, job["csvPath"])
        if fails and job["bars"] == 0:
            raise RuntimeError(f"全部失败：{fails[0]}")
        job["failedDays"] = len(fails)
        job["state"] = "done"
    except Exception as e:
        job["state"] = "error"
        job["error"] = str(e)
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass


def _fetch_day_cached(root, symbol, d, price):
    p = _cache_path(root, symbol, d)
    if os.path.exists(p) and os.path.getsize(p) > 60:      # 只有表头 = 上次抓空，忽略
        rows = []
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.reader(f):
                if not r or r[0] == "datetime":
                    continue
                ts = int(datetime.strptime(r[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
                rows.append((ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])))
        return rows
    rows = _fetch_day(symbol, d, price)
    if rows:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write("datetime,open,high,low,close,volume\n")
            f.write(_day_csv(symbol, rows))
    return rows



# ---------------------------------------------------------------- Binance 归档
BINANCE_BASE = "https://data.binance.vision/data/spot"


def _binance_cache_path(root, symbol, ym):
    y, m = ym
    return os.path.join(root, ".cache", "binance", symbol, f"{y}", f"{m:02d}.csv")


def _parse_binance_csv(text):
    """Binance klines：无表头，open_time(ms),open,high,low,close,volume,..."""
    out = []
    for line in text.splitlines():
        if not line or line[0] == "o":            # 跳过表头（部分文件有）
            continue
        f = line.split(",")
        if len(f) < 6:
            continue
        try:
            ts = int(f[0])
            # 单位不统一：秒(1.7e9) / 毫秒(1.7e12) / 微秒(1.7e15)，一律归一到秒
            while ts > 10 ** 11:
                ts //= 1000
            o, h, l, c, v = (float(f[i]) for i in (1, 2, 3, 4, 5))
            out.append((ts, o, h, l, c, v))
        except ValueError:
            continue
    return out


def _binance_fetch_zip(url):
    req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
    with urllib.request.urlopen(req, timeout=90) as r:
        blob = r.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        name = z.namelist()[0]
        return _parse_binance_csv(z.read(name).decode("utf-8", "replace"))


def _fetch_binance_month(root, symbol, ym):
    """一个月：优先月包；月包还没有就逐日抓（当月）"""
    y, m = ym
    p = _binance_cache_path(root, symbol, ym)
    if os.path.exists(p) and os.path.getsize(p) > 60:      # 只有表头 = 上次抓空，忽略
        rows = []
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.reader(f):
                if not r or r[0] == "datetime":
                    continue
                ts = int(datetime.strptime(r[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
                rows.append((ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])))
        return rows

    rows = []
    try:
        rows = _binance_fetch_zip(f"{BINANCE_BASE}/monthly/klines/{symbol}/1m/{symbol}-1m-{y}-{m:02d}.zip")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        # 当月/上月可能还没有月包 → 逐日
        d = date(y, m, 1)
        today = date.today()
        while d.month == m and d <= today:
            try:
                rows += _binance_fetch_zip(f"{BINANCE_BASE}/daily/klines/{symbol}/1m/{symbol}-1m-{d.isoformat()}.zip")
            except urllib.error.HTTPError as e2:
                if e2.code != 404:
                    raise
            d += timedelta(days=1)
    rows.sort(key=lambda r: r[0])
    if rows:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write("datetime,open,high,low,close,volume\n")
            f.write(_rows_csv(rows))
    return rows


def _rows_csv(rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for ts, o, h, l, c, v in rows:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        w.writerow([dt.strftime("%Y-%m-%d %H:%M:%S"), f"{o:.8f}".rstrip("0").rstrip("."),
                    f"{h:.8f}".rstrip("0").rstrip("."), f"{l:.8f}".rstrip("0").rstrip("."),
                    f"{c:.8f}".rstrip("0").rstrip("."), v])
    return buf.getvalue()


def _run_job_binance(job, months):
    symbol, root = job["symbol"], job["root"]
    d0 = date.fromisoformat(job["from"])
    d1 = date.fromisoformat(job["to"])
    lo = int(datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp())
    hi = int(datetime(d1.year, d1.month, d1.day, 23, 59, 59, tzinfo=timezone.utc).timestamp())
    tmp = job["csvPath"] + ".part"
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    try:
        if not months:
            raise RuntimeError("所选区间没有可下载的月份")
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write("datetime,open,high,low,close,volume\n")
            for ym in months:
                if job["cancel"]:
                    raise RuntimeError("已取消")
                rows = _fetch_binance_month(root, symbol, ym)
                rows = [r for r in rows if lo <= r[0] <= hi]     # 月包是整月，按所选区间裁剪
                job["done"] += 1
                if rows:
                    f.write(_rows_csv(rows))
                    job["bars"] += len(rows)
                else:
                    job["skipped"] += 1
        os.replace(tmp, job["csvPath"])
        job["state"] = "done"
    except Exception as e:
        job["state"] = "error"
        job["error"] = str(e)
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass


def _months_between(d0, d1):
    out = []
    y, m = d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def handle_one_request(self):
        # SSE / 长连接客户端断开时 http.server 会抛 ConnectionResetError，别刷日志
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    server_version = "TraderTrain/1.0"

    def log_message(self, fmt, *args):
        pass                                     # 静音访问日志

    def end_headers(self):
        # 静态资源也禁缓存：改了 JS/CSS 之后 Ctrl+R 必须拿到新文件，
        # 否则 HTML 是新的、ES 模块还是旧的 → 页面空白/点了没反应。
        if not getattr(self, "_no_store_done", False):
            try:
                self.send_header("Cache-Control", "no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            except Exception:
                pass
            self._no_store_done = True
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        query = {}
        if "?" in self.path:
            for kv in self.path.split("?", 1)[1].split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    query[k] = urllib.parse.unquote(v)

        if path == "/api/live/stream":
            code = (query.get("symbol") or "").upper()
            if not code:
                return self._json({"error": "缺少 symbol"}, 400)
            st = _live_stream_for(code)
            q = queue.Queue(maxsize=8)
            st["subs"].append(q)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                if st["bars"]:
                    snap = json.dumps({"symbol": code, "source": "biquote", "at": int(time.time() * 1000),
                                       "bars": st["bars"][-3:]}, ensure_ascii=False)
                    self.wfile.write(b"data: " + snap.encode("utf-8") + b"\n\n")
                    self.wfile.flush()
                last = time.time()
                while True:
                    try:
                        item = q.get(timeout=1.0)
                        self.wfile.write(b"data: " + item.encode("utf-8") + b"\n\n")
                        self.wfile.flush()
                        last = time.time()
                    except queue.Empty:
                        if time.time() - last > 15:
                            self.wfile.write(b": ping\n\n")
                            self.wfile.flush()
                            last = time.time()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                try:
                    st["subs"].remove(q)
                except ValueError:
                    pass
            return

        if path == "/api/live":
            code = (query.get("symbol") or "").upper()
            if not code:
                return self._json({"error": "缺少 symbol"}, 400)
            try:
                limit = int(query.get("limit") or 5)
            except ValueError:
                limit = 5
            ticker = _biquote_ticker(code)
            bars, err = _biquote_ohlc(ticker, "1m", limit)
            if bars is None:
                return self._json({"error": f"上游取数失败：{err}", "symbol": code, "ticker": ticker}, 503)
            return self._json({
                "symbol": code, "ticker": ticker, "source": "biquote",
                "at": int(time.time() * 1000), "bars": bars
            })

        if path == "/api/instruments":
            return self._json([{"code": c, "name": n, "category": cat, "point": p, "source": src}
                               for c, n, cat, p, src in INSTRUMENTS])

        if path in ("/api/job", "/api/duka/job"):
            return self._create_job(query)

        m = re.match(r"^/api/(?:duka/)?job/([0-9a-f]+)(/csv)?$", path)
        if m:
            job = JOBS.get(m.group(1))
            if not job:
                return self._json({"error": "任务不存在"}, 404)
            if m.group(2):
                return self._send_csv(job)
            return self._json({k: job[k] for k in ("id", "state", "total", "done", "bars", "skipped", "error", "symbol", "tf", "source")})

        return super().do_GET()

    def do_DELETE(self):
        m = re.match(r"^/api/(?:duka/)?job/([0-9a-f]+)$", self.path.split("?")[0])
        if not m:
            return self._json({"error": "bad path"}, 400)
        job = JOBS.get(m.group(1))
        if job:
            job["cancel"] = True
            job["state"] = "cancelled"
        return self._json({"ok": True})

    def _create_job(self, q):
        try:
            symbol = (q.get("symbol") or "").upper()
            if not re.match(r"^[A-Z0-9]{3,20}$", symbol):
                raise ValueError("标的名不合法")
            source = (q.get("source") or "").lower()
            if not source:
                source = next((src for c, _n, _c, _p, src in INSTRUMENTS if c == symbol), "dukascopy")
            if source not in ("dukascopy", "binance"):
                raise ValueError(f"未知数据源 {source}")
            tf = (q.get("tf") or "M1").upper()
            if tf != "M1":
                raise ValueError("目前只支持 1 分钟（其他周期由应用内聚合）")
            d0 = date.fromisoformat(q.get("from") or (date.today() - timedelta(days=30)).isoformat())
            d1 = date.fromisoformat(q.get("to") or date.today().isoformat())
            if d1 < d0:
                raise ValueError("结束日期早于开始日期")
            if (d1 - d0).days > 366 * 8:
                raise ValueError("单次最多 8 年")
            price = (q.get("price") or "BID").upper()
            with JOB_LOCK:
                for j in JOBS.values():
                    if j["state"] == "running":
                        return self._json({"error": "已有下载任务在进行中，请等它结束或取消"}, 409)
            job = _new_job(symbol, tf, d0, d1, price, self.server.root, source)
            self._json({"id": job["id"], "total": job["total"], "source": source})
        except Exception as e:
            self._json({"error": str(e)}, 400)

    def _send_csv(self, job):
        if job["state"] != "done" or not os.path.exists(job["csvPath"]):
            return self._json({"error": f"任务状态 {job['state']}"}, 409)
        data = open(job["csvPath"], "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8733)
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    os.chdir(root)

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    srv = Server(("127.0.0.1", args.port), Handler)
    srv.root = root
    print(f"TraderTrain server on http://127.0.0.1:{args.port}  root={root}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
