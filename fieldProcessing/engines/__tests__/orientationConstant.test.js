const { getCurrentEngine } = require('../registry');

const engine = getCurrentEngine('orientation-constant');
const full = (input) => engine.run(input).full;

describe('orientation-constant v1: golden geometry (V2.4.1 section 15 F, G)', () => {
  it('F. backsight due north (bearing 0 gon): zeroed instrument (Hz=0) -> orientation constant 0', () => {
    const r = full({ xStation: 0, yStation: 0, xBacksight: 100, yBacksight: 0, observedHzGon: 0 });
    expect(r.bearingGon).toBeCloseTo(0, 9);
    expect(r.orientationConstantGon).toBeCloseTo(0, 9);
  });

  it('F. backsight due east (bearing 100 gon)', () => {
    const r = full({ xStation: 0, yStation: 0, xBacksight: 0, yBacksight: 100, observedHzGon: 0 });
    expect(r.bearingGon).toBeCloseTo(100, 9);
  });

  it('F. a non-zero observed Hz to the backsight offsets the orientation constant by exactly that amount', () => {
    const r = full({ xStation: 0, yStation: 0, xBacksight: 100, yBacksight: 0, observedHzGon: 50 });
    // bearing 0, observed 50 -> constant = normalizeGon(0-50) = 350
    expect(r.orientationConstantGon).toBeCloseTo(350, 9);
  });

  it('G. wrap-around: bearing 10, observed 350 -> constant wraps to 60, not -340', () => {
    const r = full({ xStation: 0, yStation: 0, xBacksight: 100 * Math.cos((10 * Math.PI) / 200), yBacksight: 100 * Math.sin((10 * Math.PI) / 200), observedHzGon: 350 });
    expect(r.bearingGon).toBeCloseTo(10, 6);
    expect(r.orientationConstantGon).toBeCloseTo(60, 6);
    expect(r.orientationConstantGon).toBeGreaterThanOrEqual(0);
    expect(r.orientationConstantGon).toBeLessThan(400);
  });

  it('arbitrary known geometry: 45-degree bearing (50 gon)', () => {
    const r = full({ xStation: 1000, yStation: 2000, xBacksight: 1000 + 100 * Math.SQRT2, yBacksight: 2000 + 100 * Math.SQRT2, observedHzGon: 0 });
    expect(r.bearingGon).toBeCloseTo(50, 6);
  });

  it('rejects a coincident station/backsight pair (no direction is defined)', () => {
    expect(() => engine.run({ xStation: 5, yStation: 5, xBacksight: 5, yBacksight: 5, observedHzGon: 0 })).toThrow();
  });

  it('is versioned and immutable', () => {
    expect(engine.version).toBe(1);
    expect(Object.isFrozen(engine)).toBe(true);
  });
});
