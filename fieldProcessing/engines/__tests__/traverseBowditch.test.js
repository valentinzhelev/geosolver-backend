const { getCurrentEngine } = require('../registry');
const { EngineError } = require('../../../engines/errors');

const engine = getCurrentEngine('traverse-bowditch');

describe('traverse-bowditch v1: classic compass-rule adjustment', () => {
  it('E. proportional corrections: equal-length legs split the misclosure equally', () => {
    const r = engine.run({
      legs: [{ length: 100, rawDeltaX: 10, rawDeltaY: 0 }, { length: 100, rawDeltaX: 20, rawDeltaY: 0 }],
      fX: 6, fY: 0, totalLength: 200,
    });
    expect(r.resultData.corrections[0]).toEqual({ cX: -3, cY: -0, adjustedDeltaX: 7, adjustedDeltaY: 0 });
    expect(r.resultData.corrections[1]).toEqual({ cX: -3, cY: -0, adjustedDeltaX: 17, adjustedDeltaY: 0 });
  });

  it('F. unequal leg lengths: corrections are weighted by distance, not split evenly', () => {
    // total 300, leg1=100 (1/3), leg2=200 (2/3). fX=6 -> cX1=-2, cX2=-4 (independently derived).
    const r = engine.run({
      legs: [{ length: 100, rawDeltaX: 10, rawDeltaY: 0 }, { length: 200, rawDeltaX: 20, rawDeltaY: 0 }],
      fX: 6, fY: 0, totalLength: 300,
    });
    expect(r.resultData.corrections[0].cX).toBeCloseTo(-2, 9);
    expect(r.resultData.corrections[1].cX).toBeCloseTo(-4, 9);
    expect(r.resultData.corrections[0].cX).not.toBeCloseTo(r.resultData.corrections[1].cX, 9); // proves it's weighted, not split evenly
  });

  it('property: sum(cX) = -fX and sum(cY) = -fY for any leg-length distribution', () => {
    const cases = [
      { legs: [{ length: 50, rawDeltaX: 1, rawDeltaY: 1 }, { length: 150, rawDeltaX: 2, rawDeltaY: -2 }, { length: 100, rawDeltaX: -1, rawDeltaY: 3 }], fX: 0.05, fY: -0.02 },
      { legs: [{ length: 33.3, rawDeltaX: 5, rawDeltaY: 5 }, { length: 66.7, rawDeltaX: -3, rawDeltaY: 4 }], fX: -0.1, fY: 0.2 },
    ];
    for (const c of cases) {
      const totalLength = c.legs.reduce((s, l) => s + l.length, 0);
      const r = engine.run({ legs: c.legs, fX: c.fX, fY: c.fY, totalLength });
      const sumCX = r.resultData.corrections.reduce((s, corr) => s + corr.cX, 0);
      const sumCY = r.resultData.corrections.reduce((s, corr) => s + corr.cY, 0);
      expect(sumCX).toBeCloseTo(-c.fX, 9);
      expect(sumCY).toBeCloseTo(-c.fY, 9);
    }
  });

  it('property: zero misclosure produces zero corrections for every leg', () => {
    const r = engine.run({
      legs: [{ length: 40, rawDeltaX: 1, rawDeltaY: 1 }, { length: 60, rawDeltaX: 2, rawDeltaY: -1 }],
      fX: 0, fY: 0, totalLength: 100,
    });
    for (const corr of r.resultData.corrections) {
      expect(corr.cX).toBe(-0);
      expect(corr.cY).toBe(-0);
    }
  });

  it('G. adjusted endpoint equals the known control when corrections are accumulated', () => {
    // A 2-leg open path from (0,0) with a deliberate misclosure against a known endpoint of (30, 10).
    const legs = [{ length: 100, rawDeltaX: 10, rawDeltaY: 5 }, { length: 100, rawDeltaX: 19.9, rawDeltaY: 4.98 }];
    const rawEndX = legs.reduce((s, l) => s + l.rawDeltaX, 0); // 29.9
    const rawEndY = legs.reduce((s, l) => s + l.rawDeltaY, 0); // 9.98
    const fX = rawEndX - 30; // -0.1 (raw minus known, per traverse-closure's convention)
    const fY = rawEndY - 10; // -0.02
    const totalLength = 200;
    const r = engine.run({ legs, fX, fY, totalLength });
    const adjustedEndX = legs.reduce((s, l, i) => s + l.rawDeltaX + r.resultData.corrections[i].cX, 0);
    const adjustedEndY = legs.reduce((s, l, i) => s + l.rawDeltaY + r.resultData.corrections[i].cY, 0);
    expect(adjustedEndX).toBeCloseTo(30, 9);
    expect(adjustedEndY).toBeCloseTo(10, 9);
  });

  it('rejects an empty leg list, a non-positive total length, and a non-positive leg length', () => {
    expect(() => engine.run({ legs: [], fX: 0, fY: 0, totalLength: 100 })).toThrow(EngineError);
    expect(() => engine.run({ legs: [{ length: 100, rawDeltaX: 1, rawDeltaY: 1 }], fX: 0, fY: 0, totalLength: 0 })).toThrow(EngineError);
    expect(() => engine.run({ legs: [{ length: 0, rawDeltaX: 1, rawDeltaY: 1 }], fX: 0, fY: 0, totalLength: 100 })).toThrow(EngineError);
  });
});
