/**
 * Centralized toolName → allowed point roles → inputData coordinate fields
 * mapping (Milestone 1 follow-up §3). Verified directly against each
 * calculator's actual `runWithTracking({ inputData })` call in
 * GEOSOLVER.BG/src/components/tasks/*.js as of this milestone — do not
 * change a field name here without re-checking the frontend source, and do
 * not change a frontend inputData shape without updating this file.
 *
 * This is the backend's integrity boundary for point provenance: knowing a
 * pointId is real and accessible is not enough — a caller could submit
 * inputData for point B while claiming a pointReferences entry for point A.
 * routes/calculations.js uses resolveClaimedCoordinates() to pull out
 * whatever numeric x/y the submitted inputData actually claims for a given
 * role, then compares that against the real SurveyPoint's coordinates
 * before ever storing a referencedPoints snapshot.
 */

// Fixed-role tools: each role maps to exactly one x/y field pair.
const FIXED_ROLE_FIELDS = {
  'first-basic-task': {
    station: { xField: 'x1', yField: 'y1' },
  },
  'second-basic-task': {
    point1: { xField: 'x1', yField: 'y1' },
    point2: { xField: 'x2', yField: 'y2' },
  },
  'forward-intersection': {
    pointA: { xField: 'xA', yField: 'yA' },
    pointB: { xField: 'xB', yField: 'yB' },
  },
  resection: {
    pointA: { xField: 'xA', yField: 'yA' },
    pointB: { xField: 'xB', yField: 'yB' },
    pointC: { xField: 'xC', yField: 'yC' },
  },
  'polar-intersection': {
    pointA: { xField: 'xA', yField: 'yA' },
  },
  'hansen-task': {
    pointA: { xField: 'xA', yField: 'yA' },
    pointB: { xField: 'xB', yField: 'yB' },
  },
  'coordinate-transformation': {
    pointP: { xField: 'x', yField: 'y' },
  },
  'distance-bearing': {
    point1: { xField: 'x1', yField: 'y1' },
    point2: { xField: 'x2', yField: 'y2' },
  },
  'line-intersection': {
    pointA: { xField: 'x1', yField: 'y1' },
    pointB: { xField: 'x2', yField: 'y2' },
    pointC: { xField: 'x3', yField: 'y3' },
    pointD: { xField: 'x4', yField: 'y4' },
  },
  'offset-point': {
    pointA: { xField: 'xA', yField: 'yA' },
    pointB: { xField: 'xB', yField: 'yB' },
  },
  'segment-division': {
    pointA: { xField: 'xA', yField: 'yA' },
    pointB: { xField: 'xB', yField: 'yB' },
  },
};

// Dynamic-role tools: role is `${prefix}:${index}`, coordinates live inside
// an array field at inputData[arrayField][index][xField/yField].
// area-calculation's inputData is { points: [{x,y}, ...], method } — see
// AreaCalculation.js's parsePoints()/runWithTracking call.
const DYNAMIC_ROLE_TOOLS = {
  'area-calculation': {
    rolePrefix: 'vertex',
    arrayField: 'points',
    xField: 'x',
    yField: 'y',
  },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Resolves what x/y coordinates a given (toolName, role) claims within the
 * submitted inputData. Returns:
 *   { ok: true, x, y }
 *   { ok: false, reason: 'unknown_role' | 'input_missing' }
 */
function resolveClaimedCoordinates(toolName, role, inputData) {
  const fixed = FIXED_ROLE_FIELDS[toolName];
  if (fixed) {
    const spec = fixed[role];
    if (!spec) return { ok: false, reason: 'unknown_role' };
    const x = inputData?.[spec.xField];
    const y = inputData?.[spec.yField];
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false, reason: 'input_missing' };
    return { ok: true, x, y };
  }

  const dynamic = DYNAMIC_ROLE_TOOLS[toolName];
  if (dynamic) {
    const match = typeof role === 'string' && role.match(/^([a-zA-Z]+):(\d+)$/);
    if (!match || match[1] !== dynamic.rolePrefix) return { ok: false, reason: 'unknown_role' };
    const index = Number(match[2]);
    const arr = inputData?.[dynamic.arrayField];
    if (!Array.isArray(arr) || !arr[index]) return { ok: false, reason: 'input_missing' };
    const x = arr[index]?.[dynamic.xField];
    const y = arr[index]?.[dynamic.yField];
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false, reason: 'input_missing' };
    return { ok: true, x, y };
  }

  // Tool has no point-role map at all (e.g. scientific-calculator) — no
  // point reference can ever be valid for it.
  return { ok: false, reason: 'unknown_role' };
}

module.exports = { FIXED_ROLE_FIELDS, DYNAMIC_ROLE_TOOLS, resolveClaimedCoordinates };
