// 绘图工具栏：8 个工具 + Esc 取消 + 删除/清空 + 按（品种 × 周期）持久化
// 持久化的真值用 timestamp（dataIndex 会随窗口重载变化），重载后按当前窗口重新映射
import { kvGet, kvSet } from './db.js';
import { overlayStyles, fibExtendData } from './drawStyles.js';
import { isMagnetOn, isSnapActive, isShiftDown, snapPoint } from './magnet.js';

export const TOOLS = [
  { key: 'segment', label: '趋势线', icon: '<svg viewBox="0 0 16 16"><path d="M3.2 12.8L12.8 3.2"/><circle cx="3.2" cy="12.8" r="1.2"/><circle cx="12.8" cy="3.2" r="1.2"/></svg>' },
  { key: 'polyline', label: '折线（多次点击，双击/右键/回车结束）', icon: '<svg viewBox="0 0 16 16"><path d="M2.6 11.8l3.2-4.6 3 3.2 4.6-6"/><circle cx="2.6" cy="11.8" r="1.15"/><circle cx="5.8" cy="7.2" r="1.15"/><circle cx="8.8" cy="10.4" r="1.15"/><circle cx="13.4" cy="4.4" r="1.15"/></svg>' },
  { key: 'rayLine', label: '射线', icon: '<svg viewBox="0 0 16 16"><path d="M3 13L12.4 5.2"/><circle cx="3" cy="13" r="1.2"/><path d="M13.2 4.4l-2.6.5M13.2 4.4l-.5 2.6"/></svg>' },
  { key: 'horizontalStraightLine', label: '水平线', icon: '<svg viewBox="0 0 16 16"><path d="M2.4 8h11.2"/><circle cx="2.6" cy="8" r="1.1"/><circle cx="13.4" cy="8" r="1.1"/></svg>' },
  { key: 'horizontalRayLine', label: '水平射线', icon: '<svg viewBox="0 0 16 16"><path d="M2.6 8h8.6"/><circle cx="2.6" cy="8" r="1.1"/><path d="M13.4 8l-2.4-1.7M13.4 8l-2.4 1.7"/></svg>' },
  { key: 'priceLine', label: '价格线', icon: '<svg viewBox="0 0 16 16"><path d="M2.4 8h3.2M7.2 8h1.6M10.4 8h3.2"/><circle cx="8" cy="8" r="0.9"/></svg>' },
  { key: 'fibonacciLine', label: '斐波那契', icon: '<svg viewBox="0 0 16 16"><path d="M2.4 4h11.2M2.4 7h11.2M2.4 10h11.2M2.4 13h11.2"/></svg>' },
  { key: 'priceChannelLine', label: '平行通道', icon: '<svg viewBox="0 0 16 16"><path d="M2.4 10.4L10 2.8M5.6 13.6L13.2 6"/></svg>' },
  { key: 'brush', label: '涂鸦', icon: '<svg viewBox="0 0 16 16"><path d="M3 13l.9-2.9 6.2-6.2 2 2-6.2 6.2z"/><path d="M9.4 4.6l2 2"/></svg>' },
  { key: 'longPosition', label: '做多仓位（入场→止损→止盈）', icon: '<svg viewBox="0 0 16 16"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2"/><text x="8" y="11.3" font-size="7.5" text-anchor="middle" font-family="monospace" fill="currentColor" stroke="none">L</text></svg>' },
  { key: 'shortPosition', label: '做空仓位（入场→止损→止盈）', icon: '<svg viewBox="0 0 16 16"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2"/><text x="8" y="11.3" font-size="7.5" text-anchor="middle" font-family="monospace" fill="currentColor" stroke="none">S</text></svg>' }
];

export const TOOL_ACTIONS = {
  undo: '<svg viewBox="0 0 16 16"><path d="M6.6 3.8L3.4 7l3.2 3.2"/><path d="M3.4 7h5.4c2.2 0 3.8 1.4 3.8 3.3s-1.6 3.3-3.8 3.3H7.4"/></svg>',
  redo: '<svg viewBox="0 0 16 16"><path d="M9.4 3.8L12.6 7l-3.2 3.2"/><path d="M12.6 7H7.2c-2.2 0-3.8 1.4-3.8 3.3s1.6 3.3 3.8 3.3h1.4"/></svg>',
  removeLast: '<svg viewBox="0 0 16 16"><path d="M3.4 4.8h9.2M6.4 4.8V3.2h3.2v1.6M5.2 4.8l.6 8.2h4.4l.6-8.2"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.6"/><path d="M5.6 5.8l4.8 4.8M10.4 5.8l-4.8 4.8"/></svg>',
  more: '<svg viewBox="0 0 16 16"><circle cx="3.4" cy="8" r="1.15"/><circle cx="8" cy="8" r="1.15"/><circle cx="12.6" cy="8" r="1.15"/></svg>',
  magnet: '<svg viewBox="0 0 16 16"><path d="M4.2 2.8v5.4a3.8 3.8 0 0 0 7.6 0V2.8"/><path d="M4.2 2.8h2.4M9.4 2.8h2.4"/><path d="M4.2 6.2h2.4M9.4 6.2h2.4"/></svg>',
  collapse: '<svg viewBox="0 0 16 16"><path d="M4.2 10L8 6.2 11.8 10"/></svg>',
  style: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2"/></svg>',
  float: '<svg viewBox="0 0 16 16"><rect x="2.6" y="8.6" width="10.8" height="4.8" rx="1.4"/><path d="M8 6.4V1.8M5.6 4.2L8 1.8l2.4 2.4"/></svg>'
};

export class DrawLayer {
  constructor(chart, { symbol, periodKey, onChange, getStyles } = {}) {
    this.chart = chart;
    this.symbol = symbol;
    this.periodKey = periodKey;
    this.items = [];            // [{name, points:[{timestamp, value}]}]
    this.pending = null;        // 正在取点的 overlay id
    this.activeTool = null;
    this.history = [];          // 撤销栈（JSON 快照）
    this.future = [];           // 重做栈
    this.onChange = onChange || (() => {});
    this.getStyles = getStyles || (() => null);
  }

  key() { return `draw:${this.symbol}:${this.periodKey}`; }

  indexOfTs(ts) {
    const list = this.chart.getDataList();
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].timestamp === ts) return mid;
      if (list[mid].timestamp < ts) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return -1;
  }

  nearestIndex(ts) {
    const list = this.chart.getDataList();
    let lo = 0, hi = list.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].timestamp <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans + 1 < list.length && Math.abs(list[ans + 1].timestamp - ts) < Math.abs(list[ans].timestamp - ts)) ans++;
    return ans;
  }

  /** 当前工具样式（含斐波那契层级） */
  styleFor(name) {
    const styles = this.getStyles();
    const out = { styles: overlayStyles(styles, name) };
    if (name === 'fibonacciLine') out.extendData = fibExtendData(styles);
    return out;
  }

  activate(toolKey) {
    this.cancelPending();
    if (toolKey === 'polyline') return this.startPolyline();
    this.activeTool = toolKey;
    const id = this.chart.createOverlay({
      name: toolKey,
      points: [],
      ...this.styleFor(toolKey),
      onDrawEnd: (params) => {
        this.pending = null; this.activeTool = null;
        let ov = params?.overlay || this.chart.getOverlays().slice(-1)[0];
        this.levelOverlay(ov);
        this.snapOverlay(ov);
        // 自定义模板（segment 等）画完后不会自动重绘，这里再刷一次
        try {
          const cur = this.chart.getOverlays().find(o => o.id === ov?.id) || ov;
          const pts = (cur?.points || []).map(p => ({ timestamp: p.timestamp, value: p.value }));
          if (cur && pts.length) this.chart.overrideOverlay({ id: cur.id, points: pts });
        } catch {}
        this.snapshot();
        this.capture(); this.persist(); this.onChange();
      },
      onPressedMoveEnd: (params) => {
        if (!this.snapOverlay(params?.overlay)) return;
        this.capture(); this.persist(); this.onChange();
      },
      onRemoved: () => {
        if (this._busy) return;          // 批量清空/重建时不要回写空集合
        this.capture(); this.persist(); this.onChange();
      }
    });
    this.pending = id;
    this.onChange();
    return id;
  }

  /** 吸附：把一条绘图的所有落点吸到最近的 OHLC（magnet 关闭时不动） */
  /** Shift 收尾兜底：把 segment 的第二点拉平到第一点 */
  levelOverlay(overlay) {
    if (!overlay || overlay.name !== 'segment' || !isShiftDown()) return false;
    const pts = overlay.points || [];
    if (pts.length < 2 || !Number.isFinite(pts[0]?.value)) return false;
    if (pts[1].value === pts[0].value) return false;
    const next = pts.map((p, i) => (i === 1 ? { ...p, value: pts[0].value } : p));
    try { this.chart.overrideOverlay({ id: overlay.id, points: next }); } catch { return false; }
    return true;
  }

  snapOverlay(overlay) {
    if (!overlay || !isSnapActive()) return false;
    const pts = (overlay.points || []).filter(p => p.timestamp != null);
    if (!pts.length) return false;
    const snapped = pts.map(p => snapPoint(this.chart, { timestamp: p.timestamp, value: p.value }));
    const same = pts.every((p, i) => p.timestamp === snapped[i].timestamp && p.value === snapped[i].value);
    if (same) return false;
    try { this.chart.overrideOverlay({ id: overlay.id, points: snapped }); } catch { return false; }
    return true;
  }

  /** 折线：自建取点（klinecharts 没有多段折线工具） */
  startPolyline() {
    this.cancelPending();
    this.activeTool = 'polyline';
    this._poly = { pts: [], hover: null, id: null };
    const host = document.getElementById('chart');
    if (!host) return null;

    const toPoint = (ev) => {
      const r = host.getBoundingClientRect();
      const raw = this.chart.convertFromPixel(
        [{ x: ev.clientX - r.left, y: ev.clientY - r.top }], { paneId: 'candle_pane' });
      const p = Array.isArray(raw) ? raw[0] : raw;
      if (!p || !Number.isFinite(p.value) || !Number.isFinite(p.timestamp)) return null;
      return snapPoint(this.chart, { timestamp: p.timestamp, value: p.value });
    };

    const paint = () => {
      const poly = this._poly;
      if (!poly) return;
      const pts = poly.pts.slice();
      if (poly.hover && pts.length) pts.push(poly.hover);
      if (pts.length < 2) {
        if (poly.id) { try { this.chart.overrideOverlay({ id: poly.id, points: pts.length ? [pts[0], pts[0]] : [] }); } catch {} }
        return;
      }
      if (!poly.id) {
        poly.id = this.chart.createOverlay({ name: 'polyline', points: pts, ...this.styleFor('polyline') });
      } else {
        try { this.chart.overrideOverlay({ id: poly.id, points: pts }); } catch {}
      }
    };

    const onDown = (ev) => {
      if (ev.button === 2) return;                 // 右键交给 contextmenu 收尾
      const p = toPoint(ev);
      if (!p) return;
      ev.preventDefault(); ev.stopPropagation();
      this._poly.pts.push(p);
      this._poly.hover = null;
      paint();
      this.onChange();
    };
    const onMove = (ev) => {
      const p = toPoint(ev);
      if (!p) return;
      this._poly.hover = p;
      paint();
    };
    const finish = (commit) => {
      this.endPolyline(commit);
    };
    const onDbl = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(true); };
    const onCtx = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(true); };
    const onKey = (ev) => {
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    };

    this._polyHandlers = { host, onDown, onMove, onDbl, onCtx, onKey };
    host.addEventListener('mousedown', onDown, true);
    host.addEventListener('mousemove', onMove, true);
    host.addEventListener('dblclick', onDbl, true);
    host.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('keydown', onKey, true);
    this.onChange();
    return this._poly.id;
  }

  /** 结束折线：commit=false 或点数不足则丢弃 */
  endPolyline(commit) {
    const poly = this._poly;
    const h = this._polyHandlers;
    if (h) {
      h.host.removeEventListener('mousedown', h.onDown, true);
      h.host.removeEventListener('mousemove', h.onMove, true);
      h.host.removeEventListener('dblclick', h.onDbl, true);
      h.host.removeEventListener('contextmenu', h.onCtx, true);
      window.removeEventListener('keydown', h.onKey, true);
    }
    this._polyHandlers = null;
    this._poly = null;
    this.activeTool = null;
    if (!poly) { this.onChange(); return 0; }
    const pts = (poly.pts || []).slice();
    if (!poly.id) { this.onChange(); return 0; }
    if (!commit || pts.length < 2) {
      this._busy = true;
      try { this.chart.removeOverlay({ id: poly.id }); } catch {}
      this._busy = false;
      this.onChange();
      return 0;
    }
    try { this.chart.overrideOverlay({ id: poly.id, points: pts }); } catch {}
    this.snapshot();
    this.capture(); this.persist(); this.onChange();
    return pts.length;
  }

  cancelPending() {
    if (this._poly) { this.endPolyline(false); return; }
    if (this.pending) {
      try { this.chart.removeOverlay({ id: this.pending }); } catch {}
      this.pending = null;
    }
    this.activeTool = null;
    this.onChange();
  }

  cancel() { this.cancelPending(); }

  /** 变更前打快照（撤销/重做用） */
  snapshot() {
    this.history.push(JSON.stringify(this.items));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.history.pop());
    this.restore();
    this.persist();
    this.onChange();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.future.pop());
    this.restore();
    this.persist();
    this.onChange();
    return true;
  }

  /** 改单条绘图的样式（覆盖层 + 存储同步） */
  updateOverlayStyle(id, patch) {
    const o = this.chart.getOverlays().find(x => x.id === id);
    if (!o) return false;
    const line = { ...(o.styles?.line || {}), ...patch };
    this.chart.overrideOverlay({ id, styles: { line } });
    const idx = this.items.findIndex(it =>
      it.name === o.name &&
      it.points?.[0] && o.points?.[0] && it.points[0].timestamp === o.points[0].timestamp
    );
    if (idx >= 0) this.items[idx].lineStyle = { color: line.color, size: line.size, style: line.style, dashedValue: line.dashedValue };
    this.persist();
    return true;
  }

  /** 删除单条绘图 */
  removeOverlayById(id) {
    this.snapshot();
    try { this.chart.removeOverlay({ id }); } catch { return false; }
    this.capture();
    this.persist();
    this.onChange();
    return true;
  }

  removeLast() {
    this.snapshot();
    const list = this.chart.getOverlays();
    if (list.length) this.chart.removeOverlay({ id: list[list.length - 1].id });
    this.capture(); this.persist(); this.onChange();
  }

  clear() {
    this.snapshot();
    this._busy = true;
    this.chart.removeOverlay();
    this._busy = false;
    this.items = [];
    this.persist();
    this.onChange();
  }

  capture() {
    this.items = this.chart.getOverlays()
      .map(o => {
        const line = o.styles && o.styles.line;
        return {
          name: o.name,
          points: (o.points || []).filter(p => p.timestamp != null).map(p => ({ timestamp: p.timestamp, value: p.value })),
          ...(line ? { lineStyle: { color: line.color, size: line.size, style: line.style, dashedValue: line.dashedValue } } : {})
        };
      })
      .filter(i => i.points.length > 0);
    return this.items;
  }

  /** 清空并依据 items 重建；只重建「完全落在当前窗口内」的绘图（窗口外的等滚回去再显示） */
  restore() {
    const items = Array.isArray(this.items) ? this.items.slice() : [];
    this._busy = true;
    try { this.chart.removeOverlay(); } catch {}
    const list = this.chart.getDataList();
    if (!list.length) return -1;              // 图表还没数据（正在切周期/重载）：让调用方稍后重试
    const first = list[0].timestamp;
    const last = list[list.length - 1].timestamp;
    let shown = 0;
    for (const it of items) {
      const points = (it.points || [])
        .filter(p => p.timestamp != null && Number.isFinite(p.value))
        .map(p => ({ timestamp: p.timestamp, value: p.value }));
      if (!points.length) continue;
      if (points.some(p => p.timestamp < first || p.timestamp > last)) continue;  // 窗口外：不吸附到边缘，避免画歪
      // 窗口内：把时间戳对齐到最近的 bar（跨周期复制时时间戳不必逐根相等）
      const snapped = points.map(p => ({ timestamp: list[this.nearestIndex(p.timestamp)].timestamp, value: p.value }));
      // 有自己的 lineStyle 就用它，否则跟随「绘图样式」的当前设置
      const styleArg = it.lineStyle ? { styles: { line: { ...it.lineStyle } } } : this.styleFor(it.name);
      // 刚批量删除后第一根偶尔会被内核拒绝，重试一次再放弃
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // 多步工具（折线/仓位）先建前两点再 override 成全量点：避免创建时按 totalStep
          // 截断点数，也能让内核走一次正常的坐标换算。
          const id = this.chart.createOverlay({ name: it.name, points: snapped.slice(0, 2), ...styleArg });
          if (snapped.length > 2 && id) this.chart.overrideOverlay({ id, points: snapped });
          shown++;
          break;
        } catch (e) {
          if (attempt === 1) console.warn('[draw] restore failed', it.name, e?.message);
        }
      }
    }
    this._busy = false;
    return shown;
  }

  async persist() {
    await kvSet(this.key(), this.items);
  }

  async load() {
    const items = await kvGet(this.key());
    this.items = Array.isArray(items) ? items : [];
    const shown = this.restore();
    if (shown < 0) {
      // 数据还没就绪：等一帧再重建一次（期间 items 保留，不丢）
      setTimeout(() => { try { this.restore(); this.onChange(); } catch {} }, 120);
    }
    this.onChange();
    return this.items.length;
  }
}
