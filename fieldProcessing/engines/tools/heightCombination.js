const { defineEngine } = require('../../../engines/define');

/**
 * Final target-height combination (V2.4.1 section 6): station H + instrument height + the vertical rise from a
 * slope reduction (polarHeightZenith.js / polarHeightVertical.js) - prism/target height.
 *
 * A separate, tiny, versioned step (not folded into the reduction engines) so X/Y can be computed from just the
 * slope distance and angle, independently of whether station H / instrument / prism height are actually known -
 * this engine is only ever invoked once ALL FOUR of those are confirmed present (fieldProcessing/processRun.js);
 * never invented (no H=0 default).
 */
const engine = defineEngine({
  toolName: 'height-combination',
  version: 1,
  displayName: { bg: 'Определяне на кота', en: 'Height combination' },
  fields: ['stationH', 'instrumentHeight', 'verticalRise', 'prismHeight'],
  validate() {},
  compute({ stationH, instrumentHeight, verticalRise, prismHeight }) {
    return { h: stationH + instrumentHeight + verticalRise - prismHeight };
  },
  persisted: [['h', 3]],
});

module.exports = { engines: [engine] };
