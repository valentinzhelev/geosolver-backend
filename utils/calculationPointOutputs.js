/**
 * Explicit allow-list: which professional tools produce exactly ONE point-like
 * coordinate result, and which persisted resultData fields hold it.
 * Verified against each calculator's actual getResultData(...) in
 * GEOSOLVER.BG/src/components/tasks/*.js (Milestone 1.1). Do not infer
 * coordinates from arbitrary fields — a tool not listed here cannot be saved
 * as a point. Scalar tools (second-basic-task, distance-bearing,
 * area-calculation) and scientific-calculator are intentionally absent.
 *
 * The values are the STORED Calculation.resultData — never recomputed — so a
 * point created later still reflects the historical computation record.
 */
const POINT_OUTPUT_FIELDS = {
  'first-basic-task': { xField: 'x2', yField: 'y2' },
  'forward-intersection': { xField: 'xP', yField: 'yP' },
  resection: { xField: 'xP', yField: 'yP' },
  'polar-intersection': { xField: 'xP', yField: 'yP' },
  'hansen-task': { xField: 'xP', yField: 'yP' },
  'coordinate-transformation': { xField: 'xTransformed', yField: 'yTransformed' },
  'line-intersection': { xField: 'xI', yField: 'yI' },
  'offset-point': { xField: 'xP', yField: 'yP' },
  'segment-division': { xField: 'xP', yField: 'yP' },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPointProducingTool(toolName) {
  return Object.prototype.hasOwnProperty.call(POINT_OUTPUT_FIELDS, toolName);
}

/**
 * Returns { ok: true, x, y } or { ok: false, reason: 'unsupported_tool' | 'result_missing' }.
 */
function extractPointResult(toolName, resultData) {
  if (!isPointProducingTool(toolName)) return { ok: false, reason: 'unsupported_tool' };
  const spec = POINT_OUTPUT_FIELDS[toolName];
  const x = resultData?.[spec.xField];
  const y = resultData?.[spec.yField];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false, reason: 'result_missing' };
  return { ok: true, x, y };
}

module.exports = { POINT_OUTPUT_FIELDS, isPointProducingTool, extractPointResult };
