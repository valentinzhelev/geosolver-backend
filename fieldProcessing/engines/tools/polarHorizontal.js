const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');
const { normalizeGon } = require('../angleUnits');

/**
 * Horizontal polar computation for one observation (V2.4.1 section 4).
 *
 * orientationConstantGon + observed hzGon -> absolute direction; direction + horizontal distance -> deltaX/deltaY
 * -> target X/Y. Same convention as capture/notebook and the interactive calculator's polar-intersection engine
 * (engines/tools/polarIntersection.js): X = Northing, Y = Easting, 0 gon = North, 100 gon = East, so
 * deltaX = distance*cos(angle), deltaY = distance*sin(angle) with angle in gon converted to radians as
 * angle * PI / 200. This is a fresh implementation (not a call into the interactive-calculator engine, which is
 * intentionally left unmodified - CLAUDE.md), verified against the identical known geometry.
 */
const engine = defineEngine({
  toolName: 'polar-horizontal',
  version: 1,
  displayName: { bg: 'Полярно определяне (хоризонтално)', en: 'Polar computation (horizontal)' },
  fields: ['xStation', 'yStation', 'orientationConstantGon', 'hzGon', 'horizontalDistance'],
  validate({ horizontalDistance }) {
    if (horizontalDistance <= 0) {
      throw new EngineError('OUT_OF_RANGE', 'Хоризонталното разстояние трябва да е положително число.', 'horizontalDistance');
    }
  },
  compute({ xStation, yStation, orientationConstantGon, hzGon, horizontalDistance }) {
    const directionGon = normalizeGon(orientationConstantGon + hzGon);
    const rad = (directionGon * Math.PI) / 200;
    const deltaX = horizontalDistance * Math.cos(rad);
    const deltaY = horizontalDistance * Math.sin(rad);
    return { directionGon, deltaX, deltaY, x: xStation + deltaX, y: yStation + deltaY };
  },
  persisted: [['directionGon', null], ['deltaX', null], ['deltaY', null], ['x', 3], ['y', 3]],
});

module.exports = { engines: [engine] };
