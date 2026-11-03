// M4 验收自检：主题切换 / 指标库开关 / 面板布局
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const ind = await import('./indicators.js');

    /* ---------- 1. 主题切换（下拉里点选） ---------- */
    const theme0 = document.documentElement.dataset.theme;
    const pickTheme = async (key) => {
      document.getElementById('btnTheme').click();
      await wait(320);
      const row = document.querySelector(`#themeRows .theme-row[data-theme="${key}"]`);
      const open = !document.getElementById('themeMenu').hidden;
      if (row) row.click();
      await wait(520);
      return { open, applied: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode };
    };
    const lightRes = await pickTheme('light');
    const up1 = chart.getStyles().candle.bar.upColor;
    const bg1 = getComputedStyle(document.getElementById('chart')).backgroundColor;
    const darkRes = await pickTheme('dark');
    const up2 = chart.getStyles().candle.bar.upColor;
    const rows = document.querySelectorAll('#themeRows .theme-row').length;
    log('theme', {
      from: theme0, menuOpened: lightRes.open, to: lightRes.applied, back: darkRes.applied,
      modes: [lightRes.mode, darkRes.mode], upLight: up1, upDark: up2, chartBgLight: bg1, rows
    });

    /* ---------- 2. 指标库：开面板 / 添加 / 徽标 / 移除 ---------- */
    const before = chart.getIndicators().length;
    document.getElementById('btnIndicator').click();
    await wait(600);
    const panelOpen = !document.getElementById('indicatorPanel').hidden;
    // 指标库默认在「关键位」分类；这里切到「通用」再统计内置指标数量
    const generalChip = document.querySelector('#indCats .ind-cat[data-cat="general"]');
    if (generalChip) { generalChip.click(); await wait(500); }
    const listCount = document.querySelectorAll('#indList .ind-item').length;
    const firstAdd = document.querySelector('#indList .ind-item [data-add]');
    firstAdd.click();
    await wait(700);
    const afterAdd = chart.getIndicators().map(i => i.name);
    const badge = document.getElementById('indBadge').textContent;
    const rm = document.querySelector('#indActive button[data-rm]');
    if (rm) rm.click();
    await wait(600);
    const afterRemove = chart.getIndicators().length;
    document.getElementById('closeIndicator').click();
    log('indicator', {
      panelOpen, catalog: listCount, before, afterAdd, badge,
      badgeMatches: Number(badge) === afterAdd.length,
      afterRemove, removed: afterRemove === before
    });

    /* ---------- 3. 布局：1 → 3 → 1 ---------- */
    const panes0 = ind.paneCount(chart);
    document.getElementById('btnLayout').click();
    await wait(350);
    const menuOpen = !document.getElementById('layoutMenu').hidden;
    document.querySelector('#layoutMenu .layout-opt[data-panes="3"]').click();
    await wait(900);
    const panes3 = ind.paneCount(chart);
    const paneHeights = chart.getPaneOptions().filter(p => p.id !== 'x_axis_pane').map(p => Math.round(p.height));
    document.getElementById('btnLayout').click();
    await wait(300);
    document.querySelector('#layoutMenu .layout-opt[data-panes="1"]').click();
    await wait(800);
    const panes1 = ind.paneCount(chart);
    log('layout', { menuOpen, from: panes0, to3: panes3, back1: panes1, heights: paneHeights });

    R.pass = (
      lightRes.open && lightRes.applied === 'light' && lightRes.mode === 'light'
      && darkRes.applied === 'dark' && darkRes.mode === 'dark' && rows >= 4
      && up1 !== up2
      && panelOpen && listCount >= 20
      && afterAdd.length === before + 1 && Number(badge) === afterAdd.length
      && afterRemove === before
      && menuOpen && panes3 === 3 && panes1 === 1
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
