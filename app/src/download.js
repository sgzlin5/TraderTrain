// 历史数据下载：Dukascopy → 本地服务的 /api/duka/* → 走同一套 CSV 导入管线
// 服务端负责 LZMA 解压、按天缓存、重试退避；浏览器只负责进度与导入

const DL = {
  instruments: null,
  apiOk: null,
  appendMode: false,
  picked: null,
  jobId: null,
  timer: null,
  abort: null,
  notify: null            // 自动补缺口时把进度镜像到状态栏（手动模式下为 null）
};

function dlMsg(text, isErr = false) {
  const el = document.getElementById('dlMsg');
  if (el) { el.textContent = text || ''; el.classList.toggle('err', !!isErr); }
  try { DL.notify?.(text || '', isErr); } catch {}
}

async function dlInstruments() {
  // 搜索用前端内置清单（不依赖服务）；服务端列表只用于补全说明
  if (!DL.instruments) {
    const { INSTRUMENTS } = await import('./instruments.js');
    DL.instruments = INSTRUMENTS;
  }
  return DL.instruments;
}

/** 探测下载接口是否可用（服务是不是 tools/serve.py） */
async function dlApiReady() {
  if (DL.apiOk != null) return DL.apiOk;
  try {
    const res = await fetch('/api/instruments', { cache: 'no-store' });
    DL.apiOk = res.ok;
  } catch { DL.apiOk = false; }
  return DL.apiOk;
}

function dlRenderResults(list) {
  const box = document.getElementById('dlResults');
  if (!box) return;
  if (!list.length) { box.innerHTML = '<div class="dl-empty">没有匹配的标的</div>'; box.hidden = false; return; }
  box.innerHTML = list.map(s => `<button class="dl-opt" data-code="${s.code}">
      <b>${s.code}</b><span>${s.name}</span><em>${s.category} · ${s.source === 'binance' ? 'BINANCE' : 'DUKA'}</em>
    </button>`).join('');
  box.hidden = false;
  box.querySelectorAll('.dl-opt').forEach(b => {
    b.onclick = () => {
      const s = DL.instruments.find(x => x.code === b.dataset.code);
      DL.picked = s;
      document.getElementById('dlSymbol').textContent = s.code;
      document.getElementById('dlName').textContent =
        `${s.name} · ${s.category} · ${s.source === 'binance' ? 'Binance 归档' : 'Dukascopy'}`;
      const priceSel = document.getElementById('dlPrice');
      priceSel.disabled = s.source === 'binance';
      priceSel.title = s.source === 'binance' ? 'Binance 归档只有成交价' : '';
      box.hidden = true;
      document.getElementById('dlSearch').value = s.code;
      dlMsg('');
      dlSyncAppendBtn();                       // 选中后刷新「补到昨天」状态
    };
  });
}

let _dlSeq = 0;
async function dlSearch(term) {
  const seq = ++_dlSeq;                        // focus 与 input 会并发触发，只认最后一次
  try {
    const mod = await import('./instruments.js');
    DL.instruments = mod.INSTRUMENTS;          // 结果点击时要按 code 回查
    if (seq !== _dlSeq) return;
    dlRenderResults(mod.searchInstruments(term));
    const ok = await dlApiReady();
    if (!ok) dlMsg('搜索可用；下载需要本地服务：请用 start.bat 重启（当前是 python -m http.server）', true);
    else dlMsg('');
  } catch (err) {
    dlMsg(`搜索失败：${err.message}`, true);
  }
}

function utcDay(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function isoDay(d) { return d.toISOString().slice(0, 10); }
function yesterdayUTC() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return utcDay(d); }

/** 「补到昨天」按钮的可用性：要有档案，且最后一天早于昨天 */
async function dlSyncAppendBtn() {
  const btn = document.getElementById('dlAppend');
  if (!btn) return;
  const code = DL.picked?.code;
  if (!code) { btn.disabled = true; btn.title = '先选一个标的'; return; }
  const { getProfile } = await import('./db.js');
  const prev = await getProfile(`${code}-1m`);
  if (!prev) { btn.disabled = true; btn.title = `${code} 还没有档案，先用「下载并导入」整段导入一次`; return; }
  const lastDay = utcDay(new Date(prev.last));
  const y = yesterdayUTC();
  btn.disabled = lastDay >= y;
  btn.title = lastDay >= y
    ? `已是最新：最后一天 ${isoDay(lastDay)}`
    : `${isoDay(lastDay)} → ${isoDay(y)}（已有 ${prev.bars.toLocaleString()} 根）`;
}

async function dlAppend(opts = {}) {
  if (DL.jobId) return;
  const code = DL.picked?.code;
  if (!code) { dlMsg('先搜索并选择一个标的', true); return; }
  const { getProfile } = await import('./db.js');
  const prev = await getProfile(`${code}-1m`);
  if (!prev) { dlMsg(`${code} 还没有档案，先用「下载并导入」整段导入一次`, true); return; }
  if (!(await dlApiReady())) {
    dlMsg('下载接口不可用：请用 start.bat 重启（会启用 tools/serve.py）', true);
    return;
  }
  const fromDay = opts.from ? utcDay(new Date(opts.from)) : utcDay(new Date(prev.last));  // 含最后一天（边界 K 线可能不完整）
  const toDay = opts.to ? utcDay(new Date(opts.to)) : yesterdayUTC();
  if (fromDay >= toDay) { dlMsg(`已是最新：最后一天 ${isoDay(fromDay)}`, false); return; }

  DL.appendMode = true;
  DL.prevBars = prev.bars;
  dlMsg('');
  dlSetProgress(0, `续传 ${isoDay(fromDay)} → ${isoDay(toDay)} …`);
  document.getElementById('dlCancel').hidden = false;
  try {
    const source = DL.picked.source || 'dukascopy';
    const url = `/api/job?symbol=${encodeURIComponent(code)}&source=${source}`
      + `&tf=M1&from=${isoDay(fromDay)}&to=${isoDay(toDay)}&price=${document.getElementById('dlPrice').value || 'BID'}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    DL.jobId = data.id;
    DL.unit = data.source === 'binance' ? '个月' : '天';
    dlPoll(data.total);
  } catch (err) {
    DL.appendMode = false;
    dlMsg(`续传失败：${err.message}`, true);
    dlStop();
    document.getElementById('dlProgWrap').hidden = true;
  }
}

function dlSetProgress(pct, text) {
  const wrap = document.getElementById('dlProgWrap');
  const bar = document.getElementById('dlProg');
  const t = document.getElementById('dlText');
  if (!wrap) return;
  wrap.hidden = false;
  if (bar) bar.value = Math.max(0, Math.min(100, pct));
  if (t) t.textContent = text || '';
}

function dlStop() {
  if (DL.timer) { clearInterval(DL.timer); DL.timer = null; }
  const c = document.getElementById('dlCancel');
  if (c) c.hidden = true;
}

async function dlStart() {
  if (DL.jobId) return;
  if (!DL.picked) { dlMsg('先搜索并选择一个标的', true); return; }
  const from = document.getElementById('dlFrom').value;
  const to = document.getElementById('dlTo').value;
  if (!from || !to) { dlMsg('选一下起止日期', true); return; }
  const price = document.getElementById('dlPrice').value || 'BID';
  const tf = document.getElementById('dlTf').value || 'M1';

  if (!(await dlApiReady())) {
    dlMsg('下载接口不可用：请用 start.bat 重启（会启用 tools/serve.py）', true);
    return;
  }
  dlMsg('');
  DL.appendMode = false;
  dlSetProgress(0, '创建任务…');
  document.getElementById('dlCancel').hidden = false;
  try {
    const url = `/api/job?symbol=${encodeURIComponent(DL.picked.code)}&source=${DL.picked.source || 'dukascopy'}`
      + `&tf=${tf}&from=${from}&to=${to}&price=${price}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    DL.jobId = data.id;
    DL.unit = data.source === 'binance' ? '个月' : '天';
    dlPoll(data.total);
  } catch (err) {
    dlMsg(`下载失败：${err.message}`, true);
    dlStop();
    document.getElementById('dlProgWrap').hidden = true;
  }
}

function dlPoll(total) {
  DL.timer = setInterval(async () => {
    try {
      const res = await fetch(`/api/job/${DL.jobId}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const pct = j.total ? (j.done / j.total) * 100 : 0;
      dlSetProgress(pct * 0.85, `下载 ${j.done}/${j.total} ${DL.unit || '天'} · ${j.bars.toLocaleString()} 根`);
      if (j.state === 'done') { clearInterval(DL.timer); DL.timer = null; await dlFinish(j); }
      else if (j.state === 'error' || j.state === 'cancelled') {
        dlStop();
        dlMsg(j.state === 'cancelled' ? '已取消' : `下载失败：${j.error}`, j.state === 'error');
      }
    } catch (err) {
      dlStop();
      dlMsg(`进度获取失败：${err.message}`, true);
    }
  }, 1200);
}

async function dlFinish(job) {
  const sym = DL.picked.code;
  const from = document.getElementById('dlFrom').value;
  const to = document.getElementById('dlTo').value;
  dlSetProgress(88, '读取 CSV…');
  try {
    const res = await fetch(`/api/job/${DL.jobId}/csv`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`取 CSV 失败（${res.status}）`);
    const text = await res.text();
    dlSetProgress(92, DL.appendMode ? '合并入库…' : '解析并入库…');
    const ing = await import('./ingest.js');
    const src = [{ name: `${sym}_${from}_${to}.csv`, getText: async () => text }];
    const saved = DL.appendMode
      ? await ing.appendCsvSources(src, { symbol: sym })
      : await ing.importCsvSources(src, { symbol: sym });
    dlSetProgress(100, '完成');
    if (DL.appendMode) {
      const delta = saved.bars - (DL.prevBars || 0);
      dlMsg(`已续传 ${saved.symbol}：新增 ${delta.toLocaleString()} 根（下载 ${(job.bars || 0).toLocaleString()} 根，重叠部分已去重）· 现共 ${saved.bars.toLocaleString()} 根 · 到 ${isoDay(new Date(saved.last))}`);
    } else {
      dlMsg(`已导入 ${saved.symbol} · ${saved.bars.toLocaleString()} 根 · ${(saved.bytes / 1048576).toFixed(1)} MB · ${job.skipped ? `跳过 ${job.skipped} 天空档 · ` : ''}${from} → ${to}`);
    }
    await window.__TT_AFTER_IMPORT__?.(saved);
  } catch (err) {
    dlMsg(`导入失败：${err.message}`, true);
  } finally {
    try { await fetch(`/api/job/${DL.jobId}`, { method: 'DELETE' }); } catch {}
    DL.jobId = null;
    DL.appendMode = false;
    DL.notify = null;
    dlStop();
    dlSyncAppendBtn();
  }
}

/* ---------------- 中间缺口扫描与补齐（2026-11-05） ----------------
   全档扫描 1m 时间戳的异常空洞，排除两类良性缺口：
   · 每日维护（洞起点 05:5x UTC、≤2h —— Dukascopy 每天 06:00 整点缺失）
   · 周末（起点周五/周六/周日傍晚、≤3.6 天 —— XAUUSD 周末休市）
   其余列为候选：可按段补齐（ingest 按 timestamp 去重，已有根不覆盖）。 */

export async function scanInteriorGaps(code) {
  const { getProfile, getChunk } = await import('./db.js');
  const { RECORD_BYTES } = await import('./binread.js');
  const prev = await getProfile(`${code}-1m`);
  if (!prev?.chunks?.length) return { gaps: [], bars: 0 };
  let prevTs = null;
  const gaps = [];
  let bars = 0;
  const MIN = 60000;
  for (const ch of [...prev.chunks].sort((a, b) => a.year - b.year)) {
    const buf = await getChunk(ch.key);
    if (!buf) continue;
    const dv = new DataView(buf);
    const total = Math.floor(buf.byteLength / RECORD_BYTES);
    bars += total;
    for (let i = 0; i < total; i++) {
      const ts = Number(dv.getBigInt64(i * RECORD_BYTES, true));
      if (prevTs != null) {
        const dt = ts - prevTs;
        if (dt > MIN) {
          const d = new Date(prevTs);
          const dow = d.getUTCDay(), hour = d.getUTCHours(), days = dt / 86400000;
          const nbars = Math.max(1, Math.round(dt / MIN) - 1);
          let kind = 'gap';
          if (days <= 0.09 && hour === 5 && d.getUTCMinutes() >= 50) kind = 'maint';
          else if (nbars >= 55 && nbars <= 65) kind = 'maint';            // ~1h 维护段（不同年代时刻不一）
          else if (days <= 3.6 && (dow === 5 || dow === 6 || (dow === 0 && hour >= 12))) kind = 'weekend';
          if (kind === 'gap') gaps.push({
            startDay: isoDay(new Date(prevTs + MIN)), endDay: isoDay(new Date(ts - MIN)),
            bars: nbars, kind
          });
        }
      }
      prevTs = ts;
    }
  }
  return { gaps, bars };
}

/** 顺序补齐候选缺口：每段走一次「补到昨天」同款管线（下载 → 去重合并入库 → 刷新）。 */
export async function fillGaps(code, gaps, onStatus = () => {}) {
  if (DL.jobId) { onStatus('下载队列忙，稍后再试', true); return false; }
  DL.picked = { code, source: 'dukascopy' };
  const { getProfile } = await import('./db.js');
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    onStatus(`[${i + 1}/${gaps.length}] 补 ${g.startDay} → ${g.endDay} …`);
    const before = (await getProfile(`${code}-1m`))?.bars ?? 0;
    await dlAppend({ from: g.startDay, to: g.endDay });
    if (!DL.jobId) { onStatus(`跳过 ${g.startDay}（无需下载或接口不可用）`); continue; }
    // 等 dlPoll 完成（DL.jobId 在完成后被清空）+ 入库/刷新收尾
    while (DL.jobId) await new Promise(r => setTimeout(r, 500));
    await new Promise(r => setTimeout(r, 1500));
    const after = (await getProfile(`${code}-1m`))?.bars ?? 0;
    onStatus(`[${i + 1}/${gaps.length}] ${g.startDay} → ${g.endDay}：新增 ${(after - before).toLocaleString()} 根${after - before === 0 ? '（可能为休市日，上游也无数据）' : ''}`);
  }
  onStatus(`补齐完成：处理 ${gaps.length} 段`);
  return true;
}

/** 启动时自动补缺口：历史尾部 → UTC 昨天。返回 {started, reason, from, to} */
export async function autoGapFill(code, opts = {}) {
  if (DL.jobId) return { started: false, reason: 'busy' };
  if (!code) return { started: false, reason: 'no-symbol' };
  const { getProfile } = await import('./db.js');
  const prev = await getProfile(`${code}-1m`);
  if (!prev) return { started: false, reason: 'no-profile' };
  if (!(await dlApiReady())) return { started: false, reason: 'no-api' };
  const fromDay = opts.from ? utcDay(new Date(opts.from)) : utcDay(new Date(prev.last));
  const toDay = opts.to ? utcDay(new Date(opts.to)) : yesterdayUTC();
  if (fromDay >= toDay) return { started: false, reason: 'up-to-date' };

  DL.picked = { code, source: 'dukascopy' };
  DL.notify = (t, err) => { try { opts.onStatus?.(t, err); } catch {} };
  const f = document.getElementById('dlFrom'), t = document.getElementById('dlTo');
  if (f) f.value = isoDay(fromDay);
  if (t) t.value = isoDay(toDay);
  if (f) f.dataset.auto = '1';
  await dlAppend({ from: fromDay, to: toDay });
  return { started: !!DL.jobId, from: isoDay(fromDay), to: isoDay(toDay) };
}

export function wireDownload() {
  const search = document.getElementById('dlSearch');
  if (!search) return;
  const to = document.getElementById('dlTo');
  const from = document.getElementById('dlFrom');
  if (to && !to.value) to.value = new Date().toISOString().slice(0, 10);
  if (from && !from.value) {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    from.value = d.toISOString().slice(0, 10);
  }

  search.oninput = () => dlSearch(search.value);
  search.onfocus = () => dlSearch(search.value);
  document.addEventListener('mousedown', (e) => {
    const box = document.getElementById('dlResults');
    if (!box || box.hidden) return;
    if (box.contains(e.target) || e.target === search) return;
    box.hidden = true;
  }, true);

  const autoGap = document.getElementById('dlAutoGap');
  if (autoGap) {
    // 事件先同步挂上（读取初始值可以慢，但不能让用户点了没反应）
    autoGap.onchange = () => {
      import('./db.js').then(({ kvSet }) => kvSet('ui:autogap', !!autoGap.checked)).catch(() => {});
    };
    import('./db.js')
      .then(async ({ kvGet }) => { autoGap.checked = (await kvGet('ui:autogap')) !== false; })   // 默认开，用户手动取消才是关
      .catch(() => {});
  }
  document.getElementById('dlStart').onclick = () => dlStart();
  document.getElementById('dlAppend').onclick = () => dlAppend();
  // 中间缺口扫描（vela 分支新增）
  const gapScanBtn = document.getElementById('gapScanBtn');
  if (gapScanBtn) {
    gapScanBtn.onclick = async () => {
      const code = window.__APP__?.profile?.id?.replace(/-1m$/, '');
      const info = document.getElementById('gapScanInfo');
      const list = document.getElementById('gapList');
      if (!code) { if (info) info.textContent = '先导入一个档案'; return; }
      gapScanBtn.disabled = true;
      if (info) { info.hidden = false; info.textContent = '扫描中…（全档时间戳遍历，约 2 秒）'; }
      try {
        const { scanInteriorGaps } = await import('./download.js');
        const { gaps, bars } = await scanInteriorGaps(code);
        if (list) {
          list.hidden = false;
          if (!gaps.length) {
            list.innerHTML = `<div class="gap-row">扫描完成：${bars.toLocaleString()} 根中未发现可补的中间缺口（每日维护与周末已排除）</div>`;
          } else {
            // 分级：大缺口（≥10 根）逐条列出；零星（<10 根）计数 + 按天合并补齐
            const big = gaps.filter(g => g.bars >= 10);
            const tiny = gaps.filter(g => g.bars < 10);
            const tinyBars = tiny.reduce((s2, g) => s2 + g.bars, 0);
            let html = `<div class="gap-row">扫描完成：${bars.toLocaleString()} 根 · 候选缺口 ${gaps.length} 段
              <button id="gapFillAll" class="btn">补齐以下全部</button></div>`;
            html += big.map((g, i) => `<div class="gap-row">▸ ${g.startDay} → ${g.endDay} · 缺 ${g.bars.toLocaleString()} 根
              <button class="btn ghost" data-gap-i="${gaps.indexOf(g)}">补</button></div>`).join('');
            if (tiny.length) {
              html += `<div class="gap-row">▸ 另有 ${tiny.length} 段零星缺失（共 ${tinyBars.toLocaleString()} 根，单段 1-9 根）
                <button id="gapFillTiny" class="btn ghost">按天合并补齐</button></div>
                <div class="gap-row muted">零星缺失多为上游数据源本身没有的根；合并补齐按天下载，已有根自动去重。若受影响日期超过 60 天会拒绝执行。</div>`;
            }
            if (!big.length && !tiny.length) html += `<div class="gap-row">无候选缺口</div>`;
            list.innerHTML = html;
            list.querySelectorAll('[data-gap-i]').forEach(b => {
              b.onclick = () => runGapFill(code, [gaps[Number(b.dataset.gapI)]]);
            });
            const all = list.querySelector('#gapFillAll');
            if (all) all.onclick = () => runGapFill(code, big.length ? big : gaps);
            const ft = list.querySelector('#gapFillTiny');
            if (ft) ft.onclick = () => {
              const ranges = gapsToDayRanges(tiny);
              if (ranges.length > 60) { if (info) info.textContent = `零星缺失分布在 ${ranges.length} 天，超过 60 段上限，请分年处理`; return; }
              runGapFill(code, ranges.map(r => ({ startDay: r.startDay, endDay: r.endDay, bars: 0 })));
            };
          }
        }
      } catch (e) {
        if (info) { info.hidden = false; info.textContent = `扫描失败：${e.message}`; }
      } finally { gapScanBtn.disabled = false; }
    };
  }
  dlSyncAppendBtn();
  document.getElementById('dlCancel').onclick = async () => {
    if (!DL.jobId) return;
    try { await fetch(`/api/job/${DL.jobId}`, { method: 'DELETE' }); } catch {}
    dlStop();
    DL.jobId = null;
    dlMsg('已取消');
  };
}


function gapsToDayRanges(gaps) {
  const days = [...new Set(gaps.flatMap(g => {
    const out = [];
    const d0 = new Date(g.startDay + 'T00:00:00Z'), d1 = new Date(g.endDay + 'T00:00:00Z');
    for (let d = d0.getTime(); d <= d1.getTime(); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10));
    return out;
  }))].sort();
  const ranges = [];
  for (const day of days) {
    const last = ranges[ranges.length - 1];
    if (last && new Date(day) - new Date(last.endDay) <= 2 * 86400000) last.endDay = day;
    else ranges.push({ startDay: day, endDay: day });
  }
  return ranges;
}

async function runGapFill(code, gaps) {
  const info = document.getElementById('gapScanInfo');
  const list = document.getElementById('gapList');
  const onStatus = (t) => { if (info) info.textContent = t; };
  await fillGaps(code, gaps, onStatus);
  // 完成后重扫刷新列表
  try {
    const { scanInteriorGaps } = await import('./download.js');
    const r = await scanInteriorGaps(code);
    if (list) {
      list.innerHTML = r.gaps.length
        ? `<div class="gap-row">剩余 ${r.gaps.length} 段</div>` + r.gaps.map((g, i) => `<div class="gap-row">${g.startDay} → ${g.endDay} · 缺 ${g.bars.toLocaleString()} 根 <button class="btn ghost" data-gap-i="${i}">补</button></div>`).join('')
        : `<div class="gap-row">扫描完成：未发现可补的中间缺口</div>`;
      list.querySelectorAll('[data-gap-i]').forEach(b => {
        b.onclick = () => runGapFill(code, [r.gaps[Number(b.dataset.gapI)]]);
      });
    }
  } catch {}
}
