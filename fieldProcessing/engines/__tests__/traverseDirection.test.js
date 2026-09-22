const { getCurrentEngine } = require('../registry');

const engine = getCurrentEngine('traverse-direction');

describe('traverse-direction v1: back-bearing + Hz readings -> forward bearing', () => {
  it('zeroed backsight, straight-ahead sight (Hz_forward = Hz_back + 200g) continues on the same bearing', () => {
    // incoming bearing 0g (north): back-bearing is 200g. Zeroed on it (Hz_back=0), sighting straight ahead again
    // means turning another 200g from the backsight reading (Hz_forward=200) -> forward bearing stays 0g (north).
    const r = engine.run({ alphaIncomingGon: 0, hzBackGon: 0, hzForwardGon: 200 });
    expect(r.resultData.alphaBackGon).toBe(200);
    expect(r.resultData.orientationConstantGon).toBe(200);
    expect(r.resultData.forwardBearingGon).toBe(0);
  });

  it('turns 90g (east, independently derived): alphaIncoming=0, hzBack=0, hzForward=300 -> forwardBearing=100', () => {
    const r = engine.run({ alphaIncomingGon: 0, hzBackGon: 0, hzForwardGon: 300 });
    expect(r.resultData.forwardBearingGon).toBe(100);
  });

  it('a non-zero backsight reading is subtracted out via the orientation constant, not applied twice', () => {
    // alphaIncoming=50 -> alphaBack=250. Instrument reads 40g while sighting back (not zeroed) -> constant=210.
    // Reads 310g sighting forward -> forwardBearing = normalize(210+310) = 120.
    const r = engine.run({ alphaIncomingGon: 50, hzBackGon: 40, hzForwardGon: 310 });
    expect(r.resultData.orientationConstantGon).toBe(210);
    expect(r.resultData.forwardBearingGon).toBe(120);
  });

  it('wraps deterministically near the 400g boundary', () => {
    const r = engine.run({ alphaIncomingGon: 390, hzBackGon: 0, hzForwardGon: 30 });
    // alphaBack = normalize(390+200) = normalize(590) = 190. constant = 190. forward = normalize(190+30) = 220.
    expect(r.resultData.alphaBackGon).toBe(190);
    expect(r.resultData.forwardBearingGon).toBe(220);
  });

  it('never produces a value outside [0, 400)', () => {
    for (const alpha of [0, 133.333, 399.999, -0]) {
      for (const back of [0, 199.5, 399.9999]) {
        for (const fwd of [0, 250, 399.5]) {
          const r = engine.run({ alphaIncomingGon: alpha, hzBackGon: back, hzForwardGon: fwd });
          for (const v of Object.values(r.resultData)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(400);
          }
        }
      }
    }
  });
});
