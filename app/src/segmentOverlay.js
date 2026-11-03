// 趋势线（segment）：支持 按住 Ctrl 临时吸附、按住 Shift 约束水平
import { isSnapActive, isShiftDown, snapPoint } from './magnet.js';

let getChart = () => null;

/** 把点约束成“和上一点等高”（水平线段） */
function horizontalize(prev, p) {
  if (!prev || !p || !Number.isFinite(prev.value)) return p;
  return { ...p, value: prev.value };
}

/**
 * 注册自己的 segment 模板（覆盖内置同名模板）：
 * - performEventMoveForDrawing 里实时改 points，预览阶段就能看到吸附/水平效果
 * - createPointFigures 只画一条线 + 沿用默认的控制点/坐标轴
 */
export function registerSegmentOverlay(K, chartGetter) {
  if (!K || typeof K.registerOverlay !== 'function') return false;
  getChart = chartGetter || (() => null);

  K.registerOverlay({
    name: 'segment',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,

    createPointFigures({ coordinates, overlay }) {
      if (coordinates.length < 2) return [];
      const l = overlay.styles?.line || {};
      return [{
        type: 'line',
        attrs: { coordinates: [coordinates[0], coordinates[1]] },
        styles: {
          color: l.color, size: l.size ?? 1.2, style: l.style || 'solid',
          dashedValue: l.dashedValue || [0, 0]
        }
      }];
    },

    performEventMoveForDrawing({ points, performPointIndex, performPoint }) {
      const i = performPointIndex;
      const prev = (points && points[i - 1]) || (points && points[points.length - 1]);
      const target = performPoint || (points && points[i]);
      if (!prev || !target) return;

      let p = { timestamp: target.timestamp, value: target.value };
      if (isShiftDown()) p = horizontalize(prev, p);
      if (isSnapActive()) {
        const chart = getChart();
        if (chart) p = snapPoint(chart, p);
      }
      // 预览用的是 performPoint（还没写回 points），两处都要改，否则要等下一次点击才生效
      if (performPoint) { performPoint.timestamp = p.timestamp; performPoint.value = p.value; }
      if (points && points[i]) { points[i].timestamp = p.timestamp; points[i].value = p.value; }
    }
  });
  return true;
}
