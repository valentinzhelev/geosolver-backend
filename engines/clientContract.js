/**
 * Client calculation contract — stale-client protection (ZERO SILENT DIVERGENCE).
 *
 * The frontend sends `clientContractVersion` with every professional save. It is a DIAGNOSTIC and a
 * compatibility gate only: mathematical authority is always the backend engine's version.
 *
 *   1 = implicit (no field): every browser built before the canonical engine.
 *   2 = Offset Point v2 (LEFT) + Resection v2 (directed clockwise angles) + authoritative overlay.
 *
 * A tool whose current engine version changed the MATH a client displays must appear in
 * REQUIRED_CLIENT_CONTRACT. A stale client would display the old result while the backend stores
 * the new one, so its save is rejected with CLIENT_REFRESH_REQUIRED instead of silently diverging.
 * The other tools keep accepting stale clients (their client-side math is unchanged).
 */

const CURRENT_CLIENT_CONTRACT_VERSION = 2;

const REQUIRED_CLIENT_CONTRACT = Object.freeze({
  'offset-point': 2,
  resection: 2,
});

/** A positive integer, or null when absent/invalid (treated as the implicit version 1). */
function parseClientContractVersion(value) {
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function checkClientContract(toolName, clientContractVersion) {
  const provided = parseClientContractVersion(clientContractVersion);
  const effective = provided === null ? 1 : provided;
  const required = REQUIRED_CLIENT_CONTRACT[toolName] || 1;
  if (effective >= required) return { ok: true, provided, effective, required };
  return {
    ok: false,
    code: 'CLIENT_REFRESH_REQUIRED',
    provided,
    effective,
    required,
    error: 'Версията на GeoSolver в този прозорец е остаряла за този инструмент. Моля, опреснете страницата (Ctrl+F5) и опитайте отново — изчислението не е запазено.',
  };
}

module.exports = { CURRENT_CLIENT_CONTRACT_VERSION, REQUIRED_CLIENT_CONTRACT, parseClientContractVersion, checkClientContract };
