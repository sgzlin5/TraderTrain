import fs from 'node:fs';
import { PineEngine } from '@luxalgo/vela-pinets';

const T0 = 1767387600000;
function bars(n = 1500) {
  const out = []; let p = 2000;
  for (let i = 0; i < n; i++) {
    const o = p, drift = Math.sin(i / 23) * 6 + Math.sin(i / 7) * 2.5 + (i % 41 === 0 ? 12 : 0), c = o + drift;
    out.push({ time: T0 + i * 60000, open: +o.toFixed(2), high: +(Math.max(o, c) + Math.abs(drift) * 0.4 + 1.2).toFixed(2), low: +(Math.min(o, c) - Math.abs(drift) * 0.4 - 1.2).toFixed(2), close: +c.toFixed(2), volume: 100 + (i % 37) * 3 });
    p = c;
  }
  return out;
}
const BARS = bars();
const INFO = { tickerid: 'BTCUSDT', mintick: 0.01, pricescale: 100, timezone: 'UTC', session: '24x7' };
let fetchCalls = [];

async function run(engine, src, id) {
  const r = { id, ok: false, err: null, prepMs: 0, runMs: 0, counts: null, warnings: [], fetchCalls: 0 };
  let prepared; const t0 = Date.now();
  try { prepared = await engine.prepare(src, id); r.prepMs = Date.now() - t0; }
  catch (e) { r.err = 'prepare: ' + (e.message || e); return r; }
  const t1 = Date.now();
  await new Promise((resolve) => {
    let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
    try {
      engine.execute(
        { prepared, market: { symbol: 'BTCUSDT', timeframe: '60', symbolInfo: INFO }, bars: BARS, getBars: () => BARS,
          fetchSeries: async (sym, tf, range) => { r.fetchCalls++; fetchCalls.push(`${sym}/${tf}`); return BARS; },
          mode: 'static', historyState: 'complete' },
        { onModel(m) { r.model = m; }, onAlert() { r.alerts = (r.alerts || 0) + 1; },
          onWarning(w) { r.warnings.push(String(w).slice(0, 200)); },
          onError(e) { r.err = 'run: ' + String(e && e.message || e).slice(0, 500); },
          onDone() { fin(); } });
    } catch (e) { r.err = 'execute: ' + (e.message || e); fin(); }
    setTimeout(fin, 90000);
  });
  r.runMs = Date.now() - t1;
  if (r.model) {
    r.ok = !r.err;
    const c = (k) => (Array.isArray(r.model[k]) ? r.model[k].length : 0);
    r.counts = { series: c('series'), tables: c('tables'), labels: c('labels'), lines: c('lines'), boxes: c('boxes'), trades: c('trades'), priceLines: c('priceLines'), backgrounds: c('backgrounds') };
    r.modelWarnings = (r.model.warnings || []).slice(0, 3);
    r.title = r.model.title;
  }
  return r;
}

const engine = new PineEngine();
const fixture = fs.readFileSync('D:/Crypto/code/TraderTrain-vela/app/fixtures/luxalgo-structure-trend-dashboard.pine', 'utf8');
const secScript = `//@version=6
indicator("SEC", overlay=false)
htf = request.security(syminfo.tickerid, "240", ta.ema(close, 20))
[c4, o4] = request.security(syminfo.tickerid, "D", [close, open])
plot(htf, color=color.yellow)
plot(c4 - o4, color=color.aqua)
plot(c4, "c4")`;

const out = [];
out.push(await run(engine, fixture, 'luxalgo-dashboard'));
out.push(await run(engine, secScript, 'security-mtf'));
// 再次在同一个引擎上跑 dashboard（复用引擎 / 第二个实例）
out.push(await run(engine, fixture, 'luxalgo-dashboard-2nd'));
for (const r of out) { delete r.model; console.log(JSON.stringify(r)); }
console.log('FETCH(' + fetchCalls.length + '):', JSON.stringify([...new Set(fetchCalls)]));
fs.writeFileSync('D:/Crypto/code/TraderTrain-vela/docs/vela-pinets-probe2.json', JSON.stringify(out, null, 1));
