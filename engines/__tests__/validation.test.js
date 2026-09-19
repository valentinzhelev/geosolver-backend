const registry = require('../registry');
const { EngineError } = require('../errors');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

/**
 * Validation contracts — only the mathematically approved rules ported from the completed baseline
 * (no speculative rules). Every failure is a structured EngineError { code, field?, message } and
 * never a generic Error / 500.
 */

const fail = (tool, input, version) => {
  const engine = version ? registry.getEngine(tool, version) : registry.getCurrentEngine(tool);
  try {
    engine.run(input);
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect(typeof e.message).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.toResponseBody()).toEqual(expect.objectContaining({ error: e.message, code: e.code }));
    return e;
  }
  return null;
};
const ok = (tool, input, version) => {
  const engine = version ? registry.getEngine(tool, version) : registry.getCurrentEngine(tool);
  return engine.run(input);
};
const withV = (tool, patch) => ({ ...VALID_INPUTS[tool], ...patch });

describe('every tool rejects missing and non-numeric numeric fields with the field name', () => {
  const numericFields = (tool) => registry.getCurrentEngine(tool).inputKeys.filter(
    (k) => !['points', 'method', 'transformationType', 'parameters', 'mode'].includes(k)
  );

  it.each(registry.listTools())('%s', (tool) => {
    for (const field of numericFields(tool)) {
      const missing = { ...VALID_INPUTS[tool] };
      delete missing[field];
      const m = fail(tool, missing);
      expect(m.code).toBe('MISSING_FIELD');
      expect(m.field).toBe(field);
      const bad = fail(tool, withV(tool, { [field]: 'abc' }));
      expect(bad.code).toBe('INVALID_NUMBER');
      expect(bad.field).toBe(field);
    }
  });
});

describe('first-basic-task', () => {
  it('alpha must be in [0, 400) and S > 0', () => {
    expect(fail('first-basic-task', withV('first-basic-task', { alpha: -0.001 })).code).toBe('OUT_OF_RANGE');
    expect(fail('first-basic-task', withV('first-basic-task', { alpha: 400 })).field).toBe('alpha');
    expect(fail('first-basic-task', withV('first-basic-task', { s: 0 })).field).toBe('s');
    expect(fail('first-basic-task', withV('first-basic-task', { s: -5 })).code).toBe('OUT_OF_RANGE');
    expect(ok('first-basic-task', withV('first-basic-task', { alpha: 0 }))).toBeDefined();
    expect(ok('first-basic-task', withV('first-basic-task', { alpha: 399.999999 }))).toBeDefined();
  });
});

describe('second-basic-task and distance-bearing', () => {
  it('coincident points are rejected', () => {
    expect(fail('second-basic-task', { x1: 5, y1: 5, x2: 5, y2: 5 }).code).toBe('COINCIDENT_POINTS');
    expect(fail('distance-bearing', { x1: 5, y1: 5, x2: 5, y2: 5 }).code).toBe('COINCIDENT_POINTS');
    expect(ok('distance-bearing', { x1: 5, y1: 5, x2: 5, y2: 5.0001 })).toBeDefined();
  });
});

describe('forward-intersection and hansen-task', () => {
  const f = (patch) => withV('forward-intersection', patch);
  it('angles must be positive, their sum strictly below 200 gon, and A != B', () => {
    expect(fail('forward-intersection', f({ beta1: 0 })).code).toBe('OUT_OF_RANGE');
    expect(fail('forward-intersection', f({ beta2: -1 })).code).toBe('OUT_OF_RANGE');
    expect(fail('forward-intersection', f({ beta1: 100, beta2: 100 })).code).toBe('ANGLE_SUM_TOO_LARGE'); // == 200 is rejected
    expect(fail('forward-intersection', f({ beta1: 150, beta2: 60 })).code).toBe('ANGLE_SUM_TOO_LARGE');
    expect(ok('forward-intersection', f({ beta1: 99.999, beta2: 100 }))).toBeDefined();
    expect(fail('forward-intersection', { yA: 5, xA: 5, yB: 5, xB: 5, beta1: 40, beta2: 40 }).code).toBe('COINCIDENT_POINTS');
  });

  it('hansen applies the same rules through alpha/beta', () => {
    const h = (patch) => withV('hansen-task', patch);
    expect(fail('hansen-task', h({ alpha: 100, beta: 100 })).code).toBe('ANGLE_SUM_TOO_LARGE');
    expect(fail('hansen-task', h({ alpha: -5 })).code).toBe('OUT_OF_RANGE');
    expect(fail('hansen-task', { yA: 1, xA: 1, yB: 1, xB: 1, alpha: 40, beta: 40 }).code).toBe('COINCIDENT_POINTS');
  });
});

describe('polar-intersection', () => {
  it('distance must be positive; the angle is deliberately unrestricted', () => {
    expect(fail('polar-intersection', withV('polar-intersection', { distance: 0 })).code).toBe('OUT_OF_RANGE');
    expect(fail('polar-intersection', withV('polar-intersection', { distance: -1 })).field).toBe('distance');
    for (const angle of [-350, 0, 450, 1e6]) expect(ok('polar-intersection', withV('polar-intersection', { angle }))).toBeDefined();
  });
});

describe('area-calculation', () => {
  it('needs at least 3 points; only the two documented methods', () => {
    expect(fail('area-calculation', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], method: 'shoelace' }).code).toBe('TOO_FEW_POINTS');
    expect(fail('area-calculation', { points: [], method: 'shoelace' }).code).toBe('TOO_FEW_POINTS');
    expect(fail('area-calculation', { ...VALID_INPUTS['area-calculation'], method: 'x' }).code).toBe('INVALID_METHOD');
  });

  it('degenerate polygons are NOT rejected (collinear, coincident) — the shipped contract computes area 0', () => {
    expect(ok('area-calculation', { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], method: 'shoelace' }).resultData.area).toBe(0);
    expect(ok('area-calculation', { points: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], method: 'shoelace' }).resultData.area).toBe(0);
  });
});

describe('line-intersection — thresholds ported exactly (1e-12), per-line messages', () => {
  const l = (patch) => withV('line-intersection', patch);
  it('degenerate first and second line name the right line', () => {
    const one = fail('line-intersection', l({ x1: 5, y1: 5, x2: 5, y2: 5 }));
    expect(one.code).toBe('DEGENERATE_LINE');
    expect(one.field).toBe('line1');
    const two = fail('line-intersection', l({ x3: 5, y3: 5, x4: 5, y4: 5 }));
    expect(two.field).toBe('line2');
    expect(two.message).toMatch(/права 2/);
  });

  it('parallel, anti-parallel and coincident lines are PARALLEL_LINES', () => {
    const base = { y1: 0, x1: 0, y2: 0, x2: 10 };
    expect(fail('line-intersection', { ...base, y3: 1, x3: 0, y4: 1, x4: 10 }).code).toBe('PARALLEL_LINES');
    expect(fail('line-intersection', { ...base, y3: 1, x3: 10, y4: 1, x4: 0 }).code).toBe('PARALLEL_LINES');
    expect(fail('line-intersection', { ...base, y3: 0, x3: 3, y4: 0, x4: 20 }).code).toBe('PARALLEL_LINES');
  });

  it('the absolute cross-product threshold: 2e-12 passes, 5e-13 is rejected', () => {
    expect(ok('line-intersection', { y1: 0, x1: 0, y2: 0, x2: 1, y3: 0, x3: 0, y4: 2e-12, x4: 1 })).toBeDefined();
    expect(fail('line-intersection', { y1: 0, x1: 0, y2: 0, x2: 1, y3: 0, x3: 0, y4: 5e-13, x4: 1 }).code).toBe('PARALLEL_LINES');
  });

  it('the threshold depends on line LENGTHS, not on the angle (characterized, not changed)', () => {
    const build = (len) => ({ x1: 0, y1: 0, x2: len, y2: 0, x3: 0, y3: 0, x4: len * Math.cos(1e-7), y4: len * Math.sin(1e-7) });
    expect(ok('line-intersection', build(1000))).toBeDefined();
    expect(fail('line-intersection', build(1e-3)).code).toBe('PARALLEL_LINES');
  });
});

describe('offset-point (v1 and v2 share validation) and segment-division', () => {
  const o = (patch) => withV('offset-point', patch);
  it('A must differ from B and s must be inside [0, len] (inclusive)', () => {
    for (const version of [1, 2]) {
      expect(fail('offset-point', { yA: 1, xA: 1, yB: 1, xB: 1, s: 0, d: 0 }, version).code).toBe('COINCIDENT_POINTS');
      expect(fail('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 101, d: 0 }, version).code).toBe('OUT_OF_RANGE');
      expect(fail('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: -1, d: 0 }, version).field).toBe('s');
      expect(ok('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 0, d: 5 }, version)).toBeDefined();
      expect(ok('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 100, d: 5 }, version)).toBeDefined();
    }
    expect(ok('offset-point', o({ d: -1e6 }))).toBeDefined(); // d is any finite value
  });

  it('segment-division: A != B; distance in [0, len]; ratio in [0, 1]; ranges inclusive', () => {
    const s = (patch) => ({ yA: 0, xA: 0, yB: 0, xB: 100, value: 50, mode: 'distance', ...patch });
    expect(fail('segment-division', s({ yB: 0, xB: 0 })).code).toBe('COINCIDENT_POINTS');
    expect(fail('segment-division', s({ value: -0.001 })).code).toBe('OUT_OF_RANGE');
    expect(fail('segment-division', s({ value: 100.001 })).field).toBe('value');
    expect(ok('segment-division', s({ value: 100 }))).toBeDefined();
    expect(fail('segment-division', s({ mode: 'ratio', value: -0.1 })).message).toMatch(/Пропорцията/);
    expect(fail('segment-division', s({ mode: 'ratio', value: 1.1 })).code).toBe('OUT_OF_RANGE');
    expect(ok('segment-division', s({ mode: 'ratio', value: 1 }))).toBeDefined();
    expect(fail('segment-division', s({ mode: 'foo' })).code).toBe('INVALID_MODE');
  });
});

describe('a validation failure is never a plain Error', () => {
  it('every rejection above is an EngineError with a Bulgarian message (spot check across tools)', () => {
    const samples = [
      ['first-basic-task', withV('first-basic-task', { s: 0 })],
      ['forward-intersection', withV('forward-intersection', { beta1: 0 })],
      ['segment-division', withV('segment-division', { mode: 'x' })],
      ['area-calculation', { points: [], method: 'shoelace' }],
    ];
    for (const [tool, input] of samples) {
      const e = fail(tool, input);
      expect(e.message).toMatch(/[А-Яа-я]{3,}/);
    }
  });
});
