const { degToGon, gonToDeg, toGon, normalizeGon, gonToRad, FULL_TURN_GON } = require('../angleUnits');
const { parseAngle } = require('../../../capture/notebook/angles');

describe('degree/gon equivalence (item H)', () => {
  it.each([[0, 0], [90, 100], [180, 200], [270, 300], [360, 400], [45, 50]])('%s deg -> %s gon', (deg, gon) => {
    expect(degToGon(deg)).toBeCloseTo(gon, 9);
    expect(toGon(deg, 'deg')).toBeCloseTo(gon, 9);
  });
  it.each([[100, 90], [200, 180], [50, 45]])('%s gon -> %s deg', (gon, deg) => {
    expect(gonToDeg(gon)).toBeCloseTo(deg, 9);
  });
  it('toGon is the identity for gon', () => {
    expect(toGon(123.456, 'gon')).toBe(123.456);
  });
  it('rejects an unknown unit rather than guessing', () => {
    expect(() => toGon(1, 'mils')).toThrow(/unknown angle unit/);
  });
});

describe('normalizeGon: deterministic [0,400) wrap (item G)', () => {
  it.each([
    [0, 0], [399.999, 399.999], [400, 0], [800, 0], [410, 10],
    [-1, 399], [-340, 60], [-400, 0], [-410, 390],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeGon(input)).toBeCloseTo(expected, 9);
  });
  it('is always in [0, 400)', () => {
    for (const v of [1e6, -1e6, 400.0001, -0.0001]) {
      const n = normalizeGon(v);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(FULL_TURN_GON);
    }
  });
});

describe('DMS normalization equivalence (item I): a Capture-confirmed DMS reading converts to the same gon value as the equivalent decimal-degree/gon reading', () => {
  it('90 deg == 90°00\'00" == 100 gon', () => {
    const fromDms = parseAngle('90°00\'00"');
    expect(fromDms.status).toBe('ok');
    expect(fromDms.unit).toBe('deg');
    expect(toGon(fromDms.value, fromDms.unit)).toBeCloseTo(100, 9);
  });

  it('an arbitrary DMS reading matches its independently-computed decimal-degree gon equivalent', () => {
    // 45 deg 30 min = 45.5 deg (independently computed) -> 45.5 * 400/360 gon
    const fromDms = parseAngle("45°30'00\"");
    expect(fromDms.value).toBeCloseTo(45.5, 9);
    expect(toGon(fromDms.value, fromDms.unit)).toBeCloseTo((45.5 * 400) / 360, 9);
  });
});

describe('gonToRad', () => {
  it.each([[0, 0], [100, Math.PI / 2], [200, Math.PI], [400, 2 * Math.PI]])('%s gon -> %s rad', (gon, rad) => {
    expect(gonToRad(gon)).toBeCloseTo(rad, 9);
  });
});
