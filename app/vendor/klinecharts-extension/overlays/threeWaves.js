// src/overlays/threeWaves.ts
var threeWaves = {
  name: "threeWaves",
  totalStep: 5,
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
var threeWaves_default = threeWaves;
export {
  threeWaves_default as default
};
