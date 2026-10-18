/**
 * Instrument Import (V1: Leica GSI) configuration. Versions are stamped on every import record and on the evidence a confirmed
 * import produces, so a historical import is always re-read under the exact rules that produced it. Limits are configurable and
 * never unbounded: an instrument export is a few hundred kilobytes at most - anything far larger is not a field file.
 */
const int = (name, fallback, max) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
};

function getConfig() {
  return {
    parserVersion: 'leica-gsi-parser/v1',
    normalizerVersion: 'leica-gsi-normalize/v1',
    validationVersion: 'leica-gsi-validate/v1',
    limits: {
      maxBytes: int('INSTRUMENT_IMPORT_MAX_BYTES', 512 * 1024, 8 * 1024 * 1024),
      maxLines: int('INSTRUMENT_IMPORT_MAX_LINES', 10000, 100000),
      maxRecords: int('INSTRUMENT_IMPORT_MAX_RECORDS', 3000, 50000),
      maxSetups: int('INSTRUMENT_IMPORT_MAX_SETUPS', 60, 1000),
      maxLineLength: 1024,
      maxFileNameLength: 120,
    },
  };
}

module.exports = { getConfig };
