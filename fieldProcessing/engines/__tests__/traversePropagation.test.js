const { getCurrentEngine } = require('../registry');
const { EngineError } = require('../../../engines/errors');

const engine = getCurrentEngine('traverse-propagation');

describe('traverse-propagation v1: golden geometry (A, B, G)', () => {
  it('A. single north leg: bearing 0g, distance 100 from (0,0) -> (100, 0)', () => {
    const r = engine.run({ xStation: 0, yStation: 0, bearingGon: 0, horizontalDistance: 100 });
    expect(r.resultData).toEqual({ deltaX: 100, deltaY: 0, x: 100, y: 0 });
  });

  it('B. east leg: bearing 100g, distance 50 -> deltaY +50, deltaX ~0', () => {
    const r = engine.run({ xStation: 100, yStation: 0, bearingGon: 100, horizontalDistance: 50 });
    expect(r.resultData.deltaX).toBeCloseTo(0, 9);
    expect(r.resultData.deltaY).toBeCloseTo(50, 9);
    expect(r.resultData.y).toBeCloseTo(50, 9);
  });

  it('south leg: bearing 200g -> deltaX negative', () => {
    const r = engine.run({ xStation: 0, yStation: 0, bearingGon: 200, horizontalDistance: 100 });
    expect(r.resultData.deltaX).toBeCloseTo(-100, 9);
    expect(r.resultData.deltaY).toBeCloseTo(0, 9);
  });

  it('west leg: bearing 300g -> deltaY negative', () => {
    const r = engine.run({ xStation: 0, yStation: 0, bearingGon: 300, horizontalDistance: 100 });
    expect(r.resultData.deltaX).toBeCloseTo(0, 9);
    expect(r.resultData.deltaY).toBeCloseTo(-100, 9);
  });

  it('G. wrap-around near 400g behaves identically to the equivalent small angle', () => {
    const near400 = engine.run({ xStation: 0, yStation: 0, bearingGon: 399.9999999, horizontalDistance: 100 });
    const nearZero = engine.run({ xStation: 0, yStation: 0, bearingGon: 0, horizontalDistance: 100 });
    expect(near400.resultData.x).toBeCloseTo(nearZero.resultData.x, 3);
    expect(near400.resultData.y).toBeCloseTo(nearZero.resultData.y, 3);
  });

  it('rejects a non-positive horizontal distance rather than silently propagating garbage', () => {
    expect(() => engine.run({ xStation: 0, yStation: 0, bearingGon: 0, horizontalDistance: 0 })).toThrow(EngineError);
    expect(() => engine.run({ xStation: 0, yStation: 0, bearingGon: 0, horizontalDistance: -5 })).toThrow(EngineError);
  });

  it('is a pure function: same input always produces the identical output object shape', () => {
    const a = engine.run({ xStation: 10, yStation: 20, bearingGon: 133.25, horizontalDistance: 45.5 });
    const b = engine.run({ xStation: 10, yStation: 20, bearingGon: 133.25, horizontalDistance: 45.5 });
    expect(a.resultData).toEqual(b.resultData);
  });
});
