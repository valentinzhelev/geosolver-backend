const registry = require('../registry');
const { toFiniteNumber, roundTo } = require('../numbers');
const { EngineError } = require('../errors');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return { code: e.code, field: e.field };
  }
  return null;
};
const engine = (tool) => registry.getCurrentEngine(tool);

describe('number normalization — Number() semantics, never permissive parsing', () => {
  it('keeps finite JSON numbers unchanged (never rounds inputs)', () => {
    for (const v of [0, -0.5, 1234.56789012345, 1e-9, 12345678.123456789, -1e12]) expect(toFiniteNumber(v, 'f')).toBe(v);
  });

  it('converts canonical decimal strings with Number() (this repairs the legacy Forward Intersection strings)', () => {
    expect(toFiniteNumber('12.5', 'f')).toBe(12.5);
    expect(toFiniteNumber(' -0.25 ', 'f')).toBe(-0.25);
    expect(toFiniteNumber('1e3', 'f')).toBe(1000);
    expect(toFiniteNumber('+7', 'f')).toBe(7);
    expect(toFiniteNumber('.5', 'f')).toBe(0.5);
    expect(toFiniteNumber('5.', 'f')).toBe(5);
  });

  it('does NOT invent values: parseFloat-style prefixes, empty strings, hex, Infinity, decimal comma, booleans, objects are rejected', () => {
    for (const bad of ['12abc', '', '   ', '0x10', 'Infinity', '-Infinity', 'NaN', '1,5', '1 2', '--1', '1e', true, false, [], [1], {}, () => 1]) {
      expect(codeOf(() => toFiniteNumber(bad, 'f'))).toEqual({ code: 'INVALID_NUMBER', field: 'f' });
    }
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(codeOf(() => toFiniteNumber(bad, 'f'))).toEqual({ code: 'INVALID_NUMBER', field: 'f' });
    }
  });

  it('null and undefined are MISSING_FIELD', () => {
    expect(codeOf(() => toFiniteNumber(undefined, 'f'))).toEqual({ code: 'MISSING_FIELD', field: 'f' });
    expect(codeOf(() => toFiniteNumber(null, 'f'))).toEqual({ code: 'MISSING_FIELD', field: 'f' });
  });

  it('roundTo is the same operation as the frontend (Math.round(v * 10^d) / 10^d)', () => {
    expect(roundTo(1.0005, 3)).toBe(Math.round(1.0005 * 1000) / 1000);
    expect(roundTo(123.456789, 2)).toBe(123.46);
    expect(roundTo(-2.5, 0)).toBe(-2);
  });
});

describe('Forward Intersection legacy string body normalizes safely', () => {
  const strings = { yA: '200.5', xA: '100.25', yB: '310', xB: '420.125', beta1: '50', beta2: '60' };
  const numbers = { yA: 200.5, xA: 100.25, yB: 310, xB: 420.125, beta1: 50, beta2: 60 };

  it('the string-shaped body becomes the exact numeric input', () => {
    const normalized = engine('forward-intersection').normalize(strings);
    expect(normalized).toEqual(numbers);
    for (const v of Object.values(normalized)) expect(typeof v).toBe('number');
  });

  it('and computes exactly like the numeric body', () => {
    expect(engine('forward-intersection').run(strings).resultData).toEqual(engine('forward-intersection').run(numbers).resultData);
  });

  it('a string that is not a canonical number is rejected, never guessed', () => {
    expect(codeOf(() => engine('forward-intersection').normalize({ ...strings, beta1: '5o' }))).toEqual({ code: 'INVALID_NUMBER', field: 'beta1' });
  });
});

describe('inputs are never rounded and unknown fields are stripped', () => {
  it('a high-precision input survives normalization bit-for-bit', () => {
    const y1 = 1234.567890123456;
    expect(engine('first-basic-task').normalize({ y1, x1: 1, alpha: 10, s: 5 }).y1).toBe(y1);
  });

  it('extra fields are dropped for every tool', () => {
    for (const tool of registry.listTools()) {
      const normalized = engine(tool).normalize({ ...VALID_INPUTS[tool], resultData: { hacked: true }, engineVersion: 99, extra: 1 });
      expect(normalized).not.toHaveProperty('resultData');
      expect(normalized).not.toHaveProperty('engineVersion');
      expect(normalized).not.toHaveProperty('extra');
    }
  });

  it('inputData must be a plain object', () => {
    for (const bad of [undefined, null, 5, 'x', [], [1, 2]]) {
      expect(codeOf(() => engine('first-basic-task').normalize(bad))).toEqual({ code: 'INVALID_INPUT_DATA', field: 'inputData' });
    }
  });
});

describe('area-calculation: the backend accepts the structured array and NEVER re-parses or re-filters', () => {
  const area = engine('area-calculation');

  it('keeps exactly the points it was given, in order, dropping only extra keys per point', () => {
    const normalized = area.normalize({ points: [{ x: 0, y: 0, z: 9 }, { x: '100', y: 0 }, { x: 50, y: 100 }], method: 'trapezoidal' });
    expect(normalized).toEqual({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }], method: 'trapezoidal' });
  });

  it('textarea text is NOT accepted (no server-side parsing)', () => {
    expect(codeOf(() => area.normalize({ points: '0 0\n100 0\n50 100', method: 'shoelace' }))).toEqual({ code: 'INVALID_POINT_LIST', field: 'points' });
  });

  it('a malformed element is an ERROR, never silently dropped', () => {
    expect(codeOf(() => area.normalize({ points: [{ x: 0, y: 0 }, { x: 1 }, { x: 2, y: 2 }] }))).toEqual({ code: 'MISSING_FIELD', field: 'points[1].y' });
    expect(codeOf(() => area.normalize({ points: [{ x: 0, y: 0 }, null, { x: 2, y: 2 }] }))).toEqual({ code: 'INVALID_POINT_LIST', field: 'points[1]' });
    expect(codeOf(() => area.normalize({ points: [{ x: 0, y: 0 }, { x: 'abc', y: 1 }, { x: 2, y: 2 }] }))).toEqual({ code: 'INVALID_NUMBER', field: 'points[1].x' });
  });

  it('a missing method keeps the historical default "shoelace"; an unknown one is INVALID_METHOD', () => {
    expect(area.normalize({ points: VALID_INPUTS['area-calculation'].points }).method).toBe('shoelace');
    expect(codeOf(() => area.normalize({ points: VALID_INPUTS['area-calculation'].points, method: 'gauss' }))).toEqual({ code: 'INVALID_METHOD', field: 'method' });
  });
});

describe('coordinate-transformation: parameters are finite Numbers after normalization', () => {
  const tx = engine('coordinate-transformation');

  it('keeps only the type-relevant parameters and makes the defaults explicit', () => {
    expect(tx.normalize({ x: 1, y: 2, transformationType: 'translation', parameters: { dx: 5, angle: 99 } }).parameters).toEqual({ dx: 5, dy: 0 });
    expect(tx.normalize({ x: 1, y: 2, transformationType: 'rotation', parameters: {} }).parameters).toEqual({ angle: 0 });
    expect(tx.normalize({ x: 1, y: 2, transformationType: 'scaling' }).parameters).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('numeric strings are normalized to numbers — JS string concatenation semantics are impossible', () => {
    const n = tx.normalize({ x: 100, y: 200, transformationType: 'translation', parameters: { dx: '5', dy: '0' } });
    expect(n.parameters).toEqual({ dx: 5, dy: 0 });
    expect(tx.run({ x: 100, y: 200, transformationType: 'translation', parameters: { dx: '5', dy: 0 } }).resultData.xTransformed).toBe(105);
  });

  it('non-numeric parameters, non-object parameters, unknown or missing types are rejected', () => {
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'rotation', parameters: { angle: 'abc' } }))).toEqual({ code: 'INVALID_NUMBER', field: 'parameters.angle' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'scaling', parameters: { scaleX: NaN } }))).toEqual({ code: 'INVALID_NUMBER', field: 'parameters.scaleX' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'scaling', parameters: { scaleY: Infinity } }))).toEqual({ code: 'INVALID_NUMBER', field: 'parameters.scaleY' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'scaling', parameters: 'x' }))).toEqual({ code: 'INVALID_PARAMETERS', field: 'parameters' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'scaling', parameters: [1, 2] }))).toEqual({ code: 'INVALID_PARAMETERS', field: 'parameters' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2, transformationType: 'shear' }))).toEqual({ code: 'INVALID_TYPE', field: 'transformationType' });
    expect(codeOf(() => tx.normalize({ x: 1, y: 2 }))).toEqual({ code: 'MISSING_FIELD', field: 'transformationType' });
  });

  it('a scale of 0 is a valid finite number (the UI turns 0 into 1 before saving; the engine does not second-guess it)', () => {
    expect(tx.run({ x: 9, y: 8, transformationType: 'scaling', parameters: { scaleX: 0, scaleY: 2 } }).resultData).toEqual({ xTransformed: 0, yTransformed: 16 });
  });
});

describe('segment-division: mode must be exactly "distance" or "ratio"', () => {
  const seg = engine('segment-division');
  const base = { yA: 0, xA: 0, yB: 0, xB: 100, value: 50 };

  it('accepts the two modes and defaults an ABSENT mode to distance', () => {
    expect(seg.normalize({ ...base, mode: 'ratio' }).mode).toBe('ratio');
    expect(seg.normalize({ ...base, mode: 'distance' }).mode).toBe('distance');
    expect(seg.normalize(base).mode).toBe('distance');
  });

  it('every other value is INVALID_MODE — nothing is silently treated as distance', () => {
    for (const bad of ['foo', 'RATIO', 'Ratio', ' ratio', '', null, 0, 1, true, [], {}]) {
      expect(codeOf(() => seg.normalize({ ...base, mode: bad }))).toEqual({ code: 'INVALID_MODE', field: 'mode' });
    }
  });
});
