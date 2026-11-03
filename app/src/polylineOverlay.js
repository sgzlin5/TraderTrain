// 折线：多次点击连续落点，双击/右键/回车结束，Esc 取消
export function registerPolylineOverlay(K) {
  if (!K || typeof K.registerOverlay !== 'function') return false;
  K.registerOverlay({
    name: 'polyline',
    totalStep: 2,
    needDefaultPointFigure: true,      // 顶点可拖
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures({ coordinates, overlay }) {
      if (coordinates.length < 2) return [];
      const l = overlay.styles?.line || {};
      const color = l.color || '#8adeff';
      const size = Number(l.size) || 1.2;
      const style = l.style || 'solid';
      const figures = [];
      for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i];
        if (!a || !b) continue;
        figures.push({
          type: 'line',
          attrs: { coordinates: [a, b] },
          styles: { color, size, style, dashedValue: style === 'dashed' ? [5, 4] : [0, 0] }
        });
      }
      return figures;
    }
  });
  return true;
}
