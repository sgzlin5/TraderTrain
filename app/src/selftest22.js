// M22 验收：增量续传（append）——只补缺、复用旧分片、边界同 ts 用新值
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const FIX = '../../tools/fixtures/';

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    const zipMod = await import('./zip.js');
    const ing = await import('./ingest.js');
    const { getProfile, getChunk, deleteProfile } = await import('./db.js');

    // 1) 整段导入 TTZIP（2024: 240 根 / 2025: 180 根）
    const blob = await (await fetch(FIX + 'TTZIP.zip')).blob();
    const file = new File([blob], 'TTZIP.zip');
    const entries = zipMod.csvEntries(await zipMod.listZipEntries(file));
    const srcs = entries.map(e => ({
      name: e.name,
      getText: async () => new TextDecoder().decode(await zipMod.readZipEntry(file, e))
    }));
    const first = await ing.importCsvSources(srcs, { symbol: 'TTAPP' });
    const keyOf = (prof, y) => prof.chunks.find(c => String(c.year) === String(y))?.key;
    log('import', { bars: first.bars, chunks: first.chunks.length, first: first.first, last: first.last });
    const k2024a = keyOf(first, 2024), k2025a = keyOf(first, 2025);

    // 2) 造一段“续传数据”：重复最后一根 03:59（改价）+ 新增 04:00…04:59
    const pad = (n) => String(n).padStart(2, '0');
    const rows = ['datetime,open,high,low,close,volume'];
    rows.push('2024-06-03 03:59:00,9000.00,9999.00,9000.00,9999.00,7');   // 同 ts，应覆盖旧值
    for (let m = 0; m < 60; m++) {
      const hh = 4, mm = m;
      rows.push(`2024-06-03 ${pad(hh)}:${pad(mm)}:00,9100.00,9100.50,9099.50,9100.20,${100 + m}`);
    }
    const t0 = performance.now();
    const after = await ing.appendCsvSources([{ name: 'TTAPP_append.csv', getText: async () => rows.join('\n') + '\n' }], { symbol: 'TTAPP' });
    log('appendMs', Math.round(performance.now() - t0));
    const k2024b = keyOf(after, 2024), k2025b = keyOf(after, 2025);
    log('append', {
      bars: after.bars, delta: after.bars - first.bars,
      firstUnchanged: after.first === first.first,
      last: new Date(after.last).toISOString(),
      chunk2024: after.chunks.find(c => String(c.year) === '2024'),
      reuse2025: k2025a === k2025b, rewrite2024: k2024a !== k2024b
    });

    // 3) 边界那根必须是新值
    const y2024 = after.chunks.find(c => String(c.year) === '2024');
    const buf = await getChunk(y2024.key);
    const dv = new DataView(buf);
    const n = Math.floor(buf.byteLength / 28);
    let edge = null;
    for (let i = 0; i < n; i++) {
      const ts = Number(dv.getBigInt64(i * 28, true));
      if (new Date(ts).toISOString() === '2024-06-03T03:59:00.000Z') {
        edge = { ts, close: dv.getInt32(i * 28 + 20, true) / 1000, vol: dv.getFloat32(i * 28 + 24, true) };
        break;
      }
    }
    log('edgeBar', edge);

    // 4) 没有档案时续传要报错，而不是静默新建
    let noPrev = null;
    try {
      await ing.appendCsvSources([{ name: 'x.csv', getText: async () => rows.join('\n') }], { symbol: 'TNOPE' });
    } catch (e) { noPrev = e.message; }
    log('noPrev', noPrev);

    try { await deleteProfile('TTAPP-1m'); } catch {}

    R.pass = (
      first.bars === 420 && first.chunks.length === 2
      && after.bars === 480 && after.bars - first.bars === 60
      && after.first === first.first
      // 档案里已有 2025 的数据，补 2024 不会把 last 往前挪
      && new Date(after.last).toISOString() === '2025-01-02T02:59:00.000Z'
      && y2024.bars === 300
      && k2025a === k2025b && k2024a !== k2024b
      && edge && edge.close === 9999 && edge.vol === 7
      && /没有 .* 的档案/.test(String(noPrev))
    );
  } catch (err) {
    R.errors.push(String(err && err.stack || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
