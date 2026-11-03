// src/overlays/fibonacciExtension.ts
var fibonacciExtension = {
  name: "fibonacciExtension",
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, yAxis, chart }) => {
    const fbLines = [];
    const texts = [];
    if (coordinates.length > 2) {
      let precision = 0;
      if (yAxis?.isInCandle() ?? true) {
        precision = chart.getSymbol()?.pricePrecision ?? 2;
      } else {
        for (const indicator of chart.getIndicators({ paneId: overlay.paneId })) {
          precision = Math.max(precision, indicator.precision);
        }
      }
      const points = overlay.points;
      const valueDif = points[1].value - points[0].value;
      const yDif = coordinates[1].y - coordinates[0].y;
      const percents = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const textX = coordinates[2].x > coordinates[1].x ? coordinates[1].x : coordinates[2].x;
      percents.forEach((percent) => {
        const y = coordinates[2].y + yDif * percent;
        const price = (points[2].value + valueDif * percent).toFixed(precision);
        fbLines.push({
          coordinates: [
            { x: coordinates[1].x, y },
            { x: coordinates[2].x, y }
          ]
        });
        texts.push({
          x: textX,
          y,
          text: `${price} (${(percent * 100).toFixed(1)}%)`,
          baseline: "bottom"
        });
      });
    }
    return [
      {
        type: "line",
        attrs: { coordinates },
        styles: { style: "dashed" }
      },
      {
        type: "line",
        attrs: fbLines
      },
      {
        type: "text",
        ignoreEvent: true,
        attrs: texts
      }
    ];
  }
};
var fibonacciExtension_default = fibonacciExtension;
export {
  fibonacciExtension_default as default
};
