// M23 验收：指标库分类 / 收藏 / 组合模板 / 自建关键位指标
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const t = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (t) { await window.__TT_LOAD_PROFILE__(t); if (window.__APP_READY__) await window.__APP_READY__; await wait(400); }
    }
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');
    // 干净起点：清掉收藏与组合
    const indMod = await import('./indicators.js');
    await indMod.saveFavs([]); await indMod.saveCombos([]);
    state.indFavs = []; state.indCombos = [];

    // 0) 面板开关：关着时 display 必须真是 none（display:flex 会把 [hidden] 吃掉 → 关不掉）
    const panel = document.getElementById('indicatorPanel');
    log('panelClosedDisplay', getComputedStyle(panel).display);
    if (panel.hidden) document.getElementById('btnIndicator').click();
    await wait(700);
    log('panelOpenDisplay', getComputedStyle(panel).display);
    document.getElementById('closeIndicator').click();
    await wait(400);
    log('panelAfterClose', { hidden: panel.hidden, display: getComputedStyle(panel).display });

    // 1) 自建指标注册
    const supported = (window.klinecharts.getSupportedIndicators() || []);
    const custom = ['PDHL', 'ORB', 'AVWAP'].filter(n => supported.includes(n));
    log('registered', custom);

    // 2) 分类 chips
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(900);
    const chips = [...document.querySelectorAll('#indCats .ind-cat')].map(b => b.dataset.cat);
    log('chips', chips);

    // 3) 关键位分类内容
    [...document.querySelectorAll('#indCats .ind-cat')].find(b => b.dataset.cat === 'key').click();
    await wait(600);
    const keyNames = [...document.querySelectorAll('#indList .ind-item [data-add]')].map(b => b.dataset.add);
    log('keyItems', keyNames);

    // 4) 搜索跨分类
    const s = document.getElementById('indSearch');
    s.value = 'vwap'; s.dispatchEvent(new Event('input'));
    await wait(600);
    const searchHit = [...document.querySelectorAll('#indList .ind-item [data-add]')].map(b => b.dataset.add);
    log('searchVwap', searchHit);
    s.value = ''; s.dispatchEvent(new Event('input'));
    await wait(400);

    // 5) 加三个自建指标 → 图上生效
    for (const n of ['PDHL', 'ORB', 'AVWAP']) {
      const b = document.querySelector(`#indList [data-add="${n}"]`);
      if (b) { b.click(); await wait(500); }
    }
    const onChart = chart.getIndicators().map(i => i.name);
    const results = chart.getIndicators().filter(i => custom.includes(i.name))
      .map(i => ({ n: i.name, rows: (i.result || []).length, nonNull: (i.result || []).filter(r => r && Object.values(r).some(v => v != null)).length }));
    log('onChart', onChart);
    log('results', results);

    // 6) 收藏（持久化）
    const favBtn = document.querySelector('#indList [data-fav="PDHL"]');
    if (favBtn) favBtn.click();
    await wait(800);
    const { loadFavs } = await import('./indicators.js');
    const favs = await loadFavs();
    log('favs', favs);
    log('favsState', state.indFavs || []);

    // 7) 保存当前组合
    document.getElementById('indSaveCombo').click();
    await wait(300);
    document.getElementById('indComboName').value = '单测组合';
    document.getElementById('indComboOk').click();
    await wait(800);
    const { loadCombos } = await import('./indicators.js');
    const combos = await loadCombos();
    log('combos', combos.map(c => ({ name: c.name, items: c.items })));

    // 8) 应用组合：先清空再应用
    for (const i of chart.getIndicators()) { try { chart.removeIndicator({ name: i.name }); } catch {} }
    await wait(500);
    const row = document.querySelector('#indList .combo-row [data-use]');
    if (row) { row.click(); await wait(900); }
    const afterApply = chart.getIndicators().map(i => i.name);
    log('afterApply', afterApply);

    // 收尾：清掉收藏与组合，避免污染用户数据
    const ind = await import('./indicators.js');
    await ind.saveFavs([]);
    await ind.saveCombos([]);
    state.indFavs = [];
    state.indCombos = [];
    for (const i of chart.getIndicators()) { try { chart.removeIndicator({ name: i.name }); } catch {} }

    R.pass = (
      R.checks.panelClosedDisplay === 'none'
      && R.checks.panelOpenDisplay !== 'none'
      && R.checks.panelAfterClose.hidden === true && R.checks.panelAfterClose.display === 'none'
      && custom.length === 3 && chips.join() === 'fav,combos,flow,key,smc,ma,general,pine'
      && keyNames.length >= 3 && keyNames.includes('PDHL') && keyNames.includes('ORB') && keyNames.includes('AVWAP')
      && searchHit.includes('AVWAP')
      && ['PDHL', 'ORB', 'AVWAP'].every(n => afterApply.includes(n))
      && results.every(r => r.rows > 100)
      && (favs || []).includes('PDHL')
      && combos.length === 1 && combos[0].items.length === 3
    );
  } catch (err) {
    R.errors.push(String(err && err.stack || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
