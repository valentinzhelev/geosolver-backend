const { defineEngine, assertPlainObject } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');
const { toFiniteNumber } = require('../../../engines/numbers');

/**
 * Classic Bowditch (compass rule) coordinate adjustment (V2.4.2 section 11) - ONLY for CLOSED_LOOP / KNOWN_ENDPOINT
 * traverses with a fully valid horizontal chain and a known endpoint. Distributes the coordinate misclosure
 * (fX, fY) across legs IN PROPORTION TO LEG LENGTH:
 *
 *   cX_i = -fX * (L_i / SUM(L))     cY_i = -fY * (L_i / SUM(L))
 *   adjustedDeltaX_i = rawDeltaX_i + cX_i     adjustedDeltaY_i = rawDeltaY_i + cY_i
 *
 * IMPORTANT LIMITATION (V2.4.2 section 12, documented deliberately - do not remove this comment when touching this
 * file): this is the classic deterministic compass-rule method, proportional to distance only. It is NOT
 * least-squares adjustment, has NO stochastic weighting or covariance model, and is not universally the
 * "correct" or legally mandated method for every survey - it is one specific, transparent, well-known classical
 * technique. A future milestone may add a dedicated least-squares/network adjustment; this engine must never be
 * presented as that.
 *
 * Bulk engine (operates on the whole leg set at once, not a single record) - see the custom `normalize` below;
 * `corrections` is persisted via the 'string' passthrough (an array, not a single rounded number).
 */
function normalize(raw) {
  assertPlainObject(raw);
  if (!Array.isArray(raw.legs) || raw.legs.length === 0) {
    throw new EngineError('INVALID_INPUT_DATA', '„legs“ трябва да е непразен списък.', 'legs');
  }
  const legs = raw.legs.map((l, i) => ({
    length: toFiniteNumber(l.length, `legs[${i}].length`),
    rawDeltaX: toFiniteNumber(l.rawDeltaX, `legs[${i}].rawDeltaX`),
    rawDeltaY: toFiniteNumber(l.rawDeltaY, `legs[${i}].rawDeltaY`),
  }));
  return {
    legs,
    fX: toFiniteNumber(raw.fX, 'fX'),
    fY: toFiniteNumber(raw.fY, 'fY'),
    totalLength: toFiniteNumber(raw.totalLength, 'totalLength'),
  };
}

const engine = defineEngine({
  toolName: 'traverse-bowditch',
  version: 1,
  displayName: { bg: 'Изравнение по компасното правило (Bowditch)', en: 'Compass-rule (Bowditch) adjustment' },
  normalize,
  validate({ legs, totalLength }) {
    if (totalLength <= 0) throw new EngineError('OUT_OF_RANGE', 'Общата дължина на хода трябва да е положително число.', 'totalLength');
    legs.forEach((l, i) => {
      if (l.length <= 0) throw new EngineError('OUT_OF_RANGE', 'Дължината на всяка отсечка трябва да е положително число.', `legs[${i}].length`);
    });
  },
  compute({ legs, fX, fY, totalLength }) {
    const corrections = legs.map((l) => {
      const cX = -fX * (l.length / totalLength);
      const cY = -fY * (l.length / totalLength);
      return { cX, cY, adjustedDeltaX: l.rawDeltaX + cX, adjustedDeltaY: l.rawDeltaY + cY };
    });
    return { corrections };
  },
  persisted: [['corrections', 'string']],
});

module.exports = { engines: [engine] };
