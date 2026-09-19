const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

/**
 * Resection — engine v2 (directed CLOCKWISE angles, deterministic circle intersection).
 *
 *   beta1 = directed clockwise angle at P from ray P->A to ray P->B   (gon, 0 < beta < 400)
 *   beta2 = directed clockwise angle at P from ray P->B to ray P->C
 *
 * beta and 400-beta are NOT interchangeable; there is no candidate search. P is the second
 * intersection of the two circles through (A,B) and (B,C) — a directed pair determines at most
 * one station. Thresholds were derived from the Milestone 2.0C evidence (see the frontend
 * resection.js): residual 1e-6 gon, condition number 1e4, normalized collinearity 1e-9.
 *
 * The HISTORICAL v1 solver (Tienstra + angle/complement candidate search, tie-broken by
 * floating-point noise) is deliberately NOT ported. v1 rows are verified by a consistency check
 * (engines/legacyVerification.js), never by recomputation.
 */

const RESECTION_TOLERANCES = Object.freeze({
  residualGon: 1e-6,
  kappaMax: 1e4,
  collinearSin: 1e-9,
  coincidentPoints: 1e-12,
  stationOnControlLineSin: 1e-9,
});

const RESECTION_ERROR_CODES = Object.freeze({
  INVALID_COORDINATE: 'INVALID_COORDINATE',
  INVALID_ANGLE: 'INVALID_ANGLE',
  DUPLICATE_CONTROL_POINT: 'DUPLICATE_CONTROL_POINT',
  COLLINEAR_CONTROLS: 'COLLINEAR_CONTROLS',
  DANGER_CIRCLE: 'DANGER_CIRCLE',
  INCONSISTENT_ANGLES: 'INCONSISTENT_ANGLES',
  UNSTABLE_GEOMETRY: 'UNSTABLE_GEOMETRY',
});

const GON = Math.PI / 200;
const RAD_TO_GON = 200 / Math.PI;
const C = RESECTION_ERROR_CODES;

/** Directed clockwise angle at P from ray P->from to ray P->to, gon in [0, 400). */
function clockwiseGon(from, to, P) {
  let d = Math.atan2(to.y - P.y, to.x - P.x) - Math.atan2(from.y - P.y, from.x - P.x);
  while (d < 0) d += 2 * Math.PI;
  while (d >= 2 * Math.PI) d -= 2 * Math.PI;
  return d * RAD_TO_GON;
}

function circularDiffGon(a, b) {
  const d = Math.abs(a - b) % 400;
  return Math.min(d, 400 - d);
}

function circleCenter(F, T, thetaGon) {
  const dx = T.x - F.x;
  const dy = T.y - F.y;
  const len = Math.hypot(dx, dy);
  const offset = len / 2 / Math.tan(thetaGon * GON);
  return {
    x: (F.x + T.x) / 2 + offset * (-dy / len),
    y: (F.y + T.y) / 2 + offset * (dx / len),
    r: Math.hypot(offset, len / 2),
  };
}

/** Scale-free condition number (sigma_max / sigma_min) of the angle Jacobian d(beta1, beta2)/d(P). */
function conditionNumber(A, B, Cc, P) {
  const grad = (Q) => {
    const dx = Q.x - P.x;
    const dy = Q.y - P.y;
    const r2 = dx * dx + dy * dy;
    return [dy / r2, -dx / r2];
  };
  const gA = grad(A);
  const gB = grad(B);
  const gC = grad(Cc);
  const a = gB[0] - gA[0];
  const b = gB[1] - gA[1];
  const c = gC[0] - gB[0];
  const d = gC[1] - gB[1];
  const s1 = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  const disc = Math.sqrt(Math.max(0, s1 * s1 - 4 * det * det));
  const smax = Math.sqrt((s1 + disc) / 2);
  const smin = Math.sqrt(Math.max(0, (s1 - disc) / 2));
  return smin > 0 ? smax / smin : Infinity;
}

// Input-only checks: angle range, distinct controls, non-collinear controls, station not on a control line.
function preChecks({ xA, yA, xB, yB, xC, yC, beta1, beta2 }) {
  const T = RESECTION_TOLERANCES;
  if (!(beta1 > 0 && beta1 < 400 && beta2 > 0 && beta2 < 400)) {
    throw new EngineError(C.INVALID_ANGLE, 'Ъглите β₁ и β₂ трябва да са в интервала (0, 400) гради', 'beta1');
  }
  const A = { x: xA, y: yA };
  const B = { x: xB, y: yB };
  const Cc = { x: xC, y: yC };
  const ab = Math.hypot(B.x - A.x, B.y - A.y);
  const bc = Math.hypot(Cc.x - B.x, Cc.y - B.y);
  const ca = Math.hypot(A.x - Cc.x, A.y - Cc.y);
  if (Math.min(ab, bc, ca) < T.coincidentPoints) {
    throw new EngineError(C.DUPLICATE_CONTROL_POINT, 'Контролните точки A, B и C трябва да са различни');
  }
  const sinB = Math.abs((B.x - A.x) * (Cc.y - B.y) - (B.y - A.y) * (Cc.x - B.x)) / (ab * bc);
  if (sinB < T.collinearSin) {
    throw new EngineError(C.COLLINEAR_CONTROLS, 'Контролните точки A, B и C лежат на една права — обратна засечка не може да се определи');
  }
  for (const beta of [beta1, beta2]) {
    if (Math.abs(Math.sin(beta * GON)) < T.stationOnControlLineSin) {
      throw new EngineError(C.UNSTABLE_GEOMETRY, 'Ъгъл 0 или 200 гради означава станция върху права през две контролни точки — решението е неустойчиво');
    }
  }
}

function solve(input) {
  const T = RESECTION_TOLERANCES;
  const { xA, yA, xB, yB, xC, yC, beta1, beta2 } = input;
  const A = { x: xA, y: yA };
  const B = { x: xB, y: yB };
  const Cc = { x: xC, y: yC };

  const O1 = circleCenter(A, B, beta1);
  const O2 = circleCenter(B, Cc, beta2);
  const ex = O2.x - O1.x;
  const ey = O2.y - O1.y;
  const el = Math.hypot(ex, ey);
  if (!Number.isFinite(el)) {
    throw new EngineError(C.UNSTABLE_GEOMETRY, 'Решението не е числено устойчиво за тези данни');
  }
  if (el <= 1e-9 * (O1.r + O2.r)) {
    throw new EngineError(C.DANGER_CIRCLE, 'Станцията лежи върху опасната окръжност през A, B и C — положението ѝ не е определено');
  }
  const ux = ex / el;
  const uy = ey / el;
  const p = (B.x - O1.x) * ux + (B.y - O1.y) * uy;
  const P = { x: 2 * (O1.x + p * ux) - B.x, y: 2 * (O1.y + p * uy) - B.y };
  if (!Number.isFinite(P.x) || !Number.isFinite(P.y)) {
    throw new EngineError(C.UNSTABLE_GEOMETRY, 'Решението не е числено устойчиво за тези данни');
  }

  const calcBeta1 = clockwiseGon(A, B, P);
  const calcBeta2 = clockwiseGon(B, Cc, P);
  const error1 = circularDiffGon(calcBeta1, beta1);
  const error2 = circularDiffGon(calcBeta2, beta2);
  if (Math.max(error1, error2) > T.residualGon) {
    throw new EngineError(
      C.INCONSISTENT_ANGLES,
      'Въведените насочени ъгли β₁ и β₂ не отговарят на нито една станция — проверете дали са по часовниковата стрелка (P→A→P→B и P→B→P→C)'
    );
  }
  const kappa = conditionNumber(A, B, Cc, P);
  if (!Number.isFinite(kappa) || kappa > T.kappaMax) {
    throw new EngineError(C.UNSTABLE_GEOMETRY, 'Станцията е твърде близо до опасната окръжност — геометрията е неустойчива');
  }
  return { xP: P.x, yP: P.y, calcBeta1, calcBeta2, error1, error2, conditionNumber: kappa, method: 'circle-intersection' };
}

const engine = defineEngine({
  toolName: 'resection',
  version: 2,
  displayName: { bg: 'Обратна засечка', en: 'Resection' },
  fields: ['xA', 'yA', 'xB', 'yB', 'xC', 'yC', 'beta1', 'beta2'],
  validate: preChecks,
  compute(input) {
    preChecks(input);
    return solve(input);
  },
  persisted: [['xP', 3], ['yP', 3], ['method', 'string']],
});

module.exports = {
  engines: [engine],
  RESECTION_TOLERANCES,
  RESECTION_ERROR_CODES,
  clockwiseGon,
  circularDiffGon,
  conditionNumber,
};
