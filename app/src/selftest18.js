// M18 验收：指标设置（参数 / 每条线颜色 / 偏好记住）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const kv = async () => (await import('./db.js')).kvGet('ind:prefs');
  const inds = () => (state.app?.chart.getIndicators() || []).map(i => ({
    n: i.name, cp: i.calcParams || [], lines: (i.styles?.lines || []).map(l => ({ c: l.color, s: l.size }))
  }));

  const addInd = async (labelPrefix) => {
    if (document.getElementById('indicatorPanel').hidden) document.getElementById('btnIndicator').click();
    await wait(500);
    const s = document.getElementById('indSearch');       // 指标库按分类过滤，先搜再点
    s.value = labelPrefix; s.dispatchEvent(new Event('input'));
    await wait(500);
    const row = [...document.querySelectorAll('#indList .ind-item')]
      .find(x => (x.querySelector('.nm b')?.textContent || '').trim().startsWith(labelPrefix));
    const btn = row?.querySelector('[data-add]');
    if (btn) btn.click();
    await wait(1000);
    s.value = ''; s.dispatchEvent(new Event('input'));
    await wait(300);
    return !!btn;
  };

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    if (!state.app) throw new Error('应用未就绪（先导入数据）');
    const chart = state.app.chart;

    // 清干净：先清掉历史偏好，否则第一条断言拿到的是上次的 EMA(20)
    const { kvSet } = await import('./db.js');
    await kvSet('ind:prefs', {});
    state.indPrefs = {};
    for (const i of chart.getIndicators() || []) { try { chart.removeIndicator({ name: i.name }); } catch {} }
    await wait(300);

    // 1) 加 EMA → 默认 3 条线
    const added = await addInd('指数均线');
    const def = inds().find(x => x.n === 'EMA');

    // 2) 打开设置
    document.querySelector('#indActive button[data-cfg]').click();
    await wait(500);
    const opened = {
      visible: !document.getElementById('indSettingsPanel').hidden,
      params: document.getElementById('indSetParams').value,
      rows: document.querySelectorAll('#indSetLines .ind-set-line').length
    };

    // 3) 参数改成 20（只要一条线）+ 改颜色
    const pe = document.getElementById('indSetParams');
    pe.value = '20'; pe.dispatchEvent(new Event('input'));
    await wait(350);
    const rowsAfterParam = document.querySelectorAll('#indSetLines .ind-set-line').length;
    const colorInput = document.querySelector('#indSetLines input[type=color]');
    colorInput.value = '#ffcc66'; colorInput.dispatchEvent(new Event('input'));
    document.getElementById('indSetApply').click();
    await wait(1000);
    const applied = inds().find(x => x.n === 'EMA');
    const prefs = await kv();

    // 4) 移除再添加 → 应该带偏好回来
    document.querySelector('#indActive button[data-rm]').click();
    await wait(700);
    await addInd('指数均线');
    const readded = inds().find(x => x.n === 'EMA');

    // 收尾：恢复默认（不留测试偏好）
    const prefsNow = await kv();
    if (prefsNow) { delete prefsNow.EMA; }
    await kvSet('ind:prefs', prefsNow || {});
    state.indPrefs = prefsNow || {};
    try { chart.removeIndicator({ name: 'EMA' }); } catch {}

    log('add', { ok: added, def });
    log('open', opened);
    log('rowsAfterParam', rowsAfterParam);
    log('applied', applied);
    log('prefs', prefs);
    log('readded', readded);

    R.pass = (
      added && def && def.cp.join(',') === '20,50,200'
      && opened.visible && opened.params === '20, 50, 200' && opened.rows >= 3
      && rowsAfterParam === 1
      && applied && applied.cp.join(',') === '20' && applied.lines.length === 1
      && String(applied.lines[0].c).toLowerCase() === '#ffcc66'
      && prefs && prefs.EMA && prefs.EMA.calcParams.join(',') === '20'
      && readded && readded.cp.join(',') === '20'
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
