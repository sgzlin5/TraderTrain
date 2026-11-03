// 每个绘图工具的样式（颜色/线型/粗细）+ 斐波那契层级，存 IndexedDB
import { kvGet, kvSet } from './db.js';

const KEY = 'ui:drawStyles';
const TPL_KEY = 'ui:drawTemplates';

/** 与 draw.js 的 TOOLS 一一对应（这里不 import，避免循环依赖） */
export const STYLE_TOOLS = [
  'segment', 'rayLine', 'horizontalStraightLine', 'horizontalRayLine',
  'priceLine', 'fibonacciLine', 'priceChannelLine', 'brush',
  'longPosition', 'shortPosition', 'polyline'
];

export const LINE_STYLE_OPTIONS = [
  { key: 'solid', label: '实线' },
  { key: 'dashed', label: '虚线' },
  { key: 'dotted', label: '点线' }
];
export const SIZE_OPTIONS = [1, 2, 3, 4];
export const FIB_DEFAULT_LEVELS = [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0];
export const FIB_PRESETS = [
  { label: '标准', levels: [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0] },
  { label: '扩展', levels: [1.618, 1.272, 1, 0.786, 0.618, 0.5, 0.382, 0.236, 0] },
  { label: '密集', levels: [1, 0.886, 0.786, 0.705, 0.618, 0.5, 0.382, 0.236, 0.146, 0] }
];

function emptyStyle() { return { color: '', style: 'solid', size: 1 }; }

export function defaultDrawStyles() {
  const out = {};
  for (const k of STYLE_TOOLS) out[k] = emptyStyle();
  out.fibonacciLine = { color: '', style: 'dashed', size: 1, levels: FIB_DEFAULT_LEVELS.slice() };
  return out;
}

export function normalizeDrawStyles(raw) {
  const base = defaultDrawStyles();
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of STYLE_TOOLS) {
    const cur = src[k] || {};
    out[k] = {
      color: typeof cur.color === 'string' ? cur.color : base[k].color,
      style: LINE_STYLE_OPTIONS.some(o => o.key === cur.style) ? cur.style : base[k].style,
      size: SIZE_OPTIONS.includes(Number(cur.size)) ? Number(cur.size) : base[k].size
    };
    if (k === 'fibonacciLine') {
      const lv = Array.isArray(cur.levels) ? cur.levels : base.fibonacciLine.levels;
      const clean = lv.map(Number).filter(n => Number.isFinite(n)).slice(0, 16);
      out[k].levels = clean.length ? clean : FIB_DEFAULT_LEVELS.slice();
    }
  }
  return out;
}

export async function loadDrawStyles() {
  try { return normalizeDrawStyles(await kvGet(KEY)); } catch { return normalizeDrawStyles(null); }
}

export async function saveDrawStyles(styles) {
  try { await kvSet(KEY, normalizeDrawStyles(styles)); } catch {}
}

/** 主题下的默认线条色（未自定义时跟随皮肤强调色） */
export function themeLineColor() {
  return document.documentElement.dataset.mode === 'light' ? (getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#1f6feb') : '#8adeff';
}

/** 生成传给 createOverlay 的 styles；颜色留空 = 跟随皮肤 */
export function overlayStyles(styles, toolKey) {
  const s = (styles && styles[toolKey]) || emptyStyle();
  const line = {
    color: s.color || themeLineColor(),
    size: s.size || 1,
    style: s.style || 'solid'
  };
  if (s.style === 'dotted') line.dashedValue = [1, 3];
  else if (s.style === 'dashed') line.dashedValue = [5, 4];
  return { line };
}

/** 斐波那契层级（createOverlay 的 extendData） */
export function fibExtendData(styles) {
  const s = styles?.fibonacciLine;
  return { levels: (s && Array.isArray(s.levels) && s.levels.length ? s.levels : FIB_DEFAULT_LEVELS).slice() };
}

/* ---------------- 每个工具的样式模板 ---------------- */

export function emptyTemplateStore() {
  return { templates: {}, defaults: {} };
}

function normalizeLine(line) {
  const l = line && typeof line === 'object' ? line : {};
  return {
    color: typeof l.color === 'string' ? l.color : '',
    size: SIZE_OPTIONS.includes(Number(l.size)) ? Number(l.size) : 1,
    style: LINE_STYLE_OPTIONS.some(o => o.key === l.style) ? l.style : 'solid',
    dashedValue: Array.isArray(l.dashedValue) ? l.dashedValue.slice(0, 2) : undefined
  };
}

export function normalizeTemplateStore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { templates: {}, defaults: {} };
  for (const k of Object.keys(src.templates || {})) {
    const list = Array.isArray(src.templates[k]) ? src.templates[k] : [];
    const clean = list
      .filter(t => t && typeof t.name === 'string')
      .slice(0, 30)
      .map(t => ({
        id: String(t.id || `T${Math.random().toString(36).slice(2, 8)}`),
        name: t.name.slice(0, 24),
        line: normalizeLine(t.line),
        ...(Array.isArray(t.levels) ? { levels: t.levels.map(Number).filter(Number.isFinite).slice(0, 16) } : {}),
        createdAt: Number(t.createdAt) || Date.now()
      }));
    if (clean.length) out.templates[k] = clean;
  }
  for (const k of Object.keys(src.defaults || {})) {
    const id = src.defaults[k];
    if ((out.templates[k] || []).some(t => t.id === id)) out.defaults[k] = id;
  }
  return out;
}

export async function loadTemplateStore() {
  try { return normalizeTemplateStore(await kvGet(TPL_KEY)); } catch { return emptyTemplateStore(); }
}

export async function saveTemplateStore(store) {
  try { await kvSet(TPL_KEY, normalizeTemplateStore(store)); } catch {}
}

export function addTemplate(store, toolKey, tpl) {
  const s = normalizeTemplateStore(store);
  const list = s.templates[toolKey] || [];
  const item = {
    id: `T${Date.now().toString(36)}`,
    name: (tpl.name || toolKey).slice(0, 24),
    line: normalizeLine(tpl.line),
    ...(tpl.levels ? { levels: tpl.levels.map(Number).filter(Number.isFinite).slice(0, 16) } : {}),
    createdAt: Date.now()
  };
  s.templates[toolKey] = list.concat(item);
  return { store: s, item };
}

export function removeTemplate(store, toolKey, id) {
  const s = normalizeTemplateStore(store);
  s.templates[toolKey] = (s.templates[toolKey] || []).filter(t => t.id !== id);
  if (!s.templates[toolKey].length) delete s.templates[toolKey];
  if (s.defaults[toolKey] === id) delete s.defaults[toolKey];
  return s;
}

export function setDefaultTemplate(store, toolKey, id) {
  const s = normalizeTemplateStore(store);
  if ((s.templates[toolKey] || []).some(t => t.id === id)) s.defaults[toolKey] = id;
  return s;
}

export function templateOf(store, toolKey, id) {
  return (store?.templates?.[toolKey] || []).find(t => t.id === id) || null;
}

export function defaultTemplateOf(store, toolKey) {
  const id = store?.defaults?.[toolKey];
  return id ? templateOf(store, toolKey, id) : null;
}

/**
 * 把「绘制样式」和「默认模板」合成 draw.js 需要的样式表：
 * 有默认模板的工具用模板的线型/颜色/层级，其余用全局样式
 */
export function resolveToolStyles(globalStyles, store) {
  const base = normalizeDrawStyles(globalStyles);
  const out = {};
  for (const k of STYLE_TOOLS) {
    const tpl = defaultTemplateOf(store, k);
    if (tpl && tpl.line) {
      out[k] = { ...base[k], ...tpl.line };
      if (k === 'fibonacciLine') {
        out[k].levels = (tpl.levels && tpl.levels.length) ? tpl.levels.slice() : base[k].levels;
      }
    } else {
      out[k] = { ...base[k] };
    }
  }
  return out;
}
