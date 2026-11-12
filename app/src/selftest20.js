// M20 验收：ZIP / CSV 直接导入（多 csv、混合压缩、周期校验、去重、UI 全链路）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const FIX = '../../tools/fixtures/';

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;

    const { listZipEntries, csvEntries } = await import('./zip.js');
    const { importCsvSources } = await import('./ingest.js');
    const { deleteProfile, getProfile, getChunk } = await import('./db.js');

    // 1) 列目录：3 个条目，过滤出 2 个 csv
    const zipBlob = await (await fetch(FIX + 'TTZIP.zip')).blob();
    const zipFile = new File([zipBlob], 'TTZIP.zip', { type: 'application/zip' });
    const entries = await listZipEntries(zipFile);
    const csvs = csvEntries(entries);
    log('entries', entries.map(e => ({ name: e.name, method: e.method, size: e.size })));
    log('csvCount', csvs.length);

    // 2) 直接走导入管线（deflate + stored 两种都覆盖）
    const t0 = performance.now();
    const saved = await importCsvSources(csvs.map(e => ({
      name: e.name,
      getText: async () => (await import('./zip.js')).readZipEntry(zipFile, e).then(b => new TextDecoder().decode(b))
    })), { symbol: 'TTZIP' });
    log('importMs', Math.round(performance.now() - t0));
    log('saved', { symbol: saved.symbol, bars: saved.bars, bytes: saved.bytes, chunks: saved.chunks.map(c => c.year), first: saved.first, last: saved.last });

    // 3) 首根价格与 csv 对齐（2024-06-03 00:00:00 UTC）
    const y2024 = saved.chunks.find(c => String(c.year) === '2024');
    const buf = await getChunk(y2024.key);
    const dv = new DataView(buf);
    const rec = {
      ts: Number(dv.getBigInt64(0, true)),
      o: dv.getInt32(8, true) / 1000, h: dv.getInt32(12, true) / 1000,
      l: dv.getInt32(16, true) / 1000, c: dv.getInt32(20, true) / 1000,
      v: dv.getFloat32(24, true)
    };
    log('firstRecord', rec);

    // 4) 5 分钟数据必须被拒
    const badBlob = await (await fetch(FIX + 'TTBAD.zip')).blob();
    const badFile = new File([badBlob], 'TTBAD.zip');
    const badCsvs = csvEntries(await listZipEntries(badFile));
    let badErr = null;
    try {
      await importCsvSources(badCsvs.map(e => ({
        name: e.name,
        getText: async () => (await import('./zip.js')).readZipEntry(badFile, e).then(b => new TextDecoder().decode(b))
      })), { symbol: 'TTBAD' });
    } catch (e) { badErr = e.message; }
    log('badErr', badErr);
    log('badProfileExists', !!(await getProfile('TTBAD-1m')));

    // 4.5) Dukascopy 风格：time 列 + DD.MM.YYYY HH:MM:SS
    const dkBlob = await (await fetch(FIX + 'TTDK.zip')).blob();
    const dkFile = new File([dkBlob], 'TTDK.zip');
    const dkCsvs = csvEntries(await listZipEntries(dkFile));
    const dkSaved = await importCsvSources(dkCsvs.map(e => ({
      name: e.name,
      getText: async () => (await import('./zip.js')).readZipEntry(dkFile, e).then(b => new TextDecoder().decode(b))
    })), { symbol: 'TTDK' });
    const dkChunk = dkSaved.chunks[0];
    const dkBuf = await getChunk(dkChunk.key);
    const dkv = new DataView(dkBuf);
    log('dukascopy', {
      bars: dkSaved.bars,
      firstTs: dkSaved.first,
      firstIso: new Date(dkSaved.first).toISOString(),
      o: dkv.getInt32(8, true) / 1000,
      c: dkv.getInt32(20, true) / 1000
    });

    // 5) UI 全链路：把文件塞进 input，点「导入」
    if (document.getElementById('drawer').hidden) document.getElementById('btnData').click();
    await wait(300);
    const dt = new DataTransfer();
    dt.items.add(new File([zipBlob], 'TTZIP.zip', { type: 'application/zip' }));
    const input = document.getElementById('csvFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await wait(200);
    document.getElementById('csvGo').click();
    let uiMsg = '';
    for (let i = 0; i < 60; i++) {
      await wait(250);
      uiMsg = document.getElementById('csvMsg').textContent || '';
      if (/导入完成|导入失败/.test(uiMsg)) break;
    }
    log('uiMsg', uiMsg);
    log('uiProfile', !!(await getProfile('TTZIP-1m')));
    // 导入后必须真的上图（曾经因为 tabs 没清空，加载完是 0 根）
    await wait(1500);
    log('chartBarsAfterImport', state.app?.bars?.allBars?.().length ?? 0 ?? 0);
    log('tabCount', document.querySelectorAll('.tab').length);

    // 6) 清理
    for (const id of ['TTZIP-1m', 'TTBAD-1m', 'TTDK-1m']) { try { await deleteProfile(id); } catch {} }

    R.pass = (
      entries.length === 3 && csvs.length === 2
      && saved.bars === 420 && saved.chunks.length === 2
      && saved.bytes === 420 * 28
      && rec.o === 2150 && rec.h === 2150.3 && rec.l === 2149.3 && rec.c === 2149.6
      && /1m|1 分钟/.test(String(badErr)) && (await getProfile('TTBAD-1m')) === null
      && /导入完成/.test(uiMsg) && /420/.test(uiMsg)
      && dkSaved.bars === 120 && new Date(dkSaved.first).toISOString() === '2024-06-03T00:00:00.000Z'
      && dkv.getInt32(8, true) / 1000 === 2320
      && (state.app?.bars?.allBars?.().length || 0) > 0
      && document.querySelectorAll('.tab').length === 1
    );
  } catch (err) {
    R.errors.push(String(err && err.stack || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
