/**
 * GAI V1 user-facing terminology contract (V1.0.2). Single source of truth for how internal GeoSolver codes are
 * expressed to users and to the LLM: every label here is product-level professional Bulgarian, and an unknown code
 * NEVER falls back to the raw code itself (that is how internal vocabulary used to leak into prose).
 *
 * Wording deliberately matches what the rest of the product already shows (fieldProcessing/processRun.js and
 * processTraverse.js MESSAGES, the frontend's traverseView/reportLabels), so GAI never contradicts the UI.
 */
const { MESSAGES: TRAVERSE_MESSAGES } = require('../fieldProcessing/processTraverse');

/** Internal names that must never appear in provider-facing context or normal assistant prose (Section 2). */
const FORBIDDEN_PROVIDER_TERMS = [
  'CaptureJob', 'capture', 'legacyFieldBooks', 'FieldBook', 'FieldSession', 'fieldSessionId', 'FieldObservationSet', 'FieldProcessingRun',
  'SurveyPoint', 'processingType', 'needs_review', 'sourceType', 'sourceId', 'engineVersion', 'MongoDB',
  'ObjectId', '_id', 'projectId', 'captureJobId', 'processingRunId', 'fieldObservationSetId', 'generatedPointIds',
  'field-processing', 'field-notebook', 'coordinate-table', 'project-points-snapshot', 'field-processing-run',
  'XY_ONLY', 'KNOWN_ENDPOINT', 'CLOSED_LOOP', 'OPEN_TRAVERSE', 'PRISM_HEIGHT_MISSING', 'STATION_H_UNKNOWN',
  'POLAR_PROCESSING_REPORT', 'TRAVERSE_PROCESSING_REPORT', 'PROJECT_COORDINATE_LIST', 'CAPTURE_NEEDS_REVIEW',
  'NOTEBOOK_NOT_PROCESSED', 'linearMisclosure', 'relativeClosureDenominator', 'heightReason', 'pointCount',
];

const UNKNOWN_STATE = 'Неуточнено състояние';

const CAPTURE_STATUS = {
  uploaded: 'Качено', processing: 'В процес на разпознаване', needs_review: 'За проверка',
  confirmed: 'Потвърдено', failed: 'Неуспешно разпознаване',
};
const CAPTURE_MODE = { 'field-notebook': 'Полеви карнет', 'coordinate-table': 'Таблица с координати' };
const LEGACY_BOOK_TYPE = { coordinate: 'Координатен карнет', leveling: 'Нивелачен карнет' };
const PROCESSING_TYPE = { polar: 'Полярна обработка', traverse: 'Обработка на полигонов ход' };
const TRAVERSE_TYPE = {
  OPEN: 'Отворен полигонов ход', CLOSED_LOOP: 'Затворен полигонов ход',
  KNOWN_ENDPOINT: 'Полигонов ход с известна крайна точка',
};
const TRAVERSE_STATUS = { READY: 'Готов', PARTIAL: 'Частичен резултат', INVALID: 'Невалиден' };
const OBSERVATION_STATUS = {
  READY: 'Готово (X, Y и H)', XY_ONLY: 'Само X/Y (без кота)', WARNING: 'С предупреждение', ERROR: 'Невалидно',
};
const REPORT_TYPE = {
  POLAR_PROCESSING_REPORT: 'Отчет за полярна обработка',
  TRAVERSE_PROCESSING_REPORT: 'Отчет за обработка на полигонов ход',
  PROJECT_COORDINATE_LIST: 'Координатен регистър',
};
const VERTICAL_ANGLE_CONVENTION = { zenith: 'Зенитно разстояние', vertical: 'Вертикален ъгъл' };
const ISSUE_KIND = {
  CAPTURE_NEEDS_REVIEW: 'Заснемане със статус „За проверка“',
  NOTEBOOK_NOT_PROCESSED: 'Потвърдени теренни наблюдения без обработка',
  TRAVERSE_PARTIAL: 'Полигонов ход с частичен резултат',
  TRAVERSE_INVALID: 'Невалиден полигонов ход',
  TRAVERSE_OPEN_NO_CLOSURE: 'Отворен полигонов ход – няма независим контрол за затваряне (очаквано за този тип ход)',
  POLAR_HAS_ERRORS: 'Полярна обработка с невалидни цели',
  POLAR_XY_ONLY: 'Полярна обработка с цели без кота (само X/Y)',
};
/** What the deterministic issue extraction (gai/tools/issues.js) actually checks - so an empty result can be stated
 * with its real scope instead of as an unsupported "the project has no problems". */
const ISSUE_CATEGORIES_CHECKED = [
  'заснемания със статус „За проверка“ (сред заснеманията, качени от вас)',
  'потвърдени теренни наблюдения, които още не са обработени',
  'полигонови ходове с частичен или невалиден резултат',
  'отворени полигонови ходове без независим контрол за затваряне',
  'полярни обработки с невалидни цели или цели без кота',
];

/** Closure/adjustment reasons. OPEN_TRAVERSE is "not applicable by design"; every other reason is "unavailable". */
const CLOSURE_REASON = {
  OPEN_TRAVERSE: 'Отвореният полигонов ход няма независим контрол за затваряне.',
  ENDPOINT_NOT_REACHED: 'Ходът не достигна декларираната крайна точка.',
  INVALID_LEGS: 'Има невалидна отсечка в хода – невръзка не може да се определи.',
  END_NOT_RESOLVED: 'Крайната контролна точка не е намерена сред точките на проекта.',
  END_COORDINATES_UNKNOWN: 'Крайната контролна точка няма записани координати.',
  START_NOT_RESOLVED: 'Началната станция не е намерена сред точките на проекта.',
  NO_LEGS: 'Не бяха идентифицирани отсечки на хода.',
};

const MEASUREMENT_UNIT = { gon: 'gon', deg: '°', rad: 'rad', m: 'm', mm: 'mm', cm: 'cm' };

/** label(map, code) - the Bulgarian label, or a neutral phrase; never the raw internal code. */
function label(map, code, fallback = UNKNOWN_STATE) {
  return (code && Object.prototype.hasOwnProperty.call(map, code)) ? map[code] : fallback;
}

/** A persisted reason code -> its existing product message (processRun/processTraverse), never the raw code. */
function reasonMessage(code) {
  if (!code) return null;
  return CLOSURE_REASON[code] || TRAVERSE_MESSAGES[code] || 'Неуточнена причина.';
}

/** Europe/Sofia when the runtime has time-zone data; a runtime without it must not crash every GAI route at load. */
const DATE_PARTS = (() => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
})();
/** dd.mm.yyyy in Bulgarian local time (deterministic - not dependent on the server's locale). */
function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(DATE_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

/** "50.123 m" / "123.4567 gon" exactly as recorded in the confirmed field notebook - never converted. */
function formatMeasurement(m) {
  if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return null;
  return `${m.value} ${MEASUREMENT_UNIT[m.unit] || m.unit || ''}`.trim();
}

const pointLabel = (name) => `Точка ${name}`;

/** "Полигонов ход 101 → 107" / "Полярна обработка · ст. 101" - from a processing summary (tools/processing.js). */
function runLabel(summary) {
  if (!summary) return 'Обработка';
  if (summary.processingType === 'traverse') {
    const end = summary.end || summary.lastIdentifier;
    return end ? `Полигонов ход ${summary.start} → ${end}` : `Полигонов ход от ${summary.start}`;
  }
  const stations = (summary.stations || []).filter(Boolean);
  return stations.length ? `Полярна обработка · ст. ${stations.join(', ')}` : 'Полярна обработка';
}

/** "Полеви карнет · 22.09.2026" - a capture job's product label (mode + date). */
function captureLabel(mode, date) {
  const d = formatDate(date);
  const m = label(CAPTURE_MODE, mode, 'Заснемане');
  return d ? `${m} · ${d}` : m;
}

/** "Теренна сесия · 09.10.2026" - a Field Session's product label (its own title is user text, so the day is used). */
function sessionLabel(session) {
  const d = formatDate(session && (session.date ? `${session.date}T12:00:00Z` : session.createdAt));
  return d ? `Теренна сесия · ${d}` : 'Теренна сесия';
}

/** "Полеви карнет · страница 2" - which page of a multi-page notebook an observation was read from. */
function pageLabel(page) {
  return Number.isInteger(page) && page > 0 ? `Полеви карнет · страница ${page}` : 'Полеви карнет';
}

function observationSetLabel(confirmedAt) {
  const d = formatDate(confirmedAt);
  return d ? `Потвърдени теренни наблюдения · ${d}` : 'Потвърдени теренни наблюдения';
}

module.exports = {
  FORBIDDEN_PROVIDER_TERMS, ISSUE_CATEGORIES_CHECKED, UNKNOWN_STATE,
  CAPTURE_STATUS, CAPTURE_MODE, LEGACY_BOOK_TYPE, PROCESSING_TYPE, TRAVERSE_TYPE, TRAVERSE_STATUS,
  OBSERVATION_STATUS, REPORT_TYPE, VERTICAL_ANGLE_CONVENTION, ISSUE_KIND, CLOSURE_REASON,
  label, reasonMessage, formatDate, formatMeasurement, pointLabel, runLabel, captureLabel, sessionLabel, pageLabel, observationSetLabel,
};
