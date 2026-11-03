// src/overlays/fibonacciSpiral.ts
import { utils as utils2 } from '../klinecharts-shim.js';

// src/overlays/utils.ts
import { utils } from '../klinecharts-shim.js';
function getRotateCoordinate(coordinate, targetCoordinate, angle) {
  const x = (coordinate.x - targetCoordinate.x) * Math.cos(angle) - (coordinate.y - targetCoordinate.y) * Math.sin(angle) + targetCoordinate.x;
  const y = (coordinate.x - targetCoordinate.x) * Math.sin(angle) + (coordinate.y - targetCoordinate.y) * Math.cos(angle) + targetCoordinate.y;
  return { x, y };
}
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
function getDistance(coordinate1, coordinate2) {
  const xDis = Math.abs(coordinate1.x - coordinate2.x);
  const yDis = Math.abs(coordinate1.y - coordinate2.y);
  return Math.sqrt(xDis * xDis + yDis * yDis);
}

// src/overlays/fibonacciSpiral.ts
var fibonacciSpiral = {
  name: "fibonacciSpiral",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) => {
    if (coordinates.length > 1) {
      const startRadius = getDistance(coordinates[0], coordinates[1]) / Math.sqrt(24);
      const flag = coordinates[1].x > coordinates[0].x ? 0 : 1;
      const kb = utils2.getLinearSlopeIntercept(coordinates[0], coordinates[1]);
      let offsetAngle;
      if (kb) {
        offsetAngle = Math.atan(kb[0]) + Math.PI * flag;
      } else {
        if (coordinates[1].y > coordinates[0].y) {
          offsetAngle = Math.PI / 2;
        } else {
          offsetAngle = Math.PI / 2 * 3;
        }
      }
      const rotateCoordinate1 = getRotateCoordinate({ x: coordinates[0].x - startRadius, y: coordinates[0].y }, coordinates[0], offsetAngle);
      const rotateCoordinate2 = getRotateCoordinate({ x: coordinates[0].x - startRadius, y: coordinates[0].y - startRadius }, coordinates[0], offsetAngle);
      const arcs = [
        {
          ...rotateCoordinate1,
          r: startRadius,
          startAngle: offsetAngle,
          endAngle: offsetAngle + Math.PI / 2
        },
        {
          ...rotateCoordinate2,
          r: startRadius * 2,
          startAngle: offsetAngle + Math.PI / 2,
          endAngle: offsetAngle + Math.PI
        }
      ];
      let x = coordinates[0].x - startRadius;
      let y = coordinates[0].y - startRadius;
      for (let i = 2;i < 9; i++) {
        const r = arcs[i - 2].r + arcs[i - 1].r;
        let startAngle = 0;
        switch (i % 4) {
          case 0: {
            startAngle = offsetAngle;
            x -= arcs[i - 2].r;
            break;
          }
          case 1: {
            startAngle = offsetAngle + Math.PI / 2;
            y -= arcs[i - 2].r;
            break;
          }
          case 2: {
            startAngle = offsetAngle + Math.PI;
            x += arcs[i - 2].r;
            break;
          }
          case 3: {
            startAngle = offsetAngle + Math.PI / 2 * 3;
            y += arcs[i - 2].r;
            break;
          }
        }
        const endAngle = startAngle + Math.PI / 2;
        const rotateCoordinate = getRotateCoordinate({ x, y }, coordinates[0], offsetAngle);
        arcs.push({
          ...rotateCoordinate,
          r,
          startAngle,
          endAngle
        });
      }
      return [
        {
          type: "arc",
          attrs: arcs
        },
        {
          type: "line",
          attrs: getRayLine(coordinates, bounding)
        }
      ];
    }
    return [];
  }
};
var fibonacciSpiral_default = fibonacciSpiral;
export {
  fibonacciSpiral_default as default
};
