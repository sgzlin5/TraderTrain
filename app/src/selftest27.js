// M27 验收：Pine 指标用“保存的脚本名”当指标名；刷新后仍能认出并打开参数
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const NAME = 'Candle 2 Closure [LuxAlgo]';
  const SRC = [
    '//@version=5',
    `indicator("${NAME}", overlay=true)`,
    'len = input.int(14, title="周期", minval=1, maxval=200)',
    'show = input.bool(true, title="显示")',
    'src = input.source(close, title="价格源")',
    'basis = ta.sma(src, len)',
    'plot(basis, "basis")',
    'plot(basis * 1.001, "upper")'
  ].join('\n');

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');
    // 干净起点：清掉脚本库 / 映射 / 已上图的 Pine，避免上一轮残留污染断言
    const db = await import('./db.js');
    await db.kvSet('pine:lib', []); await db.kvSet('pine:active', []); await db.kvSet('pine:map', {});
    state.pineMap = {};
    for (const i of chart.getIndicators() || []) { if (/^PINE_/.test(i.name)) { try { chart.removeIndicator({ name: i.name }); } catch {} } }
    if (state.pine) state.pine.items = [];
    await wait(300);
    const { libSave, libList, loadPineMap } = await import('./pine.js');
    const entry = { id: 'T27' + Date.now().toString(36), name: NAME, src: SRC, inputs: {}, lineStyles: [] };
    await libSave(entry);
    const r = await state.pine.apply({ ...entry }, state.app.bars.allBars());
    log('applied', { ok: r.ok, names: r.names });
    await wait(900);

    const ind = chart.getIndicators().find(i => /^PINE_/.test(i.name));
    log('shortName', ind?.shortName);
    log('map', (await loadPineMap())[ind?.name]);

    // 图例显示脚本名
    document.getElementById('btnIndicator').click();
    await wait(700);
    document.getElementById('closeIndicator').click();
    await wait(600);
    log('legend', [...document.querySelectorAll('#chartLegend .lg-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));

    // 模拟刷新：清空内存管理器，只靠持久化映射
    state.pine.items = [];
    state.pineMap = await loadPineMap();
    document.querySelector('#chartLegend [data-cfg]').click();
    await wait(1300);
    log('afterSimulatedReload', {
      head: document.getElementById('indSetHead').textContent,
      pineBox: !document.getElementById('indSetPineBox').hidden
        && getComputedStyle(document.getElementById('indSetPineBox')).display !== 'none',
      inputs: [...document.querySelectorAll('#indSetInputs [data-piname]')].map(el => el.dataset.piname),
      lines: [...document.querySelectorAll('#indSetLines .ind-set-line')].map(x => x.querySelector('.sep')?.textContent)
    });
    document.getElementById('indSetCancel').click();
    await wait(300);

    // 收尾
    try { chart.removeIndicator({ name: ind.name }); } catch {}
    state.pineMap = {};
    const { kvSet } = await import('./db.js');
    await kvSet('pine:map', {});
    await kvSet('pine:active', []);
    await kvSet('pine:lib', (await libList()).filter(e => e.id !== entry.id));
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }

    R.pass = (
      r.ok === true && r.names.length === 2
      && R.checks.shortName === NAME.slice(0, 20)
      && R.checks.map?.name === NAME
      && R.checks.legend[0]?.startsWith(NAME)
      && R.checks.afterSimulatedReload.head.startsWith(NAME)
      && R.checks.afterSimulatedReload.pineBox === true
      && R.checks.afterSimulatedReload.inputs.join(',') === 'len,show,src'
      && R.checks.afterSimulatedReload.lines.join(',') === 'basis,upper'
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
