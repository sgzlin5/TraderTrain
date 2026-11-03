// M28 验收：结构 & 趋势面板（LuxAlgo Structure & Trend Dashboard 的四件套）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }
    await wait(300);

    log('registered', (window.klinecharts.getSupportedIndicators() || []).includes('SMC_DASH'));

    // 库内条目
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(700);
    document.querySelector('#indCats [data-cat="smc"]').click();
    await wait(600);
    const rows = [...document.querySelectorAll('#indList .ind-item')].map(r => r.querySelector('.nm b')?.textContent);
    log('smcRows', rows);

    // 添加
    document.querySelector('#indList [data-add="SMC_DASH"]').click();
    await wait(1800);
    document.getElementById('closeIndicator').click();
    await wait(500);

    const ind = chart.getIndicators().find(i => i.name === 'SMC_DASH');
    const p = ind?.result?.__smc;
    log('payload', p ? {
      structName: p.struct.name, structTrend: p.struct.trend, events: p.struct.events.length,
      rows: p.rows.map(r => ({ hi: r.hi.name, hiT: r.hi.trend, lo: r.lo.name, loT: r.lo.trend })),
      sweeps: p.sweeps.length, fvgs: p.fvgs.length, colorCandles: p.colorCandles,
      cp: ind.calcParams
    } : null);

    // 改参数（4H / 1H，打开蜡烛染色）→ 标签与开关跟着变
    try { chart.overrideIndicator({ name: 'SMC_DASH', calcParams: [10, 240, 240, 60, 60, 15, 15, 5, 5, 1, 1] }); } catch {}
    await wait(1500);
    const ind2 = chart.getIndicators().find(i => i.name === 'SMC_DASH');
    const p2 = ind2?.result?.__smc;
    log('afterParams', p2 ? {
      structName: p2.struct.name, rows: p2.rows.map(r => r.name),
      colorCandles: p2.colorCandles, maxFvg: p2.fvgs.length
    } : null);

    // 移除
    try { chart.removeIndicator({ name: 'SMC_DASH' }); } catch {}
    await wait(400);
    log('removed', !(chart.getIndicators() || []).some(i => i.name === 'SMC_DASH'));

    R.eval = {
      a: R.checks.registered === true,
      b: rows.includes('结构 & 趋势面板'),
      c: !!(p && p.struct.name === '1H' && p.rows.length === 2),
      d: !!(p && p.rows.map(r => r.hi.name + '/' + r.lo.name).join(',') === '1H/15M,15M/5M,5M/1M'),
      e: p && typeof p.struct.trend === 'number',
      f: !!(p && Array.isArray(p.fvgs) && p.fvgs.length <= 3 && typeof p.sweeps?.length === 'number'),
      g: !!(p2 && p2.struct?.name === '4H' && (p2.rows || []).map(x => x.hi.name + '/' + x.lo.name).join(',') === '4H/1H,1H/15M,15M/5M'),
      gRaw: p2 ? { structName: p2.struct?.name, rows: (p2.rows || []).map(x => x.hi.name + '/' + x.lo.name) } : null,
      h: p2 && p2.colorCandles === true,
      i: R.checks.removed === true
    };
    R.pass = (
      R.checks.registered === true
      && rows.includes('结构 & 趋势面板')
      && p && p.struct.name === '1H' && p.rows.length === 3
      && p.rows.map(r => r.hi.name + '/' + r.lo.name).join(',') === '1H/15M,15M/5M,5M/1M'
      && typeof p.struct.trend === 'number'
      && Array.isArray(p.fvgs) && p.fvgs.length <= 3 && typeof p.sweeps?.length === 'number'
      && p2 && p2.struct?.name === '4H' && (p2.rows || []).map(x => x.hi.name + '/' + x.lo.name).join(',') === '4H/1H,1H/15M,15M/5M'
      && p2.colorCandles === true
      && R.checks.removed === true
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
