// 副图指标（vela 分支补齐）：MACD / RSI / KDJ / ATR
// 背景：klinecharts 内置副图指标在 vela 上没有对应原生实现，导致「布局 → 2/3/4 面板」
// 只能填 FLOW_VOL、实际加不出副图。这里按 Pine/TV 口径实现，注册进 vela 原生指标体系，
// 由 paneHint='new' 撑出独立面板。
// 口径：EMA 用 ta.ema（alpha=2/(N+1)，前 N 根 SMA 起头）；RMA 用 ta.rma（alpha=1/N）；
//       MACD 柱 = DIF − DEA（Pine ta.macd 的 hist 口径，非 TV 的 2 倍显示）。

/** 指数均线：alpha = 2/(N+1)，前 N 根用 SMA 做种子 */
function emaSeries(src, period) {
  const p = Math.max(1, Math.floor(Number(period) || 1));
  const k = 2 / (p + 1);
  const out = new Array(src.length).fill(null);
  let sum = 0, prev = null, n = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !Number.isFinite(v)) { out[i] = prev; continue; }
    n++;
    if (n < p) { sum += v; continue; }
    if (prev === null) { sum += v; prev = sum / p; }
    else prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 怀尔德平滑：alpha = 1/N，前 N 根 SMA 起头（ta.rma） */
function rmaSeries(src, period) {
  const p = Math.max(1, Math.floor(Number(period) || 1));
  const k = 1 / p;
  const out = new Array(src.length).fill(null);
  let sum = 0, prev = null, n = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !Number.isFinite(v)) { out[i] = prev; continue; }
    n++;
    if (n < p) { sum += v; continue; }
    if (prev === null) { sum += v; prev = sum / p; }
    else prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const closes = (bars) => bars.map(b => b.close);

/* ---------------- MACD ---------------- */
const MACD = {
  name: 'MACD',
  shortName: 'MACD',
  series: 'normal',
  precision: 2,
  calcParams: [12, 26, 9],
  figures: [
    { key: 'dif', title: 'DIF: ', type: 'line', styles: () => ({ color: '#8adeff', size: 1.2 }) },
    { key: 'dea', title: 'DEA: ', type: 'line', styles: () => ({ color: '#ffc36b', size: 1.2 }) },
    { key: 'hist', title: 'MACD: ', type: 'histogram', styles: () => ({ color: '#8fa7b8', size: 1 }) }
  ],
  calc: (bars, indicator) => {
    const p = indicator?.calcParams || indicator?.params || [12, 26, 9];
    const fast = Math.max(1, Number(p[0]) || 12);
    const slow = Math.max(fast + 1, Number(p[1]) || 26);
    const sig = Math.max(1, Number(p[2]) || 9);
    const c = closes(bars);
    const ef = emaSeries(c, fast), es = emaSeries(c, slow);
    const dif = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const dea = emaSeries(dif.map(v => (v == null ? null : v)), sig);
    return bars.map((_, i) => ({
      dif: dif[i], dea: dea[i],
      hist: dif[i] != null && dea[i] != null ? dif[i] - dea[i] : null
    }));
  }
};

/* ---------------- RSI ---------------- */
const RSI = {
  name: 'RSI',
  shortName: 'RSI',
  series: 'normal',
  precision: 2,
  calcParams: [14],
  figures: [
    { key: 'rsi', title: 'RSI: ', type: 'line', styles: () => ({ color: '#c9a0ff', size: 1.3 }) }
  ],
  calc: (bars, indicator) => {
    const p = indicator?.calcParams || indicator?.params || [14];
    const n = Math.max(2, Number(p[0]) || 14);
    const c = closes(bars);
    const gain = c.map((v, i) => (i ? Math.max(0, v - c[i - 1]) : null));
    const loss = c.map((v, i) => (i ? Math.max(0, c[i - 1] - v) : null));
    const ag = rmaSeries(gain, n), al = rmaSeries(loss, n);
    return bars.map((_, i) => {
      if (ag[i] == null || al[i] == null) return { rsi: null };
      if (al[i] === 0) return { rsi: 100 };
      const rs = ag[i] / al[i];
      return { rsi: 100 - 100 / (1 + rs) };
    });
  }
};

/* ---------------- KDJ ---------------- */
const KDJ = {
  name: 'KDJ',
  shortName: 'KDJ',
  series: 'normal',
  precision: 2,
  calcParams: [9, 3, 3],
  figures: [
    { key: 'k', title: 'K: ', type: 'line', styles: () => ({ color: '#8adeff', size: 1.2 }) },
    { key: 'd', title: 'D: ', type: 'line', styles: () => ({ color: '#ffc36b', size: 1.2 }) },
    { key: 'j', title: 'J: ', type: 'line', styles: () => ({ color: '#c9a0ff', size: 1.2 }) }
  ],
  calc: (bars, indicator) => {
    const p = indicator?.calcParams || indicator?.params || [9, 3, 3];
    const n = Math.max(1, Number(p[0]) || 9);
    const m1 = Math.max(1, Number(p[1]) || 3);
    const m2 = Math.max(1, Number(p[2]) || 3);
    let k = 50, d = 50;
    return bars.map((b, i) => {
      let hh = -Infinity, ll = Infinity;
      for (let j = Math.max(0, i - n + 1); j <= i; j++) {
        hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low);
      }
      const rsv = hh === ll ? 50 : ((b.close - ll) / (hh - ll)) * 100;
      k = ((m1 - 1) * k + rsv) / m1;
      d = ((m2 - 1) * d + k) / m2;
      return { k, d, j: 3 * k - 2 * d };
    });
  }
};

/* ---------------- ATR ---------------- */
const ATR = {
  name: 'ATR',
  shortName: 'ATR',
  series: 'normal',
  precision: 2,
  calcParams: [14],
  figures: [
    { key: 'atr', title: 'ATR: ', type: 'line', styles: () => ({ color: '#5fe3c0', size: 1.3 }) }
  ],
  calc: (bars, indicator) => {
    const p = indicator?.calcParams || indicator?.params || [14];
    const n = Math.max(1, Number(p[0]) || 14);
    const tr = bars.map((b, i) => {
      if (!i) return b.high - b.low;
      const pc = bars[i - 1].close;
      return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    });
    const atr = rmaSeries(tr, n);
    return bars.map((_, i) => ({ atr: atr[i] }));
  }
};

export const OSC_INDS = [MACD, RSI, KDJ, ATR];

/** 指标库元信息（cat 走 indicators.js 的分类映射） */
export const OSC_META = {
  MACD: { label: 'MACD', cat: '通用', overlay: false, desc: '快慢 EMA 差与信号线（副图）· Pine ta.macd 口径' },
  RSI: { label: '相对强弱 RSI', cat: '通用', overlay: false, desc: '怀尔德平滑涨跌幅比，超买超卖与背离（副图）' },
  KDJ: { label: '随机指标 KDJ', cat: '通用', overlay: false, desc: 'RSV 两级平滑 + J 线，短线超买超卖（副图）' },
  ATR: { label: '真实波幅 ATR', cat: '通用', overlay: false, desc: '怀尔德平滑真实波幅，止损/仓位用（副图）' }
};
