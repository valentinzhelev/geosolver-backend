/**
 * Deterministic interpretation + validation of a reconstructed Field Notebook (pure, no I/O).
 *
 * Mirrors capture/validation.js's contract exactly (never mutates rawText/userValue, derives `normalizedValue`
 * from the effective text, attaches issues, severities 'ok'|'warning'|'error'), but for stations/orientations/
 * observations instead of a coordinate-table grid. Reuses capture/arbitration.js for every numeric/identifier
 * field via a pluggable value-comparison function, so uncertain-cell re-recognition and consensus-based trust
 * decisions work identically to coordinate tables (capture/rerecognition.js runs upstream, unaware of the mode).
 */
const { parseAngle, inferColumnAngleUnit } = require('./angles');
const { parseMeasurement } = require('./measurements');
const { angleUnitHint } = require('./headers');
const { arbitrateCell } = require('../arbitration');

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

const MESSAGES = {
  STATION_REQUIRED: 'Липсва идентификатор на станцията.',
  TARGET_REQUIRED: 'Липсва идентификатор на целта.',
  VALUE_REQUIRED: 'Липсва задължителна стойност.',
  MALFORMED_ANGLE: 'Ъгълът не е разпознат като валидна стойност.',
  AMBIGUOUS_ANGLE_UNIT: 'Не е ясно дали ъгълът е в градуси или гони - въведете го ръчно или уточнете заглавието на колоната.',
  ANGLE_OUT_OF_RANGE: 'Ъгълът е извън възможния диапазон.',
  MINUTES_OUT_OF_RANGE: 'Минутите трябва да са под 60.',
  SECONDS_OUT_OF_RANGE: 'Секундите трябва да са под 60.',
  MALFORMED_DISTANCE: 'Стойността не е разпозната като валидно число.',
  DUPLICATE_OBSERVATION: 'Повтарящо се наблюдение към същата цел в тази станция.',
  INCONSISTENT_ANGLE_UNIT: 'В тази станция се смесват градуси и гони - проверете колоната.',
  MIXED_DISTANCE_UNIT: 'В тази станция се смесват различни мерни единици за разстояние.',
  MISSING_ORIENTATION: 'Няма зададена ориентация (заден пункт) за тази станция.',
  MISSING_COLUMN: 'Не е зададена колона за задължително поле в таблицата с наблюдения.',
  DUPLICATE_COLUMN_MAPPING: 'Повече от една колона е зададена за едно и също поле.',
  RECOGNITION_UNCERTAIN: 'Разпознаването не е достатъчно сигурно - въведете стойността ръчно или изберете разчитане.',
  RECOGNITION_INVALID: 'Разпознаването не изглежда надеждно - въведете стойността ръчно.',
  RECOGNITION_REVIEW_SUGGESTED: 'Има разминаване между няколко разчитания на тази клетка - проверете стойността.',
  NO_OBSERVATIONS: 'Не са намерени наблюдения.',
};

const effectiveText = (cell) => (cell && cell.userValue !== null && cell.userValue !== undefined ? String(cell.userValue) : (cell ? cell.rawText || '' : ''));
const isBlank = (s) => String(s || '').trim() === '';
const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const issue = (code, severity, message, extra = {}) => ({ code, severity, message, ...extra });

function resetCell(cell) {
  cell.normalizedValue = null;
  cell.validation = { status: 'ok', issues: [] };
}
function addIssue(cell, is) {
  cell.validation.issues.push(is);
  if (is.severity === 'error') cell.validation.status = 'error';
  else if (is.severity === 'warning' && cell.validation.status !== 'error') cell.validation.status = 'warning';
}
const isEdited = (cell) => cell.userValue !== null && cell.userValue !== undefined;

/** arbitration value-comparator for an angle field: groups candidates by (unit, value), never guesses the unit. */
function angleParseValue(candidate, semantic, columnUnit) {
  const p = parseAngle(candidate.text, { columnUnit });
  if (p.status !== 'ok') return { key: null, status: p.status, display: candidate.text };
  return { key: `${p.unit}:${Math.round(p.value * 1e6) / 1e6}`, status: 'ok', display: p.value };
}
/** arbitration value-comparator for a measurement field: groups candidates by (unit, value). */
function measurementParseValue(candidate, semantic, columnStyle) {
  const p = parseMeasurement(candidate.text, { columnStyle });
  if (p.status !== 'ok') return { key: null, status: p.status, display: candidate.text };
  return { key: `${p.unit}:${Math.round(p.value * 1e6) / 1e6}`, status: 'ok', display: p.value };
}

/** Runs arbitration on a field cell and turns a non-ACCEPTED outcome into a validation issue (skipped once edited). */
function applyArbitration(cell, semantic, ctx, opts) {
  const result = arbitrateCell(cell, { semantic, tracked: true, numericStyle: ctx, numericLike: opts.numericLike, parseValue: opts.parseValue, ...opts.thresholds });
  cell.arbitration = result;
  if (!result || isEdited(cell)) return;
  if (result.outcome === 'UNCERTAIN') addIssue(cell, issue('RECOGNITION_UNCERTAIN', 'error', MESSAGES.RECOGNITION_UNCERTAIN, { reason: result.reason }));
  else if (result.outcome === 'INVALID' && cell.validation.status !== 'error') addIssue(cell, issue('RECOGNITION_INVALID', 'error', MESSAGES.RECOGNITION_INVALID, { reason: result.reason }));
  else if (result.outcome === 'REVIEW_SUGGESTED') addIssue(cell, issue('RECOGNITION_REVIEW_SUGGESTED', 'warning', MESSAGES.RECOGNITION_REVIEW_SUGGESTED, { reason: result.reason }));
}

function evaluateAngleField(cell, { required, columnUnit, thresholds }) {
  resetCell(cell);
  const text = effectiveText(cell);
  if (isBlank(text)) {
    if (required) addIssue(cell, issue('VALUE_REQUIRED', 'error', MESSAGES.VALUE_REQUIRED));
    applyArbitration(cell, 'angle', columnUnit, { numericLike: true, parseValue: angleParseValue, thresholds });
    return null;
  }
  const p = parseAngle(text, { columnUnit });
  if (p.status === 'ambiguous') addIssue(cell, issue('AMBIGUOUS_ANGLE_UNIT', 'error', MESSAGES.AMBIGUOUS_ANGLE_UNIT));
  else if (p.status === 'invalid') addIssue(cell, issue(p.reason === 'MINUTES_OUT_OF_RANGE' ? 'MINUTES_OUT_OF_RANGE' : p.reason === 'SECONDS_OUT_OF_RANGE' ? 'SECONDS_OUT_OF_RANGE' : p.reason === 'ANGLE_OUT_OF_RANGE' ? 'ANGLE_OUT_OF_RANGE' : 'MALFORMED_ANGLE', 'error', MESSAGES[p.reason] || MESSAGES.MALFORMED_ANGLE));
  else if (p.status === 'ok') cell.normalizedValue = p.value;
  applyArbitration(cell, 'angle', columnUnit, { numericLike: true, parseValue: angleParseValue, thresholds });
  return p.status === 'ok' ? { value: p.value, unit: p.unit, components: p.components } : null;
}

function evaluateMeasurementField(cell, { required, columnStyle, thresholds }) {
  resetCell(cell);
  const text = effectiveText(cell);
  if (isBlank(text)) {
    if (required) addIssue(cell, issue('VALUE_REQUIRED', 'error', MESSAGES.VALUE_REQUIRED));
    applyArbitration(cell, 'measurement', columnStyle, { numericLike: true, parseValue: measurementParseValue, thresholds });
    return null;
  }
  const p = parseMeasurement(text, { columnStyle });
  if (p.status !== 'ok') addIssue(cell, issue('MALFORMED_DISTANCE', 'error', MESSAGES.MALFORMED_DISTANCE));
  else {
    // the assumed-meters default (see capture/notebook/measurements.js) is NOT flagged as a review issue: it is
    // the documented, expected convention for the overwhelming majority of real observations (nobody writes "m"
    // after every distance) - `explicit` still records it on the value itself for any future consumer to inspect.
    cell.normalizedValue = p.value;
  }
  applyArbitration(cell, 'measurement', columnStyle, { numericLike: true, parseValue: measurementParseValue, thresholds });
  return p.status === 'ok' ? { value: p.value, unit: p.unit, explicit: p.explicit } : null;
}

function evaluateIdentifierField(cell, { required, code, thresholds }) {
  resetCell(cell);
  const text = cleanText(effectiveText(cell));
  cell.normalizedValue = text || null;
  if (!text && required) addIssue(cell, issue(code, 'error', MESSAGES[code] || MESSAGES.VALUE_REQUIRED));
  applyArbitration(cell, 'target', null, { thresholds });
  return text || null;
}

const fieldAt = (row, field) => (row.cols.find((c) => c.field === field) ? row.cells[row.cols.findIndex((c) => c.field === field)] : null);

/**
 * @param {object} notebook reconstructed notebook (see capture/notebook/reconstruct.js)
 * @param {{confidenceThreshold?: number, arbitration?: object}} options
 * @returns {{notebook: object, summary: object, setups: object[]}} `setups` is the import-ready structure (only
 *   meaningful when summary.canConfirm)
 */
function evaluateNotebook(notebook, options = {}) {
  const thresholds = options.arbitration || {};
  const nb = structuredClone(notebook);
  nb.issues = [];
  const summary = { setups: nb.setups.length, observations: 0, ready: 0, review: 0, invalid: 0, excluded: 0, errors: 0, warnings: 0, tableErrors: 0, tableWarnings: 0, canConfirm: false };
  const importSetups = [];

  for (const setup of nb.setups) {
    setup.issues = [];

    const stationName = evaluateIdentifierField(setup.station.point, { required: true, code: 'STATION_REQUIRED', thresholds });
    const hi = evaluateMeasurementField(setup.station.instrumentHeight, { required: false, columnStyle: null, thresholds });
    evaluateIdentifierField(setup.station.notes, { required: false, thresholds: {} });

    let orientationOut = null;
    if (setup.orientation) {
      const target = evaluateIdentifierField(setup.orientation.target, { required: true, code: 'TARGET_REQUIRED', thresholds });
      const direction = setup.orientation.direction ? evaluateAngleField(setup.orientation.direction, { required: false, columnUnit: null, thresholds }) : null;
      orientationOut = { target, direction };
    }

    // station/orientation field errors block the whole setup (a station or backsight that cannot even be
    // identified makes every observation under it meaningless), exactly like a missing required column does.
    const headerFieldCells = [setup.station.point, setup.station.instrumentHeight, setup.station.notes, ...(setup.orientation ? [setup.orientation.target, setup.orientation.direction].filter(Boolean) : [])];
    for (const c of headerFieldCells) {
      for (const is of c.validation.issues) {
        if (is.severity === 'error') summary.tableErrors += 1;
        else summary.tableWarnings += 1;
      }
    }

    // ---- column-level angle unit resolution (per setup, mirrors numeric.js's column-style inference) -----------
    const rawsOf = (field) => setup.observations.filter((o) => !o.excluded).map((o) => effectiveText(fieldAt(o, field))).filter((t) => t);
    const headerHintFor = (field) => {
      const col = setup.observations[0] && setup.observations[0].cols.find((c) => c.field === field);
      return col ? angleUnitHint(col.headerText) : null;
    };
    const resolveAngleUnit = (field) => {
      const hint = headerHintFor(field);
      if (hint) return hint;
      const { unit, mixed } = inferColumnAngleUnit(rawsOf(field));
      if (mixed) setup.issues.push(issue('INCONSISTENT_ANGLE_UNIT', 'warning', MESSAGES.INCONSISTENT_ANGLE_UNIT, { field }));
      return unit;
    };
    const hzUnit = resolveAngleUnit('hz');
    const vzUnit = resolveAngleUnit('vz');

    // suspicious mixed distance units (explicit units differing within the same setup's distance column)
    const distanceUnits = new Set();
    for (const o of setup.observations) {
      if (o.excluded) continue;
      const raw = effectiveText(fieldAt(o, 'distance'));
      if (!raw) continue;
      const p = parseMeasurement(raw);
      if (p.status === 'ok' && p.explicit) distanceUnits.add(p.unit);
    }
    if (distanceUnits.size > 1) setup.issues.push(issue('MIXED_DISTANCE_UNIT', 'warning', MESSAGES.MIXED_DISTANCE_UNIT));

    // ---- observation column mapping (mirrors coordinate-table's MISSING_COLUMN / DUPLICATE_COLUMN_MAPPING) -----
    const cols = setup.observations.length ? setup.observations[0].cols : [];
    if (setup.observations.length) {
      const byField = {};
      for (const c of cols) if (c.field) (byField[c.field] = byField[c.field] || []).push(c.index);
      for (const req of ['target', 'hz', 'distance']) {
        if (!byField[req]) setup.issues.push(issue('MISSING_COLUMN', 'error', MESSAGES.MISSING_COLUMN, { field: req }));
      }
      for (const [field, idxs] of Object.entries(byField)) {
        if (idxs.length > 1) setup.issues.push(issue('DUPLICATE_COLUMN_MAPPING', 'error', MESSAGES.DUPLICATE_COLUMN_MAPPING, { field, cols: idxs }));
      }
    }

    // ---- observations ---------------------------------------------------------------------------------------
    const targetNames = new Map();
    const importObservations = [];
    for (const row of setup.observations) {
      if (row.excluded) {
        row.status = 'excluded';
        continue;
      }
      const anyContent = row.cells.some((c) => !isBlank(effectiveText(c)));
      if (!anyContent) {
        row._skip = true;
        continue;
      }
      const target = fieldAt(row, 'target') && evaluateIdentifierField(fieldAt(row, 'target'), { required: true, code: 'TARGET_REQUIRED', thresholds });
      if (target) {
        const key = target.toLowerCase();
        (targetNames.get(key) || targetNames.set(key, []).get(key)).push(fieldAt(row, 'target'));
      }
      const hzCell = fieldAt(row, 'hz');
      const hz = hzCell && evaluateAngleField(hzCell, { required: true, columnUnit: hzUnit, thresholds });
      const vzCell = fieldAt(row, 'vz');
      const vz = vzCell && evaluateAngleField(vzCell, { required: false, columnUnit: vzUnit, thresholds });
      const distCell = fieldAt(row, 'distance');
      const distance = distCell && evaluateMeasurementField(distCell, { required: true, columnStyle: null, thresholds });
      const hDistCell = fieldAt(row, 'horizontalDistance');
      const horizontalDistance = hDistCell && evaluateMeasurementField(hDistCell, { required: false, columnStyle: null, thresholds });
      const prismCell = fieldAt(row, 'prismHeight');
      const prismHeight = prismCell && evaluateMeasurementField(prismCell, { required: false, columnStyle: null, thresholds });
      const codeCell = fieldAt(row, 'code');
      const code = codeCell && evaluateIdentifierField(codeCell, { required: false, thresholds: {} });
      const notesCell = fieldAt(row, 'notes');
      const notes = notesCell && evaluateIdentifierField(notesCell, { required: false, thresholds: {} });

      row._parsed = { target, hz, vz, distance, horizontalDistance, prismHeight, code, notes };
      importObservations.push(row);
    }
    for (const cells of targetNames.values()) {
      if (cells.length > 1) cells.forEach((c) => addIssue(c, issue('DUPLICATE_OBSERVATION', 'error', MESSAGES.DUPLICATE_OBSERVATION)));
    }

    // ---- setup-level summary ---------------------------------------------------------------------------------
    if (importObservations.length && !setup.orientation) setup.issues.push(issue('MISSING_ORIENTATION', 'warning', MESSAGES.MISSING_ORIENTATION));
    for (const is of setup.issues) {
      if (is.severity === 'error') summary.tableErrors += 1;
      else summary.tableWarnings += 1;
    }

    const setupImportRows = [];
    for (const row of importObservations) {
      const statuses = row.cells.map((c) => c.validation.status);
      const errors = row.cells.reduce((n, c) => n + c.validation.issues.filter((i) => i.severity === 'error').length, 0);
      const warnings = row.cells.reduce((n, c) => n + c.validation.issues.filter((i) => i.severity === 'warning').length, 0);
      summary.errors += errors;
      summary.warnings += warnings;
      row.status = statuses.includes('error') ? 'error' : statuses.includes('warning') ? 'warning' : 'ok';
      summary.observations += 1;
      if (row.status === 'error') summary.invalid += 1;
      else if (row.status === 'warning') summary.review += 1;
      else summary.ready += 1;
      if (row.status !== 'error') {
        setupImportRows.push({
          row: row.index,
          target: row._parsed.target,
          hz: row._parsed.hz,
          vz: row._parsed.vz,
          distance: row._parsed.distance,
          horizontalDistance: row._parsed.horizontalDistance,
          prismHeight: row._parsed.prismHeight,
          code: row._parsed.code || '',
          notes: row._parsed.notes || '',
          cells: Object.fromEntries(
            ['target', 'hz', 'vz', 'distance', 'horizontalDistance', 'prismHeight', 'code', 'notes']
              .map((f) => [f, fieldAt(row, f)])
              .filter(([, c]) => c && c.bbox && !c.bbox.synthetic)
              .map(([f, c]) => [f, { col: c.col, page: c.page, bbox: c.bbox }])
          ),
        });
      }
    }
    const excludedCount = setup.observations.filter((o) => o.excluded).length;
    summary.excluded += excludedCount;

    importSetups.push({
      index: setup.index,
      station: { point: stationName, instrumentHeight: hi, notes: setup.station.notes.normalizedValue || '' },
      orientation: orientationOut,
      observations: setupImportRows,
    });

    for (const row of setup.observations) {
      delete row._skip;
      delete row._parsed;
      row.skipped = row.cells.every((c) => isBlank(effectiveText(c)));
      if (row.excluded) row.status = 'excluded';
    }
  }

  if (summary.observations === 0) nb.issues.push(issue('NO_OBSERVATIONS', 'error', MESSAGES.NO_OBSERVATIONS));
  for (const is of nb.issues) {
    if (is.severity === 'error') summary.tableErrors += 1;
    else summary.tableWarnings += 1;
  }
  summary.canConfirm = summary.tableErrors === 0 && summary.invalid === 0 && summary.observations > 0;

  return { notebook: nb, summary, setups: importSetups };
}

/** UI review state of one field cell: invalid | review | edited | accepted (mirrors capture/validation.js). */
function fieldReviewState(cell) {
  const status = cell.validation && cell.validation.status;
  if (status === 'error') return 'invalid';
  if (status === 'warning') return 'review';
  if (cell.userValue !== null && cell.userValue !== undefined) return 'edited';
  return 'accepted';
}

module.exports = { evaluateNotebook, fieldReviewState, effectiveText, MESSAGES, DEFAULT_CONFIDENCE_THRESHOLD };
