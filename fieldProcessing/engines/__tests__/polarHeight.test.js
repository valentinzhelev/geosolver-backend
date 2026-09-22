const { getCurrentEngine } = require('../registry');

const zenith = getCurrentEngine('polar-height-zenith');
const vertical = getCurrentEngine('polar-height-vertical');

describe('polar-height-zenith v1: slope-distance reduction, golden geometry (V2.4.1 section 15 J)', () => {
  it('a horizontal shot (zenith 100 gon) reduces to the full slope distance, zero vertical rise', () => {
    const r = zenith.run({ slopeDistance: 50, zenithGon: 100 }).full;
    expect(r.horizontalDistance).toBeCloseTo(50, 9);
    expect(r.verticalRise).toBeCloseTo(0, 9);
  });

  it('looking straight up (zenith 0) gives the full slope distance as vertical rise, zero horizontal', () => {
    const r = zenith.run({ slopeDistance: 50, zenithGon: 0 }).full;
    expect(r.horizontalDistance).toBeCloseTo(0, 9);
    expect(r.verticalRise).toBeCloseTo(50, 9);
  });

  it('looking straight down (zenith 200) gives a negative vertical rise of the full slope distance', () => {
    const r = zenith.run({ slopeDistance: 50, zenithGon: 200 }).full;
    expect(r.horizontalDistance).toBeCloseTo(0, 6);
    expect(r.verticalRise).toBeCloseTo(-50, 9);
  });

  it('45 degrees from zenith (50 gon): both components equal slopeDistance / sqrt(2)', () => {
    const r = zenith.run({ slopeDistance: 100 * Math.SQRT2, zenithGon: 50 }).full;
    expect(r.horizontalDistance).toBeCloseTo(100, 6);
    expect(r.verticalRise).toBeCloseTo(100, 6);
  });

  it('requires only slope distance and the angle - no height inputs needed for X/Y', () => {
    expect(Object.keys(zenith.run({ slopeDistance: 10, zenithGon: 100 }).input).sort()).toEqual(['slopeDistance', 'zenithGon']);
  });

  it('rejects a zenith angle outside [0, 200] gon (not a valid physical reading)', () => {
    expect(() => zenith.run({ slopeDistance: 10, zenithGon: 250 })).toThrow();
    expect(() => zenith.run({ slopeDistance: 10, zenithGon: -5 })).toThrow();
  });

  it('rejects a non-positive slope distance', () => {
    expect(() => zenith.run({ slopeDistance: 0, zenithGon: 100 })).toThrow();
  });
});

describe('polar-height-vertical v1: the "from horizon" convention is genuinely different from zenith', () => {
  it('a horizontal shot (vertical angle 0) reduces to the full slope distance, zero vertical rise - same physical result as zenith 100', () => {
    const r = vertical.run({ slopeDistance: 50, verticalGon: 0 }).full;
    expect(r.horizontalDistance).toBeCloseTo(50, 9);
    expect(r.verticalRise).toBeCloseTo(0, 9);
  });

  it('a positive vertical angle (looking up) gives a positive vertical rise', () => {
    const r = vertical.run({ slopeDistance: 100, verticalGon: 100 }).full; // straight up
    expect(r.verticalRise).toBeCloseTo(100, 6);
    expect(r.horizontalDistance).toBeCloseTo(0, 6);
  });

  it('the SAME raw angle number means something different under each convention (never interchangeable)', () => {
    const z90 = zenith.run({ slopeDistance: 100, zenithGon: 90 }).full; // 10 gon above horizon
    const v90 = vertical.run({ slopeDistance: 100, verticalGon: 90 }).full; // 90 gon above horizon (steep)
    expect(z90.verticalRise).not.toBeCloseTo(v90.verticalRise, 3);
    const z50 = zenith.run({ slopeDistance: 100, zenithGon: 50 }).full;
    const v50 = vertical.run({ slopeDistance: 100, verticalGon: 50 }).full;
    expect(z50.verticalRise).toBeCloseTo(v50.verticalRise, 6); // the 45-degree coincidence, confirmed rather than assumed
  });

  it('rejects a vertical angle outside [-100, 100] gon', () => {
    expect(() => vertical.run({ slopeDistance: 10, verticalGon: 150 })).toThrow();
    expect(() => vertical.run({ slopeDistance: 10, verticalGon: -150 })).toThrow();
  });
});
