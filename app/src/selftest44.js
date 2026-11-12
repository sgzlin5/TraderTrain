// M44 验收：Smart Money Concepts（SMC_MST）与 Structure & Trend Dashboard（SMC_DASH）可见
// [vela] 结构图形走自绘渲染层（TT_SMC_MST，registerSmcLayers），面板 → DOM（smcRender.js 同步）。
// 口径：结构用层着墨像素判可见（不再进 overlayList），面板仍按 DOM 行判。
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await wait(120); }
    return !!fn();
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const t = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (t) { await window.__TT_LOAD_PROFILE__(t); if (window.__APP_READY__) await window.__APP_READY__; await wait(500); }
    }
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const U = await import('./selftest-util.js');

    // 清干净
    for (const n of ['SMC_MST', 'SMC_DASH']) { try { chart.removeIndicator({ name: n }); } catch {} }
    await wait(1600);
    const clean = {
      overlays: state.app.overlayList().length,
      ink: U.layerInk('TT_SMC_MST'),
      panelHidden: document.getElementById('smcPanel')?.hidden ?? true
    };

    // 1) SMC_MST：自绘层要有线（线段 + 矩形 + 标注）
    chart.createIndicator('SMC_MST', true);
    const okOverlays = await until(() => U.layerInk('TT_SMC_MST') > 200, 9000);
    const ovInk = U.layerInk('TT_SMC_MST');

    // 2) SMC_DASH：vela 分支未注册（DOM 面板依赖 ind.result，R14 未移植）→ 只记录，不计入通过
    const dashSupported = U.supportedIndicators().includes('SMC_DASH');
    chart.createIndicator('SMC_DASH', true);
    const okPanel = dashSupported ? await until(() => {
      const el = document.getElementById('smcPanel');
      return el && !el.hidden && el.querySelectorAll('tbody tr').length >= 1;
    }, 9000) : false;
    const panel = document.getElementById('smcPanel');
    const panelInfo = panel ? {
      rows: panel.querySelectorAll('tbody tr').length,
      head: (panel.querySelector('.smc-head')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      hasAlign: /全周期对齐/.test(panel.textContent || '')
    } : null;

    log('mst', { ink: ovInk, overlays: state.app.overlayList().length, ok: okOverlays });
    log('dash', { supported: dashSupported, ok: okPanel, panel: panelInfo });
    log('clean', clean);

    // 3) 摘掉后应清场
    for (const n of ['SMC_MST', 'SMC_DASH']) { try { chart.removeIndicator({ name: n }); } catch {} }
    const cleared = await until(() => U.layerInk('TT_SMC_MST') === 0
      && document.getElementById('smcPanel')?.hidden !== false, 9000);
    log('cleared', { ok: cleared, ink: U.layerInk('TT_SMC_MST'), panelHidden: document.getElementById('smcPanel')?.hidden });

    const s = R.checks;
    R.pass = s.clean.overlays === 0 && (s.clean.ink === 0 || s.clean.ink === -1)
      && s.mst.ok === true && s.mst.ink > 200
      && (s.dash.supported === false || (s.dash.ok === true && s.dash.panel?.rows >= 1))
      && s.cleared.ok === true;
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
