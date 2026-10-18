process.env.JWT_SECRET = 'test-secret-for-jest';

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
 * V2.5 section 8/10 - PROOF that a ReportDocument is a true, immutable snapshot: neither re-reading it nor
 * mutating the project/SurveyPoint state it was rendered from can ever change what an already-generated report
 * says, in its metadata, its stored model, OR its actual PDF bytes.
 */
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

const meas = (value, unit = 'm') => ({ value, unit });
const ang = (value, unit = 'gon') => ({ value, unit });

const PROJECT_RECORD = { _id: H.PROJECT, user: H.OWNER, workspace: null, crs: 'EPSG:7800', name: 'Обект Витоша' };

beforeEach(() => {
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  Report.__reset();
  ReportAsset.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  // configureAccess's own project fixtures have no `name` - override with one that HAS a name, so we can mutate it later.
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === H.PROJECT ? { ...PROJECT_RECORD } : null));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const post = (path, body, userId = H.OWNER) => H.authed(app, 'post', `/api/reports${path}`, userId).send(body);
const get = (path, userId = H.OWNER) => H.authed(app, 'get', `/api/reports${path}`, userId);

describe('PROJECT_COORDINATE_LIST: a true point-in-time snapshot', () => {
  it('mutating the project name and a point\'s coordinates AFTER generation never changes the existing report', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'A1', code: '', x: 100, y: 200, h: 10 });
    const created = (await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.PROJECT })).body.data;
    const firstFileRes = await get(`/${created.id}/file`);
    const firstText = (await pdfParse(Buffer.from(firstFileRes.body))).text;
    expect(firstText).toContain('100.000');
    expect(firstText).toContain('Обект Витоша');

    // mutate the "current" state after the report already exists
    FieldBookProject.findById.mockImplementation(async (id) => (String(id) === H.PROJECT ? { ...PROJECT_RECORD, name: 'Променено име' } : null));
    const point = SurveyPoint.__all().find((p) => p.name === 'A1');
    point.x = 999999.999; // simulate an edit to the SurveyPoint after the report was generated
    SurveyPoint.__seed(point); // fakeCaptureModels has no update() - reseed to simulate the mutation landing

    // re-fetch the SAME, already-generated report
    const reread = await get(`/${created.id}`);
    expect(reread.body.data.title).toBe(created.title);
    const rereadFileRes = await get(`/${created.id}/file`);
    const rereadText = (await pdfParse(Buffer.from(rereadFileRes.body))).text;
    expect(rereadText).toContain('100.000'); // still the OLD coordinate
    expect(rereadText).not.toContain('999999.999');
    expect(rereadText).toContain('Обект Витоша'); // still the OLD project name
    expect(rereadText).not.toContain('Променено име');

    // a NEW generation, however, DOES reflect the new state - proving the old one wasn't just stale/broken
    SurveyPoint.__reset();
    SurveyPoint.__seed({ ...point, x: 999999.999 });
    const second = (await post('/', { reportType: 'PROJECT_COORDINATE_LIST', projectId: H.PROJECT })).body.data;
    expect(second.id).not.toBe(created.id);
    const secondFileRes = await get(`/${second.id}/file`);
    const secondText = (await pdfParse(Buffer.from(secondFileRes.body))).text;
    expect(secondText).toContain('999999.999');
    expect(secondText).toContain('Променено име');

    // both reports remain listed - the first was never overwritten
    expect(Report.__all().map((r) => r._id).sort()).toEqual([created.id, second.id].sort());
  });
});

describe('POLAR_PROCESSING_REPORT: reproducible from the persisted run snapshot, never a live SurveyPoint re-query', () => {
  it('mutating a live SurveyPoint with the SAME name as the run\'s station never changes an already-generated report', async () => {
    const captureJobId = '507f1f77bcf86cd799439a01';
    const fos = await FieldObservationSet.create({
      user: H.OWNER, projectId: H.PROJECT, source: { kind: 'capture', captureJobId },
      pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
      setups: [{
        index: 0, station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '102', direction: null },
        observations: [{ row: 0, target: '201', hz: ang(0), vz: ang(100), distance: meas(50), horizontalDistance: null, prismHeight: meas(2.0), code: '', notes: '', cells: {} }],
      }],
    });
    const run = await FieldProcessingRun.create({
      user: H.OWNER, projectId: H.PROJECT, source: { fieldObservationSetId: fos._id, captureJobId },
      processingVersion: 'field-processing-2.4.2.0', engineVersions: {}, verticalAngleConvention: 'zenith',
      resultAuthority: 'server', status: 'completed', processingType: 'polar',
      setups: [{
        index: 0,
        station: { identifier: '101', resolution: 'RESOLVED', point: { id: 'p101', name: '101', code: '', x: 1000, y: 2000, h: 500 }, candidates: null },
        orientation: { identifier: '102', resolution: 'RESOLVED', point: { id: 'p102', name: '102', code: '', x: 1000, y: 2100, h: 500 }, candidates: null },
        orientationConstantGon: 100, observedHzToBacksightGon: 0, setupError: null,
        observations: [{ index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, deltaX: 0, deltaY: 50, heightReason: null, errors: [], warnings: [], cells: {} }],
      }],
    });

    // a LIVE SurveyPoint also happens to be named '101' (e.g. re-imported/edited later at a different coordinate)
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: '101', code: '', x: -1, y: -1, h: -1 });

    const created = (await post('/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run._id })).body.data;
    const fileRes = await get(`/${created.id}/file`);
    const text = (await pdfParse(Buffer.from(fileRes.body))).text;
    expect(text).toContain('1000.000'); // the RUN's own persisted station snapshot, never the live SurveyPoint
    expect(text).not.toContain('-1.000');
  });
});
