// 版面设置：右键图表弹出，改背景/网格/涨跌配色，持久化到 IndexedDB kv
// 只覆盖「皮肤之上」的动态部分（颜色与网格开关），字体/十字光标等仍由 chart.js 的 THEME 决定
import { buildVelaTheme } from './chart.js';
import { kvGet, kvSet } from './db.js';

const KEY = 'layout:chart';
const THEME_KEY = 'ui:theme';

/** 主题表：key 写进 <html data-theme>，mode 决定字色/控件亮暗 */
export const THEMES = [
  {
    key: 'dark', label: '墨蓝', mode: 'dark',
    desc: '近黑深蓝 · 冰青涨珊瑚跌',
    swatch: { bg: '#03070d', up: '#5fe3c0', down: '#ff6f85', line: 'rgba(255,255,255,.10)' }
  },
  {
    key: 'light', label: '雾白', mode: 'light',
    desc: '浅灰白 · 墨绿涨砖红跌',
    swatch: { bg: '#ffffff', up: '#12a37c', down: '#e0505f', line: 'rgba(15,35,60,.14)' }
  },
  {
    key: 'sky', label: '晴空', mode: 'light',
    desc: '浅天蓝 · 青蓝涨珊瑚跌',
    swatch: { bg: '#eaf5fd', up: '#0f8bc4', down: '#e2665f', line: 'rgba(12,70,110,.16)' }
  },
  {
    key: 'amber', label: '暖砂', mode: 'light',
    desc: '浅橙 · 琥珀涨黛蓝跌',
    swatch: { bg: '#fdf4e8', up: '#e08a2b', down: '#2f6f9e', line: 'rgba(120,70,20,.16)' }
  },
  {
    key: 'cb', label: '色盲友好', mode: 'dark',
    desc: '墨蓝底 · 蓝涨橙跌（红绿色觉障碍可分）',
    swatch: { bg: '#03070d', up: '#4fa3ff', down: '#ffa14a', line: 'rgba(255,255,255,.10)' }
  }
];

export const THEME_KEYS = THEMES.map(t => t.key);

export function themeMeta(key) {
  return THEMES.find(t => t.key === key) || THEMES[0];
}

export async function loadTheme() {
  try {
    const v = await kvGet(THEME_KEY);
    return THEME_KEYS.includes(v) ? v : 'dark';
  } catch { return 'dark'; }
}

export async function saveTheme(key) {
  try { await kvSet(THEME_KEY, THEME_KEYS.includes(key) ? key : 'dark'); } catch {}
}

export function applyThemeMode(key) {
  const meta = themeMeta(key);
  document.documentElement.dataset.theme = meta.key;
  document.documentElement.dataset.mode = meta.mode;      // 亮暗底子（CSS/图表共用）
  return meta.key;
}

export const DEFAULT_LAYOUT = {
  bgMode: 'theme',        // theme = 跟随皮肤；custom = 自定义
  bg: '#0b1220',
  grid: true,
  gridColor: '#0b0e14',   // 默认值等价于皮肤里 3.2% 白的发丝线
  up: '#5fe3c0',
  down: '#ff6f85',
  borderAuto: true,       // 边框跟随 K 线颜色
  upBorder: '#5fe3c0',
  downBorder: '#ff6f85'
};

export const PRESET_LAYOUTS = [
  { key: 'theme', label: '默认皮肤', layout: {} },
  { key: 'classic', label: '经典红绿', layout: { up: '#26a69a', down: '#ef5350', upBorder: '#26a69a', downBorder: '#ef5350' } },
  { key: 'hollow', label: '空心涨', layout: { up: '#0b1220', down: '#ff6f85', borderAuto: false, upBorder: '#5fe3c0', downBorder: '#ff6f85' } }
];

/** 两套主题的默认涨跌色：切主题时若用户没改过，就跟着换 */
export const THEME_DEFAULT_COLORS = {
  dark: { up: '#5fe3c0', down: '#ff6f85' },
  light: { up: '#12a37c', down: '#e0505f' },
  sky: { up: '#0f8bc4', down: '#e2665f' },
  amber: { up: '#e08a2b', down: '#2f6f9e' },
  cb: { up: '#4fa3ff', down: '#ffa14a' }
};

/** 切主题时迁移颜色：只要当前色「等于任一主题的默认色」就认为用户没自定义过，跟着换 */
export function migrateLayoutColors(layout, fromKey, toKey) {
  const from = THEME_DEFAULT_COLORS[fromKey] || THEME_DEFAULT_COLORS.dark;
  const to = THEME_DEFAULT_COLORS[toKey] || THEME_DEFAULT_COLORS.dark;
  const allUps = Object.values(THEME_DEFAULT_COLORS).map(c => c.up);
  const allDowns = Object.values(THEME_DEFAULT_COLORS).map(c => c.down);
  const l = normalize(layout);
  const next = { ...l };
  if (l.up === from.up || allUps.includes(l.up)) next.up = to.up;
  if (l.down === from.down || allDowns.includes(l.down)) next.down = to.down;
  if (l.borderAuto) { next.upBorder = next.up; next.downBorder = next.down; }
  else {
    if (l.upBorder === from.up || allUps.includes(l.upBorder)) next.upBorder = to.up;
    if (l.downBorder === from.down || allDowns.includes(l.downBorder)) next.downBorder = to.down;
  }
  return next;
}

export function normalize(raw) {
  return { ...DEFAULT_LAYOUT, ...(raw || {}) };
}

export async function loadLayout() {
  try { return normalize(await kvGet(KEY)); } catch { return normalize(null); }
}

export async function saveLayout(layout) {
  try { await kvSet(KEY, normalize(layout)); } catch {}
}

/** 把版面设置写进 CSS 变量与图表样式（chart 可为空，只改背景） */
/** 存的颜色若等于「任一主题的默认值」，就视为跟随主题，取当前主题的默认色 */
function resolveThemeColor(value, key, mode) {
  const cur = THEME_DEFAULT_COLORS[mode] || THEME_DEFAULT_COLORS.dark;
  const isDefault = value === THEME_DEFAULT_COLORS.dark[key] || value === THEME_DEFAULT_COLORS.light[key];
  return (!value || isDefault) ? cur[key] : value;
}

export function applyLayout(chart, layout) {
  const l = normalize(layout);
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const up = resolveThemeColor(l.up, 'up', mode);
  const down = resolveThemeColor(l.down, 'down', mode);
  const upBorder = l.borderAuto ? up : resolveThemeColor(l.upBorder, 'up', mode);
  const downBorder = l.borderAuto ? down : resolveThemeColor(l.downBorder, 'down', mode);

  if (l.bgMode === 'custom') document.documentElement.style.setProperty('--chart-bg', l.bg);
  else document.documentElement.style.removeProperty('--chart-bg');
  if (!chart) return l;

  const gridLine = { color: l.gridColor || DEFAULT_LAYOUT.gridColor, size: 1, style: 'dashed', dashedValue: [2, 5] };
  try {
    chart.setStyles({
      grid: {
        show: l.grid,
        horizontal: { line: gridLine },
        vertical: { line: gridLine }
      },
      candle: {
        bar: {
          upColor: up, downColor: down,
          upBorderColor: upBorder, downBorderColor: downBorder,
          upWickColor: upBorder, downWickColor: downBorder
        },
        priceMark: {
          last: { upColor: up, downColor: down, line: { color: up } }
        }
      }
    });
  } catch (e) { console.warn('[layout]', e); }
  return l;
}
