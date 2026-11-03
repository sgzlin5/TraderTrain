// 1m → 多周期聚合（UTC 桶对齐；缺口不补空桶）
import { RECORD_BYTES } from './binread.js';

export const PERIODS = [
  { key: '1m', label: '1m', spanMs: 60_000, page: 1200 },
  { key: '5m', label: '5m', spanMs: 300_000, page: 900 },
  { key: '15m', label: '15m', spanMs: 900_000, page: 700 },
  { key: '30m', label: '30m', spanMs: 1_800_000, page: 600 },
  { key: '1h', label: '1H', spanMs: 3_600_000, page: 500 },
  { key: '4h', label: '4H', spanMs: 14_400_000, page: 360 },
  { key: '1d', label: '1D', spanMs: 86_400_000, page: 300 }
];

/** 把升序 1m 数组按 spanMs 分桶聚合；不补空桶 */
export function aggregate(m1, spanMs) {
  const out = [];
  let cur = null;
  for (let i = 0; i < m1.length; i++) {
    const b = m1[i];
    const bucket = Math.floor(b.timestamp / spanMs) * spanMs;
    if (!cur || cur.timestamp !== bucket) {
      if (cur) out.push(cur);
      cur = { timestamp: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function periodSpanMs(key) {
  const p = PERIODS.find(x => x.key === key);
  return p ? p.spanMs : 60_000;
}

/** 直接从 ArrayBuffer 聚合（不建中间 1m 对象，比 aggregate 快数倍） */
export function aggregateBuffer(buf, spanMs, scale = 1000) {
  const dv = new DataView(buf);
  const n = Math.floor(buf.byteLength / RECORD_BYTES);
  const out = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const o = i * RECORD_BYTES;
    const ts = Math.floor(Number(dv.getBigInt64(o, true)) / spanMs) * spanMs;
    const op = dv.getInt32(o + 8, true) / scale;
    const hi = dv.getInt32(o + 12, true) / scale;
    const lo = dv.getInt32(o + 16, true) / scale;
    const cl = dv.getInt32(o + 20, true) / scale;
    const vol = dv.getFloat32(o + 24, true);
    if (cur === null || cur.timestamp !== ts) {
      if (cur) out.push(cur);
      cur = { timestamp: ts, open: op, high: hi, low: lo, close: cl, volume: vol };
    } else {
      if (hi > cur.high) cur.high = hi;
      if (lo < cur.low) cur.low = lo;
      cur.close = cl;
      cur.volume += vol;
    }
  }
  if (cur) out.push(cur);
  return out;
}
