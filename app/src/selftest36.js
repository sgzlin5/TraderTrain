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
    const c0 = ws.cells[0];
    const box = c0.el.getBoundingClientRect();
    // 直接用内部入口模拟一次 hover（selftest 里没法发真实鼠标事件）
    state.cxSync._apply(c0, { x: Math.round(box.width / 2), y: Math.round(box.height / 2), paneId: 'candle_pane' });
    await wait(200);
    const lines = [...document.querySelectorAll('.cx-line')].map(el => ({
      cell: el.parentElement?.dataset?.cell, disp: el.style.display, left: el.style.left
    }));
    log('crosshair', { cells: ws.cells.length, lines });
    state.cxSync.setEnabled(false);
    await wait(120);
    const offHidden = [...document.querySelectorAll('.cx-line')].every(el => el.style.display === 'none');
    state.cxSync.setEnabled(true);
    log('crosshairToggle', { offHidden });

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
      && s.crosshair.cells >= 2
      && s.crosshair.lines.length >= 2
      && s.crosshair.lines.every(l => l.disp === 'block' && l.left && l.left !== '')
      && s.crosshairToggle.offHidden === true
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
