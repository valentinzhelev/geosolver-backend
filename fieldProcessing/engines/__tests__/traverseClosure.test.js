const { getCurrentEngine } = require('../registry');
const { EngineError } = require('../../../engines/errors');

const engine = getCurrentEngine('traverse-closure');

describe('traverse-closure v1', () => {
  it('C/R. a perfect closure (raw endpoint === known endpoint) reports zero misclosure, not a fake ratio', () => {
    const r = engine.run({ rawEndX: 0, rawEndY: 0, knownEndX: 0, knownEndY: 0, totalLength: 400 });
    expect(r.resultData).toEqual({ fX: 0, fY: 0, linearMisclosure: 0, perfectClosure: true, relativeClosureDenominator: null });
  });

  it('D. a deliberate X/Y misclosure: independently derived fX/fY/linear misclosure and relative ratio', () => {
    // Endpoint control at (500, 300); raw computed endpoint at (500.032, 299.982) - a small, deliberate offset.
    // Matches V2.4.2 section 19's own worked example signs exactly: fX = raw - known = +0.032, fY = -0.018.
    const r = engine.run({ rawEndX: 500.032, rawEndY: 299.982, knownEndX: 500, knownEndY: 300, totalLength: 684.225 });
    expect(r.resultData.fX).toBeCloseTo(0.032, 9);
    expect(r.resultData.fY).toBeCloseTo(-0.018, 9);
    // linearMisclosure = sqrt(0.032^2 + 0.018^2) = sqrt(0.001024 + 0.000324) = sqrt(0.001348) = 0.036714...
    const expectedMisclosure = Math.sqrt(0.032 * 0.032 + 0.018 * 0.018);
    expect(r.resultData.linearMisclosure).toBeCloseTo(expectedMisclosure, 9);
    expect(r.resultData.perfectClosure).toBe(false);
    // relative closure 684.225 / 0.036714... ~= 18635 (independently computed, not derived from the engine itself)
    expect(r.resultData.relativeClosureDenominator).toBeCloseTo(684.225 / expectedMisclosure, 6);
  });

  it('rejects a non-positive total length rather than dividing by zero', () => {
    expect(() => engine.run({ rawEndX: 0, rawEndY: 0, knownEndX: 1, knownEndY: 1, totalLength: 0 })).toThrow(EngineError);
    expect(() => engine.run({ rawEndX: 0, rawEndY: 0, knownEndX: 1, knownEndY: 1, totalLength: -10 })).toThrow(EngineError);
  });
});
