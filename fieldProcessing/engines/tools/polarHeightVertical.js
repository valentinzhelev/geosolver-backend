const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');

/**
 * Slope-distance reduction, VERTICAL ANGLE (from-horizon) convention (V2.4.1 section 5/6).
 *
 * Vertical angle: measured from the horizontal plane, positive = up, negative = down, 0 gon = horizontal.
 * DIFFERENT from a zenith angle (see polarHeightZenith.js) - never confused; the orchestration layer only calls
 * this engine when an observation's vertical-angle semantics are EXPLICITLY known to be "from horizon".
 *
 * Produces ONLY the reduction (horizontalDistance, verticalRise) - see polarHeightZenith.js's doc for why station
 * H / instrument / prism height are deliberately not inputs here (heightCombination.js does that separately).
 */
const engine = defineEngine({
  toolName: 'polar-height-vertical',
  version: 1,
  displayName: { bg: 'Редукция по вертикален ъгъл', en: 'Reduction by vertical angle' },
  fields: ['slopeDistance', 'verticalGon'],
  validate({ slopeDistance, verticalGon }) {
    if (slopeDistance <= 0) throw new EngineError('OUT_OF_RANGE', 'Наклоненото разстояние трябва да е положително число.', 'slopeDistance');
    if (verticalGon < -100 || verticalGon > 100) throw new EngineError('OUT_OF_RANGE', 'Вертикалният ъгъл трябва да е между -100 и 100 гона.', 'verticalGon');
  },
  compute({ slopeDistance, verticalGon }) {
    const rad = (verticalGon * Math.PI) / 200;
    return { horizontalDistance: slopeDistance * Math.cos(rad), verticalRise: slopeDistance * Math.sin(rad) };
  },
  persisted: [['horizontalDistance', null], ['verticalRise', null]],
});

module.exports = { engines: [engine] };
