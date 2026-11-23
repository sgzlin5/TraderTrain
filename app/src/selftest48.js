// M48 验收：补缺失数据 —— 同日缺口可补 / 失败不卡死 / 扫描分级 / 加密走 Binance / 实时同根去重
// [vela] 全部用合成 CSV + 桩 fetch（只拦 /api/*），不联网、不碰真实档案；符号一律 ZZS48* 前缀。
//        覆盖 2026-11 补缺失数据修复的五个回归点，改 download.js / live.js 的补洞逻辑后必须重跑。
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const MIN = 60000, DAY = 86400000;
  const T0 = Date.UTC(2024, 2, 4);                 // 2024-03-04 周一 00:00 UTC
  const SYMS = ['ZZS48A', 'ZZS48USDT', 'ZZS48ONCE', 'ZZS48DAILY'];
  let realFetch = null;

  try {
    // 只等模块可导入即可：本用例全用合成数据，不需要图表/档案就绪（无档案时 __APP__.app 为空）
    for (let i = 0; i < 80 && !window.__APP__; i++) await wait(150);
    if (window.__APP_READY__) await Promise.race([window.__APP_READY__, wait(8000)]);

    const dl = await import('./download.js');
    const ing = await import('./ingest.js');
    const db = await import('./db.js');

    // 合成 CSV：startMs 起连续 days 天 1m，按 [from,to) 挖洞
    const mkCsv = (startMs, days, holes = [], p0 = 2000) => {
      const rows = ['datetime,open,high,low,close,volume'];
      for (let i = 0; i < days * 1440; i++) {
        const ts = startMs + i * MIN;
        if (holes.some(([a, b]) => ts >= a && ts < b)) continue;
        const iso = new Date(ts).toISOString();
        const p = (p0 + (i % 50) / 10).toFixed(1);
        rows.push(`${iso.slice(0, 10)} ${iso.slice(11, 19)},${p},${p},${p},${p},1`);
      }
      return rows.join('\n');
    };
    const sliceCsv = (csv, a, b) => csv.split('\n').filter((l) => {
      if (l.startsWith('datetime')) return true;
      const t = Date.parse(l.slice(0, 19).replace(' ', 'T') + 'Z');
      return t >= a && t < b;
    }).join('\n');
    const importCsv = (sym, csv, opt = {}) =>
      ing.importCsvSources([{ name: `${sym}_syn.csv`, getText: async () => csv }], { symbol: sym, ...opt });

    // 桩：/api/* 全部本地模拟（本地服务在跑也不会被真正打到）
    realFetch = window.fetch.bind(window);
    let csvText = '', jobFail = null, reqs = [];
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (u, o) => {
      const s = String(u), m = String(o?.method || 'GET').toUpperCase();
      if (!s.startsWith('/api/')) return realFetch(u, o);
      if (s.startsWith('/api/instruments')) return json({ ok: true });
      reqs.push(`${m} ${s}`);
      if (/\/csv$/.test(s)) return new Response(csvText, { status: 200, headers: { 'content-type': 'text/csv' } });
      if (s.startsWith('/api/job')) {
        if (m === 'DELETE') return json({ ok: true });
        if (s.startsWith('/api/job?')) return json({ id: 'job48', total: 1, source: /source=binance/.test(s) ? 'binance' : 'dukascopy' });
        return json(jobFail
          ? { state: 'error', error: jobFail, done: 0, total: 1, bars: 0 }
          : { state: 'done', done: 1, total: 1, bars: 30, skipped: 0 });
      }
      return json({ bars: [] });
    };

    /* ---- 1) 同日缺口：既要扫出来，也要真的补上（原 bug：fromDay >= toDay 被挡死） ---- */
    const A = 'ZZS48A', AH0 = T0 + 12 * 60 * MIN, AH1 = AH0 + 30 * MIN;
    await importCsv(A, mkCsv(T0, 2, [[AH0, AH1]]), { source: 'dukascopy', price: 'BID' });
    const sA0 = await dl.scanInteriorGaps(A);
    const gA = sA0.gaps[0];
    const beforeA = (await db.getProfile(`${A}-1m`)).bars;
    csvText = sliceCsv(mkCsv(AH0, 1, [], 2100), AH0, AH1);        // 只给洞里那 30 根
    reqs = [];
    const okA = await dl.fillGaps(A, sA0.gaps, () => {});
    const afterA = (await db.getProfile(`${A}-1m`)).bars;
    const sA1 = await dl.scanInteriorGaps(A);
    log('sameDayGap', {
      found: !!gA, sameDay: gA?.startDay === gA?.endDay, gapBars: gA?.bars,
      createReq: reqs.find((r) => r.startsWith('GET /api/job?') && r.includes(`from=${gA?.startDay}`)) || null,
      added: afterA - beforeA, remain: sA1.gaps.length, ok: okA
    });

    /* ---- 2) 失败不卡死：报错即返回、剩余段不发请求、失败后还能再起新任务 ---- */
    jobFail = 'selftest48 模拟上游失败'; csvText = '';
    reqs = [];
    const t2 = Date.now();
    const okB = await dl.fillGaps(A, [
      { startDay: '2024-03-10', endDay: '2024-03-11', bars: 1440 },
      { startDay: '2024-03-12', endDay: '2024-03-13', bars: 1440 }
    ], () => {});
    const failMs = Date.now() - t2;
    const creates = reqs.filter((r) => r.startsWith('GET /api/job?'));
    jobFail = null; csvText = mkCsv(T0 + 14 * DAY, 1, []); reqs = [];
    const okC = await dl.fillGaps(A, [{ startDay: '2024-03-18', endDay: '2024-03-19', bars: 1440 }], () => {});
    log('failRelease', {
      returned: okB === false, failMs,
      firstSeg: creates.filter((r) => r.includes('from=2024-03-10')).length,
      secondSeg: creates.filter((r) => r.includes('from=2024-03-12')).length,
      newJobAfterFail: okC === true && reqs.some((r) => r.startsWith('GET /api/job?'))
    });

    /* ---- 3) 扫描分级：加密周末 / 一次性 1h = 真缺口，每天同钟点 1h = 每日维护 ---- */
    const C = 'ZZS48USDT';                                        // 名字带 USDT → 判 7×24
    await importCsv(C, mkCsv(T0, 7, [[T0 + 4 * DAY + 20 * 60 * MIN, T0 + 6 * DAY + 20 * 60 * MIN]]), { source: 'binance' });
    const sC = await dl.scanInteriorGaps(C);
    const O = 'ZZS48ONCE';
    await importCsv(O, mkCsv(T0, 3, [[T0 + DAY + 12 * 60 * MIN, T0 + DAY + 13 * 60 * MIN]]));
    const sO = await dl.scanInteriorGaps(O);
    const D = 'ZZS48DAILY';
    await importCsv(D, mkCsv(T0, 5, [0, 1, 2, 3, 4].map((k) => [T0 + k * DAY + 13 * 60 * MIN, T0 + k * DAY + 14 * 60 * MIN])));
    const sD = await dl.scanInteriorGaps(D);
    log('classify', {
      cryptoWeekend: sC.gaps.filter((g) => g.kind === 'gap' && g.bars > 2000).length,
      cryptoSource: (await db.getProfile(`${C}-1m`)).source,
      onceOneHour: sO.gaps.filter((g) => g.kind === 'gap' && g.bars >= 55 && g.bars <= 65).length,
      dailyMaintHidden: sD.gaps.filter((g) => g.startHour === 13).length
    });

    /* ---- 4) 加密补洞走 Binance（原来硬编码 dukascopy → 空 CSV） ---- */
    reqs = []; jobFail = '到此为止'; csvText = '';
    await dl.fillGaps(C, sC.gaps.slice(0, 1), () => {});
    const cReq = reqs.find((r) => r.startsWith('GET /api/job?'));
    jobFail = null;
    log('cryptoSrc', { req: cReq || null, binance: !!cReq && /source=binance/.test(cReq) });

    /* ---- 5) 实时补洞：同一根收盘 bar 重复推送只喂一次（原 bug：重复入 buffer） ---- */
    const { LiveFeed } = await import('./live.js');
    let closedCalls = 0, closedBars = 0;
    const f = new LiveFeed({
      profile: { id: 'ZZS48LIVE-1m', symbol: 'ZZS48LIVE' },
      onClosed: (bs) => { closedCalls++; closedBars += bs.length; }
    });
    f.lastTs = T0;
    const bar = { timestamp: T0 + MIN, open: 2000, high: 2001, low: 1999, close: 2000, volume: 1, forming: false };
    for (let i = 0; i < 5; i++) await f._ingest([bar]);
    const buffered = f.buffer.length;
    await f._flush();
    log('liveDup', { buffered, closedCalls, closedBars, written: f.stats.written });

    const v = {
      sameDayGapFound: R.checks.sameDayGap.found === true && R.checks.sameDayGap.sameDay === true && R.checks.sameDayGap.gapBars === 30,
      sameDayGapFilled: R.checks.sameDayGap.added === 30 && R.checks.sameDayGap.remain === 0,
      sameDayJobSent: !!R.checks.sameDayGap.createReq,                      // from==to 必须真的发给服务端
      failReturns: R.checks.failRelease.returned === true && R.checks.failRelease.failMs < 15000,
      failAbortsRest: R.checks.failRelease.firstSeg === 1 && R.checks.failRelease.secondSeg === 0,
      failReleasesQueue: R.checks.failRelease.newJobAfterFail === true,     // jobId 释放后才能再发任务
      cryptoWeekendReported: R.checks.classify.cryptoWeekend === 1 && R.checks.classify.cryptoSource === 'binance',
      onceOneHourReported: R.checks.classify.onceOneHour === 1,
      dailyMaintHidden: R.checks.classify.dailyMaintHidden === 0,
      cryptoSrc: R.checks.cryptoSrc.binance === true,
      liveDup: R.checks.liveDup.buffered === 1 && R.checks.liveDup.closedBars === 1 && R.checks.liveDup.written === 1
    };
    log('verdict', v);
    R.pass = Object.values(v).every(Boolean);
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    try { if (realFetch) window.fetch = realFetch; } catch (e) { R.errors.push('restore fetch: ' + e.message); }
    try {
      const db = await import('./db.js');
      for (const s of SYMS) { try { await db.deleteProfile(`${s}-1m`); } catch {} }
      try { await db.deleteProfile('ZZS48LIVE-1m'); } catch {}
    } catch (e) { R.errors.push('cleanup: ' + e.message); }
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}