// 换机迁移：配置（kv）与行情（chunks）的导出 / 导入
//   · 配置包：JSON，含除 'profiles' 外的全部 kv（主题/版面/TAB/指标偏好/收藏/组合/绘图/场次/档案索引…）
//   · 行情包：.ttdata = 8B 魔数 + uint32 头长度 + JSON 头 + 各分片原始字节（28 B/根，不压缩）
// 说明：配置里**不含行情清单**（'profiles'），避免导入配置把目标机的行情索引清空；
//       行情清单随行情包一起走。
import {
  openDB, kvGet, kvSet, getProfiles, saveProfile, chunkKey,
  listChunkKeys, putChunk, getChunk, deleteProfile
} from './db.js';

const MAGIC = 'TTDATA1\n';
const CFG_APP = 'TraderTrain';
const SKIP_KV = new Set(['profiles']);          // 行情清单不随配置走
const MAX_PACK = 1.4 * 1024 * 1024 * 1024;      // 单个包上限（Blob/内存都要兜住）

const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function txAll(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
const reqp = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* ------------------------------------------------ 配置 */

export async function exportConfig() {
  const os = await txAll('kv', 'readonly');
  const keys = (await reqp(os.getAllKeys())).filter(k => !SKIP_KV.has(k));
  const out = {};
  for (const k of keys) out[k] = await reqp(os.get(k));
  const payload = {
    app: CFG_APP, type: 'config', version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: (document.querySelector('meta[name="app-version"]')?.content || ''),
    keys: keys.length,
    kv: out
  };
  const text = JSON.stringify(payload);
  return {
    blob: new Blob([text], { type: 'application/json' }),
    name: `trader-train-config-${stamp()}.json`,
    keys: keys.length,
    bytes: new Blob([text]).size
  };
}

export async function importConfig(file) {
  const text = await file.text();
  let obj = null;
  try { obj = JSON.parse(text); } catch { throw new Error('不是合法的 JSON 配置文件'); }
  if (obj?.app !== CFG_APP || obj?.type !== 'config' || !obj.kv) {
    throw new Error('不是 TraderTrain 的配置文件（缺少 app/type/kv）');
  }
  let n = 0, bytes = 0;
  for (const [k, v] of Object.entries(obj.kv)) {
    if (SKIP_KV.has(k)) continue;
    await kvSet(k, v);
    n++; bytes += JSON.stringify(v ?? null).length;
  }
  return { keys: n, bytes, exportedAt: obj.exportedAt || null, skipped: Object.keys(obj.kv).filter(k => SKIP_KV.has(k)) };
}

/* ------------------------------------------------ 行情 */

export async function exportData(onProgress = () => {}, opts = {}) {
  const all = await getProfiles();
  const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
  const profiles = only ? all.filter(p => only.has(p.id)) : all;
  const items = [];
  let total = 0;
  await new Promise(r => setTimeout(r, 0));   // 让刚写入的分片事务先提交（冷启动会漏读）
  for (const p of profiles) {
    const keys = await listChunkKeys(p.id);
    for (const key of keys) {
      const buf = await getChunk(key);
      const bytes = buf instanceof ArrayBuffer ? buf.byteLength : (buf?.buffer?.byteLength ?? 0);
      if (!bytes) continue;
      items.push({ key, bytes, profileId: p.id });
      total += bytes;
    }
  }
  if (total > MAX_PACK) {
    throw new Error(`行情包 ${(total / 1048576).toFixed(0)} MB 超过单包上限 ${Math.round(MAX_PACK / 1048576)} MB，请分品种导出`);
  }
  const header = {
    app: CFG_APP, type: 'data', version: 1,
    exportedAt: new Date().toISOString(),
    profiles,                 // 含 chunks[] 元信息，导入后直接可用
    chunks: items
  };
  const hbytes = new TextEncoder().encode(JSON.stringify(header));
  const parts = [MAGIC, new Uint8Array(new Uint32Array([hbytes.length]).buffer), hbytes];
  let done = 0, i = 0;
  for (const it of items) {
    const buf = await getChunk(it.key);
    parts.push(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    done += it.bytes;
    onProgress({ done, total, pct: total ? Math.round(done / total * 100) : 100, chunk: ++i, chunks: items.length });
    if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));   // 让进度条能画出来
  }
  const blob = new Blob(parts, { type: 'application/octet-stream' });
  return {
    blob, name: `trader-train-data-${stamp()}.ttdata`,
    profiles: profiles.length, chunks: items.length, bytes: blob.size,
    chunkKeys: items.map(i => i.key),                 // 便于自检/排错核对
    profileIds: profiles.map(p => p.id)
  };
}

/** 只读文件头（用于导入前显示“这个包里有什么”） */
export async function peekData(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magic = new TextDecoder().decode(head);
  if (magic !== MAGIC) throw new Error('不是 TraderTrain 行情包（.ttdata）');
  const lenBuf = await file.slice(8, 12).arrayBuffer();
  const hlen = new DataView(lenBuf).getUint32(0, true);
  const hbuf = await file.slice(12, 12 + hlen).arrayBuffer();
  const header = JSON.parse(new TextDecoder().decode(hbuf));
  if (header?.type !== 'data') throw new Error('行情包头损坏（type 不是 data）');
  return { header, headerBytes: hlen, payloadOffset: 12 + hlen };
}

export async function importData(file, onProgress = () => {}) {
  const { header, payloadOffset } = await peekData(file);
  const chunks = header.chunks || [];
  const profiles = header.profiles || [];
  let offset = payloadOffset, done = 0, i = 0;
  const total = chunks.reduce((s, c) => s + (c.bytes || 0), 0);

  for (const c of chunks) {
    const end = offset + (c.bytes || 0);
    if (end > file.size) throw new Error(`行情包被截断（缺 ${(end - file.size)} 字节）`);
    const buf = await file.slice(offset, end).arrayBuffer();
    await putChunk(c.key, buf);
    offset = end; done += c.bytes || 0;
    onProgress({ done, total, pct: total ? Math.round(done / total * 100) : 100, chunk: ++i, chunks: chunks.length });
    if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 合并行情清单：同 id 以包内为准（包里的 chunks[] 与实际写入的分片一致）
  for (const p of profiles) await saveProfile(p);

  return {
    chunks: chunks.length, profiles: profiles.length, bytes: done,
    symbols: profiles.map(p => p.symbol).filter(Boolean)
  };
}

/* ------------------------------------------------ 下载 / 选择文件 小工具 */

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export const fmtBytes = (n) => (n >= 1048576
  ? `${(n / 1048576).toFixed(1)} MB`
  : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);
