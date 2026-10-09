/**
 * Field Session (Теренна сесия) configuration. `version` is stamped on the FieldObservationSet a manual session
 * produces (as `notebookVersion`), so evidence is always attributable to the exact entry/validation rules that
 * confirmed it - the same role capture's notebookValidationVersion plays for OCR-confirmed evidence.
 */
function getConfig() {
  return {
    version: 'field-session-1.0.0',
    angleUnits: ['gon', 'deg'],
    limits: {
      maxSetups: 60,
      maxObservationsPerSetup: 400,
      maxObservationsTotal: 3000,
      maxFieldLength: 200,
      maxNotesLength: 2000,
      maxTitleLength: 120,
    },
  };
}

module.exports = { getConfig };
