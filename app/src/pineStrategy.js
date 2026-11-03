// Pine strategy 回测：把 ctx.strategy 变成可直接展示的统计 + 权益曲线
// 数据来自 PineTS 的 StrategyState（closedtrades / netprofit / max_drawdown / cagr …）

/** @param {object|null} s pickStrategy() 的结果 */
export function summarize(s) {
  if (!s) return null;
  const closed = (s.closed || []).filter(t => t.status === 'closed' || t.profit != null);
  const open = s.open || [];
  const pnls = closed.map(t => t.profit || 0);

  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const net = s.netprofit ?? closed.reduce((a, p) => a + p, 0);

  // 权益曲线（逐笔累加 + 起点本金）
  const base = s.initial_capital || 10000;
  const curve = [base];
  for (const p of pnls) curve.push(curve[curve.length - 1] + p);

  // 最大回撤（按逐笔权益）
  let peak = curve[0], maxDD = 0, maxDDPct = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0) maxDDPct = Math.max(maxDDPct, dd / peak);
  }

  // 最长连胜 / 连亏
  let streak = 0, winStreak = 0, lossStreak = 0;
  for (const p of pnls) {
    if (p > 0) { streak = streak > 0 ? streak + 1 : 1; winStreak = Math.max(winStreak, streak); }
    else if (p < 0) { streak = streak < 0 ? streak - 1 : -1; lossStreak = Math.min(lossStreak, streak); }
  }

  return {
    trades: closed.length,
    openTrades: open.length,
    net,
    grossWin,
    grossLoss,
    pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    winRate: closed.length ? wins.length / closed.length : 0,
    expectancy: closed.length ? net / closed.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    maxDD,
    maxDDPct,
    winStreak,
    lossStreak: Math.abs(lossStreak),
    equity: s.equity ?? curve[curve.length - 1],
    initialCapital: base,
    cagr: s.cagr,
    curve,
    rows: closed.map((t, i) => ({
      i: i + 1,
      side: (t.size || 0) >= 0 ? '多' : '空',
      qty: Math.abs(t.size || 0),
      entryTime: t.entry_time, entryPrice: t.entry_price,
      exitTime: t.exit_time, exitPrice: t.exit_price,
      pnl: t.profit || 0,
      bars: (t.exit_bar != null && t.entry_bar != null) ? t.exit_bar - t.entry_bar : null,
      id: t.entry_id || ''
    }))
  };
}

/** 权益曲线画到 canvas（无依赖） */
export function drawCurve(canvas, curve, palette = {}) {
  if (!canvas || !curve || curve.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...curve), max = Math.max(...curve);
  const pad = 6;
  const x = (i) => pad + (i / (curve.length - 1)) * (w - pad * 2);
  const y = (v) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2));

  const up = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#5fe3c0';
  const down = getComputedStyle(document.documentElement).getPropertyValue('--down').trim() || '#ff6f85';
  const line = curve[curve.length - 1] >= curve[0] ? up : down;

  // 基准线（本金）
  ctx.strokeStyle = 'rgba(148,169,187,.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, y(curve[0]));
  ctx.lineTo(w - pad, y(curve[0]));
  ctx.stroke();
  ctx.setLineDash([]);

  // 面积
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, line + '55');
  grad.addColorStop(1, line + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x(0), y(curve[0]));
  curve.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(curve.length - 1), h);
  ctx.lineTo(x(0), h);
  ctx.closePath();
  ctx.fill();

  // 折线
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  curve.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}
