const engines = require('..');
const registry = require('../registry');
const { ENGINE_VERSIONS, getEngineVersion, isProjectCapableTool } = require('../../utils/engineVersions');
const { REQUIRED_CLIENT_CONTRACT, CURRENT_CLIENT_CONTRACT_VERSION } = require('../clientContract');
const contracts = require('../fixtures/persistedContracts.json');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

const EXPECTED = {
  'first-basic-task': 1,
  'second-basic-task': 1,
  'forward-intersection': 1,
  resection: 2,
  'polar-intersection': 1,
  'coordinate-transformation': 1,
  'hansen-task': 1,
  'area-calculation': 1,
  'distance-bearing': 1,
  'line-intersection': 1,
  'offset-point': 2,
  'segment-division': 1,
};

describe('canonical engine registry — versions', () => {
  it('current versions are exactly the approved map (offset-point 2, resection 2, ten tools at 1)', () => {
    expect(registry.currentVersions()).toEqual(EXPECTED);
  });

  it('current versions equal the persisted-contract fixture engine versions', () => {
    for (const [tool, contract] of Object.entries(contracts.tools)) {
      expect(registry.currentVersions()[tool]).toBe(contract.engineVersion);
    }
  });

  it('is keyed by (toolName, version): offset-point has v1 (historical) and v2; resection has ONLY v2', () => {
    expect(registry.listVersions('offset-point')).toEqual([1, 2]);
    expect(registry.getEngine('offset-point', 1).version).toBe(1);
    expect(registry.getEngine('offset-point', 2).version).toBe(2);
    expect(registry.listVersions('resection')).toEqual([2]);
    expect(registry.getEngine('resection', 1)).toBeNull(); // the noise-dependent v1 solver is never a verifier
    expect(registry.getEngine('first-basic-task', 2)).toBeNull();
    expect(registry.getEngine('nope', 1)).toBeNull();
  });

  it('the CURRENT engine is the one with the declared current version, never "the highest registered"', () => {
    expect(registry.getCurrentEngine('offset-point').version).toBe(2);
    expect(registry.getCurrentEngine('resection').version).toBe(2);
    for (const tool of registry.listTools()) {
      expect(registry.getCurrentEngine(tool).toolName).toBe(tool);
      expect(registry.getCurrentEngine(tool).version).toBe(EXPECTED[tool]);
    }
  });

  it('scientific-calculator has no engine and no version', () => {
    expect(registry.getCurrentEngine('scientific-calculator')).toBeNull();
    expect(registry.hasEngine('scientific-calculator')).toBe(false);
    expect(getEngineVersion('scientific-calculator')).toBeNull();
    expect(isProjectCapableTool('scientific-calculator')).toBe(false);
  });

  it('engines are immutable', () => {
    const engine = registry.getCurrentEngine('first-basic-task');
    expect(Object.isFrozen(engine)).toBe(true);
    expect(() => { 'use strict'; engine.version = 99; }).toThrow();
  });
});

describe('engine version stamping cannot drift from the dispatched engine', () => {
  it('utils/engineVersions is a thin, frozen view over the registry', () => {
    expect(ENGINE_VERSIONS).toEqual(registry.currentVersions());
    expect(Object.isFrozen(ENGINE_VERSIONS)).toBe(true);
    for (const tool of registry.listTools()) expect(getEngineVersion(tool)).toBe(registry.getCurrentEngine(tool).version);
  });

  it.each(Object.keys(EXPECTED))('%s: run() stamps the version of the engine that computed it', (tool) => {
    const engine = registry.getCurrentEngine(tool);
    const run = engine.run(VALID_INPUTS[tool]);
    expect(run.engineVersion).toBe(engine.version);
    expect(run.engineVersion).toBe(getEngineVersion(tool));
  });

  it('historical offset-point v1 stamps 1 when it computes, so a stamp always names its own engine', () => {
    const v1 = registry.getEngine('offset-point', 1);
    expect(v1.run(VALID_INPUTS['offset-point']).engineVersion).toBe(1);
  });
});

describe('stale-client compatibility table is consistent with the registry', () => {
  it('every tool whose current engine is above v1 requires a newer client contract — and only those', () => {
    const changed = Object.entries(EXPECTED).filter(([, v]) => v > 1).map(([t]) => t).sort();
    expect(Object.keys(REQUIRED_CLIENT_CONTRACT).sort()).toEqual(changed);
    for (const tool of changed) expect(REQUIRED_CLIENT_CONTRACT[tool]).toBeGreaterThanOrEqual(2);
  });

  it('no requirement exceeds the contract version the current frontend sends', () => {
    for (const required of Object.values(REQUIRED_CLIENT_CONTRACT)) {
      expect(required).toBeLessThanOrEqual(CURRENT_CLIENT_CONTRACT_VERSION);
    }
  });
});

describe('client contract gate', () => {
  it('rejects a missing, implicit or too-old contract for offset-point and resection', () => {
    for (const tool of ['offset-point', 'resection']) {
      for (const v of [undefined, null, 1, 0, '2', 'x', 1.5, -1]) {
        const r = engines.checkClientContract(tool, v);
        expect(r.ok).toBe(false);
        expect(r.code).toBe('CLIENT_REFRESH_REQUIRED');
        expect(r.required).toBe(2);
      }
    }
  });

  it('accepts the current contract and newer ones', () => {
    for (const tool of ['offset-point', 'resection']) {
      expect(engines.checkClientContract(tool, 2).ok).toBe(true);
      expect(engines.checkClientContract(tool, 3).ok).toBe(true);
    }
  });

  it('never blocks the ten tools whose client-side math did not change (stale clients keep working)', () => {
    for (const tool of Object.keys(EXPECTED).filter((t) => t !== 'offset-point' && t !== 'resection')) {
      expect(engines.checkClientContract(tool, undefined).ok).toBe(true);
      expect(engines.checkClientContract(tool, 1).ok).toBe(true);
    }
  });

  it('the refresh message is Bulgarian and tells the user to refresh', () => {
    const r = engines.checkClientContract('resection', undefined);
    expect(r.error).toMatch(/опреснете/);
  });
});
