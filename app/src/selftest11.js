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
    const rp = state.replay;
    const prof = app.profile;
    const btn = document.getElementById('randomStart');
    const input = document.getElementById('startAt');

    const picks = [];
    for (let i = 0; i < 4; i++) {
      btn.click();
      await wait(900);
      const list = app.chart.getDataList();
      const cursor = rp.cursor;
      picks.push({
        cursor,
        inRange: cursor >= prof.first && cursor <= prof.last,
        windowEnd: list.length ? list[list.length - 1].timestamp : null,
        bars: list.length,
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
