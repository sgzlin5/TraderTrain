// Pine 纯函数层：主线程与 Worker 共用（预处理 / 输入解析 / 序列化 / 绘图对象抽取）
import { decimalsFor } from './instruments.js';

export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** 从源码里抠出 input.* 声明，用于参数面板（支持位置参数与 title=/minval=/maxval=/step=/defval=） */
export function parseInputs(src) {
  const out = [];
  const re = /^\s*([A-Za-z_]\w*)\s*=\s*input(?:\.(int|float|bool|string|source|color|time|session|symbol|timeframe))?\(([\s\S]*?)\)\s*(?:\/\/.*)?$/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, typeRaw, argsRaw] = m;
    const type = typeRaw || 'any';
    // 拆参数：逗号切分但忽略括号/引号里的逗号
    const args = [];
    let depth = 0, quote = '', buf = '';
    for (const ch of argsRaw) {
      if (quote) { buf += ch; if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { args.push(buf.trim()); buf = ''; continue; }
      buf += ch;
    }
    if (buf.trim()) args.push(buf.trim());

    const named = {};
    const positional = [];
    for (const a of args) {
      const nm = a.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (nm) named[nm[1]] = nm[2].trim(); else positional.push(a);
    }
    const unq = (v) => (v || '').replace(/^["']|["']$/g, '');
    // ['A','B','C'] / ["A","B"] → ['A','B','C']
    const arr = (raw) => {
      const t = String(raw ?? '').trim();
      if (!t.startsWith('[')) return [];
      const body = t.slice(1, t.lastIndexOf(']') === -1 ? t.length : t.lastIndexOf(']'));
      const out = [];
      let depth = 0, quote = '', buf = '';
      for (const ch of body) {
        if (quote) { buf += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { out.push(unq(buf.trim())); buf = ''; continue; }
        buf += ch;
      }
      if (buf.trim()) out.push(unq(buf.trim()));
      return out.filter(x => x !== '');
    };
    const rawDef = named.defval ?? positional[0] ?? '';
    let title = unq(named.title ?? '') || unq(positional[1] ?? '') || name;

    let def = unq(rawDef);
    if (type === 'int') def = parseInt(def, 10);
    else if (type === 'float') def = parseFloat(def);
    else if (type === 'bool') def = String(def).toLowerCase() === 'true';
    else if (type === 'source' || type === 'any') def = unq(rawDef) || 'close';
    else if (type === 'timeframe') def = unq(rawDef) || '';

    out.push({
      name, title, type, def,
      min: named.minval != null ? Number(named.minval) : undefined,
      max: named.maxval != null ? Number(named.maxval) : undefined,
      step: named.step != null ? Number(named.step) : undefined,
      tooltip: unq(named.tooltip ?? '') || '',
      // options=[...]（Pine v5/v6 的下拉）优先，其次取第 3 个位置参数
      options: (named.options ? arr(named.options) : arr(positional[2] || '')).length
        ? (named.options ? arr(named.options) : arr(positional[2] || ''))
        : positional.slice(2).map(unq).filter(v => v && !v.startsWith('['))
    });
  }
  return out;
}

/**
 * 源码预处理（前向兼容补丁，不动 vendor）：
 *  - barstate.islast 在本运行时恒 false，导致大量"只在最后一根画表/画标签"的脚本整块不执行；
 *    这里把它替换成 `bar_index >= lastIndex`，语义等价（最后一根为 true）。
 *  - isconfirmed / isnew 恒 true；isfirst 等价 bar_index == 0。
 */
export function preprocessPine(src, bars) {
  const n = Math.max(1, bars?.length || 1);
  // 绘图对象用三元 + na 初始化时，运行时会把变量存成 na（对象创建了但后续 .cell()/.set_* 全是空操作）。
  // 这里把 `var table x = cond ? <new> : na` 改写成直接赋值，语义等价（对象一旦创建就复用）。
  src = src.split('\n').map(line => {
    const m = line.match(/^(\s*var\s+(?:table|line|label|box|polyline)\s+\w+\s*=\s*)(.+)$/);
    if (!m) return line;
    const body = m[2];
    if (!/\bna\s*$/.test(body)) return line;
    const q = body.lastIndexOf('?');
    if (q < 0) return line;
    const value = body.slice(q + 1).replace(/\s*:\s*na\s*$/, '').trim();
    return value ? m[1] + value : line;
  }).join('\n');
  return src
    .replace(/\bbarstate\.islastconfirmedhistory\b/g, 'true')
    .replace(/\bbarstate\.islast\b/g, `(bar_index >= ${n - 1})`)
    .replace(/\bbarstate\.isconfirmed\b/g, `(bar_index < ${n - 1})`)   // 最后一根是正在走的那根，不算确认
    .replace(/\bbarstate\.isnew\b/g, 'true')
    .replace(/\bbarstate\.isfirst\b/g, '(bar_index == 0)');
}

/**
 * 兼容性预检：PineTS 是 v5 运行时，v6 语法大多能跑，但**部分内建函数会被静默忽略**（不报错、也没输出）。
 * 这里把已知坑扫出来，给用户看得懂的话，而不是等到"图上什么都没有"。
 */
export function scanCompat(src) {
  const ver = (src.match(/^\s*\/\/\s*@version\s*=\s*(\d+)/m) || [])[1] || null;
  const rules = [
    { re: /\bstrategy\s*\(/, msg: 'strategy() 回测声明 —— 初版只支持 indicator()', level: 'bad' },
    { re: /\btable\s*\./, msg: 'table.* 表格绘制不会被渲染（面板类脚本常见）', level: 'bad' },
    { re: /\blabel\s*\./, msg: 'label.* 文字标注不会被渲染', level: 'bad' },
    { re: /\b(line|box|polyline)\s*\./, msg: 'line/box/polyline 绘图不会被渲染', level: 'bad' },
    { re: /\brequest\.security\s*\(\s*[^,)]*,\s*["'][^"']+["']/, msg: 'request.security 换周期/换品种：换周期可跑，跨品种拿不到数据（返回 null）', level: 'warn' },
    { re: /\binput\.enum\b|\benum\s+[A-Z]\w*\s*$/m, msg: 'enum / input.enum 解析不稳，建议改用 input.string', level: 'warn' },
    { re: /\bmethod\s+\w+\s*\(/, msg: 'method 扩展方法支持不完整', level: 'warn' },
    { re: /\bvarip\b/, msg: 'varip 语义与 Pine 不同（这里等同于 var）', level: 'warn' },
    { re: /\bmatrix\s*\./, msg: 'matrix.* 未实现', level: 'bad' },
    { re: /\b(plotshape|plotchar|plotarrow)\s*\(/, msg: 'plotshape/plotchar 只会画数值，不带形状样式', level: 'warn' },
    { re: /\b(bgcolor|barcolor|fill)\s*\(/, msg: 'bgcolor/barcolor/fill 背景与填充不会绘制', level: 'warn' },
    { re: /\bstrategy\.(entry|exit|close)\b/, msg: 'strategy.* 交易指令不执行', level: 'bad' }
  ];
  const hits = [];
  for (const r of rules) if (r.re.test(src)) hits.push({ msg: r.msg, level: r.level });
  const hasPlot = /\bplot\s*\(/.test(src);
  return {
    version: ver,
    versionNote: ver === '6'
      ? '脚本声明 v6：语法已按 v6 解析（switch / array / pivothigh / valuewhen / hline 都验过）；不支持的是绘图对象（table / label / box / line）与 strategy。'
      : ver && ver !== '5' ? `脚本声明 v${ver}：按 v5/v6 语法解析，个别新特性可能被忽略` : null,
    hits,
    hasPlot,
    worst: hits.some(h => h.level === 'bad') ? 'bad' : hits.length ? 'warn' : 'ok'
  };
}

/** 把 plots 转成 klinecharts calc 能用的索引表 */
export function toPineSeries(ctx) {
  // bgcolor/barcolor/fill 在运行时里也会生成序列，但值是颜色、画出来是噪声线，直接丢掉
  const names = Object.keys(ctx.plots || {}).filter(n => !n.startsWith('__') && !/^(bgcolor|barcolor|fill)\b/.test(n));
  const series = {};
  for (const n of names) {
    const arr = ctx.plots[n]?.data || [];
    series[n] = arr.map(d => (typeof d.value === 'number' && !Number.isNaN(d.value) ? d.value : null));
  }
  const overlay = ctx.indicator?.overlay !== false;
  return { names, series, overlay, title: ctx.indicator?.title || 'PINE' };
}

/**
 * 编译 + 运行一次（用于检查）
 * @returns {Promise<{ok:boolean, error?:string, line?:number, names?:string[], overlay?:boolean, transpiledFn?:Function, ctx?:any}>}
 */
/**
 * 运行时（PineTS）要求每根 bar 带 openTime / closeTime（不是我们数据里的 timestamp），
 * 否则 `time` / `time_close` / `hour` 全是 null，`request.security("60", …)` 也拿不到别的周期。
 * 这里统一补齐：closeTime 用下一根的开盘时间，最后一根用中位周期补。
 */
export function toPineBars(bars) {
  if (!Array.isArray(bars) || !bars.length) return bars;
  if (bars[0].openTime !== undefined) return bars;
  const diffs = [];
  for (let i = 1; i < bars.length && diffs.length < 200; i++) diffs.push(bars[i].timestamp - bars[i - 1].timestamp);
  diffs.sort((a, b) => a - b);
  const span = diffs.length ? diffs[diffs.length >> 1] : 60000;
  return bars.map((b, i) => ({
    ...b,
    openTime: b.timestamp,
    closeTime: bars[i + 1] ? bars[i + 1].timestamp : b.timestamp + span
  }));
}

/**
 * PineTS 只在 source 是 provider 对象时才会调 getSymbolInfo()，
 * 传裸数组会让 syminfo.mintick / tickerid 全是 nan。这里包一层最小值。
 */
function pineSource(bars, symbol) {
  const last = bars.length ? bars[bars.length - 1] : null;
  const dp = decimalsFor(symbol, last ? last.close : null);
  const mintick = Math.pow(10, -dp);
  const info = {
    tickerid: symbol || 'PINE', ticker: symbol || 'PINE', prefix: '', root: symbol || 'PINE',
    description: symbol || 'PINE', type: 'crypto', currency: 'USD', basecurrency: 'USD',
    timezone: 'UTC', session: '24x7', volumetype: 'base',
    mintick, minmove: mintick, pricescale: Math.pow(10, dp), pointvalue: 1, mincontract: 0,
    current_contract: '', main_tickerid: symbol || 'PINE', isin: '', country: ''
  };
  return {
    getMarketData: async () => bars,
    getSymbolInfo: async () => info
  };
}


/** 把 ctx.plots 里绘图对象抽成可结构化克隆的形态（Worker → 主线程） */
export function pickDrawings(plots) {
  const out = {};
  for (const k of ['__tables__', '__labels__', '__boxes__', '__lines__']) {
    const p = plots && plots[k];
    if (!p || !Array.isArray(p.data)) continue;
    const data = [];
    for (const entry of p.data) {
      const vals = entry && entry.value;
      if (!Array.isArray(vals)) continue;
      const clean = [];
      for (const v of vals) {
        if (!v || v._deleted) continue;
        try { clean.push(structuredClone(v)); } catch { try { clean.push(JSON.parse(JSON.stringify(v))); } catch {} }
      }
      if (clean.length) data.push({ value: clean });
    }
    if (data.length) out[k] = { data };
  }
  return out;
}

/** 把 ctx.strategy 抽成可结构化克隆的形态（回测统计用） */
export function pickStrategy(s) {
  if (!s) return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const trade = (t) => ({
    id: t.id, entry_id: t.entry_id, exit_id: t.exit_id ?? null,
    size: num(t.size), profit: num(t.profit),
    entry_time: num(t.entry_time), entry_price: num(t.entry_price), entry_bar: num(t.entry_bar_index),
    exit_time: num(t.exit_time), exit_price: num(t.exit_price), exit_bar: num(t.exit_bar_index),
    status: t.status || 'open'
  });
  return {
    initial_capital: num(s.initial_capital), equity: num(s.equity),
    netprofit: num(s.netprofit), grossprofit: num(s.grossprofit), grossloss: num(s.grossloss),
    openprofit: num(s.openprofit), max_drawdown: num(s.max_drawdown), cagr: num(s.cagr),
    closed: (s.closedtrades || []).map(trade),
    open: (s.opentrades || []).map(trade)
  };
}

/** alert() 调用记录（结构化克隆用，最多 300 条） */
export function pickAlerts(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-300).map(a => ({
    type: a?.type || 'alert', id: a?.id || '', message: String(a?.message ?? ''),
    title: a?.title || '', freq: a?.freq || '', bar: a?.bar_index ?? null, time: a?.time ?? null
  }));
}

/** 主线程内同步执行完整流程（Worker 不可用时的兜底） */
export async function runInThread(PineTS, src, pineBars, inputs, symbol) {
  const pt = new PineTS(pineSource(pineBars, symbol), symbol || 'PINE', '1m', pineBars.length);
  const ctx = inputs && Object.keys(inputs).length
    ? await (async () => {
        const base = await pt.run(src);
        if (typeof base.transpiledFn !== 'function') return base;
        return pt.runPretranspiled(base.transpiledFn, inputs);
      })()
    : await pt.run(src);
  const { names, overlay, series, title } = toPineSeries(ctx);
  return { names, overlay, series, title, plots: pickDrawings(ctx.plots), strategy: pickStrategy(ctx.strategy),
    pineVersion: ctx.pineVersion ?? null, alerts: pickAlerts(ctx.alerts), ctx };
}
