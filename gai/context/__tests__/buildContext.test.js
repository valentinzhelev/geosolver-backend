jest.mock('../../../models/SurveyPoint', () => require('../../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../../models/CaptureJob', () => require('../../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../../models/FieldObservationSet', () => require('../../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../../models/FieldProcessingRun', () => require('../../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../../models/Report', () => require('../../../tests/support/fakeCaptureModels').Report);
jest.mock('../../../models/Calculation', () => require('../../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../../models/FieldBookProject');

const SurveyPoint = require('../../../models/SurveyPoint');
const CaptureJob = require('../../../models/CaptureJob');
const FieldObservationSet = require('../../../models/FieldObservationSet');
const FieldProcessingRun = require('../../../models/FieldProcessingRun');
const Report = require('../../../models/Report');
const Calculation = require('../../../models/Calculation');
const FieldBookProject = require('../../../models/FieldBookProject');
const { buildContext } = require('../buildContext');

const PROJECT = 'proj1';
const USER = 'user1';

beforeEach(() => {
  SurveyPoint.__reset();
  CaptureJob.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  Report.__reset();
  Calculation.__reset();
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === PROJECT ? { _id: PROJECT, name: 'Обект Витоша', crs: null } : null));
});

async function seedTraverseRun(traverseType = 'KNOWN_ENDPOINT') {
  return FieldProcessingRun.create({
    user: USER, projectId: PROJECT, source: { fieldObservationSetId: 'fos-x', captureJobId: 'job-x' },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'traverse',
    traverse: {
      traverseType, startIdentifier: '101', endIdentifier: traverseType === 'OPEN' ? null : '103', status: 'READY',
      start: { identifier: '101', point: { x: 1000, y: 2000, h: 500 } }, orientation: { identifier: '100', point: { x: 900, y: 2000, h: 500 } },
      end: traverseType === 'OPEN' ? null : { identifier: '103', point: { x: 1100.06, y: 2050.03, h: 500 } },
      legs: [{ index: 0, from: '101', to: '102', status: 'READY', bearingGon: 0, horizontalDistance: 100, rawX: 1100, rawY: 2000, rawH: 499.5, adjustedX: traverseType === 'OPEN' ? null : 1100.04, adjustedY: traverseType === 'OPEN' ? null : 2000.02, heightReason: null, errors: [], warnings: [] }],
      closure: traverseType === 'OPEN'
        ? { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null }
        : { available: true, reason: null, totalLength: 100, fX: -0.06, fY: -0.03, linearMisclosure: 0.037, relativeClosureDenominator: 2702, perfectClosure: false },
      adjustment: traverseType === 'OPEN' ? { method: 'bowditch', applied: false, reasonNotApplied: 'OPEN_TRAVERSE' } : { method: 'bowditch', applied: true, reasonNotApplied: null },
    },
  });
}

describe('buildContext: intent-gated, never stuffs unrelated data', () => {
  it('"Колко точки има проектът?" -> project summary only, no processing/report data pulled', async () => {
    await SurveyPoint.create({ user: USER, projectId: PROJECT, name: 'A1', x: 1, y: 1, h: 1 });
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Колко точки има проектът?' });
    expect(ctx.data.projectSummary.pointCount).toBe(1);
    expect(ctx.data.processingRuns).toBeUndefined();
    expect(ctx.data.reports).toBeUndefined();
  });

  it('a mentioned point that DOES exist resolves with its full provenance chain', async () => {
    const job = await CaptureJob.create({ user: USER, project: PROJECT, mode: 'field-notebook', status: 'confirmed', source: { assets: {} } });
    const fos = await FieldObservationSet.create({ user: USER, projectId: PROJECT, source: { kind: 'capture', captureJobId: job._id }, pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1', setups: [] });
    const run = await FieldProcessingRun.create({
      user: USER, projectId: PROJECT, source: { fieldObservationSetId: fos._id, captureJobId: job._id },
      processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'polar',
      setups: [{ index: 0, station: { identifier: '101', point: { x: 1000, y: 2000, h: 500 } }, orientation: { identifier: '102', point: { x: 1000, y: 2100 } }, orientationConstantGon: 100, setupError: null, observations: [{ index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, heightReason: null, errors: [], warnings: [] }] }],
    });
    await SurveyPoint.create({ user: USER, projectId: PROJECT, name: '201', x: 1000, y: 2050, h: 499.5, source: { kind: 'field-processing', processingType: 'polar', processingRunId: run._id, fieldObservationSetId: fos._id, setup: 0, observation: 0 } });

    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Как е получена точка 201?' });
    expect(ctx.data.points).toHaveLength(1);
    expect(ctx.data.points[0].status).toBe('FOUND');
    expect(ctx.data.points[0].point.x).toBe(1000);
    expect(ctx.data.points[0].provenanceChain.map((s) => s.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'captureJob']);
    const storedPoints = await SurveyPoint.find({ projectId: PROJECT });
    expect(ctx.evidence.some((e) => e.kind === 'surveyPoint' && e.id === String(storedPoints[0]._id))).toBe(true);
  });

  it('a mentioned point that does NOT exist is reported NOT_FOUND, never invented', async () => {
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Как е получена точка 999?' });
    expect(ctx.data.points).toEqual([{ requested: '999', status: 'NOT_FOUND' }]);
  });

  it('OPEN traverse question includes closure.available=false, never a fabricated number', async () => {
    await seedTraverseRun('OPEN');
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Има ли OPEN полигонови ходове?' });
    expect(ctx.data.processingRuns).toHaveLength(1);
    expect(ctx.data.latestMatchingRunDetail.detail.closure.available).toBe(false);
  });

  it('a closure/misclosure question surfaces the EXACT persisted linearMisclosure', async () => {
    await seedTraverseRun('KNOWN_ENDPOINT');
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Каква беше невръзката на последния полигонов ход?' });
    expect(ctx.data.latestMatchingRunDetail.detail.closure.linearMisclosure).toBe(0.037);
  });

  it('a review question includes field data AND issues', async () => {
    await CaptureJob.create({ user: USER, project: PROJECT, mode: 'field-notebook', status: 'needs_review', originalName: 'X.jpg', source: { assets: {} } });
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Кои теренни данни още чакат проверка?' });
    expect(ctx.data.fieldData).toHaveLength(1);
    expect(ctx.data.issues.some((i) => i.kind === 'CAPTURE_NEEDS_REVIEW')).toBe(true);
  });

  it('a reports question includes the reports list', async () => {
    await Report.create({ user: USER, projectId: PROJECT, reportType: 'PROJECT_COORDINATE_LIST', sourceType: 'project-points-snapshot', sourceId: null, sourceVersion: {}, templateVersion: 'v1', title: 'Координатен регистър', generatedAt: new Date(), generatedBy: USER, model: {}, file: { storageKey: 'a', mime: 'application/pdf', size: 1, hash: 'h' } });
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Кои отчети са генерирани?' });
    expect(ctx.data.reports).toHaveLength(1);
  });

  it('evidence entries are de-duplicated', async () => {
    await seedTraverseRun('KNOWN_ENDPOINT');
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Обясни тази Bowditch обработка, тази полигонова обработка' });
    const keys = ctx.evidence.map((e) => `${e.kind}:${e.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
