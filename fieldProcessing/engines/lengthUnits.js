/**
 * Deterministic length-unit conversion for Field Processing (pure, no I/O). Every engine works in METRES; this
 * converts a KNOWN unit (as capture/notebook/measurements.js already normalized and stored on the confirmed
 * FieldObservationSet - 'm', 'cm' or 'mm') into metres. Never guessed.
 */
const FACTORS = { m: 1, cm: 1 / 100, mm: 1 / 1000 };

/** @param {number} value @param {'m'|'cm'|'mm'} unit @returns {number} the value in metres */
function toMeters(value, unit) {
  if (!Object.prototype.hasOwnProperty.call(FACTORS, unit)) throw new Error(`toMeters: unknown length unit "${unit}"`);
  return value * FACTORS[unit];
}

module.exports = { toMeters };
