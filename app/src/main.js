// 入口：装配 UI + 数据 + 图表 + 回放 + 绘图 + 交易 + 场次统计 + Pine 指标（M3）
import { PERIODS } from './aggregate.js';
import { CrosshairSync } from './crosshairSync.js';
import { summarize as summarizeStrategy, drawCurve } from './pineStrategy.js';
import { fmtPrice, fmtQty } from './instruments.js';
import { ChartApp } from './chart.js';
import { importProfile, loadManifest } from './loader.js';
import { deleteProfile, getProfiles, storageEstimate, MAX_IMPORT_BYTES, kvGet, kvSet } from './db.js';
import { startSmcRender } from './smcRender.js';
import { Replay } from './replay.js';
import { DrawLayer, TOOLS, TOOL_ACTIONS } from './draw.js';
import {
  loadDrawStyles, saveDrawStyles, normalizeDrawStyles, defaultDrawStyles,
  LINE_STYLE_OPTIONS, SIZE_OPTIONS, FIB_PRESETS, FIB_DEFAULT_LEVELS, themeLineColor,
  loadTemplateStore, saveTemplateStore, addTemplate, removeTemplate, setDefaultTemplate,
  defaultTemplateOf, templateOf, resolveToolStyles
} from './drawStyles.js';
import { registerFibOverlay } from './fibOverlay.js';
import { registerPositionOverlays } from './positionOverlay.js';
import { registerPolylineOverlay } from './polylineOverlay.js';
import { Workspace, LAYOUTS, layoutByKey } from './workspace.js';
import * as KEXT from '../vendor/klinecharts-extension/index.js';
import { registerSegmentOverlay } from './segmentOverlay.js';
import { isMagnetOn, loadMagnet, toggleMagnet, setMagnetOn, bindModifierKeys, isSnapActive } from './magnet.js';
import { loadConfigSnapshot, saveConfigSnapshot } from './config.js';
import { TradeSim } from './trade.js';
import {
  SessionStore, computeStats, tradesToCsv, sessionToJson, download, captureChart, captureWindowShot
} from './session.js';
import {
  PineManager, SAMPLE_PINE, parseInputs, libList, libSave, libRemove,
  loadPineMap, loadPineActive, scanCompat, compilePine
} from './pine.js';
import { DEFAULT_LAYOUT, normalize, loadLayout, saveLayout, applyLayout as chartApplyLayout, loadTheme, saveTheme, applyThemeMode, migrateLayoutColors, THEMES, themeMeta } from './theme.js';
import { buildChartTheme, indicatorPalette } from './chart.js';
import { fmtTs, fmtTsShort, fmtDay, fmtLocalInput } from './fmt.js';
import { install as install_TBOX } from './ui/toolsDraw.js';
import { install as install_THEME } from './ui/themeMenu.js';
import { install as install_DATA } from './ui/dataPanel.js';
import { install as install_CSV } from './ui/csvImport.js';
import { install as install_ARCH } from './ui/archive.js';
import { install as install_COPYDRAW } from './ui/copyDraw.js';
import { install as install_RPL } from './ui/replay.js';
import { install as install_SESS } from './ui/session.js';
import { install as install_TRADE } from './ui/trade.js';
import {
  builtinList, activeNames, toggleBuiltin, PANE_LAYOUTS, paneCount, applyPaneLayout, LABELS as IND_LABELS, CUSTOM_META,
  loadIndPrefs, saveIndPrefs, applyIndPrefs, OVERLAY_INDS,
  IND_CATS, loadFavs, saveFavs, loadCombos, saveCombos, saveComboFromChart, applyCombo, removeCombo
} from './indicators.js';

const $ = (id) => document.getElementById(id);
const MB = (n) => +(n / 1048576).toFixed(1);
// 全站统一时间口径：UTC，显式带时区（审计 P1-B3）

const store = new SessionStore();

const state = {
  manifest: null, profiles: [], app: null, profile: null, importing: null,
  replay: null, draw: null, trade: null, marks: [],
  session: null, sessions: [], pine: null, pineEntry: null, prevPos: null,
  layout: normalize(null), theme: 'dark', indCat: 'key', indQuery: '', layoutPanes: 1,
  tools: null, drawStyles: null, selOverlay: null, drawTemplates: null,
  arq: null, store: null, indPrefs: {},
  workspace: null, wsLayout: '1', wsPeriods: null,
  tabs: [], activeTab: null
};
window.__APP__ = state;
state.store = store;

const DEBUG = new URLSearchParams(location.search).has('debug');

/** 自检用：把会互相污染的运行态清干净（?fresh=1 时每个用例前执行） */
/** 超时兜不住就当它没完成（自检重置不能让页面卡死） */
function withTimeout(p, ms, tag) {
  return Promise.race([
    Promise.resolve(p).catch((e) => logErr(tag, e)),
    new Promise((res) => setTimeout(() => { logErr(tag, '超时 ' + ms + 'ms'); res(null); }, ms))
  ]);
}

async function resetForTest() {
  try {
    // 清“会被上一个用例改掉”的状态：绘图样式/模板、Pine 库与映射、回放开关
    // （主题、页签、布局属于用户偏好，不动）
    const keys = ['ui:replay', 'ind:prefs', 'ui:drawStyles', 'ui:drawTemplates', 'pine:lib', 'pine:active', 'pine:map'];
    for (const k of keys) { try { await kvSet(k, null); } catch (e) { logErr('reset:kv', e); } }
    // 画在图上/已落盘的绘图（draw:<symbol>:<period>）
    try {
      const dm = state.draw || state.app?.draw;
      if (dm) { dm.items = []; if (dm.persist) await withTimeout(dm.persist(), 1500, 'reset:draw'); }
    } catch (e) { logErr('reset:draw', e); }
    if (state.session) state.session.trades = [];
    if (state.trade) { state.trade.trades = []; state.trade.realized = 0; try { state.trade.orders?.forEach?.(o => (o.done = true)); } catch {} }
    try { window.__TT_RENDER_ALERTS__?.([], 'selftest'); } catch (e) { logErr('reset:alerts', e); }
    try { state.app?.chart?.getOverlays?.()?.forEach(o => { try { state.app.chart.removeOverlay({ id: o.id }); } catch {} }); } catch {}
    for (const n of ['SMC_FVG', 'SMC_MST', 'SMC_ICT', 'SMC_HTF', 'SMC_DASH']) { try { state.app?.chart?.removeIndicator({ name: n }); } catch {} }
    try { window.__TT_RENDER_SESSION__?.(); } catch {}
    if (state.app?.chart) await withTimeout(applyReplayMode(false, { silent: true }), 2000, 'reset:replay');
  } catch (e) { logErr('reset', e); }
}

/** 统一错误出口：默认 warn，?debug=1 时升级成 error（别再让 catch {} 把真 bug 吃掉） */
function logErr(where, e) {
  const text = `[${where}] ${(e && (e.stack || e.message)) || e}`;
  if (DEBUG) console.error(text); else console.warn(text);
  return text;
}

function msg(text, bad = false) {
  const el = $('importMsg');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}
function pineMsg(text, bad = false) {
  const el = $('pineMsg');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

/* ---------------- 周期 / 状态栏 ---------------- */

/* ---------------- 图表 TAB ---------------- */

const TAB_PERIODS = ['1m', '5m', '15m', '1h'];

function wsOptions(tabId = null) {
  return {
    onChange: () => TBOX.renderTools(),
    getStyles: () => resolveToolStyles(state.drawStyles, state.drawTemplates),
    onTick: (bar1m) => {
      state.trade?.onBar(bar1m);
      RPL.scheduleTick();
      if (++_pushedSincePine >= 120) { _pushedSincePine = 0; RPL.schedulePineRefresh(800); }
    },
    onState: (s) => { if (state.activeTab === state._tabOfReplay) { RPL.renderReplay(s); updateStatus(); } },
    onPickSymbol: (i) => openCellSymbolPicker(i),
    onCellsChanged: () => { syncTabSymbols(); saveTabs(); refreshLegend?.(); },
    onActive: (cell) => {
      if (!tabId || state.activeTab !== tabId) return;   // 只有当前 TAB 的激活变化才同步全局状态
      bindActiveCell();
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) { tab.period = cell.app.periodKey; saveTabs(); }
    }
  };
}

/** 分屏时点某格的品种标签 → 选这一格要看的品种 */
function openCellSymbolPicker(i) {
  const menu = $('cellSymMenu') || (() => {
    const el = document.createElement('div');
    el.id = 'cellSymMenu';
    el.className = 'ctx-menu cell-sym';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  })();

  const cur = state.workspace?.cells?.[i]?.profile?.symbol || '';
  const list = state.profiles || [];
  menu.innerHTML = `<div class="mi-head">第 ${i + 1} 格 · 选择品种</div>` + (list.length
    ? list.map(p => `<button class="mi" data-sym="${p.id}" ${p.symbol === cur ? 'data-on="1"' : ''}>
        <span class="nm">${p.symbol}</span><span class="sub">${p.bars.toLocaleString()} 根 · ${fmtDay(p.first)} → ${fmtDay(p.last)}</span></button>`).join('')
    : `<div class="mi-empty">只导入过一个品种。数据面板可以再导入别的品种（CSV / 下载）。</div>`);

  const tag = state.workspace.cells[i].el.querySelector('.cell-tag').getBoundingClientRect();
  menu.style.left = `${Math.round(tag.left)}px`;
  menu.style.top = `${Math.round(tag.bottom + 4)}px`;
  menu.hidden = false;

  menu.querySelectorAll('[data-sym]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const prof = list.find(p => p.id === b.dataset.sym);
      menu.hidden = true;
      if (!prof) return;
      updateStatus(`第 ${i + 1} 格切到 ${prof.symbol}…`);
      await state.workspace.setCellSymbol(i, prof);
      syncTabSymbols();
      await saveTabs();
      updateStatus(`第 ${i + 1} 格：${prof.symbol} · ${state.workspace.cells[i].app.periodKey.toUpperCase()}`);
    };
  });
  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.hidden = true;
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
}

/** 把每格品种写回当前 TAB（持久化用） */
function syncTabSymbols() {
  const t = state.tabs.find(x => x.id === state.activeTab);
  if (!t || !state.workspace) return;
  t.cellSymbols = state.workspace.cells.map(c => c.profile?.id || null);
}

async function createTab(opts = {}) {
  const id = opts.id || `T${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;
  const root = document.createElement('div');
  root.className = 'ws';
  root.dataset.tab = id;
  $('tabPark').appendChild(root);

  const ws = new Workspace(root, state.profile, wsOptions(id));
  const tab = {
    id,
    name: opts.name || `图表 ${state.tabs.length + 1}`,
    layout: opts.layout || '1',
    periods: Array.isArray(opts.periods) ? opts.periods : null,
    period: opts.period || null,
    cellSymbols: Array.isArray(opts.symbols) ? opts.symbols : null,
    ws, root
  };
  state.tabs.push(tab);
  const restoreProfiles = (tab.cellSymbols || []).map(id => (state.profiles || []).find(p => p.id === id) || null);
  await ws.applyLayout(tab.layout, { periods: tab.periods, profiles: restoreProfiles });
  if (tab.period && tab.period !== ws.cells[0].app.periodKey) {
    await ws.cells[0].app.switchPeriod(tab.period);
  }
  tab.period = ws.cells[0].app.periodKey;
  renderTabs();
  return tab;
}

function activateTab(id) {
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return false;
  state.activeTab = id;

  for (const t of state.tabs) {
    if (t === tab) { t.root.classList.add('active'); $('chart').appendChild(t.root); }
    else { t.root.classList.remove('active'); $('tabPark').appendChild(t.root); }
  }

  state.workspace = tab.ws;
  state.app = tab.ws.app;
  state.draw = tab.ws.draw;
  state.pine = tab.ws.pine;
  state.replay = tab.ws.multi;
  state.wsLayout = tab.layout;
  state.wsPeriods = tab.periods;
  state._tabOfReplay = id;
  if (state.replay) state.replay.setEmitter((s) => { RPL.renderReplay(s); updateStatus(); });

  applyChartThemeAll();
  applyThemePaneLayout();
  renderTabs();
  renderPeriods();
  TBOX.renderTools();
  renderPineApplied();
  RPL.renderReplay();
  updateStatus();
  setTimeout(() => { try { tab.ws.resizeAll(); } catch {} }, 60);
  return true;
}

async function closeTab(id) {
  const i = state.tabs.findIndex(t => t.id === id);
  if (i < 0) return false;
  if (state.tabs.length === 1) { updateStatus('至少保留一个图表'); return false; }
  const [tab] = state.tabs.splice(i, 1);
  try { tab.ws.multi?.pause(); } catch {}
  try { tab.ws.dispose(); } catch {}
  tab.root.remove();
  if (state.activeTab === id) activateTab(state.tabs[Math.max(0, i - 1)].id);
  saveTabs();
  renderTabs();
  return true;
}

/** 关闭指标库（✕ / Esc / 再次点按钮都走这里） */
function closeIndicatorPanel() {
  const el = $('indicatorPanel');
  if (!el) return;
  el.hidden = true;
  $('btnIndicator')?.classList.remove('on');
  // 搜索框复位，避免下次打开还是上次的过滤词
  const q = $('indSearch');
  if (q && q.value) { q.value = ''; state.indQuery = ''; }
}

function renderTabs() {
  const box = $('tabList');
  if (!box) return;
  // 行内改名且输入框正有焦点：整块 innerHTML 重建会把输入框连同已输入内容冲掉（实时刷新时最容易撞上）
  // 用“焦点”判断而不是标志位，避免异常路径下标志卡死把整个页签栏冻住
  const editing = box.querySelector('.tab-in');
  if (editing && document.activeElement === editing) return;
  box.innerHTML = state.tabs.map(t => {
    const p = t.period || (t.ws?.active?.app?.periodKey) || '1m';
    return `<div class="tab ${t.id === state.activeTab ? 'on' : ''}" data-tab="${t.id}" role="tab"
      tabindex="0" title="双击 / 右键 / F2 重命名">
      <span class="tab-name">${t.name}</span>
      <span class="tab-sub">${state.profile?.symbol || ''} · ${p.toUpperCase()}${t.layout !== '1' ? ` · ${layoutByKey(t.layout).label}` : ''}</span>
      <button class="tab-x" data-close="${t.id}" title="关闭">✕</button>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-tab]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('[data-close]') || e.target.closest('.tab-in')) return;
      const tab = state.tabs.find(t => t.id === el.dataset.tab);
      // 已激活的 tab：点名字即改名（像资源管理器那样），点其他地方不重复激活
      if (tab && tab.id === state.activeTab && e.target.closest('.tab-name')) {
        startTabRename(el, tab);
        return;
      }
      activateTab(el.dataset.tab);
    };
    // F2 / Enter（键盘聚焦时）改名；Delete 关闭
    el.onkeydown = (e) => {
      const tab = state.tabs.find(t => t.id === el.dataset.tab);
      if (!tab) return;
      if (e.key === 'F2' || (e.key === 'Enter' && !document.querySelector('.tab-in'))) {
        e.preventDefault(); startTabRename(el, tab);
      } else if (e.key === 'Delete' && state.tabs.length > 1) {
        e.preventDefault(); closeTab(tab.id);
      }
    };
    // 右键：重命名 / 关闭
    el.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tab = state.tabs.find(t => t.id === el.dataset.tab);
      if (tab) openTabMenu(e, el, tab);
    };
    el.ondblclick = (e) => {
      e.stopPropagation();
      const tab = state.tabs.find(t => t.id === el.dataset.tab);
      if (tab) startTabRename(el, tab);
    };
  });
  box.querySelectorAll('[data-close]').forEach(b => {
    // 用 mousedown：改名输入框失焦会重渲染整条 tab，click 就落空了
    let closing = false;
    const doClose = async () => {
      if (closing) return;
      closing = true;
      b.closest('.tab')?.querySelector('.tab-in')?.blur();
      await closeTab(b.dataset.close);
    };
    b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); doClose(); };
    // 程序化点击（自检/脚本）只有 click 没有 mousedown，用 detail===0 兜住
    b.onclick = (e) => { e.stopPropagation(); if (e.detail === 0) doClose(); };
  });
}

/** tab 右键菜单：重命名 / 关闭 / 新建 */
function openTabMenu(ev, el, tab) {
  const menu = $('tabMenu') || (() => {
    const m = document.createElement('div');
    m.id = 'tabMenu';
    m.className = 'ctx-menu tab-menu';
    m.hidden = true;
    document.body.appendChild(m);
    return m;
  })();
  menu.innerHTML = `
    <button class="mi" data-act="rename">重命名<span class="k">F2</span></button>
    <button class="mi" data-act="close" ${state.tabs.length < 2 ? 'disabled' : ''}>关闭这个图表</button>
    <button class="mi" data-act="new">新建图表</button>`;
  menu.style.left = `${Math.round(ev.clientX)}px`;
  menu.style.top = `${Math.round(ev.clientY)}px`;
  menu.hidden = false;

  menu.querySelector('[data-act="rename"]').onclick = () => {
    menu.hidden = true;
    startTabRename(el, tab);
  };
  menu.querySelector('[data-act="close"]').onclick = async () => {
    menu.hidden = true;
    if (state.tabs.length > 1) await closeTab(tab.id);
  };
  menu.querySelector('[data-act="new"]').onclick = async () => {
    menu.hidden = true;
    $('tabNew').click();
  };

  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.hidden = true;
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
}

/** 双击 tab → 行内改名（避免原生 prompt 阻塞渲染进程） */
function startTabRename(el, tab) {
  const nameEl = el.querySelector('.tab-name');
  if (!nameEl || el.querySelector('.tab-in')) return;
  const old = tab.name;
  const inp = document.createElement('input');
  inp.className = 'tab-in';
  inp.value = old;
  inp.maxLength = 20;
  inp.spellcheck = false;
  nameEl.style.display = 'none';
  nameEl.replaceWith(inp);
  inp.focus();
  inp.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const val = (inp.value || '').trim().slice(0, 20);
    if (commit && val && val !== old) {
      tab.name = val;
      saveTabs();
      updateStatus(`图表已改名为「${val}」`);
    }
    // 先把输入框摘掉再重建：否则它还带着焦点，renderTabs 的“编辑中不重建”守卫会把这次重绘吞掉
    try { inp.remove(); } catch {}
    renderTabs();
  };
  inp.onclick = (e) => e.stopPropagation();
  inp.ondblclick = (e) => e.stopPropagation();
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  inp.onblur = () => finish(true);
}

async function saveTabs() {
  const data = state.tabs.map(t => ({
    id: t.id, name: t.name, layout: t.layout,
    periods: t.ws ? t.ws.cells.map(c => c.app.periodKey) : t.periods,
    symbols: t.ws ? t.ws.cells.map(c => c.profile?.id || null) : t.cellSymbols,
    period: t.ws ? t.ws.cells[0]?.app.periodKey : t.period
  }));
  try { await kvSet('ui:tabs', data); } catch {}
}

function wireTabs() {
  renderTabs();
  $('tabNew').onclick = async () => {
    const used = new Set(state.tabs.map(t => (t.ws?.cells[0]?.app?.periodKey) || t.period));
    const nextPeriod = TAB_PERIODS.find(p => !used.has(p)) || '1m';
    const tab = await createTab({ name: `图表 ${state.tabs.length + 1}`, layout: '1', period: nextPeriod });
    activateTab(tab.id);
    await saveTabs();
    updateStatus(`新图表 ${tab.name} · ${nextPeriod.toUpperCase()}`);
  };
}

/* ---------------- 多图工作区辅助 ---------------- */

/** 所有格子的图表都套一遍图表主题 */
function applyChartThemeAll() {
  const st = buildChartTheme(state.theme);
  (state.workspace?.cells || []).forEach(c => { try { c.app.chart.setStyles(st); } catch {} });
}

/** 版面设置（涨跌色/网格/自定义底色）应用到所有格子 */
function applyThemePaneLayout() {
  (state.workspace?.cells || []).forEach(c => {
    try { chartApplyLayout(c.app.chart, state.layout); } catch {}
  });
}

/** 切到某一格：绘图/指标/交易/周期显示都跟着走 */
function bindActiveCell() {
  const ws = state.workspace;
  if (!ws) return;
  state.app = ws.app;
  state.draw = ws.draw;
  state.pine = ws.pine;
  hideOvBar();
  renderPeriods();
  TBOX.renderTools();
  renderPineApplied();
  updateStatus();
  if (ws.cells.length > 1) {
    const cell = ws.active;
    if (cell) cell.el.querySelector('.cell-tag').textContent = `${cell.profile?.symbol || state.profile?.symbol || ''} · ${cell.app.periodKey.toUpperCase()}`;
  }
}

function renderPeriods() {
  const nav = $('periods');
  nav.innerHTML = '';
  for (const p of PERIODS) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.key = p.key;
    b.className = p.key === state.app?.periodKey ? 'active' : '';
    b.onclick = async () => {
      if (!state.app) return;
      [...nav.children].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      hideOvBar();
      const t0 = performance.now();
      await state.app.switchPeriod(p.key);
      if (state.replay) state.replay.bucket = null;
      if (state.draw) { state.draw.periodKey = p.key; await state.draw.load(); }
      if (state.workspace) {
        const cell = state.workspace.active;
        if (cell) cell.el.querySelector('.cell-tag').textContent = `${cell.profile?.symbol || state.profile?.symbol || ''} · ${p.key.toUpperCase()}`;
        state.wsPeriods = state.workspace.cells.map(c => c.app.periodKey);
        kvSet('ui:split', { key: state.wsLayout, periods: state.wsPeriods });
        const t = state.tabs.find(x => x.id === state.activeTab);
        if (t) { t.period = p.key; saveTabs(); }
        renderTabs();
      }
      updateStatus(`切周期 ${p.label} · ${Math.round(performance.now() - t0)} ms`);
      markDirty();
      RPL.schedulePineRefresh();
    };
    nav.appendChild(b);
  }
}

function updateStatus(extra = '') {
  const app = state.app;
  if (!app) { $('stPeriod').textContent = '-'; $('stLoaded').textContent = '-'; $('stMsg').textContent = extra; return; }
  const list = app.chart.getDataList();
  $('stPeriod').textContent = `周期 ${app.periodKey}`;
  $('stLoaded').textContent = `已加载 ${list.length} 根 · 读窗 ${app.stats.lastMs} ms`;
  $('stMsg').textContent = extra;
}

/* ---------------- 选中绘图：浮动操作条 ---------------- */

const OV_LABELS = {
  segment: '趋势线', rayLine: '射线', horizontalStraightLine: '水平线', horizontalRayLine: '水平射线',
  priceLine: '价格线', fibonacciLine: '斐波那契', priceChannelLine: '平行通道', brush: '涂鸦',
  longPosition: '做多仓位', shortPosition: '做空仓位', polyline: '折线'
};

function chartRect() { return $('chart').getBoundingClientRect(); }

/** 覆盖层点位 → 图表内像素坐标（chart.convertToPixel 用的是图表左上角原点） */
function overlayPixels(o) {
  const chart = state.app?.chart;
  if (!chart) return [];
  const pts = (o.points || []).filter(p => p.timestamp != null && Number.isFinite(p.value));
  if (!pts.length) return [];
  try {
    const res = chart.convertToPixel(pts.map(p => ({ timestamp: p.timestamp, value: p.value })), { paneId: o.paneId });
    const arr = Array.isArray(res) ? res : [res];
    return arr.filter(a => a && Number.isFinite(a.x) && Number.isFinite(a.y));
  } catch { return []; }
}

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function hitOverlay(vx, vy) {
  const chart = state.app?.chart;
  if (!chart) return null;
  const r = chartRect();
  const px = vx - r.left, py = vy - r.top;
  let best = null, bestD = 9;
  for (const o of chart.getOverlays()) {
    const pts = overlayPixels(o);
    if (!pts.length) continue;
    let d = Math.min(...pts.map(p => Math.hypot(p.x - px, p.y - py)));
    for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSeg(px, py, pts[i], pts[i + 1]));
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function hideOvBar() {
  $('ovBar').hidden = true;
  $('ovMenu').hidden = true;
  state.selOverlay = null;
}

function showOvBar(o) {
  const chart = state.app?.chart;
  if (!chart || !o) return;
  state.selOverlay = o.id;
  const line = o.styles?.line || {};
  $('ovName').textContent = OV_LABELS[o.name] || o.name;
  $('ovColor').value = TBOX.toHexColor(line.color);
  const w = String(line.size ?? 1);
  if (![...$('ovWidth').options].some(op => op.value === w)) {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = `${w}px`;
    $('ovWidth').appendChild(opt);
  }
  $('ovWidth').value = w;

  const bar = $('ovBar');
  bar.hidden = false;
  const br = bar.getBoundingClientRect();
  const pts = overlayPixels(o);
  const r = chartRect();
  let x = window.innerWidth / 2, y = 130;
  if (pts.length) {
    const top = Math.min(...pts.map(p => p.y));
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    x = r.left + cx - br.width / 2;
    y = r.top + top - br.height - 10;
  }
  x = Math.min(Math.max(8, x), window.innerWidth - br.width - 8);
  y = Math.min(Math.max(8, y), window.innerHeight - br.height - 8);
  bar.style.left = `${Math.round(x)}px`;
  bar.style.top = `${Math.round(y)}px`;
}

/** 当前选中绘图对应的工具 key */
function selOverlayTool() {
  const o = state.app?.chart.getOverlays().find(x => x.id === state.selOverlay);
  return o ? o.name : null;
}

/** 渲染 ⋯ 菜单里的线型/模板列表 */
function renderOvMenu() {
  const tool = selOverlayTool();
  const o = state.app?.chart.getOverlays().find(x => x.id === state.selOverlay);
  const cur = o?.styles?.line?.style || 'solid';
  $('ovLs').querySelectorAll('.ov-chip').forEach(b => b.classList.toggle('on', b.dataset.ls === cur));
  $('ovTplSaveRow').hidden = true;

  const box = $('ovTplList');
  box.innerHTML = '';
  if (!tool) return;
  const list = state.drawTemplates?.templates?.[tool] || [];
  const defId = state.drawTemplates?.defaults?.[tool];
  if (!list.length) {
    box.innerHTML = '<div class="empty">还没有模板，点下面「保存为模板…」</div>';
    return;
  }
  for (const t of list) {
    const row = document.createElement('div');
    row.className = 'tpl';
    row.innerHTML = `<span class="dot" style="background:${t.line.color || themeLineColor()}"></span>
      <span class="nm">${t.name}</span>
      ${t.id === defId ? '<span class="badge2">默认</span>' : ''}
      <button class="del" title="删除模板">×</button>`;
    row.onclick = (e) => {
      if (e.target.classList.contains('del')) {
        state.drawTemplates = removeTemplate(state.drawTemplates, tool, t.id);
        markDirty();
        saveTemplateStore(state.drawTemplates);
        renderOvMenu();
        return;
      }
      applyTemplate(t, true);
    };
    box.appendChild(row);
  }
}

/** 把模板套到当前选中的绘图上，并可顺带设为该工具默认 */
function applyTemplate(tpl, makeDefault) {
  const id = state.selOverlay;
  const o = state.app?.chart.getOverlays().find(x => x.id === id);
  if (!o || !tpl) return;
  const line = { ...tpl.line };
  state.app.chart.overrideOverlay({ id, styles: { line } });
  if (o.name === 'fibonacciLine' && Array.isArray(tpl.levels) && tpl.levels.length) {
    state.app.chart.overrideOverlay({ id, extendData: { levels: tpl.levels.slice() } });
  }
  state.draw.capture();
  state.draw.persist();
  if (makeDefault) {
    state.drawTemplates = setDefaultTemplate(state.drawTemplates, o.name, tpl.id);
    markDirty();
    saveTemplateStore(state.drawTemplates);
  }
  renderOvMenu();
  refreshOvBar();
  updateStatus(`已应用模板「${tpl.name}」${makeDefault ? '（设为该工具默认）' : ''}`);
}

/** 应用该工具的默认模板（没有模板时回到全局样式） */
function applyDefaultTemplate(overlayId) {
  const o = state.app?.chart.getOverlays().find(x => x.id === overlayId);
  if (!o) return;
  const tpl = defaultTemplateOf(state.drawTemplates, o.name);
  if (tpl) { applyTemplate(tpl, false); return; }
  const st = state.draw.styleFor(o.name);
  state.app.chart.overrideOverlay({ id: overlayId, styles: st.styles });
  state.draw.capture();
  state.draw.persist();
  refreshOvBar();
  updateStatus('已恢复内置默认样式');
}

/** 把当前选中绘图的样式存成模板 */
function saveOverlayAsTemplate() {
  const tool = selOverlayTool();
  const o = state.app?.chart.getOverlays().find(x => x.id === state.selOverlay);
  if (!tool || !o) return;
  const nameRaw = $('ovTplName').value.trim();
  const list = state.drawTemplates?.templates?.[tool] || [];
  const name = nameRaw || `${OV_LABELS[tool] || tool} ${list.length + 1}`;
  const line = o.styles?.line || { color: '', size: 1, style: 'solid' };
  const tpl = {
    name,
    line: { color: line.color, size: line.size, style: line.style, dashedValue: line.dashedValue },
    ...(tool === 'fibonacciLine' && o.extendData?.levels ? { levels: o.extendData.levels.slice() } : {})
  };
  const { store, item } = addTemplate(state.drawTemplates, tool, tpl);
  state.drawTemplates = setDefaultTemplate(store, tool, item.id);
  markDirty();
  saveTemplateStore(state.drawTemplates);
  $('ovTplName').value = '';
  $('ovTplSaveRow').hidden = true;
  renderOvMenu();
  // 内容变了重新夹一下，避免超出视口
  const el = $('ovMenu');
  if (!el.hidden) placeAt(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
  updateStatus(`已保存模板「${item.name}」并设为 ${OV_LABELS[tool] || tool} 默认`);
}

function renderOvMenuForTest() { renderOvMenu(); }

function refreshOvBar() {
  if (!state.selOverlay) return;
  const o = state.app?.chart.getOverlays().find(x => x.id === state.selOverlay);
  if (o) showOvBar(o); else hideOvBar();
}

function wireOverlayBar() {
  $('chart').addEventListener('click', (e) => {
    if (state.draw?.activeTool) return;
    const o = hitOverlay(e.clientX, e.clientY);
    if (o) showOvBar(o); else hideOvBar();
  });

  $('ovColor').oninput = (e) => {
    if (state.selOverlay) state.draw.updateOverlayStyle(state.selOverlay, { color: e.target.value });
  };
  $('ovWidth').onchange = (e) => {
    if (state.selOverlay) state.draw.updateOverlayStyle(state.selOverlay, { size: Number(e.target.value) });
  };
  $('ovDel').onclick = () => {
    const id = state.selOverlay;
    if (!id) return;
    hideOvBar();
    if (state.draw.removeOverlayById(id)) updateStatus('已删除该绘图');
  };
  $('ovTune').onclick = () => TBOX.openDrawStylePanel();
  $('ovMore').onclick = () => {
    const el = $('ovMenu');
    if (!el.hidden) { el.hidden = true; return; }
    renderOvMenu();
    const r = $('ovMore').getBoundingClientRect();
    placeAt(el, Math.round(r.right - 170), Math.round(r.bottom + 6));
  };
  $('ovMenu').querySelectorAll('.mi').forEach(b => {
    b.onclick = () => {
      const id = state.selOverlay;
      if (!id) return;
      const act = b.dataset.ov;
      if (act === 'save') { $('ovTplSaveRow').hidden = false; $('ovTplName').value = ''; $('ovTplName').focus(); return; }
      if (act === 'apply-default') { applyDefaultTemplate(id); $('ovMenu').hidden = true; refreshOvBar(); return; }
      if (act === 'fib') { TBOX.openDrawStylePanel(); $('ovMenu').hidden = true; return; }
      if (act === 'reset') {
        const o = state.app.chart.getOverlays().find(x => x.id === id);
        if (o) {
          const st = state.draw.styleFor(o.name);
          state.app.chart.overrideOverlay({ id, styles: st.styles });
          state.draw.capture();
          state.draw.persist();
        }
        $('ovMenu').hidden = true;
        refreshOvBar();
      }
    };
  });

  // 线型 chips
  $('ovLs').querySelectorAll('.ov-chip').forEach(b => {
    b.onclick = () => {
      const id = state.selOverlay;
      if (!id) return;
      const style = b.dataset.ls;
      state.draw.updateOverlayStyle(id, {
        style,
        dashedValue: style === 'dotted' ? [1, 3] : style === 'dashed' ? [5, 4] : [0, 0]
      });
      renderOvMenu();
      refreshOvBar();
    };
  });

  // 保存模板
  $('ovTplSaveOk').onclick = () => saveOverlayAsTemplate();
  $('ovTplName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveOverlayAsTemplate(); });

  document.addEventListener('mousedown', (e) => {
    if ($('ovBar').hidden) return;
    const inBar = $('ovBar').contains(e.target) || $('ovMenu').contains(e.target);
    const inChart = $('chart').contains(e.target);
    if (!inBar && !inChart) hideOvBar();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideOvBar(); });
}

/* ---------------- 配置存档（保存到本地） ---------------- */

let _dirty = false;
let _savedFlash = null;

function updateSaveDot() {
  const btn = $('btnSave');
  if (!btn) return;
  btn.classList.toggle('dirty', _dirty);
  btn.title = _dirty ? '有未保存的配置改动 · 点这里保存（Ctrl+S）' : '配置已保存到本地（Ctrl+S 覆盖）';
}

function markDirty() {
  if (_dirty) return;
  _dirty = true;
  updateSaveDot();
}

function setDirty(v) { _dirty = !!v; updateSaveDot(); }

function collectWorkspace() {
  return {
    symbol: state.profile?.symbol || null,
    period: state.app?.periodKey || null,
    start: state.replay?.cursor || null,
    theme: state.theme,
    magnet: isMagnetOn(),
    layout: state.layout,
    drawStyles: state.drawStyles,
    drawTemplates: state.drawTemplates,
    tools: TBOX.toolsState(),
    split: state.workspace ? { key: state.wsLayout, periods: state.workspace.cells.map(c => c.app.periodKey) } : null
  };
}

async function saveWorkspace(quiet = false) {
  const snap = await saveConfigSnapshot(collectWorkspace());
  if (!snap) { updateStatus('保存失败：本地存储不可用'); return null; }
  setDirty(false);
  const btn = $('btnSave');
  btn.classList.add('saved');
  clearTimeout(_savedFlash);
  _savedFlash = setTimeout(() => btn.classList.remove('saved'), 1200);
  if (!quiet) updateStatus(`配置已保存 · ${new Date(snap.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}`);
  return snap;
}

/** 启动时按存档恢复（主题/版面/吸附/绘图样式/模板/工具栏/周期） */
async function applyWorkspaceSnapshot(snap) {
  if (!snap) return false;
  try {
    if (snap.theme) { state.theme = applyThemeMode(snap.theme); THEME.updateThemeButton(); }
    if (snap.layout) {
      state.layout = normalize(snap.layout);
      applyThemePaneLayout();
      syncLayoutUI();
    }
    if (typeof snap.magnet === 'boolean') setMagnetOn(snap.magnet);
    if (snap.drawStyles) {
      state.drawStyles = normalizeDrawStyles(snap.drawStyles);
      state.drawTemplates = snap.drawTemplates || state.drawTemplates;
    }
    if (snap.tools) { state.tools = snap.tools; TBOX.toolsState(); TBOX.placeTools(); }
    if (snap.split && state.workspace && snap.split.key && snap.split.key !== state.wsLayout) {
      state.wsLayout = snap.split.key;
      state.wsPeriods = Array.isArray(snap.split.periods) ? snap.split.periods : null;
      await state.workspace.applyLayout(snap.split.key, { periods: state.wsPeriods });
      state.app = state.workspace.app;
      state.draw = state.workspace.draw;
      state.pine = state.workspace.pine;
      state.replay = state.workspace.multi;
      state.replay.setEmitter((s) => { RPL.renderReplay(s); updateStatus(); });
    }
    if (snap.period && state.app && snap.period !== state.app.periodKey) {
      await state.app.switchPeriod(snap.period);
      state.replay && (state.replay.bucket = null);
      if (state.draw) { state.draw.periodKey = snap.period; await state.draw.load(); }
    }
    return true;
  } catch (e) {
    console.warn('[config] 恢复失败', e?.message);
    return false;
  }
}

function wireSaveButton() {
  updateSaveDot();
  $('btnSave').onclick = () => saveWorkspace();
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveWorkspace();
    }
  });
}

/* ---------------- 图上图例 + 指标设置 ---------------- */

let _indSetName = null;
let _indSetPineId = null;

function indEntry(name) {
  return (state.app?.chart?.getIndicators() || []).find(i => i.name === name);
}

function indParams(name) {
  const ind = indEntry(name);
  return (ind?.calcParams || []).join(',');
}


/** 图例跟随十字光标取值（移出图表则回到最后一根） */
function wireLegendHover() {
  const host = document.getElementById('chart');
  if (!host) return;
  let timer = null;
  host.addEventListener('mousemove', (e) => {
    const chart = state.app?.chart;
    if (!chart) return;
    const r = host.getBoundingClientRect();
    let pt = null;
    try {
      const raw = chart.convertFromPixel([{ x: e.clientX - r.left, y: e.clientY - r.top }], { paneId: 'candle_pane' });
      pt = Array.isArray(raw) ? raw[0] : raw;
    } catch {}
    if (!pt || !Number.isFinite(pt.timestamp)) return;
    _legendIndexTs = pt.timestamp;
    if (timer) return;
    timer = setTimeout(() => { timer = null; renderLegend(); }, 70);
  }, true);
  host.addEventListener('mouseleave', () => { _legendIndexTs = null; renderLegend(); }, true);
}

/** 图上左上角的指标图例：一行显示 名称(参数) + 每条线的值 + 显隐/设置/移除 */
let _legendIndexTs = null;   // 图例取值用的 bar（十字光标优先，否则最后一根）

function legendValueIndex(chart) {
  const list = chart.getDataList();
  if (!list.length) return -1;
  if (_legendIndexTs == null) return list.length - 1;
  let lo = 0, hi = list.length - 1, ans = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].timestamp >= _legendIndexTs) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

function fmtLegendValue(v, precision = 2) {
  if (v == null || !Number.isFinite(Number(v))) return 'n/a';
  return Number(v).toFixed(precision);
}

let _legendTimer = null;
/** 指标变了：立刻刷一次 + 250ms 后再刷一次（内核是异步算值的） */
function refreshLegend() {
  try { renderLegend(); } catch {}
  clearTimeout(_legendTimer);
  _legendTimer = setTimeout(() => { try { renderLegend(); } catch {} }, 280);
}

function renderLegend() {
  const box = $('chartLegend');
  if (!box) return;
  const chart = state.app?.chart;
  const list = chart?.getIndicators() || [];
  if (!list.length) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;

  const palette = indicatorPalette();
  const idx = legendValueIndex(chart);
  const open = state.legendOpen !== false;

  const rows = list.map((ind, i) => {
    const off = ind.visible === false;
    const cp = ind.calcParams?.length ? `(${ind.calcParams.join(',')})` : '';
    const res = idx >= 0 ? ind.result?.[idx] : null;
    const given = ind.styles?.lines || [];
    // 自建指标可能没有 figures（自己 draw 线），退化成展示 result 里的前几个数值
    // 用 {f, k} 保留原始下标：下面是“按值过滤”，颜色仍要按原始序号取，否则线色会串位
    const figsAll = (ind.figures || []).length
      ? (ind.figures || [])
          .filter(f => f.type === 'line' || f.type === 'bar' || f.type === 'circle')
          .filter(f => (f.title || '').trim())          // 纯占位 figure（SMC 这类自己 draw 的不带数据）不进图例
          .map((f, k) => ({ f, k }))
      : Object.keys(res || {}).filter(k => typeof res[k] === 'number').slice(0, 3)
          .map((key, k) => ({ f: { key, title: `${key.toUpperCase()}: `, type: 'line' }, k }));
    const rawOf = (f) => (res && Object.prototype.hasOwnProperty.call(res, f.key) ? res[f.key] : null);
    // 只有一部分线有值时，把恒为 null 的线隐掉（ZLEMA 只设 1 个周期时不该出现 “ZLEMA2: n/a”）
    const hasVal = figsAll.some(({ f }) => rawOf(f) != null);
    const shown = (hasVal ? figsAll.filter(({ f }) => rawOf(f) != null) : figsAll).slice(0, 8);
    const vals = shown
      .map(({ f, k }) => {
        const color = given[k]?.color || palette[k % palette.length];
        const raw = rawOf(f);
        const title = (f.title || f.key || '').trim() || f.key;
        return `<span class="lg-val" style="color:${transparentColor(color) ? 'var(--dimmer)' : color}">${title} ${fmtLegendValue(raw, ind.precision ?? 2)}</span>`;
      }).join('');
    return `<div class="lg-item ${off ? 'off' : ''}" data-ind="${ind.name}">
      <span class="lg-name">${indLabel(ind.name)}${cp}</span>
      ${vals}
      <span class="lg-act">
        <button class="lg-btn" data-eye="${ind.name}" title="${off ? '显示' : '隐藏'}">${off ? '◌' : '◉'}</button>
        <button class="lg-btn" data-cfg="${ind.name}" title="参数与颜色">⚙</button>
        <button class="lg-btn" data-rm="${ind.name}" title="移除">✕</button>
      </span>
    </div>`;
  }).join('');

  box.innerHTML = `<button class="lg-head" title="展开/收起指标列表">${open ? '⌄' : '›'} 指标 <b>${list.length}</b></button>
    <div class="lg-body" ${open ? '' : 'hidden'}>${rows}</div>`;

  box.querySelector('.lg-head').onclick = (e) => {
    e.stopPropagation();
    state.legendOpen = !(state.legendOpen !== false);
    kvSet('ui:legend', { open: state.legendOpen });
    renderLegend();
  };

  box.querySelectorAll('[data-eye]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const ind = indEntry(b.dataset.eye);
      if (!ind) return;
      try { chart.overrideIndicator({ name: ind.name, visible: ind.visible === false }); } catch {}
      refreshLegend();
      updateIndBadge();
      if (!$('indicatorPanel').hidden) renderIndicatorPanel();
    };
  });
  box.querySelectorAll('[data-cfg]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openIndSettings(b.dataset.cfg); };
  });
  box.querySelectorAll('[data-rm]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      try { chart.removeIndicator({ name: b.dataset.rm }); } catch {}
      refreshLegend(); updateIndBadge();
      if (!$('indicatorPanel').hidden) renderIndicatorPanel();
    };
  });
}

const transparentColor = (c) => !c || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(String(c));

function toHex(c) {
  if (!c) return '#8adeff';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (!m) return '#8adeff';
  return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

async function openIndSettings(name) {
  const ind = indEntry(name);
  if (!ind) return;
  _indSetName = name;

  $('indSetHead').textContent = `${indLabel(name)} · ${name}`;
  const params = Array.isArray(ind.calcParams) ? ind.calcParams : [];
  $('indSetParams').value = params.join(', ');
  $('indSetVisible').checked = ind.visible !== false;

  // Pine 自编指标：参数来自脚本 input.*，线条来自 plot 序列，走专门的面板
  let pineRec = /^PINE_/.test(name) ? state.pine?.findByIndName?.(name) : null;
  if (!pineRec && /^PINE_/.test(name)) {
    const m = state.pineMap?.[name];
    const figs = (ind.figures || []).map(f => f.key);
    if (m || figs.length) {
      pineRec = {
        id: m?.id || null,
        name: m?.name || 'Pine 指标',
        indName: name,
        names: figs,
        lineStyles: (ind.styles?.lines || []).map(l => ({ color: l.color, size: l.size, style: l.style }))
      };
    }
  }
  $('indSetPineBox').hidden = !pineRec;
  $('indSetParamsRow').hidden = !!pineRec;
  $('indSetParamsHint').hidden = !!pineRec;
  _indSetPineId = pineRec?.id || null;
  if (pineRec) {
    await openPineSettings(pineRec, ind);
    $('indSettingsPanel').hidden = false;
    $('btnIndicator')?.classList.remove('on');
    if (!$('indicatorPanel').hidden) { $('indicatorPanel').hidden = true; }
    return;
  }

  const given = ind.styles?.lines || [];
  const palette = indicatorPalette();
  const prefs = state.indPrefs?.[name];
  const lines = params.map((_, i) => ({
    color: toHex(given[i]?.color || prefs?.lines?.[i]?.color || palette[i % palette.length]),
    size: given[i]?.size ?? prefs?.lines?.[i]?.size ?? 1,
    style: given[i]?.style || prefs?.lines?.[i]?.style || 'solid',
    hidden: (typeof given[i]?.color === 'string' && given[i].color
      ? transparentColor(given[i].color)
      : false) || !!prefs?.lines?.[i]?.hidden
  }));
  renderIndSetLines(lines, params);

  $('indSetParams').oninput = () => {
    const ps = readParams();
    const cur = readLines();
    const next = ps.map((_, i) => cur[i] || { color: palette[i % palette.length], size: 1, style: 'solid', hidden: false });
    renderIndSetLines(next, ps);
  };

  $('indSettingsPanel').hidden = false;
  $('btnIndicator')?.classList.remove('on');
  if (!$('indicatorPanel').hidden) { $('indicatorPanel').hidden = true; }
  $('indSetParams').focus();
}

/** Pine 指标设置：脚本 input.* 全量参数 + 每条 plot 的线条样式 */
async function openPineSettings(rec, ind) {
  const entry = rec.id ? ((await libList()).find(e => e.id === rec.id) || null) : null;
  const src = entry?.src || '';
  const declared = parseInputs(src);
  const cur = entry?.inputs || {};
  $('indSetPineSrc').textContent = entry ? `(${entry.name})` : '';

  const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'];
  const box = $('indSetInputs');
  if (!entry) {
    box.innerHTML = '<p class="ind-set-hint">找不到对应的脚本条目（可能已从脚本库删除），无法改参数。</p>';
  } else if (!declared.length) {
    box.innerHTML = '<p class="ind-set-hint">这个脚本没有 input.* 声明，参数写死在源码里。</p>';
  } else {
    box.innerHTML = declared.map((d, i) => {
      const v = cur[d.name] ?? d.def;
      const id = `pi_${i}`;
      let ctl = '';
      if (Array.isArray(d.options) && d.options.length) {
        // Pine 的 input.string(..., options=[...]) 用下拉
        const cur = String(v ?? d.def ?? '');
        const list = d.options.includes(cur) ? d.options : [cur, ...d.options];
        ctl = `<select data-piname="${d.name}" data-pitype="string" id="${id}">${list
          .map(o => `<option value="${String(o).replace(/"/g, '&quot;')}" ${o === cur ? 'selected' : ''}>${o}</option>`)
          .join('')}</select>`;
      } else if (d.type === 'bool') {
        ctl = `<input type="checkbox" data-piname="${d.name}" data-pitype="bool" id="${id}" ${v ? 'checked' : ''}>`;
      } else if (d.type === 'int' || d.type === 'float') {
        const min = d.min != null ? `min="${d.min}"` : '';
        const max = d.max != null ? `max="${d.max}"` : '';
        const step = d.step != null ? `step="${d.step}"` : (d.type === 'int' ? 'step="1"' : 'step="any"');
        ctl = `<input type="number" ${min} ${max} ${step} data-piname="${d.name}" data-pitype="${d.type}" id="${id}" value="${v ?? ''}" placeholder="${d.def ?? ''}">`;
      } else if (d.type === 'source') {
        const opts = SOURCES.includes(String(v)) ? SOURCES : [String(v), ...SOURCES];
        ctl = `<select data-piname="${d.name}" data-pitype="source" id="${id}">${[...new Set(opts)]
          .map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      } else if (d.type === 'timeframe') {
        ctl = `<input type="text" data-piname="${d.name}" data-pitype="timeframe" id="${id}" value="${String(v ?? '').replace(/"/g, '&quot;')}" placeholder="如 5 / 15 / 60 / 240 / D（留空=当前周期）">`;
      } else if (d.type === 'color') {
        ctl = `<input type="color" data-piname="${d.name}" data-pitype="color" id="${id}" value="${toHex(String(v || '#aceaff'))}">`;
      } else {
        ctl = `<input type="text" data-piname="${d.name}" data-pitype="string" id="${id}" value="${String(v ?? '').replace(/"/g, '&quot;')}" placeholder="${d.def ?? ''}">`;
      }
      let range = '';
      if (d.min != null && d.max != null) range = ` <span class="t">${d.min}~${d.max}</span>`;
      else if (d.min != null) range = ` <span class="t">≥${d.min}</span>`;
      else if (d.max != null) range = ` <span class="t">≤${d.max}</span>`;
      return `<div class="ind-set-in"><span title="${d.tooltip || d.title}">${d.title}</span>${ctl}${range}</div>`;
    }).join('');
  }

  // 线条：来自 plot 名
  const names = rec.names || [];
  const saved = rec.lineStyles || [];
  const palette = indicatorPalette();
  const lines = names.map((n, i) => ({
    name: n,
    color: toHex(saved[i]?.color && saved[i].color !== 'rgba(0,0,0,0)' ? saved[i].color : palette[i % palette.length]),
    size: saved[i]?.size ?? 1,
    style: saved[i]?.style || 'solid',
    hidden: transparentColor(saved[i]?.color)
  }));
  if (!names.length) {
    $('indSetLines').innerHTML = '<p class="ind-set-hint">这个脚本没有 plot()：内容都是绘图对象（表格/线/标签），直接画在图上，没有可调配的数值线。</p>';
  } else {
    renderIndSetLines(lines, names);
  }
}

/** 读 Pine 面板里的 input 值（按声明类型转） */
function readPineInputs() {
  const out = {};
  for (const el of $('indSetInputs').querySelectorAll('[data-piname]')) {
    const name = el.dataset.piname, type = el.dataset.pitype;
    if (type === 'bool') out[name] = el.checked;
    else if (type === 'int') { const n = parseInt(el.value, 10); if (Number.isFinite(n)) out[name] = n; }
    else if (type === 'float') { const n = parseFloat(el.value); if (Number.isFinite(n)) out[name] = n; }
    else if (type === 'timeframe') { out[name] = String(el.value || '').trim(); }
    else if (el.value !== '') out[name] = el.value;
  }
  return out;
}

async function applyPineSettings() {
  const chart = state.app?.chart;
  const name = _indSetName;
  if (!chart) return false;
  const entryId = _indSetPineId || state.pine?.findByIndName?.(name)?.id;
  const entry = entryId ? (await libList()).find(e => e.id === entryId) : null;
  if (!entry) { updateStatus('找不到这个 Pine 脚本（可能已被删除）', true); return false; }

  const inputs = readPineInputs();
  entry.inputs = inputs;
  entry.lineStyles = readLines();
  await libSave(entry);

  const bars = chart.getDataList();
  const r = await state.pine.apply({ ...entry }, bars);
  if (!r.ok) { updateStatus(`Pine 重算失败：${r.error}`, true); return false; }
  updateIndBadge();
  refreshLegend();
  renderIndicatorPanel();
  renderAlerts(r.alerts || [], entry.name);
  updateStatus(`Pine「${entry.name}」已更新 · ${Object.keys(inputs).length} 个参数`);
  closeIndSettings();
  return true;
}

function renderIndSetLines(lines, params) {
  const box = $('indSetLines');
  if (!lines.length) { box.innerHTML = '<p class="ind-set-hint">这个指标没有可调线条样式。</p>'; return; }
  const styles = [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线']];
  box.innerHTML = lines.map((l, i) => `
    <div class="ind-set-line" data-i="${i}">
      <button class="eye ${l.hidden ? 'off' : ''}" title="显示/隐藏这条线">${l.hidden ? '◌' : '◉'}</button>
      <input type="color" value="${toHex(l.color)}">
      <input type="number" min="0.5" max="6" step="0.5" value="${l.size ?? 1}">
      <select>${styles.map(([v, t]) => `<option value="${v}" ${l.style === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="sep">${typeof params[i] === 'string' ? params[i] : (params[i] != null ? `(${params[i]})` : '')}</span>
    </div>`).join('');
  box.querySelectorAll('.eye').forEach(b => {
    b.onclick = () => {
      b.classList.toggle('off');
      const on = b.classList.contains('off');
      b.textContent = on ? '◌' : '◉';
    };
  });
}

function readParams() {
  return ($('indSetParams').value || '').split(/[,，\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0);
}

function readLines() {
  return [...$('indSetLines').querySelectorAll('.ind-set-line')].map(r => ({
    color: r.querySelector('input[type=color]').value,
    size: Number(r.querySelector('input[type=number]').value) || 1,
    style: r.querySelector('select').value,
    hidden: r.querySelector('.eye').classList.contains('off')
  }));
}

async function applyIndSettings() {
  const chart = state.app?.chart;
  const name = _indSetName;
  if (!chart || !name) return false;
  if (/^PINE_/.test(name) && state.pine?.findByIndName?.(name)) return applyPineSettings();
  const calcParams = readParams();
  const lines = readLines();
  const visible = $('indSetVisible').checked;

  const patch = { name, paneId: indEntry(name)?.paneId, visible };
  if (calcParams.length) patch.calcParams = calcParams;
  if (lines.length) {
    patch.styles = { lines: lines.map(l => ({ color: l.hidden ? 'rgba(0,0,0,0)' : l.color, size: l.size, style: l.style })) };
  }
  try { chart.overrideIndicator(patch); } catch {}

  const after = indEntry(name);
  const ok = !!after && (!patch.calcParams || patch.calcParams.join(',') === (after.calcParams || []).join(','));
  if (!ok) { updateStatus(`指标 ${name} 更新失败（参数不合法？）`, true); return false; }

  state.indPrefs = { ...(state.indPrefs || {}), [name]: { calcParams, lines, visible } };
  await saveIndPrefs(state.indPrefs);
  updateStatus(`指标 ${name} 已更新 · ${calcParams.join(',') || '-'}${visible ? '' : ' · 已隐藏'}`);
  refreshLegend();
  renderIndicatorPanel();
  closeIndSettings();
  return true;
}

function closeIndSettings() {
  $('indSettingsPanel').hidden = true;
  _indSetName = null;
}

function wireIndSettings() {
  $('indSetApply').onclick = () => applyIndSettings();
  $('indSetCancel').onclick = closeIndSettings;
  $('indSetClose').onclick = closeIndSettings;
  // Esc：按“最上层先关”的次序收起所有可关闭面板（原来只有部分面板响应）
  // 用捕获阶段 + window：画图/图表库自己在 document 上也有 keydown，冒泡阶段容易被 stopPropagation 吃掉
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    if (document.querySelector('.tab-in')) return;   // 改名输入框自己处理
    if (state.draw?.active) return;                  // 画图取消优先
    const closers = [
      { key: 'indSet', open: () => $('indSettingsPanel').hidden === false, close: () => closeIndSettings() },
      { key: 'indicator', open: () => $('indicatorPanel').hidden === false, close: () => closeIndicatorPanel() },
      { key: 'strat', open: () => $('stratPanel').hidden === false, close: () => { $('stratPanel').hidden = true; } },
      { key: 'pine', open: () => $('pinePanel').hidden === false, close: () => { $('pinePanel').hidden = true; $('btnPine')?.classList.remove('on'); } },
      { key: 'moreTools', open: () => $('moreTools')?.hidden === false, close: () => TBOX.closeMoreTools() },
      { key: 'copyDraw', open: () => $('copyDrawPanel')?.hidden === false, close: () => { $('copyDrawPanel').hidden = true; } },
      { key: 'ctx', open: () => $('ctxMenu')?.hidden === false, close: () => closeCtx() },
      { key: 'layout', open: () => $('layoutMenu')?.hidden === false, close: () => closeLayoutMenu() },
      { key: 'theme', open: () => $('themeMenu')?.hidden === false, close: () => THEME.closeThemeMenu() },
      { key: 'archive', open: () => $('archivePanel')?.hidden === false, close: () => ARCH.closeArchive() }
    ];
    const hit = closers.find(c => { try { return c.open(); } catch { return false; } });
    if (hit) { e.preventDefault(); e.stopPropagation(); try { hit.close(); } catch {} }
  }, true);
  $('indSetParams').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyIndSettings(); });
  $('indSetInputs').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyIndSettings(); });
  $('indSetReset').onclick = async () => {
    const name = _indSetName;
    if (!name) return;
    // Pine：恢复 = 清掉保存的 inputs / 线条，回到脚本默认值
    let pineRec = /^PINE_/.test(name) ? state.pine?.findByIndName?.(name) : null;
  if (!pineRec && /^PINE_/.test(name)) {
    const m = state.pineMap?.[name];
    const figs = (ind.figures || []).map(f => f.key);
    if (m || figs.length) {
      pineRec = {
        id: m?.id || null,
        name: m?.name || 'Pine 指标',
        indName: name,
        names: figs,
        lineStyles: (ind.styles?.lines || []).map(l => ({ color: l.color, size: l.size, style: l.style }))
      };
    }
  }
    if (pineRec) {
      const entry = (await libList()).find(e => e.id === pineRec.id);
      if (entry) {
        entry.inputs = {}; entry.lineStyles = [];
        await libSave(entry);
        const r = await state.pine.apply({ ...entry }, state.app.chart.getDataList());
        if (!r.ok) updateStatus(`Pine 重算失败：${r.error}`, true);
      }
      updateIndBadge(); refreshLegend(); renderIndicatorPanel(); closeIndSettings();
      updateStatus('Pine 指标已恢复脚本默认值');
      return;
    }
    if (state.indPrefs) { delete state.indPrefs[name]; await saveIndPrefs(state.indPrefs); }
    const chart = state.app?.chart;
    try { chart.removeIndicator({ name }); } catch {}
    toggleBuiltin(chart, name, OVERLAY_INDS.has(name), null);
    renderIndicatorPanel();
    refreshLegend();
    updateStatus(`指标 ${name} 已恢复默认`);
    closeIndSettings();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('indSettingsPanel').hidden) closeIndSettings();
  });
}

/* ---------------- 指标库 ---------------- */

function indLabel(name) {
  if (IND_LABELS[name]) return IND_LABELS[name];
  const metaLabel = CUSTOM_META?.[name]?.label;
  if (metaLabel) return metaLabel;
  if (/^PINE_/.test(name)) {
    const rec = state.pine?.findByIndName?.(name);
    if (rec?.name) return rec.name;
    const m = state.pineMap?.[name];
    return m?.name || 'Pine 指标';
  }
  return name;
}

function updateIndBadge() {
  const n = state.app ? (state.app.chart.getIndicators() || []).length : 0;
  const b = $('indBadge');
  b.textContent = String(n);
  b.hidden = n === 0;
}

async function renderIndicatorPanel() {
  const chart = state.app?.chart;
  if (!chart) return;
  const active = activeNames(chart);

  // 已上图
  $('indCount').textContent = active.length ? `${active.length} 个` : '空';
  $('indActive').innerHTML = active.length
    ? active.map(nm => `<div class="t"><span>${indLabel(nm)} <span class="muted">${nm}</span></span>
        <span class="act"><button class="ghost" data-cfg="${nm}" title="参数与颜色">⚙</button><button class="ghost" data-rm="${nm}">移除</button></span></div>`).join('')
    : '<div class="muted">还没有指标</div>';
  $('indActive').querySelectorAll('button[data-rm]').forEach(b => {
    b.onclick = () => {
      try { chart.removeIndicator({ name: b.dataset.rm }); } catch {}
      updateIndBadge();
      renderIndicatorPanel();
    };
  });
  $('indActive').querySelectorAll('button[data-cfg]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openIndSettings(b.dataset.cfg); };
  });
  refreshLegend();

  // 分类网格（4 列，选中格用琥珀底色）
  const q = (state.indQuery || '').trim();
  const ql = q.toLowerCase();
  const cat = IND_CATS.some(c => c.key === state.indCat) ? state.indCat : 'key';
  const allItems = builtinList();
  $('indCats').innerHTML = IND_CATS.map(c =>
    `<button class="ind-cat ${(!q && cat === c.key) ? 'on' : ''}" data-cat="${c.key}">${c.label}</button>`).join('');
  $('indCats').querySelectorAll('.ind-cat').forEach(b => {
    b.onclick = () => { state.indCat = b.dataset.cat; renderIndicatorPanel(); };
  });
  $('indPeriod').textContent = state.app?.periodKey || '1m';
  const info = $('indInfoText');
  if (info) {
    const p = state.profile;
    info.textContent = p
      ? `${p.symbol} 当前窗口读取 ${p.first ? fmtDay(p.first) : '—'} → ${p.last ? fmtDay(p.last) : '—'} 的 1 分钟历史，支持切换周期分析与复盘。`
      : '导入数据后可以在这里管理 Pine 脚本。';
  }

  const box = $('indList');
  box.innerHTML = '';
  $('indNewPine').hidden = cat !== 'pine' || !!q;
  $('indPineFoot').hidden = cat !== 'pine' || !!q;
  $('indSaveCombo').hidden = cat === 'pine';
  if (cat !== 'pine' || q) $('indSearch').placeholder = '搜索全部内置指标，如 EMA、均线';

  const setMeta = (label, n, unit = '个指标') => {
    $('indTotal2').textContent = label;
    $('indTotal')?.remove?.();
    const meta = document.querySelector('.ind-meta-txt');
    if (meta) meta.innerHTML = `${label} · <b id="indTotal">${n}</b> ${unit}`;
  };

  // Pine / 自编
  if (!q && cat === 'pine') {
    const lib = await libList();
    $('indNewPine').hidden = false;
    $('indPineFoot').hidden = false;
    $('indSaveCombo').hidden = true;
    $('indSearch').placeholder = '搜索名称或账号';
    setMeta('我的指标', lib.length, '个');
    if (!lib.length) {
      box.innerHTML = `<div class="ind-empty-card">
        <b>编译一次，随时取用</b>
        <p>Pine 编译成功后自动保存到本机指标库，下次打开直接添加，不用重新粘贴。</p>
      </div>`;
      return;
    }
    for (const e of lib) {
      const on = state.pine?.list().some(x => x.id === e.id);
      const row = document.createElement('div');
      row.className = 'ind-item ind-pine-row' + (on ? ' on' : '');
      row.innerHTML = `<span class="rate">★★★★<span class="off">☆</span></span>
        <span class="nm"><b>${e.name}</b><small>${e.overlay ? '主图' : '子图'} · ${(e.src || '').length} 字符${e.savedAt ? ' · ' + new Date(e.savedAt).toLocaleDateString('zh-CN') : ''}</small></span>
        <span class="act">
          <button class="star" data-edit="${e.id}" title="在编辑器里打开">✎</button>
          <button class="add ${on ? 'on' : ''}" data-add="${e.id}">${on ? '已添加' : '+ 添加'}</button>
        </span>`;
      row.querySelector('[data-add]').onclick = async () => {
        if (on) state.pine.remove(e.id);
        else {
          const bars = chart.getDataList();
          const r = await state.pine.apply({ ...e }, bars);
          if (!r.ok) updateStatus(`Pine 失败：${r.error}`);
        }
        renderPineApplied();
        updateIndBadge();
        renderIndicatorPanel();
      };
      row.querySelector('[data-edit]').onclick = () => {
        state.pineEntry = { ...e };
        $('pineName').value = e.name;
        $('pineSrc').value = e.src || '';
        $('pinePanel').hidden = false;
        $('indicatorPanel').hidden = true;
        $('btnIndicator').classList.remove('on');
        renderInputs(parseInputs(e.src || ''), e.inputs || {});
      };
      box.appendChild(row);
    }
    return;
  }

  // 组合模板分类
  if (!q && cat === 'combos') {
    const combos = state.indCombos || [];
    setMeta('当前分类', combos.length);
    if (!combos.length) {
      box.innerHTML = '<div class="ind-empty">还没有组合。调好一套指标后点上面「保存当前组合」。</div>';
      return;
    }
    for (const c of combos) {
      const row = document.createElement('div');
      row.className = 'ind-item combo-row';
      row.innerHTML = `<span class="rate">★★★★<span class="off">☆</span></span>
        <span class="nm"><b>${c.name}</b><small>${c.items.map(indLabel).join(' · ')}</small></span>
        <span class="act"><button class="add" data-use="${c.id}">应用</button>
        <button class="add" data-del="${c.id}">删除</button></span>`;
      row.querySelector('[data-use]').onclick = () => {
        const n = applyCombo(chart, c);
        updateIndBadge(); refreshLegend(); renderIndicatorPanel();
        updateStatus(`已应用组合「${c.name}」· ${n} 个指标`);
      };
      let armed = false;
      row.querySelector('[data-del]').onclick = async (e) => {
        if (!armed) { armed = true; e.target.textContent = '再点一次'; setTimeout(() => { armed = false; e.target.textContent = '删除'; }, 3000); return; }
        state.indCombos = await removeCombo(c.id);
        renderIndicatorPanel();
      };
      box.appendChild(row);
    }
    return;
  }

  // 指标列表（搜索时跨全部分类）
  let items;
  if (q) items = allItems.filter(i => i.label.toLowerCase().includes(ql) || i.name.toLowerCase().includes(ql) || (i.desc || '').toLowerCase().includes(ql));
  else if (cat === 'fav') items = allItems.filter(i => (state.indFavs || []).includes(i.name));
  else items = allItems.filter(i => i.cat === cat);

  setMeta(q ? `搜索「${q}」` : '当前分类', items.length);

  if (!items.length) {
    const emptyText = q ? '没有匹配的指标'
      : cat === 'fav' ? '还没有收藏，点指标右边的 ☆ 收藏。'
      : cat === 'flow' ? '订单流指标需要逐笔/成交量数据；当前数据源 volume 为 0，暂不可用。'
      : cat === 'smc' ? 'SMC 结构类（订单块 / 结构突破 / 摆动点）下一批做'
      : '这一分类还没有指标';
    box.innerHTML = `<div class="ind-empty">${emptyText}</div>`;
    return;
  }

  for (const it of items) {
    const on = active.includes(it.name);
    const fav = (state.indFavs || []).includes(it.name);
    const full = Math.floor(it.rate ?? 3.5);
    const row = document.createElement('div');
    row.className = 'ind-item' + (on ? ' on' : '');
    row.innerHTML = `<span class="rate">${'★'.repeat(full)}<span class="off">${'☆'.repeat(5 - full)}</span></span>
      <span class="nm"><b>${it.label}</b><small>${it.desc || it.name}</small></span>
      <span class="act">
        <button class="star ${fav ? 'on' : ''}" data-fav="${it.name}" title="${fav ? '取消收藏' : '收藏'}">${fav ? '★' : '☆'}</button>
        <button class="add ${on ? 'on' : ''}" data-add="${it.name}" title="${on ? '点击移除' : '添加到图上'}">${on ? '已添加' : '+ 添加'}</button>
      </span>`;
    row.querySelector('[data-fav]').onclick = async (e) => {
      e.stopPropagation();
      const set = new Set(state.indFavs || []);
      set.has(it.name) ? set.delete(it.name) : set.add(it.name);
      state.indFavs = [...set];
      await saveFavs(state.indFavs);
      renderIndicatorPanel();
    };
    row.querySelector('[data-add]').onclick = () => {
      toggleBuiltin(chart, it.name, it.overlay, state.indPrefs?.[it.name]);
      updateIndBadge();
      renderIndicatorPanel();
    };
    box.appendChild(row);
  }
}

function wireIndicatorPanel() {
  $('btnIndicator').onclick = async () => {
    const el = $('indicatorPanel');
    el.hidden = !el.hidden;
    $('btnIndicator').classList.toggle('on', !el.hidden);
    if (!el.hidden) { await renderIndicatorPanel(); updateIndBadge(); }
  };
  $('closeIndicator').onclick = () => closeIndicatorPanel();

  $('indSearch').oninput = () => {
    state.indQuery = $('indSearch').value;
    renderIndicatorPanel();
  };
  $('btnShot') ? ($('btnShot').onclick = copyWindowShot) : null;
  $('indRefresh').onclick = async () => {
    state.manifest = null;
    await renderIndicatorPanel();
    updateStatus('指标库已刷新');
  };
  $('indNewPine').onclick = async () => {
    state.indCat = 'pine';
    // Pine 编辑器和指标库都贴右边，开一个要关另一个，否则编辑器被盖住（看起来像"点了没反应"）
    $('indicatorPanel').hidden = true;
    $('btnIndicator')?.classList.remove('on');
    $('pinePanel').hidden = false;
    $('pineSrc').value = $('pineSrc').value || SAMPLE_PINE;
    renderInputs(parseInputs($('pineSrc').value), {});
  };

  // 保存当前组合
  $('indSaveCombo').onclick = () => {
    const form = $('indComboForm');
    form.hidden = !form.hidden;
    if (!form.hidden) { $('indComboName').value = ''; $('indComboName').focus(); }
  };
  $('indComboCancel').onclick = () => { $('indComboForm').hidden = true; };
  const doSaveCombo = async () => {
    const chart = state.app?.chart;
    if (!chart) return;
    try {
      const c = await saveComboFromChart(chart, $('indComboName').value, state.indPrefs);
      state.indCombos = await loadCombos();
      $('indComboForm').hidden = true;
      state.indCat = 'combos';
      renderIndicatorPanel();
      updateStatus(`已保存组合「${c.name}」· ${c.items.length} 个指标`);
    } catch (e) { updateStatus(`保存组合失败：${e.message}`, true); }
  };
  $('indComboOk').onclick = doSaveCombo;
  $('indComboName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSaveCombo(); });

  // 旧版静态 chips 若还存在，兼容绑定
  $('indCats').querySelectorAll('.ind-cat').forEach(b => {
    b.onclick = () => { state.indCat = b.dataset.cat; renderIndicatorPanel(); };
  });
}

/** 迷你示意图：直接用布局自己的 grid 定义画格子，所见即所得 */
function miniLayout(l) {
  const cells = l.areas.map(a => `<i style="grid-area:${a}"></i>`).join('');
  return `<span class="lay-mini" style="grid-template-columns:${l.cols};grid-template-rows:${l.rows}">${cells}</span>`;
}

/** 副图示意图：1 个主格 + n-1 个副格 */
function miniPanes(n) {
  const rows = n === 1 ? '1fr' : `1.5fr ${Array(n - 1).fill('1fr').join(' ')}`;
  const cells = Array.from({ length: n }, () => '<i></i>').join('');
  return `<span class="lay-mini lay-mini-panes" style="grid-template-rows:${rows}">${cells}</span>`;
}

/** 当前窗口的构建号（入口 script 的 ?v=） */
function currentBuild() {
  const src = document.querySelector('script[type="module"]')?.src || '';
  return (src.match(/[?&]v=([0-9a-z]+)/) || [])[1] || '';
}

/**
 * 版本看门狗：磁盘上的 index.html 换了构建号就提示刷新，切走再回来时自动刷新。
 * 解决“我改完了但你的窗口还是旧代码”。
 */
function startBuildWatch() {
  const mine = currentBuild();
  let latest = mine;
  let shown = false;
  const check = async () => {
    try {
      const r = await fetch('/app/index.html', { cache: 'no-store' });
      const html = await r.text();
      const v = (html.match(/src\/main\.js\?v=([0-9a-z]+)/) || [])[1];
      if (!v) return;
      latest = v;
      if (v !== mine && !shown) {
        shown = true;
        const bar = $('buildBar');
        if (bar) {
          bar.hidden = false;
          $('buildReload').onclick = () => location.replace(`${location.pathname}?v=${v}`);
          $('buildLater').onclick = () => { bar.hidden = true; };
        }
      }
    } catch { /* 服务没起来就算了 */ }
  };
  // 切走再回来：若已发现新版本，直接静默刷新
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (latest && latest !== mine) location.replace(`${location.pathname}?v=${latest}`);
    else check();
  });
  window.addEventListener('focus', check);
  setInterval(check, 45000);
  setTimeout(check, 4000);
}

/**
 * D1：复盘报告 → 打印/另存 PDF
 * 用新窗口渲染一份带 @media print 的 HTML，再调 print()（Chrome 里可直接“另存为 PDF”）。
 */
async function exportSessionReport(session) {
  if (!session) { updateStatus('没有可导出的复盘', true); return null; }
  const st = computeStats(session.trades || []);
  const money = (v) => (v >= 0 ? '+' : '') + Number(v || 0).toFixed(2);
  const pctNum = (v) => (Number.isFinite(v) ? v.toFixed(1) + '%' : '—');   // computeStats 的 winRate 已是百分数
  const shots = [];
  for (const k of (session.shots || []).slice(0, 8)) {
    try { const url = await state.store.shotUrl(k.key); if (url) shots.push(url); } catch {}
  }
  const rows = (session.trades || []).map((t, i) => `<tr>
      <td>${i + 1}</td><td>${t.side === 'long' ? '多' : '空'}</td><td class="n">${t.qty}</td>
      <td class="n">${fmtPrice(t.entry, session.symbol)}</td><td class="n">${fmtPrice(t.exit, session.symbol)}</td>
      <td class="n ${t.pnl >= 0 ? 'pos' : 'neg'}">${money(t.pnl)}</td><td>${t.why || ''}</td>
      <td class="t">${t.closeTs ? fmtTs(t.closeTs) : '—'}</td></tr>`).join('');

  const html = `<div class="rp">
<style>
  @page { margin: 14mm; }
  body{font:12px/1.55 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#111;margin:0}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#666;font-size:11px;margin-bottom:14px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 14px}
  .cell{border:1px solid #ddd;border-radius:6px;padding:8px 10px}
  .cell span{display:block;color:#888;font-size:10px;margin-bottom:4px}
  .cell b{font-size:15px;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th,td{border-bottom:1px solid #e5e5e5;padding:4px 6px;text-align:left}
  th{background:#f4f4f4;font-weight:600}
  td.n{text-align:right;font-variant-numeric:tabular-nums}
  td.t{color:#666;font-size:9.5px}
  .pos{color:#0a7c5a}.neg{color:#c02a3a}
  .shots{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px}
  .shots img{width:100%;border:1px solid #ddd;border-radius:4px}
  .note{margin-top:14px;white-space:pre-wrap;border-top:1px dashed #ccc;padding-top:8px;color:#333}
</style>
<h1>复盘报告 · ${session.name || '未命名'}</h1>
<div class="sub">${session.symbol || ''} · ${session.period || ''} · 创建 ${fmtTs(session.createdAt)}${session.endedAt ? ` · 结束 ${fmtTs(session.endedAt)}` : ' · 进行中'}</div>
<div class="grid">
  <div class="cell"><span>交易笔数</span><b>${st.count || 0}</b></div>
  <div class="cell"><span>净盈亏</span><b class="${(st.netProfit || 0) >= 0 ? 'pos' : 'neg'}">${money(st.netProfit)}</b></div>
  <div class="cell"><span>胜率</span><b>${pctNum(st.winRate)}</b></div>
  <div class="cell"><span>盈亏比</span><b>${Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '—'}</b></div>
  <div class="cell"><span>期望/笔</span><b>${money(st.expectancy)}</b></div>
  <div class="cell"><span>最大回撤</span><b>${money(-(st.maxDrawdown || 0))}</b></div>
  <div class="cell"><span>连胜 / 连亏</span><b>${st.maxConsecWins || 0} / ${st.maxConsecLosses || 0}</b></div>
  <div class="cell"><span>收官权益</span><b>${money(st.finalEquity)}</b></div>
</div>
<table><thead><tr><th>#</th><th>方向</th><th>数量</th><th>开仓</th><th>平仓</th><th>盈亏</th><th>平仓原因</th><th>平仓时间</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8">没有成交</td></tr>'}</tbody></table>
${shots.length ? `<div class="shots">${shots.map(u => `<img src="${u}">`).join('')}</div>` : ''}
${session.note ? `<div class="note">${String(session.note).replace(/[<>]/g, '')}</div>` : ''}
<footer>由 TraderTrain 生成 · ${fmtTs(Date.now())}</footer>
</div>`;

  const host = $('reportRoot');
  if (!host) { updateStatus('缺少报告容器', true); return null; }
  host.innerHTML = html;
  updateStatus(`报告已生成：${session.name} —— 在打印对话框里选「另存为 PDF」`);
  setTimeout(() => { try { window.print(); } catch {} }, 300);
  return host;
}

/** 绘图管理（D3）：列出当前格当前周期的绘图，支持多选删除 / 清空 */
function renderDrawMgr() {
  const box = $('drawMgrList');
  if (!box) return;
  const ovs = state.app?.chart?.getOverlays?.() || [];
  const meta = $('drawMgrMeta');
  if (meta) {
    meta.textContent = ovs.length
      ? `${state.workspace?.active?.profile?.symbol || state.profile?.symbol || ''} · ${state.app?.periodKey?.toUpperCase() || ''} · ${ovs.length} 个绘图`
      : `${state.workspace?.active?.profile?.symbol || ''} · ${state.app?.periodKey?.toUpperCase() || ''} · 没有绘图`;
  }
  box.innerHTML = ovs.length ? ovs.map((o, i) => {
    const pts = (o.points || []).filter(p => p.timestamp != null);
    const p0 = pts[0];
    return `<label class="d">
      <input type="checkbox" data-oid="${o.id}">
      <span class="nm">${o.name || 'drawing'}</span>
      <span class="pts">${p0 ? fmtTsShort(p0.timestamp) : '—'}${p0?.value != null ? ' @ ' + fmtPrice(p0.value, state.profile?.symbol) : ''}</span>
    </label>`;
  }).join('') : `<div class="empty-card"><b>这个周期还没有绘图</b><p>左侧工具栏画一笔试试；这里可以批量删除或清空。</p></div>`;
}

function openDrawMgr() {
  $('alertPanel').hidden = true;
  $('stratPanel').hidden = true;
  $('drawMgrPanel').hidden = false;
  renderDrawMgr();
}

/** 脚本 alert() → 提醒面板（D2） */
function renderAlerts(alerts, name = '') {
  const list = Array.isArray(alerts) ? alerts.slice().reverse() : [];
  state.pineAlerts = list;
  const badge = $('alertBadge');
  if (badge) { badge.hidden = !list.length; badge.textContent = String(list.length); }
  const box = $('alertList');
  if (!box) return;
  $('alertMeta').textContent = list.length
    ? `${name || state.profile?.symbol || ''} · ${list.length} 条提醒（最近的在前）`
    : `${name || ''} · 还没有提醒`;
  box.innerHTML = list.length
    ? list.map(a => `<div class="a ${/warn|error/.test(a.type) ? 'warn' : ''}">
        <span class="t">${a.time ? fmtTsShort(a.time) : (a.bar != null ? 'bar ' + a.bar : '—')}</span>
        <span class="m">${(a.message || a.title || '').replace(/[<>]/g, '')}</span></div>`).join('')
    : `<div class="empty-card"><b>还没有提醒</b><p>脚本里写 alert("…", alert.freq_once_per_bar_close)，应用到图上后这里会列出每次触发。</p></div>`;
}

/** 关闭布局浮层（✕ / Esc / 再点按钮 / 点图表外都走这里） */
function closeLayoutMenu() {
  const el = $('layoutMenu');
  if (el) el.hidden = true;
  const b = $('btnLayout');
  if (b) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }
}

/** 副图数量：1 = 单图，2..4 = 主图 + N-1 个副图 */
function setPaneCount(n) {
  if (!state.app) return;
  applyPaneLayout(state.app.chart, n);
  syncLayoutMenu();
  updateIndBadge();
  if (!$('indicatorPanel').hidden) renderIndicatorPanel();
  markDirty();
}

/** 布局菜单里「分屏排布」与「副图数量」的选中态（切换分屏也在这里绑定） */
function syncLayoutMenu() {
  const rows = $('splitRows');
  if (rows) {
    const cur = state.wsLayout || '1';
    const groups = [1, 2, 3, 4]
      .map(n => ({ n, items: LAYOUTS.filter(l => l.cells === n) }))
      .filter(g => g.items.length);
    rows.innerHTML = groups.map(g => `<div class="lay-row">
        <span class="lay-n">${g.n}</span>
        <div class="lay-grid">${g.items.map(l => `<button class="layout-opt lay-cell ${cur === l.key ? 'on' : ''}"
            data-split="${l.key}" title="${l.label} · ${l.cells} 图" aria-label="${l.label}">${miniLayout(l)}</button>`).join('')}</div>
      </div>`).join('');
    rows.querySelectorAll('[data-split]').forEach(b => {
      b.onclick = async () => {
        const key = b.dataset.split;
        if (!state.workspace) return;
        const periods = state.workspace.cells.map(c => c.app.periodKey);
        const keepCursor = state.replay?.cursor || null;
        state.wsLayout = key;
        await state.workspace.applyLayout(key, { periods });
        // applyLayout 会重建 MultiReplay：必须把 state.replay 换过去，并把游标对齐到新格子
        state.replay = state.workspace.multi;
        state.cxSync?.refresh();
        if (state.replay) {
          state.replay.setEmitter((s) => { RPL.renderReplay(s); updateStatus(); });
          if (keepCursor) await state.replay.setStart(keepCursor);
        }
        state.wsPeriods = state.workspace.cells.map(c => c.app.periodKey);
        const t = state.tabs.find(x => x.id === state.activeTab);
        if (t) { t.layout = key; t.periods = state.wsPeriods; saveTabs(); }
        kvSet('ui:split', { key, periods: state.wsPeriods });
        bindActiveCell();
        renderTabs();
        syncLayoutMenu();
        markDirty();
        updateStatus(`分屏：${layoutByKey(key).label}`);
        closeLayoutMenu();   // 选完就收起浮层
      };
    });
  }
  const n = state.app ? paneCount(state.app.chart) : 1;
  const pane = $('paneRows');
  if (pane) {
    if (!pane.querySelector('[data-panes]')) {
      pane.innerHTML = [1, 2, 3, 4].map(k => `<button class="layout-opt lay-cell" data-panes="${k}"
        title="${k === 1 ? '单图' : `主图 + ${k - 1} 副图`}">${miniPanes(k)}</button>`).join('');
      pane.querySelectorAll('[data-panes]').forEach(b => {
        b.onclick = () => setPaneCount(Number(b.dataset.panes));
      });
    }
    pane.querySelectorAll('[data-panes]').forEach(b => {
      b.classList.toggle('on', Number(b.dataset.panes) === n);
    });
  }
}

function wireLayoutMenu() {
  $('btnLayout').onclick = (e) => {
    e.stopPropagation();
    const el = $('layoutMenu');
    if (!el.hidden) { closeLayoutMenu(); return; }
    syncLayoutMenu();
    const r = $('btnLayout').getBoundingClientRect();
    placeAt(el, Math.round(r.right - 300), Math.round(r.bottom + 8));
    $('btnLayout').classList.add('on');
    $('btnLayout').setAttribute('aria-expanded', 'true');
  };
  $('closeLayout').onclick = (e) => { e.stopPropagation(); closeLayoutMenu(); };
  if ($('cxSync')) {
    $('cxSync').onchange = async (e) => {
      e.stopPropagation();
      const on = $('cxSync').checked;
      state.cxSync?.setEnabled(on);
      try { await kvSet('ui:cxsync', on); } catch {}
      updateStatus(on ? '十字光标已跨图同步' : '十字光标同步已关闭');
    };
  }
  $('TBOX.closeMoreTools') && ($('TBOX.closeMoreTools').onclick = (e) => { e.stopPropagation(); TBOX.closeMoreTools(); });
  $('layoutMenu').querySelectorAll('#paneRows .layout-opt').forEach(b => {
    b.onclick = () => {
      const n = Number(b.dataset.panes);
      if (state.app) applyPaneLayout(state.app.chart, n);
      syncLayoutMenu();
      updateIndBadge();
      if (!$('indicatorPanel').hidden) renderIndicatorPanel();
      markDirty();
    };
  });
  document.addEventListener('mousedown', (e) => {
    if ($('layoutMenu').hidden) return;
    if ($('layoutMenu').contains(e.target) || $('btnLayout').contains(e.target)) return;
    closeLayoutMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('layoutMenu').hidden) closeLayoutMenu();
  });
}

/* ---------------- 图表右键菜单（一级 + 二级） ---------------- */

function syncLayoutUI() {
  const l = state.layout || DEFAULT_LAYOUT;
  $('lyBg').value = l.bg;
  $('lyBg').disabled = l.bgMode !== 'custom';
  [...$('bgMode').children].forEach(b => b.classList.toggle('on', b.dataset.mode === l.bgMode));
  $('lyGrid').checked = !!l.grid;
  $('lyGridColor').value = l.gridColor || DEFAULT_LAYOUT.gridColor;
  $('lyGridColor').disabled = !l.grid;
  $('lyUp').value = l.up;
  $('lyDown').value = l.down;
  $('lyBorderAuto').checked = !!l.borderAuto;
  $('lyUpBorder').value = l.upBorder || l.up;
  $('lyDownBorder').value = l.downBorder || l.down;
  $('lyUpBorder').disabled = !!l.borderAuto;
  $('lyDownBorder').disabled = !!l.borderAuto;
}

function commitLayout(patch = {}) {
  state.layout = normalize({ ...state.layout, ...patch });
  applyThemePaneLayout();
  syncLayoutUI();
  saveLayout(state.layout);
}

/** 把浮层夹在视口内 */
function placeAt(el, x, y) {
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - r.width - 8));
  const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - r.height - 8));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function closeSubs() {
  $('layoutPanel').hidden = true;
  $('copyDrawPanel').hidden = true;
  document.querySelectorAll('#ctxMenu .mi.on').forEach(el => el.classList.remove('on'));
}

function closeCtx() {
  $('ctxMenu').hidden = true;
  closeSubs();
}

function openCtx(x, y) {
  closeSubs();
  placeAt($('ctxMenu'), x, y);
}

/** 二级菜单贴着对应的一级条目展开（右侧优先，放不下翻到左侧） */
function openSub(id, itemEl) {
  closeSubs();
  itemEl.classList.add('on');
  const el = $(id);
  el.hidden = false;
  const ir = itemEl.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const menuR = $('ctxMenu').getBoundingClientRect();
  // 贴着「菜单」外沿展开，而不是贴着条目内沿（否则会压住一级菜单）
  let left = menuR.right + 2;
  if (left + er.width > window.innerWidth - 8) left = menuR.left - er.width - 2;
  const top = Math.min(Math.max(8, ir.top - 6), Math.max(8, window.innerHeight - er.height - 8));
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = top + 'px';
}

/** 复位图表：回到最新一根 + 恢复默认柱宽 */
function resetChartView() {
  const chart = state.app?.chart;
  if (!chart) return;
  const list = chart.getDataList();
  try { chart.setBarSpace(8); } catch {}
  try { chart.scrollToDataIndex(Math.max(0, list.length - 1), 120); } catch {}
  updateStatus('已复位图表');
}

function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** 复制此图表：优先写剪贴板，不行就下载 */
async function copyChartImage() {
  let blob = null;
  try { blob = await captureChart($('chart')); } catch {}
  if (!blob) { updateStatus('复制失败：截图为空', true); return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': blob })]);
    updateStatus(`图表已复制到剪贴板（${MB(blob.size)} MB）`);
  } catch {
    saveBlob(`chart-${state.profile?.symbol || 'chart'}-${Date.now()}.jpg`, blob);
    updateStatus('剪贴板不可用，已下载图片');
  }
}

/** 截屏当前窗口 → 剪贴板（图表 + 顶部信息条 + 底部状态条） */
async function copyWindowShot() {
  const btn = $('btnShot');
  if (btn) btn.classList.add('busy');
  try {
    const p = state.profile;
    const app = state.app;
    const bars = app?.chart?.getDataList?.() || [];
    const last = bars.length ? bars[bars.length - 1].timestamp : null;
    const fmt = (ts) => (ts ? fmtTs(ts) : '—');
    const blob = await captureWindowShot($('chart'), {
      title: 'TraderTrain',
      symbol: p?.symbol || '',
      period: app?.periodKey ? app.periodKey.toUpperCase() : '',
      range: p ? `${fmt(p.first)} → ${fmt(p.last)}` : '',
      status: `周期 ${app?.periodKey || '-'} · 已加载 ${bars.length} 根 · ${$('stMsg')?.textContent || ''}`,
      stamp: last ? `游标 ${fmt(state.replay?.cursor || last)}` : ''
    });
    if (!blob) { updateStatus('截屏失败：图表还没画出来', true); return; }
    // 剪贴板写入要设超时：窗口没有焦点/权限弹窗挂着时，clipboard.write() 会永不 settle，
    // 表现就是“点了截屏没反应”。超时或失败一律退回下载，并如实报文案。
    const withTimeout = (pr, ms) => Promise.race([
      pr,
      new Promise((_, rej) => setTimeout(() => rej(new Error('clipboard timeout')), ms))
    ]);
    try {
      await withTimeout(navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]), 3000);
      updateStatus(`窗口截图已复制到剪贴板（${MB(blob.size)} MB）`);
    } catch (e) {
      saveBlob(`window-${p?.symbol || 'shot'}-${Date.now()}.png`, blob);
      updateStatus(`剪贴板不可用（${e.message}），已下载 PNG`);
    }
  } catch (e) {
    updateStatus(`截屏失败：${e.message}`, true);
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

/** Pine 策略回测：跑一次脚本 → 取 ctx.strategy → 出统计/权益曲线/明细 */
async function runPineBacktest(srcOverride = null, nameOverride = null) {
  const src = srcOverride ?? $('pineSrc').value.trim();
  const name = nameOverride ?? ($('pineName').value.trim() || '策略');
  if (!src) { updateStatus('先粘贴脚本', true); return null; }
  if (!/\bstrategy\s*\(/.test(src)) {
    updateStatus('这个脚本没有 strategy()，没有回测数据', true);
    return null;
  }
  const bars = state.app?.chart?.getDataList() || [];
  if (!bars.length) { updateStatus('还没有数据', true); return null; }

  const btn = $('pineBacktest');
  btn && (btn.disabled = true);
  updateStatus('回测中…');
  let r;
  try {
    const inputs = readEditorInputs();
    r = await compilePine(src, bars, inputs, state.profile?.symbol);
  } finally { btn && (btn.disabled = false); }

  if (!r.ok) { updateStatus(`回测失败：${r.error}`, true); return null; }
  const sum = summarizeStrategy(r.strategy);
  if (!sum) { updateStatus('脚本没有产生策略状态（没有成交）', true); renderStratPanel(null, name); return null; }
  renderAlerts(r.alerts || [], name);
  renderStratPanel(sum, name);
  $('pinePanel').hidden = true;
  $('stratPanel').hidden = false;
  updateStatus(`回测完成：${sum.trades} 笔 · 净盈亏 ${sum.net.toFixed(2)}`);
  return sum;
}

function renderStratPanel(sum, name) {
  const stats = $('stratStats');
  const rows = $('stratTrades');
  const meta = $('stratMeta');
  if (!sum) {
    stats.innerHTML = '';
    rows.innerHTML = '<div class="strat-empty">这个脚本没有产生成交</div>';
    meta.textContent = `${name} · 无回测数据`;
    return;
  }
  const money = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const items = [
    ['成交笔数', String(sum.trades)],
    ['净盈亏', money(sum.net)],
    ['胜率', pct(sum.winRate)],
    ['盈亏比 PF', sum.pf === Infinity ? '∞' : sum.pf.toFixed(2)],
    ['期望/笔', money(sum.expectancy)],
    ['最大回撤', sum.maxDD.toFixed(2) + (sum.maxDDPct ? ` (${pct(sum.maxDDPct)})` : '')],
    ['连胜/连亏', `${sum.winStreak} / ${sum.lossStreak}`],
    ['期末权益（含浮盈）', (sum.equity ?? sum.curve[sum.curve.length - 1]).toFixed(2)]
  ];
  stats.innerHTML = items.map(([k, v]) => `<div class="it"><span>${k}</span><b>${v}</b></div>`).join('');

  const fmtT = (ts) => (ts ? fmtTs(ts) : '—');
  const head = '<div class="r head"><span>#</span><span>方向</span><span>数量</span><span>开仓</span><span>平仓</span><span>盈亏</span></div>';
  const body = sum.rows.slice(0, 300).map(r => `<div class="r">
      <span>${r.i}</span><span>${r.side}</span><span>${r.qty}</span>
      <span>${fmtT(r.entryTime)}<br>${r.entryPrice != null ? fmtPrice(r.entryPrice, state.profile?.symbol) : '—'}</span>
      <span>${fmtT(r.exitTime)}<br>${r.exitPrice != null ? fmtPrice(r.exitPrice, state.profile?.symbol) : '—'}</span>
      <b class="${r.pnl >= 0 ? 'pos' : 'neg'}">${money(r.pnl)}</b>
    </div>`).join('');
  rows.innerHTML = head + (body || '<div class="strat-empty">没有已平仓交易</div>');
  meta.textContent = `${name} · ${state.profile?.symbol || ''} · ${sum.trades} 笔已平${sum.openTrades ? ` · ${sum.openTrades} 笔持仓中` : ''} · 本金 ${sum.initialCapital}`;
  requestAnimationFrame(() => drawCurve($('stratCurve'), sum.curve));
}

/* ---------------- Pine 指标 ---------------- */

/** 刷新页面后把上次上图的 Pine 指标重新算一遍挂回来（否则管理器为空，设置面板也认不出来） */
async function restorePineIndicators() {
  try {
    const ids = await loadPineActive();
    if (!ids?.length) return 0;
    const chart = state.app?.chart;
    if (!chart) return 0;
    const bars = chart.getDataList();
    if (!bars?.length) return 0;
    const lib = await libList();
    let n = 0;
    for (const id of ids) {
      const entry = lib.find(e => e.id === id);
      if (!entry) continue;
      const r = await state.pine.apply({ ...entry }, bars);
      if (r?.ok) n++;
    }
    state.pineMap = await loadPineMap();
    renderPineApplied?.();
    updateIndBadge();
    refreshLegend();
    return n;
  } catch (e) { console.warn('[pine restore]', e?.message); return 0; }
}

async function refreshPine() {
  if (!state.pine || !state.app) return;
  const bars = state.app.chart.getDataList();
  if (!bars.length) return;
  const applied = state.pine.list();
  for (const it of applied) {
    const entry = (await libList()).find(x => x.id === it.id);
    if (entry) await state.pine.apply(entry, bars);
  }
  renderPineApplied();
}

function renderPineApplied() {
  const box = $('pineApplied');
  const list = state.pine ? state.pine.list() : [];
  box.innerHTML = list.length
    ? list.map(it => `<div class="t"><span>${it.name} <span class="muted">${it.names.join('/')} · ${it.overlay ? '主图' : '子图'}</span></span>
        <button class="ghost" data-rm="${it.id}">移除</button></div>`).join('')
    : '<div class="muted">还没有上图的指标</div>';
  box.querySelectorAll('button[data-rm]').forEach(b => {
    b.onclick = () => {
      state.pine.remove(b.dataset.rm);
      renderPineApplied();
      updateIndBadge();
    };
  });
}

async function renderLib() {
  const list = await libList();
  const ul = $('libList');
  ul.innerHTML = list.length ? '' : '<li class="muted">（空）保存后出现在这里</li>';
  for (const e of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${e.name}<div class="meta">${e.overlay ? '主图' : '子图'} · ${(e.src || '').length} 字符</div></span>`;
    const box = document.createElement('span');
    const use = document.createElement('button');
    use.textContent = '载入';
    use.onclick = () => {
      state.pineEntry = { ...e };
      $('pineName').value = e.name;
      $('pineSrc').value = e.src;
      renderInputs(parseInputs(e.src), e.inputs || {});
      pineMsg(`已载入「${e.name}」`);
    };
    const apply = document.createElement('button');
    apply.textContent = '上图';
    apply.onclick = async () => {
      const bars = state.app.chart.getDataList();
      const r = await state.pine.apply({ ...e }, bars);
      pineMsg(r.ok ? `已上图：${r.names.join(', ')}` : `失败：${r.error}`, !r.ok);
      renderPineApplied();
    };
    const del = document.createElement('button');
    del.className = 'ghost'; del.textContent = '删除';
    del.onclick = async () => {
      await libRemove(e.id);
      state.pine?.remove(e.id);
      renderPineApplied();
      await renderLib();
    };
    box.append(use, apply, del);
    li.appendChild(box);
    ul.appendChild(li);
  }
}

/** 读编辑器里的参数（#pineInputs） */
function readEditorInputs() {
  const out = {};
  const box = $('pineInputs');
  if (!box) return out;
  for (const el of box.querySelectorAll('[data-piname]')) {
    const k = el.dataset.piname, t = el.dataset.pitype;
    if (t === 'bool') out[k] = el.checked;
    else if (t === 'int') { const n = parseInt(el.value, 10); if (Number.isFinite(n)) out[k] = n; }
    else if (t === 'float') { const n = parseFloat(el.value); if (Number.isFinite(n)) out[k] = n; }
    else if (el.value !== '') out[k] = el.value;
  }
  return out;
}

function renderInputs(inputs, values = {}) {
  const wrap = $('pineInputsWrap');
  const box = $('pineInputs');
  // 图表拖动/实时推进会让 refreshPine 周期性重建这里，正在输入的参数不能被冲掉
  if (box.contains(document.activeElement) && document.activeElement?.dataset?.piname) return;
  if (!inputs.length) { wrap.hidden = true; box.innerHTML = ''; return; }
  wrap.hidden = false;
  box.innerHTML = '';
  for (const p of inputs) {
    const label = document.createElement('span');
    label.textContent = `${p.title} (${p.type})`;
    const inp = document.createElement('input');
    inp.type = p.type === 'bool' ? 'checkbox' : (p.type === 'string' ? 'text' : 'number');
    inp.dataset.piname = p.title;
    inp.dataset.pitype = p.type;
    if (p.type === 'bool') inp.checked = values[p.title] ?? values[p.name] ?? p.def;
    else inp.value = values[p.title] ?? values[p.name] ?? p.def;
    inp.onchange = async () => {
      const entry = state.pineEntry;
      if (!entry) return;
      const v = p.type === 'bool' ? inp.checked : (p.type === 'string' ? inp.value : Number(inp.value));
      entry.inputs = { ...(entry.inputs || {}), [p.title]: v };
      const bars = state.app.chart.getDataList();
      const r = await state.pine.apply(entry, bars);
      pineMsg(r.ok ? `参数已应用（${p.title}=${v}）` : `应用失败：${r.error}`, !r.ok);
      renderPineApplied();
    };
    box.append(label, inp);
  }
}

async function checkPine() {
  const src = $('pineSrc').value.trim();
  if (!src) { pineMsg('源码为空', true); return null; }
  if (!state.app) { pineMsg('先导入并加载数据', true); return null; }
  const bars = state.app.chart.getDataList();
  pineMsg('编译中…');
  const { compilePine } = await import('./pine.js');
  // 编辑器里的源码即当前编辑对象，参数改动要作用在这份源码上
  state.pineEntry = { ...(state.pineEntry || {}), src, name: $('pineName').value.trim() || 'PINE 指标' };
  const inputs = state.pineEntry.inputs || null;

  // 先做兼容性预检：v6 / 绘图原语 / 表格这些在 v5 运行时会被静默忽略
  const compat = scanCompat(src);
  const notes = [];
  if (compat.versionNote) notes.push(compat.versionNote);
  for (const h of compat.hits) notes.push((h.level === 'bad' ? '✕ ' : '! ') + h.msg);
  if (!compat.hasPlot) notes.push('✕ 脚本里没有 plot()：数值型输出才算指标，label/table/box 画的东西不会上图');

  const r = await compilePine(src, bars, inputs, state.profile?.symbol);
  if (!r.ok) {
    pineMsg([`编译失败${r.line ? `（第 ${r.line} 行）` : ''}：${r.error}`, ...notes].join('\n'), true);
    return null;
  }
  const head = `编译通过：${r.names.length} 条输出${r.names.length ? `（${r.names.join(', ')}）` : ''} · ${r.overlay ? '主图' : '子图'}`;
  if (!r.names.length) notes.unshift('请注意：这次没有任何数值输出，图上不会出现线');
  pineMsg([head, ...notes].join('\n'), compat.worst === 'bad' || !r.names.length);
  renderInputs(parseInputs(src), state.pineEntry?.inputs || {});
  return r;
}

async function applyPine() {
  const src = $('pineSrc').value.trim();
  const name = $('pineName').value.trim() || 'PINE 指标';
  if (!src) { pineMsg('源码为空', true); return; }
  if (!state.app) { pineMsg('先导入并加载数据', true); return; }
  const bars = state.app.chart.getDataList();
  const entry = {
    id: state.pineEntry?.id || `P${Date.now().toString(36)}`,
    name, src,
    inputs: state.pineEntry?.inputs || {},
    savedAt: Date.now()
  };
  const compat = scanCompat(src);
  const r = await state.pine.apply(entry, bars);
  if (!r.ok) {
    const notes = [compat.versionNote, ...compat.hits.map(h => (h.level === 'bad' ? '✕ ' : '! ') + h.msg)].filter(Boolean);
    pineMsg([`编译/应用失败${r.line ? `（第 ${r.line} 行）` : ''}：${r.error}`, ...notes].join('\n'), true);
    return;
  }
  entry.overlay = r.overlay;
  state.pineEntry = entry;
  await libSave(entry);
  await renderLib();
  renderPineApplied();
  updateIndBadge();
  renderInputs(parseInputs(src), entry.inputs);
  renderAlerts(r.alerts || [], entry.name);
  const warn = [compat.versionNote, ...compat.hits.filter(h => h.level === 'bad').map(h => '✕ ' + h.msg)].filter(Boolean);
  const alertNote = (r.alerts || []).length ? ` / ${r.alerts.length} 条提醒` : '';
  pineMsg([`已保存并上图：${r.names.join(', ') || '（无输出）'}${alertNote}`, ...warn].join('\n'), !r.names.length);
}

function wirePine() {
  $('closePine').onclick = () => { $('pinePanel').hidden = true; };
  $('closePine').onclick = () => { $('pinePanel').hidden = true; };
  $('pineSample').onclick = () => {
    $('pineSrc').value = SAMPLE_PINE;
    $('pineName').value = $('pineName').value || 'EMA 20/50';
    renderInputs(parseInputs(SAMPLE_PINE), {});
  };
  $('pineCheck').onclick = () => checkPine();
  $('pineApply').onclick = () => applyPine();
  $('pineBacktest').onclick = () => runPineBacktest();
  $('pineAlerts').onclick = () => { $('stratPanel').hidden = true; $('pinePanel').hidden = true; $('alertPanel').hidden = false; renderAlerts(state.pineAlerts || []); };
  $('closeAlerts').onclick = () => { $('alertPanel').hidden = true; };
  $('closeDrawMgr').onclick = () => { $('drawMgrPanel').hidden = true; };
  $('drawMgrAll').onclick = () => {
    const boxes = [...$('drawMgrList').querySelectorAll('input[type=checkbox]')];
    const allOn = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !allOn; });
  };
  $('drawMgrDel').onclick = () => {
    const ids = [...$('drawMgrList').querySelectorAll('input[type=checkbox]:checked')].map(b => b.dataset.oid);
    if (!ids.length) { updateStatus('先勾选要删的绘图', true); return; }
    ids.forEach(id => { try { state.app.chart.removeOverlay({ id }); } catch {} });
    state.draw?.capture?.(); state.draw?.persist?.(); state.draw?.onChange?.();
    renderDrawMgr();
    updateStatus(`已删除 ${ids.length} 个绘图`);
  };
  $('drawMgrClear').onclick = () => {
    state.draw?.clear?.();
    renderDrawMgr();
    updateStatus('已清空当前周期的绘图');
  };
  $('closeStrat').onclick = () => { $('stratPanel').hidden = true; };
}

/* ---------------- 装配 ---------------- */


/** 换数据源/重新加载前清空所有 TAB：否则旧 workspace 只被部分 dispose，
 *  activateTab(state.tabs[0]) 会激活那个已废弃的 TAB，图表显示 0 根 */
function resetTabs() {
  for (const t of state.tabs || []) {
    try { t.ws?.multi?.pause?.(); } catch {}
    try { t.ws?.dispose?.(); } catch {}
    try { t.root?.remove(); } catch {}
  }
  state.tabs = [];
  state.activeTab = null;
  state.workspace = null;
  state._tabOfReplay = null;
  const list = $('tabList'); if (list) list.innerHTML = '';
  const park = $('tabPark'); if (park) park.innerHTML = '';
}

async function loadProfile(profile) {
  try { if (state.live) { await state.live.stop(); state.live = null; paintLive({ state: 'idle' }); } } catch {}
  window.__BOOT_STAGE__ = 'loadProfile:start'; window.__BOOT_TICK__ = Date.now();
  // 自检/外部脚本的等待点：loadProfile 全部装完才 resolve
  window.__APP_READY__ = new Promise((res) => { state._appReady = res; });
  try { state.pine?.clear(); } catch {}
  resetTabs();                                   // 先拆干净，再按新数据源重建
  try { state.app?.dispose(); } catch {}
  state.app = null;
  state.profile = profile;
  try { await kvSet('ui:profile', profile.id); } catch {}
  if (state.pine) state.pine.symbol = profile.symbol;
  if ($('symbol')) $('symbol').textContent = profile.symbol;
  // ---- 多图工作区（分屏）：默认按上次的分屏布局，格子周期可各自不同 ----
  const split = (await kvGet('ui:split')) || { key: '1', periods: null };
  state.wsLayout = split.key || '1';
  state.wsPeriods = Array.isArray(split.periods) ? split.periods : null;

  // ---- 图表 TAB：每个 TAB 一套独立的工作区（分屏 + 周期 + 游标） ----
  const tabsSaved = (await kvGet('ui:tabs')) || null;
  if (Array.isArray(tabsSaved) && tabsSaved.length) {
    const uniq = [...new Map(tabsSaved.map(t => [t.id, t])).values()];   // 去掉历史重复
    for (const t of uniq) await createTab({ ...t, restore: true });
  } else {
    await createTab({ name: '图表 1', layout: state.wsLayout, periods: state.wsPeriods });
  }
  activateTab(state.tabs[0].id);
  state.app = state.workspace.app;
  window.__BOOT_STAGE__ = 'mounted'; window.__BOOT_TICK__ = Date.now();
  await state.app.waitLoaded();
  state.app.applyPrecisionFromData();
  TRADE.updateAsOf();
  TRADE.detectVolume();
  window.__BOOT_STAGE__ = 'loaded'; window.__BOOT_TICK__ = Date.now();

  // 十字光标跨图同步（默认开，开关在布局菜单里）
  try {
    const on = (await kvGet('ui:cxsync')) !== false;
    const box = $('cxSync');
    if (box) box.checked = on;
    state.cxSync?.destroy?.();
    state.cxSync = new CrosshairSync(state.workspace, { enabled: on });
    state.cxSync.refresh();
  } catch {}

  state.layout = await loadLayout();
  applyThemePaneLayout();
  syncLayoutUI();

  state.pineEntry = null;
  state.replay.cursor = state.app.anchor;

  hideOvBar();

  const savedTrades = null;   // 交易真值改由场次承载（session.trades），不再单独存 trades:<symbol>
  state.trade = new TradeSim({ onChange: TRADE.onTradeChange });
  await SESS.ensureSession(profile.symbol);
  state.indPrefs = await loadIndPrefs();       // 指标参数/颜色偏好
  try { const lg = await kvGet('ui:legend'); state.legendOpen = lg ? lg.open !== false : true; } catch { state.legendOpen = true; }
  state.trade.trades = [...(state.session.trades || [])];
  state.trade.realized = state.trade.trades.reduce((s, t) => s + t.pnl, 0);
  TRADE.renderTrade(state.trade.snapshot());
  await renderLib();

  $('date').value = new Date(profile.last).toISOString().slice(0, 10);
  $('startAt').value = fmtLocalInput(Math.max(profile.first, profile.last - 86400000));
  renderPeriods();
  await loadMagnet();
  // 有存档就按存档恢复（主题/版面/吸附/绘图样式/模板/工具栏/周期）
  const _snap = await loadConfigSnapshot();
  if (_snap) await applyWorkspaceSnapshot(_snap);
  TBOX.renderTools();
  RPL.renderReplay();
  renderPineApplied();
  updateIndBadge();
  syncLayoutMenu();
  TBOX.placeTools();
  window.__BOOT_STAGE__ = 'periods'; window.__BOOT_TICK__ = Date.now();
  updateStatus(`已加载 ${profile.symbol}（${fmtDay(profile.first)} → ${fmtDay(profile.last)}）`);
  await DATA.renderProfiles();
  await restorePineIndicators();
  // 回放开关：默认关（只留一个入口，打开才出回放控件）
  let replayPref = false;
  try { replayPref = (await kvGet('ui:replay')) === true; } catch {}

  // 实时：用户没明确关过、且源能取到数据，就默认开着
  try {
    const pref = await kvGet('ui:live');          // null=没选过 / true / false
    // 不预探活：冷启动第一次连上游可能要好几秒，探不通就直接放弃会把“实时”永久关掉。
    // 交给 feed 自己每 3 s 重试，出错会体现在状态栏（延迟/错误）。
    if (state.profile && pref !== false && !state.live) await startLiveFeed();
  } catch (e) { logErr('live:恢复', e); }

  // 启动自动补缺口（默认关；一次页面生命周期只试一次，避免导入后 loadProfile 递归）
  try {
    if (state.profile && !state._gapTried && (await kvGet('ui:autogap')) !== false) {
      state._gapTried = true;
      const { autoGapFill } = await import('./download.js');
      const sym = state.profile.symbol;
      const r = await autoGapFill(sym, {
        onStatus: (t, err) => {
          if (err || /已续传|导入失败|下载失败|已取消/.test(t)) updateStatus(`自动补缺口：${t}`, !!err);
        }
      });
      if (r.started) updateStatus(`自动补缺口：${r.from} → ${r.to} 开始下载（图表可先用，完成后自动刷新）`);
      else if (r.reason === 'up-to-date') console.info('[gap] 无缺口');
      else console.warn('[gap] 跳过：', r.reason);
    }
  } catch (e) { logErr('gap:自动补', e); }

  // 图表/回放对象就绪后再落实回放开关状态（这时 seek 才有意义）
  try { await applyReplayMode(replayPref === true, { silent: true }); } catch (e) { logErr('replay:恢复', e); }

  window.__BOOT_STAGE__ = 'ready'; window.__BOOT_TICK__ = Date.now();
  state._appReady?.(true);
}

async function refresh() {
  state.profiles = await getProfiles();
  await DATA.renderProfiles();
  await DATA.renderUsage();
}

function showBootError(err) {
  const msg = String((err && (err.stack || err.message)) || err);
  window.__BOOT_ERR__ = msg;
  console.error('[boot]', err);
  try {
    let box = document.getElementById('bootErr');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bootErr';
      box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:64px;z-index:9999;padding:12px 14px;'
        + 'border:1px solid rgba(255,111,133,.5);border-radius:6px;background:rgba(40,10,16,.96);'
        + 'color:#ffd9de;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;max-height:40vh;overflow:auto';
      document.body.appendChild(box);
    }
    box.textContent = '启动失败：' + msg + '\n\n按 Ctrl+R 重试；若反复出现，把这段发给维护者。';
  } catch {}
  try { const sb = document.getElementById('stMsg'); if (sb) sb.textContent = '启动失败：' + msg.slice(0, 120); } catch {}
}

/* ---------------- 实时采集（biquote → live store） ---------------- */
function liveBtn() { return $('btnLive'); }

function paintLive(s = {}) {
  const b = liveBtn(); if (!b) return;
  const on = s.state === 'live';
  b.classList.toggle('on', on);
  b.classList.toggle('err', !!s.err);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  const t = b.querySelector('.live-txt');
  if (t) t.textContent = on ? '实时中' : '实时';
  const bits = [];
  if (s.symbol) bits.push(s.symbol);
  if (s.last) bits.push(`最近 ${new Date(s.last).toISOString().slice(11, 16)}Z`);
  if (s.lagSec != null) bits.push(`延迟 ${s.lagSec}s`);
  if (s.pending) bits.push(`待写 ${s.pending}`);
  if (s.written) bits.push(`已入库 ${s.written} 根`);
  if (s.backfilled) bits.push(`回补 ${s.backfilled} 根`);
  if (s.err) bits.push(`错误 ${String(s.err).slice(0, 60)}`);
  b.title = on ? `实时采集中：${bits.join(' · ')}` : '实时采集（biquote）：每 3 s 拉一次，收盘那根自动入库';
  // 状态栏只在“状态/错误”变化时写一行；每轮轮询都写会把用户的提示（随机起点/截屏…）冲掉
  const sig = `${on}|${s.err ? 1 : 0}`;
  if (sig !== state._liveSig) {
    state._liveSig = sig;
    if (on || s.err) updateStatus(`实时 · ${bits.join(' · ')}`);
  }
  try { TRADE.updateAsOf(); } catch {}
}

/** 窗口末根离实时多远还算“贴着实时”（超过就当用户停在历史，不自动拽） */
const NEAR_LIVE_MS = 10 * 60_000;

async function startLiveFeed() {
  const p = state.profile;
  if (!p) { updateStatus('实时：还没有行情数据'); return; }
  // 单实例：同一品种已经在采就不要再起一个（两个 feed 会互相覆盖 live 分片）
  if (state.live && state.live.running && state.live.profile?.id === p.id) {
    paintLive(state.live.status());
    return;
  }
  if (state.live) await state.live.stop();
  const { LiveFeed } = await import('./live.js');
  state.live = new LiveFeed({
    profile: p,
    onForming: (bar) => {
      // 贴边就原地更新；落后超过 2 分钟说明窗口已经掉队（休眠/断线/我方的假 bar 等），
      // 直接整窗重载到最新——否则原来的「距离 ≤2 根」判断会让它永远追不上，表现就是“图表不动但数据在写”
      const ch = state.app;
      if (!ch || state.replayMode) return;
      const last = ch?.lastTs?.();
      const behind = last ? bar.timestamp - last : Infinity;
      if (behind <= 2 * 60_000) {
        if (bar.timestamp >= (last || 0)) {
          try { ch.pushBar({ timestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 }); } catch {}
        }
      } else if (behind <= NEAR_LIVE_MS) {
        catchUpLive(bar.timestamp);          // 窗口还贴着实时（≤10 分钟），补齐掉队的几根
      }
      // 更远说明用户主动停/跳到历史，等「最新」或回放开关把他带回来，别去拽窗口
    },
    onClosed: async (bars) => {
      const ch = state.app;
      if (!ch) return;
      const had = await ch.refreshLive();
      const last = bars[bars.length - 1];
      const tail = ch.lastTs?.();
      try { TRADE.updateAsOf(); } catch {}
      if (!had || !last || state.replayMode) return;
      const behind = tail ? last.timestamp - tail : Infinity;
      if (behind <= 2 * 60_000) {
        if (last.timestamp > (tail || 0)) {
          try { ch.pushBar({ timestamp: last.timestamp, open: last.open, high: last.high, low: last.low, close: last.close, volume: 0 }); } catch {}
        }
      } else if (behind <= NEAR_LIVE_MS) {
        catchUpLive(last.timestamp);
      }
    },
    onStatus: (s) => paintLive(s)
  });
  await state.live.start();
  await kvSet('ui:live', true).catch(() => {});
  paintLive(state.live.status());

  // 历史与实时之间的空洞要明说（不自欺：图上那一大段空白不是渲染问题）
  try {
    const LS = await import('./liveStore.js');
    const meta = await LS.getLiveMeta(p.id);
    const firstLive = meta.days?.[0]?.first;
    if (p.last && firstLive && firstLive - p.last > 86400000) {
      const days = Math.round((firstLive - p.last) / 86400000);
      updateStatus(`实时已开 · 历史止于 ${fmtTs(p.last)}，与实时之间缺 ${days} 天 · 用「补到昨天」补齐`, true);
    }
  } catch {}
}

async function stopLiveFeed() {
  if (state.live) { await state.live.stop(); state.live = null; }
  await kvSet('ui:live', false).catch(() => {});
  paintLive({ state: 'idle' });
  updateStatus('实时已停止');
}

/** 源探活：能取到 1 根已收盘 bar 就算“源可用”（3 s 超时） */
async function liveSourceReady(symbol, { timeout = 8000, tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(`/api/live?symbol=${encodeURIComponent(symbol)}&limit=2`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.bars) && j.bars.length > 0) return true;
      }
    } catch (e) { /* 冷启动上游慢，再来一次 */ }
    if (i + 1 < tries) await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

/** 回放模式开关：关着的时候回放相关控件全部不出现 */
async function applyReplayMode(on, opts = {}) {
  state.replayMode = !!on;
  const bar = $('replayBar');
  if (bar) bar.dataset.on = on ? '1' : '0';
  const btn = $('btnReplay');
  if (btn) {
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? '回放模式：开（点一下收起回放控件）' : '回放模式：打开后显示起点 / 播放 / 步进 / 速度';
  }
  document.body.classList.toggle('replay-on', !!on);
  // 打开回放时把游标贴到当前最右一根，免得“播放”从几分钟前跳回去
  if (on) {
    try {
      const t = state.app?.lastTs?.();
      if (t && state.replay) { state.replay.cursor = t; state.replay.emit?.(); }
    } catch {}
  }
  if (!on) {
    try { state.replay?.pause?.(); } catch {}
    if (opts.noSeek) { if (!opts.silent) await kvSet('ui:replay', false).catch(() => {}); return; }
    // 收起回放后回到最新一根（历史与实时取更晚者），避免画面停在半路
    try {
      const p = state.profile;
      const newest = Math.max(p?.last || 0, p?.live?.last || 0);
      if (state.replay && newest) await state.replay.setStart(Math.min(Date.now(), newest + 60000));
    } catch {}
  }
  if (!opts.silent) await kvSet('ui:replay', !!on).catch(() => {});
}

/**
 * 实时窗口掉队时追赶：优先「把缺的 bar 一根根补进去」（增量，可靠），
 * 落后太多（>120 根）才退化成整窗重载。3 s 内只追一次，避免抖动。
 */
async function catchUpLive(newestTs) {
  const now = Date.now();
  if (state._catchupAt && now - state._catchupAt < 3_000) return;
  state._catchupAt = now;
  const ch = state.app;
  if (!ch || state.replayMode) return;
  const tail = ch.lastTs();
  if (!tail) return;
  const behindBars = Math.ceil(((newestTs || now) - tail) / 60_000);
  try {
    if (behindBars > 120) {
      const at = Math.min(Date.now(), (newestTs || now) + 60_000);
      await state.replay?.setStart(at);
      console.info('[live] 落后太多，整窗重载到', new Date(at).toISOString());
      return;
    }
    const bars = await ch.source.frame((newestTs || now), 60_000, behindBars + 2);
    let pushed = 0;
    for (const b of bars) {
      if (b.timestamp <= tail) continue;
      ch.pushBar({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 });
      pushed++;
    }
    if (pushed) console.info('[live] 窗口落后 %d 根，已增量补齐 %d 根', behindBars, pushed);
  } catch (e) { logErr('live:追赶', e); }
}

/** 跳到最新 K 线：退出回放、回到实时边缘，并把实时采集拉起来 */
async function jumpToLatest(opts = {}) {
  const p = state.profile;
  if (!p) { updateStatus('还没有行情数据', true); return null; }
  try {
    // 回放开着就先关掉（内部会 pause + 把游标/窗口送回最新）
    if (state.replayMode) await applyReplayMode(false, { silent: !!opts.silent });
  } catch {}
  // 兜底再定位一次（已经在最新时这一步几乎零成本）
  let at = null;
  try {
    const newest = Math.max(p.last || 0, p.live?.last || 0);
    if (newest) {
      at = Math.min(Date.now(), newest + 60_000);
      await state.replay?.setStart(at);
      // 游标对齐到真实的那根 bar（否则会落在分钟中间，回放/步进的起点不干净）
      const t = state.app?.lastTs?.();
      if (t && state.replay) { state.replay.cursor = t; state.replay.emit?.(); at = t; }
    }
  } catch (e) { logErr('latest:定位', e); }
  // 切回实时：源能取到数据就把采集拉起来
  try {
    if (!state.live && (await liveSourceReady(p.symbol))) await startLiveFeed();
  } catch (e) { logErr('latest:实时', e); }
  if (!opts.silent) {
    updateStatus(state.live
      ? `已跳到最新 K 线 · 实时中${at ? ' · ' + fmtTs(at) : ''}`
      : `已跳到最新 K 线${at ? ' · ' + fmtTs(at) : ''}（实时源不可用）`);
  }
  return { at, live: !!state.live, replayMode: !!state.replayMode };
}

function wireLive() {
  liveBtn()?.addEventListener('click', async () => {
    if (state.live) await stopLiveFeed();
    else await startLiveFeed();
  });
  $('btnLatest')?.addEventListener('click', async () => { await jumpToLatest(); });
  $('btnReplay')?.addEventListener('click', async () => {
    await applyReplayMode(!state.replayMode);
    updateStatus(state.replayMode ? '回放模式：开（起点/播放/步进/速度已就位）' : '回放模式：关（回到实时视图）');
  });
  window.__TT_JUMP_LATEST__ = (o) => jumpToLatest(o);
  window.__TT_RESET__ = () => resetForTest();
  window.__TT_REPLAY_MODE__ = {
    on: () => applyReplayMode(true),
    off: () => applyReplayMode(false),
    state: () => !!state.replayMode
  };
  // 看门狗：设置是“开”但没在采集（feed 丢了 / 轮询卡住 / 睡醒后 timer 停了）→ 重启
  setInterval(async () => {
    try {
      if (!state.profile) return;
      const pref = await kvGet('ui:live');
      if (pref === false) return;
      const f = state.live;
      const stalled = !f || !f.running || !f.stats?.lastPollAt || (Date.now() - f.stats.lastPollAt > 60_000);
      if (stalled) {
        console.warn('[live] 看门狗重启：', f ? (f.running ? '轮询停滞' : 'feed 已停') : '无 feed');
        if (state.live) { try { await state.live.stop(); } catch {} state.live = null; }
        await startLiveFeed();
      }
    } catch (e) { logErr('live:看门狗', e); }
  }, 30_000);

  window.__TT_LIVE__ = {
    start: () => startLiveFeed(),
    stop: () => stopLiveFeed(),
    status: () => state.live?.status() || { state: 'idle' },
    feed: () => state.live
  };
}

async function boot() {
  window.__BOOT_STAGE__ = 'boot:start'; window.__BOOT_TICK__ = Date.now();
  // 看门狗：30 秒还没 ready 先判断“还在不在动”——阶段还在推进就继续等（冷启动读 400 万根要几十秒），
  // 连续 20 秒没推进才报阶段，避免把慢启动误判成白屏
  setTimeout(function checkBoot() {
    if (window.__UI_READY__) return;
    const idle = Date.now() - (window.__BOOT_TICK__ || 0);
    if (idle < 20000 && (window.__BOOT_TRIES__ = (window.__BOOT_TRIES__ || 0) + 1) < 15) {
      setTimeout(checkBoot, 10000);
      return;
    }
    showBootError('启动超时，卡在阶段：' + (window.__BOOT_STAGE__ || 'boot:start'));
  }, 30000);
  state.tools = (await kvGet('ui:tools')) || { mode: 'float', x: null, y: null };
  state.drawStyles = await loadDrawStyles();
  state.drawTemplates = await loadTemplateStore();
  registerFibOverlay(window.klinecharts);
  registerPositionOverlays(window.klinecharts);
  registerPolylineOverlay(window.klinecharts);
  try {
    const { registerCustomIndicators } = await import('./customIndicators.js');
    registerCustomIndicators(window.klinecharts);
    const { registerSmcIndicators } = await import('./smc.js');
    registerSmcIndicators(window.klinecharts);
    const { registerFlowIndicators } = await import('./flow.js');
    registerFlowIndicators(window.klinecharts);
  } catch (e) { console.warn('[customInd]', e?.message); }
  state.pineMap = await loadPineMap();
  state.indFavs = await loadFavs();
  state.indCombos = await loadCombos();
  state.indCat = IND_CATS.some(c => c.key === state.indCat) ? state.indCat : 'key';
  TBOX.registerExtensionOverlays();
  registerSegmentOverlay(window.klinecharts, () => state.app?.chart || null);
  bindModifierKeys();
  SESS.wireModifierNudge();
  state.theme = await loadTheme();
  applyThemeMode(state.theme);
  THEME.updateThemeButton();
  try { state.manifest = await loadManifest(); }
  catch (err) { msg(`manifest 读取失败：${err.message}`, true); }
  await DATA.renderAvail();
  await refresh();
  // 没有任何行情 → 图表区给一句人话（exe 首次启动、换了数据空间都会遇到）
  const ce = $('chartEmpty');
  if (ce) {
    ce.hidden = state.profiles.length > 0;
    $('ceGoData') && ($('ceGoData').onclick = () => { ce.hidden = true; $('btnData')?.click(); });
  }

  if (state.profiles.length) {
    const lastId = await kvGet('ui:profile').catch(() => null);
    const pick = state.profiles.find(p => p.id === lastId) || state.profiles[state.profiles.length - 1];
    await loadProfile(pick);
  }

  window.__BOOT_STAGE__ = 'ui:bind';
  wireTabs();
  RPL.wireReplay();
  TRADE.wireTrade();
  SESS.wireSession();
  wirePine();
  COPYDRAW.wireContextMenu();
  wireIndicatorPanel();
  wireIndSettings();
  wireLegendHover();
  wireLayoutMenu();
  TBOX.wireTools();
  TBOX.wireDrawStylePanel();
  window.__renderOvMenu__ = () => { renderOvMenu(); };
  window.__TT_RENDER_STRAT__ = (sum, name) => renderStratPanel(sum, name);
  window.__TT_RENDER_ALERTS__ = (list, name) => renderAlerts(list, name);
  window.__TT_EXPORT_REPORT__ = (sess) => exportSessionReport(sess);
  window.__TT_RENDER_DRAWMGR__ = () => renderDrawMgr();
  window.__TT_RENDER_SESSION__ = () => { try { TRADE.renderTrade(state.trade.snapshot()); } catch {} };
  wireOverlayBar();
  THEME.wireThemeMenu();
  wireSaveButton();
  ARCH.wireArchive();
  CSV.wireCsvImport();
  import('./download.js').then(m => m.wireDownload()).catch(() => {});
  // 下载完成后走跟 ZIP 导入一样的收尾
  window.__TT_AFTER_IMPORT__ = async (saved) => { await refresh(); await loadProfile(saved); };
  window.__TT_LOAD_PROFILE__ = (p) => loadProfile(p);   // 自检可切换档案
  window.__TT_RENDER_IND__ = () => renderIndicatorPanel();   // 调试/自检用
  window.__TT_REFRESH_PINE__ = () => refreshPine();
  window.__TT_RENDER_SESSION_FULL__ = () => SESS.renderSession();
  startBuildWatch();
  window.__UI_READY__ = true;          // 全部事件已绑好（自检要等这个，不是 __APP_READY__）
  $('btnData').onclick = () => {
    $('drawer').hidden = !$('drawer').hidden;
    $('btnData').classList.toggle('active', !$('drawer').hidden);
  };
  $('closeDrawer').onclick = () => { $('drawer').hidden = true; $('btnData').classList.remove('active'); };
  wireTransfer();
  // 快捷键帮助：? 开关、Esc 关闭
  const helpEl = $('helpPanel');
  $('helpClose') && ($('helpClose').onclick = () => { helpEl.hidden = true; });
  window.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
    if (e.key === '?') { e.preventDefault(); helpEl.hidden = !helpEl.hidden; }
    else if (e.key === 'Escape' && !helpEl.hidden) { helpEl.hidden = true; }
  });
  wireLive();
  try { startSmcRender(state); } catch (e) { logErr('smc:启动', e); }
/* ---------------- 换机迁移：配置 / 行情 导出导入 ---------------- */
function wireTransfer() {
  const msg = $('xferMsg');
  const wrap = $('xferProgWrap');
  const prog = $('xferProg');
  const text = $('xferText');
  const say = (t, kind = '') => { if (msg) { msg.textContent = t; msg.dataset.kind = kind; } };

  const busy = (on) => {
    for (const id of ['xferCfgExport', 'xferCfgImport', 'xferDataExport', 'xferDataImport']) {
      const b = $(id); if (b) b.disabled = on;
    }
  };
  const showProg = (on) => { if (wrap) wrap.hidden = !on; if (on && prog) prog.value = 0; };
  const onProg = (p) => {
    if (!prog) return;
    prog.value = p.pct || 0;
    if (text) text.textContent = p.total
      ? `${p.pct}% · ${(p.done / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB · 分片 ${p.chunk || 0}/${p.chunks || 0}`
      : '准备中…';
  };

  $('xferCfgExport')?.addEventListener('click', async () => {
    busy(true); say('正在打包配置…');
    try {
      const T = await import('./transfer.js');
      const r = await T.exportConfig();
      T.downloadBlob(r.blob, r.name);
      say(`配置已导出：${r.keys} 项 · ${T.fmtBytes(r.bytes)} · ${r.name}`, 'ok');
    } catch (e) { say(`导出配置失败：${e.message}`, 'err'); }
    finally { busy(false); }
  });

  $('xferCfgImport')?.addEventListener('click', () => $('xferCfgFile')?.click());
  $('xferCfgFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = '';
    if (!f) return;
    busy(true); say(`正在导入配置 ${f.name} …`);
    try {
      const T = await import('./transfer.js');
      const r = await T.importConfig(f);
      say(`配置已导入：${r.keys} 项 · 页面即将重载…`, 'ok');
      setTimeout(() => location.reload(), 900);
    } catch (e) { say(`导入配置失败：${e.message}`, 'err'); busy(false); }
  });

  $('xferDataExport')?.addEventListener('click', async () => {
    busy(true); showProg(true); say('正在打包行情…');
    try {
      const T = await import('./transfer.js');
      const r = await T.exportData(onProg);
      if (!r.chunks) { say('本机还没有可导出的行情（先导入或下载一段）', 'warn'); showProg(false); busy(false); return; }
      T.downloadBlob(r.blob, r.name);
      say(`行情已导出：${r.profiles} 个品种 · ${r.chunks} 个分片 · ${T.fmtBytes(r.bytes)} · ${r.name}`, 'ok');
    } catch (e) { say(`导出行情失败：${e.message}`, 'err'); }
    finally { showProg(false); busy(false); }
  });

  $('xferDataImport')?.addEventListener('click', () => $('xferDataFile')?.click());
  $('xferDataFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = '';
    if (!f) return;
    busy(true); showProg(true); say(`正在读取 ${f.name} …`);
    try {
      const T = await import('./transfer.js');
      const peek = await T.peekData(f);
      say(`包内 ${peek.header.profiles?.length || 0} 个品种 · ${peek.header.chunks?.length || 0} 个分片，开始写入…`);
      const r = await T.importData(f, onProg);
      say(`行情已导入：${r.profiles} 个品种（${(r.symbols || []).join(' / ') || '—'}）· ${r.chunks} 个分片 · ${T.fmtBytes(r.bytes)}，页面即将重载…`, 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { say(`导行情包失败：${e.message}`, 'err'); busy(false); showProg(false); }
  });

  window.__TT_TRANSFER__ = { exportConfig: async () => (await import('./transfer.js')).exportConfig(),
    importConfig: (f) => import('./transfer.js').then(m => m.importConfig(f)),
    exportData: (cb) => import('./transfer.js').then(m => m.exportData(cb)),
    importData: (f, cb) => import('./transfer.js').then(m => m.importData(f, cb)),
    peekData: (f) => import('./transfer.js').then(m => m.peekData(f)) };
}

  $('goto').onclick = async () => {
    if (!state.app) return;
    const v = $('date').value;
    if (!v) return;
    const ts = Date.parse(v + 'T23:59:59Z');
    const t0 = performance.now();
    if (state.replay) await state.replay.setStart(ts);
    else await state.app.goto(ts);
    $('startAt').value = fmtLocalInput(ts);
    if (state.draw) await state.draw.load();
    updateStatus(`定位 ${v}（UTC）· ${Math.round(performance.now() - t0)} ms`);
    RPL.schedulePineRefresh();
  };
  window.__BOOT_STAGE__ = 'ready'; window.__BOOT_TICK__ = Date.now();
}


/** 测试用：在“独立 origin”上把 data/manifest.json 的 bin 分片灌进 IndexedDB（?seed=1） */
async function seedForTest() {
  const { loadManifest, importProfile } = await import('./loader.js');
  const { getProfile } = await import('./db.js');
  window.__SEED_PCT__ = 0;
  try {
    const mf = await loadManifest();
    for (const p of mf.profiles) {
      if (await getProfile(p.id)) { window.__SEED_PCT__ = 100; continue; }
      await importProfile(p, {
        verify: false,   // 本地测试环境，跳过 sha256 省时间
        onProgress: (pr) => { window.__SEED_PCT__ = pr.totalBytes ? Math.round((pr.doneBytes / pr.totalBytes) * 100) : 0; }
      });
      window.__SEED_PCT__ = 100;
    }
  } catch (e) {
    window.__SEED_ERR__ = String(e.message || e);
    logErr('seed', e);
  } finally {
    window.__SEED_DONE__ = true;
    document.title = window.__SEED_ERR__ ? 'SEED ERR' : 'SEED OK';
  }
}

if (new URLSearchParams(location.search).get('seed') === '1') await seedForTest();


/* --- 拆分出去的模块装配（按依赖排序） --- */
const CSV = install_CSV({ $, MB, fmtDay, loadProfile, refresh, state });
const DATA = install_DATA({ $, MAX_IMPORT_BYTES, MB, deleteProfile, fmtDay, importProfile, loadProfile, msg, refresh, state, storageEstimate, store });
const TBOX = install_TBOX({ $, KEXT, OV_LABELS, TOOLS, TOOL_ACTIONS, hideOvBar, isMagnetOn, kvSet, markDirty, openDrawMgr, placeAt, state, toggleMagnet, updateStatus, FIB_DEFAULT_LEVELS, FIB_PRESETS, LINE_STYLE_OPTIONS, SIZE_OPTIONS, defaultDrawStyles, normalizeDrawStyles, saveDrawStyles, themeLineColor });
const COPYDRAW = install_COPYDRAW({ $, PERIODS, TBOX, applyThemePaneLayout, closeCtx, closeSubs, commitLayout, copyChartImage, kvGet, normalize, openCtx, openSub, resetChartView, saveLayout, state, syncLayoutUI, updateStatus, renderTools: TBOX.renderTools });
const THEME = install_THEME({ $, THEMES, applyChartThemeAll, applyThemeMode, applyThemePaneLayout, markDirty, migrateLayoutColors, placeAt, saveLayout, saveTheme, state, syncLayoutUI, themeMeta, updateStatus });
const SESS = install_SESS({ $, MB, fmtDay, fmtPrice, fmtTs, state, store, computeStats, download, sessionToJson, tradesToCsv });
const TRADE = install_TRADE({ $, SESS, fmtPrice, fmtTs, logErr, state, store, updateStatus, CSV, captureChart, renderSession: SESS.renderSession, renderShotList: SESS.renderShotList });
const ARCH = install_ARCH({ $, SESS, TRADE, exportSessionReport, fmtDay, fmtLocalInput, fmtPrice, fmtTs, renderPeriods, state, store, updateStatus, download, sessionToJson, renderSession: SESS.renderSession, renderStats: SESS.renderStats, renderTrade: TRADE.renderTrade });
const RPL = install_RPL({ $, TBOX, fmtLocalInput, fmtTs, markDirty, refreshPine, renderLegend, state, store, updateStatus, renderTools: TBOX.renderTools });
boot().catch(showBootError);

// 启动阶段的异步异常（例如 IndexedDB 被另一个窗口占用）也要看得见，而不是白屏转圈
window.addEventListener('beforeunload', () => { try { state.live?.stop(); } catch {} });
window.addEventListener('unhandledrejection', (e) => { if (!window.__UI_READY__) showBootError(e.reason); });
window.addEventListener('error', (e) => { if (!window.__UI_READY__) showBootError(e.message); });

const params = new URLSearchParams(location.search);
const ST = Number(params.get('selftest') || 0);
if (ST > 0) {
  (async () => {
    // ?fresh=1：跑之前先清掉会互相污染的运行态（成交/提醒/绘图/SMC/回放开关）
    if (params.get('fresh') === '1') {
      try { await window.__APP_READY__; } catch (e) { logErr('selftest:ready', e); }
      try { await resetForTest(); } catch (e) { logErr('selftest:reset', e); }
    }
    // 1 号用例的文件名是 selftest.js（历史原因），其余是 selftestN.js
    const mod = await import(ST === 1 ? './selftest.js' : `./selftest${ST}.js`);
    await mod.run(state);
  })().catch((e) => { console.error('[selftest] 启动失败', e); });
}
