const registry = require('../registry');
const { EngineError } = require('../errors');
const { RESECTION_ERROR_CODES: CODES, RESECTION_TOLERANCES, clockwiseGon } = require('../tools/resection');

/**
 * Backend Resection engine v2 (directed clockwise angles). REFERENCE evidence derived from an
 * independent atan2 construction; the v1 solver is not ported and is never used here.
 */

const engine = registry.getCurrentEngine('resection');
const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };
const C = { x: 50, y: 80 };
const CENTER = { x: 50, y: 24.375 };
const RADIUS = 55.625;

const pointsOf = (a, b, c) => ({ xA: a.x, yA: a.y, xB: b.x, yB: b.y, xC: c.x, yC: c.y });
const anglesFor = (a, b, c, P) => ({ beta1: clockwiseGon(a, b, P), beta2: clockwiseGon(b, c, P) });
const solve = (a, b, c, P) => engine.run({ ...pointsOf(a, b, c), ...anglesFor(a, b, c, P) });
const onRing = (offset, theta = 2) => ({ x: CENTER.x + (RADIUS + offset) * Math.cos(theta), y: CENTER.y + (RADIUS + offset) * Math.sin(theta) });
const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return e.code;
  }
  return null;
};

describe('REFERENCE — recovery', () => {
  it.each([[50, 35], [40.5, 30.25], [45.75, 20.5], [55, 60.25]])('interior station (%f, %f)', (x, y) => {
    const r = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, { x, y }) }));
    expect(r.xP).toBeCloseTo(x, 8);
    expect(r.yP).toBeCloseTo(y, 8);
    expect(r.conditionNumber).toBeLessThan(20);
  });

  it.each([[30, -40], [140, 90], [-60, 20], [207.2512871487786, 49.321070637566926], [11, 6], [67, 48]])('exterior station (%f, %f)', (x, y) => {
    const r = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, { x, y }) }));
    expect(r.xP).toBeCloseTo(x, 6);
    expect(r.yP).toBeCloseTo(y, 6);
  });

  it('the previously proven P / Q case: each directed input returns its own station', () => {
    const P = { x: -60, y: 20 };
    const Q = { x: 207.2512871487786, y: 49.321070637566926 };
    const atP = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, P) }));
    const atQ = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, Q) }));
    expect(Math.hypot(atP.xP - P.x, atP.yP - P.y)).toBeLessThan(1e-6);
    expect(Math.hypot(atQ.xP - Q.x, atQ.yP - Q.y)).toBeLessThan(1e-6);
  });

  it('valid directed input whose angles sum to 400 gon or more is accepted', () => {
    let found = null;
    for (let x = -150; x <= 250 && !found; x += 5) {
      for (let y = -120; y <= 200 && !found; y += 5) {
        if (Math.abs(Math.hypot(x - CENTER.x, y - CENTER.y) - RADIUS) < 3) continue;
        const a = anglesFor(A, B, C, { x, y });
        if (a.beta1 + a.beta2 >= 400) found = { P: { x, y }, ...a };
      }
    }
    expect(found).not.toBeNull();
    const r = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), beta1: found.beta1, beta2: found.beta2 }));
    expect(r.xP).toBeCloseTo(found.P.x, 6);
  });

  it.each([1e-3, 1, 1e3])('scale %s', (s) => {
    const P = { x: 37.5 * s, y: 22.25 * s };
    const r = engine.compute(engine.normalizeAndValidate({
      ...pointsOf({ x: 0, y: 0 }, { x: 100 * s, y: 0 }, { x: 50 * s, y: 80 * s }),
      ...anglesFor({ x: 0, y: 0 }, { x: 100 * s, y: 0 }, { x: 50 * s, y: 80 * s }, P),
    }));
    expect(Math.hypot(r.xP - P.x, r.yP - P.y) / s).toBeLessThan(1e-8);
  });

  it('UTM-like coordinates', () => {
    const o = { x: 500000, y: 4700000 };
    const Al = { x: o.x, y: o.y };
    const Bl = { x: o.x + 100, y: o.y };
    const Cl = { x: o.x + 50, y: o.y + 80 };
    const P = { x: o.x + 37.5, y: o.y + 22.25 };
    const r = engine.compute(engine.normalizeAndValidate({ ...pointsOf(Al, Bl, Cl), ...anglesFor(Al, Bl, Cl, P) }));
    expect(Math.hypot(r.xP - P.x, r.yP - P.y)).toBeLessThan(1e-6);
  });
});

describe('VALIDATION — structured reasons', () => {
  const base = { ...pointsOf(A, B, C), beta1: 50, beta2: 60 };

  it('angle range', () => {
    for (const [beta1, beta2] of [[0, 50], [50, 0], [400, 50], [50, 400], [-5, 50]]) {
      expect(codeOf(() => engine.run({ ...base, beta1, beta2 }))).toBe(CODES.INVALID_ANGLE);
    }
  });

  it('duplicate control points', () => {
    expect(codeOf(() => engine.run({ ...base, xB: 0, yB: 0 }))).toBe(CODES.DUPLICATE_CONTROL_POINT);
    expect(codeOf(() => engine.run({ ...base, xC: 100, yC: 0 }))).toBe(CODES.DUPLICATE_CONTROL_POINT);
    expect(codeOf(() => engine.run({ ...base, xC: 0, yC: 0 }))).toBe(CODES.DUPLICATE_CONTROL_POINT);
  });

  it('collinear controls (exact and normalized-scale-free)', () => {
    expect(codeOf(() => engine.run({ ...base, xA: 0, yA: 0, xB: 100, yB: 0, xC: 200, yC: 0 }))).toBe(CODES.COLLINEAR_CONTROLS);
    for (const s of [1e-3, 1, 1e3]) {
      expect(codeOf(() => engine.run({ ...base, xA: 0, yA: 0, xB: 100 * s, yB: 0, xC: 200 * s, yC: 1e-9 * s }))).toBe(CODES.COLLINEAR_CONTROLS);
    }
  });

  it('near-collinear controls with a well-placed station are stable and accepted', () => {
    for (const off of [1, 0.001, 1e-6]) {
      const Cn = { x: 200, y: off };
      const r = solve(A, B, Cn, { x: 100, y: 40 });
      expect(r.resultData.xP).toBeCloseTo(100, 3);
      expect(r.resultData.yP).toBeCloseTo(40, 3);
    }
  });

  it('exact danger circle, unstable near-danger, and stable near-danger', () => {
    for (const theta of [1.0, 2.0, 4.0, 5.5]) expect(codeOf(() => solve(A, B, C, onRing(0, theta)))).toBe(CODES.DANGER_CIRCLE);
    expect(codeOf(() => solve(A, B, C, onRing(0.001)))).toBe(CODES.UNSTABLE_GEOMETRY);
    for (const off of [0.01, 1, 5]) {
      const P = onRing(off);
      const r = engine.compute(engine.normalizeAndValidate({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, P) }));
      expect(Math.hypot(r.xP - P.x, r.yP - P.y)).toBeLessThan(1e-6);
    }
  });

  it('station on a control line (angle 0 or 200)', () => {
    expect(codeOf(() => engine.run({ ...base, beta1: 200 }))).toBe(CODES.UNSTABLE_GEOMETRY);
    expect(codeOf(() => engine.run({ ...base, beta2: 200 }))).toBe(CODES.UNSTABLE_GEOMETRY);
  });

  it('inconsistent directed angles', () => {
    for (const [beta1, beta2] of [[150, 300], [300, 300], [250, 150]]) {
      expect(codeOf(() => engine.run({ ...base, beta1, beta2 }))).toBe(CODES.INCONSISTENT_ANGLES);
    }
  });

  it('non-finite values are rejected by normalization (structured, before any math)', () => {
    expect(codeOf(() => engine.run({ ...base, xA: NaN }))).toBe('INVALID_NUMBER');
    expect(codeOf(() => engine.run({ ...base, beta1: Infinity }))).toBe('INVALID_NUMBER');
    expect(codeOf(() => engine.run({ ...base, beta2: 'x' }))).toBe('INVALID_NUMBER');
  });

  it('tolerances are the validated preflight values', () => {
    expect(RESECTION_TOLERANCES).toEqual(expect.objectContaining({ residualGon: 1e-6, kappaMax: 1e4, collinearSin: 1e-9 }));
  });
});

describe('DETERMINISM and persisted contract', () => {
  it('repeated identical execution returns identical results', () => {
    const input = { ...pointsOf(A, B, C), ...anglesFor(A, B, C, { x: 37.123, y: 41.987 }) };
    const first = engine.run(input);
    for (let i = 0; i < 25; i++) expect(engine.run(input)).toEqual(first);
  });

  it('persists xP, yP (3 dp) and the method label — nothing else', () => {
    const { resultData } = engine.run({ ...pointsOf(A, B, C), ...anglesFor(A, B, C, { x: 50, y: 35 }) });
    expect(Object.keys(resultData)).toEqual(['xP', 'yP', 'method']);
    expect(resultData).toEqual({ xP: 50, yP: 35, method: 'circle-intersection' });
  });
});
