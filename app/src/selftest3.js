// M3 验收自检：Pine 指标（编译/上图/参数/报错）、场次统计、导出、截图、持久化
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.pine && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    // 这些用例的时间戳是按 XAUUSD 数据写的：档案不对就先切过去
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const target = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (target) { await window.__TT_LOAD_PROFILE__(target); if (window.__APP_READY__) await window.__APP_READY__; await wait(300); }
    }
    if (state.profile?.id !== 'XAUUSD-1m') throw new Error(`用例需要 XAUUSD 档案，当前是 ${state.profile?.id || '无'}`);
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');

    const pine = await import('./pine.js');
    const sess = await import('./session.js');
    const bars = app.chart.getDataList();

    /* ---------- 1. Pine 编译（样例） ---------- */
    const SRC = pine.SAMPLE_PINE;
    let t = performance.now();
    const c1 = await pine.compilePine(SRC, bars);
    log('pine_compile', {
      ok: c1.ok, ms: Math.round(performance.now() - t),
      names: c1.names, overlay: c1.overlay,
      lastE20: c1.series?.e20?.slice(-1)[0], lastE50: c1.series?.e50?.slice(-1)[0],
      bars: bars.length
    });

    /* ---------- 2. 上图 + 输出对齐 ---------- */
    const entry = { id: 'TEST_PINE', name: 'EMA 20/50', src: SRC, inputs: {} };
    t = performance.now();
    const ap = await state.pine.apply(entry, bars);
    await wait(300);
    const inds = app.chart.getIndicators();
    const target = inds.find(i => /^PINE_/.test(i.name));
    log('pine_apply', {
      ok: ap.ok, ms: Math.round(performance.now() - t), names: ap.names, overlay: ap.overlay,
      onChart: target ? { name: target.name, pane: target.paneId, resultLen: target.result?.length, tail: target.result?.slice(-1) } : null,
      indicators: inds.map(i => `${i.paneId}:${i.name}`)
    });

    /* ---------- 3. 参数覆盖（input.int → 50） ---------- */
    const SRC2 = `//@version=5
indicator("SMA Len", overlay=true)
len = input.int(14, "Length")
plot(ta.sma(close, len), "s")`;
    const dflt = await pine.compilePine(SRC2, bars);
    const over = await pine.compilePine(SRC2, bars, { Length: 50 });
    const vDef = dflt.series?.s?.slice(-1)[0];
    const vOvr = over.series?.s?.slice(-1)[0];
    log('pine_params', {
      okDefault: dflt.ok, okOverride: over.ok,
      defaultLast: vDef, overrideLast: vOvr,
      different: vDef != null && vOvr != null && Math.abs(vDef - vOvr) > 1e-9,
      inputsDetected: pine.parseInputs(SRC2)
    });

    /* ---------- 4. 报错定位 ---------- */
    const bad = await pine.compilePine(`//@version=5
indicator("bad", overlay=true)
plot(ta.ema(close, 20)`, bars);
    log('pine_error', { ok: bad.ok, hasError: !!bad.error, error: (bad.error || '').slice(0, 120), line: bad.line });

    /* ---------- 5. 移除指标 ---------- */
    state.pine.remove('TEST_PINE');
    await wait(200);
    log('pine_remove', {
      remaining: app.chart.getIndicators().filter(i => /^PINE_/.test(i.name)).length,
      applied: state.pine.list().length
    });

    /* ---------- 6. 统计口径（已知样本） ---------- */
    const sample = [
      { side: 'long', entry: 100, exit: 101, qty: 10, pnl: 10, openTs: 0, closeTs: 0, why: 'TP' },
      { side: 'long', entry: 100, exit: 99.5, qty: 10, pnl: -5, openTs: 0, closeTs: 0, why: 'SL' },
      { side: 'short', entry: 100, exit: 98, qty: 10, pnl: 20, openTs: 0, closeTs: 0, why: 'TP' },
      { side: 'long', entry: 100, exit: 99.2, qty: 10, pnl: -8, openTs: 0, closeTs: 0, why: 'manual' }
    ];
    const st = sess.computeStats(sample);
    log('stats', {
      count: st.count, wins: st.wins, losses: st.losses, winRate: st.winRate,
      netProfit: st.netProfit, profitFactor: st.profitFactor,
      expectancy: st.expectancy, maxDrawdown: st.maxDrawdown,
      consec: [st.maxConsecWins, st.maxConsecLosses], finalEquity: st.finalEquity
    });

    /* ---------- 7. 导出 CSV ---------- */
    const csv = sess.tradesToCsv(sample);
    const lines = csv.split('\n');
    log('csv', { lines: lines.length, head: lines[0].slice(0, 60), firstRow: lines[1].slice(0, 70) });

    /* ---------- 8. 截图 ---------- */
    await new Promise(r => setTimeout(r, 500));   // 等图表把首帧画完（多图工作区初始化后有额外绘制）
    t = performance.now();
    let blob = await sess.captureChart(document.getElementById('chart'));
    if (!blob) { await new Promise(r => setTimeout(r, 900)); blob = await sess.captureChart(document.getElementById('chart')); }
    log('screenshot', { ok: !!blob, bytes: blob?.size ?? 0, ms: Math.round(performance.now() - t) });

    /* ---------- 9. 场次持久化（含交易与截图） ---------- */
    const store = new sess.SessionStore();
    const created = await store.create({ symbol: app.profile.symbol, name: '自检场次' });
    created.trades = sample.slice(0, 2);
    if (blob) {
      const shot = await store.addShot(created, blob, { phase: 'open', ts: bars.at(-1).timestamp });
      created.shotKey = shot.key;
    }
    await store.save(created);
    const reloaded = await store.get(created.id);
    const shotBack = reloaded?.shots?.[0] ? await store.shotUrl(reloaded.shots[0].key) : null;
    log('session_persist', {
      id: created.id, tradesAfterReload: reloaded?.trades?.length,
      shots: reloaded?.shots?.length, shotUrlOk: !!shotBack,
      activeIdMatches: (await store.activeId()) === created.id,
      listed: (await store.list()).some(x => x.id === created.id)
    });
    await store.remove(created.id);

    R.pass = (
      R.checks.pine_compile.ok && R.checks.pine_compile.names.length === 2
      && R.checks.pine_apply.ok && R.checks.pine_apply.onChart
      && Math.abs(R.checks.pine_apply.onChart.resultLen - R.checks.pine_compile.bars) <= 2   // 实时可能在这一瞬插进一两根
      && R.checks.pine_params.okOverride && R.checks.pine_params.different
      && R.checks.pine_error.ok === false && R.checks.pine_error.hasError
      && R.checks.pine_remove.remaining === 0
      && R.checks.stats.count === 4 && R.checks.stats.winRate === 50
      && R.checks.stats.netProfit === 17 && R.checks.stats.profitFactor === 2.31
      && Math.abs(R.checks.stats.expectancy - 4.25) < 1e-6
      && R.checks.stats.maxDrawdown === 8
      && R.checks.csv.lines === 5
      && R.checks.screenshot.ok && R.checks.screenshot.bytes > 1000
      && R.checks.session_persist.tradesAfterReload === 2
      && R.checks.session_persist.shotUrlOk && R.checks.session_persist.activeIdMatches
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
