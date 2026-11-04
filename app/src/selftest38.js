// M38 验收：ZLEMA 零延迟均线（进内置指标库「通用」分类）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 独立参考实现（换一种写法：先算整条 src 序列，再按 EMA 递推），避免照抄被测代码
  function refZlema(bars, period) {
    const lag = Math.floor((period - 1) / 2);
    const src = bars.map((b, i) => (i >= lag ? 2 * b.close - bars[i - lag].close : b.close));
    const k = 2 / (period + 1);
    const out = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i < period - 1) { sum += src[i]; continue; }
      if (i === period - 1) { out[i] = (sum + src[i]) / period; continue; }
      out[i] = out[i - 1] * (1 - k) + src[i] * k;
    }
    return out;
  }

  try {
    for (let i = 0; i < 100 && !window.__UI_READY__; i++) await wait(100);
    const K = window.klinecharts;
    const chart = state.app?.chart;
    const bars = chart.getDataList();

    // 1) 是否注册进内核
    log('registered', (K.getSupportedIndicators?.() || []).includes('ZLEMA'));

    // 2) 指标库条目与分类
    const { builtinList, toggleBuiltin } = await import('./indicators.js');
    const item = builtinList().find(x => x.name === 'ZLEMA');
    log('library', item
      ? { cat: item.cat, overlay: item.overlay, label: item.label, rate: item.rate }
      : null);

    // 3) 走真实入口（toggleBuiltin → OVERLAY_INDS 命中 → 挂主图）
    toggleBuiltin(chart, 'ZLEMA', item?.overlay !== false, null);
    await wait(700);
    let ind = (chart.getIndicators() || []).find(i => i.name === 'ZLEMA');
    log('added', ind
      ? { paneId: ind.paneId, params: ind.calcParams, resultLen: ind.result?.length ?? null, bars: bars.length }
      : null);

    // 4) 数值 vs 参考实现（默认 20）
    const ref = refZlema(bars, 20);
    const got = (ind?.result || []).map(r => r.z1);
    let maxDiff = 0, compared = 0, mismatched = false;
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] == null) continue;
      const a = got[i];
      if (typeof a !== 'number') { mismatched = true; break; }
      maxDiff = Math.max(maxDiff, Math.abs(a - ref[i]));
      compared++;
    }
    log('values20', {
      compared, mismatched, maxDiff,
      tail: got[got.length - 1] ?? null, refTail: ref[ref.length - 1] ?? null
    });

    // 5) 退化检查：period=1 → lag=0、k=1，应逐点等于收盘价
    chart.overrideIndicator({ name: 'ZLEMA', paneId: ind.paneId, calcParams: [1] });
    await wait(800);
    ind = (chart.getIndicators() || []).find(i => i.name === 'ZLEMA');
    let d1 = 0;
    (ind?.result || []).forEach((r, i) => {
      const v = r?.z1; const b = bars[i];
      if (typeof v === 'number' && b) d1 = Math.max(d1, Math.abs(v - b.close));
    });
    log('degenerate', { params: ind?.calcParams, maxDiffVsClose: d1 });

    // 6) 三条线 9/20/50
    chart.overrideIndicator({ name: 'ZLEMA', paneId: ind.paneId, calcParams: [9, 20, 50] });
    await wait(800);
    ind = (chart.getIndicators() || []).find(i => i.name === 'ZLEMA');
    const last = (ind?.result || [])[ind.result.length - 1] || {};
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    log('three', {
      params: ind?.calcParams,
      z1: last.z1 ?? null, z2: last.z2 ?? null, z3: last.z3 ?? null,
      allFinite: finite(last.z1) && finite(last.z2) && finite(last.z3)
    });

    // 7) 指标库面板「通用」分类里能找到、且显示已添加
    document.getElementById('btnIndicator').click();
    await wait(500);
    // ZLEMA 现在归到「均线」分类（和 EMA/RMA 一起），优先点它，老版本回退 general
    const catBtn = document.querySelector('#indCats .ind-cat[data-cat="ma"]')
      || document.querySelector('#indCats .ind-cat[data-cat="general"]');
    if (catBtn) { catBtn.click(); await wait(300); }
    const rows = [...document.querySelectorAll('#indList .ind-item')];
    const row = rows.find(r => r.querySelector('[data-add="ZLEMA"]'));
    log('panel', {
      cat: document.querySelector('#indCats .ind-cat.on')?.dataset.cat ?? null,
      rows: rows.length,
      found: !!row,
      label: row?.querySelector('.nm b')?.textContent ?? null,
      added: row?.querySelector('[data-add]')?.textContent?.trim() ?? null
    });
    document.getElementById('indicatorPanel').hidden = true;

    // 8) 移除
    chart.removeIndicator({ name: 'ZLEMA' });
    await wait(500);
    log('stillThere', (chart.getIndicators() || []).some(i => i.name === 'ZLEMA'));

    R.pass = (
      R.checks.registered === true
      && R.checks.library && (R.checks.library.cat === 'ma' || R.checks.library.cat === 'general') && R.checks.library.overlay === true
      && R.checks.added && R.checks.added.paneId === 'candle_pane'
      && R.checks.added.resultLen === R.checks.added.bars
      && R.checks.values20.mismatched === false && R.checks.values20.maxDiff < 1e-6
      && R.checks.values20.compared > 100
      && R.checks.degenerate.maxDiffVsClose < 1e-9
      && R.checks.three.allFinite === true
      && R.checks.panel.found === true && R.checks.panel.added === '已添加'
      && R.checks.stillThere === false
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
