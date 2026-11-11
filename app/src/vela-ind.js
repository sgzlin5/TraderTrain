// 指标层（Vela 版，P4 第一批）：
// 1) 纯 calc 指标 → registerNativeIndicator 通用适配器（复用 customIndicators.js 的 calc，
//    figures → SeriesSpec，零重写）；
// 2) Pine 桥（D1）：registerEngine('pine', PineEngine) + D7 isconfirmed 预处理 +
//    D8 importResolver（接本项目「Pine 库」，见 VELA-PINETS-COVERAGE §5）。
// SMC×5 / flow×4 的 calc 返回 overlay 对象池（走 boxes/labels 输出分支）= P4 第二批。
import { CUSTOM_INDS } from './customIndicators.js';
import { SMC_INDS } from './smc.js';
import { FLOW_INDS } from './flow.js';
import { libList } from './pine.js';
import { kvGet } from './db.js';

window.__VI_COPIES = (window.__VI_COPIES || 0) + 1;   // 模块副本计数（诊断双实例）
const V = () => window.VelaSDK;
const LINE_STYLE_MAP = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', dash: 'dashed', dot: 'dotted' };

/** klinecharts figure → SeriesSpec（线/圆点） */
function figToSeries(tpl, fig, biz, rows, paramsHash) {
  const st = (typeof fig.styles === 'function' ? fig.styles(undefined, undefined) : fig.styles) || {};
  const kind = fig.type === 'circle' ? 'circles' : (fig.type === 'bar' ? 'histogram' : 'line');
  return {
    id: `tt-${tpl.name.toLowerCase()}-${fig.key}-${paramsHash}`,
    title: (fig.title || fig.key).replace(/:\s*$/, '').replace(/:\s*/, ''),
    kind,
    points: rows.map((r, i) => ({
      time: biz[i].time,
      value: r && r[fig.key] != null ? r[fig.key] : null,
      ...(st.color ? {} : {})
    })),
    style: {
      color: st.color || '#8adeff',
      width: st.size ?? 1,
      lineStyle: LINE_STYLE_MAP[st.style] || 'solid'
    }
  };
}

let _registered = false;
/** 把 CUSTOM_INDS（PDHL/ORB/AVWAP/EMA/RMA/ZLEMA）注册成 Vela native indicators */
export function registerNativeVelaIndicators() {
  const { registerNativeIndicator } = V() || {};
  if (_registered || typeof registerNativeIndicator !== 'function') return 0;
  let n = 0;
  for (const tpl of CUSTOM_INDS) {
    try {
      registerNativeIndicator({
        type: 'TT_' + tpl.name,
        title: tpl.shortName || tpl.name,
        paneHint: tpl.series === 'price' ? 'price' : 'new',
        overlay: tpl.series === 'price',
        multiInstance: false,
        inputsSchema() {
          return (tpl.calcParams || []).map((def, i) => ({
            key: 'p' + i, title: '参数 ' + (i + 1), type: 'number', default: def
          }));
        },
        defaultInputs() {
          const o = {};
          (tpl.calcParams || []).forEach((d, i) => { o['p' + i] = d; });
          return o;
        },
        create() {
          return {
            start(ctx, inputs) { this._ctx = ctx; this._inputs = inputs; this._run(); },
            onBars() { if (this._ctx) this._run(); },
            _run() {
              const ctx = this._ctx;
              if (!ctx) return;
              const bars = ctx.bars() || [];
              // calc 吃 klinecharts 形状 {timestamp,...}
              const biz = bars.map(b => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
              const params = (tpl.calcParams || []).map((d, i) => this._inputs?.['p' + i] ?? d);
              let rows = [];
              try { rows = tpl.calc(biz, { params, calcParams: params }) || []; } catch (e) { console.warn('[vela-ind]', tpl.name, e?.message); }
              const ph = params.join('-').replace(/\./g, '_') || 'd';
              const series = [];
              for (const fig of (tpl.figures || [])) {
                if (!fig?.key) continue;
                try { series.push(figToSeries(tpl, fig, biz, rows, ph)); } catch (e) { console.warn('[vela-ind:fig]', tpl.name, fig.key, e?.message); }
              }
              ctx.emit({ series });
            }
          };
        }
      });
      n++;
    } catch (e) { console.warn('[vela-ind:reg]', tpl.name, e?.message); }
  }
  _registered = true;
  return n;
}

/* ---------------- SMC×4 + FLOW_VOL：payload → 自绘层 items ---------------- */
function queueHostUpdate() { /* worker 作用域无 host；由 wireSmcLayerTriggers 的图表事件驱动 */ }
// SMC 的 calc 返回 rows（含 __smc 载荷：zones/events/swings/eq/fvgs），旧方案由 smcRender
// 用 overlay 池画 rect/hline/tag；Vela 下直接 emit 数据空间原语（xloc=bar_time），坐标零换算。
const LAYER_DATA = window.__TT_LAYER_DATA_REF = (window.__TT_LAYER_DATA_REF || new Map());   // 全局共享：防双模块实例
window.__VI_TAG = 'vi@' + (window.__VI_TAG || '');
const SMC_BULL = '#5fe3c0';
const SMC_BEAR = '#ff6f85';
const SMC_WARN = '#ffc36b';
let _smcSeq = 0;

/** payload → items（box/line/tag，绝对时间；逐条移植 smcRender 的 drawFvg/drawIct/drawHtf/drawMst） */
function smcPayloadToItems(name, p, biz) {
  const ts = (i) => biz[Math.max(0, Math.min(biz.length - 1, i))]?.time ?? 0;
  const lastI = p.n ? p.n - 1 : biz.length - 1;
  const items = [];
  const box = (t1, v1, t2, v2, bg, border) => {
    if (t1 == null || t2 == null || !Number.isFinite(v1) || !Number.isFinite(v2)) return;
    items.push({ t: 'box', x1: Math.min(t1, t2), y1: Math.max(v1, v2), x2: Math.max(t1, t2), y2: Math.min(v1, v2), bg, border: border ?? bg });
  };
  const line = (t1, p1, t2, p2, color, style, width) => {
    if (t1 == null || t2 == null) return;
    items.push({ t: 'line', x1: t1, y1: p1, x2: t2, y2: p2, color, dash: style === 'dotted' ? [1, 3] : [5, 4], w: width ?? 1 });
  };
  const tag = (t, price, text, color) => {
    if (t == null || !Number.isFinite(price)) return;
    items.push({ t: 'tag', x: t, y: price, text, color });
  };
  const fill = (dir) => (dir === 1 ? 'rgba(95,227,192,.12)' : 'rgba(255,111,133,.12)');
  const bord = (dir) => (dir === 1 ? SMC_BULL : SMC_BEAR);

  if (name === 'SMC_FVG') {
    for (const z of p.zones || []) {
      const bull = z.inverse ? z.dir === -1 : z.dir === 1;
      box(ts(z.from), z.top, ts(z.closed != null ? z.closed : lastI), z.bottom, fill(bull), bord(bull));
      tag(ts(z.from), Math.min(z.top, z.bottom), z.inverse ? 'IFVG' : 'FVG', bord(bull));
    }
  } else if (name === 'SMC_ICT') {
    let lo = Infinity, hi = -Infinity;
    for (const b of biz) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
    const pad = (hi - lo) * 0.04 || 1;
    for (const z of p.zones || []) {
      box(ts(z.from), hi + pad, ts(z.to + 1), lo - pad, z.color, 'transparent');
      tag(ts(z.from + 1), hi + pad, z.label, 'rgba(205,218,230,.9)');
    }
    for (const z of p.fvgs || []) {
      box(ts(z.from), z.top, ts(lastI), z.bottom, fill(z.dir), bord(z.dir));
    }
  } else if (name === 'SMC_HTF') {
    for (const s of p.swings || []) {
      const c = s.type === 'H' ? 'rgba(255,111,133,.55)' : 'rgba(95,227,192,.55)';
      line(ts(s.i), s.price, ts(lastI), s.price, c, 'dotted', 1);
      tag(ts(s.i), s.price, `${p.hours}H ${s.type === 'H' ? 'SH' : 'SL'}`, c);
    }
    for (const e of p.events || []) {
      const c = e.dir === 1 ? SMC_BULL : SMC_BEAR;
      line(ts(e.from), e.price, ts(e.i), e.price, c, 'dashed', 1.4);
      tag(ts(e.i), e.price, `${p.hours}H ${e.kind}`, c);
      if (e.ob) box(ts(e.ob.from), e.ob.top, ts(e.ob.to != null ? e.ob.to : lastI), e.ob.bottom, fill(e.ob.dir), bord(e.ob.dir));
    }
  } else if (name === 'SMC_MST') {
    for (const e of p.events || []) {
      const c = e.dir > 0 ? SMC_BULL : SMC_BEAR;
      line(ts(e.from), e.price, ts(e.i), e.price, c, 'dashed', 1);
      tag(ts(e.i), e.price, e.kind, c);
      if (e.ob) {
        box(ts(e.ob.from), e.ob.top, ts(e.ob.to != null ? e.ob.to : lastI), e.ob.bottom, fill(e.ob.dir), bord(e.ob.dir));
        tag(ts(e.ob.from), e.ob.top, 'OB', bord(e.ob.dir));
      }
    }
    for (const q of p.eq || []) {
      line(ts(q.from), q.price, ts(q.to != null ? q.to : lastI), q.price, SMC_WARN, 'dashed', 1);
      tag(ts(q.from), q.price, q.type === 'H' ? 'EQH' : 'EQL', SMC_WARN);
    }
  }
  return items;
}

/** 交易标记层：host 写 window.__TT_TRADE_DATA = { entry, sl, tp, side, qty }，层画
 *  入场/SL/TP 全宽虚线 + 右缘方向 chip（多绿/空红）。R14 同路自绘。 */
export function registerTradeMarksLayer() {
  const { registerRendererLayer } = V() || {};
  if (typeof registerRendererLayer !== 'function') return;
  try {
    registerRendererLayer({
      id: 'TT_TRADE_MARKS',
      placement: 'above-data',
      create() {
        let cv = null;
        return {
          mount(canvas) {
            cv = canvas;
            window.__LAYER_CV = window.__LAYER_CV || {};
            window.__LAYER_CV.TT_TRADE_MARKS = canvas;
          },
          render(args) {
            try { paintTradeMarks(args, cv || (window.__LAYER_CV || {}).TT_TRADE_MARKS); } catch {}
          }
        };
      }
    });
  } catch (e) { console.warn('[vela:marks-layer]', e?.message); }
}

function paintTradeMarks(args, cv) {
  const t = window.__TT_TRADE_DATA || null;
  if (!cv) return;
  const ctx2 = cv.getContext('2d');
  const dpr = cv.clientWidth ? cv.width / cv.clientWidth : 1;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, cv.width, cv.height);
  const sc = args.scale, bd = args.bounds;
  if (!t || !sc || !bd) return;
  const Y = (v) => {
    const lo = sc.min, hi = sc.max;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return NaN;
    return bd.top + (1 - (v - lo) / (hi - lo)) * bd.height;
  };
  const W = cv.clientWidth;
  const line = (v, color) => {
    const y = Y(v);
    if (!Number.isFinite(y)) return;
    ctx2.strokeStyle = color; ctx2.lineWidth = 1; ctx2.setLineDash([5, 4]);
    ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(W, y); ctx2.stroke(); ctx2.setLineDash([]);
  };
  const bull = t.side === 'long';
  const main = bull ? '#5fe3c0' : '#ff6f85';
  if (t.entry != null) line(t.entry, main);
  if (t.sl != null) line(t.sl, '#ff6f85');
  if (t.tp != null) line(t.tp, '#5fe3c0');
  if (t.entry != null) {
    const y = Y(t.entry);
    const text = `${bull ? '▲ 多' : '▼ 空'} ${t.qty ?? ''}`;
    ctx2.font = '10px ui-monospace, Menlo, Consolas, monospace';
    const w = ctx2.measureText(text).width + 8;
    ctx2.fillStyle = 'rgba(6,12,20,.78)'; ctx2.fillRect(W - w - 4, y - 9, w, 14);
    ctx2.strokeStyle = main; ctx2.strokeRect(W - w - 4, y - 9, w, 14);
    ctx2.fillStyle = main; ctx2.fillText(text, W - w, y + 2);
  }
}

/** 回测成交层：host 写 window.__TT_BT_TRADES__ = { trades:[{t0,p0,t1,p1,side,pnl,open}] }
 *  画入场三角 + 出场方块 + 连线（盈绿亏红），时间轴用内核 coords.timeToX。 */
export function registerBtTradesLayer() {
  const { registerRendererLayer } = V() || {};
  if (typeof registerRendererLayer !== 'function') return;
  try {
    registerRendererLayer({
      id: 'TT_BT_TRADES',
      placement: 'above-data',
      create() {
        let cv = null;
        return {
          mount(canvas) {
            cv = canvas;
            window.__LAYER_CV = window.__LAYER_CV || {};
            window.__LAYER_CV.TT_BT_TRADES = canvas;
          },
          render(args) {
            try {
              window.__LAYER_ARGS = window.__LAYER_ARGS || {};
              window.__LAYER_ARGS.TT_BT_TRADES = args;
              paintBtTrades(args, cv || (window.__LAYER_CV || {}).TT_BT_TRADES);
            } catch {}
          }
        };
      }
    });
  } catch (e) { console.warn('[vela:bt-trades-layer]', e?.message); }
}

/** 手动重画（host 改了 window.__TT_BT_TRADES__ 后调用；没有渲染帧时也能立刻上屏） */
export function repaintBtTrades() {
  const args = (window.__LAYER_ARGS || {}).TT_BT_TRADES;
  const cv = (window.__LAYER_CV || {}).TT_BT_TRADES;
  if (!args || !cv) return false;
  try { paintBtTrades(args, cv); return true; } catch { return false; }
}

function paintBtTrades(args, cv) {
  const pack = window.__TT_BT_TRADES || null;
  if (!cv) return;
  const ctx2 = cv.getContext('2d');
  const dpr = cv.clientWidth ? cv.width / cv.clientWidth : 1;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, cv.width, cv.height);
  const list = pack && Array.isArray(pack.trades) ? pack.trades : null;
  if (!list || !list.length) return;
  const sc = args.scale, bd = args.bounds, co = args.coords;
  if (!sc || !bd || !co || typeof co.timeToX !== 'function') return;
  const lo = sc.min, hi = sc.max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return;
  const Y = (v) => bd.top + (1 - (v - lo) / (hi - lo)) * bd.height;
  const X = (t) => { try { return co.timeToX(t); } catch { return NaN; } };
  const W = cv.clientWidth;
  const WIN = '#5fe3c0', LOSS = '#ff6f85', LONG = '#3fb6a3', SHORT = '#d9566c', EDGE = '#0d1117';
  ctx2.lineWidth = 1.4;
  const few = list.length <= 15;          // 笔数少时标盈亏数字，多时只画几何
  ctx2.font = '9px ui-monospace,Menlo,monospace';
  ctx2.textAlign = 'left'; ctx2.textBaseline = 'middle';
  for (const t of list) {
    const x0 = X(t.t0), y0 = Y(t.p0);
    const hasExit = t.t1 != null && t.p1 != null;
    const x1 = hasExit ? X(t.t1) : NaN;
    const y1 = hasExit ? Y(t.p1) : NaN;
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
    const vis0 = x0 > -60 && x0 < W + 60;
    const vis1 = Number.isFinite(x1) && x1 > -60 && x1 < W + 60;
    if (!vis0 && !vis1) continue;
    const sideCol = t.side === 'short' ? SHORT : LONG;
    const ok = (Number(t.pnl) || 0) >= 0;
    if (hasExit && Number.isFinite(x1) && Number.isFinite(y1)) {
      // 持仓区间：入场 → 出场
      ctx2.strokeStyle = ok ? WIN : LOSS;
      ctx2.globalAlpha = 0.85;
      ctx2.beginPath(); ctx2.moveTo(x0, y0); ctx2.lineTo(x1, y1); ctx2.stroke();
      ctx2.globalAlpha = 1;
      // 出场方块（描边保证在浅色 K 线上也看得清）
      ctx2.fillStyle = ok ? WIN : LOSS;
      ctx2.fillRect(x1 - 3.2, y1 - 3.2, 6.4, 6.4);
      ctx2.strokeStyle = EDGE; ctx2.lineWidth = 1;
      ctx2.strokeRect(x1 - 3.2, y1 - 3.2, 6.4, 6.4);
      ctx2.lineWidth = 1.4;
      if (few && Number.isFinite(t.pnl)) {
        ctx2.fillStyle = ok ? WIN : LOSS;
        const txt = (ok ? '+' : '') + (Number(t.pnl)).toFixed(1);
        ctx2.fillText(txt, x1 + 6, y1);
      }
    }
    // 入场三角：多朝上（贴 K 线下沿）、空朝下（贴上沿）
    if (vis0) {
      const d = t.open ? 5.5 : 7;
      ctx2.beginPath();
      if (t.side === 'short') { ctx2.moveTo(x0, y0 - d * 0.25); ctx2.lineTo(x0 - d, y0 - d * 1.9); ctx2.lineTo(x0 + d, y0 - d * 1.9); }
      else { ctx2.moveTo(x0, y0 + d * 0.25); ctx2.lineTo(x0 - d, y0 + d * 1.9); ctx2.lineTo(x0 + d, y0 + d * 1.9); }
      ctx2.closePath();
      ctx2.fillStyle = sideCol; ctx2.fill();
      ctx2.strokeStyle = EDGE; ctx2.lineWidth = 1; ctx2.stroke(); ctx2.lineWidth = 1.4;
    }
  }
  ctx2.setTransform(1, 0, 0, 1, 0, 0);
}

/** SMC 自绘层：id = native type → pushData 载荷进 args.data，canvas 2D 直接画
 *  （R14 Tier-1：非 series 原语不上屏的确定通路；绘制代码移植自 smcRender） */
export function registerSmcLayers() {
  const { registerRendererLayer } = V() || {};
  if (typeof registerRendererLayer !== 'function') return 0;
  let n = 0;
  for (const type of ['TT_SMC_FVG', 'TT_SMC_ICT', 'TT_SMC_HTF', 'TT_SMC_MST',
                      'TT_FLOW_VP', 'TT_FLOW_WALL', 'TT_FLOW_DEPTH']) {
    try {
      registerRendererLayer({
        id: type,
        placement: 'above-data',
        create() {
          const TYPE = type;                    // 闭包：本层的 native type
          let cv = null;
          // 绘制必须是闭包函数：渲染器会包装实例（mount/render），this 上没有自定义方法（实测）
          const paint = (args, cvs) => {
            const cv2 = cvs || (window.__LAYER_CV || {})[TYPE];
            if (!cv2) return;
            const ctx2 = cv2.getContext('2d');
            ctx2.setTransform(cv2.clientWidth ? cv2.width / cv2.clientWidth : 1, 0, 0, cv2.clientWidth ? cv2.width / cv2.clientWidth : 1, 0, 0);
            ctx2.clearRect(0, 0, cv2.width, cv2.height);
            // [R14] 载荷走 window 全局表（0.9.3 的 pushData→scene.nativeData 通了，但层 args.data 装配拿不到）
            if (TYPE.indexOf('TT_FLOW') === 0) { paintFlow(TYPE, args, cv2); return; }   // flow 像素画派
            const d = (window.__TT_LAYER_DATA || {})[TYPE];
            if (!d?.items?.length) return;
            const co = args.coords;
            try {
              const s0 = d.items[0];
              window.__PAINT_TRACE = window.__PAINT_TRACE || [];
              if (window.__PAINT_TRACE.length < 3) window.__PAINT_TRACE.push({
                n: d.items.length, x1: co.timeToX(s0.x1), y1: (() => { try { return Y(s0.y1); } catch (e) { return 'Y-ERR ' + e.message; } })(),
                cvW: cv2.width, cw: cv2.clientWidth, transform: ctx2.getTransform().a
              });
            } catch (e) { window.__PAINT_TRACE = window.__PAINT_TRACE || []; window.__PAINT_TRACE.push('trace-err ' + e.message); }
            const sc = args.scale, bd = args.bounds;
            const X = (t) => co.timeToX(t);
            // coords.priceToY 内部读未接线的 scale（.log undefined）会炸——用 scale(min/max)+bounds 手工映射
            const Y = (v) => {
              if (!sc || !bd) return NaN;
              const min = sc.min, max = sc.max;
              if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return NaN;
              let f;
              if (sc.log) {
                const lv = Math.log(Math.max(v, 1e-9));
                const lmin = Math.log(Math.max(min, 1e-9)), lmax = Math.log(Math.max(max, 1e-9));
                f = (lv - lmin) / ((lmax - lmin) || 1);
              } else {
                f = (v - min) / (max - min);
              }
              if (sc.invert) f = 1 - f;
              return bd.top + (1 - f) * bd.height;
            };
            ctx2.font = '10px ui-monospace, Menlo, Consolas, monospace';
            for (const it of d.items) {
              if (it.t === 'box') {
                const x1 = X(it.x1), x2 = X(it.x2), y1 = Y(it.y1), y2 = Y(it.y2);
                if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
                ctx2.fillStyle = it.bg;
                ctx2.fillRect(x1, y1, x2 - x1, y2 - y1);
                ctx2.strokeStyle = it.border;
                ctx2.setLineDash([4, 3]);
                ctx2.lineWidth = 1;
                ctx2.strokeRect(x1, y1, x2 - x1, y2 - y1);
                ctx2.setLineDash([]);
              } else if (it.t === 'line') {
                const x1 = X(it.x1), y1 = Y(it.y1), x2 = X(it.x2), y2 = Y(it.y2);
                if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
                ctx2.strokeStyle = it.color;
                ctx2.lineWidth = it.w;
                ctx2.setLineDash(it.dash);
                ctx2.beginPath(); ctx2.moveTo(x1, y1); ctx2.lineTo(x2, y2); ctx2.stroke();
                ctx2.setLineDash([]);
              } else if (it.t === 'tag') {
                const x = X(it.x), y = Y(it.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                const w = ctx2.measureText(it.text).width + 8;
                ctx2.fillStyle = it.color;
                ctx2.fillRect(x + 4, y - 8, w, 14);
                ctx2.fillStyle = '#0b1a26';
                ctx2.fillText(it.text, x + 8, y + 3);
              }
            }
          };
          return {
            mount(canvas) {
              cv = canvas;
              (window.__LAYER_CV = window.__LAYER_CV || {})[TYPE] = canvas;   // 跨层实例共享（create 会被调多次）
            },
            render(args) {
              window.__M = window.__M || {};
              window.__M.render = (window.__M.render || 0) + 1;
              window.__M.closureCv = !!cv;
              window.__M.winCv = !!(window.__LAYER_CV || {})[TYPE];
              try {
                window.__LAYER_FRAMES = window.__LAYER_FRAMES || {};
                window.__LAYER_FRAMES[TYPE] = (window.__LAYER_FRAMES[TYPE] || 0) + 1;
                paint(args, cv || (window.__LAYER_CV || {})[TYPE]);
                window.__M.paintDone = (window.__M.paintDone || 0) + 1;
              } catch (e) {
                // 早期帧 scale/coords 未就绪会炸——吞掉等下一帧，避免整层被拆
                if (!this._warned) { this._warned = true; console.warn('[vela-smc:layer]', e?.message); }
              }
            }
          };
        }
      });
      n++;
    } catch (e) { console.warn('[vela-smc:layer]', type, e?.message); }
  }
  return n;
}

/* ---------------- FLOW_VP/WALL/DEPTH：像素画派（右缘锚定剖面/订单墙/量差） ----------------
   载荷 = flow 模板的 calc __smc（prof/walls），绘制按语义在层内解析像素：
   右缘 = 画布 CSS 宽 - 价格轴余量；Y = args.scale/bounds 手工映射（R14 同款）。 */
const FLOW_C = { WARN: '#ffc36b', ICE: 'rgba(172,234,255,.9)', BULL: '#5fe3c0', BEAR: '#ff6f85' };

function paintFlow(TYPE, args, cv2) {
  const payload = (window.__TT_FLOW_DATA || {})[TYPE];
  window.__FLOW_TRACE = window.__FLOW_TRACE || [];
  if (window.__FLOW_TRACE.length < 3) window.__FLOW_TRACE.push({ type: TYPE, hasPayload: !!payload, hasSc: !!args.scale, hasBd: !!args.bounds, scMinMax: args.scale ? [Math.round(args.scale.min), Math.round(args.scale.max)] : null, cvW: cv2.width, cw: cv2.clientWidth });
  if (!payload) return;
  const ctx2 = cv2.getContext('2d');
  const dpr = cv2.clientWidth ? cv2.width / cv2.clientWidth : 1;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, cv2.width, cv2.height);
  const W = cv2.clientWidth, H = cv2.clientHeight;
  const sc = args.scale, bd = args.bounds;
  if (!sc || !bd || max(sc) === min(sc)) return;
  const Y = (v) => {
    const lo = sc.min, hi = sc.max;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return NaN;
    let f = (v - lo) / (hi - lo);
    if (sc.log) { const lv = Math.log(Math.max(v, 1e-9)); f = (lv - Math.log(Math.max(lo, 1e-9))) / ((Math.log(Math.max(hi, 1e-9)) - Math.log(Math.max(lo, 1e-9))) || 1); }
    if (sc.invert) f = 1 - f;
    return bd.top + (1 - f) * bd.height;
  };
  const line = (x1, y1, x2, y2, color, dash, w) => {
    ctx2.strokeStyle = color; ctx2.lineWidth = w ?? 1; ctx2.setLineDash(dash || []);
    ctx2.beginPath(); ctx2.moveTo(x1, y1); ctx2.lineTo(x2, y2); ctx2.stroke(); ctx2.setLineDash([]);
  };
  const chip = (x, y, text, color, align = 'left') => {
    ctx2.font = '10px ui-monospace, Menlo, Consolas, monospace';
    const w = ctx2.measureText(text).width + 8;
    const x0 = align === 'right' ? x - w : x;
    ctx2.fillStyle = color; ctx2.fillRect(x0, y - 8, w, 14);
    ctx2.fillStyle = '#0b1a26'; ctx2.fillText(text, x0 + 4, y + 3);
  };
  const axisW = 62;

  if (TYPE === 'TT_FLOW_VP') {
    const { prof, hasVolume } = payload;
    if (!prof?.rows?.length) return;
    const width = Math.min(120, Math.max(70, W * 0.12));
    const xRight = W - axisW;
    const weight = hasVolume ? (r) => r.vol : (r) => r.time;
    for (const r of prof.rows) {
      const y = Y(r.price);
      if (!Number.isFinite(y) || y < 0 || y > H) continue;
      const w = Math.max(1, (weight(r) / prof.max) * width);
      ctx2.fillStyle = r.price === prof.poc ? 'rgba(255,195,107,.75)' : 'rgba(172,234,255,.34)';
      ctx2.fillRect(xRight - w, y - 1.8, w, 3.6);
    }
    for (const [price, label, color] of [[prof.poc, 'POC', FLOW_C.WARN], [prof.vah, 'VAH', FLOW_C.ICE], [prof.val, 'VAL', FLOW_C.ICE]]) {
      const y = Y(price);
      if (!Number.isFinite(y)) continue;
      line(xRight - width - 6, y, xRight, y, color, [4, 3], 1);
      chip(xRight - 2, y - 1, `${label} ${price.toFixed(2)}`, color, 'right');
    }
    chip(xRight, 14, hasVolume ? 'VP·VOL' : 'VP·TIME', 'rgba(190,205,220,.85)', 'right');
  } else if (TYPE === 'TT_FLOW_WALL') {
    const { walls, hasVolume } = payload;
    const x0 = W * 0.46, x1 = W - axisW - (window.__TT_FLOW_DATA?.TT_FLOW_VP ? 112 : 0);
    for (const w of walls || []) {
      const y = Y(w.price);
      if (!Number.isFinite(y) || y < 0 || y > H) continue;
      const color = w.side > 0 ? FLOW_C.BULL : w.side < 0 ? FLOW_C.BEAR : FLOW_C.WARN;
      line(x0, y, x1, y, color, [2, 2], 1.4);
      chip(x0 + 4, y - 8, `WALL ×${w.mult.toFixed(1)}${hasVolume ? '' : ' 触及'}`, color, 'left');
    }
  } else if (TYPE === 'TT_FLOW_DEPTH') {
    const { prof, hasVolume, last } = payload;
    if (!prof?.rows?.length) return;
    const shift = (window.__TT_FLOW_DATA?.TT_FLOW_VP) ? 118 : 0;
    const width = Math.min(90, Math.max(56, W * 0.09));
    const xMid = W - 6 - axisW - shift;
    for (const r of prof.rows) {
      const y = Y(r.price);
      if (!Number.isFinite(y) || y < 0 || y > H) continue;
      const diff = r.up - r.down;
      const w = Math.max(1, (Math.abs(diff) / prof.maxDiff) * width);
      ctx2.fillStyle = diff >= 0 ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)';
      ctx2.fillRect(xMid - w, y - 1.2, w, 2.4);
    }
    line(xMid - width, 4, xMid - width, H - 4, 'rgba(255,255,255,.12)', [], 1);
    if (last != null) {
      const yLast = Y(last);
      if (Number.isFinite(yLast)) {
        line(xMid - width - 4, yLast, xMid, yLast, FLOW_C.WARN, [3, 2], 1);
        chip(xMid - width - 6, yLast, last.toFixed(2), FLOW_C.WARN, 'right');
      }
    }
    chip(xMid, 14, hasVolume ? 'DEPTH·量差' : 'DEPTH·时间差', 'rgba(190,205,220,.85)', 'right');
  }
}
function min(sc) { return sc?.min; }
function max(sc) { return sc?.max; }

/* ---------------- host 侧 SMC 计算（喂给自绘层） ---------------- */
const HOST_THROTTLE = new Map();

/** 主作用域跑 SMC calc → window.__TT_LAYER_DATA（自绘层每帧读它）。
 *  由图表事件（load:end / bar / market:changed）触发，200ms 节流。 */
export function updateSmcLayers(app) {
  if (!app?.chart || typeof window === 'undefined') return;
  if (!app.chart.indicators) return;
  let present;
  try { present = new Set((app.chart.indicators() || []).map(h => h.nativeType).filter(Boolean)); } catch { return; }
  (window.__TT_LAYER_DATA = window.__TT_LAYER_DATA || {});
  let wrote = false;
  for (const tpl of SMC_INDS) {
    if (tpl.name === 'SMC_DASH') continue;          // DOM 面板：不进层
    const type = 'TT_' + tpl.name;
    if (!present.has(type)) continue;               // 未上图：跳过（保留最后载荷，层不画由 add/remove 控制）
    const key = type + ':' + app.periodKey;
    const now = performance.now();
    if (now - (HOST_THROTTLE.get(key) || 0) < 200) continue;
    HOST_THROTTLE.set(key, now);
    const bars = app.bars.allBars().map(b => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
    const params = (tpl.calcParams || []).map(d => d);
    try {
      const rows = tpl.calc(bars, { params, calcParams: params }) || [];
      const payload = rows.__smc || null;
      const items = payload ? smcPayloadToItems(tpl.name, payload, bars.map(b => ({ time: b.timestamp }))) : [];
      if (items.length) { window.__TT_LAYER_DATA[type] = { items }; wrote = true; }
    } catch (e) { console.warn('[vela-smc:host]', tpl.name, e?.message); }
  }
  // FLOW_VP/WALL/DEPTH：像素层载荷（原始 __smc 直接给画派）
  for (const tpl of FLOW_INDS) {
    if (tpl.name === 'FLOW_VOL') continue;
    const type = 'TT_' + tpl.name;
    if (!present.has(type)) continue;
    const key = type + ':' + app.periodKey;
    const now = performance.now();
    if (now - (HOST_THROTTLE.get(key) || 0) < 200) continue;
    HOST_THROTTLE.set(key, now);
    const bars = app.bars.allBars().map(b => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
    const params = (tpl.calcParams || []).map(d => d);
    try {
      const rows = tpl.calc(bars, { params, calcParams: params }) || [];
      const payload = rows.__smc || null;
      if (payload) { (window.__TT_FLOW_DATA = window.__TT_FLOW_DATA || {})[type] = payload; wrote = true; }
    } catch (e) { console.warn('[vela-flow:host]', tpl.name, e?.message); }
  }
  // 载荷更新后主动触发一帧（静态图无数据帧，层不会自发重绘）
  if (wrote) { try { app.chart.resize?.(); } catch {} }
}

/** 图表事件接线（app.mount 后调一次） */
export function wireSmcLayerTriggers(app) {
  const c = app.chart;
  if (!c?.on) return;
  let timer = null;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => updateSmcLayers(app), 200); };
  for (const ev of ['load:end', 'bar', 'market:changed', 'replay:step', 'replay:tick']) {
    try { c.on(ev, kick); } catch {}
  }
  app._smcKick = kick;
  window.__TT_SMC_KICK = kick;   // 面板添加/移除后手动触发
}

/** SMC_FVG/ICT/HTF/MST（DASH 面板与 FLOW_VP/WALL/DEPTH 走像素/DOM 层，后续批次） */
export function registerSmcVelaIndicators() {
  const { registerNativeIndicator } = V() || {};
  if (typeof registerNativeIndicator !== 'function') return 0;
  let n = 0;
  for (const tpl of [...SMC_INDS, ...FLOW_INDS]) {
    if (tpl.name === 'SMC_DASH') continue;                 // DOM 面板：暂缓
    const isSmc = tpl.name.startsWith('SMC_');
    try {
      registerNativeIndicator({
        type: 'TT_' + tpl.name,
        title: tpl.shortName || tpl.name,
        shortTitle: tpl.shortName || tpl.name,
        paneHint: tpl.series === 'price' ? 'price' : 'new',
        overlay: tpl.series === 'price',
        multiInstance: false,
        inputsSchema() {
          return (tpl.calcParams || []).map((def, i) => ({ key: 'p' + i, title: '参数 ' + (i + 1), type: 'number', default: def }));
        },
        defaultInputs() {
          const o = {};
          (tpl.calcParams || []).forEach((d, i) => { o['p' + i] = d; });
          return o;
        },
        create() {
          return {
            start(ctx, inputs) { this._ctx = ctx; this._inputs = inputs; this._run(); },
            onBars() { if (this._ctx) this._run(); },
            _run() {
              const ctx = this._ctx;
              if (!ctx) return;
              const bars = ctx.bars() || [];
              const biz = bars.map(b => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
              const params = (tpl.calcParams || []).map((d, i) => this._inputs?.['p' + i] ?? d);
              let rows = [];
              try { rows = tpl.calc(biz, { params, calcParams: params }) || []; } catch (e) { console.warn('[vela-smc]', tpl.name, e?.message); }
              if (isSmc) {
                // [R14 Tier-1 最终方案] native 实例跑在 worker 作用域（window 写入主页面不可见），
                // 计算+载荷由 host 侧 updateSmcLayers() 承担（见下）；这里只发透明锚 series
                // 撑起 pane 标尺 + 提供图例行。
                const c = biz[biz.length - 1]?.close ?? 0;
                ctx.emit({ series: [{ id: `tt-${tpl.name.toLowerCase()}-anchor`, title: tpl.shortName || tpl.name,
                  kind: 'line',
                  points: [{ time: biz[0]?.time ?? 0, value: c }, { time: biz[biz.length - 1]?.time ?? 0, value: c }],
                  style: { color: 'rgba(0,0,0,0)', width: 1, lineStyle: 'solid' } }] });
                queueHostUpdate();
                return;
              }
              {
                // FLOW_VOL：vu/vd 直方图
                const series = [];
                for (const fig of (tpl.figures || [])) {
                  if (!fig?.key) continue;
                  series.push({
                    id: `tt-${tpl.name.toLowerCase()}-${fig.key}`,
                    title: (fig.title || fig.key).replace(/:\s*/, ''),
                    kind: 'histogram',
                    points: rows.map((r, i) => ({ time: biz[i].time, value: r && r[fig.key] != null ? r[fig.key] : null })),
                    style: { color: (typeof fig.styles === 'function' ? fig.styles() : fig.styles)?.color || '#8adeff', width: 1, lineStyle: 'solid', base: 0 }
                  });
                }
                // 之前这里写的是 out.series = series / ctx.emit(out)，而 out 在该作用域根本没定义
                // → 任何带 figures 的自编指标（FLOW_VOL 等）一算就 ReferenceError，图上什么都不出
                ctx.emit({ series });
              }
            }
          };
        }
      });
      n++;
    } catch (e) { console.warn('[vela-smc:reg]', tpl.name, e?.message); }
  }
  return n;
}

/* ---------------- D7：barstate.isconfirmed → not barstate.islast ---------------- */
/** 主线口径：末根（正在走的那根）不算确认。一行源码替换（P4-a 探针验证，见 COVERAGE §5 #13）。 */
export function preprocessPineV(src) {
  return String(src || '').replace(/barstate\.isconfirmed/g, 'not barstate.islast');
}

/* ---------------- D8：importResolver 接本项目「Pine 库」 ---------------- */
/** import 的 user/name/version → Pine 库条目源码；未命中返回 null（引擎报错原文透传 UI）。 */
export async function resolvePineImport(path) {
  try {
    const libs = await libList();
    const hit = (libs || []).find(x => x.path === path || x.name === path || `local/${x.name}/1` === path);
    if (hit) { const src = hit.src || (await kvGet('pine:lib:' + hit.id))?.src; if (src) return src; }
    const raw = await kvGet('pine:lib');
    const list = Array.isArray(raw) ? raw : [];
    const hit2 = list.find(x => x.path === path || x.name === path);
    return hit2 ? (hit2.src || null) : null;
  } catch { return null; }
}

/* ---------------- Pine 管理器（Vela 版） ---------------- */
/** 公开面 = 旧 pine.js 的 PineManager（apply/list/remove/compute/clear/symbol/findByIndName） */
export class PineManagerV {
  constructor(chart) {
    this.chart = chart;
    this.symbol = null;
    this.items = [];
    this._engine = null;
  }

  /** 注册 Pine 引擎（app.mount 后调一次；D8 resolver 接 Pine 库） */
  async ensureEngine() {
    if (this._engine || !this.chart) return this._engine;
    const { PineEngine } = V() || {};
    if (!PineEngine) return null;
    try {
      this._engine = new PineEngine({
        importResolver: async (path) => await resolvePineImport(path)
      });
      this.chart.registerEngine('pine', this._engine);
    } catch (e) { console.warn('[vela-ind:engine]', e?.message); }
    return this._engine;
  }

  list() { return this.items; }

  /** 编译/上图。entry = {id, name, src, inputs, lineStyles, overlay}，bars 参数兼容旧签名（忽略，Vela 自管数据） */
  async apply(entry) {
    if (!this.chart) return { ok: false, error: '图表未就绪' };
    await this.ensureEngine();
    const src = preprocessPineV(entry.src);
    try {
      const res = await this.chart.runScript(src, {
        id: entry.id || `pine${Date.now().toString(36)}`,
        ...(entry.inputs ? { inputs: entry.inputs } : {})
      });
      if (!res || res.ok === false) {
        return { ok: false, error: (res && (res.error?.message || res.error)) || 'runScript 失败' };
      }
      const names = (res.plots || []).map(p => p.title || p.id).filter(Boolean);
      const item = {
        id: res.id || entry.id,
        name: entry.name || 'PINE 指标',
        indName: 'PINE_' + (res.id || entry.id),
        names,
        overlay: (res.meta?.overlay ?? true),
        series: [],
        title: res.title || entry.name || 'PINE 指标'
      };
      this.items = this.items.filter(x => x.id !== item.id);
      this.items.push(item);
      return { ok: true, names, overlay: item.overlay, title: item.title, plots: res.plots || null, alerts: res.alerts || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  /** 旧接口兼容：先编译返回元数据（不上图也可复用 apply） */
  async compute(entry) { return this.apply(entry); }

  async remove(id) {
    try {
      const h = (this.chart.indicators?.() || []).find(x => x.id === id);
      if (h) await h.remove?.();
    } catch {}
    this.items = this.items.filter(x => x.id !== id);
  }

  async clear() { for (const it of [...this.items]) await this.remove(it.id); }

  findByIndName(name) { return this.items.find(x => x.indName === name) || null; }
}
