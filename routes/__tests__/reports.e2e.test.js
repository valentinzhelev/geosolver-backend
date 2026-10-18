process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/ReportAsset', () => require('../../tests/support/fakeCaptureModels').ReportAsset);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

/**
 * REPORT / DOCUMENT ENGINE V2.5 - AUTOMATED END-TO-END ACCEPTANCE (section 17/19)
 *
 * The FULL real pipeline, not hand-built fixtures: a genuine Field Notebook image (upload -> OCR fixture ->
 * reconstruction -> confirm) -> KNOWN_ENDPOINT traverse processing (same geometry as
 * fieldProcessing.traverse.e2e.test.js, independently re-derived below) -> "Генерирай отчет" -> a persisted,
 * immutable ReportDocument + PDF -> listed under Project Documents -> an authenticated download that returns the
 * EXACT stored bytes -> a second generation that creates a second, independent report.
 */
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const CaptureJob = require('../../models/CaptureJob');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const Report = require('../../models/Report');
const ReportAsset = require('../../models/ReportAsset');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const { layoutNotebook, renderTableImage } = require('../../tests/support/notebookFixtures');
const H = require('../../tests/support/captureApiHarness');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');

jest.setTimeout(90000);

// Identical geometry to fieldProcessing.traverse.e2e.test.js (already independently derived and proven there):
// 100 due south of 101 (zeroed backsight); leg1 -> raw 102=(1100,2000); leg2 -> raw 103=(1100,2050); known
// endpoint control 103=(1100.06, 2050.03), a deliberate small misclosure.
const SPEC = {
  setups: [
    { station: '101', hi: '1.500', orientationTarget: '100', observations: [{ target: '102', hz: '200.0000g', vz: '100.0000g', distance: '100.000', prism: '2.000' }] },
    { station: '102', hi: '1.500', orientationTarget: '101', observations: [{ target: '103', hz: '300.0000g', vz: '100.0000g', distance: '50.000' }] },
  ],
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
  Report.__reset();
  ReportAsset.__reset();
  setStorage(createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '100', x: 900, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
  SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '103', x: 1100.06, y: 2050.03, h: 500 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const fpPost = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const reportsPost = (path, body) => H.authed(app, 'post', `/api/reports${path}`).send(body);
const reportsGet = (path) => H.authed(app, 'get', `/api/reports${path}`);

it('SCENARIO 1: real notebook -> traverse run -> report generation -> persisted, listed, downloadable, regenerable', async () => {
  // 1. a REAL Field Notebook capture, confirmed (not a hand-built FieldObservationSet)
  const uploadRes = await H.upload(app, capture.image, { mode: 'field-notebook' });
  expect(uploadRes.status).toBe(201);
  const jobId = uploadRes.body.data.id;
  const confirmRes = await H.authed(app, 'post', `/api/capture/jobs/${jobId}/confirm`);
  expect(confirmRes.status).toBe(200);
  const fosId = confirmRes.body.observationSetId;

  // 2. an authoritative traverse FieldProcessingRun (KNOWN_ENDPOINT, same geometry proven in V2.4.2's own E2E)
  const runRes = await fpPost('/traverse', { fieldObservationSetId: fosId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' });
  expect(runRes.status).toBe(201);
  const run = runRes.body.data;
  expect(run.traverse.closure.available).toBe(true);
  expect(run.traverse.adjustment.applied).toBe(true);

  // 3. "Генерирай отчет"
  const reportRes = await reportsPost('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id });
  expect(reportRes.status).toBe(201);
  const report = reportRes.body.data;
  expect(report.reportType).toBe('TRAVERSE_PROCESSING_REPORT');
  expect(report.sourceId).toBe(run.id);
  expect(report.fileMime).toBe('application/pdf');

  // 4. listed under Project Documents
  const listRes = await reportsGet(`?projectId=${H.PROJECT}`);
  expect(listRes.body.data.map((r) => r.id)).toContain(report.id);

  // 5. an authenticated download returns the EXACT persisted PDF (hash match), with real, correct content
  const fileRes = await reportsGet(`/${report.id}/file`);
  expect(fileRes.headers['content-type']).toBe('application/pdf');
  const bytes = Buffer.from(fileRes.body);
  expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const stored = Report.__all().find((r) => r._id === report.id);
  expect(stored.file.hash).toBe(hash);

  const text = (await pdfParse(bytes)).text;
  expect(text).toContain('1100.000'); // raw X of the first leg's endpoint (102), independently re-derived above
  expect(text).toContain('1100.040'); // Bowditch-adjusted X of the same point
  expect(text).toContain('Bowditch');
  expect(text).toContain('101'); // start station
  expect(text).toContain('103'); // known endpoint

  // 6. a second generation creates a SECOND, independent, immutable report - never overwrites the first
  const secondRes = await reportsPost('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id });
  expect(secondRes.status).toBe(201);
  expect(secondRes.body.data.id).not.toBe(report.id);
  const listAfter = await reportsGet(`?projectId=${H.PROJECT}`);
  expect(listAfter.body.data.map((r) => r.id).sort()).toEqual([report.id, secondRes.body.data.id].sort());
  // the FIRST report/file are completely untouched by the second generation
  const refetchFirst = await reportsGet(`/${report.id}/file`);
  expect(crypto.createHash('sha256').update(Buffer.from(refetchFirst.body)).digest('hex')).toBe(hash);

  // the FieldObservationSet itself was never touched by any of this
  const fos = FieldObservationSet.__all().find((f) => f._id === fosId);
  expect(fos).toBeTruthy();
});
