// 自建指标：klinecharts 内置库里没有的「关键位 / 结构」类
// 统一用 figures（线/圆点）表达，不用自定义 draw —— 这个版本里 draw 回调不会被调用（实测）
const DAY = 86400000;
const NEAR_RATIO = 0.015;        // 离现价 1.5% 以外的参考位不画（避免把纵轴拉爆）

function dayStart(ts) { return Math.floor(ts / DAY) * DAY; }

/* ---------------- 1. 前日高/低/收（只画当天） ---------------- */
const PDHL = {
  name: 'PDHL',
  shortName: '前日高低',
  series: 'price',
  precision: 2,
  figures: [
    { key: 'pdh', title: 'PDH: ', type: 'line', styles: () => ({ color: '#ff6f85', size: 1, style: 'dashed' }) },
    { key: 'pdl', title: 'PDL: ', type: 'line', styles: () => ({ color: '#5fe3c0', size: 1, style: 'dashed' }) },
    { key: 'pdc', title: 'PDC: ', type: 'line', styles: () => ({ color: '#8fa7b8', size: 1, style: 'dashed' }) }
  ],
  calc: (dataList) => {
    const levels = new Array(dataList.length);
    let curDay = null, prevH = null, prevL = null, prevC = null;
    let h = -Infinity, l = Infinity, c = null;
    for (let i = 0; i < dataList.length; i++) {
      const b = dataList[i], d = dayStart(b.timestamp);
      if (d !== curDay) {
        if (curDay !== null) { prevH = h; prevL = l; prevC = c; }
        curDay = d; h = -Infinity; l = Infinity; c = null;
      }
      levels[i] = { pdh: prevH, pdl: prevL, pdc: prevC };
      h = Math.max(h, b.high); l = Math.min(l, b.low); c = b.close;
    }
    // 只保留“最后一天”的这几根 bar；离现价太远的参考位不画，否则会把纵轴撑爆
    const lastDay = dataList.length ? dayStart(dataList[dataList.length - 1].timestamp) : null;
    const lastClose = dataList.length ? dataList[dataList.length - 1].close : null;
    const near = (v) => v != null && lastClose && Math.abs(v - lastClose) / lastClose <= NEAR_RATIO;
    return levels.map((v, i) => (dayStart(dataList[i].timestamp) === lastDay
      ? { pdh: near(v.pdh) ? v.pdh : null, pdl: near(v.pdl) ? v.pdl : null, pdc: near(v.pdc) ? v.pdc : null }
      : { pdh: null, pdl: null, pdc: null }));
  }
};

/* ---------------- 2. 开盘区间 OR（当天前 N 分钟的高低，只画当天） ---------------- */
const ORB = {
  name: 'ORB',
  shortName: '开盘区间',
  series: 'price',
  precision: 2,
  calcParams: [30],
  figures: [
    { key: 'orh', title: 'ORH: ', type: 'line', styles: () => ({ color: '#aceaff', size: 1, style: 'dashed' }) },
    { key: 'orl', title: 'ORL: ', type: 'line', styles: () => ({ color: '#aceaff', size: 1, style: 'dashed' }) }
  ],
  calc: (dataList, indicator) => {
    const mins = Math.max(1, Number(indicator.calcParams?.[0]) || 30);
    const out = new Array(dataList.length);
    let curDay = null, h = null, l = null, done = false;
    for (let i = 0; i < dataList.length; i++) {
      const b = dataList[i], d = dayStart(b.timestamp);
      if (d !== curDay) { curDay = d; h = null; l = null; done = false; }
      const minute = (b.timestamp - d) / 60000;
      if (!done) {
        if (minute < mins) { h = h == null ? b.high : Math.max(h, b.high); l = l == null ? b.low : Math.min(l, b.low); }
        else if (h != null) done = true;
      }
      out[i] = { orh: h, orl: l };
    }
    const lastDay = dataList.length ? dayStart(dataList[dataList.length - 1].timestamp) : null;
    const lastClose = dataList.length ? dataList[dataList.length - 1].close : null;
    const near = (v) => v != null && lastClose && Math.abs(v - lastClose) / lastClose <= NEAR_RATIO;
    return out.map((v, i) => (dayStart(dataList[i].timestamp) === lastDay
      ? { orh: near(v.orh) ? v.orh : null, orl: near(v.orl) ? v.orl : null }
      : { orh: null, orl: null }));
  }
};

/* ---------------- 3. 锚定 VWAP（按日锚定，无量数据退化成均价） ---------------- */
const AVWAP = {
  name: 'AVWAP',
  shortName: '锚定VWAP',
  series: 'price',
  precision: 2,
  figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line', styles: () => ({ color: '#c9a0ff', size: 1.4 }) }],
  calcParams: [1],
  calc: (dataList, indicator) => {
    const perDay = Number(indicator.calcParams?.[0] ?? 1) !== 0;
    const out = new Array(dataList.length);
    let anchor = null, pv = 0, vv = 0, count = 0, sum = 0, last = null;
    for (let i = 0; i < dataList.length; i++) {
      const b = dataList[i];
      const key = perDay ? dayStart(b.timestamp) : Math.floor(b.timestamp / (DAY * 7));
      if (key !== anchor) { anchor = key; pv = 0; vv = 0; count = 0; sum = 0; }
      const tp = (b.high + b.low + b.close) / 3;
      if (b.volume > 0) { pv += tp * b.volume; vv += b.volume; last = vv ? pv / vv : tp; }
      else { sum += tp; count++; last = sum / count; }
      out[i] = { vwap: last };
    }
    return out;
  }
};

export const CUSTOM_INDS = [PDHL, ORB, AVWAP];

export const CUSTOM_META = {
  PDHL: { label: '前日高/低/收 PDH·PDL·PDC', cat: '关键位', overlay: true,
    desc: '上一交易日高/低/收 · 当天三条参考虚线' },
  ORB: { label: '开盘区间 OR', cat: '关键位', overlay: true,
    desc: '开盘后 N 分钟高/低 · 突破/回踩观察' },
  AVWAP: { label: '锚定 VWAP', cat: '关键位', overlay: true,
    desc: '日锚定成交量加权均价 · 无量退化均价' },
  SMC_FVG: { label: 'FVG / IFVG', cat: 'SMC', overlay: true,
    desc: '延伸至填补 · 收盘穿越后反转' },
  SMC_MST: { label: '聪明钱概念', cat: 'SMC', overlay: true,
    desc: '内部/摆动结构 · BOS / CHoCH · 订单块 · EQH/EQL' },
  SMC_ICT: { label: 'ICT 杀区工具箱', cat: 'SMC', overlay: true,
    desc: '四大 Killzone · 未填补 FVG（UTC 时区）' },
  SMC_HTF: { label: '波段 & 中期结构', cat: 'SMC', overlay: true,
    desc: '当前周期内部结构 + 可选 1 小时外部结构与 OB' },
  SMC_DASH: { label: '结构 & 趋势面板', cat: 'SMC', overlay: true,
    desc: '多周期结构对齐 · BOS/CHoCH · 扫单 · FVG · 面板' },
  FLOW_VOL: { label: '成交量', cat: '订单流', overlay: false,
    desc: '按当前周期聚合显示 · 无量数据源为空' },
  FLOW_VP: { label: '综合 VP', cat: '订单流', overlay: true,
    desc: 'POC / VAH / VAL · 无量时退化为价格停留时间' },
  FLOW_WALL: { label: '订单墙', cat: '订单流', overlay: true,
    desc: '成交量突增的墙 · 无量时用同价反复触及代替' },
  FLOW_DEPTH: { label: '挂单深度', cat: '订单流', overlay: true,
    desc: '按价位的买卖成交差 · 真实盘口需 L2 逐笔数据' },
};

let _registered = false;
export function registerCustomIndicators(K) {
  if (_registered || !K?.registerIndicator) return 0;
  let n = 0;
  for (const tpl of CUSTOM_INDS) {
    try { K.registerIndicator(tpl); n++; } catch (e) { console.warn('[ind]', tpl.name, e?.message); }
  }
  _registered = true;
  return n;
}
