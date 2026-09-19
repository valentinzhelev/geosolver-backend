const { defineEngine, assertPlainObject } = require('../define');
const { EngineError } = require('../errors');
const { toFiniteNumber } = require('../numbers');

const TYPES = ['translation', 'rotation', 'scaling'];

// Per type: [parameter, default when the key is ABSENT]. A present value must be a finite Number
// after normalization — JS string-concatenation semantics of the frontend domain function are
// deliberately NOT carried over (an unnormalized '5' would otherwise turn 100 + '5' into '1005').
const PARAMETERS = {
  translation: [['dx', 0], ['dy', 0]],
  rotation: [['angle', 0]],
  scaling: [['scaleX', 1], ['scaleY', 1]],
};

const engine = defineEngine({
  toolName: 'coordinate-transformation',
  version: 1,
  displayName: { bg: 'Координатна трансформация', en: 'Coordinate transformation' },
  inputKeys: ['x', 'y', 'transformationType', 'parameters'],
  normalize(raw) {
    assertPlainObject(raw);
    const x = toFiniteNumber(raw.x, 'x');
    const y = toFiniteNumber(raw.y, 'y');
    const type = raw.transformationType;
    if (type === undefined || type === null || type === '') {
      throw new EngineError('MISSING_FIELD', 'Типът трансформация е задължителен', 'transformationType');
    }
    if (!TYPES.includes(type)) {
      throw new EngineError('INVALID_TYPE', 'Неизвестен тип трансформация', 'transformationType');
    }
    const rawParams = raw.parameters === undefined || raw.parameters === null ? {} : raw.parameters;
    if (typeof rawParams !== 'object' || Array.isArray(rawParams)) {
      throw new EngineError('INVALID_PARAMETERS', 'Параметрите трябва да са обект', 'parameters');
    }
    const parameters = {};
    for (const [key, fallback] of PARAMETERS[type]) {
      parameters[key] = rawParams[key] === undefined ? fallback : toFiniteNumber(rawParams[key], `parameters.${key}`);
    }
    return { x, y, transformationType: type, parameters };
  },
  validate() {
    // Type and parameter validity is fully enforced by normalize().
  },
  compute({ x, y, transformationType, parameters }) {
    let xNew;
    let yNew;
    if (transformationType === 'translation') {
      xNew = x + parameters.dx;
      yNew = y + parameters.dy;
    } else if (transformationType === 'rotation') {
      // Counter-clockwise in the X-Y plane; a positive angle turns +X toward +Y (bearing increases).
      const angle = (parameters.angle * Math.PI) / 200;
      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);
      xNew = x * cosAngle - y * sinAngle;
      yNew = x * sinAngle + y * cosAngle;
    } else {
      xNew = x * parameters.scaleX;
      yNew = y * parameters.scaleY;
    }
    return { xTransformed: xNew, yTransformed: yNew };
  },
  persisted: [['xTransformed', 3], ['yTransformed', 3]],
});

module.exports = { engines: [engine] };
