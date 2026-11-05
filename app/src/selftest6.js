// M6 验收自检：选中绘图的浮动操作条（改色/改宽/线型/删除/持久化）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const draw = state.draw;
    const l = state.app.bars.allBars();

    // 1. 造一条绘图
    chart.removeOverlay();
    draw.items = [];
    const a = l.length - 60, b = l.length - 12;
    chart.createOverlay({
      name: 'segment',
      points: [{ timestamp: l[a].timestamp, value: l[a].close }, { timestamp: l[b].timestamp, value: l[b].close }],
      ...draw.styleFor('segment')
    });
    draw.capture();
    await draw.persist();
    await wait(200);

    // 2. 点击线中点 → 弹出操作条
    const o = state.app.overlayList()[0];
    const px = chart.convertToPixel(o.points.map(p => ({ timestamp: p.timestamp, value: p.value })), { paneId: 'candle_pane' });
    const rect = document.getElementById('chart').getBoundingClientRect();
    const cx = rect.left + (px[0].x + px[1].x) / 2;
    const cy = rect.top + (px[0].y + px[1].y) / 2;
    document.getElementById('chart').querySelectorAll('canvas').forEach(cv => {
      cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy, view: window }));
    });
    await wait(350);
    const barShown = !document.getElementById('ovBar').hidden;
    const barName = document.getElementById('ovName').textContent;

    // 3. 改色 + 改宽
    const colorEl = document.getElementById('ovColor');
    colorEl.value = '#ffcc66';
    colorEl.dispatchEvent(new Event('input', { bubbles: true }));
    const widthEl = document.getElementById('ovWidth');
    widthEl.value = '2';
    widthEl.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    const line = state.app.overlayList()[0].styles.line;

    // 4. ⋯ → 虚线
    document.getElementById('ovMore').click();
    await wait(250);
    const menuOpen = !document.getElementById('ovMenu').hidden;
    document.querySelector('#ovLs .ov-chip[data-ls="dashed"]').click();
    await wait(300);
    const line2 = state.app.overlayList()[0].styles.line;
    const itemStyle = draw.items[0]?.lineStyle || null;

    // 5. 持久化往返
    await draw.persist();
    const stored = (await (async () => { const { kvGet } = await import('./db.js'); return kvGet(`draw:${state.profile.symbol}:${state.periodKey || '1m'}`); })()) || [];
    const storedStyle = stored[0]?.lineStyle || null;

    // 6. 删除
    document.getElementById('ovDel').click();
    await wait(350);
    const afterDel = state.app.overlayList().length;
    const barHidden = document.getElementById('ovBar').hidden;

    log('ovbar', {
      barShown, barName, menuOpen,
      line: { color: line.color, size: line.size },
      line2: { style: line2.style, dashedValue: line2.dashedValue },
      itemStyle, storedStyle,
      afterDel, barHidden
    });

    R.pass = (
      barShown && barName === '趋势线' && menuOpen
      && line.color === '#ffcc66' && line.size === 2
      && line2.style === 'dashed'
      && !!itemStyle && itemStyle.style === 'dashed' && !!storedStyle && storedStyle.color === '#ffcc66'
      && afterDel === 0 && barHidden
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
