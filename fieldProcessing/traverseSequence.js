/**
 * Deterministic traverse SEQUENCE construction (V2.4.2 section 3): given a CONFIRMED FieldObservationSet's
 * `setups` array (read-only - never modified) and an explicit start (and, for controlled traverses, end) station
 * identifier declared by the caller, walks station -> backsight/foresight identity links to propose an ORDERED
 * chain of legs. Automatic reconstruction NEVER silently picks a continuation when more than one is equally
 * valid - see `state` below, which the caller must inspect before trusting `legs`.
 *
 * A leg's "foresight" is auto-detected: among a setup's non-excluded observations, a candidate continuation is
 * one whose target identifier matches ANOTHER setup's own station identifier (so it is itself an occupied
 * station elsewhere in this FieldObservationSet) AND that other setup's declared backsight is, in turn, this
 * station (mutual consistency - a one-sided reference is not treated as an intended traverse leg). A target that
 * has no own setup is only ever accepted as the FINAL leg, to the caller-declared known endpoint identifier -
 * never as a mid-chain continuation (an un-occupied point cannot orient the next leg).
 */
const norm = (s) => String(s || '').trim().toLowerCase();

const issue = (code, extra = {}) => ({ code, ...extra });

/**
 * @param {object[]} setups FieldObservationSet.setups (untouched)
 * @param {{traverseType:'CLOSED_LOOP'|'KNOWN_ENDPOINT'|'OPEN', startIdentifier:string, endIdentifier?:string|null}} options
 * @returns {{
 *   state: 'RESOLVED'|'INCOMPLETE'|'AMBIGUOUS'|'DISCONNECTED',
 *   issue: object|null,
 *   legs: {fromSetupIndex:number, toSetupIndex:number|null, fromIdentifier:string, toIdentifier:string, sourceObservation:{setupIndex:number,row:number}}[],
 *   reachedKnownEndpoint: boolean,
 *   effectiveEndIdentifier: string|null,
 * }}
 */
function buildTraverseSequence(setups, { traverseType, startIdentifier, endIdentifier = null }) {
  const wantsEndpoint = traverseType !== 'OPEN';
  const effectiveEndIdentifier = endIdentifier || (traverseType === 'CLOSED_LOOP' ? startIdentifier : null);
  const endKey = wantsEndpoint ? norm(effectiveEndIdentifier) : null;

  if (wantsEndpoint && !endKey) {
    return { state: 'INCOMPLETE', issue: issue('END_STATION_NOT_SPECIFIED'), legs: [], reachedKnownEndpoint: false, effectiveEndIdentifier: null };
  }

  const byStationKey = new Map();
  const duplicateKeys = new Set();
  for (const s of setups) {
    const key = norm(s.station && s.station.point);
    if (!key) continue;
    if (byStationKey.has(key)) duplicateKeys.add(key);
    else byStationKey.set(key, s);
  }
  if (duplicateKeys.size > 0) {
    return {
      state: 'AMBIGUOUS',
      issue: issue('DUPLICATE_STATION_IDENTIFIER_IN_OBSERVATION_SET', { identifiers: [...duplicateKeys] }),
      legs: [], reachedKnownEndpoint: false, effectiveEndIdentifier,
    };
  }

  const startKey = norm(startIdentifier);
  if (!startKey || !byStationKey.has(startKey)) {
    return { state: 'DISCONNECTED', issue: issue('START_STATION_NOT_FOUND', { identifier: startIdentifier }), legs: [], reachedKnownEndpoint: false, effectiveEndIdentifier };
  }

  const legs = [];
  const visitedKeys = new Set([startKey]);
  let currentKey = startKey;
  let state = 'RESOLVED';
  let sequenceIssue = null;
  let reachedKnownEndpoint = false;

  const guard = setups.length + 2;
  for (let step = 0; step < guard; step += 1) {
    const currentSetup = byStationKey.get(currentKey);
    const backsightKey = currentSetup.orientation ? norm(currentSetup.orientation.target) : null;

    const candidates = [];
    for (const o of currentSetup.observations || []) {
      if (o.excluded) continue;
      const tKey = norm(o.target);
      if (!tKey || tKey === currentKey || tKey === backsightKey) continue;

      const targetSetup = byStationKey.get(tKey);
      const isDeclaredEndpoint = wantsEndpoint && tKey === endKey;

      if (isDeclaredEndpoint) {
        // Reaching the declared endpoint always terminates the chain here, whether or not that identifier also
        // happens to have its own occupied setup (e.g. CLOSED_LOOP closing back onto the start): we do not need
        // to continue FROM it, so its own backsight declaration (the start's EXTERNAL orientation reference, for
        // instance) is irrelevant to this link's consistency.
        candidates.push({ observation: o, toKey: tKey, toSetupIndex: targetSetup ? targetSetup.index : null });
        continue;
      }
      if (!targetSetup) continue; // a plain sighted target with no own setup can only ever be the declared endpoint
      const targetBacksightKey = targetSetup.orientation ? norm(targetSetup.orientation.target) : null;
      if (targetBacksightKey !== currentKey) continue; // no mutual confirmation -> not a real traverse link
      if (visitedKeys.has(tKey)) continue; // would re-enter the middle of the chain
      candidates.push({ observation: o, toKey: tKey, toSetupIndex: targetSetup.index });
    }

    if (candidates.length === 0) {
      const expectedNext = setups.find((s) => !visitedKeys.has(norm(s.station && s.station.point))
        && s.orientation && norm(s.orientation.target) === currentKey);
      if (expectedNext) {
        state = 'INCOMPLETE';
        sequenceIssue = issue('MISSING_FORESIGHT_OBSERVATION', { atStationIdentifier: currentSetup.station.point, expectedNextIdentifier: expectedNext.station.point });
      } else if (wantsEndpoint) {
        state = 'INCOMPLETE';
        sequenceIssue = issue('ENDPOINT_NOT_REACHED', { atStationIdentifier: currentSetup.station.point });
      }
      break;
    }

    const byTarget = new Map();
    for (const c of candidates) if (!byTarget.has(c.toKey)) byTarget.set(c.toKey, c); // first-recorded observation wins
    const distinct = [...byTarget.values()];
    if (distinct.length > 1) {
      state = 'AMBIGUOUS';
      sequenceIssue = issue('AMBIGUOUS_CONTINUATION', { atStationIdentifier: currentSetup.station.point, candidateIdentifiers: distinct.map((c) => c.observation.target) });
      break;
    }

    const chosen = distinct[0];
    const toIdentifier = chosen.toSetupIndex !== null ? byStationKey.get(chosen.toKey).station.point : chosen.observation.target;
    legs.push({
      fromSetupIndex: currentSetup.index,
      toSetupIndex: chosen.toSetupIndex,
      fromIdentifier: currentSetup.station.point,
      toIdentifier,
      sourceObservation: { setupIndex: currentSetup.index, row: chosen.observation.row },
    });

    if (wantsEndpoint && chosen.toKey === endKey) { reachedKnownEndpoint = true; break; }
    visitedKeys.add(chosen.toKey);
    currentKey = chosen.toKey;
  }

  if (legs.length === 0 && state === 'RESOLVED') {
    state = 'INCOMPLETE';
    sequenceIssue = issue('NO_LEGS_FOUND');
  } else if (wantsEndpoint && !reachedKnownEndpoint && state === 'RESOLVED') {
    state = 'INCOMPLETE';
    sequenceIssue = sequenceIssue || issue('ENDPOINT_NOT_REACHED');
  }

  return { state, issue: sequenceIssue, legs, reachedKnownEndpoint, effectiveEndIdentifier };
}

module.exports = { buildTraverseSequence };
