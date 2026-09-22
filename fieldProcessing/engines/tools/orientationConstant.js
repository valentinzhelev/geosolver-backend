const { defineEngine } = require('../../../engines/define');
const { EngineError } = require('../../../engines/errors');
const { normalizeGon } = require('../angleUnits');

/**
 * Station orientation from a known backsight (V2.4.1 section 3).
 *
 * Known: station coordinates, backsight coordinates, the observed Hz reading taken while sighting the backsight
 * (already converted to gon by the caller - angles are never unit-converted inside an engine, see angleUnits.js).
 * `observedHzGon` defaults to 0 by the ORCHESTRATION layer, never this engine, when the notebook recorded no
 * explicit backsight reading (the "instrument was zeroed on the backsight" convention) - that interpretation is
 * documented in fieldProcessing/processRun.js, not silently baked in here.
 *
 * Convention (GeoSolver official, unchanged): X = Northing, Y = Easting, bearing clockwise from +X, 0 gon = North,
 * 100 gon = East. bearingGon = atan2(deltaY, deltaX) normalized into [0, 400).
 * orientationConstantGon = normalizeGon(bearingGon - observedHzGon): the angle added to any later Hz reading (at
 * the same station) to obtain that target's absolute direction.
 */
const engine = defineEngine({
  toolName: 'orientation-constant',
  version: 1,
  displayName: { bg: 'Ориентиране на станция', en: 'Station orientation' },
  fields: ['xStation', 'yStation', 'xBacksight', 'yBacksight', 'observedHzGon'],
  validate({ xStation, yStation, xBacksight, yBacksight }) {
    if (xStation === xBacksight && yStation === yBacksight) {
      throw new EngineError('COINCIDENT_POINTS', 'Станцията и ориентирът съвпадат.', 'xBacksight');
    }
  },
  compute({ xStation, yStation, xBacksight, yBacksight, observedHzGon }) {
    const deltaY = yBacksight - yStation;
    const deltaX = xBacksight - xStation;
    let bearingRad = Math.atan2(deltaY, deltaX);
    if (bearingRad < 0) bearingRad += 2 * Math.PI;
    const bearingGon = (bearingRad * 200) / Math.PI;
    const orientationConstantGon = normalizeGon(bearingGon - observedHzGon);
    return { bearingGon, orientationConstantGon };
  },
  persisted: [['bearingGon', null], ['orientationConstantGon', null]],
});

module.exports = { engines: [engine] };
