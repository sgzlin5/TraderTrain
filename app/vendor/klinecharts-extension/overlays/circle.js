// src/overlays/utils.ts
import { utils } from '../klinecharts-shim.js';
function getDistance(coordinate1, coordinate2) {
  const xDis = Math.abs(coordinate1.x - coordinate2.x);
  const yDis = Math.abs(coordinate1.y - coordinate2.y);
  return Math.sqrt(xDis * xDis + yDis * yDis);
}

// src/overlays/circle.ts
var circle = {
  name: "circle",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: {
    circle: {
      color: "rgba(22, 119, 255, 0.15)"
    }
  },
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length > 1) {
      const radius = getDistance(coordinates[0], coordinates[1]);
      return {
        type: "circle",
        attrs: {
          ...coordinates[0],
          r: radius
        },
        styles: { style: "stroke_fill" }
      };
    }
    return [];
  }
};
var circle_default = circle;
export {
  circle_default as default
};
