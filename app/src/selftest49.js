// M49 验收：实时采集不卡死 —— 轮询不叠请求 / SSE 不并发补洞 / 单请求有超时 / SSE 先于回补打开
// [vela] 全部用桩 fetch 与桩 EventSource，不联网、不碰真实档案；符号一律 ZZS49* 前缀。
//        改 live.js 的取数并发/超时/启动顺序后必须重跑。
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const MIN = 60000, DAY = 86400000;
  const T0 = Date.UTC(2024, 2, 4);                        // 历史末尾（造"落后 149 天"）
  const LIVE_TAIL = T0 + 149 * DAY;                       // 实时最新一根
  const SYMS = ['ZZS49LIVE-1m', 'ZZS49POLL-1m', 'ZZS49GAP-1m', 'ZZS49START-1m'];
  let realFetch = null, realES = null;

  const mkBars = (firstTs, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = firstTs + i * MIN;
      out.push({ t, o: 2000, h: 2001, l: 1999, c: 2000, v: 5, open: false });
    }
    return out;
  };

  try {
    for (let i = 0; i < 80 && !window.__APP__; i++) await wait(150);

    const { LiveFeed } = await import('./live.js');
    realFetch = window.fetch.bind(window);
    realES = window.EventSource;
    window.EventSource = class { constructor() {} close() {} addEventListener() {} };   // 1)–3) 不真开 SSE
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    let reqs = 0, delay = 0, bars = [];

    window.fetch = async (u, o) => {
      const s = String(u);
      if (!s.startsWith('/api/')) return realFetch(u, o);
      reqs++;
      if (delay) await wait(delay);
      return json({ symbol: 'ZZS49', source: 'biquote', at: Date.now(), bars });
    };

    /* ---- 1) 轮询不叠请求：上一轮还没回来时再 tick 不能再发一次 ---- */
    const f1 = new LiveFeed({ profile: { id: 'ZZS49POLL-1m', symbol: 'ZZS49POLL' } });
    f1.lastTs = LIVE_TAIL;                                 // 贴着实时，避免触发补洞
    bars = mkBars(LIVE_TAIL - 3 * MIN, 3);
    delay = 400; reqs = 0;
    await Promise.all([f1._poll(), f1._poll(), f1._poll()]);
    log('pollNoOverlap', { reqs });

    /* ---- 2) SSE 连发 5 条只跑一条补洞链（原来 1 s 一条各发一次 → 请求风暴） ---- */
    const f2 = new LiveFeed({ profile: { id: 'ZZS49GAP-1m', symbol: 'ZZS49GAP' } });
    f2.lastTs = T0;                                        // 落后 149 天
    bars = mkBars(LIVE_TAIL - 200 * MIN, 200);
    const tailTs = bars[bars.length - 1].t;                // 最后那根 = 200 根窗口的尾巴
    delay = 300; reqs = 0;
    const msg = bars.map(b => ({ timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, forming: false }));
    await Promise.all([f2._ingest(msg), f2._ingest(msg), f2._ingest(msg), f2._ingest(msg), f2._ingest(msg)]);
    log('ingestSingleFlight', { reqs, lastTs: f2.lastTs, expectTail: tailTs, written: f2.stats.written });

    /* ---- 3) 单请求超时：上游不回就 8 s 内失败，别把轮询链吊死 ---- */
    window.fetch = (u, o) => new Promise((_res, rej) => {
      o?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const f3 = new LiveFeed({ profile: { id: 'ZZS49POLL-1m', symbol: 'ZZS49POLL' } });
    const t3 = Date.now();
    let err3 = null;
    try { await f3._fetch(5); } catch (e) { err3 = String(e.name || e.message || e); }
    log('fetchTimeout', { ms: Date.now() - t3, err: err3 });

    /* ---- 4) 启动顺序：先开 SSE，再等回补（回补慢不能把快路径堵在前面） ---- */
    let esAt = 0, backfillAt = 0;
    window.EventSource = class { constructor(u) { esAt = Date.now(); this.url = u; } close() {} addEventListener() {} };
    window.fetch = async (u, o) => {
      const s = String(u);
      if (!s.startsWith('/api/')) return realFetch(u, o);
      await wait(1200);
      backfillAt = Date.now();
      return json({ symbol: 'ZZS49START', source: 'biquote', at: Date.now(), bars: [] });
    };
    const f4 = new LiveFeed({ profile: { id: 'ZZS49START-1m', symbol: 'ZZS49START' } });
    const t4 = Date.now();
    await f4.start();
    log('streamFirst', { esMs: esAt ? esAt - t4 : null, backfillMs: backfillAt ? backfillAt - t4 : null });
    await f4.stop();

    const v = {
      pollNoOverlap: R.checks.pollNoOverlap.reqs === 1,
      ingestSingleFlight: R.checks.ingestSingleFlight.reqs === 1,
      gapHealedToTail: R.checks.ingestSingleFlight.lastTs === R.checks.ingestSingleFlight.expectTail,
      noDupWrite: R.checks.ingestSingleFlight.written === 200,
      fetchTimeout: R.checks.fetchTimeout.ms >= 7500 && R.checks.fetchTimeout.ms < 12000 && R.checks.fetchTimeout.err === 'AbortError',
      streamBeforeBackfill: R.checks.streamFirst.esMs != null && R.checks.streamFirst.backfillMs != null
        && R.checks.streamFirst.esMs < R.checks.streamFirst.backfillMs
    };
    log('verdict', v);
    R.pass = Object.values(v).every(Boolean);
  } catch (err) {
    R.errors.push(String((err && err.stack) || err));
    R.pass = false;
  } finally {
    try { if (realFetch) window.fetch = realFetch; } catch (e) { R.errors.push('restore fetch: ' + e.message); }
    try { if (realES) window.EventSource = realES; } catch (e) { R.errors.push('restore ES: ' + e.message); }
    try {
      const db = await import('./db.js');
      for (const id of SYMS) { try { await db.deleteProfile(id); } catch {} }
    } catch (e) { R.errors.push('cleanup: ' + e.message); }
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}