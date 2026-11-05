// M44 验收：Smart Money Concepts（SMC_MST）与 Structure & Trend Dashboard（SMC_DASH）可见
// 背景：klinecharts v10 不再调用 indicator.draw，这两个指标原来"挂在图上但什么都不画"。
// 现在：结构图形 → overlay，面板 → DOM（smcRender.js 每 1.2 s 同步）。
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

    // 清干净
    for (const n of ['SMC_MST', 'SMC_DASH']) { try { chart.removeIndicator({ name: n }); } catch {} }
    await wait(1600);
    const clean = { overlays: state.app.overlayList().length, panelHidden: document.getElementById('smcPanel')?.hidden ?? true };

    // 1) SMC_MST：应有 overlay（线段 + 矩形 + 标注）
    chart.createIndicator('SMC_MST', true);
    const okOverlays = await until(() => state.app.overlayList().length >= 5, 9000);
    const ovCount = state.app.overlayList().length;

    // 2) SMC_DASH：应出现 DOM 面板，且有 HTF/LTF 行
    chart.createIndicator('SMC_DASH', true);
    const okPanel = await until(() => {
      const el = document.getElementById('smcPanel');
      return el && !el.hidden && el.querySelectorAll('tbody tr').length >= 1;
    }, 9000);
    const panel = document.getElementById('smcPanel');
    const panelInfo = panel ? {
      rows: panel.querySelectorAll('tbody tr').length,
      head: (panel.querySelector('.smc-head')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      hasAlign: /全周期对齐/.test(panel.textContent || '')
    } : null;

    log('mst', { overlays: ovCount, ok: okOverlays });
    log('dash', { ok: okPanel, panel: panelInfo });
    log('clean', clean);

    // 3) 摘掉后应清场
    for (const n of ['SMC_MST', 'SMC_DASH']) { try { chart.removeIndicator({ name: n }); } catch {} }
    const cleared = await until(() => state.app.overlayList().length === 0 && document.getElementById('smcPanel')?.hidden !== false, 9000);
    log('cleared', { ok: cleared, overlays: state.app.overlayList().length, panelHidden: document.getElementById('smcPanel')?.hidden });

    const s = R.checks;
    R.pass = s.clean.overlays === 0
      && s.mst.ok === true && s.mst.overlays >= 5
      && s.dash.ok === true && s.dash.panel.rows >= 1 && s.dash.panel.hasAlign === true
      && s.cleared.ok === true;
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
