// M24 验收：SMC / ICT 指标（FVG·IFVG / 聪明钱概念 / ICT 杀区 / 波段与中期结构）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');

    // 干净起点
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }
    await wait(300);

    const names = ['SMC_FVG', 'SMC_MST', 'SMC_ICT', 'SMC_HTF', 'SMC_DASH'];
    log('registered', names.filter(n => (window.klinecharts.getSupportedIndicators() || []).includes(n)));

    // 指标库 SMC 分类
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(700);
    document.querySelector('#indCats [data-cat="smc"]').click();
    await wait(600);
    const rows = [...document.querySelectorAll('#indList .ind-item')].map(r => ({
      name: r.querySelector('[data-add]')?.dataset.add,
      title: r.querySelector('.nm b')?.textContent,
      desc: r.querySelector('.nm small')?.textContent
    }));
    log('rows', rows);

    // 逐个添加
    for (const n of names) {
      const b = document.querySelector(`#indList [data-add="${n}"]`);
      if (b) b.click();
      await wait(900);
    }
    const onChart = (chart.getIndicators() || []).map(i => i.name);
    log('onChart', onChart);

    // calc 真的算出了东西（payload 挂在 result 上）
    const payload = {};
    for (const ind of chart.getIndicators() || []) {
      const p = ind.result?.__smc;
      payload[ind.name] = p
        ? { zones: p.zones?.length ?? 0, events: p.events?.length ?? 0, eq: p.eq?.length ?? 0, swings: p.swings?.length ?? 0, fvgs: p.fvgs?.length ?? 0 }
        : null;
    }
    log('payload', payload);

    // 图例：中文名 + 不能出现占位 figure 的 n/a
    document.getElementById('closeIndicator').click();
    await wait(600);
    const legend = [...document.querySelectorAll('#chartLegend .lg-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
    log('legend', legend);

    // 移除一个
    try { chart.removeIndicator({ name: 'SMC_HTF' }); } catch {}
    await wait(500);
    log('afterRemove', (chart.getIndicators() || []).map(i => i.name));

    // 收尾：清空，别把用户图弄脏
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }

    const titles = rows.map(r => r.title);
    // 调试：逐条列出断言结果，失败时不用猜
    log('conds', {
      reg: R.checks.registered.length === 5,
      rows5: rows.length === 5,
      tFvg: titles.some(t => t.includes('FVG / IFVG')),
      tMst: titles.some(t => t.includes('聪明钱概念')),
      tIct: titles.some(t => t.includes('ICT 杀区工具箱')),
      tHtf: titles.some(t => t.includes('波段 & 中期结构')),
      tDash: titles.some(t => t.includes('结构&趋势面板')),
      on5: onChart.length === 5,
      pFvg: payload.SMC_FVG?.zones > 0, pMst: payload.SMC_MST?.events > 0,
      pIct: payload.SMC_ICT?.zones > 0, pHtf: !!payload.SMC_HTF,
      leg5: legend.length === 5,
      legClean: legend.every(t => !t.includes('n/a') && !t.startsWith('SMC_')),
      after4: R.checks.afterRemove.length === 4
    });

    R.pass = (
      R.checks.registered.length === 5
      && rows.length === 5
      && titles.some(t => t.includes('FVG / IFVG')) && titles.some(t => t.includes('聪明钱概念'))
      && titles.some(t => t.includes('ICT 杀区工具箱')) && titles.some(t => t.includes('波段 & 中期结构'))
      && titles.some(t => t.includes('结构&趋势面板'))
      && onChart.length === 5
      && payload.SMC_FVG?.zones > 0 && payload.SMC_MST?.events > 0
      && payload.SMC_ICT?.zones > 0 && payload.SMC_HTF && payload.SMC_HTF.swings >= 0
      && legend.length === 5 && legend.every(t => !t.includes('n/a') && !t.startsWith('SMC_'))
      && R.checks.afterRemove.length === 4
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
