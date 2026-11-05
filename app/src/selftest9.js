// M9 验收：折线工具 + 吸附开关
import { isMagnetOn, loadMagnet, setMagnetOn, snapPoint } from './magnet.js';

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 2500) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await wait(80); }
    return !!fn();
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const draw = state.draw;
    const dw = chart.drawings;
    const magnetBtn = document.querySelector('#tools button[data-act="magnet"]');
    const toolBtn = document.querySelector('#tools button[data-tool="polyline"]');
    const before = isMagnetOn();

    /* [vela P3] 折线是 Vela 原生工具：交互放置走真实鼠标（合成事件驱动不了渲染器内部
       事件管线），自检验证：工具激活态 + 编程式建档 + 持久化往返 + 吸附开关 */

    // —— 折线工具激活 + 4 点建档 ——
    setMagnetOn(false);
    app.setMagnet?.(false);
    draw.clear();
    await wait(200);
    draw.activate('polyline');
    await wait(250);
    const armedType = dw.getTool?.() ?? null;
    const l = app.bars.allBars();
    const px = (i, k) => ({ time: l[l.length - 30 - i * 6].timestamp, price: k === 0 ? l[l.length - 30 - i * 6].low : l[l.length - 30 - i * 6].high });
    dw.add('polyline', { anchors: [px(0), px(1), px(2), px(3)] });
    await until(() => (dw.toJSON().drawings || []).some(x => x.type === 'polyline'), 1500);
    draw.capture();
    const polyItem = draw.items.find(i => i.name === 'polyline');
    const poly = {
      armedType,
      items: draw.items.length,
      pts: polyItem ? polyItem.points.length : 0,
      active: draw.activeTool
    };
    draw.cancelPending();

    // —— 右键菜单（宿主 UI，与绘图内核无关的部分保留） ——
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const rp = { clientX: r.left + r.width * 0.70, clientY: r.top + r.height * 0.42 };
    host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, ...rp }));
    await wait(320);
    const menuAfter = !document.getElementById('ctxMenu').hidden;
    document.getElementById('ctxMenu').hidden = true;
    const ctxProbe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r2 = el.getBoundingClientRect();
      const e2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2,
        clientX: r2.left + Math.min(24, r2.width / 2), clientY: r2.top + Math.min(16, r2.height / 2) });
      el.dispatchEvent(e2);
      const prevented = e2.defaultPrevented;
      document.getElementById('ctxMenu').hidden = true;
      return prevented;
    };
    const nativeMenu = { statusBar: ctxProbe('#status'), tabBar: ctxProbe('#tabBar'), input: ctxProbe('#startAt') };

    // —— 落盘 + 重建：4 点折线 + 2 点折线各一 ——
    dw.add('polyline', { anchors: [px(4), px(5)] });
    await wait(300);
    await draw.persist();
    const shown = await draw.load();
    await wait(400);
    const afterLoad = (dw.toJSON().drawings || []).filter(x => x.type === 'polyline').map(x => x.anchors.length);

    // —— 吸附开关：Vela 原生 setSnapMode ——
    const modeOff = dw.getSnapMode?.() ?? null;
    magnetBtn.click();              // 走 UI：切换 + 重渲染按钮
    await wait(200);
    const modeOn = dw.getSnapMode?.() ?? null;
    const snap = {
      modeOff, modeOn,
      toggled: modeOff !== modeOn,
      weakIsOn: modeOn === 'weak' || modeOn === 'strong'
    };

    // —— 吸附状态持久化 ——
    const persisted = await loadMagnet();
    const btnOn = !!document.querySelector('#tools button[data-act="magnet"].active');
    draw.clear();
    await wait(200);

    log('polyline', poly);
    log('restore', { shown, afterLoad });
    log('rightClick', { menuAfter, nativeMenu });
    log('magnet', { ...snap, persisted, btnOn });
    log('ui', { magnetBtn: !!magnetBtn, toolBtn: !!toolBtn });

    setMagnetOn(before);
    app.setMagnet?.(before);

    R.pass = (
      poly.armedType === 'polyline' && poly.items === 1 && poly.pts === 4
      && afterLoad.length === 2 && afterLoad.includes(4) && afterLoad.includes(2)
      && snap.toggled === true && snap.weakIsOn === true
      && persisted === true && btnOn === true
      && menuAfter === true && nativeMenu.statusBar === true && nativeMenu.tabBar === true
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
