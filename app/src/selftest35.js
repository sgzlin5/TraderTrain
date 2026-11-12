// M35 验收：Pine 支持矩阵抽样（含 syminfo.mintick 修复）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const pine = await import('./pine.js');
    const pd = await import('./pineDraw.js');
    const bars = state.app.bars.allBars();
    const sym = state.profile?.symbol || 'XAUUSD';
    const last = (a) => { for (let i = (a || []).length - 1; i >= 0; i--) if (a[i] != null && !Number.isNaN(a[i])) return a[i]; return null; };
    const P = (src) => pine.compilePine(src, bars, null, sym);

    // 1) 基础 TA 输出
    const ta = await P('//@version=6\nindicator("t")\nplot(ta.ema(close,20), "e")\nplot(ta.rsi(close,14), "r")\nplot(ta.atr(14), "a")');
    log('ta', { ok: ta.ok, names: ta.names, ema: last(ta.series?.e), rsi: last(ta.series?.r) });

    // 2) syminfo（本轮修复项）
    const si = await P('//@version=6\nindicator("t")\nplot(syminfo.mintick, "mt")\nplot(syminfo.tickerid == syminfo.ticker ? 1 : 0, "id")\nplot(syminfo.pricescale, "ps")');
    log('syminfo', { mintick: last(si.series?.mt), idOk: last(si.series?.id), pricescale: last(si.series?.ps) });

    // 3) request.security + lower_tf
    const sec = await P('//@version=6\nindicator("t", overlay=true)\nc4 = request.security(syminfo.tickerid, "240", close)\nplot(c4, "c4")\narr = request.security_lower_tf(syminfo.tickerid, "1", close)\nplot(array.size(arr), "n")');
    log('security', { c4: last(sec.series?.c4), lowerTf: last(sec.series?.n) });

    // 4) 绘图对象：line / label / box
    const dr = await P('//@version=6\nindicator("t", overlay=true)\nif barstate.islast\n    line.new(bar_index-10, low, bar_index, high)\n    label.new(bar_index, high, "X")\n    box.new(bar_index-5, high, bar_index, low)');
    const d1 = pd.collectDrawings(dr.ctx?.plots || {});
    log('drawings', { lines: d1.lines.length, labels: d1.labels.length, boxes: d1.boxes.length });

    // 5) table
    const tb = await P('//@version=6\nindicator("t", overlay=true)\nvar t = table.new(position.top_right, 2, 2)\nif barstate.islast\n    table.cell(t, 0, 0, "A")\n    table.cell(t, 1, 0, str.tostring(close, "#.##"))');
    const d2 = pd.collectDrawings(tb.ctx?.plots || {});
    log('table', { tables: d2.tables.length, cells: d2.tables[0]?.cells?.length || 0 });

    // 6) 语言特性：UDT / method / switch / map / matrix / var
    const lang = await P(`//@version=6
indicator("t")
type Pivot
    float price
    int bar
method double(float x) => x * 2
m = map.new<string, float>()
map.put(m, "a", 1.5)
mt = matrix.new<float>(2, 2, 1.0)
matrix.set(mt, 0, 1, 2.5)
v = switch
    close > open => 1.0
    => -1.0
var Pivot p = Pivot.new(high, bar_index)
plot(double(v) + map.get(m, "a") + matrix.get(mt, 0, 1) + p.price * 0, "v")`);
    log('lang', { ok: lang.ok, names: lang.names, v: last(lang.series?.v) });

    // 7) strategy 能编译但没有数值输出
    const st = await P('//@version=6\nstrategy("s", overlay=true)\nif ta.crossover(close, ta.sma(close,20))\n    strategy.entry("L", strategy.long)');
    log('strategy', { ok: st.ok, names: st.names, hasCtxStrategy: !!st.ctx?.strategy });

    // 8) barstate 语义（历史数据全部 confirmed）
    const bs = await P('//@version=6\nindicator("t")\nplot(barstate.islast ? 1 : 0, "last")\nplot(barstate.isconfirmed ? 1 : 0, "conf")');
    log('barstate', { last: last(bs.series?.last), confirmed: last(bs.series?.conf) });

    // 9) 性能：轻脚本应远低于 100 ms
    const t0 = performance.now();
    await P('//@version=6\nindicator("t")\nplot(ta.ema(close,20), "e")');
    log('perf', { lightMs: +(performance.now() - t0).toFixed(0), bars: bars.length });

    const s = R.checks;
    R.pass = (
      s.ta.ok === true && s.ta.names.length === 3 && s.ta.ema > 0
      && s.syminfo.mintick > 0 && s.syminfo.idOk === 1 && s.syminfo.pricescale >= 1
      && s.security.c4 > 0 && s.security.lowerTf >= 1
      && s.drawings.lines === 1 && s.drawings.labels === 1 && s.drawings.boxes === 1
      && s.table.tables === 1 && s.table.cells === 2
      && s.lang.ok === true && s.lang.v != null
      && s.strategy.ok === true && s.strategy.names.length === 0 && s.strategy.hasCtxStrategy === true
      // 最后一根是「正在走的那根」→ isconfirmed 恒 0（pineCore 预处理：bar_index < n-1）
      && s.barstate.last === 1 && s.barstate.confirmed === 0
      && s.perf.lightMs < 100
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
