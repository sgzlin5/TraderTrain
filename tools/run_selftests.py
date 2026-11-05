#!/usr/bin/env python3
"""跑一遍 ?selftest=N 自检并输出汇总（走 Chrome 远程调试协议）。

用法：
  python tools/run_selftests.py --port 9222 --base http://127.0.0.1:8733 --tests 1-45
  python tools/run_selftests.py --tests 2,11,44 --json out.json --fresh

前提：Chrome 以 --remote-debugging-port=<port> 启动，且已打开 base 页面（脚本会自动新建标签）。
"""
import argparse
import asyncio
import json
import sys
import time
import urllib.request

import websockets


async def cdp_ws(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as r:
        info = json.load(r)
    return info["webSocketDebuggerUrl"]


class Browser:
    def __init__(self, port):
        self.port = port
        self.ws = None
        self.seq = 0

    async def connect(self):
        url = await cdp_ws(self.port)
        self.ws = await websockets.connect(url, max_size=64 * 1024 * 1024)
        # 复用已有的 page target，没有就新建
        res = await self.send("Target.getTargets")
        page = next((t for t in res["targetInfos"] if t["type"] == "page"), None)
        if page:
            att = await self.send("Target.attachToTarget", {"targetId": page["targetId"], "flatten": True})
            self.session = att["sessionId"]
        else:
            nt = await self.send("Target.createTarget", {"url": "about:blank"})
            att = await self.send("Target.attachToTarget", {"targetId": nt["targetId"], "flatten": True})
            self.session = att["sessionId"]

    async def send(self, method, params=None, session=True, timeout=40):
        self.seq += 1
        msg = {"id": self.seq, "method": method, "params": params or {}}
        if session and getattr(self, "session", None):
            msg["sessionId"] = self.session
        await self.ws.send(json.dumps(msg))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            data = json.loads(raw)
            if data.get("id") == self.seq:
                if "error" in data:
                    raise RuntimeError(f"{method}: {data['error']}")
                return data.get("result", {})

    async def evaluate(self, expr, timeout=40):
        res = await self.send("Runtime.evaluate",
                              {"expression": expr, "awaitPromise": True, "returnByValue": True},
                              timeout=timeout)
        if "exceptionDetails" in res:
            return None
        return res.get("result", {}).get("value")

    async def goto(self, url):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(0.4)

    async def close(self):
        try:
            await self.ws.close()
        except Exception:
            pass


def parse_tests(spec):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


async def run_one(br, base, n, fresh, timeout_s, ready_timeout=25):
    url = f"{base}/app/index.html?selftest={n}" + ("&fresh=1" if fresh else "")
    t0 = time.time()
    await br.goto(url)
    # 等页面就绪（有的用例自己等，这里只兜底）
    deadline = time.time() + ready_timeout
    while time.time() < deadline:
        v = await br.evaluate("window.__UI_READY__ === true")
        if v:
            break
        await asyncio.sleep(0.3)
    res = None
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        raw = await br.evaluate("window.__RESULT__ && window.__RESULT__.done ? JSON.stringify(window.__RESULT__) : ''")
        if raw:
            res = json.loads(raw)
            break
        await asyncio.sleep(0.4)
    ms = round((time.time() - t0) * 1000)
    if not res:
        return {"test": n, "pass": None, "ms": ms, "state": "TIMEOUT"}
    return {"test": n, "pass": bool(res.get("pass")), "ms": res.get("elapsedMs", ms),
            "errors": (res.get("errors") or [])[:1], "state": "done"}


async def main_async(args):
    br = Browser(args.port)
    await br.connect()
    tests = parse_tests(args.tests)
    results = []
    for n in tests:
        try:
            r = await run_one(br, args.base, n, args.fresh, args.timeout)
        except Exception as e:            # CDP 卡住/浏览器崩了：重连后继续
            print(f"[RECONN] #{n} {type(e).__name__}: {e}", flush=True)
            await br.close()
            br = Browser(args.port)
            await br.connect()
            r = {"test": n, "pass": None, "ms": 0, "state": "CDP_ERROR", "errors": [str(e)[:120]]}
        results.append(r)
        mark = "PASS" if r["pass"] else ("FAIL" if r["pass"] is False else "TIMEOUT")
        print(f"[{mark:7}] #{n:<3} {r.get('ms')} ms {r.get('errors') or ''}", flush=True)
    await br.close()

    ok = [r for r in results if r["pass"]]
    bad = [r for r in results if not r["pass"]]
    print(f"\n合计 {len(results)}：通过 {len(ok)}，未通过 {len(bad)}")
    if bad:
        print("未通过：", ", ".join(f"#{r['test']}({r['state']})" for r in bad))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"when": time.strftime("%Y-%m-%d %H:%M:%S"), "results": results}, f, ensure_ascii=False, indent=1)
        print(f"报告：{args.json}")
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="9222", help="Chrome 远程调试端口")
    ap.add_argument("--base", default="http://127.0.0.1:8733")
    ap.add_argument("--tests", default="1-45")
    ap.add_argument("--fresh", action="store_true", help="每个用例前清会话/成交/提醒/SMC 指标")
    ap.add_argument("--timeout", type=int, default=90, help="单个用例最长等待秒数")
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    try:
        sys.exit(asyncio.run(main_async(args)))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
