/**
 * Small engine benchmark (no framework): mean cost of one full canonical run
 * (normalize -> validate -> compute -> format) per professional engine, in microseconds.
 *   node scripts/bench-engines.js
 * Compare with HTTP + MongoDB latency (milliseconds): the mathematics is negligible.
 */
const registry = require('../engines/registry');
const { VALID_INPUTS } = require('../tests/support/canonicalInputs');

const RUNS = Number(process.env.BENCH_RUNS) || 20000;

function bench(engine, input) {
  for (let i = 0; i < 500; i++) engine.run(input); // warm-up (JIT)
  const start = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) engine.run(input);
  const ns = Number(process.hrtime.bigint() - start);
  return ns / RUNS / 1000; // microseconds per run
}

const rows = [];
for (const tool of registry.listTools()) {
  rows.push({ tool, version: registry.getCurrentEngine(tool).version, microseconds: bench(registry.getCurrentEngine(tool), VALID_INPUTS[tool]) });
}
rows.sort((a, b) => b.microseconds - a.microseconds);

console.log(`Canonical engine cost per calculation (mean of ${RUNS} runs, Node ${process.version})`);
for (const r of rows) console.log(`${r.tool.padEnd(28)} v${r.version}  ${r.microseconds.toFixed(2).padStart(8)} µs`);
const worst = rows[0];
console.log(`\nWorst: ${worst.tool} at ${worst.microseconds.toFixed(2)} µs (${(worst.microseconds / 1000).toFixed(4)} ms)`);

module.exports = { rows };
