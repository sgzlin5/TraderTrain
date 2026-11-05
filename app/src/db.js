// IndexedDB 封装：chunks（按 年份分片存 ArrayBuffer）+ kv（清单/设置/统计）
const DB_NAME = 'trader-train';
const DB_VERSION = 3;
export const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;   // 单次导入上限 1 GB

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('live')) db.createObjectStore('live');
    };
    rq.onsuccess = () => { _db = rq.result; resolve(_db); };
    rq.onerror = () => reject(rq.error);
  });
}

function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
function reqp(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function kvGet(key) { const db = await openDB(); return reqp(tx(db, 'kv', 'readonly').get(key)); }
export async function kvSet(key, val) { const db = await openDB(); return reqp(tx(db, 'kv', 'readwrite').put(val, key)); }
export async function kvDel(key) { const db = await openDB(); return reqp(tx(db, 'kv', 'readwrite').delete(key)); }

// 分片键：<profileId>@<importId>/<year>；importId 保证新旧导入互不覆盖，取消时能整批回滚
export const chunkKey = (profileId, year, importId) =>
  `${profileId}${importId ? '@' + importId : ''}/${year}`;

/** 某 profile 的所有分片键：严格前缀匹配（避免 id 前缀撞车，如 XAUUSD-1m vs XAUUSD-1m2） */
export async function listChunkKeys(profileId) {
  const db = await openDB();
  const all = await reqp(tx(db, 'chunks', 'readonly').getAllKeys());
  const a = profileId + '/', b = profileId + '@';
  return all.filter(k => typeof k === 'string' && (k.startsWith(a) || k.startsWith(b)));
}

/** 删除某 profile 的所有分片（含历史 importId 版本） */
export async function deleteChunkKeys(profileId) {
  const keys = await listChunkKeys(profileId);
  for (const k of keys) await delChunk(k);
  return keys.length;
}

export async function putChunk(key, buffer) { const db = await openDB(); return reqp(tx(db, 'chunks', 'readwrite').put(buffer, key)); }
export async function getChunk(key) { const db = await openDB(); return reqp(tx(db, 'chunks', 'readonly').get(key)); }
export async function delChunk(key) { const db = await openDB(); return reqp(tx(db, 'chunks', 'readwrite').delete(key)); }

// 已存数据档案：kv 'profiles' = [{id, symbol, name, bytes, bars, first, last, chunks:[{year,bytes,bars,first,last}]}]
export async function getProfiles() { return (await kvGet('profiles')) || []; }
export async function getProfile(id) { return (await getProfiles()).find(p => p.id === id) || null; }
export async function saveProfile(p) {
  const all = await getProfiles();
  const i = all.findIndex(x => x.id === p.id);
  if (i >= 0) all[i] = p; else all.push(p);
  await kvSet('profiles', all);
}
export async function deleteProfile(id) {
  await deleteChunkKeys(id);
  await deleteLiveKeys(id);
  const all = (await getProfiles()).filter(p => p.id !== id);
  await kvSet('profiles', all);
}

/** 实时分片（store 'live'）的键：`<profileId>|<YYYYMMDD>`，与 chunks 的 importId 命名空间完全分开 */
export const liveKey = (profileId, yyyymmdd) => `${profileId}|${yyyymmdd}`;

export async function putLive(key, buffer) { const db = await openDB(); return reqp(tx(db, 'live', 'readwrite').put(buffer, key)); }
export async function getLive(key) { const db = await openDB(); return reqp(tx(db, 'live', 'readonly').get(key)); }
export async function delLive(key) { const db = await openDB(); return reqp(tx(db, 'live', 'readwrite').delete(key)); }
export async function listLiveKeys(profileId) {
  const db = await openDB();
  const all = await reqp(tx(db, 'live', 'readonly').getAllKeys());
  const p = profileId + '|';
  return all.filter(k => typeof k === 'string' && k.startsWith(p));
}
export async function deleteLiveKeys(profileId) {
  const keys = await listLiveKeys(profileId);
  for (const k of keys) await delLive(k);
  return keys.length;
}

/** 截图等二进制：blobs 库（key -> Blob/ArrayBuffer） */
export async function putBlob(key, blob) { const db = await openDB(); return reqp(tx(db, 'blobs', 'readwrite').put(blob, key)); }
export async function getBlob(key) { const db = await openDB(); return reqp(tx(db, 'blobs', 'readonly').get(key)); }
export async function delBlob(key) { const db = await openDB(); return reqp(tx(db, 'blobs', 'readwrite').delete(key)); }
export async function listBlobKeys(prefix = '') {
  const db = await openDB();
  const all = await reqp(tx(db, 'blobs', 'readonly').getAllKeys());
  return prefix ? all.filter(k => String(k).startsWith(prefix)) : all;
}
export async function blobBytes(prefix = '') {
  const db = await openDB();
  const keys = await listBlobKeys(prefix);
  let total = 0;
  for (const k of keys) {
    const v = await reqp(tx(db, 'blobs', 'readonly').get(k));
    total += v?.size ?? v?.byteLength ?? 0;
  }
  return total;
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const e = await navigator.storage.estimate();
  return { quotaMB: +(e.quota / 1048576).toFixed(0), usageMB: +(e.usage / 1048576).toFixed(1) };
}

// 单次导入闸门：>1 GB 直接拒绝
export function checkImportBudget(bytes) {
  if (bytes > MAX_IMPORT_BYTES) {
    return { ok: false, maxMB: MAX_IMPORT_BYTES / 1048576, wantMB: +(bytes / 1048576).toFixed(1),
             message: `本次导入 ${(bytes / 1048576).toFixed(1)} MB，超过单次上限 ${MAX_IMPORT_BYTES / 1048576} MB，请拆分区间后分批导入` };
  }
  return { ok: true };
}
