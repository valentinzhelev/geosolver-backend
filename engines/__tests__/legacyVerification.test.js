const fs = require('fs');
const path = require('path');
const registry = require('../registry');
const { verifyLegacyCalculation, describeStrategy, RESECTION_V1_POLICY } = require('../legacyVerification');
const { clockwiseGon } = require('../tools/resection');
const resectionV1 = require('../fixtures/resection.v1.legacy.vectors.json');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

/**
 * LEGACY verification: strategies are chosen per (toolName, engineVersion). The historical
 * resection v1 solver is never re-run; offset v1 is a known bug and is blocked unless d === 0; other
 * deterministic legacy engines are recomputed by their EXACT version. There is no override.
 */

const round3 = (v) => Math.round(v * 1000) / 1000;

function legacyRow(toolName, engineVersion, inputData, resultData, extra = {}) {
  return { toolName, engineVersion, inputData, resultData, ...extra };
}
// A legacy row whose stored result is what the engine of that exact version produces.
function honestRow(toolName, engineVersion, inputData) {
  const engine = registry.getEngine(toolName, engineVersion);
  return legacyRow(toolName, engineVersion, inputData, engine.run(inputData).resultData);
}

describe('strategy table', () => {
  it('is explicit per (toolName, engineVersion)', () => {
    expect(describeStrategy('resection', 1)).toBe('consistency-check');
    expect(describeStrategy('offset-point', 1)).toBe('known-bug-guard+recompute-v1');
    expect(describeStrategy('offset-point', 2)).toBe('recompute-exact-version');
    expect(describeStrategy('resection', 2)).toBe('recompute-exact-version');
    expect(describeStrategy('first-basic-task', 1)).toBe('recompute-exact-version');
    expect(describeStrategy('first-basic-task', 7)).toBe('unavailable');
    expect(describeStrategy('first-basic-task', undefined)).toBe('unknown-version');
    expect(describeStrategy('first-basic-task', null)).toBe('unknown-version');
  });

  it('the historical resection v1 solver is never used: it is not registered and the verifier does not reference one', () => {
    expect(registry.getEngine('resection', 1)).toBeNull();
    const source = fs.readFileSync(path.join(__dirname, '..', 'legacyVerification.js'), 'utf8');
    expect(source).not.toMatch(/calculateResectionV1|Tienstra/);
    expect(source).not.toMatch(/getEngine\(\s*'resection'\s*,\s*1/);
  });

  it('the resection v1 policy table is strict: only DIRECTED_MATCH is allowed', () => {
    expect(RESECTION_V1_POLICY.DIRECTED_MATCH.allowed).toBe(true);
    for (const verdict of ['COMPLEMENT_ONLY', 'MISMATCH', 'UNSTABLE']) expect(RESECTION_V1_POLICY[verdict].allowed).toBe(false);
    expect(RESECTION_V1_POLICY.COMPLEMENT_ONLY.code).toBe('LEGACY_RESECTION_ALTERNATIVE_SOLUTION');
    expect(RESECTION_V1_POLICY.MISMATCH.code).toBe('RESULT_MISMATCH');
    expect(RESECTION_V1_POLICY.UNSTABLE.code).toBe('LEGACY_RESECTION_UNSTABLE');
  });
});

describe('resection v1 — consistency verification (never recomputation)', () => {
  const rowFrom = (vector, stored) => legacyRow('resection', 1, vector.input, { xP: round3(stored.xP), yP: round3(stored.yP), method: 'Tienstra' });

  it('DIRECTED_MATCH -> allowed, using the STORED station (basis: consistency-check)', () => {
    const vectors = resectionV1.vectors.filter((v) => v.category === 'deterministic');
    expect(vectors.length).toBeGreaterThanOrEqual(6);
    for (const v of vectors) {
      const result = verifyLegacyCalculation(rowFrom(v, v.v1));
      expect(result.allowed).toBe(true);
      expect(result.basis).toBe('consistency-check');
      expect(result.verdict).toBe('DIRECTED_MATCH');
      expect(result.x).toBe(round3(v.v1.xP));
      expect(result.y).toBe(round3(v.v1.yP));
    }
  });

  it('COMPLEMENT_ONLY (v1 returned an alternative exact station) -> BLOCKED LEGACY_RESECTION_ALTERNATIVE_SOLUTION', () => {
    const alternatives = resectionV1.vectors.filter((v) => v.category === 'ambiguous-returned-ALTERNATIVE-station');
    expect(alternatives.length).toBeGreaterThanOrEqual(5);
    for (const v of alternatives) {
      const result = verifyLegacyCalculation(rowFrom(v, v.v1));
      expect(result).toMatchObject({ allowed: false, status: 409, code: 'LEGACY_RESECTION_ALTERNATIVE_SOLUTION' });
    }
  });

  it('MISMATCH (corrupted / forged stored station) -> BLOCKED RESULT_MISMATCH', () => {
    const v = resectionV1.vectors.find((x) => x.category === 'deterministic');
    for (const shift of [{ x: 5, y: 0 }, { x: 0, y: 5 }, { x: 500, y: -500 }, { x: 0.05, y: 0.05 }]) {
      const forged = { xP: v.v1.xP + shift.x, yP: v.v1.yP + shift.y };
      expect(verifyLegacyCalculation(rowFrom(v, forged))).toMatchObject({ allowed: false, code: 'RESULT_MISMATCH' });
    }
    expect(verifyLegacyCalculation(legacyRow('resection', 1, v.input, { xP: 'x', yP: 1 }))).toMatchObject({ allowed: false, code: 'RESULT_MISMATCH' });
    expect(verifyLegacyCalculation(legacyRow('resection', 1, v.input, {}))).toMatchObject({ allowed: false, code: 'RESULT_MISMATCH' });
  });

  it('UNSTABLE (ill-conditioned geometry cannot bound a forgery) -> BLOCKED LEGACY_RESECTION_UNSTABLE', () => {
    const P = { x: 50 + 55.626 * Math.cos(2), y: 24.375 + 55.626 * Math.sin(2) };
    const A = { x: 0, y: 0 };
    const B = { x: 100, y: 0 };
    const C = { x: 50, y: 80 };
    const input = { xA: 0, yA: 0, xB: 100, yB: 0, xC: 50, yC: 80, beta1: clockwiseGon(A, B, P), beta2: clockwiseGon(B, C, P) };
    expect(verifyLegacyCalculation(legacyRow('resection', 1, input, { xP: P.x, yP: P.y, method: 'Tienstra' })))
      .toMatchObject({ allowed: false, code: 'LEGACY_RESECTION_UNSTABLE' });
  });

  it('unreadable stored input -> LEGACY_INPUT_INVALID', () => {
    expect(verifyLegacyCalculation(legacyRow('resection', 1, { xA: 'q' }, { xP: 1, yP: 1 }))).toMatchObject({ allowed: false, code: 'LEGACY_INPUT_INVALID' });
  });

  it('is strict: there is no override parameter', () => {
    expect(verifyLegacyCalculation.length).toBe(1);
  });
});

describe('offset-point v1 — KNOWN BUG guard', () => {
  const base = { yA: 0, xA: 0, yB: 0, xB: 100, s: 50 };

  it('d !== 0 is BLOCKED LEGACY_ENGINE_KNOWN_BUG, even when the stored mirrored result is perfectly consistent', () => {
    for (const d of [10, -10, 0.001, 1e-9]) {
      const row = honestRow('offset-point', 1, { ...base, d });
      const r = verifyLegacyCalculation(row);
      expect(r).toMatchObject({ allowed: false, status: 409, code: 'LEGACY_ENGINE_KNOWN_BUG' });
    }
  });

  it('d === 0 proceeds after normal verification (recomputed with v1; the foot point is version-independent)', () => {
    const r = verifyLegacyCalculation(honestRow('offset-point', 1, { ...base, d: 0 }));
    expect(r.allowed).toBe(true);
    expect(r.basis).toBe('recomputed');
    expect(r.x).toBeCloseTo(50, 9);
    expect(r.y).toBeCloseTo(0, 9);
  });

  it('d === 0 with a stored result that does not match is still RESULT_MISMATCH; -0 counts as 0', () => {
    expect(verifyLegacyCalculation(legacyRow('offset-point', 1, { ...base, d: 0 }, { yP: 999, xP: 50 }))).toMatchObject({ allowed: false, code: 'RESULT_MISMATCH' });
    expect(verifyLegacyCalculation(honestRow('offset-point', 1, { ...base, d: -0 })).allowed).toBe(true);
  });

  it('the string form of d is normalized before the guard ("0" is 0, "10" is 10)', () => {
    expect(verifyLegacyCalculation(honestRow('offset-point', 1, { ...base, d: '0' })).allowed).toBe(true);
    expect(verifyLegacyCalculation(legacyRow('offset-point', 1, { ...base, d: '10' }, { yP: 10, xP: 50 })).code).toBe('LEGACY_ENGINE_KNOWN_BUG');
  });
});

describe('other deterministic legacy engines — recomputed by their EXACT version', () => {
  it('a consistent stored result verifies; the point comes from the recomputation', () => {
    for (const tool of ['first-basic-task', 'polar-intersection', 'forward-intersection', 'line-intersection', 'segment-division', 'hansen-task', 'coordinate-transformation']) {
      const r = verifyLegacyCalculation(honestRow(tool, 1, VALID_INPUTS[tool]));
      expect(r.allowed).toBe(true);
      expect(r.basis).toBe('recomputed');
    }
  });

  it('a tampered stored result is RESULT_MISMATCH', () => {
    const row = honestRow('first-basic-task', 1, VALID_INPUTS['first-basic-task']);
    row.resultData = { ...row.resultData, x2: row.resultData.x2 + 50 };
    expect(verifyLegacyCalculation(row)).toMatchObject({ allowed: false, status: 409, code: 'RESULT_MISMATCH' });
  });

  it('a difference of one rounding step is tolerated (boundary flip), two steps are not', () => {
    const row = honestRow('first-basic-task', 1, VALID_INPUTS['first-basic-task']);
    expect(verifyLegacyCalculation({ ...row, resultData: { ...row.resultData, x2: row.resultData.x2 + 0.001 } }).allowed).toBe(true);
    expect(verifyLegacyCalculation({ ...row, resultData: { ...row.resultData, x2: row.resultData.x2 + 0.01 } }).allowed).toBe(false);
  });

  it('legacy Forward Intersection rows with STRING inputData are normalized then verified', () => {
    const numbers = VALID_INPUTS['forward-intersection'];
    const strings = Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, String(v)]));
    const stored = registry.getCurrentEngine('forward-intersection').run(numbers).resultData;
    const r = verifyLegacyCalculation(legacyRow('forward-intersection', 1, strings, stored));
    expect(r.allowed).toBe(true);
  });

  it('invalid stored input -> LEGACY_INPUT_INVALID', () => {
    expect(verifyLegacyCalculation(legacyRow('first-basic-task', 1, { y1: 'x' }, { y2: 1, x2: 1 }))).toMatchObject({ allowed: false, code: 'LEGACY_INPUT_INVALID' });
  });

  it('a legacy (non-canonical) row labelled with the CURRENT version still goes through recompute by that exact version', () => {
    expect(verifyLegacyCalculation(honestRow('offset-point', 2, { yA: 0, xA: 0, yB: 0, xB: 100, s: 50, d: 10 })).allowed).toBe(true);
    const input = VALID_INPUTS.resection;
    expect(verifyLegacyCalculation(honestRow('resection', 2, input)).allowed).toBe(true);
  });
});

describe('unknown versions', () => {
  it('absent or non-integer version -> LEGACY_ENGINE_UNKNOWN; unregistered version -> ENGINE_VERSION_UNAVAILABLE', () => {
    for (const engineVersion of [undefined, null, 1.5, '1', NaN]) {
      expect(verifyLegacyCalculation(legacyRow('first-basic-task', engineVersion, VALID_INPUTS['first-basic-task'], {}))).toMatchObject({ allowed: false, status: 409, code: 'LEGACY_ENGINE_UNKNOWN' });
    }
    for (const [tool, version] of [['first-basic-task', 2], ['first-basic-task', 99], ['resection', 3], ['offset-point', 3]]) {
      expect(verifyLegacyCalculation(legacyRow(tool, version, VALID_INPUTS[tool], {}))).toMatchObject({ allowed: false, code: 'ENGINE_VERSION_UNAVAILABLE' });
    }
  });

  it('a non-professional tool has no strategy', () => {
    expect(verifyLegacyCalculation(legacyRow('scientific-calculator', 1, {}, {})).code).toBe('ENGINE_VERSION_UNAVAILABLE');
  });
});
