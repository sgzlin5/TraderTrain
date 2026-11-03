// 把 CSV（单个文件或 zip 里的多个）吃成 28B/根 的年分片，写进 IndexedDB
// 两个入口：
//   importCsvSources  —— 整段导入（替换该品种档案）
//   appendCsvSources  —— 增量续传（只重写受影响的年份分片，其余年份沿用旧 key）
import { checkImportBudget, chunkKey, delChunk, putChunk, getProfile, saveProfile, getChunk } from './db.js';

export const RECORD_BYTES = 28;
export const PRICE_SCALE = 1000;

/** 自动长块的紧凑行缓冲：ts(Float64) + 4×价格(Int32) + 量(Float32)，约 28 B/行 */
class RowSink {
  constructor(cap = 1 << 16) {
    this.n = 0;
    this._alloc(cap);
  }
  _alloc(cap) {
    const ts = new Float64Array(cap);
    const px = new Int32Array(cap * 4);
    const vol = new Float32Array(cap);
    if (this.ts) { ts.set(this.ts.subarray(0, this.n)); px.set(this.px.subarray(0, this.n * 4)); vol.set(this.vol.subarray(0, this.n)); }
    this.ts = ts; this.px = px; this.vol = vol; this.cap = cap;
  }
  push(ts, o, h, l, c, v, scale) {
    if (this.n === this.cap) this._alloc(this.cap * 2);
    const i = this.n++;
    this.ts[i] = ts;
    this.px[i * 4] = Math.round(o * scale);
    this.px[i * 4 + 1] = Math.round(h * scale);
    this.px[i * 4 + 2] = Math.round(l * scale);
    this.px[i * 4 + 3] = Math.round(c * scale);
    this.vol[i] = v;
  }
}

/** 从文件名/压缩包名猜品种：XAUUSD_2024.csv → XAUUSD */
export function inferSymbol(names, fallback = 'DATA') {
  for (const raw of names) {
    const base = String(raw).split(/[\\/]/).pop().replace(/\.(zip|csv|txt|tsv)$/i, '');
    const m = base.match(/^([A-Za-z][A-Za-z0-9._-]{1,20}?)(?:[-_ .]?(?:19|20)\d{2}\b|[-_ .]?1m\b|$)/);
    if (m && m[1]) return m[1].toUpperCase().replace(/[^A-Z0-9._-]/g, '');
  }
  return fallback;
}

function ymdUTC(ts) { return new Date(ts).getUTCFullYear(); }

/**
 * 解析 + 按年分桶（内存里只有本轮新数据）
 * @returns {{sym,id,years:number[],bufs:Map<number,Uint8Array>,counts:Map<number,number>,
 *   yearFirst:Map<number,number>,yearLast:Map<number,number>,bars:number,bytes:number,
 *   first:number,last:number,dupes:number,skipped:number,zeroVol:number}}
 */
async function buildFromSources(sources, { symbol, onProgress = () => {}, signal, scale = PRICE_SCALE } = {}) {
  if (!sources.length) throw new Error('没有可导入的 CSV');
  const sink = new RowSink(1 << 18);
  const { parseCsv } = await import('./csvparse.js');

  let filesDone = 0, skipped = 0;
  for (const src of sources) {
    if (signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
    onProgress({ phase: 'parse', file: src.name, fileIndex: filesDone, fileCount: sources.length, rows: sink.n });
    const text = await src.getText();
    const r = parseCsv(text, { onRow: (b) => sink.push(b.ts, b.o, b.h, b.l, b.c, b.v, scale), signal });
    skipped += r.skipped;
    filesDone++;
    if (!r.rows) throw new Error(`${src.name} 里没解析出有效的 OHLC 行（表头需含 open/high/low/close）`);
  }
  const n = sink.n;
  if (!n) throw new Error('所有 CSV 都没有有效数据行');

  // 排序（多数源本来就有序，先验证一遍，避免白排）
  const idx = new Uint32Array(n);
  let sorted = true;
  for (let i = 0; i < n; i++) { idx[i] = i; if (i && sink.ts[i] < sink.ts[i - 1]) sorted = false; }
  if (!sorted) {
    onProgress({ phase: 'sort', rows: n });
    idx.sort((a, b) => sink.ts[a] - sink.ts[b]);
  }

  // 按年统计（去重：同 ts 只留最后一根）
  const counts = new Map();
  let prevTs = -Infinity, dupes = 0;
  const kept = [];
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    const ts = sink.ts[i];
    if (ts === prevTs) { dupes++; continue; }
    prevTs = ts;
    const y = ymdUTC(ts);
    counts.set(y, (counts.get(y) || 0) + 1);
    kept.push(i);
  }
  const bars = kept.length;

  // 周期校验：基础数据必须是 1 分钟，否则图表按 1m 聚合会全错
  let gap60 = 0, gapOther = 0, gapMin = Infinity;
  for (let k = 1; k < bars; k++) {
    const d = sink.ts[kept[k]] - sink.ts[kept[k - 1]];
    if (d === 60000) gap60++; else gapOther++;
    if (d > 0 && d < gapMin) gapMin = d;
  }
  if (bars > 2) {
    if (gapMin < 60000) throw new Error(`数据里有小于 1 分钟的间隔（最小 ${gapMin / 1000}s），像是 tick/秒级数据，无法作为 1m 基础周期导入`);
    const share = gap60 / Math.max(1, gap60 + gapOther);
    if (share < 0.5) throw new Error(`多数相邻间隔不是 60s（1m 占比 ${(share * 100).toFixed(0)}%），这不是 1 分钟数据；请先导出 1m 再导入`);
  }

  const years = [...counts.keys()].sort((a, b) => a - b);
  const bufs = new Map(), offs = new Map();
  for (const y of years) { bufs.set(y, new Uint8Array(counts.get(y) * RECORD_BYTES)); offs.set(y, 0); }

  const yearFirst = new Map(), yearLast = new Map();
  let first = Infinity, last = -Infinity, zeroVol = 0;
  for (let k = 0; k < bars; k++) {
    if ((k & 0x3ffff) === 0 && signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
    const i = kept[k];
    const ts = sink.ts[i];
    const y = ymdUTC(ts);
    const buf = bufs.get(y);
    const o = offs.get(y);
    const dv = new DataView(buf.buffer);
    dv.setBigInt64(o, BigInt(Math.trunc(ts)), true);
    dv.setInt32(o + 8, sink.px[i * 4], true);
    dv.setInt32(o + 12, sink.px[i * 4 + 1], true);
    dv.setInt32(o + 16, sink.px[i * 4 + 2], true);
    dv.setInt32(o + 20, sink.px[i * 4 + 3], true);
    dv.setFloat32(o + 24, sink.vol[i], true);
    offs.set(y, o + RECORD_BYTES);
    if (!yearFirst.has(y)) yearFirst.set(y, ts);
    yearLast.set(y, ts);
    if (ts < first) first = ts;
    if (ts > last) last = ts;
    if (sink.vol[i] === 0) zeroVol++;
  }

  const sym = (symbol || inferSymbol(sources.map(s => s.name))).toUpperCase();
  return {
    sym, id: `${sym}-1m`, years, bufs, counts, yearFirst, yearLast,
    bars, bytes: bars * RECORD_BYTES, first, last, dupes, skipped, zeroVol, scale
  };
}

/** 两个同年的有序分片按 ts 归并；同 ts 用新的一根（可能是被修正的边界 K 线） */
function mergeYearBuffers(oldBuf, newBuf) {
  const rec = RECORD_BYTES;
  // 兼容两种入参：ArrayBuffer（IndexedDB 取出）与 Uint8Array（本轮新数据）
  const oArr = oldBuf instanceof Uint8Array ? oldBuf : new Uint8Array(oldBuf);
  const nArr = newBuf instanceof Uint8Array ? newBuf : new Uint8Array(newBuf);
  const dvOld = new DataView(oArr.buffer, oArr.byteOffset, oArr.byteLength);
  const dvNew = new DataView(nArr.buffer, nArr.byteOffset, nArr.byteLength);
  const nOld = Math.floor(oArr.byteLength / rec);
  const nNew = Math.floor(nArr.byteLength / rec);
  const out = new Uint8Array((nOld + nNew) * rec);
  let i = 0, j = 0, o = 0;
  const copy = (arr, idx) => { out.set(arr.subarray(idx * rec, idx * rec + rec), o); o += rec; };
  while (i < nOld && j < nNew) {
    const a = Number(dvOld.getBigInt64(i * rec, true));
    const b = Number(dvNew.getBigInt64(j * rec, true));
    if (a < b) { copy(oArr, i); i++; }
    else if (b < a) { copy(nArr, j); j++; }
    else { copy(nArr, j); i++; j++; }
  }
  while (i < nOld) { copy(oArr, i); i++; }
  while (j < nNew) { copy(nArr, j); j++; }
  return o === out.byteLength ? out : out.subarray(0, o);
}

function chunkMeta(buf) {
  const rec = RECORD_BYTES;
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const n = Math.floor(arr.byteLength / rec);
  const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  return {
    bars: n,
    first: n ? Number(dv.getBigInt64(0, true)) : null,
    last: n ? Number(dv.getBigInt64((n - 1) * rec, true)) : null
  };
}

/** 整段导入（替换该品种的档案） */
export async function importCsvSources(sources, opt = {}) {
  const built = await buildFromSources(sources, opt);
  const gate = checkImportBudget(built.bytes);
  if (!gate.ok) throw new Error(gate.message);

  const { onProgress = () => {}, signal } = opt;
  const importId = Date.now().toString(36);
  const prev = await getProfile(built.id);
  const saved = {
    id: built.id, symbol: built.sym, period: { span: 1, type: 'minute' }, recordBytes: RECORD_BYTES,
    priceScale: built.scale, zeroVolume: built.zeroVol === built.bars,
    bars: built.bars, bytes: built.bytes, importedBytes: built.bytes,
    first: built.first, last: built.last, gaps: 0, dir: '(csv)', source: 'csv',
    skipped: built.skipped, dupeTimestamps: built.dupes,
    importedAt: new Date().toISOString(), importId, chunks: []
  };

  const written = [];
  try {
    for (let i = 0; i < built.years.length; i++) {
      if (signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
      const y = built.years[i];
      const buf = built.bufs.get(y);
      const key = chunkKey(built.id, y, importId);
      await putChunk(key, buf.buffer);
      written.push(key);
      saved.chunks.push({
        year: y, bytes: buf.byteLength, bars: built.counts.get(y), key,
        first: built.yearFirst.get(y), last: built.yearLast.get(y)
      });
      onProgress({ phase: 'write', file: `${y}`, fileIndex: i, fileCount: built.years.length, doneBytes: 0, totalBytes: built.bytes });
    }
    await saveProfile(saved);
    if (prev?.chunks?.length) {
      for (const c of prev.chunks) if (c.key && !written.includes(c.key)) { try { await delChunk(c.key); } catch {} }
    }
  } catch (err) {
    for (const k of written) { try { await delChunk(k); } catch {} }
    throw err;
  }
  return saved;
}

/**
 * 增量续传：只把新数据并进档案
 *  - 新的一年 → 直接写新分片
 *  - 已存在的年份 → 读出旧分片，与新的按 ts 归并，写新分片
 *  - 没被碰到年份 → 继续沿用旧 key（不重写，省 IO）
 */
export async function appendCsvSources(sources, opt = {}) {
  const { onProgress = () => {}, signal } = opt;
  const built = await buildFromSources(sources, opt);
  const prev = await getProfile(built.id);
  if (!prev) throw new Error(`没有 ${built.id} 的档案，先整段导入一次再续传`);
  const gate = checkImportBudget(built.bytes);          // 单次上限只算这次新增的字节
  if (!gate.ok) throw new Error(gate.message);

  const importId = Date.now().toString(36);
  const prevByYear = new Map(prev.chunks.map(c => [String(c.year), c]));
  const allYears = [...new Set([...prev.chunks.map(c => String(c.year)), ...built.years.map(String)])]
    .map(Number).sort((a, b) => a - b);

  const written = [];
  const chunks = [];
  let replacedKeys = [];
  try {
    for (let i = 0; i < allYears.length; i++) {
      const y = allYears[i];
      const newBuf = built.bufs.get(y);
      const oldChunk = prevByYear.get(String(y));
      if (!newBuf && oldChunk) {                 // 没动过：沿用旧分片
        chunks.push(oldChunk);
        continue;
      }
      let buf = newBuf;
      if (newBuf && oldChunk) {
        const oldBuf = await getChunk(oldChunk.key);
        if (oldBuf) { buf = mergeYearBuffers(oldBuf, newBuf); replacedKeys.push(oldChunk.key); }
      }
      if (signal?.aborted) throw new DOMException('用户取消续传', 'AbortError');
      const key = chunkKey(built.id, y, importId);
      await putChunk(key, buf.buffer);
      written.push(key);
      const meta = chunkMeta(buf);
      chunks.push({ year: y, bytes: buf.byteLength, bars: meta.bars, key, first: meta.first, last: meta.last });
      onProgress({ phase: 'write', file: `${y}`, fileIndex: i, fileCount: allYears.length, doneBytes: 0, totalBytes: built.bytes });
    }

    const bars = chunks.reduce((s, c) => s + (c.bars || 0), 0);
    const bytes = chunks.reduce((s, c) => s + (c.bytes || 0), 0);
    const first = Math.min(prev.first ?? Infinity, built.first);
    const last = Math.max(prev.last ?? -Infinity, built.last);
    const saved = {
      ...prev,
      bars, bytes, first, last,
      importedBytes: bytes,
      appendedAt: new Date().toISOString(),
      appendedBars: built.bars,
      importId, chunks
    };
    await saveProfile(saved);
    for (const k of replacedKeys) { try { await delChunk(k); } catch {} }
    return saved;
  } catch (err) {
    for (const k of written) { try { await delChunk(k); } catch {} }
    throw err;
  }
}
