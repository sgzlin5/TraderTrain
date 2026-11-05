// 从 main.js 的「交易」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, CSV, SESS, captureChart, fmtPrice, fmtTs, logErr, renderSession, renderShotList, state, store, updateStatus } = ctx;

/* ---------------- 交易 ---------------- */

let _markSig = '';
function renderTradeMarks(s) {
  if (!state.app) return;
  const chart = state.app.chart;
  const pos = s.pos;
  const sig = pos ? `${pos.side}@${pos.entry}/${pos.sl}/${pos.tp}/${chart.getDataList().length}` : '-';
  if (sig === _markSig) return;
  _markSig = sig;
  for (const id of state.marks) { try { chart.removeOverlay({ id }); } catch {} }
  state.marks = [];
  if (!pos) return;
  const idx = Math.max(0, chart.getDataList().length - 1);
  const add = (name, value, color) => {
    try {
      const id = chart.createOverlay({
        name,
        points: [{ dataIndex: idx, value }],
        styles: { line: { color, size: 1, style: 'dashed' } }
      });
      if (id) state.marks.push(id);
    } catch {}
  };
  // 入场线 + 箭头标签（多/空 + 手数），SL/TP 用价格线保留右侧标签
  const bull = pos.side === 'long';
  add('horizontalStraightLine', pos.entry, bull ? '#5fe3c0' : '#ff6f85');
  if (pos.sl != null) add('priceLine', pos.sl, '#ff6f85');
  if (pos.tp != null) add('priceLine', pos.tp, '#5fe3c0');
  // 入场点的方向标记（v10 不支持 draw，这里用 overlay 注解代替箭头）
  try {
    const id = chart.createOverlay({
      name: 'simpleAnnotation',
      points: [{ dataIndex: idx, value: pos.entry }],
      extendData: `${bull ? '▲ 多' : '▼ 空'} ${pos.qty}`,
      styles: { text: { color: bull ? '#5fe3c0' : '#ff6f85', size: 11, family: 'ui-monospace, Menlo, Consolas, monospace', backgroundColor: 'rgba(6,12,20,.72)' } }
    });
    if (id) state.marks.push(id);
  } catch (e) { logErr('trade:标记', e); }
}

function renderTrade(snap) {
  const s = snap || (state.trade ? state.trade.snapshot() : null);
  if (!s) return;
  const pos = s.pos;
  const box = $('posBox');
  if (pos) {
    const fl = s.floating;
    box.className = 'box ' + (pos.side === 'long' ? 'long' : 'short');
    box.innerHTML = `${pos.side === 'long' ? '多' : '空'} ${pos.qty} oz @ ${fmtPrice(pos.entry, state.profile?.symbol)}
      <br>SL ${pos.sl ?? '-'} · TP ${pos.tp ?? '-'}
      <br>浮动 <b class="${(fl ?? 0) >= 0 ? 'pos' : 'neg'}">${fl == null ? '-' : fl.toFixed(2)}</b>`;
  } else {
    box.className = 'box';
    const pend = s.orders.filter(o => !o.done).length;
    box.textContent = pend ? `无持仓 · 挂单 ${pend} 笔` : '无持仓';
  }
  const wins = s.trades.filter(t => t.pnl > 0).length;
  $('tradeStats').textContent = s.trades.length
    ? `${s.trades.length} 笔 · 胜 ${wins} · 已实现 ${s.realized.toFixed(2)}`
    : '暂无成交';
  if (!s.trades.length) {
    $('tradeList').innerHTML = `<div class="empty-card">
      <b>还没有成交</b><p>点上面的「市价买/卖」或「限价挂单」下单，成交后会出现在这里。</p></div>`;
  } else
  $('tradeList').innerHTML = s.trades.slice().reverse().slice(0, 30).map(t => `
    <div class="t"><span>${t.side === 'long' ? '多' : '空'} ${t.qty} @ ${fmtPrice(t.entry, state.profile?.symbol)} → ${fmtPrice(t.exit, state.profile?.symbol)}
      <span class="muted">${t.why}</span></span>
      <span class="${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span></div>`).join('');
  $('stTrade').textContent = `持仓 ${pos ? `${pos.side} ${pos.qty}oz @ ${fmtPrice(pos.entry, state.profile?.symbol)}` : '无'} · 已实现 ${s.realized.toFixed(2)}`;
  renderTradeMarks(s);
}

/**
 * 源数据成交量：全 0 时在顶栏和状态栏标明，免得用户以为是脚本或图表坏了。
 * 只看前 300 根（够判断，不用扫 400 万根）。
 */
function detectVolume() {
  const bars = state.app?.chart?.getDataList?.() || [];
  const sample = bars.slice(0, 300);
  const hasVol = sample.some(b => Number(b.volume) > 0);
  state.hasVolume = hasVol;
  const tag = $('volTag');
  if (tag) {
    tag.hidden = hasVol;
    tag.textContent = hasVol ? '' : '无成交量';
    tag.title = hasVol ? '' : '当前数据源没有成交量（Dukascopy 的 CSV 一般不带），依赖 volume 的脚本只能部分显示';
  }
  return hasVol;
}

function updateAsOf() {
  const el = $('stAsOf');
  if (!el) return;
  const p = state.profile;
  // 有实时段时“数据截至”要跟着实时走（profile.last 只是导入时的历史截止）
  const liveLast = state.live?.lastTs || p?.live?.last || null;
  const last = liveLast && (!p?.last || liveLast > p.last) ? liveLast : p?.last;
  el.textContent = last ? `数据截至 ${fmtTs(last)}${liveLast ? ' · 含实时' : ''}` : '数据截至 -';
}

function lastPrice() {
  const b = state.app?.lastBar();
  return b ? b.close : null;
}

/** 交易状态变化 → 同步到场次（新平仓笔数 → 追加 + 截图） */
function onTradeChange(snap) {
  renderTrade(snap);
  const ses = state.session;
  if (ses) {
    const fresh = snap.trades.slice(ses.trades.length);
    if (fresh.length) {
      ses.trades.push(...fresh);
      store.save(ses).then(() => renderSession());
      captureShot(ses, 'close', fresh[fresh.length - 1]);
    }
    if (!state.prevPos && snap.pos) captureShot(ses, 'open', snap.pos);
    state.prevPos = snap.pos;
  }
}

async function captureShot(session, phase, info) {
  try {
    // 等两帧再截：面板开合会改 #chart 宽度 → canvas 重置后要等重绘（用 setTimeout，后台标签页 rAF 会被节流）
    await new Promise(r => setTimeout(r, 200));
    const blob = await captureChart($('chart'));
    if (!blob || blob.size < 3000) return;
    await store.addShot(session, blob, { phase, ts: state.replay?.cursor ?? null, side: info?.side ?? null });
    await store.save(session);
    await renderShotList();
  } catch (e) { console.warn('shot failed', e); }
}

function wireTrade() {
  $('btnTrade').onclick = () => {
    $('tradePanel').hidden = !$('tradePanel').hidden;
    $('btnTrade').classList.toggle('active', !$('tradePanel').hidden);
  };
  $('closeTrade').onclick = () => { $('tradePanel').hidden = true; $('btnTrade').classList.remove('active'); };
  $('qty').onchange = (e) => state.trade?.setQty(e.target.value);
  const num = (id) => { const el = $(id); const v = Number(el.value); return el.value !== '' && Number.isFinite(v) ? v : null; };

  $('buy').onclick = () => {
    if (!state.trade || !state.app) return;
    const p = lastPrice(); if (p == null) return;
    const r = state.trade.openMarket('long', p, state.app.lastBar(), { sl: num('sl'), tp: num('tp') });
    if (!r.ok) updateStatus(r.reason);
  };
  $('sell').onclick = () => {
    if (!state.trade || !state.app) return;
    const p = lastPrice(); if (p == null) return;
    const r = state.trade.openMarket('short', p, state.app.lastBar(), { sl: num('sl'), tp: num('tp') });
    if (!r.ok) updateStatus(r.reason);
  };
  $('flat').onclick = () => {
    if (!state.trade || !state.app) return;
    const p = lastPrice(); if (p == null) return;
    const rec = state.trade.closePos(p, state.app.lastBar(), 'manual');
    if (rec) updateStatus(`平仓 ${rec.side} pnl ${rec.pnl}`);
  };
  $('limitBuy').onclick = () => {
    const p = num('limitPrice'); if (p == null || !state.trade) return;
    state.trade.placeLimit('long', p, state.app.lastBar());
    updateStatus(`挂多 @ ${p}`);
  };
  $('limitSell').onclick = () => {
    const p = num('limitPrice'); if (p == null || !state.trade) return;
    state.trade.placeLimit('short', p, state.app.lastBar());
    updateStatus(`挂空 @ ${p}`);
  };
  $('cancelOrders').onclick = () => { state.trade?.cancelOrders(); updateStatus('已撤未成交挂单'); };
}


  return { renderTrade, detectVolume, updateAsOf, onTradeChange, wireTrade };
}
