const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Distance and bearing between two points. Compute order (x1, y1, x2, y2); persisted distance 3 dp,
// bearingGon 2 dp (the shipped mixed contract — deliberately not unified).
const engine = defineEngine({
  toolName: 'distance-bearing',
  version: 1,
  displayName: { bg: 'Разстояние и посока', en: 'Distance and Bearing' },
  fields: ['y1', 'x1', 'y2', 'x2'],
  validate({ x1, y1, x2, y2 }) {
    if (x1 === x2 && y1 === y2) {
      throw new EngineError('COINCIDENT_POINTS', 'Точките не могат да съвпадат');
    }
  },
  compute({ x1, y1, x2, y2 }) {
    const deltaY = y2 - y1;
    const deltaX = x2 - x1;
    const distance = Math.sqrt(deltaY * deltaY + deltaX * deltaX);
    let bearingRad = Math.atan2(deltaY, deltaX);
    if (bearingRad < 0) bearingRad += 2 * Math.PI;
    return { distance, bearingGon: (bearingRad * 200) / Math.PI };
  },
  persisted: [['distance', 3], ['bearingGon', 2]],
});

module.exports = { engines: [engine] };
