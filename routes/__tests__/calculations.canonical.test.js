process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/Calculation', () => {
  const mockCtor = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: 'mock-calc-id',
    save: jest.fn().mockResolvedValue(undefined),
  }));
  mockCtor.find = jest.fn();
  mockCtor.findById = jest.fn();
  mockCtor.findOne = jest.fn();
  mockCtor.countDocuments = jest.fn().mockResolvedValue(0);
  return mockCtor;
});
jest.mock('../../models/SurveyPoint');
jest.mock('../../models/Workspace');
jest.mock('../../models/FieldBookProject');
jest.mock('../../utils/calculationLimits', () => ({
  getLimitsForUser: jest.fn(),
}));
jest.mock('../../utils/eduCalculationAccess', () => ({
  validateEduCalculationAccess: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const Calculation = require('../../models/Calculation');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldBookProject = require('../../models/FieldBookProject');
const { getLimitsForUser } = require('../../utils/calculationLimits');
const { validateEduCalculationAccess } = require('../../utils/eduCalculationAccess');
const engines = require('../../engines');
const { VALID_INPUTS, CURRENT_CLIENT_CONTRACT } = require('../../tests/support/canonicalInputs');

const tokenFor = (id) => jwt.sign({ id, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '15m' });
const OWNER = 'owner-id';
const OUTSIDER = 'outsider-id';
const PROJECT_ID = '507f1f77bcf86cd799439011';

const post = (body, userId = OUTSIDER) => request(app).post('/api/calculations').set('Authorization', `Bearer ${tokenFor(userId)}`).send(body);
const saved = () => Calculation.mock.calls[0][0];
const bodyFor = (tool, extra = {}) => ({
  toolName: tool,
  inputData: VALID_INPUTS[tool],
  clientContractVersion: CURRENT_CLIENT_CONTRACT,
  ...extra,
});

beforeEach(() => {
  getLimitsForUser.mockResolvedValue({ canCalculate: true, used: 0, limit: 5, unlimited: false });
  validateEduCalculationAccess.mockResolvedValue({});
});
afterEach(() => jest.clearAllMocks());

describe('canonical persistence — the backend result is what gets stored', () => {
  it('a FORGED client resultData is ignored: the persisted resultData is the server computation', async () => {
    const res = await post(bodyFor('first-basic-task', { resultData: { y2: 999999, x2: -999999, deltaX: 1, deltaY: 1 } }));
    expect(res.status).toBe(201);
    const expected = engines.getCurrentEngine('first-basic-task').run(VALID_INPUTS['first-basic-task']).resultData;
    expect(saved().resultData).toEqual(expected);
    expect(res.body.resultData).toEqual(expected); // returned to the client: the authoritative row
    expect(saved().resultData.x2).not.toBe(-999999);
  });

  it('a save WITHOUT any client resultData works (advisory only) and is computed by the server', async () => {
    const res = await post(bodyFor('polar-intersection'));
    expect(res.status).toBe(201);
    expect(saved().resultData).toEqual(engines.getCurrentEngine('polar-intersection').run(VALID_INPUTS['polar-intersection']).resultData);
  });

  it('stamps resultAuthority "server" and the engineVersion of the ENGINE THAT COMPUTED the row', async () => {
    for (const [tool, version] of [['first-basic-task', 1], ['offset-point', 2], ['resection', 2]]) {
      Calculation.mockClear();
      const res = await post(bodyFor(tool));
      expect(res.status).toBe(201);
      expect(saved().resultAuthority).toBe('server');
      expect(saved().engineVersion).toBe(version);
      expect(res.body.resultAuthority).toBe('server');
      expect(res.body.engineVersion).toBe(version);
    }
  });

  it('a STANDALONE professional calculation is canonicalized too (no project needed)', async () => {
    const res = await post(bodyFor('segment-division'));
    expect(res.status).toBe(201);
    expect(saved().projectId).toBeNull();
    expect(saved().resultAuthority).toBe('server');
  });

  it('persists the NORMALIZED input: numbers, unknown fields stripped', async () => {
    const res = await post(bodyFor('first-basic-task', { inputData: { y1: '100', x1: ' 100 ', alpha: 50, s: '80', evil: { $where: 'x' }, resultData: 1 } }));
    expect(res.status).toBe(201);
    expect(saved().inputData).toEqual({ y1: 100, x1: 100, alpha: 50, s: 80 });
  });

  it('returns the authoritative Calculation plus a clientCheck diagnostic', async () => {
    const res = await post(bodyFor('first-basic-task'));
    expect(res.body.clientCheck).toEqual({ status: 'not_provided', fields: [], engineVersion: 1 });
  });
});

describe('server-controlled fields cannot be forged from the request body', () => {
  it('resultAuthority in the body is ignored (professional tool stays "server")', async () => {
    const res = await post({ ...bodyFor('first-basic-task'), resultAuthority: 'client' });
    expect(res.status).toBe(201);
    expect(saved().resultAuthority).toBe('server');
  });

  it('resultAuthority "server" in the body cannot upgrade a Scientific Calculator row (stays "client")', async () => {
    const res = await post({ toolName: 'scientific-calculator', inputData: { expression: '1+1' }, resultData: { value: 2 }, resultAuthority: 'server' });
    expect(res.status).toBe(201);
    expect(saved().resultAuthority).toBe('client');
  });

  it('engineVersion in the body is ignored, including a forged old version for offset-point / resection', async () => {
    for (const tool of ['first-basic-task', 'offset-point', 'resection']) {
      Calculation.mockClear();
      await post({ ...bodyFor(tool), engineVersion: 1 });
      expect(saved().engineVersion).toBe(engines.getCurrentEngine(tool).version);
      Calculation.mockClear();
      await post({ ...bodyFor(tool), engineVersion: 999999 });
      expect(saved().engineVersion).toBe(engines.getCurrentEngine(tool).version);
    }
  });

  it('crs in the body is ignored for both standalone and project saves', async () => {
    await post({ ...bodyFor('first-basic-task'), crs: 'EPSG:FORGED' });
    expect(saved().crs).toBeNull();
    Calculation.mockClear();
    FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: 'EPSG:7801' });
    await post({ ...bodyFor('first-basic-task'), projectId: PROJECT_ID, crs: 'EPSG:FORGED' }, OWNER);
    expect(saved().crs).toBe('EPSG:7801');
  });

  it('a client referencedPoints snapshot is never stored; only pointReferences {pointId, role} is read', async () => {
    FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: null });
    SurveyPoint.findById.mockResolvedValue({ _id: 'p1', user: OWNER, projectId: PROJECT_ID, name: 'REAL', code: 'R', x: 200, y: 100, h: null }); // matches first-basic-task's station (x1=200, y1=100)
    const res = await post({
      ...bodyFor('first-basic-task'),
      projectId: PROJECT_ID,
      referencedPoints: [{ pointId: 'x', role: 'station', name: 'FORGED', x: 1, y: 1 }],
      pointReferences: [{ pointId: 'p1', role: 'station' }],
    }, OWNER);
    expect(res.status).toBe(201);
    expect(saved().referencedPoints).toEqual([{ pointId: 'p1', role: 'station', name: 'REAL', code: 'R', x: 200, y: 100, h: null }]);
  });

  it('toolDisplayName and calculationTime are cosmetic: malformed values cannot cause a 500', async () => {
    const res = await post({ ...bodyFor('first-basic-task'), toolDisplayName: { bg: 5 }, calculationTime: -3 });
    expect(res.status).toBe(201);
    expect(saved().toolDisplayName).toEqual({ bg: 'Първа основна задача', en: 'First Basic Task' });
    expect(saved().calculationTime).toBeUndefined();
    Calculation.mockClear();
    const ok = await post({ ...bodyFor('first-basic-task'), toolDisplayName: { bg: ' Моето ', en: ' Mine ' }, calculationTime: 12 });
    expect(ok.status).toBe(201);
    expect(saved().toolDisplayName).toEqual({ bg: 'Моето', en: 'Mine' });
    expect(saved().calculationTime).toBe(12);
  });
});

describe('provenance runs on the NORMALIZED input', () => {
  const projectSetup = () => FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: null });

  it('a legacy STRING-shaped Forward Intersection body with picked points is now accepted (strings normalize to the numbers provenance compares)', async () => {
    projectSetup();
    SurveyPoint.findById.mockResolvedValue({ _id: 'pA', user: OWNER, projectId: PROJECT_ID, name: 'A', code: '', x: 100.25, y: 200.5, h: null });
    const res = await post({
      toolName: 'forward-intersection',
      inputData: { yA: '200.5', xA: '100.25', yB: '310', xB: '420.125', beta1: '50', beta2: '60' },
      projectId: PROJECT_ID,
      pointReferences: [{ pointId: 'pA', role: 'pointA' }],
      clientContractVersion: 1, // a stale client is fine for forward-intersection
    }, OWNER);
    expect(res.status).toBe(201);
    expect(saved().inputData).toEqual({ yA: 200.5, xA: 100.25, yB: 310, xB: 420.125, beta1: 50, beta2: 60 });
    expect(saved().referencedPoints).toHaveLength(1);
  });

  it('a forged provenance claim (inputData from another point) is still rejected — after normalization', async () => {
    projectSetup();
    SurveyPoint.findById.mockResolvedValue({ _id: 'pA', user: OWNER, projectId: PROJECT_ID, name: 'A', code: '', x: 1, y: 1, h: null });
    const res = await post({
      toolName: 'forward-intersection',
      inputData: { yA: '200.5', xA: '100.25', yB: '310', xB: '420.125', beta1: '50', beta2: '60' },
      projectId: PROJECT_ID,
      pointReferences: [{ pointId: 'pA', role: 'pointA' }],
    }, OWNER);
    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a project save of area-calculation keeps vertex roles working on the structured array', async () => {
    projectSetup();
    SurveyPoint.findById.mockResolvedValue({ _id: 'v1', user: OWNER, projectId: PROJECT_ID, name: 'V', code: '', x: 100, y: 0, h: null });
    const res = await post({
      ...bodyFor('area-calculation'),
      projectId: PROJECT_ID,
      pointReferences: [{ pointId: 'v1', role: 'vertex:1' }],
    }, OWNER);
    expect(res.status).toBe(201);
  });
});

describe('structured validation — never a 500', () => {
  it.each([
    ['alpha out of range', { toolName: 'first-basic-task', inputData: { y1: 1, x1: 1, alpha: 400, s: 5 } }, 'OUT_OF_RANGE', 'alpha'],
    ['non-numeric field', { toolName: 'first-basic-task', inputData: { y1: 'abc', x1: 1, alpha: 5, s: 5 } }, 'INVALID_NUMBER', 'y1'],
    ['missing field', { toolName: 'polar-intersection', inputData: { yA: 1, xA: 1, angle: 5 } }, 'MISSING_FIELD', 'distance'],
    ['unknown segment mode', { toolName: 'segment-division', inputData: { yA: 0, xA: 0, yB: 0, xB: 100, value: 5, mode: 'foo' } }, 'INVALID_MODE', 'mode'],
    ['too few polygon points', { toolName: 'area-calculation', inputData: { points: [{ x: 0, y: 0 }], method: 'shoelace' } }, 'TOO_FEW_POINTS', 'points'],
    ['parallel lines', { toolName: 'line-intersection', inputData: { y1: 0, x1: 0, y2: 0, x2: 10, y3: 1, x3: 0, y4: 1, x4: 10 } }, 'PARALLEL_LINES', undefined],
    ['inputData missing', { toolName: 'first-basic-task' }, 'INVALID_INPUT_DATA', 'inputData'],
    ['inputData not an object', { toolName: 'first-basic-task', inputData: 'x' }, 'INVALID_INPUT_DATA', 'inputData'],
  ])('%s -> 400 { error, code, field? }', async (_name, body, code, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.error).toBe('string');
    if (field) expect(res.body.field).toBe(field);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('solve-time failures (resection INCONSISTENT_ANGLES) are structured 400s too', async () => {
    const res = await post({
      toolName: 'resection',
      inputData: { xA: 0, yA: 0, xB: 100, yB: 0, xC: 50, yC: 80, beta1: 150, beta2: 300 },
      clientContractVersion: CURRENT_CLIENT_CONTRACT,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCONSISTENT_ANGLES');
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('an unknown toolName is a 400 UNSUPPORTED_TOOL (it used to be a schema-error 500)', async () => {
    const res = await post({ toolName: 'made-up-tool', inputData: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_TOOL');
  });

  it('an empty / missing body cannot crash the route', async () => {
    const res = await request(app).post('/api/calculations').set('Authorization', `Bearer ${tokenFor(OUTSIDER)}`);
    expect(res.status).toBe(400);
  });

  it('a schema ValidationError at save time is a structured 400, not a 500', async () => {
    Calculation.mockImplementationOnce(() => ({
      save: jest.fn().mockRejectedValue(Object.assign(new Error('resultData is required'), { name: 'ValidationError' })),
    }));
    const res = await post({ toolName: 'scientific-calculator', inputData: { expression: '1+1' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CALCULATION');
  });
});

describe('authorization and ordering are preserved', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/calculations').send(bodyFor('first-basic-task'));
    expect(res.status).toBe(401);
  });

  it('a project save by a non-member is still 403 (valid input)', async () => {
    FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: null });
    const res = await post({ ...bodyFor('first-basic-task'), projectId: PROJECT_ID }, OUTSIDER);
    expect(res.status).toBe(403);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a project-scoped Scientific save is still rejected', async () => {
    FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: null });
    const res = await post({ toolName: 'scientific-calculator', inputData: { expression: '1+1' }, resultData: { value: 2 }, projectId: PROJECT_ID }, OWNER);
    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a standalone Scientific save is unchanged: client authority, no engineVersion', async () => {
    const res = await post({ toolName: 'scientific-calculator', inputData: { expression: '1+1' }, resultData: { value: 2 } });
    expect(res.status).toBe(201);
    expect(saved().resultAuthority).toBe('client');
    expect(saved().engineVersion).toBeNull();
    expect(saved().resultData).toEqual({ value: 2 }); // client-authored by design; never claimed as server
    expect(res.body.clientCheck).toBeUndefined();
  });
});

describe('edu context and free-plan limit behavior are unchanged', () => {
  it('consumer path: limit reached -> 403 and nothing is computed/stored', async () => {
    getLimitsForUser.mockResolvedValue({ canCalculate: false, used: 5, limit: 5 });
    const res = await post(bodyFor('first-basic-task'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Calculation limit reached');
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('consumer path: within the limit saves as context "consumer"', async () => {
    await post(bodyFor('first-basic-task'));
    expect(getLimitsForUser).toHaveBeenCalledTimes(1);
    expect(saved().context).toBe('consumer');
    expect(saved().assignmentId).toBeNull();
  });

  it('edu context: the limit is NOT consulted (exemption preserved) and the row is computed canonically', async () => {
    getLimitsForUser.mockResolvedValue({ canCalculate: false });
    const res = await post({ ...bodyFor('first-basic-task'), eduContext: { assignmentId: 'a1' } });
    expect(res.status).toBe(201);
    expect(getLimitsForUser).not.toHaveBeenCalled();
    expect(validateEduCalculationAccess).toHaveBeenCalledWith(OUTSIDER, 'a1');
    expect(saved().context).toBe('edu');
    expect(saved().assignmentId).toBe('a1');
    expect(saved().resultAuthority).toBe('server');
  });

  it('edu context with calculatorPolicy off / not enrolled is still forbidden and stores nothing', async () => {
    validateEduCalculationAccess.mockRejectedValue(Object.assign(new Error('За това задание калкулаторът не е разрешен от преподавателя'), { status: 403 }));
    const res = await post({ ...bodyFor('first-basic-task'), eduContext: { assignmentId: 'a1' } });
    expect(res.status).toBe(403);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('the fields the classroom overlay reads (x2/y2, distance/alpha, xP/yP) are in the authoritative result', async () => {
    const need = { 'first-basic-task': ['x2', 'y2'], 'second-basic-task': ['distance', 'alpha'], 'forward-intersection': ['xP', 'yP'], resection: ['xP', 'yP'] };
    for (const [tool, fields] of Object.entries(need)) {
      Calculation.mockClear();
      const res = await post(bodyFor(tool, { eduContext: { assignmentId: 'a1' } }));
      expect(res.status).toBe(201);
      for (const f of fields) expect(typeof res.body.resultData[f]).toBe('number');
    }
  });
});

describe('STALE CLIENT protection (CLIENT_REFRESH_REQUIRED)', () => {
  it.each(['offset-point', 'resection'])('%s without a compatible clientContractVersion is REJECTED, nothing stored', async (tool) => {
    for (const version of [undefined, 1, 0, 'abc']) {
      Calculation.mockClear();
      const body = { toolName: tool, inputData: VALID_INPUTS[tool] };
      if (version !== undefined) body.clientContractVersion = version;
      const res = await post(body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CLIENT_REFRESH_REQUIRED');
      expect(res.body.requiredClientContractVersion).toBe(2);
      expect(res.body.error).toMatch(/опреснете/);
      expect(Calculation).not.toHaveBeenCalled();
    }
  });

  it.each(['offset-point', 'resection'])('%s with the CURRENT client contract succeeds', async (tool) => {
    const res = await post({ toolName: tool, inputData: VALID_INPUTS[tool], clientContractVersion: 2 });
    expect(res.status).toBe(201);
    expect(saved().clientContractVersion).toBe(2);
  });

  it('the refresh gate comes before validation and before the free-plan limit is consulted', async () => {
    const res = await post({ toolName: 'resection', inputData: { garbage: true } });
    expect(res.status).toBe(409);
    expect(getLimitsForUser).not.toHaveBeenCalled();
  });

  it('the ten tools whose client-side math did not change keep accepting stale clients', async () => {
    for (const tool of ['first-basic-task', 'second-basic-task', 'forward-intersection', 'polar-intersection', 'coordinate-transformation', 'hansen-task', 'area-calculation', 'distance-bearing', 'line-intersection', 'segment-division']) {
      Calculation.mockClear();
      const res = await post({ toolName: tool, inputData: VALID_INPUTS[tool] }); // no clientContractVersion at all
      expect(res.status).toBe(201);
      expect(saved().clientContractVersion).toBeUndefined();
    }
  });

  it('clientContractVersion is diagnostic only: it cannot change the engine, the version, or the authority', async () => {
    await post({ ...bodyFor('first-basic-task'), clientContractVersion: 999 });
    expect(saved().engineVersion).toBe(1);
    expect(saved().resultAuthority).toBe('server');
  });

  it('a non-integer contract version is not recorded', async () => {
    await post({ ...bodyFor('first-basic-task'), clientContractVersion: 'banana' });
    expect(saved().clientContractVersion).toBeUndefined();
  });
});

describe('client result comparison (advisory, per field, never rejecting)', () => {
  let warn;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  const server = () => engines.getCurrentEngine('first-basic-task').run(VALID_INPUTS['first-basic-task']).resultData;

  it('a matching client result -> status "match", nothing logged', async () => {
    const res = await post(bodyFor('first-basic-task', { resultData: server() }));
    expect(res.body.clientCheck.status).toBe('match');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a one-rounding-step difference is a MATCH (last-bit boundary flips are tolerated)', async () => {
    const s = server();
    const res = await post(bodyFor('first-basic-task', { resultData: { ...s, x2: s.x2 + 0.001 } }));
    expect(res.body.clientCheck.status).toBe('match');
  });

  it('a real difference is a "mismatch": the save STILL succeeds, the server value wins, and it is logged without coordinates', async () => {
    const s = server();
    const res = await post(bodyFor('first-basic-task', { resultData: { ...s, x2: 999.123456 } }));
    expect(res.status).toBe(201);
    expect(saved().resultData.x2).toBe(s.x2);
    expect(res.body.clientCheck.status).toBe('mismatch');
    expect(res.body.clientCheck.fields.map((f) => f.field)).toEqual(['x2']);
    expect(res.body.clientCheck.fields[0].difference).toBeCloseTo(999.123456 - s.x2, 6);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ event: 'calculation.client_mismatch', toolName: 'first-basic-task', engineVersion: 1, clientContractVersion: 2 });
    expect(parsed.fields[0].field).toBe('x2');
    // never raw survey values
    for (const secret of ['999.123456', String(s.x2), String(s.y2), '156.569']) expect(line).not.toContain(secret);
    for (const key of ['inputData', 'resultData', 'coordinates']) expect(line).not.toContain(key);
  });

  it('compares numerically per field, never as JSON strings (a client sending numeric strings is a mismatch, not a crash)', async () => {
    const s = server();
    const res = await post(bodyFor('first-basic-task', { resultData: { y2: String(s.y2), x2: s.x2, deltaX: s.deltaX, deltaY: s.deltaY } }));
    expect(res.status).toBe(201);
    expect(res.body.clientCheck.status).toBe('mismatch');
    expect(res.body.clientCheck.fields[0].field).toBe('y2');
  });

  it('a non-object client resultData counts as not provided', async () => {
    for (const bad of ['x', 5, [1], null]) {
      const res = await post(bodyFor('first-basic-task', { resultData: bad }));
      expect(res.status).toBe(201);
      expect(res.body.clientCheck.status).toBe('not_provided');
    }
  });
});
