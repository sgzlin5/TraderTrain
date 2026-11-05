// Vela MarketDataFeed（自定义底层 feed，经 new Vela(el, opts, { dataFeed }) 裸注入）：
// IndexedDB 年分片（BarSource）→ load(cfg)；store 锚定在「请求的可见窗口」而不是实时尾
// （provider 注册表模式的 store 永远从实时尾向前加深，任意日期起点没法回放 —— 2026-11-05 实测）。
// 同时维护「已喂给 Vela 的 store」镜像，供 barAt / lastBar / barsInRange 同步查询
// （Vela 图表层没有公开的 bars 访问器，P0-b 实测）。
// 硬规则（P0-c 实测）：永不返回整段 —— limit 自保截断，镜像封顶 2×MIRROR_CAP。
import { BarSource } from './source.js';
import { periodSpanMs } from './aggregate.js';
import { decimalsFor } from './instruments.js';

const MAX_DEPTH = 20_000;          // 单次 load 的 store 深度上限（回放窗口深度预算）
const MIRROR_CAP = 40_000;         // 镜像封顶 = 2×MAX_DEPTH，超出丢最老的

/** BarSource 的 1m 形状 {timestamp,...} → Vela 形状 {time,...} */
const toVela = (b) => ({ time: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
/** Vela 形状 → 1m 形状（业务层 48 处 .timestamp 零改动） */
const toBiz = (b) => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

export class TTFeed {
  /** @param {import('./vela.js').VelaChartApp} app */
  constructor(app, source) {
    this.app = app;
    this.source = source instanceof BarSource ? source : new BarSource(app.profile);
    this.mirror = [];              // 升序 {time,...}——当前已喂给 Vela 的 store
    this.lastReadMs = 0;
    this.calls = [];               // 取数日志（P1 实测用）
    this._onBar = null;            // P1.5：实时 forming bar 出口
    this._liveTimer = null;
  }
  get symbol() { return this.app.profile.symbol; }

  /** 从 BarSource 切 [from, to]（闭区间，anchor=to 结尾）、最多 limit 根的升序窗口 */
  async _slice(from, to, limit, span) {
    const cap = Math.min(limit ?? MAX_DEPTH, MAX_DEPTH);
    let bars;
    try {
      bars = span === 60_000
        ? await this.source.frame1m(to, cap)
        : await this.source.frame(to, span, cap);
    } catch (e) {
      console.error('[vela-data:slice]', e?.message || e);
      return [];
    }
    if (from != null && bars.length) {
      let lo = 0, hi = bars.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].timestamp < from) lo = m + 1; else hi = m; }
      bars = bars.slice(lo);
    }
    return bars;
  }

  /**
   * MarketDataFeed.load：cfg = {symbol, timeframe, bars, visibleRange?}。
   * **store 的布局由返回值决定**（裸 feed，Vela 不二次安排）：
   * - visibleRange 给了 → 视口 = [vr.from, vr.to]；store = 以 vr.to + runway 为尾的
   *   depth 根（runway = depth - 视口根数，供回放向右逐根揭示，实测 Vela 的深度
   *   回填永远从 store 尾部向前翻页、visibleRange 对数据布局无效 —— 必须由 load 一次给足）。
   * - 没给 → 尾部 depth 根（boot 默认 / 实时贴边）。
   */
  async load(cfg = {}) {
    if (this.calls.length < 80) this.calls.push({ tf: cfg.timeframe, from: cfg.visibleRange?.from, to: cfg.visibleRange?.to, bars: cfg.bars });
    const span = periodSpanMs(cfg.timeframe);
    const depth = Math.min(cfg.bars ?? MAX_DEPTH, MAX_DEPTH);
    const vr = cfg.visibleRange;
    const last = this.app.profile.last ?? 0;
    let storeTo;
    if (vr && vr.to != null) {
      const viewportBars = vr.from != null ? Math.ceil((vr.to - vr.from) / span) + 1 : 0;
      storeTo = vr.to + Math.max(depth - viewportBars, 0) * span;
    } else {
      storeTo = last;
    }
    const bars = await this._slice(storeTo - (depth - 1) * span, storeTo, depth, span);
    const out = bars.map(toVela);
    this._resetMirror(out);
    this.lastReadMs = this.source.lastReadMs;
    return out;
  }

  /** Vela 的尾部增量口（实时续传 / 断线重连）。P1 先按切片实现；P1.5 接 liveStore 合并 */
  async loadRange(cfg = {}, range = {}) {
    if (this.calls.length < 80) this.calls.push({ fn: 'loadRange', tf: cfg.timeframe, ...range });
    const span = periodSpanMs(cfg.timeframe);
    const to = range.to ?? this.app.profile.last ?? 0;
    const bars = await this._slice(range.from ?? to - 5000 * span, to, range.limit ?? 5000, span);
    const out = bars.map(toVela);
    this._mergeMirror(out);
    return out;
  }

  /**
   * 实时 forming bar 订阅。**关键（R15）**：Vela 的 live 管线在等「第一个 tick」——
   * 没有它 runScript/脚本首跑永不落定（实测：手动补一个 tick 后挂起的脚本立刻完成）。
   * 所以 subscribe 时用存量最后一根补发一个合成 tick（值不变 = 视觉无变化），
   * 无需上游在线即可解锁；此后真实 tick 由 live 桥经 pushLiveBar 进入。
   */
  subscribe(cfg, onBar) {
    this._onBar = onBar;
    // 订阅早于历史加载——等 mirror 稳定（连续 1s 无增长）再补发合成首 tick：
    // 过早的 tick 会被加载中的管线丢掉（实测）
    let tries = 0, lastN = -1, stable = 0;
    const tick = () => {
      if (this._onBar !== onBar) return;                      // 已退订
      const n = this.mirror.length;
      if (n === 0) { if (++tries < 80) setTimeout(tick, 100); return; }
      if (n !== lastN) { lastN = n; stable = 0; if (++tries < 120) setTimeout(tick, 100); return; }
      if (++stable < 3) { setTimeout(tick, 350); return; }    // 稳定 ~1s
      const last = this.mirror[n - 1];
      try { onBar({ ...last }); } catch (e) { console.warn('[vela-data:首tick]', e?.message); }
    };
    setTimeout(tick, 100);
    return () => { if (this._onBar === onBar) this._onBar = null; };
  }

  /** 实时推送入口（P1.5 由 live 桥调用）：更新镜像尾 + 喂给图表 */
  pushLiveBar(bar) {
    const v = toVela(bar);
    const m = this.mirror;
    if (m.length && v.time === m[m.length - 1].time) m[m.length - 1] = v;
    else if (!m.length || v.time > m[m.length - 1].time) m.push(v);
    else return;
    try { this._onBar?.(v); } catch (e) { console.warn('[vela-data:onBar]', e?.message); }
  }

  symbolInfo(cfg = {}) {
    const close = this.app.profile.lastClose ?? null;
    const dp = decimalsFor(cfg.symbol || this.symbol, close);
    return {
      ticker: cfg.symbol || this.symbol, description: cfg.symbol || this.symbol,
      pricescale: Math.pow(10, dp), mintick: Math.pow(10, -dp),
      pricePrecision: dp, minMove: Math.pow(10, -dp), timezone: 'UTC'
    };
  }

  /** load 语义 = 整段换血（窗口重建），镜像直接替换 */
  _resetMirror(out) {
    this.mirror = out.slice();
    if (this.mirror.length > MIRROR_CAP) this.mirror = this.mirror.slice(this.mirror.length - MIRROR_CAP);
  }
  _mergeMirror(out) {
    if (!out.length) return;
    const m = this.mirror;
    if (!m.length || out[0].time > m[m.length - 1].time) {
      this.mirror = m.concat(out);
    } else if (out[out.length - 1].time < m[0].time) {
      this.mirror = out.concat(m);
    } else {
      const map = new Map();
      for (const b of m) map.set(b.time, b);
      for (const b of out) map.set(b.time, b);
      this.mirror = [...map.values()].sort((a, b) => a.time - b.time);
    }
    if (this.mirror.length > MIRROR_CAP) this.mirror = this.mirror.slice(this.mirror.length - MIRROR_CAP);
  }

  // —— 查询面（klinecharts 形状，业务层直接用） ——
  get length() { return this.mirror.length; }
  /** 某根（按开盘时间，精确匹配）；没有返回 null */
  barAt(ts) {
    const m = this.mirror;
    let lo = 0, hi = m.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; const t = m[mid].time; if (t === ts) return toBiz(m[mid]); if (t < ts) lo = mid + 1; else hi = mid - 1; }
    return null;
  }
  /** ≤ ts 的最后一根（游标语义）；没有返回 null */
  barAtOrBefore(ts) {
    const m = this.mirror;
    if (!m.length || ts < m[0].time) return null;
    let lo = 0, hi = m.length - 1, r = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (m[mid].time <= ts) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return toBiz(m[r]);
  }
  /** 第一个 timestamp >= ts 的下标（没有 → length）；图例取值用 */
  indexAtOrAfter(ts) {
    const m = this.mirror;
    let lo = 0, hi = m.length, r = m.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (m[mid].time >= ts) { r = mid; hi = mid; } else lo = mid + 1; }
    return r;
  }
  lastBar() { const m = this.mirror; return m.length ? toBiz(m[m.length - 1]) : null; }
  /** [a,b] 闭区间内的根（klinecharts 形状，升序） */
  barsInRange(a, b) {
    const m = this.mirror;
    let lo = 0, hi = m.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (m[mid].time < a) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < m.length && m[i].time <= b; i++) out.push(toBiz(m[i]));
    return out;
  }
  /** 全窗口（klinecharts 形状）——给原 getDataList() 调用点兜底；只读勿改 */
  allBars() { return this.mirror.map(toBiz); }
}
