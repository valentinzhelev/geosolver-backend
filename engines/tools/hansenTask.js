const { defineEngine } = require('../define');
const { validateForward, computeForward } = require('./forwardIntersection');

// The shipped "Hansen task" IS a forward intersection with alpha/beta at A and B (see the
// frontend module doc). Compute order is (xA, yA, xB, yB, alpha, beta); persisted values are
// UNROUNDED. Angle rules are forward intersection's.
const engine = defineEngine({
  toolName: 'hansen-task',
  version: 1,
  displayName: { bg: 'Задача на Хансен', en: 'Hansen Task' },
  fields: ['yA', 'xA', 'yB', 'xB', 'alpha', 'beta'],
  validate({ yA, xA, yB, xB, alpha, beta }) {
    validateForward({ xA, yA, xB, yB, beta1: alpha, beta2: beta });
  },
  compute({ yA, xA, yB, xB, alpha, beta }) {
    const fwd = computeForward({ yA, xA, yB, xB, beta1: alpha, beta2: beta });
    return { xP: fwd.xP, yP: fwd.yP };
  },
  persisted: [['xP', null], ['yP', null]],
});

module.exports = { engines: [engine] };
