// M12 验收：保存配置到本地（存档 + 未保存红点 + 启动恢复）
import { loadConfigSnapshot } from './config.js';

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const btn = document.getElementById('btnSave');
    const dot = () => btn.classList.contains('dirty');
    const themeOf = () => document.documentElement.dataset.theme;

    // 1) 初始：保存按钮存在、无红点
    const initial = { exists: !!btn, dirty: dot() };

    // 2) 改主题 → 出红点
    const pick = async (key) => {
      document.getElementById('btnTheme').click();
      await wait(260);
      const row = document.querySelector(`#themeRows .theme-row[data-theme="${key}"]`);
      if (row) row.click();
      await wait(420);
    };
    await pick('sky');
    const afterChange = { theme: themeOf(), dirty: dot() };

    // 3) 点保存 → 红点消失 + 存档写入
    btn.click();
    await wait(700);
    const snap1 = await loadConfigSnapshot();
    const afterSave = {
      dirty: dot(),
      savedClass: btn.classList.contains('saved'),
      snap: snap1 && {
        theme: snap1.theme, period: snap1.period, symbol: snap1.symbol,
        hasLayout: !!snap1.layout, hasStyles: !!snap1.drawStyles,
        hasTemplates: !!snap1.drawTemplates, hasTools: !!snap1.tools,
        savedAt: typeof snap1.savedAt === 'number'
      }
    };

    // 4) 再改成 amber 但不保存 → 红点回来；存档仍是 sky
    await pick('amber');
    const afterSecond = { theme: themeOf(), dirty: dot(), snapTheme: (await loadConfigSnapshot())?.theme };

    // 5) Ctrl+S 也能存
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await wait(700);
    const snap2 = await loadConfigSnapshot();
    const afterCtrlS = { dirty: dot(), snapTheme: snap2?.theme };

    // 收尾：存回原主题，避免影响后续自检
    const restore = themeOf();
    await pick('dark');
    btn.click();
    await wait(600);

    log('save', { initial, afterChange, afterSave, afterSecond, afterCtrlS, restoreFrom: restore });

    R.pass = (
      initial.exists && initial.dirty === false
      && afterChange.theme === 'sky' && afterChange.dirty === true
      && afterSave.dirty === false && afterSave.savedClass === true
      && !!afterSave.snap && afterSave.snap.theme === 'sky' && afterSave.snap.savedAt === true
      && afterSave.snap.hasLayout && afterSave.snap.hasStyles && afterSave.snap.hasTools
      && afterSecond.dirty === true && afterSecond.snapTheme === 'sky'
      && afterCtrlS.dirty === false && afterCtrlS.snapTheme === 'amber'
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
