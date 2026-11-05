// M13 验收：复盘档案页（列表 / 筛选 / 排序 / 搜索 / 打开还原 / 元信息 / 删除）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const mkTrade = (i, pnl) => ({
    side: pnl > 0 ? 'long' : 'short', qty: 10, entry: 4000 + i, exit: 4000 + i + pnl / 10,
    pnl, why: 'manual', openTs: Date.now() - 3600_000, closeTs: Date.now() - 1800_000
  });

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const { store } = state;
    const list0 = (await store.list()).length;

    // 建三份测试档案
    const tag = Date.now().toString(36).slice(-4);
    const N = { a: `测A-${tag}`, b: `测B-${tag}`, c: `测C-${tag}` };
    const seeds = [
      { name: N.a, pnl: 30, tags: ['假突破'], rating: 5, start: app.profile.last - 3 * 86400000 },
      { name: N.b, pnl: -12, tags: ['追单', '急'], rating: 2, start: app.profile.last - 5 * 86400000 },
      { name: N.c, pnl: 6, tags: [], rating: 3, start: app.profile.last - 8 * 86400000 }
    ];
    const made = [];
    for (const s of seeds) {
      const ses = await store.create({ symbol: app.profile.symbol, name: s.name, period: '1m', startTs: s.start });
      ses.trades = [mkTrade(1, s.pnl), mkTrade(2, s.pnl > 0 ? s.pnl / 2 : s.pnl / 3)];
      ses.tags = s.tags; ses.rating = s.rating; ses.conclusion = `${s.name} 的结论`;
      await store.save(ses);
      made.push(ses.id);
    }
    const listAfterCreate = (await store.list()).length;

    // 打开面板
    document.getElementById('btnArchive').click();
    await wait(700);
    const panelOpen = !document.getElementById('archivePanel').hidden;
    const rowCount = document.querySelectorAll('#arList .ar-row').length;

    const setSel = async (id, val) => {
      const el = document.getElementById(id);
      el.value = val;
      el.dispatchEvent(new Event('change'));
      await wait(320);
    };
    const setSearch = async (txt) => {
      const el = document.getElementById('arSearch');
      el.value = txt;
      el.dispatchEvent(new Event('input'));
      await wait(320);
    };

    // 搜索
    await setSearch(tag);
    const searchCount = document.querySelectorAll('#arList .ar-row').length;
    const searchNames = [...document.querySelectorAll('#arList .ar-name')].map(n => n.firstChild.textContent.trim()).sort();

    // 排序：净盈亏降序 → 第一行应是 A（+45）
    await setSel('arSort', 'pnl-desc');
    const firstByPnl = document.querySelector('#arList .ar-row .ar-name').firstChild.textContent.trim();
    await setSel('arSort', 'pnl-asc');
    const firstByPnlAsc = document.querySelector('#arList .ar-row .ar-name').firstChild.textContent.trim();

    // 状态筛选（三份都是进行中）
    await setSel('arState', 'closed');
    const closedCount = document.querySelectorAll('#arList .ar-row').length;
    await setSel('arState', 'open');
    const openCount = document.querySelectorAll('#arList .ar-row').length;

    // 打开一份：还原周期 + 起点
    const targetStart = seeds[0].start;
    const rowA = [...document.querySelectorAll('#arList .ar-row')].find(r => r.querySelector('.ar-name').firstChild.textContent.trim() === N.a);
    rowA.querySelector('[data-open]').click();
    await wait(1400);
    const opened = {
      sessionId: state.session?.id === made[0],
      name: state.session?.name,
      period: document.getElementById('periods').querySelector('.active')?.dataset.key || app.periodKey,
      cursorNearStart: Math.abs((state.replay?.cursor || 0) - targetStart) < 86400000,
      panelClosed: document.getElementById('archivePanel').hidden,
      trades: state.session?.trades?.length || 0
    };

    // 元信息：标签 / 评分 / 结论
    document.getElementById('btnArchive').click();
    await wait(600);
    const rowB = [...document.querySelectorAll('#arList .ar-row')].find(r => r.querySelector('.ar-name').firstChild.textContent.trim() === N.b);
    rowB.querySelector('.ar-line').click();
    await wait(600);
    const det = rowB.querySelector('.ar-detail');
    det.querySelector('#arTags').value = '标签改过, 第二';
    det.querySelector('[data-star="4"]').click();
    det.querySelector('#arConclusion').value = '改过的结论';
    det.querySelector('#arSaveMeta').click();
    await wait(900);
    const briefB = (await store.list()).find(b => b.id === made[1]);
    const fullB = await store.get(made[1]);
    const meta = { tags: briefB?.tags, rating: briefB?.rating, conclusion: fullB?.conclusion };

    // 删除
    const rowC = [...document.querySelectorAll('#arList .ar-row')].find(r => r.querySelector('.ar-name').firstChild.textContent.trim() === N.c);
    const delBtn = rowC.querySelector('[data-del]');
    delBtn.click();
    await wait(200);
    delBtn.click();
    await wait(900);
    const listAfterDel = (await store.list()).length;

    // 收尾：清掉剩下的测试档案
    for (const id of made) { try { await store.remove(id); } catch {} }
    await renderArchiveSafe();
    const listFinal = (await store.list()).length;

    log('archive', {
      list0, listAfterCreate, panelOpen, rowCount, searchCount, searchNames,
      firstByPnl, firstByPnlAsc, closedCount, openCount, opened, meta, listAfterDel, listFinal
    });

    R.pass = (
      panelOpen && listAfterCreate === list0 + 3 && rowCount >= 3
      && searchCount === 3 && searchNames.join(',') === [N.a, N.b, N.c].sort().join(',')
      && firstByPnl === N.a && firstByPnlAsc === N.b
      && closedCount === 0 && openCount >= 3
      && opened.sessionId && opened.period === '1m' && opened.cursorNearStart
      && opened.panelClosed && opened.trades === 2
      && meta.tags.join(',') === '标签改过,第二' && meta.rating === 4 && meta.conclusion === '改过的结论'
      && listAfterDel === listAfterCreate - 1
      && listFinal === list0
    );
  } catch (err) {
    R.errors.push(String(err && (err.stack || err.message) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}

async function renderArchiveSafe() {
  const btn = document.getElementById('btnArchive');
  try { if (document.getElementById('archivePanel').hidden) btn.click(); } catch {}
}
