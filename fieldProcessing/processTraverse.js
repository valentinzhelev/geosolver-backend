/**
 * Traverse processing orchestration (V2.4.2): a CONFIRMED FieldObservationSet's setups -> an ordered chain of legs
 * -> raw coordinates -> (for CLOSED_LOOP/KNOWN_ENDPOINT) coordinate closure -> (only when fully valid) a classic
 * Bowditch adjustment. Reuses fieldProcessing/traverseSequence.js for ordering, fieldProcessing/pointResolution.js
 * for server-side station/endpoint identity, and fieldProcessing/processRun.js's distance/height decision tree
 * (resolveHorizontalDistance/resolveHeight) and orientation-constant/polar-horizontal engines UNCHANGED for the
 * first station - never a second copy of that logic. Only station 2+'s DIRECTION (no independently known
 * coordinates to derive a bearing from) and every station's COORDINATE PROPAGATION use the new traverse-direction/
 * traverse-propagation engines (V2.4.2 section 6/8), and closure/adjustment use traverse-closure/traverse-bowditch.
 *
 * `buildTraverseRun` is the only async entry point (point resolution needs the database); everything else here is
 * pure and independently testable.
 */
const { resolvePointByName } = require('./pointResolution');
const { buildTraverseSequence } = require('./traverseSequence');
const { getCurrentEngine, toGon, toMeters, normalizeGon } = require('./engines');
const { observedHzToBacksightGon, resolveHorizontalDistance, resolveHeight, issue: polarIssue, ENGINES: POLAR_ENGINES } = require('./processRun');

const ENGINES = {
  direction: getCurrentEngine('traverse-direction'),
  propagation: getCurrentEngine('traverse-propagation'),
  closure: getCurrentEngine('traverse-closure'),
  bowditch: getCurrentEngine('traverse-bowditch'),
};

const MESSAGES = {
  START_STATION_NOT_FOUND: 'Началната станция не е намерена сред точките на проекта.',
  START_STATION_AMBIGUOUS: 'Има повече от една точка с името на началната станция - уточнете коя е.',
  START_ORIENTATION_MISSING: 'Началната станция няма записан ориентир в полевата книжка.',
  START_ORIENTATION_NOT_FOUND: 'Ориентирът на началната станция не е намерен сред точките на проекта.',
  START_ORIENTATION_AMBIGUOUS: 'Има повече от една точка с името на ориентира - уточнете коя е.',
  START_COORDINATES_UNKNOWN: 'Началната станция няма записани координати.',
  START_ORIENTATION_COORDINATES_UNKNOWN: 'Ориентирът на началната станция няма записани координати.',
  COINCIDENT_START_ORIENTATION: 'Началната станция и ориентирът съвпадат.',
  END_STATION_NOT_FOUND: 'Крайната контролна точка не е намерена сред точките на проекта.',
  END_STATION_AMBIGUOUS: 'Има повече от една точка с името на крайната контролна точка - уточнете коя е.',
  PREVIOUS_LEG_INVALID: 'Предходната отсечка е невалидна - координатите на тази станция са неизвестни.',
  ...require('./processRun').MESSAGES,
};
const issue = (code, extra = {}) => ({ code, message: MESSAGES[code] || code, ...extra });

/** Validation/global-status states (V2.4.2 section 14). */
const STATUS = { READY: 'READY', PARTIAL: 'PARTIAL', INVALID: 'INVALID' };

function blockedLeg(seqLeg, index, code) {
  return {
    index, fromSetupIndex: seqLeg.fromSetupIndex, toSetupIndex: seqLeg.toSetupIndex,
    from: seqLeg.fromIdentifier, to: seqLeg.toIdentifier, sourceObservation: seqLeg.sourceObservation,
    status: 'ERROR', bearingGon: null, horizontalDistance: null,
    rawDeltaX: null, rawDeltaY: null, rawX: null, rawY: null, rawH: null, heightReason: null,
    adjustedDeltaX: null, adjustedDeltaY: null, adjustedX: null, adjustedY: null, correctionX: null, correctionY: null,
    errors: [issue(code)], warnings: [],
  };
}

/**
 * PURE (no I/O): computes every leg's raw (and, if eligible, Bowditch-adjusted) result, GIVEN already-resolved
 * start/orientation/end points and the traverse sequence's ordered legs.
 *
 * @param {object[]} setups the FieldObservationSet's setups (read-only, for occupyingSetup lookups)
 * @param {object} sequence buildTraverseSequence's output
 * @param {{traverseType, startPoint, orientationPoint, endPoint, verticalAngleConvention}} resolved
 */
function computeTraverse(setups, sequence, resolved) {
  const { traverseType, startPoint, orientationPoint, endPoint, verticalAngleConvention } = resolved;
  const seqLegs = sequence.legs;

  if (!startPoint) return { legs: [], closure: closureUnavailable('START_NOT_RESOLVED'), adjustment: adjustmentNotApplied('START_NOT_RESOLVED'), status: STATUS.INVALID, blockReason: null };
  if (typeof startPoint.x !== 'number' || typeof startPoint.y !== 'number') {
    return blockAll(seqLegs, 'START_COORDINATES_UNKNOWN');
  }
  if (!orientationPoint) return blockAll(seqLegs, 'START_ORIENTATION_NOT_FOUND');
  if (typeof orientationPoint.x !== 'number' || typeof orientationPoint.y !== 'number') {
    return blockAll(seqLegs, 'START_ORIENTATION_COORDINATES_UNKNOWN');
  }

  const startSetup = setups.find((s) => s.index === seqLegs[0].fromSetupIndex);
  const hzToBacksightGon = observedHzToBacksightGon(startSetup.orientation);
  let orientationConstantGon0;
  try {
    orientationConstantGon0 = POLAR_ENGINES.orientation.run({
      xStation: startPoint.x, yStation: startPoint.y, xBacksight: orientationPoint.x, yBacksight: orientationPoint.y, observedHzGon: hzToBacksightGon,
    }).full.orientationConstantGon;
  } catch {
    return blockAll(seqLegs, 'COINCIDENT_START_ORIENTATION');
  }

  const legs = [];
  let currentX = startPoint.x;
  let currentY = startPoint.y;
  let currentH = typeof startPoint.h === 'number' && Number.isFinite(startPoint.h) ? startPoint.h : null;
  let previousBearingGon = null;
  let chainBroken = false;

  for (let i = 0; i < seqLegs.length; i += 1) {
    const seqLeg = seqLegs[i];
    if (chainBroken) { legs.push(blockedLeg(seqLeg, i, 'PREVIOUS_LEG_INVALID')); continue; }

    const occupyingSetup = setups.find((s) => s.index === seqLeg.fromSetupIndex);
    const observation = (occupyingSetup.observations || []).find((o) => o.row === seqLeg.sourceObservation.row);

    if (!observation || !observation.target) { legs.push(blockedLeg(seqLeg, i, 'MISSING_TARGET')); chainBroken = true; continue; }
    if (!observation.hz) { legs.push(blockedLeg(seqLeg, i, 'MISSING_HZ')); chainBroken = true; continue; }

    const distance = resolveHorizontalDistance(observation, verticalAngleConvention);
    if (!distance.ok) { legs.push(blockedLeg(seqLeg, i, distance.code)); chainBroken = true; continue; }

    const hzForwardGon = toGon(observation.hz.value, observation.hz.unit);
    let bearingGon;
    if (i === 0) {
      bearingGon = normalizeGon(orientationConstantGon0 + hzForwardGon);
    } else {
      const hzBackGon = observedHzToBacksightGon(occupyingSetup.orientation);
      bearingGon = ENGINES.direction.run({ alphaIncomingGon: previousBearingGon, hzBackGon, hzForwardGon }).full.forwardBearingGon;
    }

    let propagated;
    try {
      // `full` (unrounded) carries the running X/Y forward leg-to-leg so rounding never accumulates across a long
      // chain (V2.4.2 section 8: "do not round intermediate values"); `resultData` (rounded to 3dp, same
      // convention as polar-horizontal) is what gets PERSISTED as this leg's raw result - rounding only at that
      // presentation/persistence boundary.
      propagated = ENGINES.propagation.run({ xStation: currentX, yStation: currentY, bearingGon, horizontalDistance: distance.horizontalDistanceMeters });
    } catch (e) {
      legs.push(blockedLeg(seqLeg, i, 'INVALID_GEOMETRY'));
      legs[legs.length - 1].errors = [{ code: 'INVALID_GEOMETRY', message: e.message }];
      chainBroken = true;
      continue;
    }

    const heightResult = resolveHeight(occupyingSetup, { point: { h: currentH } }, observation, distance.verticalRiseMeters, verticalAngleConvention);
    const heightReason = heightResult.reasonCode || null;

    legs.push({
      index: i, fromSetupIndex: seqLeg.fromSetupIndex, toSetupIndex: seqLeg.toSetupIndex,
      from: seqLeg.fromIdentifier, to: seqLeg.toIdentifier, sourceObservation: seqLeg.sourceObservation,
      status: heightReason ? 'XY_ONLY' : 'READY',
      bearingGon, horizontalDistance: distance.horizontalDistanceMeters,
      rawDeltaX: propagated.full.deltaX, rawDeltaY: propagated.full.deltaY, rawX: propagated.resultData.x, rawY: propagated.resultData.y,
      rawH: heightReason ? null : heightResult.h, heightReason,
      adjustedDeltaX: null, adjustedDeltaY: null, adjustedX: null, adjustedY: null, correctionX: null, correctionY: null,
      errors: [], warnings: heightReason ? [polarIssue(heightReason)] : [],
    });

    currentX = propagated.full.x; currentY = propagated.full.y; currentH = heightReason ? null : heightResult.h;
    previousBearingGon = bearingGon;
  }

  const anyError = legs.some((l) => l.status === 'ERROR');
  let status;
  if (legs.length === 0) status = STATUS.INVALID;
  else if (sequenceIsFullyResolved(sequence) && !anyError) status = STATUS.READY;
  else status = STATUS.PARTIAL;

  // Closure (section 10): only for CLOSED_LOOP/KNOWN_ENDPOINT, only when the sequence actually reached the known
  // endpoint and every leg computed cleanly - never a fabricated value otherwise.
  let closure;
  if (traverseType === 'OPEN') {
    closure = closureUnavailable('OPEN_TRAVERSE');
  } else if (!sequence.reachedKnownEndpoint || anyError || legs.length === 0) {
    closure = closureUnavailable(anyError ? 'INVALID_LEGS' : 'ENDPOINT_NOT_REACHED');
  } else if (!endPoint) {
    closure = closureUnavailable('END_NOT_RESOLVED');
  } else if (typeof endPoint.x !== 'number' || typeof endPoint.y !== 'number') {
    closure = closureUnavailable('END_COORDINATES_UNKNOWN');
  } else {
    const totalLength = legs.reduce((s, l) => s + l.horizontalDistance, 0);
    // Uses the full-precision chained endpoint (currentX/currentY), not the last leg's rounded rawX/rawY, so
    // closure reflects the true propagated position rather than an already-rounded intermediate value.
    const c = ENGINES.closure.run({ rawEndX: currentX, rawEndY: currentY, knownEndX: endPoint.x, knownEndY: endPoint.y, totalLength }).full;
    closure = { available: true, reason: null, totalLength, ...c };
  }

  // Bowditch (section 11/12): ONLY for a controlled traverse with a fully valid horizontal chain and real closure.
  let adjustment;
  if (!closure.available) {
    adjustment = adjustmentNotApplied(closure.reason);
  } else {
    const totalLength = closure.totalLength;
    const bow = ENGINES.bowditch.run({
      legs: legs.map((l) => ({ length: l.horizontalDistance, rawDeltaX: l.rawDeltaX, rawDeltaY: l.rawDeltaY })),
      fX: closure.fX, fY: closure.fY, totalLength,
    }).full;
    let ax = startPoint.x;
    let ay = startPoint.y;
    legs.forEach((l, i) => {
      const corr = bow.corrections[i];
      ax += l.rawDeltaX + corr.cX; ay += l.rawDeltaY + corr.cY;
      l.correctionX = corr.cX; l.correctionY = corr.cY;
      l.adjustedDeltaX = l.rawDeltaX + corr.cX; l.adjustedDeltaY = l.rawDeltaY + corr.cY;
      l.adjustedX = ax; l.adjustedY = ay;
    });
    adjustment = { method: 'bowditch', version: 1, applied: true, reasonNotApplied: null };
  }

  return { legs, closure, adjustment, status, blockReason: null };
}

function sequenceIsFullyResolved(sequence) { return sequence.state === 'RESOLVED'; }

function closureUnavailable(reason) { return { available: false, reason, totalLength: null, fX: null, fY: null, linearMisclosure: null, perfectClosure: null, relativeClosureDenominator: null }; }
function adjustmentNotApplied(reasonNotApplied) { return { method: 'bowditch', version: 1, applied: false, reasonNotApplied }; }

function blockAll(seqLegs, code) {
  return { legs: seqLegs.map((l, i) => blockedLeg(l, i, code)), closure: closureUnavailable(code), adjustment: adjustmentNotApplied(code), status: STATUS.INVALID, blockReason: code };
}

/**
 * @param {object[]} setups the CONFIRMED FieldObservationSet's `setups` array
 * @param {{traverseType, startIdentifier, endIdentifier, verticalAngleConvention, projectId, SurveyPointModel}} options
 */
async function buildTraverseRun(setups, options) {
  const { traverseType, startIdentifier, endIdentifier = null, verticalAngleConvention = null, projectId, SurveyPointModel } = options;

  const sequence = buildTraverseSequence(setups, { traverseType, startIdentifier, endIdentifier });

  const startSetup = setups.find((s) => String(s.station && s.station.point || '').trim().toLowerCase() === String(startIdentifier || '').trim().toLowerCase());
  let startResolution = null;
  let orientationResolution = null;
  let orientationIdentifier = null;
  if (startSetup) {
    startResolution = await resolvePointByName(SurveyPointModel, projectId, startIdentifier);
    if (startSetup.orientation) {
      orientationIdentifier = startSetup.orientation.target;
      orientationResolution = await resolvePointByName(SurveyPointModel, projectId, orientationIdentifier);
    }
  }

  const wantsEndpoint = traverseType !== 'OPEN';
  let endResolution = null;
  if (wantsEndpoint && sequence.effectiveEndIdentifier) {
    endResolution = await resolvePointByName(SurveyPointModel, projectId, sequence.effectiveEndIdentifier);
  }

  // Sequence itself failed to resolve deterministically (AMBIGUOUS/DISCONNECTED) or found no legs at all: nothing
  // can be computed - report the sequence problem directly rather than pretending there is a traverse to process.
  if (sequence.legs.length === 0) {
    return {
      traverseType, startIdentifier, endIdentifier: sequence.effectiveEndIdentifier,
      sequence, start: pointOut(startIdentifier, startResolution), orientation: pointOut(orientationIdentifier, orientationResolution),
      end: wantsEndpoint ? pointOut(sequence.effectiveEndIdentifier, endResolution) : null,
      legs: [], closure: closureUnavailable('NO_LEGS'), adjustment: adjustmentNotApplied('NO_LEGS'), status: STATUS.INVALID,
    };
  }

  let blockCode = null;
  if (!startResolution || startResolution.status === 'MISSING') blockCode = 'START_STATION_NOT_FOUND';
  else if (startResolution.status === 'AMBIGUOUS') blockCode = 'START_STATION_AMBIGUOUS';
  else if (!startSetup.orientation) blockCode = 'START_ORIENTATION_MISSING';
  else if (!orientationResolution || orientationResolution.status === 'MISSING') blockCode = 'START_ORIENTATION_NOT_FOUND';
  else if (orientationResolution.status === 'AMBIGUOUS') blockCode = 'START_ORIENTATION_AMBIGUOUS';
  else if (wantsEndpoint && (!endResolution || endResolution.status === 'MISSING')) blockCode = 'END_STATION_NOT_FOUND';
  else if (wantsEndpoint && endResolution.status === 'AMBIGUOUS') blockCode = 'END_STATION_AMBIGUOUS';

  let computed;
  if (blockCode) {
    computed = blockAll(sequence.legs, blockCode);
  } else {
    computed = computeTraverse(setups, sequence, {
      traverseType,
      startPoint: startResolution.point,
      orientationPoint: orientationResolution.point,
      endPoint: wantsEndpoint ? endResolution.point : null,
      verticalAngleConvention,
    });
  }

  // A sequence that stopped early (INCOMPLETE) never produces a fully READY run, even if every leg it DID manage
  // to build is individually valid - the requested traverse was not completed.
  const status = sequence.state !== 'RESOLVED' && computed.status === STATUS.READY ? STATUS.PARTIAL : computed.status;

  return {
    traverseType, startIdentifier, endIdentifier: sequence.effectiveEndIdentifier,
    sequence, start: pointOut(startIdentifier, startResolution), orientation: pointOut(orientationIdentifier, orientationResolution),
    end: wantsEndpoint ? pointOut(sequence.effectiveEndIdentifier, endResolution) : null,
    legs: computed.legs, closure: computed.closure, adjustment: computed.adjustment, status,
  };
}

function pointOut(identifier, resolution) {
  if (!identifier) return null;
  return { identifier, resolution: resolution ? resolution.status : 'MISSING', point: (resolution && resolution.point) || null, candidates: (resolution && resolution.candidates) || null };
}

module.exports = { buildTraverseRun, computeTraverse, MESSAGES, STATUS };
