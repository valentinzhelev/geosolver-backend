const { getCurrentEngine } = require('../registry');

const zenith = getCurrentEngine('polar-height-zenith');
const vertical = getCurrentEngine('polar-height-vertical');

describe('polar-height-zenith v1: golden geometry (V2.4.1 section 15 J, K, L)', () => {
  it('J. a horizontal shot (zenith 100 gon) reduces to the full slope distance, zero vertical rise', () => {
    const r = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 50, zenithGon: 100 }).full;
    expect(r.horizontalDistance).toBeCloseTo(50, 9);
    expect(r.verticalRise).toBeCloseTo(0, 9);
  });

  it('J. looking straight up (zenith 0) gives the full slope distance as vertical rise, zero horizontal', () => {
    const r = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 50, zenithGon: 0 }).full;
    expect(r.horizontalDistance).toBeCloseTo(0, 9);
    expect(r.verticalRise).toBeCloseTo(50, 9);
  });

  it('J. looking straight down (zenith 200) gives a negative vertical rise of the full slope distance', () => {
    const r = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 50, zenithGon: 200 }).full;
    expect(r.horizontalDistance).toBeCloseTo(0, 6);
    expect(r.verticalRise).toBeCloseTo(-50, 9);
  });

  it('J. 45 degrees from zenith (50 gon): both components equal slopeDistance / sqrt(2)', () => {
    const r = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100 * Math.SQRT2, zenithGon: 50 }).full;
    expect(r.horizontalDistance).toBeCloseTo(100, 6);
    expect(r.verticalRise).toBeCloseTo(100, 6);
  });

  it('K. height combines station H, instrument height, vertical rise and prism height (independently derived)', () => {
    const r = zenith.run({ stationH: 100, instrumentHeight: 1.5, prismHeight: 2.0, slopeDistance: 50, zenithGon: 100 }).resultData;
    // horizontal shot -> verticalRise 0 -> h = 100 + 1.5 + 0 - 2.0 = 99.5
    expect(r.h).toBeCloseTo(99.5, 6);
  });

  it('K. height with a real vertical rise (zenith 0, straight up)', () => {
    const r = zenith.run({ stationH: 100, instrumentHeight: 1.5, prismHeight: 2.0, slopeDistance: 50, zenithGon: 0 }).resultData;
    // h = 100 + 1.5 + 50 - 2.0 = 149.5
    expect(r.h).toBeCloseTo(149.5, 6);
  });

  it('L. instrument height and prism height act symmetrically opposite on the result', () => {
    const withInstrument = zenith.run({ stationH: 100, instrumentHeight: 2, prismHeight: 0, slopeDistance: 50, zenithGon: 100 }).resultData;
    const withPrism = zenith.run({ stationH: 100, instrumentHeight: 0, prismHeight: 2, slopeDistance: 50, zenithGon: 100 }).resultData;
    expect(withInstrument.h - 100).toBeCloseTo(2, 9);
    expect(withPrism.h - 100).toBeCloseTo(-2, 9);
  });

  it('rejects a zenith angle outside [0, 200] gon (not a valid physical reading)', () => {
    expect(() => zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 10, zenithGon: 250 })).toThrow();
    expect(() => zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 10, zenithGon: -5 })).toThrow();
  });

  it('rejects a non-positive slope distance', () => {
    expect(() => zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 0, zenithGon: 100 })).toThrow();
  });
});

describe('polar-height-vertical v1: the "from horizon" convention is genuinely different from zenith', () => {
  it('a horizontal shot (vertical angle 0) reduces to the full slope distance, zero vertical rise - same physical result as zenith 100', () => {
    const r = vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 50, verticalGon: 0 }).full;
    expect(r.horizontalDistance).toBeCloseTo(50, 9);
    expect(r.verticalRise).toBeCloseTo(0, 9);
  });

  it('a positive vertical angle (looking up) gives a positive vertical rise', () => {
    const r = vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100, verticalGon: 100 }).full; // straight up
    expect(r.verticalRise).toBeCloseTo(100, 6);
    expect(r.horizontalDistance).toBeCloseTo(0, 6);
  });

  it('the SAME raw angle number means something different under each convention (never interchangeable)', () => {
    // 50 "zenith" gon (45 deg from up) vs 50 "vertical" gon (45 deg above horizon) give different vertical rises
    const z = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100, zenithGon: 50 }).full;
    const v = vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100, verticalGon: 50 }).full;
    // both happen to be 45 degrees from their own reference, so magnitudes coincide here - use a case where they diverge:
    const z90 = zenith.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100, zenithGon: 90 }).full; // 10 gon above horizon
    const v90 = vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 100, verticalGon: 90 }).full; // 90 gon above horizon (steep)
    expect(z90.verticalRise).not.toBeCloseTo(v90.verticalRise, 3);
    expect(z.verticalRise).toBeCloseTo(v.verticalRise, 6); // the 45-degree coincidence, confirmed rather than assumed
  });

  it('rejects a vertical angle outside [-100, 100] gon', () => {
    expect(() => vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 10, verticalGon: 150 })).toThrow();
    expect(() => vertical.run({ stationH: 0, instrumentHeight: 0, prismHeight: 0, slopeDistance: 10, verticalGon: -150 })).toThrow();
  });
});
