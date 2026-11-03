// klinecharts 10.1.0 装配：单一品种 / 多周期聚合 / 向更早翻页
import { PERIODS, periodSpanMs } from './aggregate.js';
import { BarSource } from './source.js';
import { decimalsFor } from './instruments.js';

const K = window.klinecharts;

const PERIOD_TYPE = (key) => {
  if (key === '1d') return { span: 1, type: 'day' };
  if (key === '4h') return { span: 4, type: 'hour' };
  if (key === '1h') return { span: 1, type: 'hour' };
  return { span: parseInt(key, 10), type: 'minute' };
};

const MONO = 'SFMono-Regular, Consolas, "Cascadia Mono", monospace';

/** 图表配色：与 styles.css 的主题 token 一一对应 */
const CHART_THEME = {
  dark: {
    mode: 'dark',
    up: '#5fe3c0', down: '#ff6f85', flat: '#94a9bb',
    grid: 'rgba(255,255,255,.032)', hair: 'rgba(255,255,255,.09)', axis: '#6f8b9e',
    cross: '#8adeff', crossText: '#b6efff', crossBg: '#0b1a26', lastText: '#07131d',
    ind: ['#8adeff', '#ffc36b', '#b6efff', '#ff9ec4']
  },
  light: {
    mode: 'light',
    up: '#12a37c', down: '#e0505f', flat: '#7b8fa3',
    grid: 'rgba(15,35,60,.10)', hair: 'rgba(15,35,60,.14)', axis: '#6b8199',
    cross: '#1f6feb', crossText: '#1668d6', crossBg: '#ffffff', lastText: '#ffffff',
    ind: ['#1f6feb', '#d9822b', '#0f9b8e', '#c94f7c']
  },
  sky: {
    mode: 'light',
    up: '#0f8bc4', down: '#e2665f', flat: '#7b93a6',
    grid: 'rgba(12,70,110,.12)', hair: 'rgba(12,70,110,.16)', axis: '#5b7d94',
    cross: '#0b7fd4', crossText: '#0a6cbb', crossBg: '#ffffff', lastText: '#ffffff',
    ind: ['#0b7fd4', '#e08a2b', '#0f9b8e', '#c94f7c']
  },
  amber: {
    mode: 'light',
    up: '#e08a2b', down: '#2f6f9e', flat: '#9c8574',
    grid: 'rgba(120,70,20,.12)', hair: 'rgba(120,70,20,.16)', axis: '#8a6f57',
    cross: '#c96a17', crossText: '#b25e12', crossBg: '#fffdf9', lastText: '#ffffff',
    ind: ['#c96a17', '#2f6f9e', '#0f9b8e', '#b0436f']
  }
};

/** 当前主题的指标线配色（给「指标设置」里生成默认颜色用） */
export function indicatorPalette() {
  const key = currentThemeKey();
  return (CHART_THEME[key] || CHART_THEME.dark).ind;
}

export function currentThemeMode() {
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
}

/** 当前主题 key（dark / light / sky / amber） */
export function currentThemeKey() {
  const k = document.documentElement.dataset.theme;
  return CHART_THEME[k] ? k : 'dark';
}

/** 生成图表样式（网格/蜡烛/坐标轴/十字光标/指标/绘图） */
export function buildChartTheme(mode = currentThemeKey()) {
  const t = CHART_THEME[mode] || CHART_THEME.dark;
  const isLight = t.mode === 'light';
  return {
    grid: {
      horizontal: { line: { color: t.grid, size: 1, style: 'dashed', dashedValue: [2, 5] },
        text: { color: t.axis, size: 11, family: MONO } },
      vertical: { line: { color: t.grid, size: 1, style: 'dashed', dashedValue: [2, 5] },
        text: { color: t.axis, size: 11, family: MONO } }
    },
    candle: {
      bar: {
        upColor: t.up, downColor: t.down, noChangeColor: t.flat,
        upBorderColor: t.up, downBorderColor: t.down, noChangeBorderColor: t.flat,
        upWickColor: t.up, downWickColor: t.down, noChangeWickColor: t.flat
      },
      tooltip: {
        showRule: 'follow_cross',
        showType: 'standard',
        rect: {
          position: 'pointer',
          color: isLight ? 'rgba(255,255,255,.97)' : 'rgba(6,14,22,.94)',
          borderColor: isLight ? 'rgba(15,35,60,.16)' : 'rgba(138,175,202,.22)',
          borderSize: 1, borderRadius: 3,
          paddingLeft: 9, paddingRight: 9, paddingTop: 7, paddingBottom: 7,
          offsetLeft: 14, offsetTop: 14
        },
        title: { show: true, color: t.crossText, size: 11, family: MONO, weight: '500' },
        legend: {
          color: isLight ? '#46617a' : '#94a9bb', size: 11, family: MONO, defaultValue: '—',
          template: ({ current }) => (current ? [
            { title: '开', value: current.open != null ? current.open.toFixed(2) : '—' },
            { title: '高', value: current.high != null ? current.high.toFixed(2) : '—' },
            { title: '低', value: current.low != null ? current.low.toFixed(2) : '—' },
            { title: '收', value: current.close != null ? current.close.toFixed(2) : '—' }
          ] : [])
        }
      },
      priceMark: {
        high: { color: t.axis, textColor: t.axis, textSize: 10, textFamily: MONO },
        low: { color: t.axis, textColor: t.axis, textSize: 10, textFamily: MONO },
        last: {
          upColor: t.up, downColor: t.down, noChangeColor: t.flat,
          line: { color: t.up, size: 1, style: 'dashed', dashedValue: [4, 4] },
          text: { color: t.lastText, size: 11, family: MONO, borderRadius: 2,
            paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3 }
        }
      }
    },
    xAxis: { axisLine: { color: t.hair }, tickLine: { show: false, color: t.hair },
      tickText: { color: t.axis, size: 11, family: MONO } },
    yAxis: { axisLine: { color: t.hair }, tickLine: { show: false, color: t.hair },
      tickText: { color: t.axis, size: 11, family: MONO } },
    separator: { color: t.hair },
    crosshair: {
      horizontal: {
        line: { color: t.cross, size: 1, style: 'dashed', dashedValue: [3, 3] },
        text: { backgroundColor: t.crossBg, color: t.crossText, borderColor: t.cross, size: 11, family: MONO }
      },
      vertical: {
        line: { color: t.cross, size: 1, style: 'dashed', dashedValue: [3, 3] },
        text: { backgroundColor: t.crossBg, color: t.crossText, borderColor: t.cross, size: 11, family: MONO }
      }
    },
    indicator: {
      lines: t.ind.map(color => ({ color, size: 1, style: 'solid' })),
      lastValueMark: { text: { color: isLight ? '#0d1b2a' : '#edf7fc', size: 11, family: MONO } },
      // 内核自带的指标图例（左上角那行文字）关掉：改由我们自己画的图例行显示，
      // 这样参数、每条线的值、显示/设置/移除按钮在同一行里。
      tooltip: {
        title: { show: false, showName: false, showParams: false, color: 'rgba(0,0,0,0)' },
        legend: { color: 'rgba(0,0,0,0)', size: 0, defaultValue: '' }
      }
    },
    overlay: {
      line: { color: t.cross },
      // 画图控制点：平时是细细的空心圈，选中时空心稍大一点——不要实心大圆点，会盖住 K 线
      point: {
        color: 'rgba(0,0,0,0)', borderColor: t.cross, borderSize: 1.1, radius: 2.6,
        activeColor: 'rgba(0,0,0,0)', activeBorderColor: t.cross, activeBorderSize: 1.6, activeRadius: 3.6
      },
      text: { color: t.crossText, size: 12, family: MONO }
    }
  };
}

export class ChartApp {
  constructor(container, profile) {
    this.container = container;
    this.profile = profile;
    this.source = new BarSource(profile);
    this.periodKey = '1m';
    this.anchor = profile.last;
    this.earliest = null;
    this.chart = null;
    this.stats = { loads: 0, lastMs: 0, lastCount: 0 };
    this._waiters = [];
  }

  pageFor(key) { return (PERIODS.find(p => p.key === key) || PERIODS[0]).page; }

  async mount() {
    this.chart = K.init(this.container, { locale: 'zh-CN', timezone: 'UTC' });
    if (!this.chart) throw new Error('图表初始化失败（容器无宽高？）');
    // 容器尺寸变化（面板开合/窗口缩放）必须 resize，否则 canvas 位图停在初始尺寸（默认 300×150）
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        try { this.chart.resize(); } catch {}
      });
      this._ro.observe(this.container);
    }
    window.addEventListener('resize', () => { try { this.chart.resize(); } catch {} });
    // 启动时窗口若被遮挡/最小化，rAF 会被暂停，canvas 会停在 300×150；回到可见时补一次 resize
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { try { this.chart.resize(); } catch {} }
    });
    try { this.chart.setStyles(buildChartTheme()); } catch (e) { console.warn('[styles]', e); }
    this.chart.setSymbol({
      ticker: this.profile.symbol,
      pricePrecision: decimalsFor(this.profile.symbol, this.profile.lastClose ?? null),
      volumePrecision: 0
    });
    this.chart.setPeriod(PERIOD_TYPE(this.periodKey));
    this.chart.setDataLoader(this.buildLoader());
    // M1 不做成交量：源数据 volume 恒为 0，直接不建 VOL 面板
    return this.chart;
  }

  buildLoader() {
    return {
      getBars: async ({ type, timestamp, callback }) => {
        const spanMs = periodSpanMs(this.periodKey);
        const page = this.pageFor(this.periodKey);
        try {
          if (type === 'init') {
            const bars = await this.source.frame(this.anchor, spanMs, page);
            if (bars.length) this.earliest = bars[0].timestamp;
            this.stats = { loads: this.stats.loads + 1, lastMs: +this.source.lastReadMs.toFixed(1), lastCount: bars.length };
            callback(bars, { forward: bars.length === page, backward: false });
            this._markLoaded(bars.length);
            if (this._onInit) { const f = this._onInit; this._onInit = null; f(bars.length); }
          } else if (type === 'forward') {
            const end = (timestamp ?? this.earliest) - 1;
            const bars = await this.source.frame(end, spanMs, page);
            if (bars.length) this.earliest = bars[0].timestamp;
            this.stats = { loads: this.stats.loads + 1, lastMs: +this.source.lastReadMs.toFixed(1), lastCount: bars.length };
            callback(bars, { forward: bars.length === page, backward: false });
            this._markLoaded(bars.length);
          } else {
            callback([], false);
          }
        } catch (err) {
          console.error('[getBars]', err);
          callback([], false);
          throw err;
        }
      },
      subscribeBar: ({ callback }) => { this.subCb = callback; },
      unsubscribeBar: () => { this.subCb = null; }
    };
  }

  /** 推一根（回放用） */
  pushBar(bar) {
    if (this.subCb) this.subCb(bar);
  }

  lastBar() {
    const list = this.chart.getDataList();
    return list.length ? list[list.length - 1] : null;
  }

  /** 把窗口右端定到 ts 并重载（回放起点 / 跳转 / 回退共用） */
  async seek(ts) {
    this.anchor = ts;
    this.chart.resetData();
    const wait = this.waitInit();
    this.chart.setSymbol({ ticker: this.profile.symbol, pricePrecision: decimalsFor(this.profile.symbol, this.profile.lastClose ?? null), volumePrecision: 0 });
    return wait;
  }

  /** 等一次由 setSymbol/setPeriod 触发的 init 回调真正落地 */
  waitInit(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('加载超时')), timeout);
      this._onInit = (n) => { clearTimeout(timer); resolve(n); };
    });
  }

  async switchPeriod(key) {
    if (!PERIODS.some(p => p.key === key)) return;
    this.periodKey = key;
    this.chart.setPeriod(PERIOD_TYPE(key));
    await this.seek(this.anchor);
  }

  async goto(timestampMs) {
    await this.seek(timestampMs);
  }

  _markLoaded(n) {
    const waiters = this._waiters;
    this._waiters = [];
    for (const fn of waiters) fn(n);
  }

  /** 数据到手后按真实价格量级再定一次小数位（加密尤其需要：SHIB 0.0000123 不能按 2 位） */
  applyPrecisionFromData() {
    try {
      const bars = this.chart.getDataList() || [];
      const close = bars.length ? bars[bars.length - 1].close : null;
      const dp = decimalsFor(this.profile.symbol, close);
      if (this.chart.getSymbol()?.pricePrecision !== dp) {
        this.chart.setSymbol({ ticker: this.profile.symbol, pricePrecision: dp, volumePrecision: 0 });
      }
      return dp;
    } catch { return null; }
  }

  waitLoaded(timeout = 8000) {
    const n = this.chart.getDataList().length;
    if (n > 0) return Promise.resolve(n);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('加载超时')), timeout);
      this._waiters.push((count) => { clearTimeout(timer); resolve(count); });
    });
  }

  dispose() { try { K.dispose(this.container); } catch {} }
}
