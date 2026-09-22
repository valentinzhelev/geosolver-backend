/**
 * Deterministic angle parsing for Field Notebook observations (pure, no I/O).
 *
 * Supports the representations geodetic field notebooks actually use:
 *  - gon/grad, with an explicit suffix ("94.5000g", "94,5000 gon")
 *  - decimal degrees, with an explicit degree symbol ("94.5°")
 *  - DMS - degrees/minutes/seconds, with explicit symbols ("94°30'15\"", "94° 30'")
 *
 * The unit is NEVER guessed. A bare number with no symbol ("94.5000") is genuinely ambiguous between gon and
 * degrees and is reported as such UNLESS the column itself declares a unit (e.g. an observation header "Hz (gon)"
 * or "Hz (°)") - exactly the same "column context may resolve an otherwise-ambiguous cell" rule as
 * capture/numeric.js, never a silent default.
 *
 * Result: { status: 'ok'|'ambiguous'|'invalid'|'empty', value, unit: 'gon'|'deg'|null, components, reason }
 *   `value` is the normalized number IN ITS OWN UNIT SYSTEM (a gon reading stays a gon number): nothing here ever
 *   silently converts between gon and degrees. `components` is {deg,min,sec} for a DMS reading, otherwise null.
 */

const DEG = '[°ºo]'; // 'o' as a degree symbol is a common OCR/typewriter substitute, still an explicit marker
const MIN = "['′]";
const SEC = '["″]';
const NUM = '\\d{1,3}(?:[.,]\\d{1,4})?';

const FULL_DMS = new RegExp(`^([+-]?\\d{1,3})\\s*${DEG}\\s*(\\d{1,2}(?:[.,]\\d{1,3})?)\\s*${MIN}\\s*(\\d{1,2}(?:[.,]\\d{1,4})?)\\s*${SEC}?\\s*$`);
const DEG_MIN = new RegExp(`^([+-]?\\d{1,3})\\s*${DEG}\\s*(\\d{1,2}(?:[.,]\\d{1,4})?)\\s*${MIN}\\s*$`);
const DEG_ONLY = new RegExp(`^([+-]?${NUM})\\s*${DEG}\\s*$`);
const GON = new RegExp(`^([+-]?${NUM})\\s*(gon|grad|g)\\.?$`, 'i');
const BARE = new RegExp(`^([+-]?${NUM})$`);

const num = (s) => Number(String(s).replace(',', '.'));

const result = (status, extra = {}) => ({ status, value: null, unit: null, components: null, reason: null, ...extra });

/** A full-circle-bounds sanity check (0 <= |value| < one full turn). This is deliberately NOT a zenith/Hz-specific
 * geodetic convention (those vary by instrument and site): it only catches numbers that cannot be an angle at all. */
function inCircleBounds(value, unit) {
  const turn = unit === 'gon' ? 400 : 360;
  return Math.abs(value) < turn;
}

function finishDms(sign, deg, min, sec) {
  if (min >= 60) return result('invalid', { reason: 'MINUTES_OUT_OF_RANGE' });
  if (sec >= 60) return result('invalid', { reason: 'SECONDS_OUT_OF_RANGE' });
  const value = sign * (deg + min / 60 + sec / 3600);
  if (!inCircleBounds(deg, 'deg')) return result('invalid', { reason: 'ANGLE_OUT_OF_RANGE' });
  return result('ok', { value, unit: 'deg', components: { deg: sign * deg, min, sec } });
}

/**
 * @param {string} raw
 * @param {{columnUnit?: 'gon'|'deg'|null}} options
 */
function parseAngle(raw, options = {}) {
  const columnUnit = options.columnUnit || null;
  if (raw === null || raw === undefined) return result('empty', { reason: 'EMPTY' });
  const text = String(raw).trim();
  if (text === '') return result('empty', { reason: 'EMPTY' });

  let m = text.match(FULL_DMS);
  if (m) {
    const sign = m[1].startsWith('-') ? -1 : 1;
    return finishDms(sign, Math.abs(Number(m[1])), num(m[2]), num(m[3]));
  }
  m = text.match(DEG_MIN);
  if (m) {
    const sign = m[1].startsWith('-') ? -1 : 1;
    return finishDms(sign, Math.abs(Number(m[1])), num(m[2]), 0);
  }
  m = text.match(DEG_ONLY);
  if (m) {
    const value = num(m[1]);
    if (!inCircleBounds(value, 'deg')) return result('invalid', { reason: 'ANGLE_OUT_OF_RANGE' });
    return result('ok', { value, unit: 'deg', components: null });
  }
  m = text.match(GON);
  if (m) {
    const value = num(m[1]);
    if (!inCircleBounds(value, 'gon')) return result('invalid', { reason: 'ANGLE_OUT_OF_RANGE' });
    return result('ok', { value, unit: 'gon', components: null });
  }
  m = text.match(BARE);
  if (m) {
    const value = num(m[1]);
    if (!columnUnit) return result('ambiguous', { reason: 'AMBIGUOUS_ANGLE_UNIT', value });
    if (!inCircleBounds(value, columnUnit)) return result('invalid', { reason: 'ANGLE_OUT_OF_RANGE' });
    return result('ok', { value, unit: columnUnit, components: null });
  }
  return result('invalid', { reason: 'MALFORMED_ANGLE' });
}

/**
 * Infers a column's angle unit from its OWN unambiguous (non-bare) cells, exactly like numeric.js's column style.
 * @param {string[]} rawValues
 * @returns {{unit: 'gon'|'deg'|null, mixed: boolean}}
 */
function inferColumnAngleUnit(rawValues) {
  const units = new Set();
  for (const raw of rawValues) {
    const p = parseAngle(raw); // no columnUnit: only a cell that is unambiguous BY ITSELF counts
    if (p.status === 'ok' && p.unit) units.add(p.unit);
  }
  if (units.size === 1) return { unit: [...units][0], mixed: false };
  return { unit: null, mixed: units.size > 1 };
}

module.exports = { parseAngle, inferColumnAngleUnit, inCircleBounds };
