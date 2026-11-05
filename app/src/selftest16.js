// M16 验收：@klinecharts/extension 集成（18 个 overlay 注册 · 更多工具弹层 · 可画可存）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const clickAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const ev = (t) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0, buttons: t === 'mouseup' ? 0 : 1, detail: 1 });
    const big = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    big.dispatchEvent(ev('mousemove')); big.dispatchEvent(ev('mousedown')); big.dispatchEvent(ev('mouseup'));
  };
  const pickExt = async (key) => {
    document.querySelector('#tools button[data-act=more]').click();
    await wait(320);
    const n = document.querySelectorAll('#moreToolsGrid [data-ext]').length;
    const b = document.querySelector(`#moreToolsGrid [data-ext="${key}"]`);
    if (b) b.click();
    await wait(360);
    return { buttons: n, active: state.draw?.activeTool };
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;

    const supported = window.klinecharts.getSupportedOverlays();
    const EXT = ['measure', 'gannBox', 'fibonacciExtension', 'fibonacciSegment', 'fibonacciCircle',
      'fibonacciSpeedResistanceFan', 'fibonacciSpiral', 'abcd', 'xabcd', 'threeWaves',
      'fiveWaves', 'eightWaves', 'anyWaves', 'arrow', 'rect', 'circle', 'triangle', 'parallelogram'];
    const registered = EXT.filter(n => supported.includes(n));

    // 清图 + 画三个扩展工具
    state.draw.clear();
    await wait(400);
    const pop = await pickExt('measure');
    clickAt(0.30, 0.72); await wait(320); clickAt(0.46, 0.45); await wait(500);
    const pop2 = await pickExt('gannBox');
    clickAt(0.52, 0.74); await wait(320); clickAt(0.68, 0.42); await wait(500);
    const pop3 = await pickExt('fibonacciExtension');
    clickAt(0.30, 0.30); await wait(300); clickAt(0.45, 0.20); await wait(300); clickAt(0.60, 0.35); await wait(600);

    const drawn = state.app.overlayList().map(o => ({ n: o.name, pts: (o.points || []).length }));
    await state.draw.persist();
    const kept = JSON.parse(JSON.stringify(state.draw.items));

    // 重建：先清空再按 capture 出来的 items 重放
    state.draw.clear();
    await wait(400);
    state.draw.items = kept;
    const restored = state.draw.restore();
    await wait(600);
    const afterLoad = state.app.overlayList().map(o => o.name);

    // 关掉弹层 + 清图，避免污染后续
    try { document.querySelector('#tools button[data-act=more]').click(); } catch {}
    state.draw.clear();
    await wait(300);

    log('ext', { total: EXT.length, registered: registered.length, missing: EXT.filter(n => !supported.includes(n)) });
    log('popover', { measure: pop, gann: pop2, fib: pop3 });
    log('drawn', drawn);
    log('restore', { loadReturned: restored, afterLoad });

    R.pass = (
      registered.length === 18
      && pop.buttons === 18 && pop.active === 'measure'
      && pop2.active === 'gannBox' && pop3.active === 'fibonacciExtension'
      && drawn.length === 3
      && drawn.map(d => d.n).join(',') === 'measure,gannBox,fibonacciExtension'
      && restored === 3 && afterLoad.includes('measure') && afterLoad.includes('gannBox') && afterLoad.includes('fibonacciExtension')
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
