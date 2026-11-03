// src/overlays/triangle.ts
var triangle = {
  name: "triangle",
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: {
    polygon: {
      color: "rgba(22, 119, 255, 0.15)"
    }
  },
  createPointFigures: ({ coordinates }) => [
    {
      type: "polygon",
      attrs: { coordinates },
      styles: { style: "stroke_fill" }
    }
  ]
};
var triangle_default = triangle;
export {
  triangle_default as default
};
