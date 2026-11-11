// Vela 0.9.3 装配：数据窗口（自定义 DataProvider）/ 原生回放（replay + setTicks 1m 推桶）/ 查询面。
// 对 main.js / workspace.js 暴露与旧 ChartApp / Replay 相同的公开面，业务层零改动（D4：本分支只有 Vela）。
import { PERIODS, periodSpanMs } from './aggregate.js';
import { BarSource } from './source.js';
import { TTFeed } from './vela-data.js';
import { decimalsFor } from './instruments.js';
import { registerVelaZhHans } from './vela-locale-zh.js';
import { buildVelaTheme } from './chart.js';

const VELA = () => window.VelaSDK;
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const BASE_MS = 500;                    // 1x = 500 ms/根（与旧 Replay 一致）

const toBiz = (b) => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

function velaTheme() {
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
}

/** 图表应用（Vela 版）：公开面 = 旧 chart.js 的 ChartApp */
export class VelaChartApp {
  /** 图表内核标记（selftest / 功能探测用） */
  isVela = true;
  constructor(container, profile) {
    this.container = container;
    this.profile = profile;
    this.source = new BarSource(profile);
    this.periodKey = '1m';
    // 有实时段时默认锚在实时边缘，否则锚在历史末尾（开盘即最新）——与旧版一致
    const liveEnd = profile.live?.last || 0;
    this.anchor = liveEnd > (profile.last || 0) ? liveEnd : profile.last;
    this.depth = 8000;                  // 回放窗口深度（P0-c：8k–20k，堆 2–8 MB）
    this.chart = null;
    this.feed = null;          // 自定义 MarketDataFeed（store 锚定可见窗口）
    this._seekSeq = 0;
    this.stats = { loads: 0, lastMs: 0, lastCount: 0 };
    this._waiters = [];
    this._onInit = null;
    this.replayParked = false;   // true = 宿主不在回放态（内部 replay 若被 Vela 续上也不据其游标封顶）
  }

  /** 查询面：state.app.bars.lastBar() / barAt(ts) / barsInRange(a,b) / allBars() / length */
  get bars() { return this.feed; }

  /** 绘图列表（klinecharts overlay 形状，main.js 的样式面板/管理面板/右键菜单零改动） */
  overlayList() {
    const d = this.chart?.drawings;
    if (!d) return [];
    const REV = { trendline: 'segment', polyline: 'polyline', ray: 'rayLine', hline: 'horizontalStraightLine',
      hray: 'horizontalRayLine', fibretracement: 'fibonacciLine', parallelchannel: 'priceChannelLine',
      freehand: 'brush', position: 'longPosition' };
    let list = [];
    try { list = d.toJSON().drawings || []; } catch {}
    return list.map(x => ({
      id: x.id,
      name: x.props?.tt || REV[x.type] || x.type,
      points: (x.anchors || []).map(a => ({ timestamp: a.time, value: a.price })),
      styles: { line: { color: x.style?.lineColor, size: x.style?.lineWidth, style: x.style?.lineStyle,
        dashedValue: x.style?.lineStyle === 'dashed' ? [4, 4] : [1, 0] } },
      locked: !!x.locked, visible: x.visible !== false
    }));
  }

  /** 磁吸开关 → 原生吸附（weak = 吸最近 OHLC） */
  setMagnet(on) {
    try { this.chart?.drawings?.setSnapMode(on ? 'weak' : 'off'); } catch {}
  }

  /** 查询封顶：回放中 = 游标（旧 getDataList 回放时只含已揭示的根）；非回放 = 窗口锚点
   *  （store 为回放跑道在锚点右侧多放的根，对业务层不可见 —— 旧窗口右端 = 锚点的语义） */
  _cursorCap() {
    try {
      const s = this.chart?.replay?.state;
      // replayParked：宿主已退出回放（setStart({enter:false})）。Vela 的 setMarket 会「把回放续到
      // 新数据」把 active 又拉回来 —— 只要宿主不在回放态，就绝不能用它的游标封顶，
      // 否则实时永远追不上（症状：退不出回放 / 图表冻在旧游标 / 每轮重复"补齐 N 根"空转）。
      if (s?.active && s.cursorTime && !this.replayParked) return s.cursorTime;
    } catch {}
    return this.anchor || null;
  }

  pageFor(key) { return (PERIODS.find(p => p.key === key) || PERIODS[0]).page; }

  async mount() {
    const { Vela } = VELA();
    registerVelaZhHans(VELA());       // [P5] zh-Hans 语言包（绘图工作流可见文本，未覆盖键回退英文）
    this.feed = new TTFeed(this, this.source);
    this.chart = new Vela(this.container, {
      theme: velaTheme(),
      locale: 'zh-Hans',
      animations: { zoom: 180, pan: true, autoScale: true, intro: false, liveBar: false },   // [P5] 官方同款滚轮缩放缓动 + 惯性平移；intro 首绘揭示保持关闭
      drawings: { toolbar: true },   // [P5] 官方原生绘图工具栏（工具全集 + 设置弹窗 + 撤销重做）
      live: false                       // [R15] 回退：live:true 下 runScript/脚本首跑不落定（4 轮实验：
                                        // 合成首 tick/稳定后补发均无效），Pine 管线优先。
                                        // TTFeed.subscribe 的合成 tick 与 pushLiveBar 桥保留，
                                        // 待 Vela 修复或查明首跑门控后一行重开
    }, { dataFeed: this.feed });
    this._theme = buildVelaTheme(velaTheme());     // 主题对象基线：setStyles 在它上面盖用户改的涨跌色/网格
    await this.reloadWindow(this.anchor);
    // 容器尺寸变化兜底（Vela 自带观察，这里只防面板开合的极端情况）
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { try { this.chart.resize(); } catch {} });
      this._ro.observe(this.container);
    }
    return this.chart;
  }

  /** 按 anchor 重建窗口。同身份 setMarket 不会重取数（实测：store 永锚实时尾），
   *  所以已加载过时先用一个廉价中间周期切走身份，再切回来 —— feed.load(cfg) 携带
   *  visibleRange，store 由我们的返回值锚定在请求窗口（实测 15 ms 级 + 一次中间浅载）。 */
  async reloadWindow(anchorTs, { identity = false } = {}) {
    const span = periodSpanMs(this.periodKey);
    const page = this.pageFor(this.periodKey);
    const t0 = performance.now();
    if (!identity && this._loadedOnce) {
      // 中间身份：真实周期（不能用 2m 这类未登记周期 —— span 会回退 1m），浅 store 即弃
      const alt = this.periodKey === '1m' ? '5m' : '1m';
      await this.chart.setMarket({ timeframe: alt, bars: 400 });
      try { await this.chart.historyComplete(); } catch {}
    }
    await this.chart.setMarket({
      symbol: this.profile.symbol,
      timeframe: this.periodKey,
      bars: this.depth,
      visibleRange: { from: anchorTs - page * span, to: anchorTs + span - 1 }
    });
    try { await this.chart.historyComplete(); } catch {}   // 深度回填落地后再继续（防乱序/镜像未齐）
    this._loadedOnce = true;
    this.anchor = anchorTs;
    this.stats = {
      loads: this.stats.loads + 1,
      lastMs: +(this.feed.lastReadMs || 0).toFixed(1),
      lastCount: this.feed.length
    };
    this._markLoaded(this.feed.length);
    if (this._onInit) { const f = this._onInit; this._onInit = null; f(this.feed.length); }
    return performance.now() - t0;
  }

  /** 窗口右端定到 ts 并重灌（回放起点 / 跳转 / 回退共用）——语义同旧 seek */
  async seek(ts) {
    await this.reloadWindow(ts);
    return this.lastTs();
  }

  async goto(timestampMs) { return this.seek(timestampMs); }

  /** 实时续传后把「窗口右端」跟到最新一根（只推 anchor，不重建 store）。
   *  不跟进的话 lastTs() 会永远停在退出回放时的锚点：实时追赶每轮都判定"落后 N 根"，
   *  重复推同样的根，图表看着就是不走（实测症状）。 */
  followLive(ts) {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return;
    try { if (this.chart?.replay?.state?.active) return; } catch {}
    if (t > (this.anchor || 0)) this.anchor = t;
  }

  /** 样式适配：main.js/theme.js 仍是按 klinecharts 的 setStyles 形状调（版面设置里改涨跌色、
   *  网格、主题切换），Vela 内核只有 setTheme(theme 对象) —— 在这里做最小映射，
   *  否则这些「图表设置」在 vela 分支上全是无声 no-op（且每次切 tab 抛一条 TypeError）。 */
  setStyles(styles = {}) {
    try {
      const base = buildVelaTheme(velaTheme());   // 每次按当前亮暗模式重算：切主题时底色/文字色才会跟着换
      const bar = styles.candle?.bar || {};
      const up = bar.upColor || base.upColor;
      const down = bar.downColor || base.downColor;
      const gridOn = styles.grid?.show !== false;
      const gridColor = styles.grid?.horizontal?.line?.color || styles.grid?.vertical?.line?.color;
      const theme = { ...base };
      if (gridColor) theme.gridColor = gridOn ? gridColor : 'rgba(0,0,0,0)';
      // 自定义底色：applyLayout 把颜色写在 --chart-bg 上（Vela 不读 CSS 变量），这里同步给内核
      try {
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--chart-bg').trim();
        if (bg) theme.background = bg;
      } catch {}
      this.chart?.setTheme?.(theme);
      // 涨跌色不在 theme 里（内核 deriveTheme 会用 config.candles 覆盖），必须走 applyConfig
      const upBorder = bar.upBorderColor || up;
      const downBorder = bar.downBorderColor || down;
      try {
        this.chart?.renderer?.applyConfig?.({ candles: {
          upColor: up, downColor: down,
          borderUpColor: upBorder, borderDownColor: downBorder,
          wickUpColor: bar.upWickColor || upBorder, wickDownColor: bar.downWickColor || downBorder
        } });
      } catch (e) { console.warn('[vela:styles:candles]', e?.message || e); }
      this._theme = theme;
      return true;
    } catch (e) { console.warn('[vela:styles]', e?.message || e); return false; }
  }

  async switchPeriod(key) {
    if (!PERIODS.some(p => p.key === key)) return;
    this.periodKey = key;
    await this.reloadWindow(this.anchor, { identity: true });
  }

  /** 当前最后一根的时间戳（没有就 null）；回放中封顶在游标 */
  lastTs() {
    const cap = this._cursorCap();
    const b = cap ? this.feed?.barAtOrBefore(cap) : this.feed?.lastBar();
    return b ? b.timestamp : null;
  }

  lastBar() {
    const cap = this._cursorCap();
    if (cap == null) return this.feed?.lastBar() || null;
    // 回放中：>1m 的 forming 桶是逐 tick 的渲染态，store 里只有完整桶 —— 优先取渲染态
    return this.replayRef?._rendered || this.feed?.barAtOrBefore(cap) || null;
  }

  /** 实时数据落库后刷新「有实时段」的标志（语义同旧版） */
  async refreshLive() {
    try {
      const { getProfile } = await import('./db.js');
      const p = await getProfile(this.profile.id);
      if (p) {
        this.profile = { ...this.profile, ...p };
        this.source.hasLive = !!(p.live && (p.live.days || []).length);
      }
      return !!this.source.hasLive;
    } catch { return false; }
  }

  /** 旧回放推杆：Vela 用原生 replay，推bar语义作废（保留空实现防旧调用点炸） */
  pushBar() {}

  /** 数据到手后再定小数位（Vela 侧由 getSymbolInfo 提供，这里只返回位数保持兼容） */
  applyPrecisionFromData() {
    try {
      const b = this.lastBar();
      return decimalsForSafe(this.profile.symbol, b ? b.close : null);
    } catch { return null; }
  }

  waitLoaded(timeout = 8000) {
    const n = this.feed?.length || 0;
    if (n > 0) return Promise.resolve(n);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('加载超时')), timeout);
      this._waiters.push((count) => { clearTimeout(timer); resolve(count); });
    });
  }

  /** 兼容旧接口：等一次窗口重建落地 */
  waitInit(timeout = 8000) {
    if (this.feed?.length > 0) return Promise.resolve(this.feed.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._onInit = null; reject(new Error('加载超时')); }, timeout);
      this._onInit = (n) => { clearTimeout(timer); this._onInit = null; resolve(n); };
    });
  }

  _markLoaded(n) {
    const waiters = this._waiters;
    this._waiters = [];
    for (const fn of waiters) fn(n);
  }

  dispose() {
    try { this._ro?.disconnect(); } catch {}
    try { this.chart?.destroy(); } catch {}
    this.chart = null;
  }
}

function decimalsForSafe(symbol, close) {
  try { return decimalsFor(symbol, close); } catch { return 2; }
}

/**
 * 回放（Vela 原生 replay）：公开面 = 旧 replay.js 的 Replay。
 * - 1m 图：step() 逐根整根揭示；
 * - >1m 图：replaySetTicks 把每根聚合 bar 按其 1m 组成逐 tick 展开 —— 与旧「推桶」语义一致
 *   （forming 桶每分钟长一次），且指标/图表按 live 路径跟随。
 * - onTick(bar1m) 每 1m 步触发一次（交易撮合/状态栏依赖它，bar 为 klinecharts 形状）。
 */
export class ReplayV {
  constructor(app, { onTick, onState } = {}) {
    this.app = app;
    this.source = app.source;
    this.cursor = app.profile.last;
    this.playing = false;
    this.speed = 1;
    this.bucket = null;                 // 旧接口兼容（Vela 无桶，恒 null）
    this.onTick = onTick || (() => {});
    this.onState = onState || (() => {});
    this._tickMap = new Map();          // bar.time → 该桶的 1m 组成（tick 源会被预取，必须按桶键控）
    this._startTs = null;               // 回放起点（起点桶的 ≤ 起点部分要折成预置 tick）
    this._rendered = null;              // 渲染态的最后一根（forming 桶 ≠ store 里的完整桶）
    this._wired = false;
    this._wire();
  }

  get spanMs() { return periodSpanMs(this.app.periodKey); }
  msPerBar() { return Math.max(16, BASE_MS / this.speed); }

  state() {
    const s = this._rs() || {};
    return {
      cursor: this.cursor,              // 1m 分辨率（跨格共享时钟语义；cursorTime 是桶级）
      playing: s.playing ?? this.playing,
      speed: this.speed,
      period: this.app.periodKey,
      total: this.app.profile.last,
      buckets: null
    };
  }
  _rs() { try { return this.app.chart?.replay?.state || null; } catch { return null; } }
  emit() { this.onState(this.state()); }

  /** forming 桶的渲染态：组成数组 [0..index] 聚合（时间 = 桶开盘时间） */
  _renderFrom(bucketTs, index, arr) {
    if (!arr || !arr.length) return;
    const upto = arr.slice(0, Math.min(index, arr.length - 1) + 1);
    if (!upto.length) return;
    this._rendered = {
      timestamp: bucketTs,
      open: upto[0].open,
      high: Math.max(...upto.map(b => b.high)),
      low: Math.min(...upto.map(b => b.low)),
      close: upto[upto.length - 1].close,
      volume: upto.reduce((s, b) => s + (b.volume || 0), 0)
    };
  }

  _wire() {
    if (this._wired || !this.app.chart) return;
    this._wired = true;
    const c = this.app.chart;
    c.on('replay:start', () => { this.emit(); });
    c.on('replay:play', () => { this.playing = true; this.emit(); });
    c.on('replay:pause', () => { this.playing = false; this.emit(); });
    c.on('replay:end', () => { this.playing = false; this._rendered = null; this._tickMap = new Map(); this.emit(); });
    // >1m：每个 tick = 一根 1m 组成（tickSource 按序消费），喂给交易撮合/状态栏
    c.on('replay:tick', ({ cursorTime, index }) => {
      const arr = this._tickMap?.get(cursorTime);
      const b = arr?.[index];
      if (b) { this.cursor = b.timestamp; this.onTick(b, b); this._renderFrom(cursorTime, index, arr); }
      this.emit();
    });
    // 桶完成（最后一个 tick 收敛）：渲染态 = store 里的完整桶
    c.on('replay:step', ({ cursorTime }) => {
      const b = this.app.feed ? this.app.feed.barAtOrBefore(cursorTime) : null;
      if (b) this._rendered = b;
    });
    // 1m（或无 ticks 时整根揭示）：'bar' 事件 = 一根新bar（回放揭示也走它）
    // 只在回放态消费：历史装载不触发（'bar' 只在 live tick / 揭示时发，但加载尾部也可能算
    // "appended"——用 replay.active 把口子收死，避免 boot 时对每根历史 bar 调 onTick）
    c.on('bar', (payload) => {
      const s = this._rs();
      if (!s?.active) return;
      const b = payload && payload.bar ? payload.bar : payload;
      if (b && b.time != null) {
        const bb = toBiz(b);
        this.cursor = bb.timestamp;
        this._rendered = bb;            // 整根揭示：渲染态 = 揭示的那根
        this.onTick(bb, bb);
      }
      this.emit();
    });
  }

  /** >1m 周期装上 tick 源：每根聚合 bar 的 tick = 它 span 内的 1m 根。
   *  起点桶特殊：≤ 起点的成员折成一个「预置 tick」（旧模型窗口构建时预烤部分桶的语义，
   *  步进从起点的下一根开始），其后 tick 正常逐根。 */
  _bindTicks() {
    const r = this.app.chart?.replay;
    if (!r || this.spanMs === 60_000) return;
    const need = Math.ceil(this.spanMs / 60_000) + 2;
    const startTs = this._startTs;
    r.setTicks(async (bar, { end }) => {
      try {
        const bars = await this.source.nextBars(bar.time - 1, need);
        const inSpan = bars.filter(b => b.timestamp >= bar.time && b.timestamp < end);
        if (startTs != null && bar.time <= startTs && startTs < end) {
          const pre = inSpan.filter(b => b.timestamp <= startTs);
          const rest = inSpan.filter(b => b.timestamp > startTs);
          if (pre.length) {
            const synth = {
              timestamp: pre[pre.length - 1].timestamp,   // 游标语义 = 预烤到的最后一根 1m
              open: pre[0].open,
              high: Math.max(...pre.map(b => b.high)),
              low: Math.min(...pre.map(b => b.low)),
              close: pre[pre.length - 1].close,
              volume: pre.reduce((s, b) => s + (b.volume || 0), 0)
            };
            this._tickMap.set(bar.time, [synth, ...rest]);
            return [
              { price: synth.close, high: synth.high, low: synth.low, open: synth.open, volume: synth.volume },
              ...rest.map(b => ({ price: b.close, high: b.high, low: b.low, open: b.open, volume: b.volume }))
            ];
          }
        }
        this._tickMap.set(bar.time, inSpan);
        return inSpan.map(b => ({ price: b.close, high: b.high, low: b.low, open: b.open, volume: b.volume }));
      } catch {
        return [];                      // 空列表 = 整根揭示（引擎文档语义）
      }
    });
  }

  /** start 的 from 口径：>1m 用「起点所在桶的桶边界 - 1」（该桶保持隐藏、以 ticks 逐分钟
   *  展开 = 旧「部分桶」语义；ts 在桶中间时只减 1ms 藏不掉它 —— 05:58 的 5m 桶 05:55 仍会被
   *  整根保留，实测踩过）；1m 用 ts（起点根可见，首步揭示下一根 = 旧 nextBars 推进） */
  _fromFor(ts) {
    if (this.spanMs <= 60_000) return ts;
    return Math.floor(ts / this.spanMs) * this.spanMs - 1;
  }

  /** 确保处于回放态（不在则进入：游标落在起点口径上） */
  async _ensureReplay() {
    const r = this.app.chart?.replay;
    if (!r) return;
    if (!r.state.active) {
      this.app.replayParked = false;                       // 重新进回放：解除 parked 封顶
      this._startTs = this.cursor || this.app.profile.last;
      await r.start({ from: this._fromFor(this.cursor || this.app.profile.last) });
      this._bindTicks();
    }
  }

  /** 把起点桶的预置 tick 立刻消费掉（旧模型：部分桶在窗口构建时就已「预烤」在图上，
   *  不占步数 —— setStart 后图上直接可见起点桶的已走部分，步进从起点下一根开始）。
   *  守卫：只有「首个隐藏桶包含起点」时才有预烤（起点落在缺口上时下一个桶在起点之后，
   *  没有已走部分，消费一步反而会多走一根）。 */
  _prebake() {
    const r = this.app.chart?.replay;
    const span = this.spanMs;
    if (!r || span <= 60_000 || !r.state.active) return;
    const st = this._startTs;
    if (st == null) return;
    // 起点所在桶被 _fromFor 整根藏掉了：按 1m tick 把「起点之前的已走部分」烤出来，
    // 否则图上只有一个 1m 的小尖（1D 就是 1/1440 根）。tick 固定是 1m，可直接算条数。
    const bucketStart = Math.floor(st / span) * span;
    const perBar = Math.max(1, Math.round(span / 60_000));
    const need = Math.min(Math.max(1, Math.ceil((st - bucketStart) / 60_000) + 1), perBar);
    for (let i = 0; i < need; i++) {
      let ok = false;
      try { ok = r.stepUpdate(); } catch { ok = false; }
      if (!ok) break;
    }
  }

  /** 把 Vela 内部回放停干净。它在 setMarket/historyComplete 之后会把 active **异步续回来**
   *  （"换周期把回放续到新数据"），单次 stop 会漏 —— 必须连续两次检测到 inactive 才算停稳。 */
  async _stopReplayHard(r, tries = 12) {
    if (!r) return false;
    let calm = 0;
    for (let i = 0; i < tries; i++) {
      const active = (() => { try { return !!r.state.active; } catch { return false; } })();
      if (active) { calm = 0; try { r.stop(); } catch {} }
      else if (++calm >= 2) return true;
      await new Promise((res) => setTimeout(res, 50));
    }
    try { return !r.state.active; } catch { return false; }
  }

  /** 设定回放起点：窗口重建（store 锚到 ts）。回放激活时要先 stop 干净退出 ——
   *  周期往返会把回放 carry-over 到新市场（实测进入 cursorTime:null/remaining:0 的僵死态），
   *  重建后再 start 重进。 */
  async setStart(ts, { enter = true } = {}) {
    this.pause();
    this.cursor = ts;
    this._startTs = ts;
    this.bucket = null;
    const r = this.app.chart?.replay;
    // enter=false = 宿主退出回放/追实时：先挂 parked，seek 期间 Vela 续上回放也不会被封顶
    this.app.replayParked = !enter;
    await this._stopReplayHard(r);
    await this.app.seek(ts).catch(() => {});
    // 关键：设起点后**必须进回放态**，否则 store 里游标右侧那段「跑道」会直接画出来
    // （症状：随机起点一按，未来 K 线全露）。退出回放/实时追窗这类调用传 { enter:false }。
    if (r && enter) {
      try {
        await r.start({ from: this._fromFor(ts) });
        this._rendered = null; this._tickMap = new Map(); this._bindTicks();
        this._prebake();
      } catch {}
    } else if (r) {
      // 退出回放这条路：seek 里的 setMarket 会按「换周期把回放续到新数据」把 active 又拉回来
      // （Vela 原生行为），所以重建窗口之后必须再停一次 —— 且要停到"不再自己活过来"为止。
      await this._stopReplayHard(r);
    }
    this.emit();
  }

  /** 前进 n 个 1m 步；返回实际步数（>1m 走 stepUpdate，1m 走 step；跑道耗尽自动续窗） */
  async step(n = 1) {
    const r = this.app.chart?.replay;
    if (!r) return 0;
    await this._ensureReplay();
    let advanced = 0;
    for (let i = 0; i < n; i++) {
      // 统一用「揭示下一根 bar」：>1m 时 stepUpdate 只推进一个 1m tick（一根 1D 要 1440 次），
      // 看起来就是按了没反应。step() 会把正在成形的桶直接收完，语义 = 旧版「前进一根」。
      let ok = r.step();
      if (!ok) {
        if (!(await this._extendIfNeeded())) break;
        ok = r.step();
        if (!ok) break;
      }
      advanced++;
    }
    if (advanced) this.emit();
    return advanced;
  }

  /** store 跑道耗尽（remaining=0 且还没到档案最后一根）：以 cursor 为锚重建窗口再续。
   *  （Vela 回放只揭示已在内存里的根 —— P0-c；跑道 = store 在游标右侧的余量） */
  async _extendIfNeeded() {
    const r = this.app.chart.replay;
    const s = r.state;
    if (!s.active) return false;
    if (s.remaining > 0) return true;
    const last = this.app.profile.last || 0;
    if (!last || this.cursor + this.spanMs > last) return false;   // 真到头
    try { r.stop(); } catch {}                                      // 同 setStart：先退出再重建
    await this.app.seek(this.cursor).catch(() => {});
    this.app.replayParked = false;
    await r.start({ from: this._fromFor(this.cursor) });
    this._rendered = null;
    this._tickMap = new Map();
    this._bindTicks();
    this._prebake();
    return true;
  }

  /** 回退 n 根（重建窗口，游标落在目标根） */
  async back(n = 1) {
    this.pause();
    let ts = this.cursor;
    for (let i = 0; i < n; i++) {
      const p = await this.source.prevBar(ts);
      if (!p) break;
      ts = p.timestamp;
    }
    await this.setStart(ts);
  }

  async jump(ts) { await this.setStart(ts); }

  play() {
    if (this.playing) return;
    const r = this.app.chart?.replay;
    if (!r) return;
    this._ensureReplay().then(() => {
      if (this.playing) r.play(this.msPerBar());
    });
    this.playing = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    try { this.app.chart?.replay?.pause(); } catch {}
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }
  setSpeed(x) {
    this.speed = x;
    if (this.playing) { try { this.app.chart.replay.play(this.msPerBar()); } catch {} }
    this.emit();
  }
}

/* ————— P3/P4 前的占位层：绘图与 Pine 的图表耦合部分（接口对齐，全部 no-op） —————
   保留 UI 面板可用、boot 不炸；图表侧实现分别在 vela-draw.js（P3）/ vela-ind.js（P4）接回。 */

export class DrawStub {
  constructor(chart, { symbol, periodKey, onChange } = {}) {
    this.chart = chart;
    this.symbol = symbol;
    this.periodKey = periodKey;
    this.items = [];
    this.activeTool = null;
    this.onChange = onChange || (() => {});
  }
  key() { return `draw:${this.symbol}:${this.periodKey}`; }
  async load() {}
  persist() {}
  capture() {}
  activate(toolKey) { this.activeTool = toolKey; this.onChange(); return false; }
  styleFor() { return null; }
  updateOverlayStyle() {}
  removeOverlayById() {}
  clear() {}
  cancelPending() { this.activeTool = null; this.onChange(); }
}

export class PineStub {
  constructor(chart) {
    this.chart = chart;
    this.symbol = null;
    this.items = [];
  }
  list() { return this.items; }
  async compute() { return { ok: false, error: 'Pine 桥接中（P4）' }; }
  async apply() { return { ok: false, error: 'Pine 桥接中（P4）' }; }
  async remove() {}
}
