// M32 验收：Tab 双击改名（行内编辑 + 持久化 + Esc 取消）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const kv = await import('./db.js');

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const tab = () => document.querySelector('#tabList .tab');
    const nameOf = () => document.querySelector('#tabList .tab .tab-name')?.textContent?.trim();
    const dbl = () => tab().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const orig = nameOf();
    log('orig', orig);

    // 1) 双击进入编辑
    dbl(); await wait(300);
    const inp = document.querySelector('.tab-in');
    log('editMode', !!inp);
    log('inputValue', inp?.value);

    // 2) 输入 + 回车保存
    inp.value = '日内复盘 A';
    key(inp, 'Enter'); await wait(500);
    log('afterEnter', nameOf());
    log('stored', ((await kv.kvGet('ui:tabs')) || []).map(t => t.name));

    // 3) Esc 取消
    dbl(); await wait(300);
    const inp2 = document.querySelector('.tab-in');
    inp2.value = '不应该保存';
    key(inp2, 'Escape'); await wait(400);
    log('afterEsc', nameOf());
    log('inputGone', !document.querySelector('.tab-in'));

    // 4) 空名不覆盖 + 改名不影响副标题
    dbl(); await wait(300);
    const inp3 = document.querySelector('.tab-in');
    inp3.value = '   ';
    key(inp3, 'Enter'); await wait(400);
    log('afterEmpty', nameOf());
    log('sub', document.querySelector('#tabList .tab .tab-sub')?.textContent?.trim());

    // 4.5) 三种入口：点已激活标签名 / F2 / 右键菜单
    const t0 = document.querySelector('#tabList .tab');
    t0.querySelector('.tab-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(250);
    const byClickName = !!document.querySelector('.tab-in');
    document.querySelector('.tab-in')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(250);

    document.querySelector('#tabList .tab')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    await wait(250);
    const byF2 = !!document.querySelector('.tab-in');
    document.querySelector('.tab-in')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(250);

    const tabNow = document.querySelector('#tabList .tab');
    const box = tabNow.getBoundingClientRect();
    tabNow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + 20, clientY: box.y + 8 }));
    await wait(300);
    const menu = document.getElementById('tabMenu');
    const menuItems = menu ? [...menu.querySelectorAll('.mi')].map(b => b.textContent.replace(/\s+/g, '')) : [];
    // 图表右键仍要能用（不能被 tab 的放行逻辑影响）
    const chartEl = document.getElementById('chart');
    const cb = chartEl.getBoundingClientRect();
    chartEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cb.x + cb.width / 2, clientY: cb.y + cb.height / 2 }));
    await wait(300);
    const chartMenu = !document.getElementById('ctxMenu').hidden;
    chartEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
    await wait(200);
    log('renameEntries', { byClickName, byF2, menuItems, chartMenu });

    // 5) 点击 tab 本身仍能激活，不会被输入框吞掉
    dbl(); await wait(250);
    const inp4 = document.querySelector('.tab-in');
    inp4.value = '日内复盘 B';
    inp4.blur(); await wait(400);
    log('afterBlur', nameOf());

    const stored = ((await kv.kvGet('ui:tabs')) || []).map(t => t.name);
    R.pass = (
      R.checks.editMode === true
      && R.checks.inputValue === orig
      && R.checks.afterEnter === '日内复盘 A'
      && stored[0] === '日内复盘 B'
      && R.checks.afterEsc === '日内复盘 A'
      && R.checks.inputGone === true
      && R.checks.afterEmpty === '日内复盘 A'
      && /XAUUSD/.test(R.checks.sub)
      && R.checks.afterBlur === '日内复盘 B'
      && R.checks.renameEntries.byClickName === true
      && R.checks.renameEntries.byF2 === true
      && R.checks.renameEntries.menuItems.length === 3
      && R.checks.renameEntries.chartMenu === true
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
