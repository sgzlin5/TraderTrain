// M31 验收：截屏当前窗口 → 剪贴板（状态栏相机按钮）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const btn = document.getElementById('btnShot');
    log('button', { exists: !!btn, title: btn?.title || '', wired: typeof btn?.onclick === 'function' });

    const { captureWindowShot } = await import('./session.js');
    const chartEl = document.getElementById('chart');
    const rect = chartEl.getBoundingClientRect();
    const blob = await captureWindowShot(chartEl, {
      title: 'TraderTrain',
      symbol: state.profile?.symbol,
      period: (state.app?.periodKey || '1m').toUpperCase(),
      range: '2026-06-26 21:00 → 2026-06-27 05:58',
      status: '周期 1m · 已加载 1200 根',
      stamp: '游标 2026-06-27 05:58'
    });
    const bmp = blob ? await createImageBitmap(blob) : null;
    const dpr = window.devicePixelRatio || 1;
    log('shot', blob ? {
      type: blob.type, size: blob.size, w: bmp.width, h: bmp.height,
      chartW: Math.round(rect.width * dpr), chartH: Math.round(rect.height * dpr),
      extraH: bmp.height - Math.round(rect.height * dpr)
    } : null);

    // 点按钮 → 状态栏必须给出结果文案
    document.getElementById('stMsg').textContent = '';
    btn.click();
    await wait(2600);
    log('status', document.getElementById('stMsg').textContent);

    R.pass = (
      R.checks.button.exists === true
      && /截屏当前窗口/.test(R.checks.button.title)
      && R.checks.button.wired === true
      && blob && blob.type === 'image/png' && blob.size > 5000
      && bmp.width === Math.round(rect.width * dpr)
      && R.checks.shot.extraH > 40                 // 顶部信息条 + 底部状态条
      && /剪贴板|已下载/.test(R.checks.status)
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
