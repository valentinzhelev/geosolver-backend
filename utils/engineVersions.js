/**
 * Provenance/version labels for persisted geodetic calculation engines,
 * keyed by Calculation.toolName. This is a label recorded alongside a
 * result, NOT proof that the backend recomputed or verified the math —
 * the actual calculation always happens client-side in domain/geodesy
 * (GEOSOLVER.BG). Bump a tool's version here only when its formula or
 * validation rules genuinely change, so historical rows stay distinguishable
 * from rows produced by different logic.
 *
 * 'scientific-calculator' is intentionally absent — it is a general
 * mathjs expression evaluator, not a geodetic engine, and does not gain
 * server persistence as part of this milestone.
 */
const ENGINE_VERSIONS = {
  'first-basic-task': 1,
  'second-basic-task': 1,
  'forward-intersection': 1,
  // v2 (Milestone 2.0C): directed CLOCKWISE angles at P (beta1 = P->A to P->B, beta2 = P->B to P->C,
  // 0 < beta < 400 gon), deterministic circle-intersection solver, structured rejection of duplicate /
  // collinear / danger-circle / inconsistent / ill-conditioned input. v1 (unsigned angles, Tienstra with
  // angle/complement candidate search) is HISTORICAL: v1 rows are not rewritten and must be verified by a
  // consistency check, never by re-running v2.
  resection: 2,
  'polar-intersection': 1,
  'coordinate-transformation': 1,
  'hansen-task': 1,
  'area-calculation': 1,
  'distance-bearing': 1,
  'line-intersection': 1,
  // v2 (Milestone 2.0B): positive d = LEFT of A->B (X north, Y east). v1 = the earlier,
  // shipped RIGHT-side behavior; v1 rows/results are historical and are not rewritten.
  'offset-point': 2,
  'segment-division': 1,
};

/** Returns the current engine version for a toolName, or null if unknown/not a versioned engine. */
function getEngineVersion(toolName) {
  return Object.prototype.hasOwnProperty.call(ENGINE_VERSIONS, toolName)
    ? ENGINE_VERSIONS[toolName]
    : null;
}

/**
 * True for the professional geodetic tools that may be saved into a Project.
 * Derived from the engine-version map so there is a single list: anything
 * without a versioned engine (i.e. scientific-calculator) is not a Project
 * calculation.
 */
function isProjectCapableTool(toolName) {
  return Object.prototype.hasOwnProperty.call(ENGINE_VERSIONS, toolName);
}

module.exports = { ENGINE_VERSIONS, getEngineVersion, isProjectCapableTool };
