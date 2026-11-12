// 自检公共工具（vela 分支）：把旧 klinecharts 口径的查询换成 Vela 原生口径。
// 旧用例里的 window.klinecharts.* / chart.getIndicators().result 在 vela 下没有对应物，
// 统一从这里取：注册表（vela-ind 的 NATIVE_TYPES）、挂图指标、指标 calc 纯函数、绘图列表。

import { CUSTOM_INDS } from './customIndicators.js';
import { SMC_INDS } from './smc.js';
import { FLOW_INDS } from './flow.js';

/** 已注册的 native 指标旧名（TT_ 前缀已去）；对应旧 window.klinecharts.getSupportedIndicators() */
export function supportedIndicators() {
  try { return window.__TT_SUPPORTED__ ? window.__TT_SUPPORTED__() : []; } catch { return []; }
}

/** 指标是否已挂到图上（旧口径 chart.getIndicators().find(i => i.name === name)） */
export function indOnChart(chart, name) {
  const type = String(name).startsWith('TT_') ? String(name) : 'TT_' + name;
  const list = (chart?.getIndicators?.() || []);
  return list.find((h) => h.nativeType === type || h.id === type || h.name === name) || null;
}

/** 指标的纯计算（不依赖图表）：同一份 calc 就是内核指标用的那份，用它验数值口径 */
export function calcOf(name, bars, calcParams) {
  const tpl = [...CUSTOM_INDS, ...SMC_INDS, ...FLOW_INDS].find((t) => t.name === name);
  if (!tpl || typeof tpl.calc !== 'function') return null;
  try { return tpl.calc(bars, calcParams ? { calcParams } : undefined) || []; } catch { return null; }
}

/** 当前图上绘图（Vela drawings） */
export function drawingsOf(chart) {
  try { return chart?.drawings?.all?.() || []; } catch { return []; }
}

/** 清空绘图（旧 chart.removeOverlay() 的替代） */
export function clearDrawings(chart) {
  try { chart?.removeOverlay?.(); return true; } catch { return false; }
}

/** 自绘渲染层的着墨像素数（vela 里 SMC/Flow/BT 走 renderer layer，不进 overlayList）
 *  -1 = 层 canvas 还没挂；-2 = 取像素失败；>=0 = 有效 */
export function layerInk(type) {
  const cv = (window.__LAYER_CV || {})[type];
  if (!cv || !cv.width) return -1;
  try {
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  } catch { return -2; }
}

/** 真实鼠标点击（交互层校验 isTrusted，合成事件会被内核丢弃）：
 *  页面把点击请求压进 window.__TT_INPUT__，tools/run_selftests.py 用 CDP Input 域真发，
 *  回执写 window.__TT_INPUT_ACK__。fx/fy 是最大 canvas 的 0..1 相对坐标。 */
export async function realClick(fx, fy, waitMs = 380) {
  const host = document.getElementById('chart');
  const cvs = [...host.querySelectorAll('canvas')].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  const r = cvs.getBoundingClientRect();
  const x = Math.round(r.left + r.width * fx);
  const y = Math.round(r.top + r.height * fy);
  window.__TT_INPUT__ = window.__TT_INPUT__ || [];
  const id = (window.__TT_INPUT_SEQ__ = (window.__TT_INPUT_SEQ__ || 0) + 1);
  window.__TT_INPUT__.push({ id, type: 'click', x, y });
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if ((window.__TT_INPUT_ACK__ || 0) >= id) break;
    await new Promise((res) => setTimeout(res, 60));
  }
  await new Promise((res) => setTimeout(res, waitMs));
  return { x, y, ack: (window.__TT_INPUT_ACK__ || 0) >= id };
}
