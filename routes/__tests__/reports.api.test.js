process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
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

const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const Report = require('../../models/Report');
const ReportAsset = require('../../models/ReportAsset');
const H = require('../../tests/support/captureApiHarness');
const pdfParse = require('pdf-parse');

jest.setTimeout(30000);

let idCounter = 0;
const nextId = () => `507f1f77bcf86cd7994${String(idCounter++).padStart(5, '0')}`;

const meas = (value, unit = 'm') => (value === null ? null : { value, unit });
const ang = (value, unit = 'gon') => (value === null ? null : { value, unit });

async function seedPolarRun({ projectId = H.PROJECT, user = H.OWNER } = {}) {
  const captureJobId = nextId();
  const fos = await FieldObservationSet.create({
    user, projectId, source: { kind: 'capture', captureJobId },
    pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups: [{
      index: 0, station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '102', direction: null },
      observations: [
        { row: 0, target: '201', hz: ang(0), vz: ang(100), distance: meas(50), horizontalDistance: null, prismHeight: meas(2.0), code: '', notes: '', cells: {} },
      ],
    }],
  });
  const run = await FieldProcessingRun.create({
    user, projectId, source: { fieldObservationSetId: fos._id, captureJobId },
    processingVersion: 'field-processing-2.4.2.0', engineVersions: { 'orientation-constant': 1, 'polar-horizontal': 1 },
    verticalAngleConvention: 'zenith', resultAuthority: 'server', status: 'completed', processingType: 'polar',
    setups: [{
      index: 0,
      station: { identifier: '101', resolution: 'RESOLVED', point: { id: 'p101', name: '101', code: '', x: 1000, y: 2000, h: 500 }, candidates: null },
      orientation: { identifier: '102', resolution: 'RESOLVED', point: { id: 'p102', name: '102', code: '', x: 1000, y: 2100, h: 500 }, candidates: null },
      orientationConstantGon: 100, observedHzToBacksightGon: 0, setupError: null,
      observations: [{ index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, deltaX: 0, deltaY: 50, heightReason: null, errors: [], warnings: [], cells: {} }],
    }],
  });
  return { run, fos };
}

async function seedTraverseRun({ projectId = H.PROJECT, user = H.OWNER, traverseType = 'KNOWN_ENDPOINT' } = {}) {
  const captureJobId = nextId();
  const fos = await FieldObservationSet.create({
    user, projectId, source: { kind: 'capture', captureJobId },
    pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups: [{ index: 0, station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '100', direction: null }, observations: [{ row: 0, target: '102', hz: ang(200), vz: null, distance: null, horizontalDistance: meas(100), prismHeight: null, code: '', notes: '', cells: {} }] }],
  });
  const traverse = {
    traverseType, startIdentifier: '101', endIdentifier: traverseType === 'OPEN' ? null : '103', status: 'READY',
    start: { identifier: '101', resolution: 'RESOLVED', point: { id: 'p101', name: '101', x: 1000, y: 2000, h: 500 }, candidates: null },
    orientation: { identifier: '100', resolution: 'RESOLVED', point: { id: 'p100', name: '100', x: 900, y: 2000, h: 500 }, candidates: null },
    end: traverseType === 'OPEN' ? null : { identifier: '103', resolution: 'RESOLVED', point: { id: 'p103', name: '103', x: 1100.06, y: 2050.03, h: 500 }, candidates: null },
    legs: [{ index: 0, fromSetupIndex: 0, toSetupIndex: null, from: '101', to: '102', sourceObservation: { setupIndex: 0, row: 0 }, status: 'READY', bearingGon: 0, horizontalDistance: 100, rawDeltaX: 100, rawDeltaY: 0, rawX: 1100, rawY: 2000, rawH: null, heightReason: 'STATION_H_UNKNOWN', adjustedX: traverseType === 'OPEN' ? null : 1100.04, adjustedY: traverseType === 'OPEN' ? null : 2000.02, correctionX: traverseType === 'OPEN' ? null : 0.04, correctionY: traverseType === 'OPEN' ? null : 0.02, errors: [], warnings: [] }],
    closure: traverseType === 'OPEN'
      ? { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null, perfectClosure: null, relativeClosureDenominator: null }
      : { available: true, reason: null, totalLength: 100, fX: -0.06, fY: -0.03, linearMisclosure: 0.067, perfectClosure: false, relativeClosureDenominator: 1492 },
    adjustment: traverseType === 'OPEN'
      ? { method: 'bowditch', version: 1, applied: false, reasonNotApplied: 'OPEN_TRAVERSE' }
      : { method: 'bowditch', version: 1, applied: true, reasonNotApplied: null },
  };
  const run = await FieldProcessingRun.create({
    user, projectId, source: { fieldObservationSetId: fos._id, captureJobId },
    processingVersion: 'field-processing-2.4.2.0', engineVersions: { 'traverse-bowditch': 1 },
    verticalAngleConvention: 'zenith', resultAuthority: 'server', status: 'completed', processingType: 'traverse', traverse,
  });
  return { run, fos };
}

beforeEach(() => {
  idCounter = 0;
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  Report.__reset();
  ReportAsset.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const post = (path, body, userId = H.OWNER) => H.authed(app, 'post', `/api/reports${path}`, userId).send(body);
const get = (path, userId = H.OWNER) => H.authed(app, 'get', `/api/reports${path}`, userId);

describe('POST /api/reports: validation', () => {
  it('an invalid reportType -> 400', async () => {
    expect((await post('/', { reportType: 'NONSENSE', projectId: H.PROJECT })).status).toBe(400);
  });
  it('a missing/invalid projectId -> 400', async () => {
    expect((await post('/', { reportType: 'PROJECT_COORDINATE_LIST' })).status).toBe(400);
    expect((await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: 'nope' })).status).toBe(400);
  });
  it('POLAR/TRAVERSE without a sourceId -> 400', async () => {
    expect((await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT })).status).toBe(400);
    expect((await post('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT })).status).toBe(400);
  });
  it('a non-existent project -> 404', async () => {
    expect((await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: '507f1f77bcf86cd799439999' })).status).toBe(404);
  });
  it('a non-existent source run -> 404', async () => {
    const res = await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: '507f1f77bcf86cd799439999' });
    expect(res.status).toBe(404);
  });
  it('a viewer (below editor) cannot generate -> 403; no access -> 404', async () => {
    expect((await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.SHARED_PROJECT }, H.OWNER)).status).toBe(403);
    expect((await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.OTHER_PROJECT }, H.OWNER)).status).toBe(404);
  });
});

describe('POST /api/reports: source/project mismatch and type mismatch', () => {
  it('a source run from ANOTHER project is rejected, never rendered', async () => {
    const { run } = await seedPolarRun({ projectId: H.SHARED_PROJECT, user: H.OTHER });
    const res = await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id ? run.id : run._id }, H.OWNER);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SOURCE_PROJECT_MISMATCH');
  });

  it('a TRAVERSE report requested against a POLAR run (same project) is rejected', async () => {
    const { run } = await seedPolarRun();
    const res = await post('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SOURCE_TYPE_MISMATCH');
  });

  it('a POLAR report requested against a TRAVERSE run (same project) is rejected', async () => {
    const { run } = await seedTraverseRun();
    const res = await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SOURCE_TYPE_MISMATCH');
  });
});

describe('POST /api/reports: generates each report type from persisted authoritative data', () => {
  it('POLAR_PROCESSING_REPORT: renders the exact persisted run, never recomputed', async () => {
    const { run } = await seedPolarRun();
    const res = await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id });
    expect(res.status).toBe(201);
    const report = res.body.data;
    expect(report.reportType).toBe('POLAR_PROCESSING_REPORT');
    expect(report.sourceType).toBe('field-processing-run');
    expect(report.sourceId).toBe(String(run._id));
    expect(report.fileMime).toBe('application/pdf');
    expect(report.fileSize).toBeGreaterThan(1000);
    expect(report.generatedBy.name).toBe('Test Owner');

    const fileRes = await get(`/${report.id}/file`);
    expect(fileRes.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(fileRes.body).slice(0, 5).toString()).toBe('%PDF-');
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).toContain('101');
    expect(text).toContain('499.500');
  });

  it('TRAVERSE_PROCESSING_REPORT (KNOWN_ENDPOINT): PDF contains raw and adjusted coordinates', async () => {
    const { run } = await seedTraverseRun({ traverseType: 'KNOWN_ENDPOINT' });
    const res = await post('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id });
    expect(res.status).toBe(201);
    const fileRes = await get(`/${res.body.data.id}/file`);
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).toContain('1100.000');
    expect(text).toContain('1100.040');
    expect(text).toContain('Bowditch');
  });

  it('TRAVERSE_PROCESSING_REPORT (OPEN): PDF states closure/Bowditch are not applicable', async () => {
    const { run } = await seedTraverseRun({ traverseType: 'OPEN' });
    const res = await post('/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id });
    expect(res.status).toBe(201);
    const fileRes = await get(`/${res.body.data.id}/file`);
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).toContain('не са приложими');
  });

  it('PROJECT_COORDINATE_LIST: snapshots current SurveyPoints', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'A1', code: '', x: 4700030.123, y: 500050.456, h: 120.789 });
    const res = await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.PROJECT });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceType).toBe('project-points-snapshot');
    expect(res.body.data.sourceId).toBeNull();
    const fileRes = await get(`/${res.body.data.id}/file`);
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).toContain('4700030.123');
  });

  it('never accepts client-supplied coordinates/results: the body is ignored, the PDF matches the real persisted run', async () => {
    const { run } = await seedPolarRun();
    const res = await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id, setups: [{ station: { point: { x: 999999 } } }] });
    const fileRes = await get(`/${res.body.data.id}/file`);
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).not.toContain('999999');
    expect(text).toContain('1000.000'); // the REAL station X
  });
});

describe('GET /api/reports and metadata', () => {
  it('lists reports for a project, newest first, without the full model snapshot', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'A1', x: 1, y: 1, h: 1 });
    const a = (await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.PROJECT })).body.data;
    await new Promise((r) => setTimeout(r, 2));
    const b = (await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.PROJECT })).body.data;
    const res = await get(`?projectId=${H.PROJECT}`);
    expect(res.body.data.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(res.body.data[0].model).toBeUndefined();
  });

  it('GET /:id returns full metadata; a report from another project is 404 for an unauthorized user', async () => {
    const { run } = await seedPolarRun();
    const created = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    const res = await get(`/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toContain('полярна');
    const forbidden = await H.authed(app, 'get', `/api/reports/${created.id}`, H.OTHER);
    expect(forbidden.status).toBe(404); // existence not revealed
  });

  it('an arbitrary/malformed report id is a clean 404, not a 500', async () => {
    expect((await get('/not-an-object-id')).status).toBe(404);
    expect((await get('/507f1f77bcf86cd799439999')).status).toBe(404);
  });

  it('file download for an inaccessible report is also 404', async () => {
    const { run } = await seedPolarRun({ projectId: H.SHARED_PROJECT, user: H.OTHER });
    const created = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.SHARED_PROJECT, sourceId: run._id }, H.OTHER)).body.data;
    const res = await H.authed(app, 'get', `/api/reports/${created.id}/file`, H.OWNER); // OWNER is only a viewer on SHARED_PROJECT
    expect(res.status).toBe(403);
  });
});

describe('immutability and regeneration', () => {
  it('regenerating the same report creates a SECOND, independent report id', async () => {
    const { run } = await seedPolarRun();
    const a = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    const b = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    expect(a.id).not.toBe(b.id);
    expect(Report.__all()).toHaveLength(2);
  });

  it('the stored hash matches a fresh SHA-256 of the downloaded bytes', async () => {
    const { run } = await seedPolarRun();
    const created = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    const fileRes = await get(`/${created.id}/file`);
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(Buffer.from(fileRes.body)).digest('hex');
    const stored = Report.__all().find((r) => r._id === created.id);
    expect(stored.file.hash).toBe(hash);
  });

  it('the file endpoint sets a safe, Bulgarian-capable Content-Disposition filename', async () => {
    const { run } = await seedPolarRun();
    const created = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    const fileRes = await get(`/${created.id}/file`);
    const cd = fileRes.headers['content-disposition'];
    expect(cd).toMatch(/^attachment; filename="[^"]*\.pdf"; filename\*=UTF-8''/);
    expect(cd).not.toMatch(/[\r\n]/); // no header injection via a crafted title/project name
  });
});
