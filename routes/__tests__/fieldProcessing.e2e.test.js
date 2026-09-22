process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
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

/**
 * FIELD PROCESSING V2.4.1 - AUTOMATED END-TO-END ACCEPTANCE (section 20)
 *
 * Project SurveyPoints 101 (station) and 102 (backsight, due east) -> a REAL Field Notebook capture (image ->
 * upload -> OCR fixture -> reconstruction -> confirm) with observations to targets 201 (slope distance + a zenith
 * angle -> full READY: X, Y and H) and 202 (a zenith angle but no prism height -> XY_ONLY) -> field-processing ->
 * exact independently-derived ground truth -> explicit "Създай точки" -> the full provenance chain.
 */
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const CaptureJob = require('../../models/CaptureJob');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const { layoutNotebook, renderTableImage } = require('../../tests/support/notebookFixtures');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(90000);

const SPEC = {
  setups: [{
    station: '101', hi: '1.500', orientationTarget: '102', // no orientationDirection: the "zeroed on backsight" convention
    observations: [
      { target: '201', hz: '0.0000g', vz: '100.0000g', distance: '50.000', prism: '2.000' }, // horizontal shot, full height inputs
      { target: '202', hz: '300.0000g', vz: '100.0000g', distance: '30.000' }, // no prism height -> XY only
    ],
  }],
};

// Independently-derived ground truth (by hand, NOT by running the implementation):
//   orientation constant = bearing(101->102) = 100 gon (102 is due east of 101)
//   201: direction = normalizeGon(100 + 0) = 100 gon (east); horizontal shot -> horizontalDistance = 50
//        x = 1000 + 50*cos(100g) = 1000, y = 2000 + 50*sin(100g) = 2050; h = 500 + 1.5 + 0 - 2.0 = 499.5
//   202: direction = normalizeGon(100 + 300) = 0 gon (north); horizontal shot -> horizontalDistance = 30
//        x = 1000 + 30*cos(0) = 1030, y = 2000 + 30*sin(0) = 2000; h unavailable (no prism height)
const TRUTH = {
  orientationConstantGon: 100,
  targets: {
    201: { x: 1000, y: 2050, h: 499.5, status: 'READY' },
    202: { x: 1030, y: 2000, h: null, status: 'XY_ONLY' },
  },
};

let capture;
beforeAll(async () => {
  const layout = layoutNotebook(SPEC);
  const image = await renderTableImage(layout);
  capture = { layout, image };
});
beforeEach(() => {
  CaptureJob.__reset();
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  setStorage(createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '102', x: 1000, y: 2100, h: 500 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const post = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const get = (path) => H.authed(app, 'get', `/api/field-processing${path}`);

it('101/102 SurveyPoints + a confirmed Field Notebook -> processing -> exact ground truth -> explicit save -> full provenance', async () => {
  // 1. upload and confirm a real Field Notebook capture (the only two project points that exist are 101 and 102)
  const uploadRes = await H.upload(app, capture.image, { mode: 'field-notebook' });
  expect(uploadRes.status).toBe(201);
  const jobId = uploadRes.body.data.id;
  const confirmRes = await H.authed(app, 'post', `/api/capture/jobs/${jobId}/confirm`);
  expect(confirmRes.status).toBe(200);
  const fosId = confirmRes.body.observationSetId;
  expect(fosId).toBeTruthy();
  expect(SurveyPoint.__all()).toHaveLength(2); // still only 101 and 102 - nothing auto-created

  // 2. run processing
  const runRes = await post('/', { fieldObservationSetId: fosId, verticalAngleConvention: 'zenith' });
  expect(runRes.status).toBe(201);
  const run = runRes.body.data;
  expect(run.resultAuthority).toBe('server');
  expect(run.source).toMatchObject({ fieldObservationSetId: fosId, captureJobId: jobId });

  const setup = run.setups[0];
  expect(setup.setupError).toBeNull();
  // station/orientation SNAPSHOTS are persisted on the run (immutability/reproducibility, section 10)
  expect(setup.station.point).toMatchObject({ name: '101', x: 1000, y: 2000, h: 500 });
  expect(setup.orientation.point).toMatchObject({ name: '102', x: 1000, y: 2100 });
  expect(setup.orientationConstantGon).toBeCloseTo(TRUTH.orientationConstantGon, 6);

  const byTarget = Object.fromEntries(setup.observations.map((o) => [o.target, o]));
  for (const [target, truth] of Object.entries(TRUTH.targets)) {
    expect(byTarget[target].status).toBe(truth.status);
    expect(byTarget[target].x).toBeCloseTo(truth.x, 3);
    expect(byTarget[target].y).toBeCloseTo(truth.y, 3);
    if (truth.h === null) expect(byTarget[target].h).toBeNull();
    else expect(byTarget[target].h).toBeCloseTo(truth.h, 3);
  }

  // 3. NO points before the explicit save
  expect(SurveyPoint.__all()).toHaveLength(2);

  // 4. explicit "Създай точки"
  const saveRes = await post(`/${run.id}/create-points`, {});
  expect(saveRes.status).toBe(200);
  expect(saveRes.body.created).toHaveLength(2); // both 201 (READY) and 202 (XY_ONLY) are auto-selected
  expect(saveRes.body.skipped).toEqual([]);

  const points = SurveyPoint.__all().filter((p) => p.name === '201' || p.name === '202');
  expect(points).toHaveLength(2);
  const p201 = points.find((p) => p.name === '201');
  const p202 = points.find((p) => p.name === '202');
  expect(p201).toMatchObject({ x: TRUTH.targets['201'].x, y: TRUTH.targets['201'].y, h: TRUTH.targets['201'].h });
  expect(p202).toMatchObject({ x: TRUTH.targets['202'].x, y: TRUTH.targets['202'].y, h: null });

  // 5. the FULL provenance chain: CaptureJob -> FieldObservationSet -> FieldProcessingRun -> SurveyPoint
  expect(p201.source).toMatchObject({ kind: 'field-processing', processingRunId: run.id, fieldObservationSetId: fosId, setup: 0 });
  const fos = FieldObservationSet.__all().find((f) => f._id === fosId);
  expect(String(fos.source.captureJobId)).toBe(jobId);
  const storedRun = FieldProcessingRun.__all().find((r) => r._id === run.id);
  expect(String(storedRun.source.fieldObservationSetId)).toBe(fosId);
  expect(String(storedRun.source.captureJobId)).toBe(jobId);
  expect(storedRun.generatedPointIds.map(String).sort()).toEqual([p201._id, p202._id].sort());
  // the generated points' coordinates match the persisted authoritative processing result EXACTLY
  const runObs = byTarget['201'];
  expect(p201.x).toBe(runObs.x);
  expect(p201.y).toBe(runObs.y);
  expect(p201.h).toBe(runObs.h);

  // 6. a second "Създай точки" creates no duplicates
  const again = await post(`/${run.id}/create-points`, {});
  expect(again.body.created).toHaveLength(0);
  expect(again.body.skipped.map((s) => s.reason)).toEqual(['ALREADY_CREATED', 'ALREADY_CREATED']);
  expect(SurveyPoint.__all().filter((p) => p.name === '201' || p.name === '202')).toHaveLength(2);

  // 7. GET reads back the same immutable run
  const reread = await get(`/${run.id}`);
  expect(reread.body.data.setups).toEqual(run.setups);
});
