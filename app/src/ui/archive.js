// 从 main.js 的「复盘档案」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, SESS, TRADE, download, exportSessionReport, fmtDay, fmtLocalInput, fmtPrice, fmtTs, renderPeriods, renderSession, renderStats, renderTrade, sessionToJson, state, store, updateStatus } = ctx;

/* ---------------- 复盘档案 ---------------- */

const AR_SORT = {
  'time-desc': (a, b) => b.createdAt - a.createdAt,
  'time-asc': (a, b) => a.createdAt - b.createdAt,
  'pnl-desc': (a, b) => (b.netProfit || 0) - (a.netProfit || 0),
  'pnl-asc': (a, b) => (a.netProfit || 0) - (b.netProfit || 0),
  'count-desc': (a, b) => (b.count || 0) - (a.count || 0),
  'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0)
};

function arQuery() {
  if (!state.arq) state.arq = { symbol: 'all', st: 'all', sort: 'time-desc', q: '' };
  return state.arq;
}

const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, n || 0))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n || 0)));
const pnlCls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');

async function renderArchive() {
  const q = arQuery();
  const all = await store.list();
  state.sessions = all;

  const syms = [...new Set(all.map(a => a.symbol).filter(Boolean))];
  const sel = $('arSymbol');
  const sig = syms.join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = `<option value="all">全部品种</option>` + syms.map(s => `<option value="${s}">${s}</option>`).join('');
    sel.value = q.symbol;
  }

  let rows = all.filter(a => {
    if (q.symbol !== 'all' && a.symbol !== q.symbol) return false;
    if (q.st === 'open' && a.endedAt) return false;
    if (q.st === 'closed' && !a.endedAt) return false;
    if (q.q) {
      const hay = `${a.name} ${(a.tags || []).join(' ')} ${a.conclusion || ''} ${a.note || ''}`.toLowerCase();
      if (!hay.includes(q.q)) return false;
    }
    return true;
  }).sort(AR_SORT[q.sort] || AR_SORT['time-desc']);

  const netAll = rows.reduce((s, a) => s + (a.netProfit || 0), 0);
  const nTrades = rows.reduce((s, a) => s + (a.count || 0), 0);
  $('arSummary').textContent = `${rows.length} 份档案 · ${nTrades} 笔 · 净盈亏合计 ${netAll >= 0 ? '+' : ''}${netAll.toFixed(2)}`;

  const box = $('arList');
  if (!rows.length) {
    box.innerHTML = '<div class="ar-empty">还没有档案。在场次面板里「新建场次」做一轮，结束后就会出现在这里。</div>';
    return;
  }

  box.innerHTML = rows.map(a => `
    <div class="ar-row" data-id="${a.id}">
      <div class="ar-line">
        <span class="ar-name">${a.name}${(a.tags || []).length ? `<em>${a.tags.map(t => `#${t}`).join(' ')}</em>` : ''}</span>
        <span class="ar-meta">${a.symbol || '-'} · ${a.period || '-'} · ${fmtDay(a.createdAt)}${a.endedAt ? '' : ' · 进行中'}</span>
        <span class="ar-count">${a.count || 0} 笔</span>
        <span class="ar-pnl ${pnlCls(a.netProfit)}">${a.netProfit > 0 ? '+' : ''}${(a.netProfit || 0).toFixed(2)}</span>
        <span class="ar-rate" title="评分">${stars(a.rating)}</span>
        <span class="ar-act">
          <button class="btn ghost" data-open>打开</button>
          <button class="btn ghost" data-exp>导出</button>
          <button class="btn ghost" data-pdf>报告</button>
          <button class="btn ghost" data-del>删除</button>
        </span>
      </div>
      <div class="ar-detail" hidden></div>
    </div>`).join('');

  box.querySelectorAll('.ar-row').forEach(row => {
    const id = row.dataset.id;
    const brief = rows.find(a => a.id === id);
    const detail = row.querySelector('.ar-detail');

    row.querySelector('.ar-line').onclick = async (e) => {
      if (e.target.closest('button')) return;
      if (!detail.hidden) { detail.hidden = true; return; }
      const full = await store.get(id);
      if (!full) return;
      detail.innerHTML = await detailHtml(full);
      detail.hidden = false;
      wireDetail(detail, full);
    };

    row.querySelector('[data-open]').onclick = async () => { await openArchive(brief); };
    row.querySelector('[data-exp]').onclick = async () => {
      const full = await store.get(id);
      if (!full) return;
      download(`${full.symbol}-${full.id}.json`, sessionToJson(full));
    };
    row.querySelector('[data-pdf]').onclick = async (e) => {
      e.stopPropagation();
      const full = await store.get(id);
      if (full) await exportSessionReport(full);
    };
    const del = row.querySelector('[data-del]');
    let armed = false, timer = null;
    del.onclick = async () => {
      if (!armed) {
        armed = true; del.textContent = '再点一次';
        timer = setTimeout(() => { armed = false; del.textContent = '删除'; }, 3000);
        return;
      }
      clearTimeout(timer);
      await store.remove(id);
      if (state.session?.id === id) state.session = null;
      await renderArchive();
      updateStatus('档案已删除');
    };
  });
}

async function detailHtml(full) {
  const st = renderStats(full);
  const rows = (full.trades || []).slice(-6).reverse().map((t, i) => `
    <div class="t"><span>${t.side === 'long' ? '多' : '空'} ${t.qty} @ ${fmtPrice(t.entry, state.profile?.symbol)} → ${fmtPrice(t.exit, state.profile?.symbol)}
      <span class="muted">${t.why} · ${fmtTs(t.closeTs)}</span></span>
      <span class="${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span></div>`).join('');
  return `
    <div class="ar-stats">
      <span><b class="${pnlCls(st.netProfit)}">${st.netProfit >= 0 ? '+' : ''}${st.netProfit}</b><i>净盈亏</i></span>
      <span><b>${st.winRate}%</b><i>胜率</i></span>
      <span><b>${Number.isFinite(st.profitFactor) ? st.profitFactor : '∞'}</b><i>盈亏比</i></span>
      <span><b>${st.expectancy}</b><i>期望</i></span>
      <span><b>${st.maxDrawdown}</b><i>最大回撤</i></span>
      <span><b>${st.finalEquity}</b><i>收官权益</i></span>
    </div>
    ${rows ? `<div class="ar-trades">${rows}</div>` : '<div class="muted">没有已平仓交易</div>'}
    <div class="ar-edit">
      <div class="row">
        <input id="arTags" class="grow" value="${(full.tags || []).join(', ')}" placeholder="标签，逗号分隔（如：假突破, 追单）">
        <span class="ar-stars" id="arStars">${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" class="${(full.rating || 0) >= n ? 'on' : ''}">★</button>`).join('')}</span>
      </div>
      <textarea id="arConclusion" rows="2" placeholder="结论：这轮做对了什么 / 下次改什么">${full.conclusion || ''}</textarea>
      <div class="row"><span class="spacer"></span><button class="btn" id="arSaveMeta">保存到档案</button></div>
    </div>`;
}

function wireDetail(detail, full) {
  let rating = full.rating || 0;
  detail.querySelectorAll('[data-star]').forEach(b => {
    b.onclick = () => {
      rating = Number(b.dataset.star);
      detail.querySelectorAll('[data-star]').forEach(x => x.classList.toggle('on', Number(x.dataset.star) <= rating));
    };
  });
  detail.querySelector('#arSaveMeta').onclick = async () => {
    const tags = detail.querySelector('#arTags').value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 12);
    const conclusion = detail.querySelector('#arConclusion').value.trim();
    await store.updateMeta(full.id, { tags, rating, conclusion });
    await renderArchive();
    if (state.session?.id === full.id) { state.session.tags = tags; state.session.rating = rating; state.session.conclusion = conclusion; }
    updateStatus('档案已更新');
  };
}

/** 打开档案：还原周期 + 起点 + 该场次交易 */
async function openArchive(brief) {
  const full = await store.get(brief.id);
  if (!full) { updateStatus('档案读不出来'); return false; }
  const symWarn = full.symbol && state.profile?.symbol && full.symbol !== state.profile.symbol;
  if (full.period && state.app && full.period !== state.app.periodKey) {
    await state.app.switchPeriod(full.period);
    if (state.replay) state.replay.bucket = null;
    if (state.draw) { state.draw.periodKey = full.period; await state.draw.load(); }
    renderPeriods();
  }
  state.session = full;
  await store.setActive(full.id);
  $('sessName').value = full.name;
  $('sessNote').value = full.note || '';
  if (state.trade) {
    state.trade.trades = [...(full.trades || [])];
    state.trade.realized = state.trade.trades.reduce((s, t) => s + t.pnl, 0);
    state.trade.pos = null; state.trade.orders = [];
    state.trade.emit?.();
    renderTrade(state.trade.snapshot());
  }
  if (full.startTs && state.replay) {
    $('startAt').value = fmtLocalInput(full.startTs);
    await state.replay.setStart(full.startTs);
    if (state.draw) await state.draw.load();
  }
  await renderSession();
  closeArchive();
  updateStatus(symWarn ? `已打开 ${full.name}（品种 ${full.symbol} 与当前不同，只还原周期与起点）` : `已打开档案 ${full.name}`);
  return true;
}

function closeArchive() {
  $('archivePanel').hidden = true;
  $('btnArchive').classList.remove('on');
}

function wireArchive() {
  $('btnArchive').onclick = async () => {
    const el = $('archivePanel');
    if (!el.hidden) { closeArchive(); return; }
    el.hidden = false;
    $('btnArchive').classList.add('on');
    await renderArchive();
  };
  $('closeArchive').onclick = closeArchive;
  $('arSymbol').onchange = (e) => { arQuery().symbol = e.target.value; renderArchive(); };
  $('arState').onchange = (e) => { arQuery().st = e.target.value; renderArchive(); };
  $('arSort').onchange = (e) => { arQuery().sort = e.target.value; renderArchive(); };
  $('arSearch').oninput = (e) => { arQuery().q = e.target.value.trim().toLowerCase(); renderArchive(); };
  $('arExportAll').onclick = async () => {
    const all = await store.list();
    const full = [];
    for (const b of all) { const s = await store.get(b.id); if (s) full.push(s); }
    download(`archives-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: Date.now(), sessions: full }, null, 2));
    updateStatus(`已导出 ${full.length} 份档案`);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('archivePanel').hidden) closeArchive();
  });
}


  return { closeArchive, wireArchive };
}
