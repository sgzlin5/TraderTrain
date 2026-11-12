// M25 验收：订单流四件套（成交量 / 综合 VP / 订单墙 / 挂单深度）
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

    const names = ['FLOW_VOL', 'FLOW_VP', 'FLOW_WALL', 'FLOW_DEPTH'];
    log('registered', names.filter(n => (window.klinecharts.getSupportedIndicators() || []).includes(n)));

    // 指标库「订单流」分类
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(700);
    document.querySelector('#indCats [data-cat="flow"]').click();
    await wait(600);
    const rows = [...document.querySelectorAll('#indList .ind-item')].map(r => ({
      name: r.querySelector('[data-add]')?.dataset.add,
      title: r.querySelector('.nm b')?.textContent,
      desc: r.querySelector('.nm small')?.textContent
    }));
    log('rows', rows);

    for (const n of names) {
      const b = document.querySelector(`#indList [data-add="${n}"]`);
      if (b) b.click();
      await wait(800);
    }
    const onChart = (chart.getIndicators() || []).map(i => i.name);
    log('onChart', onChart);
    log('panes', chart.getPaneOptions().filter(p => p.id !== 'x_axis_pane').length);

    const payload = {};
    for (const ind of chart.getIndicators() || []) {
      const p = ind.result?.__smc;
      payload[ind.name] = p ? {
        hasVolume: p.hasVolume,
        rows: p.prof?.rows?.length ?? 0,
        poc: p.prof?.poc ?? null,
        walls: p.walls?.length ?? 0
      } : null;
    }
    log('payload', payload);

    // 口径自报告：hasVolume 必须是明确布尔（真量→量口径，无量→时间口径退化）。
    //  fixture 自带量列，所以这里验「报了口径」而不是「一定在退化」。
    log('fallback', {
      vp: typeof payload.FLOW_VP?.hasVolume === 'boolean',
      depth: typeof payload.FLOW_DEPTH?.hasVolume === 'boolean',
      vol: { vp: payload.FLOW_VP?.hasVolume, depth: payload.FLOW_DEPTH?.hasVolume }
    });

    document.getElementById('closeIndicator').click();
    await wait(500);
    log('legend', [...document.querySelectorAll('#chartLegend .lg-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));

    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }

    const titles = rows.map(r => r.title);
    R.pass = (
      R.checks.registered.length === 4
      && rows.length === 4
      && ['成交量', '综合 VP', '订单墙', '挂单深度'].every(t => titles.includes(t))
      && onChart.length === 4
      && R.checks.panes === 2                       // 主图 + 成交量副图
      && payload.FLOW_VP?.rows > 10 && payload.FLOW_VP?.poc > 0
      && payload.FLOW_DEPTH?.rows > 5
      && payload.FLOW_WALL?.walls >= 0
      && R.checks.fallback.vp === true && R.checks.fallback.depth === true
      && R.checks.legend.length === 4
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
