// 从 main.js 的「回放」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, TBOX, fmtLocalInput, fmtTs, markDirty, refreshPine, renderLegend, renderTools, state, store, updateStatus } = ctx;

/* ---------------- 回放 ---------------- */

function renderReplay(s = null) {
  const st = s || (state.replay ? state.replay.state() : null);
  if (!st) return;
  $('cursorInfo').textContent = `游标 ${fmtTs(st.cursor)} · ${st.playing ? '播放中' : '暂停'} · ${st.speed}×`;
  $('play').textContent = st.playing ? '暂停' : '播放';
}

function wireReplay() {
  $('setStart').onclick = async () => {
    if (!state.replay) return;
    const v = $('startAt').value;
    if (!v) return;
    const ts = Date.parse(v + ':00Z');
    const ms = await applyStart(ts);
    updateStatus(`起点 ${fmtTs(ts)} · ${ms} ms`);
  };
  /** 在数据范围内随机取一个起点（避开首尾各一天，落点吸到真实存在的 1m bar） */
  async function pickRandomStart() {
    const p = state.profile;
    const rp = state.replay;
    if (!p || !rp) return 0;
    const day = 86400000;
    const lo = p.first + day;
    const hi = p.last - day;
    if (!(hi > lo)) return 0;
    let ts = lo + Math.floor(Math.random() * (hi - lo));
    try {
      const nb = await rp.source.nextBars(ts, 1);
      if (nb && nb[0]) ts = nb[0].timestamp;      // 落在休市/缺口里就顺延到下一根真 bar
    } catch {}
    return ts;
  }

  async function applyStart(ts) {
    const t0 = performance.now();
    $('startAt').value = fmtLocalInput(ts);
    if (state.session) { state.session.startTs = ts; store.save(state.session).catch?.(() => {}); }
    await state.replay.setStart(ts);
    if (state.draw) await state.draw.load();
    markDirty();
    schedulePineRefresh();
    return Math.round(performance.now() - t0);
  }

  $('randomStart').onclick = async () => {
    if (!state.replay) return;
    const ts = await pickRandomStart();
    if (!ts) { updateStatus('数据范围太小，无法随机'); return; }
    const ms = await applyStart(ts);
    updateStatus(`随机起点 ${fmtTs(ts)} · ${ms} ms`);
  };

  $('fwd').onclick = async () => { if (state.replay) await state.replay.step(1); };
  $('back').onclick = async () => {
    if (!state.replay) return;
    await state.replay.back(1);
    if (state.draw) await state.draw.load();
    if (state.trade) { state.trade._lastPrice = state.app.lastBar()?.close ?? null; state.trade.emit(); }
    schedulePineRefresh();
  };
  $('play').onclick = () => {
    state.replay?.toggle();
    if (!state.replay?.playing) schedulePineRefresh();
  };
  $('speed').onchange = (e) => state.replay?.setSpeed(Number(e.target.value));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); state.replay?.toggle(); if (!state.replay?.playing) schedulePineRefresh(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); state.replay?.step(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); $('back').click(); }
    else if (e.key === 'r' || e.key === 'R') { (e.shiftKey ? $('randomStart') : $('setStart')).click(); }
    else if (e.key === 'Escape') { state.draw?.cancel(); renderTools(); }
  });
}

/** 回放推进时：UI 节流（120ms）；Pine 指标每 120 根或暂停时重算 */
let _tickTimer = null, _pushedSincePine = 0;
function scheduleTick() {
  if (_tickTimer) return;
  _tickTimer = setTimeout(() => {
    _tickTimer = null;
    updateStatus();
    updateFloating();
    renderLegend();
  }, 120);
}

let _pineTimer = null;
function schedulePineRefresh(delay = 400) {
  if (!state.pine) return;
  if (_pineTimer) clearTimeout(_pineTimer);
  _pineTimer = setTimeout(() => {
    _pineTimer = null;
    refreshPine();
  }, delay);
}

function updateFloating() {
  const t = state.trade;
  if (!t || !t.pos || t._lastPrice == null) return;
  const fl = (t.pos.side === 'long' ? t._lastPrice - t.pos.entry : t.pos.entry - t._lastPrice) * t.pos.qty;
  const b = $('posBox').querySelector('b');
  if (b) { b.textContent = fl.toFixed(2); b.className = fl >= 0 ? 'pos' : 'neg'; }
}


  return { renderReplay, wireReplay, scheduleTick, schedulePineRefresh };
}
