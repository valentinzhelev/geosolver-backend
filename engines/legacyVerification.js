/**
 * LEGACY verification strategies for Save-as-point on rows that are NOT canonical
 * (resultAuthority absent, or 'client'). This is deliberately separate from canonical
 * computation: canonical rows use their stored server-authoritative result directly, legacy rows
 * are verified per (toolName, engineVersion) and the original Calculation is never modified.
 *
 * Strategy table (explicit decisions — do not generalize):
 *   resection v1   consistency check ONLY. The v1 solver ranks candidate stations by floating-point
 *                  noise, so it is never re-run as a verifier: the stored station is used to
 *                  reconstruct the directed angles, which are compared with the stored input.
 *                  DIRECTED_MATCH -> allowed; COMPLEMENT_ONLY / MISMATCH / UNSTABLE -> blocked.
 *   offset-point v1  KNOWN BUG (mirrored right-side result). Blocked unless d === 0 (the foot
 *                  point is identical in v1 and v2); then verified by recomputing with v1.
 *   any other (tool, version) that is registered   recompute with that EXACT version and compare
 *                  the persisted fields with the approved tolerances; mismatch -> RESULT_MISMATCH.
 *   unknown / absent version  blocked (ENGINE_VERSION_UNAVAILABLE / LEGACY_ENGINE_UNKNOWN).
 * There is no "continue anyway" override.
 */
const registry = require('./registry');
const { compareResultData } = require('./compare');
const { isEngineError } = require('./errors');
const { extractPointResult } = require('../utils/calculationPointOutputs');
const { clockwiseGon, circularDiffGon, conditionNumber, RESECTION_TOLERANCES } = require('./tools/resection');

const blocked = (code, error) => ({ allowed: false, status: 409, code, error });
const allowed = (point, basis, extra = {}) => ({ allowed: true, x: point.x, y: point.y, basis, ...extra });

const RESECTION_V1_POLICY = Object.freeze({
  DIRECTED_MATCH: { allowed: true },
  COMPLEMENT_ONLY: { allowed: false, code: 'LEGACY_RESECTION_ALTERNATIVE_SOLUTION', error: 'Тази засечка е запазена с алтернативно решение (допълващи ъгли) и не може да стане точка' },
  MISMATCH: { allowed: false, code: 'RESULT_MISMATCH', error: 'Запазеният резултат не съответства на въведените данни' },
  UNSTABLE: { allowed: false, code: 'LEGACY_RESECTION_UNSTABLE', error: 'Геометрията на тази засечка е твърде неустойчива, за да бъде потвърдена' },
});

/**
 * Consistency verdict for a stored v1 resection. Tolerance is derived from the 3-decimal rounding of
 * the stored coordinates: moving P by at most d = 0.5e-3*sqrt(2) m changes each ray's bearing by at
 * most d / distance radians.
 */
function resectionConsistencyVerdict(input, stored) {
  const A = { x: input.xA, y: input.yA };
  const B = { x: input.xB, y: input.yB };
  const C = { x: input.xC, y: input.yC };
  const P = { x: stored.x, y: stored.y };
  const dA = Math.hypot(P.x - A.x, P.y - A.y);
  const dB = Math.hypot(P.x - B.x, P.y - B.y);
  const dC = Math.hypot(P.x - C.x, P.y - C.y);
  if (Math.min(dA, dB, dC) < 1e-9) return { verdict: 'MISMATCH' };
  const kappa = conditionNumber(A, B, C, P);
  if (!Number.isFinite(kappa) || kappa > RESECTION_TOLERANCES.kappaMax) return { verdict: 'UNSTABLE', kappa };
  const RAD_TO_GON = 200 / Math.PI;
  const d = 0.5e-3 * Math.SQRT2;
  const tol1 = (d / dA + d / dB) * RAD_TO_GON + 1e-9;
  const tol2 = (d / dB + d / dC) * RAD_TO_GON + 1e-9;
  const c1 = clockwiseGon(A, B, P);
  const c2 = clockwiseGon(B, C, P);
  const e1 = circularDiffGon(c1, input.beta1);
  const e2 = circularDiffGon(c2, input.beta2);
  if (e1 <= tol1 && e2 <= tol2) return { verdict: 'DIRECTED_MATCH', kappa };
  const okC1 = e1 <= tol1 || circularDiffGon(c1, 400 - input.beta1) <= tol1;
  const okC2 = e2 <= tol2 || circularDiffGon(c2, 400 - input.beta2) <= tol2;
  return okC1 && okC2 ? { verdict: 'COMPLEMENT_ONLY', kappa } : { verdict: 'MISMATCH', kappa };
}

function verifyResectionV1(calc) {
  // The v2 engine is used ONLY for its input normalizer (the saved input contract is identical); it
  // never computes anything here.
  let input;
  try {
    input = registry.getCurrentEngine('resection').normalize(calc.inputData);
  } catch (e) {
    if (isEngineError(e)) return blocked('LEGACY_INPUT_INVALID', 'Запазените входни данни не могат да бъдат проверени');
    throw e;
  }
  const stored = extractPointResult('resection', calc.resultData);
  if (!stored.ok) return blocked('RESULT_MISMATCH', RESECTION_V1_POLICY.MISMATCH.error);
  const { verdict } = resectionConsistencyVerdict(input, stored);
  const policy = RESECTION_V1_POLICY[verdict];
  if (!policy.allowed) return blocked(policy.code, policy.error);
  return allowed(stored, 'consistency-check', { verdict });
}

function verifyByRecompute(calc, engine) {
  let run;
  try {
    run = engine.run(calc.inputData);
  } catch (e) {
    if (isEngineError(e)) return blocked('LEGACY_INPUT_INVALID', 'Запазените входни данни не могат да бъдат проверени');
    throw e;
  }
  const comparison = compareResultData(engine, run.resultData, calc.resultData);
  if (comparison.status !== 'match') {
    return blocked('RESULT_MISMATCH', 'Запазеният резултат не съответства на преизчислението с неговата версия на алгоритъма');
  }
  const point = extractPointResult(engine.toolName, run.resultData);
  if (!point.ok) return blocked('RESULT_MISMATCH', 'Запазеният резултат няма валидни координати');
  return allowed(point, 'recomputed');
}

function verifyOffsetV1(calc) {
  const engine = registry.getEngine('offset-point', 1);
  let input;
  try {
    input = engine.normalizeAndValidate(calc.inputData);
  } catch (e) {
    if (isEngineError(e)) return blocked('LEGACY_INPUT_INVALID', 'Запазените входни данни не могат да бъдат проверени');
    throw e;
  }
  if (input.d !== 0) {
    return blocked(
      'LEGACY_ENGINE_KNOWN_BUG',
      'Това изчисление е направено с версия 1 на ортогоналния offset, която поставя точката от грешната страна. От него не се създава нова точка — направете ново изчисление'
    );
  }
  return verifyByRecompute(calc, engine);
}

/** Documents the chosen strategy; used by tests and by anyone extending the table. */
function describeStrategy(toolName, engineVersion) {
  if (!Number.isInteger(engineVersion)) return 'unknown-version';
  if (toolName === 'resection' && engineVersion === 1) return 'consistency-check';
  if (toolName === 'offset-point' && engineVersion === 1) return 'known-bug-guard+recompute-v1';
  return registry.getEngine(toolName, engineVersion) ? 'recompute-exact-version' : 'unavailable';
}

function verifyLegacyCalculation(calc) {
  const version = calc.engineVersion;
  if (!Number.isInteger(version)) {
    return blocked('LEGACY_ENGINE_UNKNOWN', 'Липсва версия на алгоритъма за това изчисление — от него не може да се създаде точка');
  }
  const strategy = describeStrategy(calc.toolName, version);
  if (strategy === 'consistency-check') return verifyResectionV1(calc);
  if (strategy === 'known-bug-guard+recompute-v1') return verifyOffsetV1(calc);
  if (strategy === 'recompute-exact-version') return verifyByRecompute(calc, registry.getEngine(calc.toolName, version));
  return blocked('ENGINE_VERSION_UNAVAILABLE', 'Версията на алгоритъма на това изчисление не се поддържа');
}

module.exports = { verifyLegacyCalculation, describeStrategy, resectionConsistencyVerdict, RESECTION_V1_POLICY };
