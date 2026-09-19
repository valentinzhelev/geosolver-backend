const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Polar intersection. Compute order is (xA, yA, angle, distance) — X first. The angle is
// deliberately NOT range-checked (the shipped contract accepts any finite gon value).
const engine = defineEngine({
  toolName: 'polar-intersection',
  version: 1,
  displayName: { bg: 'Полярна засечка', en: 'Polar intersection' },
  fields: ['yA', 'xA', 'angle', 'distance'],
  validate({ distance }) {
    if (distance <= 0) {
      throw new EngineError('OUT_OF_RANGE', 'Разстоянието трябва да е положително число', 'distance');
    }
  },
  compute({ xA, yA, angle, distance }) {
    const angleRad = (angle * Math.PI) / 200;
    const sinAlpha = Math.sin(angleRad);
    const cosAlpha = Math.cos(angleRad);
    const deltaX = distance * cosAlpha;
    const deltaY = distance * sinAlpha;
    return { xP: xA + deltaX, yP: yA + deltaY };
  },
  persisted: [['xP', 3], ['yP', 3]],
});

module.exports = { engines: [engine] };
