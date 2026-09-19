/**
 * Canonical Calculation Engine — public API. Pure: no Express, no database. Everything a route (or,
 * later, a Capture/OCR pipeline) needs to normalize, validate and compute professional geodetic
 * calculations without going through HTTP.
 *
 *   const { getCurrentEngine } = require('./engines');
 *   const engine = getCurrentEngine('first-basic-task');
 *   const input = engine.normalizeAndValidate(rawInput);   // structured EngineError on failure
 *   const { resultData, engineVersion } = engine.run(rawInput);
 */
const registry = require('./registry');
const { EngineError, isEngineError } = require('./errors');
const { checkClientContract, parseClientContractVersion, CURRENT_CLIENT_CONTRACT_VERSION, REQUIRED_CLIENT_CONTRACT } = require('./clientContract');
const { compareResultData } = require('./compare');
const { logClientMismatch } = require('./telemetry');
const { verifyLegacyCalculation, describeStrategy } = require('./legacyVerification');

module.exports = {
  ...registry,
  EngineError,
  isEngineError,
  checkClientContract,
  parseClientContractVersion,
  CURRENT_CLIENT_CONTRACT_VERSION,
  REQUIRED_CLIENT_CONTRACT,
  compareResultData,
  logClientMismatch,
  verifyLegacyCalculation,
  describeStrategy,
};
