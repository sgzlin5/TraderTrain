// 实时采集（方案 A′ 的写入端）
//   · 每 20 s 轮询本地服务 /api/live?symbol=…&limit=3（服务端代理 biquote，绕开 CORS）
//   · 正在走的那根（open=true）只喂给图表，不落库
//   · 已收盘的攒到内存，30 s 或 ≥20 根 flush 一次写 live store（一次事务）
//   · 启动时回补：把比库里 last 更新的已收盘 bar 补进来（biquote 至少给 5 小时）
import { appendLiveBars, getLiveMeta, liveLastTs } from './liveStore.js';

const MIN = 60_000;
const POLL_MS = 20_000;
const FLUSH_MS = 30_000;
const FLUSH_BARS = 20;
const BACKFILL_LIMIT = 300;

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
    return {
      state: this.running ? 'live' : 'idle',
      symbol: this.profile?.symbol,
      last: this.lastTs,
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
      await this._poll();
      if (this.running) this.timer = setTimeout(tick, POLL_MS);
    };
    this.timer = setTimeout(tick, 300);
    this.flushTimer = setInterval(() => { this._flush().catch(() => {}); }, FLUSH_MS);
    return this.status();
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.flushTimer);
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

  async _poll() {
    this.stats.polls++;
    this.stats.lastPollAt = Date.now();
    try {
      const bars = await this._fetch(3);
      const forming = bars.filter(b => b.forming);
      const closed = bars.filter(b => !b.forming);
      if (forming.length) this.onForming(forming[forming.length - 1]);
      if (closed.length) {
        const known = this.lastTs ?? (await liveLastTs(this.profile.id)) ?? this._histLast();
        const fresh = closed.filter(b => known == null || b.timestamp > known);
        if (fresh.length) {
          this.buffer.push(...fresh);
          this.pendingFlush = this.buffer.length >= FLUSH_BARS;
          this.onStatus(this.status());
          if (this.pendingFlush) await this._flush();
        }
      }
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

export const LIVE_CONFIG = { POLL_MS, FLUSH_MS, FLUSH_BARS, BACKFILL_LIMIT, MIN };
