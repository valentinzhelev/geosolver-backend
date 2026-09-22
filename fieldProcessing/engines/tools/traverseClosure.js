const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');

const FLOATING_POINT_TOLERANCE_M = 1e-9;

/**
 * Coordinate closure for a CLOSED_LOOP or KNOWN_ENDPOINT traverse (V2.4.2 section 10): compares the raw
 * propagated endpoint against the known endpoint control snapshot. OPEN traverses never call this engine - they
 * have no independent endpoint control, so closure is reported as NOT_AVAILABLE by the orchestration layer, never
 * a fabricated zero (see fieldProcessing/processTraverse.js).
 *
 * fX/fY = misclosure in X/Y, defined as RAW minus KNOWN (positive means the raw traverse overshot in that
 * direction) - the sign convention Bowditch (traverse-bowditch.js) depends on: correction_i = -f * (L_i/SUM(L))
 * only pulls the adjusted endpoint back onto the known control if f is defined this way round.
 * linearMisclosure = sqrt(fX^2+fY^2); relative closure is expressed as the ratio totalLength : linearMisclosure
 * (e.g. "1 : 18493"), which is undefined (not a ratio, not a fake zero) when the closure is (effectively) perfect -
 * `perfectClosure` flags that case explicitly instead. "Effectively" uses a tight floating-point tolerance
 * (1e-9 m), not exact zero: propagating several legs of pure trigonometry (cos/sin of gon-converted angles)
 * accumulates IEEE-754 noise on the order of 1e-13..1e-14 m even for a geometrically exact closed traverse, which
 * is many orders of magnitude below any real survey's measurable precision and must not be reported as an actual
 * (non-)closure.
 */
const engine = defineEngine({
  toolName: 'traverse-closure',
  version: 1,
  displayName: { bg: 'Линейна невръзка (полигонов ход)', en: 'Linear misclosure (traverse)' },
  fields: ['rawEndX', 'rawEndY', 'knownEndX', 'knownEndY', 'totalLength'],
  validate({ totalLength }) {
    if (totalLength <= 0) throw new EngineError('OUT_OF_RANGE', 'Общата дължина на хода трябва да е положително число.', 'totalLength');
  },
  compute({ rawEndX, rawEndY, knownEndX, knownEndY, totalLength }) {
    const fX = rawEndX - knownEndX;
    const fY = rawEndY - knownEndY;
    const linearMisclosure = Math.sqrt(fX * fX + fY * fY);
    const perfectClosure = linearMisclosure < FLOATING_POINT_TOLERANCE_M;
    const relativeClosureDenominator = perfectClosure ? null : totalLength / linearMisclosure;
    return { fX, fY, linearMisclosure, perfectClosure, relativeClosureDenominator };
  },
  persisted: [['fX', null], ['fY', null], ['linearMisclosure', null], ['perfectClosure', 'string'], ['relativeClosureDenominator', 'string']],
});

module.exports = { engines: [engine] };
