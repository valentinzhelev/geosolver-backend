const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');

/**
 * Slope-distance reduction, ZENITH ANGLE convention (V2.4.1 section 5/6).
 *
 * Zenith angle: measured from the zenith (straight up). 0 gon = straight up, 100 gon = horizontal,
 * 200 gon = straight down (nadir) - the standard total-station convention. DIFFERENT from a "vertical angle"
 * measured from the horizontal plane (see polarHeightVertical.js) - never confused; the orchestration layer
 * (fieldProcessing/processRun.js) only calls this engine when an observation's vertical-angle semantics are
 * EXPLICITLY known to be zenith (never assumed).
 *
 * Deliberately produces ONLY the reduction (horizontalDistance, verticalRise), not a final target H: X/Y only
 * needs the slope distance and this angle, never station H / instrument / prism height - requiring those here
 * would make X/Y computation depend on inputs it does not actually need. Combining into a final H is
 * heightCombination.js, a separate, independently reusable step.
 */
const engine = defineEngine({
  toolName: 'polar-height-zenith',
  version: 1,
  displayName: { bg: 'Редукция по зенитно разстояние', en: 'Reduction by zenith angle' },
  fields: ['slopeDistance', 'zenithGon'],
  validate({ slopeDistance, zenithGon }) {
    if (slopeDistance <= 0) throw new EngineError('OUT_OF_RANGE', 'Наклоненото разстояние трябва да е положително число.', 'slopeDistance');
    if (zenithGon < 0 || zenithGon > 200) throw new EngineError('OUT_OF_RANGE', 'Зенитното разстояние трябва да е между 0 и 200 гона.', 'zenithGon');
  },
  compute({ slopeDistance, zenithGon }) {
    const rad = (zenithGon * Math.PI) / 200;
    return { horizontalDistance: slopeDistance * Math.sin(rad), verticalRise: slopeDistance * Math.cos(rad) };
  },
  persisted: [['horizontalDistance', null], ['verticalRise', null]],
});

module.exports = { engines: [engine] };
