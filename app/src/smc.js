// SMC / ICT 指标：FVG·IFVG、聪明钱概念（BOS/CHoCH/OB/EQH·EQL）、ICT 杀区、波段与中期结构
// 口径参考 LuxAlgo Smart Money Concepts / ICT Killzones 这一类开源 Pine 脚本，用 K 线 OHLC 自算，
// 不依赖任何 Pine 运行时。绘制用 indicator 的 draw 回调（实测：模板必须至少有一个 figure，否则 draw 不会被调用）
const BULL = '#5fe3c0';
const BEAR = '#ff6f85';
const ICE = '#aceaff';
const WARN = '#ffc36b';
const DAY = 86400000;
const HOUR = 3600000;

/* ---------------------------------- 工具 ---------------------------------- */

/** 拆成各自独立的一根柱子时间桶（用于把 1m 聚合成 1h 等） */
function bucket(list, span) {
  const out = [];
  let cur = null;
  for (const b of list) {
    const k = Math.floor(b.timestamp / span);
    if (!cur || cur.k !== k) {
      cur = { k, timestamp: k * span, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, i0: out.length };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
    }
  }
  return out;
}

/** 摆动点：左右各 lb 根都不超过它 */
function pivots(list, lb) {
  const out = [];
  for (let i = lb; i < list.length - lb; i++) {
    let hi = true, lo = true;
    for (let k = i - lb; k <= i + lb; k++) {
      if (k === i) continue;
      if (list[k].high >= list[i].high) hi = false;
      if (list[k].low <= list[i].low) lo = false;
      if (!hi && !lo) break;
    }
    if (hi) out.push({ i, price: list[i].high, type: 'H' });
    if (lo) out.push({ i, price: list[i].low, type: 'L' });
  }
  return out;
}

/** 简易 ATR（用 SMA 近似，够做容差） */
function atr(list, n = 14) {
  if (!list.length) return 0;
  let sum = 0, cnt = 0;
  for (let i = 1; i < list.length && cnt < n; i++, cnt++) sum += Math.max(list[i].high - list[i].low, Math.abs(list[i].high - list[i - 1].close));
  return cnt ? sum / cnt : list[0].high - list[0].low;
}

/** FVG：第 i 根与第 i-2 根之间的缺口；返回原始区间（未处理填补） */
function findFvgs(list) {
  const zones = [];
  for (let i = 2; i < list.length; i++) {
    const a = list[i - 2], c = list[i];
    if (c.low > a.high) zones.push({ dir: 1, top: c.low, bottom: a.high, from: i - 2, to: i });
    else if (c.high < a.low) zones.push({ dir: -1, top: a.low, bottom: c.high, from: i - 2, to: i });
  }
  return zones;
}

/** 回填：被完全填补 → 记为 inverse（IFVG）；inverse 再被反向吃掉 → 关闭 */
function resolveFvgs(zones, list) {
  for (const z of zones) {
    for (let i = z.to + 1; i < list.length; i++) {
      const b = list[i];
      const touched = z.dir === 1 ? b.low <= z.bottom : b.high >= z.top;
      if (!touched) continue;
      if (!z.touched) { z.touched = i; }
      const eaten = z.dir === 1 ? b.close < z.bottom : b.close > z.top;
      if (eaten && !z.filled) { z.filled = i; z.inverse = true; z.flip = i; }
      if (z.inverse) {
        const back = z.dir === 1 ? b.close > z.top : b.close < z.bottom;
        if (back) { z.closed = i; break; }
      }
    }
  }
  return zones;
}

/** 订单块：突破前最后一根反向 K 线（多头取最后一根阴线） */
function findOb(list, from, to, dir) {
  for (let i = to; i >= from; i--) {
    const b = list[i];
    if (dir === 1 ? b.close < b.open : b.close > b.open) return { dir, top: b.high, bottom: b.low, from: i, to: null };
  }
  return null;
}

/** 结构：BOS / CHoCH 序列 */
function structure(list, lb) {
  const pv = pivots(list, lb);
  const events = [];
  let lastH = null, lastL = null, trend = 0;
  for (let i = 0; i < list.length; i++) {
    while (pv.length && pv[0].i + lb <= i) {
      const p = pv.shift();
      if (p.type === 'H') lastH = p; else lastL = p;
    }
    const b = list[i];
    if (lastH && b.close > lastH.price) {
      events.push({ i, price: lastH.price, dir: 1, kind: trend === -1 ? 'CHoCH' : 'BOS', from: lastH.i });
      trend = 1; lastH = null;
    } else if (lastL && b.close < lastL.price) {
      events.push({ i, price: lastL.price, dir: -1, kind: trend === 1 ? 'CHoCH' : 'BOS', from: lastL.i });
      trend = -1; lastL = null;
    }
  }
  return { events, pivots: pv, trend };
}

/* ------------------------------ 绘制工具 ------------------------------ */

function px(xAxis, i) {
  const v = xAxis.convertToPixel(i);
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function py(yAxis, price) {
  const v = yAxis.convertToPixel(price);
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** 反推当前可见的数据下标区间（draw 里没有 visibleRange，用两点采样求斜率） */
function visibleIdx(xAxis, bounding) {
  const p0 = px(xAxis, 0), p1 = px(xAxis, 1);
  if (p0 == null || p1 == null) return null;
  const step = p1 - p0;
  if (!step) return null;
  return { from: Math.floor((0 - p0) / step) - 2, to: Math.ceil((bounding.width - p0) / step) + 2 };
}

/** 形状与可见区间有交集才画 */
function inView(v, from, to) {
  if (!v) return true;
  return to >= v.from && from <= v.to;
}

function drawRect(ctx, x1, y1, x2, y2, fill, stroke) {
  if ([x1, y1, x2, y2].some(v => v == null)) return;
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  ctx.save();
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) {
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  ctx.restore();
}

function drawLine(ctx, x1, y1, x2, y2, color, dash = [4, 3], width = 1) {
  if ([x1, y1, x2, y2].some(v => v == null)) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, x, y, text, color, align = 'left') {
  if (x == null || y == null) return;
  ctx.save();
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** draw 里拿不到 dataList：calc 把结果挂在 result 上，这里回读（挂不上就退回按名字缓存） */
const _cache = new Map();
function payloadOf(indicator) {
  const r = indicator?.result;
  if (r && r.__smc) return r.__smc;
  return _cache.get(indicator?.name) || null;
}
function stash(list, result, payload) {
  result.__smc = payload;
  try { _cache.set(payload.name, payload); } catch {}
  return result;
}

/* ------------------------------ 1. FVG / IFVG ------------------------------ */

const FVG = {
  name: 'SMC_FVG',
  shortName: 'FVG/IFVG',
  series: 'price',
  precision: 2,
  calcParams: [8],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const maxN = Math.max(2, Math.min(20, Number(indicator.calcParams?.[0]) || 8));
    const zones = resolveFvgs(findFvgs(list), list)
      .filter(z => z.to >= list.length - 600)
      .slice(-maxN);
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: FVG.name, zones, n: list.length });
  },
};

/* --------------------------- 2. 聪明钱概念 SMC --------------------------- */

const MST = {
  name: 'SMC_MST',
  shortName: 'SMC',
  series: 'price',
  precision: 2,
  calcParams: [5],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const lb = Math.max(2, Math.min(20, Number(indicator.calcParams?.[0]) || 5));
    const { events } = structure(list, lb);
    const pv = pivots(list, lb);
    const tol = atr(list) * 0.15;

    // 只留最近的结构事件 + 对应订单块
    const recent = events.slice(-8).map(e => {
      const ob = findOb(list, Math.max(0, e.from), e.i, e.dir);
      if (ob) {
        for (let k = e.i; k < list.length; k++) {
          if (ob.dir === 1 ? list[k].low <= ob.top : list[k].high >= ob.bottom) { ob.to = k; break; }
        }
      }
      return { ...e, ob };
    });

    // EQH / EQL：同型摆动点价格接近
    const eq = [];
    for (let i = 1; i < pv.length; i++) {
      const a = pv[i - 1], b = pv[i];
      if (a.type === b.type && Math.abs(a.price - b.price) <= tol) eq.push({ type: b.type, price: (a.price + b.price) / 2, from: a.i, to: b.i });
    }

    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: MST.name, events: recent, eq: eq.slice(-6), n: list.length });
  },
};

/* ---------------------------- 3. ICT 杀区工具箱 ---------------------------- */

// 时间窗按 UTC（本地数据源是以 UTC 存的）：亚洲 00:00-04:00 / 伦敦 07:00-10:00 / 纽约早盘 12:30-15:00 / 纽约午盘 17:30-20:00
const KILLZONES = [
  { label: 'ASIA', from: 0, to: 4, color: 'rgba(160,170,200,.14)' },
  { label: 'LONDON', from: 7, to: 10, color: 'rgba(172,234,255,.13)' },
  { label: 'NY AM', from: 12.5, to: 15, color: 'rgba(255,195,107,.13)' },
  { label: 'NY PM', from: 17.5, to: 20, color: 'rgba(255,111,133,.12)' }
];

const ICT = {
  name: 'SMC_ICT',
  shortName: 'ICT 杀区',
  series: 'price',
  precision: 2,
  calcParams: [1],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    // 把可见区间按天切成杀区窗口（只针对最后一屏数据，避免几百个矩形）
    const n = list.length;
    const start = Math.max(0, n - 900);
    const zones = [];
    let day = null;
    for (let i = start; i < n; i++) {
      const ts = list[i].timestamp;
      const d = Math.floor(ts / DAY) * DAY;
      const h = (ts - d) / HOUR;
      for (const kz of KILLZONES) {
        if (h >= kz.from && h < kz.to) {
          const key = d + '|' + kz.label;
          const lastZ = zones[zones.length - 1];
          if (lastZ && lastZ.key === key) lastZ.to = i;
          else zones.push({ key, label: kz.label, color: kz.color, from: i, to: i, day: d });
        }
      }
      day = d;
    }
    const fvgs = resolveFvgs(findFvgs(list), list).filter(z => z.to >= n - 300 && !z.closed).slice(-4);
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: ICT.name, zones: zones.slice(-12), fvgs, n });
  },
};

/* -------------------------- 4. 波段与中期结构（HTF） -------------------------- */

const HTF = {
  name: 'SMC_HTF',
  shortName: '结构波段',
  series: 'price',
  precision: 2,
  calcParams: [1],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const hours = Math.max(1, Math.min(24, Number(indicator.calcParams?.[0]) || 1));
    const htf = bucket(list, hours * HOUR);
    const { events } = structure(htf, 3);
    const pv = pivots(htf, 3);
    // HTF 时间 → 当前周期 index
    const tsToIndex = (ts) => {
      let lo = 0, hi = list.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].timestamp <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    const swings = pv.slice(-6).map(p => ({ type: p.type, price: p.price, i: tsToIndex(htf[p.i].timestamp) }));
    const lastEv = events.slice(-3).map(e => ({
      kind: e.kind, dir: e.dir, price: e.price,
      from: tsToIndex(htf[e.from].timestamp), i: tsToIndex(htf[e.i].timestamp),
      ob: (() => {
        const ob = findOb(htf, Math.max(0, e.from), e.i, e.dir);
        if (!ob) return null;
        for (let k = e.i; k < htf.length; k++) {
          if (ob.dir === 1 ? htf[k].low <= ob.top : htf[k].high >= ob.bottom) { ob.to = k; break; }
        }
        return { ...ob, from: tsToIndex(htf[ob.from].timestamp), to: ob.to != null ? tsToIndex(htf[ob.to].timestamp) : null };
      })()
    }));
    const result = list.map(() => ({ v: null }));
    return stash(list, result, { name: HTF.name, hours, swings, events: lastEv, n: list.length });
  },
};

export const SMC_INDS = [FVG, MST, ICT, HTF];
export { px, py, visibleIdx, inView, payloadOf, stash, drawRect, drawLine, drawTag, atr, bucket, DAY, HOUR };

let _done = false;
export function registerSmcIndicators(K) {
  if (_done || !K?.registerIndicator) return 0;
  let n = 0;
  for (const tpl of SMC_INDS) {
    try { K.registerIndicator(tpl); n++; } catch (e) { console.warn('[smc]', tpl.name, e?.message); }
  }
  _done = true;
  return n;
}
