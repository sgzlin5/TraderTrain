// M41 验收：启动自动补缺口（开关 + 管线 + 幂等）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');

    // 这个用例的前提是 XAUUSD 档案已补到“昨天”，别的用例可能把档案切走
    if (state.profile?.id !== 'XAUUSD-1m' && window.__TT_LOAD_PROFILE__) {
      const t = (state.profiles || []).find(p => p.id === 'XAUUSD-1m');
      if (t) { await window.__TT_LOAD_PROFILE__(t); if (window.__APP_READY__) await window.__APP_READY__; await wait(400); }
    }
    const db = await import('./db.js');
    const dl = await import('./download.js');

    // 1) 开关：存在 + 可改 + 能落库（初始值是异步读的，等一拍）
    const box = document.getElementById('dlAutoGap');
    await wait(400);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    const kvOn = await db.kvGet('ui:autogap');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    const kvOff = await db.kvGet('ui:autogap');
    log('switch', { exists: !!box, on: kvOn === true, off: kvOff === false });

    // 前置：档案可能落后于「昨天」（其它用例/离线环境），先补到齐再验 up-to-date；
    // 否则补缺口任务还在跑，下面第三步一进去就是 busy
    const waitIdle = async (ms = 300000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const r = await dl.autoGapFill(state.profile.symbol);
        if (r.reason !== 'busy') return r;
        await wait(2000);
      }
      return { reason: 'timeout' };
    };
    let gate = await dl.autoGapFill(state.profile.symbol);
    if (gate.started) gate = await waitIdle();
    log('prefill', { gate });

    // 2) 无缺口时明确返回 up-to-date（不启动任务）
    const p0 = await db.getProfile(state.profile.id);
    const noGap = await dl.autoGapFill(p0.symbol);
    log('noGap', { started: noGap.started, reason: noGap.reason });

    // 3) 同一段区间跑两次：第二次必须 0 新增（幂等）
    const from = new Date(p0.last - 3 * 86400000).toISOString().slice(0, 10);
    const to = new Date(p0.last).toISOString().slice(0, 10);
    const runOnce = async () => {
      const msgs = [];
      const r = await dl.autoGapFill(p0.symbol, { from, to, onStatus: (t, err) => msgs.push((err ? 'ERR:' : '') + t) });
      for (let i = 0; i < 90; i++) {
        await wait(1000);
        if (msgs.some(t => /已续传|失败|取消/.test(t))) break;
      }
      await wait(1500);                     // 等 finally 清 jobId
      const done = msgs.find(t => /已续传/.test(t)) || '';
      const m = done.match(/新增 ([\d,]+) 根/);
      return { started: r.started, from: r.from, to: r.to, delta: m ? Number(m[1].replace(/,/g, '')) : null, msg: done.slice(0, 90) };
    };

    const a1 = await runOnce();
    const p1 = await db.getProfile(state.profile.id);
    // 等 jobId 释放（finally 清）后再问一次“还有没有缺口”
    let again = { reason: 'busy' };
    for (let i = 0; i < 12; i++) {
      again = await dl.autoGapFill(p0.symbol);
      if (again.reason !== 'busy') break;
      await wait(1000);
    }

    log('pipeline', {
      first: a1,
      bars0: p0.bars, bars1: p1.bars,
      idempotent: p1.bars === p0.bars && a1.delta === 0,
      rerunReason: again.reason
    });

    const s = R.checks;
    R.pass = s.switch.exists === true && s.switch.on === true && s.switch.off === true
      && s.noGap.started === false && s.noGap.reason === 'up-to-date'
      && s.pipeline.first.started === true && s.pipeline.first.from === from && s.pipeline.first.to === to
      && s.pipeline.idempotent === true
      && s.pipeline.rerunReason === 'up-to-date';
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
