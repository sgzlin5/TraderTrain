// M29 验收：Pine v6 支持 + 兼容性预检（table/label/box 等绘图原语给出明确提示）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const chart = state.app?.chart;
    if (!chart) throw new Error('应用未就绪');
    const { compilePine, scanCompat } = await import('./pine.js');
    const bars = chart.getDataList();

    // 1) v6 真的被识别
    const v6 = '//@version=6\nindicator("v6", overlay=true)\nlen = input.int(20, "L")\nplot(ta.ema(close, len), "ema")';
    const r1 = await compilePine(v6, bars);
    log('v6', { ok: r1.ok, pineVersion: r1.ctx?.pineVersion ?? null, names: r1.names });

    // 2) v6 常见语法
    const feats = {
      switch: '//@version=6\nindicator("s")\nv = switch\n    close > open => 1.0\n    => -1.0\nplot(v)',
      array: '//@version=6\nindicator("a")\nvar a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a))',
      pivot: '//@version=6\nindicator("p", overlay=true)\nplot(ta.pivothigh(high, 5, 5), "PH")\nplot(ta.pivotlow(low, 5, 5), "PL")',
      valuewhen: '//@version=6\nindicator("vw")\nplot(ta.valuewhen(ta.crossover(close, ta.sma(close,20)), close, 0))',
      hline: '//@version=6\nindicator("h")\nhline(0.5, "mid")\nplot(close, "c")'
    };
    const featRes = {};
    for (const [k, src] of Object.entries(feats)) {
      const r = await compilePine(src, bars);
      featRes[k] = { ok: r.ok, names: r.names };
    }
    log('features', featRes);

    // 3) bgcolor 不产生噪声线
    const bg = '//@version=6\nindicator("bg", overlay=true)\nbgcolor(close > open ? color.new(color.green, 90) : na)\nplot(close, "c")';
    const r3 = await compilePine(bg, bars);
    log('bgcolor', { ok: r3.ok, names: r3.names });

    // 4) 兼容性预检
    const dash = '//@version=6\nindicator("dash", overlay=true)\nvar tb = table.new(position.top_right, 1, 1)\ntable.cell(tb, 0, 0, "TREND")\nif barstate.islast\n    label.new(bar_index, high, "hi")';
    log('compatBad', scanCompat(dash));
    log('compatOk', scanCompat(v6));

    // 5) UI：检查按钮把提示写出来
    document.getElementById('pinePanel').hidden = false;
    await wait(400);
    document.getElementById('pineSrc').value = dash;
    document.getElementById('pineName').value = '仪表盘脚本';
    document.getElementById('pineCheck').click();
    await wait(3200);
    log('uiMsg', document.getElementById('pineMsg').textContent);
    document.getElementById('pinePanel').hidden = true;

    const msg = R.checks.uiMsg || '';
    R.pass = (
      r1.ok === true && R.checks.v6.pineVersion === 6 && R.checks.v6.names.length === 1
      && Object.values(featRes).every(x => x.ok)
      && featRes.pivot.names.length === 2
      && featRes.hline.names.includes('mid')
      && r3.ok && !r3.names.some(n => /^bgcolor/.test(n))
      && R.checks.compatBad.worst === 'bad'
      && R.checks.compatBad.hits.some(h => /table/.test(h.msg))
      && R.checks.compatOk.worst === 'ok'
      && msg.includes('v6') && msg.includes('table') && msg.includes('没有 plot')
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
