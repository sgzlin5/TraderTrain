// 从 main.js 的「官方扩展工具（@klinecharts/extension 0.1.0） + 扩展工具弹层 + 悬浮工具栏：拖动 / 收起 + 绘图样式面板 + 绘图」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, FIB_DEFAULT_LEVELS, FIB_PRESETS, KEXT, LINE_STYLE_OPTIONS, OV_LABELS, SIZE_OPTIONS, TOOLS, TOOL_ACTIONS, defaultDrawStyles, hideOvBar, isMagnetOn, kvSet, markDirty, normalizeDrawStyles, openDrawMgr, placeAt, saveDrawStyles, state, themeLineColor, toggleMagnet, updateStatus } = ctx;

/* ---------------- 扩展工具弹层 ---------------- */

function renderMoreTools() {
  const grid = $('moreToolsGrid');
  if (!grid) return;
  const active = state.draw?.activeTool;
  grid.innerHTML = EXT_TOOLS.map(t => `<button data-ext="${t.key}" class="${active === t.key ? 'on' : ''}" title="${t.label}">${t.label}</button>`).join('');
  grid.querySelectorAll('[data-ext]').forEach(b => {
    b.onclick = () => {
      if (!state.draw) return;
      hideOvBar();
      state.draw.activate(b.dataset.ext);
      closeMoreTools();
      renderTools();
      $('toolHint').textContent = `绘制：${b.textContent}（按提示落点，Esc 取消）`;
    };
  });
}

function closeMoreTools() { $('moreTools').hidden = true; $('tools')?.classList.remove('mt-on'); }

function toggleMoreTools() {
  const el = $('moreTools');
  if (!el.hidden) { closeMoreTools(); return; }
  renderMoreTools();
  const host = $('tools').getBoundingClientRect();
  placeAt(el, Math.round(Math.min(host.left, window.innerWidth - 300)), Math.round(host.bottom + 8));
  el.hidden = false;
  document.addEventListener('mousedown', function onDoc(e) {
    if (el.hidden) { document.removeEventListener('mousedown', onDoc, true); return; }
    if (el.contains(e.target) || $('tools').contains(e.target)) return;
    closeMoreTools();
    document.removeEventListener('mousedown', onDoc, true);
  }, true);
}

/* ---------------- 官方扩展工具（@klinecharts/extension 0.1.0） ---------------- */

/** 扩展包里的 18 个 overlay：注册到全局，工具栏「更多」里可选 */
const EXT_TOOLS = [
  { key: 'measure', label: '测量' },
  { key: 'gannBox', label: '江恩箱' },
  { key: 'fibonacciExtension', label: '斐波那契扩展' },
  { key: 'fibonacciSegment', label: '斐波那契段' },
  { key: 'fibonacciCircle', label: '斐波那契圆' },
  { key: 'fibonacciSpeedResistanceFan', label: '速阻扇形' },
  { key: 'fibonacciSpiral', label: '斐波那契螺旋' },
  { key: 'abcd', label: 'AB=CD' },
  { key: 'xabcd', label: '蝴蝶 XABCD' },
  { key: 'threeWaves', label: '三浪' },
  { key: 'fiveWaves', label: '五浪' },
  { key: 'eightWaves', label: '八浪' },
  { key: 'anyWaves', label: '任意浪' },
  { key: 'arrow', label: '箭头' },
  { key: 'rect', label: '矩形' },
  { key: 'circle', label: '圆' },
  { key: 'triangle', label: '三角' },
  { key: 'parallelogram', label: '平行四边形' }
];

// 让「选中绘图」操作条也能显示扩展工具的中文名
try { EXT_TOOLS.forEach(t => { OV_LABELS[t.key] = t.label; }); } catch {}

let _extRegistered = false;
function registerExtensionOverlays() {
  if (_extRegistered) return 0;
  const K = window.klinecharts;
  if (!K || typeof K.registerOverlay !== 'function') return 0;
  let n = 0;
  for (const tpl of Object.values(KEXT)) {
    if (!tpl || typeof tpl !== 'object' || !tpl.name) continue;
    try { K.registerOverlay(tpl); n++; } catch (e) { console.warn('[ext]', tpl.name, e?.message); }
  }
  _extRegistered = true;
  return n;
}

/* ---------------- 绘图 ---------------- */

function renderTools() {
  const box = $('tools');
  if (!box) return;
  const d = state.draw;
  const active = d?.activeTool;
  const canUndo = !!(d && d.history && d.history.length);
  const canRedo = !!(d && d.future && d.future.length);
  box.innerHTML = `
    <button class="drag" data-act="drag" title="拖动工具栏">${'<i></i>'.repeat(6)}</button>
    <button data-act="magnet" class="${isMagnetOn() ? 'active' : ''}" title="吸附（落点对齐到开高低收）">${TOOL_ACTIONS.magnet}</button>
    <span class="tb-sep"></span>
    ${TOOLS.map((t, i) => `${i === TOOLS.length - 2 ? '<span class="tb-sep"></span>' : ''}<button data-tool="${t.key}" class="${active === t.key ? 'active' : ''}" title="${t.label}">${t.icon}</button>`).join('')}
    <span class="tb-sep"></span>
    <button data-act="undo" ${canUndo ? '' : 'disabled'} title="撤销">${TOOL_ACTIONS.undo}</button>
    <button data-act="redo" ${canRedo ? '' : 'disabled'} title="重做">${TOOL_ACTIONS.redo}</button>
    <button data-act="removeLast" title="删除最后一根绘图">${TOOL_ACTIONS.removeLast}</button>
    <button data-act="clear" title="清空当前周期的绘图">${TOOL_ACTIONS.clear}</button>
    <button data-act="manage" title="绘图管理（多选 / 批量删除）">▤</button>
    <button data-act="more" title="更多绘图工具（扩展包）">${TOOL_ACTIONS.more}</button>
    <button data-act="style" title="绘图样式">${TOOL_ACTIONS.style}</button>
    <span class="tb-sep"></span>
    <button data-act="collapse" title="${toolsState().mode === 'rail' ? '切回悬浮工具栏' : '收起到左侧工具栏'}">${toolsState().mode === 'rail' ? TOOL_ACTIONS.float : TOOL_ACTIONS.collapse}</button>
  `;

  // 图标按钮只有 title：补 aria-label，读屏/键盘才有名字（B1）
  box.querySelectorAll('button').forEach(b => {
    if (!b.getAttribute('aria-label')) {
      const label = b.getAttribute('title') || (b.dataset.tool ? (TOOLS.find(t => t.key === b.dataset.tool)?.label || '') : '');
      if (label) b.setAttribute('aria-label', label);
    }
  });
  box.querySelector('[data-act="manage"]')?.addEventListener('click', () => openDrawMgr());
  box.querySelectorAll('button[data-tool]').forEach(b => {
    const t = TOOLS.find(x => x.key === b.dataset.tool);
    b.onclick = () => {
      if (!state.draw) return;
      hideOvBar();
      state.draw.activate(b.dataset.tool);
      renderTools();
      $('toolHint').textContent = b.dataset.tool === 'polyline'
        ? '绘制：折线（多次点击，双击/右键/回车结束，Esc 取消）'
        : `绘制：${t.label}（点两次完成，Esc 取消）`;
    };
  });
  box.querySelectorAll('button[data-act]').forEach(b => {
    const act = b.dataset.act;
    if (act === 'drag') return;
    b.onclick = () => {
      const d2 = state.draw;
      if (!d2) return;
      if (act === 'magnet') {
        const now = toggleMagnet();
        markDirty();
        renderTools();
        updateStatus(now ? '吸附已开：落点对齐开高低收' : '吸附已关');
        return;
      }
      if (act === 'undo') { d2.undo(); renderTools(); }
      else if (act === 'redo') { d2.redo(); renderTools(); }
      else if (act === 'removeLast') { d2.removeLast(); renderTools(); }
      else if (act === 'clear') { d2.clear(); renderTools(); }
      else if (act === 'more') { toggleMoreTools(); }
      else if (act === 'style') {
        if ($('drawStylePanel').hidden) openDrawStylePanel(); else closeDrawStylePanel();
      }
      else if (act === 'collapse') {
        const next = toolsState().mode === 'rail' ? 'float' : 'rail';
        setToolsMode(next);
        updateStatus(next === 'rail' ? '工具栏已贴到左侧，用工具栏里的切换按钮可切回悬浮' : '工具栏已悬浮');
      }
    };
  });
  if (!active) $('toolHint').textContent = '';
}

/* ---------------- 绘图样式面板 ---------------- */

function toHexColor(v) {
  return /^#[0-9a-f]{6}$/i.test(v || '') ? v : themeLineColor();
}

function renderDrawStylePanel() {
  const st = state.drawStyles || defaultDrawStyles();
  const box = $('drawStyleRows');
  box.innerHTML = TOOLS.map(t => {
    const s = st[t.key] || {};
    return `<div class="ds-row">
      <span class="ds-name">${t.label}</span>
      <input type="color" class="swatch" data-color="${t.key}" value="${toHexColor(s.color)}" title="线条颜色">
      <select data-style="${t.key}" title="线型">${LINE_STYLE_OPTIONS.map(o => `<option value="${o.key}"${s.style === o.key ? ' selected' : ''}>${o.label}</option>`).join('')}</select>
      <select data-size="${t.key}" title="粗细">${SIZE_OPTIONS.map(n => `<option value="${n}"${Number(s.size) === n ? ' selected' : ''}>${n}px</option>`).join('')}</select>
      <button class="ds-reset" data-reset="${t.key}" title="恢复该工具默认">⟲</button>
    </div>`;
  }).join('');

  box.querySelectorAll('input[data-color]').forEach(el => {
    el.oninput = () => setDrawStyle(el.dataset.color, { color: el.value });
  });
  box.querySelectorAll('select[data-style]').forEach(el => {
    el.onchange = () => setDrawStyle(el.dataset.style, { style: el.value });
  });
  box.querySelectorAll('select[data-size]').forEach(el => {
    el.onchange = () => setDrawStyle(el.dataset.size, { size: Number(el.value) });
  });
  box.querySelectorAll('button[data-reset]').forEach(el => {
    el.onclick = () => {
      const key = el.dataset.reset;
      const d = defaultDrawStyles()[key];
      state.drawStyles[key] = { ...d };
      commitDrawStyles();
      renderDrawStylePanel();
    };
  });

  // 斐波那契层级
  const lv = st.fibonacciLine?.levels || FIB_DEFAULT_LEVELS;
  $('fibLevels').innerHTML = lv.map((n, i) =>
    `<span class="ds-chip"><b>${(n * 100).toFixed(1)}%</b><button data-lv="${i}" title="删除">×</button></span>`
  ).join('') || '<span class="pl-hint">没有层级</span>';
  $('fibLevels').querySelectorAll('button[data-lv]').forEach(b => {
    b.onclick = () => {
      const i = Number(b.dataset.lv);
      const next = lv.slice();
      next.splice(i, 1);
      if (!next.length) { updateStatus('至少保留一个层级', true); return; }
      state.drawStyles.fibonacciLine.levels = next;
      commitDrawStyles();
      renderDrawStylePanel();
    };
  });
  $('fibPresets').innerHTML = FIB_PRESETS.map((p, i) =>
    `<button class="btn ghost" data-preset="${i}">${p.label}</button>`).join('');
  $('fibPresets').querySelectorAll('button[data-preset]').forEach(b => {
    b.onclick = () => {
      const p = FIB_PRESETS[Number(b.dataset.preset)];
      state.drawStyles.fibonacciLine.levels = p.levels.slice();
      commitDrawStyles();
      renderDrawStylePanel();
    };
  });
}

function setDrawStyle(toolKey, patch) {
  state.drawStyles[toolKey] = { ...state.drawStyles[toolKey], ...patch };
  commitDrawStyles();
}

function commitDrawStyles() {
  state.drawStyles = normalizeDrawStyles(state.drawStyles);
  saveDrawStyles(state.drawStyles);
  // 已有绘图按新样式重画
  try { state.draw?.restore(); } catch {}
}

function addFibLevel() {
  const raw = $('fibLevelInput').value.trim();
  if (!raw) return;
  let v = Number(raw);
  if (!Number.isFinite(v)) { updateStatus('层级要填数字，例如 0.705 或 1.618', true); return; }
  if (v > 2 && v <= 200) v = v / 100;          // 允许直接输入 70.5 表示 70.5%
  if (v < -1 || v > 3) { updateStatus('层级范围建议 -100% ~ 300%', true); return; }
  const levels = (state.drawStyles.fibonacciLine.levels || []).slice();
  if (levels.some(n => Math.abs(n - v) < 1e-9)) { updateStatus('该层级已存在', true); return; }
  levels.push(v);
  levels.sort((a, b) => b - a);
  state.drawStyles.fibonacciLine.levels = levels.slice(0, 16);
  $('fibLevelInput').value = '';
  commitDrawStyles();
  renderDrawStylePanel();
}

function openDrawStylePanel() {
  renderDrawStylePanel();
  const el = $('drawStylePanel');
  if (!el.hidden) return;
  const r = $('tools').getBoundingClientRect();
  placeAt(el, Math.round(Math.min(r.left, window.innerWidth - 360)), Math.round(r.bottom + 8));
}

function closeDrawStylePanel() { $('drawStylePanel').hidden = true; }

function wireDrawStylePanel() {
  $('closeDrawStyle').onclick = closeDrawStylePanel;
  $('drawStyleDone').onclick = closeDrawStylePanel;
  $('fibLevelAdd').onclick = addFibLevel;
  $('fibLevelInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFibLevel(); });
  document.addEventListener('mousedown', (e) => {
    const el = $('drawStylePanel');
    if (el.hidden) return;
    if (el.contains(e.target) || $('tools').contains(e.target)) return;
    closeDrawStylePanel();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('drawStylePanel').hidden) closeDrawStylePanel();
  });
}

/* ---------------- 悬浮工具栏：拖动 / 收起 ---------------- */

function toolsState() {
  if (!state.tools) state.tools = { mode: 'float', x: null, y: null };
  if (!state.tools.mode) state.tools.mode = state.tools.hidden ? 'rail' : 'float';   // 兼容旧字段
  delete state.tools.hidden;
  return state.tools;
}

function saveTools() {
  kvSet('ui:tools', toolsState()).catch?.(() => {});
  markDirty();
}

/** 两种形态：float = 图表上方悬浮条（可拖动）；rail = 贴左侧竖排栏 */
function placeTools() {
  const box = $('tools');
  if (!box) return;
  const t = toolsState();
  const rail = t.mode === 'rail';
  box.hidden = false;
  box.classList.toggle('rail', rail);
  $('main').classList.toggle('has-rail', rail);
  if (rail) {
    box.classList.remove('dragged');
    box.style.left = '';
    box.style.top = '';
  } else if (t.x == null || t.y == null) {
    box.classList.remove('dragged');
    box.style.left = '';
    box.style.top = '';
  } else {
    box.classList.add('dragged');
    box.style.left = `${t.x}px`;
    box.style.top = `${t.y}px`;
  }
  if (state.app?.chart) { try { state.app.chart.resize(); } catch {} }
}

function setToolsMode(mode) {
  const t = toolsState();
  t.mode = mode === 'rail' ? 'rail' : 'float';
  placeTools();
  renderTools();
  saveTools();
}

function wireTools() {
  const box = $('tools');
  if (!box) return;

  box.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.drag');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const main = $('main').getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const offX = e.clientX - r.left;
    const offY = e.clientY - r.top;
    box.classList.add('dragging');
    const move = (ev) => {
      const x = Math.min(Math.max(0, ev.clientX - main.left - offX), main.width - r.width);
      const y = Math.min(Math.max(0, ev.clientY - main.top - offY), main.height - r.height);
      box.classList.add('dragged');
      box.style.left = `${Math.round(x)}px`;
      box.style.top = `${Math.round(y)}px`;
      toolsState().x = Math.round(x);
      toolsState().y = Math.round(y);
    };
    const up = () => {
      box.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveTools();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}


  return { closeMoreTools, registerExtensionOverlays, renderTools, toHexColor, openDrawStylePanel, wireDrawStylePanel, toolsState, placeTools, wireTools };
}
