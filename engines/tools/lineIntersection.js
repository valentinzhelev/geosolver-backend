const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Intersection of two infinite lines given by two points each. Compute order
// (x1, y1, x2, y2, x3, y3, x4, y4). Existing thresholds are ported EXACTLY (not "improved"):
//   - a line is degenerate when hypot(dx, dy) < 1e-12
//   - lines are parallel when |dx1*dy2 - dy1*dx2| < 1e-12 (ABSOLUTE cross product, units m^2)
// Both are input-only geometric checks, so they live in validate(). The shipped UI message named
// "line 1" for both lines; the structured error here names the correct line.
const DEGENERATE_EPS = 1e-12;
const PARALLEL_EPS = 1e-12;

const direction = (xa, ya, xb, yb) => ({ dx: xb - xa, dy: yb - ya });

const engine = defineEngine({
  toolName: 'line-intersection',
  version: 1,
  displayName: { bg: 'Пресичане на прави', en: 'Line intersection' },
  fields: ['y1', 'x1', 'y2', 'x2', 'y3', 'x3', 'y4', 'x4'],
  validate({ x1, y1, x2, y2, x3, y3, x4, y4 }) {
    const l1 = direction(x1, y1, x2, y2);
    const l2 = direction(x3, y3, x4, y4);
    if (Math.hypot(l1.dx, l1.dy) < DEGENERATE_EPS) {
      throw new EngineError('DEGENERATE_LINE', 'Точките на права 1 съвпадат', 'line1');
    }
    if (Math.hypot(l2.dx, l2.dy) < DEGENERATE_EPS) {
      throw new EngineError('DEGENERATE_LINE', 'Точките на права 2 съвпадат', 'line2');
    }
    if (Math.abs(l1.dx * l2.dy - l1.dy * l2.dx) < PARALLEL_EPS) {
      throw new EngineError('PARALLEL_LINES', 'Правите са паралелни — няма пресичане');
    }
  },
  compute({ x1, y1, x2, y2, x3, y3, x4, y4 }) {
    const l1 = direction(x1, y1, x2, y2);
    const l2 = direction(x3, y3, x4, y4);
    const denom = l1.dx * l2.dy - l1.dy * l2.dx;
    const t = ((x3 - x1) * l2.dy - (y3 - y1) * l2.dx) / denom;
    return { xI: x1 + t * l1.dx, yI: y1 + t * l1.dy };
  },
  persisted: [['yI', null], ['xI', null]],
});

module.exports = { engines: [engine] };
