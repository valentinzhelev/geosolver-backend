const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');

/**
 * Height (vertical) computation for one observation, VERTICAL ANGLE (from-horizon) convention (V2.4.1 section 6).
 *
 * Vertical angle: measured from the horizontal plane, positive = up, negative = down, 0 gon = horizontal. This is
 * DIFFERENT from a zenith angle (see polarHeightZenith.js) - never confused; the orchestration layer only calls
 * this engine when the observation's vertical-angle semantics are EXPLICITLY known to be "from horizon".
 *
 *   horizontalDistance = slopeDistance * cos(vertical)
 *   verticalRise        = slopeDistance * sin(vertical)
 *   targetH = stationH + instrumentHeight + verticalRise - prismHeight
 */
const engine = defineEngine({
  toolName: 'polar-height-vertical',
  version: 1,
  displayName: { bg: 'Височина (вертикален ъгъл)', en: 'Height (vertical angle)' },
  fields: ['stationH', 'instrumentHeight', 'prismHeight', 'slopeDistance', 'verticalGon'],
  validate({ slopeDistance, verticalGon }) {
    if (slopeDistance <= 0) throw new EngineError('OUT_OF_RANGE', 'Наклоненото разстояние трябва да е положително число.', 'slopeDistance');
    if (verticalGon < -100 || verticalGon > 100) throw new EngineError('OUT_OF_RANGE', 'Вертикалният ъгъл трябва да е между -100 и 100 гона.', 'verticalGon');
  },
  compute({ stationH, instrumentHeight, prismHeight, slopeDistance, verticalGon }) {
    const rad = (verticalGon * Math.PI) / 200;
    const horizontalDistance = slopeDistance * Math.cos(rad);
    const verticalRise = slopeDistance * Math.sin(rad);
    const h = stationH + instrumentHeight + verticalRise - prismHeight;
    return { horizontalDistance, verticalRise, h };
  },
  persisted: [['horizontalDistance', null], ['verticalRise', null], ['h', 3]],
});

module.exports = { engines: [engine] };
