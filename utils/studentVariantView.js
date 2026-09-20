/**
 * Student-facing view of stored Assignment variants.
 *
 * Generators may carry server-side data under reserved "__" keys (e.g. __groundTruth, see
 * utils/taskGroundTruth.js). Those are split off before storage, so a stored variant should never hold
 * one — but a student must not depend on that: every student-visible variant projection goes through
 * this module, which removes ANY key starting with "__" at any depth (fail closed) and never copies
 * solution / solutionHash.
 *
 * Teacher / admin responses are NOT filtered: they already receive the full assignment (including the
 * solutions) by design, and no reserved key is ever stored.
 */

const RESERVED_PREFIX = '__';

function stripReservedKeys(value) {
  if (Array.isArray(value)) return value.map(stripReservedKeys);
  if (value && typeof value === 'object') {
    const plain = typeof value.toObject === 'function' ? value.toObject() : value;
    const out = {};
    for (const key of Object.keys(plain)) {
      if (key.startsWith(RESERVED_PREFIX)) continue;
      out[key] = stripReservedKeys(plain[key]);
    }
    return out;
  }
  return value;
}

function toStudentVariants(variants) {
  return (variants || []).map((variant) => ({
    variantIndex: variant.variantIndex,
    inputData: stripReservedKeys(variant.inputData),
  }));
}

// Submitted answers are stored as sent; drop reserved keys so forged internal metadata is never persisted.
// (Grading only ever reads the keys of the server-held solution, so such keys were never trusted either.)
function sanitizeStudentAnswers(answers) {
  return stripReservedKeys(answers);
}

module.exports = { stripReservedKeys, toStudentVariants, sanitizeStudentAnswers };
