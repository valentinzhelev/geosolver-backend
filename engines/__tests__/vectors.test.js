const registry = require('../registry');
const persisted = require('../fixtures/persistedVectors.json');
const secondVectors = require('../fixtures/secondTask.shipped.vectors.json');
const areaVectors = require('../fixtures/areaCalculation.shipped.vectors.json');
const offsetV1 = require('../fixtures/orthogonalOffset.v1.legacy.vectors.json');
const contracts = require('../fixtures/persistedContracts.json');

// Golden persisted vectors: input -> persisted resultData. Rounded fields must match EXACTLY (same
// operations, same doubles); unrounded fields are compared with a tolerance — never bit equality of
// calculated floating values.

function expectPersistedMatch(engine, actual, expected) {
  for (const [field, decimals] of engine.persisted) {
    if (typeof decimals === 'number' || decimals === 'string') {
      expect(actual[field]).toBe(expected[field]);
    } else {
      expect(actual[field]).toBeCloseTo(expected[field], 9);
    }
  }
}

describe('golden persisted vectors (ten domain-layer tools)', () => {
  const cases = Object.entries(persisted.tools).flatMap(([tool, t]) => t.vectors.map((v) => [`${tool}: ${v.name}`, tool, t.engineVersion, v]));

  it('covers exactly the ten tools whose vectors live in persistedVectors.json', () => {
    expect(Object.keys(persisted.tools).sort()).toEqual(
      ['coordinate-transformation', 'distance-bearing', 'first-basic-task', 'forward-intersection', 'hansen-task',
        'line-intersection', 'offset-point', 'polar-intersection', 'resection', 'segment-division']
    );
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)('%s', (_label, tool, version, v) => {
    const engine = registry.getEngine(tool, version);
    expect(engine).not.toBeNull();
    expect(engine.version).toBe(contracts.tools[tool].engineVersion);
    const { resultData } = engine.run(v.input);
    expectPersistedMatch(engine, resultData, v.result);
  });
});

describe('second-basic-task — shipped vectors', () => {
  const engine = registry.getCurrentEngine('second-basic-task');

  it.each(secondVectors.vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    const { resultData } = engine.run(v.input);
    expectPersistedMatch(engine, resultData, v.result);
  });

  it.each(secondVectors.errors.map((e) => [e.name, e]))('rejects: %s', (_name, e) => {
    expect(() => engine.run(e.input)).toThrow(e.message);
    try {
      engine.run(e.input);
    } catch (err) {
      expect(err.code).toBe('COINCIDENT_POINTS');
    }
  });
});

describe('area-calculation — shipped vectors', () => {
  const engine = registry.getCurrentEngine('area-calculation');
  const cases = areaVectors.calc.flatMap((c) => areaVectors.methods.map((m) => [`${c.name} [${m}]`, c, m]));

  it.each(cases)('%s', (_label, c, method) => {
    const { resultData } = engine.run({ points: c.points.map(([x, y]) => ({ x, y })), method });
    expect(Object.keys(resultData)).toEqual(['area']);
    expect(resultData.area).toBeCloseTo(c.area, 9);
  });

  it.each(areaVectors.errors.map((e) => [e.name, e]))('rejects: %s', (_name, e) => {
    let thrown;
    try {
      engine.run({ points: e.points.map(([x, y]) => ({ x, y })), method: e.method });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toBe(e.message);
  });
});

describe('offset-point — historical v1 evidence and current v2', () => {
  const v1 = registry.getEngine('offset-point', 1);
  const v2 = registry.getEngine('offset-point', 2);

  it('the legacy fixture is the historical RIGHT-side behavior, engine v1', () => {
    expect(offsetV1.engineVersion).toBe(1);
    expect(offsetV1.convention).toMatch(/RIGHT/);
  });

  it.each(offsetV1.vectors.map((v) => [v.name, v]))('v1 engine reproduces the frozen historical result: %s', (_name, v) => {
    const { resultData } = v1.run(v.input);
    expect(resultData.xP).toBeCloseTo(v.result.xP, 9);
    expect(resultData.yP).toBeCloseTo(v.result.yP, 9);
  });

  it.each(offsetV1.vectors.map((v) => [v.name, v]))('v2 is the exact mirror of v1 (same foot point, opposite side): %s', (_name, v) => {
    const mirrored = v2.run({ ...v.input, d: -v.input.d }).resultData;
    expect(mirrored.xP).toBeCloseTo(v.result.xP, 9);
    expect(mirrored.yP).toBeCloseTo(v.result.yP, 9);
  });
});
