// 吸附开关：落点吸附到最近 bar 的 开/高/低/收
import { kvGet, kvSet } from './db.js';

const KEY = 'ui:magnet';
let on = false;        // 工具栏磁铁开关（持久）
let temp = false;      // 临时吸附（按住 Ctrl）

export const mods = { shift: false };

export function isMagnetOn() { return on; }

/** 实际是否吸附：开关打开 或 按住 Ctrl */
export function isSnapActive() { return on || temp; }

/** 临时吸附（Ctrl 按下/松开） */
export function setTempMagnet(v) { temp = !!v; return temp; }

/** Shift 是否按住（画线段时约束水平） */
export function isShiftDown() { return mods.shift; }

/** 绑定修饰键：Ctrl=临时吸附，Shift=水平约束 */
export function bindModifierKeys() {
  const setCtrl = (v) => { temp = v; };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Control') setCtrl(true);
    if (e.key === 'Shift') mods.shift = true;
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') setCtrl(false);
    if (e.key === 'Shift') mods.shift = false;
  }, true);
  // 切窗口/失焦时清掉，避免“粘住”
  window.addEventListener('blur', () => { temp = false; mods.shift = false; });
}

export async function loadMagnet() {
  const v = await kvGet(KEY);
  on = !!v;
  return on;
}

export function setMagnetOn(v) {
  on = !!v;
  kvSet(KEY, on);
  return on;
}

export function toggleMagnet() { return setMagnetOn(!on); }

/** 把 {timestamp,value} 吸到最近的 bar 上最近的那个 OHLC */
export function snapPoint(chart, point) {
  if (!(on || temp) || !chart || !point) return { timestamp: point?.timestamp, value: point?.value };
  const list = chart.getDataList();
  if (!list.length || !Number.isFinite(point.timestamp)) return { ...point };

  let lo = 0, hi = list.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].timestamp <= point.timestamp) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans + 1 < list.length && Math.abs(list[ans + 1].timestamp - point.timestamp) < Math.abs(list[ans].timestamp - point.timestamp)) ans++;

  const bar = list[ans];
  const cands = [bar.open, bar.high, bar.low, bar.close].filter(v => Number.isFinite(v));
  if (!cands.length) return { timestamp: bar.timestamp, value: point.value };

  const yOf = (value) => {
    try {
      const px = chart.convertToPixel([{ value }], { paneId: 'candle_pane' });
      const p = Array.isArray(px) ? px[0] : px;
      return Number.isFinite(p?.y) ? p.y : null;
    } catch { return null; }
  };
  const y0 = yOf(point.value);
  let best = cands[0], bestD = Infinity;
  for (const c of cands) {
    const y = yOf(c);
    const d = (y != null && y0 != null) ? Math.abs(y - y0) : Math.abs(c - point.value);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { timestamp: bar.timestamp, value: best };
}
