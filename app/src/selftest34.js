// M34 验收：P1 三项（类型刻度 token / 数字 sans+tabular / 涨跌箭头 + 色盲主题）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);

    // 1) 类型刻度
    const px = (n) => parseFloat(cssVar(n));
    log('tokens', {
      xs: cssVar('--fs-2xs'), sm: cssVar('--fs-md'), xl: cssVar('--fs-xl'), x2: cssVar('--fs-2xl'),
      bodyFont: getComputedStyle(document.body).fontSize,
      // 刻度必须单调递增，且正文 = --fs-md
      monotonic: px('--fs-2xs') < px('--fs-xs') && px('--fs-xs') < px('--fs-sm')
        && px('--fs-sm') < px('--fs-md') && px('--fs-md') < px('--fs-lg')
        && px('--fs-lg') < px('--fs-xl') && px('--fs-xl') < px('--fs-2xl'),
      bodyMatchesMd: getComputedStyle(document.body).fontSize === cssVar('--fs-md')
    });

    // 2) 数字读数 = sans + tabular-nums
    const numSel = ['#status', '.stats .s b'];
    const num = numSel.map(sel => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const cs = getComputedStyle(el);
      return { sel, family: cs.fontFamily, numeric: cs.fontVariantNumeric };
    });
    log('numeric', num);

    // 3) 涨跌箭头（CSS ::before，不依赖颜色）
    const probe = document.createElement('div');
    probe.innerHTML = '<span class="pos">1</span><span class="neg">1</span>';
    document.body.appendChild(probe);
    const arrowPos = getComputedStyle(probe.querySelector('.pos'), '::before').content;
    const arrowNeg = getComputedStyle(probe.querySelector('.neg'), '::before').content;
    probe.remove();
    log('arrows', { pos: arrowPos, neg: arrowNeg });

    // 4) 色盲友好主题
    const rows = [];
    document.getElementById('btnTheme').click(); await wait(500);
    document.querySelectorAll('#themeRows .theme-row').forEach(r => rows.push(r.textContent.trim().slice(0, 6)));
    const cbBtn = [...document.querySelectorAll('#themeRows .theme-row')].find(r => /色盲/.test(r.textContent));
    log('themeMenu', { rows: rows.length, hasCb: !!cbBtn });
    if (cbBtn) { cbBtn.click(); await wait(1200); }
    log('cb', {
      theme: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.mode,
      up: cssVar('--up'), down: cssVar('--down'),
      stored: await (await import('./db.js')).kvGet('ui:theme')
    });

    // 还原成墨蓝
    document.getElementById('btnTheme').click(); await wait(400);
    const dk = [...document.querySelectorAll('#themeRows .theme-row')].find(r => /墨蓝/.test(r.textContent));
    if (dk) { dk.click(); await wait(900); }
    log('restored', document.documentElement.dataset.theme);

    R.pass = (
      R.checks.tokens.monotonic === true && R.checks.tokens.bodyMatchesMd === true
      && px('--fs-md') >= 13 && px('--fs-2xl') >= 22
      && /tabular-nums/.test(R.checks.numeric[0].numeric || '')
      && /Avenir|PingFang|system-ui|sans/.test(R.checks.numeric[0].family || '')
      && /▲/.test(R.checks.arrows.pos) && /▼/.test(R.checks.arrows.neg)
      && R.checks.themeMenu.hasCb === true && R.checks.themeMenu.rows >= 5
      && R.checks.cb.theme === 'cb' && R.checks.cb.mode === 'dark'
      && R.checks.cb.up.toLowerCase() === '#4fa3ff' && R.checks.cb.down.toLowerCase() === '#ffa14a'
      && R.checks.cb.stored === 'cb'
      && R.checks.restored === 'dark'
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
