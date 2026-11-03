// M9 验收：折线工具 + 吸附开关
import { isMagnetOn, loadMagnet, setMagnetOn, snapPoint } from './magnet.js';

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const clickAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const mk = (t) => new MouseEvent(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
      button: 0, buttons: t === 'mouseup' ? 0 : 1, detail: 1
    });
    host.dispatchEvent(mk('mousemove'));
    host.dispatchEvent(mk('mousedown'));
    host.dispatchEvent(mk('mouseup'));
  };
  const dblAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    host.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
      view: window, button: 0, detail: 2
    }));
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const draw = state.draw;
    const magnetBtn = document.querySelector('#tools button[data-act="magnet"]');
    const toolBtn = document.querySelector('#tools button[data-tool="polyline"]');
    const before = isMagnetOn();

    // —— 折线：4 点 + 双击结束 ——
    setMagnetOn(false);
    draw.clear();
    await wait(150);
    draw.activate('polyline');
    await wait(250);
    const spots = [[0.28, 0.62], [0.38, 0.80], [0.48, 0.55], [0.58, 0.72]];
    for (const [fx, fy] of spots) { clickAt(fx, fy); await wait(260); }
    const collected = draw._poly ? draw._poly.pts.length : -1;
    dblAt(0.58, 0.72);
    await wait(600);
    const polyItem = draw.items.find(i => i.name === 'polyline');
    const poly = {
      collected,
      items: draw.items.length,
      pts: polyItem ? polyItem.points.length : 0,
      active: draw.activeTool,
      handlers: !!draw._polyHandlers
    };

    // —— 右键收尾：不该弹图表菜单 ——
    draw.activate('polyline');
    await wait(260);
    clickAt(0.62, 0.60); await wait(300);
    clickAt(0.70, 0.42); await wait(300);
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const rp = { clientX: r.left + r.width * 0.70, clientY: r.top + r.height * 0.42 };
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, ...rp }));
    await wait(320);
    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, ...rp }));
    await wait(320);
    const rightClick = {
      polyGone: !draw._poly,
      menuHidden: document.getElementById('ctxMenu').hidden,
      active: draw.activeTool,
      items: draw.items.filter(i => i.name === 'polyline').length
    };
    // 再右键一次：此时应正常弹菜单（等过 500ms 的右键抑制窗口）
    await wait(760);
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, ...rp }));
    await wait(140);
    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, ...rp }));
    await wait(320);
    const menuAfter = !document.getElementById('ctxMenu').hidden;
    document.getElementById('ctxMenu').hidden = true;

    // 浏览器原生菜单拦截：整页右键都不该冒出来（输入框除外）
    const ctxProbe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const e2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2,
        clientX: r.left + Math.min(24, r.width / 2), clientY: r.top + Math.min(16, r.height / 2) });
      el.dispatchEvent(e2);
      const prevented = e2.defaultPrevented;
      document.getElementById('ctxMenu').hidden = true;
      return prevented;
    };
    const nativeMenu = { statusBar: ctxProbe('#status'), tabBar: ctxProbe('#tabBar'), input: ctxProbe('#startAt') };

    // —— 落盘 + 重建 ——
    await draw.persist();
    const shown = await draw.load();
    await wait(400);
    const afterLoad = chart.getOverlays().filter(o => o.name === 'polyline').map(o => o.points.length);

    // —— 吸附：关 → 原样；开 → 吸到 OHLC ——
    const list = chart.getDataList();
    const bar = list[Math.floor(list.length * 0.5)];
    const probe = { timestamp: bar.timestamp + 60000 * 3, value: bar.close + 0.137 };
    const off = snapPoint(chart, probe);
    magnetBtn.click();              // 走 UI：切换 + 重渲染按钮
    await wait(200);
    const onRes = snapPoint(chart, probe);
    const bar2 = list.find(b => b.timestamp === onRes.timestamp);
    const ohlc = bar2 ? [bar2.open, bar2.high, bar2.low, bar2.close].map(v => Math.round(v * 1000) / 1000) : [];
    const magnet = {
      offSame: off.value === probe.value && off.timestamp === probe.timestamp,
      onValue: Math.round(onRes.value * 1000) / 1000,
      onHit: ohlc.includes(Math.round(onRes.value * 1000) / 1000),
      onTs: !!bar2
    };

    // —— 吸附状态持久化 ——
    const persisted = await loadMagnet();
    const btnOn = !!document.querySelector('#tools button[data-act="magnet"].active');
    draw.clear();
    await wait(200);

    log('polyline', poly);
    log('restore', { shown, afterLoad });
    log('rightClick', { ...rightClick, menuAfter, nativeMenu });
    log('magnet', { ...magnet, persisted, btnOn });
    log('ui', { magnetBtn: !!magnetBtn, toolBtn: !!toolBtn });

    setMagnetOn(before);

    R.pass = (
      poly.collected === 4 && poly.items === 1 && poly.pts === 4 && poly.active === null && poly.handlers === false
      && afterLoad.length === 2 && afterLoad.includes(4) && afterLoad.includes(2)
      && magnet.offSame === true && magnet.onHit === true && magnet.onTs === true
      && persisted === true && btnOn === true
      && rightClick.polyGone && rightClick.menuHidden && rightClick.active === null && rightClick.items >= 2
      && menuAfter === true
      && nativeMenu.statusBar === true && nativeMenu.tabBar === true && nativeMenu.input === false
      && !!magnetBtn && !!toolBtn
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
