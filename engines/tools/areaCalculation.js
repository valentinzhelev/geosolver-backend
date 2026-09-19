const { defineEngine, assertPlainObject } = require('../define');
const { EngineError } = require('../errors');
const { toFiniteNumber } = require('../numbers');

const METHODS = ['shoelace', 'trapezoidal'];

// Area of a polygon. The frontend already turned the textarea into a structured
// points: [{x, y}] array (and dropped malformed lines); the backend accepts THAT array and never
// re-parses text or re-filters lines. Persisted result is only `area`, unrounded.
const engine = defineEngine({
  toolName: 'area-calculation',
  version: 1,
  displayName: { bg: 'Изчисляване на площ', en: 'Area calculation' },
  inputKeys: ['points', 'method'],
  normalize(raw) {
    assertPlainObject(raw);
    if (!Array.isArray(raw.points)) {
      throw new EngineError('INVALID_POINT_LIST', 'Точките трябва да са масив', 'points');
    }
    const points = raw.points.map((p, i) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        throw new EngineError('INVALID_POINT_LIST', `Точка ${i + 1} трябва да има координати x и y`, `points[${i}]`);
      }
      return { x: toFiniteNumber(p.x, `points[${i}].x`), y: toFiniteNumber(p.y, `points[${i}].y`) };
    });
    const method = raw.method === undefined ? 'shoelace' : raw.method;
    if (!METHODS.includes(method)) {
      throw new EngineError('INVALID_METHOD', 'Неизвестен метод за изчисление', 'method');
    }
    return { points, method };
  },
  validate({ points }) {
    if (points.length < 3) {
      throw new EngineError('TOO_FEW_POINTS', 'Необходими са поне 3 точки за изчисляване на площ', 'points');
    }
  },
  compute({ points, method }) {
    let area = 0;
    if (method === 'shoelace') {
      let sum1 = 0;
      let sum2 = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        sum1 += points[i].x * points[j].y;
        sum2 += points[j].x * points[i].y;
      }
      area = Math.abs(sum1 - sum2) / 2;
    } else {
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += ((points[j].x - points[i].x) * (points[j].y + points[i].y)) / 2;
      }
      area = Math.abs(area);
    }
    return { area };
  },
  persisted: [['area', null]],
});

module.exports = { engines: [engine] };
