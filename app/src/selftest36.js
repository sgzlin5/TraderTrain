// M36 验收：A1 Pine Worker / A2 十字光标跨图同步 / A3 策略回测
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const pine = await import('./pine.js');
    const ps = await import('./pineStrategy.js');
    const bars = state.app.bars.allBars();
    const sym = state.profile?.symbol || 'XAUUSD';

    // ---- A1：重脚本走 Worker，主线程不掉帧 ----
    const heavy = '//@version=6\nindicator("t")\ns = 0.0\nfor i = 0 to bar_index\n    for j = 0 to 60\n        s += 1\nplot(s, "s")';
    let beats = 0;
    const iv = setInterval(() => beats++, 16);
    const t0 = performance.now();
    const rh = await pine.compilePine(heavy, bars, null, sym);
    const heavyMs = Math.round(performance.now() - t0);
    clearInterval(iv);
    // 轻脚本基线
    const t1 = performance.now();
    const rl = await pine.compilePine('//@version=6\nindicator("t")\nplot(ta.ema(close,20), "e")', bars, null, sym);
    const lightMs = Math.round(performance.now() - t1);
    log('worker', {
      viaWorker: rh.viaWorker === true, heavyOk: rh.ok, heavyMs, heartbeats: beats,
      lightMs, lightOk: rl.ok, workerReady: pine.pineWorkerReady()
    });

    // ---- A2：十字光标跨图同步 ----
    const ws = state.workspace;
    if (ws.cells.length < 2) {
      state.wsLayout = '2h';
      await ws.applyLayout('2h', { periods: ['1m', '5m'] });
      await wait(2500);
    }
    state.cxSync.refresh();
    const cells = ws.cells.slice();
    const c0 = cells[0];
    const others = cells.filter(c => c !== c0);
    // [vela] 幽灵线走 renderer.setExternalCrosshair（数据空间），没有 .cx-line DOM：
    // 用探针替换其余格的接口，验证「同一 time 被镜像过去」+「关掉后不再镜像」
    const calls = [];
    const orig = new Map();
    for (const c of others) {
      const r = c?.app?.chart?.renderer;
      if (!r || typeof r.setExternalCrosshair !== 'function') continue;
      orig.set(c, r.setExternalCrosshair);
      r.setExternalCrosshair = (time, price) => { calls.push({ cell: c.i, time, price }); };
    }
    const ts = state.app.bars.allBars().slice(-30)[0]?.timestamp ?? null;
    state.cxSync._onMove(c0, { time: ts, price: 4000, paneKind: 'price' });
    await wait(150);
    const mirrored = calls.filter(x => x.time === ts && x.price === 4000).length;
    state.cxSync.setEnabled(false);          // 关闭时会 _clear()，基线取在它之后
    await wait(80);
    const n0 = calls.length;
    state.cxSync._onMove(c0, { time: ts + 60000, price: 4001, paneKind: 'price' });
    await wait(120);
    const offStopped = calls.length === n0;
    state.cxSync.setEnabled(true);
    for (const [c, fn] of orig) {
      try { c.app.chart.renderer.setExternalCrosshair = fn; c.app.chart.renderer.setExternalCrosshair(null); } catch {}
    }
    log('crosshair', { cells: cells.length, probe: orig.size, mirrored, calls: calls.length });
    log('crosshairToggle', { offStopped });

    // ---- A3：策略回测 ----
    const SRC = `//@version=6
strategy("MA Cross 10/30", overlay=true, initial_capital=10000)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
plot(fast, "f")
plot(slow, "s")`;
    const rs = await pine.compilePine(SRC, bars, null, sym);
    const sum = ps.summarize(rs.strategy);
    log('strategy', {
      ok: rs.ok, hasStrategy: !!rs.strategy, viaWorker: rs.viaWorker,
      trades: sum?.trades ?? null, curve: sum?.curve?.length ?? null,
      net: sum ? +sum.net.toFixed(2) : null,
      winRate: sum ? +(sum.winRate * 100).toFixed(1) : null,
      pf: sum ? (sum.pf === Infinity ? 'inf' : +sum.pf.toFixed(2)) : null,
      rows: sum?.rows?.length ?? 0,
      firstSide: sum?.rows?.[0]?.side ?? null
    });
    // 面板渲染
    const sum2 = ps.summarize(rs.strategy);
    window.__TT_RENDER_STRAT__?.(sum2, 'selftest');
    await wait(300);

    const s = R.checks;
    R.pass = (
      s.worker.viaWorker === true && s.worker.heavyOk === true && s.worker.workerReady === true
      && s.worker.lightOk === true
      && s.crosshair.cells >= 2 && s.crosshair.probe >= 1
      && s.crosshair.mirrored >= 1
      && s.crosshairToggle.offStopped === true
      && s.strategy.ok === true && s.strategy.hasStrategy === true
      && s.strategy.trades > 0 && s.strategy.curve === s.strategy.trades + 1
      && s.strategy.rows === s.strategy.trades && (s.strategy.firstSide === '多' || s.strategy.firstSide === '空')
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
