const registry = require('../registry');
const contracts = require('../fixtures/persistedContracts.json');
const persisted = require('../fixtures/persistedVectors.json');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');
const { roundTo } = require('../numbers');

// The persisted-result contract per tool (saved key sets, per-field rounding) is frozen in
// fixtures/persistedContracts.json (byte-identical to the frontend fixture; see fixtureIntegrity.test.js).
// The canonical engines must reproduce it exactly.

describe.each(Object.entries(contracts.tools))('%s — persisted contract', (tool, contract) => {
  const engine = registry.getCurrentEngine(tool);

  it('persisted result fields and per-field rounding equal the contract', () => {
    expect(engine.persisted).toEqual(contract.persistedResult);
  });

  it('the saved input key set equals the contract', () => {
    expect([...engine.inputKeys].sort()).toEqual([...contract.persistedInput].sort());
  });

  it('normalized input contains ONLY the contract keys (unknown fields are stripped)', () => {
    const noisy = { ...VALID_INPUTS[tool], evil: 'x', __proto_like: 1, resultData: { x: 1 } };
    const normalized = engine.normalize(noisy);
    expect(Object.keys(normalized).sort()).toEqual([...contract.persistedInput].sort());
  });

  it('resultData has exactly the contract keys, in contract order', () => {
    const { resultData } = engine.run(VALID_INPUTS[tool]);
    expect(Object.keys(resultData)).toEqual(contract.persistedResult.map(([field]) => field));
  });

  it('every rounded field is really rounded to its contract decimals (idempotent), and unrounded fields are untouched doubles', () => {
    const { resultData, full } = engine.run(VALID_INPUTS[tool]);
    for (const [field, decimals] of contract.persistedResult) {
      if (decimals === 'string') {
        expect(typeof resultData[field]).toBe('string');
      } else if (typeof decimals === 'number') {
        expect(roundTo(resultData[field], decimals)).toBe(resultData[field]);
      } else {
        expect(resultData[field]).toBe(full[field]);
      }
    }
  });
});

describe('the contract fixture agrees with the golden vectors', () => {
  it('vector input keys equal the contract input keys for every tool', () => {
    for (const [tool, t] of Object.entries(persisted.tools)) {
      for (const v of t.vectors) {
        expect(Object.keys(v.input).sort()).toEqual([...contracts.tools[tool].persistedInput].sort());
      }
    }
  });

  it('rounding differs by tool exactly as shipped (no global standardization)', () => {
    const decimals = (tool) => contracts.tools[tool].persistedResult.map(([, d]) => d);
    expect(decimals('first-basic-task')).toEqual([3, 3, 3, 3]);
    expect(decimals('distance-bearing')).toEqual([3, 2]); // bearingGon: 2 dp
    expect(decimals('hansen-task')).toEqual([null, null]);
    expect(decimals('area-calculation')).toEqual([null]);
    expect(decimals('offset-point')).toEqual([null, null]);
    expect(decimals('resection')).toEqual([3, 3, 'string']);
  });
});
