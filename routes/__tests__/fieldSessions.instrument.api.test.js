process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/InstrumentImport', () => require('../../tests/support/fakeCaptureModels').InstrumentImport);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const F = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');
const GSI = require('../../tests/support/gsiFixtures');

const { CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint, InstrumentImport } = F;

jest.setTimeout(20000);

beforeEach(() => {
  for (const m of [CaptureJob, FieldObservationSet, FieldProcessingRun, Report, FieldBook, FieldSession, SurveyPoint, InstrumentImport]) m.__reset();
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const api = (method, path, body, userId = H.OWNER) => {
  const r = H.authed(app, method, `/api/field-sessions${path}`, userId);
  return body === undefined ? r : r.send(body);
};
const create = async (body = {}, userId = H.OWNER) => (await api('post', '/', { projectId: H.PROJECT, ...body }, userId)).body.data;
const upload = (id, text, { name = 'station.gsi', userId = H.OWNER, baseRevision } = {}) => {
  let r = request(app).post(`/api/field-sessions/${id}/instrument-import`).set('Authorization', `Bearer ${H.token(userId)}`);
  if (baseRevision !== undefined) r = r.field('baseRevision', String(baseRevision));
  return r.attach('file', Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), name);
};
const decide = (id, decisions, baseRevision, userId = H.OWNER) => api('patch', `/${id}/instrument-import`, { decisions, baseRevision }, userId);
const m = (value) => ({ value, unit: 'm', explicit: true });
const gon = (value) => ({ value, unit: 'gon', components: null });

describe('upload and review', () => {
  it('a Leica GSI-8 file becomes the session source, with the review the confirm will re-run', async () => {
    const s = await create();
    const res = await upload(s.id, GSI.A_GSI8_SINGLE);
    expect(res.status).toBe(201);
    const v = res.body.data;
    expect(v).toMatchObject({ source: 'instrument', sourceLabel: 'Импорт от Leica GSI-8', setupCount: 1, observationCount: 2, issues: { errors: 0, warnings: 2 } });
    expect(v.instrumentImport).toMatchObject({ available: true, vendorLabel: 'Leica', format: 'GSI-8', fileName: 'station.gsi', duplicate: false });
    expect(v.instrumentImport.review.summary).toMatchObject({ records: 3, setups: 1, observations: 2, canConfirm: true });
    expect(v.instrumentImport.review.records.map((r) => r.raw)).toEqual(GSI.A_GSI8_SINGLE.split('\r\n'));
    expect(v.evaluation.issues.map((i) => i.code)).toEqual(['MISSING_ORIENTATION', 'STATION_NOT_FOUND']);
    expect(v.revision).toBe(s.revision + 1);
    // the audit record: who, where, which file, which parser
    const [imp] = InstrumentImport.__all();
    expect(imp).toMatchObject({ user: H.OWNER, projectId: H.PROJECT, fieldSessionId: s.id, vendor: 'leica', format: 'GSI-8', originalName: 'station.gsi', status: 'draft', parserVersion: 'leica-gsi-parser/v1', normalizerVersion: 'leica-gsi-normalize/v1' });
    expect(imp.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(imp.bytes).toBe(Buffer.byteLength(GSI.A_GSI8_SINGLE));
    expect(imp.upload.summary.records).toBe(3);
    // nothing internal reaches the client
    expect(JSON.stringify(v)).not.toMatch(/instrumentImportId|InstrumentImport|sha256|FieldObservationSet|lineage/);
    expect(JSON.stringify(v)).not.toContain(imp._id);
  });

  it('file-level refusals store nothing and answer in Bulgarian with a structured code', async () => {
    const s = await create();
    const cases = [
      [GSI.NOT_GSI, 422, 'UNSUPPORTED_FORMAT', 'Форматът не е разпознат.'],
      [GSI.L_MIXED_MARKERS, 422, 'AMBIGUOUS_GSI_FORMAT'],
      [GSI.L_SIXTEEN_WITHOUT_MARKER, 422, 'AMBIGUOUS_GSI_FORMAT'],
      [Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x14, 0x00]), 422, 'BINARY_FILE'],
      [Buffer.from([0xff, 0xfe, 0x31, 0x00, 0x31, 0x00]), 422, 'UNSUPPORTED_ENCODING'],
      [Buffer.from('110001+00000101 ä', 'latin1'), 422, 'UNSUPPORTED_ENCODING'],
      [Buffer.alloc(600 * 1024, 0x31), 413, 'FILE_TOO_LARGE'],
    ];
    for (const [body, status, code, message] of cases) {
      const res = await upload(s.id, body);
      expect([res.status, res.body.code]).toEqual([status, code]);
      if (message) expect(res.body.message).toBe(message);
      expect(res.body.message).toMatch(/[А-Яа-я]/);
      expect(JSON.stringify(res.body)).not.toMatch(/Error|stack|at \w+ \(/);
    }
    const none = await request(app).post(`/api/field-sessions/${s.id}/instrument-import`).set('Authorization', `Bearer ${H.token()}`).field('x', '1');
    expect([none.status, none.body.code]).toEqual([400, 'NO_FILE']);
    expect(InstrumentImport.__all()).toEqual([]);
    expect((await api('get', `/${s.id}`)).body.data.source).toBe('none');
  });

  it('the display file name is sanitized (no path, no markup)', async () => {
    const s = await create();
    const res = await upload(s.id, GSI.A_GSI8_SINGLE, { name: '..\\..\\<img src=x onerror=alert(1)>.gsi' });
    expect(res.status).toBe(201);
    expect(res.body.data.instrumentImport.fileName).not.toMatch(/[<>\\/]/);
  });

  it('GSI-16 with coordinates: Leica E/N shown as GeoSolver Y/X', async () => {
    const s = await create();
    const v = (await upload(s.id, GSI.B_GSI16_SINGLE)).body.data;
    expect(v.sourceLabel).toBe('Импорт от Leica GSI-16');
    expect(v.instrumentImport.review.setups[0].stationCoordinates).toEqual({ x: 4700000, y: 500000, h: 125 });
  });

  it('the list shows the instrument session with its counts', async () => {
    const s = await create();
    await upload(s.id, GSI.C_MULTI_STATION);
    const list = (await api('get', `/?projectId=${H.PROJECT}`)).body.data;
    expect(list[0]).toMatchObject({ id: s.id, source: 'instrument', sourceLabel: 'Импорт от Leica GSI-8', setupCount: 2, issues: { errors: 1 } });
  });
});

describe('decisions', () => {
  it('orientation choice, exclusion and an explicit station are revision-checked writes', async () => {
    const s = await create();
    let v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    const res = await decide(s.id, { orientation: { s1: 2 } }, v.revision);
    expect(res.status).toBe(200);
    v = res.body.data;
    expect(v.instrumentImport.decisions).toEqual({ excluded: [], orientation: { s1: 2 }, orphanStation: null });
    expect(v.instrumentImport.review.setups[0].orientation).toEqual({ target: '102', direction: gon(0) });
    expect(v.evaluation.issues.map((i) => i.code)).not.toContain('MISSING_ORIENTATION');
    // a stale revision never overwrites
    expect((await decide(s.id, { orientation: {} }, v.revision - 1)).body.code).toBe('REVISION_CONFLICT');
  });

  it('malformed decisions are INVALID_DECISION (structure); mismatching ones are shown as review errors', async () => {
    const s = await create();
    const v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    for (const bad of [null, [], { excluded: 'x' }, { excluded: [0] }, { excluded: ['2'] }, { orientation: { $where: 1 } }, { orientation: { s1: 'x' } }, { orphanStation: { point: 5 } }, { orphanStation: { point: 'x'.repeat(61) } }]) {
      const res = await decide(s.id, bad, v.revision);
      expect([res.status, res.body.code]).toEqual([400, 'INVALID_DECISION']);
    }
    const res = await decide(s.id, { orientation: { s1: 99 } }, v.revision);
    expect(res.status).toBe(200);
    expect(res.body.data.evaluation.issues.map((i) => i.code)).toContain('INVALID_DECISION');
    expect(res.body.data.evaluation.summary.canConfirm).toBe(false);
  });
});

describe('confirm -> the same evidence every other session produces', () => {
  it('creates ONE session-origin observation set from the STORED file + decisions, idempotently', async () => {
    const s = await create();
    let v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    v = (await decide(s.id, { orientation: { s1: 2 } }, v.revision)).body.data;
    const res = await api('post', `/${s.id}/confirm`, { setups: [{ station: { point: 'HACK' } }] }); // the body is ignored
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'confirmed', confirmed: true, observationCount: 1, sourceLabel: 'Импорт от Leica GSI-8' });

    const [fos] = FieldObservationSet.__all();
    expect(fos.source).toEqual({ kind: 'session', fieldSessionId: s.id });
    expect(fos.instrumentImport).toMatchObject({ vendor: 'leica', format: 'GSI-8', fileName: 'station.gsi', parserVersion: 'leica-gsi-parser/v1' });
    expect(fos.setups).toEqual([{
      index: 0,
      station: { point: '101', instrumentHeight: m(1.55), notes: '' },
      orientation: { target: '102', direction: gon(0) },
      observations: [{
        row: 0, target: '201', hz: gon(50.1234), vz: gon(98.7654), distance: m(85.432), horizontalDistance: null, prismHeight: m(1.6),
        code: '', notes: '', cells: {}, source: { kind: 'instrument', record: 3, line: 3 },
      }],
    }]);
    expect(res.body.data.evidence.setups[0].observations[0]).toMatchObject({ target: '201', fileLine: 3 });
    expect(InstrumentImport.__all()[0]).toMatchObject({ status: 'confirmed', fieldObservationSetId: fos._id, confirmed: { decisions: { orientation: { s1: 2 } } } });

    const again = await api('post', `/${s.id}/confirm`, {});
    expect(again.body.alreadyConfirmed).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
    // frozen afterwards
    expect((await decide(s.id, { orientation: {} })).body.code).toBe('SESSION_CONFIRMED');
    expect((await upload(s.id, GSI.E_HORIZONTAL)).body.code).toBe('SESSION_CONFIRMED');
    expect((await api('delete', `/${s.id}/instrument-import`)).body.code).toBe('SESSION_CONFIRMED');
  });

  it('errors block the confirm (and release the claim): the malformed record must be excluded explicitly', async () => {
    const s = await create();
    let v = (await upload(s.id, GSI.J_MALFORMED_WORD)).body.data;
    const res = await api('post', `/${s.id}/confirm`, {});
    expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_ERRORS']);
    expect(res.body.errors.map((e) => e.code)).toEqual(['MALFORMED_NUMBER']);
    expect(FieldObservationSet.__all()).toEqual([]);
    expect(FieldSession.__all()[0].confirmClaimedAt).toBeNull();

    v = (await decide(s.id, { excluded: [2] }, v.revision)).body.data;
    expect(v.instrumentImport.review.records.map((r) => r.status)).toEqual(['ok', 'excluded', 'ok']);
    expect((await api('post', `/${s.id}/confirm`, {})).status).toBe(200);
    expect(FieldObservationSet.__all()[0].setups[0].observations.map((o) => o.target)).toEqual(['202']);
  });

  it('concurrent confirms create exactly one set', async () => {
    const s = await create();
    await upload(s.id, GSI.A_GSI8_SINGLE);
    const results = await Promise.all([1, 2, 3, 4].map(() => api('post', `/${s.id}/confirm`, {})));
    expect(results.every((r) => r.status === 200 || r.body.code === 'CONFIRM_IN_PROGRESS')).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('submit moves an instrument session to review like a manual one', async () => {
    const s = await create();
    await upload(s.id, GSI.A_GSI8_SINGLE);
    const res = await api('post', `/${s.id}/submit`, {});
    expect(res.body.data).toMatchObject({ status: 'review' });
  });
});

describe('source rules, detach, duplicates, revisions', () => {
  it('one source per session: no file over entries, pages or another file; no entries or pages over a file', async () => {
    const manual = await create({ setups: [{ station: { point: '101' }, observations: [{ target: '201', hz: '1', distance: '5' }] }] });
    expect((await upload(manual.id, GSI.A_GSI8_SINGLE)).body.code).toBe('SOURCE_CONFLICT');

    const s = await create();
    const v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    expect((await upload(s.id, GSI.E_HORIZONTAL)).body.code).toBe('SOURCE_CONFLICT');
    expect((await api('patch', `/${s.id}`, { setups: [], baseRevision: v.revision })).body.code).toBe('SOURCE_CONFLICT');
    expect((await api('post', `/${s.id}/pages`, { captureJobId: '507f1f77bcf86cd799439abc' })).body.code).toBe('SOURCE_CONFLICT');
    expect((await api('post', `/${s.id}/attach-capture`, { captureJobId: '507f1f77bcf86cd799439abc' })).body.code).toBe('SOURCE_CONFLICT');
    // metadata stays editable
    expect((await api('patch', `/${s.id}`, { title: 'Станция 101', baseRevision: v.revision })).body.data.title).toBe('Станция 101');
  });

  it('an empty manual draft can take a file', async () => {
    const s = await create({ setups: [] });
    expect((await upload(s.id, GSI.A_GSI8_SINGLE)).status).toBe(201);
  });

  it('detach before confirmation: the session is empty again, the import is kept as detached and is not a duplicate', async () => {
    const s = await create();
    await upload(s.id, GSI.A_GSI8_SINGLE);
    const res = await api('delete', `/${s.id}/instrument-import`);
    expect(res.body.data).toMatchObject({ source: 'none', instrumentImport: null });
    expect(InstrumentImport.__all()[0].status).toBe('detached');
    const again = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    expect(again.instrumentImport.duplicate).toBe(false);
  });

  it('the same file in another session of the project is a WARNING (never a silent second import, never a block)', async () => {
    const a = await create();
    await upload(a.id, GSI.A_GSI8_SINGLE);
    const b = await create();
    const v = (await upload(b.id, GSI.A_GSI8_SINGLE)).body.data;
    expect(v.instrumentImport.duplicate).toBe(true);
    expect(v.evaluation.issues[0]).toMatchObject({ code: 'DUPLICATE_FILE', severity: 'warning', message: 'Същият файл вече е импортиран в този проект.' });
    expect(v.evaluation.summary.canConfirm).toBe(true);
    // a different project is not a duplicate
    const other = await create({ projectId: H.OTHER_PROJECT }, H.OTHER);
    expect((await upload(other.id, GSI.A_GSI8_SINGLE, { userId: H.OTHER })).body.data.instrumentImport.duplicate).toBe(false);
  });

  it('concurrent uploads to one session: exactly one wins, the loser leaves no import behind', async () => {
    const s = await create();
    const results = await Promise.all([upload(s.id, GSI.A_GSI8_SINGLE), upload(s.id, GSI.E_HORIZONTAL), upload(s.id, GSI.C_MULTI_STATION)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => ['REVISION_CONFLICT', 'SOURCE_CONFLICT'].includes(r.body.code))).toBe(true);
    const imports = InstrumentImport.__all();
    expect(imports).toHaveLength(1);
    expect(String(FieldSession.__all()[0].source.instrumentImportId)).toBe(imports[0]._id);
  });

  it('a revision re-reads a copy of the same file with the confirmed decisions; the original stays untouched', async () => {
    const s = await create({ title: 'Станция 101' });
    let v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
    v = (await decide(s.id, { orientation: { s1: 2 } }, v.revision)).body.data;
    await api('post', `/${s.id}/confirm`, {});
    const res = await api('post', `/${s.id}/revise`, {});
    expect(res.status).toBe(201);
    const r = res.body.data;
    expect(r).toMatchObject({ source: 'instrument', status: 'draft', revisionOf: s.id, title: 'Станция 101 (ревизия)' });
    expect(r.instrumentImport).toMatchObject({ duplicate: false, decisions: { orientation: { s1: 2 } } });
    expect(r.instrumentImport.review.setups[0].observations[0].hz).toEqual(gon(50.1234)); // full resolution, not retyped
    const imports = InstrumentImport.__all();
    expect(imports).toHaveLength(2);
    expect(imports[1]).toMatchObject({ derivedFrom: imports[0]._id, lineage: imports[0]._id, fieldSessionId: r.id, status: 'draft' });
    expect(imports[0].status).toBe('confirmed');
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });
});

describe('access', () => {
  it('another user cannot see, upload to, decide on or confirm a session (404, nothing revealed)', async () => {
    const s = await create();
    await upload(s.id, GSI.A_GSI8_SINGLE);
    expect((await upload(s.id, GSI.A_GSI8_SINGLE, { userId: H.OTHER })).status).toBe(404);
    expect((await decide(s.id, { orientation: {} }, undefined, H.OTHER)).status).toBe(404);
    expect((await api('delete', `/${s.id}/instrument-import`, undefined, H.OTHER)).status).toBe(404);
    expect((await api('post', `/${s.id}/confirm`, {}, H.OTHER)).status).toBe(404);
    expect((await api('get', `/${s.id}`, undefined, H.OTHER)).status).toBe(404);
  });

  it('a viewer of a shared project cannot import', async () => {
    const s = await create({ projectId: H.SHARED_PROJECT }, H.OTHER);
    const res = await upload(s.id, GSI.A_GSI8_SINGLE);
    expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
    expect(InstrumentImport.__all()).toEqual([]);
  });

  it('an import is only ever read through ITS session in ITS project (a re-pointed reference is not followed)', async () => {
    const a = await create();
    await upload(a.id, GSI.A_GSI8_SINGLE);
    const other = await create({ projectId: H.OTHER_PROJECT }, H.OTHER);
    await upload(other.id, GSI.B_GSI16_SINGLE, { userId: H.OTHER });
    const foreign = InstrumentImport.__all().find((i) => i.projectId === H.OTHER_PROJECT);
    FieldSession.__mutate(a.id, (x) => { x.source.instrumentImportId = foreign._id; });
    const v = (await api('get', `/${a.id}`)).body.data;
    expect(v.instrumentImport).toMatchObject({ available: false, format: null, review: null });
    expect(JSON.stringify(v)).not.toContain('GSI-16');
    const res = await api('post', `/${a.id}/confirm`, {});
    expect([res.status, res.body.code]).toEqual([404, 'INSTRUMENT_IMPORT_MISSING']);
    expect(FieldObservationSet.__all()).toEqual([]);
  });
});
