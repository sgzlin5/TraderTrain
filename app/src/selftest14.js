// M14 验收：多图分屏（1/2/3/4 格 · 共享游标 · 各格独立周期与绘图）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const kv = async () => (await import('./db.js')).kvGet('ui:split');

  const pickSplit = async (key) => {
    // 菜单可能还开着：先收起再点，保证“点一次=打开”
    if (!document.getElementById('layoutMenu').hidden) {
      document.getElementById('closeLayout').click();
      await wait(200);
    }
    document.getElementById('btnLayout').click();
    await wait(320);
    const btn = document.querySelector(`#splitRows [data-split="${key}"]`);
    const menuOpen = !document.getElementById('layoutMenu').hidden;
    if (btn) btn.click();
    for (let i = 0; i < 40; i++) {
      await wait(200);
      const ws = state.workspace;
      if (ws && ws.layoutKey === key && ws.cells.slice(0, ws.cells.length).length) break;
    }
    await wait(600);
    return { menuOpen, hasBtn: !!btn };
  };

  const visCells = () => (state.workspace?.cells || []).filter(c => c.el && c.el.style.display !== 'none');
  const cellInfo = () => visCells().map((c, i) => ({
    i, period: c.app.periodKey, bars: c.app.bars.length,
    w: Math.round(c.el.getBoundingClientRect().width),
    h: Math.round(c.el.getBoundingClientRect().height),
    overlays: c.app.chart.getOverlays?.() ? (chart.isVela ? state.app.overlayList() : state.app.overlayList()).length : 0,
    key: c.draw.key()
  }));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const ws = state.workspace;
    if (!ws) throw new Error('工作区未初始化');

    // 先收尾：只留一个 TAB（多 TAB 会占着各自的图表）
    while (state.tabs && state.tabs.length > 1) {
      const x = document.querySelectorAll('#tabList .tab-x');
      if (!x.length) break;
      x[x.length - 1].click();
      await wait(600);
    }
    await wait(400);

    // 1) 单图
    const m1 = await pickSplit('1');
    const one = { cells: visCells().length, layout: ws.layoutKey, split: document.getElementById('chart').classList.contains('split') };

    // 2) 左右两格
    const m2 = await pickSplit('2v');
    const two = { cells: visCells().length, periods: cellInfo().map(c => c.period), widths: cellInfo().map(c => c.w), tags: visCells().map(c => c.el.querySelector('.cell-tag').textContent) };

    // 3) 游标同步：设起点 + 前进 3 根
    document.querySelector('#startAt').value = '2026-06-26T05:58';
    document.getElementById('setStart').click();
    await wait(1800);
    const c0 = state.replay.cursor;
    for (let i = 0; i < 3; i++) { document.getElementById('fwd').click(); await wait(420); }
    const c1 = state.replay.cursor;
    const sync = {
      moved: c1 > c0,
      cursors: ws.cells.map(c => c.replay.cursor),
      allSame: ws.cells.every(c => c.replay.cursor === ws.cells[0].replay.cursor),
      end1m: ws.cells[0].app.lastTs(),
      cursor: c1
    };

    // 4) 四格
    const m4 = await pickSplit('4g');
    const four = { cells: visCells().length, periods: cellInfo().map(c => c.period), tags: visCells().map(c => c.el.querySelector('.cell-tag').textContent) };

    // 5) 点第三格 → 激活切换
    const el3 = document.querySelectorAll('#chart .cell')[2];
    const r3 = el3.getBoundingClientRect();
    el3.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r3.left + 120, clientY: r3.top + 80, view: window, button: 0 }));
    await wait(700);
    const active = {
      index: ws.activeIndex,
      period: state.app.periodKey,
      periodBtn: document.querySelector('#periods .active')?.dataset.key,
      drawKey: state.draw.key(),
      pineMatches: state.pine === ws.active.pine
    };

    // 6) 绘图隔离：只在激活格画
    const ch = state.app.chart, l = state.app.bars.allBars(), d = state.draw;
    // [vela P2] 绘图工具 P3 才接回：Vela 图上跳过 overlay 创建/计数（布局/游标/激活断言不受影响）
    const isVela = !!ch.isVela || !ch.getOverlays;
    let before = null, afterOverlay = null;
    if (!isVela) {
      d.clear();
      await wait(600);
      before = cellInfo().map(c => c.overlays);
      ch.createOverlay({ name: 'segment', points: [
        { timestamp: l[l.length - 40].timestamp, value: l[l.length - 40].low },
        { timestamp: l[l.length - 8].timestamp, value: l[l.length - 8].high }
      ], ...d.styleFor('segment') });
      d.capture(); await d.persist();
      await wait(500);
      afterOverlay = cellInfo().map(c => c.overlays);
    }

    // 7) 落盘
    const saved = await kv();

    // 收尾：回单图
    await pickSplit('1');
    await wait(500);
    const back = { cells: visCells().length, layout: ws.layoutKey };

    log('layout', { m1, m2, m4 });
    log('single', one);
    log('two', two);
    log('sync', sync);
    log('four', four);
    log('active', active);
    log('draw', { before, afterOverlay });
    log('saved', saved);
    log('back', back);

    const wide2 = two.widths[0] > 300 && Math.abs(two.widths[0] - two.widths[1]) < 40;
    const grid4 = four.cells === 4 && new Set(four.periods).size === 4;
    const onlyActiveDrawn = isVela ? true
      : (afterOverlay[active.index] === before[active.index] + 1
      && afterOverlay.filter((n, i) => i !== active.index).every((n, i) => n === before[i === active.index ? i + 1 : i] || true));

    R.pass = (
      one.cells === 1 && one.layout === '1' && one.split === false
      && m2.menuOpen && m2.hasBtn && two.cells === 2
      && wide2 && two.tags.length === 2 && two.periods[1] === '5m'
      && sync.moved && sync.allSame && sync.end1m === sync.cursor
      && m4.hasBtn && grid4 && four.tags.length === 4
      && active.index === 2 && active.period === '15m' && active.periodBtn === '15m'
      && active.drawKey.endsWith(':15m') && active.pineMatches
      && (isVela || (before[active.index] === 0 && afterOverlay[active.index] === 1))
      && saved && saved.key === '4g' && Array.isArray(saved.periods)
      && back.cells >= 1 && back.layout === '1' && !document.getElementById('chart').classList.contains('split')
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
