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
  draw: ({ ctx, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const last = p.n - 1;
    const view = visibleIdx(xAxis, bounding);
    for (const z of p.zones) {
      if (!inView(view, z.from, z.closed != null ? z.closed : last)) continue;
      const bull = z.inverse ? z.dir === -1 : z.dir === 1;
      const color = bull ? BULL : BEAR;
      const x1 = px(xAxis, z.from);
      const x2 = px(xAxis, z.closed != null ? z.closed : last);
      const y1 = py(yAxis, z.top), y2 = py(yAxis, z.bottom);
      drawRect(ctx, x1, y1, x2, y2, bull ? 'rgba(95,227,192,.10)' : 'rgba(255,111,133,.10)', bull ? 'rgba(95,227,192,.45)' : 'rgba(255,111,133,.45)');
      if (x1 != null && y1 != null) drawTag(ctx, x1 + 4, Math.min(y1, y2) + 8, z.inverse ? 'IFVG' : 'FVG', color);
    }
    return true;
  }
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
  draw: ({ ctx, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const last = p.n - 1;
    const view = visibleIdx(xAxis, bounding);
    for (const e of p.events) {
      if (!inView(view, e.from, e.i)) continue;
      const color = e.dir === 1 ? BULL : BEAR;
      const x1 = px(xAxis, e.from), x2 = px(xAxis, e.i), y = py(yAxis, e.price);
      drawLine(ctx, x1, y, x2, y, color, [5, 3], 1.2);
      drawTag(ctx, x2 - 2, y - 7, e.kind, color, 'right');
      if (e.ob) {
        const ox1 = px(xAxis, e.ob.from), ox2 = px(xAxis, e.ob.to != null ? e.ob.to : last);
        drawRect(ctx, ox1, py(yAxis, e.ob.top), ox2, py(yAxis, e.ob.bottom),
          e.ob.dir === 1 ? 'rgba(95,227,192,.14)' : 'rgba(255,111,133,.14)',
          e.ob.dir === 1 ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)');
        drawTag(ctx, ox1 + 3, py(yAxis, e.ob.top) + 8, 'OB', e.ob.dir === 1 ? BULL : BEAR);
      }
    }
    for (const q of p.eq) {
      const y = py(yAxis, q.price);
      drawLine(ctx, px(xAxis, q.from), y, px(xAxis, last), y, WARN, [2, 4], 1);
      drawTag(ctx, px(xAxis, q.from) + 4, y - 7, q.type === 'H' ? 'EQH' : 'EQL', WARN);
    }
    return true;
  }
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
  draw: ({ ctx, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const view = visibleIdx(xAxis, bounding);
    for (const z of p.zones) {
      if (!inView(view, z.from, z.to)) continue;
      const x1 = px(xAxis, z.from), x2 = px(xAxis, z.to + 1);
      if (x1 == null || x2 == null) continue;
      ctx.save();
      ctx.fillStyle = z.color;
      ctx.fillRect(x1, 0, Math.max(2, x2 - x1), ctx.canvas.height);
      ctx.restore();
      if (x2 - x1 > 26) drawTag(ctx, x1 + 4, 12, z.label, 'rgba(205,218,230,.9)');
    }
    const last = p.n - 1;
    for (const z of p.fvgs) {
      if (!inView(view, z.from, last)) continue;
      const bull = z.dir === 1;
      drawRect(ctx, px(xAxis, z.from), py(yAxis, z.top), px(xAxis, last), py(yAxis, z.bottom),
        bull ? 'rgba(95,227,192,.12)' : 'rgba(255,111,133,.12)',
        bull ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)');
    }
    return true;
  }
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
  draw: ({ ctx, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const last = p.n - 1;
    const view = visibleIdx(xAxis, bounding);
    for (const s of p.swings) {
      if (!inView(view, s.i, last)) continue;
      const y = py(yAxis, s.price);
      const color = s.type === 'H' ? 'rgba(255,111,133,.55)' : 'rgba(95,227,192,.55)';
      drawLine(ctx, px(xAxis, s.i), y, px(xAxis, last), y, color, [1, 3], 1);
      drawTag(ctx, px(xAxis, s.i) + 3, y - 6, `${p.hours}H ${s.type === 'H' ? 'SH' : 'SL'}`, color);
    }
    for (const e of p.events) {
      if (!inView(view, e.from, last)) continue;
      const color = e.dir === 1 ? BULL : BEAR;
      const y = py(yAxis, e.price);
      drawLine(ctx, px(xAxis, e.from), y, px(xAxis, e.i), y, color, [6, 3], 1.4);
      drawTag(ctx, px(xAxis, e.i) - 2, y - 7, `${p.hours}H ${e.kind}`, color, 'right');
      if (e.ob) {
        drawRect(ctx, px(xAxis, e.ob.from), py(yAxis, e.ob.top), px(xAxis, e.ob.to != null ? e.ob.to : last), py(yAxis, e.ob.bottom),
          e.ob.dir === 1 ? 'rgba(95,227,192,.10)' : 'rgba(255,111,133,.10)',
          e.ob.dir === 1 ? 'rgba(95,227,192,.4)' : 'rgba(255,111,133,.4)');
      }
    }
    return true;
  }
};

/* ---------------- 5. 结构 & 趋势面板（参考 LuxAlgo Structure & Trend Dashboard） ---------------- */

const DASH = {
  name: 'SMC_DASH',
  shortName: '结构趋势',
  series: 'price',
  precision: 2,
  // 参数：摆动回看 / 结构周期 / 三组对齐周期(高,低 × 3) / FVG 上限 / 扫单开关 / 蜡烛染色
  calcParams: [10, 60, 60, 15, 15, 5, 5, 1, 3, 1, 0],
  figures: [{ key: 'v', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) }],
  calc: (list, indicator) => {
    const cp = (i, d) => {
      const v = Number(indicator.calcParams?.[i]);
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    const lb = Math.max(2, Math.min(50, cp(0, 10)));
    const structTf = Math.max(1, cp(1, 60)) * 60000;
    const tf1 = Math.max(1, cp(2, 60)) * 60000;
    const tf2 = Math.max(1, cp(3, 15)) * 60000;
    const pairTfs = [
      [cp(2, 60), cp(3, 15)],
      [cp(4, 15), cp(5, 5)],
      [cp(6, 5), cp(7, 1)]
    ].map(([a, b]) => [a * 60000, b * 60000]);
    const maxFvg = Math.max(0, Math.min(20, cp(8, 3)));
    const showSweep = cp(9, 1) !== 0;
    const colorCandles = cp(10, 0) !== 0;

    const tsToIndex = (ts) => {
      let lo = 0, hi = list.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].timestamp <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };

    /** 在给定周期上算结构：返回 {trend, events, lastEvent, bars} */
    const ema = (arr, n) => {
      const k = 2 / (n + 1);
      let v = arr[0];
      return arr.map((x, i) => (i === 0 ? (v = x) : (v = x * k + v * (1 - k))));
    };
    const tfState = (span) => {
      const agg = span > 60000 ? bucket(list, span) : list;
      // 高周期桶很少时，摆动回看要跟着缩，否则一个 pivot 都出不来
      const lbTf = Math.max(2, Math.min(lb, Math.max(2, Math.floor(agg.length / 8))));
      const st = structure(agg, lbTf);
      const closes = agg.map(b => b.close);
      const f = ema(closes, 12), sl = ema(closes, 50);
      const emaBias = f[f.length - 1] > sl[sl.length - 1] ? 1 : f[f.length - 1] < sl[sl.length - 1] ? -1 : 0;
      const last = st.events[st.events.length - 1] || null;
      return {
        trend: st.trend || emaBias,            // 结构没给出方向时用 EMA 兜底
        structTrend: st.trend,
        emaBias,
        events: st.events.slice(-6).map(e => ({ ...e, i: tsToIndex(agg[e.i].timestamp), from: tsToIndex(agg[e.from].timestamp) })),
        last, bars: agg.length, lbTf
      };
    };

    const st = tfState(structTf);
    const pairs = pairTfs.map(([a, b]) => ({ hi: tfState(a), lo: tfState(b) }));

    // 流动性扫单：突破前一个摆动高/低后收回到内侧
    const sweeps = [];
    if (showSweep) {
      const pv = pivots(list, lb);
      for (const p of pv.slice(-40)) {
        for (let i = p.i + 1; i < Math.min(list.length, p.i + 60); i++) {
          const b = list[i];
          if (p.type === 'H' && b.high > p.price && b.close < p.price) { sweeps.push({ i, price: p.price, dir: -1 }); break; }
          if (p.type === 'L' && b.low < p.price && b.close > p.price) { sweeps.push({ i, price: p.price, dir: 1 }); break; }
        }
      }
    }

    // FVG（用当前周期，限制条数）
    const fvgs = maxFvg ? resolveFvgs(findFvgs(list), list).filter(z => !z.closed && z.to >= list.length - 400).slice(-maxFvg) : [];

    const label = (span) => (span >= 86400000 ? `${Math.round(span / 86400000)}D`
      : span >= 3600000 ? `${Math.round(span / 3600000)}H`
      : `${Math.round(span / 60000)}M`);

    const result = list.map(() => ({ v: null }));
    return stash(list, result, {
      name: DASH.name, n: list.length, lb, colorCandles,
      struct: { name: label(structTf), trend: st.trend, events: st.events },
      rows: pairTfs.map(([a, b], i) => ({
        hi: { name: label(a), trend: pairs[i].hi.trend, last: pairs[i].hi.last },
        lo: { name: label(b), trend: pairs[i].lo.trend, last: pairs[i].lo.last }
      })),
      sweeps: sweeps.slice(-8),
      fvgs
    });
  },
  draw: ({ ctx, chart, bounding, xAxis, yAxis, indicator }) => {
    const p = payloadOf(indicator);
    if (!p) return true;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const view = visibleIdx(xAxis, bounding);
    const last = p.n - 1;

    // 蜡烛按结构偏色（可选）
    if (p.colorCandles && view) {
      const list = chart?.getDataList?.() || [];
      const from = Math.max(0, view.from), to = Math.min(list.length - 1, view.to);
      for (let i = from; i <= to; i++) {
        const b = list[i];
        const x = px(xAxis, i);
        const y1 = py(yAxis, b.open), y2 = py(yAxis, b.close);
        if (x == null || y1 == null || y2 == null) continue;
        ctx.save();
        ctx.strokeStyle = p.struct.trend > 0 ? 'rgba(95,227,192,.28)' : p.struct.trend < 0 ? 'rgba(255,111,133,.28)' : 'rgba(255,255,255,.08)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
        ctx.restore();
      }
    }

    // 结构事件（BOS / CHoCH）
    for (const e of p.struct.events) {
      if (!inView(view, e.from, e.i)) continue;
      const color = e.dir === 1 ? BULL : BEAR;
      const y = py(yAxis, e.price);
      drawLine(ctx, px(xAxis, e.from), y, px(xAxis, e.i), y, color, [5, 3], 1.2);
      drawTag(ctx, px(xAxis, e.i) - 2, y - 7, e.kind, color, 'right');
    }

    // 扫单
    for (const w of p.sweeps) {
      if (!inView(view, w.i, w.i)) continue;
      const y = py(yAxis, w.price);
      if (y == null || y < 0 || y > H) continue;
      drawTag(ctx, px(xAxis, w.i) + 4, y + (w.dir > 0 ? 10 : -10), 'SWEEP', WARN, 'left');
    }

    // FVG
    for (const z of p.fvgs) {
      if (!inView(view, z.from, last)) continue;
      const bull = z.dir === 1;
      drawRect(ctx, px(xAxis, z.from), py(yAxis, z.top), px(xAxis, last), py(yAxis, z.bottom),
        bull ? 'rgba(95,227,192,.08)' : 'rgba(255,111,133,.08)',
        bull ? 'rgba(95,227,192,.35)' : 'rgba(255,111,133,.35)');
    }

    // 面板（右下角）：HIGH / LOW / ALIGNED 三列，多组周期各一行
    const rows = p.rows || [];
    const boxW = 236, rowH = 20, padX = 12, padY = 9;
    const boxH = padY * 2 + 18 + 20 + rows.length * rowH + 6;
    const x0 = W - 12 - boxW, y0 = H - 12 - boxH;
    const cw = [78, 78, boxW - 78 - 78 - padX];      // 三列宽度

    ctx.save();
    ctx.fillStyle = 'rgba(6,12,20,.9)';
    ctx.fillRect(x0, y0, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW - 1, boxH - 1);
    ctx.restore();

    drawTag(ctx, x0 + padX, y0 + padY + 6, '结构 · 趋势', 'rgba(205,218,230,.95)', 'left');
    drawTag(ctx, x0 + boxW - padX, y0 + padY + 6, `${p.struct.name} ${p.struct.trend > 0 ? '▲' : p.struct.trend < 0 ? '▼' : '–'}`,
      p.struct.trend > 0 ? BULL : p.struct.trend < 0 ? BEAR : 'rgba(190,205,220,.7)', 'right');

    // 表头
    const hy = y0 + padY + 22;
    drawTag(ctx, x0 + padX, hy, 'HTF', 'rgba(160,175,190,.8)', 'left');
    drawTag(ctx, x0 + padX + cw[0], hy, 'LTF', 'rgba(160,175,190,.8)', 'left');
    drawTag(ctx, x0 + padX + cw[0] + cw[1], hy, '对齐', 'rgba(160,175,190,.8)', 'left');
    drawLine(ctx, x0 + padX, hy + 9, x0 + boxW - padX, hy + 9, 'rgba(255,255,255,.10)', [], 1);

    rows.forEach((r, k) => {
      const y = hy + 22 + k * rowH;
      const hiColor = r.hi.trend > 0 ? BULL : r.hi.trend < 0 ? BEAR : 'rgba(190,205,220,.7)';
      const loColor = r.lo.trend > 0 ? BULL : r.lo.trend < 0 ? BEAR : 'rgba(190,205,220,.7)';
      drawTag(ctx, x0 + padX, y, `${r.hi.name} ${r.hi.trend > 0 ? '多' : r.hi.trend < 0 ? '空' : '震'}`, hiColor, 'left');
      drawTag(ctx, x0 + padX + cw[0], y, `${r.lo.name} ${r.lo.trend > 0 ? '多' : r.lo.trend < 0 ? '空' : '震'}`, loColor, 'left');
      const same = r.hi.trend !== 0 && r.hi.trend === r.lo.trend;
      drawTag(ctx, x0 + padX + cw[0] + cw[1], y, same ? '✓' : '·',
        same ? (r.hi.trend > 0 ? BULL : BEAR) : 'rgba(150,165,180,.6)', 'left');
    });

    const yAl = y0 + boxH - padY - 3;
    const alignedAll = rows.length > 0 && rows.every(r => r.hi.trend !== 0 && r.hi.trend === r.lo.trend);
    drawTag(ctx, x0 + padX, yAl, '全周期对齐', 'rgba(190,205,220,.85)', 'left');
    drawTag(ctx, x0 + boxW - padX, yAl, alignedAll ? '✓ 一致' : '不同步',
      alignedAll ? BULL : 'rgba(190,205,220,.6)', 'right');
    return true;
  }
};

export const SMC_INDS = [FVG, MST, ICT, HTF, DASH];
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
