/**
 * Drift telemetry. Deliberately minimal (no new logging subsystem): one structured line.
 * It carries the tool, the engine version, the client contract version and the differing FIELD
 * NAMES with their difference magnitudes — never raw survey coordinates or any input/result value.
 */
function logClientMismatch({ toolName, engineVersion, clientContractVersion, fields }) {
  const line = {
    event: 'calculation.client_mismatch',
    toolName,
    engineVersion,
    clientContractVersion: clientContractVersion === null || clientContractVersion === undefined ? null : clientContractVersion,
    fields: fields.map((f) => ({ field: f.field, difference: typeof f.difference === 'number' ? f.difference : null, kind: f.kind })),
  };
  console.warn(JSON.stringify(line));
  return line;
}

module.exports = { logClientMismatch };
