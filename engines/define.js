const { EngineError } = require('./errors');
const { toFiniteNumber, roundTo } = require('./numbers');

function assertPlainObject(raw, field = 'inputData') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EngineError('INVALID_INPUT_DATA', `„${field}“ трябва да е обект`, field);
  }
}

/** Default normalizer: keeps ONLY the listed fields, each as a finite Number; unknown fields are dropped. */
function normalizeNumericFields(raw, fields) {
  assertPlainObject(raw);
  const out = {};
  for (const field of fields) out[field] = toFiniteNumber(raw[field], field);
  return out;
}

/**
 * Builds one immutable, versioned canonical engine (toolName, version).
 *
 *   normalize(raw)   -> normalized input (numbers, enums; unknown fields stripped; NEVER rounds inputs)
 *   validate(input)  -> throws EngineError for every input-only rule (ranges, coincidence, degeneracy)
 *   compute(input)   -> full result (may throw EngineError for solve-dependent failures)
 *   format(full)     -> persisted resultData, exactly the shipped per-tool contract (rounding included)
 *
 * `persisted` is [[field, decimals]] where decimals is a number (rounded), null (full precision) or
 * 'string' (kept as is). It mirrors engines/fixtures/persistedContracts.json and is tested against it.
 * Pure: no Express, no database — Capture/OCR can call normalize/validate/compute directly.
 */
function defineEngine({ toolName, version, displayName, inputKeys, fields, normalize, validate, compute, persisted }) {
  const doNormalize = normalize || ((raw) => normalizeNumericFields(raw, fields));

  function format(full) {
    const out = {};
    for (const [field, decimals] of persisted) {
      const value = full[field];
      if (decimals === 'string') {
        out[field] = value;
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new EngineError('NON_FINITE_RESULT', 'Изчислението не води до крайно число', field);
      }
      out[field] = typeof decimals === 'number' ? roundTo(value, decimals) : value;
    }
    return out;
  }

  const engine = {
    toolName,
    version,
    displayName,
    inputKeys: inputKeys || fields,
    persisted,
    normalize: doNormalize,
    validate,
    compute,
    format,
    normalizeAndValidate(raw) {
      const input = doNormalize(raw);
      validate(input);
      return input;
    },
    run(raw) {
      const input = engine.normalizeAndValidate(raw);
      const full = compute(input);
      return { input, full, resultData: format(full), engineVersion: version };
    },
  };
  return Object.freeze(engine);
}

module.exports = { defineEngine, normalizeNumericFields, assertPlainObject };
