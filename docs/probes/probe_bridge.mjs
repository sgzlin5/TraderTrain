import fs from 'node:fs';
import { PineEngine } from '@luxalgo/vela-pinets';

const T0 = 1767387600000;
const BARS = Array.from({ length: 800 }, (_, i) => {
  const o = 2000 + Math.sin(i / 9) * 20, c = o + Math.sin(i / 5) * 8;
  return { time: T0 + i * 60000, open: o, high: Math.max(o, c) + 2, low: Math.min(o, c) - 2, close: c, volume: 100 };
});
const INFO = { tickerid: 'BTCUSDT', mintick: 0.01, pricescale: 100, timezone: 'UTC' };

async function run(src, id) {
  const engine = new PineEngine();
  const prepared = await engine.prepare(src, id);
  let model = null, err = null;
  await new Promise((res) => {
    let d = false; const fin = () => { if (!d) { d = true; res(); } };
    engine.execute({ prepared, market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: INFO }, bars: BARS, getBars: () => BARS, mode: 'static' },
      { onModel(m) { model = m; }, onError(e) { err = String(e.message || e); }, onDone() { fin(); } });
    setTimeout(fin, 60000);
  });
  return { model, err };
}

// 1) LuxAlgo 常见的 `var table t = na` + barstate.islast 填格
const r1 = await run(`//@version=6
indicator("VAR-TABLE", overlay=true)
var table t = na
if barstate.islast
    t := table.new(position.top_right, 2, 2, bgcolor=color.new(color.black, 10))
    table.cell(t, 0, 0, "Trend", text_color=color.white)
    table.cell(t, 1, 0, close > open ? "Bull" : "Bear", text_color=color.white)
plot(close)`, 'var-table');
const tb = r1.model?.tables?.[0];
console.log('1 var-table err=', r1.err, 'tables=', r1.model?.tables?.length, 'cells=', tb ? JSON.stringify(tb).slice(0, 400) : null);

// 2) barstate 语义：末根 islast/isconfirmed/isnew
const r2 = await run(`//@version=6
indicator("BS", overlay=false)
plot(barstate.islast ? 1 : 0, "islast")
plot(barstate.isconfirmed ? 1 : 0, "isconfirmed")
plot(barstate.isnew ? 1 : 0, "isnew")
plot(bar_index, "bi")`, 'barstate');
const series = r2.model?.series || [];
console.log('2 barstate err=', r2.err, 'series=', series.length);
for (const s of series) {
  const v = s.values || s.data || [];
  const tail = v.slice(-3);
  console.log('   ', s.title || s.name || s.id, 'last3=', JSON.stringify(tail));
}

// 3) labels 上限与密集标签（每根画一个）
const r3 = await run(`//@version=6
indicator("LA", overlay=true, max_labels_count=500)
if barstate.isconfirmed
    label.new(bar_index, high, str.tostring(bar_index))`, 'labels');
console.log('3 labels err=', r3.err, 'labels=', r3.model?.labels?.length);

// 4) alert()（LuxAlgo 大量用）
const r4 = await run(`//@version=6
indicator("AL", overlay=false)
if ta.crossover(close, ta.sma(close, 10))
    alert("cross up " + str.tostring(close))`, 'alert');
console.log('4 alert ok=', !r4.err, 'alerts in model=', r4.model?.alerts?.length);
