// src/overlays/fiveWaves.ts
var fiveWaves = {
  name: "fiveWaves",
  totalStep: 7,
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
var fiveWaves_default = fiveWaves;
export {
  fiveWaves_default as default
};
