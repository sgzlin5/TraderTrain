// 跨图十字光标同步（Vela 版）：一格移动 → 其余格用 renderer.setExternalCrosshair 画数据空间幽灵线。
// Vela 有原生接缝（klinecharts 时代要自己画 DOM 竖线），不再需要任何自绘。
// 同时记录 last = {time, price} 供图例悬停读数（main.js 的 legendValueIndex 用）。
export class CrosshairSyncV {
  constructor(workspace, opts = {}) {
    this.ws = workspace;
    this.enabled = opts.enabled !== false;
    this.onState = opts.onState || null;
    this.attached = new WeakSet();   // 已订阅的 chart
    this.unsubs = new Map();         // chart → Unsubscribe[]
    this.last = null;                // {time, price} —— 最近一次真实十字光标（图例读数用）
    this._applying = false;          // 防回环（外置幽灵线不应触发 onCrosshairMove，保险丝）
  }

  /** 给新出现的格子补订阅（布局变更后要再调一次） */
  refresh() {
    if (!this.ws) return;
    for (const cell of this.ws.cells) {
      const chart = cell?.app?.chart;
      if (!chart || this.attached.has(chart)) continue;
      this.attached.add(chart);
      try {
        const r = chart.renderer;
        if (!r?.onCrosshairMove) continue;
        const off = r.onCrosshairMove((e) => this._onMove(cell, e));
        this.unsubs.set(chart, [...(this.unsubs.get(chart) || []), off]);
      } catch {}
    }
  }

  setEnabled(v) {
    this.enabled = !!v;
    this.onState?.(this.enabled);
    if (!this.enabled) this._clear();
  }

  _onMove(srcCell, e) {
    this.last = e && e.time != null ? { time: e.time, price: e.price } : null;
    if (!this.enabled || this._applying) return;
    // 只镜像价格 pane 的水平位（study pane 的 price 是指标值，镜像过去没有意义）
    const price = e?.paneKind === 'price' || e?.paneKind == null ? e.price : null;
    this._applying = true;
    try {
      for (const cell of this.ws.cells) {
        const chart = cell?.app?.chart;
        if (!chart || cell === srcCell) continue;
        try { chart.renderer.setExternalCrosshair(e?.time ?? null, price); } catch {}
      }
    } finally {
      this._applying = false;
    }
  }

  _clear() {
    for (const cell of this.ws.cells) {
      const chart = cell?.app?.chart;
      if (!chart) continue;
      try { chart.renderer.setExternalCrosshair(null); } catch {}
    }
  }

  destroy() {
    for (const list of this.unsubs.values()) for (const off of list) { try { off(); } catch {} }
    this.unsubs.clear();
    this.attached = new WeakSet();
    this._clear();
  }
}
