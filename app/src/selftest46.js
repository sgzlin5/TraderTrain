// 46 号验收：策略回测（区间取数 / 轻载荷 / 进度与取消 / 逐 bar 统计 / 存档对比）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const SRC = '//@version=6\nstrategy("SMA", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.02)\n'
    + 'fast = ta.sma(close,20)\nslow = ta.sma(close,50)\n'
    + 'if ta.crossover(fast,slow)\n    strategy.entry("L", strategy.long)\n'
    + 'if ta.crossunder(fast,slow)\n    strategy.close("L")\n';

  try {
    for (let i = 0; i < 100 && !window.__UI_READY__; i++) await wait(100);
    const BT = await import('./backtest.js');
    const pine = await import('./pine.js');
    const prof = state.profile;
    if (!prof) throw new Error('没有行情档案');

    // 1) 区间取数（60 天 1m）
    const end = prof.live?.last || prof.last;
    const start = end - 60 * 86400000;
    const f = await BT.fetchRange(prof, { startTs: start, endTs: end, spanMs: 60_000 });
    let mono = true;
    for (let i = 1; i < f.bars.length; i++) if (f.bars[i].timestamp <= f.bars[i - 1].timestamp) { mono = false; break; }
    const noDup = new Set(f.bars.map((b) => b.timestamp)).size === f.bars.length;
    log('range', {
      n: f.bars.length, mono, truncated: f.truncated,
      inRange: f.from >= start && f.to <= end,
      fetchMs: f.ms, noDup
    });
    if (!f.bars.length) throw new Error('区间取数为空');

    // 2) 同一批数据跑两次必须完全一致（回测可复现）
    const r1 = await pine.compileBacktest({ src: SRC, bars: f.bars, symbol: prof.symbol });
    const r2 = await pine.compileBacktest({ src: SRC, bars: f.bars, symbol: prof.symbol });
    log('deterministic', {
      ok: r1.ok && r2.ok,
      trades: r1.strategy?.closed?.length, trades2: r2.strategy?.closed?.length,
      net: r1.strategy?.netprofit, net2: r2.strategy?.netprofit
    });

    // 3) 轻载荷：回测只回 strategy，不回 series/plots（大区间才不会被克隆顶死）
    log('payload', { hasStrategy: !!r1.strategy, hasSeries: 'series' in r1, hasPlots: 'plots' in r1, ms: r1.ms });

    // 4) 统计口径：逐 bar 权益 / 回撤 / 夏普 / 买持 / 月度
    const sum = BT.analyze({ bars: f.bars, strategy: r1.strategy, spanMs: 60_000 });
    log('metrics', {
      bars: sum.bars, equity: sum.bars, curve: sum.curve.length,
      maxDDPct: +sum.maxDDPct.toFixed(4), exposure: +sum.exposure.toFixed(3),
      sharpe: sum.sharpe == null ? null : +sum.sharpe.toFixed(2),
      buyHold: sum.buyHold == null ? null : +sum.buyHold.toFixed(4),
      monthly: sum.monthly.length, fees: +(sum.fees || 0).toFixed(2),
      curveMax: Math.max(...sum.curve), curveLast: sum.curve[sum.curve.length - 1]
    });

    // 5) 取消：起了就取消，必须回 cancelled 且不再持有挂起任务
    const p = pine.compileBacktest({ src: SRC, bars: f.bars.concat(f.bars), symbol: prof.symbol });
    await wait(40);
    pine.cancelBacktest();
    const rc = await p;
    log('cancel', { cancelled: !!rc.cancelled, ok: !!rc.ok, busy: pine.backtestBusy() });
    // 取消后 worker 必须能重建
    const r3 = await pine.compileBacktest({ src: SRC, bars: f.bars.slice(-5000), symbol: prof.symbol });
    log('afterCancel', { ok: r3.ok, trades: r3.strategy?.closed?.length });

    // 6) UI：跑一次近 7 天 15m，面板要出数、能存档、能清空
    document.getElementById('pineSrc').value = SRC;
    document.getElementById('pineName').value = 'selftest46';
    document.getElementById('btRange').value = '7';
    document.getElementById('btPeriod').value = '15';
    document.getElementById('btRange').dispatchEvent(new Event('change'));
    const ui = await window.__TT_BT__.run();
    await wait(400);
    const panel = document.getElementById('stratPanel');
    const stats = document.getElementById('stratStats');
    const meta = document.getElementById('stratMeta');
    log('ui', {
      ran: !!ui, panel: !panel.hidden, statItems: stats.querySelectorAll('.it').length,
      metaHasBars: /根/.test(meta.textContent || ''), progHidden: document.getElementById('btProg').hidden,
      curveW: document.getElementById('stratCurve').width
    });
    await window.__TT_BT__.clear();            // 从空库开始，断言才稳（之前手工跑的可能还留着）
    await window.__TT_BT__.save();
    const runs = await window.__TT_BT__.runs();
    log('archive', { n: runs.length, hasCurve: Array.isArray(runs[0]?.curve) && runs[0].curve.length > 1, name: runs[0]?.name });
    await window.__TT_BT__.clear();
    log('archiveCleared', { n: (await window.__TT_BT__.runs()).length });

    const rangeParts = {
      enough: f.bars.length > 1000,
      mono: mono === true,
      noDup: noDup === true,
      fromOk: typeof f.from === 'number' && f.from >= start,
      toOk: typeof f.to === 'number' && f.to <= end
    };
    log('rangeParts', rangeParts);
    const verdict = {
      rangeOk: Object.values(rangeParts).every(Boolean),
      deterministic: r1.ok && r2.ok && r1.strategy?.closed?.length === r2.strategy?.closed?.length
        && Math.abs((r1.strategy?.netprofit || 0) - (r2.strategy?.netprofit || 0)) < 1e-6,
      lightPayload: !!r1.strategy && r1.series === undefined && r1.plots === undefined,
      metricsOk: sum.bars === f.bars.length && sum.curve.length >= 2 && sum.maxDDPct >= 0
        && sum.exposure >= 0 && sum.exposure <= 1 && sum.monthly.length >= 1,
      cancelOk: rc.cancelled === true && pine.backtestBusy() === false && r3.ok === true,
      uiOk: !!ui && !panel.hidden && stats.querySelectorAll('.it').length === 12 && /根/.test(meta.textContent || ''),
      archiveOk: runs.length === 1 && Array.isArray(runs[0]?.curve) && runs[0].curve.length > 1,
      archiveClearedOk: R.checks.archiveCleared?.n === 0
    };
    log('verdict', verdict);
    R.pass = Object.values(verdict).every(Boolean);
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
