/**
 * Which processing types a CONFIRMED set of observations can actually support (pure, no I/O) - so the UI only ever
 * offers valid options ("Do not show impossible processing types"). It inspects the confirmed `setups` only and
 * reuses fieldProcessing/traverseSequence.js to decide whether a station chain exists; it calculates nothing.
 *
 *   polar    - at least one setup with at least one observation
 *   traverse - a resolved chain of >= 1 leg between occupied stations (mutually confirmed backsight/foresight)
 *
 * Whether the stations exist in the project (and have coordinates) is a processing precondition reported by the
 * processing run itself and by the review warnings - it does not make a type "impossible".
 */
const { buildTraverseSequence } = require('../fieldProcessing/traverseSequence');

const norm = (s) => String(s || '').trim().toLowerCase();

function polarOption(setups) {
  const withObs = setups.filter((s) => (s.observations || []).length > 0);
  const observationCount = withObs.reduce((n, s) => n + s.observations.length, 0);
  return {
    available: withObs.length > 0,
    reason: withObs.length > 0 ? null : 'NO_OBSERVATIONS',
    setupCount: withObs.length,
    observationCount,
  };
}

function traverseOption(setups) {
  const stationCount = setups.filter((s) => s.station && s.station.point).length;
  const none = (reason) => ({ available: false, reason, suggestedStart: null, chain: [], endCandidates: [], closesOnStart: false });
  if (stationCount < 2) return none('NEEDS_TWO_STATIONS');

  let best = null;
  for (const s of setups) {
    if (!s.station || !s.station.point) continue;
    const seq = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: s.station.point });
    if (seq.state === 'AMBIGUOUS' && seq.issue && seq.issue.code === 'DUPLICATE_STATION_IDENTIFIER_IN_OBSERVATION_SET') return none('DUPLICATE_STATION');
    if (seq.state === 'RESOLVED' && seq.legs.length && (!best || seq.legs.length > best.legs.length)) best = { start: s.station.point, legs: seq.legs };
  }
  if (!best) return none('NO_STATION_CHAIN');

  const chain = [best.legs[0].fromIdentifier, ...best.legs.map((l) => l.toIdentifier)];
  const last = setups.find((s) => norm(s.station.point) === norm(chain[chain.length - 1]));
  const stationKeys = new Set(setups.map((s) => norm(s.station.point)));
  const backsight = last && last.orientation ? norm(last.orientation.target) : null;
  const seen = new Set();
  const endCandidates = [];
  let closesOnStart = false;
  for (const o of (last && last.observations) || []) {
    const k = norm(o.target);
    if (!k || k === backsight || k === norm(last.station.point)) continue;
    if (k === norm(chain[0])) closesOnStart = true;
    else if (!stationKeys.has(k) && !seen.has(k)) { seen.add(k); endCandidates.push(o.target); }
  }
  return { available: true, reason: null, suggestedStart: best.start, chain, endCandidates, closesOnStart };
}

/** @param {object[]} setups confirmed FieldObservationSet.setups */
function processingOptions(setups) {
  const list = Array.isArray(setups) ? setups : [];
  return { polar: polarOption(list), traverse: traverseOption(list) };
}

module.exports = { processingOptions };
