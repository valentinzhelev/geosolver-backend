/**
 * Field Processing orchestration (V2.4.1): a single polar setup (station + orientation/backsight + confirmed
 * observations) -> calculated target coordinates. Uses fieldProcessing/engines (deterministic, versioned) for
 * every formula and fieldProcessing/pointResolution.js for server-side station/orientation resolution - this
 * module only wires them together and decides, per observation, what could and could not be computed and why.
 *
 * `computeSetup` is PURE (no I/O) so the whole decision tree is testable without a database. `buildProcessingRun`
 * adds the async point-resolution step per setup, then a run-wide duplicate-target check.
 */
const { resolvePointByName } = require('./pointResolution');
const { getCurrentEngine, toGon, toMeters } = require('./engines');

const ENGINES = {
  orientation: getCurrentEngine('orientation-constant'),
  horizontal: getCurrentEngine('polar-horizontal'),
  zenith: getCurrentEngine('polar-height-zenith'),
  vertical: getCurrentEngine('polar-height-vertical'),
  combine: getCurrentEngine('height-combination'),
};

const MESSAGES = {
  STATION_MISSING: 'Станцията не е намерена сред точките на проекта.',
  STATION_AMBIGUOUS: 'Има повече от една точка с това име - уточнете коя е станцията.',
  ORIENTATION_MISSING: 'Ориентирът не е намерен сред точките на проекта.',
  ORIENTATION_AMBIGUOUS: 'Има повече от една точка с това име - уточнете кой е ориентирът.',
  NO_ORIENTATION_REFERENCE: 'Тази станция няма записана ориентация в полевата книжка.',
  STATION_COORDINATES_UNKNOWN: 'Станцията няма записани координати.',
  ORIENTATION_COORDINATES_UNKNOWN: 'Ориентирът няма записани координати.',
  COINCIDENT_STATION_ORIENTATION: 'Станцията и ориентирът съвпадат.',
  MISSING_TARGET: 'Липсва идентификатор на целта.',
  MISSING_HZ: 'Липсва хоризонтален ъгъл (Hz).',
  MISSING_DISTANCE: 'Липсва разстояние (нито хоризонтално, нито наклонено).',
  DISTANCE_REDUCTION_UNAVAILABLE: 'Има само наклонено разстояние, но липсва зенитен/вертикален ъгъл или конвенцията не е зададена - не може да се сведе до хоризонтално.',
  INVALID_GEOMETRY: 'Геометрията не е валидна.',
  STATION_H_UNKNOWN: 'Станцията няма записана кота.',
  INSTRUMENT_HEIGHT_MISSING: 'Липсва височина на инструмента.',
  PRISM_HEIGHT_MISSING: 'Липсва височина на призмата.',
  VERTICAL_ANGLE_MISSING: 'Липсва вертикален/зенитен ъгъл - котата не може да се изчисли.',
  VERTICAL_ANGLE_CONVENTION_UNKNOWN: 'Не е зададена конвенцията за вертикалния ъгъл (зенитно разстояние или вертикален ъгъл) - котата не може да се изчисли.',
  DUPLICATE_TARGET_NAME_IN_RUN: 'Тази цел се среща повече от веднъж в тази обработка - проверете преди да запазите точки.',
};
const issue = (code) => ({ code, message: MESSAGES[code] || code });

/** The observed Hz reading to the backsight, in gon - 0 (the "instrument zeroed on the backsight" convention)
 * when the notebook recorded no explicit direction, documented explicitly (never a silent numeric guess about an
 * unrelated value - this IS the standard meaning of an omitted backsight reading). */
function observedHzToBacksightGon(orientation) {
  if (!orientation || !orientation.direction) return 0;
  return toGon(orientation.direction.value, orientation.direction.unit);
}

/** Resolves the horizontal distance (metres) for one observation, or an error code explaining why it could not be. */
function resolveHorizontalDistance(observation, verticalAngleConvention) {
  if (observation.horizontalDistance) {
    return { ok: true, horizontalDistanceMeters: toMeters(observation.horizontalDistance.value, observation.horizontalDistance.unit), verticalRiseMeters: null };
  }
  if (!observation.distance) return { ok: false, code: 'MISSING_DISTANCE' };
  if (!observation.vz || !verticalAngleConvention) return { ok: false, code: 'DISTANCE_REDUCTION_UNAVAILABLE' };
  const slopeDistanceMeters = toMeters(observation.distance.value, observation.distance.unit);
  const vzGon = toGon(observation.vz.value, observation.vz.unit);
  const engine = verticalAngleConvention === 'zenith' ? ENGINES.zenith : ENGINES.vertical;
  const field = verticalAngleConvention === 'zenith' ? 'zenithGon' : 'verticalGon';
  try {
    const reduced = engine.run({ slopeDistance: slopeDistanceMeters, [field]: vzGon }).full;
    return { ok: true, horizontalDistanceMeters: reduced.horizontalDistance, verticalRiseMeters: reduced.verticalRise };
  } catch (e) {
    return { ok: false, code: 'INVALID_GEOMETRY', message: e.message };
  }
}

/** Attempts the final height; returns {h} on success, or {reasonCode} when a required input is genuinely absent. */
function resolveHeight(setup, station, observation, verticalRiseMeters, verticalAngleConvention) {
  if (typeof station.point.h !== 'number' || !Number.isFinite(station.point.h)) return { reasonCode: 'STATION_H_UNKNOWN' };
  if (!setup.station.instrumentHeight || typeof setup.station.instrumentHeight.value !== 'number') return { reasonCode: 'INSTRUMENT_HEIGHT_MISSING' };
  if (!observation.prismHeight || typeof observation.prismHeight.value !== 'number') return { reasonCode: 'PRISM_HEIGHT_MISSING' };
  if (!verticalAngleConvention) return { reasonCode: 'VERTICAL_ANGLE_CONVENTION_UNKNOWN' };
  if (!observation.vz) return { reasonCode: 'VERTICAL_ANGLE_MISSING' };
  let riseMeters = verticalRiseMeters;
  if (riseMeters === null) {
    // the observation's horizontal distance came from an explicit horizontalDistance field, not the slope: the
    // vertical rise still needs its OWN reduction from the slope distance (if one was recorded) for height.
    if (!observation.distance) return { reasonCode: 'VERTICAL_ANGLE_MISSING' };
    const slopeDistanceMeters = toMeters(observation.distance.value, observation.distance.unit);
    const vzGon = toGon(observation.vz.value, observation.vz.unit);
    const engine = verticalAngleConvention === 'zenith' ? ENGINES.zenith : ENGINES.vertical;
    const field = verticalAngleConvention === 'zenith' ? 'zenithGon' : 'verticalGon';
    try {
      riseMeters = engine.run({ slopeDistance: slopeDistanceMeters, [field]: vzGon }).full.verticalRise;
    } catch {
      return { reasonCode: 'VERTICAL_ANGLE_MISSING' };
    }
  }
  const instrumentHeightMeters = toMeters(setup.station.instrumentHeight.value, setup.station.instrumentHeight.unit);
  const prismHeightMeters = toMeters(observation.prismHeight.value, observation.prismHeight.unit);
  const h = ENGINES.combine.run({ stationH: station.point.h, instrumentHeight: instrumentHeightMeters, verticalRise: riseMeters, prismHeight: prismHeightMeters }).resultData.h;
  return { h };
}

/** One observation's full result, GIVEN an already-resolved, oriented setup (station/orientation both RESOLVED). */
function computeObservation(setup, station, orientationConstantGon, observation, verticalAngleConvention) {
  const errors = [];
  const target = observation.target;
  if (!target) errors.push(issue('MISSING_TARGET'));
  if (!observation.hz) errors.push(issue('MISSING_HZ'));
  if (errors.length) {
    return { index: observation.row, target: target || null, status: 'ERROR', x: null, y: null, h: null, direction: null, horizontalDistance: null, deltaX: null, deltaY: null, heightReason: null, errors, warnings: [], cells: observation.cells };
  }

  const distance = resolveHorizontalDistance(observation, verticalAngleConvention);
  if (!distance.ok) {
    return { index: observation.row, target, status: 'ERROR', x: null, y: null, h: null, direction: null, horizontalDistance: null, deltaX: null, deltaY: null, heightReason: null, errors: [issue(distance.code)], warnings: [], cells: observation.cells };
  }

  const hzGon = toGon(observation.hz.value, observation.hz.unit);
  let horizontal;
  try {
    horizontal = ENGINES.horizontal.run({ xStation: station.point.x, yStation: station.point.y, orientationConstantGon, hzGon, horizontalDistance: distance.horizontalDistanceMeters }).full;
  } catch (e) {
    return { index: observation.row, target, status: 'ERROR', x: null, y: null, h: null, direction: null, horizontalDistance: distance.horizontalDistanceMeters, deltaX: null, deltaY: null, heightReason: null, errors: [{ code: 'INVALID_GEOMETRY', message: e.message }], warnings: [], cells: observation.cells };
  }

  const heightResult = resolveHeight(setup, station, observation, distance.verticalRiseMeters, verticalAngleConvention);
  const heightReason = heightResult.reasonCode || null;

  return {
    index: observation.row,
    target,
    status: heightReason ? 'XY_ONLY' : 'READY',
    x: horizontal.x,
    y: horizontal.y,
    h: heightReason ? null : heightResult.h,
    direction: horizontal.directionGon,
    horizontalDistance: distance.horizontalDistanceMeters,
    deltaX: horizontal.deltaX,
    deltaY: horizontal.deltaY,
    heightReason,
    errors: [],
    warnings: heightReason ? [issue(heightReason)] : [],
    cells: observation.cells,
  };
}

/** One setup, PURE (no I/O): `resolution` is the already-fetched point-resolution outcome for station/orientation. */
function computeSetup(setup, resolution, options = {}) {
  const verticalAngleConvention = options.verticalAngleConvention || null;
  const stationOut = { identifier: setup.station.point, resolution: resolution.station.status, point: resolution.station.point || null, candidates: resolution.station.candidates || null };
  const orientationOut = setup.orientation
    ? { identifier: setup.orientation.target, resolution: resolution.orientation.status, point: resolution.orientation.point || null, candidates: resolution.orientation.candidates || null }
    : null;

  const blockAll = (code) => ({
    index: setup.index, station: stationOut, orientation: orientationOut, orientationConstantGon: null, bearingGon: null,
    setupError: code, observations: setup.observations.filter((o) => !o.excluded).map((o) => ({
      index: o.row, target: o.target || null, status: 'ERROR', x: null, y: null, h: null, direction: null,
      horizontalDistance: null, deltaX: null, deltaY: null, heightReason: null, errors: [issue(code)], warnings: [], cells: o.cells,
    })),
  });

  if (resolution.station.status === 'MISSING') return blockAll('STATION_MISSING');
  if (resolution.station.status === 'AMBIGUOUS') return blockAll('STATION_AMBIGUOUS');
  if (!setup.orientation) return blockAll('NO_ORIENTATION_REFERENCE');
  if (resolution.orientation.status === 'MISSING') return blockAll('ORIENTATION_MISSING');
  if (resolution.orientation.status === 'AMBIGUOUS') return blockAll('ORIENTATION_AMBIGUOUS');

  const station = stationOut;
  const orientation = orientationOut;
  if (typeof station.point.x !== 'number' || typeof station.point.y !== 'number') return blockAll('STATION_COORDINATES_UNKNOWN');
  if (typeof orientation.point.x !== 'number' || typeof orientation.point.y !== 'number') return blockAll('ORIENTATION_COORDINATES_UNKNOWN');

  const hzToBacksightGon = observedHzToBacksightGon(setup.orientation);
  let orientationFull;
  try {
    orientationFull = ENGINES.orientation.run({ xStation: station.point.x, yStation: station.point.y, xBacksight: orientation.point.x, yBacksight: orientation.point.y, observedHzGon: hzToBacksightGon }).full;
  } catch {
    return blockAll('COINCIDENT_STATION_ORIENTATION');
  }

  const observations = setup.observations
    .filter((o) => !o.excluded)
    .map((o) => computeObservation(setup, station, orientationFull.orientationConstantGon, o, verticalAngleConvention));

  return {
    index: setup.index,
    station,
    orientation,
    orientationConstantGon: orientationFull.orientationConstantGon,
    bearingGon: orientationFull.bearingGon,
    observedHzToBacksightGon: hzToBacksightGon,
    setupError: null,
    observations,
  };
}

/** Flags (WARNING, never silently dropped) a target name that repeats across READY/XY_ONLY observations in the
 * SAME run - a save-as-points conflict predictor, computed purely from the run's own data. */
function applyDuplicateTargetWarnings(setups) {
  const seen = new Map();
  for (const setup of setups) {
    for (const obs of setup.observations) {
      if (obs.status !== 'READY' && obs.status !== 'XY_ONLY') continue;
      const key = String(obs.target || '').trim().toLowerCase();
      if (!key) continue;
      (seen.get(key) || seen.set(key, []).get(key)).push(obs);
    }
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    for (const obs of group) {
      obs.status = 'WARNING';
      obs.warnings.push(issue('DUPLICATE_TARGET_NAME_IN_RUN'));
    }
  }
}

/**
 * @param {object[]} setups the CONFIRMED FieldObservationSet's `setups` array
 * @param {{projectId: string, SurveyPointModel: object, verticalAngleConvention?: 'zenith'|'vertical'|null}} context
 * @returns {Promise<object[]>} per-setup results, ready to persist as FieldProcessingRun.setups
 */
async function buildProcessingRun(setups, { projectId, SurveyPointModel, verticalAngleConvention = null }) {
  const results = [];
  for (const setup of setups) {
    const station = await resolvePointByName(SurveyPointModel, projectId, setup.station.point);
    const orientation = setup.orientation ? await resolvePointByName(SurveyPointModel, projectId, setup.orientation.target) : null;
    results.push(computeSetup(setup, { station, orientation }, { verticalAngleConvention }));
  }
  applyDuplicateTargetWarnings(results);
  return results;
}

module.exports = { computeSetup, buildProcessingRun, applyDuplicateTargetWarnings, MESSAGES };
