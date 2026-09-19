/**
 * Engine versions per Calculation.toolName — a THIN VIEW over the canonical engine registry
 * (engines/registry.js). It holds no independent table, so a version can never drift from the
 * engine that is actually dispatched: POST /api/calculations stamps engineVersion from the engine
 * it computed with, and this module only mirrors the registry's current versions for readers.
 *
 * Meaning of a version (since the canonical engine): the backend computed that row's resultData
 * with exactly that engine version (resultAuthority: 'server'). Rows created before the canonical
 * engine carry a version that was only a label attached to a client-computed result.
 *
 * 'scientific-calculator' is intentionally absent — it is a general mathjs expression evaluator,
 * not a geodetic engine, and has no engine or version.
 */
const registry = require('../engines/registry');

const ENGINE_VERSIONS = Object.freeze(registry.currentVersions());

/** Returns the current engine version for a toolName, or null if it is not a versioned engine. */
function getEngineVersion(toolName) {
  return Object.prototype.hasOwnProperty.call(ENGINE_VERSIONS, toolName)
    ? ENGINE_VERSIONS[toolName]
    : null;
}

/**
 * True for the professional geodetic tools that may be saved into a Project — every tool with a
 * canonical engine. Anything without one (i.e. scientific-calculator) is not a Project calculation.
 */
function isProjectCapableTool(toolName) {
  return Object.prototype.hasOwnProperty.call(ENGINE_VERSIONS, toolName);
}

module.exports = { ENGINE_VERSIONS, getEngineVersion, isProjectCapableTool };
