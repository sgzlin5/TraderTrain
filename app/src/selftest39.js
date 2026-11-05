// M39 验收：换机迁移（配置导出/导入、行情包导出/导入）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const TEST_ID = 'ZZTEST39-1m';
  let db = null, T = null;

  try {
    for (let i = 0; i < 100 && !window.__UI_READY__; i++) await wait(100);
    db = await import('./db.js');
    T = await import('./transfer.js');

    // 1) UI：区块与按钮都在、且已接线（点一次导出应产生下载名而非报错）
    document.getElementById('btnData').click();
    await wait(350);
    const ids = ['xferCfgExport', 'xferCfgImport', 'xferDataExport', 'xferDataImport'];
    log('ui', {
      drawerOpen: document.getElementById('drawer').hidden === false,
      buttons: ids.map(id => { const b = document.getElementById(id); return b ? (b.textContent || '').trim() : null; }),
      wired: typeof window.__TT_TRANSFER__ === 'object'
    });

    // 2) 配置往返：写探针 → 导出 → 删 → 导入 → 读回
    const probeKey = 'selftest39:probe';
    const probeVal = { zh: '中文值', n: 42, nested: { ok: true } };
    await db.kvSet(probeKey, probeVal);
    const cfg = await T.exportConfig();
    const cfgText = await cfg.blob.text();
    const cfgObj = JSON.parse(cfgText);
    log('configExport', {
      keys: cfg.keys, bytes: cfg.bytes, name: cfg.name,
      app: cfgObj.app, type: cfgObj.type,
      hasProbe: Object.prototype.hasOwnProperty.call(cfgObj.kv, probeKey),
      excludesProfiles: !Object.prototype.hasOwnProperty.call(cfgObj.kv, 'profiles')
    });
    await db.kvDel(probeKey);
    const goneBefore = await db.kvGet(probeKey);
    const cfgFile = new File([cfg.blob], cfg.name, { type: 'application/json' });
    const cfgRes = await T.importConfig(cfgFile);
    const back = await db.kvGet(probeKey);
    log('configImport', {
      keys: cfgRes.keys, goneBefore: goneBefore === undefined,
      restored: JSON.stringify(back) === JSON.stringify(probeVal),
      profilesUntouched: Array.isArray(await db.kvGet('profiles'))
    });
    await db.kvDel(probeKey);

    // 3) 造一个假品种 + 2 个分片（28 B/根），用于行情包往返
    const mkChunk = (count, base) => {          // count = 根数（不是数组！）
      const buf = new ArrayBuffer(count * 28);
      const dv = new DataView(buf);
      for (let i = 0; i < count; i++) {
        dv.setBigInt64(i * 28, BigInt(1700000000000 + (i + base) * 60000), true);
        for (let f = 0; f < 4; f++) dv.setInt32(i * 28 + 8 + f * 4, Math.round((2000 + i) * 1000), true);
        dv.setFloat32(i * 28 + 24, 100 + i, true);
      }
      return buf;
    };
    const c1 = db.chunkKey(TEST_ID, 2025), c2 = db.chunkKey(TEST_ID, 2026);
    const b1 = mkChunk(3, 0), b2 = mkChunk(2, 3);
    await db.putChunk(c1, b1);
    await db.putChunk(c2, b2);
    await db.saveProfile({
      id: TEST_ID, symbol: 'ZZTEST', name: '自检假品种', sourceTz: 0,
      bytes: b1.byteLength + b2.byteLength, bars: 5,
      first: 1700000000000, last: 1700000000000 + 4 * 60000, lastClose: 2000,
      chunks: [{ year: 2025, bytes: b1.byteLength, bars: 3, first: 1700000000000, last: 1700000120000 },
               { year: 2026, bytes: b2.byteLength, bars: 2, first: 1700000180000, last: 1700000240000 }]
    });

    // 4) 导出行情（只导这个假品种，避免把真行情 100+ MB 拖进来）
    const prog = [];
    const pack = await T.exportData((p) => prog.push(p.pct), { only: [TEST_ID] });
    log('dataExport', {
      name: pack.name, profiles: pack.profiles, chunks: pack.chunks, bytes: pack.bytes,
      progressTicks: prog.length, progressLast: prog[prog.length - 1] ?? null,
      chunkKeys: pack.chunkKeys, profileIds: pack.profileIds
    });

    // 5) 包头
    const packFile = new File([pack.blob], pack.name, { type: 'application/octet-stream' });
    const peek = await T.peekData(packFile);
    log('peek', {
      type: peek.header.type, profiles: peek.header.profiles.length,
      chunks: peek.header.chunks.length,
      payloadMatches: peek.header.chunks.reduce((s, c) => s + c.bytes, 0) === pack.bytes - peek.payloadOffset,
      symbols: peek.header.profiles.map(p => p.symbol)
    });

    // 6) 删掉再导入，验证分片字节一致
    await db.deleteProfile(TEST_ID);
    const afterDel = await db.listChunkKeys(TEST_ID);
    const imp = await T.importData(packFile, () => {});
    const keys = await db.listChunkKeys(TEST_ID);
    const r1 = new Uint8Array(await db.getChunk(c1));
    const r2 = new Uint8Array(await db.getChunk(c2));
    const same = (a, b) => a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
    const prof = (await db.getProfiles()).find(p => p.id === TEST_ID);
    log('dataImport', {
      deletedKeys: afterDel.length, imported: imp.chunks, profiles: imp.profiles,
      keys: keys.length, bytesEqual: same(r1, new Uint8Array(b1)) && same(r2, new Uint8Array(b2)),
      profileBack: !!prof, barsInProfile: prof?.bars ?? null, symbols: imp.symbols
    });

    // 7) 坏包要报人话，而不是静默
    let badErr = '';
    try { await T.peekData(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'bad.ttdata')); }
    catch (e) { badErr = e.message; }
    log('badPack', badErr);

    // 清理
    await db.deleteProfile(TEST_ID);

    R.pass = (
      R.checks.ui.drawerOpen === true
      && R.checks.ui.buttons.every(t => t && t.length > 0)
      && R.checks.ui.wired === true
      && R.checks.configExport.hasProbe === true && R.checks.configExport.excludesProfiles === true
      && R.checks.configExport.app === 'TraderTrain' && R.checks.configExport.type === 'config'
      && R.checks.configImport.goneBefore === true && R.checks.configImport.restored === true
      && R.checks.configImport.profilesUntouched === true
      && R.checks.dataExport.profiles === 1 && R.checks.dataExport.chunks === 2
      && R.checks.dataExport.progressTicks >= 2 && R.checks.dataExport.progressLast === 100
      && R.checks.peek.payloadMatches === true && R.checks.peek.symbols.includes('ZZTEST')
      && R.checks.dataImport.deletedKeys === 0 && R.checks.dataImport.imported === 2
      && R.checks.dataImport.keys === 2 && R.checks.dataImport.bytesEqual === true
      && R.checks.dataImport.profileBack === true && R.checks.dataImport.barsInProfile === 5
      && /行情包|ttdata/.test(R.checks.badPack || '')
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    try { if (db) await db.deleteProfile(TEST_ID); } catch {}
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
