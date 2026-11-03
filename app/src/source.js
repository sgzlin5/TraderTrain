// 从 IndexedDB 的年分片里按需读窗口（年块常驻缓存，窗口解码）
import { getChunk } from './db.js';
import { createDecoder } from './binread.js';
import { aggregate, aggregateBuffer } from './aggregate.js';

export class BarSource {
  constructor(profile) {
    this.profile = profile;
    this.chunks = [...profile.chunks].sort((a, b) => a.year - b.year);
    this.scale = profile.priceScale || 1000;
    this.bufCache = new Map();       // year -> ArrayBuffer
    this.decCache = new Map();       // year -> decoder
    this.aggCache = new Map();       // year -> Map(spanMs -> 聚合数组)
    this.order = [];
    this.lastReadMs = 0;
  }

  _touch(year) {
    this.order = this.order.filter(y => y !== year);
    this.order.push(year);
    while (this.order.length > 3) {
      const ev = this.order.shift();
      this.bufCache.delete(ev);
      this.decCache.delete(ev);
      this.aggCache.delete(ev);
    }
  }

  async bufFor(year) {
    if (this.bufCache.has(year)) { this._touch(year); return this.bufCache.get(year); }
    const ch = this.chunks.find(c => String(c.year) === String(year));
    if (!ch) throw new Error(`缺少 ${year} 年分片`);
    const buf = await getChunk(ch.key);
    if (!buf) throw new Error(`${year} 年分片未找到（可能被删除），请重新导入`);
    this.bufCache.set(year, buf);
    this._touch(year);
    return buf;
  }

  async decoder(year) {
    if (this.decCache.has(year)) { this._touch(year); return this.decCache.get(year); }
    const dec = createDecoder(await this.bufFor(year), this.scale);
    this.decCache.set(year, dec);
    return dec;
  }

  chunkIndexFor(ts) {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (c.first == null) continue;
      if (ts >= c.first) return i;
    }
    return 0;
  }

  /** 取以 anchorTs（含）结尾、向回最多 count 根的升序 1m 数组 */
  async frame1m(anchorTs, count) {
    const t0 = performance.now();
    const segs = [];              // 按时间倒序收集，最后拼接（避免大数组 spread 爆栈）
    let got = 0;
    let ci = this.chunkIndexFor(anchorTs);
    let guard = 0;
    while (ci >= 0 && got < count && guard++ < 64) {
      const year = this.chunks[ci].year;
      const dec = await this.decoder(year);
      let idx = dec.lowerBound(anchorTs + 1);
      const parts = [];
      while (idx > 0 && got < count) {
        const take = Math.min(idx, count - got);
        parts.unshift(dec.slice(idx - take, take));
        got += take;
        idx -= take;
      }
      for (const pt of parts) segs.unshift(pt);
      ci--;
    }
    let out = [];
    for (const s of segs) out = out.concat(s);
    this.lastReadMs = performance.now() - t0;
    return out;
  }

  /** 取以 anchorTs 结尾的聚合窗口（升序）；聚合按年块缓存，切周期后是二分+切片 */
  async frame(anchorTs, spanMs, page) {
    if (spanMs === 60_000) return this.frame1m(anchorTs, page);
    const t0 = performance.now();
    const segs = [];
    let count = 0;
    let ci = this.chunkIndexFor(anchorTs);
    let guard = 0;
    while (ci >= 0 && count < page && guard++ < 32) {
      const agg = await this.aggFor(this.chunks[ci].year, spanMs);
      // 二分：最后一个 timestamp <= anchorTs 的位置
      let lo = 0, hi = agg.length - 1, idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (agg[mid].timestamp <= anchorTs) { idx = mid + 1; lo = mid + 1; } else hi = mid - 1;
      }
      const take = Math.min(idx, page - count);
      if (take > 0) { segs.unshift(agg.slice(idx - take, idx)); count += take; }
      ci--;
    }
    let out = [];
    for (const s of segs) out = out.concat(s);   // 段间按年升序，段内本身升序
    this.lastReadMs = performance.now() - t0;
    return out;
  }

  /** 年块聚合缓存：直接从 ArrayBuffer 聚合，不建中间 1m 对象 */
  async aggFor(year, spanMs) {
    let m = this.aggCache.get(year);
    if (!m) { m = new Map(); this.aggCache.set(year, m); }
    if (m.has(spanMs)) return m.get(spanMs);
    const buf = await this.bufFor(year);
    const agg = aggregateBuffer(buf, spanMs, this.scale);
    m.set(spanMs, agg);
    while (this.aggCache.size > 4) this.aggCache.delete(this.aggCache.keys().next().value);
    return agg;
  }

  /** 时间戳之后（不含）的下一批 1m 根，升序 */
  async nextBars(ts, count = 1) {
    const out = [];
    let ci = this.chunkIndexFor(ts);
    let guard = 0;
    while (ci < this.chunks.length && out.length < count && guard++ < 64) {
      const dec = await this.decoder(this.chunks[ci].year);
      let idx = dec.lowerBound(ts + 1);           // 第一个 > ts
      while (idx < dec.total && out.length < count) {
        out.push(dec.at(idx));
        idx++;
      }
      ci++;
    }
    return out;
  }

  /** ts 之前（不含）的最后一根 1m */
  async prevBar(ts) {
    let ci = this.chunkIndexFor(ts);
    let guard = 0;
    while (ci >= 0 && guard++ < 64) {
      const dec = await this.decoder(this.chunks[ci].year);
      let idx = dec.lowerBound(ts) - 1;           // 第一个 >= ts 的位置 -1
      if (idx >= 0) return dec.at(idx);
      ci--;
    }
    return null;
  }
}
