/**
 * Deterministic interpretation + validation of a MANUAL field session (pure, no I/O).
 *
 * The manual counterpart of capture/notebook/validation.js#evaluateNotebook and deliberately NOT a second
 * observation model: it parses with the same capture/notebook/angles.js and measurements.js, and its `setups`
 * output has exactly the shape evaluateNotebook produces for a Field Notebook, so a confirmed manual session and a
 * confirmed OCR notebook become the same FieldObservationSet evidence and run through the same processing engines.
 *
 * Nothing here calculates a geodetic value. Angles keep the unit they were entered in (an explicit unit wins, a
 * bare number takes the session's declared angle unit - a user DECISION, never a guess); distances/heights keep
 * their own unit (a bare number is meters, as for notebooks).
 *
 * Issues are located ({setup, section, row, field}) so the review screen can highlight the exact field, and carry
 * a fixed Bulgarian message. Severity 'error' blocks confirmation; 'warning' never does.
 */
const { parseAngle } = require('../capture/notebook/angles');
const { parseMeasurement } = require('../capture/notebook/measurements');
const { isBlankRow } = require('./entry');

const MESSAGES = {
  STATION_REQUIRED: 'Липсва идентификатор на станцията.',
  TARGET_REQUIRED: 'Липсва идентификатор на целта.',
  VALUE_REQUIRED: 'Липсва задължителна стойност.',
  DISTANCE_REQUIRED: 'Въведете наклонено или хоризонтално разстояние.',
  MALFORMED_ANGLE: 'Ъгълът не е разпознат като валидна стойност.',
  ANGLE_OUT_OF_RANGE: 'Ъгълът е извън възможния диапазон.',
  MINUTES_OUT_OF_RANGE: 'Минутите трябва да са под 60.',
  SECONDS_OUT_OF_RANGE: 'Секундите трябва да са под 60.',
  MALFORMED_DISTANCE: 'Стойността не е разпозната като валидно число.',
  NON_POSITIVE_DISTANCE: 'Разстоянието трябва да е по-голямо от нула.',
  NEGATIVE_HEIGHT: 'Височината не може да бъде отрицателна.',
  DUPLICATE_OBSERVATION: 'Повтарящо се наблюдение към същата цел в тази станция.',
  TARGET_IS_STATION: 'Целта съвпада със станцията.',
  COINCIDENT_ORIENTATION: 'Ориентирът съвпада със станцията.',
  MISSING_ORIENTATION: 'Няма зададена ориентация (заден пункт) за тази станция.',
  INCONSISTENT_ANGLE_UNIT: 'Ъгълът е в друга единица от избраната за сесията - проверете го.',
  DUPLICATE_STATION: 'Тази станция е заета повече от веднъж в сесията.',
  EMPTY_SETUP: 'Станцията няма наблюдения.',
  NO_OBSERVATIONS: 'Няма нито едно наблюдение.',
  STATION_NOT_FOUND: 'Станцията не е намерена сред точките на проекта - обработката няма да може да я използва.',
  STATION_AMBIGUOUS: 'Има повече от една точка с това име - уточнете коя е станцията.',
  STATION_COORDINATES_UNKNOWN: 'Станцията няма записани координати.',
  ORIENTATION_NOT_FOUND: 'Ориентирът не е намерен сред точките на проекта.',
  ORIENTATION_AMBIGUOUS: 'Има повече от една точка с това име - уточнете кой е ориентирът.',
  ORIENTATION_COORDINATES_UNKNOWN: 'Ориентирът няма записани координати.',
};

const norm = (s) => String(s || '').trim().toLowerCase();

function evaluateSession(session) {
  const angleUnit = session.angleUnit === 'deg' ? 'deg' : 'gon';
  const issues = [];
  const add = (severity, code, loc, extra = {}) => issues.push({ severity, code, message: MESSAGES[code], ...loc, ...extra });
  const err = (code, loc) => add('error', code, loc);
  const warn = (code, loc) => add('warning', code, loc);

  const angle = (raw, loc, { required }) => {
    const t = String(raw || '').trim();
    if (!t) { if (required) err('VALUE_REQUIRED', loc); return null; }
    const p = parseAngle(t, { columnUnit: angleUnit });
    if (p.status !== 'ok') {
      const code = ['MINUTES_OUT_OF_RANGE', 'SECONDS_OUT_OF_RANGE', 'ANGLE_OUT_OF_RANGE'].includes(p.reason) ? p.reason : 'MALFORMED_ANGLE';
      err(code, loc);
      return null;
    }
    if (p.unit !== angleUnit) warn('INCONSISTENT_ANGLE_UNIT', loc);
    return { value: p.value, unit: p.unit, components: p.components };
  };

  const measure = (raw, loc, { required, positive = false, nonNegative = false }) => {
    const t = String(raw || '').trim();
    if (!t) { if (required) err('VALUE_REQUIRED', loc); return null; }
    const p = parseMeasurement(t);
    if (p.status !== 'ok') { err('MALFORMED_DISTANCE', loc); return null; }
    if (positive && !(p.value > 0)) { err('NON_POSITIVE_DISTANCE', loc); return null; }
    if (nonNegative && p.value < 0) { err('NEGATIVE_HEIGHT', loc); return null; }
    return { value: p.value, unit: p.unit, explicit: p.explicit };
  };

  const importSetups = [];
  let observations = 0;
  const stationSeen = new Map();

  for (const s of session.setups || []) {
    const sLoc = (section, field, row) => ({ setup: s.index, section, field, ...(row === undefined ? {} : { row }) });
    const stationName = String(s.station.point || '').trim();
    if (!stationName) err('STATION_REQUIRED', sLoc('station', 'point'));
    else {
      const key = norm(stationName);
      stationSeen.set(key, (stationSeen.get(key) || 0) + 1);
    }
    const hi = measure(s.station.instrumentHeight, sLoc('station', 'instrumentHeight'), { required: false, nonNegative: true });

    // an orientation object with nothing in it is "no orientation" (the form always sends the empty pair)
    const o = s.orientation;
    const hasOrientation = !!o && (String(o.target || '').trim() !== '' || String(o.direction || '').trim() !== '');
    let orientationOut = null;
    if (hasOrientation) {
      const target = String(o.target || '').trim();
      if (!target) err('TARGET_REQUIRED', sLoc('orientation', 'target'));
      else if (stationName && norm(target) === norm(stationName)) err('COINCIDENT_ORIENTATION', sLoc('orientation', 'target'));
      const direction = angle(o.direction, sLoc('orientation', 'direction'), { required: false });
      orientationOut = { target: target || null, direction };
    }

    const rows = (s.observations || []).filter((r) => !isBlankRow(r));
    const targetRows = new Map();
    const importRows = [];
    for (const r of rows) {
      const loc = (field) => sLoc('observation', field, r.row);
      const before = issues.length;
      const target = String(r.target || '').trim();
      if (!target) err('TARGET_REQUIRED', loc('target'));
      else {
        if (stationName && norm(target) === norm(stationName)) err('TARGET_IS_STATION', loc('target'));
        (targetRows.get(norm(target)) || targetRows.set(norm(target), []).get(norm(target))).push(r.row);
      }
      const hz = angle(r.hz, loc('hz'), { required: true });
      const vz = angle(r.vz, loc('vz'), { required: false });
      const distance = measure(r.distance, loc('distance'), { required: false, positive: true });
      const horizontalDistance = measure(r.horizontalDistance, loc('horizontalDistance'), { required: false, positive: true });
      if (!String(r.distance || '').trim() && !String(r.horizontalDistance || '').trim()) err('DISTANCE_REQUIRED', loc('distance'));
      const prismHeight = measure(r.prismHeight, loc('prismHeight'), { required: false, nonNegative: true });

      observations += 1;
      const rowErrors = issues.slice(before).some((i) => i.severity === 'error');
      if (!rowErrors) {
        importRows.push({
          row: r.row, target, hz, vz, distance, horizontalDistance, prismHeight,
          code: String(r.code || '').trim(), notes: String(r.notes || '').trim(), cells: {},
        });
      }
    }
    for (const [, rowIds] of targetRows) {
      if (rowIds.length > 1) for (const id of rowIds) err('DUPLICATE_OBSERVATION', sLoc('observation', 'target', id));
    }

    if (rows.length && !hasOrientation) warn('MISSING_ORIENTATION', sLoc('station', 'orientation'));
    if (!rows.length) warn('EMPTY_SETUP', sLoc('station', 'point'));

    importSetups.push({
      index: s.index,
      station: { point: stationName || null, instrumentHeight: hi, notes: String(s.station.notes || '').trim() },
      orientation: orientationOut,
      observations: importRows,
    });
  }

  for (const [key, n] of stationSeen) {
    if (n > 1) {
      const dup = (session.setups || []).filter((s) => norm(s.station.point) === key);
      for (const s of dup) warn('DUPLICATE_STATION', { setup: s.index, section: 'station', field: 'point' });
    }
  }
  if (observations === 0) err('NO_OBSERVATIONS', { setup: null, section: 'session', field: null });

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const summary = { setups: (session.setups || []).length, observations, errors, warnings, canConfirm: errors === 0 && observations > 0 };
  return { issues, summary, setups: importSetups };
}

/**
 * Project-reference warnings (async part, given pre-fetched points): the station and orientation of each setup
 * should exist, uniquely and with coordinates, among the project's SurveyPoints - the same name-only,
 * case-insensitive matching fieldProcessing/pointResolution.js applies. Warnings only: confirming evidence does
 * not depend on them (they are processing preconditions), but the review screen must say so up front.
 * @param {object[]} setups session setups (raw)
 * @param {{name:string,x:number|null,y:number|null}[]} points the project's points
 */
function referenceIssues(setups, points) {
  const byName = new Map();
  for (const p of points) {
    const k = norm(p.name);
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  // A station that another setup OBSERVES, or a backsight that is another setup's station, is a point the session
  // itself derives (a traverse), not a control point that must already exist - so only unexplained references warn.
  const observedTargets = new Set();
  const stations = new Set();
  for (const s of setups) {
    if (s.station.point) stations.add(norm(s.station.point));
    for (const o of s.observations || []) if (o.target) observedTargets.add(norm(o.target));
  }
  const issues = [];
  const check = (name, prefix, loc, derivedFrom) => {
    const t = String(name || '').trim();
    if (!t) return;
    const matches = byName.get(norm(t)) || [];
    if (matches.length === 0 && derivedFrom.has(norm(t))) return;
    const add = (code) => issues.push({ severity: 'warning', code, message: MESSAGES[code], ...loc });
    if (matches.length === 0) add(`${prefix}_NOT_FOUND`);
    else if (matches.length > 1) add(`${prefix}_AMBIGUOUS`);
    else if (typeof matches[0].x !== 'number' || typeof matches[0].y !== 'number') add(`${prefix}_COORDINATES_UNKNOWN`);
  };
  for (const s of setups) {
    check(s.station.point, 'STATION', { setup: s.index, section: 'station', field: 'point' }, observedTargets);
    if (s.orientation) check(s.orientation.target, 'ORIENTATION', { setup: s.index, section: 'orientation', field: 'target' }, stations);
  }
  return issues;
}

module.exports = { evaluateSession, referenceIssues, MESSAGES };
