process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
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
const CaptureJob = require('../../models/CaptureJob');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldObservationSet = require('../../models/FieldObservationSet');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const { layoutNotebook, renderTableImage } = require('../../tests/support/notebookFixtures');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(60000);

const CLEAN_SPEC = { setups: [{
  station: 'T1', hi: '1.450', orientationTarget: 'T0', orientationDirection: '0.0000g',
  observations: [
    { target: 'A1', hz: '94.5000g', vz: '100.2500g', distance: '123.456', prism: '1.500' },
    { target: 'A2', hz: '188.7750g', vz: '99.5000g', distance: '87.320', prism: '1.500' },
  ],
}] };

let capture;
let storage;
beforeAll(async () => {
  const layout = layoutNotebook(CLEAN_SPEC);
  const image = await renderTableImage(layout);
  capture = { layout, image };
});
beforeEach(() => {
  CaptureJob.__reset();
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  storage = createMemoryStorage();
  setStorage(storage);
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const upload = (opts) => H.upload(app, capture.image, { mode: 'field-notebook', ...opts });
const get = (id, path = '') => H.authed(app, 'get', `/api/capture/jobs/${id}${path}`);
const patch = (id, body) => H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send(body);
const confirm = (id, userId) => H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`, userId);

describe('upload: mode=field-notebook', () => {
  it('201 with a needs_review job, a reconstructed notebook (not a table), NO SurveyPoint and NO FieldObservationSet', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    const job = res.body.data;
    expect(job).toMatchObject({ status: 'needs_review', mode: 'field-notebook' });
    expect(job.table).toBeNull();
    expect(job.notebook).not.toBeNull();
    expect(job.notebookVersion).toBeTruthy();
    expect(job.notebook.setups).toHaveLength(1);
    expect(job.notebook.setups[0].station.point).toMatchObject({ rawText: 'T1', reviewState: 'accepted' });
    expect(job.notebook.setups[0].observations).toHaveLength(2);
    expect(job.validationSummary).toMatchObject({ setups: 1, observations: 2, canConfirm: true });
    expect(SurveyPoint.__all()).toHaveLength(0);
    expect(FieldObservationSet.__all()).toHaveLength(0);
  });

  it('an unknown mode value is refused (400), no job is created', async () => {
    const res = await upload({ mode: 'nonsense-mode' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(CaptureJob.__all()).toHaveLength(0);
  });

  it('omitting mode still defaults to coordinate-table (unchanged V2.1/V2.2 behaviour)', async () => {
    const res = await H.upload(app, capture.image); // no mode field at all
    expect(res.status).toBe(201);
    expect(res.body.data.mode).toBe('coordinate-table');
  });

  it('a notebook cell carries the full V2.2 candidate shape (candidates, arbitration, symbolConfidence)', async () => {
    const job = (await upload()).body.data;
    const hzCell = job.notebook.setups[0].observations[0].cells[1];
    expect(hzCell.rawText).toBe('94.5000g');
    expect(hzCell.candidates[0]).toMatchObject({ source: 'primary', provider: 'fixture' });
    expect(hzCell.arbitration).toMatchObject({ outcome: 'ACCEPTED' });
    expect(hzCell.symbolConfidence).toEqual({ min: null, suspicious: [] });
  });

  it('reuses the same auth/Pro-gate/project-authorization as coordinate-table capture', async () => {
    H.configureAccess({ User, FieldBookProject, Workspace }, { plans: { [H.OWNER]: 'free' } });
    const res = await upload();
    expect(res.status).toBe(402);
    expect(CaptureJob.__all()).toHaveLength(0);
  });

  it('no notebook detected (no station line at all) -> 422 NO_NOTEBOOK_DETECTED', async () => {
    setProviderForTests('google-vision', { name: 'fixture', version: 'x', recognize: async (b, d) => ({ provider: { name: 'fixture', version: 'x' }, page: { index: 0, width: d.width, height: d.height, words: [] } }) });
    const res = await upload();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_NOTEBOOK_DETECTED');
  });
});

describe('review edits: station/orientation/observation corrections, column remap, row exclusion', () => {
  it('correcting an ambiguous Hz cell (userValue) resolves it, exactly like coordinate tables', async () => {
    const ambiguousSpec = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94.5000', vz: '100.2500g', distance: '10.000' }] }] };
    const layout = layoutNotebook(ambiguousSpec);
    setProviderForTests('google-vision', H.fixtureProvider(layout));
    const id = (await upload({ filename: 'amb.png' })).body.data.id;
    const before = (await get(id)).body.data;
    expect(before.validationSummary.canConfirm).toBe(false);

    const res = await patch(id, { edits: [{ setup: 0, section: 'observation', row: 0, field: 'hz', value: '94.5000g' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.validationSummary.canConfirm).toBe(true);
    const cell = res.body.data.notebook.setups[0].observations[0].cells[1];
    expect(cell).toMatchObject({ userValue: '94.5000g', reviewState: 'edited' });
  });

  it('a station-level correction (missing station id) unblocks confirmation', async () => {
    const words = capture.layout.words.filter((w) => w.text !== 'T1');
    setProviderForTests('google-vision', H.fixtureProvider({ ...capture.layout, words }));
    const id = (await upload({ filename: 'nostation.png' })).body.data.id;
    expect((await get(id)).body.data.validationSummary.canConfirm).toBe(false);
    const res = await patch(id, { edits: [{ setup: 0, section: 'station', field: 'point', value: 'T1' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.validationSummary.canConfirm).toBe(true);
  });

  it('remapping a column changes every row in that setup', async () => {
    const id = (await upload()).body.data.id;
    const before = (await get(id)).body.data;
    const targetColIndex = before.notebook.setups[0].observations[0].cols.find((c) => c.field === 'target').index;
    const res = await patch(id, { columns: [{ setup: 0, index: targetColIndex, field: null }] });
    expect(res.status).toBe(200);
    const cols0 = res.body.data.notebook.setups[0].observations[0].cols;
    const cols1 = res.body.data.notebook.setups[0].observations[1].cols;
    expect(cols0.find((c) => c.index === targetColIndex).field).toBeNull();
    expect(cols1.find((c) => c.index === targetColIndex).field).toBeNull();
  });

  it('excluding an observation row removes it from validation and blocking, reversibly', async () => {
    const id = (await upload()).body.data.id;
    const excluded = await patch(id, { rows: [{ setup: 0, index: 0, excluded: true }] });
    expect(excluded.status).toBe(200);
    expect(excluded.body.data.notebook.setups[0].observations[0].excluded).toBe(true);
    expect(excluded.body.data.validationSummary.observations).toBe(1);
    const restored = await patch(id, { rows: [{ setup: 0, index: 0, excluded: false }] });
    expect(restored.body.data.notebook.setups[0].observations[0].excluded).toBe(false);
    expect(restored.body.data.validationSummary.observations).toBe(2);
  });

  it('invalid edit addressing is refused (400), nothing changes', async () => {
    const id = (await upload()).body.data.id;
    for (const body of [
      { edits: [{ setup: 9, section: 'station', field: 'point', value: 'x' }] },
      { edits: [{ setup: 0, section: 'observation', row: 99, field: 'hz', value: 'x' }] },
      { edits: [{ setup: 0, section: 'nonsense', field: 'point', value: 'x' }] },
      { rows: [{ setup: 0, index: 99, excluded: true }] },
    ]) {
      const res = await patch(id, body);
      expect(res.status).toBe(400);
    }
    expect(CaptureJob.__all().find((j) => j._id === id).revision).toBe(0);
  });
});

describe('POST /confirm: creates a FieldObservationSet, never a SurveyPoint, never a calculation', () => {
  it('confirms a clean notebook: one FieldObservationSet with full provenance, job marked confirmed', async () => {
    const id = (await upload()).body.data.id;
    const res = await confirm(id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, alreadyConfirmed: false });
    expect(res.body.observationSetId).toBeTruthy();

    expect(SurveyPoint.__all()).toHaveLength(0); // NEVER a SurveyPoint
    const sets = FieldObservationSet.__all();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ projectId: H.PROJECT, user: H.OWNER });
    expect(String(sets[0].source.captureJobId)).toBe(id);
    expect(sets[0].setups[0].station.point).toBe('T1');
    expect(sets[0].setups[0].observations.map((o) => o.target)).toEqual(['A1', 'A2']);
    expect(sets[0].setups[0].observations[0].hz).toMatchObject({ value: 94.5, unit: 'gon' });
    expect(sets[0].setups[0].observations[0].cells.hz.bbox.w).toBeGreaterThan(0); // provenance back to source cells

    const stored = CaptureJob.__all().find((j) => j._id === id);
    expect(stored.status).toBe('confirmed');
    expect(String(stored.importedFieldObservationSetId)).toBe(String(sets[0]._id));
  });

  it('blocks on unresolved errors (422) with flattened field errors; nothing is created', async () => {
    const ambiguousSpec = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94.5000', vz: '100.2500g', distance: '10.000' }] }] };
    const layout = layoutNotebook(ambiguousSpec);
    setProviderForTests('google-vision', H.fixtureProvider(layout));
    const id = (await upload({ filename: 'amb.png' })).body.data.id;
    const res = await confirm(id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERRORS');
    expect(res.body.errors.some((e) => e.code === 'AMBIGUOUS_ANGLE_UNIT')).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(0);
  });

  it('is IDEMPOTENT: confirming twice returns the same observationSetId, no duplicate set', async () => {
    const id = (await upload()).body.data.id;
    const a = await confirm(id);
    const b = await confirm(id);
    expect(b.body).toMatchObject({ alreadyConfirmed: true, observationSetId: a.body.observationSetId });
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('concurrent confirms create exactly one FieldObservationSet', async () => {
    const id = (await upload()).body.data.id;
    const results = await Promise.all([confirm(id), confirm(id), confirm(id)]);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(FieldObservationSet.__all()).toHaveLength(1);
  });

  it('a confirmed notebook can no longer be edited (409)', async () => {
    const id = (await upload()).body.data.id;
    await confirm(id);
    expect((await patch(id, { rows: [{ setup: 0, index: 0, excluded: true }] })).status).toBe(409);
  });

  it('does not trust a client-provided body: the body is ignored', async () => {
    const id = (await upload()).body.data.id;
    const res = await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`).send({ setups: [{ station: { point: 'EVIL' } }] });
    expect(res.status).toBe(200);
    expect(FieldObservationSet.__all()[0].setups[0].station.point).toBe('T1');
  });
});

describe('Capture history shows the mode and works for field-notebook jobs too', () => {
  it('a notebook job appears in history with mode field-notebook and observation-based counts', async () => {
    const id = (await upload()).body.data.id;
    await confirm(id);
    const res = await H.authed(app, 'get', `/api/capture/jobs?projectId=${H.PROJECT}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id, mode: 'field-notebook', status: 'confirmed', rows: 2, importedCount: 2 });
  });
});
