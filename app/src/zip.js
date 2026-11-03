// 极简 ZIP 读取器：只解压 .csv 这类文本条目（stored / deflate）
// 支持 ZIP64：>4 GB 或 >65535 条目时，尺寸/偏移放在 ZIP64 EOCD 与 0x0001 扩展字段里
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CDIR = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const U32_MAX = 0xffffffff;

function u16(dv, o) { return dv.getUint16(o, true); }
function u32(dv, o) { return dv.getUint32(o, true); }

/** 找 EOCD：从尾部最多 64KB + 22 字节里倒着扫 */
async function findEocd(file) {
  const tailLen = Math.min(file.size, 65536 + 22);
  const buf = await file.slice(file.size - tailLen).arrayBuffer();
  const dv = new DataView(buf);
  for (let i = buf.byteLength - 22; i >= 0; i--) {
    if (u32(dv, i) === SIG_EOCD) {
      const base0 = {
        base: file.size - tailLen,                       // 尾部缓冲区在文件里的起点
        offsetInBuf: i,
        entries: u16(dv, i + 10),
        cdirSize: u32(dv, i + 12),
        cdirOffset: u32(dv, i + 16)
      };
      const fixed = await resolveZip64(file, base0, dv, i);
      return { ...base0, ...fixed };
    }
  }
  throw new Error('不是有效的 zip（找不到目录结尾 EOCD）');
}

/** EOCD 里的字段是 0xFFFFFFFF / 0xFFFF 时，去 ZIP64 里取真值 */
async function resolveZip64(file, eocd, dv, at) {
  const needs = eocd.entries === 0xffff || eocd.cdirSize === U32_MAX || eocd.cdirOffset === U32_MAX;
  if (!needs) return eocd;
  const locOffset = at - 20;
  if (locOffset < 0) throw new Error('ZIP64 定位器不在尾部 64KB 内，暂不支持');
  if (u32(dv, locOffset) !== SIG_EOCD64_LOC) return eocd;   // 只是条目数恰好 65535
  const eocd64Offset = Number(dv.getBigUint64(locOffset + 8, true));
  const buf = await file.slice(eocd64Offset, eocd64Offset + 56).arrayBuffer();
  const d2 = new DataView(buf);
  if (u32(d2, 0) !== SIG_EOCD64) throw new Error('ZIP64 目录头损坏');
  return {
    entries: Number(d2.getBigUint64(32, true)),
    cdirSize: Number(d2.getBigUint64(40, true)),
    cdirOffset: Number(d2.getBigUint64(48, true)),
    zip64: true
  };
}

/** 读 0x0001 扩展字段里的 64 位尺寸/偏移（顺序：size, compSize, localOffset） */
function applyZip64Extra(dv, start, len, out) {
  const end = start + len;
  let q = start;
  while (q + 4 <= end) {
    const id = u16(dv, q);
    const sz = u16(dv, q + 2);
    if (id === 0x0001) {
      let r = q + 4;
      if (out.size === U32_MAX && r + 8 <= end) { out.size = Number(dv.getBigUint64(r, true)); r += 8; }
      if (out.compSize === U32_MAX && r + 8 <= end) { out.compSize = Number(dv.getBigUint64(r, true)); r += 8; }
      if (out.localOffset === U32_MAX && r + 8 <= end) { out.localOffset = Number(dv.getBigUint64(r, true)); r += 8; }
    }
    q += 4 + sz;
  }
  return out;
}

/** 列出所有条目（不解压） */
export async function listZipEntries(file) {
  const eocd = await findEocd(file);
  if (!eocd.cdirSize && !eocd.entries) throw new Error('zip 是空的');

  const cbuf = await file.slice(eocd.cdirOffset, eocd.cdirOffset + eocd.cdirSize).arrayBuffer();
  const dv = new DataView(cbuf);
  const out = [];
  let p = 0;
  for (let i = 0; i < eocd.entries && p + 46 <= cbuf.byteLength; i++) {
    if (u32(dv, p) !== SIG_CDIR) break;
    const flags = u16(dv, p + 8);
    const method = u16(dv, p + 10);
    const compSizeRaw = u32(dv, p + 20);
    const sizeRaw = u32(dv, p + 24);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOffsetRaw = u32(dv, p + 42);
    const sizes = applyZip64Extra(dv, p + 46 + nameLen, extraLen,
      { size: sizeRaw, compSize: compSizeRaw, localOffset: localOffsetRaw });
    const compSize = sizes.compSize, size = sizes.size, localOffset = sizes.localOffset;
    const nameBytes = new Uint8Array(cbuf, p + 46, nameLen);
    // bit 11 = UTF-8 文件名
    const name = new TextDecoder((flags & 0x800) ? 'utf-8' : 'gbk').decode(nameBytes);
    out.push({ name, method, compSize, size, localOffset, flags, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 读取单个条目，返回 Uint8Array（deflate 走浏览器内置 DecompressionStream） */
export async function readZipEntry(file, entry) {
  const head = await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
  const dv = new DataView(head);
  if (u32(dv, 0) !== SIG_LOCAL) throw new Error(`条目头损坏：${entry.name}`);
  const nameLen = u16(dv, 26);
  const extraLen = u16(dv, 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = new Uint8Array(await file.slice(start, start + entry.compSize).arrayBuffer());

  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`压缩方式不支持（method=${entry.method}）：${entry.name}`);
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持 DecompressionStream，无法解压');

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 挑出 csv 条目：跳过目录、__MACOSX、隐藏文件 */
export function csvEntries(entries) {
  return entries.filter(e => !e.isDir
    && /\.(csv|txt|tsv)$/i.test(e.name)
    && !e.name.startsWith('__MACOSX/')
    && !e.name.split('/').pop().startsWith('.'));
}

export async function readZipText(file, entry) {
  const bytes = await readZipEntry(file, entry);
  const isUtf8 = (entry.flags & 0x800) !== 0;
  return new TextDecoder(isUtf8 ? 'utf-8' : 'utf-8').decode(bytes);   // csv 一般 utf-8/gbk，见 fallback
}
