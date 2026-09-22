const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');
const { gonToRad } = require('../angleUnits');

/**
 * Raw coordinate propagation for one traverse leg (V2.4.2 section 8): a known station + an already-resolved
 * forward bearing (see traverseDirection.js / the V2.4.1 orientation-constant engine for the first station) +
 * a horizontal distance -> the next station's raw X/Y. Same trigonometric convention as polar-horizontal
 * (X = Northing, Y = Easting, deltaX = L*cos(bearing), deltaY = L*sin(bearing)), but its own engine: unlike
 * polar-horizontal the bearing here is already final (not an orientationConstant + Hz decomposition), so this is
 * not a clone of that formula's field contract.
 */
const engine = defineEngine({
  toolName: 'traverse-propagation',
  version: 1,
  displayName: { bg: 'Пренасяне на координати (полигонов ход)', en: 'Coordinate propagation (traverse)' },
  fields: ['xStation', 'yStation', 'bearingGon', 'horizontalDistance'],
  validate({ horizontalDistance }) {
    if (horizontalDistance <= 0) {
      throw new EngineError('OUT_OF_RANGE', 'Хоризонталното разстояние трябва да е положително число.', 'horizontalDistance');
    }
  },
  compute({ xStation, yStation, bearingGon, horizontalDistance }) {
    const rad = gonToRad(bearingGon);
    const deltaX = horizontalDistance * Math.cos(rad);
    const deltaY = horizontalDistance * Math.sin(rad);
    return { deltaX, deltaY, x: xStation + deltaX, y: yStation + deltaY };
  },
  persisted: [['deltaX', null], ['deltaY', null], ['x', 3], ['y', 3]],
});

module.exports = { engines: [engine] };
