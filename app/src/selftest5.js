// M5 验收自检：绘图样式（线型/粗细/颜色）+ 斐波那契层级
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
    const ds = await import('./drawStyles.js');

    // 打开样式面板
    document.querySelector('#tools button[data-act="style"]').click();
    await wait(500);
    const panelOpen = !document.getElementById('drawStylePanel').hidden;
    const rows = document.querySelectorAll('#drawStyleRows .ds-row').length;
    // 先恢复标准层级，避免受上一次运行残留影响
    document.querySelector('#fibPresets button[data-preset="0"]').click();
    await wait(300);
    const chips0 = document.querySelectorAll('#fibLevels .ds-chip').length;

    // 斐波那契：虚线 → 实线 3px
    const selStyle = document.querySelector('#drawStyleRows select[data-style="fibonacciLine"]');
    selStyle.value = 'solid';
    selStyle.dispatchEvent(new Event('change', { bubbles: true }));
    const selSize = document.querySelector('#drawStyleRows select[data-size="fibonacciLine"]');
    selSize.value = '3';
    selSize.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);

    // 加一个层级
    const input = document.getElementById('fibLevelInput');
    input.value = '0.705';
    document.getElementById('fibLevelAdd').click();
    await wait(400);
    const levels = state.drawStyles.fibonacciLine.levels.slice();
    const chips1 = document.querySelectorAll('#fibLevels .ds-chip').length;

    // 画一条斐波那契，检查交给内核的样式与层级
    const l = chart.getDataList();
    chart.removeOverlay();
    draw.items = [];
    let lo = 0, hi = 0;
    for (let i = Math.max(0, l.length - 220); i < l.length; i++) {
      if (l[i].low <= l[lo].low) lo = i;
      if (l[i].high >= l[hi].high) hi = i;
    }
    chart.createOverlay({
      name: 'fibonacciLine',
      points: [{ timestamp: l[lo].timestamp, value: l[lo].low }, { timestamp: l[hi].timestamp, value: l[hi].high }],
      ...draw.styleFor('fibonacciLine')
    });
    draw.capture();
    await draw.persist();
    await wait(300);
    const ov = chart.getOverlays()[0];
    log('fib', {
      panelOpen, rows, chips0, chips1, levels,
      line: ov ? { style: ov.styles.line.style, size: ov.styles.line.size } : null,
      ext: ov ? ov.extendData : null,
      extLevels: ov && ov.extendData ? ov.extendData.levels.length : 0
    });

    // 分隔线工具改成虚线 2px，验证另一工具独立
    const segStyle = document.querySelector('#drawStyleRows select[data-style="segment"]');
    segStyle.value = 'dotted';
    segStyle.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    log('segment', { style: state.drawStyles.segment.style, size: state.drawStyles.segment.size });

    // 恢复默认（斐波那契）
    document.querySelector('#fibPresets button[data-preset="0"]').click();
    await wait(300);
    const levelsBack = state.drawStyles.fibonacciLine.levels.slice();

    // 持久化
    const saved = await ds.loadDrawStyles();
    log('persist', { fibStyle: saved.fibonacciLine.style, fibSize: saved.fibonacciLine.size, levels: saved.fibonacciLine.levels.length, segStyle: saved.segment.style });

    document.getElementById('drawStyleDone').click();
    chart.removeOverlay();
    draw.items = [];
    await draw.persist();

    R.pass = (
      panelOpen && rows === 8 && chips0 >= 5 && chips1 === chips0 + 1
      && levels.includes(0.705)
      && !!R.checks.fib.line && R.checks.fib.line.style === 'solid' && R.checks.fib.line.size === 3
      && R.checks.fib.extLevels === levels.length
      && R.checks.segment.style === 'dotted'
      && levelsBack.length === 7
      && R.checks.persist.fibStyle === 'solid' && R.checks.persist.fibSize === 3
      && R.checks.persist.segStyle === 'dotted'
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
