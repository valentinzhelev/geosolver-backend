const { getCurrentEngine } = require('../registry');

const combine = getCurrentEngine('height-combination');
const h = (input) => combine.run(input).resultData.h;

describe('height-combination v1: golden arithmetic (V2.4.1 section 15 K, L)', () => {
  it('K. combines station H, instrument height, vertical rise and prism height (independently derived)', () => {
    expect(h({ stationH: 100, instrumentHeight: 1.5, verticalRise: 0, prismHeight: 2.0 })).toBeCloseTo(99.5, 6);
  });

  it('K. with a non-zero vertical rise', () => {
    expect(h({ stationH: 100, instrumentHeight: 1.5, verticalRise: 50, prismHeight: 2.0 })).toBeCloseTo(149.5, 6);
  });

  it('L. instrument height and prism height act symmetrically opposite on the result', () => {
    const withInstrument = h({ stationH: 100, instrumentHeight: 2, verticalRise: 0, prismHeight: 0 });
    const withPrism = h({ stationH: 100, instrumentHeight: 0, verticalRise: 0, prismHeight: 2 });
    expect(withInstrument - 100).toBeCloseTo(2, 9);
    expect(withPrism - 100).toBeCloseTo(-2, 9);
  });

  it('L. instrument height and prism height cancel exactly when equal (a common real-world setup)', () => {
    expect(h({ stationH: 250.5, instrumentHeight: 1.6, verticalRise: 3.2, prismHeight: 1.6 })).toBeCloseTo(253.7, 6);
  });

  it('composes with a zenith reduction end to end for a known geometry', () => {
    const zenith = getCurrentEngine('polar-height-zenith');
    const reduced = zenith.run({ slopeDistance: 100 * Math.SQRT2, zenithGon: 50 }).full; // verticalRise ~ 100
    const result = combine.run({ stationH: 500, instrumentHeight: 1.5, verticalRise: reduced.verticalRise, prismHeight: 2.0 }).resultData;
    expect(result.h).toBeCloseTo(599.5, 3);
  });
});
