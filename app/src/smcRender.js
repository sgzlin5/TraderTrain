// SMC 指标的“可见层”：klinecharts v10 不再调用 indicator.draw，
// 所以结构图形全部改由 overlay 渲染，面板类改由 DOM 渲染。
// 每个指标一套 overlay 池，用 payload 签名判断是否重建；指标摘掉自动清场。
import { payloadOf } from './smc.js';

const BULL = '#5fe3c0';
const BEAR = '#ff6f85';
const WARN = '#ffc36b';
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

/** poolName -> { ids: [], sig: '' } */
const POOLS = Object.create(null);
let timer = null;

const pool = (name) => (POOLS[name] ||= { ids: [], sig: '' });

function dropPool(chart, name) {
  const p = POOLS[name];
  if (!p) return;
  for (const id of p.ids) { try { chart.removeOverlay({ id }); } catch {} }
  p.ids = [];
  p.sig = '';
}

/* ------------------------------- 画图小工具 ------------------------------- */

const mk = (chart, collect) => (args) => {
  try {
    const id = chart.createOverlay({ lock: true, visible: true, zLevel: 3, ...args });
    if (id) collect.push(id);
  } catch (e) { /* 单个元素失败不影响其它 */ }
};

const hline = (add, ts1, ts2, price, color, style = 'dashed', size = 1) =>
  add({ name: 'horizontalSegment', points: [{ timestamp: ts1, value: price }, { timestamp: ts2 }], styles: { line: { color, size, style } } });

const rect = (add, ts1, v1, ts2, v2, fill, stroke) =>
  add({ name: 'rect', points: [{ timestamp: ts1, value: v1 }, { timestamp: ts2, value: v2 }], zLevel: 2,
        styles: { polygon: { color: fill, borderColor: stroke, borderSize: 1, borderStyle: 'dashed' } } });

const tag = (add, ts, price, text, color, z = 4) =>
  // 注意：simpleAnnotation 的文本来自 extendData，styles.text.text 不会渲染（实测）
  add({ name: 'simpleAnnotation', points: [{ timestamp: ts, value: price }], zLevel: z,
        extendData: String(text),
        styles: { text: { color, size: 10, family: FONT, backgroundColor: 'rgba(6,12,20,.72)' } } });

/* -------------------------------- 各指标绘制 -------------------------------- */

/** FVG / IFVG：缺口矩形 + 标签 */
function drawFvg(chart, list, p, collect) {
  const add = mk(chart, collect);
  const ts = (i) => list[Math.max(0, Math.min(list.length - 1, i))]?.timestamp;
  const lastI = p.n ? p.n - 1 : list.length - 1;
  for (const z of p.zones || []) {
    const bull = z.inverse ? z.dir === -1 : z.dir === 1;
    const c = bull ? BULL : BEAR;
    rect(add, ts(z.from), z.top, ts(z.closed != null ? z.closed : lastI), z.bottom,
      bull ? 'rgba(95,227,192,.10)' : 'rgba(255,111,133,.10)',
      bull ? 'rgba(95,227,192,.45)' : 'rgba(255,111,133,.45)');
    tag(add, ts(z.from), Math.min(z.top, z.bottom), z.inverse ? 'IFVG' : 'FVG', c);
  }
}

/** ICT 杀区：整根竖带（用可见价格范围撑满）+ 未填补 FVG */
function drawIct(chart, list, p, collect) {
  const add = mk(chart, collect);
  const ts = (i) => list[Math.max(0, Math.min(list.length - 1, i))]?.timestamp;
  let lo = Infinity, hi = -Infinity;
  for (const b of list) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
  const pad = (hi - lo) * 0.04 || 1;
  for (const z of p.zones || []) {
    rect(add, ts(z.from), hi + pad, ts(z.to + 1), lo - pad, z.color, 'transparent');
    tag(add, ts(z.from + 1), hi + pad, z.label, 'rgba(205,218,230,.9)', 5);
  }
  const lastI = p.n ? p.n - 1 : list.length - 1;
  for (const z of p.fvgs || []) {
    const bull = z.dir === 1;
    rect(add, ts(z.from), z.top, ts(lastI), z.bottom,
      bull ? 'rgba(95,227,192,.12)' : 'rgba(255,111,133,.12)',
      bull ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)');
  }
}

/** 波段 & 中期结构：摆动线 + BOS/CHoCH + 订单块 */
function drawHtf(chart, list, p, collect) {
  const add = mk(chart, collect);
  const ts = (i) => list[Math.max(0, Math.min(list.length - 1, i))]?.timestamp;
  const lastI = p.n ? p.n - 1 : list.length - 1;
  for (const s of p.swings || []) {
    const c = s.type === 'H' ? 'rgba(255,111,133,.55)' : 'rgba(95,227,192,.55)';
    hline(add, ts(s.i), ts(lastI), s.price, c, 'dotted', 1);
    tag(add, ts(s.i), s.price, `${p.hours}H ${s.type === 'H' ? 'SH' : 'SL'}`, c);
  }
  for (const e of p.events || []) {
    const c = e.dir === 1 ? BULL : BEAR;
    hline(add, ts(e.from), ts(e.i), e.price, c, 'dashed', 1.4);
    tag(add, ts(e.i), e.price, `${p.hours}H ${e.kind}`, c);
    if (e.ob) {
      const to = e.ob.to != null ? e.ob.to : lastI;
      rect(add, ts(e.ob.from), e.ob.top, ts(to), e.ob.bottom,
        e.ob.dir === 1 ? 'rgba(95,227,192,.10)' : 'rgba(255,111,133,.10)',
        e.ob.dir === 1 ? 'rgba(95,227,192,.4)' : 'rgba(255,111,133,.4)');
    }
  }
}

/** 聪明钱概念：BOS/CHoCH + 订单块 + EQH/EQL */
function drawMst(chart, list, p, collect) {
  const add = mk(chart, collect);
  const ts = (i) => list[Math.max(0, Math.min(list.length - 1, i))]?.timestamp;
  const lastI = p.n ? p.n - 1 : list.length - 1;
  for (const e of p.events || []) {
    const c = e.dir > 0 ? BULL : BEAR;
    hline(add, ts(e.from), ts(e.i), e.price, c, 'dashed', 1);
    tag(add, ts(e.i), e.price, e.kind, c);
    if (e.ob) {
      const to = e.ob.to != null ? e.ob.to : lastI;
      rect(add, ts(e.ob.from), e.ob.top, ts(to), e.ob.bottom,
        e.ob.dir > 0 ? 'rgba(95,227,192,.14)' : 'rgba(255,111,133,.14)',
        e.ob.dir > 0 ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)');
      tag(add, ts(e.ob.from), e.ob.top, 'OB', e.ob.dir > 0 ? BULL : BEAR);
    }
  }
  for (const q of p.eq || []) {
    hline(add, ts(q.from), ts(q.to != null ? q.to : lastI), q.price, WARN, 'dashed', 1);
    tag(add, ts(q.from), q.price, q.type === 'H' ? 'EQH' : 'EQL', WARN);
  }
}

/* ---------------------------------- 同步 ---------------------------------- */

const PAINTERS = {
  SMC_FVG: { pool: 'fvg', fn: drawFvg, sig: (p) => JSON.stringify((p.zones || []).map(z => [z.from, z.to, z.closed, z.inverse, z.top, z.bottom])) },
  SMC_MST: { pool: 'mst', fn: drawMst, sig: (p) => JSON.stringify({ n: p.n, ev: (p.events || []).map(e => [e.kind, e.from, e.i, !!e.ob]), eq: (p.eq || []).map(q => [q.type, q.price, q.from]) }) },
  SMC_ICT: { pool: 'ict', fn: drawIct, sig: (p) => JSON.stringify({ z: (p.zones || []).map(z => [z.key, z.from, z.to]), f: (p.fvgs || []).map(z => [z.from, z.top, z.bottom]) }) },
  SMC_HTF: { pool: 'htf', fn: drawHtf, sig: (p) => JSON.stringify({ s: (p.swings || []).map(s => [s.type, s.i, s.price]), e: (p.events || []).map(e => [e.kind, e.from, e.i, e.price, !!e.ob]) }) }
};

/** 每 1.2 s 同步一次（指标增删 / 数据推进都会反映出来） */
export function startSmcRender(state) {
  if (timer) return;
  const run = () => {
    const chart = state.app?.chart;
    if (!chart) return;
    let list = [];
    try { list = chart.getDataList() || []; } catch { return; }
    const seen = new Set();
    try {
      for (const ind of chart.getIndicators() || []) {
        const name = ind.name;
        const conf = PAINTERS[name];
        if (!conf) continue;
        seen.add(name);
        const p = payloadOf(ind);
        if (!p || !list.length) continue;
        const sig = conf.sig(p);
        const pl = pool(conf.pool);
        if (sig !== pl.sig) {
          dropPool(chart, conf.pool);
          const collect = [];
          conf.fn(chart, list, p, collect);
          pl.ids = collect;
          pl.sig = sig;
        }
      }
    } catch (e) { console.warn('[smc] 同步失败', e?.message); }

    // 摘掉的指标 → 清场
    for (const [name, conf] of Object.entries(PAINTERS)) {
      if (!seen.has(name)) dropPool(chart, conf.pool);
    }
  };
  run();
  timer = setInterval(run, 1200);
}

export function stopSmcRender() {
  if (timer) { clearInterval(timer); timer = null; }
}
