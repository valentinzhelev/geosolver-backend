process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/ReportAsset', () => require('../../tests/support/fakeCaptureModels').ReportAsset);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

/**
 * MULTI-PAGE FIELD NOTEBOOKS - AUTOMATED END-TO-END ACCEPTANCE (scenarios A and D, plus a traverse across pages)
 *
 * Pages are real reconstructed notebooks; everything downstream - the merge, the confirm, the polar/traverse engines, points,
 * the report, the provenance - is the REAL code. Processing receives the same FieldObservationSet shape as always: there is no
 * multi-page branch anywhere after the confirm.
 */
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const F = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');
const P = require('../../tests/support/pageFixtures');
const { tracePointProvenance } = require('../../gai/tools/provenance');

const { CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession } = F;

jest.setTimeout(60000);

beforeEach(() => {
  for (const m of [CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession]) m.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const sessions = (method, path, body) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`);
  return body === undefined ? r : r.send(body);
};
const fp = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const reports = (path, body) => H.authed(app, 'post', `/api/reports${path}`).send(body);
const seedPoint = (name, x, y, h = 500) => SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name, x, y, h });
const makeJob = (setups, opts = {}) => CaptureJob.create(P.pageJobFields(setups, { user: H.OWNER, project: H.PROJECT, ...opts }));
const addPages = async (sessionId, jobs) => { for (const j of jobs) await sessions('post', `/${sessionId}/pages`, { captureJobId: String(j._id) }); };
const shot = (target, hz, distance, extra = {}) => P.obs(target, `${hz}.0000g`, { distance: `${distance}.000`, ...extra });

describe('SCENARIO A: a three-page notebook -> ONE session -> processing -> points -> report, provenance back to the page', () => {
  // 101 (1000,2000,500) and 102 (1000,2100,500): 102 is due EAST of 101 (bearing 100 gon). Heights all horizontal (V = 100 gon,
  // i = p = 1.5) so H stays 500. Page 1 = station 101 (201, 202); page 2 = the SAME station's table continued (203, 204), no
  // station line; page 3 = station 102 looking back at 101 (205, 206).
  //   201: hz 0   -> 100 gon (east),  50 m -> (1000, 2050)     202: hz 100 -> 200 gon (south), 30 m -> ( 970, 2000)
  //   203: hz 300 ->   0 gon (north), 20 m -> (1020, 2000)     204: hz 200 -> 300 gon (west),  10 m -> (1000, 1990)
  //   102 -> 101 is bearing 300 gon:  205: hz 0 -> 300 (west), 40 m -> (1000, 2060)    206: hz 100 -> 0 (north), 30 m -> (1030, 2100)
  const pages = async () => [
    await makeJob([P.station('101', [shot('201', 0, 50), shot('202', 100, 30)])]),
    await makeJob([P.continuation([shot('203', 300, 20), shot('204', 200, 10)])]),
    await makeJob([P.station('102', [shot('205', 0, 40), shot('206', 100, 30)], { orientationTarget: '101' })]),
  ];
  const TRUTH = { 201: [1000, 2050], 202: [970, 2000], 203: [1020, 2000], 204: [1000, 1990], 205: [1000, 2060], 206: [1030, 2100] };

  it('the whole chain, with every link verified from both ends', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);
    const jobs = await pages();
    const created = (await sessions('post', '/', { projectId: H.PROJECT, date: '2026-10-18', operator: 'В. Желев' })).body.data;
    await addPages(created.id, jobs);

    // --- one session, review is session-wide and clean ------------------------------------------------------------------
    const review = (await sessions('get', `/${created.id}`)).body.data;
    expect(review).toMatchObject({ source: 'capture', status: 'review', pageCount: 3, setupCount: 2, observationCount: 6, issues: { errors: 0, warnings: 0 } });
    expect(review.evaluation.summary.canConfirm).toBe(true);
    expect(review.pages.map((p) => p.continuesStation)).toEqual([null, '101', null]);

    // --- confirm: exactly one authoritative set -----------------------------------------------------------------------
    const confirmed = await sessions('post', `/${created.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ status: 'confirmed', setupCount: 2, observationCount: 6 });
    expect(FieldObservationSet.__all()).toHaveLength(1);
    const setId = confirmed.body.data.observationSetId;
    const fos = FieldObservationSet.__all()[0];
    expect(fos.setups.map((s) => [s.station.point, s.observations.map((o) => o.target)])).toEqual([['101', ['201', '202', '203', '204']], ['102', ['205', '206']]]);

    // --- processing receives the ordinary evidence shape; no special multi-page branch ---------------------------------
    const opts = confirmed.body.data.processingOptions;
    expect(opts.polar).toMatchObject({ available: true, setupCount: 2, observationCount: 6 });
    const runRes = await fp('', { fieldObservationSetId: setId, verticalAngleConvention: 'zenith' });
    expect(runRes.status).toBe(201);
    const run = runRes.body.data;
    expect(run.source).toEqual({ fieldObservationSetId: setId, captureJobId: null, fieldSessionId: created.id });
    const byTarget = Object.fromEntries(run.setups.flatMap((s) => s.observations).map((o) => [o.target, o]));
    for (const [t, [x, y]] of Object.entries(TRUTH)) {
      expect(byTarget[t].status).toBe('READY');
      expect(byTarget[t].x).toBeCloseTo(x, 3);
      expect(byTarget[t].y).toBeCloseTo(y, 3);
      expect(byTarget[t].h).toBeCloseTo(500, 3);
    }

    // --- points, no duplicates -----------------------------------------------------------------------------------
    const pointsRes = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pointsRes.status).toBe(200);
    expect(pointsRes.body.created).toHaveLength(6);
    const p203 = SurveyPoint.__all().find((p) => p.name === '203');
    expect(p203).toMatchObject({ x: 1020, y: 2000 });
    expect(p203.source).toMatchObject({ kind: 'field-processing', processingRunId: run.id, fieldObservationSetId: setId, setup: 0 });
    expect((await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`)).body.created).toHaveLength(0);

    // --- report ---------------------------------------------------------------------------------------------------
    const rep = await reports('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id });
    expect([200, 201]).toContain(rep.status);

    // --- the session now reads as processed, with counts from the real records ---------------------------------------
    const done = (await sessions('get', `/${created.id}`)).body.data;
    expect(done).toMatchObject({ status: 'processed', processing: { runCount: 1, pointCount: 6, reportCount: 1 } });

    // --- provenance: back to the right PAGE, through the session -----------------------------------------------------
    const prov203 = await tracePointProvenance(H.PROJECT, String(p203._id));
    expect(prov203.chain.map((c) => c.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession']);
    expect(prov203.chain.find((c) => c.kind === 'fieldSession')).toMatchObject({ id: created.id, pageCount: 3, page: 2 });
    expect(prov203.fieldMeasurement).toMatchObject({ target: '203', station: '101', page: 2 });
    const p205 = SurveyPoint.__all().find((p) => p.name === '205');
    const prov205 = await tracePointProvenance(H.PROJECT, String(p205._id));
    expect(prov205.fieldMeasurement).toMatchObject({ target: '205', station: '102', page: 3 });
    const p201 = SurveyPoint.__all().find((p) => p.name === '201');
    expect((await tracePointProvenance(H.PROJECT, String(p201._id))).fieldMeasurement.page).toBe(1);
    // the stored evidence keeps the exact origin (internal: page index, page job, page-local setup and row)
    const o203 = fos.setups[0].observations.find((o) => o.target === '203');
    expect(o203.source).toEqual({ page: 1, captureJobId: String(jobs[1]._id), setup: 0, row: 0 });
    // and no internal id reached the product text of the chain
    expect(JSON.stringify(prov203.chain.map((c) => c.label))).not.toMatch(/[0-9a-f]{24}/);
  });

  it('no duplicated authoritative values: the session stores no coordinates and no copy of the observations', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);
    const created = (await sessions('post', '/', { projectId: H.PROJECT })).body.data;
    await addPages(created.id, await pages());
    await sessions('post', `/${created.id}/confirm`);
    const row = FieldSession.__all()[0];
    expect(row.setups).toEqual([]); // typed entries are for manual sessions only
    expect(row.fieldObservationSetId).toBe(FieldObservationSet.__all()[0]._id);
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['x', 'y']));
  });
});

describe('a traverse across pages: each station on its own page, ordered setups, raw vs adjusted, provenance', () => {
  it('page 1 = station 101, page 2 = station 102 -> traverse -> points -> the point says which page its observation came from', async () => {
    seedPoint('100', 900, 2000);
    seedPoint('101', 1000, 2000);
    seedPoint('103', 1100.06, 2050.03);
    const j1 = await makeJob([P.station('101', [P.obs('102', '200.0000g', { distance: '100.000', prism: '2.000' })], { orientationTarget: '100' })]);
    const j2 = await makeJob([P.station('102', [P.obs('103', '300.0000g', { distance: '50.000', prism: '' })], { orientationTarget: '101' })]);
    const s = (await sessions('post', '/', { projectId: H.PROJECT, title: 'Полигонов ход по страници' })).body.data;
    await addPages(s.id, [j1, j2]);
    const confirmed = (await sessions('post', `/${s.id}/confirm`)).body.data;
    expect(confirmed.evidence.setups.map((st) => [st.index, st.station.point, st.observations.map((o) => o.page)])).toEqual([[0, '101', [1]], [1, '102', [2]]]);
    expect(confirmed.processingOptions.traverse).toMatchObject({ available: true, suggestedStart: '101', chain: ['101', '102'], endCandidates: ['103'] });

    const runRes = await fp('/traverse', { fieldObservationSetId: confirmed.observationSetId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' });
    expect(runRes.status).toBe(201);
    const t = runRes.body.data.traverse;
    expect(t.status).toBe('READY');
    expect(t.closure.linearMisclosure).toBeCloseTo(0.0671, 3);
    expect(t.legs.map((l) => [l.from, l.to, l.fromSetupIndex])).toEqual([['101', '102', 0], ['102', '103', 1]]);

    const pts = await H.authed(app, 'post', `/api/field-processing/${runRes.body.data.id}/create-points`);
    expect(pts.body.created.map((c) => c.name)).toEqual(['102']);
    const p102 = SurveyPoint.__all().find((p) => p.name === '102');
    const prov = await tracePointProvenance(H.PROJECT, String(p102._id));
    expect(prov.chain.map((c) => c.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession']);
    expect(prov.fieldMeasurement).toMatchObject({ station: '101', target: '102', page: 1 });
  });
});

describe('SCENARIO D: a production-style legacy single-page session through the whole chain', () => {
  it('opens, confirms through the session, processes, reports - and its provenance names the session', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);
    const job = await makeJob([P.station('101', [shot('201', 0, 50), shot('202', 100, 30)])]);
    // the record exactly as the LIVE schema stored it: source.captureJobId only, no `sources`
    const legacy = await F.FieldSession.create({ user: H.OWNER, projectId: H.PROJECT, status: 'draft', source: { kind: 'capture', captureJobId: String(job._id) } });
    expect(FieldSession.__all()[0].sources).toBeUndefined();

    const opened = (await sessions('get', `/${legacy._id}`)).body.data;
    expect(opened).toMatchObject({ status: 'review', pageCount: 1, setupCount: 1, observationCount: 2 });
    const confirmed = await sessions('post', `/${legacy._id}/confirm`);
    expect(confirmed.status).toBe(200);
    const run = (await fp('', { fieldObservationSetId: confirmed.body.data.observationSetId, verticalAngleConvention: 'zenith' })).body.data;
    expect(run.source.fieldSessionId).toBe(String(legacy._id));
    const pts = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pts.body.created).toHaveLength(2);
    expect([200, 201]).toContain((await reports('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id })).status);
    expect((await sessions('get', `/${legacy._id}`)).body.data).toMatchObject({ status: 'processed', processing: { pointCount: 2, reportCount: 1 } });
    // a single-page session says nothing about "pages" in its provenance
    const p201 = SurveyPoint.__all().find((p) => p.name === '201');
    const prov = await tracePointProvenance(H.PROJECT, String(p201._id));
    expect(prov.chain.find((c) => c.kind === 'fieldSession')).toMatchObject({ id: String(legacy._id) });
    expect(prov.chain.find((c) => c.kind === 'fieldSession').pageCount).toBeUndefined();
  });

  it('provenance of a point processed from the ORIGINAL capture-confirm flow (capture-origin evidence in a legacy session) is unchanged', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);
    const job = await makeJob([P.station('101', [shot('201', 0, 50)])]);
    const legacy = await F.FieldSession.create({ user: H.OWNER, projectId: H.PROJECT, status: 'draft', source: { kind: 'capture', captureJobId: String(job._id) } });
    const viaCapture = await H.authed(app, 'post', `/api/capture/jobs/${job._id}/confirm`).send({});
    expect(viaCapture.status).toBe(200);
    const run = (await fp('', { fieldObservationSetId: viaCapture.body.observationSetId, verticalAngleConvention: 'zenith' })).body.data;
    expect(run.source).toMatchObject({ captureJobId: String(job._id), fieldSessionId: null });
    await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    const p = SurveyPoint.__all().find((x) => x.name === '201');
    const prov = await tracePointProvenance(H.PROJECT, String(p._id));
    expect(prov.chain.map((c) => c.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession', 'captureJob']);
    expect(prov.chain.find((c) => c.kind === 'fieldSession').id).toBe(String(legacy._id));
  });
});
