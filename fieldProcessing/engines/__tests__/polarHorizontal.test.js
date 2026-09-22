const { getCurrentEngine } = require('../registry');

const engine = getCurrentEngine('polar-horizontal');
const run = (input) => engine.run(input).resultData;

describe('polar-horizontal v1: golden geometry (V2.4.1 section 15 A-E, G)', () => {
  it('A. North: direction 0 gon, distance 100 -> X+100, Y unchanged', () => {
    expect(run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 0, horizontalDistance: 100 })).toMatchObject({ x: 100, y: 0 });
  });

  it('B. East: 100 gon -> Y+100', () => {
    expect(run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 100, horizontalDistance: 100 })).toMatchObject({ x: 0, y: 100 });
  });

  it('C. South: 200 gon -> X-100', () => {
    const r = run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 200, horizontalDistance: 100 });
    expect(r.x).toBeCloseTo(-100, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('D. West: 300 gon -> Y-100', () => {
    const r = run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 300, horizontalDistance: 100 });
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(-100, 6);
  });

  it('E. known arbitrary geometry: 50 gon (45deg) from a non-origin station, independently derived expected deltas', () => {
    // distance = 100*sqrt(2), at 45 degrees both deltas are exactly 100 (independently computed by hand)
    const r = run({ xStation: 1000, yStation: 2000, orientationConstantGon: 0, hzGon: 50, horizontalDistance: 100 * Math.SQRT2 });
    expect(r.x).toBeCloseTo(1100, 6);
    expect(r.y).toBeCloseTo(2100, 6);
  });

  it('G. wrap-around near 400 gon: orientationConstant 390 + Hz 20 wraps to direction 10 gon (= case B rotated)', () => {
    const wrapped = engine.run({ xStation: 0, yStation: 0, orientationConstantGon: 390, hzGon: 20, horizontalDistance: 100 }).full;
    const direct = engine.run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 10, horizontalDistance: 100 }).full;
    expect(wrapped.directionGon).toBeCloseTo(10, 9);
    expect(wrapped.x).toBeCloseTo(direct.x, 9);
    expect(wrapped.y).toBeCloseTo(direct.y, 9);
  });

  it('rejects a non-positive horizontal distance rather than computing a degenerate result', () => {
    expect(() => run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 0, horizontalDistance: 0 })).toThrow();
    expect(() => run({ xStation: 0, yStation: 0, orientationConstantGon: 0, hzGon: 0, horizontalDistance: -5 })).toThrow();
  });

  it('is versioned and immutable', () => {
    expect(engine.version).toBe(1);
    expect(engine.toolName).toBe('polar-horizontal');
    expect(Object.isFrozen(engine)).toBe(true);
  });
});
