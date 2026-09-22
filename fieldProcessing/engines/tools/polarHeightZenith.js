const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');

/**
 * Height (vertical) computation for one observation, ZENITH ANGLE convention (V2.4.1 section 6).
 *
 * Zenith angle: measured from the zenith (straight up). 0 gon = straight up, 100 gon = horizontal,
 * 200 gon = straight down (nadir) - the standard total-station convention. This is DIFFERENT from a "vertical
 * angle" measured from the horizontal plane (see polarHeightVertical.js): the two must never be confused, and the
 * orchestration layer (fieldProcessing/processRun.js) only calls this engine when the confirmed observation's
 * vertical-angle semantics are EXPLICITLY known to be zenith (never assumed - see the module doc there).
 *
 *   horizontalDistance = slopeDistance * sin(zenith)
 *   verticalRise        = slopeDistance * cos(zenith)
 *   targetH = stationH + instrumentHeight + verticalRise - prismHeight
 */
const engine = defineEngine({
  toolName: 'polar-height-zenith',
  version: 1,
  displayName: { bg: 'Височина (зенитно разстояние)', en: 'Height (zenith angle)' },
  fields: ['stationH', 'instrumentHeight', 'prismHeight', 'slopeDistance', 'zenithGon'],
  validate({ slopeDistance, zenithGon }) {
    if (slopeDistance <= 0) throw new EngineError('OUT_OF_RANGE', 'Наклоненото разстояние трябва да е положително число.', 'slopeDistance');
    if (zenithGon < 0 || zenithGon > 200) throw new EngineError('OUT_OF_RANGE', 'Зенитното разстояние трябва да е между 0 и 200 гона.', 'zenithGon');
  },
  compute({ stationH, instrumentHeight, prismHeight, slopeDistance, zenithGon }) {
    const rad = (zenithGon * Math.PI) / 200;
    const horizontalDistance = slopeDistance * Math.sin(rad);
    const verticalRise = slopeDistance * Math.cos(rad);
    const h = stationH + instrumentHeight + verticalRise - prismHeight;
    return { horizontalDistance, verticalRise, h };
  },
  persisted: [['horizontalDistance', null], ['verticalRise', null], ['h', 3]],
});

module.exports = { engines: [engine] };
