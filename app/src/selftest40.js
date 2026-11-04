// M40 验收：实时数据落库（方案 A′）—— 分片隔离 / 读合并 / 历史优先 / 导出合并 / 删除清理
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const ID = 'ZZLIVE40-1m';
  const DAY = Date.UTC(2026, 0, 5);            // 2026-01-05 00:00Z
  const MIN = 60_000;
  let db = null, LS = null, Src = null;

  const mkBar = (ts, price, vol = 10) => ({ timestamp: ts, open: price, high: price + 1, low: price - 1, close: price, volume: vol });

  try {
    for (let i = 0; i < 100 && !window.__UI_READY__; i++) await wait(100);
    db = await import('./db.js');
    LS = await import('./liveStore.js');
    Src = (await import('./source.js')).BarSource;
    const T = await import('./transfer.js');

    // 先清干净（重复跑不污染）
    await db.deleteProfile(ID);

    // 1) 历史分片：ts 0..9 根，价 2000+i
    const histBars = Array.from({ length: 10 }, (_, i) => mkBar(DAY + i * MIN, 2000 + i, 100));
    const histBuf = LS.encodeBars(histBars);
    const hkey = db.chunkKey(ID, 2026);
    await db.putChunk(hkey, histBuf);
    await db.saveProfile({
      id: ID, symbol: 'ZZLIVE40', name: '实时合并自检', chunks: [{
        year: 2026, key: hkey, bytes: histBuf.byteLength, bars: histBars.length,
        first: histBars[0].timestamp, last: histBars[histBars.length - 1].timestamp
      }],
      bytes: histBuf.byteLength, bars: histBars.length,
      first: histBars[0].timestamp, last: histBars[histBars.length - 1].timestamp, lastClose: 2009
    });

    // 2) 实时段：ts 5..14（与历史 5..9 重叠，价 3000+i，用来验证“历史优先”）
    const liveBars = Array.from({ length: 10 }, (_, i) => mkBar(DAY + (5 + i) * MIN, 3000 + i, 7));
    const w = await LS.appendLiveBars(ID, liveBars, { source: 'biquote', volumeKind: 'tickCount' });
    log('append', {
      days: w.days, bars: w.bars, last: w.last,
      liveKeys: (await db.listLiveKeys(ID)).length,
      dayKey: (await db.listLiveKeys(ID))[0] || null
    });

    // 3) 命名空间隔离：chunks 与 live 互不污染
    const chunkKeys = await db.listChunkKeys(ID);
    log('isolation', {
      chunkKeys, liveKeys: await db.listLiveKeys(ID),
      chunkKeyCount: chunkKeys.length,
      // live 键绝不能出现在 chunks 的键空间里
      leaksIntoChunks: chunkKeys.some(k => String(k).includes('|'))
    });

    // 4) 读合并 + 历史优先
    const prof = await db.getProfile(ID);
    const src = new Src(prof);
    const frame = await src.frame1m(DAY + 14 * MIN, 20);
    const at = (m) => frame.find(b => b.timestamp === DAY + m * MIN);
    log('merge', {
      bars: frame.length,
      first: frame[0]?.timestamp === DAY ? 'ts0' : frame[0]?.timestamp,
      last: frame[frame.length - 1]?.timestamp === DAY + 14 * MIN,
      ascending: frame.every((b, i) => i === 0 || b.timestamp > frame[i - 1].timestamp),
      // 重叠区（5..9）必须是历史的 2000+i，不是实时的 3000+i
      overlapFromHist: [5, 6, 7, 8, 9].every(m => at(m) && Math.abs(at(m).close - (2000 + m)) < 1e-6),
      liveTail: [10, 11, 12, 13, 14].every(m => at(m) && Math.abs(at(m).close - (3000 + (m - 5))) < 1e-6),
      noDup: new Set(frame.map(b => b.timestamp)).size === frame.length
    });

    // 5) 聚合窗口也吃到实时段（5m：历史 0..9 / 实时 5..14 → 桶 0,5,10）
    const agg = await src.frame(DAY + 14 * MIN, 5 * MIN, 10);
    log('aggregate', {
      buckets: agg.length,
      ts: agg.map(b => Math.round((b.timestamp - DAY) / MIN)),
      lastClose: Math.round(agg[agg.length - 1]?.close ?? 0)
    });

    // 6) nextBars / prevBar 能进出实时段
    const next = await src.nextBars(DAY + 9 * MIN, 3);
    const prev = await src.prevBar(DAY + 12 * MIN);
    log('nav', {
      next: next.map(b => Math.round((b.timestamp - DAY) / MIN)),
      prev: prev ? Math.round((prev.timestamp - DAY) / MIN) : null
    });

    // 7) 导出：实时段并入年份分片，包里没有孤儿
    const pack = await T.exportData(() => {}, { only: [ID] });
    const file = new File([pack.blob], pack.name, { type: 'application/octet-stream' });
    const peek = await T.peekData(file);
    const ch0 = peek.header.profiles[0].chunks[0];
    log('export', {
      version: peek.header.version, mergedLiveDays: pack.mergedLiveDays,
      chunkKeys: peek.header.chunks.map(c => c.key),
      onlyHistKey: peek.header.chunks.length === 1 && peek.header.chunks[0].key === hkey,
      bars: ch0.bars, first: ch0.first === DAY, last: ch0.last === DAY + 14 * MIN,
      // 导出后清单里不该再留 live 摘要
      profileHasLive: Object.prototype.hasOwnProperty.call(peek.header.profiles[0], 'live')
    });

    // 8) 导入回来：分片字节数 = 15 根（10 历史 + 5 新实时），且重叠区仍是历史值
    await db.deleteProfile(ID);
    await T.importData(file, () => {});
    const back = await db.getProfile(ID);
    const src2 = new Src(back);
    const f2 = await src2.frame1m(DAY + 14 * MIN, 20);
    const a2 = (m) => f2.find(b => b.timestamp === DAY + m * MIN);
    log('import', {
      bars: back.bars, chunks: back.chunks.length,
      frameBars: f2.length,
      overlapKeptHist: Math.abs((a2(7)?.close ?? 0) - 2007) < 1e-6,
      tailKept: Math.abs((a2(14)?.close ?? 0) - 3009) < 1e-6,
      liveStoreEmpty: (await db.listLiveKeys(ID)).length === 0
    });

    // 9) 删除 profile → live 分片一起清
    await LS.appendLiveBars(ID, [mkBar(DAY + 20 * MIN, 3100)]);
    const before = await db.listLiveKeys(ID);
    await db.deleteProfile(ID);
    log('cleanup', { before: before.length, after: (await db.listLiveKeys(ID)).length });

    R.pass = (
      R.checks.append.days === 1 && R.checks.append.bars === 10
      && R.checks.isolation.leaksIntoChunks === false && R.checks.isolation.chunkKeyCount === 1
      && R.checks.merge.last === true && R.checks.merge.ascending === true && R.checks.merge.noDup === true
      && R.checks.merge.overlapFromHist === true && R.checks.merge.liveTail === true
      && R.checks.aggregate.buckets >= 3 && R.checks.aggregate.ts.includes(10)
      && R.checks.nav.next.join(',') === '10,11,12' && R.checks.nav.prev === 11   // 12min 之前最近一根 = 11min（实时段）
      && R.checks.export.version === 2 && R.checks.export.mergedLiveDays === 1
      && R.checks.export.onlyHistKey === true && R.checks.export.bars === 15
      && R.checks.export.profileHasLive === false
      && R.checks.import.bars === 15 && R.checks.import.overlapKeptHist === true
      && R.checks.import.tailKept === true && R.checks.import.liveStoreEmpty === true
      && R.checks.cleanup.after === 0
    );
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    try { if (db) await db.deleteProfile(ID); } catch {}
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
