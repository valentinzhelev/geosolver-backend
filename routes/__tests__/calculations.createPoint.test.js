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
const Workspace = require('../../models/Workspace');
const FieldBookProject = require('../../models/FieldBookProject');
const { POINT_OUTPUT_FIELDS } = require('../../utils/calculationPointOutputs');

const OWNER = 'owner-id';
const EDITOR = 'editor-id';
const VIEWER = 'viewer-id';
const OUTSIDER = 'outsider-id';
const PROJECT_ID = '507f1f77bcf86cd799439011';
const CALC_ID = '507f1f77bcf86cd799439022';

const tokenFor = (id) => jwt.sign({ id, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '15m' });

function makeCalc(overrides = {}) {
  return {
    _id: CALC_ID,
    userId: OWNER, // Alice, the creator
    toolName: 'first-basic-task',
    projectId: PROJECT_ID,
    resultAuthority: 'server', // canonical row: the stored authoritative result is used directly
    crs: 'EPSG:7801',
    inputData: { y1: 1, x1: 1, alpha: 50, s: 10 },
    resultData: { y2: 1500.25, x2: 2500.75, deltaX: 3, deltaY: 4 },
    save: jest.fn(),
    ...overrides,
  };
}

function mockProject({ workspace = null, crs = 'EPSG:7801' } = {}) {
  FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace, crs });
}

function mockWorkspaceMember(userId, role) {
  Workspace.findById.mockResolvedValue({ _id: 'ws-1', owner: OWNER, members: [{ user: userId, role }] });
}

function post(userId, body = { name: 'P1' }, id = CALC_ID) {
  return request(app)
    .post(`/api/calculations/${id}/create-point`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .send(body);
}

beforeEach(() => {
  SurveyPoint.findOne.mockResolvedValue(null);
  SurveyPoint.create.mockImplementation(async (doc) => ({ _id: 'new-point', ...doc }));
});

afterEach(() => jest.resetAllMocks());

describe('POST /api/calculations/:id/create-point — success and derivation', () => {
  it('project owner can create a point; coordinates come from the STORED resultData', async () => {
    const calc = makeCalc();
    Calculation.findById.mockResolvedValue(calc);
    mockProject();

    const res = await post(OWNER, { name: '  T1  ', code: ' 101 ' });

    expect(res.status).toBe(201);
    expect(SurveyPoint.create).toHaveBeenCalledTimes(1);
    expect(SurveyPoint.create).toHaveBeenCalledWith({
      user: OWNER,
      projectId: PROJECT_ID,
      name: 'T1',
      code: '101',
      x: 2500.75, // resultData.x2
      y: 1500.25, // resultData.y2
      h: null, // not calculated by this tool — not pretended
      sourceCalculationId: CALC_ID,
    });
  });

  it('a workspace EDITOR who did not create the calculation can save it as a point', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ userId: OWNER }));
    mockProject({ workspace: 'ws-1' });
    mockWorkspaceMember(EDITOR, 'editor');

    const res = await post(EDITOR);

    expect(res.status).toBe(201);
    expect(SurveyPoint.create.mock.calls[0][0].user).toBe(EDITOR);
  });

  it('SurveyPoint.user is the person who clicked "Save as point" — not the calculation creator, not the project owner', async () => {
    const ALICE = 'alice-id'; // created the calculation
    const BOB = 'bob-id'; // workspace editor performing the action
    Calculation.findById.mockResolvedValue(makeCalc({ userId: ALICE }));
    // Project is owned by OWNER (a third person); Bob has access via the workspace.
    mockProject({ workspace: 'ws-1' });
    mockWorkspaceMember(BOB, 'editor');

    const res = await post(BOB);

    expect(res.status).toBe(201);
    const created = SurveyPoint.create.mock.calls[0][0];
    expect(created.user).toBe(BOB);
    expect(created.user).not.toBe(ALICE);
    expect(created.user).not.toBe(OWNER);
    // Project access still flows through projectId, which is the calculation's.
    expect(created.projectId).toBe(PROJECT_ID);
  });

  it('never recomputes: uses resultData even if it no longer matches inputData', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ resultData: { y2: 111, x2: 222 }, inputData: { y1: 0, x1: 0, alpha: 0, s: 1 } }));
    mockProject();

    await post(OWNER);

    expect(SurveyPoint.create.mock.calls[0][0]).toMatchObject({ x: 222, y: 111 });
  });

  it('leaves the Calculation document completely unchanged', async () => {
    const calc = makeCalc();
    const before = JSON.stringify({ ...calc, save: undefined });
    Calculation.findById.mockResolvedValue(calc);
    mockProject();

    await post(OWNER);

    expect(calc.save).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...calc, save: undefined })).toBe(before);
  });
});

describe('create-point — authorization', () => {
  it('rejects a workspace VIEWER (may read, may not create)', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject({ workspace: 'ws-1' });
    mockWorkspaceMember(VIEWER, 'viewer');

    const res = await post(VIEWER);

    expect(res.status).toBe(403);
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('rejects an outsider (calculation appears not to exist)', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject({ workspace: 'ws-1' });
    Workspace.findById.mockResolvedValue({ _id: 'ws-1', owner: OWNER, members: [] });

    const res = await post(OUTSIDER);

    expect(res.status).toBe(404);
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('rejects a missing calculation', async () => {
    Calculation.findById.mockResolvedValue(null);
    const res = await post(OWNER);
    expect(res.status).toBe(404);
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(app).post(`/api/calculations/${CALC_ID}/create-point`).send({ name: 'P' });
    expect(res.status).toBe(401);
  });
});

describe('create-point — eligibility', () => {
  it('rejects a STANDALONE calculation for its own creator (out of scope)', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ projectId: null }));
    const res = await post(OWNER);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_A_PROJECT_CALCULATION');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it("does not reveal someone else's standalone calculation", async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ projectId: null }));
    const res = await post(OUTSIDER);
    expect(res.status).toBe(404);
  });

  it.each(['second-basic-task', 'distance-bearing', 'area-calculation', 'scientific-calculator'])(
    'rejects unsupported/scalar tool %s even inside a project',
    async (toolName) => {
      Calculation.findById.mockResolvedValue(makeCalc({ toolName, resultData: { x2: 1, y2: 2, xP: 1, yP: 2, area: 5 } }));
      mockProject();

      const res = await post(OWNER);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_TOOL');
      expect(SurveyPoint.create).not.toHaveBeenCalled();
    }
  );

  it('rejects a supported tool whose stored result has no valid coordinates', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ resultData: { x2: 'abc' } }));
    mockProject();
    const res = await post(OWNER);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESULT_MISSING');
  });

  it.each(Object.entries(POINT_OUTPUT_FIELDS))(
    '%s: never creates a point from invalid stored coordinates',
    async (toolName, spec) => {
      const good = 10.5;
      const badValues = [undefined, null, '12.5', 'abc', '', true, {}, [], NaN, Infinity, -Infinity];
      const cases = [];
      // bad x with good y, and good x with bad y, for every bad value
      badValues.forEach((bad) => {
        cases.push({ [spec.xField]: bad, [spec.yField]: good });
        cases.push({ [spec.xField]: good, [spec.yField]: bad });
      });
      cases.push({}); // both missing

      for (const resultData of cases) {
        Calculation.findById.mockResolvedValue(makeCalc({ toolName, resultData }));
        mockProject();

        const res = await post(OWNER);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RESULT_MISSING');
      }
      expect(SurveyPoint.create).not.toHaveBeenCalled();
    }
  );

  it('valid numeric results (including 0 and negatives) from the real workflow still work', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ resultData: { x2: 0, y2: -1234.5678 } }));
    mockProject();
    const res = await post(OWNER);
    expect(res.status).toBe(201);
    expect(SurveyPoint.create.mock.calls[0][0]).toMatchObject({ x: 0, y: -1234.5678 });
  });

  it('requires a point name', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject();
    const res = await post(OWNER, { name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NAME_REQUIRED');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });
});

describe('create-point — the client cannot forge server-derived fields', () => {
  it('ignores x, y, projectId, sourceCalculationId, h and engineVersion in the body', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject();

    const res = await post(OWNER, {
      name: 'P1',
      code: 'C',
      x: -999,
      y: -999,
      h: 12345,
      projectId: 'attacker-project',
      sourceCalculationId: 'attacker-calculation',
      engineVersion: 99,
      resultData: { x2: 0, y2: 0 },
    });

    expect(res.status).toBe(201);
    const created = SurveyPoint.create.mock.calls[0][0];
    expect(created.x).toBe(2500.75);
    expect(created.y).toBe(1500.25);
    expect(created.h).toBeNull();
    expect(created.projectId).toBe(PROJECT_ID);
    expect(created.sourceCalculationId).toBe(CALC_ID);
    expect(Object.keys(created).sort()).toEqual(
      ['code', 'h', 'name', 'projectId', 'sourceCalculationId', 'user', 'x', 'y']
    );
  });
});

describe('create-point — duplicate prevention', () => {
  it('a second request for the same calculation is refused with the existing point, nothing created', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject();
    SurveyPoint.findOne.mockResolvedValue({ _id: 'existing-point', name: 'T1' });

    const res = await post(OWNER);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CREATED');
    expect(res.body.data._id).toBe('existing-point');
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('a concurrent duplicate that slips past the check is stopped by the unique index (E11000) and reported as ALREADY_CREATED', async () => {
    Calculation.findById.mockResolvedValue(makeCalc());
    mockProject();
    SurveyPoint.findOne
      .mockResolvedValueOnce(null) // pre-check sees nothing
      .mockResolvedValueOnce({ _id: 'winner-point' }); // after losing the race
    SurveyPoint.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    const res = await post(OWNER);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CREATED');
    expect(res.body.data._id).toBe('winner-point');
  });
});

describe('create-point — CRS consistency', () => {
  it('creates the point when the calculation CRS snapshot matches the project CRS', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ crs: 'EPSG:7801' }));
    mockProject({ crs: 'EPSG:7801' });
    const res = await post(OWNER);
    expect(res.status).toBe(201);
  });

  it('REFUSES when the project CRS was edited after the calculation was made', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ crs: 'EPSG:7801' }));
    mockProject({ crs: 'EPSG:7799' });

    const res = await post(OWNER);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CRS_MISMATCH', calculationCrs: 'EPSG:7801', projectCrs: 'EPSG:7799' });
    expect(SurveyPoint.create).not.toHaveBeenCalled();
  });

  it('an empty-string project CRS and a null calculation CRS are the same "undeclared" state — no false mismatch', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ crs: null }));
    mockProject({ crs: '' });
    const res = await post(OWNER);
    expect(res.status).toBe(201);
  });

  it('also refuses when the calculation recorded no CRS but the project now declares one', async () => {
    Calculation.findById.mockResolvedValue(makeCalc({ crs: null }));
    mockProject({ crs: 'EPSG:7801' });
    const res = await post(OWNER);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CRS_MISMATCH');
  });
});

describe('create-point — every supported output mapping', () => {
  it.each(Object.entries(POINT_OUTPUT_FIELDS))('%s → stored %j becomes the point x/y', async (toolName, spec) => {
    Calculation.findById.mockResolvedValue(
      makeCalc({ toolName, resultData: { [spec.xField]: 10.5, [spec.yField]: 20.5, noise: 1 } })
    );
    mockProject();

    const res = await post(OWNER);

    expect(res.status).toBe(201);
    expect(SurveyPoint.create.mock.calls[0][0]).toMatchObject({ x: 10.5, y: 20.5 });
  });
});
