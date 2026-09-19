const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// First basic task: X2 = X1 + S cos(a), Y2 = Y1 + S sin(a). Frame: X north, Y east, a clockwise from +X, gon.
const engine = defineEngine({
  toolName: 'first-basic-task',
  version: 1,
  displayName: { bg: 'Първа основна задача', en: 'First Basic Task' },
  fields: ['y1', 'x1', 'alpha', 's'],
  validate({ alpha, s }) {
    if (alpha < 0 || alpha >= 400) {
      throw new EngineError('OUT_OF_RANGE', 'Посочният ъгъл трябва да бъде между 0 и 400 гради', 'alpha');
    }
    if (s <= 0) {
      throw new EngineError('OUT_OF_RANGE', 'Дължината трябва да бъде положителна', 's');
    }
  },
  compute({ y1, x1, alpha, s }) {
    const alphaRad = (alpha * Math.PI) / 200;
    const sinAlpha = Math.sin(alphaRad);
    const cosAlpha = Math.cos(alphaRad);
    const deltaX = s * cosAlpha;
    const deltaY = s * sinAlpha;
    return { deltaX, deltaY, x2: x1 + deltaX, y2: y1 + deltaY };
  },
  persisted: [['y2', 3], ['x2', 3], ['deltaX', 3], ['deltaY', 3]],
});

module.exports = { engines: [engine] };
