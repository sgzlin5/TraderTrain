// 探针：用 vela-pinets 的 PineEngine（Vela 的官方 Pine 引擎）离线跑 LuxAlgo 类脚本
// 目的：判断「切到 Vela 后能否用 vela-pinets 覆盖 LuxAlgo 指标」——不依赖浏览器/图表
import fs from 'node:fs';
import { PineEngine } from '@luxalgo/vela-pinets';

const T0 = 1767387600000;
function bars(n = 1500) {
  const out = [];
  let p = 2000;
  for (let i = 0; i < n; i++) {
    const o = p;
    const drift = Math.sin(i / 23) * 6 + Math.sin(i / 7) * 2.5 + (i % 41 === 0 ? 12 : 0);
    const c = o + drift;
    const h = Math.max(o, c) + Math.abs(drift) * 0.4 + 1.2;
    const l = Math.min(o, c) - Math.abs(drift) * 0.4 - 1.2;
    out.push({ time: T0 + i * 60000, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: 100 + (i % 37) * 3 });
    p = c;
  }
  return out;
}

const BARS = bars();
const SYMBOL_INFO = { tickerid: 'BTCUSDT', mintick: 0.01, pricescale: 100, timezone: 'UTC', session: '24x7' };

async function runScript(engine, src, id, opts = {}) {
  const r = { id, chars: src.length, prepMs: null, runMs: null, ok: false, err: null, warnings: [], alerts: 0, model: null };
  let prepared;
  const t0 = Date.now();
  try {
    prepared = await engine.prepare(src, id);
    r.prepMs = Date.now() - t0;
    r.preparedKeys = Object.keys(prepared || {});
  } catch (e) {
    r.err = 'prepare: ' + (e && e.message || e);
    return r;
  }
  const t1 = Date.now();
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      engine.execute(
        {
          prepared,
          market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: SYMBOL_INFO },
          bars: BARS,
          getBars: () => BARS,
          fetchSeries: opts.fetchSeries || (async () => []),
          mode: 'static',
          historyState: 'complete',
        },
        {
          onModel(m) { r.model = m; },
          onAlert() { r.alerts++; },
          onWarning(w) { r.warnings.push(String(typeof w === 'string' ? w : JSON.stringify(w)).slice(0, 240)); },
          onError(e) { r.err = 'run: ' + String(e && e.message || e).slice(0, 400); },
          onDone() { finish(); },
        },
      );
    } catch (e) {
      r.err = 'execute: ' + String(e && e.message || e).slice(0, 400);
      finish();
    }
    setTimeout(finish, 120000);
  });
  r.runMs = Date.now() - t1;
  if (r.model) {
    r.ok = !r.err;
    r.modelKeys = Object.keys(r.model);
    const g = (k) => (Array.isArray(r.model[k]) ? r.model[k].length : (r.model[k] && typeof r.model[k] === 'object' ? Object.keys(r.model[k]).length : 0));
    r.counts = {
      plots: g('plots'), series: g('series'), tables: g('tables'), labels: g('labels'),
      lines: g('lines'), boxes: g('boxes'), polylines: g('polylines'), trades: g('trades'),
      warnings: (r.model.warnings || []).length, alertsModel: (r.model.alerts || []).length,
    };
  }
  return r;
}

const CASES = [];
const fixture = fs.readFileSync('D:/Crypto/code/TraderTrain-vela/app/fixtures/luxalgo-structure-trend-dashboard.pine', 'utf8');
CASES.push(['LuxAlgo-StructureTrendDashboard(真实样本)', fixture]);

CASES.push(['v6 表格面板(table.new/cell/merge)', `//@version=6
indicator("T", overlay=true)
t = table.new(position.top_right, 2, 3, bgcolor=color.new(color.black,20), border_width=1)
if barstate.islast
    table.cell(t, 0, 0, "TF", text_color=color.white)
    table.cell(t, 1, 0, timeframe.period, text_color=color.white)
    table.cell(t, 0, 1, "Trend", text_color=color.white)
    table.cell(t, 1, 1, close > ta.ema(close,50) ? "Bull" : "Bear", text_color=color.white)
plot(ta.ema(close,50))`]);

CASES.push(['v6 request.security 多周期', `//@version=6
indicator("SEC", overlay=false)
htf = request.security(syminfo.tickerid, "240", ta.ema(close, 20))
[c4, o4] = request.security(syminfo.tickerid, "D", [close, open])
plot(htf, color=color.yellow)
plot(c4 - o4, color=color.aqua)`]);

CASES.push(['v6 全图区域自绘(box/line/label 循环)', `//@version=6
indicator("DRAW", overlay=true, max_boxes_count=200, max_lines_count=200, max_labels_count=200)
ph = ta.pivothigh(5, 5)
pl = ta.pivotlow(5, 5)
var box b = na
var line ln = na
if not na(ph)
    b := box.new(bar_index - 10, ph, bar_index, ph - ta.atr(14) * 2, border_color=color.green, bgcolor=color.new(color.green, 85))
    ln := line.new(bar_index - 10, ph, bar_index, ph, color=color.green)
    label.new(bar_index, ph, "HH " + str.tostring(ph, format.mintick), style=label.style_label_down, color=color.green, textcolor=color.black)`]);

CASES.push(['v6 UDT + array 方法 (SMC 常见写法)', `//@version=6
indicator("UDT", overlay=true)
type FVG
    float top
    float bot
    int   idx
var array<FVG> gaps = array.new<FVG>()
if close > close[2] and low > high[2]
    array.push(gaps, FVG.new(low, high[2], bar_index))
if array.size(gaps) > 0
    g = array.get(gaps, array.size(gaps) - 1)
    box.new(g.idx, g.top, bar_index, g.bot, border_color=color.teal, bgcolor=color.new(color.teal, 80))
plot(array.size(gaps), "gaps")`]);

CASES.push(['strategy 脚本(看 trades)', `//@version=6
strategy("S", overlay=true, initial_capital=10000)
if ta.crossover(close, ta.ema(close, 20))
    strategy.entry("L", strategy.long)
if ta.crossunder(close, ta.ema(close, 20))
    strategy.close("L")`]);

const engine = new PineEngine();
console.log('pinets 版本:', (await import('pinets/package.json', { with: { type: 'json' } }).catch(() => null)) ? '见 node_modules' : 'n/a');

const results = [];
for (const [name, src] of CASES) {
  const r = await runScript(engine, src, 'id-' + results.length, { fetchSeries: async (sym, tf) => ({ symbol: sym, timeframe: tf, bars: BARS.slice(-400) }) });
  r.name = name;
  results.push(r);
  console.log(JSON.stringify({ name: r.name, ok: r.ok, err: r.err, prepMs: r.prepMs, runMs: r.runMs, counts: r.counts, modelKeys: r.modelKeys, warnings: r.warnings.slice(0, 2) }, null, 1));
}

// 同引擎连续两个脚本（P0-C 里 chart.runScript 第二次 ok:false 的等价检查）
const a = await runScript(engine, CASES[1][1], 'multi-a');
const b = await runScript(engine, CASES[2][1], 'multi-b');
console.log('MULTI:', JSON.stringify({ first: { ok: a.ok, err: a.err }, second: { ok: b.ok, err: b.err, counts: b.counts } }));

fs.writeFileSync('D:/Crypto/code/TraderTrain-vela/docs/vela-pinets-probe.json', JSON.stringify(results.map(({ model, ...rest }) => rest), null, 1));
console.log('written');
