/**
 * Report-display Bulgarian labels. Reason-code messages are NOT reinvented here - they reuse the exact same
 * fixed text the Field Processing API already returns to the frontend (fieldProcessing/processTraverse.js#MESSAGES
 * already merges fieldProcessing/processRun.js's own MESSAGES in, so importing it alone covers both polar and
 * traverse reason codes), keeping the report and the live UI in sync from one source of truth.
 */
const { MESSAGES: REASON_MESSAGES } = require('../fieldProcessing/processTraverse');

const OBSERVATION_STATUS_LABEL = {
  READY: 'Готово',
  XY_ONLY: 'Само X/Y',
  WARNING: 'Предупреждение',
  ERROR: 'Невалидно',
};
const RUN_STATUS_LABEL = {
  READY: 'Готов',
  PARTIAL: 'Частичен резултат',
  INVALID: 'Невалиден',
};
const TRAVERSE_TYPE_LABEL = {
  CLOSED_LOOP: 'Затворен ход',
  KNOWN_ENDPOINT: 'Ход с известна крайна точка',
  OPEN: 'Отворен ход',
};

const observationStatusLabel = (status) => OBSERVATION_STATUS_LABEL[status] || status;
const runStatusLabel = (status) => RUN_STATUS_LABEL[status] || status;
const traverseTypeLabel = (type) => TRAVERSE_TYPE_LABEL[type] || type;
const reasonMessage = (code) => (code ? (REASON_MESSAGES[code] || code) : '');

module.exports = { observationStatusLabel, runStatusLabel, traverseTypeLabel, reasonMessage };
