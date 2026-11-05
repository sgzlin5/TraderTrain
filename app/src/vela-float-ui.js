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
    <div class="tt-float-row"><span class="tt-lb">模板</span><span id="ttTplChips" class="tt-swatches"></span>
      <button class="tt-act" id="ttTplSave" title="把当前样式存为模板">存</button></div>
    <div class="tt-float-row"><span class="tt-lb">颜色</span><span class="tt-swatches" id="ttSwatches"></span>
      <input type="color" id="ttColorPick" title="自定义颜色" style="width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.2);background:none"></div>
    <div class="tt-float-row"><span class="tt-lb">线宽</span><span id="ttWidths"></span></div>
    <div class="tt-float-row"><span class="tt-lb">线型</span><span id="ttStyles"></span>
      <button class="tt-act" id="ttFillBtn" title="填充开关" hidden>填充</button></div>
    <div class="tt-float-row"><span class="tt-lb">操作</span><button class="tt-act tt-danger" id="ttDel">删除</button></div>`;
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
  el.querySelector('#ttDel').onclick = () => {
    try { meta.chart.drawings.remove(meta.id); } catch {}
    el.hidden = true;
  };
  // —— 模板区（TradingView 式：存当前样式为命名模板 / 点击应用 / × 删） ——
  const TKEY = 'vela:toolTemplates';
  const persist = () => {
    try {
      const all = meta.chart.drawings.toolTemplates() || {};
      import('./db.js').then(({ kvSet }) => kvSet(TKEY, all)).catch(() => {});
    } catch {}
  };
  const renderTpls = () => {
    const box = el.querySelector('#ttTplChips');
    box.innerHTML = '';
    let tpls = [];
    try { tpls = meta.chart.drawings.toolTemplates()[meta.type] || []; } catch {}
    for (const t of tpls) {
      const b = document.createElement('button');
      b.className = 'tt-tpl'; b.textContent = t.name; b.title = '点击应用到当前绘图，Shift+点击删除';
      b.onclick = (e) => {
        if (e.shiftKey) {
          try {
            const all = meta.chart.drawings.toolTemplates() || {};
            all[meta.type] = (all[meta.type] || []).filter(x => x.name !== t.name);
            meta.chart.drawings.setToolTemplates(all);
            renderTpls(); persist();
          } catch {}
          return;
        }
        try { meta.chart.drawings.update(meta.id, JSON.parse(JSON.stringify(t.settings))); } catch (err) { console.warn('[tt-float:tpl]', err?.message); }
      };
      box.appendChild(b);
    }
  };
  el.querySelector('#ttTplSave').onclick = () => {
    const name = prompt('模板名称：');
    if (!name) return;
    try {
      // 公开层无 saveToolTemplate——读 toolTemplates() 改后整灌 setToolTemplates
      const all = meta.chart.drawings.toolTemplates() || {};
      const arr = (all[meta.type] || []).filter(t => t.name !== name);
      all[meta.type] = [...arr, { name, settings: { style: JSON.parse(JSON.stringify(meta.style || {})) } }];
      meta.chart.drawings.setToolTemplates(all);
      renderTpls(); persist();
    } catch (e) { console.warn('[tt-float:save]', e?.message); }
  };
  meta.renderTpls = renderTpls;
  meta.persist = persist;
  return { el, meta };
}

function buildFavoritesFloat() {
  let el = document.getElementById('ttFavFloat');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ttFavFloat';
  el.className = 'tt-favbar';
  el.innerHTML = `<div class="tt-fav-row" id="ttFavRow"></div>
    <div class="tt-fav-picker" id="ttFavPick" hidden></div>`;
  document.getElementById('chart').appendChild(el);
  el.querySelector('.tt-x').onclick = () => {
    const row = el.querySelector('#ttFavRow');
    row.style.display = row.style.display === 'none' ? '' : 'none';
  };
  return el;
}

/** 旧版样式模板迁移（一次性）：ui:drawTemplates（klinecharts 命名）→ Vela toolTemplates。
 *  线样式映射 line{color,size,style} → style{lineColor,lineWidth,lineStyle}；
 *  斐波那契 levels 暂不迁移（Vela 侧 props 结构不同，后续批次）。 */
export async function migrateLegacyTemplates(chart) {
  try {
    const { loadTemplateStore } = await import('./drawStyles.js');
    const { TOOL_MAP } = await import('./vela-draw.js');
    const store = await loadTemplateStore();
    const tpls = store?.templates || {};
    const out = chart.drawings.toolTemplates() || {};
    let n = 0;
    for (const [toolKey, list] of Object.entries(tpls)) {
      const type = TOOL_MAP[toolKey];
      if (!type) continue;
      const conv = (list || [])
        .filter(t => t?.name && t.line?.color)
        .map(t => ({
          name: t.name,
          settings: { style: { lineColor: t.line.color, lineWidth: t.line.size || 1, lineStyle: t.line.style || 'solid' } }
        }));
      if (!conv.length) continue;
      const cur = out[type] || [];
      const names = new Set(cur.map(x => x.name));
      for (const c of conv) if (!names.has(c.name)) { cur.push(c); n++; }
      out[type] = cur;
    }
    if (n) {
      chart.drawings.setToolTemplates(out);
      const { kvSet } = await import('./db.js');
      await kvSet('vela:toolTemplates', out);   // 迁移结果入 kv，跨会话保留
    }
    return n;
  } catch (e) { console.warn('[tt-float:migrate]', e?.message); return 0; }
}

/** 模板持久化恢复（每格图表 mount 后调）：kv 里的 toolTemplates JSON 整体回灌 */
export async function restoreToolTemplates(chart) {
  try {
    const { kvGet } = await import('./db.js');
    const saved = await kvGet('vela:toolTemplates');
    if (saved && typeof saved === 'object' && Object.keys(saved).length) {
      chart.drawings.setToolTemplates(saved);
    }
  } catch (e) { console.warn('[tt-float:restore]', e?.message); }
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
    styleBox.meta.type = dw.type;
    if (styleBox.meta.renderTpls) styleBox.meta.renderTpls();
    styleBox.el.hidden = false;
  };

  chart.on('drawing:selected', ({ id }) => { if (!id) styleBox.el.hidden = true; else showStyle(id); });
  chart.on('drawing:edited', ({ id }) => { if (id && id === styleBox.meta.id) showStyle(id); });
  chart.on('drawing:created', () => window.__TT_SMC_KICK?.());

  const iconOf = (type) => {
    try { return V.getDrawingType?.(type)?.icon || ''; } catch { return ''; }
  };
  const renderFavs = () => {
    const row = favBox.querySelector('#ttFavRow');
    let favs = [];
    try { favs = chart.drawings.favorites() || []; } catch {}
    row.innerHTML = '';
    if (!favs.length) {
      row.innerHTML = '<span class="tt-hint">点 ＋ 添加收藏工具</span>';
      return;
    }
    let cur = null;
    try { cur = chart.drawings.getTool?.(); } catch {}
    for (const type of favs) {
      const b = document.createElement('button');
      b.className = 'tt-fav-icon' + (cur === type ? ' active' : '');
      b.title = labelOf(type) + '（右键取消收藏）';
      b.innerHTML = iconOf(type) || labelOf(type);
      b.onclick = () => { try { chart.drawings.setTool(cur === type ? null : type); } catch {} };
      b.oncontextmenu = (e) => { e.preventDefault(); try { chart.drawings.setFavorite(type, false); } catch {} };
      row.appendChild(b);
    }
  };
  renderFavs();
  chart.on('drawing:favorites', () => renderFavs());
  chart.on('drawing:tool', () => renderFavs());

  const pick = favBox.querySelector('#ttFavPick');
  favBox.querySelector('#ttFavAdd').onclick = () => {
    if (!pick.hidden) { pick.hidden = true; return; }
    let types = [];
    try { types = V.drawingTypes?.() || []; } catch {}
    let favs = [];
    try { favs = chart.drawings.favorites() || []; } catch {}
    pick.innerHTML = types.map((t) => {
      const on = favs.includes(t);
      return '<button class="tt-pick-icon' + (on ? ' on' : '') + '" data-t="' + t + '" title="' + labelOf(t) + '">'
        + '<span class="tt-pick-ic">' + (iconOf(t) || labelOf(t)) + '</span><span class="tt-pick-star">' + (on ? '★' : '☆') + '</span></button>';
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
