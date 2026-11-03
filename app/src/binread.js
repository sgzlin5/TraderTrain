// 28 字节记录解码：int64 ts + int32×4 定点价 + float32 volume（小端）
export const RECORD_BYTES = 28;
export const PRICE_SCALE = 1000;

export function createDecoder(buf, priceScale = PRICE_SCALE) {
  const dv = new DataView(buf);
  const total = Math.floor(buf.byteLength / RECORD_BYTES);
  return {
    total,
    at(i) {
      const o = i * RECORD_BYTES;
      return {
        timestamp: Number(dv.getBigInt64(o, true)),
        open: dv.getInt32(o + 8, true) / priceScale,
        high: dv.getInt32(o + 12, true) / priceScale,
        low: dv.getInt32(o + 16, true) / priceScale,
        close: dv.getInt32(o + 20, true) / priceScale,
        volume: dv.getFloat32(o + 24, true)
      };
    },
    // 第一个 >= ts 的下标（chunk 内单调递增）
    lowerBound(ts) {
      let lo = 0, hi = total - 1, ans = total;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (Number(dv.getBigInt64(mid * RECORD_BYTES, true)) >= ts) { ans = mid; hi = mid - 1; }
        else lo = mid + 1;
      }
      return ans;
    },
    slice(start, count) {
      const out = [];
      const end = Math.min(start + count, total);
      for (let i = Math.max(0, start); i < end; i++) out.push(this.at(i));
      return out;
    }
  };
}
