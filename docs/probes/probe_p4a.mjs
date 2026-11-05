// P4-a 前置实验（VELA-REMAINING §2 / PINETS-COVERAGE §3.4）
// 1) live 模式下 barstate.isconfirmed 的末根口径（R12）：
//    static 实测末根 = 1（已录）；这里验 mode:'live' + notifyBars 三步：
//    初始(含forming尾bar) → tick(改forming) → 收盘(补新forming)，看末根/次末根的 ic 值。
// 2) importResolver 链式解析：脚本 import libA，libA 再 import libB；
//    记录 resolver 被问了几次、path/importer 长什么样、null 时的报错原文。
// 跑法：仓库根 npm i 后 `node docs/probes/probe_p4a.mjs`（纯 Node）。
import { PineEngine } from '@luxalgo/vela-pinets';

const T0 = 1767387600000;
const mk = (i, o, h, l, c, v) => ({ time: T0 + i * 60000, open: o, high: h, low: l, close: c, volume: v });
// 200 根已收盘 + 1 根 forming（200 号，volume 未定）
const base = Array.from({ length: 200 }, (_, i) => mk(i, 2000 + i, 2003 + i, 1998 + i, 2001 + i, 100));
const forming = () => mk(200, 2200, 2204, 2199, 2202, 37);

const SRC = `//@version=6
indicator("P4A", overlay=false)
plot(barstate.isconfirmed ? 1 : 0, "ic")
plot(barstate.islast ? 1 : 0, "il")`;

const MKT = { symbol: 'BTCUSDT', timeframe: '1', symbolInfo: { tickerid: 'BTCUSDT', mintick: 0.01, pricescale: 100, timezone: 'UTC' } };

function dumpSeries(model, tag) {
  const out = {};
  for (const s of (model?.series ?? [])) {
    const arr = s.values ?? s.data ?? s.points ?? null;
    const key = s.title ?? s.id ?? s.plot ?? '?';
    if (Array.isArray(arr)) out[key] = { n: arr.length, last2: arr.slice(-2).map(v => (v && typeof v === 'object') ? JSON.stringify(v) : v) };
    else out[key] = { keys: Object.keys(s) };
  }
  console.log(tag, JSON.stringify({ modelKeys: Object.keys(model ?? {}), series: out }));
}

// ---------- 实验 1：live isconfirmed ----------
{
  const bars = [...base, forming()];               // getBars 返回的活数组
  const engine = new PineEngine();
  const prepared = await engine.prepare(SRC, 'p4a');
  const models = [];
  let done;
  const gate = new Promise(r => { done = r; });
  const session = engine.execute({
    prepared, market: MKT, bars, getBars: () => bars, mode: 'live',
  }, {
    onModel(m) { models.push(m); },
    onError(e) { console.log('LIVE onError', String(e?.message ?? e)); },
    onDone() { /* live 流不触发 */ },
  });
  await new Promise(r => setTimeout(r, 1500));      // 等首轮
  dumpSeries(models.at(-1), 'LIVE 初始(末根=forming) models=' + models.length);
  // tick：forming 原地变（同一 time，价格变）
  bars[200].close = 2203.5; bars[200].high = 2205;
  session.notifyBars();                             // undefined = live tick
  await new Promise(r => setTimeout(r, 800));
  dumpSeries(models.at(-1), 'LIVE tick后 models=' + models.length);
  // 收盘：200 号定稿 + 追加 201 号新 forming
  bars[200] = mk(200, 2200, 2205, 2199, 2203.5, 100);
  bars.push(forming201());
  function forming201() { return mk(201, 2203.5, 2206, 2202, 2205, 21); }
  session.notifyBars();
  await new Promise(r => setTimeout(r, 800));
  dumpSeries(models.at(-1), 'LIVE 收盘后(次末根应确认?) models=' + models.length);
  session.stop();

  // 对照：同一份最终数据跑 static
  const e2 = new PineEngine();
  const p2 = await e2.prepare(SRC, 'p4a-s');
  const m2 = [];
  await new Promise(res => { let d = false; const fin = () => { if (!d) { d = true; res(); } };
    e2.execute({ prepared: p2, market: MKT, bars, getBars: () => bars, mode: 'static' },
      { onModel(m) { m2.push(m); }, onDone() { fin(); } }); setTimeout(fin, 15000); });
  dumpSeries(m2.at(-1), 'STATIC 对照(同一数据) ');
}

// ---------- 实验 1b：预处理替换 barstate.isconfirmed → not barstate.islast ----------
// 结论见文末记录：vela-pinets 任何模式末根 ic=1；主线口径（末根=0）要靠源码预处理。
{
  const SRC2 = SRC.replace(/barstate\.isconfirmed/g, 'not barstate.islast');
  const bars = [...base, mk(200, 2200, 2204, 2199, 2202, 37)];
  const engine = new PineEngine();
  const prepared = await engine.prepare(SRC2, 'p4b');
  const models = [];
  const session = engine.execute({ prepared, market: MKT, bars, getBars: () => bars, mode: 'live' },
    { onModel(m) { models.push(m); } });
  await new Promise(r => setTimeout(r, 2500));
  const arr = m => { const s = m.series[0]; return (s.values ?? s.data ?? s.points).map(e => e.value); };
  console.log('PATCH LIVE 初始: 末根ic=' + arr(models.at(-1)).at(-1) + ' (期望0) models=' + models.length);
  bars[200] = mk(200, 2200, 2205, 2199, 2203.5, 100);
  bars.push(mk(201, 2203.5, 2206, 2202, 2205, 21));
  session.notifyBars();
  await new Promise(r => setTimeout(r, 2500));
  const mfin = models.at(-1);
  const va = arr(mfin);
  const s0 = mfin.series[0];
  const v0 = (s0.values ?? s0.data ?? s0.points);
  console.log('PATCH LIVE 收盘后: 次末根ic=' + va.at(-2) + ' (期望1) 末根ic=' + va.at(-1) + ' (期望0) n=' + va.length
    + ' 末time=' + v0.at(-1).time + ' (应=bar201=' + (T0 + 201 * 60000) + ') models=' + models.length);
  session.stop();
}

// ---------- 实验 2：importResolver 链式 ----------
{
  const asked = [];
  const LIBS = {
    'mylib/a/1': `//@version=6
library("a", overlay=false)
import mylib/b/1 as b
export f(float x) => b.g(x) + 1`,
    'mylib/b/1': `//@version=6
library("b", overlay=false)
export g(float x) => x * 2`,
  };
  const engine = new PineEngine({
    importResolver: async (path, info) => {
      asked.push({ path, importer: info?.importer, version: info?.version, name: info?.name });
      return LIBS[path] ?? null;
    },
  });
  const SRC2 = `//@version=6
indicator("IMP-CHAIN", overlay=false)
import mylib/a/1 as a
plot(a.f(close))`;
  const prepared = await engine.prepare(SRC2, 'imp2');
  const bars = base;
  const models = []; let err = null;
  await new Promise(res => { let d = false; const fin = () => { if (!d) { d = true; res(); } };
    engine.execute({ prepared, market: MKT, bars, getBars: () => bars, mode: 'static' },
      { onModel(m) { models.push(m); }, onError(e) { err = String(e?.message ?? e); }, onDone() { fin(); } });
    setTimeout(fin, 20000); });
  console.log('CHAIN resolver调用=' + JSON.stringify(asked));
  const s = models.at(-1)?.series?.[0];
  const arr = s && (s.values ?? s.data ?? s.points);
  console.log('CHAIN ok=' + !!models.at(-1), 'err=' + err, '末值=' + (Array.isArray(arr) ? arr.at(-1) : '(无series)'));
}

// ---------- 实验 3：resolver 返回 null 的报错原文 ----------
{
  const engine = new PineEngine({ importResolver: async () => null });
  try { await engine.prepare(`//@version=6\nindicator("X")\nimport nobody/lib/1 as x\nplot(close)`, 'x3'); console.log('NULL resolved: prepare 成功(意外)'); }
  catch (e) { console.log('NULL err原文:', String(e?.message ?? e).slice(0, 200)); }
}

process.exit(0);
