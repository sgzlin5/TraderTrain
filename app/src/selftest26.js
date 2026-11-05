// M26 验收：Pine 自编指标的参数面板（脚本 input.* 全量 + 每条 plot 的线条）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const SRC = [
    '//@version=5',
    'indicator("参数面板测试", overlay=true)',
    'len = input.int(14, title="周期", minval=1, maxval=200)',
    'mult = input.float(2.0, title="倍数", step=0.5)',
    'useMid = input.bool(true, title="使用中值")',
    'src = input.source(close, title="价格源")',
    'basis = ta.sma(src, len)',
    'dev = ta.stdev(src, len) * mult',
    'plot(basis, "basis")',
    'plot(basis + dev, "upper")',
    'plot(basis - dev, "lower")'
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
    const { libSave, libList } = await import('./pine.js');
    const entry = { id: 'T26' + Date.now().toString(36), name: '参数面板测试', src: SRC, inputs: {}, lineStyles: [] };
    await libSave(entry);

    const bars = state.app.bars.allBars();
    const r0 = await state.pine.apply({ ...entry }, bars);
    log('applied', { ok: r0.ok, names: r0.names });
    await wait(700);

    const indName = state.pine.list().find(x => x.id === entry.id)?.indName;
    const before = chart.getIndicators().find(i => i.name === indName)?.result?.slice(-1)[0];
    log('before', before);

    // 打开设置（图例齿轮）
    document.getElementById('btnIndicator').click();
    await wait(700);
    document.getElementById('closeIndicator').click();
    await wait(500);
    document.querySelector('#chartLegend [data-cfg]').click();
    await wait(1200);

    log('panel', {
      pineBox: !document.getElementById('indSetPineBox').hidden,
      paramsRow: getComputedStyle(document.getElementById('indSetParamsRow')).display,
      inputs: [...document.querySelectorAll('#indSetInputs [data-piname]')].map(el => ({
        n: el.dataset.piname, t: el.dataset.pitype, v: el.type === 'checkbox' ? el.checked : el.value
      })),
      lines: [...document.querySelectorAll('#indSetLines .ind-set-line')].map(x => x.querySelector('.sep')?.textContent)
    });

    // 改参数 + 改色 → 应用
    const set = (n, v) => { const el = [...document.querySelectorAll('#indSetInputs [data-piname]')].find(x => x.dataset.piname === n); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } };
    set('len', '30'); set('mult', '3');
    const col = document.querySelector('#indSetLines input[type=color]');
    col.value = '#ffcc66'; col.dispatchEvent(new Event('input'));
    document.getElementById('indSetApply').click();
    await wait(2600);

    const entry2 = (await libList()).find(e => e.id === entry.id);
    const ind2 = chart.getIndicators().find(i => /^PINE_/.test(i.name));
    log('after', {
      indName: ind2?.name,
      last: ind2?.result?.slice(-1)[0],
      color0: ind2?.styles?.lines?.[0]?.color,
      inputs: entry2?.inputs,
      lineStyles: (entry2?.lineStyles || []).slice(0, 1)
    });

    // 恢复默认
    document.querySelector('#chartLegend [data-cfg]').click();
    await wait(1000);
    document.getElementById('indSetReset').click();
    await wait(2200);
    const entry3 = (await libList()).find(e => e.id === entry.id);
    log('reset', { inputs: entry3?.inputs, lines: entry3?.lineStyles });

    // 收尾清理
    state.pine.remove(entry.id);
    const rest = (await libList()).filter(e => e.id !== entry.id);
    await import('./db.js').then(m => m.kvSet('pine:lib', rest));
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }

    R.pass = (
      r0.ok === true && R.checks.applied.names.length === 3
      && R.checks.panel.pineBox === true && R.checks.panel.paramsRow === 'none'
      && R.checks.panel.inputs.length === 4
      && R.checks.panel.inputs.map(x => x.t).join(',') === 'int,float,bool,source'
      && R.checks.panel.lines.join(',') === 'basis,upper,lower'
      && R.checks.after.inputs.len === 30 && R.checks.after.inputs.mult === 3
      && R.checks.after.color0 === '#ffcc66'
      && before?.basis !== R.checks.after.last?.basis
      && R.checks.after.last.basis > 0
      && (R.checks.reset.inputs == null || Object.keys(R.checks.reset.inputs).length === 0)
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
