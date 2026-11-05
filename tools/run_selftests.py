#!/usr/bin/env python3
"""跑一遍 ?selftest=N 自检并输出汇总（走 Chrome 远程调试协议）。

用法：
  python tools/run_selftests.py --port 9222 --base http://127.0.0.1:8731 --tests 1-45
  python tools/run_selftests.py --tests 2,11,44 --json out.json --fresh

前提：Chrome 以 --remote-debugging-port=<port> 启动，且已打开 base 页面（脚本会自动新建标签）。
"""
import argparse
import asyncio
import os
import subprocess
import json
import sys
import time
import urllib.request

import websockets


CHROME_CANDIDATES = [
    r"C:/Program Files/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]


def _cdp_alive(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as r:
            json.load(r)
        return True
    except Exception:
        return False


def ensure_chrome(port, profile_dir, headed=False):
    """--remote-debugging-port 没起就先拉一个（测试专用 profile，headless 省内存）"""
    if _cdp_alive(port):
        return
    exe = next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)
    if not exe:
        raise RuntimeError("找不到 Chrome/Edge，无法自动启动调试实例")
    os.makedirs(profile_dir, exist_ok=True)
    args = [exe, f"--remote-debugging-port={port}", f"--user-data-dir={profile_dir}",
            "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-background-networking", "--disable-features=Translate"]
    if not headed:
        args.append("--headless=new")
    args.append("about:blank")
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        if _cdp_alive(port):
            return
        time.sleep(0.5)
    raise RuntimeError(f"启动调试浏览器后 {port} 仍不可用")


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
        pages = [t for t in res["targetInfos"] if t["type"] == "page"]
        page = pages[0] if pages else None
        # 关掉多余标签：每个页面都吃 400 万根数据，开多了会互相拖死
        for t in pages[1:]:
            try:
                await self.send("Target.closeTarget", {"targetId": t["targetId"]})
            except Exception:
                pass
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


async def seed_origin(br, base, timeout_s=900):
    """把 data/manifest.json 的 bin 分片导入当前 origin 的 IndexedDB（幂等：已有档案就跳过）"""
    print(f"[SEED] {base}/app/index.html?seed=1", flush=True)
    await br.goto(f"{base}/app/index.html?seed=1")
    deadline = time.time() + timeout_s
    last = -1
    while time.time() < deadline:
        st = await br.evaluate("JSON.stringify({d:!!window.__SEED_DONE__,p:window.__SEED_PCT__||0,e:window.__SEED_ERR__||''})")
        if st:
            v = json.loads(st)
            if v["p"] != last and v["p"] % 10 == 0:
                print(f"[SEED] {v['p']}%", flush=True)
                last = v["p"]
            if v["d"]:
                print("[SEED] done" + (f" err={v['e']}" if v["e"] else ""), flush=True)
                return not v["e"]
        await asyncio.sleep(1.0)
    print("[SEED] 超时", flush=True)
    return False


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
    ensure_chrome(args.port, args.profile, args.headed)
    br = Browser(args.port)
    await br.connect()
    if args.seed:
        ok = await seed_origin(br, args.base, args.seed_timeout)
        if not ok:
            print("灌数据失败，终止", flush=True)
            await br.close()
            return 2
    tests = parse_tests(args.tests)
    results = []
    for n in tests:
        try:
            r = await run_one(br, args.base, n, args.fresh, args.timeout)
            # UI 用例有偶发抖动（首帧未稳、实时刷新正好插进来），失败重试一次，成功的标 flaky
            for attempt in range(args.retry):
                if r.get("pass"):
                    break
                print(f"[RETRY ] #{n} 第 {attempt + 2} 次", flush=True)
                r2 = await run_one(br, args.base, n, args.fresh, args.timeout, ready_timeout=40)
                if r2.get("pass"):
                    r2["flaky"] = True
                    r = r2
                    break
                r = r2
        except Exception as e:            # CDP 卡住/浏览器崩了：重连后继续
            print(f"[RECONN] #{n} {type(e).__name__}: {e}", flush=True)
            await br.close()
            ensure_chrome(args.port, args.profile, args.headed)
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
    ap.add_argument("--base", default="http://127.0.0.1:8731")
    ap.add_argument("--tests", default="1-45")
    ap.add_argument("--fresh", action="store_true", help="每个用例前清会话/成交/提醒/SMC 指标")
    ap.add_argument("--timeout", type=int, default=90, help="单个用例最长等待秒数")
    ap.add_argument("--profile", default=os.path.join(os.path.expanduser("~"), "AppData/Local/hermes/cache/chrome-test-profile"))
    ap.add_argument("--headed", action="store_true", help="有界面启动（默认 headless=new）")
    ap.add_argument("--retry", type=int, default=1, help="失败的用例重试次数（0 = 不重试）")
    ap.add_argument("--seed", action="store_true", help="先跑 ?seed=1 把 data/manifest.json 灌进该 origin")
    ap.add_argument("--seed-timeout", type=int, default=900)
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    try:
        sys.exit(asyncio.run(main_async(args)))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
