// 历史数据下载：Dukascopy → 本地服务的 /api/duka/* → 走同一套 CSV 导入管线
// 服务端负责 LZMA 解压、按天缓存、重试退避；浏览器只负责进度与导入

const DL = {
  instruments: null,
  apiOk: null,
  appendMode: false,
  picked: null,
  jobId: null,
  timer: null,
  abort: null
};

function dlMsg(text, isErr = false) {
  const el = document.getElementById('dlMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
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

async function dlAppend() {
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
  const fromDay = utcDay(new Date(prev.last));      // 含最后一天（可能是不完整的边界 K 线）
  const toDay = yesterdayUTC();
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
    dlStop();
    dlSyncAppendBtn();
  }
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

  document.getElementById('dlStart').onclick = () => dlStart();
  document.getElementById('dlAppend').onclick = () => dlAppend();
  dlSyncAppendBtn();
  document.getElementById('dlCancel').onclick = async () => {
    if (!DL.jobId) return;
    try { await fetch(`/api/job/${DL.jobId}`, { method: 'DELETE' }); } catch {}
    dlStop();
    DL.jobId = null;
    dlMsg('已取消');
  };
}
