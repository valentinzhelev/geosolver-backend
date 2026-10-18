/**
 * Instrument Import (V1: Leica GSI) - the pure pipeline. No I/O, no LLM, no geodetic calculation:
 *
 *   bytes -> safe text (text.js) -> format detection (gsiDetect) -> records (gsiParser) -> setups + issues (gsiNormalize)
 *
 * `readInstrumentFile` runs once, at upload: it refuses a file that is not confidently Leica GSI (a structured
 * InstrumentImportError, never a parser exception) and returns the normalized LINES - the immutable snapshot an import stores.
 * `reviewInstrumentImport` re-reads that stored snapshot with the user's current decisions; it is deterministic, so the review the
 * user saw and the evidence confirmation writes are produced by the very same function from the very same input.
 */
const { decodeText } = require('./text');
const { detectGsi } = require('./leica/gsiDetect');
const { parseGsi } = require('./leica/gsiParser');
const { normalizeGsi } = require('./leica/gsiNormalize');
const { InstrumentImportError } = require('./errors');
const { getConfig } = require('./config');

const FORMATS = ['GSI-8', 'GSI-16'];

function enforceLimits(records) {
  const { limits } = getConfig();
  if (records.length > limits.maxRecords) throw new InstrumentImportError('TOO_MANY_RECORDS');
  if (records.filter((r) => r.kind === 'station').length > limits.maxSetups) throw new InstrumentImportError('TOO_MANY_SETUPS');
}

/** @param {Buffer} buffer @returns {{vendor:'leica', format:'GSI-8'|'GSI-16', sha256:string, bytes:number, lines:{n:number,text:string,truncated:boolean}[]}} */
function readInstrumentFile(buffer) {
  const { lines, sha256, bytes } = decodeText(buffer);
  const { vendor, format } = detectGsi(lines);
  enforceLimits(parseGsi(lines, format));
  return { vendor, format, sha256, bytes, lines };
}

/** @param {{format:string, lines:object[]}} snapshot a stored import @param {object} decisions see gsiNormalize */
function reviewInstrumentImport(snapshot, decisions = {}) {
  if (!FORMATS.includes(snapshot.format)) throw new InstrumentImportError('UNSUPPORTED_FORMAT');
  const records = parseGsi(snapshot.lines || [], snapshot.format);
  enforceLimits(records);
  const { parserVersion, normalizerVersion, validationVersion } = getConfig();
  return { format: snapshot.format, versions: { parserVersion, normalizerVersion, validationVersion }, ...normalizeGsi(records, decisions) };
}

module.exports = { readInstrumentFile, reviewInstrumentImport, FORMATS };
