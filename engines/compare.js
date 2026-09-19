/**
 * Per-field numeric comparison of a client's advisory resultData against the authoritative server
 * resultData. Never compares JSON strings and never rejects a save — the server value always wins.
 *
 * Approved tolerances:
 *   rounded field   (decimals = n): one rounding step 10^-n plus a relative 1e-9 term
 *   unrounded field (decimals null): absolute 1e-6 plus a relative 1e-9 term
 * The rounding step matters: engines can differ in the last bit of sin/cos and flip a rounding boundary.
 */
function compareResultData(engine, serverResult, clientResult) {
  if (!clientResult || typeof clientResult !== 'object' || Array.isArray(clientResult)) {
    return { status: 'not_provided', fields: [] };
  }
  const fields = [];
  for (const [field, decimals] of engine.persisted) {
    const server = serverResult[field];
    const client = clientResult[field];
    if (decimals === 'string') {
      if (client !== server) fields.push({ field, kind: 'value' });
      continue;
    }
    if (typeof client !== 'number' || !Number.isFinite(client)) {
      fields.push({ field, kind: 'missing_or_invalid' });
      continue;
    }
    const base = typeof decimals === 'number' ? Math.pow(10, -decimals) : 1e-6;
    const tolerance = base + 1e-9 * Math.abs(server);
    const difference = Math.abs(client - server);
    if (difference > tolerance) fields.push({ field, kind: 'value', difference });
  }
  return { status: fields.length ? 'mismatch' : 'match', fields };
}

module.exports = { compareResultData };
