#!/usr/bin/env python3
"""CDP 小工具：evaluate JS / 读 console。用法：
  python tools/cdp_eval.py "expression"          # 在已开的 TraderTrain 标签里求值
  python tools/cdp_eval.py --console 30          # 读最近 30 条 console
"""
import argparse, asyncio, json, sys, urllib.request
import websockets

PORT = 9333
ORIGIN = '8733'

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('expr', nargs='?')
    ap.add_argument('--console', type=int, default=0)
    ap.add_argument('--timeout', type=float, default=30)
    args = ap.parse_args()

    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json') as r:
        tabs = json.load(r)
    import os
    origin = os.environ.get('TT_ORIGIN', '8733')
    cands = [t for t in tabs if t['type'] == 'page' and origin in t['url']]
    page = next((t for t in reversed(cands) if 'selftest' in t['url']), cands[-1] if cands else None)
    if not page:
        print('NO-TAB', json.dumps([t['url'] for t in tabs if t['type'] == 'page'])[:300]); return
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=64*1024*1024) as ws:
        seq = 0
        logs = []
        async def cmd(method, params=None, sid=None):
            nonlocal seq
            seq += 1
            m = {'id': seq, 'method': method, 'params': params or {}}
            if sid: m['sessionId'] = sid
            await ws.send(json.dumps(m))
            return seq
        await cmd('Runtime.enable')
        sid = None
        if args.console:
            # 收若干秒 console，再返回
            try:
                await asyncio.wait_for(_drain(ws, logs, args.console), timeout=args.console + 4)
            except asyncio.TimeoutError:
                pass
            for l in logs[-60:]:
                print(l)
            return
        res_id = await cmd('Runtime.evaluate', {
            'expression': args.expr, 'returnByValue': True, 'awaitPromise': True
        })
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=args.timeout))
            if msg.get('id') == res_id:
                r = msg.get('result', {}).get('result', {})
                v = r.get('value')
                print(json.dumps(v, ensure_ascii=False, default=str)[:4000] if not isinstance(v, str) else v[:4000])
                if r.get('subtype') == 'error' or 'exceptionDetails' in msg.get('result', {}):
                    print('EVAL-ERROR', json.dumps(msg['result'].get('exceptionDetails', {}))[:1500])
                break

async def _drain(ws, logs, seconds):
    loop = asyncio.get_event_loop()
    end = loop.time() + seconds
    while loop.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
        except asyncio.TimeoutError:
            continue
        m = json.loads(raw)
        if m.get('method') == 'Runtime.consoleAPICalled':
            p = m['params']
            txt = ' '.join(str(a.get('value', a.get('description', '')))[:200] for a in p.get('args', []))
            logs.append(f"[{p.get('type')}] {txt[:300]}")
        elif m.get('method') == 'Runtime.exceptionThrown':
            d = m['params']['exceptionDetails']
            logs.append('[EXC] ' + json.dumps(d.get('exception', {}).get('description', d))[:300])

asyncio.run(main())
