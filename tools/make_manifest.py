#!/usr/bin/env python3
"""扫描 data/bin/<profile>/ 生成 data/manifest.json（导入器唯一数据入口）。

用法: python tools/make_manifest.py [data_dir]

产物字段:
  { profiles: [ { symbol, period, recordBytes, priceScale, first, last, bars, bytes,
                  chunks: [{year, file, bytes, bars, first, last, sha256}] } ] }
"""
import hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORD = 28

def sha256(path, buf=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(buf)
            if not b:
                break
            h.update(b)
    return h.hexdigest()

def build(data_dir):
    profiles = []
    for name in sorted(os.listdir(data_dir)):
        pdir = os.path.join(data_dir, name)
        if not os.path.isdir(pdir):
            continue
        metas = [f for f in os.listdir(pdir) if f.endswith(".meta.json")]
        if not metas:
            continue
        meta = json.load(open(os.path.join(pdir, metas[0]), encoding="utf-8"))
        symbol = meta["symbol"]
        chunks = []
        for f in sorted(os.listdir(pdir)):
            if not f.endswith(".bin"):
                continue
            year = f.rsplit("-", 1)[1].split(".")[0]
            path = os.path.join(pdir, f)
            size = os.path.getsize(path)
            assert size % RECORD == 0, f"{f} 不是 {RECORD} 字节整数倍"
            ymeta = meta["years"].get(year, {})
            chunks.append({
                "year": year, "file": f, "bytes": size, "bars": size // RECORD,
                "first": ymeta.get("first"), "last": ymeta.get("last"),
                "sha256": sha256(path),
            })
        profiles.append({
            "id": f"{symbol}-1m",
            "symbol": symbol,
            "period": meta["period"],
            "recordBytes": RECORD,
            "priceScale": meta["layout"]["price_scale"],
            "zeroVolume": meta.get("zero_volume_bars", 0) == meta.get("bars", -1),
            "bars": sum(c["bars"] for c in chunks),
            "bytes": sum(c["bytes"] for c in chunks),
            "first": min((c["first"] for c in chunks if c["first"]), default=None),
            "last": max((c["last"] for c in chunks if c["last"]), default=None),
            "gaps": meta.get("gaps_over_1min", 0),
            "dir": os.path.relpath(pdir, ROOT).replace("\\", "/"),
            "chunks": chunks,
        })
    return {"version": 1, "recordBytes": RECORD, "generatedAt": None, "profiles": profiles}

if __name__ == "__main__":
    data_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "bin")
    m = build(data_dir)
    out = os.path.join(ROOT, "data", "manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    for p in m["profiles"]:
        print(f"{p['id']}: {p['bars']} bars / {p['bytes']/1048576:.1f} MB / {len(p['chunks'])} chunks / "
              f"{p['first']} → {p['last']} / zeroVolume={p['zeroVolume']}")
    print("manifest ->", out)
