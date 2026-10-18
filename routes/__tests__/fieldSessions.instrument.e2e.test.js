process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/ReportAsset', () => require('../../tests/support/fakeCaptureModels').ReportAsset);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/InstrumentImport', () => require('../../tests/support/fakeCaptureModels').InstrumentImport);
jest.mock('../../models/Calculation', () => require('../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

/**
 * INSTRUMENT IMPORT V1 (Leica GSI) - END-TO-END ACCEPTANCE through the REAL routes and the REAL deterministic engines:
 *
 *   Leica GSI file -> Field Session review -> confirm -> the EXISTING Polar / Traverse processing -> points -> report -> GAI provenance
 *
 * Expected coordinates are derived by hand from the geometry (the same geometry the manual-session acceptance proves), never
 * from running the parser: the import must produce exactly the evidence a typed notebook would.
 *   A. one station (101, backsight 102) -> polar 201 / 202 / 203
 *   B. multi-station 101 -> 102 -> 103 -> known-endpoint traverse with Bowditch
 *   C. an unknown optional word + a malformed record + valid observations -> explicit, visible behaviour
 */
const request = require('supertest');
const pdfParse = require('pdf-parse');
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const F = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');
const { gsi8, gsi16, line } = require('../../tests/support/gsiFixtures');
const { tracePointProvenance } = require('../../gai/tools/provenance');
const { buildContext, formatContextForPrompt } = require('../../gai/context/buildContext');
const { FORBIDDEN_PROVIDER_TERMS } = require('../../gai/terminology');

const { CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession, InstrumentImport, Calculation } = F;

jest.setTimeout(90000);

beforeEach(() => {
  for (const m of [CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, FieldBook, FieldSession, InstrumentImport, Calculation]) m.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === H.PROJECT ? { _id: H.PROJECT, user: H.OWNER, workspace: null, crs: 'EPSG:7800', name: 'Обект' } : null));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const sessions = (method, path, body) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`);
  return body === undefined ? r : r.send(body);
};
const upload = (id, text, name) => request(app).post(`/api/field-sessions/${id}/instrument-import`).set('Authorization', `Bearer ${H.token()}`).attach('file', Buffer.from(text, 'utf8'), name);
const fp = (path, body) => H.authed(app, 'post', `/api/field-processing${path}`).send(body);
const seedPoint = (name, x, y, h = 500) => SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name, x, y, h });
const leak = (text) => FORBIDDEN_PROVIDER_TERMS.filter((t) => new RegExp(`(^|[^A-Za-z_])${t.replace(/[-]/g, '\\-')}([^A-Za-z_]|$)`).test(text));

describe('E2E A: Leica GSI-16, one station -> POLAR -> points -> report -> provenance', () => {
  // 101 (X 1000, Y 2000, H 500), backsight 102 due east (bearing 100 gon) read as Hz 0 -> orientation constant 100 gon.
  // 201: Hz 0 -> 100 gon, 50 m -> (1000, 2050), t 1.5 -> H 500.000;  202: Hz 100 -> 200 gon, 30 m -> (970, 2000), t 1.8 -> 499.700;
  // 203: Hz 300 -> 0 gon, 20 m -> (1020, 2000), no reflector height -> X/Y only. V = 100 gon read as ZENITH (chosen at processing).
  const W = gsi16;
  const FILE = [
    line('GSI-16', [W.point('101', 1), W.metres('88', 1.5, 1)]),
    line('GSI-16', [W.point('102', 2), W.gon('21', 0), W.gon('22', 100), W.metres('31', 100)]),
    line('GSI-16', [W.point('201', 3), W.gon('21', 0), W.gon('22', 100), W.metres('31', 50), W.metres('87', 1.5, 1), W.text('41', 'K1')]),
    line('GSI-16', [W.point('202', 4), W.gon('21', 100), W.gon('22', 100), W.metres('31', 30), W.metres('87', 1.8, 1)]),
    line('GSI-16', [W.point('203', 5), W.gon('21', 300), W.gon('22', 100), W.metres('31', 20)]),
  ].join('\r\n');

  it('the whole chain, with exact coordinates', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);

    const s = (await sessions('post', '/', { projectId: H.PROJECT, date: '2026-10-19', instrument: 'Leica TS07' })).body.data;
    const up = await upload(s.id, FILE, 'ST101.GSI');
    expect(up.status).toBe(201);
    let v = up.body.data;
    expect(v.instrumentImport.format).toBe('GSI-16');
    expect(v.instrumentImport.review.setups[0].observations.map((o) => o.target)).toEqual(['102', '201', '202', '203']);
    // the user picks the backsight explicitly
    v = (await sessions('patch', `/${s.id}/instrument-import`, { decisions: { orientation: { s1: 2 } }, baseRevision: v.revision })).body.data;
    expect(v.evaluation.issues).toEqual([]); // 101 / 102 exist, orientation chosen: nothing to warn about
    const confirmed = (await sessions('post', `/${s.id}/confirm`)).body.data;
    expect(confirmed).toMatchObject({ status: 'confirmed', setupCount: 1, observationCount: 3, sourceLabel: 'Импорт от Leica GSI-16' });
    expect(confirmed.processingOptions.polar).toMatchObject({ available: true, observationCount: 3 });

    const run = (await fp('', { fieldObservationSetId: confirmed.observationSetId, verticalAngleConvention: 'zenith' })).body.data;
    expect(run.source).toEqual({ fieldObservationSetId: confirmed.observationSetId, captureJobId: null, fieldSessionId: s.id });
    const obsOf = (t) => run.setups[0].observations.find((o) => o.target === t);
    expect(obsOf('201')).toMatchObject({ status: 'READY' });
    expect(obsOf('201').x).toBeCloseTo(1000, 9);
    expect(obsOf('201').y).toBeCloseTo(2050, 9);
    expect(obsOf('201').h).toBeCloseTo(500, 9);
    expect(obsOf('202').x).toBeCloseTo(970, 9);
    expect(obsOf('202').y).toBeCloseTo(2000, 9);
    expect(obsOf('202').h).toBeCloseTo(499.7, 9);
    expect(obsOf('203')).toMatchObject({ status: 'XY_ONLY', heightReason: 'PRISM_HEIGHT_MISSING' });
    expect(obsOf('203').x).toBeCloseTo(1020, 9);
    expect(obsOf('203').y).toBeCloseTo(2000, 9);

    const pts = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pts.body.created.map((c) => c.name).sort()).toEqual(['201', '202', '203']);
    const p201 = SurveyPoint.__all().find((p) => p.name === '201');
    // the point code from the file (WI 41) is kept in the confirmed evidence, exactly as for a typed notebook row
    expect(confirmed.evidence.setups[0].observations.find((o) => o.target === '201').code).toBe('K1');

    const report = (await H.authed(app, 'post', '/api/reports').send({ reportType: 'POLAR_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id })).body.data;
    const text = (await pdfParse(Buffer.from((await H.authed(app, 'get', `/api/reports/${report.id}/file`)).body))).text;
    for (const needle of ['101', '201', '2050.000', '970.000', '499.700']) expect(text).toContain(needle);

    // provenance: Точка 201 -> обработка -> потвърдени наблюдения -> Теренна сесия -> Импорт от Leica GSI-16
    const prov = await tracePointProvenance(H.PROJECT, p201._id);
    expect(prov.chain.map((x) => x.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession', 'instrumentImport']);
    expect(prov.chain[0].label).toBe('Точка 201');
    expect(prov.chain[3].label).toBe('Теренна сесия · 19.10.2026');
    expect(prov.chain[4]).toMatchObject({ label: 'Импорт от Leica GSI-16', fileName: 'ST101.GSI', format: 'GSI-16', observationCount: 3, warningCount: 0 });
    expect(prov.fieldMeasurement).toMatchObject({ station: '101', target: '201', fileLine: 3, hz: { value: 0, unit: 'gon' }, slopeDistance: { value: 50, unit: 'm' } });

    // GAI explains it in product language, read-only, without ids or internal names
    const ctx = await buildContext({ projectId: H.PROJECT, userId: H.OWNER, question: 'Откъде идва точка 201?' });
    const rendered = formatContextForPrompt(ctx);
    const steps = JSON.parse(rendered)['Запитани точки'][0]['Произход'];
    expect(steps.map((x) => x['Стъпка'])).toEqual(['Създадена от обработка', 'Входни данни на обработката', 'Теренна сесия', 'Първоизточник']);
    expect(steps[3]).toMatchObject({ 'Източник': 'Импорт от Leica GSI-16', 'Описание': 'Тези наблюдения са импортирани от Leica GSI-16.', 'Потвърдени наблюдения от файла': 3, 'Предупреждения при импорта': 0 });
    expect(rendered).toContain('ST101.GSI');
    expect(rendered).toContain('Ред във файла на инструмента');
    expect(/\b[0-9a-f]{24}\b/i.test(rendered)).toBe(false);
    expect(leak(rendered)).toEqual([]);
    expect(ctx.evidence.at(-1)).toMatchObject({ kind: 'instrumentImport', label: 'Импорт от Leica GSI-16' });

    // single source of truth: no computed coordinate is stored in the import, the session or the evidence
    for (const json of [JSON.stringify(InstrumentImport.__all()), JSON.stringify(FieldSession.__all()), JSON.stringify(FieldObservationSet.__all())]) {
      for (const derived of ['2050', '970', '1020', '499.7']) expect(json).not.toContain(derived);
    }
  });
});

describe('E2E B: Leica GSI-8, multi-station 101 -> 102 -> 103 -> TRAVERSE (Bowditch) -> points -> report', () => {
  // The geometry of the manual traverse acceptance: 100 due south of 101 (backsight read as 0); leg 1 Hz 200, 100 m -> raw 102 =
  // (1100, 2000); at 102 backsight 101 read 0, Hz 300, 50 m -> raw 103 = (1100, 2050); known control 103 = (1100.06, 2050.03).
  const W = gsi8;
  const FILE = [
    line('GSI-8', [W.point('101', 1), W.metres('88', 1.5, 1)]),
    line('GSI-8', [W.point('100', 2), W.gon('21', 0), W.gon('22', 100)]),
    line('GSI-8', [W.point('102', 3), W.gon('21', 200), W.gon('22', 100), W.metres('31', 100), W.metres('87', 2, 1)]),
    line('GSI-8', [W.point('102', 4), W.metres('88', 1.5, 1)]),
    line('GSI-8', [W.point('101', 5), W.gon('21', 0), W.gon('22', 100)]),
    line('GSI-8', [W.point('103', 6), W.gon('21', 300), W.gon('22', 100), W.metres('31', 50)]),
  ].join('\n');

  it('station records in file order become ordered setups; the existing traverse engine closes and adjusts', async () => {
    seedPoint('100', 900, 2000);
    seedPoint('101', 1000, 2000);
    seedPoint('103', 1100.06, 2050.03);

    const s = (await sessions('post', '/', { projectId: H.PROJECT, title: 'Ход 101 → 103' })).body.data;
    let v = (await upload(s.id, FILE, 'traverse.gsi')).body.data;
    expect(v.instrumentImport.review.setups.map((x) => [x.key, x.station.point])).toEqual([['s1', '101'], ['s4', '102']]);
    expect(v.evaluation.summary.canConfirm).toBe(false); // the angle-only backsights have no distance until chosen as orientation
    v = (await sessions('patch', `/${s.id}/instrument-import`, { decisions: { orientation: { s1: 2, s4: 5 } }, baseRevision: v.revision })).body.data;
    expect(v.evaluation.summary.canConfirm).toBe(true);
    const confirmed = (await sessions('post', `/${s.id}/confirm`)).body.data;
    expect(confirmed.evidence.setups.map((x) => [x.index, x.station.point, x.orientation.target])).toEqual([[0, '101', '100'], [1, '102', '101']]);
    expect(confirmed.processingOptions.traverse).toMatchObject({ available: true, suggestedStart: '101', chain: ['101', '102'], endCandidates: ['103'] });

    const run = (await fp('/traverse', { fieldObservationSetId: confirmed.observationSetId, traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103', verticalAngleConvention: 'zenith' })).body.data;
    const t = run.traverse;
    expect(t.status).toBe('READY');
    expect(t.closure.linearMisclosure).toBeCloseTo(0.0671, 3);
    expect(t.adjustment).toMatchObject({ method: 'bowditch', applied: true });
    expect(t.legs[0].rawX).toBeCloseTo(1100, 9);
    expect(t.legs[0].rawY).toBeCloseTo(2000, 9);
    expect(t.legs[1].rawX).toBeCloseTo(1100, 9);
    expect(t.legs[1].rawY).toBeCloseTo(2050, 9);
    expect(t.legs[0].adjustedX).toBeCloseTo(1100.04, 2);

    const pts = await H.authed(app, 'post', `/api/field-processing/${run.id}/create-points`);
    expect(pts.body.created.map((c) => c.name)).toEqual(['102']);
    const report = (await H.authed(app, 'post', '/api/reports').send({ reportType: 'TRAVERSE_PROCESSING_REPORT', projectId: H.PROJECT, sourceId: run.id })).body.data;
    const text = (await pdfParse(Buffer.from((await H.authed(app, 'get', `/api/reports/${report.id}/file`)).body))).text;
    for (const needle of ['1100.000', '1100.040', 'Bowditch', '101', '103']) expect(text).toContain(needle);

    const p102 = SurveyPoint.__all().find((p) => p.name === '102');
    const prov = await tracePointProvenance(H.PROJECT, p102._id);
    expect(prov.chain.map((x) => x.label)).toEqual(['Точка 102', 'Полигонов ход 101 → 103', expect.stringMatching(/^Потвърдени теренни наблюдения/), expect.stringMatching(/^Теренна сесия/), 'Импорт от Leica GSI-8']);
    expect((await sessions('get', `/${s.id}`)).body.data).toMatchObject({ status: 'processed', processing: { runCount: 1, pointCount: 1, reportCount: 1 } });
  });
});

describe('E2E C: unknown optional word + malformed record + valid observations -> explicit behaviour', () => {
  const FILE = [
    '110001+00000101 88..10+00001500 ',
    '110002+00000102 21.322+00000000 22.322+10000000 31..00+00100000 ',
    '110003+00000201 21.322+00000000 22.322+10000000 31..00+00050000 99..00+00004711 ', // unknown word 99: kept, warned, not used
    '110004+00000202 21.322+1000000X 22.322+10000000 31..00+00030000 ', // malformed Hz: an error record
    'THIS IS NOT A GSI LINE',
    '110005+00000203 21.322+30000000 22.322+10000000 31..00+00020000 ',
  ].join('\n');

  it('a file where too many lines are not GSI (here 1 of 6) is refused as a whole - never half-read', async () => {
    const s = (await sessions('post', '/', { projectId: H.PROJECT })).body.data;
    const up = await upload(s.id, FILE, 'mixed.gsi');
    expect([up.status, up.body.code]).toEqual([422, 'UNSUPPORTED_FORMAT']);
    expect(InstrumentImport.__all()).toEqual([]);
  });

  it('with one bad line among many, the file is reviewed record by record and nothing silently disappears', async () => {
    seedPoint('101', 1000, 2000);
    seedPoint('102', 1000, 2100);
    const s = (await sessions('post', '/', { projectId: H.PROJECT })).body.data;
    const more = Array.from({ length: 6 }, (_x, i) => line('GSI-8', [gsi8.point(`30${i}`, 6 + i), gsi8.gon('21', 10 * i), gsi8.gon('22', 100), gsi8.metres('31', 10)]));
    const longer = [FILE, ...more].join('\n');
    const v = (await upload(s.id, longer, 'mixed.gsi')).body.data;
    const recs = v.instrumentImport.review.records;
    expect(recs).toHaveLength(12);
    expect(recs.map((r) => r.status).slice(0, 6)).toEqual(['ok', 'ok', 'warning', 'error', 'error', 'ok']);
    expect(recs[4]).toMatchObject({ kind: 'invalid', raw: 'THIS IS NOT A GSI LINE', words: [] });
    expect(recs[2].words.find((w) => w.code === '99')).toMatchObject({ label: 'Неизвестно поле Leica', raw: '99..00+00004711', category: 'unknown' });
    const codes = v.evaluation.issues.map((i) => [i.code, i.record]);
    expect(codes).toEqual(expect.arrayContaining([['UNKNOWN_WORD', 3], ['MALFORMED_NUMBER', 4], ['INVALID_RECORD', 5]]));
    expect(v.evaluation.summary.canConfirm).toBe(false);
    expect((await sessions('post', `/${s.id}/confirm`)).body.code).toBe('VALIDATION_ERRORS');

    const ok = (await sessions('patch', `/${s.id}/instrument-import`, { decisions: { orientation: { s1: 2 }, excluded: [4, 5] }, baseRevision: v.revision })).body.data;
    expect(ok.evaluation.summary).toMatchObject({ errors: 0, canConfirm: true });
    expect(ok.instrumentImport.review.records.filter((r) => r.status === 'excluded').map((r) => r.seq)).toEqual([4, 5]);
    const confirmed = (await sessions('post', `/${s.id}/confirm`)).body.data;
    const targets = confirmed.evidence.setups[0].observations.map((o) => o.target);
    expect(targets).toEqual(['201', '203', '300', '301', '302', '303', '304', '305']);
    expect(targets).not.toContain('202');
    const imp = InstrumentImport.__all()[0];
    expect(imp.confirmed.summary).toMatchObject({ excluded: 2, unknownWords: 1 });
    expect(imp.lines.map((l) => l.text)).toContain('THIS IS NOT A GSI LINE'); // the raw file is kept as uploaded
  });
});
