process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
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

/**
 * FIELD PROCESSING V2.4.2 - TRAVERSE AUTOMATED END-TO-END ACCEPTANCE (section 25)
 *
 * Project SurveyPoints: 100 (external orientation, due south of 101), 101 (known start station), 103 (known
 * endpoint control, DELIBERATELY offset from the raw traverse result by a small misclosure) -> a REAL two-setup
 * Field Notebook capture (101 backsight-to-100, foresight-to-102; 102 backsight-to-101, foresight-to-103) ->
 * upload -> confirm -> KNOWN_ENDPOINT traverse processing -> exact independently-derived raw/closure/Bowditch
 * values -> explicit "Създай точки" saving the ADJUSTED coordinates -> full provenance chain. A second `it` reuses
 * the SAME confirmed FieldObservationSet for an OPEN traverse (no closure/adjustment, RAW values saved).
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
  setups: [
    {
      station: '101', hi: '1.500', orientationTarget: '100', // no orientationDirection: zeroed on the backsight
      observations: [{ target: '102', hz: '200.0000g', vz: '100.0000g', distance: '100.000', prism: '2.000' }],
    },
    {
      station: '102', hi: '1.500', orientationTarget: '101', // zeroed on the backsight again
      observations: [{ target: '103', hz: '300.0000g', vz: '100.0000g', distance: '50.000' }], // no prism -> XY_ONLY
    },
  ],
};

// Independently-derived ground truth (by hand, NOT by running the implementation):
//   orientationConstant0 = bearing(101->100) = 200g (100 is due south of 101, zeroed backsight)
//   leg1: forwardBearing = normalize(200+200) = 0g (north); horizontal (vz=100g exactly) -> 100m
//         raw102 = (1000+100, 2000+0) = (1100, 2000); H102 = 500+1.5+0-2.0 = 499.5 -> READY
//   leg2: alphaBack = normalize(0+200) = 200g, orientationConstant = 200 (zeroed); forwardBearing = normalize(200+300) = 100g (east)
//         raw endpoint (103) = (1100+0, 2000+50) = (1100, 2050); no prism -> XY_ONLY, H unavailable
//   known endpoint control (103) = (1100.06, 2050.03) - a deliberate small misclosure
//   fX = rawEndX - knownEndX = 1100 - 1100.06 = -0.06; fY = 2050 - 2050.03 = -0.03
//   linearMisclosure = sqrt(0.06^2 + 0.03^2) = 0.067082...; totalLength = 150
//   Bowditch (weighted by leg length, 100 and 50 of 150): leg1 gets 2/3 of the correction, leg2 gets 1/3
//     cX1 = 0.06*(2/3) = 0.04, cY1 = 0.03*(2/3) = 0.02 ; cX2 = 0.06*(1/3) = 0.02, cY2 = 0.03*(1/3) = 0.01
//   adjusted102 = (1100.04, 2000.02); adjusted endpoint = (1100.06, 2050.03) = EXACTLY the known control
const TRUTH = {
  orientationConstant0: 200,
  raw: { 102: { x: 1100, y: 2000, h: 499.5, status: 'READY' }, 103: { x: 1100, y: 2050, h: null, status: 'XY_ONLY' } },
  closure: { fX: -0.06, fY: -0.03, totalLength: 150 },
  adjusted: { 102: { x: 1100.04, y: 2000.02 }, 103: { x: 1100.06, y: 2050.03 } },
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
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '100', x: 900, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '103', x: 1100.06, y: 2050.03, h: 500 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const post = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const get = (path) => H.authed(app, 'get', `/api/field-processing${path}`);

async function confirmedFieldObservationSet() {
  const uploadRes = await H.upload(app, capture.image, { mode: 'field-notebook' });
  expect(uploadRes.status).toBe(201);
  const jobId = uploadRes.body.data.id;
  const confirmRes = await H.authed(app, 'post', `/api/capture/jobs/${jobId}/confirm`);
  expect(confirmRes.status).toBe(200);
  return { jobId, fosId: confirmRes.body.observationSetId };
}

it('KNOWN_ENDPOINT: raw + closure + Bowditch match independently-derived truth, save uses ADJUSTED coordinates', async () => {
  const { jobId, fosId } = await confirmedFieldObservationSet();
  expect(SurveyPoint.__all()).toHaveLength(3); // only 100/101/103 exist - nothing auto-created
  const fosSnapshotBefore = FieldObservationSet.__all().find((f) => f._id === fosId);

  const runRes = await post('/traverse', { fieldObservationSetId: fosId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' });
  expect(runRes.status).toBe(201);
  const run = runRes.body.data;
  expect(run.processingType).toBe('traverse');
  expect(run.resultAuthority).toBe('server');
  expect(run.source).toMatchObject({ fieldObservationSetId: fosId, captureJobId: jobId });

  const t = run.traverse;
  expect(t.traverseType).toBe('KNOWN_ENDPOINT');
  expect(t.sequence.state).toBe('RESOLVED');
  // station/orientation/end SNAPSHOTS are persisted (immutability/reproducibility, section 15/10)
  expect(t.start.point).toMatchObject({ name: '101', x: 1000, y: 2000, h: 500 });
  expect(t.orientation.point).toMatchObject({ name: '100', x: 900, y: 2000 });
  expect(t.end.point).toMatchObject({ name: '103', x: 1100.06, y: 2050.03 });

  expect(t.legs).toHaveLength(2);
  const [leg1, leg2] = t.legs;
  expect(leg1).toMatchObject({ to: '102', status: TRUTH.raw[102].status, rawX: TRUTH.raw[102].x, rawY: TRUTH.raw[102].y });
  expect(leg1.rawH).toBeCloseTo(TRUTH.raw[102].h, 6);
  expect(leg2).toMatchObject({ to: '103', status: TRUTH.raw[103].status, rawX: TRUTH.raw[103].x, rawY: TRUTH.raw[103].y });
  expect(leg2.rawH).toBeNull();

  // closure, exact within tight numeric tolerance
  expect(t.closure.available).toBe(true);
  expect(t.closure.fX).toBeCloseTo(TRUTH.closure.fX, 6);
  expect(t.closure.fY).toBeCloseTo(TRUTH.closure.fY, 6);
  expect(t.closure.totalLength).toBeCloseTo(TRUTH.closure.totalLength, 6);
  expect(t.closure.perfectClosure).toBe(false);

  // Bowditch corrections and adjusted endpoint = known control, exactly
  expect(t.adjustment.applied).toBe(true);
  expect(leg1.adjustedX).toBeCloseTo(TRUTH.adjusted[102].x, 6);
  expect(leg1.adjustedY).toBeCloseTo(TRUTH.adjusted[102].y, 6);
  expect(leg2.adjustedX).toBeCloseTo(TRUTH.adjusted[103].x, 6);
  expect(leg2.adjustedY).toBeCloseTo(TRUTH.adjusted[103].y, 6);
  expect(leg2.adjustedX).toBeCloseTo(1100.06, 9); // the adjusted endpoint equals the control to floating-point tolerance
  expect(leg2.adjustedY).toBeCloseTo(2050.03, 9);

  // NO points before the explicit save
  expect(SurveyPoint.__all()).toHaveLength(3);

  // explicit "Създай точки": '102' is new (saved at ADJUSTED coords); '103' already exists -> NAME_CONFLICT, skipped
  const saveRes = await post(`/${run.id}/create-points`, {});
  expect(saveRes.status).toBe(200);
  expect(saveRes.body.created.map((p) => p.name)).toEqual(['102']);
  expect(saveRes.body.skipped).toEqual([{ setup: 1, observation: 0, target: '103', reason: 'NAME_CONFLICT', existingPointId: expect.any(String) }]);

  const p102 = SurveyPoint.__all().find((p) => p.name === '102');
  expect(p102.x).toBeCloseTo(TRUTH.adjusted[102].x, 6);
  expect(p102.y).toBeCloseTo(TRUTH.adjusted[102].y, 6);
  expect(p102.x).not.toBeCloseTo(TRUTH.raw[102].x + 0.001, 2); // sanity: not the raw value

  // full provenance chain: CaptureJob -> FieldObservationSet -> FieldProcessingRun -> SurveyPoint
  expect(p102.source).toMatchObject({ kind: 'field-processing', processingType: 'traverse', processingRunId: run.id, fieldObservationSetId: fosId, setup: 0, observation: 0 });
  const storedRun = FieldProcessingRun.__all().find((r) => r._id === run.id);
  expect(String(storedRun.source.captureJobId)).toBe(jobId);
  expect(storedRun.generatedPointIds.map(String)).toEqual([p102._id]);

  // second "Създай точки" creates no duplicates
  const again = await post(`/${run.id}/create-points`, {});
  expect(again.body.created).toHaveLength(0);
  expect(SurveyPoint.__all().filter((p) => p.name === '102')).toHaveLength(1);

  // GET reads back the same immutable run
  const reread = await get(`/${run.id}`);
  expect(reread.body.data.traverse).toEqual(run.traverse);

  // the FieldObservationSet itself was never mutated by any of this
  const fosSnapshotAfter = FieldObservationSet.__all().find((f) => f._id === fosId);
  expect(fosSnapshotAfter).toEqual(fosSnapshotBefore);
});

it('OPEN (same confirmed FieldObservationSet): raw only, no closure/Bowditch, save uses RAW coordinates', async () => {
  const { fosId } = await confirmedFieldObservationSet();

  const runRes = await post('/traverse', { fieldObservationSetId: fosId, traverseType: 'OPEN', startIdentifier: '101', verticalAngleConvention: 'zenith' });
  const t = runRes.body.data.traverse;
  expect(t.traverseType).toBe('OPEN');
  // 103 has no own setup, so an OPEN chain (occupied-to-occupied only) stops after the one leg it CAN identify
  expect(t.legs).toHaveLength(1);
  expect(t.legs[0]).toMatchObject({ to: '102', rawX: TRUTH.raw[102].x, rawY: TRUTH.raw[102].y });
  expect(t.closure.available).toBe(false);
  expect(t.closure.reason).toBe('OPEN_TRAVERSE');
  expect(t.closure.fX).toBeNull();
  expect(t.adjustment.applied).toBe(false);
  expect(t.legs[0].adjustedX).toBeNull();

  const saveRes = await post(`/${runRes.body.data.id}/create-points`, {});
  expect(saveRes.body.created).toHaveLength(1);
  expect(saveRes.body.created[0]).toMatchObject({ name: '102', x: TRUTH.raw[102].x, y: TRUTH.raw[102].y }); // RAW, not adjusted
});
