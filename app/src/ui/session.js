// 从 main.js 的「场次」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, MB, computeStats, download, fmtDay, fmtPrice, fmtTs, sessionToJson, state, store, tradesToCsv } = ctx;

/* ---------------- 场次 ---------------- */

async function ensureSession(symbol) {
  const id = await store.activeId();
  let ses = id ? await store.get(id) : null;
  if (!ses || ses.symbol !== symbol) ses = await store.create({ symbol });
  state.session = ses;
  state.sessions = await store.list();
  // 正在输入就别覆盖（平仓会自动 renderSession，否则用户刚写的备注被旧值冲掉）
  const nameEl = $('sessName'), noteEl = $('sessNote');
  if (document.activeElement !== nameEl) nameEl.value = ses.name;
  if (document.activeElement !== noteEl) noteEl.value = ses.note || '';
  await renderSession();
  return ses;
}

function renderStats(session) {
  const st = computeStats(session.trades);
  const cell = (v, label) => `<div class="s"><b>${v}</b><span>${label}</span></div>`;
  $('statBox').innerHTML = [
    cell(st.count, '笔数'),
    cell(st.winRate + '%', '胜率'),
    cell(st.netProfit.toFixed(2), '净盈亏'),
    cell(st.profitFactor === Infinity ? '∞' : st.profitFactor, '盈亏比'),
    cell(st.expectancy.toFixed(2), '期望/笔'),
    cell(st.maxDrawdown.toFixed(2), '最大回撤'),
    cell(st.wins + '/' + st.losses, '胜/负'),
    cell(st.maxConsecWins, '最多连赢'),
    cell(st.maxConsecLosses, '最多连输')
  ].join('');
  return st;
}

async function renderSession() {
  const ses = state.session;
  if (!ses) return;
  const st = renderStats(ses);
  $('sessInfo').textContent = `${ses.name} · ${ses.symbol} · 创建 ${fmtTs(ses.createdAt)}${ses.endedAt ? ` · 结束 ${fmtTs(ses.endedAt)}` : ' · 进行中'} · 收官权益 ${st.finalEquity.toFixed(2)}`;
  $('sessTrades').innerHTML = ses.trades.length
    ? ses.trades.slice().reverse().map((t, i) => `
      <div class="t"><span>${ses.trades.length - i}. ${t.side === 'long' ? '多' : '空'} ${t.qty} @ ${fmtPrice(t.entry, state.profile?.symbol)} → ${fmtPrice(t.exit, state.profile?.symbol)}
        <span class="muted">${t.why} · ${fmtTs(t.closeTs)}</span></span>
        <span class="${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span></div>`).join('')
    : '<div class="muted">还没有已平仓交易</div>';
  await renderShotList();
  await renderSessionList();
}

async function renderShotList() {
  const ses = state.session;
  if (!ses) return;
  const box = $('shotList');
  box.innerHTML = '';
  let bytes = 0;
  for (const s of (ses.shots || []).slice(-12).reverse()) {
    const url = await store.shotUrl(s.key);
    bytes += s.bytes || 0;
    if (!url) continue;
    const img = document.createElement('img');
    img.src = url;
    img.title = `${s.phase === 'open' ? '开仓' : '平仓'} ${fmtTs(s.ts)}`;
    img.onclick = () => window.open(url, '_blank');
    box.appendChild(img);
  }
  $('shotInfo').textContent = ses.shots?.length ? `${ses.shots.length} 张 · ${MB(bytes)} MB` : '（暂无）';
}

async function renderSessionList() {
  const list = await store.list();
  state.sessions = list;
  const ul = $('sessList');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = `<li class="empty-card"><b>还没有场次</b>
      <p>「新建场次」开始一轮练习；结束时点「结束并归档」，之后能在复盘档案里回看。</p></li>`;
  }
  for (const s of list.slice().reverse().slice(0, 20)) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${s.name}<div class="meta">${s.symbol} · ${s.count} 笔 · ${fmtDay(s.createdAt)}</div></span>`;
    const box = document.createElement('span');
    const open = document.createElement('button');
    open.textContent = state.session?.id === s.id ? '当前' : '查看';
    open.onclick = async () => {
      const full = await store.get(s.id);
      if (!full) return;
      state.session = full;
      await store.setActive(full.id);
      $('sessName').value = full.name;
      $('sessNote').value = full.note || '';
      await renderSession();
    };
    const del = document.createElement('button');
    del.className = 'ghost'; del.textContent = '删除';
    let armed = false, timer = null;
    del.onclick = async () => {
      if (!armed) {
        armed = true; del.textContent = '再点一次';
        timer = setTimeout(() => { armed = false; del.textContent = '删除'; }, 3000);
        return;
      }
      clearTimeout(timer);
      await store.remove(s.id);
      if (state.session?.id === s.id) { state.session = null; await ensureSession(state.profile.symbol); }
      await renderSession();
    };
    box.append(open, del);
    li.appendChild(box);
    ul.appendChild(li);
  }
}

function wireSession() {
  $('btnSession').onclick = async () => {
    $('sessionPanel').hidden = !$('sessionPanel').hidden;
    $('btnSession').classList.toggle('active', !$('sessionPanel').hidden);
    if (!$('sessionPanel').hidden) { await renderSession(); }
  };
  $('closeSession').onclick = () => { $('sessionPanel').hidden = true; $('btnSession').classList.remove('active'); };

  $('sessSaveName').onclick = async () => {
    if (!state.session) return;
    state.session.name = $('sessName').value.trim() || state.session.name;
    state.session.note = $('sessNote').value;
    await store.save(state.session);
    await renderSession();
  };
  $('sessNote').onblur = $('sessSaveName').onclick;

  $('sessNew').onclick = async () => {
    if (!state.profile) return;
    const name = ($('sessName').value || '').trim() || `场次 ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
    state.session = await store.create({ symbol: state.profile.symbol, name, period: state.app?.periodKey || null, startTs: state.replay?.cursor || null });
    state.prevPos = null;
    if (state.trade) { state.trade.trades = []; state.trade.realized = 0; state.trade.pos = null; state.trade.orders = []; state.trade.emit(); }
    $('sessName').value = state.session.name;
    $('sessNote').value = '';
    await renderSession();
  };

  $('sessEnd').onclick = async () => {
    if (!state.session) return;
    await store.end(state.session);
    await renderSession();
  };

  $('sessExportJson').onclick = () => {
    if (!state.session) return;
    const ses = state.session;
    download(`${ses.symbol}-${ses.id}.json`, sessionToJson(ses));
  };
  $('sessExportCsv').onclick = () => {
    if (!state.session) return;
    const ses = state.session;
    download(`${ses.symbol}-${ses.id}.csv`, '\ufeff' + tradesToCsv(ses.trades), 'text/csv');
  };
}


/** 按住/松开修饰键时，重算一次绘制预览（不用等鼠标再动一下） */
let _lastPointer = null;
function watchPointer() {
  document.addEventListener('mousemove', (e) => { _lastPointer = { x: e.clientX, y: e.clientY }; }, true);
}
function nudgeDrawingPreview() {
  const d = state.draw;
  if (!d || !d.pending || !_lastPointer) return;
  const cvs = [...document.querySelectorAll('#chart canvas')];
  const big = cvs.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  if (!big) return;
  try {
    big.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, view: window,
      clientX: _lastPointer.x, clientY: _lastPointer.y, buttons: 0, detail: 1
    }));
  } catch {}
}
function wireModifierNudge() {
  watchPointer();
  const keys = new Set(['Shift', 'Control']);
  window.addEventListener('keydown', (e) => { if (keys.has(e.key)) nudgeDrawingPreview(); }, true);
  window.addEventListener('keyup', (e) => { if (keys.has(e.key)) nudgeDrawingPreview(); }, true);
}


  return { ensureSession, renderStats, renderSession, renderShotList, wireSession, wireModifierNudge };
}
