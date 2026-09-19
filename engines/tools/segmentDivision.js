const { defineEngine, assertPlainObject } = require('../define');
const { EngineError } = require('../errors');
const { toFiniteNumber } = require('../numbers');

const MODES = ['distance', 'ratio'];

// Point on segment A->B at distance s from A, or at ratio k. Compute order (yA, xA, yB, xB, value, mode).
// The shipped domain function silently treated ANY mode other than 'ratio' as distance; the canonical
// contract rejects it (INVALID_MODE). An ABSENT mode keeps the historical 'distance' default; the
// calculator UI only ever sends 'distance' or 'ratio'. Persisted yP, xP are UNROUNDED.
const engine = defineEngine({
  toolName: 'segment-division',
  version: 1,
  displayName: { bg: 'Деление на отсечка', en: 'Segment division' },
  inputKeys: ['yA', 'xA', 'yB', 'xB', 'value', 'mode'],
  normalize(raw) {
    assertPlainObject(raw);
    const out = {};
    for (const field of ['yA', 'xA', 'yB', 'xB', 'value']) out[field] = toFiniteNumber(raw[field], field);
    const mode = raw.mode === undefined ? 'distance' : raw.mode;
    if (!MODES.includes(mode)) {
      throw new EngineError('INVALID_MODE', 'Режимът трябва да бъде „distance“ или „ratio“', 'mode');
    }
    out.mode = mode;
    return out;
  },
  validate({ yA, xA, yB, xB, value, mode }) {
    const len = Math.hypot(yB - yA, xB - xA);
    if (len < 1e-12) {
      throw new EngineError('COINCIDENT_POINTS', 'Точките A и B съвпадат');
    }
    if (mode === 'ratio') {
      if (value < 0 || value > 1) {
        throw new EngineError('OUT_OF_RANGE', 'Пропорцията k трябва да е между 0 и 1', 'value');
      }
    } else if (value < 0 || value > len) {
      throw new EngineError('OUT_OF_RANGE', `Разстоянието s=${value.toFixed(3)} m е извън отсечката (0…${len.toFixed(3)} m)`, 'value');
    }
  },
  compute({ yA, xA, yB, xB, value, mode }) {
    const dy = yB - yA;
    const dx = xB - xA;
    const len = Math.hypot(dy, dx);
    const t = mode === 'ratio' ? value : value / len;
    return { yP: yA + t * dy, xP: xA + t * dx };
  },
  persisted: [['yP', null], ['xP', null]],
});

module.exports = { engines: [engine] };
