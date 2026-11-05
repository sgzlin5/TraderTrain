// 绘图层（Vela 版）：klinecharts overlay 模板 → chart.drawings。
// 关键简化（相对旧 draw.js）：
// - 绘图锚定在数据空间（time+price），跨窗口重载天然持久 —— 旧「窗口内重建」整套消失；
// - 撤销/重做/磁吸/折线/仓位工具全部原生（undo/redo/setSnapMode/polyline/position）；
// - 持久化直接存 Vela 的 DrawingsDocument（旧 klinecharts items 格式读入时迁移）。
import { kvGet, kvSet } from './db.js';
import { overlayStyles, fibExtendData } from './drawStyles.js';

/** 我们的工具名 → Vela DrawingTypeKey */
export const TOOL_MAP = {
  segment: 'trendline',
  polyline: 'polyline',
  rayLine: 'ray',
  horizontalStraightLine: 'hline',
  horizontalRayLine: 'hray',
  priceLine: 'hline',                 // Vela 无独立价格线类型，落 hline，原名记在 props.tt
  fibonacciLine: 'fibretracement',
  priceChannelLine: 'parallelchannel',
  brush: 'freehand',
  longPosition: 'position',
  shortPosition: 'position'
};
/** Vela type → 我们的默认名（props.tt 缺失时的回推） */
const REV_MAP = {
  trendline: 'segment', polyline: 'polyline', ray: 'rayLine',
  hline: 'horizontalStraightLine', hray: 'horizontalRayLine',
  fibretracement: 'fibonacciLine', parallelchannel: 'priceChannelLine',
  freehand: 'brush', position: 'longPosition'
};

/** DrawingStyle ← 旧 lineStyle {color,size,style,dashedValue} */
const styleFromLine = (line) => {
  if (!line) return undefined;
  const out = { lineColor: line.color, lineWidth: line.size ?? 1, lineStyle: line.style === 'dashed' ? 'dashed' : (line.style === 'solid' ? 'solid' : 'dotted') };
  return out;
};
/** 旧 lineStyle ← DrawingStyle（回读用） */
const lineFromStyle = (st) => st ? {
  color: st.lineColor, size: st.lineWidth, style: st.lineStyle,
  dashedValue: st.lineStyle === 'dashed' ? [4, 4] : [1, 0]
} : undefined;

export class DrawLayerV {
  constructor(chart, { symbol, periodKey, onChange } = {}) {
    this.chart = chart;
    this.symbol = symbol;
    this.periodKey = periodKey;
    this.items = [];                 // 旧 item 形状（{name, points, lineStyle}）—— 面板/自检兼容
    this.pending = null;
    this.activeTool = null;
    this.onChange = onChange || (() => {});
    this._wired = false;
    this._persistTimer = null;
    this._wire();
  }

  key() { return `draw:${this.symbol}:${this.periodKey}`; }

  _wire() {
    if (this._wired || !this.chart) return;
    this._wired = true;
    const d = this.chart.drawings;
    if (!d) return;
    // 放置完成：贴上当前模板样式 + 记录来源工具名
    this.chart.on('drawing:created', ({ id }) => {
      const doc = d.toJSON().drawings.find(x => x.id === id);
      const tool = this.activeTool;
      if (doc && tool && TOOL_MAP[tool]) {
        const patch = { props: { ...(doc.props || {}), tt: tool } };
        const st = styleFromLine(this.styleFor(tool)?.styles?.line);
        if (st) patch.style = { ...doc.style, ...st };
        try { d.update(id, patch); } catch {}
      }
      this.pending = null; this.activeTool = null;
      this.capture(); this.persist(); this.onChange();
    });
    // 锚点/样式编辑 → 防抖落盘
    this.chart.on('drawing:edited', () => {
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => { this.capture(); this.persist(); this.onChange(); }, 250);
    });
    this.chart.on('drawing:tool', ({ type }) => {
      this.activeTool = type ? (Object.keys(TOOL_MAP).find(k => TOOL_MAP[k] === type) || null) : null;
      this.pending = type ? this.pending : null;
      this.onChange();
    });
  }

  /** 当前工具样式（模板系统沿用 drawStyles.js 的存储） */
  styleFor(name) {
    try {
      const styles = this.getStyles ? this.getStyles() : null;
      const out = { styles: overlayStyles(styles, name) };
      if (name === 'fibonacciLine') out.extendData = fibExtendData(styles);
      return out;
    } catch { return { styles: null }; }
  }

  /** 激活工具：Vela 原生放置（点画在图上，Esc/右键取消走图内 UX） */
  activate(toolKey) {
    const d = this.chart?.drawings;
    if (!d?.supported) return null;
    this.cancelPending();
    const type = TOOL_MAP[toolKey];
    if (!type) return null;
    this.activeTool = toolKey;
    try {
      d.setStayMode(false);
      d.setTool(type);
      this.pending = 'armed';
    } catch {}
    this.onChange();
    return 'armed';
  }

  cancelPending() {
    const d = this.chart?.drawings;
    if (d) { try { d.setTool(null); } catch {} }
    this.pending = null;
    this.activeTool = null;
    this.onChange();
  }
  cancel() { this.cancelPending(); }

  /** 变更前快照 → 原生撤销栈（undo/redo 归 Vela） */
  snapshot() {}
  undo() {
    const d = this.chart?.drawings;
    if (!d?.canUndo?.()) return false;
    d.undo(); this.capture(); this.persist(); this.onChange();
    return true;
  }
  redo() {
    const d = this.chart?.drawings;
    if (!d?.canRedo?.()) return false;
    d.redo(); this.capture(); this.persist(); this.onChange();
    return true;
  }

  /** 改单条样式（覆盖层 + 落盘） */
  updateOverlayStyle(id, patch) {
    const d = this.chart?.drawings;
    if (!d) return false;
    const doc = d.toJSON().drawings.find(x => x.id === id);
    if (!doc) return false;
    const line = { ...(lineFromStyle(doc.style) || {}), ...patch };
    try { d.update(id, { style: { ...doc.style, ...styleFromLine(line) } }); } catch { return false; }
    this.capture(); this.persist(); this.onChange();
    return true;
  }

  removeOverlayById(id) {
    const d = this.chart?.drawings;
    if (!d) return false;
    try { d.remove(id); } catch { return false; }
    this.capture(); this.persist(); this.onChange();
    return true;
  }

  removeLast() {
    const d = this.chart?.drawings;
    if (!d) return;
    const list = d.toJSON().drawings;
    if (list.length) { try { d.remove(list[list.length - 1].id); } catch {} }
    this.capture(); this.persist(); this.onChange();
  }

  clear() {
    const d = this.chart?.drawings;
    if (!d) return;
    const ids = d.toJSON().drawings.map(x => x.id);
    if (ids.length) { try { d.removeMany(ids); } catch {} }
    this.capture(); this.persist(); this.onChange();
  }

  /** 图上的绘图 → 旧 item 形状（面板/自检兼容） */
  capture() {
    const d = this.chart?.drawings;
    const list = d ? (d.toJSON().drawings || []) : [];
    this.items = list
      .map(x => ({
        name: x.props?.tt || REV_MAP[x.type] || x.type,
        type: x.type,
        id: x.id,
        points: (x.anchors || []).map(a => ({ timestamp: a.time, value: a.price })),
        ...(lineFromStyle(x.style) ? { lineStyle: lineFromStyle(x.style) } : {})
      }))
      .filter(i => i.points.length > 0);
    return this.items;
  }

  /** 持久化 = Vela 文档原样落盘（含 id/style/props，恢复零重排） */
  async persist() {
    try {
      const d = this.chart?.drawings;
      const doc = d ? d.toJSON() : { version: 1, drawings: [] };
      await kvSet(this.key(), doc);
    } catch (e) { console.warn('[vela-draw] persist', e?.message); }
  }

  /** 读档：老格式（klinecharts items 数组）迁移成 Vela 文档后 fromJSON */
  async load() {
    const d = this.chart?.drawings;
    if (!d) return 0;
    const saved = await kvGet(this.key());
    if (Array.isArray(saved)) {
      // 旧格式迁移：{name, points, lineStyle} → SerializedDrawing
      const now = Date.now();
      const doc = {
        version: 1,
        drawings: saved.map((it, i) => {
          const type = TOOL_MAP[it.name] || 'trendline';
          return {
            id: `mig${now.toString(36)}${i}`,
            type, paneId: 'candle_pane',
            anchors: (it.points || []).filter(p => p.timestamp != null).map(p => ({ time: p.timestamp, price: p.value })),
            style: { ...(styleFromLine(it.lineStyle) || { lineColor: '#8adeff', lineWidth: 1, lineStyle: 'solid' }) },
            locked: false, visible: true, zIndex: i, createdAt: now,
            props: { tt: it.name }
          };
        })
      };
      try { d.fromJSON(doc); } catch (e) { console.warn('[vela-draw] 迁移失败', e?.message); }
    } else if (saved && Array.isArray(saved.drawings)) {
      try { d.fromJSON(saved); } catch (e) { console.warn('[vela-draw] 读档失败', e?.message); }
    }
    const n = this.capture();
    this.onChange();
    return n.length;
  }
}

