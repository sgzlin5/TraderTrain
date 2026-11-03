// M33 验收：面板关闭链路（✕ / Esc / 再次点按钮），含 Tab 改名后 ✕ 仍可关
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const esc = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  };
  const hidden = (id) => document.getElementById(id).hidden;

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);

    // 1) 指标库：✕
    document.getElementById('btnIndicator').click(); await wait(700);
    const opened1 = !hidden('indicatorPanel');
    document.getElementById('closeIndicator').click(); await wait(500);
    log('indicatorByX', { opened: opened1, closed: hidden('indicatorPanel') });

    // 2) 指标库：再点按钮
    document.getElementById('btnIndicator').click(); await wait(600);
    document.getElementById('btnIndicator').click(); await wait(500);
    log('indicatorByToggle', hidden('indicatorPanel'));

    // 3) 指标库：Esc
    document.getElementById('btnIndicator').click(); await wait(700);
    esc(); await wait(500);
    log('indicatorByEsc', hidden('indicatorPanel'));

    // 4) Pine 编辑器：Esc
    document.getElementById('btnIndicator').click(); await wait(600);
    document.querySelector('#indCats [data-cat="pine"]').click(); await wait(800);
    document.getElementById('indNewPine').click(); await wait(900);
    const pineOpened = !hidden('pinePanel');
    esc(); await wait(500);
    log('pineByEsc', { opened: pineOpened, closed: hidden('pinePanel') });

    // 5) 设置抽屉：Esc
    document.getElementById('indSettingsPanel').hidden = false; await wait(250);
    esc(); await wait(400);
    log('indSetByEsc', hidden('indSettingsPanel'));

    // 6) Tab 改名中直接点 ✕（blur 重渲染不得吞掉关闭）
    const before = document.querySelectorAll('#tabList .tab').length;
    if (before < 2) { document.getElementById('tabNew').click(); await wait(2200); }
    const tabs = [...document.querySelectorAll('#tabList .tab')];
    const last = tabs[tabs.length - 1];
    last.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(350);
    const editing = !!document.querySelector('.tab-in');
    const x = last.querySelector('[data-close]');
    x.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(1800);
    log('tabCloseDuringRename', {
      editing,
      before: document.querySelectorAll('#tabList .tab').length + 1,
      after: document.querySelectorAll('#tabList .tab').length
    });

    // 7) 布局浮层：✕ / 点图表 / 再点按钮 / Esc
    const lmHidden = () => document.getElementById('layoutMenu').hidden;
    document.getElementById('btnLayout').click(); await wait(600);
    const lmOpen = !lmHidden();
    document.getElementById('closeLayout').click(); await wait(400);
    const lmByX = lmHidden();
    document.getElementById('btnLayout').click(); await wait(500);
    document.getElementById('chart').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(400);
    const lmByOutside = lmHidden();
    document.getElementById('btnLayout').click(); await wait(400);
    document.getElementById('btnLayout').click(); await wait(400);
    const lmByToggle = lmHidden();
    document.getElementById('btnLayout').click(); await wait(400);
    esc(); await wait(400);
    const lmByEsc = lmHidden();
    log('layoutMenu', { opened: lmOpen, byX: lmByX, byOutside: lmByOutside, byToggle: lmByToggle, byEsc: lmByEsc });

    R.pass = (
      R.checks.layoutMenu.opened === true && R.checks.layoutMenu.byX === true
      && R.checks.layoutMenu.byOutside === true && R.checks.layoutMenu.byToggle === true
      && R.checks.layoutMenu.byEsc === true
      && R.checks.indicatorByX.opened === true && R.checks.indicatorByX.closed === true
      && R.checks.indicatorByToggle === true
      && R.checks.indicatorByEsc === true
      && R.checks.pineByEsc.opened === true && R.checks.pineByEsc.closed === true
      && R.checks.indSetByEsc === true
      && R.checks.tabCloseDuringRename.editing === true
      && R.checks.tabCloseDuringRename.after === R.checks.tabCloseDuringRename.before - 1
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
