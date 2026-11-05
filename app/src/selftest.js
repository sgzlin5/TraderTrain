// M1 验收自检：import → 持久化 → 窗口读 → 聚合对齐 → 抽样对账 → 渲染
import { getProfiles, getChunk, storageEstimate, chunkKey, listChunkKeys, checkImportBudget } from './db.js';
import { importProfile, loadManifest } from './loader.js';
import { BarSource } from './source.js';
import { aggregate } from './aggregate.js';

const KNOWN = { ts: Date.UTC(2024, 3, 13, 4, 16), open: 2336.245, high: 2337.695, low: 2336.245, close: 2337.318 };

export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    // 0) 等 boot 完成
    for (let i = 0; i < 40 && !window.__APP__; i++) await wait(100);
    const manifest = state.manifest || await loadManifest();
    log('manifest', { profiles: manifest.profiles.length, bytes: manifest.profiles[0]?.bytes });

    // 1) 导入（无条件重导一次，覆盖“导入 → 持久化”路径）
    const prof = manifest.profiles[0];
    let t = performance.now();
    let imported;
    try {
      imported = await importProfile(prof, { verify: true });
      log('import', { ok: true, ms: Math.round(performance.now() - t), bars: imported.bars, mb: +(imported.importedBytes / 1048576).toFixed(1) });
    } catch (e) {
      log('import', { ok: false, err: e.message });
      throw e;
    }

    // 2) 持久化：重读 profiles + 直接取一片
    const profiles = await getProfiles();
    const chunkBytes = await (await getChunk(imported.chunks[0].key))?.byteLength;
    log('persistence', { profiles: profiles.length, chunkBytes, chunkOk: chunkBytes === prof.chunks[0].bytes });

    // 3) 窗口读取性能（1m / 5m）
    const src = new BarSource(imported);
    const timeIt = async (anchor, spanMs, page) => {
      const t1 = performance.now();
      const bars = await src.frame(anchor, spanMs, page);
      return { bars: bars.length, ms: +(performance.now() - t1).toFixed(2), first: bars[0]?.timestamp, last: bars.at(-1)?.timestamp };
    };
    const w1cold = await timeIt(prof.last, 60_000, 1200);        // 首次：要读年块
    const w1warm = await timeIt(prof.last, 60_000, 1200);        // 缓存命中
    const w5cold = await timeIt(prof.last, 300_000, 900);        // 首次：建 5m 年块聚合
    const w5warm = await timeIt(prof.last, 300_000, 900);
    const w1dcold = await timeIt(prof.last, 86_400_000, 300);
    const w1dwarm = await timeIt(prof.last, 86_400_000, 300);
    const w1 = await src.frame(prof.last, 60_000, 1200);   // 供后续断言用的实际数组（缓存命中）
    log('window', { m1_cold: w1cold, m1_warm: w1warm, m5_cold: w5cold, m5_warm: w5warm, d1_cold: w1dcold, d1_warm: w1dwarm });

    // 4) 聚合严格对齐：同区间 1m 根数 / 5 == 5m 根数（按分钟起点计）
    const from = w1[0]?.timestamp, to = w1.at(-1)?.timestamp;
    const m1raw = await src.frame1m(to, 60_000);
    const inRange = m1raw.filter(b => b.timestamp >= from && b.timestamp <= to);
    const agg5 = aggregate(inRange, 300_000);
    const expectBuckets = new Set(inRange.map(b => Math.floor(b.timestamp / 300_000) * 300_000)).size;
    const bucketCheck = (() => {
      if (!agg5.length) return { ok: false, reason: 'empty' };
      const k = agg5.at(-1);
      const members = inRange.filter(b => Math.floor(b.timestamp / 300_000) * 300_000 === k.timestamp);
      const ok = near(k.open, members[0].open) && near(k.close, members.at(-1).close)
        && near(k.high, Math.max(...members.map(m => m.high)))
        && near(k.low, Math.min(...members.map(m => m.low)))
        && k.volume === members.reduce((s, m) => s + m.volume, 0);
      return { ok, bucketTs: k.timestamp, members: members.length, ohlc: [k.open, k.high, k.low, k.close] };
    })();
    log('aggregate', {
      m1_in_range: inRange.length, expect_buckets: expectBuckets, actual_buckets: agg5.length,
      aligned: agg5.length === expectBuckets, bucket_ohlc_ok: bucketCheck.ok, last_bucket: bucketCheck
    });

    // 4b) 窗口必须严格升序且无重复（聚合跨年也不许乱序）
    const ascending = (arr) => arr.every((b, i) => i === 0 || b.timestamp > arr[i - 1].timestamp);
    log('ordering', {
      m1: ascending(w1), d1: ascending(await src.frame(prof.last, 86_400_000, 300)),
      m5: ascending(await src.frame(prof.last, 300_000, 900))
    });

    // 5) 抽样对账（源 CSV 已知一根）
    const year = new Date(KNOWN.ts).getUTCFullYear();
    const found = await (async () => {
      const dec = await src.decoder(String(year));
      const idx = dec.lowerBound(KNOWN.ts);
      const b = dec.at(idx);
      return b;
    })();
    const match = found && found.timestamp === KNOWN.ts
      && near(found.open, KNOWN.open, 1e-3) && near(found.high, KNOWN.high, 1e-3)
      && near(found.low, KNOWN.low, 1e-3) && near(found.close, KNOWN.close, 1e-3);
    log('reconcile', { ok: !!match, want: KNOWN, got: found });

    // 6) 渲染：canvas 数量 + 数据根数 + 无 VOL
    const app = state.app || window.__APP__?.app;
    let render = null;
    if (app) {
      const inds = app.chart.getIndicators().map(i => i.name);
      render = {
        canvas: document.querySelectorAll('#chart canvas').length,
        dataList: app.bars.allBars().length,
        indicators: inds,
        hasVolumePanel: inds.some(n => /VOL/i.test(n)),
        panes: app.chart.getPaneCount?.() ?? null
      };
    }
    log('render', render);

    // 7) 切周期回归（5m）
    if (app) {
      await app.switchPeriod('5m');
      await wait(300);
      const list = app.bars.allBars();
      log('switch_5m', { bars: list.length, first: list[0]?.timestamp, last: list.at(-1)?.timestamp,
        alignedTo5m: list.every(b => b.timestamp % 300_000 === 0) });
      await app.switchPeriod('1m');
    }

    // 8) 单次导入 1 GB 闸门
    const gate = checkImportBudget(2 * 1024 ** 3);
    log('budget_gate', { rejected: gate.ok === false, message: (gate.message || '').slice(0, 48) });

    // 9) 取消导入 → 只回滚本次，旧版本数据完好
    const before = (await getProfiles()).find(p => p.id === prof.id);
    const ac = new AbortController();
    let writes = 0, aborted = false, cancelErr = '';
    try {
      await importProfile(prof, {
        signal: ac.signal, verify: false,
        onProgress: (p) => { if (p.phase === 'write' && ++writes === 3) ac.abort(); }
      });
    } catch (e) { aborted = e.name === 'AbortError'; cancelErr = e.message; }
    const after = (await getProfiles()).find(p => p.id === prof.id);
    const oldBuf = await getChunk(before.chunks[0].key);
    log('cancel_rollback', {
      aborted, cancelErr: cancelErr.slice(0, 40),
      profileKeyUnchanged: after?.chunks?.[0]?.key === before.chunks[0].key,
      oldChunkBytes: oldBuf?.byteLength, oldChunkOk: oldBuf?.byteLength === before.chunks[0].bytes,
      keysNow: (await listChunkKeys(prof.id)).length
    });

    const est = await storageEstimate();
    log('storage', est);
    R.pass = Object.entries(R.checks).every(([k, v]) => {
      if (k === 'import') return v.ok;
      if (k === 'persistence') return v.chunkOk && v.profiles > 0;
      if (k === 'window') return v.m1_warm.ms < 50 && v.m5_warm.ms < 50 && v.d1_warm.ms < 50
        && v.m1_cold.ms < 400 && v.m5_cold.ms < 600 && v.d1_cold.ms < 900;
      if (k === 'aggregate') return v.aligned && v.bucket_ohlc_ok;
      if (k === 'reconcile') return v.ok;
      if (k === 'render') return v.canvas > 0 && v.dataList > 0 && !v.hasVolumePanel;
      if (k === 'switch_5m') return v.alignedTo5m && v.bars > 0;
      if (k === 'ordering') return v.m1 && v.d1 && v.m5;
      if (k === 'budget_gate') return v.rejected === true;
      if (k === 'cancel_rollback') return v.aborted && v.profileKeyUnchanged && v.oldChunkOk;
      return true;
    });
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
