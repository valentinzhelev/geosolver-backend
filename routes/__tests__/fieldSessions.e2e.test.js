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
 * FIELD SESSIONS V2 - AUTOMATED END-TO-END ACCEPTANCE
 *
 * The whole chain through the REAL routes and the REAL deterministic engines (nothing hand-built downstream of the
 * session): Field Session -> confirmed observations -> processing -> points -> report, with every link verified from
 * both ends and the single-source-of-truth rule checked ("no duplicated authoritative values").
 *
 *   1. manual polar session   2. manual multi-station traverse session   3. an OCR-notebook (Capture) session
 */
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const F = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { layoutNotebook, renderTableImage } = require('../../tests/support/notebookFixtures');

const { CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession } = F;

jest.setTimeout(90000);

beforeEach(() => {
  for (const m of [CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession]) m.__reset();
  setStorage(F.createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const sessions = (method, path, body) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`);
  return body === undefined ? r : r.send(body);
};
const fp = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const reports = (method, path, body) => {
  const r = H.authed(app, method, `/api/reports${path}`);
  return body === undefined ? r : r.send(body);
};
const seedPoint = (name, x, y, h = 500) => SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name, x, y, h });

/** Every authoritative record a session's chain touches, read straight from the stores. */
const stored = {
  session: (id) => FieldSession.__all().find((s) => s._id === id),
  set: (id) => FieldObservationSet.__all().find((f) => f._id === id),
  run: (id) => FieldProcessingRun.__all().find((r) => r._id === id),
};

describe('SCENARIO 1: manual POLAR session -> confirm -> processing -> points -> report', () => {
  // 101 at (X=1000, Y=2000, H=500); backsight 102 due east (bearing 100 gon) read as 0 -> orientation constant 100 gon.
  // 201: hz 0   -> direction 100 gon (east),  30 m -> (1000, 2050) with 50 m;   202: hz 100 -> 200 gon (south) -> (970, 2000)
  // 203: hz 300 -> 0 gon (north) -> (1020, 2000). Heights: zenith 100 gon (horizontal), i=1.5: 201 t=1.5 -> 500, 202 t=1.8 -> 499.7,
  // 203 has no prism height -> XY only.
  const entries = () => [{
    station: { point: '101', instrumentHeight: '1.5', notes: 'отворена площадка' },
    orientation: { target: '102', direction: '0' },
    observations: [
      { target: '201', hz: '0', vz: '100', distance: '50', prismHeight: '1.5', code: 'К1' },
      { target: '202', hz: '100', vz: '100', distance: '30', prismHeight: '1.8' },
      { target: '203', hz: '300', vz: '100', distance: '20' },
    ],
  }];

  it('the full chain, with every link verified from both ends and no duplicated authoritative values', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);

    // --- Field Session: create, enter, review, confirm ---------------------------------------------------------
    const created = (await sessions('post', '/', { projectId: H.PROJECT, date: '2026-10-09', operator: 'В. Желев', instrument: 'Leica TS07', instrumentSerial: '1234567', conditions: 'слънчево, 18°C', angleUnit: 'gon' })).body.data;
    expect(created).toMatchObject({ status: 'draft', title: 'Теренна сесия — 09.10.2026' });
    const saved = (await sessions('patch', `/${created.id}`, { setups: entries(), baseRevision: created.revision })).body.data;
    expect(saved.evaluation.issues).toEqual([]); // 101/102 exist in the project -> not even a reference warning
    expect((await sessions('post', `/${created.id}/submit`)).body.data.statusLabel).toBe('За проверка');
    const confirmed = (await sessions('post', `/${created.id}/confirm`)).body;
    expect(confirmed.data).toMatchObject({ status: 'confirmed', statusLabel: 'Потвърдена', setupCount: 1, observationCount: 3 });
    const setId = confirmed.data.observationSetId;

    // --- the entry point offers exactly what the data supports -------------------------------------------------
    const detail = (await sessions('get', `/${created.id}`)).body.data;
    expect(detail.processingOptions.polar).toMatchObject({ available: true, setupCount: 1, observationCount: 3 });
    expect(detail.processingOptions.traverse.available).toBe(false);

    // --- polar processing from the confirmed observations ------------------------------------------------------
    const runRes = await fp('', { fieldObservationSetId: setId, verticalAngleConvention: 'zenith' });
    expect(runRes.status).toBe(201);
    const run = runRes.body.data;
    expect(run.source).toEqual({ fieldObservationSetId: setId, captureJobId: null, fieldSessionId: created.id }); // links BACK to the session
    const obsOf = (t) => run.setups[0].observations.find((o) => o.target === t);
    expect(obsOf('201')).toMatchObject({ status: 'READY' });
    expect(obsOf('201').x).toBeCloseTo(1000, 6);
    expect(obsOf('201').y).toBeCloseTo(2050, 6);
    expect(obsOf('201').h).toBeCloseTo(500, 6);
    expect(obsOf('202')).toMatchObject({ status: 'READY' });
    expect(obsOf('202').x).toBeCloseTo(970, 6);
    expect(obsOf('202').y).toBeCloseTo(2000, 6);
    expect(obsOf('202').h).toBeCloseTo(499.7, 6);
    expect(obsOf('203')).toMatchObject({ status: 'XY_ONLY', heightReason: 'PRISM_HEIGHT_MISSING' });
    expect(obsOf('203').x).toBeCloseTo(1020, 6);
    expect(obsOf('203').y).toBeCloseTo(2000, 6);

    // --- points -----------------------------------------------------------------------------------------------
    const pointsRes = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pointsRes.status).toBe(200);
    expect(pointsRes.body.created.map((c) => c.name).sort()).toEqual(['201', '202', '203']);
    const points = SurveyPoint.__all().filter((p) => ['201', '202', '203'].includes(p.name));
    expect(points.map((p) => p.name).sort()).toEqual(['201', '202', '203']);
    const p203 = points.find((p) => p.name === '203');
    expect(p203.h).toBeNull(); // no height was ever invented
    expect(points.every((p) => p.source.kind === 'field-processing' && p.source.processingRunId === run.id)).toBe(true);

    // --- report -----------------------------------------------------------------------------------------------
    const reportRes = await reports('post', '/', { reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id });
    expect(reportRes.status).toBe(201);
    const report = reportRes.body.data;
    const file = await reports('get', `/${report.id}/file`);
    const bytes = Buffer.from(file.body);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(Report.__all().find((r) => r._id === report.id).file.hash);
    const text = (await pdfParse(bytes)).text;
    for (const needle of ['101', '201', '2050.000', '970.000', '499.700']) expect(text).toContain(needle);

    // --- the session now tells the whole story, from deterministic counts ---------------------------------------
    const after = (await sessions('get', `/${created.id}`)).body.data;
    expect(after).toMatchObject({ status: 'processed', statusLabel: 'Обработена', processing: { runCount: 1, pointCount: 3, reportCount: 1 } });
    expect(after.runs).toEqual([expect.objectContaining({ id: run.id, processingType: 'polar', pointCount: 3 })]);
    expect(after.reports).toEqual([expect.objectContaining({ id: report.id, reportType: 'POLAR_PROCESSING_REPORT' })]);
    const listed = (await sessions('get', `/?projectId=${H.PROJECT}`)).body.data[0];
    expect(listed).toMatchObject({ id: created.id, status: 'processed', processing: { runCount: 1, pointCount: 3, reportCount: 1 } });

    // --- provenance walks the chain in both directions -----------------------------------------------------------
    const p201 = points.find((p) => p.name === '201');
    const runRec = stored.run(p201.source.processingRunId);
    const setRec = stored.set(String(runRec.source.fieldObservationSetId));
    const sessionRec = stored.session(String(setRec.source.fieldSessionId));
    expect(sessionRec._id).toBe(created.id);
    expect(setRec.source).toEqual({ kind: 'session', fieldSessionId: created.id });
    expect(report.sourceId).toBe(run.id);

    // --- single source of truth: no derived value is stored on the session or in the evidence ----------------------
    const sessionJson = JSON.stringify(sessionRec);
    const setJson = JSON.stringify(setRec);
    for (const derived of ['2050', '970', '1020', '499.7']) {
      expect(sessionJson).not.toContain(derived);
      expect(setJson).not.toContain(derived);
    }
    expect(sessionRec.setups[0].observations[0].distance).toBe('50'); // the raw entry, as typed
    expect(setRec.setups[0].observations[0].distance).toEqual({ value: 50, unit: 'm', explicit: false });

    // --- the evidence stayed immutable through all of it -------------------------------------------------------------
    expect((await sessions('patch', `/${created.id}`, { operator: 'x' })).status).toBe(409);
    expect((await sessions('delete', `/${created.id}`)).status).toBe(409);
    expect(stored.set(setId)).toEqual(setRec);

    // re-processing is allowed (a new run, same evidence) and the session simply counts it
    expect((await fp('', { fieldObservationSetId: setId })).status).toBe(201);
    expect((await sessions('get', `/${created.id}`)).body.data.processing.runCount).toBe(2);
  });
});

describe('SCENARIO 2: manual multi-station session -> TRAVERSE processing (raw vs adjusted) -> points -> report', () => {
  // Same geometry proven independently in fieldProcessing.traverse.e2e / reports.e2e: 100 due south of 101 (zeroed
  // backsight); leg 1 -> raw 102 = (1100, 2000); leg 2 -> raw 103 = (1100, 2050); the known endpoint control
  // 103 = (1100.06, 2050.03) is a deliberate small misclosure (fX = -0.06, fY = -0.03 -> 0.067 m).
  const entries = () => [
    {
      station: { point: '101', instrumentHeight: '1.5' }, orientation: { target: '100', direction: '0' },
      observations: [{ target: '102', hz: '200', vz: '100', distance: '100', prismHeight: '2' }],
    },
    {
      station: { point: '102', instrumentHeight: '1.5' }, orientation: { target: '101', direction: '0' },
      observations: [{ target: '103', hz: '300', vz: '100', distance: '50' }],
    },
  ];

  it('ordered setups -> traverse run -> raw and Bowditch-adjusted coordinates -> points -> report -> provenance', async () => {
    seedPoint('100', 900, 2000);
    seedPoint('101', 1000, 2000);
    seedPoint('103', 1100.06, 2050.03); // the known control endpoint (it already exists: its name must not be overwritten)

    const created = (await sessions('post', '/', { projectId: H.PROJECT, title: 'Полигонов ход 101 → 103', setups: entries() })).body.data;
    expect(created).toMatchObject({ setupCount: 2, observationCount: 2 });
    const confirmed = (await sessions('post', `/${created.id}/confirm`)).body.data;
    const setId = confirmed.observationSetId;

    // ordered setups survive into the confirmed evidence
    expect(confirmed.evidence.setups.map((s) => [s.index, s.station.point])).toEqual([[0, '101'], [1, '102']]);

    // only valid processing is offered, with the chain inferred from the data
    expect(confirmed.processingOptions.polar.available).toBe(true);
    expect(confirmed.processingOptions.traverse).toMatchObject({ available: true, suggestedStart: '101', chain: ['101', '102'], endCandidates: ['103'], closesOnStart: false });

    const runRes = await fp('/traverse', { fieldObservationSetId: setId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' });
    expect(runRes.status).toBe(201);
    const run = runRes.body.data;
    expect(run.source.fieldSessionId).toBe(created.id);
    const t = run.traverse;
    expect(t.status).toBe('READY');
    expect(t.closure.available).toBe(true);
    expect(t.closure.linearMisclosure).toBeCloseTo(0.0671, 3);
    expect(t.adjustment).toMatchObject({ method: 'bowditch', applied: true });
    // raw and adjusted are different, both persisted on the run, neither on the session
    expect(t.legs[0].rawX).toBeCloseTo(1100, 6);
    expect(t.legs[0].rawY).toBeCloseTo(2000, 6);
    expect(t.legs[0].adjustedX).toBeCloseTo(1100.04, 2);
    expect(t.legs[0].adjustedX).not.toBeCloseTo(t.legs[0].rawX, 3);
    expect(t.legs[1].rawX).toBeCloseTo(1100, 6);
    expect(t.legs[1].rawY).toBeCloseTo(2050, 6);
    // setups are consumed in order: leg i starts at setup i
    expect(t.legs.map((l) => [l.from, l.to, l.fromSetupIndex])).toEqual([['101', '102', 0], ['102', '103', 1]]);

    // points: the adjusted coordinates are what is saved; the existing control 103 is skipped, not overwritten
    const pointsRes = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pointsRes.status).toBe(200);
    expect(pointsRes.body.created.map((c) => c.name)).toEqual(['102']);
    expect(pointsRes.body.skipped).toEqual([expect.objectContaining({ target: '103', reason: 'NAME_CONFLICT' })]);
    const p102 = SurveyPoint.__all().find((p) => p.name === '102');
    expect(p102.x).toBeCloseTo(1100.04, 2);
    expect(p102.source).toMatchObject({ kind: 'field-processing', processingType: 'traverse', processingRunId: run.id, setup: 0, observation: 0 });
    expect(SurveyPoint.__all().filter((p) => p.name === '103')).toHaveLength(1);
    expect(SurveyPoint.__all().find((p) => p.name === '103').x).toBe(1100.06);

    const report = (await reports('post', '/', { reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id })).body.data;
    const text = (await pdfParse(Buffer.from((await reports('get', `/${report.id}/file`)).body))).text;
    for (const needle of ['1100.000', '1100.040', 'Bowditch', '101', '103']) expect(text).toContain(needle);

    const after = (await sessions('get', `/${created.id}`)).body.data;
    expect(after).toMatchObject({ status: 'processed', processing: { runCount: 1, pointCount: 1, reportCount: 1 } });
    expect(after.runs[0]).toMatchObject({ id: run.id, processingType: 'traverse', traverseType: 'KNOWN_ENDPOINT', status: 'READY', start: '101', end: '103' });

    // provenance, both directions: point -> run -> set -> session, and session -> set -> run -> report
    const setRec = stored.set(String(stored.run(p102.source.processingRunId).source.fieldObservationSetId));
    expect(setRec.source.fieldSessionId).toBe(created.id);
    expect(stored.session(created.id).fieldObservationSetId).toBe(setRec._id);

    // single source of truth
    for (const derived of ['1100', '2050', '0.067']) expect(JSON.stringify(stored.session(created.id))).not.toContain(derived);
  });

  it('a session whose stations do not form a chain is never offered traverse processing', async () => {
    const s = (await sessions('post', '/', { projectId: H.PROJECT, setups: [
      { station: { point: 'A' }, orientation: { target: 'X', direction: '0' }, observations: [{ target: 'P', hz: '10', distance: '10' }] },
      { station: { point: 'B' }, orientation: { target: 'Y', direction: '0' }, observations: [{ target: 'Q', hz: '10', distance: '10' }] },
    ] })).body.data;
    const d = (await sessions('post', `/${s.id}/confirm`)).body.data;
    expect(d.processingOptions.traverse).toMatchObject({ available: false, reason: 'NO_STATION_CHAIN' });
    expect(d.processingOptions.polar.available).toBe(true);
  });
});

describe('SCENARIO 3: a REAL OCR Field Notebook (upload -> OCR -> review -> confirm) inside a session', () => {
  const SPEC = {
    setups: [
      { station: '101', hi: '1.500', orientationTarget: '100', observations: [{ target: '102', hz: '200.0000g', vz: '100.0000g', distance: '100.000', prism: '2.000' }] },
      { station: '102', hi: '1.500', orientationTarget: '101', observations: [{ target: '103', hz: '300.0000g', vz: '100.0000g', distance: '50.000' }] },
    ],
  };

  it('Добави от снимка: the existing pipeline feeds the session; processing links back to the session AND the capture', async () => {
    const layout = layoutNotebook(SPEC);
    const image = await renderTableImage(layout);
    setProviderForTests('google-vision', H.fixtureProvider(layout));
    seedPoint('100', 900, 2000);
    seedPoint('101', 1000, 2000);
    seedPoint('103', 1100.06, 2050.03);

    // the session exists first; the photo is uploaded through the UNCHANGED capture API and attached
    const session = (await sessions('post', '/', { projectId: H.PROJECT, title: 'От снимка' })).body.data;
    const upload = await H.upload(app, image, { mode: 'field-notebook' });
    expect(upload.status).toBe(201);
    const jobId = upload.body.data.id;
    const attached = (await sessions('post', `/${session.id}/attach-capture`, { captureJobId: jobId })).body.data;
    expect(attached).toMatchObject({ source: 'capture', status: 'review', statusLabel: 'За проверка', capture: { mine: true, status: 'needs_review', jobId } });
    expect(attached.processingOptions).toBeNull(); // nothing is processable before confirmation

    // the review/confirm happens in the existing capture workflow, untouched
    const confirmRes = await H.authed(app, 'post', `/api/capture/jobs/${jobId}/confirm`);
    expect(confirmRes.status).toBe(200);
    const detail = (await sessions('get', `/${session.id}`)).body.data;
    expect(detail).toMatchObject({ status: 'confirmed', observationSetId: confirmRes.body.observationSetId, setupCount: 2 });
    expect(detail.processingOptions.traverse).toMatchObject({ available: true, chain: ['101', '102'] });

    const run = (await fp('/traverse', { fieldObservationSetId: detail.observationSetId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' })).body.data;
    expect(run.source).toMatchObject({ captureJobId: jobId, fieldSessionId: null }); // capture-origin evidence keeps its capture link
    const after = (await sessions('get', `/${session.id}`)).body.data; // ...and the session finds the run through the evidence
    expect(after).toMatchObject({ status: 'processed', processing: { runCount: 1 } });
    expect(after.runs[0].id).toBe(run.id);

    // the capture is attached to exactly this session; a second session cannot take it
    const other = (await sessions('post', '/', { projectId: H.PROJECT })).body.data;
    expect((await sessions('post', `/${other.id}/attach-capture`, { captureJobId: jobId })).status).toBe(409);
    // and the OCR evidence itself is exactly what the capture pipeline made (no copy in the session)
    expect(stored.session(session.id).setups).toEqual([]);
  });
});
