/**
 * Manual field entry: sanitising and normalising what a client sends (pure, no I/O).
 *
 * A session's `setups` keep the user's RAW TEXT per field ("123.4567", "94°30'15\"", "1,52") - exactly like a
 * notebook cell's userValue - and all interpretation happens server-side in fieldSessions/evaluate.js through the
 * SAME angle/measurement parsers the Capture notebook uses. The client never supplies parsed numbers, units or
 * authority. Unknown keys are dropped (allow-list), strings are control-char stripped and length capped, and the
 * structure is bounded so a malformed or hostile body cannot grow a document without limit.
 */
const { FieldSessionError } = require('./errors');
const { getConfig } = require('./config');

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const OBSERVATION_FIELDS = ['target', 'hz', 'vz', 'distance', 'horizontalDistance', 'prismHeight', 'code', 'notes'];

function text(value, max) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new FieldSessionError('INVALID_REQUEST');
  const s = String(value).replace(CONTROL, '').replace(/\r?\n/g, ' ').trim();
  if (s.length > max) throw new FieldSessionError('INVALID_REQUEST');
  return s;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Keeps a client-chosen non-negative integer id if unique, otherwise assigns max+1 (ids stay stable across saves). */
function assignIds(items, key) {
  const used = new Set();
  const out = [];
  for (const it of items) {
    const v = it[key];
    if (Number.isInteger(v) && v >= 0 && v < 1e9 && !used.has(v)) { used.add(v); out.push(v); } else out.push(null);
  }
  let next = used.size ? Math.max(...used) + 1 : 0;
  return out.map((v) => (v === null ? next++ : v));
}

/**
 * @param {unknown} input client `setups`
 * @returns {object[]} normalised raw setups, in the order given
 */
function normalizeSetups(input) {
  const { limits } = getConfig();
  if (!Array.isArray(input)) throw new FieldSessionError('INVALID_REQUEST');
  if (input.length > limits.maxSetups) throw new FieldSessionError('INVALID_REQUEST');

  let total = 0;
  const shaped = input.map((raw) => {
    if (!isObj(raw)) throw new FieldSessionError('INVALID_REQUEST');
    const station = isObj(raw.station) ? raw.station : {};
    const observationsIn = raw.observations === undefined ? [] : raw.observations;
    if (!Array.isArray(observationsIn) || observationsIn.length > limits.maxObservationsPerSetup) throw new FieldSessionError('INVALID_REQUEST');
    total += observationsIn.length;
    if (total > limits.maxObservationsTotal) throw new FieldSessionError('INVALID_REQUEST');

    const orientationIn = isObj(raw.orientation) ? raw.orientation : null;
    const orientation = orientationIn
      ? { target: text(orientationIn.target, limits.maxFieldLength), direction: text(orientationIn.direction, limits.maxFieldLength) }
      : null;

    const rowIds = assignIds(observationsIn.map((o) => (isObj(o) ? o : {})), 'row');
    const observations = observationsIn.map((o, i) => {
      if (!isObj(o)) throw new FieldSessionError('INVALID_REQUEST');
      const out = { row: rowIds[i] };
      for (const f of OBSERVATION_FIELDS) out[f] = text(o[f], f === 'notes' ? limits.maxNotesLength : limits.maxFieldLength);
      return out;
    });

    return {
      index: raw.index,
      station: {
        point: text(station.point, limits.maxFieldLength),
        instrumentHeight: text(station.instrumentHeight, limits.maxFieldLength),
        notes: text(station.notes, limits.maxNotesLength),
      },
      orientation,
      observations,
    };
  });

  const setupIds = assignIds(shaped, 'index');
  return shaped.map((s, i) => ({ ...s, index: setupIds[i] }));
}

/** Optional session metadata (all optional - never mandatory unless mathematically required). */
function normalizeMetadata(input = {}) {
  const { limits, angleUnits } = getConfig();
  const out = {};
  const str = (key, max) => { if (input[key] !== undefined) out[key] = text(input[key], max); };
  str('title', limits.maxTitleLength);
  str('operator', limits.maxFieldLength);
  str('instrument', limits.maxFieldLength);
  str('instrumentSerial', limits.maxFieldLength);
  str('conditions', limits.maxFieldLength);
  str('notes', limits.maxNotesLength);
  if (input.date !== undefined) {
    const d = text(input.date, 10);
    if (d !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new FieldSessionError('INVALID_REQUEST');
    if (d !== '' && Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new FieldSessionError('INVALID_REQUEST');
    out.date = d;
  }
  if (input.angleUnit !== undefined) {
    if (!angleUnits.includes(input.angleUnit)) throw new FieldSessionError('INVALID_REQUEST');
    out.angleUnit = input.angleUnit;
  }
  return out;
}

/** True when every raw field of an observation row is empty (such rows are ignored, never counted or flagged). */
const isBlankRow = (o) => OBSERVATION_FIELDS.every((f) => String(o[f] || '').trim() === '');

module.exports = { normalizeSetups, normalizeMetadata, isBlankRow, OBSERVATION_FIELDS };
