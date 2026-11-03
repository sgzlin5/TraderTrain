#!/usr/bin/env python3
"""1m CSV -> 分年 bin（定点价格，零精度损失）。

记录格式（28 B/根，小端 LE）:
  int64  timestamp_ms
  int32  open   (price * SCALE)
  int32  high   (price * SCALE)
  int32  low    (price * SCALE)
  int32  close  (price * SCALE)
  float32 volume

用法:
  python csv2bin.py <in.csv> <out_dir> [--symbol XAUUSD] [--year-from 2015] [--scale 1000]

产物:
  <out_dir>/<SYMBOL>-1m-<YYYY>.bin
  <out_dir>/<SYMBOL>-1m.meta.json   {bars, first, last, years{}, gaps, scale, zero_volume_bars, layout}
"""
import csv, json, os, struct, sys, datetime, time

REC = struct.Struct("<qiiiif")          # 8 + 4*4 + 4 = 28 B
SCALE = 1000

def main(src, out_dir, symbol="XAUUSD", year_from=0, scale=SCALE):
    os.makedirs(out_dir, exist_ok=True)
    files, per_year, gaps = {}, {}, []
    total = zero_vol = 0
    prev = None
    t0 = time.time()
    def q(p):                              # 价格 -> 定点
        return int(round(float(p) * scale))
    with open(src, newline="", encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            dt = datetime.datetime.strptime(rec["datetime"], "%Y-%m-%d %H:%M:%S")
            if dt.year < year_from:
                continue
            ts = int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
            v = float(rec["volume"])
            if v == 0:
                zero_vol += 1
            if prev is not None and ts - prev > 60000:
                gaps.append([prev, ts, (ts - prev) // 60000])
            prev = ts
            y = dt.year
            fp = files.get(y)
            if fp is None:
                fp = files[y] = open(os.path.join(out_dir, f"{symbol}-1m-{y}.bin"), "wb")
                per_year[y] = {"first": ts, "last": ts, "bars": 0}
            fp.write(REC.pack(ts, q(rec["open"]), q(rec["high"]), q(rec["low"]), q(rec["close"]), v))
            m = per_year[y]; m["last"] = ts; m["bars"] += 1
            total += 1
    for fp in files.values():
        fp.close()
    meta = {
        "symbol": symbol, "period": {"span": 1, "type": "minute"},
        "layout": {"record_bytes": 28, "endian": "little",
                   "fields": ["timestamp_ms:int64", "open:int32", "high:int32", "low:int32", "close:int32", "volume:float32"],
                   "price_scale": scale},
        "bars": total,
        "first": min((m["first"] for m in per_year.values()), default=None),
        "last": max((m["last"] for m in per_year.values()), default=None),
        "years": {str(y): per_year[y] for y in sorted(per_year)},
        "gaps_over_1min": len(gaps), "gaps": gaps[:5000],
        "zero_volume_bars": zero_vol,
        "source_tz": "raw (源时间直读, 日线/周线聚合按配置 tz 切)",
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    with open(os.path.join(out_dir, f"{symbol}-1m.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    out_mb = sum(os.path.getsize(os.path.join(out_dir, n)) for n in os.listdir(out_dir)) / 1048576
    print(json.dumps({"bars": total, "years": len(per_year), "out_mb": round(out_mb, 1),
                      "gaps": len(gaps), "zero_volume": zero_vol,
                      "seconds": round(time.time() - t0, 1)}, ensure_ascii=False))

if __name__ == "__main__":
    a = sys.argv[1:]
    kw = {}
    for flag, key, cast in (("--symbol", "symbol", str), ("--year-from", "year_from", int), ("--scale", "scale", int)):
        if flag in a:
            i = a.index(flag); kw[key] = cast(a[i + 1]); del a[i:i + 2]
    main(a[0], a[1], **kw)
