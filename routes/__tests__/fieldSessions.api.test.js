process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
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
const F = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');
const pageFx = require('../../tests/support/pageFixtures');

const { CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint } = F;

jest.setTimeout(20000);

beforeEach(() => {
  for (const m of [CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint]) m.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const api = (method, path, body, userId = H.OWNER) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`, userId);
  return body === undefined ? r : r.send(body);
};
const post = (p, b, u) => api('post', p, b === undefined ? {} : b, u);
const get = (p, u) => api('get', p, undefined, u);
const patch = (p, b, u) => api('patch', p, b, u);
const del = (p, u) => api('delete', p, undefined, u);

const obs = (target, over = {}) => ({ target, hz: '100.1234', vz: '99.5', distance: '50.123', prismHeight: '1.8', ...over });
const goodSetups = () => [{
  station: { point: '101', instrumentHeight: '1.52', notes: '' },
  orientation: { target: '102', direction: '0' },
  observations: [obs('201'), obs('202', { hz: '150' }), obs('203', { hz: '200' })],
}];
const create = async (body = {}, userId = H.OWNER) => (await post('/', { projectId: H.PROJECT, ...body }, userId)).body.data;

describe('create / list / get', () => {
  it('creates an empty draft with a Bulgarian default title and optional metadata', async () => {
    const res = await post('/', { projectId: H.PROJECT, date: '2026-10-09', operator: 'В. Желев', instrument: 'Leica TS07', conditions: 'слънчево' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'draft', statusLabel: 'Чернова', source: 'none', sourceLabel: 'Още няма данни', title: 'Теренна сесия — 09.10.2026',
      operator: 'В. Желев', instrument: 'Leica TS07', setupCount: 0, observationCount: 0, confirmed: false, projectId: H.PROJECT,
    });
    // nothing internal is shown
    expect(JSON.stringify(res.body.data)).not.toMatch(/FieldSession|FieldObservationSet|CaptureJob|captureJobId/);
  });

  it('metadata is optional - an entirely empty body (just the project) is a valid session', async () => {
    const s = await create();
    expect(s.title).toMatch(/^Теренна сесия — \d\d\.\d\d\.\d{4}$/);
  });

  it('creating with entries makes a manual session and reports deterministic counts', async () => {
    const s = await create({ setups: goodSetups() });
    expect(s).toMatchObject({ source: 'manual', sourceLabel: 'Ръчно въведена', setupCount: 1, observationCount: 3, issues: { errors: 0, warnings: 2 } }); // station + orientation are not among the project's points
  });

  it.each([
    ['a missing project', {}],
    ['a malformed project id', { projectId: 'nope' }],
    ['a bad date', { projectId: H.PROJECT, date: '09.10.2026' }],
    ['a bad angle unit', { projectId: H.PROJECT, angleUnit: 'rad' }],
    ['non-array setups', { projectId: H.PROJECT, setups: 'x' }],
  ])('rejects %s with 400', async (_, body) => {
    expect((await api('post', '/', body)).status).toBe(400);
  });

  it('lists only this project\'s sessions, newest first, with legacy carnet COUNTS and attached capture ids', async () => {
    const a = await create({ title: 'Първа' });
    const b = await create({ title: 'Втора' });
    await F.FieldSession.create({ user: H.OTHER, projectId: H.OTHER_PROJECT, title: 'Чужда' });
    await FieldBook.create({ user: H.OWNER, project: H.PROJECT, name: 'К1', type: 'coordinate' });
    await FieldBook.create({ user: H.OWNER, project: H.PROJECT, name: 'К2', type: 'leveling', archived: true });
    await FieldBook.create({ user: H.OTHER, project: H.OTHER_PROJECT, name: 'Чужд', type: 'coordinate' });

    const res = await get(`/?projectId=${H.PROJECT}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.title)).toEqual(['Втора', 'Първа']);
    expect(res.body.data.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(res.body.legacyFieldBooks).toEqual({ total: 2, active: 1 });
    expect(res.body.attachedCaptureJobIds).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('Чужда');
  });

  it('GET one returns the session; a malformed or unknown id is a clean 404', async () => {
    const s = await create({ setups: goodSetups() });
    const res = await get(`/${s.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.setups[0].station.point).toBe('101');
    expect(res.body.data.evaluation.summary).toMatchObject({ canConfirm: true, observations: 3 });
    expect((await get('/not-an-id')).status).toBe(404);
    expect((await get('/507f1f77bcf86cd799439999')).status).toBe(404);
  });

  it('the review lists project-reference warnings for a station that is not among the project points', async () => {
    const s = await create({ setups: goodSetups() });
    let detail = (await get(`/${s.id}`)).body.data;
    expect(detail.evaluation.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['STATION_NOT_FOUND', 'ORIENTATION_NOT_FOUND']));
    await SurveyPoint.create({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
    await SurveyPoint.create({ user: H.OWNER, projectId: H.PROJECT, name: '102', x: 1000, y: 2100, h: 500 });
    detail = (await get(`/${s.id}`)).body.data;
    expect(detail.evaluation.issues).toEqual([]);
  });
});

describe('access control and project scoping', () => {
  it('no token -> 401', async () => {
    const request = require('supertest');
    expect((await request(app).get(`/api/field-sessions?projectId=${H.PROJECT}`)).status).toBe(401);
  });

  it('a project the caller cannot see is 404 for every route - existence is never revealed', async () => {
    const foreign = await F.FieldSession.create({ user: H.OTHER, projectId: H.OTHER_PROJECT, title: 'Чужда' });
    expect((await get(`/?projectId=${H.OTHER_PROJECT}`)).status).toBe(404);
    expect((await post('/', { projectId: H.OTHER_PROJECT })).status).toBe(404);
    for (const [m, p, b] of [['get', `/${foreign._id}`], ['patch', `/${foreign._id}`, { title: 'x' }], ['post', `/${foreign._id}/submit`, {}],
      ['post', `/${foreign._id}/confirm`, {}], ['post', `/${foreign._id}/attach-capture`, { captureJobId: H.PROJECT }], ['post', `/${foreign._id}/revise`, {}], ['delete', `/${foreign._id}`]]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await api(m, p, b)).status).toBe(404);
    }
    expect((await F.FieldSession.findById(foreign._id)).title).toBe('Чужда');
  });

  it('a viewer of a shared project can READ sessions but every write is 403', async () => {
    const s = await F.FieldSession.create({ user: H.OTHER, projectId: H.SHARED_PROJECT, title: 'Споделена', source: { kind: 'manual' }, setups: [] });
    expect((await get(`/?projectId=${H.SHARED_PROJECT}`)).body.data.map((x) => x.title)).toEqual(['Споделена']);
    expect((await get(`/${s._id}`)).status).toBe(200);
    expect((await post('/', { projectId: H.SHARED_PROJECT })).status).toBe(403);
    for (const [m, p, b] of [['patch', `/${s._id}`, { title: 'x' }], ['post', `/${s._id}/submit`, {}], ['post', `/${s._id}/confirm`, {}], ['post', `/${s._id}/revise`, {}], ['delete', `/${s._id}`]]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await api(m, p, b)).status).toBe(403);
    }
  });

  it('a session id from one project can never be used through another project\'s access', async () => {
    const foreign = await F.FieldSession.create({ user: H.OTHER, projectId: H.OTHER_PROJECT, title: 'Чужда' });
    const mine = await create();
    // attaching a foreign project's capture to my session is refused, and never reveals it
    const job = await CaptureJob.create({ user: H.OTHER, project: H.OTHER_PROJECT, mode: 'field-notebook', status: 'needs_review', source: { assets: {} } });
    expect((await post(`/${mine.id}/attach-capture`, { captureJobId: String(job._id) })).status).toBe(404);
    expect(foreign.projectId).toBe(H.OTHER_PROJECT);
  });
});

describe('PATCH: entries and metadata', () => {
  it('saves entries, bumps the revision, and returns the evaluation', async () => {
    const s = await create();
    const res = await patch(`/${s.id}`, { setups: goodSetups(), baseRevision: s.revision });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ source: 'manual', revision: s.revision + 1, observationCount: 3 });
    expect(res.body.data.setups[0].observations.map((o) => o.row)).toEqual([0, 1, 2]);
  });

  it('metadata only is fine and leaves entries untouched', async () => {
    const s = await create({ setups: goodSetups() });
    const res = await patch(`/${s.id}`, { operator: 'Иван', conditions: 'дъжд', notes: 'бележка' });
    expect(res.body.data).toMatchObject({ operator: 'Иван', conditions: 'дъжд', notes: 'бележка', observationCount: 3 });
  });

  it('a stale baseRevision is a 409 and changes nothing (no lost update from a second device)', async () => {
    const s = await create({ setups: goodSetups() });
    await patch(`/${s.id}`, { operator: 'Първо устройство', baseRevision: s.revision });
    const stale = await patch(`/${s.id}`, { operator: 'Второ устройство', baseRevision: s.revision });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REVISION_CONFLICT');
    expect((await get(`/${s.id}`)).body.data.operator).toBe('Първо устройство');
  });

  it('rejects an empty change, malformed entries and unknown fields are dropped', async () => {
    const s = await create();
    expect((await patch(`/${s.id}`, {})).status).toBe(400);
    expect((await patch(`/${s.id}`, { setups: [{ station: { point: { $gt: '' } } }] })).status).toBe(400);
    const res = await patch(`/${s.id}`, { title: 'Т', status: 'confirmed', source: { kind: 'capture' }, fieldObservationSetId: H.PROJECT, user: H.OTHER });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'draft', source: 'none' }); // a client can never set state, source or ownership
    expect(FieldSession.__all()[0].user).toBe(H.OWNER);
  });

  it('raw text is kept exactly as entered (interpretation is server-side and re-done on every read)', async () => {
    const s = await create();
    const res = await patch(`/${s.id}`, { setups: [{ station: { point: '101' }, orientation: { target: '102', direction: '0' }, observations: [obs('201', { hz: "94°30'15\"", distance: '50,123' })] }] });
    expect(res.body.data.setups[0].observations[0]).toMatchObject({ hz: "94°30'15\"", distance: '50,123' });
    expect(res.body.data.evaluation.summary.canConfirm).toBe(true);
  });
});

describe('submit for review', () => {
  it('needs at least one observation; then becomes "За проверка" and stays editable', async () => {
    const s = await create();
    const empty = await post(`/${s.id}/submit`);
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('NOTHING_TO_SUBMIT');

    await patch(`/${s.id}`, { setups: goodSetups() });
    const res = await post(`/${s.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'review', statusLabel: 'За проверка' });
    expect((await patch(`/${s.id}`, { operator: 'още' })).status).toBe(200);
  });
});

describe('confirm: immutable evidence', () => {
  it('refuses entries with errors (422, located issues) and releases the claim so they can be fixed', async () => {
    const s = await create({ setups: [{ station: { point: '101' }, orientation: { target: '102', direction: '0' }, observations: [obs('201', { hz: 'abc' }), obs('202', { distance: '' })] }] });
    const res = await post(`/${s.id}/confirm`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERRORS');
    expect(res.body.errors.map((e) => `${e.code}:${e.field}`)).toEqual(['MALFORMED_ANGLE:hz', 'DISTANCE_REQUIRED:distance']);
    expect(FieldObservationSet.__all()).toHaveLength(0);
    // the claim was released: the entries are editable again and a fixed session confirms
    const fixed = await patch(`/${s.id}`, { setups: goodSetups() });
    expect(fixed.status).toBe(200);
    expect((await post(`/${s.id}/confirm`)).status).toBe(200);
  });

  it('creates exactly one observation set equal to the evaluated entries, links it, and marks the session Потвърдена', async () => {
    const s = await create({ setups: goodSetups() });
    const res = await post(`/${s.id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyConfirmed).toBe(false);
    expect(res.body.data).toMatchObject({ status: 'confirmed', statusLabel: 'Потвърдена', confirmed: true });
    expect(res.body.data.observationSetId).toBeTruthy();

    const sets = FieldObservationSet.__all();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ projectId: H.PROJECT, source: { kind: 'session', fieldSessionId: s.id } });
    expect(sets[0].source.captureJobId).toBeUndefined();
    expect(sets[0].notebookVersion).toBe('field-session-1.0.0');
    expect(sets[0].setups[0]).toMatchObject({
      index: 0,
      station: { point: '101', instrumentHeight: { value: 1.52, unit: 'm' } },
      orientation: { target: '102', direction: { value: 0, unit: 'gon' } },
    });
    expect(sets[0].setups[0].observations.map((o) => [o.row, o.target, o.hz.value])).toEqual([[0, '201', 100.1234], [1, '202', 150], [2, '203', 200]]);
    expect(String(sets[0]._id)).toBe(res.body.data.observationSetId);
  });

  it('is idempotent - confirming again (even concurrently) never creates a second set', async () => {
    const s = await create({ setups: goodSetups() });
    const [a, b] = await Promise.all([post(`/${s.id}/confirm`), post(`/${s.id}/confirm`)]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]));
    const again = await post(`/${s.id}/confirm`);
    expect(again.status).toBe(200);
    expect(again.body.alreadyConfirmed).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('the request body is ignored: only the stored entries are ever confirmed', async () => {
    const s = await create({ setups: goodSetups() });
    const res = await post(`/${s.id}/confirm`, { setups: [{ station: { point: 'HACK' }, observations: [obs('X')] }], status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(FieldObservationSet.__all()[0].setups[0].station.point).toBe('101');
  });

  it('after confirmation nothing can change: PATCH, submit and DELETE are 409, entries and evidence are untouched', async () => {
    const s = await create({ setups: goodSetups() });
    await post(`/${s.id}/confirm`);
    const before = JSON.stringify(FieldObservationSet.__all());
    const entriesBefore = JSON.stringify(FieldSession.__all()[0].setups);

    const p = await patch(`/${s.id}`, { setups: [{ station: { point: 'ПОДМЯНА' }, observations: [obs('1')] }] });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('SESSION_CONFIRMED');
    expect((await patch(`/${s.id}`, { operator: 'x' })).status).toBe(409);
    expect((await post(`/${s.id}/submit`)).status).toBe(409);
    expect((await del(`/${s.id}`)).status).toBe(409);
    expect(JSON.stringify(FieldObservationSet.__all())).toBe(before);
    expect(JSON.stringify(FieldSession.__all()[0].setups)).toBe(entriesBefore);
  });

  it('a stale write racing a confirm cannot sneak in: the claim blocks edits', async () => {
    const s = await create({ setups: goodSetups() });
    FieldSession.__mutate(s.id, (row) => { row.confirmClaimedAt = new Date(); }); // a confirm is in flight
    expect((await patch(`/${s.id}`, { operator: 'късно' })).status).toBe(409);
    expect((await post(`/${s.id}/confirm`)).body.code).toBe('CONFIRM_IN_PROGRESS');
  });

  describe('confirm before the one-time index migration (legacy plain unique index on source.captureJobId)', () => {
    const e11000 = () => Object.assign(new Error('E11000 duplicate key error collection: fieldobservationsets index: source.captureJobId_1 dup key: { source.captureJobId: null }'), { code: 11000 });

    it('answers a clean, recoverable 503 (not a generic 500), releases the claim, leaks nothing, and the same session confirms once the index is fixed', async () => {
      const s = await create({ setups: goodSetups() });
      const spy = jest.spyOn(FieldObservationSet, 'create').mockRejectedValueOnce(e11000());
      const res = await post(`/${s.id}/confirm`);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ success: false, code: 'CONFIRM_UNAVAILABLE' });
      expect(res.body.message).toBe('Потвърждаването временно не е налично – системата се обновява. Сесията е запазена, опитайте отново след малко.');
      expect(JSON.stringify(res.body)).not.toMatch(/E11000|captureJobId|index|fieldobservationsets/);
      // nothing half-done: no evidence, still editable, claim released
      expect(FieldObservationSet.__all()).toHaveLength(0);
      const stored = FieldSession.__all()[0];
      expect(stored.status).not.toBe('confirmed');
      expect(stored.confirmClaimedAt).toBeNull();
      expect((await patch(`/${s.id}`, { operator: 'още може' })).status).toBe(200);
      // the migration has been applied: the very same confirm now works, exactly once
      spy.mockRestore();
      const ok = await post(`/${s.id}/confirm`);
      expect(ok.status).toBe(200);
      expect(ok.body.alreadyConfirmed).toBe(false);
      expect(FieldObservationSet.__all()).toHaveLength(1);
      expect((await post(`/${s.id}/confirm`)).body.alreadyConfirmed).toBe(true);
      expect(FieldObservationSet.__all()).toHaveLength(1);
    });

    it('a duplicate key that IS this session\'s own set stays idempotent (same evidence, no error)', async () => {
      const s = await create({ setups: goodSetups() });
      const first = await post(`/${s.id}/confirm`);
      // simulate the lost race: the session lost its confirmation but its set exists, and create() hits the session index
      FieldSession.__mutate(s.id, (row) => { row.status = 'review'; row.confirmClaimedAt = null; row.fieldObservationSetId = null; });
      const spy = jest.spyOn(FieldObservationSet, 'create').mockRejectedValueOnce(e11000());
      const again = await post(`/${s.id}/confirm`);
      spy.mockRestore();
      expect(again.status).toBe(200);
      expect(again.body.data.observationSetId).toBe(first.body.data.observationSetId);
      expect(FieldObservationSet.__all()).toHaveLength(1);
    });

    it('any other failure is still the generic CONFIRM_FAILED and also releases the claim', async () => {
      const s = await create({ setups: goodSetups() });
      jest.spyOn(FieldObservationSet, 'create').mockRejectedValueOnce(new Error('boom'));
      const res = await post(`/${s.id}/confirm`);
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('CONFIRM_FAILED');
      expect(FieldSession.__all()[0].confirmClaimedAt).toBeNull();
    });
  });

  it('a confirmed session exposes the typed evidence (no OCR geometry) and only the processing it supports', async () => {
    const s = await create({ setups: goodSetups() });
    const d = (await post(`/${s.id}/confirm`)).body.data;
    expect(d.evidence.setups[0].observations[0]).toMatchObject({ target: '201', hz: { value: 100.1234, unit: 'gon' } });
    expect(d.evidence.setups[0].observations[0].cells).toBeUndefined();
    expect(d.processingOptions.polar).toEqual({ available: true, reason: null, setupCount: 1, observationCount: 3 });
    expect(d.processingOptions.traverse).toMatchObject({ available: false, reason: 'NEEDS_TWO_STATIONS' });
    expect(d.evaluation).toBeNull(); // there is nothing left to review
  });
});

describe('Field Notebook capture integration (the existing OCR pipeline is reused, never duplicated)', () => {
  // a real page as the Capture pipeline leaves it: two stations, four observations each, nothing to fix
  const notebookJob = (over = {}) => CaptureJob.create({
    ...pageFx.pageJobFields([
      pageFx.station('101', [pageFx.obs('201'), pageFx.obs('202', '20.0000g'), pageFx.obs('203', '30.0000g'), pageFx.obs('204', '40.0000g')]),
      pageFx.station('102', [pageFx.obs('205'), pageFx.obs('206', '20.0000g'), pageFx.obs('207', '30.0000g'), pageFx.obs('208', '40.0000g')], { orientationTarget: '101' }),
    ], { user: H.OWNER, project: H.PROJECT }),
    ...over,
  });
  const confirmJobWithSet = async (job) => {
    const fos = await FieldObservationSet.create({
      user: H.OWNER, projectId: H.PROJECT, source: { kind: 'capture', captureJobId: job._id },
      setups: [{ index: 0, station: { point: '101', instrumentHeight: null, notes: '' }, orientation: { target: '102', direction: null }, observations: [{ row: 0, target: '201', hz: { value: 1, unit: 'gon' }, distance: { value: 10, unit: 'm' }, cells: { hz: { bbox: {} } } }] }],
    });
    CaptureJob.__mutate(job._id, (r) => { r.status = 'confirmed'; r.importedFieldObservationSetId = fos._id; });
    return fos;
  };

  it('attaches the user\'s own notebook; the session mirrors the job\'s state and review counts (nothing is copied)', async () => {
    const job = await notebookJob();
    const s = await create();
    const res = await post(`/${s.id}/attach-capture`, { captureJobId: String(job._id) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      source: 'capture', sourceLabel: 'От снимка на полеви карнет', status: 'review', statusLabel: 'За проверка',
      setupCount: 2, observationCount: 8, issues: { errors: 0, warnings: 0 },
      capture: { attached: true, available: true, status: 'needs_review', mine: true, jobId: String(job._id) },
    });
    expect(res.body.data.setups).toEqual([]); // no entries are duplicated into the session
    expect((await get(`/?projectId=${H.PROJECT}`)).body.attachedCaptureJobIds).toEqual([String(job._id)]);
  });

  it('can be created attached in one step', async () => {
    const job = await notebookJob();
    const res = await post('/', { projectId: H.PROJECT, captureJobId: String(job._id) });
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('capture');
  });

  it('once the capture review confirms the notebook, the session is Потвърдена with the confirmed evidence and processing options', async () => {
    const job = await notebookJob();
    const s = await create({ captureJobId: String(job._id) });
    const fos = await confirmJobWithSet(job);
    const d = (await get(`/${s.id}`)).body.data;
    expect(d).toMatchObject({ status: 'confirmed', confirmed: true, observationSetId: String(fos._id), setupCount: 1, observationCount: 1 });
    expect(d.evidence.setups[0].observations[0].cells).toBeUndefined();
    expect(d.processingOptions.polar.available).toBe(true);
  });

  it('a failed capture, a coordinate table, another user\'s capture, another project\'s capture are all refused', async () => {
    const s = await create();
    const failed = await notebookJob({ status: 'failed' });
    const table = await notebookJob({ mode: 'coordinate-table' });
    const theirs = await notebookJob({ user: H.OTHER });
    const [f, t, o] = await Promise.all([failed, table, theirs].map((j) => post(`/${s.id}/attach-capture`, { captureJobId: String(j._id) })));
    expect([f.status, f.body.code]).toEqual([409, 'CAPTURE_FAILED']);
    expect([t.status, t.body.code]).toEqual([400, 'CAPTURE_NOT_NOTEBOOK']);
    expect([o.status, o.body.code]).toEqual([404, 'CAPTURE_NOT_FOUND']); // not revealed as "someone else's"
    expect((await post(`/${s.id}/attach-capture`, { captureJobId: 'nope' })).status).toBe(400);
    expect((await get(`/${s.id}`)).body.data.source).toBe('none');
  });

  it('a capture belongs to at most ONE session; re-attaching the same one is idempotent', async () => {
    const job = await notebookJob();
    const a = await create();
    const b = await create();
    expect((await post(`/${a.id}/attach-capture`, { captureJobId: String(job._id) })).status).toBe(200);
    expect((await post(`/${a.id}/attach-capture`, { captureJobId: String(job._id) })).status).toBe(200);
    const dup = await post(`/${b.id}/attach-capture`, { captureJobId: String(job._id) });
    expect([dup.status, dup.body.code]).toEqual([409, 'CAPTURE_ALREADY_ATTACHED']);
    expect((await post('/', { projectId: H.PROJECT, captureJobId: String(job._id) })).status).toBe(409);
  });

  it('one evidence source per session: manual data blocks an attach, a capture blocks manual entries (and the manual submit)', async () => {
    const job = await notebookJob();
    const manual = await create({ setups: goodSetups() });
    expect((await post(`/${manual.id}/attach-capture`, { captureJobId: String(job._id) })).body.code).toBe('SOURCE_CONFLICT');
    expect((await post(`/${manual.id}/pages`, { captureJobId: String(job._id) })).body.code).toBe('SOURCE_CONFLICT');

    const withCapture = await create({ captureJobId: String(job._id) });
    expect((await patch(`/${withCapture.id}`, { setups: goodSetups() })).body.code).toBe('SOURCE_CONFLICT');
    expect((await post(`/${withCapture.id}/submit`)).body.code).toBe('USE_CAPTURE_REVIEW');
  });

  it('an EMPTY manual session may still switch to a capture', async () => {
    const job = await notebookJob();
    const s = await create({ setups: [] });
    expect((await post(`/${s.id}/attach-capture`, { captureJobId: String(job._id) })).body.data.source).toBe('capture');
  });

  it('another project member sees the session state but never the uploader\'s private review link', async () => {
    const job = await notebookJob();
    const s = await F.FieldSession.create({ user: H.OTHER, projectId: H.SHARED_PROJECT, source: { kind: 'capture', captureJobId: String(job._id) } });
    CaptureJob.__mutate(job._id, (r) => { r.project = H.SHARED_PROJECT; r.user = H.OTHER; });
    const d = (await get(`/${s._id}`)).body.data; // OWNER is a viewer of the shared project
    expect(d.capture).toMatchObject({ attached: true, available: true, mine: false, status: 'needs_review' });
  });

  it('a capture that no longer exists is reported as unavailable, not guessed', async () => {
    const job = await notebookJob();
    const s = await create({ captureJobId: String(job._id) });
    CaptureJob.__reset();
    const d = (await get(`/${s.id}`)).body.data;
    expect(d).toMatchObject({ status: 'draft', capture: { attached: true, available: false, status: null } });
  });
});

describe('revisions: corrections never overwrite evidence', () => {
  it('only a confirmed session can be revised', async () => {
    const s = await create({ setups: goodSetups() });
    const res = await post(`/${s.id}/revise`);
    expect([res.status, res.body.code]).toEqual([409, 'NOT_CONFIRMED']);
  });

  it('creates a NEW editable draft with identical entries; the original and its evidence stay exactly as they were', async () => {
    const s = await create({ title: 'Станция 101', setups: [{ station: { point: '101', instrumentHeight: '152 cm' }, orientation: { target: '102', direction: "0°30'0\"" }, observations: [obs('201', { hz: "94°30'15\"", distance: '', horizontalDistance: '30 m' })] }] });
    await post(`/${s.id}/confirm`);
    const setBefore = JSON.stringify(FieldObservationSet.__all());

    const res = await post(`/${s.id}/revise`);
    expect(res.status).toBe(201);
    const rev = res.body.data;
    expect(rev).toMatchObject({ status: 'draft', source: 'manual', revisionOf: s.id, title: 'Станция 101 (ревизия)', observationCount: 1 });
    expect(rev.id).not.toBe(s.id);
    expect(rev.evaluation.summary.canConfirm).toBe(true);

    expect(JSON.stringify(FieldObservationSet.__all())).toBe(setBefore);
    const original = (await get(`/${s.id}`)).body.data;
    expect(original).toMatchObject({ status: 'confirmed', hasRevision: true });

    // fix the revision and confirm it: a SECOND, independent set; the first is untouched
    await patch(`/${rev.id}`, { setups: [{ ...rev.setups[0], observations: [{ ...rev.setups[0].observations[0], distance: '', horizontalDistance: '31 m' }] }] });
    expect((await post(`/${rev.id}/confirm`)).status).toBe(200);
    const sets = FieldObservationSet.__all();
    expect(sets).toHaveLength(2);
    expect(sets[0].setups[0].observations[0].horizontalDistance.value).toBe(30);
    expect(sets[1].setups[0].observations[0].horizontalDistance.value).toBe(31);
  });

  it('a confirmed OCR-notebook session can be revised into an editable typed copy too', async () => {
    const job = await CaptureJob.create({ user: H.OWNER, project: H.PROJECT, mode: 'field-notebook', status: 'confirmed', source: { assets: {} } });
    const fos = await FieldObservationSet.create({
      user: H.OWNER, projectId: H.PROJECT, source: { kind: 'capture', captureJobId: job._id },
      setups: [{ index: 0, station: { point: '101', instrumentHeight: { value: 1.5, unit: 'm', explicit: false }, notes: '' }, orientation: { target: '102', direction: { value: 0, unit: 'gon', components: null } },
        observations: [{ row: 3, target: '201', hz: { value: 12.3456, unit: 'gon', components: null }, vz: null, distance: { value: 50, unit: 'm', explicit: false }, horizontalDistance: null, prismHeight: null, code: '', notes: '', cells: { hz: { col: 1, page: 0, bbox: {} } } }] }],
    });
    CaptureJob.__mutate(job._id, (r) => { r.importedFieldObservationSetId = fos._id; });
    const s = await create({ captureJobId: String(job._id) });
    const rev = (await post(`/${s.id}/revise`)).body.data;
    expect(rev).toMatchObject({ source: 'manual', observationCount: 1, evaluation: { summary: { canConfirm: true } } });
    expect(rev.setups[0].observations[0]).toMatchObject({ row: 3, target: '201', hz: '12.3456g', distance: '50' });
  });
});

describe('delete', () => {
  it('removes an unconfirmed session (and frees an attached capture); never a confirmed one', async () => {
    const job = await CaptureJob.create({ user: H.OWNER, project: H.PROJECT, mode: 'field-notebook', status: 'needs_review', source: { assets: {} } });
    const s = await create({ captureJobId: String(job._id) });
    expect((await del(`/${s.id}`)).status).toBe(200);
    expect((await get(`/${s.id}`)).status).toBe(404);
    expect(CaptureJob.__all()).toHaveLength(1); // the capture itself is untouched
    expect((await create({ captureJobId: String(job._id) })).source).toBe('capture'); // and can be attached again

    const confirmed = await create({ setups: goodSetups() });
    await post(`/${confirmed.id}/confirm`);
    expect((await del(`/${confirmed.id}`)).status).toBe(409);
  });
});

describe('legacy FieldBook compatibility (no migration, no loss)', () => {
  it('legacy carnets are untouched and only counted; a project with carnets and no sessions still works', async () => {
    await FieldBook.create({ user: H.OWNER, project: H.PROJECT, name: 'Координатен карнет', type: 'coordinate', rows: [{ pointNo: '1', beta: 100 }] });
    const before = JSON.stringify(FieldBook.__all());
    const res = await get(`/?projectId=${H.PROJECT}`);
    expect(res.body.data).toEqual([]);
    expect(res.body.legacyFieldBooks).toEqual({ total: 1, active: 1 });
    expect(JSON.stringify(res.body)).not.toContain('Координатен карнет'); // content stays behind its own pilot gate
    await create({ setups: goodSetups() });
    expect(JSON.stringify(FieldBook.__all())).toBe(before);
  });
});
