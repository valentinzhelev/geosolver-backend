process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
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

let captureJobCounter = 0;
const nextCaptureJobId = () => `507f1f77bcf86cd7994390${String(captureJobCounter++).padStart(2, '0')}`;

const meas = (value, unit = 'm') => (value === null ? null : { value, unit, explicit: true });
const ang = (value, unit = 'gon') => (value === null ? null : { value, unit, components: null });
const obsRow = (row, target, hz, distance, over = {}) => ({
  row, target, hz: ang(hz), vz: null, distance: null, horizontalDistance: meas(distance), prismHeight: null, code: '', notes: '',
  cells: { hz: { col: 1, page: 0, bbox: { x: 0, y: 0, w: 5, h: 5 } } }, excluded: false, ...over,
});
const setupData = (index, station, backsight, observations, over = {}) => ({
  index, station: { point: station, instrumentHeight: meas(1.5), notes: '' }, orientation: backsight ? { target: backsight, direction: null } : null, observations, ...over,
});

async function seedFieldObservationSet(setups, { user = H.OWNER, projectId = H.PROJECT } = {}) {
  return FieldObservationSet.create({
    user, projectId, source: { kind: 'capture', captureJobId: nextCaptureJobId() },
    pipelineVersion: 'capture-2.3.0', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups,
  });
}

// 100 due south of 101 (zeroed backsight -> orientationConstant0 = 200g); leg1 hz=200 -> bearing 0g (north);
// leg2 hz=300 -> bearing 100g (east). Independently derived, matches the fieldProcessing/__tests__/processTraverse
// unit-level golden values.
function twoLegChain() {
  return [
    setupData(0, '101', '100', [obsRow(0, '102', 200, 100)]),
    setupData(1, '102', '101', [obsRow(1, '103', 300, 50)]),
    setupData(2, '103', '102', []), // occupied too, so an OPEN traverse can chain all the way to it as well
  ];
}

beforeEach(() => {
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '100', x: 900, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const post = (path, body, userId = H.OWNER) => H.authed(app, 'post', `/api/field-processing${path}`, userId).send(body);

describe('POST /api/field-processing/traverse: validation', () => {
  it('missing/invalid fieldObservationSetId -> 400', async () => {
    expect((await post('/traverse', { traverseType: 'OPEN', startIdentifier: '101' })).status).toBe(400);
  });

  it('an invalid traverseType -> 400', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'SPIRAL', startIdentifier: '101' });
    expect(res.status).toBe(400);
  });

  it('a missing startIdentifier -> 400', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN' });
    expect(res.status).toBe(400);
  });

  it('KNOWN_ENDPOINT without an endIdentifier -> 400', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101' });
    expect(res.status).toBe(400);
  });

  it('a viewer (below editor) cannot process -> 403; no project access -> 404', async () => {
    const fos = await seedFieldObservationSet(twoLegChain(), { projectId: H.SHARED_PROJECT, user: H.OTHER });
    expect((await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).status).toBe(403);
    const fos2 = await seedFieldObservationSet(twoLegChain(), { projectId: H.OTHER_PROJECT, user: H.OTHER });
    expect((await post('/traverse', { fieldObservationSetId: fos2._id, traverseType: 'OPEN', startIdentifier: '101' })).status).toBe(404);
  });
});

describe('POST /api/field-processing/traverse: computes a server-authoritative traverse run', () => {
  it('OPEN: raw coordinates, no closure, no adjustment', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' });
    expect(res.status).toBe(201);
    const run = res.body.data;
    expect(run.processingType).toBe('traverse');
    expect(run.resultAuthority).toBe('server');
    expect(run.traverse.traverseType).toBe('OPEN');
    expect(run.traverse.status).toBe('READY');
    expect(run.traverse.legs).toHaveLength(2);
    expect(run.traverse.legs[0]).toMatchObject({ from: '101', to: '102', rawX: 1100, rawY: 2000 });
    expect(run.traverse.legs[1]).toMatchObject({ from: '102', to: '103', rawX: 1100, rawY: 2050 });
    expect(run.traverse.closure.available).toBe(false);
    expect(run.traverse.closure.reason).toBe('OPEN_TRAVERSE');
    expect(run.traverse.adjustment.applied).toBe(false);
  });

  it('KNOWN_ENDPOINT with a perfectly-matching control point -> closure available, Bowditch applied trivially', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '103', x: 1100, y: 2050, h: 500 });
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103' });
    const run = res.body.data;
    expect(run.traverse.closure.available).toBe(true);
    expect(run.traverse.closure.perfectClosure).toBe(true);
    expect(run.traverse.adjustment.applied).toBe(true);
    const last = run.traverse.legs[run.traverse.legs.length - 1];
    expect(last.adjustedX).toBeCloseTo(1100, 3);
    expect(last.adjustedY).toBeCloseTo(2050, 3);
  });

  it('an unresolved start station blocks every leg with a structured reason, never a guess', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: 'GHOST' });
    expect(res.body.data.traverse.status).toBe('INVALID');
    expect(res.body.data.traverse.sequence.state).toBe('DISCONNECTED');
  });

  it('never trusts client-supplied coordinates: the body carries none and none are accepted', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const res = await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101', legs: [{ rawX: 999999 }] });
    expect(res.body.data.traverse.legs[0].rawX).toBe(1100); // the REAL computed value, body ignored
  });
});

describe('GET and listing include traverse runs alongside polar runs', () => {
  it('GET /:id reads back an immutable traverse run', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const created = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).body.data;
    const res = await H.authed(app, 'get', `/api/field-processing/${created.id}`, H.OWNER);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(created);
  });

  it('listing mixes polar and traverse runs for the same FieldObservationSet, newest first', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const traverseRun = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).body.data;
    await new Promise((r) => setTimeout(r, 2));
    const polarRun = (await post('/', { fieldObservationSetId: fos._id })).body.data;
    const res = await H.authed(app, 'get', `/api/field-processing?fieldObservationSetId=${fos._id}`, H.OWNER);
    expect(res.body.data.map((r) => r.id)).toEqual([polarRun.id, traverseRun.id]);
    expect(res.body.data[0].processingType).toBe('polar');
    expect(res.body.data[1].processingType).toBe('traverse');
  });
});

describe('POST /api/field-processing/:id/create-points for a traverse run', () => {
  it('creates SurveyPoints for both new stations with full traverse provenance', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const run = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).body.data;
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.status).toBe(200);
    expect(res.body.created.map((p) => p.name).sort()).toEqual(['102', '103']);
    const p102 = SurveyPoint.__all().find((p) => p.name === '102');
    expect(p102.source).toMatchObject({ kind: 'field-processing', processingType: 'traverse', processingRunId: run.id, setup: 0, observation: 0 });
    expect(p102.x).toBe(1100);
    expect(p102.y).toBe(2000);
  });

  it('is idempotent: a second create-points call creates no duplicates', async () => {
    const fos = await seedFieldObservationSet(twoLegChain());
    const run = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).body.data;
    await post(`/${run.id}/create-points`, {});
    const second = await post(`/${run.id}/create-points`, {});
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped.every((s) => s.reason === 'ALREADY_CREATED')).toBe(true);
    expect(SurveyPoint.__all().filter((p) => p.name === '102')).toHaveLength(1);
  });

  it('a name conflict with an existing project point (e.g. the loop-closing station) is skipped, never overwritten', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '103', x: 1, y: 1, h: 1 }); // pre-existing, deliberately NOT the computed value
    const fos = await seedFieldObservationSet(twoLegChain());
    const run = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'OPEN', startIdentifier: '101' })).body.data;
    const res = await post(`/${run.id}/create-points`, {});
    expect(res.body.created.map((p) => p.name)).toEqual(['102']);
    expect(res.body.skipped).toContainEqual(expect.objectContaining({ target: '103', reason: 'NAME_CONFLICT' }));
    const existing = SurveyPoint.__all().find((p) => p.name === '103');
    expect(existing.x).toBe(1); // untouched
  });

  it('saves the Bowditch-ADJUSTED coordinates for a controlled traverse, not the raw ones', async () => {
    // deliberate small misclosure: control at (1100.03, 2050.02) instead of the exact raw (1100, 2050)
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '103', x: 1100.03, y: 2050.02, h: 500 });
    const fos = await seedFieldObservationSet(twoLegChain());
    // '103' is the endpoint, not a mid-chain station -> nothing new to save from THIS leg, but '102' (mid-chain)
    // must be saved at its ADJUSTED position, not the raw one.
    const run = (await post('/traverse', { fieldObservationSetId: fos._id, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103' })).body.data;
    expect(run.traverse.adjustment.applied).toBe(true);
    const res = await post(`/${run.id}/create-points`, {});
    const p102 = res.body.created.find((p) => p.name === '102');
    expect(p102).toBeTruthy();
    expect(p102.x).not.toBe(1100); // not the raw value
    const leg0 = run.traverse.legs[0];
    expect(p102.x).toBeCloseTo(leg0.adjustedX, 6);
    expect(p102.y).toBeCloseTo(leg0.adjustedY, 6);
  });
});
