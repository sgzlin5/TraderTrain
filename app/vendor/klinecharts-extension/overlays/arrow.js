// src/overlays/arrow.ts
import { utils as utils2 } from '../klinecharts-shim.js';

// src/overlays/utils.ts
import { utils } from '../klinecharts-shim.js';
function getRotateCoordinate(coordinate, targetCoordinate, angle) {
  const x = (coordinate.x - targetCoordinate.x) * Math.cos(angle) - (coordinate.y - targetCoordinate.y) * Math.sin(angle) + targetCoordinate.x;
  const y = (coordinate.x - targetCoordinate.x) * Math.sin(angle) + (coordinate.y - targetCoordinate.y) * Math.cos(angle) + targetCoordinate.y;
  return { x, y };
}

// src/overlays/arrow.ts
var arrow = {
  name: "arrow",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length > 1) {
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
      const rotateCoordinate1 = getRotateCoordinate({ x: coordinates[1].x - 8, y: coordinates[1].y + 4 }, coordinates[1], offsetAngle);
      const rotateCoordinate2 = getRotateCoordinate({ x: coordinates[1].x - 8, y: coordinates[1].y - 4 }, coordinates[1], offsetAngle);
      return [
        {
          type: "line",
          attrs: { coordinates }
        },
        {
          type: "line",
          ignoreEvent: true,
          attrs: { coordinates: [rotateCoordinate1, coordinates[1], rotateCoordinate2] }
        }
      ];
    }
    return [];
  }
};
var arrow_default = arrow;
export {
  arrow_default as default
};
