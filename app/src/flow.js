// 订单流四件套：成交量 / 综合 VP（成交量分布）/ 订单墙 / 挂单深度（成交差）
// 数据前提：本应用只有 OHLCV（无逐笔、无 L2）。所以：
//  - 有成交量（Binance 这类）→ 按真实 volume 算；
//  - 无量（多数外汇/金属源 volume=0）→ 自动退化成「价格停留时间 / 触及次数」，并在图例与画面上标明口径。
// 真实挂单墙、盘口深度需要逐笔与 L2 数据，这里用「成交量/成交差」的可算代理，不做假的盘口数字。
import { px, py, visibleIdx, inView, payloadOf, stash, drawLine, drawTag, atr, bucket } from './smc.js';

const BULL = '#5fe3c0';
const BEAR = '#ff6f85';
const ICE = '#aceaff';
const WARN = '#ffc36b';

/** 同一张图上是否也开了别的订单流面板（VP 与 DEPTH 都要贴右边时要错开） */
const hasInd = (chart, name) => (chart?.getIndicators?.() || []).some(i => i.name === name);

/** 带底色的标签，压在 K 线/直方图上也能看清 */
function chip(ctx, x, y, text, color, align = 'right') {
  if (x == null || y == null) return;
  ctx.save();
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  const w = ctx.measureText(text).width + 8;
  const bx = align === 'right' ? x - w : x;
  ctx.fillStyle = 'rgba(6,12,20,.78)';
  ctx.fillRect(bx, y - 7, w, 14);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, y - 6.5, w - 1, 13);
  ctx.fillStyle = color;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 4, y);
  ctx.restore();
}

const MEDIAN = (arr) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** 价格分桶：按视觉需要选一个“好看的”步长 */
function niceStep(span, target = 60) {
  const raw = span / Math.max(6, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * pow;
}

/** 把一段 K 线按价格分桶统计：成交量 / 停留时间 / 触及次数 / 买卖成交差 */
function profile(list, from, to, step, hasVolume) {
  const rows = new Map();
  const add = (bucketPrice, vol, time, up, down, touch) => {
    const k = Math.round(bucketPrice / step) * step;
    const r = rows.get(k) || { price: k, vol: 0, time: 0, up: 0, down: 0, touch: 0 };
    r.vol += vol; r.time += time; r.up += up; r.down += down; r.touch += touch;
    rows.set(k, r);
  };
  for (let i = Math.max(0, from); i <= Math.min(list.length - 1, to); i++) {
    const b = list[i];
    const lo = Math.min(b.open, b.close), hi = Math.max(b.open, b.close);
    const up = b.close >= b.open;
    const steps = Math.max(1, Math.round((b.high - b.low) / step) || 1);
    const per = (b.high - b.low) / steps;
    for (let s = 0; s < steps; s++) {
      const p = b.low + per * (s + 0.5);
      const inBody = p >= lo && p <= hi;
      const vol = hasVolume ? (b.volume || 0) / steps * (inBody ? 1.6 : 1) : 0;
      add(p, vol, 1 / steps * (inBody ? 1.6 : 1), hasVolume ? 0 : (up ? 1 : 0), hasVolume ? 0 : (up ? 0 : 1), 1);
    }
    if (hasVolume) {
      const v = b.volume || 0;
      add((b.high + b.low) / 2, 0, 0, up ? v : 0, up ? 0 : v, 0);
    }
  }
  const out = [...rows.values()].sort((a, b) => b.price - a.price);
  const weight = (r) => (hasVolume ? r.vol : r.time);
  const total = out.reduce((s, r) => s + weight(r), 0) || 1;
  const poc = out.reduce((best, r) => (weight(r) > weight(best) ? r : best), out[0] || { price: 0 });
  // 价值区：从 POC 向两侧扩到 70%
  let acc = weight(poc), up = true;
  let loIdx = out.indexOf(poc), hiIdx = loIdx;
  while (acc / total < 0.7 && (loIdx > 0 || hiIdx < out.length - 1)) {
    const nextLo = loIdx > 0 ? weight(out[loIdx - 1]) : -1;
    const nextHi = hiIdx < out.length - 1 ? weight(out[hiIdx + 1]) : -1;
    if (nextHi >= nextLo) { hiIdx++; acc += nextHi; } else { loIdx--; acc += nextLo; }
    up = !up;
  }
  return {
    rows: out,
    max: out.reduce((m, r) => Math.max(m, weight(r)), 0) || 1,
    maxDiff: out.reduce((m, r) => Math.max(m, Math.abs(r.up - r.down)), 0) || 1,
    total,
    poc: poc.price,
    vah: out[Math.max(0, loIdx)]?.price ?? poc.price,
    val: out[Math.min(out.length - 1, hiIdx)]?.price ?? poc.price,
    weight
  };
}

/* ------------------------------ 1. 成交量 ------------------------------ */

const VOL = {
  name: 'FLOW_VOL',
  shortName: '成交量',
  series: 'normal',
  precision: 2,
  figures: [
    { key: 'vu', title: '量▲ ', type: 'bar', baseValue: 0, styles: () => ({ color: BULL }) },
    { key: 'vd', title: '量▼ ', type: 'bar', baseValue: 0, styles: () => ({ color: BEAR }) }
  ],
  calc: (list) => {
    const hasVolume = list.some(b => (b.volume || 0) > 0);
    const result = list.map(b => (b.close >= b.open
      ? { vu: b.volume || 0, vd: null }
      : { vu: null, vd: b.volume || 0 }));
    return stash(list, result, { name: VOL.name, hasVolume, n: list.length });
  },
  draw: ({ ctx, indicator }) => {
    const p = payloadOf(indicator);
    if (p && !p.hasVolume) {
      // 子面板里 bounding.top 是容器坐标（≈几百），画布只有 100 高 → 必须用画布本地坐标
      drawTag(ctx, 8, 16, '当前数据源没有成交量（volume=0）：换成加密/有量的数据源才有柱',
        'rgba(190,205,220,.75)', 'left');
    }
    return true;
  }
};

/* ---------------------------- 2. 综合 VP ---------------------------- */

const VP = {
  name: 'FLOW_VP',
  shortName: '综合VP',
  series: 'price',
  precision: 2,
  calcParams: [600],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const n = Math.max(60, Math.min(5000, Number(indicator.calcParams?.[0]) || 600));
    const from = Math.max(0, list.length - n);
    const hasVolume = list.slice(from).some(b => (b.volume || 0) > 0);
    const span = Math.max(1e-9, (list[list.length - 1]?.high ?? 1) - Math.min(...list.slice(from).map(b => b.low)));
    const prof = profile(list, from, list.length - 1, niceStep(span, 70), hasVolume);
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: VP.name, prof, hasVolume, n: list.length, from });
  },
  draw: ({ ctx, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const view = visibleIdx(xAxis, bounding);
    const { prof, hasVolume } = p;
    if (!view || !prof.rows.length) return true;
    const H = ctx.canvas.height;
    const width = Math.min(120, Math.max(70, bounding.width * 0.12));
    const xRight = bounding.width - 8;
    const weight = hasVolume ? (r) => r.vol : (r) => r.time;
    for (const r of prof.rows) {
      const y = py(yAxis, r.price);
      if (y == null || y < 0 || y > H) continue;
      const w = Math.max(1, (weight(r) / prof.max) * width);
      const isPoc = r.price === prof.poc;
      ctx.save();
      ctx.fillStyle = isPoc ? 'rgba(255,195,107,.75)' : 'rgba(172,234,255,.34)';
      ctx.fillRect(xRight - w, y - 1.8, w, 3.6);
      ctx.restore();
    }
    const dash = [4, 3];
    for (const [price, label, color] of [[prof.poc, 'POC', WARN], [prof.vah, 'VAH', ICE], [prof.val, 'VAL', ICE]]) {
      const y = py(yAxis, price);
      drawLine(ctx, xRight - width - 6, y, xRight, y, color, dash, 1);
      chip(ctx, xRight - 2, y - 1, `${label} ${price.toFixed(2)}`, color, 'right');
    }
    chip(ctx, xRight, 14, hasVolume ? 'VP·VOL' : 'VP·TIME', 'rgba(190,205,220,.85)', 'right');
    return true;
  }
};

/* ---------------------------- 3. 订单墙 ---------------------------- */

const WALL = {
  name: 'FLOW_WALL',
  shortName: '订单墙',
  series: 'price',
  precision: 2,
  calcParams: [4],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const k = Math.max(2, Math.min(12, Number(indicator.calcParams?.[0]) || 4));
    const n = Math.min(list.length, 1200);
    const from = list.length - n;
    const slice = list.slice(from);
    const vols = slice.map(b => b.volume || 0).filter(v => v > 0);
    const hasVolume = vols.length > slice.length * 0.6;
    const walls = [];

    if (hasVolume) {
      const med = MEDIAN(vols) || 1;
      for (let i = from; i < list.length; i++) {
        const v = list[i].volume || 0;
        if (v >= med * k) {
          const price = (list[i].high + list[i].low) / 2;
          walls.push({ i, price, mult: v / med, side: list[i].close >= list[i].open ? 1 : -1, kind: 'VOL' });
        }
      }
    } else {
      // 无量：用「同一价位被反复触及」当流动性簇的代理
      const span = Math.max(1e-9, Math.max(...slice.map(b => b.high)) - Math.min(...slice.map(b => b.low)));
      const step = niceStep(span, 90);
      const hits = new Map();
      for (let i = from; i < list.length; i++) {
        const b = list[i];
        for (const price of [b.high, b.low]) {
          const k2 = Math.round(price / step) * step;
          const h = hits.get(k2) || { price: k2, n: 0, last: i };
          h.n++; h.last = i;
          hits.set(k2, h);
        }
      }
      const avg = [...hits.values()].reduce((s, h) => s + h.n, 0) / Math.max(1, hits.size);
      for (const h of [...hits.values()].sort((a, b) => b.n - a.n).slice(0, 6)) {
        if (h.n >= Math.max(3, avg * k * 0.5)) walls.push({ i: h.last, price: h.price, mult: h.n / Math.max(1, avg), side: 0, kind: 'TOUCH' });
      }
    }
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: WALL.name, walls: walls.slice(-10), hasVolume, n: list.length });
  },
  draw: ({ ctx, chart, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const view = visibleIdx(xAxis, bounding);
    const last = p.n - 1;
    for (const w of p.walls) {
      if (!inView(view, w.i, last)) continue;
      const y = py(yAxis, w.price);
      if (y == null || y < 0 || y > ctx.canvas.height) continue;
      const color = w.side > 0 ? BULL : w.side < 0 ? BEAR : WARN;
      const x0 = bounding.width * 0.46;
      const x1 = bounding.width - (hasInd(chart, 'FLOW_VP') ? 126 : hasInd(chart, 'FLOW_DEPTH') ? 100 : 14);
      drawLine(ctx, x0, y, x1, y, color, [2, 2], 1.4);
      chip(ctx, x0 + 4, y - 8, `WALL ×${w.mult.toFixed(1)}${p.hasVolume ? '' : ' 触及'}`, color, 'left');
    }
    return true;
  }
};

/* ------------------------ 4. 挂单深度（成交差） ------------------------ */

const DEPTH = {
  name: 'FLOW_DEPTH',
  shortName: '挂单深度',
  series: 'price',
  precision: 2,
  calcParams: [120],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const n = Math.max(30, Math.min(1200, Number(indicator.calcParams?.[0]) || 120));
    const from = Math.max(0, list.length - n);
    const hasVolume = list.slice(from).some(b => (b.volume || 0) > 0);
    const last = list[list.length - 1];
    const span = Math.max(1e-9, Math.max(...list.slice(from).map(b => b.high)) - Math.min(...list.slice(from).map(b => b.low)));
    const step = niceStep(span, 44);
    const prof = profile(list, from, list.length - 1, step, hasVolume);
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: DEPTH.name, prof, hasVolume, last: last?.close ?? null, n: list.length, from });
  },
  draw: ({ ctx, chart, bounding, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const H = ctx.canvas.height;
    const shift = hasInd(chart, 'FLOW_VP') ? 118 : 0;
    const width = Math.min(90, Math.max(56, bounding.width * 0.09));
    const xMid = bounding.width - 6 - shift;
    for (const r of p.prof.rows) {
      const y = py(yAxis, r.price);
      if (y == null || y < 0 || y > ctx.canvas.height) continue;
      const diff = r.up - r.down;
      const w = Math.max(1, (Math.abs(diff) / p.prof.maxDiff) * width);
      ctx.save();
      ctx.fillStyle = diff >= 0 ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)';
      ctx.fillRect(diff >= 0 ? xMid - w : xMid - w, y - 1.2, w, 2.4);
      ctx.restore();
    }
    drawLine(ctx, xMid - width, 4, xMid - width, H - 4, 'rgba(255,255,255,.12)', [], 1);
    const yLast = p.last != null ? py(yAxis, p.last) : null;
    if (yLast != null) {
      drawLine(ctx, xMid - width - 4, yLast, xMid, yLast, WARN, [3, 2], 1);
      chip(ctx, xMid - width - 6, yLast, p.last.toFixed(2), WARN, 'right');
    }
    chip(ctx, xMid, 14, p.hasVolume ? 'DEPTH·量差' : 'DEPTH·时间差', 'rgba(190,205,220,.85)', 'right');
    return true;
  }
};

export const FLOW_INDS = [VOL, VP, WALL, DEPTH];

let _done = false;
export function registerFlowIndicators(K) {
  if (_done || !K?.registerIndicator) return 0;
  let n = 0;
  for (const tpl of FLOW_INDS) {
    try { K.registerIndicator(tpl); n++; } catch (e) { console.warn('[flow]', tpl.name, e?.message); }
  }
  _done = true;
  return n;
}
