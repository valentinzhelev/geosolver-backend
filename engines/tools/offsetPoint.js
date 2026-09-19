const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Orthogonal offset from segment A->B. Compute order (yA, xA, yB, xB, s, d) — Y first.
// s = chainage from A (m); d = perpendicular offset (m). Persisted yP, xP are UNROUNDED.
//
// Frame: X = north, Y = east, bearings clockwise from +X.
//   v2 (Milestone 2.0B, CURRENT): positive d = LEFT of A->B  -> normal (nx, ny) = ( uy, -ux)
//   v1 (HISTORICAL):              positive d = RIGHT of A->B -> normal (nx, ny) = (-uy,  ux)
// v1 was a shipped bug (it contradicted the documented convention). It is kept ONLY so legacy
// rows can be identified and verified; new calculations are always computed with v2.

function makeEngine(version, normalOf) {
  return defineEngine({
    toolName: 'offset-point',
    version,
    displayName: { bg: 'Ортогонален offset', en: 'Orthogonal offset' },
    fields: ['yA', 'xA', 'yB', 'xB', 's', 'd'],
    validate({ yA, xA, yB, xB, s }) {
      const len = Math.hypot(yB - yA, xB - xA);
      if (len < 1e-12) {
        throw new EngineError('COINCIDENT_POINTS', 'Точките A и B съвпадат');
      }
      if (s < 0 || s > len) {
        throw new EngineError('OUT_OF_RANGE', `Разстоянието s=${s.toFixed(3)} m е извън отсечката (0…${len.toFixed(3)} m)`, 's');
      }
    },
    compute({ yA, xA, yB, xB, s, d }) {
      const dy = yB - yA;
      const dx = xB - xA;
      const len = Math.hypot(dy, dx);
      const uy = dy / len;
      const ux = dx / len;
      const { nx, ny } = normalOf(ux, uy);
      const yOn = yA + s * uy;
      const xOn = xA + s * ux;
      return { yP: yOn + d * ny, xP: xOn + d * nx };
    },
    persisted: [['yP', null], ['xP', null]],
  });
}

const offsetV1 = makeEngine(1, (ux, uy) => ({ nx: -uy, ny: ux }));
const offsetV2 = makeEngine(2, (ux, uy) => ({ nx: uy, ny: -ux }));

module.exports = { engines: [offsetV1, offsetV2] };
