// SMC 类指标的“可见层”：klinecharts v10 不再调用 indicator.draw，
// 所以 BOS/CHoCH 线、订单块、EQH/EQL、以及结构面板都改由这里渲染：
//   · 图形 → overlay（horizontalSegment / rect / simpleAnnotation）
//   · 面板 → 悬浮在图表上的 DOM
import { payloadOf } from './smc.js';

const BULL = '#5fe3c0';
const BEAR = '#ff6f85';
const WARN = '#ffc36b';

const OV = { ids: [], sig: '' };
let panelEl = null;
let timer = null;

const colorOf = (dir) => (dir > 0 ? BULL : BEAR);

function ensurePanel(host) {
  if (panelEl && panelEl.isConnected) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'smcPanel';
  panelEl.className = 'smc-panel';
  panelEl.hidden = true;
  host.appendChild(panelEl);
  return panelEl;
}

function dropOverlays(chart) {
  for (const id of OV.ids) { try { chart.removeOverlay({ id }); } catch {} }
  OV.ids = [];
  OV.sig = '';
}

/** 结构事件 → overlay（线段 + 标签 + 订单块矩形） */
function drawMst(chart, list, p) {
  const ts = (i) => list[Math.max(0, Math.min(list.length - 1, i))]?.timestamp;
  const add = (args) => { try { const id = chart.createOverlay(args); if (id) OV.ids.push(id); } catch (e) { /* 单个元素失败不影响其它 */ } };

  for (const e of p.events || []) {
    const c = colorOf(e.dir);
    add({
      name: 'horizontalSegment',
      points: [{ timestamp: ts(e.from), value: e.price }, { timestamp: ts(e.i) }],
      styles: { line: { color: c, size: 1, style: 'dashed' } },
      lock: true, visible: true, zLevel: 3
    });
    add({
      name: 'simpleAnnotation',
      points: [{ timestamp: ts(e.i), value: e.price }],
      styles: { text: { color: c, size: 9, family: 'ui-monospace, Menlo, Consolas, monospace', backgroundColor: 'transparent' } },
      lock: true, visible: true, zLevel: 4
    });
    if (e.ob) {
      const to = e.ob.to != null ? e.ob.to : (p.n ? p.n - 1 : e.i);
      add({
        name: 'rect',
        points: [{ timestamp: ts(e.ob.from), value: e.ob.top }, { timestamp: ts(to), value: e.ob.bottom }],
        styles: { polygon: { color: e.ob.dir > 0 ? 'rgba(95,227,192,.14)' : 'rgba(255,111,133,.14)', borderColor: e.ob.dir > 0 ? 'rgba(95,227,192,.5)' : 'rgba(255,111,133,.5)', borderSize: 1, borderStyle: 'dashed' } },
        lock: true, visible: true, zLevel: 2
      });
    }
  }
  for (const q of p.eq || []) {
    add({
      name: 'horizontalSegment',
      points: [{ timestamp: ts(q.from), value: q.price }, { timestamp: ts(q.to != null ? q.to : list.length - 1) }],
      styles: { line: { color: WARN, size: 1, style: 'dashed' } },
      lock: true, visible: true, zLevel: 3
    });
  }
}

function renderPanel(p) {
  const el = panelEl;
  if (!el) return;
  if (!p) { el.hidden = true; return; }
  const rows = (p.rows || []).map(r => {
    const hiC = r.hi.trend > 0 ? 'pos' : r.hi.trend < 0 ? 'neg' : 'flat';
    const loC = r.lo.trend > 0 ? 'pos' : r.lo.trend < 0 ? 'neg' : 'flat';
    const same = r.hi.trend !== 0 && r.hi.trend === r.lo.trend;
    return `<tr>
      <td class="${hiC}">${r.hi.name} ${r.hi.trend > 0 ? '多' : r.hi.trend < 0 ? '空' : '震'}</td>
      <td class="${loC}">${r.lo.name} ${r.lo.trend > 0 ? '多' : r.lo.trend < 0 ? '空' : '震'}</td>
      <td>${same ? '✓' : '·'}</td>
    </tr>`;
  }).join('');
  const aligned = (p.rows || []).length > 0 && p.rows.every(r => r.hi.trend !== 0 && r.hi.trend === r.lo.trend);
  const st = p.struct || {};
  el.innerHTML = `
    <div class="smc-head"><b>结构 · 趋势</b><span class="${st.trend > 0 ? 'pos' : st.trend < 0 ? 'neg' : 'flat'}">${st.name || ''} ${st.trend > 0 ? '▲' : st.trend < 0 ? '▼' : '–'}</span></div>
    <table><thead><tr><th>HTF</th><th>LTF</th><th>对齐</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="smc-foot"><span>全周期对齐</span><span class="${aligned ? 'pos' : 'flat'}">${aligned ? '✓ 一致' : '不同步'}</span></div>`;
  el.hidden = false;
}

/** 每 1.2 s 同步一次（指标增删/数据推进都会反映出来） */
export function startSmcRender(state) {
  if (timer) return;
  const run = () => {
    const chart = state.app?.chart;
    if (!chart) return;
    let list = [];
    try { list = chart.getDataList() || []; } catch { return; }
    let mst = null, dash = null;
    try {
      for (const ind of chart.getIndicators() || []) {
        if (ind.name === 'SMC_MST') mst = payloadOf(ind);
        else if (ind.name === 'SMC_DASH') dash = payloadOf(ind);
      }
    } catch {}

    // 结构图形
    if (mst && list.length) {
      const sig = JSON.stringify({ n: mst.n, ev: (mst.events || []).map(e => [e.kind, e.from, e.i, !!e.ob]), eq: (mst.eq || []).map(q => [q.type, q.price, q.from]) });
      if (sig !== OV.sig) { dropOverlays(chart); drawMst(chart, list, mst); OV.sig = sig; }
    } else if (OV.ids.length) dropOverlays(chart);

    // 结构面板
    const host = document.getElementById('chart');
    if (host) { ensurePanel(host); renderPanel(dash); }
  };
  run();
  timer = setInterval(run, 1200);
}

export function stopSmcRender() {
  if (timer) { clearInterval(timer); timer = null; }
}
