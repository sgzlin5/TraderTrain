// M28 验收：SMC_DASH（结构 & 趋势面板）已从 Vela 版本删除
// 历史口径：该指标依赖 ind.result / DOM 面板，Vela 分支未移植 → 直接下线，
// 这里守「目录、指标表、内核注册、面板入口」四处都不再出现它。
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');

    // 1) 目录（面板列表的数据源）
    const ci = await import('./customIndicators.js');
    const meta = Object.keys(ci.CUSTOM_META || {});
    const inCatalog = meta.includes('SMC_DASH');

    // 2) SMC 指标表（计算层）
    const smc = await import('./smc.js');
    const inInds = (smc.SMC_INDS || []).some(t => t.name === 'SMC_DASH');

    // 3) 内核注册表
    const sup = chart.getSupportedIndicators ? chart.getSupportedIndicators() : [];
    const inSupported = sup.includes('SMC_DASH');

    // 4) 面板入口（SMC 分类下既无行、也无 data-add）
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(600);
    const smcCat = document.querySelector('#indCats [data-cat="smc"]');
    if (smcCat) smcCat.click();
    await wait(500);
    const rows = [...document.querySelectorAll('#indList .ind-item')].map(r => r.querySelector('.nm b')?.textContent).filter(Boolean);
    const dashBtn = !!document.querySelector('#indList [data-add="SMC_DASH"]');
    document.getElementById('closeIndicator')?.click();
    await wait(200);

    log('catalog', { count: meta.length, inCatalog });
    log('inds', { names: (smc.SMC_INDS || []).map(t => t.name), inInds });
    log('supported', { count: sup.length, inSupported });
    log('panel', { rows, dashBtn });

    R.pass = inCatalog === false && inInds === false && inSupported === false && dashBtn === false;
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
