// M30 验收：LuxAlgo 结构&趋势面板脚本「直接粘贴即可用」
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');

    // 干净起点：清掉上一轮遗留的 Pine 指标与 DOM 面板
    state.pine?.clear?.();
    document.querySelectorAll('.pine-board').forEach(el => el.remove());
    await wait(400);

    const src = await (await fetch('./fixtures/luxalgo-structure-trend-dashboard.pine')).text();
    log('scriptChars', src.length);

    const pine = await import('./pine.js');
    const bars = chart.getDataList();
    const r = await pine.compilePine(src, bars);
    log('compile', { ok: r.ok, err: (r.error || '').slice(0, 120), names: r.names });

    // 1) time / security 都能出数（openTime/closeTime 补齐后）
    const s = r.series || {};
    const last = (k) => { const a = s[k] || []; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    const probe = await pine.compilePine([
      '//@version=6', 'indicator("probe", overlay=true)',
      'plot(time, "t")', 'plot(hour, "h")',
      'plot(request.security(syminfo.tickerid, "60", close), "s60")',
      'plot(request.security(syminfo.tickerid, "240", close), "s240")'
    ].join('\n'), bars);
    const pt = probe.series || {};
    const lastP = (k) => { const a = pt[k] || []; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    log('timeSeries', { time: lastP('t'), hour: lastP('h'), s60: lastP('s60'), s240: lastP('s240') });

    // 2) 绘图对象带坐标
    const P = r.ctx.plots;
    const take = (k) => (P[k].data.map(x => x && x.value).flat().filter(Boolean)) || [];
    const lines = take('__lines__'), boxes = take('__boxes__'), labels = take('__labels__');
    log('drawings', {
      lines: lines.length, linesWithX: lines.filter(o => o.x1 != null && o.x2 != null).length,
      boxes: boxes.length, boxesWithX: boxes.filter(o => o.left != null && o.right != null).length,
      labels: labels.length, labelsWithX: labels.filter(o => o.x != null).length
    });

    // 3) 表格内容（真实多周期方向 + 对齐勾）
    const T = take('__tables__');
    const tb = T[T.length - 1];
    const cells = tb ? tb.cells.flat().filter(Boolean).map(c => c.text) : [];
    log('table', { cells: cells.length, texts: cells.slice(0, 10), hasAlign: cells.includes('☑') || cells.includes('☐') });

    // 4) 挂到图上 → 出现 DOM 面板，且移除后消失
    const { libSave, libList } = await import('./pine.js');
    const entry = { id: 'T30' + Date.now().toString(36), name: 'LuxAlgo 面板', src, inputs: {}, lineStyles: [] };
    await libSave(entry);
    const ap = await state.pine.apply(entry, bars);
    await wait(1200);
    const boardCount = document.querySelectorAll('.pine-board').length;
    const cellCount = document.querySelectorAll('.pine-board td').length;
    state.pine.remove(entry.id);
    await wait(500);
    const afterRemove = document.querySelectorAll('.pine-board').length;
    log('dom', { applied: ap.ok, boards: boardCount, cells: cellCount, afterRemove });

    // 5) 设置面板：Position / Size 必须是下拉（input.string 带 options）
    await state.pine.apply(entry, bars);
    await wait(1200);
    document.getElementById('btnIndicator').click();
    await wait(600);
    document.getElementById('closeIndicator').click();
    await wait(400);
    document.querySelector('#chartLegend [data-cfg]').click();
    await wait(1200);
    const selects = [...document.querySelectorAll('#indSetInputs select')].map(el => ({
      n: el.dataset.piname, v: el.value, opts: [...el.options].map(o => o.value)
    }));
    log('selects', selects);
    log('parsedOptions', pine.parseInputs(src)
      .filter(i => ['dashboardPositionInput', 'dashboardSizeInput'].includes(i.name))
      .map(i => ({ n: i.name, opts: i.options })));
    document.getElementById('indSetCancel').click();
    await wait(300);

    // 收尾
    state.pine.remove(entry.id);
    document.querySelectorAll('.pine-board').forEach(el => el.remove());
    await (await import('./db.js')).kvSet('pine:lib', (await libList()).filter(e => e.id !== entry.id));

    R.pass = (
      r.ok === true
      && lastP('t') > 0 && lastP('h') >= 0
      && lastP('s60') > 0 && lastP('s240') > 0
      && lines.length > 50 && lines.filter(o => o.x1 != null).length > 50
      && labels.filter(o => o.x != null).length > 20
      && cells.length > 20
      && (cells.includes('☑') || cells.includes('☐'))
      && boardCount === 1 && cellCount > 15
      && afterRemove === 0
      && selects.length === 2
      && selects.find(x => x.n === 'dashboardPositionInput')?.opts.join(',') === 'Top Right,Bottom Right,Bottom Left'
      && selects.find(x => x.n === 'dashboardSizeInput')?.opts.join(',') === 'Tiny,Small,Normal,Large,Huge'
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
