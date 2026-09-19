const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Second basic task. This is the math of the SHIPPED inline implementation (SecondTask.js /
// secondTaskShipped.js), not the unused domain module. The shipped code rounded the four
// persisted fields with Math.round(x * 1000) / 1000 — identical to format()'s 3-dp rounding.
const engine = defineEngine({
  toolName: 'second-basic-task',
  version: 1,
  displayName: { bg: 'Втора основна задача', en: 'Second Basic Task' },
  fields: ['x1', 'y1', 'x2', 'y2'],
  validate({ x1, y1, x2, y2 }) {
    if (x1 === x2 && y1 === y2) {
      throw new EngineError('COINCIDENT_POINTS', 'Точките не могат да съвпадат');
    }
  },
  compute({ x1, y1, x2, y2 }) {
    const deltaX = x2 - x1;
    const deltaY = y2 - y1;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const tangens = deltaX !== 0 ? deltaY / deltaX : (deltaY > 0 ? Infinity : -Infinity);
    const arctanTab = (Math.atan(Math.abs(tangens)) * 200) / Math.PI;

    let alpha;
    if (deltaX > 0 && deltaY >= 0) {
      alpha = arctanTab;
    } else if (deltaX <= 0 && deltaY > 0) {
      alpha = 200 - arctanTab;
    } else if (deltaX < 0 && deltaY <= 0) {
      alpha = 200 + arctanTab;
    } else {
      alpha = 400 - arctanTab; // deltaX >= 0 && deltaY < 0
    }
    return { alpha, distance, deltaX, deltaY };
  },
  persisted: [['alpha', 3], ['distance', 3], ['deltaX', 3], ['deltaY', 3]],
});

module.exports = { engines: [engine] };
