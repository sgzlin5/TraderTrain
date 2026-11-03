// src/overlays/eightWaves.ts
var eightWaves = {
  name: "eightWaves",
  totalStep: 10,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    const texts = coordinates.map((coordinate, i) => ({
      ...coordinate,
      text: `(${i})`,
      baseline: "bottom"
    }));
    return [
      {
        type: "line",
        attrs: { coordinates }
      },
      {
        type: "text",
        ignoreEvent: true,
        attrs: texts
      }
    ];
  }
};
var eightWaves_default = eightWaves;
export {
  eightWaves_default as default
};
