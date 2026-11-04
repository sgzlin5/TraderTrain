// 实时数据落库（方案 A′）
//   · 独立 objectStore 'live'：key = `<profileId>|<YYYYMMDD>`，一天一个连续 28 B/根的分片
//   · 摘要存 kv `live:<profileId>` = { days:[{date,bars,first,last,source}], last, volumeKind }
//   · 同时把摘要挂到 profiles[].live，读路径（source.js）据此并入实时段
//   · 与 Dukascopy 历史分片（chunks）完全隔离：不改 importId 命名空间，导出时再合并
import {
  getLive, putLive, delLive, listLiveKeys, liveKey,
  getProfiles, saveProfile, kvGet, kvSet
} from './db.js';
import { RECORD_BYTES, PRICE_SCALE } from './binread.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** UTC 日期串 YYYYMMDD */
export function dayOf(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
/** 某日 00:00 UTC 的毫秒 */
export function dayStart(dateStr) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
  return Date.UTC(y, m - 1, d);
}

/** 1m bars → 28 B/根（按 ts 升序、同 ts 后者胜） */
export function encodeBars(bars, scale = PRICE_SCALE) {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const uniq = [];
  for (const b of sorted) {
    if (uniq.length && uniq[uniq.length - 1].timestamp === b.timestamp) uniq[uniq.length - 1] = b;
    else uniq.push(b);
  }
  const buf = new ArrayBuffer(uniq.length * RECORD_BYTES);
  const dv = new DataView(buf);
  uniq.forEach((b, i) => {
    const o = i * RECORD_BYTES;
    dv.setBigInt64(o, BigInt(Math.trunc(b.timestamp)), true);
    dv.setInt32(o + 8, Math.round(b.open * scale), true);
    dv.setInt32(o + 12, Math.round(b.high * scale), true);
    dv.setInt32(o + 16, Math.round(b.low * scale), true);
    dv.setInt32(o + 20, Math.round(b.close * scale), true);
    dv.setFloat32(o + 24, Number(b.volume) || 0, true);
  });
  return buf;
}

/** 28 B/根 → bars[] */
export function decodeBars(buf, scale = PRICE_SCALE) {
  if (!buf) return [];
  const dv = new DataView(buf);
  const total = Math.floor(buf.byteLength / RECORD_BYTES);
  const out = new Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * RECORD_BYTES;
    out[i] = {
      timestamp: Number(dv.getBigInt64(o, true)),
      open: dv.getInt32(o + 8, true) / scale,
      high: dv.getInt32(o + 12, true) / scale,
      low: dv.getInt32(o + 16, true) / scale,
      close: dv.getInt32(o + 20, true) / scale,
      volume: dv.getFloat32(o + 24, true)
    };
  }
  return out;
}

/* ------------------------------------------------ 摘要 */

const metaKey = (profileId) => `live:${profileId}`;

export async function getLiveMeta(profileId) {
  try { return (await kvGet(metaKey(profileId))) || { days: [], last: null, volumeKind: 'tickCount' }; }
  catch { return { days: [], last: null, volumeKind: 'tickCount' }; }
}

async function setLiveMeta(profileId, meta) {
  await kvSet(metaKey(profileId), meta);
  // 挂到 profile 上：读路径（source.js）与状态栏都看这一个字段
  const all = await getProfiles();
  const p = all.find(x => x.id === profileId);
  if (p) { p.live = { days: meta.days, last: meta.last, volumeKind: meta.volumeKind }; await saveProfile(p); }
  return meta;
}

/* ------------------------------------------------ 写入 */

/**
 * 追加已收盘的 1m bars（按 UTC 日分组，读-改-写当天分片）
 * @returns {{ days:number, bars:number, last:number|null }}
 */
export async function appendLiveBars(profileId, bars, opts = {}) {
  if (!bars?.length) return { days: 0, bars: 0, last: null };
  const scale = opts.scale || PRICE_SCALE;
  const source = opts.source || 'biquote';
  const byDay = new Map();
  for (const b of bars) {
    if (b?.timestamp == null) continue;
    const d = dayOf(b.timestamp);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(b);
  }

  const meta = await getLiveMeta(profileId);
  const dayMap = new Map((meta.days || []).map(d => [d.date, d]));
  let written = 0;

  for (const [date, list] of byDay) {
    const key = liveKey(profileId, date);
    const old = decodeBars(await getLive(key), scale);
    const merged = new Map(old.map(b => [b.timestamp, b]));
    for (const b of list) merged.set(b.timestamp, b);       // 实时重写：新值胜
    const arr = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
    if (!arr.length) continue;
    await putLive(key, encodeBars(arr, scale));
    dayMap.set(date, {
      date, bars: arr.length, source,
      first: arr[0].timestamp, last: arr[arr.length - 1].timestamp
    });
    written += list.length;
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const last = days.length ? Math.max(...days.map(d => d.last)) : null;
  await setLiveMeta(profileId, { days, last, volumeKind: opts.volumeKind || meta.volumeKind || 'tickCount' });
  return { days: byDay.size, bars: written, last };
}

/* ------------------------------------------------ 读取 */

/** profile 的实时天摘要（升序） */
export async function liveDays(profileId) {
  const meta = await getLiveMeta(profileId);
  return meta.days || [];
}

/** 取 [from, to]（含端点）内的实时 1m bars，升序 */
export async function readLiveRange(profileId, from, to, scale = PRICE_SCALE) {
  if (from == null || to == null || to < from) return [];
  const days = await liveDays(profileId);
  const hit = days.filter(d => d.last >= from && d.first <= to);
  if (!hit.length) return [];
  const out = [];
  for (const d of hit) {
    const bars = decodeBars(await getLive(liveKey(profileId, d.date)), scale);
    for (const b of bars) if (b.timestamp >= from && b.timestamp <= to) out.push(b);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/** 尾部 N 根实时 bars（升序），用于启动回补/连续性判断 */
export async function readLiveTail(profileId, count = 200, scale = PRICE_SCALE) {
  const days = (await liveDays(profileId)).slice().reverse();
  const out = [];
  for (const d of days) {
    const bars = decodeBars(await getLive(liveKey(profileId, d.date)), scale);
    out.unshift(...bars);
    if (out.length >= count) break;
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out.slice(-count);
}

/** 最近一根实时 bar 的时间戳（没有就 null） */
export async function liveLastTs(profileId) {
  const meta = await getLiveMeta(profileId);
  return meta.last ?? null;
}

/* ------------------------------------------------ 清理 */

export async function dropLiveDay(profileId, date) {
  await delLive(liveKey(profileId, date));
  const meta = await getLiveMeta(profileId);
  meta.days = (meta.days || []).filter(d => d.date !== date);
  meta.last = meta.days.length ? Math.max(...meta.days.map(d => d.last)) : null;
  await setLiveMeta(profileId, meta);
  return meta;
}

/** 删掉 fromTs 之前（含）的实时天（Dukascopy 补过之后调用） */
export async function dropLiveBefore(profileId, ts) {
  const meta = await getLiveMeta(profileId);
  const drop = (meta.days || []).filter(d => d.last <= ts).map(d => d.date);
  for (const date of drop) await delLive(liveKey(profileId, date));
  if (!drop.length) return 0;
  meta.days = (meta.days || []).filter(d => !drop.includes(d.date));
  meta.last = meta.days.length ? Math.max(...meta.days.map(d => d.last)) : null;
  await setLiveMeta(profileId, meta);
  return drop.length;
}

export async function clearLive(profileId) {
  const keys = await listLiveKeys(profileId);
  for (const k of keys) await delLive(k);
  await kvSet(metaKey(profileId), { days: [], last: null, volumeKind: 'tickCount' });
  const all = await getProfiles();
  const p = all.find(x => x.id === profileId);
  if (p) { delete p.live; await saveProfile(p); }
  return keys.length;
}

/** 一致性自检用：某 profile 的实时分片总根数 */
export async function liveBarCount(profileId) {
  const days = await liveDays(profileId);
  return days.reduce((s, d) => s + (d.bars || 0), 0);
}
