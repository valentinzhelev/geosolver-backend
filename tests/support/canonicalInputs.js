/**
 * Test support (not a test file): one VALID persisted-input body per professional tool, taken from the
 * frozen golden fixtures so route tests exercise real, mathematically valid inputs.
 */
const persisted = require('../../engines/fixtures/persistedVectors.json');
const second = require('../../engines/fixtures/secondTask.shipped.vectors.json');
const area = require('../../engines/fixtures/areaCalculation.shipped.vectors.json');

const VALID_INPUTS = {};
for (const [tool, t] of Object.entries(persisted.tools)) VALID_INPUTS[tool] = t.vectors[0].input;
VALID_INPUTS['second-basic-task'] = second.vectors.find((v) => v.name === 'quadrant I, 3-4-5').input;
VALID_INPUTS['area-calculation'] = {
  points: area.calc[0].points.map(([x, y]) => ({ x, y })),
  method: 'shoelace',
};

// Contract version a current (post-canonical) frontend sends.
const CURRENT_CLIENT_CONTRACT = 2;

const TOOLS = Object.keys(VALID_INPUTS);

module.exports = { VALID_INPUTS, TOOLS, CURRENT_CLIENT_CONTRACT };
