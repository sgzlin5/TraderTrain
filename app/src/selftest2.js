// M2 验收自检：回放（含跨缺口）、跨周期推桶、绘图持久化、交易撮合
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
  // 等条件成立（canvas 交互/重建都是异步的，固定 sleep 会偶发失败）
  const until = async (fn, ms = 2500) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await wait(80); }
    return !!fn();
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.trade && window.__APP__.replay); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    // 这些用例的时间戳是按 XAUUSD 数据写的：档案不对就先切过去
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const target = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (target) { await window.__TT_LOAD_PROFILE__(target); if (window.__APP_READY__) await window.__APP_READY__; await wait(300); }
    }
    if (state.profile?.id !== 'XAUUSD-1m') throw new Error(`用例需要 XAUUSD 档案，当前是 ${state.profile?.id || '无'}`);
    const app = state.app, rp = state.replay, draw = state.draw, trade = state.trade;
    if (!app || !rp) throw new Error('应用未就绪（先导入数据）');

    /* ---------- 1. 回放：起点与步进 ---------- */
    const startTs = Date.UTC(2024, 2, 20, 0, 0, 0);
    let t = performance.now();
    await rp.setStart(startTs);
    const setStartMs = performance.now() - t;
    // 实时开着时首屏是实时边缘：等一次真正落到游标，别读到上一帧的窗口
    await until(() => app.lastBar()?.timestamp === rp.cursor, 3000);
    log('replay_setstart', {
      ms: +setStartMs.toFixed(1), cursor: rp.cursor,
      lastBarTs: app.lastBar()?.timestamp, cursorIsLast: app.lastBar()?.timestamp === rp.cursor,
      bars: app.bars.length, period: app.periodKey
    });

    t = performance.now();
    const stepped = await rp.step(5);
    const step5Ms = performance.now() - t;
    const lastTs = app.lastBar()?.timestamp;
    log('replay_step5', {
      advanced: stepped, ms: +step5Ms.toFixed(2),
      cursorAdvancedMin: (rp.cursor - startTs) / 60000,
      chartLastEqualsCursor: lastTs === rp.cursor
    });

    /* ---------- 2. 跨缺口（2024-03-29 耶稣受难日 → 周一） ---------- */
    const before = Date.UTC(2024, 2, 29, 3, 0, 0);
    await rp.setStart(before);
    const tsBefore = rp.cursor;
    let maxJumpMin = 0, prev = rp.cursor, monotonic = true;
    t = performance.now();
    for (let i = 0; i < 200; i++) {
      const n = await rp.step(1);
      if (!n) break;
      const jump = (rp.cursor - prev) / 60000;
      if (jump <= 0) monotonic = false;
      if (jump > maxJumpMin) maxJumpMin = jump;
      prev = rp.cursor;
    }
    log('replay_gap', {
      ms: +((performance.now() - t) / 200).toFixed(2) + ' ms/步',
      from: new Date(tsBefore).toISOString().slice(0, 16),
      to: new Date(rp.cursor).toISOString().slice(0, 16),
      maxGapMinutes: maxJumpMin, monotonic
    });

    /* ---------- 3. 300 根推进耗时（播放成本的直接度量） ---------- */
    await rp.setStart(Date.UTC(2024, 5, 3, 0, 0, 0));
    t = performance.now();
    const adv300 = await rp.step(300);
    const ms300 = performance.now() - t;
    log('replay_300', { advanced: adv300, ms: +ms300.toFixed(1), perBarMs: +(ms300 / Math.max(1, adv300)).toFixed(3) });

    /* ---------- 4. 非 1m 周期推桶（5m 连续 7 根） ---------- */
    await app.switchPeriod('5m');
    state.draw.periodKey = '5m';
    rp.bucket = null;
    await rp.setStart(Date.UTC(2024, 5, 3, 0, 0, 0));
    for (let i = 0; i < 7; i++) await rp.step(1);
    const last5 = app.lastBar();   // [vela] 回放中封顶在游标（forming 桶）
    const members = await state.app.source.nextBars(Date.UTC(2024, 5, 3, 0, 0, 0), 7);
    const bucketTs = Math.floor(rp.cursor / 300000) * 300000;
    const sameBucket = members.filter(b => Math.floor(b.timestamp / 300000) * 300000 === bucketTs);
    log('replay_5m_bucket', {
      period: app.periodKey, lastTs: last5?.timestamp, aligned: last5 ? last5.timestamp % 300000 === 0 : false,
      bucket: bucketTs, members: sameBucket.length,
      highOk: sameBucket.length ? near(last5.high, Math.max(...sameBucket.map(b => b.high)), 1e-6) : null,
      lowOk: sameBucket.length ? near(last5.low, Math.min(...sameBucket.map(b => b.low)), 1e-6) : null,
      closeOk: sameBucket.length ? near(last5.close, sameBucket[sameBucket.length - 1].close, 1e-6) : null
    });
    await app.switchPeriod('1m');
    state.draw.periodKey = '1m';
    rp.bucket = null;

    /* ---------- 5. 绘图：建档 → 落盘 → 清空 → 读档还原 ----------
       [vela P3] 交互放置走原生（真实鼠标）；自检用编程式 add 验证持久化往返 */
    {
      const dw = app.chart.drawings;
      const l = app.bars.allBars();
      const beforeCount = dw.toJSON().drawings.length;
      const a1 = { time: l[l.length - 40].timestamp, price: l[l.length - 40].low };
      const a2 = { time: l[l.length - 8].timestamp, price: l[l.length - 8].high };
      dw.add('trendline', { anchors: [a1, a2], props: { tt: 'segment' } });
      await until(() => dw.toJSON().drawings.length > beforeCount, 1500);
      const afterDraw = dw.toJSON().drawings.length;
      draw.capture();
      await draw.persist();
      const ids = dw.toJSON().drawings.map(x => x.id);
      dw.removeMany(ids);
      await until(() => dw.toJSON().drawings.length === 0, 1200);
      const afterClear = dw.toJSON().drawings.length;
      await rp.setStart(Date.UTC(2024, 5, 3, 0, 0, 0));
      let loaded = await draw.load();
      if (loaded === -1) { await wait(260); loaded = await draw.load(); }
      await until(() => dw.toJSON().drawings.length >= 1, 2500);
      const afterRestore = dw.toJSON().drawings.length;
      log('draw', {
        beforeCount, afterDraw, delta: afterDraw - beforeCount,
        afterClear, loaded, afterRestore,
        itemPts: (draw.items[0]?.points || []).map(p => ({ ts: p.timestamp, v: Math.round(p.value) }))
      });
      draw.clear();
    }

    /* ---------- 6. 交易：市价多 + TP 触发 ---------- */
    const bar0 = app.lastBar();
    const entry = bar0.close;
    const tp = +(entry + 2).toFixed(2);        // 2 美元/oz 止盈
    const qty = 10;
    trade.setQty(qty);
    trade.openMarket('long', entry, bar0, { sl: null, tp });
    let closed = null;
    for (let i = 0; i < 4000 && !closed; i++) {
      const n = await rp.step(1);
      if (!n) break;
      closed = trade.trades[trade.trades.length - 1] || null;
      if (closed && !closed.closeTs) closed = null;
    }
    const rec = trade.trades[trade.trades.length - 1];
    const expected = rec ? +((rec.exit - rec.entry) * rec.qty).toFixed(2) : null;
    log('trade', {
      entry: +entry.toFixed(2), tp, qty,
      closed: rec ? { side: rec.side, entry: +rec.entry.toFixed(2), exit: +rec.exit.toFixed(2), pnl: rec.pnl, why: rec.why } : null,
      expectedPnl: expected, pnlMatches: rec ? near(rec.pnl, expected, 1e-6) : false,
      realized: +trade.realized.toFixed(2)
    });

    /* ---------- 7. 交易持久化（M3 起真值在场次里，不再有 kv trades:<symbol>） ---------- */
    const persisted = await (async () => {
      const { SessionStore } = await import('./session.js');
      const st = new SessionStore();
      const ses = state.session;
      if (!ses) return { id: null, memCount: 0, dbCount: 0 };
      const memCount = ses.trades?.length ?? 0;      // 撮合 → 场次（onTradeChange 同步追加）
      await st.save(ses);                            // 显式落盘，避免依赖异步 save 的时序
      const back = await st.get(ses.id);
      return { id: ses.id, memCount, dbCount: back?.trades?.length ?? 0 };
    })();
    log('trade_persist', {
      saved: persisted.memCount > 0 && persisted.dbCount === persisted.memCount,
      count: persisted.dbCount,
      session: persisted.id,
      memCount: persisted.memCount
    });

    // [vela P1] 绘图段在 Vela 下跳过（P3 接回后恢复断言）
    const drawOk = R.checks.draw.skipped ? true
      : (R.checks.draw.delta === 1 && R.checks.draw.afterClear === 0 && R.checks.draw.afterRestore >= 1);
    R.pass = (
      R.checks.replay_setstart.cursorIsLast
      && R.checks.replay_step5.advanced === 5 && R.checks.replay_step5.chartLastEqualsCursor
      && R.checks.replay_gap.monotonic && R.checks.replay_gap.maxGapMinutes > 60
      && R.checks.replay_300.perBarMs < 0.2
      && R.checks.replay_5m_bucket.aligned && R.checks.replay_5m_bucket.highOk && R.checks.replay_5m_bucket.closeOk
      && drawOk
      && !!R.checks.trade.closed && R.checks.trade.pnlMatches && R.checks.trade_persist.count > 0
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
