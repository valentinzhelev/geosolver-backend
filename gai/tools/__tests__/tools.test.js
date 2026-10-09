jest.mock('../../../models/SurveyPoint', () => require('../../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../../models/CaptureJob', () => require('../../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../../models/FieldObservationSet', () => require('../../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../../models/FieldProcessingRun', () => require('../../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../../models/Report', () => require('../../../tests/support/fakeCaptureModels').Report);
jest.mock('../../../models/Calculation', () => require('../../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../../models/FieldBook', () => require('../../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../../models/FieldSession', () => require('../../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../../models/FieldBookProject');

const SurveyPoint = require('../../../models/SurveyPoint');
const CaptureJob = require('../../../models/CaptureJob');
const FieldObservationSet = require('../../../models/FieldObservationSet');
const FieldProcessingRun = require('../../../models/FieldProcessingRun');
const Report = require('../../../models/Report');
const Calculation = require('../../../models/Calculation');
const FieldBook = require('../../../models/FieldBook');
const FieldBookProject = require('../../../models/FieldBookProject');

const tools = require('../index');

const PROJECT = 'proj1';
const OTHER_PROJECT = 'proj2';
const USER = 'user1';

beforeEach(() => {
  SurveyPoint.__reset();
  CaptureJob.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  Report.__reset();
  Calculation.__reset();
  FieldBook.__reset();
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === PROJECT ? { _id: PROJECT, name: 'Обект Витоша', crs: 'EPSG:7801' } : null));
});

async function seedPolarRun() {
  const job = await CaptureJob.create({ user: USER, project: PROJECT, mode: 'field-notebook', status: 'confirmed', source: { assets: {} } });
  const fos = await FieldObservationSet.create({
    user: USER, projectId: PROJECT, source: { kind: 'capture', captureJobId: job._id },
    pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups: [{ index: 0, station: { point: '101' }, orientation: { target: '102' }, observations: [{ row: 0, target: '201' }] }],
  });
  const run = await FieldProcessingRun.create({
    user: USER, projectId: PROJECT, source: { fieldObservationSetId: fos._id, captureJobId: job._id },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'polar',
    setups: [{
      index: 0,
      station: { identifier: '101', point: { id: 'p101', name: '101', x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '102', point: { id: 'p102', name: '102', x: 1000, y: 2100, h: 500 } },
      orientationConstantGon: 100, setupError: null,
      observations: [
        { index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, heightReason: null, errors: [], warnings: [] },
        { index: 1, target: '202', status: 'XY_ONLY', x: 1030, y: 2000, h: null, direction: 0, horizontalDistance: 30, heightReason: 'PRISM_HEIGHT_MISSING', errors: [], warnings: [] },
      ],
    }],
  });
  const point201 = await SurveyPoint.create({
    user: USER, projectId: PROJECT, name: '201', code: '', x: 1000, y: 2050, h: 499.5,
    source: { kind: 'field-processing', processingType: 'polar', processingRunId: run._id, fieldObservationSetId: fos._id, setup: 0, observation: 0 },
  });
  return { job, fos, run, point201 };
}

async function seedTraverseRun(traverseType = 'KNOWN_ENDPOINT') {
  const run = await FieldProcessingRun.create({
    user: USER, projectId: PROJECT, source: { fieldObservationSetId: 'fos-x', captureJobId: 'job-x' },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'traverse',
    traverse: {
      traverseType, startIdentifier: '101', endIdentifier: traverseType === 'OPEN' ? null : '103', status: 'READY',
      start: { identifier: '101', point: { x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '100', point: { x: 900, y: 2000, h: 500 } },
      end: traverseType === 'OPEN' ? null : { identifier: '103', point: { x: 1100.06, y: 2050.03, h: 500 } },
      legs: [{ index: 0, from: '101', to: '102', status: 'READY', bearingGon: 0, horizontalDistance: 100, rawX: 1100, rawY: 2000, rawH: 499.5, adjustedX: 1100.04, adjustedY: 2000.02, heightReason: null, errors: [], warnings: [] }],
      closure: traverseType === 'OPEN'
        ? { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null }
        : { available: true, reason: null, totalLength: 100, fX: -0.06, fY: -0.03, linearMisclosure: 0.067, relativeClosureDenominator: 1492, perfectClosure: false },
      adjustment: traverseType === 'OPEN' ? { method: 'bowditch', applied: false, reasonNotApplied: 'OPEN_TRAVERSE' } : { method: 'bowditch', applied: true, reasonNotApplied: null },
    },
  });
  return { run };
}

describe('getProjectSummary', () => {
  it('returns deterministic counts, never guessed', async () => {
    await seedPolarRun();
    CaptureJob.__store.rows.forEach((j) => { j.status = 'confirmed'; });
    await CaptureJob.create({ user: USER, project: PROJECT, mode: 'coordinate-table', status: 'needs_review', source: { assets: {} } });
    const summary = await tools.getProjectSummary(PROJECT);
    expect(summary.project.name).toBe('Обект Витоша');
    expect(summary.pointCount).toBe(1);
    expect(summary.capture.total).toBe(2);
    expect(summary.capture.needsReview).toBe(1);
    expect(summary.processing.polarCount).toBe(1);
    expect(summary.legacyFieldBooks).toEqual({ total: 0, active: 0, byType: {} });
  });

  it('distinguishes legacy Field Books from the Capture system - capture.total=0 does not mean legacyFieldBooks.total=0', async () => {
    await FieldBook.create({ user: USER, project: PROJECT, name: 'Нивелачен карнет', type: 'leveling' });
    await FieldBook.create({ user: USER, project: PROJECT, name: 'Координатен карнет', type: 'coordinate' });
    await FieldBook.create({ user: USER, project: PROJECT, name: 'Архивиран карнет', type: 'leveling', archived: true });
    const summary = await tools.getProjectSummary(PROJECT);
    expect(summary.capture.total).toBe(0);
    expect(summary.legacyFieldBooks).toEqual({ total: 3, active: 2, byType: { leveling: 1, coordinate: 1 } });
  });
});

describe('listProjectPoints / getSurveyPointByName / getSurveyPointById', () => {
  it('lists only points belonging to the project', async () => {
    await seedPolarRun();
    await SurveyPoint.create({ user: USER, projectId: OTHER_PROJECT, name: 'X', x: 1, y: 1, h: 1 });
    const points = await tools.listProjectPoints(PROJECT);
    expect(points).toHaveLength(1);
    expect(points[0].name).toBe('201');
  });

  it('finds a point by name, case-insensitively', async () => {
    await seedPolarRun();
    const res = await tools.getSurveyPointByName(PROJECT, '  201 ');
    expect(res.status).toBe('FOUND');
    expect(res.point.x).toBe(1000);
  });

  it('a nonexistent point name is NOT_FOUND, never invented', async () => {
    const res = await tools.getSurveyPointByName(PROJECT, '999');
    expect(res.status).toBe('NOT_FOUND');
  });

  it('never resolves a point that belongs to a DIFFERENT project, even by exact id', async () => {
    const { point201 } = await seedPolarRun();
    const res = await tools.getSurveyPointById(OTHER_PROJECT, point201._id);
    expect(res.status).toBe('NOT_FOUND');
  });
});

describe('tracePointProvenance', () => {
  it('traces a field-processing point through run -> notebook -> capture job', async () => {
    const { point201, run, job } = await seedPolarRun();
    const res = await tools.tracePointProvenance(PROJECT, point201._id);
    expect(res.status).toBe('FOUND');
    const kinds = res.chain.map((c) => c.kind);
    expect(kinds).toEqual(['point', 'processingRun', 'fieldObservationSet', 'captureJob']);
    expect(res.chain[1].id).toBe(String(run._id));
    expect(res.chain[3].id).toBe(String(job._id));
  });

  it('a manually-entered point traces to "manual", never a fabricated source', async () => {
    const p = await SurveyPoint.create({ user: USER, projectId: PROJECT, name: 'M1', x: 1, y: 1, h: 1 });
    const res = await tools.tracePointProvenance(PROJECT, p._id);
    expect(res.chain.map((c) => c.kind)).toEqual(['point', 'manual']);
  });

  it('a point id from another project is NOT_FOUND', async () => {
    const { point201 } = await seedPolarRun();
    const res = await tools.tracePointProvenance(OTHER_PROJECT, point201._id);
    expect(res.status).toBe('NOT_FOUND');
  });
});

describe('listProcessingRuns / getProcessingRun', () => {
  it('summarizes polar and traverse runs distinctly', async () => {
    await seedPolarRun();
    await seedTraverseRun();
    const runs = await tools.listProcessingRuns(PROJECT);
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.processingType === 'polar').targetCount).toBe(2);
    expect(runs.find((r) => r.processingType === 'traverse').legCount).toBe(1);
  });

  it('getProcessingRun returns the exact persisted closure/status for a traverse, never recomputed', async () => {
    const { run } = await seedTraverseRun('KNOWN_ENDPOINT');
    const res = await tools.getProcessingRun(PROJECT, run._id);
    expect(res.status).toBe('FOUND');
    expect(res.detail.closure.linearMisclosure).toBe(0.067);
    expect(res.detail.legs[0].adjustedX).toBe(1100.04);
  });

  it('an OPEN traverse detail carries closure.available=false, never a fabricated number', async () => {
    const { run } = await seedTraverseRun('OPEN');
    const res = await tools.getProcessingRun(PROJECT, run._id);
    expect(res.detail.closure.available).toBe(false);
    expect(res.detail.closure.reason).toBe('OPEN_TRAVERSE');
  });

  it('a run from another project is NOT_FOUND', async () => {
    const { run } = await seedPolarRun();
    const res = await tools.getProcessingRun(OTHER_PROJECT, run._id);
    expect(res.status).toBe('NOT_FOUND');
  });
});

describe('listReports / getCalculationHistory', () => {
  it('lists reports without the heavy model snapshot', async () => {
    await Report.create({
      user: USER, projectId: PROJECT, reportType: 'PROJECT_COORDINATE_LIST', sourceType: 'project-points-snapshot',
      sourceId: null, sourceVersion: {}, templateVersion: 'v1', title: 'Координатен регистър', generatedAt: new Date(), generatedBy: USER,
      model: { huge: 'x'.repeat(1000) }, file: { storageKey: 'a', mime: 'application/pdf', size: 123, hash: 'h' },
    });
    const reports = await tools.listReports(PROJECT);
    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBeUndefined();
    expect(reports[0].title).toContain('Координатен');
  });

  it('lists calculation history with a professional title', async () => {
    await Calculation.create({ userId: USER, projectId: PROJECT, toolName: 'polar-intersection', toolDisplayName: { bg: 'Полярна засечка', en: 'Polar intersection' }, inputData: {}, resultData: {} });
    const calcs = await tools.getCalculationHistory(PROJECT);
    expect(calcs).toHaveLength(1);
    expect(calcs[0].title).toBe('Полярна засечка');
  });
});

describe('extractProjectIssues', () => {
  it('flags a needs-review capture job, an unprocessed notebook, an XY_ONLY polar run, and an OPEN traverse', async () => {
    await CaptureJob.create({ user: USER, project: PROJECT, mode: 'field-notebook', status: 'needs_review', originalName: 'A.jpg', source: { assets: {} } });
    await FieldObservationSet.create({
      user: USER, projectId: PROJECT, source: { kind: 'capture', captureJobId: 'job-unprocessed' },
      pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1', setups: [],
    });
    await seedPolarRun(); // includes an XY_ONLY observation
    await seedTraverseRun('OPEN');
    const issues = await tools.extractProjectIssues(PROJECT, USER);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain('CAPTURE_NEEDS_REVIEW');
    expect(kinds).toContain('NOTEBOOK_NOT_PROCESSED');
    expect(kinds).toContain('POLAR_XY_ONLY');
    expect(kinds).toContain('TRAVERSE_OPEN_NO_CLOSURE');
  });

  it('a fully clean project has no issues', async () => {
    const issues = await tools.extractProjectIssues(PROJECT, USER);
    expect(issues).toEqual([]);
  });
});
