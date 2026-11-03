// 场次（session）+ 统计 + 截图 + 导出
import { kvGet, kvSet, putBlob, getBlob, delBlob, listBlobKeys, blobBytes } from './db.js';

const SESSIONS_KEY = 'sessions';
const ACTIVE_KEY = 'session:active';

/* ---------------- 统计 ---------------- */

export function computeStats(trades, initialCapital = 100000) {
  const n = trades.length;
  const pnls = trades.map(t => t.pnl);
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p <= 0);
  const grossProfit = +wins.reduce((s, v) => s + v, 0).toFixed(2);
  const grossLoss = +Math.abs(losses.reduce((s, v) => s + v, 0)).toFixed(2);
  const netProfit = +(grossProfit - grossLoss).toFixed(2);
  const winRate = n ? +(wins.length / n * 100).toFixed(1) : 0;
  const avgWin = wins.length ? +(grossProfit / wins.length).toFixed(2) : 0;
  const avgLoss = losses.length ? +(grossLoss / losses.length).toFixed(2) : 0;
  const profitFactor = grossLoss ? +(grossProfit / grossLoss).toFixed(2) : (grossProfit ? Infinity : 0);
  const expectancy = n ? +((wins.length / n) * avgWin - (losses.length / n) * avgLoss).toFixed(2) : 0;

  // 权益曲线 & 最大回撤（按平仓顺序）
  let eq = initialCapital, peak = eq, maxDD = 0, maxDDPct = 0;
  const equity = [];
  let consecW = 0, consecL = 0, maxW = 0, maxL = 0;
  for (const p of pnls) {
    eq += p;
    equity.push(+eq.toFixed(2));
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak ? +(dd / peak * 100).toFixed(2) : 0; }
    if (p > 0) { consecW++; consecL = 0; maxW = Math.max(maxW, consecW); }
    else { consecL++; consecW = 0; maxL = Math.max(maxL, consecL); }
  }

  return {
    count: n, wins: wins.length, losses: losses.length, winRate,
    grossProfit, grossLoss, netProfit, profitFactor, avgWin, avgLoss, expectancy,
    maxDrawdown: +maxDD.toFixed(2), maxDrawdownPct: maxDDPct,
    maxConsecWins: maxW, maxConsecLosses: maxL,
    finalEquity: +eq.toFixed(2), initialCapital, equity
  };
}

/* ---------------- 导出 ---------------- */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tradesToCsv(trades) {
  const head = ['序号', '方向', '数量(oz)', '开仓价', '平仓价', '盈亏', '平仓原因', '开仓时间(UTC)', '平仓时间(UTC)', '持仓分钟'];
  const iso = (ts) => ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '';
  const rows = trades.map((t, i) => [
    i + 1, t.side === 'long' ? '多' : '空', t.qty, t.entry, t.exit, t.pnl, t.why,
    iso(t.openTs), iso(t.closeTs),
    t.openTs && t.closeTs ? Math.round((t.closeTs - t.openTs) / 60000) : ''
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}

export function sessionToJson(session) {
  const stats = computeStats(session.trades);
  return JSON.stringify({ ...session, stats, exportedAt: new Date().toISOString() }, null, 1);
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- 截图 ---------------- */

/** 所有 canvas 位图尺寸是否已跟上 CSS（面板开合/resize 期间会短暂不一致） */
function canvasReady(host) {
  const dpr = window.devicePixelRatio || 1;
  const cs = [...host.querySelectorAll('canvas')];
  if (!cs.length) return false;
  return cs.every(c => {
    const r = c.getBoundingClientRect();
    return r.width < 2 || Math.abs(c.width - Math.round(r.width * dpr)) <= 1;
  });
}

/** 把 #chart 内所有 canvas 按位置拼到一张图上，返回 { out, bright, ready } */
function composeCanvas(host) {
  const hr = host.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvases = [...host.querySelectorAll('canvas')];
  if (!canvases.length || hr.width < 2) return null;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(hr.width * dpr));
  out.height = Math.max(1, Math.round(hr.height * dpr));
  const ctx = out.getContext('2d');
  const bgVar = getComputedStyle(document.documentElement).getPropertyValue('--chart-bg').trim();
  ctx.fillStyle = bgVar || '#03070d';
  ctx.fillRect(0, 0, out.width, out.height);
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    try {
      ctx.drawImage(c, Math.round((r.x - hr.x) * dpr), Math.round((r.y - hr.y) * dpr),
        Math.round(r.width * dpr), Math.round(r.height * dpr));
    } catch { /* 不可读 canvas 跳过 */ }
  }
  // 采样亮度：全黑说明抓到的是重绘前的空画布（全画面稀疏采样，避免只看顶部空白区）
  const px = ctx.getImageData(0, 0, out.width, out.height).data;
  let bright = 0;
  const stepX = Math.max(1, Math.floor(out.width / 160));
  const stepY = Math.max(1, Math.floor(out.height / 100));
  for (let y = 0; y < out.height; y += stepY) {
    for (let x = 0; x < out.width; x += stepX) {
      const i = (y * out.width + x) * 4;
      if (Math.max(px[i], px[i + 1], px[i + 2]) > 80) bright++;
    }
  }
  return { out, bright, ready: canvasReady(host) };
}

/**
 * 窗口截图：把图表区 + 顶部信息条（品种/周期/区间）+ 底部状态条拼成一张 PNG，
 * 用于「截屏当前窗口并复制到剪贴板」。纯前端，不依赖系统截屏权限。
 */
export async function captureWindowShot(host, meta = {}) {
  const r = composeCanvas(host);
  if (!r || r.bright < 6) return null;
  const dpr = window.devicePixelRatio || 1;
  const padX = Math.round(16 * dpr);
  const headH = Math.round(46 * dpr);
  const footH = Math.round(30 * dpr);
  const W = r.out.width, H = r.out.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H + headH + footH;
  const ctx = out.getContext('2d');

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#03070d';
  const line = 'rgba(255,255,255,.075)';
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#edf7fc';
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#94a9bb';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(r.out, 0, headH);

  // 顶部信息条
  const title = meta.title || 'TraderTrain';
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(15 * dpr)}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, padX, headH / 2);

  const sub = [meta.symbol, meta.period, meta.range].filter(Boolean).join('  ·  ');
  if (sub) {
    ctx.fillStyle = dim;
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(sub, padX + ctx.measureText(title).width + Math.round(220 * dpr), headH / 2);
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.beginPath();
  ctx.moveTo(0, headH + 0.5);
  ctx.lineTo(out.width, headH + 0.5);
  ctx.stroke();

  // 底部状态条
  ctx.fillStyle = bg;
  ctx.fillRect(0, headH + H, out.width, footH);
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(0, headH + H + 0.5);
  ctx.lineTo(out.width, headH + H + 0.5);
  ctx.stroke();
  ctx.fillStyle = dim;
  ctx.font = `${Math.round(10 * dpr)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillText(meta.status || '', padX, headH + H + footH / 2);
  ctx.textAlign = 'right';
  ctx.fillText(meta.stamp || new Date().toLocaleString('zh-CN'), out.width - padX, headH + H + footH / 2);

  return await new Promise(res => out.toBlob(res, 'image/png'));
}

/** 截图：就绪时零等待；未就绪/空图最多重试 2 次（总等待 <300 ms） */
export async function captureChart(host, quality = 0.82) {
  let last = null;
  for (let i = 0; i < 8; i++) {
    const r = composeCanvas(host);
    if (!r) return null;
    last = r;
    if (r.ready && r.bright >= 6) break;
    // 空图：多半是后台标签页把重绘暂停了，主动触发一次 resize 让图表重画
    try { window.dispatchEvent(new Event('resize')); } catch {}
    await new Promise(res => setTimeout(res, r.ready ? 160 : 90));
  }
  if (!last || last.bright < 6) return null;
  const blob = await new Promise(res => last.out.toBlob(res, 'image/jpeg', quality));
  return blob && blob.size > 2000 ? blob : null;
}

/* ---------------- 场次存储 ---------------- */

export class SessionStore {
  async list() {
    const raw = (await kvGet(SESSIONS_KEY)) || [];
    return raw.map(b => ({
      period: null, startTs: null, tags: [], rating: 0,
      netProfit: 0, winRate: 0, profitFactor: 0, shots: 0,
      ...b
    }));
  }

  async get(id) { return kvGet(`session:${id}`); }

  async activeId() { return kvGet(ACTIVE_KEY); }
  async setActive(id) { await kvSet(ACTIVE_KEY, id); }

  async create({ symbol, name, period = null, startTs = null }) {
    const id = `S${Date.now().toString(36)}`;
    const s = {
      id, symbol, name: name || `场次 ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`,
      note: '', createdAt: Date.now(), endedAt: null, trades: [], shots: [],
      period, startTs, tags: [], rating: 0, conclusion: ''
    };
    await this.save(s);          // save 里会维护索引，不要再 push 一次（否则索引里出现两条同 id）
    await this.setActive(id);
    return s;
  }

  async save(session) {
    await kvSet(`session:${session.id}`, session);
    const list = await this.list();
    const i = list.findIndex(x => x.id === session.id);
    const st = computeStats(session.trades || []);
    const brief = {
      id: session.id, symbol: session.symbol, name: session.name,
      createdAt: session.createdAt, endedAt: session.endedAt,
      count: (session.trades || []).length,
      period: session.period || null, startTs: session.startTs || null,
      tags: session.tags || [], rating: session.rating || 0,
      netProfit: st.netProfit, winRate: st.winRate, profitFactor: Number.isFinite(st.profitFactor) ? st.profitFactor : 0,
      shots: (session.shots || []).length
    };
    if (i >= 0) list[i] = brief; else list.push(brief);
    await kvSet(SESSIONS_KEY, list);
    await this.setActive(session.id);
    return brief;
  }

  /** 只改档案元信息（标签、评分、结论、名称、周期、起点） */
  async updateMeta(id, patch = {}) {
    const s = await this.get(id);
    if (!s) return null;
    const keys = ['name', 'note', 'tags', 'rating', 'conclusion', 'period', 'startTs', 'endedAt'];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    }
    await this.save(s);
    return s;
  }

  async end(session) {
    session.endedAt = Date.now();
    await this.save(session);
    return session;
  }

  async remove(id) {
    const s = await this.get(id);
    if (s) for (const k of s.shots || []) { try { await delBlob(k.key); } catch {} }
    await kvSet(`session:${id}`, null);
    const list = (await this.list()).filter(x => x.id !== id);
    await kvSet(SESSIONS_KEY, list);
  }

  /** 保存截图并登记到 session.shots */
  async addShot(session, blob, meta = {}) {
    const key = `shot:${session.id}:${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    await putBlob(key, blob);
    const rec = { key, ...meta, at: Date.now(), bytes: blob.size };
    session.shots.push(rec);
    return rec;
  }

  async shotUrl(key) {
    const blob = await getBlob(key);
    return blob ? URL.createObjectURL(blob) : null;
  }

  async shotBytes(prefix = 'shot:') { return blobBytes(prefix); }
  async shotKeys(prefix = 'shot:') { return listBlobKeys(prefix); }
}
