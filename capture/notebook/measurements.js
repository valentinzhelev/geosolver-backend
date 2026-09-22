/**
 * Deterministic distance/height parsing for Field Notebook observations (pure, no I/O).
 *
 * Reuses capture/numeric.js's number parser for the digits, but with a domain-appropriate difference from
 * coordinate parsing: a SINGLE dot or comma in a distance/height is always its decimal separator, never a
 * thousands group. Coordinates like "4.700.000,25" genuinely need that ambiguity check because "4.700" could be
 * 4700 (thousands-grouped) or 4.7 - but no field-notebook slope distance, instrument height or prism height is
 * ever written "1.500" to mean "1500": that scale simply does not occur in these fields. This is the SECOND (and
 * last) documented convention this module makes. A genuine thousands group - rare, for a long traverse leg - is
 * still only ever a SPACE/apostrophe separator or a repeated dot/comma, exactly like capture/numeric.js already
 * handles unambiguously; those forms are delegated to it as-is.
 *
 * The FIRST documented convention (see parseMeasurement) is the unit itself: no unit written at all -> meters,
 * always flagged `explicit: false` so it is never mistaken for a real reading of the notebook.
 */
const { parseNumericCell } = require('../numeric');

const UNIT_MAP = {
  m: 'm', meter: 'm', metre: 'm', meters: 'm', metres: 'm', м: 'm', метра: 'm', метър: 'm', метри: 'm',
  cm: 'cm', см: 'cm', mm: 'mm', мм: 'mm',
};
const UNIT_SUFFIX = new RegExp(`\\s*(${Object.keys(UNIT_MAP).join('|')})\\.?$`, 'i');

const result = (status, extra = {}) => ({ status, value: null, unit: null, explicit: false, format: null, reason: null, ...extra });

/** Splits a trailing explicit unit off the text, if any. */
function splitUnit(text) {
  const m = text.match(UNIT_SUFFIX);
  if (m) {
    const candidate = text.slice(0, m.index).trim();
    if (candidate !== '') return { numPart: candidate, unit: UNIT_MAP[m[1].toLowerCase()] };
  }
  return { numPart: text, unit: null };
}

/** The measurement-domain number parser: see the module doc for why a lone separator is always decimal here. */
function parseMeasurementNumber(numPart, columnStyle) {
  if (columnStyle) return parseNumericCell(numPart, columnStyle); // an explicit override, e.g. for future column inference
  const dots = (numPart.match(/\./g) || []).length;
  const commas = (numPart.match(/,/g) || []).length;
  if (dots === 1 && commas === 0) return parseNumericCell(numPart, { decimalSep: '.' });
  if (commas === 1 && dots === 0) return parseNumericCell(numPart, { decimalSep: ',' });
  return parseNumericCell(numPart); // 0 separators, or an already-unambiguous space/apostrophe/repeated form
}

/**
 * @param {string} raw
 * @param {{columnStyle?: object|null, defaultUnit?: 'm'|'cm'|'mm'}} options
 */
function parseMeasurement(raw, options = {}) {
  const { columnStyle = null, defaultUnit = 'm' } = options;
  if (raw === null || raw === undefined) return result('empty', { reason: 'EMPTY' });
  const text = String(raw).trim();
  if (text === '') return result('empty', { reason: 'EMPTY' });

  const { numPart, unit } = splitUnit(text);
  const p = parseMeasurementNumber(numPart, columnStyle);
  if (p.status !== 'ok') return result(p.status, { reason: p.reason });
  if (unit) return result('ok', { value: p.value, unit, explicit: true, format: p.format });
  return result('ok', { value: p.value, unit: defaultUnit, explicit: false, format: p.format });
}

module.exports = { parseMeasurement, splitUnit, UNIT_MAP };
