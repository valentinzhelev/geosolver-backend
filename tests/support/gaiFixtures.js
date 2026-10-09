/**
 * Deterministic GAI fixtures (V1.0.2), seeded into the in-memory fakes from fakeCaptureModels.js. Every test file
 * that uses these must jest.mock the corresponding models to those fakes (the fakes are the same module instances
 * inside one test file's registry).
 *
 *   seedProductionProject - the exact live production shape: "Практическо Задание", EPSG:7801, 31 points,
 *                           0 Capture jobs, 2 coordinate-type legacy Field Books, 0 processing, 0 reports.
 *   seedRichProject       - every entity GAI reasons about: a Capture job "За проверка", a confirmed field notebook
 *                           -> polar run that created 201 (with H) and 202 (no H: missing prism height), a
 *                           KNOWN_ENDPOINT traverse with a persisted 0.037 m misclosure + Bowditch, an OPEN traverse,
 *                           a report, and a manually entered point.
 */
const F = require('./fakeCaptureModels');

const meas = (value, unit = 'm') => ({ value, unit });
/** The fakes stamp createdAt at create(); pin it so "latest" ordering and date labels are deterministic. */
async function at(doc, iso) { doc.createdAt = new Date(iso); await doc.save(); return doc; }
const ang = (value, unit = 'gon') => ({ value, unit });

async function seedProductionProject({ projectId, userId }) {
  for (let i = 0; i < 31; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await F.SurveyPoint.create({ user: userId, projectId, name: String(100 + i), x: 4700000 + i, y: 8500000 + i, h: 500 });
  }
  await F.FieldBook.create({ user: userId, project: projectId, name: 'Карнет 1', type: 'coordinate' });
  await F.FieldBook.create({ user: userId, project: projectId, name: 'Карнет 2', type: 'coordinate' });
}

async function seedRichProject({ projectId, userId, notebookNotes202 = '' }) {
  const reviewJob = await F.CaptureJob.create({ user: userId, project: projectId, mode: 'field-notebook', status: 'needs_review', source: { originalName: 'polygon_22_09.jpg', assets: {} } });
  await at(reviewJob, '2026-09-24T08:00:00Z');

  const job = await F.CaptureJob.create({ user: userId, project: projectId, mode: 'field-notebook', status: 'confirmed', source: { originalName: 'station_101.jpg', assets: {} } });
  await at(job, '2026-09-22T07:00:00Z');
  const fos = await F.FieldObservationSet.create({
    user: userId, projectId, source: { kind: 'capture', captureJobId: job._id }, confirmedAt: new Date('2026-09-22T08:00:00Z'),
    pipelineVersion: 'v1', recognitionVersion: 'v1', arbitrationVersion: 'v1', validationVersion: 'v1', notebookVersion: 'v1',
    setups: [{
      index: 0, station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '102', direction: null },
      observations: [
        { row: 0, target: '201', hz: ang(0), vz: ang(100), distance: meas(50), horizontalDistance: null, prismHeight: meas(2), code: '', notes: '' },
        { row: 1, target: '202', hz: ang(100), vz: ang(100), distance: meas(30), horizontalDistance: null, prismHeight: null, code: '', notes: notebookNotes202 },
      ],
    }],
  });
  const polarRun = await F.FieldProcessingRun.create({
    user: userId, projectId, source: { fieldObservationSetId: fos._id, captureJobId: job._id },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'polar',
    verticalAngleConvention: 'zenith',
    setups: [{
      index: 0,
      station: { identifier: '101', point: { id: 'p101', name: '101', x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '102', point: { id: 'p102', name: '102', x: 1000, y: 2100, h: 500 } },
      orientationConstantGon: 100, setupError: null,
      observations: [
        { index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, heightReason: null, errors: [], warnings: [] },
        { index: 1, target: '202', status: 'XY_ONLY', x: 970, y: 2000, h: null, direction: 200, horizontalDistance: 30, heightReason: 'PRISM_HEIGHT_MISSING', errors: [], warnings: [] },
      ],
    }],
  });
  await at(polarRun, '2026-09-22T09:00:00Z');
  const p201 = await F.SurveyPoint.create({ user: userId, projectId, name: '201', x: 1000, y: 2050, h: 499.5, source: { kind: 'field-processing', processingType: 'polar', processingRunId: polarRun._id, fieldObservationSetId: fos._id, setup: 0, observation: 0 } });
  const p202 = await F.SurveyPoint.create({ user: userId, projectId, name: '202', x: 970, y: 2000, h: null, source: { kind: 'field-processing', processingType: 'polar', processingRunId: polarRun._id, fieldObservationSetId: fos._id, setup: 0, observation: 1 } });
  polarRun.generatedPointIds = [p201._id, p202._id];
  await polarRun.save();

  const traverse = (traverseType) => ({
    traverseType, startIdentifier: '101', endIdentifier: traverseType === 'OPEN' ? null : '103', status: 'READY',
    start: { identifier: '101', point: { x: 1000, y: 2000, h: 500 } },
    orientation: { identifier: '100', point: { x: 900, y: 2000, h: 500 } },
    end: traverseType === 'OPEN' ? null : { identifier: '103', point: { x: 1100.06, y: 2050.03, h: 500 } },
    legs: [{
      index: 0, fromSetupIndex: 0, toSetupIndex: null, from: '101', to: traverseType === 'OPEN' ? '104' : '102', sourceObservation: { setupIndex: 0, row: 0 },
      status: 'READY', bearingGon: 0, horizontalDistance: 100, rawX: 1100, rawY: 2000, rawH: 499.5,
      adjustedX: traverseType === 'OPEN' ? null : 1100.04, adjustedY: traverseType === 'OPEN' ? null : 2000.02, heightReason: null, errors: [], warnings: [],
    }],
    closure: traverseType === 'OPEN'
      ? { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null, perfectClosure: null, relativeClosureDenominator: null }
      : { available: true, reason: null, totalLength: 100, fX: -0.03, fY: -0.02, linearMisclosure: 0.037, relativeClosureDenominator: 2702.7, perfectClosure: false },
    adjustment: traverseType === 'OPEN' ? { method: 'bowditch', applied: false, reasonNotApplied: 'OPEN_TRAVERSE' } : { method: 'bowditch', applied: true, reasonNotApplied: null },
  });
  const knownRun = await F.FieldProcessingRun.create({
    user: userId, projectId, source: { fieldObservationSetId: 'fos-known', captureJobId: 'job-known' },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'traverse', traverse: traverse('KNOWN_ENDPOINT'),
  });
  await at(knownRun, '2026-09-23T09:00:00Z');
  // created last -> newest: "the latest traverse" questions must resolve to the OPEN one unless filtered otherwise
  const openRun = await F.FieldProcessingRun.create({
    user: userId, projectId, source: { fieldObservationSetId: 'fos-open', captureJobId: 'job-open' },
    processingVersion: 'v1', engineVersions: {}, resultAuthority: 'server', status: 'completed', processingType: 'traverse', traverse: traverse('OPEN'),
  });
  await at(openRun, '2026-09-23T15:00:00Z');

  await F.Report.create({
    user: userId, projectId, reportType: 'PROJECT_COORDINATE_LIST', sourceType: 'project-points-snapshot', sourceId: null,
    sourceVersion: {}, templateVersion: 'v1', title: 'Координатен регистър', generatedAt: new Date('2026-09-23T09:00:00Z'), generatedBy: userId, model: {},
    file: { storageKey: 'a', mime: 'application/pdf', size: 1, hash: 'h' },
  });
  await F.SurveyPoint.create({ user: userId, projectId, name: '300', x: 1200, y: 2200, h: null });

  return { job, fos, polarRun, knownRun, openRun, p201, p202 };
}

function resetAll() {
  for (const m of ['SurveyPoint', 'CaptureJob', 'FieldObservationSet', 'FieldProcessingRun', 'Report', 'Calculation', 'FieldBook', 'FieldSession', 'GaiConversation', 'GaiMessage']) F[m].__reset();
}

module.exports = { seedProductionProject, seedRichProject, resetAll };
