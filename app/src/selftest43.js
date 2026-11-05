// M43 验收：LuxAlgo 口径的 EMA / RMA / ZLEMA 作为内置指标
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 参考实现（照 Pine ta.ema / ta.rma / ZLEMA 定义写，不引用被测代码）
  const refEma = (src, p, alpha) => {
    const out = new Array(src.length).fill(null);
    let sum = 0, prev = null;
    for (let i = 0; i < src.length; i++) {
      if (i < p - 1) { sum += src[i]; continue; }
      if (prev == null) { sum += src[i]; prev = sum / p; } else prev = src[i] * alpha + prev * (1 - alpha);
      out[i] = prev;
    }
    return out;
  };
  const refEmaStd = (src, p) => refEma(src, p, 2 / (p + 1));
  const refRma = (src, p) => refEma(src, p, 1 / p);
  const refZlema = (src, p) => {
    const lag = Math.floor((p - 1) / 2);
    const del = src.map((v, i) => (i >= lag ? 2 * v - src[i - lag] : v));
    return refEmaStd(del, p);
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

    const ci = await import('./customIndicators.js');
    const inds = await import('./indicators.js');

    // 1) 注册 + 库分类
    const supported = (window.klinecharts?.getSupportedIndicators?.() || []);
    const lib = inds.builtinList();
    const byName = (n) => lib.find(x => x.name === n) || null;
    const metaOf = (n) => ci.CUSTOM_META[n] || null;
    log('library', {
      supported: ['EMA', 'RMA', 'ZLEMA'].filter(n => supported.includes(n)),
      metaCats: ['EMA', 'RMA', 'ZLEMA'].map(n => (metaOf(n) || {}).cat || null),
      libCats: ['EMA', 'RMA', 'ZLEMA'].map(n => (byName(n) || {}).cat || null),
      labels: ['EMA', 'RMA', 'ZLEMA'].map(n => (byName(n) || {}).label || null),
      dupes: lib.filter(x => ['EMA', 'RMA', 'ZLEMA'].includes(x.name)).length,
      hasMaCat: inds.IND_CATS.some(c => c.key === 'ma')
    });

    // 2) 数值对齐（用真实 bar 的收盘价）
    const bars = app.bars.allBars().slice(-800);
    const src = bars.map(b => b.close);
    const N = 20;
    const idx = bars.length - 1;
    const got = {};
    for (const name of ['EMA', 'RMA', 'ZLEMA']) {
      const def = ci.CUSTOM_INDS.find(x => x.name === name);
      const rows = def.calc(bars, { calcParams: [N] });
      got[name] = rows[idx].z1;
    }
    const want = { EMA: refEmaStd(src, N)[idx], RMA: refRma(src, N)[idx], ZLEMA: refZlema(src, N)[idx] };
    const diff = {};
    for (const k of Object.keys(want)) diff[k] = Math.abs((got[k] ?? NaN) - want[k]);
    log('math', { got, want, diff, allOk: Object.values(diff).every(d => Number.isFinite(d) && d < 0.01) });

    // 3) 上图（三个都挂上去不报错，且生成了指标实例）
    const before = app.chart.getIndicators().map(i => i.name);
    const created = [];
    for (const name of ['EMA', 'RMA', 'ZLEMA']) {
      try { const c = app.chart.createIndicator(name, true, { id: `t43_${name}` }); created.push({ name, ok: !!c }); } catch (e) { created.push({ name, ok: false, err: String(e.message) }); }
      await wait(200);
    }
    const after = app.chart.getIndicators().map(i => i.name);
    log('chart', { created, added: ['EMA', 'RMA', 'ZLEMA'].filter(n => after.filter(x => x === n).length > before.filter(x => x === n).length) });
    for (const name of ['EMA', 'RMA', 'ZLEMA']) { try { app.chart.removeIndicator?.({ id: `t43_${name}` }); } catch {} }

    const s = R.checks;
    R.pass = s.library.supported.length === 3
      && s.library.dupes === 3
      && s.library.hasMaCat === true
      && s.library.libCats.every(c => c === 'ma')
      && s.library.metaCats.every(c => c === '均线')
      && s.math.allOk === true
      && s.chart.added.length === 3;
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
