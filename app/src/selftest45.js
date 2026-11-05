// M45 验收：FVG / ICT 杀区 / 波段结构 —— 三个原 draw 指标改 overlay 后的可见性
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 9000) => {
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
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪（先导入数据）');

    const ALL = ['SMC_FVG', 'SMC_MST', 'SMC_ICT', 'SMC_HTF', 'SMC_DASH'];
    for (const n of ALL) { try { chart.removeIndicator({ name: n }); } catch {} }
    await until(() => state.app.overlayList().length === 0, 9000);

    // 逐个挂 → 每个都要产生 overlay
    const each = {};
    for (const n of ['SMC_FVG', 'SMC_ICT', 'SMC_HTF']) {
      chart.createIndicator(n, true);
      const ok = await until(() => state.app.overlayList().length > 0, 9000);
      each[n] = { ok, overlays: state.app.overlayList().length };
      try { chart.removeIndicator({ name: n }); } catch {}
      await until(() => state.app.overlayList().length === 0, 9000);
    }

    // 五个一起挂 → overlay 累加 + 面板出现
    for (const n of ALL) { try { chart.createIndicator(n, true); } catch {} }
    const okAll = await until(() => state.app.overlayList().length >= 20
      && document.getElementById('smcPanel')?.hidden === false, 12000);
    const all = {
      ok: okAll,
      overlays: state.app.overlayList().length,
      panelRows: document.querySelectorAll('#smcPanel tbody tr').length
    };

    // 全摘 → 清场
    for (const n of ALL) { try { chart.removeIndicator({ name: n }); } catch {} }
    const cleared = await until(() => state.app.overlayList().length === 0
      && document.getElementById('smcPanel')?.hidden !== false, 12000);

    log('each', each);
    log('all', all);
    log('cleared', { ok: cleared, overlays: state.app.overlayList().length });

    const s = R.checks;
    R.pass = s.each.SMC_FVG.ok && s.each.SMC_ICT.ok && s.each.SMC_HTF.ok
      && s.all.ok === true && s.all.overlays >= 20 && s.all.panelRows >= 1
      && s.cleared.ok === true;
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
