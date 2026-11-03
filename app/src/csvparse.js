// CSV 解析：表头自动识别 + 常见时间格式 + 分隔符/编码容错
// 目标：把任意常见行情 CSV（MT4/MT5/交易所导出/TradingView）读成 {ts,o,h,l,c,v}

/** utf-8 优先，坏了再按 GBK 解（国内导出常见） */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('gbk').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
  }
}

const ALIAS = {
  datetime: ['datetime', 'date time', 'timestamp', 'time', 'date_time', '日期时间', '时间'],
  date: ['date', '日期'],
  time: ['time', '时间'],
  open: ['open', 'o', '开盘', '开盘价'],
  high: ['high', 'h', '最高', '最高价'],
  low: ['low', 'l', '最低', '最低价'],
  close: ['close', 'c', 'last', '收盘', '收盘价'],
  volume: ['volume', 'vol', 'v', 'tickvol', '成交量', '量']
};

function norm(s) {
  return s.replace(/^\ufeff/, '').trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
}

/** 猜分隔符：看表头行里哪种出现最多 */
export function detectDelimiter(line) {
  const cands = [',', ';', '\t', '|'];
  let best = ',', bestN = 0;
  for (const d of cands) {
    const n = line.split(d).length - 1;
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

/** 表头 → 列下标映射；认不出 open/high/low/close 就返回 null（说明这不是带表头的行情 CSV） */
export function parseHeader(line, delim) {
  const cells = line.split(delim).map(norm);
  const idx = {};
  for (const [key, names] of Object.entries(ALIAS)) {
    const i = cells.findIndex(c => names.includes(c));
    if (i >= 0) idx[key] = i;
  }
  const ok = idx.open != null && idx.high != null && idx.low != null && idx.close != null
    && (idx.datetime != null || idx.date != null || idx.time != null);
  return ok ? { idx, cells } : null;
}

const NUM = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** 时间串 → 毫秒。无时区按 UTC（与 csv2bin.py 一致） */
export function parseTs(s, dateStr, timeStr) {
  let t = (s || '').trim().replace(/^["']|["']$/g, '');
  if (dateStr != null) t = (dateStr.trim() + ' ' + (timeStr || '00:00:00').trim()).trim();

  if (/^\d{10}$/.test(t)) return Number(t) * 1000;               // epoch 秒
  if (/^\d{13}$/.test(t)) return Number(t);                       // epoch 毫秒

  // DD.MM.YYYY HH:MM:SS[.mmm]（Dukascopy 导出），以及 DD/MM/YYYY
  let m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const [, d, mo, y, hh = '0', mi = '0', ss = '0', ms = '0', tz] = m;
    let ts = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss, +ms.padEnd(3, '0').slice(0, 3));
    if (tz && tz !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const g = tz.slice(1).replace(':', '');
      ts -= sign * ((+g.slice(0, 2)) * 60 + (+g.slice(2, 4))) * 60000;
    }
    return ts;
  }

  m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return NaN;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0', ms = '0', tz] = m;
  let ts = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss, +ms.padEnd(3, '0').slice(0, 3));
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const [th, tm] = tz.slice(1).replace(':', '').match(/(\d{2})(\d{2})/).slice(1);
    ts -= sign * ((+th) * 60 + (+tm)) * 60000;
  }
  return ts;
}

/**
 * 逐行解析，不建大数组（几百 MB 的 csv 也只按行过一遍）
 * @param {string} text
 * @param {{onRow:(r:{ts:number,o:number,h:number,l:number,c:number,v:number})=>void, hasHeader?:boolean, signal?:AbortSignal}} opt
 * @returns {{rows:number, skipped:number, header:boolean, cols:string[]}}
 */
export function parseCsv(text, { onRow, hasHeader = true, signal } = {}) {
  let i = 0;
  const n = text.length;
  // 第一行
  let eol = text.indexOf('\n', i);
  if (eol < 0) eol = n;
  const firstLine = text.slice(i, eol).replace(/\r$/, '');
  const delim = detectDelimiter(firstLine);
  let header = null;
  if (hasHeader) header = parseHeader(firstLine, delim);
  if (header) i = eol + 1;                                    // 有表头就跳过
  else {
    // 没表头：按“时间,开,高,低,收[,量]”约定；若第一行第一列不是时间就跳过它
    header = { idx: { datetime: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 }, cells: [] };
    if (!Number.isFinite(parseTs(firstLine.split(delim)[0]))) i = eol + 1;
  }

  const { idx } = header;
  // 只有 time 列、没有 date/datetime 时（Dukascopy 的 time 列就是完整时间）
  if (idx.datetime == null && idx.date == null && idx.time != null) idx.datetime = idx.time;
  let rows = 0, skipped = 0;
  while (i < n) {
    if (signal?.aborted) throw new DOMException('用户取消导入', 'AbortError');
    let j = text.indexOf('\n', i);
    if (j < 0) j = n;
    const line = text.slice(i, j).replace(/\r$/, '');
    i = j + 1;
    if (!line || line[0] === '#') continue;

    const cells = line.split(delim);
    const tsRaw = idx.datetime != null ? cells[idx.datetime]
      : (cells[idx.date] || '') + ' ' + (cells[idx.time] ?? '00:00:00');
    const ts = parseTs(tsRaw, idx.datetime != null ? null : (cells[idx.date] || ''), idx.time != null ? cells[idx.time] : undefined);
    const o = cells[idx.open], h = cells[idx.high], l = cells[idx.low], c = cells[idx.close];
    if (!Number.isFinite(ts) || o == null || h == null || l == null || c == null) { skipped++; continue; }
    const O = Number(o), H = Number(h), L = Number(l), C = Number(c);
    if (!Number.isFinite(O) || !Number.isFinite(H) || !Number.isFinite(L) || !Number.isFinite(C)) { skipped++; continue; }
    const V = idx.volume != null ? Number(cells[idx.volume]) : 0;
    onRow({ ts, o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? V : 0 });
    rows++;
  }
  return { rows, skipped, header: header.cells.length > 0, cols: header.cells };
}
