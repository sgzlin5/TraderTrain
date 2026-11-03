// M19 验收：图上图例 + 每个指标单独配置（参数 / 线条颜色·线宽·线型·显示 / 整体显示）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const chart = () => state.app?.chart;
  const ind = (n) => (chart()?.getIndicators() || []).find(i => i.name === n);
  const kv = async () => (await import('./db.js')).kvGet('ind:prefs');

  const addInd = async (prefix) => {
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(500);
    const s = document.getElementById('indSearch');       // 分类过滤后列表可能没有该指标，先搜索
    s.value = prefix; s.dispatchEvent(new Event('input'));
    await wait(500);
    const row = [...document.querySelectorAll('#indList .ind-item')]
      .find(x => (x.querySelector('.nm b')?.textContent || '').trim().startsWith(prefix));
    const btn = row?.querySelector('[data-add]');
    if (btn) btn.click();
    await wait(900);
    s.value = ''; s.dispatchEvent(new Event('input'));
    await wait(300);
    return !!btn;
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (!state.app) throw new Error('应用未就绪（先导入数据）');

    // 干净起步
    const { kvSet } = await import('./db.js');
    await kvSet('ind:prefs', {});
    state.indPrefs = {};
    for (const i of chart().getIndicators() || []) { try { chart().removeIndicator({ name: i.name }); } catch {} }
    await wait(300);
    state.legendOpen = true;                      // 保证图例展开（折叠是持久化的用户偏好）

    await addInd('指数均线');
    await addInd('MACD');
    if (!document.getElementById('indicatorPanel').hidden) document.getElementById('closeIndicator').click();
    await wait(400);

    // 1) 图例（可折叠卡片）
    const legend = {
      collapsedChip: !!document.querySelector('#chartLegend .lg-head'),
      bodyOpen: !document.querySelector('#chartLegend .lg-body')?.hidden,
      rows: document.querySelectorAll('#chartLegend .lg-item').length,
      text: [...document.querySelectorAll('#chartLegend .lg-name')].map(e => e.textContent.trim()),
      hasValues: [...document.querySelectorAll('#chartLegend .lg-val')].length
    };
    // 折叠/展开
    document.querySelector('#chartLegend .lg-head').click();
    await wait(300);
    legend.collapsed = !!document.querySelector('#chartLegend .lg-body')?.hidden;
    document.querySelector('#chartLegend .lg-head').click();
    await wait(300);
    legend.reexpanded = !document.querySelector('#chartLegend .lg-body')?.hidden;

    // 2) 图例上的眼睛：隐藏 / 恢复
    document.querySelector('#chartLegend [data-eye="MACD"]').click();
    await wait(600);
    const hidden = { visible: ind('MACD')?.visible, offRows: document.querySelectorAll('#chartLegend .lg-item.off').length };
    document.querySelector('#chartLegend [data-eye="MACD"]').click();
    await wait(600);
    const shown = { visible: ind('MACD')?.visible };

    // 3) 从图例齿轮打开右侧设置面板
    document.querySelector('#chartLegend [data-cfg="EMA"]').click();
    await wait(600);
    const panel = {
      open: !document.getElementById('indSettingsPanel').hidden,
      head: document.getElementById('indSetHead').textContent,
      params: document.getElementById('indSetParams').value,
      rows: document.querySelectorAll('#indSetLines .ind-set-line').length,
      hasEye: !!document.querySelector('#indSetLines .eye'),
      hasStyle: !!document.querySelector('#indSetLines select')
    };

    // 4) 参数 → 单线，并隐藏这条线
    const pe = document.getElementById('indSetParams');
    pe.value = '20'; pe.dispatchEvent(new Event('input'));
    await wait(350);
    const rowsAfter = document.querySelectorAll('#indSetLines .ind-set-line').length;
    const eye = document.querySelector('#indSetLines .eye');
    if (eye.classList.contains('off')) eye.click();            // 先确保处于“显示”
    await wait(150);
    eye.click();                                               // 再隐藏
    await wait(150);
    document.getElementById('indSetApply').click();
    await wait(900);
    const applied = ind('EMA');
    const transparent = applied?.styles?.lines?.[0]?.color;
    const prefs = await kv();

    // 5) 恢复默认
    document.querySelector('#chartLegend [data-cfg="EMA"]').click();
    await wait(500);
    document.getElementById('indSetReset').click();
    await wait(1200);
    const reset = ind('EMA');

    // 收尾
    for (const i of chart().getIndicators() || []) { try { chart().removeIndicator({ name: i.name }); } catch {} }
    await kvSet('ind:prefs', {});
    state.indPrefs = {};

    log('legend', legend);
    log('toggle', { hidden, shown });
    log('panel', panel);
    log('rowsAfter', rowsAfter);
    log('applied', { cp: applied?.calcParams, transparent });
    log('prefs', prefs?.EMA);
    log('reset', reset?.calcParams);

    R.pass = (
      legend.collapsedChip && legend.bodyOpen && legend.rows === 2
      && legend.text.some(t => t.includes('EMA')) && legend.text.some(t => t.includes('MACD'))
      && legend.hasValues >= 4 && legend.collapsed && legend.reexpanded
      && hidden.visible === false && hidden.offRows === 1
      && shown.visible === true
      && panel.open && panel.head.includes('EMA') && panel.params === '6, 12, 20' && panel.rows === 3
      && panel.hasEye && panel.hasStyle
      && rowsAfter === 1
      && applied && applied.calcParams.join(',') === '20'
      && /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(String(transparent))
      && prefs && prefs.EMA && prefs.EMA.lines[0].hidden === true
      && reset && reset.calcParams.join(',') === '6,12,20'
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
