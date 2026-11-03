// src/overlays/anyWaves.ts
var anyWaves = {
  name: "anyWaves",
  totalStep: Number.MAX_SAFE_INTEGER,
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
var anyWaves_default = anyWaves;
export {
  anyWaves_default as default
};
