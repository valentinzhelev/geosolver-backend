process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(30000);

const CAPTURE_JOB_ID = '507f1f77bcf86cd799439abc';

const meas = (value, unit = 'm') => (value === null ? null : { value, unit, explicit: true });
const ang = (value, unit = 'gon') => (value === null ? null : { value, unit, components: null });
const obsRow = (row, over = {}) => ({ row, target: `T${row}`, hz: ang(0), vz: null, distance: null, horizontalDistance: meas(50), prismHeight: null, code: '', notes: '', cells: { hz: { col: 1, page: 0, bbox: { x: 0, y: 0, w: 5, h: 5 } } }, ...over });
const setupData = (index, over = {}) => ({
  index, station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '102', direction: null }, observations: [obsRow(0)], ...over,
});

async function seedFieldObservationSet(setups, { user = H.OWNER, projectId = H.PROJECT, captureJobId = CAPTURE_JOB_ID } = {}) {
  return FieldObservationSet.create({
    user, projectId, source: { kind: 'capture', captureJobId },
    pipelineVersion: 'capture-2.3.0', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups,
  });
}

beforeEach(() => {
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '102', x: 1000, y: 2100, h: 500 }); // due east -> bearing 100 gon
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const post = (path, body, userId = H.OWNER) => H.authed(app, 'post', `/api/field-processing${path}`, userId).send(body);
const get = (path, userId = H.OWNER) => H.authed(app, 'get', `/api/field-processing${path}`, userId);

describe('POST /api/field-processing: authentication and project access', () => {
  it('no token -> 401', async () => {
    const request = require('supertest');
    expect((await request(app).post('/api/field-processing').send({})).status).toBe(401);
  });

  it('missing/invalid fieldObservationSetId -> 400', async () => {
    expect((await post('/', {})).status).toBe(400);
    expect((await post('/', { fieldObservationSetId: 'not-an-id' })).status).toBe(400);
  });

  it('a non-existent FieldObservationSet -> 404', async () => {
    expect((await post('/', { fieldObservationSetId: '507f1f77bcf86cd799439999' })).status).toBe(404);
  });

  it('a viewer (below editor) cannot process -> 403', async () => {
    const fos = await seedFieldObservationSet([setupData(0)], { projectId: H.SHARED_PROJECT, user: H.OTHER });
    const res = await post('/', { fieldObservationSetId: fos._id });
    expect(res.status).toBe(403);
  });

  it('a user with no access to the project gets 404 (existence not revealed)', async () => {
    const fos = await seedFieldObservationSet([setupData(0)], { projectId: H.OTHER_PROJECT, user: H.OTHER });
    const res = await post('/', { fieldObservationSetId: fos._id });
    expect(res.status).toBe(404);
  });

  it('an invalid verticalAngleConvention -> 400', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    expect((await post('/', { fieldObservationSetId: fos._id, verticalAngleConvention: 'nonsense' })).status).toBe(400);
  });
});

describe('POST /api/field-processing: computes a server-authoritative run', () => {
  it('a resolved station/orientation with a horizontal-distance observation produces XY_ONLY (no height inputs)', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const res = await post('/', { fieldObservationSetId: fos._id });
    expect(res.status).toBe(201);
    const run = res.body.data;
    expect(run).toMatchObject({ resultAuthority: 'server', status: 'completed', project: H.PROJECT });
    expect(run.source).toMatchObject({ fieldObservationSetId: fos._id, captureJobId: CAPTURE_JOB_ID });
    expect(run.processingVersion).toBeTruthy();
    expect(run.engineVersions).toMatchObject({ 'orientation-constant': 1, 'polar-horizontal': 1 });
    const setup = run.setups[0];
    expect(setup.setupError).toBeNull();
    expect(setup.station.point).toMatchObject({ name: '101', x: 1000, y: 2000 });
    expect(setup.observations[0]).toMatchObject({ target: 'T0', status: 'XY_ONLY', x: 1000, y: 2050 });
  });

  it('with a declared zenith convention and full height inputs, the observation is READY', async () => {
    const row = obsRow(0, { horizontalDistance: null, distance: meas(100), vz: ang(100), prismHeight: meas(2.0) });
    const fos = await seedFieldObservationSet([setupData(0, { observations: [row] })]);
    const res = await post('/', { fieldObservationSetId: fos._id, verticalAngleConvention: 'zenith' });
    expect(res.body.data.verticalAngleConvention).toBe('zenith');
    const obs = res.body.data.setups[0].observations[0];
    expect(obs.status).toBe('READY');
    expect(obs.h).toBeCloseTo(499.5, 3); // 500 + 1.5 + 0 - 2.0 (horizontal shot)
  });

  it('an unresolvable station blocks that setup only, reported with the specific reason', async () => {
    const fos = await seedFieldObservationSet([setupData(0, { station: { point: 'GHOST', instrumentHeight: null, notes: '' } })]);
    const res = await post('/', { fieldObservationSetId: fos._id });
    expect(res.body.data.setups[0].setupError).toBe('STATION_MISSING');
    expect(res.body.data.setups[0].observations[0].status).toBe('ERROR');
  });

  it('an ambiguous station name is reported distinctly and never guessed', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1, y: 1, h: 1 }); // a second "101"
    const fos = await seedFieldObservationSet([setupData(0)]);
    const res = await post('/', { fieldObservationSetId: fos._id });
    expect(res.body.data.setups[0].setupError).toBe('STATION_AMBIGUOUS');
  });

  it('never trusts client-supplied station/orientation coordinates: the body has none and none are accepted', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const res = await post('/', { fieldObservationSetId: fos._id, setups: [{ station: { x: 999999, y: 999999 } }] });
    expect(res.body.data.setups[0].station.point.x).toBe(1000); // the REAL SurveyPoint, body ignored
  });
});

describe('GET /api/field-processing/:id and listing', () => {
  it('reads back an immutable run', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const created = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await get(`/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(created);
  });

  it('a run from another project is not found (404, not 403 - existence not revealed)', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const created = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await H.authed(app, 'get', `/api/field-processing/${created.id}`, H.OTHER);
    expect(res.status).toBe(404);
  });

  it('lists runs for a FieldObservationSet, newest first', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const a = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    await new Promise((r) => setTimeout(r, 2));
    const b = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await get(`?fieldObservationSetId=${fos._id}`);
    expect(res.body.data.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('lists runs project-wide via ?projectId=, across different FieldObservationSets, newest first', async () => {
    const fosA = await seedFieldObservationSet([setupData(0)], { captureJobId: '507f1f77bcf86cd799439ab1' });
    const a = (await post('/', { fieldObservationSetId: fosA._id })).body.data;
    await new Promise((r) => setTimeout(r, 2));
    const fosB = await seedFieldObservationSet([setupData(0)], { captureJobId: '507f1f77bcf86cd799439ab2' });
    const b = (await post('/', { fieldObservationSetId: fosB._id })).body.data;
    const res = await get(`?projectId=${H.PROJECT}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('?projectId= respects the same access rule as the fieldObservationSetId path (404 for no access, not 403)', async () => {
    const res = await H.authed(app, 'get', `/api/field-processing?projectId=${H.OTHER_PROJECT}`, H.OWNER);
    expect(res.status).toBe(404);
  });

  it('an invalid ?projectId= is rejected with 400', async () => {
    const res = await get('?projectId=not-an-id');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/field-processing/:id/create-points ("Създай точки")', () => {
  it('creates SurveyPoints for READY/XY_ONLY targets with full field-processing provenance', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const run = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0]).toMatchObject({ name: 'T0', x: 1000, y: 2050 });
    const points = SurveyPoint.__all().filter((p) => p.name === 'T0');
    expect(points).toHaveLength(1);
    expect(points[0].source).toMatchObject({ kind: 'field-processing', processingRunId: run.id, fieldObservationSetId: fos._id, setup: 0, observation: 0 });
    expect(res.body.data.generatedPointIds).toEqual([points[0]._id]);
    expect(res.body.data.pointsCreatedAt).toBeTruthy();
  });

  it('never creates SurveyPoints before this explicit call', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    await post('/', { fieldObservationSetId: fos._id });
    expect(SurveyPoint.__all().filter((p) => p.name === 'T0')).toHaveLength(0);
  });

  it('is idempotent: a second call creates no duplicates, reports ALREADY_CREATED', async () => {
    const fos = await seedFieldObservationSet([setupData(0)]);
    const run = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    await post(`/${run.id}/create-points`, {});
    const second = await post(`/${run.id}/create-points`, {});
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped).toEqual([{ setup: 0, observation: 0, target: 'T0', reason: 'ALREADY_CREATED' }]);
    expect(SurveyPoint.__all().filter((p) => p.name === 'T0')).toHaveLength(1);
  });

  it('a name conflict with an EXISTING project point is skipped safely, never overwritten', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'T0', x: 1, y: 1, h: 1 });
    const fos = await seedFieldObservationSet([setupData(0)]);
    const run = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.body.created).toHaveLength(0);
    expect(res.body.skipped[0]).toMatchObject({ target: 'T0', reason: 'NAME_CONFLICT' });
    const existing = SurveyPoint.__all().find((p) => p.name === 'T0');
    expect(existing.x).toBe(1); // untouched
  });

  it('ERROR observations are never saved, even implicitly', async () => {
    const fos = await seedFieldObservationSet([setupData(0, { observations: [obsRow(0, { hz: null })] })]);
    const run = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    expect(run.setups[0].observations[0].status).toBe('ERROR');
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.body.created).toHaveLength(0);
  });

  it('WARNING (duplicate target across setups) is not auto-saved by default', async () => {
    const setups = [setupData(0, { observations: [obsRow(0, { target: 'DUP' })] }), setupData(1, { observations: [obsRow(0, { target: 'DUP' })] })];
    const fos = await seedFieldObservationSet(setups);
    const run = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    expect(run.setups[0].observations[0].status).toBe('WARNING');
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.body.created).toHaveLength(0);
  });

  it('a viewer (below editor) cannot create points, even for a run that already exists', async () => {
    const fos = await seedFieldObservationSet([setupData(0)], { projectId: H.SHARED_PROJECT, user: H.OTHER });
    // create the run as OTHER (the project owner), who has editor+ access
    const run = (await post('/', { fieldObservationSetId: fos._id }, H.OTHER)).body.data;
    const res = await post(`/${run.id}/create-points`, {}, H.OWNER); // OWNER is only a viewer on SHARED_PROJECT
    expect(res.status).toBe(403);
    expect(SurveyPoint.__all().filter((p) => p.name === 'T0')).toHaveLength(0);
  });
});
