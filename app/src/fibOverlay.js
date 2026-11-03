// 自定义斐波那契回撤：层级数值可配置（内置模板把 percents 写死为 [1,.786,.618,.5,.382,.236,0]）
// 通过 registerOverlay 覆盖同名 'fibonacciLine'，绘制/交互逻辑沿用模板，只把层级换成 overlay.extendData.levels
const DEFAULT_LEVELS = [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0];

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

export function registerFibOverlay(K) {
  if (!K || typeof K.registerOverlay !== 'function') return false;
  K.registerOverlay({
    name: 'fibonacciLine',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures({ chart, coordinates, bounding, overlay }) {
      const points = overlay.points || [];
      if (!coordinates.length) return [];
      const levels = (overlay.extendData && Array.isArray(overlay.extendData.levels) && overlay.extendData.levels.length)
        ? overlay.extendData.levels
        : DEFAULT_LEVELS;
      const precision = chart.getSymbol()?.pricePrecision ?? 2;

      const lines = [];
      const texts = [];
      const startX = 0;
      const endX = bounding.width;
      if (coordinates.length > 1 && isNum(points[0]?.value) && isNum(points[1]?.value)) {
        const yDif = coordinates[0].y - coordinates[1].y;
        const valueDif = points[0].value - points[1].value;
        for (const percent of levels) {
          const y = coordinates[1].y + yDif * percent;
          const v = points[1].value + valueDif * percent;
          const value = v.toFixed(precision).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          lines.push({ coordinates: [{ x: startX, y }, { x: endX, y }] });
          texts.push({
            x: startX + 4,
            y,
            text: `${value}  ${(percent * 100).toFixed(1)}%`,
            baseline: 'bottom'
          });
        }
      }
      return [
        { type: 'line', attrs: lines },
        { type: 'text', isCheckEvent: false, attrs: texts }
      ];
    }
  });
  return true;
}
