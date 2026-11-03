// M10 验收：多主题（墨蓝 / 雾白 / 晴空 / 暖砂）
import { THEMES, themeMeta, loadTheme } from './theme.js';

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    // __APP_READY__ 只是数据装好；主题按钮的事件在 boot 后段才绑，必须等 UI_READY
    for (let i = 0; i < 200 && !window.__UI_READY__; i++) await wait(50);
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const original = document.documentElement.dataset.theme;

    const pick = async (key) => {
      // 确保菜单是打开的：如果上一次残留了打开状态，再点一次反而会关掉
      if (document.getElementById('themeMenu').hidden) {
        document.getElementById('btnTheme').click();
        await wait(280);
      }
      const menuOpen = !document.getElementById('themeMenu').hidden;
      const row = document.querySelector(`#themeRows .theme-row[data-theme="${key}"]`);
      const hasRow = !!row;
      if (row) row.click();
      await wait(420);
      const cs = getComputedStyle(document.documentElement);
      const chartEl = document.getElementById('chart');
      return {
        key, menuOpen, hasRow,
        theme: document.documentElement.dataset.theme,
        mode: document.documentElement.dataset.mode,
        cssBg: cs.getPropertyValue('--bg').trim(),
        cssChartBg: cs.getPropertyValue('--chart-bg').trim(),
        chartBgPx: getComputedStyle(chartEl).backgroundColor,
        up: chart.getStyles().candle.bar.upColor,
        menuClosed: document.getElementById('themeMenu').hidden
      };
    };

    const results = [];
    for (const t of THEMES) results.push(await pick(t.key));

    const persisted = await loadTheme();
    const onRows = document.querySelectorAll('#themeRows .theme-row.on').length;
    const activeKey = document.querySelector('#themeRows .theme-row.on')?.dataset.theme;

    // 复原
    const back = await pick(original);

    log('themes', results);
    log('persist', { persisted, onRows, activeKey, backTheme: back.theme });
    log('table', THEMES.map(t => ({ key: t.key, label: t.label, mode: t.mode })));

    const byKey = Object.fromEntries(results.map(r => [r.key, r]));
    const uniqBg = new Set(results.map(r => r.cssBg)).size;
    const uniqUp = new Set(results.map(r => r.up)).size;

    R.pass = (
      results.length === THEMES.length && results.length >= 4
      && results.every(r => r.theme === r.key && r.hasRow && r.menuOpen && r.menuClosed)
      && results.every(r => r.mode === themeMeta(r.key).mode)
      && byKey.dark.mode === 'dark' && byKey.light.mode === 'light'
      && byKey.sky.mode === 'light' && byKey.amber.mode === 'light'
      && uniqBg >= 4 && uniqUp === THEMES.length
      && onRows === 1 && activeKey === results[results.length - 1].key
      && back.theme === original
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
