const { toMeters } = require('../lengthUnits');

describe('toMeters: deterministic length-unit conversion', () => {
  it.each([
    [1.5, 'm', 1.5], [150, 'cm', 1.5], [1500, 'mm', 1.5], [0, 'cm', 0],
  ])('%s %s -> %s m', (value, unit, expected) => {
    expect(toMeters(value, unit)).toBeCloseTo(expected, 9);
  });

  it('rejects an unknown unit rather than guessing', () => {
    expect(() => toMeters(1, 'inch')).toThrow(/unknown length unit/);
  });
});
