// Pine 指标：粘贴源码 → 编译 → 注册成 KLineChart 指标（PineTS 运行时，AGPL，仅自用）
// 计算范围 = 当前窗口的 K 线；窗口变化/回放暂停时重算
import { kvGet, kvSet } from './db.js';
import { decimalsFor } from './instruments.js';
import { collectDrawings, drawPineDrawings } from './pineDraw.js';
import {
  hashStr, parseInputs, preprocessPine, scanCompat, toPineBars, toPineSeries, pickDrawings, runInThread
} from './pineCore.js';

// 兼容：这些名字以前从 pine.js 导出，自检脚本仍在用
export { hashStr, parseInputs, preprocessPine, scanCompat, toPineBars };

const LIB_KEY = 'pine:lib';
const MAP_KEY = 'pine:map';      // indName → {id, name}：刷新后还能认出是哪个脚本
const ACTIVE_KEY = 'pine:active'; // 已上图的脚本 id：刷新后自动恢复

export async function loadPineMap() { try { return (await kvGet(MAP_KEY)) || {}; } catch { return {}; } }
export async function loadPineActive() { try { return (await kvGet(ACTIVE_KEY)) || []; } catch { return []; } }

async function rememberPine(indName, entry) {
  const map = await loadPineMap();
  map[indName] = { id: entry.id, name: entry.name };
  await kvSet(MAP_KEY, map);
  const active = await loadPineActive();
  if (!active.includes(entry.id)) await kvSet(ACTIVE_KEY, [...active, entry.id]);
}

async function forgetPine(indName, id) {
  const map = await loadPineMap();
  delete map[indName];
  await kvSet(MAP_KEY, map);
  const active = (await loadPineActive()).filter(x => x !== id);
  await kvSet(ACTIVE_KEY, active);
}
const PALETTE = ['#f0b90b', '#4da3ff', '#ef5350', '#26a69a', '#ab47bc', '#ff9800', '#26c6da', '#d4e157'];

export const SAMPLE_PINE = `//@version=5
indicator("EMA 20/50", overlay=true)
e20 = ta.ema(close, 20)
e50 = ta.ema(close, 50)
plot(e20, "e20", color=color.yellow)
plot(e50, "e50", color=color.blue)
`;

let _PineTS = null;
async function getPineTS() {
  if (!_PineTS) {
    const m = await import('../vendor/pinets.min.browser.es.js');
    _PineTS = m.PineTS;
  }
  return _PineTS;
}

/** Worker：把 PineTS 执行挪出主线程（重脚本不再卡界面） */
let _pw = null;
let _pwSeq = 0;
const _pwPending = new Map();
let _pwBroken = false;

function pineWorker() {
  if (_pw || _pwBroken) return _pw;
  try {
    _pw = new Worker(new URL('./pineWorker.js', import.meta.url), { type: 'module' });
    _pw.onmessage = (e) => {
      const { id } = e.data || {};
      const slot = _pwPending.get(id);
      if (!slot) return;
      _pwPending.delete(id);
      clearTimeout(slot.timer);
      slot.resolve(e.data);
    };
    _pw.onerror = (err) => {
      // Worker 起不来（CSP / 老浏览器）：退回主线程，不再重试
      _pwBroken = true;
      for (const [, slot] of _pwPending) { clearTimeout(slot.timer); slot.resolve(null); }
      _pwPending.clear();
      console.warn('[pine worker]', err?.message || err);
    };
  } catch {
    _pwBroken = true;
    _pw = null;
  }
  return _pw;
}

function askWorker(payload, timeout = 15000) {
  const w = pineWorker();
  if (!w) return Promise.resolve(null);
  const id = ++_pwSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { _pwPending.delete(id); resolve(null); }, timeout);
    _pwPending.set(id, { resolve, timer });
    try { w.postMessage({ id, ...payload }); } catch { clearTimeout(timer); _pwPending.delete(id); resolve(null); }
  });
}

/** Worker 是否接管（自检可关掉，便于拿到 ctx） */
let _useWorker = true;
export function setPineWorker(on) { _useWorker = !!on; }
export function pineWorkerReady() { return !!_pw && !_pwBroken; }

export async function compilePine(src, bars, inputs = null, symbol = null) {
  const n = Math.max(1, bars?.length || 1);
  const pre = preprocessPine(src, bars);
  const pineBars = toPineBars(bars);
  const sym = symbol || bars?.symbol || 'PINE';

  if (_useWorker) {
    const r = await askWorker({ src: pre, bars: pineBars, inputs: inputs && Object.keys(inputs).length ? inputs : null, symbol: sym });
    if (r) {
      if (!r.ok) return { ok: false, error: String(r.error || '').slice(0, 400), line: r.line ?? null };
      return {
        ok: true, names: r.names || [], overlay: r.overlay !== false, series: r.series || {},
        title: r.title || 'PINE', plots: r.plots || null, strategy: r.strategy || null, alerts: r.alerts || [], viaWorker: true,
        ctx: { plots: r.plots || {}, strategy: r.strategy || null, pineVersion: r.pineVersion ?? null, alerts: r.alerts || [] }
      };
    }
    // Worker 不可用 / 超时 → 主线程兜底
  }

  const PineTS = await getPineTS();
  try {
    const out = await runInThread(PineTS, pre, pineBars, inputs, sym);
    return { ok: true, ...out, transpiledFn: out.ctx?.transpiledFn, viaWorker: false };
  } catch (e) {
    const msg = String(e && e.message || e);
    const m = msg.match(/line[^\d]*(\d+)/i) || msg.match(/at\s+(\d+):(\d+)/);
    return { ok: false, error: msg.slice(0, 400), line: m ? Number(m[1]) : null };
  }
}

/* ---------------- 回测专用执行通道 ----------------
   独立 worker：可取消、不会静默回退主线程（长回测降级主线程 = 页面假死）。
   载荷只回 strategy（series/plots 对回测没用，几十万根时那部分克隆足以把渲染进程顶死）。 */
export const BT_TIMEOUT_MS = 15 * 60_000;
let _btWorker = null;
let _btSeq = 0;
const _btPending = new Map();

function btWorker() {
  if (_btWorker) return _btWorker;
  _btWorker = new Worker(new URL('./pineWorker.js', import.meta.url), { type: 'module' });
  _btWorker.onmessage = (e) => {
    const { id, phase } = e.data || {};
    const slot = _btPending.get(id);
    if (!slot) return;
    if (phase === 'start') { try { slot.onPhase?.('compute'); } catch {} return; }
    _btPending.delete(id);
    clearTimeout(slot.timer);
    slot.resolve(e.data);
  };
  _btWorker.onerror = (err) => {
    for (const [, s] of _btPending) { clearTimeout(s.timer); s.resolve({ ok: false, error: `回测 worker 异常：${err?.message || err}` }); }
    _btPending.clear();
    try { _btWorker.terminate(); } catch {}
    _btWorker = null;
  };
  return _btWorker;
}

/** 取消当前回测（terminate worker：正在跑的脚本立即停下，不会有残包） */
export function cancelBacktest() {
  let n = 0;
  for (const [, s] of _btPending) { clearTimeout(s.timer); s.resolve({ ok: false, cancelled: true, error: '已取消' }); n++; }
  _btPending.clear();
  if (_btWorker) { try { _btWorker.terminate(); } catch {} _btWorker = null; }
  return n;
}

export function backtestBusy() { return _btPending.size > 0; }

/** 只跑策略（回测）：返回 {ok, strategy, ms, bars} */
export async function compileBacktest({ src, bars, inputs = null, symbol = null, timeoutMs = BT_TIMEOUT_MS, onPhase } = {}) {
  if (!bars || !bars.length) return { ok: false, error: '没有数据' };
  const pre = preprocessPine(src, bars);
  const pineBars = toPineBars(bars);
  const sym = symbol || 'PINE';
  try { onPhase?.('transfer'); } catch {}
  let w;
  try { w = btWorker(); } catch (e) { return { ok: false, error: `回测 worker 起不来：${e?.message || e}` }; }
  const id = ++_btSeq;
  const payload = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      _btPending.delete(id);
      resolve({ ok: false, error: `回测超时（${Math.round(timeoutMs / 1000)} s）` });
    }, timeoutMs);
    _btPending.set(id, { resolve, timer, onPhase });
    try {
      w.postMessage({ id, mode: 'backtest', src: pre, bars: pineBars, inputs: inputs && Object.keys(inputs).length ? inputs : null, symbol: sym });
    } catch (e) {
      clearTimeout(timer);
      _btPending.delete(id);
      resolve({ ok: false, error: `发送失败：${e?.message || e}` });
    }
  });
  if (payload?.cancelled) return { ok: false, cancelled: true, error: '已取消' };
  if (!payload?.ok) {
    const msg = String(payload?.error || '回测失败');
    return { ok: false, error: msg.slice(0, 400), line: payload?.line ?? null };
  }
  return { ok: true, strategy: payload.strategy || null, alerts: payload.alerts || [], pineVersion: payload.pineVersion ?? null, ms: payload.ms ?? null, bars: bars.length };
}

/* ---------------- 指标库（本地保存的脚本） ---------------- */

export async function libList() { return (await kvGet(LIB_KEY)) || []; }
export async function libSave(entry) {
  const list = await libList();
  const i = list.findIndex(x => x.id === entry.id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  await kvSet(LIB_KEY, list);
  return list;
}
export async function libRemove(id) {
  const list = (await libList()).filter(x => x.id !== id);
  await kvSet(LIB_KEY, list);
  return list;
}

/* ---------------- 挂到图表 ---------------- */

export class PineManager {
  constructor(chart) {
    this.chart = chart;
    this.symbol = null;   // 由外层在加载品种时设置，供 syminfo 用
    this.items = [];      // [{id, name, entry, names, series, overlay, indName}]
  }

  /** 用当前窗口数据算出序列；返回能否成功 */
  async compute(entry, bars, symbol = null) {
    const r = await compilePine(entry.src, bars, entry.inputs || null, symbol || this.symbol || null);
    if (!r.ok) return r;
    // 把绘图对象的原始记录一起带回去（表格/标签/方框/线）
    return { ok: true, names: r.names, series: r.series, overlay: r.overlay, title: r.title, plots: r.plots || r.ctx?.plots || null, alerts: r.alerts || [] };
  }

  /** 注册/刷新一个 Pine 指标（串行化：并发 apply 会互相删刚建好的指标，出现重复） */
  apply(entry, bars) {
    const prev = this._queue || Promise.resolve();
    const run = () => this._apply(entry, bars);
    this._queue = prev.then(run, run);
    return this._queue;
  }

  async _apply(entry, bars) {
    const K = window.klinecharts;
    const r = await this.compute(entry, bars);
    if (!r.ok) return r;

    const indName = `PINE_${hashStr(entry.src + JSON.stringify(entry.inputs || {}))}`;
    const tsIndex = new Map(bars.map((b, i) => [b.timestamp, i]));
    const store = new Map();      // timestamp -> {key: value}
    for (const n of r.names) {
      const arr = r.series[n];
      for (let i = 0; i < bars.length; i++) {
        const v = arr[i];
        if (v == null) continue;
        let o = store.get(bars[i].timestamp);
        if (!o) { o = {}; store.set(bars[i].timestamp, o); }
        o[n] = v;
      }
    }

    if (!this._registered) this._registered = new Set();
    // 运行时把表格/标签/方框/线记在伪序列里：收出来自己画
    const drawings = collectDrawings(r.plots || r.ctx?.plots);
    const figures = r.names.map((n, i) => ({ key: n, title: n, type: 'line' }));
    if (!figures.length) {
      // 纯绘图脚本没有数值输出，但模板必须有至少一个 figure 才会触发 draw
      figures.push({ key: '__none', title: '', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) });
    }
    const saved = Array.isArray(entry.lineStyles) ? entry.lineStyles : [];
    const lines = r.names.map((n, i) => {
      const st = saved[i] || {};
      return {
        color: st.hidden ? 'rgba(0,0,0,0)' : (st.color || PALETTE[i % PALETTE.length]),
        size: st.size ?? 1,
        style: st.style || 'solid'
      };
    });
    const template = {
      name: indName,
      shortName: entry.name.slice(0, 20),
      precision: 2,
      calcParams: [],
      shouldOhlc: false,
      styles: { lines },
      figures,
      calc: (dl) => dl.map(d => {
        const v = store.get(d.timestamp) || {};
        // 没有 plot 的脚本给占位 figure 一个在价格区间内的值，保证 klinecharts 会调用 draw
        return r.names.length ? v : { ...v, __none: d.close };
      }),
      draw: ({ ctx, chart, xAxis, yAxis }) => {
        try {
          drawPineDrawings(ctx, xAxis, yAxis,
            { labels: drawings.labels, boxes: drawings.boxes, lines: drawings.lines },
            chart?.getDataList?.() || []);
        } catch {}
        return true;
      }
    };
    try {
      K.registerIndicator(template);
      this._registered.add(indName);
    } catch { /* 同名已注册 */ }

    // 已存在就先移除，保证参数/数据变化后重画
    const exist = this.items.find(it => it.id === entry.id);
    if (exist) { try { this.chart.removeIndicator({ name: exist.indName }); } catch {} }
    try { this.chart.removeIndicator({ name: indName }); } catch {}

    const paneArg = r.overlay
      ? { name: indName, paneId: 'candle_pane' }
      : { name: indName };
    let indId = null;
    try { indId = this.chart.createIndicator(paneArg, true); } catch { indId = null; }
    // 同名残留（并发/恢复路径）只保留刚建的那条
    try {
      const dups = (this.chart.getIndicators() || []).filter(i => i.name === indName);
      if (dups.length > 1) {
        const keep = indId ? dups.find(i => i.id === indId) : dups[dups.length - 1];
        for (const d of dups) if (d !== keep) { try { this.chart.removeIndicator({ id: d.id }); } catch {} }
      }
    } catch {}

    rememberPine(indName, entry);
    // 表格用 DOM 渲染（canvas draw 在"数值全空"的指标上不会被调用）
    this._mountBoards(entry.id, drawings.tables);
    const rec = { id: entry.id, name: entry.name, indName, indId, names: r.names, overlay: r.overlay, lineStyles: lines,
                  drawings };
    this.items = this.items.filter(it => it.id !== entry.id).concat(rec);
    return { ok: true, indId, names: r.names, overlay: r.overlay, alerts: r.alerts || [] };
  }

  /** 把 Pine 的 table.* 画成 DOM 面板（贴图表角落，跟着主题走） */
  _mountBoards(id, tables) {
    const host = document.getElementById('chart');
    if (!host) return;
    const sel = `[data-pine-board="${id}"]`;
    host.querySelectorAll(sel).forEach(el => el.remove());
    if (!tables || !tables.length) return;
    for (const t of tables) {
      if (!t || !Array.isArray(t.cells) || !t.cells.length) continue;
      const el = document.createElement('div');
      el.className = 'pine-board';
      el.dataset.pineBoard = id;
      const pos = String(t.position || 'top_right');
      el.style.cssText = `position:absolute;z-index:6;pointer-events:none;`
        + (pos.includes('bottom') ? 'bottom:10px;' : 'top:10px;')
        + (pos.includes('right') ? 'right:12px;' : 'left:12px;')
        + `background:${t.bgcolor || 'rgba(8,14,22,.92)'};`
        + `border:1px solid ${t.frame_color || 'rgba(255,255,255,.12)'};border-radius:4px;`
        + `font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#dfe9f2;padding:2px 2px;`;

      const table = document.createElement('table');
      table.style.borderCollapse = 'collapse';
      const merges = t.merges || [];
      const skip = new Set();
      for (let r = 0; r < (t.rows || t.cells.length); r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < (t.columns || t.cells[r].length); c++) {
          if (skip.has(r + ':' + c)) continue;
          const cell = t.cells[r] && t.cells[r][c];
          const td = document.createElement('td');
          const m = merges.find(x => x.startRow === r && x.startCol === c);
          if (m) {
            td.colSpan = m.endCol - m.startCol + 1;
            td.rowSpan = m.endRow - m.startRow + 1;
            for (let rr = r; rr <= m.endRow; rr++) {
              for (let cc = c; cc <= m.endCol; cc++) if (!(rr === r && cc === c)) skip.add(rr + ':' + cc);
            }
          }
          const style = [];
          if (cell) {
            if (cell.text_color) style.push(`color:${cell.text_color}`);
            if (cell.bgcolor) style.push(`background:${cell.bgcolor}`);
            td.textContent = cell.text == null ? '' : String(cell.text);
            td.style.textAlign = cell.text_halign === 'left' ? 'left' : cell.text_halign === 'right' ? 'right' : 'center';
            const px = { tiny: 8, small: 9, normal: 10, large: 12, huge: 14 }[cell.text_size] || 10;
            style.push(`font-size:${px}px`);
          }
          style.push('padding:2px 8px', 'white-space:nowrap');
          td.style.cssText = style.join(';');
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      el.appendChild(table);
      host.appendChild(el);
    }
  }

  remove(id) {
    const it = this.items.find(x => x.id === id);
    if (!it) return;
    try { this.chart.removeIndicator({ name: it.indName }); } catch {}
    this._mountBoards(id, []);
    forgetPine(it.indName, id);
    this.items = this.items.filter(x => x.id !== id);
  }

  clear() {
    for (const it of this.items.slice()) this.remove(it.id);
  }

  list() {
    return this.items.map(it => ({
      id: it.id, name: it.name, indName: it.indName, names: it.names,
      overlay: it.overlay, lineStyles: it.lineStyles
    }));
  }

  /** 按 indName 找到挂图记录（设置面板用） */
  findByIndName(indName) { return this.items.find(it => it.indName === indName) || null; }
}
