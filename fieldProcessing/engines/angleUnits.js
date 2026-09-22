/**
 * Deterministic angle-unit conversion for Field Processing (pure, no I/O).
 *
 * GeoSolver's official coordinate/angle convention (unchanged, see CLAUDE.md and capture/notebook/angles.js):
 *   X = Northing, Y = Easting, bearing/direction clockwise from +X, 0 gon = North, 100 gon = East.
 *
 * Processing NEVER infers an angle's unit - capture/notebook already resolved that at review time (a
 * FieldObservationSet only ever contains an observation whose angle has an explicit `unit`, 'gon' or 'deg';
 * capture/notebook/validation.js blocks confirmation of anything still ambiguous). This module only converts a
 * KNOWN unit into gon (the internal working unit for every field-processing engine) and normalizes into [0, 400).
 */
const FULL_TURN_GON = 400;

/** @param {number} deg @returns {number} the same angle in gon (400 gon = 360 deg = one full turn) */
function degToGon(deg) {
  return (deg * FULL_TURN_GON) / 360;
}

/** @param {number} gon @returns {number} the same angle in decimal degrees */
function gonToDeg(gon) {
  return (gon * 360) / FULL_TURN_GON;
}

/**
 * @param {number} value
 * @param {'gon'|'deg'} unit a KNOWN unit - never guessed here (see module doc)
 * @returns {number} the value converted to gon (NOT normalized to [0,400) - see normalizeGon)
 */
function toGon(value, unit) {
  if (unit === 'gon') return value;
  if (unit === 'deg') return degToGon(value);
  throw new Error(`toGon: unknown angle unit "${unit}"`);
}

/** Normalizes a gon value deterministically into [0, 400). */
function normalizeGon(gon) {
  const wrapped = gon % FULL_TURN_GON;
  return wrapped < 0 ? wrapped + FULL_TURN_GON : wrapped;
}

const gonToRad = (gon) => (gon * Math.PI) / 200;

module.exports = { FULL_TURN_GON, degToGon, gonToDeg, toGon, normalizeGon, gonToRad };
