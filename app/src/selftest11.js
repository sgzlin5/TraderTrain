// M11 验收：回放随机起点
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    // 前面的用例可能把档案/周期切走（小样本档案会让 >100 根、区间断言失真）
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const t = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (t) { await window.__TT_LOAD_PROFILE__(t); if (window.__APP_READY__) await window.__APP_READY__; await wait(600); }
    }
    const rp = state.replay;
    const prof = app.profile;
    const btn = document.getElementById('randomStart');
    const input = document.getElementById('startAt');

    // 等启动收尾（快照恢复可能还在跑 setStart，抢第一下会白点）
    await wait(1200);
    const hiBound = Math.max(prof.last, state.profile?.live?.last || 0);   // 有实时段时上界要跟着延长
    const picks = [];
    for (let i = 0; i < 4; i++) {
      document.getElementById('randomStart').click();
      await wait(900);
      const cursor = rp.cursor;
      const lb = app.lastBar();   // [vela] 回放中封顶在游标
      picks.push({
        cursor,
        inRange: cursor >= prof.first && cursor <= hiBound,
        windowEnd: lb ? lb.timestamp : null,
        bars: app.bars.length,
        input: input.value,
        cursorInfo: document.getElementById('cursorInfo').textContent
      });
    }

    const distinct = new Set(picks.map(p => p.cursor)).size;
    const allEndOk = picks.every(p => p.windowEnd === p.cursor);
    const allInRange = picks.every(p => p.inRange);
    const allBars = picks.every(p => p.bars > 100);
    const allInput = picks.every(p => p.input && p.input.length >= 16);
    const statusText = document.getElementById('status').textContent;

    log('randomStart', { picks, distinct, allEndOk, allInRange, allBars, allInput });
    log('status', statusText.slice(0, 120));

    R.pass = distinct >= 3 && allEndOk && allInRange && allBars && allInput
      && /随机起点/.test(statusText);
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
