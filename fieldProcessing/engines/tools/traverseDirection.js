const { defineEngine } = require('../../../engines/define');
const { normalizeGon } = require('../angleUnits');

/**
 * Direction propagation for traverse station 2+ (V2.4.2 section 6). The FIRST station's orientation is resolved
 * from known coordinates via the existing `orientation-constant` engine (V2.4.1, reused as-is); every SUBSEQUENT
 * station has no independently known coordinates for its backsight (the previous station's coordinates are
 * themselves a computed traverse result, not surveyed control), so its orientation is derived purely from the
 * INCOMING bearing instead of re-deriving a bearing from coordinates - the standard practical traverse method,
 * and mathematically equivalent to computing atan2 on the propagated coordinates (a straight leg observed from
 * either end has back-bearing = forward-bearing +/- 200 gon).
 *
 * Convention (GeoSolver official, unchanged): X = Northing, Y = Easting, bearing clockwise from +X, 0 gon = North.
 *   alphaBackGon = normalize(alphaIncomingGon + 200)              (bearing FROM this station BACK to the previous one)
 *   orientationConstantGon = normalize(alphaBackGon - hzBackGon)  (same "constant + Hz = absolute bearing" contract
 *                                                                   as orientation-constant)
 *   forwardBearingGon = normalize(orientationConstantGon + hzForwardGon)
 */
const engine = defineEngine({
  toolName: 'traverse-direction',
  version: 1,
  displayName: { bg: 'Пренасяне на посока (полигонов ход)', en: 'Direction propagation (traverse)' },
  fields: ['alphaIncomingGon', 'hzBackGon', 'hzForwardGon'],
  validate() {},
  compute({ alphaIncomingGon, hzBackGon, hzForwardGon }) {
    const alphaBackGon = normalizeGon(alphaIncomingGon + 200);
    const orientationConstantGon = normalizeGon(alphaBackGon - hzBackGon);
    const forwardBearingGon = normalizeGon(orientationConstantGon + hzForwardGon);
    return { alphaBackGon, orientationConstantGon, forwardBearingGon };
  },
  persisted: [['alphaBackGon', null], ['orientationConstantGon', null], ['forwardBearingGon', null]],
});

module.exports = { engines: [engine] };
