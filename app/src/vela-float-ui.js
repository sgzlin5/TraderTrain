import { labelZh } from './vela-locale-zh.js';
// 悬浮属性框 + 收藏工具框（官方 drawings API 驱动；R14 自绘层同期的自定义 UI）
// - 样式属性框：drawing:selected 时弹出，颜色/线宽/线型/填充/副本/锁定/删除，
//   变更经 chart.drawings.update(id, {style}) 即时生效（drawing:edited 触发既有落盘）
// - 收藏工具框：rendering drawing:favorites，点击武装工具；＋ 打开全部工具收藏选择器
const STYLE_SWATCHES = ['#5fe3c0', '#ff6f85', '#ffc36b', '#8adeff', '#b6efff', '#ffffff', '#c084fc', '#94a9bb'];

function buildStyleFloat() {
  let el = document.getElementById('ttStyleFloat');
  if (el) return { el, meta: el.__meta };
  el = document.createElement('div');
  el.id = 'ttStyleFloat';
  el.className = 'tt-float';
  el.hidden = true;
  el.innerHTML = `
    <div class="tt-float-head"><b id="ttStyleTitle">绘图</b><button class="tt-x" title="关闭">✕</button></div>
    <div class="tt-float-row"><span class="tt-lb">颜色</span><span class="tt-swatches" id="ttSwatches"></span>
      <input type="color" id="ttColorPick" title="自定义颜色" style="width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.2);background:none"></div>
    <div class="tt-float-row"><span class="tt-lb">线宽</span><span id="ttWidths"></span></div>
    <div class="tt-float-row"><span class="tt-lb">线型</span><span id="ttStyles"></span>
      <button class="tt-act" id="ttFillBtn" title="填充开关" hidden>填充</button></div>
    <div class="tt-float-row"><span class="tt-lb">操作</span>
      <button class="tt-act" id="ttDup">副本</button><button class="tt-act" id="ttLock">锁定</button>
      <button class="tt-act tt-danger" id="ttDel">删除</button></div>`;
  document.getElementById('chart').appendChild(el);
  const meta = (el.__meta = { chart: null, id: null, style: null, locked: false, fillable: false });
  el.querySelector('.tt-x').onclick = () => { el.hidden = true; };
  const upd = (patch) => {
    if (!meta.chart || !meta.id) return;
    try { meta.chart.drawings.update(meta.id, patch); } catch (e) { console.warn('[tt-float]', e?.message); }
  };
  const sw = el.querySelector('#ttSwatches');
  for (const c of STYLE_SWATCHES) {
    const b = document.createElement('button');
    b.className = 'tt-sw';
    b.style.background = c;
    b.title = c;
    b.onclick = () => upd({ style: { ...meta.style, lineColor: c } });
    sw.appendChild(b);
  }
  el.querySelector('#ttColorPick').oninput = (e) => upd({ style: { ...meta.style, lineColor: e.target.value } });
  const wd = el.querySelector('#ttWidths');
  for (const w of [1, 2, 3, 4]) {
    const b = document.createElement('button');
    b.className = 'tt-act';
    b.textContent = w;
    b.onclick = () => upd({ style: { ...meta.style, lineWidth: w } });
    wd.appendChild(b);
  }
  const st = el.querySelector('#ttStyles');
  for (const [name, v] of [['实线', 'solid'], ['虚线', 'dashed'], ['点线', 'dotted']]) {
    const b = document.createElement('button');
    b.className = 'tt-act';
    b.textContent = name;
    b.onclick = () => upd({ style: { ...meta.style, lineStyle: v } });
    st.appendChild(b);
  }
  const fillBtn = el.querySelector('#ttFillBtn');
  fillBtn.onclick = () => {
    const cur = meta.style?.fillColor;
    upd({ style: { ...meta.style, fillColor: cur ? undefined : 'rgba(95,227,192,.14)' } });
  };
  el.querySelector('#ttDup').onclick = () => { try { meta.chart.drawings.clone(meta.id); } catch {} };
  el.querySelector('#ttLock').onclick = () => {
    try { meta.chart.drawings.lock(meta.id, !meta.locked); } catch {}
  };
  el.querySelector('#ttDel').onclick = () => {
    try { meta.chart.drawings.remove(meta.id); } catch {}
    el.hidden = true;
  };
  return { el, meta };
}

function buildFavoritesFloat() {
  let el = document.getElementById('ttFavFloat');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ttFavFloat';
  el.className = 'tt-float tt-fav';
  el.innerHTML = `<div class="tt-float-head"><b>★ 收藏工具</b>
    <button class="tt-act" id="ttFavAdd" title="添加/取消收藏">＋</button>
    <button class="tt-x" title="收起">—</button></div>
    <div class="tt-fav-row" id="ttFavRow"></div>
    <div class="tt-fav-picker" id="ttFavPick" hidden></div>`;
  document.getElementById('chart').appendChild(el);
  el.querySelector('.tt-x').onclick = () => {
    const row = el.querySelector('#ttFavRow');
    row.style.display = row.style.display === 'none' ? '' : 'none';
  };
  return el;
}

/** 接线悬浮框（每格图表调一次；框是全局单例，事件按来源图表路由） */
export function wireDrawingFloatingUI(app) {
  const chart = app.chart;
  if (!chart?.drawings || chart.__ttFloatWired) return;
  chart.__ttFloatWired = true;
  const V = window.VelaSDK || {};
  const styleBox = buildStyleFloat();
  const favBox = buildFavoritesFloat();
  const labelOf = (type) => labelZh(type);   // zh-Hans 包查表（i18n descriptor 用法绕开）

  const showStyle = (id) => {
    let dw = null;
    try { dw = chart.drawings.toJSON().drawings.find(x => x.id === id); } catch {}
    if (!dw) { styleBox.el.hidden = true; return; }
    styleBox.meta.chart = chart;
    styleBox.meta.id = id;
    styleBox.meta.style = dw.style || {};
    styleBox.meta.locked = !!dw.locked;
    styleBox.meta.fillable = ['box', 'rect', 'rotatedrect', 'position', 'callout'].includes(dw.type);
    styleBox.el.querySelector('#ttFillBtn').hidden = !styleBox.meta.fillable;
    const nm = styleBox.el.querySelector('#ttStyleTitle');
    if (nm) nm.textContent = labelOf(dw.type);
    styleBox.el.hidden = false;
  };

  chart.on('drawing:selected', ({ id }) => { if (!id) styleBox.el.hidden = true; else showStyle(id); });
  chart.on('drawing:edited', ({ id }) => { if (id && id === styleBox.meta.id) showStyle(id); });
  chart.on('drawing:created', () => window.__TT_SMC_KICK?.());

  const renderFavs = () => {
    const row = favBox.querySelector('#ttFavRow');
    let favs = [];
    try { favs = chart.drawings.favorites() || []; } catch {}
    row.innerHTML = '';
    if (!favs.length) {
      row.innerHTML = '<span class="tt-hint">在官方工具栏点 ★ 收藏后，工具会显示在这里</span>';
      return;
    }
    for (const type of favs) {
      const b = document.createElement('button');
      b.className = 'tt-fav-btn';
      b.textContent = labelOf(type);
      b.title = type;
      b.onclick = () => { try { chart.drawings.setTool(type); } catch {} };
      row.appendChild(b);
    }
  };
  renderFavs();
  chart.on('drawing:favorites', () => renderFavs());

  const pick = favBox.querySelector('#ttFavPick');
  favBox.querySelector('#ttFavAdd').onclick = () => {
    if (!pick.hidden) { pick.hidden = true; return; }
    let types = [];
    try { types = V.drawingTypes?.() || []; } catch {}
    let favs = [];
    try { favs = chart.drawings.favorites() || []; } catch {}
    pick.innerHTML = types.map((t) => {
      const on = favs.includes(t);
      return '<button class="tt-pick' + (on ? ' on' : '') + '" data-t="' + t + '">' + (on ? '★' : '☆') + ' ' + labelOf(t) + '</button>';
    }).join('');
    pick.hidden = false;
    pick.querySelectorAll('.tt-pick').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        const cur = chart.drawings.favorites() || [];
        chart.drawings.setFavorite(t, !cur.includes(t));
        renderFavs();
        favBox.querySelector('#ttFavAdd').click();
      };
    });
  };
}
