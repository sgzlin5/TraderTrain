// 策略回测的数据与统计层（与图表内核无关，可在 selftest / 后台直接调）
//   · fetchRange：按 [start, end] 从年分片里取 bars（可聚合到 5m/15m/1h），带进度与上限
//   · analyze   ：把 PineTS 的 strategy 状态 + bars 变成逐 bar 权益、回撤、夏普、买持基准、月度盈亏
import { BarSource } from './source.js';
import { summarize } from './pineStrategy.js';

/** 单次回测的硬上限：超过这个量，worker 回传/内存会把渲染进程顶死（实测 41 亿根级直接卡死） */
export const BT_MAX_BARS = 300_000;
/** 超过这个量提示「可能要算一会儿」 */
export const BT_SLOW_BARS = 80_000;
/** 分页取数粒度（每页 1m/聚合根的条数） */
const PAGE = 20_000;

const MIN = 60_000;

/**
 * 取 [startTs, endTs] 区间的 bars。
 * @returns {{bars:Array, truncated:boolean, spanMs:number, from:number|null, to:number|null, ms:number, total:number}}
 */
export async function fetchRange(profile, { startTs, endTs, spanMs = MIN, maxBars = BT_MAX_BARS, onProgress } = {}) {
  if (!profile) throw new Error('没有行情档案');
  const end = Number.isFinite(Number(endTs)) ? Number(endTs) : (profile.live?.last || profile.last || Date.now());
  const span = Math.max(MIN, Math.round(Number(spanMs) || MIN));
  const src = profile.__btSource || new BarSource(profile);
  const t0 = performance.now();
  const pages = [];
  let got = 0;
  let anchor = end;
  let truncated = false;
  let guard = 0;

  while (guard++ < 200) {
    if (got >= maxBars) { truncated = true; break; }
    const page = Math.min(PAGE, maxBars - got);
    let rows = [];
    try { rows = await src.frame(anchor, span, page); } catch (e) { throw new Error(`取数失败：${e?.message || e}`); }
    if (!rows || !rows.length) break;
    pages.unshift(rows);
    got += rows.length;
    const first = rows[0].timestamp;
    if (Number.isFinite(Number(startTs)) && first <= Number(startTs)) break;
    if (first <= (profile.first || 0)) break;
    anchor = first - 1;
    try { onProgress?.({ phase: 'fetch', got, from: first }); } catch {}
    if (rows.length < page) break;      // 到头了
  }

  let bars = [];
  for (const p of pages) for (const b of p) bars.push(b);
  const lo = Number(startTs);
  if (Number.isFinite(lo)) bars = bars.filter((b) => b.timestamp >= lo);
  bars = bars.filter((b) => b.timestamp <= end);
  if (bars.length > maxBars) { bars = bars.slice(bars.length - maxBars); truncated = true; }

  return {
    bars, truncated, spanMs: span,
    from: bars.length ? bars[0].timestamp : null,
    to: bars.length ? bars[bars.length - 1].timestamp : null,
    ms: Math.round(performance.now() - t0), total: bars.length
  };
}

/** 第一个 timestamp <= ts 的下标（找不到返回 -1） */
function idxAtOrBefore(bars, ts) {
  if (!Number.isFinite(Number(ts))) return -1;
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** 从脚本头解析 strategy(...) 的常用参数（存档/对比要显示口径） */
export function parseStrategyParams(src = '') {
  const head = String(src).match(/strategy\s*\(([\s\S]{0,600}?)\)/);
  const out = {};
  if (!head) return out;
  const body = head[1];
  const grab = (key) => {
    const m = body.match(new RegExp(`${key}\\s*=\\s*([^,\\n]+)`));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  for (const k of ['initial_capital', 'default_qty_type', 'default_qty_value', 'commission_type', 'commission_value', 'slippage', 'pyramiding', 'currency',
    'process_orders_on_close', 'calc_on_order_fills', 'close_entries_rule', 'use_bar_magnifier', 'fill_orders_on_standard_ohlc']) {
    const v = grab(k);
    if (v != null) out[k] = v;
  }
  return out;
}

/**
 * 回测口径摘要（写进面板/存档，避免几个月后分不清结论用的什么假设）。
 * 依据：2026-11 对 vendored PineTS 引擎的实测（docs/BT-TV-PARITY.md）——
 *   市价单：posc=false → 下一 bar 开盘价；posc=true → 信号 bar 收盘价
 *   出口单 stop/limit：按 bar 内 high/low 触发，fill 价 = 挂单价
 *   pyramiding=N：同向最多 N 笔（0 与缺省都是 1 笔）
 *   slippage 单位 = tick（mintick 0.01）；commission 支持 cash_per_contract / percent
 *   未实现：use_bar_magnifier / fill_orders_on_standard_ohlc（只解析不生效）
 */
export function btParity(src = '') {
  const p = parseStrategyParams(src);
  const on = (v) => String(v).toLowerCase() === 'true';
  const num = (v, d) => (v == null || v === '' ? d : Number(v));
  const out = {
    fill: on(p.process_orders_on_close) ? 'close' : 'next-open',
    intrabar: true,
    calcOnFill: on(p.calc_on_order_fills),
    pyramiding: num(p.pyramiding, 1),
    slippageTicks: num(p.slippage, 0),
    commissionType: p.commission_type || 'none',
    commissionValue: num(p.commission_value, 0),
    unsupported: []
  };
  if (on(p.use_bar_magnifier)) out.unsupported.push('use_bar_magnifier');
  if (on(p.fill_orders_on_standard_ohlc)) out.unsupported.push('fill_orders_on_standard_ohlc');
  return out;
}

/** 口径 → 一行短标签（面板 meta 用） */
export function parityLabel(par = {}) {
  const bits = [];
  bits.push(par.fill === 'close' ? '信号bar收盘成交' : '下一bar开盘成交');
  bits.push('止损/止盈按bar内高低触发');
  if (par.calcOnFill) bits.push('成交后立即重算');
  if (par.pyramiding > 1) bits.push(`同向最多 ${par.pyramiding} 笔`);
  if (par.slippageTicks > 0) bits.push(`滑点 ${par.slippageTicks} tick`);
  if (par.commissionType && par.commissionType !== 'none') {
    const v = par.commissionValue;
    bits.push(par.commissionType.includes('percent') ? `手续费 ${v}%` : `手续费 ${v}/张`);
  }
  if (par.unsupported && par.unsupported.length) bits.push(`⚠ 引擎未实现 ${par.unsupported.join('/')}`);
  return bits.join(' · ');
}

/**
 * 逐 bar 权益 + 交易统计。
 * @param {object} o
 * @param {Array} o.bars      升序 bars（与回测同口径）
 * @param {object} o.strategy pickStrategy() 的结果
 * @param {number} o.spanMs   每根 bar 的跨度（分钟级）
 */
export function analyze({ bars = [], strategy = null, spanMs = MIN, src = '' } = {}) {
  const base = summarize(strategy) || {
    trades: 0, openTrades: (strategy?.open || []).length, net: 0, grossWin: 0, grossLoss: 0, pf: 0,
    winRate: 0, expectancy: 0, avgWin: 0, avgLoss: 0, maxDD: 0, maxDDPct: 0, winStreak: 0, lossStreak: 0,
    equity: strategy?.initial_capital ?? 10000, initialCapital: strategy?.initial_capital ?? 10000,
    cagr: null, curve: [], rows: []
  };
  const cap = Number(strategy?.initial_capital) || base.initialCapital || 10000;
  const n = bars.length;
  if (!n) {
    return { ...base, bars: 0, equityByBar: [], curve: [], monthly: [], fees: 0, sharpe: null, sortino: null, buyHold: null, buyHoldMoney: null, exposure: 0, spanDays: 0, params: src ? parseStrategyParams(src) : {}, parity: btParity(src) };
  }

  // 交易 → bar 下标区间（size 带符号，多正空负，直接乘价差）
  const tr = [];
  for (const t of [...(strategy?.closed || []), ...(strategy?.open || [])]) {
    const i0 = idxAtOrBefore(bars, t.entry_time);
    if (i0 < 0) continue;
    const i1 = Number.isFinite(Number(t.exit_time)) ? idxAtOrBefore(bars, t.exit_time) : n - 1;
    tr.push({ ...t, i0, i1: Math.max(i0, i1), closed: Number.isFinite(Number(t.exit_time)) });
  }
  tr.sort((a, b) => a.i0 - b.i0);

  const equity = new Array(n);
  const open = [];
  let realized = 0;
  let ptr = 0;
  let openBars = 0;
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    while (ptr < tr.length && tr[ptr].i0 <= i) { open.push(tr[ptr]); ptr++; }
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      if (p.i1 <= i) { realized += Number(p.profit) || 0; open.splice(k, 1); }
    }
    let un = 0;
    for (const p of open) un += (bar.close - Number(p.entry_price)) * (Number(p.size) || 0);
    if (open.length) openBars++;
    equity[i] = cap + realized + un;
  }

  // 回撤（逐 bar）
  let peak = equity[0], maxDD = 0, maxDDPct = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0) maxDDPct = Math.max(maxDDPct, dd / peak);
  }

  // 日频收益 → 夏普 / 索提诺（按 252 交易日年化；口径写进 UI）
  const dayEnd = new Map();
  for (let i = 0; i < n; i++) {
    const d = Math.floor(bars[i].timestamp / 86400000);
    dayEnd.set(d, equity[i]);
  }
  const days = [...dayEnd.keys()].sort((a, b) => a - b);
  const rets = [];
  for (let i = 1; i < days.length; i++) {
    const prev = dayEnd.get(days[i - 1]);
    const cur = dayEnd.get(days[i]);
    if (prev > 0) rets.push(cur / prev - 1);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const varr = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const sd = Math.sqrt(varr);
  const downSide = Math.sqrt(rets.filter((r) => r < 0).reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null;
  const sortino = downSide > 0 ? (mean / downSide) * Math.sqrt(252) : null;

  // 月度盈亏（按平仓时间；未平仓单独提示）
  const mon = new Map();
  for (const t of strategy?.closed || []) {
    const ts = Number(t.exit_time);
    if (!Number.isFinite(ts)) continue;
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    mon.set(key, (mon.get(key) || 0) + (Number(t.profit) || 0));
  }
  const monthly = [...mon.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, pnl]) => ({ ym, pnl }));

  // 费用（引擎的 grossprofit/grossloss 已是「扣费后」口径且 grossloss 为正数，
  // 旧算法 gross−net 会翻倍算错；改为逐笔用「净盈亏 − 价格变动×数量」反推手续费）
  let feeSum = 0;
  for (const t of strategy?.closed || []) {
    const prof = Number(t.profit);
    const move = (Number(t.exit_price) - Number(t.entry_price)) * (Number(t.size) || 0);
    if (!Number.isFinite(prof) || !Number.isFinite(move)) continue;
    const d = prof - move;
    if (Math.abs(d) > 1e-9) feeSum += d;
  }
  const netP = Number.isFinite(Number(strategy?.netprofit)) ? Number(strategy.netprofit) : base.net;
  const fees = Math.max(0, -feeSum);

  const firstClose = bars[0].close, lastClose = bars[n - 1].close;
  const spanDays = (bars[n - 1].timestamp - bars[0].timestamp) / 86400000;
  const endEq = Number.isFinite(Number(strategy?.equity)) ? Number(strategy.equity) : equity[n - 1];

  // 曲线抽稀到 ~1200 点（画布 400px 级足够，存档也小）
  const MAXP = 1200;
  const step = Math.max(1, Math.ceil(n / MAXP));
  const curve = [];
  for (let i = 0; i < n; i += step) curve.push(+equity[i].toFixed(2));
  if (curve[curve.length - 1] !== +equity[n - 1].toFixed(2)) curve.push(+equity[n - 1].toFixed(2));

  return {
    ...base,
    initialCapital: cap,
    equity: endEq,
    net: netP,
    fees,
    bars: n,
    spanMs,
    spanDays: +spanDays.toFixed(2),
    equityByBar: equity,
    curve,
    monthly,
    maxDD,
    maxDDPct,
    sharpe,
    sortino,
    exposure: n ? openBars / n : 0,
    buyHold: firstClose > 0 ? lastClose / firstClose - 1 : null,
    buyHoldMoney: firstClose > 0 ? (lastClose / firstClose - 1) * cap : null,
    cagr: spanDays > 1 && cap > 0 && endEq > 0 ? Math.pow(endEq / cap, 365 / spanDays) - 1 : null,
    params: src ? parseStrategyParams(src) : {},
    parity: btParity(src)
  };
}
