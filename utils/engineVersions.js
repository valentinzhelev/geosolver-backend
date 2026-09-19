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
  resection: 1,
  'polar-intersection': 1,
  'coordinate-transformation': 1,
  'hansen-task': 1,
  'area-calculation': 1,
  'distance-bearing': 1,
  'line-intersection': 1,
  'offset-point': 1,
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
