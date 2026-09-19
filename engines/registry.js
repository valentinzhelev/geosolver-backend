/**
 * Canonical engine registry, keyed by (toolName, engineVersion).
 *
 * This is the ONE dispatch point for professional geodetic calculations, and the ONLY source
 * of engine versions: utils/engineVersions.js is a thin view over currentVersions(), so a
 * Calculation can never be stamped with a version whose engine did not compute it.
 *
 * Historical engines that can be recomputed safely stay registered (offset-point v1). Resection
 * v1 is intentionally NOT registered — its noise-dependent solver is never used as a verifier;
 * see legacyVerification.js.
 */

const MODULES = [
  require('./tools/firstBasicTask'),
  require('./tools/secondBasicTask'),
  require('./tools/forwardIntersection'),
  require('./tools/resection'),
  require('./tools/polarIntersection'),
  require('./tools/coordinateTransformation'),
  require('./tools/hansenTask'),
  require('./tools/areaCalculation'),
  require('./tools/distanceBearing'),
  require('./tools/lineIntersection'),
  require('./tools/offsetPoint'),
  require('./tools/segmentDivision'),
];

// Explicit, reviewed table — never inferred from "the highest version registered".
const CURRENT_VERSION = Object.freeze({
  'first-basic-task': 1,
  'second-basic-task': 1,
  'forward-intersection': 1,
  resection: 2,
  'polar-intersection': 1,
  'coordinate-transformation': 1,
  'hansen-task': 1,
  'area-calculation': 1,
  'distance-bearing': 1,
  'line-intersection': 1,
  'offset-point': 2,
  'segment-division': 1,
});

const ENGINES = new Map(); // toolName -> Map(version -> engine)
for (const mod of MODULES) {
  for (const engine of mod.engines) {
    if (!ENGINES.has(engine.toolName)) ENGINES.set(engine.toolName, new Map());
    const versions = ENGINES.get(engine.toolName);
    if (versions.has(engine.version)) {
      throw new Error(`Duplicate engine ${engine.toolName} v${engine.version}`);
    }
    versions.set(engine.version, engine);
  }
}

for (const [toolName, version] of Object.entries(CURRENT_VERSION)) {
  if (!ENGINES.has(toolName) || !ENGINES.get(toolName).has(version)) {
    throw new Error(`Current engine ${toolName} v${version} is not registered`);
  }
}
for (const toolName of ENGINES.keys()) {
  if (!(toolName in CURRENT_VERSION)) throw new Error(`Engine ${toolName} has no declared current version`);
}

/** The engine for an exact (toolName, version), or null. */
function getEngine(toolName, version) {
  const versions = ENGINES.get(toolName);
  return (versions && versions.get(version)) || null;
}

/** The engine every NEW calculation of this tool is computed with, or null (e.g. scientific-calculator). */
function getCurrentEngine(toolName) {
  return Object.prototype.hasOwnProperty.call(CURRENT_VERSION, toolName) ? getEngine(toolName, CURRENT_VERSION[toolName]) : null;
}

const hasEngine = (toolName) => ENGINES.has(toolName);
const currentVersions = () => ({ ...CURRENT_VERSION });
const listTools = () => Object.keys(CURRENT_VERSION);
const listVersions = (toolName) => (ENGINES.has(toolName) ? [...ENGINES.get(toolName).keys()].sort((a, b) => a - b) : []);

module.exports = { getEngine, getCurrentEngine, hasEngine, currentVersions, listTools, listVersions };
