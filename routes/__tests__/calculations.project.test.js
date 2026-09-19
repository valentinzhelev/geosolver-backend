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
  getLimitsForUser: jest.fn().mockResolvedValue({ canCalculate: true, used: 0, limit: 5, unlimited: false }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const Calculation = require('../../models/Calculation');
const SurveyPoint = require('../../models/SurveyPoint');
const Workspace = require('../../models/Workspace');
const FieldBookProject = require('../../models/FieldBookProject');

function tokenFor(userId, role = 'student') {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

const OWNER_ID = 'owner-user-id';
const EDITOR_ID = 'editor-user-id';
const VIEWER_ID = 'viewer-user-id';
const OUTSIDER_ID = 'outsider-user-id';
const PROJECT_ID = '507f1f77bcf86cd799439011';
const OTHER_PROJECT_ID = '507f1f77bcf86cd799439022';

function makeProjectDoc({ workspaceId = null } = {}) {
  return {
    _id: PROJECT_ID,
    user: OWNER_ID,
    workspace: workspaceId,
    crs: 'EPSG:7801',
  };
}

const validBody = {
  toolName: 'first-basic-task',
  toolDisplayName: { bg: 'Първа задача', en: 'First task' },
  inputData: { y1: 100, x1: 100, alpha: 50, s: 80 },
  resultData: { y2: 150, x2: 150 },
  calculationTime: 12,
};

describe('POST /api/calculations — standalone regression (no projectId)', () => {
  afterEach(() => jest.clearAllMocks());

  it('saves exactly as before when no projectId is supplied', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(Calculation).toHaveBeenCalledTimes(1);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.projectId).toBeNull();
    expect(saved.referencedPoints).toEqual([]);
    expect(saved.crs).toBeNull();
    expect(saved.engineVersion).toBe(1);
  });
});

describe('POST /api/calculations — project access control', () => {
  afterEach(() => jest.clearAllMocks());

  it('saves as the project owner', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(String(saved.projectId)).toBe(PROJECT_ID);
    expect(saved.crs).toBe('EPSG:7801');
  });

  it('saves as a workspace editor', async () => {
    const workspaceId = 'ws-1';
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId }));
    Workspace.findById.mockResolvedValue({
      _id: workspaceId,
      owner: OWNER_ID,
      members: [{ user: EDITOR_ID, role: 'editor' }],
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(EDITOR_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID });

    expect(res.status).toBe(201);
  });

  it('rejects a workspace viewer (read-only, not editor)', async () => {
    const workspaceId = 'ws-1';
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId }));
    Workspace.findById.mockResolvedValue({
      _id: workspaceId,
      owner: OWNER_ID,
      members: [{ user: VIEWER_ID, role: 'viewer' }],
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(VIEWER_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('rejects an outsider with no relationship to the project or its workspace', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId: 'ws-1' }));
    Workspace.findById.mockResolvedValue({ _id: 'ws-1', owner: OWNER_ID, members: [] });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a rejected projectId does NOT silently save as a standalone calculation', async () => {
    FieldBookProject.findById.mockResolvedValue(null); // project doesn't exist / inaccessible

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    // The whole request must fail — Calculation.save must never be reached.
    expect(Calculation).not.toHaveBeenCalled();
  });
});

describe('POST /api/calculations — point reference resolution', () => {
  afterEach(() => jest.clearAllMocks());

  it('builds referencedPoints from database values, ignoring any client-supplied snapshot fields', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1',
      user: OWNER_ID,
      projectId: PROJECT_ID,
      name: 'REAL_NAME',
      code: 'REAL_CODE',
      x: 111.111,
      y: 222.222,
      h: 5,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody,
        // 'station' maps to x1/y1 for first-basic-task (utils/toolPointRoles.js)
        // — must match the real SurveyPoint's coordinates for the new
        // provenance check to accept this reference.
        inputData: { ...validBody.inputData, x1: 111.111, y1: 222.222 },
        projectId: PROJECT_ID,
        pointReferences: [{
          pointId: 'point-1',
          role: 'station',
          // Forged snapshot fields the client should never be trusted for:
          name: 'FORGED_NAME',
          code: 'FORGED_CODE',
          x: -999,
          y: -999,
          h: -999,
        }],
      });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.referencedPoints).toEqual([{
      pointId: 'point-1',
      role: 'station',
      name: 'REAL_NAME',
      code: 'REAL_CODE',
      x: 111.111,
      y: 222.222,
      h: 5,
    }]);
  });

  it('rejects an inaccessible point reference', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    SurveyPoint.findById.mockResolvedValue(null); // not found / no access

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody,
        projectId: PROJECT_ID,
        pointReferences: [{ pointId: 'nonexistent', role: 'station' }],
      });

    expect(res.status).toBe(403);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('rejects a point that belongs to a DIFFERENT project than the calculation', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1',
      user: OWNER_ID,
      projectId: OTHER_PROJECT_ID,
      name: 'X', code: '', x: 1, y: 1, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody,
        projectId: PROJECT_ID,
        pointReferences: [{ pointId: 'point-1', role: 'station' }],
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  // The core forgery case: a caller submits inputData that actually came
  // from point B, but attaches a pointReferences entry claiming point A.
  // Knowing pointId A is real, accessible, and in the same project is NOT
  // enough — the backend must independently verify the coordinates match.
  it('REJECTS a forged provenance claim: inputData from point B, pointReferences claiming point A', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    // Point A is real, accessible, same project — everything BUT the coordinates.
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-A',
      user: OWNER_ID,
      projectId: PROJECT_ID,
      name: 'Point A', code: 'A', x: 500, y: 500, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody,
        // This is point B's actual coordinates, not point A's.
        inputData: { ...validBody.inputData, x1: 100, y1: 100 },
        projectId: PROJECT_ID,
        pointReferences: [{ pointId: 'point-A', role: 'station' }],
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('rejects a role that is not valid for the submitted toolName', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1', user: OWNER_ID, projectId: PROJECT_ID,
      name: 'P', code: '', x: 100, y: 100, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody, // toolName: 'first-basic-task', which only has role "station"
        projectId: PROJECT_ID,
        pointReferences: [{ pointId: 'point-1', role: 'pointA' }], // not a valid role for this tool
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('rejects duplicate roles in the same request', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1', user: OWNER_ID, projectId: PROJECT_ID,
      name: 'P', code: '', x: 100, y: 100, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        ...validBody,
        projectId: PROJECT_ID,
        pointReferences: [
          { pointId: 'point-1', role: 'station' },
          { pointId: 'point-1', role: 'station' }, // duplicate role
        ],
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('rejects a point reference for a tool with no role map at all (scientific-calculator)', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        toolName: 'scientific-calculator',
        toolDisplayName: { bg: 'Калкулатор', en: 'Calculator' },
        inputData: { expression: '1+1' },
        resultData: { value: 2 },
        pointReferences: [{ pointId: 'point-1', role: 'anything' }],
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('area-calculation: accepts a vertex:N role whose inputData.points[N] matches the point', async () => {
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1', user: OWNER_ID, projectId: null,
      name: 'V0', code: '', x: 10, y: 20, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        toolName: 'area-calculation',
        toolDisplayName: { bg: 'Площ', en: 'Area' },
        inputData: { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }], method: 'shoelace' },
        resultData: { area: 123 },
        pointReferences: [{ pointId: 'point-1', role: 'vertex:0' }],
      });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.referencedPoints).toEqual([{
      pointId: 'point-1', role: 'vertex:0', name: 'V0', code: '', x: 10, y: 20, h: null,
    }]);
  });

  it('area-calculation: rejects vertex:N when inputData.points[N] no longer matches the point (e.g. reordered/edited)', async () => {
    SurveyPoint.findById.mockResolvedValue({
      _id: 'point-1', user: OWNER_ID, projectId: null,
      name: 'V0', code: '', x: 10, y: 20, h: null,
    });

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({
        toolName: 'area-calculation',
        toolDisplayName: { bg: 'Площ', en: 'Area' },
        // vertex:0 no longer holds point-1's coordinates.
        inputData: { points: [{ x: 999, y: 999 }, { x: 30, y: 40 }, { x: 50, y: 60 }], method: 'shoelace' },
        resultData: { area: 123 },
        pointReferences: [{ pointId: 'point-1', role: 'vertex:0' }],
      });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });
});

describe('POST /api/calculations — server-controlled fields cannot be forged', () => {
  afterEach(() => jest.clearAllMocks());

  it('client cannot choose engineVersion — backend always stamps it from the server-side map', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({ ...validBody, engineVersion: 999999 });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.engineVersion).toBe(1); // from utils/engineVersions.js, not the forged 999999
  });

  it('client cannot choose the CRS snapshot — backend always derives it from FieldBookProject.crs', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc()); // real crs: 'EPSG:7801'

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({ ...validBody, projectId: PROJECT_ID, crs: 'FORGED:0000' });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.crs).toBe('EPSG:7801');
  });

  it('a standalone save ignores a client-supplied crs — stays null', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({ ...validBody, crs: 'FAKE:9999' });

    expect(res.status).toBe(201);
    expect(Calculation.mock.calls[0][0].crs).toBeNull();
  });

  it('client cannot submit a referencedPoints snapshot directly — only pointReferences {pointId, role} is read', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({
        ...validBody,
        referencedPoints: [{
          pointId: 'totally-forged-id', role: 'station',
          name: 'FORGED', code: 'FORGED', x: -1, y: -1, h: -1,
        }],
      });

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.referencedPoints).toEqual([]); // the direct injection attempt is simply never read
  });
});

describe('Scientific Calculator is not a Project calculation', () => {
  afterEach(() => jest.clearAllMocks());

  const sciBody = {
    toolName: 'scientific-calculator',
    toolDisplayName: { bg: 'Научен калкулатор', en: 'Scientific calculator' },
    inputData: { expression: '1+1' },
    resultData: { value: 2 },
  };

  it('REJECTS a project-scoped scientific-calculator save, even for a project owner', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());

    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`)
      .send({ ...sciBody, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a standalone scientific-calculator save is unchanged (still accepted, no professional engineVersion)', async () => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send(sciBody);

    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.projectId).toBeNull();
    expect(saved.engineVersion).toBeNull();
  });

  it.each([
    'first-basic-task', 'second-basic-task', 'forward-intersection', 'resection',
    'polar-intersection', 'coordinate-transformation', 'hansen-task', 'area-calculation',
    'distance-bearing', 'line-intersection', 'offset-point', 'segment-division',
  ])('%s is stamped with server-side engineVersion 1', async (toolName) => {
    const res = await request(app)
      .post('/api/calculations')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`)
      .send({ ...validBody, toolName });

    expect(res.status).toBe(201);
    expect(Calculation.mock.calls[0][0].engineVersion).toBe(1);
  });
});

describe('GET /api/calculations/:id — access rules', () => {
  afterEach(() => jest.clearAllMocks());

  it('a standalone calculation remains creator-only', async () => {
    Calculation.findById.mockResolvedValue({
      _id: 'calc-1', userId: OWNER_ID, projectId: null,
    });

    const res = await request(app)
      .get('/api/calculations/calc-1')
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`);

    expect(res.status).toBe(404);
  });

  it('a project calculation is readable by a project member who did not create it', async () => {
    Calculation.findById.mockResolvedValue({
      _id: 'calc-1', userId: OWNER_ID, projectId: PROJECT_ID,
    });
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId: 'ws-1' }));
    Workspace.findById.mockResolvedValue({
      _id: 'ws-1', owner: OWNER_ID, members: [{ user: VIEWER_ID, role: 'viewer' }],
    });

    const res = await request(app)
      .get('/api/calculations/calc-1')
      .set('Authorization', `Bearer ${tokenFor(VIEWER_ID)}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/projects/:projectId/calculations', () => {
  afterEach(() => jest.clearAllMocks());

  it('is readable by a viewer', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId: 'ws-1' }));
    Workspace.findById.mockResolvedValue({
      _id: 'ws-1', owner: OWNER_ID, members: [{ user: VIEWER_ID, role: 'viewer' }],
    });
    const find = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), select: jest.fn().mockResolvedValue([
      { _id: 'c1', userId: OWNER_ID, toolName: 'first-basic-task' },
      { _id: 'c2', userId: EDITOR_ID, toolName: 'resection' },
    ]) };
    Calculation.find.mockReturnValue(find);
    Calculation.countDocuments.mockResolvedValue(2);

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/calculations`)
      .set('Authorization', `Bearer ${tokenFor(VIEWER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.calculations).toHaveLength(2);
    // Includes calculations by multiple different contributors, not just the caller.
    const contributors = new Set(res.body.calculations.map((c) => c.userId));
    expect(contributors.has(OWNER_ID)).toBe(true);
    expect(contributors.has(EDITOR_ID)).toBe(true);
  });

  function mockProjectList(items) {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue(items),
    };
    Calculation.find.mockReturnValue(chain);
    return chain;
  }

  it('totalItems is the real project total (count query), not the size of the returned page', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    mockProjectList([{ _id: 'c1' }]); // limit=1 page returns a single row
    Calculation.countDocuments.mockResolvedValue(57);

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/calculations?page=1&limit=1`)
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.calculations).toHaveLength(1);
    expect(res.body.pagination.totalItems).toBe(57);
    expect(res.body.pagination.total).toBe(57);
    // The count is scoped to this project, not a personal/global count.
    expect(Calculation.countDocuments).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('later pages stay on the project query: correct skip/limit, project filter, correct paging flags', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc());
    const chain = mockProjectList(new Array(15).fill({ _id: 'c' }));
    Calculation.countDocuments.mockResolvedValue(40);

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/calculations?page=2&limit=15`)
      .set('Authorization', `Bearer ${tokenFor(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(Calculation.find).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(chain.skip).toHaveBeenCalledWith(15);
    expect(chain.limit).toHaveBeenCalledWith(15);
    expect(res.body.pagination).toMatchObject({ current: 2, total: 3, totalItems: 40, hasNext: true, hasPrev: true });
  });

  it('rejects an outsider', async () => {
    FieldBookProject.findById.mockResolvedValue(makeProjectDoc({ workspaceId: 'ws-1' }));
    Workspace.findById.mockResolvedValue({ _id: 'ws-1', owner: OWNER_ID, members: [] });

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/calculations`)
      .set('Authorization', `Bearer ${tokenFor(OUTSIDER_ID)}`);

    expect(res.status).toBe(403);
  });
});
