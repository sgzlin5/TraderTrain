// 实时采集（方案 A′ 的写入端）
//   · 每 20 s 轮询本地服务 /api/live?symbol=…&limit=3（服务端代理 biquote，绕开 CORS）
//   · 正在走的那根（open=true）只喂给图表，不落库
//   · 已收盘的攒到内存，30 s 或 ≥20 根 flush 一次写 live store（一次事务）
//   · 启动时回补：把比库里 last 更新的已收盘 bar 补进来（biquote 至少给 5 小时）
import { appendLiveBars, getLiveMeta, liveLastTs } from './liveStore.js';

const MIN = 60_000;
// biquote 限流 15,000 次/分钟/IP，3 s 一轮（20 次/分钟）完全吃得下；实测单次 0.8–1.3 s
const POLL_MS = 1_000;
const POLL_MS_SAFE = 5_000;      // SSE 健康时的轮询兜底间隔
const FLUSH_MS = 5_000;
const FLUSH_BARS = 20;
const BACKFILL_LIMIT = 1000;      // biquote 的 1m 上限（约 5 小时）
const POLL_LIMIT = 15;            // 每轮多取 15 根：短暂断线能自愈
const GAP_MIN = 2;                // 落后超过 N 分钟就触发补洞
const GAP_FETCH_LIMIT = 120;

export class LiveFeed {
  /**
   * @param {object} o
   * @param {object} o.profile       当前 profile（需含 id/symbol）
   * @param {(bar:object)=>void} [o.onForming]  未收盘那根（画面上更新）
   * @param {(bars:object[])=>void} [o.onClosed] 已收盘写库成功后回调（通常用来推图/刷新）
   * @param {(s:object)=>void} [o.onStatus]     状态：{state,last,pending,err}
   */
  constructor({ profile, onForming, onClosed, onStatus }) {
    this.profile = profile;
    this.onForming = onForming || (() => {});
    this.onClosed = onClosed || (() => {});
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.timer = null;
    this.flushTimer = null;
    this.buffer = [];
    this.lastTs = null;
    this.pendingFlush = false;
    this.stats = { polls: 0, written: 0, errors: 0, lastErr: null, lastPollAt: 0 };
  }

  status(extra = {}) {
    const lagSec = this.lastTs ? Math.max(0, Math.round((Date.now() - this.lastTs - MIN) / 1000)) : null;
    return {
      state: this.running ? 'live' : 'idle',
      symbol: this.profile?.symbol,
      last: this.lastTs,
      lagSec,
      pending: this.buffer.length,
      ...this.stats,
      ...extra
    };
  }

  async start() {
    if (this.running) return this.status();
    this.running = true;
    this.onStatus(this.status());

    // 1) 回补：库里 last 与实际最新之间可能有缺口
    try {
      const back = await this._fetch(BACKFILL_LIMIT);
      const knownLast = (await liveLastTs(this.profile.id)) ?? this._histLast();
      const fresh = back.filter(b => !b.forming && (knownLast == null || b.timestamp > knownLast));  // 注意：字段是 forming，不是 open（open 是开盘价）
      if (fresh.length) {
        this.buffer.push(...fresh);
        const w = await this._flush();          // 走同一条写入路径（批量、单事务）
        if (w) this.onStatus(this.status({ backfilled: fresh.length }));
      }
    } catch (e) {
      this.stats.backfillErr = String((e && e.message) || e);
      this.stats.lastErr = this.stats.backfillErr;
      console.error('[live] 回补失败', e);
      this.onStatus(this.status({ err: this.stats.lastErr }));
    }

    // 2) 轮询
    const tick = async () => {
      if (!this.running) return;
      const t0 = Date.now();
      await this._poll();
      // 固定节拍：扣掉本次请求耗时，否则真实周期 = POLL_MS + 请求耗时（实测 1 s 变成 ~1.9 s）
      // SSE 健康时轮询降频到 5 s 兜底；否则保持 1 s
      const streamOk = this.es && Date.now() - (this.stats.lastStreamAt || 0) < 5000;
      const target = streamOk ? POLL_MS_SAFE : POLL_MS;
      const wait = Math.max(150, target - (Date.now() - t0));
      if (this.running) this.timer = setTimeout(tick, wait);
    };
    this._openStream();
    this.timer = setTimeout(tick, 300);
    this.flushTimer = setInterval(() => { this._flush().catch(() => {}); }, FLUSH_MS);
    return this.status();
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.flushTimer);
    this._closeStream();
    this.timer = null; this.flushTimer = null;
    try { await this._flush(); } catch {}
    this.onStatus(this.status());
    return this.status();
  }

  _histLast() {
    const p = this.profile;
    return p?.last ?? null;
  }

  async _fetch(limit) {
    const url = `/api/live?symbol=${encodeURIComponent(this.profile.symbol)}&limit=${limit}`;
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `实时接口 ${r.status}`);
    return (j.bars || []).map(b => ({
      timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, forming: !!b.open
    }));
  }

  /** SSE 推来的 bar 与轮询走同一条入库/绘制路径 */
  _ingest(bars) {
    const forming = bars.filter(b => b.forming);
    const closed = bars.filter(b => !b.forming);
    if (forming.length && this.onForming) this.onForming(forming[forming.length - 1]);
    if (!closed.length) return;
    const run = async () => {
      let known = this.lastTs ?? (await liveLastTs(this.profile.id)) ?? this._histLast();
      const newest = closed[closed.length - 1].timestamp;
      let all = bars;
      if (known != null && newest - known > GAP_MIN * MIN) {
        try {
          all = await this._fetch(GAP_FETCH_LIMIT);
          this.stats.healed = (this.stats.healed || 0) + 1;
        } catch (e) { /* 补洞失败不影响本轮 */ }
      }
      const fresh = all.filter(b => !b.forming).filter(b => known == null || b.timestamp > known);
      if (fresh.length) {
        this.buffer.push(...fresh);
        this.pendingFlush = this.buffer.length >= FLUSH_BARS;
        this.onStatus(this.status());
        if (this.pendingFlush) await this._flush();
      }
    };
    return run().catch((e) => { this.stats.lastErr = String(e.message || e); this.onStatus(this.status({ err: this.stats.lastErr })); });
  }

  /** SSE 快路径：服务端单例订阅 biquote，1 s 推一次；失败自动退回轮询 */
  _openStream() {
    if (typeof EventSource === 'undefined' || !this.profile) return;
    try { this._closeStream(); } catch {}
    try {
      const es = new EventSource(`/api/live/stream?symbol=${encodeURIComponent(this.profile.symbol)}`);
      this.es = es;
      es.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          const bars = (j.bars || []).map(b => ({
            timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, forming: !!b.open
          }));
          if (!bars.length) return;
          this.stats.streamTicks = (this.stats.streamTicks || 0) + 1;
          this.stats.lastStreamAt = Date.now();
          this._ingest(bars);
        } catch (e) { /* 单条坏包忽略 */ }
      };
      es.onerror = () => {
        this.stats.streamErr = (this.stats.streamErr || 0) + 1;
        // 连续失败就把 ES 关掉，回到轮询；下一轮 poll 成功后会重试打开
        if (this.stats.streamErr >= 3) { try { es.close(); } catch {} this.es = null; }
      };
    } catch (e) { this.es = null; }
  }

  _closeStream() {
    try { this.es?.close(); } catch {}
    this.es = null;
  }

  async _poll() {
    this.stats.polls++;
    this.stats.lastPollAt = Date.now();
    try {
      let bars = await this._fetch(POLL_LIMIT);
      await this._ingest(bars);
      // 流断了就顺手重开（服务端重启 / 网络切换后能自愈）
      if (!this.es && (this.stats.streamErr || 0) < 100) this._openStream();
      this.onStatus(this.status({ ok: true }));
    } catch (e) {
      this.stats.errors++;
      this.stats.lastErr = String(e.message || e);
      this.onStatus(this.status({ err: this.stats.lastErr }));
    }
  }

  async _flush() {
    if (!this.buffer.length) return null;
    const bars = this.buffer.splice(0, this.buffer.length);
    try {
      const w = await appendLiveBars(this.profile.id, bars, { source: 'biquote', volumeKind: 'tickCount' });
      this.lastTs = w.last;
      this.stats.written += bars.length;
      this.stats.lastErr = null;
      this.onClosed(bars);
      this.onStatus(this.status());
      return w;
    } catch (e) {
      this.buffer.unshift(...bars);          // 写失败放回去，下轮再试
      this.stats.lastErr = String(e.message || e);
      if (this.buffer.length > 500) this.buffer = this.buffer.slice(-500);
      this.onStatus(this.status({ err: this.stats.lastErr }));
      return null;
    }
  }
}

/** 便捷：给某个 profile 起一个 feed，返回控制器 */
export function startLive(profile, handlers = {}) {
  const feed = new LiveFeed({ profile, ...handlers });
  feed.start();
  return feed;
}

export const LIVE_CONFIG = { POLL_MS, FLUSH_MS, FLUSH_BARS, BACKFILL_LIMIT, POLL_LIMIT, GAP_MIN, GAP_FETCH_LIMIT, MIN };
