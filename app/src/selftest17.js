// M17 验收：Ctrl 临时吸附 + Shift 水平线段
import { isSnapActive, isMagnetOn, setMagnetOn, mods } from './magnet.js';

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const key = (type, name, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, ...extra }));
  const clickAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const ev = (t) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0, buttons: t === 'mouseup' ? 0 : 1, detail: 1 });
    const big = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    big.dispatchEvent(ev('mousemove')); big.dispatchEvent(ev('mousedown')); big.dispatchEvent(ev('mouseup'));
  };
  const moveAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const big = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    big.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0, buttons: 1, detail: 1 }));
  };
  const clickOnlyAt = (fx, fy) => {
    const host = document.getElementById('chart');
    const r = host.getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const big = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    ['mousedown', 'mouseup'].forEach(t => big.dispatchEvent(new MouseEvent(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
      button: 0, buttons: t === 'mouseup' ? 0 : 1, detail: 1
    })));
  };
  const lastOverlay = () => {
    const list = state.app.chart.getOverlays();
    return list[list.length - 1] || null;
  };
  const ohcHit = (p) => {
    const l = state.app.chart.getDataList();
    const b = l.find(x => x.timestamp === p.timestamp);
    if (!b) return { hit: false, v: p.value };
    const v = Math.round(p.value * 1000) / 1000;
    const set = [b.open, b.high, b.low, b.close].map(x => Math.round(x * 1000) / 1000);
    return { hit: set.includes(v), v };
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (!state.app) throw new Error('应用未就绪（先导入数据）');
    const wasOn = isMagnetOn();
    setMagnetOn(false);                      // 从"磁铁关"开始，确保验的是 Ctrl 临时吸附
    await wait(200);

    // 1) Ctrl 按住 → 临时吸附
    const before = isSnapActive();
    key('keydown', 'Control', { ctrlKey: true });
    await wait(120);
    const during = isSnapActive();
    key('keyup', 'Control');
    await wait(120);
    const after = isSnapActive();

    // 2) 按住 Ctrl 画线段 → 落点吸到 OHLC
    state.draw.clear();
    await wait(200);
    state.draw.activate('segment');
    await wait(300);
    key('keydown', 'Control', { ctrlKey: true });
    clickAt(0.32, 0.62); await wait(380);
    clickAt(0.58, 0.36); await wait(520);
    key('keyup', 'Control');
    await wait(300);
    const ctrlOv = lastOverlay();
    const ctrlPts = (ctrlOv?.points || []).map(ohcHit);
    const ctrlCase = { n: ctrlOv?.name, pts: ctrlPts, allHit: ctrlPts.length === 2 && ctrlPts.every(p => p.hit) };

    // 3) 按住 Shift 画线段 → 水平（两点等高）
    state.draw.clear();
    await wait(200);
    state.draw.activate('segment');
    await wait(300);
    key('keydown', 'Shift', { shiftKey: true });
    clickAt(0.30, 0.70); await wait(380);
    clickAt(0.60, 0.40); await wait(520);
    key('keyup', 'Shift');
    await wait(300);
    const shiftOv = lastOverlay();
    const sv = (shiftOv?.points || []).map(p => Math.round(p.value * 1000) / 1000);
    const shiftCase = { pts: sv, level: sv.length === 2 && sv[0] === sv[1] };

    // 3b) 只按 Shift、不动鼠标 → 随后直接落点，第二点也应该是水平的
    state.draw.clear();
    await wait(200);
    state.draw.activate('segment');
    await wait(300);
    clickOnlyAt(0.40, 0.62); await wait(420);
    moveAt(0.62, 0.30); await wait(220);            // 预览到另一个高度
    key('keydown', 'Shift', { shiftKey: true });
    await wait(420);                                 // 不移动鼠标，只按键
    clickOnlyAt(0.62, 0.30); await wait(420);        // 直接落点
    key('keyup', 'Shift');
    const idlePts = (lastOverlay()?.points || []).map(p => Math.round(p.value * 1000) / 1000);
    const idleShift = { pts: idlePts, levelled: idlePts.length === 2 && idlePts[0] === idlePts[1] };
    state.draw.clear();
    await wait(200);

    // 4) 松开后不再约束
    state.draw.clear();
    await wait(200);
    state.draw.activate('segment');
    await wait(300);
    clickAt(0.28, 0.72); await wait(360);
    clickAt(0.56, 0.30); await wait(520);
    const plainOv = lastOverlay();
    const pv = (plainOv?.points || []).map(p => Math.round(p.value * 1000) / 1000);
    const plainCase = { pts: pv, notLevel: pv.length === 2 && pv[0] !== pv[1] };

    state.draw.clear();
    await wait(200);
    setMagnetOn(wasOn);

    log('ctrl', { before, during, after });
    log('ctrlDraw', ctrlCase);
    log('shiftDraw', shiftCase);
    log('idleShift', idleShift);
    log('plainDraw', plainCase);

    R.pass = (
      before === false && during === true && after === false
      && ctrlCase.allHit
      && shiftCase.level
      && idleShift.levelled
      && plainCase.notLevel
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
