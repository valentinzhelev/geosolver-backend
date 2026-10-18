/**
 * Field Session (Теренна сесия) configuration. `version` is stamped on the FieldObservationSet a manual session
 * produces (as `notebookVersion`), so evidence is always attributable to the exact entry/validation rules that
 * confirmed it - the same role capture's notebookValidationVersion plays for OCR-confirmed evidence.
 */
const pageLimit = () => {
  const n = Number(process.env.FIELD_SESSION_MAX_PAGES);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 15;
};

function getConfig() {
  return {
    version: 'field-session-1.0.0',
    // the page-merge rules (fieldSessions/pageMerge.js) that produced a capture-backed session's confirmed evidence
    mergeVersion: 'field-session-merge-1.0.0',
    angleUnits: ['gon', 'deg'],
    limits: {
      maxSetups: 60,
      maxObservationsPerSetup: 400,
      maxObservationsTotal: 3000,
      maxFieldLength: 200,
      maxNotesLength: 2000,
      maxTitleLength: 120,
      // notebook pages (CaptureJobs) per session: each page is its own upload + OCR call and its own review, so the cap is
      // about provider cost and review usability, not storage. Configurable, never unbounded.
      maxPages: pageLimit(),
    },
  };
}

module.exports = { getConfig };
