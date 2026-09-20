/**
 * Server-side ground truth for generated classroom tasks (Milestone 2.1).
 *
 * The student receives each variant's FULL `inputData` (routes/studentAssignments.js strips only
 * `solution` and `solutionHash`), so a generator can never carry the answer inside inputData.
 * A TRUSTED generator (utils/templateTrust.js gate — untrusted scripts are never executed) may
 * return the exact known state under ONE reserved key. It is removed here, before anything is
 * stored or sent, and becomes the stored `solution`:
 *
 *   generator returns { ...measurementsShownToTheStudent, __groundTruth: { xP, yP } }
 *   -> inputData = the measurements only        -> stored in Assignment.variants[].inputData
 *   -> solution  = { xP, yP }                   -> stored server-side, never sent to students
 *
 * Any OTHER key starting with "__" is rejected (fail closed): a generator cannot smuggle hidden
 * data into a student-visible payload through a different name.
 */
const GROUND_TRUTH_KEY = '__groundTruth';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Splits a generator result into { inputData, groundTruth }. `groundTruth` is undefined when the
 * generator did not provide one (the template's solutionScript is then used, as before).
 */
function splitGroundTruth(generated) {
  if (!isPlainObject(generated)) return { inputData: generated, groundTruth: undefined };

  const reserved = Object.keys(generated).filter((key) => key.startsWith('__'));
  if (reserved.length === 0) return { inputData: generated, groundTruth: undefined };
  if (reserved.length !== 1 || reserved[0] !== GROUND_TRUTH_KEY) {
    throw new Error(`Generator returned an unsupported reserved key: ${reserved.filter((k) => k !== GROUND_TRUTH_KEY).join(', ')}`);
  }

  const truth = generated[GROUND_TRUTH_KEY];
  const entries = isPlainObject(truth) ? Object.entries(truth) : [];
  if (entries.length === 0 || !entries.every(([, v]) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('Generator ground truth must be a non-empty object of finite numbers');
  }

  const inputData = { ...generated };
  delete inputData[GROUND_TRUTH_KEY];
  return { inputData, groundTruth: Object.fromEntries(entries) };
}

module.exports = { GROUND_TRUTH_KEY, splitGroundTruth };
