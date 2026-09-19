process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/Calculation', () => {
  const mockCtor = jest.fn();
  mockCtor.findById = jest.fn();
  mockCtor.find = jest.fn();
  mockCtor.findOne = jest.fn();
  mockCtor.countDocuments = jest.fn();
  return mockCtor;
});
jest.mock('../../models/SurveyPoint', () => {
  const mockModel = jest.fn();
  mockModel.create = jest.fn();
  mockModel.findOne = jest.fn();
  mockModel.findById = jest.fn();
  return mockModel;
});
jest.mock('../../models/Workspace');
jest.mock('../../models/FieldBookProject');
jest.mock('../../utils/calculationLimits', () => ({
  getLimitsForUser: jest.fn().mockResolvedValue({ canCalculate: true }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const Calculation = require('../../models/Calculation');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldBookProject = require('../../models/FieldBookProject');
const engines = require('../../engines');
const { clockwiseGon } = require('../../engines/tools/resection');
const resectionV1 = require('../../engines/fixtures/resection.v1.legacy.vectors.json');
const { VALID_INPUTS } = require('../../tests/support/canonicalInputs');

const OWNER = 'owner-id';
const PROJECT_ID = '507f1f77bcf86cd799439011';
const CALC_ID = '507f1f77bcf86cd799439022';
const tokenFor = (id) => jwt.sign({ id, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '15m' });
const round3 = (v) => Math.round(v * 1000) / 1000;

const post = (body = { name: 'P1' }) => request(app)
  .post(`/api/calculations/${CALC_ID}/create-point`)
  .set('Authorization', `Bearer ${tokenFor(OWNER)}`)
  .send(body);

function row(toolName, engineVersion, inputData, resultData, extra = {}) {
  return { _id: CALC_ID, userId: OWNER, toolName, projectId: PROJECT_ID, crs: 'EPSG:7801', engineVersion, inputData, resultData, save: jest.fn(), ...extra };
}
const honest = (toolName, version, inputData) => row(toolName, version, inputData, engines.getEngine(toolName, version).run(inputData).resultData);

beforeEach(() => {
  FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: 'EPSG:7801' });
  SurveyPoint.findOne.mockResolvedValue(null);
  SurveyPoint.create.mockImplementation(async (data) => ({ _id: 'new-point', ...data }));
});
afterEach(() => jest.clearAllMocks());

const created = () => SurveyPoint.create.mock.calls[0][0];

describe('legacy row (resultAuthority absent) — engineVersion 1, deterministic engine: recompute by exact version', () => {
  it('a consistent legacy first-basic-task row creates the point from the RECOMPUTED coordinates', async () => {
    const calc = honest('first-basic-task', 1, VALID_INPUTS['first-basic-task']);
    Calculation.findById.mockResolvedValue(calc);
    const res = await post();
    expect(res.status).toBe(201);
    const expected = engines.getEngine('first-basic-task', 1).run(VALID_INPUTS['first-basic-task']).resultData;
    expect(created().x).toBe(expected.x2);
    expect(created().y).toBe(expected.y2);
    expect(created().sourceCalculationId).toBe(CALC_ID);
    expect(calc.save).not.toHaveBeenCalled(); // the legacy Calculation is never rewritten
  });

  it('a forged/corrupted stored result is BLOCKED (409 RESULT_MISMATCH) and no SurveyPoint is created', async () => {
    const calc = honest('first-basic-task', 1, VALID_INPUTS['first-basic-task']);
    calc.resultData = { ...calc.resultData, x2: 999999, y2: -999999 };
    Calculation.findById.mockResolvedValue(calc);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESULT_MISMATCH');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('a row whose resultAuthority is "client" is treated as legacy too', async () => {
    const calc = honest('first-basic-task', 1, VALID_INPUTS['first-basic-task']);
    calc.resultAuthority = 'client';
    calc.resultData = { ...calc.resultData, x2: 1, y2: 1 };
    Calculation.findById.mockResolvedValue(calc);
    expect((await post()).status).toBe(409);
  });

  it('an unversioned or unavailable engine version is blocked (409), never guessed', async () => {
    Calculation.findById.mockResolvedValue(row('first-basic-task', undefined, VALID_INPUTS['first-basic-task'], { y2: 1, x2: 1 }));
    let res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEGACY_ENGINE_UNKNOWN');
    Calculation.findById.mockResolvedValue(row('first-basic-task', 42, VALID_INPUTS['first-basic-task'], { y2: 1, x2: 1 }));
    res = await post();
    expect(res.body.code).toBe('ENGINE_VERSION_UNAVAILABLE');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });
});

describe('legacy offset-point v1 — known mirrored bug', () => {
  const base = { yA: 0, xA: 0, yB: 0, xB: 100, s: 50 };

  it('d !== 0 -> 409 LEGACY_ENGINE_KNOWN_BUG, no point', async () => {
    Calculation.findById.mockResolvedValue(honest('offset-point', 1, { ...base, d: 10 }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEGACY_ENGINE_KNOWN_BUG');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('d === 0 proceeds after normal verification', async () => {
    Calculation.findById.mockResolvedValue(honest('offset-point', 1, { ...base, d: 0 }));
    const res = await post();
    expect(res.status).toBe(201);
    expect(created().x).toBeCloseTo(50, 9);
    expect(created().y).toBeCloseTo(0, 9);
  });
});

describe('legacy resection v1 — consistency verdicts (the v1 solver is never re-run)', () => {
  const rowOf = (v) => row('resection', 1, v.input, { xP: round3(v.v1.xP), yP: round3(v.v1.yP), method: 'Tienstra' });

  it('DIRECTED_MATCH -> point created from the STORED station', async () => {
    const v = resectionV1.vectors.find((x) => x.category === 'deterministic');
    Calculation.findById.mockResolvedValue(rowOf(v));
    const res = await post();
    expect(res.status).toBe(201);
    expect(created().x).toBe(round3(v.v1.xP));
    expect(created().y).toBe(round3(v.v1.yP));
  });

  it('COMPLEMENT_ONLY (alternative exact solution) -> 409 LEGACY_RESECTION_ALTERNATIVE_SOLUTION', async () => {
    const v = resectionV1.vectors.find((x) => x.category === 'ambiguous-returned-ALTERNATIVE-station');
    Calculation.findById.mockResolvedValue(rowOf(v));
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEGACY_RESECTION_ALTERNATIVE_SOLUTION');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('MISMATCH -> 409 RESULT_MISMATCH', async () => {
    const v = resectionV1.vectors.find((x) => x.category === 'deterministic');
    const calc = rowOf(v);
    calc.resultData = { ...calc.resultData, xP: calc.resultData.xP + 25 };
    Calculation.findById.mockResolvedValue(calc);
    expect((await post()).body.code).toBe('RESULT_MISMATCH');
  });

  it('UNSTABLE geometry -> 409 LEGACY_RESECTION_UNSTABLE', async () => {
    const A = { x: 0, y: 0 };
    const B = { x: 100, y: 0 };
    const C = { x: 50, y: 80 };
    const P = { x: 50 + 55.626 * Math.cos(2), y: 24.375 + 55.626 * Math.sin(2) };
    const input = { xA: 0, yA: 0, xB: 100, yB: 0, xC: 50, yC: 80, beta1: clockwiseGon(A, B, P), beta2: clockwiseGon(B, C, P) };
    Calculation.findById.mockResolvedValue(row('resection', 1, input, { xP: P.x, yP: P.y, method: 'Tienstra' }));
    expect((await post()).body.code).toBe('LEGACY_RESECTION_UNSTABLE');
  });
});

describe('canonical rows are NOT re-verified', () => {
  it('a resultAuthority "server" row uses its stored authoritative result directly, whatever its input says', async () => {
    const calc = row('first-basic-task', 1, { y1: 1, x1: 1, alpha: 50, s: 10 }, { y2: 1500.25, x2: 2500.75, deltaX: 3, deltaY: 4 }, { resultAuthority: 'server' });
    Calculation.findById.mockResolvedValue(calc);
    const res = await post();
    expect(res.status).toBe(201);
    expect(created().x).toBe(2500.75);
    expect(created().y).toBe(1500.25);
  });

  it('a canonical current-version resection / offset-point row is accepted directly', async () => {
    for (const [tool, version] of [['resection', 2], ['offset-point', 2]]) {
      SurveyPoint.create.mockClear();
      const calc = honest(tool, version, VALID_INPUTS[tool]);
      calc.resultAuthority = 'server';
      Calculation.findById.mockResolvedValue(calc);
      expect((await post()).status).toBe(201);
    }
  });
});

describe('ordering with the existing gates', () => {
  it('an existing point is returned as ALREADY_CREATED even if the legacy row would now be blocked (idempotency wins)', async () => {
    Calculation.findById.mockResolvedValue(honest('offset-point', 1, { yA: 0, xA: 0, yB: 0, xB: 100, s: 50, d: 10 }));
    SurveyPoint.findOne.mockResolvedValue({ _id: 'existing', name: 'T1' });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CREATED');
  });

  it('the CRS mismatch gate still applies to legacy rows', async () => {
    Calculation.findById.mockResolvedValue(honest('first-basic-task', 1, VALID_INPUTS['first-basic-task'], {}));
    FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: 'EPSG:CHANGED' });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CRS_MISMATCH');
  });

  it('a non-point tool is still rejected as UNSUPPORTED_TOOL before any verification', async () => {
    Calculation.findById.mockResolvedValue(honest('second-basic-task', 1, VALID_INPUTS['second-basic-task']));
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_TOOL');
  });

  it('the name is still required and only name/code are read from the body', async () => {
    Calculation.findById.mockResolvedValue(honest('first-basic-task', 1, VALID_INPUTS['first-basic-task']));
    expect((await post({})).body.code).toBe('NAME_REQUIRED');
    const res = await post({ name: 'P', x: 1, y: 2, sourceCalculationId: 'zzz', resultAuthority: 'server' });
    expect(res.status).toBe(201);
    expect(created().sourceCalculationId).toBe(CALC_ID);
  });
});
