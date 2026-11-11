import { labelZh } from './vela-locale-zh.js';
// 收藏工具条（官方 drawings API 驱动，原生风格）
// - Vela 0.9.3 原生只有「收藏数据面」（工具 flyout 里的星标 + drawing:favorites 事件 + setFavorites），
//   没有收藏工具条 UI，所以这条自绘；几何/配色直接借用原生 .vela-dtb 的 chrome（adoptNativeChrome）
// - 收藏 / 样式模板都是图表实例内存态，宿主不落盘就跨会话（Ctrl+R）丢失 → wirePrefsPersistence 落 kv
// - 样式模板的存/用/删走官方原生入口：选中绘图 ⚙ 设置弹窗里的「样式」菜单，不自绘属性框
// 清空按钮图标（与原生 .vela-dpop 图标同款描边风格）
const CLEAR_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
  + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/></svg>';

const FAV_KEY = 'vela:drawingFavorites';
const TPL_KEY = 'vela:toolTemplates';
const DEF_KEY = 'vela:toolDefaults';
// 原生 chrome 用到的 CSS 变量（dr() 把主题写进每个原生子树的根元素，这里手动搬）
const VELA_VARS = ['--vela-bg', '--vela-surface', '--vela-fg', '--vela-fg-muted', '--vela-fg-bright', '--vela-fg-faint',
  '--vela-border', '--vela-border-strong', '--vela-hover', '--vela-hover-strong', '--vela-active', '--vela-highlight',
  '--vela-radius-md', '--vela-radius-lg', '--vela-shadow', '--vela-font-family', '--vela-font-size-md',
  '--vela-font-size-sm', '--vela-dur-fast', '--vela-ease', '--vela-z-menu'];

function copyVelaVars(el, src) {
  if (!el || !src) return;
  const cs = window.getComputedStyle(src);
  for (const v of VELA_VARS) {
    const val = cs.getPropertyValue(v).trim();
    if (val) el.style.setProperty(v, val);
  }
  if (!el.style.getPropertyValue('--vela-bg') && cs.backgroundColor) el.style.setProperty('--vela-bg', cs.backgroundColor);
  if (!el.style.getPropertyValue('--vela-surface') && cs.backgroundColor) el.style.setProperty('--vela-surface', cs.backgroundColor);
  const bd = cs.borderTopColor || cs.borderRightColor;
  if (bd && !el.style.getPropertyValue('--vela-border')) el.style.setProperty('--vela-border', bd);
}

/** 把原生绘图工具栏的 chrome（背景/边框/色板/圆角/阴影等 CSS 变量）搬到自绘条上，
 *  再按工具栏右边缘定位 —— 和原生工具栏同源，换主题一起变。 */
function adoptNativeChrome(el, chartEl) {
  const tb = document.querySelector('.vela-dtb');
  if (!el || !chartEl || !tb) return;
  copyVelaVars(el, tb);
  const box = tb.getBoundingClientRect();
  const host = chartEl.getBoundingClientRect();
  if (box.width) el.style.left = Math.round(box.right - host.left + 6) + 'px';   // 贴原生工具栏右侧（宽度随折叠变）
}

/** 「清空所有画图」共享动作：原生没有这个入口，用 removeMany（一步删除，可撤销）。
 *  两步确认；收藏条按钮与左侧工具栏底部按钮共用同一 armed 状态与标题。 */
function clearAllController(chart) {
  const s = chart.__ttClear || (chart.__ttClear = { armedAt: 0, btns: new Set() });
  const count = () => { try { return (chart.drawings.toJSON().drawings || []).length; } catch { return 0; } };
  const paint = () => {
    const n = count();
    const armed = !!s.armedAt && n > 0;
    for (const b of s.btns) {
      b.classList.toggle('empty', n === 0);   // 不用 disabled：disabled 按钮收不到 pointerenter，撤销后状态会卡死
      b.classList.toggle('confirm', armed);
      b.title = armed ? `再点一次：清空全部 ${n} 个画图（可撤销）` : (n ? `清空所有画图（${n} 个）` : '没有画图');
    }
  };
  const disarm = () => { s.armedAt = 0; paint(); };
  const hit = () => {
    const ids = (() => { try { return (chart.drawings.toJSON().drawings || []).map((d) => d.id); } catch { return []; } })();
    if (!ids.length) { paint(); return; }
    if (!s.armedAt) {
      s.armedAt = Date.now();
      paint();
      setTimeout(() => { if (s.armedAt && Date.now() - s.armedAt > 2000) disarm(); }, 2200);
      return;
    }
    try { chart.drawings.removeMany(ids); } catch (e) { console.warn('[tt-draw:clear]', e?.message); }
    disarm();
  };
  const attach = (btn) => {
    if (!btn || s.btns.has(btn)) return;
    s.btns.add(btn);
    btn.addEventListener('click', (e) => { e.stopPropagation(); hit(); });
    btn.addEventListener('pointerenter', () => paint());   // 撤销/重做等无事件的路径，靠悬停刷新
    paint();
  };
  return { attach, paint };
}

/** 左侧原生绘图工具栏底部（折叠按钮上方）插「清空所有画图」，造型同 .vela-dtb-btn */
function wireToolbarClear(chart) {
  if (chart.__ttTbClearWired) return;
  chart.__ttTbClearWired = true;
  const clear = clearAllController(chart);
  const inject = (tb) => {
    if (!tb || tb.querySelector('.tt-dtb-clear')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vela-dtb-btn tt-dtb-clear';
    btn.innerHTML = '<span class="vela-dtb-hit">' + CLEAR_ICON + '</span>';
    // 放在折叠按钮之后 → 贴在工具栏最底部（折叠态下原生只留 collapse，本按钮随之隐藏）
    const collapse = tb.querySelector('.vela-dtb-collapse');
    if (collapse) collapse.after(btn); else tb.appendChild(btn);
    clear.attach(btn);
  };
  inject(document.querySelector('.vela-dtb'));
  try {
    // 工具栏会被原生重建 → 盯着 #chart；但每次 DOM 变化都 querySelector 太浪费（图例/标记会频繁改动），
    // 用一帧去抖再注入。
    let queued = 0;
    const mo = new window.MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => { queued = 0; inject(document.querySelector('.vela-dtb')); });
    });
    const host = document.getElementById('chart');
    if (host) mo.observe(host, { childList: true, subtree: true });
  } catch {}
}

function buildFavoritesFloat() {
  let el = document.getElementById('ttFavFloat');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ttFavFloat';
  el.className = 'tt-favbar';
  el.innerHTML = `<div class="tt-fav-row" id="ttFavRow"></div>
    <button class="tt-fav-add" id="ttFavAdd" title="添加收藏工具">＋</button>
    <span class="tt-fav-sep"></span>
    <button class="tt-fav-icon tt-fav-clear" id="ttFavClear" title="清空所有画图">${CLEAR_ICON}</button>
    <div class="tt-fav-picker" id="ttFavPick" hidden></div>`;
  document.getElementById('chart').appendChild(el);
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
      await kvSet(TPL_KEY, out);   // 迁移结果入 kv，跨会话保留
    }
    return n;
  } catch (e) { console.warn('[tt-float:migrate]', e?.message); return 0; }
}

/** 收藏 / 模板持久化（每格图表挂一次）：都是实例内存态，事件一到就落 kv。
 *  与 UI 解耦 —— 工具条坏了收藏照样不丢。 */
export function wirePrefsPersistence(chart) {
  if (!chart?.drawings || chart.__ttPrefsWired) return;
  chart.__ttPrefsWired = true;
  chart.on('drawing:favorites', () => {
    try {
      const favs = chart.drawings.favorites() || [];
      import('./db.js').then(({ kvSet }) => kvSet(FAV_KEY, favs)).catch(() => {});
    } catch {}
  });
  chart.on('drawing:templates', () => {
    try {
      const tpls = chart.drawings.toolTemplates() || {};
      import('./db.js').then(({ kvSet }) => kvSet(TPL_KEY, tpls)).catch(() => {});
    } catch {}
  });
  // 工具默认样式（原生画一笔改了颜色/宽度 → 下次同类工具沿用）：也是内存态
  chart.on('drawing:defaults', () => {
    try {
      const def = chart.drawings.toolDefaults() || {};
      import('./db.js').then(({ kvSet }) => kvSet(DEF_KEY, def)).catch(() => {});
    } catch {}
  });
}

/** 收藏恢复（boot 时）：kv → setFavorites */
export async function restoreFavorites(chart) {
  try {
    const { kvGet } = await import('./db.js');
    const saved = await kvGet(FAV_KEY);
    if (Array.isArray(saved) && saved.length) chart.drawings.setFavorites(saved);
  } catch (e) { console.warn('[tt-fav:restore]', e?.message); }
}

/** 模板持久化恢复（每格图表 mount 后调）：kv 里的 toolTemplates JSON 整体回灌 */
export async function restoreToolTemplates(chart) {
  try {
    const { kvGet } = await import('./db.js');
    const saved = await kvGet(TPL_KEY);
    if (saved && typeof saved === 'object' && Object.keys(saved).length) {
      chart.drawings.setToolTemplates(saved);
    }
  } catch (e) { console.warn('[tt-float:restore]', e?.message); }
}

/** 工具默认样式恢复（boot 时）：kv → setToolDefaults */
export async function restoreToolDefaults(chart) {
  try {
    const { kvGet } = await import('./db.js');
    const saved = await kvGet(DEF_KEY);
    if (saved && typeof saved === 'object' && Object.keys(saved).length) {
      chart.drawings.setToolDefaults(saved);
    }
  } catch (e) { console.warn('[tt-def:restore]', e?.message); }
}

// ---------------- 选中绘图悬浮条（.vela-dpop）的「模板」入口 ----------------
// 原生模板只藏在 ⚙ 设置弹窗的「样式」菜单里；悬浮条本身没有入口。
// 这里往原生条里插一个同款按钮（同尺寸/同 class/同图标体积），点开自绘菜单 —— 菜单直接用原生
// .vela-menu 皮肤，配色变量从 .vela-dpop 身上搬（copyVelaVars），所以跟原生完全同源。
// TV 同款「模板」图标：3×3 方块网格（不是书签 —— 书签在本项目语义里是收藏）
const TPL_ICON = (() => {
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    cells.push('<rect x="' + (3 + c * 6.4) + '" y="' + (3 + r * 6.4) + '" width="4.4" height="4.4" rx="1"/>');
  }
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' + cells.join('') + '</svg>';
})();

/** 取一个绘图的「可复用样式」（对齐原生 Xh()：style + text(去 value) + props） */
function templateSettings(doc) {
  const s = { style: { ...(doc?.style || {}) } };
  if (doc?.text) { const { value: _v, ...rest } = doc.text; s.text = rest; }
  if (doc?.props) s.props = JSON.parse(JSON.stringify(doc.props));
  return s;
}

function buildTplMenu() {
  let el = document.getElementById('ttTplMenu');
  if (el) return el;
  el = document.createElement('ul');
  el.id = 'ttTplMenu';
  el.className = 'tt-tpl-menu';
  el.hidden = true;
  document.getElementById('chart').appendChild(el);
  return el;
}

/** 与原生 WT() 同源的样式预设（线类 / 形状类），颜色取 SDK 的 BULLISH/BEARISH/NEUTRAL */
const PRESET_LINE_TYPES = new Set(['trendline', 'ray', 'extendedline', 'hline', 'hray', 'vline', 'crossline', 'infoline', 'trendangle']);
const PRESET_SHAPE_TYPES = new Set(['box', 'rotatedrect', 'ellipse', 'circle', 'triangle', 'parallelchannel', 'disjointchannel', 'flattopbottom']);

function presetStyles(type, V = {}) {
  const up = V.BULLISH || '#089981';
  const down = V.BEARISH || '#f23645';
  const mid = V.NEUTRAL || '#787b86';
  if (PRESET_LINE_TYPES.has(type)) {
    return [
      { name: '支撑', settings: { style: { lineColor: up, lineWidth: 2, lineStyle: 'solid' } } },
      { name: '阻力', settings: { style: { lineColor: down, lineWidth: 2, lineStyle: 'solid' } } },
      { name: '投射', settings: { style: { lineColor: mid, lineWidth: 1, lineStyle: 'dashed' } } },
    ];
  }
  if (PRESET_SHAPE_TYPES.has(type)) {
    return [
      { name: '需求区', settings: { style: { lineColor: up, fillColor: up + '26' } } },
      { name: '供给区', settings: { style: { lineColor: down, fillColor: down + '26' } } },
    ];
  }
  return [];
}

/** 悬浮条「样式」菜单：预设 + 我的模板 + 保存 + 重置（= 原生 ⚙ 弹窗里那个「样式⌄」的同款内容，
 *  但不必打开整个设置弹窗）。点条目即时套用到当前绘图。 */
function renderTplMenu(menu, chart, doc, onClose) {
  const type = doc.type;
  const V = window.VelaSDK || {};
  let tpls = [];
  try { tpls = (chart.drawings.toolTemplates() || {})[type] || []; } catch {}
  const presets = presetStyles(type, V);
  const cur = templateSettings(doc);

  // 只比较候选里出现的字段（预设只有 style，模板可能带 text/props）
  const matches = (cand) => {
    const proj = { style: cur.style };
    if (cand.text) proj.text = cur.text;
    if (cand.props) proj.props = cur.props;
    return JSON.stringify(proj) === JSON.stringify(cand);
  };

  menu.innerHTML = '';

  const head = document.createElement('li');
  head.className = 'tt-tpl-item tt-tpl-head';
  head.innerHTML = '<span class="tt-tpl-label">' + labelZh(type) + ' · 样式</span>';
  menu.appendChild(head);

  const section = (text) => {
    const el = document.createElement('li');
    el.className = 'tt-tpl-item tt-tpl-section';
    el.textContent = text;
    menu.appendChild(el);
  };

  const mkRow = (name, settings, deletable) => {
    const li = document.createElement('li');
    const isActive = matches(settings);
    li.className = 'tt-tpl-item' + (isActive ? ' on' : '');
    li.title = isActive ? '当前样式就是这个' : '点击套用到当前绘图';

    const dot = document.createElement('span');
    dot.className = 'tt-tpl-dot';
    dot.style.background = settings?.style?.lineColor || settings?.style?.fillColor || 'transparent';

    const lb = document.createElement('span');
    lb.className = 'tt-tpl-label';
    lb.textContent = name;

    const mark = document.createElement('span');
    mark.className = 'tt-tpl-check';
    mark.textContent = isActive ? '✓' : '';

    li.append(dot, lb, mark);

    if (deletable) {
      const x = document.createElement('span');
      x.className = 'tt-tpl-del';
      x.title = '删除模板';
      x.textContent = '✕';
      x.onclick = (e) => {
        e.stopPropagation();
        // 公开面没有 removeToolTemplate/saveToolTemplate（仅控制器内部有）→ 整体回灌 setToolTemplates
        try {
          const all = chart.drawings.toolTemplates() || {};
          const list = (all[type] || []).filter((it) => it.name !== name);
          if (list.length) all[type] = list; else delete all[type];
          chart.drawings.setToolTemplates(all);
        } catch (err) { console.warn('[tt-tpl:del]', err?.message); }
        renderTplMenu(menu, chart, doc, onClose);
      };
      li.appendChild(x);
    }

    li.onclick = () => {
      try { chart.drawings.update(doc.id, JSON.parse(JSON.stringify(settings || {}))); } catch (e) { console.warn('[tt-tpl:apply]', e?.message); }
      onClose?.();
    };
    return li;
  };

  if (presets.length) {
    section('预设');
    for (const p of presets) menu.appendChild(mkRow(p.name, p.settings, false));
  }

  section('我的模板');
  if (!tpls.length) {
    const empty = document.createElement('li');
    empty.className = 'tt-tpl-item tt-tpl-empty';
    empty.innerHTML = '<span class="tt-tpl-label">暂无模板，先存一个</span>';
    menu.appendChild(empty);
  } else {
    for (const t of tpls) menu.appendChild(mkRow(t.name, t.settings, true));
  }

  const sep = document.createElement('li');
  sep.className = 'tt-tpl-sep';
  menu.appendChild(sep);

  const save = document.createElement('li');
  save.className = 'tt-tpl-item tt-tpl-save-row';
  const inp = document.createElement('input');
  inp.className = 'tt-tpl-name';
  inp.placeholder = '样式名';
  inp.maxLength = 24;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tt-tpl-save';
  btn.textContent = '保存当前';
  const doSave = () => {
    const name = (inp.value || '').trim();
    if (!name) { inp.focus(); return; }
    try {
      const all = chart.drawings.toolTemplates() || {};
      const arr = (all[type] || []).filter((x) => x.name !== name);
      all[type] = [...arr, { name, settings: templateSettings(doc) }];
      chart.drawings.setToolTemplates(all);
    } catch (e) { console.warn('[tt-tpl:save]', e?.message); }
    inp.value = '';
    renderTplMenu(menu, chart, doc, onClose);
  };
  btn.onclick = (e) => { e.stopPropagation(); doSave(); };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') doSave(); };
  save.append(inp, btn);
  menu.appendChild(save);

  const reset = document.createElement('li');
  reset.className = 'tt-tpl-item tt-tpl-reset';
  reset.textContent = '重置为默认';
  reset.onclick = () => {
    let def = null;
    try { def = V.getDrawingType?.(type)?.defaultStyle || null; } catch {}
    if (def) { try { chart.drawings.update(doc.id, { style: JSON.parse(JSON.stringify(def)) }); } catch (e) { console.warn('[tt-tpl:reset]', e?.message); } }
    onClose?.();
  };
  menu.appendChild(reset);
}

/** 往 .vela-dpop 插「模板」按钮（条每次打开都是新建 DOM → 用 MutationObserver 补插） */
function wireDpopTemplates(chart, chartEl) {
  if (!chartEl || chart.__ttTplWired) return;
  chart.__ttTplWired = true;
  const menu = buildTplMenu();
  let selId = null;
  let openDoc = null;                                  // 菜单当前对应的绘图（模板变化时就地重画）
  const close = () => { menu.hidden = true; openDoc = null; };
  const docOf = (id) => {
    try { return chart.drawings.toJSON().drawings.find((x) => x.id === id) || null; } catch { return null; }
  };

  const openMenu = (dpop, doc) => {
    openDoc = doc;
    copyVelaVars(menu, dpop);
    renderTplMenu(menu, chart, doc, close);
    menu.hidden = false;
    const host = chartEl.getBoundingClientRect();
    const a = dpop.getBoundingClientRect();
    menu.style.left = Math.round(a.left - host.left) + 'px';
    menu.style.top = Math.round(Math.max(4, a.top - host.top - menu.offsetHeight - 6)) + 'px';
  };

  const inject = (dpop) => {
    if (!dpop || dpop.querySelector('.tt-dpop-tpl-btn')) return;   // 按钮在行容器里，不能用 :scope >
    const row = dpop.firstElementChild;
    if (!row || !row.querySelector('.vela-dpop-grip')) return;   // 只认「选中工具条」那一行
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vela-dpop-btn tt-dpop-tpl-btn';
    btn.title = '样式：预设 / 我的模板 / 保存当前 / 重置为默认';
    btn.innerHTML = TPL_ICON;
    btn.style.cssText = `width:30px;height:30px;display:flex;align-items:center;justify-content:center;`
      + `cursor:pointer;border:none;border-radius:5px;padding:0;color:inherit;background:transparent;`;
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu.hidden) { close(); return; }
      const doc = docOf(selId);
      if (!doc) return;
      btn.dataset.active = '1';
      openMenu(dpop, doc);
    });
    // 位置对齐 TV：紧跟拖动柄（第 2 位），而不是吊在 ⋮ 前
    const grip = row.querySelector('.vela-dpop-grip');
    row.insertBefore(btn, grip && grip.nextSibling ? grip.nextSibling : null);
  };

  chart.on('drawing:selected', ({ id, ids }) => {
    selId = (ids && ids.length ? ids[0] : id) || null;
    close();
    const b = chartEl.querySelector('.tt-dpop-tpl-btn');
    if (b) delete b.dataset.active;
  });
  chart.on('drawing:edited', close);
  // 模板增删后原地重画（不关菜单：刚存的样式要能立刻看到）
  chart.on('drawing:templates', () => {
    if (!menu.hidden && openDoc) renderTplMenu(menu, chart, openDoc, close);
  });

  try {
    const mo = new window.MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const dpop = n.matches?.('.vela-dpop') ? n : n.querySelector?.('.vela-dpop');
          if (dpop) inject(dpop);
        }
      }
      if (!chartEl.querySelector('.vela-dpop')) close();
    });
    mo.observe(chartEl, { childList: true, subtree: true });
  } catch {}
  chartEl.querySelectorAll('.vela-dpop').forEach(inject);

  // 菜单内的指针事件在冒泡到 document 前掐断（冒泡阶段，不能再早）：
  // 原生 popup 在 document 上装了 onOutside，一点菜单就会把整条悬浮条关掉、菜单跟着消失、点击落空。
  for (const evt of ['pointerdown', 'mousedown', 'click', 'touchstart']) {
    menu.addEventListener(evt, (e) => { e.stopPropagation(); });
  }
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || e.target.closest?.('.tt-dpop-tpl-btn')) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/** 接线收藏工具条（每格图表调一次；条是全局单例，事件按来源图表路由） */
export function wireDrawingFloatingUI(app) {
  const chart = app.chart;
  if (!chart?.drawings || chart.__ttFloatWired) return;
  chart.__ttFloatWired = true;
  const V = window.VelaSDK || {};
  const chartEl = document.getElementById('chart');
  const labelOf = (type) => labelZh(type);   // zh-Hans 包查表（i18n descriptor 用法绕开）

  let favBox = null;
  try { favBox = buildFavoritesFloat(); } catch (e) { console.warn('[tt-fav:build]', e?.message); }
  wirePrefsPersistence(chart);
  wireDpopTemplates(chart, chartEl);
  wireToolbarClear(chart);
  chart.on('drawing:created', () => window.__TT_SMC_KICK?.());
  if (!favBox) return;

  const iconOf = (type) => {
    try { return V.getDrawingType?.(type)?.icon || ''; } catch { return ''; }
  };
  const renderFavs = () => {
    adoptNativeChrome(favBox, chartEl);
    const row = favBox.querySelector('#ttFavRow');
    if (!row) return;
    let favs = [];
    try { favs = chart.drawings.favorites() || []; } catch {}
    let cur = null;
    try { cur = chart.drawings.getTool?.(); } catch {}
    row.innerHTML = '';
    if (!favs.length) {
      row.innerHTML = '<span class="tt-hint">点 ＋ 添加收藏工具</span>';
      return;
    }
    for (const type of favs) {
      const b = document.createElement('button');
      b.className = 'tt-fav-icon' + (cur === type ? ' active' : '');
      b.dataset.t = type;
      b.title = labelOf(type) + '（右键取消收藏）';
      b.innerHTML = iconOf(type) || labelOf(type);
      b.onclick = () => { try { chart.drawings.setTool(cur === type ? null : type); } catch {} };
      b.oncontextmenu = (e) => { e.preventDefault(); try { chart.drawings.setFavorite(type, false); } catch {} };
      row.appendChild(b);
    }
  };

  try {
    renderFavs();
    chart.on('drawing:favorites', () => renderFavs());
    chart.on('drawing:tool', () => renderFavs());

    // —— 清空所有画图（原生没有一键清空；左侧工具栏底部 + 收藏条共用同一控制） ——
    const clearCtl = clearAllController(chart);
    clearCtl.attach(favBox.querySelector('#ttFavClear'));
    chart.on('drawing:created', () => clearCtl.paint());
    chart.on('drawing:edited', () => clearCtl.paint());

    const pick = favBox.querySelector('#ttFavPick');
    const addBtn = favBox.querySelector('#ttFavAdd');
    addBtn.onclick = () => {
      if (!pick.hidden) { pick.hidden = true; return; }
      let types = [];
      try {
        // drawingTypes() 返回 meta 对象（ResolvedDrawingTypeMeta），不是 type 字符串
        types = (V.drawingTypes?.() || []).map((x) => (typeof x === 'string' ? x : x?.type)).filter(Boolean);
      } catch {}
      let favs = [];
      try { favs = chart.drawings.favorites() || []; } catch {}
      pick.innerHTML = types.map((t) => {
        const on = favs.includes(t);
        return '<button class="tt-pick-icon' + (on ? ' on' : '') + '" data-t="' + t + '" title="' + labelOf(t) + '">'
          + (iconOf(t) || labelOf(t)) + '<span class="tt-pick-star">' + (on ? '★' : '☆') + '</span></button>';
      }).join('');
      pick.hidden = false;
    };
    // 选择器用事件委托：按钮是动态 innerHTML 生成的（类名 .tt-pick-icon）
    pick.onclick = (e) => {
      const b = e.target.closest?.('.tt-pick-icon');
      if (!b) return;
      const t = b.dataset.t;
      try {
        const cur = chart.drawings.favorites() || [];
        chart.drawings.setFavorite(t, !cur.includes(t));
      } catch {}
      renderFavs();
      let on = false;
      try { on = (chart.drawings.favorites() || []).includes(t); } catch {}
      b.classList.toggle('on', on);
      const star = b.querySelector('.tt-pick-star');
      if (star) star.textContent = on ? '★' : '☆';
    };
    // 点条外/按 Esc 关选择器
    document.addEventListener('pointerdown', (e) => {
      if (pick.hidden) return;
      if (favBox.contains(e.target)) return;
      pick.hidden = true;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pick.hidden) pick.hidden = true; });
    try {
      new window.MutationObserver(() => adoptNativeChrome(favBox, chartEl))
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    } catch {}
  } catch (e) { console.warn('[tt-fav:wire]', e?.message); }
}
