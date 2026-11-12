// M42 验收：跳到最新 K 线（退出回放 + 切回实时）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // 游标只能落在真实 bar 的开盘时刻：5m 周期下落后最新 tick ≤ 1 个周期是正常口径
  const barSpan = ({ '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000 })[state.app?.periodKey] || 300000;
  const until = async (fn, ms = 8000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await wait(80); }
    return !!fn();
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const t = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (t) { await window.__TT_LOAD_PROFILE__(t); if (window.__APP_READY__) await window.__APP_READY__; await wait(400); }
    }
    if (!state.app) throw new Error('应用未就绪（先导入数据）');
    // 钩子是 boot 末尾 wireLive 才挂的，等它出现再操作
    await until(() => !!window.__TT_REPLAY_MODE__ && !!document.getElementById('btnLatest'), 8000);

    const btn = document.getElementById('btnLatest');
    log('button', { exists: !!btn, title: btn?.title || '', wired: typeof btn?.onclick === 'function' || !!btn });

    // 造场景：回放开 + 停在 2024
    await window.__TT_REPLAY_MODE__?.on?.();
    await wait(300);
    await state.replay.setStart(Date.UTC(2024, 2, 20, 0, 0));
    await until(() => state.app.lastTs() === state.replay.cursor, 5000);
    const before = {
      mode: !!window.__TT_REPLAY_MODE__.state(),
      barOn: document.getElementById('replayBar')?.dataset.on,
      cursor: state.replay.cursor,
      chartLast: state.app.lastTs()
    };

    // 点它
    document.getElementById('btnLatest').click();
    await until(() => window.__TT_REPLAY_MODE__.state() === false && Math.abs(Date.now() - state.replay.cursor) < 10 * 60000, 10000);
    await wait(600);

    const newest = Math.max(state.profile?.last || 0, state.profile?.live?.last || 0);
    const after = {
      mode: !!window.__TT_REPLAY_MODE__.state(),
      barOn: document.getElementById('replayBar')?.dataset.on,
      cursor: state.replay.cursor,
      chartLast: state.app.lastTs(),
      liveState: window.__TT_LIVE__?.status?.().state,
      stMsg: (document.getElementById('stMsg')?.textContent || '').slice(0, 60),
      newest,
      // 游标只能落在真实 bar 的开盘时刻：5m 周期下落后最新 tick ≤ 1 个周期是正常口径
      cursorAtNewest: Math.abs(state.replay.cursor - Math.min(Date.now(), newest + 60000)) <= barSpan
    };
    log('jump', { before, after });

    const s = R.checks;
    R.pass = s.button.exists === true
      && s.jump.before.mode === true && s.jump.before.barOn === '1'
      && s.jump.after.mode === false && s.jump.after.barOn === '0'
      && s.jump.after.chartLast >= s.jump.after.cursor && s.jump.after.chartLast - s.jump.after.cursor <= barSpan  // 跳完实时还会继续走到下一根
      && s.jump.after.cursorAtNewest === true
      && s.jump.after.liveState === 'live'
      && /跳到最新/.test(s.jump.after.stMsg);
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
