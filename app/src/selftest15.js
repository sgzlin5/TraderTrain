// M15 验收：图表 TAB（新增/切换/独立周期与游标/关闭/持久化）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const kv = async () => (await import('./db.js')).kvGet('ui:tabs');

  const tabs = () => state.tabs || [];
  const domTabs = () => document.querySelectorAll('#tabList .tab').length;
  const setPeriod = async (key) => {
    const b = document.querySelector(`#periods button[data-key="${key}"]`);
    if (b) b.click();
    await wait(1500);
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (!state.app) throw new Error('应用未就绪（先导入数据）');

    // 收尾到只剩一个 tab
    while (tabs().length > 1) { await closeTabFor(state, tabs()[1].id); await wait(500); }
    await wait(400);
    const base = { tabs: tabs().length, dom: domTabs(), period: state.app.periodKey };

    // 1) 新增
    document.getElementById('tabNew').click();
    await wait(2800);
    const added = {
      tabs: tabs().length,
      dom: domTabs(),
      activeIsNew: state.activeTab === tabs()[1].id,
      period: state.app.periodKey,
      wsInChart: document.querySelectorAll('#chart .ws').length,
      parked: document.getElementById('tabPark').querySelectorAll('.ws').length
    };

    // 2) 新 tab 改周期 15m
    await setPeriod('15m');
    const tab2Period = state.app.periodKey;

    // 3) 新 tab 设起点 = 2026-06-20 05:58
    document.querySelector('#startAt').value = '2026-06-20T05:58';
    document.getElementById('setStart').click();
    await wait(1800);
    const cursorB = state.replay.cursor;

    // 4) 切回 tab1 → 周期/游标应是自己的
    document.querySelectorAll('#tabList .tab')[0].click();
    await wait(1600);
    const backTo1 = { period: state.app.periodKey, cursor: state.replay.cursor, activeIsOld: state.activeTab === tabs()[0].id };
    document.querySelector('#startAt').value = '2026-06-26T05:58';
    document.getElementById('setStart').click();
    await wait(1800);
    const cursorA = state.replay.cursor;

    // 5) 再切回 tab2，游标应还是 cursorB
    document.querySelectorAll('#tabList .tab')[1].click();
    await wait(1400);
    const backTo2 = { period: state.app.periodKey, cursor: state.replay.cursor };

    // 6) 落盘
    const saved = await kv();

    // 7) 关闭 tab2
    document.querySelectorAll('#tabList .tab-x')[1].click();
    await wait(1400);
    const closed = { tabs: tabs().length, dom: domTabs(), activePeriod: state.app.periodKey };

    // 8) 关最后一个 → 拒绝
    document.querySelectorAll('#tabList .tab-x')[0].click();
    await wait(700);
    const lastGuard = { tabs: tabs().length, msg: document.getElementById('stMsg').textContent.slice(-20) };

    log('tab', { base, added, tab2Period, cursors: { a: cursorA, b: cursorB }, backTo1, backTo2, closed, lastGuard });
    log('saved', saved);

    R.pass = (
      base.tabs === 1 && base.dom === 1
      && added.tabs === 2 && added.dom === 2 && added.activeIsNew
      && added.period !== base.period && added.wsInChart === 1 && added.parked === 1
      && tab2Period === '15m'
      && backTo1.period === base.period && backTo1.activeIsOld
      && cursorA !== cursorB
      && backTo2.period === '15m' && backTo2.cursor === cursorB
      && Array.isArray(saved) && saved.length === 2 && saved[1].periods && saved[1].period === '15m'
      && closed.tabs === 1 && closed.dom === 1
      && lastGuard.tabs === 1 && /至少保留一个/.test(lastGuard.msg)
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}

async function closeTabFor(state, id) {
  const btn = [...document.querySelectorAll('#tabList .tab')]
    .find(el => el.dataset.tab === id)?.querySelector('.tab-x');
  if (btn) btn.click();
}
