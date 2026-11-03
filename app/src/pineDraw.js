// Pine 绘图对象渲染：把运行时记录的 table / label / box / line 画到 canvas 上
// 运行时（PineTS 0.13.1）会把绘图对象记在 ctx.plots.__tables__ 等伪序列里，但不会渲染。
// 注意：xloc.bar_time 的对象在运行时里丢了 x（time 序列未实现），这类只能跳过；xloc.bar_index 的可以画。

const SIZE_PX = { tiny: 9, small: 10, normal: 11, large: 13, huge: 15 };

function colorOf(c, fallback) {
  if (!c || typeof c !== 'string') return fallback;
  if (c === 'na' || c === '#') return fallback;
  return c;
}

function alphaColor(c, alpha) {
  const col = colorOf(c, null);
  if (!col) return null;
  // #RRGGBB(AA)
  const m = col.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
    const hex = m[1];
    return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${a})`;
  }
  return col;
}

/** 取出运行时记录的绘图对象（去重、去已删除） */
export function collectDrawings(plots) {
  const take = (key) => {
    const p = plots && plots[key];
    const data = p && p.data;
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const entry of data) {
      const vals = entry && entry.value;
      if (!Array.isArray(vals)) continue;
      for (const v of vals) if (v && !v._deleted) out.push(v);
    }
    return out;
  };
  return {
    tables: take('__tables__'),
    labels: take('__labels__'),
    boxes: take('__boxes__'),
    lines: take('__lines__')
  };
}

function measure(ctx, text, size) {
  ctx.save();
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** 画表格（LuxAlgo 面板类脚本的主角） */
function drawTable(ctx, W, H, t) {
  if (!t || !Array.isArray(t.cells) || !t.cells.length) return false;
  const rows = t.rows || t.cells.length;
  const cols = t.columns || (t.cells[0] || []).length;
  const padX = 6, padY = 4;

  // 尺寸：按每列最宽文本
  const colW = new Array(cols).fill(28);
  const rowH = new Array(rows).fill(18);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = t.cells[r] && t.cells[r][c];
      if (!cell || !cell.text) continue;
      const size = SIZE_PX[cell.text_size] || 10;
      colW[c] = Math.max(colW[c], measure(ctx, String(cell.text), size) + padX * 2);
      rowH[r] = Math.max(rowH[r], size + padY * 2);
    }
  }
  const tableW = colW.reduce((a, b) => a + b, 0);
  const tableH = rowH.reduce((a, b) => a + b, 0);
  const margin = 8;
  let x0 = W - margin - tableW, y0 = margin;
  if (t.position === 'bottom_right') { x0 = W - margin - tableW; y0 = H - margin - tableH; }
  else if (t.position === 'bottom_left') { x0 = margin; y0 = H - margin - tableH; }
  else if (t.position === 'top_left') { x0 = margin; y0 = margin; }
  else if (t.position === 'middle_center') { x0 = (W - tableW) / 2; y0 = (H - tableH) / 2; }

  // 背景 + 外框
  ctx.save();
  ctx.fillStyle = alphaColor(t.bgcolor, 'rgba(10,16,24,.88)');
  ctx.fillRect(x0, y0, tableW, tableH);
  if (t.frame_color) {
    ctx.strokeStyle = alphaColor(t.frame_color, 'rgba(255,255,255,.15)');
    ctx.lineWidth = Math.max(1, t.frame_width || 1);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, tableW - 1, tableH - 1);
  }
  ctx.restore();

  // 单元格
  const xs = [x0];
  for (let c = 0; c < cols; c++) xs.push(xs[c] + colW[c]);
  const ys = [y0];
  for (let r = 0; r < rows; r++) ys.push(ys[r] + rowH[r]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = t.cells[r] && t.cells[r][c];
      if (!cell) continue;
      if (cell._merged) continue;                 // 被合并覆盖的格子不画
      const size = SIZE_PX[cell.text_size] || 10;
      const bx = xs[c], by = ys[r];
      let bw = colW[c], bh = rowH[r];
      // 合并：找以本格为起点的 merge
      const merge = (t.merges || []).find(m => m.startRow === r && m.startCol === c);
      if (merge) {
        bw = xs[merge.endCol + 1] - bx;
        bh = ys[merge.endRow + 1] - by;
      }
      if (cell.bgcolor) {
        ctx.save();
        ctx.fillStyle = alphaColor(cell.bgcolor, 'transparent');
        ctx.fillRect(bx, by, bw, bh);
        ctx.restore();
      }
      if (cell.text) {
        ctx.save();
        ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = alphaColor(cell.text_color, '#e6eef6');
        ctx.textBaseline = 'middle';
        const align = cell.text_halign || 'center';
        ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
        const tx = align === 'left' ? bx + padX : align === 'right' ? bx + bw - padX : bx + bw / 2;
        ctx.fillText(String(cell.text), tx, by + bh / 2);
        ctx.restore();
      }
    }
  }
  return true;
}

/** 时间(ms) → 数据下标：运行时 xloc='bt' 存的是毫秒时间戳，而 xAxis 只接受下标 */
function makeTimeToIndex(list) {
  const ts = list.map(b => b.timestamp);
  return (t) => {
    if (typeof t !== 'number') return null;
    let lo = 0, hi = ts.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    // 时间戳之间允许 1.5 根周期的误差
    const span = ts.length > 1 ? ts[1] - ts[0] : 60000;
    if (t - ts[best] > span * 1.5) return null;
    return best;
  };
}

/** 画 labels / boxes / lines（x 分 bar_time / bar_index 两种） */
function drawObjects(ctx, xAxis, yAxis, W, H, objs, list) {
  const t2i = makeTimeToIndex(list || []);
  const toPx = (x, y, xloc) => {
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const idx = (xloc === 'bi') ? x : t2i(x);
    if (idx == null || idx < 0) return null;
    const px = xAxis.convertToPixel(idx);
    const py = yAxis.convertToPixel(y);
    if (px == null || py == null || !isFinite(px) || !isFinite(py)) return null;
    return { x: px, y: py };
  };

  for (const b of objs.boxes || []) {
    const p1 = toPx(b.left ?? b.x1, b.top, b.xloc);
    const p2 = toPx(b.right ?? b.x2, b.bottom, b.xloc);
    if (!p1 || !p2) continue;
    ctx.save();
    if (b.bgcolor) {
      ctx.fillStyle = alphaColor(b.bgcolor, 'rgba(95,227,192,.2)');
      ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    }
    if (b.border_color && b.border_width) {
      ctx.strokeStyle = alphaColor(b.border_color, 'rgba(255,255,255,.3)');
      ctx.lineWidth = b.border_width;
      ctx.strokeRect(Math.min(p1.x, p2.x) + .5, Math.min(p1.y, p2.y) + .5, Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    }
    ctx.restore();
  }

  for (const l of objs.lines || []) {
    const p1 = toPx(l.x1, l.y1, l.xloc);
    const p2 = toPx(l.x2, l.y2, l.xloc);
    if (!p1 || !p2) continue;
    const color = alphaColor(l.color, 'rgba(172,234,255,.8)');
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, l.width || 1);
    if (l.style === 'style_dashed') ctx.setLineDash([5, 4]);
    else if (l.style === 'style_dotted') ctx.setLineDash([1, 3]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.restore();
  }

  for (const lb of objs.labels || []) {
    if (!lb.text) continue;
    const p = toPx(lb.x, lb.y, lb.xloc);
    if (!p) continue;
    const size = SIZE_PX[lb.size] || 10;
    ctx.save();
    ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = alphaColor(lb.textcolor, '#e6eef6');
    ctx.textBaseline = 'middle';
    ctx.textAlign = lb.textalign === 'left' ? 'left' : lb.textalign === 'right' ? 'right' : 'center';
    const dy = lb.style === 'style_label_up' ? -10 : lb.style === 'style_label_down' ? 10 : 0;
    ctx.fillText(String(lb.text), p.x, p.y + dy);
    ctx.restore();
  }
}

/** 统一入口：给 Pine 指标的 draw 回调调用 */
export function drawPineDrawings(ctx, xAxis, yAxis, objs, list) {
  if (!objs) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let drew = false;
  for (const t of objs.tables || []) {
    if (drawTable(ctx, W, H, t)) drew = true;
  }
  drawObjects(ctx, xAxis, yAxis, W, H, objs, list || []);
  return drew;
}
