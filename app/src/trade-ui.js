// 模拟交易 UI（对齐 TradingView 模拟账户的关键交互）：
//   1) 图上右键 → 限价买入 / 限价卖出（用点击价）；另可「设为止损 / 设为止盈」
//   2) 回放时左上角常驻「模拟账户」面板：权益可改、按 %权益/盎司/美元下单、市价买卖、浮动/已实现
//   3) 入场后或挂单后，SL/TP 以图上虚线呈现，直接拖动线即改价；删除线 = 清除该保护
// 全部走 Vela 的公开面：registerWidgetAction（原生右键菜单）+ chart.drawings（原生可拖拽横线）。
const TAG_SL = 'tt-sl';
const TAG_TP = 'tt-tp';
const COLOR_SL = '#ff6f85';
const COLOR_TP = '#5fe3c0';
const KV_EQ = 'ui:trade.equity';
const KV_QTY = 'ui:trade.qty';

let ctxRef = null;        // { app, sim, toast }
let panel = null;
let visible = false;

const ourIds = new Map();   // tag → drawing id（删除事件只认得自己画的线）
// Vela 的 toJSON 会丢弃自定义 props，只能用「标签文案 + 我们的固定样式」认线：
// 形如 "SL 4,131.13" / "TP 4,119.13" 且颜色=dashed 我们的专用色，正常用户画图不会同时满足。
const $id = (id) => document.getElementById(id);
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function adoptNativeChrome(el) {
  const tb = document.querySelector('.vela-dtb');
  if (!el || !tb) return;
  const cs = window.getComputedStyle(tb);
  const vars = ['--vela-bg', '--vela-fg', '--vela-fg-muted', '--vela-fg-bright', '--vela-fg-faint',
    '--vela-border', '--vela-border-strong', '--vela-hover', '--vela-hover-strong', '--vela-active',
    '--vela-radius-md', '--vela-radius-lg', '--vela-shadow', '--vela-font-family',
    '--vela-bullish', '--vela-bearish'];
  for (const v of vars) {
    const val = cs.getPropertyValue(v).trim();
    if (val) el.style.setProperty(v, val);
  }
  if (!el.style.getPropertyValue('--vela-bg') && cs.backgroundColor) el.style.setProperty('--vela-bg', cs.backgroundColor);
  if (!el.style.getPropertyValue('--vela-border') && cs.borderTopColor) el.style.setProperty('--vela-border', cs.borderTopColor);
}

function buildPanel() {
  let el = $id('ttTradePanel');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ttTradePanel';
  el.className = 'tt-trade-panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="tt-tp-head"><span>模拟账户</span><span class="tt-tp-badge">回放</span></div>
    <div class="tt-tp-row">
      <label class="tt-tp-fld"><span>权益</span><input id="ttEq" type="number" step="1000" min="1"></label>
    </div>
    <div class="tt-tp-row">
      <label class="tt-tp-fld"><span>数量</span><input id="ttQty" type="number" step="1" min="0.01"></label>
      <label class="tt-tp-fld"><span>单位</span>
        <select id="ttQtyMode">
          <option value="pct">%权益</option>
          <option value="oz">盎司</option>
          <option value="usd">美元</option>
        </select>
      </label>
    </div>
    <div class="tt-tp-row tt-tp-actions">
      <button type="button" id="ttSell" class="tt-tp-btn sell"><b>卖出</b><small>市价</small></button>
      <button type="button" id="ttBuy" class="tt-tp-btn buy"><b>买入</b><small>市价</small></button>
    </div>
    <div class="tt-tp-foot">
      <span>浮动 <b id="ttFloat">—</b></span>
      <span>已实现 <b id="ttReal">0.00</b></span>
    </div>
    <div class="tt-tp-foot tt-tp-foot2">
      <span>余额 <b id="ttBal">—</b></span>
      <span id="ttPosLine">空仓</span>
    </div>`;
  document.getElementById('chart').appendChild(el);
  adoptNativeChrome(el);
  return el;
}

function lastPrice() {
  try { return panelCtx?.app?.lastBar?.()?.close ?? null; } catch { return null; }
}
let panelCtx = null;

function toast(msg, kind = 'info') {
  try { ctxRef?.toast?.(msg, kind); return; } catch {}
  // 没有 shell toast 时退化成状态栏
  const el = $id('status');
  if (el) el.textContent = msg;
}

/* ---------------- 图上的 SL / TP 线 ---------------- */

function lineTag(d) {
  const raw = String(d?.text?.value ?? '');
  if (!raw) return null;
  const m = /tt-(sl|tp)/i.exec(raw);           // 旧格式：标签里带 tt-sl / tt-tp 标记
  if (m) return m[1].toLowerCase() === 'sl' ? TAG_SL : TAG_TP;
  if (raw.startsWith('SL ')) return TAG_SL;    // 新格式：直接以 "SL 4,131.13" / "TP ..." 开头
  if (raw.startsWith('TP ')) return TAG_TP;
  return null;
}

/** 是不是我们画的保护线（标签 + hline + 专用色 + 虚线，四重匹配，避免误伤用户自己画的横线） */
function isOurs(d, tag) {
  const t = lineTag(d);
  if (!t) return false;
  if (tag && t !== tag) return false;
  if (d.type !== 'hline') return false;
  if (d?.style?.lineColor !== (t === TAG_SL ? COLOR_SL : COLOR_TP)) return false;
  return (d?.style?.lineStyle || 'dashed') === 'dashed';
}

function ourLine(tag) {
  const chart = ctxRef?.app?.chart;
  if (!chart?.drawings) return null;
  const list = (() => { try { return chart.drawings.toJSON().drawings || []; } catch { return []; } })();
  const id = ourIds.get(tag);
  const byId = id ? list.find((d) => d.id === id) : null;
  return byId || list.find((d) => isOurs(d, tag)) || null;
}

function removeLine(tag) {
  const d = ourLine(tag);
  ourIds.delete(tag);
  if (!d) return;
  try { ctxRef.app.chart.drawings.remove(d.id); } catch {}
}

/** 启动清理：回放/持仓状态不持久，图上的 SL/TP 线若是上次遗留就删掉 */
function dropOrphanLines() {
  const chart = ctxRef?.app?.chart;
  if (!chart?.drawings) return;
  if (ctxRef?.sim?.activeTrade?.()) return;   // 有持仓/挂单时不动，避免删掉正在用的保护线
  const list = (() => { try { return chart.drawings.toJSON().drawings || []; } catch { return []; } })();
  for (const d of list) {
    if (isOurs(d) || isOrderLine(d)) { try { chart.drawings.remove(d.id); } catch {} }
  }
  ourIds.clear();
}

function upsertLine(tag, price, color, label, place = 'end') {
  const chart = ctxRef?.app?.chart;
  if (!chart?.drawings) return;
  if (price == null) { removeLine(tag); return; }
  const d = ourLine(tag);
  const bar = (() => { try { return ctxRef.app.lastBar?.(); } catch { return null; } })();
  const time = bar?.timestamp ?? Date.now();
  const text = label ? { value: label, color, size: 'small', place, side: 'below' } : undefined;
  try {
    if (!d) {
      const made = chart.drawings.add('hline', {
        anchors: [{ time, price }],
        style: { lineColor: color, lineWidth: 1, lineStyle: 'dashed' },
        text
      });
      if (made?.id) ourIds.set(tag, made.id);
    } else if (Math.abs((d.anchors?.[0]?.price ?? 0) - price) > 1e-9) {
      chart.drawings.update(d.id, { anchors: [{ time, price }], text });
    }
  } catch (e) { console.warn('[tt-trade:line]', e?.message); }
}

/* ---------------- 挂单/持仓胶囊（+SL / +TP） ----------------
   坐标换算优先用图表内核自己的投影器 chart.renderer.renderer.drawingProjector()：
   yOf(price, 'price') / pxToPoint(x, y, 'price')，引擎画线用的就是它，精度与吸附一致。
   （老办法是拿十字光标事件自校准线性映射：只有鼠标在图上移动过才有值，
     所以之前"刚下的挂单胶囊/止损热区不出现"——投影器可用时直接不算了。）
   投影器取不到（内核私有面变动）时退回自校准。 */

const TAG_ORDER = 'tt-order';
const COLOR_ORDER = '#787b86';
const cal = { samples: [], k: null, b: null };
let chip = null;
let lastPointerY = null;
let sampleTimer = null;   // 指针停下后 80ms 再采样：crosshair 价格比 pointermove 慢一帧，立刻配对会错位

function projector() {
  try {
    const inner = ctxRef?.app?.chart?.renderer?.renderer;
    const p = inner?.drawingProjector?.();
    return p && typeof p.yOf === 'function' ? p : null;
  } catch { return null; }
}

function rangeKey() {
  try { return JSON.stringify(ctxRef?.app?.chart?.getVisibleRange?.() || null); } catch { return null; }
}

function feedSample(y, price) {
  if (!(y > 0) || !Number.isFinite(price)) { positionChip(); return; }
  const s = cal.samples;
  const last = s[s.length - 1];
  if (last && Math.abs(last.y - y) < 0.5 && Math.abs(last.price - price) < 1e-9) { positionChip(); return; }
  s.push({ y, price, r: rangeKey(), t: Date.now() });
  if (s.length > 48) s.shift();
  refit();
}

function refit() {
  const now = Date.now();
  const rk = rangeKey();
  const fresh = cal.samples.filter((p) => now - p.t < 5000);
  const same = fresh.filter((p) => p.r === rk);
  const pts = same.length >= 2 ? same : fresh;
  if (pts.length < 2) { cal.k = null; cal.b = null; positionChip(); return; }
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];
  if (Math.abs(p1.price - p0.price) < 1e-9) { positionChip(); return; }
  cal.k = (p1.y - p0.y) / (p1.price - p0.price);     // px per price
  cal.b = p1.y - cal.k * p1.price;
  positionChip();
}

function yForPrice(price) {
  if (!Number.isFinite(price)) return null;
  const p = projector();
  if (p) {
    try { const y = p.yOf(price, 'price'); if (Number.isFinite(y)) return y; } catch {}
  }
  if (cal.k == null) return null;
  return cal.k * price + cal.b;
}

/** 像素 y（相对 #chart 顶部）→ 价格：拖动 SL/TP 线时用 */
function priceAtY(y) {
  const p = projector();
  if (p) {
    try {
      const r = p.pxToPoint(0, y, 'price');
      if (r && Number.isFinite(r.price)) return r.price;
    } catch {}
  }
  if (!cal.k) return null;
  return (y - cal.b) / cal.k;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** 当前可视价格区间（像素 → 价格反推；两套映射都不可用就返回 null） */
function visibleBand() {
  const host = document.getElementById('chart');
  const h = host?.clientHeight || 0;
  if (!h) return null;
  const a = priceAtY(16);
  const b = priceAtY(h - 40);
  if (a == null || b == null) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/** 默认保护位：按可视区间取距离，避免 1%/2% 落在视窗外（视窗一缩就看不到线、也就拖不到） */
function defaultLevel(entry, side, kind) {
  const band = visibleBand();
  const span = band && band.hi > band.lo ? band.hi - band.lo : entry * 0.004;
  const d = Math.max(entry * 0.0005, span * (kind === 'sl' ? 0.32 : 0.42));
  let out = kind === 'sl'
    ? (side === 'long' ? entry - d : entry + d)
    : (side === 'long' ? entry + d : entry - d);
  // 入场价贴在视窗边缘时默认值会跑到画布外（线看不到也拖不到）：夹回可视区间
  if (band) {
    const pad = span * 0.06;
    const lo = band.lo + pad;
    const hi = band.hi - pad;
    out = Math.min(Math.max(out, lo), hi);
    const minDist = span * 0.02;                   // 且不能落回入场价的错误一侧
    out = kind === 'sl'
      ? (side === 'long' ? Math.min(out, entry - minDist) : Math.max(out, entry + minDist))
      : (side === 'long' ? Math.max(out, entry + minDist) : Math.min(out, entry - minDist));
  }
  return round2(out);
}

function buildChip() {
  let el = $id('ttChip');
  if (el) { chip = el; return el; }
  el = document.createElement('div');
  el.id = 'ttChip';
  el.className = 'tt-chip';
  el.hidden = true;
  el.innerHTML = `
    <span class="tt-chip-side"></span>
    <span class="tt-chip-qty"></span>
    <span class="tt-chip-px"></span>
    <button type="button" class="tt-chip-btn" data-k="sl"></button>
    <button type="button" class="tt-chip-btn" data-k="tp"></button>
    <button type="button" class="tt-chip-x" data-k="close" title="撤销挂单">✕</button>`;
  document.getElementById('chart').appendChild(el);
  el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    e.stopPropagation();
    const sim = ctxRef?.sim;
    const t = sim?.activeTrade?.();
    if (!sim || !t) return;
    const k = b.dataset.k;
    const p = t.entry;
    if (k === 'sl') {
      if (t.sl != null) sim.setStop(null);
      else sim.setStop(defaultLevel(p, t.side, 'sl'));
      syncTradeUI();
    } else if (k === 'tp') {
      if (t.tp != null) sim.setTarget(null);
      else sim.setTarget(defaultLevel(p, t.side, 'tp'));
      syncTradeUI();
    } else if (k === 'close') {
      if (t.kind === 'order') { sim.cancelOrder(t.id); syncTradeUI(); toast('已撤销挂单', 'info'); }
      else flatAtMarket();
    }
  });
  chip = el;
  return el;
}

/* 自绘拖拽热区：Vela 的 hline 命中区只有线宽那么点（1px 虚线上很难抓），
   这里在线上下各铺 16px 透明条，按下即进入拖动，价格用已标定的 y→价格 反算。 */
const HIT_H = 16;
const hits = { sl: null, tp: null };
let dragTag = null;
let dragGrab = 0;      // 按下点相对线中心的偏移，拖动时保持，避免线跳到指针上

function buildHit(tag) {
  let el = $id(tag === TAG_SL ? 'ttHitSL' : 'ttHitTP');
  if (el) return el;
  el = document.createElement('div');
  el.id = tag === TAG_SL ? 'ttHitSL' : 'ttHitTP';
  el.className = 'tt-line-hit';
  el.hidden = true;
  document.getElementById('chart').appendChild(el);
  const host = document.getElementById('chart');

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = ctxRef?.sim?.activeTrade?.();
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    dragTag = tag;
    const hostTop = host.getBoundingClientRect().top;
    const yLine = yForPrice(tag === TAG_SL ? t.sl : t.tp);
    dragGrab = yLine == null ? 0 : (e.clientY - hostTop) - yLine;
    try { el.setPointerCapture?.(e.pointerId); } catch {}
    document.body.classList.add('tt-dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (dragTag !== tag) return;
    e.preventDefault();
    e.stopPropagation();
    const rawY = e.clientY - host.getBoundingClientRect().top - dragGrab;   // 保持抓取偏移
    const y = Math.max(12, Math.min((host.clientHeight || 600) - 44, rawY)); // 别把线拖出可视区
    const p = priceAtY(y);
    if (p == null) return;
    let price = round2(p);
    if (!Number.isFinite(price)) return;
    const sim = ctxRef?.sim;
    const t = sim?.activeTrade?.();
    if (!t) return;
    // 不许拖到入场价反侧：止损拖到盈利侧会在下一根立刻成交，止盈拖到亏损侧同理（TV 也是拦）
    const eps = Math.max(1e-9, Math.abs(t.entry) * 2e-5);
    if (tag === TAG_SL) {
      price = t.side === 'long' ? Math.min(price, t.entry - eps) : Math.max(price, t.entry + eps);
    } else {
      price = t.side === 'long' ? Math.max(price, t.entry + eps) : Math.min(price, t.entry - eps);
    }
    if (tag === TAG_SL) sim.setStop(price); else sim.setTarget(price);
    syncTradeUI();          // 线、胶囊按钮、热区一起跟着动
  });
  const end = (e) => {
    if (dragTag !== tag) return;
    dragTag = null;
    try { el.releasePointerCapture?.(e.pointerId); } catch {}
    document.body.classList.remove('tt-dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  hits[tag === TAG_SL ? 'sl' : 'tp'] = el;
  return el;
}

function positionHits() {
  const host = document.getElementById('chart');
  if (!host) return;
  const t = ctxRef?.sim?.activeTrade?.();
  const set = (el, price) => {
    if (!el) return;
    const y = t && price != null ? yForPrice(price) : null;
    if (y == null) { el.hidden = true; return; }
    el.hidden = false;
    el.style.top = Math.round(y - HIT_H / 2) + 'px';
  };
  set(hits.sl, t ? t.sl : null);
  set(hits.tp, t ? t.tp : null);
}

function positionChip() {
  if (!chip) return;
  const t = ctxRef?.sim?.activeTrade?.();
  const host = document.getElementById('chart');
  if (!t || !host) { chip.hidden = true; positionHits(); return; }
  const y = yForPrice(t.entry);
  if (y == null) { chip.hidden = true; positionHits(); return; }
  const h = chip.offsetHeight || 22;
  const top = Math.round(y - h / 2);
  chip.style.top = Math.max(2, Math.min((host.clientHeight || 600) - h - 2, top)) + 'px';
  chip.hidden = false;
  positionHits();
}

function updateChip() {
  const el = buildChip();
  const t = ctxRef?.sim?.activeTrade?.();
  if (!t) { el.hidden = true; positionHits(); return; }
  el.classList.toggle('buy', t.side === 'long');
  el.classList.toggle('sell', t.side === 'short');
  el.querySelector('.tt-chip-side').textContent = t.kind === 'order'
    ? (t.side === 'long' ? '限价买入' : '限价卖出')
    : (t.side === 'long' ? '多头' : '空头');
  el.querySelector('.tt-chip-qty').textContent = String(t.qty);
  el.querySelector('.tt-chip-px').textContent = money(t.entry);
  const slB = el.querySelector('[data-k="sl"]');
  slB.textContent = t.sl == null ? '+SL' : money(t.sl);
  slB.classList.toggle('on', t.sl != null);
  slB.title = t.sl == null ? '按可视区间设止损（可拖线微调）' : '点击清除止损';
  const tpB = el.querySelector('[data-k="tp"]');
  tpB.textContent = t.tp == null ? '+TP' : money(t.tp);
  tpB.classList.toggle('on', t.tp != null);
  tpB.title = t.tp == null ? '按可视区间设止盈（可拖线微调）' : '点击清除止盈';
  el.querySelector('[data-k="close"]').title = t.kind === 'order' ? '撤销挂单' : '平仓';
  positionChip();
}

/** 未成交挂单画一条灰虚线（TV 同款），成交后自动撤掉 */
function syncOrderLine() {
  const t = ctxRef?.sim?.activeTrade?.();
  if (!t || t.kind !== 'order') { removeLine(TAG_ORDER); return; }
  upsertLine(TAG_ORDER, t.entry, COLOR_ORDER, '');
}

function isOrderLine(d) {
  if (d.type !== 'hline') return false;
  if (d?.style?.lineColor !== COLOR_ORDER) return false;
  if ((d?.style?.lineStyle || 'dashed') !== 'dashed') return false;
  return !String(d?.text?.value ?? '').trim();   // 订单线不带文字（信息和胶囊重复）
}

function syncLines() {
  const t = ctxRef?.sim?.activeTrade?.();
  if (!t) { removeLine(TAG_SL); removeLine(TAG_TP); return; }
  upsertLine(TAG_SL, t.sl, COLOR_SL, `SL ${t.sl != null ? money(t.sl) : ''}`.trim());
  upsertLine(TAG_TP, t.tp, COLOR_TP, `TP ${t.tp != null ? money(t.tp) : ''}`.trim());
}

/* ---------------- 面板渲染 ---------------- */

export function syncTradeUI(snap) {
  if (!snap && ctxRef?.sim) {
    const p = lastPrice();
    if (p != null) ctxRef.sim._lastPrice = p;    // 浮动盈亏统一按图上最新价算
  }
  const s = snap || ctxRef?.sim?.snapshot?.();
  if (!s) return;
  if (panel && !panel.hidden) {
    const eq = $id('ttEq');
    if (eq && document.activeElement !== eq) eq.value = String(Math.round(s.equity));
    const q = $id('ttQty');
    const modeEl = $id('ttQtyMode');
    if (modeEl && modeEl.value !== s.qtyMode) modeEl.value = s.qtyMode;
    if (q && document.activeElement !== q) q.value = String(s.qtyMode === 'pct' ? s.pct : s.qty);
    const fl = $id('ttFloat');
    if (fl) {
      fl.textContent = s.floating == null ? '—' : (s.floating >= 0 ? '+' : '') + money(s.floating);
      fl.className = s.floating == null ? '' : (s.floating >= 0 ? 'up' : 'down');
    }
    const re = $id('ttReal');
    if (re) { re.textContent = (s.realized >= 0 ? '+' : '') + money(s.realized); re.className = s.realized >= 0 ? 'up' : 'down'; }
    const bal = $id('ttBal');
    if (bal) bal.textContent = money(s.balance);
    const pl = $id('ttPosLine');
    if (pl) {
      if (s.pos) {
        pl.textContent = `${s.pos.side === 'long' ? '多' : '空'} ${s.pos.qty} @ ${money(s.pos.entry)}`;
        pl.className = s.pos.side === 'long' ? 'up' : 'down';
      } else {
        const pend = (s.orders || []).filter((o) => !o.done);
        pl.textContent = pend.length ? `挂单 ${pend.length}` : '空仓';
        pl.className = '';
      }
    }
  }
  syncLines();
  syncOrderLine();
  updateChip();
}

export function setTradeUIVisible(on) {
  visible = !!on;
  if (!panel) return;
  panel.hidden = !visible;
  if (visible) { adoptNativeChrome(panel); dropOrphanLines(); syncTradeUI(); }
}

/* ---------------- 下单入口（右键菜单 / 面板共用） ---------------- */

function barNow() { try { return ctxRef?.app?.lastBar?.() ?? null; } catch { return null; } }

function placeLimit(side, price, from = '右键') {
  const sim = ctxRef?.sim;
  if (!sim) return;
  const r = sim.placeLimit(side, price, barNow());
  if (r && r.ok === false) { toast(`挂单失败：${r.reason}`, 'error'); return; }
  syncTradeUI();
  toast(`${from}：${side === 'long' ? '限价买入' : '限价卖出'} ${r.qty} @ ${money(price)}`, 'success');
}

function market(side) {
  const sim = ctxRef?.sim;
  const p = lastPrice();
  if (!sim || p == null) { toast('还没有行情，无法下单', 'error'); return; }
  const r = sim.openMarket(side, p, barNow());
  if (r && r.ok === false) { toast(`下单失败：${r.reason}`, 'error'); return; }
  syncTradeUI();
  toast(`市价${side === 'long' ? '买入' : '卖出'} ${r.pos.qty} @ ${money(p)}`, 'success');
}

function setStopAt(price, which) {
  const sim = ctxRef?.sim;
  if (!sim) return;
  const r = which === 'sl' ? sim.setStop(price) : sim.setTarget(price);
  if (r && r.ok === false) { toast(`设置失败：${r.reason}`, 'error'); return; }
  syncTradeUI();
  toast(`${which === 'sl' ? '止损' : '止盈'} @ ${money(price)}`, 'success');
}

/* ---------------- 右键菜单：挂到 app 自己的 #ctxMenu 上 ----------------
   Vela 的 bare chart 没有右键菜单（registerWidgetAction 只在 widget shell 里生效），
   本 app 已有 #ctxMenu（main.js:openCtx），交易项直接加进那套菜单，风格天然一致。 */
let lastCross = null;      // {price, at}

function trackCrosshair(chart) {
  try {
    chart.renderer?.onCrosshairMove?.((e) => {
      if (e && e.price != null && (e.paneKind == null || e.paneKind === 'price')) {
        lastCross = { price: e.price, at: Date.now() };
        // 顺手喂一个价格↔像素样本（胶囊定位靠这个线性拟合）
        // 价格↔像素样本由 pointermove 的防抖采样来喂（见 initTradeUI），这里只记十字光标价
      }
    });
  } catch (e) { console.warn('[tt-trade:cross]', e?.message); }
}

/** 右键落点价格：优先十字光标（同一位置刚移过），否则退回最后一根收盘价 */
export function priceUnderPointer() {
  if (lastCross && Date.now() - lastCross.at < 6000) return lastCross.price;
  return lastPrice();
}

export function placeLimitAtPrice(side, price) { placeLimit(side, price, '右键'); }

export function applyStopAtPrice(which, price) { setStopAt(price, which); }

export function flatAtMarket() {
  const sim = ctxRef?.sim;
  const px = lastPrice();
  if (!sim?.pos) { toast('当前没有持仓', 'error'); return; }
  const rec = sim.closePos(px, barNow(), 'manual');
  syncTradeUI();
  toast(`平仓 @ ${money(px)} · ${rec && rec.pnl >= 0 ? '+' : ''}${money(rec && rec.pnl)}`,
    rec && rec.pnl >= 0 ? 'success' : 'error');
}

export function cancelAllOrders() {
  const n = ctxRef?.sim?.orders?.filter((o) => !o.done).length || 0;
  ctxRef?.sim?.cancelOrders?.();
  syncTradeUI();
  toast(n ? `已撤销 ${n} 笔挂单` : '没有挂单', n ? 'info' : 'error');
}

/** 右键菜单里交易行的可用状态（main.js:openCtx 调用） */
export function tradeMenuState() {
  const sim = ctxRef?.sim;
  const t = sim?.activeTrade?.();
  return { hasSim: !!sim, hasTrade: !!t, hasPos: !!sim?.pos, pending: (sim?.orders || []).filter((o) => !o.done).length };
}

/* ---------------- 接线 ---------------- */

export function initTradeUI({ app, sim, toast: toastFn } = {}) {
  ctxRef = { app, sim, toast: toastFn };
  if (!app?.chart || !sim) return null;
  panel = buildPanel();
  panelCtx = ctxRef;

  // 面板按钮
  $id('ttEq').onchange = (e) => {
    sim.setEquity(e.target.value);
    import('./db.js').then(({ kvSet }) => kvSet(KV_EQ, sim.equity)).catch(() => {});
    syncTradeUI();
  };
  $id('ttQty').onchange = (e) => {
    sim.setQtyMode(sim.qtyMode, e.target.value);
    import('./db.js').then(({ kvSet }) => kvSet(KV_QTY, { mode: sim.qtyMode, value: sim.qtyMode === 'pct' ? sim.pct : sim.qty })).catch(() => {});
  };
  $id('ttQtyMode').onchange = (e) => {
    sim.setQtyMode(e.target.value, e.target.value === 'pct' ? sim.pct : sim.qty);
    import('./db.js').then(({ kvSet }) => kvSet(KV_QTY, { mode: sim.qtyMode, value: sim.qtyMode === 'pct' ? sim.pct : sim.qty })).catch(() => {});
    syncTradeUI();
  };
  $id('ttBuy').onclick = () => market('long');
  $id('ttSell').onclick = () => market('short');

  // 恢复上次的权益 / 数量口径
  import('./db.js').then(async ({ kvGet }) => {
    const eq = await kvGet(KV_EQ);
    if (Number.isFinite(Number(eq)) && Number(eq) > 0) sim.setEquity(eq);
    const q = await kvGet(KV_QTY);
    if (q && q.mode) sim.setQtyMode(q.mode, q.value);
    syncTradeUI();
  }).catch(() => {});

  // 图上拖线 = 改 SL/TP；删线 = 清除
  const chart = app.chart;
  // 注：Vela 的 drawings.update() 是同步 emit 'drawing:edited'，用 busy 标志会把真实拖动也吞掉；
  // 这里靠幂等（价格没变就不写）防环，不再加锁。
  // 注：Vela 的 drawings.update() 是同步 emit 'drawing:edited'；靠幂等（价格没变就不写）防环
  chart.on('drawing:edited', ({ id }) => {
    const d = (() => { try { return chart.drawings.toJSON().drawings.find((x) => x.id === id); } catch { return null; } })();
    if (!d) return;
    const tag = lineTag(d);
    if (tag !== TAG_SL && tag !== TAG_TP) return;
    const price = d?.anchors?.[0]?.price;
    if (!Number.isFinite(price)) return;
    if (tag === TAG_SL) sim.setStop(price); else sim.setTarget(price);
    syncTradeUI();
  });
  chart.on('drawing:removed', ({ id }) => {
    for (const [tag, lid] of [...ourIds]) {
      if (lid !== id) continue;
      ourIds.delete(tag);
      if (tag === TAG_SL) sim.setStop(null);
      else if (tag === TAG_TP) sim.setTarget(null);
      syncTradeUI();
      return;
    }
  });

  trackCrosshair(chart);
  buildChip();
  buildHit(TAG_SL);
  buildHit(TAG_TP);
  const host = document.getElementById('chart');
  host?.addEventListener('pointermove', (e) => {
    lastPointerY = e.clientY;
    if (sampleTimer) clearTimeout(sampleTimer);
    sampleTimer = setTimeout(() => {
      sampleTimer = null;
      const p = lastCross && Date.now() - lastCross.at < 400 ? lastCross.price : null;
      if (p != null && lastPointerY != null) feedSample(lastPointerY - host.getBoundingClientRect().top, p);
    }, 80);
  }, { passive: true });
  host?.addEventListener('scroll', positionChip, { passive: true });
  // 平移/缩放（拖拽、滚轮、双击复位）后胶囊与热区要跟着走：投影器变了 y 就变了
  host?.addEventListener('wheel', () => repositionSoon(), { passive: true });
  host?.addEventListener('pointerdown', () => repositionSoon(), { passive: true });
  host?.addEventListener('pointerup', () => repositionSoon(), { passive: true });
  window.addEventListener('resize', () => { refit(); positionChip(); });
  // 兜底轻量跟随（持仓/挂单存在时每 120 ms 校一次）：实时新增 bar、自动缩放、分屏改高都不会漏
  setInterval(() => { try { if (ctxRef?.sim?.activeTrade?.()) { positionChip(); } } catch {} }, 120);
  dropOrphanLines();                                  // 图还没恢复完时先试一次
  setTimeout(dropOrphanLines, 1500);                  // 图表存档异步恢复，再补一次
  syncTradeUI();
  return { panel, sync: syncTradeUI, setVisible: setTradeUIVisible, reposition: positionChip };
}

/* 平移/缩放后的下一帧再量（图表此时才把新 viewport 写进投影器） */
let _repositionRaf = 0;
function repositionSoon() {
  if (_repositionRaf) return;
  _repositionRaf = requestAnimationFrame(() => { _repositionRaf = 0; try { positionChip(); } catch {} });
}

export { TAG_SL, TAG_TP };
