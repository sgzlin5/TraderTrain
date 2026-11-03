// src/overlays/utils.ts
import { utils } from '../klinecharts-shim.js';
function getRayLine(coordinates, bounding) {
  if (coordinates.length > 1) {
    let coordinate;
    if (coordinates[0].x === coordinates[1].x && coordinates[0].y !== coordinates[1].y) {
      if (coordinates[0].y < coordinates[1].y) {
        coordinate = {
          x: coordinates[0].x,
          y: bounding.height
        };
      } else {
        coordinate = {
          x: coordinates[0].x,
          y: 0
        };
      }
    } else if (coordinates[0].x > coordinates[1].x) {
      coordinate = {
        x: 0,
        y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: 0, y: coordinates[0].y })
      };
    } else {
      coordinate = {
        x: bounding.width,
        y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: bounding.width, y: coordinates[0].y })
      };
    }
    return { coordinates: [coordinates[0], coordinate] };
  }
  return [];
}

// src/overlays/fibonacciSpeedResistanceFan.ts
var fibonacciSpeedResistanceFan = {
  name: "fibonacciSpeedResistanceFan",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) => {
    const lines1 = [];
    let lines2 = [];
    const texts = [];
    if (coordinates.length > 1) {
      const xOffset = coordinates[1].x > coordinates[0].x ? -38 : 4;
      const yOffset = coordinates[1].y > coordinates[0].y ? -2 : 20;
      const xDistance = coordinates[1].x - coordinates[0].x;
      const yDistance = coordinates[1].y - coordinates[0].y;
      const percents = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0];
      percents.forEach((percent) => {
        const x = coordinates[1].x - xDistance * percent;
        const y = coordinates[1].y - yDistance * percent;
        lines1.push({
          coordinates: [
            { x, y: coordinates[0].y },
            { x, y: coordinates[1].y }
          ]
        });
        lines1.push({
          coordinates: [
            { x: coordinates[0].x, y },
            { x: coordinates[1].x, y }
          ]
        });
        lines2 = lines2.concat(getRayLine([coordinates[0], { x, y: coordinates[1].y }], bounding));
        lines2 = lines2.concat(getRayLine([coordinates[0], { x: coordinates[1].x, y }], bounding));
        texts.unshift({
          x: coordinates[0].x + xOffset,
          y: y + 10,
          text: `${percent.toFixed(3)}`
        });
        texts.unshift({
          x: x - 18,
          y: coordinates[0].y + yOffset,
          text: `${percent.toFixed(3)}`
        });
      });
    }
    return [
      {
        type: "line",
        attrs: lines1
      },
      {
        type: "line",
        attrs: lines2
      },
      {
        type: "text",
        ignoreEvent: true,
        attrs: texts
      }
    ];
  }
};
var fibonacciSpeedResistanceFan_default = fibonacciSpeedResistanceFan;
export {
  fibonacciSpeedResistanceFan_default as default
};
