// M45 验收：FVG / ICT 杀区 / 波段结构 —— SMC 图形可见性
// [vela] 这些指标走自绘渲染层（TT_SMC_*），不进 overlayList；可见性用层着墨像素判。
//        SMC_DASH 在 vela 分支未注册（依赖 ind.result），只记录不计入通过。
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
    // 前面用例可能停在回放窗口里（可见根少 → 着墨像素不够）；先回到实时边缘再量
    if (state.replayMode) { try { await window.__TT_JUMP_LATEST__?.({ silent: true }); } catch {} await wait(400); }
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪（先导入数据）');
    const U = await import('./selftest-util.js');

    const LAYERS = { SMC_FVG: 'TT_SMC_FVG', SMC_MST: 'TT_SMC_MST', SMC_ICT: 'TT_SMC_ICT', SMC_HTF: 'TT_SMC_HTF' };
    const ALL = [...Object.keys(LAYERS), 'SMC_DASH'];
    const inkOf = (names) => names.reduce((s, n) => s + Math.max(0, U.layerInk(LAYERS[n] || '')), 0);

    for (const n of ALL) { try { chart.removeIndicator({ name: n }); } catch {} }
    await until(() => inkOf(Object.keys(LAYERS)) === 0, 9000);

    // 逐个挂 → 每个层都要有墨
    const each = {};
    for (const n of Object.keys(LAYERS)) {
      chart.createIndicator(n, true);
      const ok = await until(() => U.layerInk(LAYERS[n]) > 100, 9000);
      each[n] = { ok, ink: U.layerInk(LAYERS[n]) };
      try { chart.removeIndicator({ name: n }); } catch {}
      await until(() => U.layerInk(LAYERS[n]) === 0, 9000);
    }

    // 四个一起挂 → 墨量累加
    for (const n of Object.keys(LAYERS)) { try { chart.createIndicator(n, true); } catch {} }
    const okAll = await until(() => inkOf(Object.keys(LAYERS)) >= 400, 12000);
    const all = {
      ok: okAll,
      ink: inkOf(Object.keys(LAYERS)),
      perLayer: Object.fromEntries(Object.keys(LAYERS).map(n => [n, U.layerInk(LAYERS[n])])),
      dashSupported: U.supportedIndicators().includes('SMC_DASH')
    };

    // 全摘 → 清场
    for (const n of ALL) { try { chart.removeIndicator({ name: n }); } catch {} }
    const cleared = await until(() => inkOf(Object.keys(LAYERS)) === 0
      && document.getElementById('smcPanel')?.hidden !== false, 12000);

    log('each', each);
    log('all', all);
    log('cleared', { ok: cleared, ink: inkOf(Object.keys(LAYERS)) });

    const s = R.checks;
    R.pass = s.each.SMC_FVG.ok && s.each.SMC_ICT.ok && s.each.SMC_HTF.ok && s.each.SMC_MST.ok
      && s.all.ok === true && s.all.ink >= 400
      && s.cleared.ok === true;
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
