// 做多 / 做空仓位工具：入场 → 止损 → 止盈，画出风险区、收益区与盈亏比
// klinecharts 没有内置仓位工具，这里注册两个 overlay 模板（3 次点击完成，totalStep = 4）
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const read = (k, fb) => (cs.getPropertyValue(k) || '').trim() || fb;
  return {
    up: read('--up', '#5fe3c0'),
    down: read('--down', '#ff6f85'),
    accent: read('--cyan', '#8adeff')
  };
}

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(138,222,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function fmt(v, precision, sep = true) {
  const s = Number(v).toFixed(precision);
  return sep ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

function template(name, direction) {
  return {
    name,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures({ chart, coordinates, bounding, overlay }) {
      if (coordinates.length < 2) return [];
      const points = overlay.points || [];
      const entryPt = points[0], slPt = points[1], tpPt = points[2] || points[1];
      if (![entryPt, slPt, tpPt].every(p => p && isNum(p.value))) return [];

      const c = themeColors();
      const lineStyle = overlay.styles?.line || {};
      const accent = lineStyle.color || c.accent;          // 入场线/文字颜色（可在绘图样式里改）
      const entrySize = Number(lineStyle.size) || 1.4;
      const winColor = direction === 'long' ? c.up : c.down;
      const lossColor = direction === 'long' ? c.down : c.up;
      const precision = chart.getSymbol()?.pricePrecision ?? 2;

      const x0 = coordinates[0].x;
      const x1 = Math.max(bounding.width, x0 + 40);
      const yEntry = coordinates[0].y;
      const ySl = coordinates[1].y;
      const yTp = (coordinates[2] || coordinates[1]).y;

      const entry = entryPt.value;
      const sl = slPt.value;
      const tp = tpPt.value;
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      const rr = risk > 0 ? reward / risk : 0;
      const pct = (v) => `${entry ? (((v - entry) / entry) * 100).toFixed(2) : '0.00'}%`;

      const figures = [];

      // 风险区 / 收益区
      const rect = (yA, yB, color) => ({
        type: 'rect',
        attrs: { x: x0, y: Math.min(yA, yB), width: Math.max(1, x1 - x0), height: Math.max(1, Math.abs(yB - yA)) },
        styles: { style: 'fill', color: hexToRgba(color, 0.14), borderColor: 'transparent', borderSize: 0 }
      });
      figures.push(rect(yEntry, ySl, lossColor));
      figures.push(rect(yEntry, yTp, winColor));

      // 三条线
      const line = (y, color, style, size) => ({
        type: 'line',
        attrs: { coordinates: [{ x: x0, y }, { x: x1, y }] },
        styles: { color, size, style, dashedValue: style === 'dashed' ? [5, 4] : [0, 0] }
      });
      figures.push(line(yEntry, accent, lineStyle.style === 'solid' || !lineStyle.style ? 'solid' : lineStyle.style, entrySize));
      figures.push(line(ySl, lossColor, 'dashed', 1));
      figures.push(line(yTp, winColor, 'dashed', 1));

      // 文案：入场 / 止损 / 止盈 + 盈亏比
      const texts = [
        { x: x0 + 6, y: yEntry - 4, text: `${direction === 'long' ? '做多' : '做空'}  ${fmt(entry, precision)}`, baseline: 'bottom' },
        { x: x0 + 6, y: ySl - 4, text: `SL  ${fmt(sl, precision)}  ${pct(sl)}`, baseline: 'bottom' },
        { x: x0 + 6, y: yTp - 4, text: `TP  ${fmt(tp, precision)}  ${pct(tp)}`, baseline: 'bottom' },
        { x: x0 + 6, y: yEntry + 15, text: `盈亏比 1 : ${rr ? rr.toFixed(2) : '—'}`, baseline: 'bottom' }
      ];
      figures.push({
        type: 'text',
        isCheckEvent: false,
        attrs: texts,
        styles: { color: accent, size: 11, family: 'SFMono-Regular, Consolas, monospace' }
      });

      return figures;
    }
  };
}

export function registerPositionOverlays(K) {
  if (!K || typeof K.registerOverlay !== 'function') return false;
  K.registerOverlay(template('longPosition', 'long'));
  K.registerOverlay(template('shortPosition', 'short'));
  return true;
}
