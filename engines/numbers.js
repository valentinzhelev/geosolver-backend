const { EngineError } = require('./errors');

// Canonical decimal notation only. This is the subset of Number() semantics that can never
// invent a value: "12abc" (parseFloat would give 12), "", "  ", "0x10", "Infinity", "1,5" are
// all rejected instead of being coerced. A JSON number passes through unchanged.
const DECIMAL_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Normalizes one numeric input field to a finite Number.
 *  - finite JSON numbers are kept as they are (never rounded);
 *  - canonical decimal strings are converted with Number() — this is what repairs the legacy
 *    Forward Intersection string-shaped inputData;
 *  - everything else is a structured error.
 */
function toFiniteNumber(value, field) {
  if (value === undefined || value === null) {
    throw new EngineError('MISSING_FIELD', `Липсва стойност за „${field}“`, field);
  }
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!DECIMAL_STRING.test(trimmed)) {
      throw new EngineError('INVALID_NUMBER', `Полето „${field}“ трябва да е валидно число`, field);
    }
    n = Number(trimmed);
  } else {
    throw new EngineError('INVALID_NUMBER', `Полето „${field}“ трябва да е валидно число`, field);
  }
  if (!Number.isFinite(n)) {
    throw new EngineError('INVALID_NUMBER', `Полето „${field}“ трябва да е валидно число`, field);
  }
  return n;
}

/** Same operation and operation order as the frontend's domain/math/roundTo. */
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = { toFiniteNumber, roundTo, DECIMAL_STRING };
