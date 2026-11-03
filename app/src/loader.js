// 从 data/manifest.json 导入 bin 分片到 IndexedDB
// 关键：新分片写在独立 importId 前缀下，成功后才切换档案并清理旧版本；失败/取消只回滚本次
import { checkImportBudget, chunkKey, delChunk, listChunkKeys, putChunk, saveProfile, getProfile } from './db.js';

export const BASE = new URL('../../', import.meta.url);

export async function loadManifest() {
  const res = await fetch(new URL('data/manifest.json', BASE), { cache: 'no-store' });
  if (!res.ok) throw new Error(`manifest 读取失败: ${res.status}`);
  return res.json();
}

async function sha256(buf) {
  if (!crypto?.subtle) return null;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 导入一个 profile
 * @param {object} profile manifest.profiles[i]
 * @param {{onProgress?:Function, signal?:AbortSignal, verify?:boolean}} opt
 */
export async function importProfile(profile, { onProgress = () => {}, signal, verify = true } = {}) {
  const gate = checkImportBudget(profile.bytes);
  if (!gate.ok) throw new Error(gate.message);

  const prev = await getProfile(profile.id);            // 旧版本先记着，成功后才清
  const importId = Date.now().toString(36);
  const total = profile.bytes;
  let done = 0;
  const written = [];
  const saved = { ...profile, importedAt: new Date().toISOString(), importId, chunks: [] };

  try {
    for (let i = 0; i < profile.chunks.length; i++) {
      if (signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
      const ch = profile.chunks[i];
      onProgress({ phase: 'fetch', file: ch.file, fileIndex: i, fileCount: profile.chunks.length, doneBytes: done, totalBytes: total });

      const res = await fetch(new URL(`${profile.dir}/${ch.file}`, BASE));
      if (!res.ok) throw new Error(`下载失败 ${ch.file}: ${res.status}`);
      const buf = await res.arrayBuffer();

      if (buf.byteLength !== ch.bytes) throw new Error(`${ch.file} 大小不符：期望 ${ch.bytes}，实际 ${buf.byteLength}`);
      if (buf.byteLength % profile.recordBytes !== 0) throw new Error(`${ch.file} 不是 ${profile.recordBytes} 字节整数倍`);
      if (verify && ch.sha256) {
        const got = await sha256(buf);
        if (got && got !== ch.sha256) throw new Error(`${ch.file} 校验和不匹配`);
      }

      if (signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
      const key = chunkKey(profile.id, ch.year, importId);
      await putChunk(key, buf);
      written.push(key);
      done += buf.byteLength;
      saved.chunks.push({ year: ch.year, bytes: ch.bytes, bars: ch.bars, first: ch.first, last: ch.last, key });
      onProgress({ phase: 'write', file: ch.file, fileIndex: i, fileCount: profile.chunks.length, doneBytes: done, totalBytes: total });
    }

    saved.importedBytes = done;
    await saveProfile(saved);                            // 档案指向新版本分片

    // 清理旧版本分片（失败不影响新数据可用）
    if (prev?.chunks?.length) {
      for (const c of prev.chunks) {
        if (c.key && !written.includes(c.key)) { try { await delChunk(c.key); } catch {} }
      }
    }
    return saved;
  } catch (err) {
    // 只回滚本次写入，旧版本数据保持可用
    for (const k of written) { try { await delChunk(k); } catch {} }
    throw err;
  }
}

/** 清理孤立分片（上次异常退出留下的 importId 版本） */
export async function sweepOrphans(profileId) {
  const p = await getProfile(profileId);
  if (!p) return 0;
  const keep = new Set((p.chunks || []).map(c => c.key));
  let removed = 0;
  for (const k of await listChunkKeys(profileId)) {
    if (!keep.has(k)) { try { await delChunk(k); removed++; } catch {} }
  }
  return removed;
}
