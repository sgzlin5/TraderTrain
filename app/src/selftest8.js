// M8 验收自检：做多 / 做空仓位工具（3 次点击完成，落盘）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const clickAt = (fx, fy, notes = '') => {
    const host = document.getElementById('chart');
    const cvs = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    const r = cvs.getBoundingClientRect();
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    const fire = (t) => cvs.dispatchEvent(new MouseEvent(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
      button: 0, buttons: t === 'mouseup' ? 0 : 1, detail: 1
    }));
    fire('mousemove'); fire('mousedown'); fire('mouseup');
  };

  // 点一次可能被忽略（刚激活时首帧还没进绘制态），补点到步进变化为止
  const clickUntil = async (fx, fy, expectMinPts) => {
    for (let i = 0; i < 4; i++) {
      clickAt(fx, fy);
      await wait(300);
      const o = document.getElementById('chart') && (chart.isVela ? state.app.overlayList() : state.app.overlayList()).slice(-1)[0];
      const pts = (o?.points || []).filter(p => Number.isFinite(p.value)).length;
      if (pts >= expectMinPts) return pts;
    }
    return -1;
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const draw = state.draw;

    const supported = (window.klinecharts.getSupportedOverlays() || []).filter(n => /Position$/.test(n));

    // 做多：入场 → 止损 → 止盈
    chart.removeOverlay();
    draw.items = [];
    draw.activate('longPosition');
    await wait(450);
    const p1 = await clickUntil(0.45, 0.55, 1);
    const p2 = await clickUntil(0.50, 0.68, 2);
    const p3 = await clickUntil(0.56, 0.40, 3);
    const step1 = { p1, p2, p3 };
    await wait(500);
    const ovs = state.app.overlayList();
    const longOv = ovs.find(o => o.name === 'longPosition');
    const longPts = longOv ? longOv.points.filter(p => Number.isFinite(p.value)).length : 0;
    const afterLong = { n: ovs.length, pts: longPts, active: draw.activeTool, items: draw.items.length };

    // 做空
    draw.activate('shortPosition');
    await wait(450);
    const q1 = await clickUntil(0.62, 0.50, 1);
    const q2 = await clickUntil(0.66, 0.40, 2);
    const q3 = await clickUntil(0.70, 0.66, 3);
    const step2 = { q1, q2, q3 };
    await wait(500);
    const ovs2 = state.app.overlayList();
    const shortOv = ovs2.find(o => o.name === 'shortPosition');
    const shortPts = shortOv ? shortOv.points.filter(p => Number.isFinite(p.value)).length : 0;
    const afterShort = { n: ovs2.length, pts: shortPts, active: draw.activeTool, items: draw.items.length };

    // 落盘 + 重建
    await draw.persist();
    const saved = draw.items.map(i => ({ name: i.name, pts: i.points.length }));
    // 从 IndexedDB 重新载入（load 内部会 removeOverlay + 重建）
    const keep = JSON.parse(JSON.stringify(draw.items));
    await draw.load();
    await wait(500);
    const restored = state.app.overlayList().map(o => o.name);
    const shown = restored.length;
    const l2 = state.app.bars.allBars();
    const inRange = keep.map(it => ({
      name: it.name,
      ok: it.points.every(p => p.timestamp >= l2[0].timestamp && p.timestamp <= l2[l2.length - 1].timestamp)
    }));
    // 再直接 restore 一次（items 原样），验证重建路径
    const shown2 = draw.restore();
    await wait(300);
    const restored2 = state.app.overlayList().map(o => o.name);

    log('position', {
      supported, step1, step2, afterLong, afterShort, saved,
      inRange, restoredShown: shown, restored, shown2, restored2
    });

    chart.removeOverlay();
    draw.items = [];
    await draw.persist();

    R.pass = (
      supported.length === 2
      && afterLong.n === 1 && afterLong.pts === 3 && afterLong.active === null && afterLong.items === 1
      && afterShort.n === 2 && afterShort.pts === 3 && afterShort.items === 2
      && saved.length === 2 && saved.every(s => s.pts === 3)
      && shown2 === 2 && restored2.includes('longPosition') && restored2.includes('shortPosition')
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
