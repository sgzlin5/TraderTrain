// 十字光标跨图同步：鼠标在任一格移动时，其余格在同一时间位置画一条竖线
// （klinecharts 10 没有 setCrosshair，所以用 DOM 竖线 + convertToPixel 自己画）
const LINE_CLASS = 'cx-line';

export class CrosshairSync {
  constructor(workspace, opts = {}) {
    this.ws = workspace;
    this.enabled = opts.enabled !== false;
    this.onState = opts.onState || null;
    this.attached = new WeakSet();   // 已订阅的 chart 实例
    this.lines = new Map();          // cell.i → el
    this._raf = 0;
    this._pending = null;
  }

  /** 给新出现的格子补订阅（布局变更后要再调一次） */
  refresh() {
    if (!this.ws) return;
    for (const cell of this.ws.cells) {
      if (!cell?.app?.chart || this.attached.has(cell.app.chart)) continue;
      this.attached.add(cell.app.chart);
      try {
        cell.app.chart.subscribeAction('onCrosshairChange', (d) => this._onMove(cell, d));
      } catch {}
    }
  }

  setEnabled(v) {
    this.enabled = !!v;
    this.onState?.(this.enabled);
    if (!this.enabled) this._clear();
  }

  detach() {
    this._clear();
    this.attached = new WeakSet();
  }

  _lineFor(cell) {
    let el = this.lines.get(cell.i);
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.className = LINE_CLASS;
    el.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;pointer-events:none;' +
      'background:var(--muted);opacity:.45;display:none;z-index:3';
    // 格子容器需要一个定位上下文
    const cs = getComputedStyle(cell.el);
    if (cs.position === 'static') cell.el.style.position = 'relative';
    cell.el.appendChild(el);
    this.lines.set(cell.i, el);
    return el;
  }

  _onMove(cell, d) {
    if (!this.enabled) return;
    this._pending = { cell, d };
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const p = this._pending;
      this._pending = null;
      if (p) this._apply(p.cell, p.d);
    });
  }

  /** 事件只带 x/y/paneId，没有 kLineData：用 convertFromPixel 反解时间 */
  _tsAt(cell, d) {
    if (d?.kLineData?.timestamp != null) return d.kLineData.timestamp;
    if (typeof d?.x !== 'number') return null;
    try {
      const r = cell.app.chart.convertFromPixel([{ x: d.x, y: d.y }], { paneId: d.paneId || 'candle_pane' });
      const pt = Array.isArray(r) ? r[0] : r;
      return pt && pt.timestamp != null ? pt.timestamp : null;
    } catch { return null; }
  }

  _apply(srcCell, d) {
    const ts = this._tsAt(srcCell, d);
    if (ts == null) { this._clear(); return; }

    // 源格：直接用事件里的像素
    for (const cell of this.ws.cells) {
      if (!cell?.app?.chart) continue;
      const el = this._lineFor(cell);
      let x = null;
      if (cell === srcCell && typeof d.x === 'number') {
        x = d.x;
      } else {
        // 其余格：时间 → 像素（candle_pane 的绘图区左边界由 axis 宽度决定，convertToPixel 已含）
        try {
          const r = cell.app.chart.convertToPixel([{ timestamp: ts }], { paneId: 'candle_pane' });
          const pt = Array.isArray(r) ? r[0] : r;
          if (pt && Number.isFinite(pt.x)) x = pt.x;
        } catch { x = null; }
      }
      if (x == null) { el.style.display = 'none'; continue; }
      // 越界（该格没有这根 K 线 / 在可视区外）就隐藏
      const w = cell.el.clientWidth;
      if (x < 0 || x > w) { el.style.display = 'none'; continue; }
      el.style.left = `${Math.round(x)}px`;
      el.style.display = 'block';
    }
  }

  _clear() {
    for (const [, el] of this.lines) if (el) el.style.display = 'none';
  }

  destroy() {
    this._clear();
    for (const [, el] of this.lines) el.remove();
    this.lines.clear();
  }
}
