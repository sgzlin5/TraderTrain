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
export {
  getRotateCoordinate,
  getRayLine,
  getDistance
};
