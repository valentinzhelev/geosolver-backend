/**
 * Field Processing engine registry, keyed by (toolName, engineVersion) - the SAME dispatch pattern as the
 * interactive calculator's canonical registry (engines/registry.js), deliberately kept as a SEPARATE registry: the
 * two product domains never share a toolName/version table, and engines/registry.js itself is untouched (CLAUDE.md:
 * "Do NOT modify the Canonical Calculation Engine").
 */
const MODULES = [
  require('./tools/orientationConstant'),
  require('./tools/polarHorizontal'),
  require('./tools/polarHeightZenith'),
  require('./tools/polarHeightVertical'),
  require('./tools/heightCombination'),
  require('./tools/traverseDirection'),
  require('./tools/traversePropagation'),
  require('./tools/traverseClosure'),
  require('./tools/traverseBowditch'),
];

const CURRENT_VERSION = Object.freeze({
  'orientation-constant': 1,
  'polar-horizontal': 1,
  'polar-height-zenith': 1,
  'polar-height-vertical': 1,
  'height-combination': 1,
  'traverse-direction': 1,
  'traverse-propagation': 1,
  'traverse-closure': 1,
  'traverse-bowditch': 1,
});

const ENGINES = new Map();
for (const mod of MODULES) {
  for (const engine of mod.engines) {
    if (!ENGINES.has(engine.toolName)) ENGINES.set(engine.toolName, new Map());
    const versions = ENGINES.get(engine.toolName);
    if (versions.has(engine.version)) throw new Error(`Duplicate field-processing engine ${engine.toolName} v${engine.version}`);
    versions.set(engine.version, engine);
  }
}
for (const [toolName, version] of Object.entries(CURRENT_VERSION)) {
  if (!ENGINES.has(toolName) || !ENGINES.get(toolName).has(version)) {
    throw new Error(`Current field-processing engine ${toolName} v${version} is not registered`);
  }
}
for (const toolName of ENGINES.keys()) {
  if (!(toolName in CURRENT_VERSION)) throw new Error(`Field-processing engine ${toolName} has no declared current version`);
}

function getEngine(toolName, version) {
  const versions = ENGINES.get(toolName);
  return (versions && versions.get(version)) || null;
}
function getCurrentEngine(toolName) {
  return Object.prototype.hasOwnProperty.call(CURRENT_VERSION, toolName) ? getEngine(toolName, CURRENT_VERSION[toolName]) : null;
}
const currentVersions = () => ({ ...CURRENT_VERSION });

module.exports = { getEngine, getCurrentEngine, currentVersions };
