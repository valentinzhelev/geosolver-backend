const registry = require('../registry');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

// Basic cost check, deliberately loose (CI machines vary): a canonical run must stay far below
// the millisecond-scale cost of an HTTP round trip plus a MongoDB write. scripts/bench-engines.js
// prints the actual numbers. Resection is the heaviest engine (two circles, a solve, a condition
// number) and is asserted separately.
const RUNS = 3000;
const LIMIT_MICROSECONDS = 1000; // 1 ms

function meanMicroseconds(engine, input) {
  for (let i = 0; i < 200; i++) engine.run(input);
  const start = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) engine.run(input);
  return Number(process.hrtime.bigint() - start) / RUNS / 1000;
}

describe('canonical engine cost is negligible next to HTTP/database latency', () => {
  it.each(registry.listTools())('%s: mean run well under 1 ms', (tool) => {
    expect(meanMicroseconds(registry.getCurrentEngine(tool), VALID_INPUTS[tool])).toBeLessThan(LIMIT_MICROSECONDS);
  });

  it('resection (the heaviest engine) also stays under 1 ms, including its failure paths', () => {
    const engine = registry.getCurrentEngine('resection');
    expect(meanMicroseconds(engine, VALID_INPUTS.resection)).toBeLessThan(LIMIT_MICROSECONDS);
    const bad = { ...VALID_INPUTS.resection, beta1: 150, beta2: 300 };
    const start = process.hrtime.bigint();
    for (let i = 0; i < RUNS; i++) {
      try { engine.run(bad); } catch (e) { /* structured EngineError expected */ }
    }
    expect(Number(process.hrtime.bigint() - start) / RUNS / 1000).toBeLessThan(LIMIT_MICROSECONDS);
  });
});
