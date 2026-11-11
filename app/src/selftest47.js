// 47 号验收：Pine 回测引擎口径与 TradingView 对齐（docs/BT-TV-PARITY.md 的可执行版本）
// 只用合成 bar，不依赖行情档案；引擎升级后这条必须重新跑。
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const NL = String.fromCharCode(10);
  const join = (a) => a.join(NL);
  const T0 = Date.UTC(2026, 0, 1);
  const idx = (ts) => Math.round((Number(ts) - T0) / 60000);

  // 通用序列：前 10 根横盘 → bar10 收 101（信号）→ bar11 开盘成交 → bar12 只影线穿价
  const mkBars = (b12) => {
    const rows = [];
    const push = (o, h, l, c, i) => rows.push({ timestamp: T0 + i * 60000, open: o, high: h, low: l, close: c, volume: 100 });
    for (let i = 0; i < 10; i++) push(100, 100.2, 99.8, 100, i);
    push(100, 101.2, 99.9, 101, 10);
    push(101, 101.4, 100.8, 101, 11);
    push(101, b12.h, b12.l, b12.c, 12);
    for (let i = 13; i < 20; i++) push(101, 101.2, 100.8, 101, i);
    return rows;
  };

  // 多空切换序列（pyramiding / commission 用）
  const sineBars = (n = 80) => {
    const rows = [];
    let prev = 100;
    for (let i = 0; i < n; i++) {
      const c = +(100 + 3 * Math.sin(i * 1.1)).toFixed(4);
      rows.push({ timestamp: T0 + i * 60000, open: prev, high: Math.max(prev, c) + 0.2, low: Math.min(prev, c) - 0.2, close: c, volume: 100 });
      prev = c;
    }
    return rows;
  };

  const srcExit = (extra, stop, limit) => join([
    '//@version=5',
    'strategy("exit", overlay=true, initial_capital=10000' + extra + ')',
    'if bar_index == 10',
    '    strategy.entry("L", strategy.long)',
    'if strategy.position_size > 0',
    '    strategy.exit("X", "L", stop=' + stop + ', limit=' + limit + ')',
  ]);

  const srcPyr = (extra) => join([
    '//@version=5',
    'strategy("pyr", overlay=true, initial_capital=10000' + extra + ')',
    'if close > close[1]',
    '    strategy.entry("L", strategy.long)',
  ]);

  const srcTrade = (extra) => join([
    '//@version=5',
    'strategy("tr", overlay=true, initial_capital=10000' + extra + ')',
    'fast = ta.sma(close, 2)',
    'slow = ta.sma(close, 5)',
    'if ta.crossover(fast, slow)',
    '    strategy.entry("L", strategy.long)',
    'if ta.crossunder(fast, slow)',
    '    strategy.close("L")',
  ]);

  try {
    for (let i = 0; i < 100 && !window.__UI_READY__; i++) await wait(100);
    const pine = await import('./pine.js');
    const BT = await import('./backtest.js');
    const runBT = (src, bars) => pine.compileBacktest({ src, bars, symbol: 'PARITY' });

    // 1) 市价成交时点：posc=false → 下一 bar 开盘；posc=true → 信号 bar 收盘
    const bStop = mkBars({ h: 101.2, l: 96, c: 100.5 });
    const off = await runBT(srcExit(', process_orders_on_close=false', 99, 200), bStop);
    const on = await runBT(srcExit(', process_orders_on_close=true', 99, 200), bStop);
    const tOff = off.strategy?.closed?.[0] || {};
    const tOn = on.strategy?.closed?.[0] || {};
    log('fillTiming', {
      offEntryBar: idx(tOff.entry_time), offEntryPx: tOff.entry_price, offBarOpen: bStop[11].open,
      onEntryBar: idx(tOn.entry_time), onEntryPx: tOn.entry_price, onBarClose: bStop[10].close
    });

    // 2) stop / limit 是否按 bar 内 high/low 触发（收盘价没穿也算成交）
    const bLimit = mkBars({ h: 106, l: 100.2, c: 100.5 });
    const sOut = await runBT(srcExit('', 99, 200), bStop);
    const lOut = await runBT(srcExit('', 80, 103), bLimit);
    const sT = sOut.strategy?.closed?.[0] || {};
    const lT = lOut.strategy?.closed?.[0] || {};
    log('intrabar', {
      stopExitBar: idx(sT.exit_time), stopExitPx: sT.exit_price, stopBarClose: bStop[12].close, stopBarLow: bStop[12].low,
      limitExitBar: idx(lT.exit_time), limitExitPx: lT.exit_price, limitBarHigh: bLimit[12].high
    });

    // 3) pyramiding：缺省 1 笔；=3 允许 3 笔同向
    const bPy = sineBars();
    const p0 = await runBT(srcPyr(''), bPy);
    const p3 = await runBT(srcPyr(', pyramiding=3'), bPy);
    const n0 = (p0.strategy?.closed || []).length + (p0.strategy?.open || []).length;
    const n3 = (p3.strategy?.closed || []).length + (p3.strategy?.open || []).length;
    log('pyramiding', { defaultEntries: n0, threeEntries: n3, threeOpen: (p3.strategy?.open || []).length });

    // 4) 手续费：cash_per_contract=1 → 每笔多扣 2；percent=0.1 → 约 0.2/笔
    const bTr = sineBars(300);
    const base = await runBT(srcTrade(''), bTr);
    const cash = await runBT(srcTrade(', commission_type=strategy.commission.cash_per_contract, commission_value=1'), bTr);
    const pctC = await runBT(srcTrade(', commission_type=strategy.commission.percent, commission_value=0.1'), bTr);
    const mb = BT.analyze({ bars: bTr, strategy: base.strategy, src: srcTrade('') });
    const mc = BT.analyze({ bars: bTr, strategy: cash.strategy, src: srcTrade(', commission_type=strategy.commission.cash_per_contract, commission_value=1') });
    log('commission', {
      baseNet: +(base.strategy?.netprofit || 0).toFixed(2),
      cashNet: +(cash.strategy?.netprofit || 0).toFixed(2),
      pctNet: +(pctC.strategy?.netprofit || 0).toFixed(2),
      baseFees: +(mb.fees || 0).toFixed(2),
      cashFees: +(mc.fees || 0).toFixed(2),
      trades: (cash.strategy?.closed || []).length,
      gp: cash.strategy?.grossprofit, gl: cash.strategy?.grossloss, np: cash.strategy?.netprofit
    });

    // 5) slippage 单位 = tick（mintick 0.01）：0.5 → 成交价偏移 0.005
    const bs = await runBT(srcExit(', slippage=0.5', 99, 200), bStop);
    log('slippage', { entryPx: bs.strategy?.closed?.[0]?.entry_price, exitPx: bs.strategy?.closed?.[0]?.exit_price });

    // 6) analyze 的口径快照（params 不能再是空对象；未实现项要标出来）
    const srcMag = srcTrade(', use_bar_magnifier=true, pyramiding=2, slippage=1');
    const par = BT.btParity(srcMag);
    const sumMag = BT.analyze({ bars: bTr, strategy: base.strategy, src: srcMag });
    log('parity', {
      params: sumMag.params, fill: par.fill, pyramiding: par.pyramiding,
      unsupported: par.unsupported, label: BT.parityLabel(par)
    });

    const v = {
      fillOffOk: idx(tOff.entry_time) === 11 && Math.abs(Number(tOff.entry_price) - bStop[11].open) < 0.006,
      fillOnOk: idx(tOn.entry_time) === 10 && Math.abs(Number(tOn.entry_price) - bStop[10].close) < 0.006,
      stopIntrabarOk: idx(sT.exit_time) === 12 && Math.abs(Number(sT.exit_price) - 99) < 1e-6
        && bStop[12].close > 99 && bStop[12].low < 99,
      limitIntrabarOk: idx(lT.exit_time) === 12 && Math.abs(Number(lT.exit_price) - 103) < 1e-6
        && bLimit[12].close < 103 && bLimit[12].high > 103,
      pyramidingOk: R.checks.pyramiding.defaultEntries === 1 && R.checks.pyramiding.threeEntries === 3,
      commissionOk: Math.abs(R.checks.commission.cashFees - 2 * R.checks.commission.trades) < 0.5
        && (R.checks.commission.baseNet - R.checks.commission.cashNet) > 1.8 * R.checks.commission.trades,
      feesNotDoubledOk: R.checks.commission.baseFees < 0.05,
      grossSignOk: R.checks.commission.gl > 0 && Math.abs((R.checks.commission.gp - R.checks.commission.gl) - R.checks.commission.np) < 0.05,
      slippageOk: Math.abs(Number(bs.strategy?.closed?.[0]?.entry_price) - 101.005) < 0.002,
      parityParamsOk: Object.keys(R.checks.parity.params || {}).length >= 3 && R.checks.parity.pyramiding === 2
        && (R.checks.parity.unsupported || []).includes('use_bar_magnifier')
        && /引擎未实现/.test(R.checks.parity.label || '')
    };
    log('verdict', v);
    R.pass = Object.values(v).every(Boolean);
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
