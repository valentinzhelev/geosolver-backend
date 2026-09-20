process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/FieldBookProject');
jest.mock('../../models/FieldBook');
jest.mock('../../models/FieldBookPilotRequest');
jest.mock('../../models/Workspace');
jest.mock('../../models/SurveyPoint');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const FieldBookProject = require('../../models/FieldBookProject');
const FieldBook = require('../../models/FieldBook');
const FieldBookPilotRequest = require('../../models/FieldBookPilotRequest');
const Workspace = require('../../models/Workspace');

/**
 * QA-01: a Project is the primary geodetic work object. Creating/listing/editing projects must NOT require the
 * Field Book pilot; only the Field Book resources (a project's books and /books/*) stay pilot-gated.
 */

const USER = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const WS = '507f1f77bcf86cd799439033';
const token = (role = 'user', id = USER) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
const auth = (role) => ({ Authorization: `Bearer ${token(role)}` });

// FieldBookProject.find(...) is used both as `.sort()` (list) and `.select()` (shared ids)
const findChain = (docs) => {
  const p = Promise.resolve(docs);
  p.sort = () => Promise.resolve(docs);
  p.select = () => Promise.resolve(docs);
  return p;
};

beforeEach(() => {
  FieldBookPilotRequest.findOne.mockResolvedValue(null); // NOT a pilot user
  FieldBookProject.create.mockImplementation(async (data) => ({ _id: 'new-project-id', ...data }));
  Workspace.find.mockReturnValue({ select: () => Promise.resolve([]) });
});
afterEach(() => jest.resetAllMocks());

describe('creating a project without Field Book pilot access', () => {
  it('personal project (no workspace): 201, owned by the caller, workspace null, default CRS EPSG:7801', async () => {
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: '  Проект А  ' });
    expect(res.status).toBe(201);
    expect(FieldBookPilotRequest.findOne).not.toHaveBeenCalled(); // the pilot gate is not on this route
    const arg = FieldBookProject.create.mock.calls[0][0];
    expect(arg).toMatchObject({ user: USER, workspace: null, name: 'Проект А', crs: 'EPSG:7801' });
    expect(res.body.data.crs).toBe('EPSG:7801');
  });

  it('the CRS chosen by the user persists exactly, with description (notes)', async () => {
    const res = await request(app).post('/api/fieldbooks/projects').set(auth())
      .send({ name: 'P', crs: 'EPSG:7799', notes: 'Учебен проект' });
    expect(res.status).toBe(201);
    expect(FieldBookProject.create.mock.calls[0][0]).toMatchObject({ crs: 'EPSG:7799', notes: 'Учебен проект' });
  });

  it('a name is still required', async () => {
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(FieldBookProject.create).not.toHaveBeenCalled();
  });

  it('an unauthenticated request is still rejected', async () => {
    const res = await request(app).post('/api/fieldbooks/projects').send({ name: 'P' });
    expect(res.status).toBe(401);
  });
});

describe('workspace linking (authorization unchanged)', () => {
  it('a project can be linked to a workspace the caller OWNS', async () => {
    Workspace.findById.mockResolvedValue({ _id: WS, owner: USER, members: [] });
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: 'P', workspaceId: WS });
    expect(res.status).toBe(201);
    expect(FieldBookProject.create.mock.calls[0][0].workspace).toBe(WS);
  });

  it('an EDITOR member may link', async () => {
    Workspace.findById.mockResolvedValue({ _id: WS, owner: OTHER, members: [{ user: USER, role: 'editor' }] });
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: 'P', workspaceId: WS });
    expect(res.status).toBe(201);
  });

  it('a forged inaccessible workspace is refused (403) and nothing is created', async () => {
    Workspace.findById.mockResolvedValue({ _id: WS, owner: OTHER, members: [] });
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: 'P', workspaceId: WS });
    expect(res.status).toBe(403);
    expect(FieldBookProject.create).not.toHaveBeenCalled();
  });

  it('a non-existent workspace id is refused the same way', async () => {
    Workspace.findById.mockResolvedValue(null);
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: 'P', workspaceId: WS });
    expect(res.status).toBe(403);
    expect(FieldBookProject.create).not.toHaveBeenCalled();
  });

  it('a VIEWER member cannot link a project (needs editor)', async () => {
    Workspace.findById.mockResolvedValue({ _id: WS, owner: OTHER, members: [{ user: USER, role: 'viewer' }] });
    const res = await request(app).post('/api/fieldbooks/projects').set(auth()).send({ name: 'P', workspaceId: WS });
    expect(res.status).toBe(403);
  });

  it('PATCH: unlinking (workspaceId null) still works; linking to an inaccessible workspace is refused', async () => {
    const project = { _id: 'p1', user: USER, workspace: WS, save: jest.fn().mockResolvedValue(undefined) };
    FieldBookProject.findById.mockResolvedValue(project);
    const unlink = await request(app).patch('/api/fieldbooks/projects/p1').set(auth()).send({ workspaceId: null });
    expect(unlink.status).toBe(200);
    expect(project.workspace).toBeNull();
    expect(project.save).toHaveBeenCalledTimes(1);

    Workspace.findById.mockResolvedValue({ _id: WS, owner: OTHER, members: [] });
    project.save.mockClear();
    const forged = await request(app).patch('/api/fieldbooks/projects/p1').set(auth()).send({ workspaceId: WS });
    expect(forged.status).toBe(403);
    expect(project.save).not.toHaveBeenCalled();
  });

  it('PATCH: the CRS can be changed by the owner', async () => {
    const project = { _id: 'p1', user: USER, workspace: null, crs: 'EPSG:7801', save: jest.fn().mockResolvedValue(undefined) };
    FieldBookProject.findById.mockResolvedValue(project);
    const res = await request(app).patch('/api/fieldbooks/projects/p1').set(auth()).send({ crs: 'EPSG:7800' });
    expect(res.status).toBe(200);
    expect(project.crs).toBe('EPSG:7800');
  });
});

describe('existing projects still load for a user without pilot access', () => {
  it('GET /projects: own projects, plus projects shared through workspaces', async () => {
    Workspace.find.mockReturnValue({ select: () => Promise.resolve([{ _id: WS }]) });
    const shared = [{ _id: 'shared-1' }];
    const own = [{ _id: 'own-1', name: 'Мой', crs: 'EPSG:7801' }];
    FieldBookProject.find.mockImplementation((filter) => (filter.$or ? findChain(own) : findChain(shared)));
    const res = await request(app).get('/api/fieldbooks/projects').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(own);
    const listFilter = FieldBookProject.find.mock.calls.map((c) => c[0]).find((f) => f.$or);
    expect(listFilter.$or[0]).toEqual({ user: USER });
  });

  it('GET /projects with no workspaces lists only the caller\'s own projects', async () => {
    FieldBookProject.find.mockReturnValue(findChain([{ _id: 'own-1' }]));
    const res = await request(app).get('/api/fieldbooks/projects').set(auth());
    expect(res.status).toBe(200);
    expect(FieldBookProject.find).toHaveBeenCalledWith({ user: USER });
  });
});

describe('the Field Book pilot restriction still protects Field Books', () => {
  const PILOT = { code: 'FIELDBOOK_PILOT_REQUIRED' };

  it.each([
    ['get', '/api/fieldbooks/projects/p1/books'],
    ['post', '/api/fieldbooks/projects/p1/books'],
    ['get', '/api/fieldbooks/books/b1'],
    ['patch', '/api/fieldbooks/books/b1'],
    ['post', '/api/fieldbooks/books/b1/calculate'],
    ['post', '/api/fieldbooks/books/b1/copy'],
    ['delete', '/api/fieldbooks/books/b1'],
  ])('a non-pilot user gets 403 FIELDBOOK_PILOT_REQUIRED on %s %s', async (method, url) => {
    const res = await request(app)[method](url).set(auth()).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject(PILOT);
    expect(FieldBook.create).not.toHaveBeenCalled();
  });

  it('an approved pilot user passes the gate', async () => {
    FieldBookPilotRequest.findOne.mockResolvedValue({ status: 'approved' });
    FieldBookProject.findById.mockResolvedValue({ _id: 'p1', user: USER, workspace: null });
    FieldBook.find.mockReturnValue({ sort: () => Promise.resolve([]) });
    const res = await request(app).get('/api/fieldbooks/projects/p1/books').set(auth());
    expect(res.status).toBe(200);
  });

  it('an admin passes the gate without a pilot record', async () => {
    FieldBookProject.findById.mockResolvedValue({ _id: 'p1', user: USER, workspace: null });
    FieldBook.find.mockReturnValue({ sort: () => Promise.resolve([]) });
    const res = await request(app).get('/api/fieldbooks/projects/p1/books').set(auth('admin'));
    expect(res.status).toBe(200);
  });
});
