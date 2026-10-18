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
const P = require('../../tests/support/pageFixtures');

const { CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint } = F;

jest.setTimeout(30000);

/**
 * MULTI-PAGE FIELD SESSIONS - API contract: attach / detach / reorder pages, ownership, limits, unified view, confirm.
 * Pages are real reconstructed + evaluated notebooks (tests/support/pageFixtures.js); the session routes, the page merge and the
 * capture-confirm guard are the real code. Races against a real MongoDB are in fieldSessions.pages.mongo.integration.test.js.
 */
beforeEach(() => {
  for (const m of [CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint]) m.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.FIELD_SESSION_MAX_PAGES; });

const api = (method, path, body, userId = H.OWNER) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`, userId);
  return body === undefined ? r : r.send(body);
};
const post = (p, b, u) => api('post', p, b === undefined ? {} : b, u);
const get = (p, u) => api('get', p, undefined, u);
const patch = (p, b, u) => api('patch', p, b, u);
const del = (p, u) => api('delete', p, undefined, u);
const capturePost = (path, userId = H.OWNER) => H.authed(app, 'post', `/api/capture${path}`, userId).send({});
const capturePatch = (path, body, userId = H.OWNER) => H.authed(app, 'patch', `/api/capture${path}`, userId).send(body);

const makeJob = (setups, opts = {}) => CaptureJob.create(P.pageJobFields(setups, { user: H.OWNER, project: H.PROJECT, ...opts }));
const page1 = () => makeJob([P.station('101', [P.obs('201'), P.obs('202', '20.0000g')])]);
const page2 = () => makeJob([P.continuation([P.obs('203', '30.0000g'), P.obs('204', '40.0000g')])]);
const page3 = () => makeJob([P.station('102', [P.obs('205', '50.0000g'), P.obs('206', '60.0000g')], { orientationTarget: '101' })]);
const newSession = async (body = {}) => (await post('/', { projectId: H.PROJECT, ...body })).body.data;
const addPage = (sid, job, extra = {}) => post(`/${sid}/pages`, { captureJobId: String(job._id), ...extra });
const pageIds = (d) => d.pages.map((p) => p.id);
const storedSession = (id) => FieldSession.__all().find((s) => s._id === id);

describe('pages: attach (POST /:id/pages)', () => {
  it('appends pages in order; each carries its number, state and counts - and nothing internal is printed', async () => {
    const [j1, j2, j3] = [await page1(), await page2(), await page3()];
    const s = await newSession();
    expect((await addPage(s.id, j1)).status).toBe(201);
    await addPage(s.id, j2);
    const d = (await addPage(s.id, j3)).body.data;
    expect(d.source).toBe('capture');
    expect(d.sourceLabel).toBe('От снимки на полеви карнет (3 страници)');
    expect(d.pageCount).toBe(3);
    expect(d.pages.map((p) => [p.page, p.id, p.state])).toEqual([[1, String(j1._id), 'ready'], [2, String(j2._id), 'ready'], [3, String(j3._id), 'ready']]);
    expect(d.pages[1]).toMatchObject({ observationCount: 2, continuesStation: '101', mine: true, hasImage: true, errors: 0 });
    expect(d.status).toBe('review');
    expect(JSON.stringify(d.logical)).not.toMatch(/captureJob|FieldSession|FieldObservationSet/);
  });

  it('persists the structure: ordered sources + the legacy mirror of page 1 (an older reader still sees a capture)', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const row = storedSession(s.id);
    expect(row.source).toMatchObject({ kind: 'capture', captureJobId: String(j1._id) });
    expect(row.sources.map((p) => [p.captureJobId, p.order])).toEqual([[String(j1._id), 0], [String(j2._id), 1]]);
  });

  it('inserts at a position and renumbers; the mirror follows page 1', async () => {
    const [j1, j2, j3] = [await page1(), await page2(), await page3()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const d = (await addPage(s.id, j3, { position: 0 })).body.data;
    expect(pageIds(d)).toEqual([String(j3._id), String(j1._id), String(j2._id)]);
    expect(storedSession(s.id).source.captureJobId).toBe(String(j3._id));
  });

  it('the same capture twice in one session is a clear PAGE_DUPLICATE (409), nothing changes', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    const before = storedSession(s.id);
    const again = await addPage(s.id, j1);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PAGE_DUPLICATE');
    expect(storedSession(s.id).revision).toBe(before.revision);
  });

  it('one capture can never be a page of TWO sessions (CAPTURE_ALREADY_ATTACHED), whichever structure holds it', async () => {
    const j1 = await page1();
    const a = await newSession();
    const b = await newSession();
    await addPage(a.id, j1);
    for (const res of [await addPage(b.id, j1), await post(`/${b.id}/attach-capture`, { captureJobId: String(j1._id) }), await post('/', { projectId: H.PROJECT, captureJobId: String(j1._id) })]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CAPTURE_ALREADY_ATTACHED');
    }
    // and a LEGACY record (no `sources`, only the old single field) still owns its capture
    const legacyJob = await page1();
    await F.FieldSession.create({ user: H.OWNER, projectId: H.PROJECT, source: { kind: 'capture', captureJobId: String(legacyJob._id) } });
    expect((await addPage(b.id, legacyJob)).body.code).toBe('CAPTURE_ALREADY_ATTACHED');
  });

  it('refuses without leaking: another user\'s capture, another project\'s capture, a coordinate table, an unknown id', async () => {
    const s = await newSession();
    const others = await CaptureJob.create(P.pageJobFields([P.station('101', [P.obs('201')])], { user: H.OTHER, project: H.PROJECT }));
    const elsewhere = await CaptureJob.create(P.pageJobFields([P.station('101', [P.obs('201')])], { user: H.OWNER, project: H.OTHER_PROJECT }));
    const table = await CaptureJob.create({ user: H.OWNER, project: H.PROJECT, mode: 'coordinate-table', status: 'needs_review', source: { assets: {} } });
    for (const id of [others._id, elsewhere._id]) {
      const r = await post(`/${s.id}/pages`, { captureJobId: String(id) });
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('CAPTURE_NOT_FOUND');
    }
    expect((await post(`/${s.id}/pages`, { captureJobId: String(table._id) })).body.code).toBe('CAPTURE_NOT_NOTEBOOK');
    expect((await post(`/${s.id}/pages`, { captureJobId: '507f1f77bcf86cd7994399ff' })).body.code).toBe('CAPTURE_NOT_FOUND');
    expect((await post(`/${s.id}/pages`, { captureJobId: 'nope' })).body.code).toBe('INVALID_REQUEST');
    expect((await post(`/${s.id}/pages`, {})).body.code).toBe('INVALID_REQUEST');
    expect(storedSession(s.id).sources).toBeUndefined();
  });

  it('a confirmed capture is not a new page (it is already evidence); a FAILED capture is accepted and shown retryable', async () => {
    const s = await newSession();
    const confirmed = await makeJob([P.station('101', [P.obs('201')])], { status: 'confirmed' });
    expect((await addPage(s.id, confirmed)).body.code).toBe('CAPTURE_CONFIRMED');
    const failed = await makeJob([], { status: 'failed' });
    const d = (await addPage(s.id, failed)).body.data;
    expect(d.pages[0]).toMatchObject({ page: 1, state: 'failed' });
    expect(d.evaluation.issues.find((i) => i.code === 'PAGE_FAILED')).toMatchObject({ severity: 'error', page: 1 });
    expect(d.evaluation.summary.canConfirm).toBe(false);
  });

  it('the page limit is configurable and enforced with a clear error', async () => {
    process.env.FIELD_SESSION_MAX_PAGES = '2';
    const s = await newSession();
    await addPage(s.id, await page1());
    await addPage(s.id, await page2());
    const third = await addPage(s.id, await page3());
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: 'PAGE_LIMIT_REACHED', maxPages: 2 });
    await expect(get(`/${s.id}`).then((r) => r.body.data.pageCount)).resolves.toBe(2);
  });

  it('typed manual entries block a page; an EMPTY manual session becomes capture-backed', async () => {
    const manual = await newSession({ setups: [{ station: { point: '101' }, observations: [{ target: '201', hz: '10', distance: '25' }] }] });
    expect((await addPage(manual.id, await page1())).body.code).toBe('SOURCE_CONFLICT');
    const empty = await newSession({ setups: [] });
    expect((await addPage(empty.id, await page1())).status).toBe(201);
  });

  it('a stale revision is refused with REVISION_CONFLICT; a viewer cannot change pages (403); an outsider gets 404', async () => {
    const s = await newSession();
    expect((await addPage(s.id, await page1(), { baseRevision: 99 })).body.code).toBe('REVISION_CONFLICT');
    const shared = await F.FieldSession.create({ user: H.OTHER, projectId: H.SHARED_PROJECT });
    const j = await CaptureJob.create(P.pageJobFields([P.station('101', [P.obs('201')])], { user: H.OWNER, project: H.SHARED_PROJECT }));
    expect((await post(`/${shared._id}/pages`, { captureJobId: String(j._id) })).status).toBe(403);
    expect((await post(`/${s.id}/pages`, { captureJobId: String(j._id) }, H.OTHER)).status).toBe(404);
  });

  it('the original attach-capture contract is unchanged: idempotent for the same capture, SOURCE_CONFLICT for a second one', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    expect((await post(`/${s.id}/attach-capture`, { captureJobId: String(j1._id) })).status).toBe(200);
    expect((await post(`/${s.id}/attach-capture`, { captureJobId: String(j1._id) })).status).toBe(200);
    expect(storedSession(s.id).sources).toHaveLength(1);
    expect((await post(`/${s.id}/attach-capture`, { captureJobId: String(j2._id) })).body.code).toBe('SOURCE_CONFLICT');
  });
});

describe('pages: detach (DELETE /:id/pages/:pageId)', () => {
  it('removes the page from the session only - the capture itself survives, untouched', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const jobsBefore = JSON.stringify(CaptureJob.__all());
    const res = await del(`/${s.id}/pages/${j1._id}`);
    expect(res.status).toBe(200);
    expect(pageIds(res.body.data)).toEqual([String(j2._id)]);
    expect(res.body.data.pages[0].page).toBe(1); // renumbered
    expect(JSON.stringify(CaptureJob.__all())).toBe(jobsBefore);
    expect(storedSession(s.id).source.captureJobId).toBe(String(j2._id)); // the mirror follows
    // and it is free to be a page of another session now
    const other = await newSession();
    expect((await addPage(other.id, j1)).status).toBe(201);
  });

  it('detaching the last page returns the session to "no data yet" so manual entry may start', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    const d = (await del(`/${s.id}/pages/${j1._id}`)).body.data;
    expect(d).toMatchObject({ source: 'none', pageCount: 0, pages: [] });
    expect(storedSession(s.id).source).toMatchObject({ kind: null, captureJobId: null });
    expect((await patch(`/${s.id}`, { setups: [{ station: { point: '101' }, observations: [] }] })).status).toBe(200);
  });

  it('an unknown page is PAGE_NOT_FOUND; a stale revision is refused', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    expect((await del(`/${s.id}/pages/507f1f77bcf86cd7994399ff`)).body.code).toBe('PAGE_NOT_FOUND');
    expect((await del(`/${s.id}/pages/nope`)).body.code).toBe('PAGE_NOT_FOUND');
    expect((await H.authed(app, 'delete', `/api/field-sessions/${s.id}/pages/${j1._id}?baseRevision=99`)).body.code).toBe('REVISION_CONFLICT');
  });

  it('deleting a draft session never deletes its captures', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    expect((await del(`/${s.id}`)).status).toBe(200);
    expect(CaptureJob.__all().map((j) => j._id).sort()).toEqual([String(j1._id), String(j2._id)].sort());
  });
});

describe('pages: reorder (PATCH /:id/pages/reorder)', () => {
  it('persists an explicit order and the merge follows it', async () => {
    const [j1, j2, j3] = [await page1(), await page2(), await page3()];
    const s = await newSession();
    for (const j of [j1, j2, j3]) await addPage(s.id, j);
    const order = [j1, j3, j2].map((j) => String(j._id));
    const res = await patch(`/${s.id}/pages/reorder`, { pageIds: order });
    expect(res.status).toBe(200);
    expect(pageIds(res.body.data)).toEqual(order);
    expect(storedSession(s.id).sources.map((p) => [p.captureJobId, p.order])).toEqual(order.map((id, i) => [id, i]));
    // page 3 (station 102) is now page 2 and the continuation page follows it: it continues station 102
    expect(res.body.data.pages[2].continuesStation).toBe('102');
    await expect(get(`/${s.id}`).then((r) => pageIds(r.body.data))).resolves.toEqual(order); // survives a reload
  });

  it('NEVER touches the captures: no job is read-written, no OCR re-run (reordering is a session-only write)', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const jobsBefore = JSON.stringify(CaptureJob.__all());
    const spies = ['create', 'findOneAndUpdate', 'updateOne', 'updateMany'].map((m) => jest.spyOn(CaptureJob, m));
    await patch(`/${s.id}/pages/reorder`, { pageIds: [String(j2._id), String(j1._id)] });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(JSON.stringify(CaptureJob.__all())).toBe(jobsBefore);
  });

  it('the same order is a no-op: no write, no revision bump', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const rev = storedSession(s.id).revision;
    const res = await patch(`/${s.id}/pages/reorder`, { pageIds: [String(j1._id), String(j2._id)] });
    expect(res.status).toBe(200);
    expect(storedSession(s.id).revision).toBe(rev);
  });

  it('must be EXACTLY the current pages - no missing, extra, duplicate or foreign ids', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const a = String(j1._id);
    const b = String(j2._id);
    for (const bad of [[a], [a, b, a], [a, a], [a, '507f1f77bcf86cd7994399ff'], [], 'ab', null, [a, b, b]]) {
      expect((await patch(`/${s.id}/pages/reorder`, { pageIds: bad })).body.code).toBe('INVALID_REQUEST');
    }
    expect(pageIds((await get(`/${s.id}`)).body.data)).toEqual([a, b]);
  });

  it('a stale revision is refused', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    expect((await patch(`/${s.id}/pages/reorder`, { pageIds: [String(j1._id)], baseRevision: 99 })).body.code).toBe('REVISION_CONFLICT');
  });
});

describe('the unified review (GET /:id)', () => {
  it('one logical notebook across pages: merged setups, page numbers, a session-wide evaluation', async () => {
    const [j1, j2, j3] = [await page1(), await page2(), await page3()];
    const s = await newSession();
    for (const j of [j1, j2, j3]) await addPage(s.id, j);
    const d = (await get(`/${s.id}`)).body.data;
    expect(d.setupCount).toBe(2);
    expect(d.observationCount).toBe(6);
    expect(d.issues).toEqual({ errors: 0, warnings: 0 });
    expect(d.evaluation.summary).toMatchObject({ pages: 3, setups: 2, observations: 6, errors: 0, canConfirm: true });
    expect(d.logical.setups.map((st) => [st.station.point, st.pages, st.observations.map((o) => [o.target, o.page])])).toEqual([
      ['101', [1, 2], [['201', 1], ['202', 1], ['203', 2], ['204', 2]]],
      ['102', [3], [['205', 3], ['206', 3]]],
    ]);
    expect(d.logical.setups[0].observations[2]).toMatchObject({ pageSetup: 0, pageRow: 0 }); // where to jump to in the page
    expect(d.logical.setups[0].observations[0].bbox).toMatchObject({ x: expect.any(Number), w: expect.any(Number) });
    // the list agrees with the detail
    const row = (await get(`/?projectId=${H.PROJECT}`)).body.data.find((x) => x.id === s.id);
    expect(row).toMatchObject({ setupCount: 2, observationCount: 6, issues: { errors: 0, warnings: 0 }, pageCount: 3 });
  });

  it('issues name the page, the setup, the row and the field', async () => {
    const s = await newSession();
    await addPage(s.id, await page1());
    await addPage(s.id, await makeJob([P.continuation([P.obs('203', '30.0000g'), P.obs('204', '40.0000g', { distance: '2x5' })])]));
    const d = (await get(`/${s.id}`)).body.data;
    const bad = d.evaluation.issues.find((i) => i.code === 'MALFORMED_DISTANCE');
    expect(bad).toMatchObject({ severity: 'error', page: 2, pageSetup: 0, pageRow: 1, field: 'distance', setup: 0 });
    expect(d.evaluation.summary.canConfirm).toBe(false);
    expect(d.issues.errors).toBeGreaterThan(0);
  });

  it('SCENARIO B: a repeated heading with a different instrument height is a blocking conflict, resolved by editing one page', async () => {
    const s = await newSession();
    const j1 = await makeJob([P.station('101', [P.obs('201')], { hi: '1.500' })]);
    const j2 = await makeJob([P.station('101', [P.obs('202', '20.0000g')], { hi: '1.700' })]);
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const blocked = (await get(`/${s.id}`)).body.data;
    expect(blocked.evaluation.issues.find((i) => i.code === 'CROSS_PAGE_CONFLICT')).toMatchObject({ severity: 'error', page: 2, otherPage: 1 });
    const refused = await post(`/${s.id}/confirm`);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('VALIDATION_ERRORS');
    expect(refused.body.errors.map((e) => e.code)).toContain('CROSS_PAGE_CONFLICT');
    expect(FieldObservationSet.__all()).toHaveLength(0);
    // the user fixes page 2's cell through the existing capture review edit
    const edit = await capturePatch(`/jobs/${j2._id}/cells`, { edits: [{ setup: 0, section: 'station', field: 'instrumentHeight', value: '1.500' }], baseRevision: 0 });
    expect(edit.status).toBe(200);
    const ok = await post(`/${s.id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.setupCount).toBe(1);
  });
});

describe('confirm: ONE evidence set from all pages (SCENARIO A shape)', () => {
  const threePages = async () => {
    const jobs = [await page1(), await page2(), await page3()];
    const s = await newSession();
    for (const j of jobs) await addPage(s.id, j);
    return { s, jobs };
  };

  it('creates exactly ONE FieldObservationSet: two setups, six observations, each carrying its page', async () => {
    const { s, jobs } = await threePages();
    const res = await post(`/${s.id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alreadyConfirmed: false, data: { status: 'confirmed', statusLabel: 'Потвърдена', setupCount: 2, observationCount: 6 } });
    const sets = FieldObservationSet.__all();
    expect(sets).toHaveLength(1);
    expect(sets[0].source).toEqual({ kind: 'session', fieldSessionId: s.id });
    expect(sets[0].notebookVersion).toBe('field-session-merge-1.0.0');
    expect(sets[0].pages.map((p) => [p.page, p.captureJobId])).toEqual(jobs.map((j, i) => [i, String(j._id)]));
    expect(sets[0].setups).toHaveLength(2);
    expect(sets[0].setups.map((st) => st.station.point)).toEqual(['101', '102']);
    expect(sets[0].setups[0].observations.map((o) => o.target)).toEqual(['201', '202', '203', '204']);
    expect(sets[0].setups[0].observations.map((o) => o.row)).toEqual([0, 1, 2, 3]);
    expect(sets[0].setups[0].observations.map((o) => o.source.page)).toEqual([0, 0, 1, 1]);
    expect(sets[0].setups[0].observations[2].source).toMatchObject({ captureJobId: String(jobs[1]._id), setup: 0, row: 0 });
  });

  it('is idempotent: confirming again returns the same set and creates nothing', async () => {
    const { s } = await threePages();
    const first = await post(`/${s.id}/confirm`);
    const again = await post(`/${s.id}/confirm`);
    expect(again.body.alreadyConfirmed).toBe(true);
    expect(again.body.data.observationSetId).toBe(first.body.data.observationSetId);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('concurrent confirms: one evidence set, every response agrees', async () => {
    const { s } = await threePages();
    const burst = await Promise.all(Array.from({ length: 8 }, () => post(`/${s.id}/confirm`)));
    expect(FieldObservationSet.__all()).toHaveLength(1);
    const ok = burst.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.data.observationSetId)).size).toBe(1);
    expect(burst.some((r) => r.status >= 500)).toBe(false);
  });

  it('freezes the pages: the captures are confirmed (pointing at the session\'s set), un-editable, and not re-confirmable on their own', async () => {
    const { s, jobs } = await threePages();
    const confirmed = await post(`/${s.id}/confirm`);
    const setId = confirmed.body.data.observationSetId;
    for (const j of CaptureJob.__all()) expect(j).toMatchObject({ status: 'confirmed', importedFieldObservationSetId: setId });
    const edit = await capturePatch(`/jobs/${jobs[0]._id}/cells`, { edits: [{ setup: 0, section: 'station', field: 'point', value: 'X' }], baseRevision: 0 });
    expect(edit.status).toBe(409);
    const viaCapture = await capturePost(`/jobs/${jobs[1]._id}/confirm`);
    expect(viaCapture.body.observationSetId).toBe(setId); // idempotent: the SESSION's set, never a second one
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('after confirmation nothing about the pages can change (attach, detach, reorder are 409 SESSION_CONFIRMED) and the evidence stays', async () => {
    const { s, jobs } = await threePages();
    await post(`/${s.id}/confirm`);
    const before = JSON.stringify(FieldObservationSet.__all());
    const extra = await page1();
    expect((await addPage(s.id, extra)).body.code).toBe('SESSION_CONFIRMED');
    expect((await del(`/${s.id}/pages/${jobs[0]._id}`)).body.code).toBe('SESSION_CONFIRMED');
    expect((await patch(`/${s.id}/pages/reorder`, { pageIds: jobs.map((j) => String(j._id)).reverse() })).body.code).toBe('SESSION_CONFIRMED');
    expect((await del(`/${s.id}`)).body.code).toBe('SESSION_CONFIRMED');
    expect(JSON.stringify(FieldObservationSet.__all())).toBe(before);
    expect(pageIds((await get(`/${s.id}`)).body.data)).toEqual(jobs.map((j) => String(j._id)));
  });

  it('a confirmed multi-page session shows its evidence with page numbers and NO internal ids or OCR geometry', async () => {
    const { s } = await threePages();
    const d = (await post(`/${s.id}/confirm`)).body.data;
    expect(d.evidence.setups[0].observations.map((o) => o.page)).toEqual([1, 1, 2, 2]);
    expect(d.evidence.setups[0].observations[0].cells).toBeUndefined();
    expect(d.evidence.setups[0].observations[0].source).toBeUndefined();
    expect(d.pages.map((p) => [p.page, p.state, p.observationCount])).toEqual([[1, 'confirmed', 2], [2, 'confirmed', 2], [3, 'confirmed', 2]]);
    expect(d.processingOptions.polar).toMatchObject({ available: true, setupCount: 2, observationCount: 6 });
    expect(d.logical).toBeNull();
    expect(d.evaluation).toBeNull();
  });

  it('blocking issues refuse the confirm (422) and leave NO claim behind: the session and every page stay editable', async () => {
    const s = await newSession();
    const j1 = await page1();
    const j2 = await makeJob([P.continuation([P.obs('202', '20.0000g'), P.obs('203', '30.0000g')])]); // 202 repeats page 1
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const res = await post(`/${s.id}/confirm`);
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.code)).toEqual(['DUPLICATE_OBSERVATION_ACROSS_PAGES', 'DUPLICATE_OBSERVATION_ACROSS_PAGES']);
    expect(FieldObservationSet.__all()).toHaveLength(0);
    expect(storedSession(s.id).confirmClaimedAt).toBeNull();
    for (const j of CaptureJob.__all()) expect(j).toMatchObject({ status: 'needs_review', confirmClaimedAt: null });
    expect((await del(`/${s.id}/pages/${j2._id}`)).status).toBe(200); // still editable
  });

  it('a page that is still processing, failed or missing blocks the confirm; removing it unblocks the rest', async () => {
    const s = await newSession();
    await addPage(s.id, await page1());
    const failed = await makeJob([], { status: 'failed' });
    await addPage(s.id, failed);
    expect((await post(`/${s.id}/confirm`)).body.errors.map((e) => e.code)).toContain('PAGE_FAILED');
    await del(`/${s.id}/pages/${failed._id}`);
    expect((await post(`/${s.id}/confirm`)).status).toBe(200);
  });

  it('a session with no page cannot confirm', async () => {
    const s = await newSession();
    await post(`/${s.id}/attach-capture`, { captureJobId: String((await page1())._id) });
    await del(`/${s.id}/pages/${CaptureJob.__all()[0]._id}`);
    const res = await post(`/${s.id}/confirm`);
    expect([409, 422]).toContain(res.status); // nothing to confirm: manual path says "no observations", never a set
    expect(FieldObservationSet.__all()).toHaveLength(0);
  });
});

describe('the capture flow cannot create a second piece of evidence for a session page', () => {
  it('confirming ONE page of a multi-page session through the capture route is refused (BELONGS_TO_SESSION) and leaves no claim', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const res = await capturePost(`/jobs/${j1._id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BELONGS_TO_SESSION');
    expect(FieldObservationSet.__all()).toHaveLength(0);
    expect(CaptureJob.__all().find((j) => j._id === String(j1._id))).toMatchObject({ status: 'needs_review', confirmClaimedAt: null });
  });

  it('a SINGLE-page session can still be confirmed the original way (capture review), and then reads as confirmed', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    const res = await capturePost(`/jobs/${j1._id}/confirm`);
    expect(res.status).toBe(200);
    const d = (await get(`/${s.id}`)).body.data;
    expect(d).toMatchObject({ status: 'confirmed', confirmed: true });
    expect(d.observationSetId).toBe(res.body.observationSetId);
    // ...and it is locked for page changes
    expect((await addPage(s.id, await page2())).body.code).toBe('SESSION_CONFIRMED');
    expect((await post(`/${s.id}/confirm`)).body.alreadyConfirmed).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('a second page cannot be attached once the first was claimed by the capture confirm', async () => {
    const j1 = await page1();
    const s = await newSession();
    await addPage(s.id, j1);
    CaptureJob.__mutate(j1._id, (r) => { r.confirmClaimedAt = new Date(); });
    expect((await addPage(s.id, await page2())).body.code).toBe('SESSION_CONFIRMED');
  });

  describe('a continuation page is judged the way its SESSION judges it', () => {
    const stationIssue = (job) => (job.notebook.setups[0].station.point.validation.issues || []).some((i) => i.code === 'STATION_REQUIRED');
    const getJob = (id) => H.authed(app, 'get', `/api/capture/jobs/${id}`).then((r) => r.body.data);

    it('standalone: its blank station is still an error (the capture confirm refuses it); in a session: it is the continuation of the previous page', async () => {
      const [j1, j2] = [await page1(), await page2()];
      const standalone = await getJob(j2._id);
      expect(stationIssue(standalone)).toBe(true);
      expect(standalone.validationSummary.canConfirm).toBe(false);
      const s = await newSession();
      await addPage(s.id, j1);
      await addPage(s.id, j2);
      const inSession = await getJob(j2._id);
      expect(stationIssue(inSession)).toBe(false);
      expect(inSession.validationSummary.canConfirm).toBe(true);
      expect(inSession.notebook.setups[0].observations).toHaveLength(2);
      // display only: nothing was written
      expect(stationIssue(CaptureJob.__all().find((j) => j._id === String(j2._id)))).toBe(true);
    });

    it('a standalone continuation page cannot be confirmed through the capture flow (blank station)', async () => {
      const j2 = await page2();
      const res = await capturePost(`/jobs/${j2._id}/confirm`);
      expect(res.status).toBe(422);
      expect(FieldObservationSet.__all()).toHaveLength(0);
    });

    it('an edit made inside the session is evaluated continuation-aware (and persisted that way)', async () => {
      const [j1, j2] = [await page1(), await page2()];
      const s = await newSession();
      await addPage(s.id, j1);
      await addPage(s.id, j2);
      const edit = await capturePatch(`/jobs/${j2._id}/cells`, { edits: [{ setup: 0, section: 'observation', row: 0, field: 'target', value: '299' }], baseRevision: 0 });
      expect(edit.status).toBe(200);
      expect(stationIssue(edit.body.data)).toBe(false);
      expect(edit.body.data.validationSummary.canConfirm).toBe(true);
      expect((await get(`/${s.id}`)).body.data.logical.setups[0].observations.map((o) => o.target)).toContain('299');
    });

    it('typing a station into the continuation page makes it an ordinary setup again (no longer a continuation)', async () => {
      const [j1, j2] = [await page1(), await page2()];
      const s = await newSession();
      await addPage(s.id, j1);
      await addPage(s.id, j2);
      await capturePatch(`/jobs/${j2._id}/cells`, { edits: [{ setup: 0, section: 'station', field: 'point', value: '103' }], baseRevision: 0 });
      const d = (await get(`/${s.id}`)).body.data;
      expect(d.logical.setups.map((st) => st.station.point)).toEqual(['101', '103']);
      expect(d.pages[1].continuesStation).toBeNull();
    });
  });

  it('a page whose capture is claimed mid-confirm cannot be edited', async () => {
    const j1 = await page1();
    CaptureJob.__mutate(j1._id, (r) => { r.confirmClaimedAt = new Date(); });
    const edit = await capturePatch(`/jobs/${j1._id}/cells`, { edits: [{ setup: 0, section: 'station', field: 'point', value: 'X' }] });
    expect(edit.status).toBe(409);
  });
});

describe('SCENARIO D: production-style legacy single-capture sessions keep working', () => {
  // exactly what the live schema stored: source.captureJobId only, NO `sources`
  const legacySession = async (job, over = {}) => F.FieldSession.create({
    user: H.OWNER, projectId: H.PROJECT, status: 'draft', source: { kind: 'capture', captureJobId: String(job._id) }, ...over,
  });

  it('opens: one page, derived status and counts, the first-page `capture` info older clients read', async () => {
    const job = await makeJob([P.station('101', [P.obs('201'), P.obs('202', '20.0000g')])]);
    const legacy = await legacySession(job);
    expect(storedSession(legacy._id).sources).toBeUndefined();
    const d = (await get(`/${legacy._id}`)).body.data;
    expect(d).toMatchObject({ source: 'capture', status: 'review', pageCount: 1, setupCount: 1, observationCount: 2, sourceLabel: 'От снимка на полеви карнет' });
    expect(d.pages).toHaveLength(1);
    expect(d.capture).toMatchObject({ attached: true, available: true, mine: true, jobId: String(job._id) });
    expect(d.evaluation.summary.canConfirm).toBe(true);
    expect((await get(`/?projectId=${H.PROJECT}`)).body.attachedCaptureJobIds).toEqual([String(job._id)]);
  });

  it('a legacy draft confirms through the session (one set, page frozen) - the record is upgraded on write', async () => {
    const job = await makeJob([P.station('101', [P.obs('201'), P.obs('202', '20.0000g')])]);
    const legacy = await legacySession(job);
    const res = await post(`/${legacy._id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'confirmed', setupCount: 1, observationCount: 2 });
    expect(FieldObservationSet.__all()).toHaveLength(1);
    expect(storedSession(legacy._id).sources).toHaveLength(1);
    expect(storedSession(legacy._id).source.captureJobId).toBe(String(job._id));
  });

  it('a legacy session whose capture was confirmed the original way stays confirmed, with its capture-origin evidence and processing options', async () => {
    const job = await makeJob([P.station('101', [P.obs('201')])]);
    const fos = await FieldObservationSet.create({ user: H.OWNER, projectId: H.PROJECT, source: { kind: 'capture', captureJobId: String(job._id) }, setups: [{ index: 0, station: { point: '101', instrumentHeight: null, notes: '' }, orientation: { target: '102', direction: null }, observations: [{ row: 0, target: '201', hz: { value: 10, unit: 'gon' }, distance: { value: 25, unit: 'm' } }] }] });
    CaptureJob.__mutate(job._id, (r) => { r.status = 'confirmed'; r.importedFieldObservationSetId = fos._id; });
    const legacy = await legacySession(job);
    const d = (await get(`/${legacy._id}`)).body.data;
    expect(d).toMatchObject({ status: 'confirmed', confirmed: true, observationSetId: String(fos._id), setupCount: 1, observationCount: 1 });
    expect(d.processingOptions.polar.available).toBe(true);
    expect((await post(`/${legacy._id}/confirm`)).body.alreadyConfirmed).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('a second page can be added to a legacy draft (it is upgraded to the multi-page structure, page 1 first)', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const legacy = await legacySession(j1);
    const d = (await addPage(legacy._id, j2)).body.data;
    expect(pageIds(d)).toEqual([String(j1._id), String(j2._id)]);
    expect(storedSession(legacy._id).sources.map((p) => p.order)).toEqual([0, 1]);
  });

  it('a legacy capture-backed record is still found as the owner of its capture by the capture route guard', async () => {
    const [j1, j2] = [await page1(), await page2()];
    const legacy = await legacySession(j1);
    await addPage(legacy._id, j2);
    expect((await capturePost(`/jobs/${j1._id}/confirm`)).body.code).toBe('BELONGS_TO_SESSION');
  });
});

describe('legacy list contract and revision of a merged session', () => {
  it('the project list reports every page id (so the "captures outside a session" list stays right)', async () => {
    const [j1, j2, j3] = [await page1(), await page2(), await page3()];
    const s = await newSession();
    await addPage(s.id, j1);
    await addPage(s.id, j2);
    const ids = (await get(`/?projectId=${H.PROJECT}`)).body.attachedCaptureJobIds;
    expect(ids.sort()).toEqual([String(j1._id), String(j2._id)].sort());
    expect(ids).not.toContain(String(j3._id));
  });

  it('a revision of a confirmed multi-page session is a NEW manual draft carrying the merged evidence (never an edit of it)', async () => {
    const jobs = [await page1(), await page2(), await page3()];
    const s = await newSession();
    for (const j of jobs) await addPage(s.id, j);
    await post(`/${s.id}/confirm`);
    const rev = await post(`/${s.id}/revise`);
    expect(rev.status).toBe(201);
    expect(rev.body.data).toMatchObject({ source: 'manual', status: 'draft', setupCount: 2, observationCount: 6, revisionOf: s.id });
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });
});
