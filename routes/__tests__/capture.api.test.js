process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const request = require('supertest');
const sharp = require('sharp');
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const CaptureJob = require('../../models/CaptureJob');
const SurveyPoint = require('../../models/SurveyPoint');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(60000);

const HEADERS = ['Точка', 'Код', 'X', 'Y', 'H', 'Бележка'];
const ROWS = [
  ['P1', 'CP', '4700000.25', '500000.50', '100.125', ''],
  ['P2', 'CP', '4700100.50', '500050.75', '101.50', 'ъгъл'],
  ['P3', 'DT', '4700200.00', '500100.25', '', ''],
];

let capture;
let storage;
beforeAll(async () => { capture = await H.makeCapture(HEADERS, ROWS); });
beforeEach(() => {
  CaptureJob.__reset();
  SurveyPoint.__reset();
  storage = createMemoryStorage();
  setStorage(storage);
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

const upload = (opts) => H.upload(app, capture.image, opts);
const get = (id, path = '') => H.authed(app, 'get', `/api/capture/jobs/${id}${path}`);

describe('authentication, Pro gate and project authorization', () => {
  it('no token -> 401 on every route', async () => {
    const id = '507f1f77bcf86cd799439999';
    expect((await request(app).post('/api/capture/jobs')).status).toBe(401);
    for (const [m, p] of [['get', `/jobs/${id}`], ['get', `/jobs/${id}/image/review`], ['patch', `/jobs/${id}/cells`], ['post', `/jobs/${id}/confirm`]]) {
      expect((await request(app)[m](`/api/capture${p}`)).status).toBe(401);
    }
  });

  it('Pro gate: a free user gets 402 and NO job is created (all routes)', async () => {
    H.configureAccess({ User, FieldBookProject, Workspace }, { plans: { [H.OWNER]: 'free' } });
    const res = await upload();
    expect(res.status).toBe(402);
    expect(CaptureJob.__all()).toHaveLength(0);
    expect((await get('507f1f77bcf86cd799439999')).status).toBe(402);
  });

  it('project authorization: no project -> 400, unknown/foreign project -> 403, and no job is created', async () => {
    expect((await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).attach('image', capture.image, 'a.png')).status).toBe(400);
    expect((await upload({ projectId: H.OTHER_PROJECT })).status).toBe(403);
    expect((await upload({ projectId: '507f1f77bcf86cd799439fff' })).status).toBe(403);
    expect((await upload({ projectId: 'not-an-id' })).status).toBe(400);
    expect(CaptureJob.__all()).toHaveLength(0);
  });

  it('a workspace VIEWER cannot create captures (editor or above is required)', async () => {
    const res = await upload({ projectId: H.SHARED_PROJECT });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROJECT_FORBIDDEN');
  });

  it('another user cannot read, edit, confirm or view the image of my job (404, existence not revealed)', async () => {
    const created = await upload();
    const id = created.body.data.id;
    const other = (m, p) => H.authed(app, m, `/api/capture/jobs/${id}${p}`, H.OTHER);
    expect((await other('get', '')).status).toBe(404);
    expect((await other('get', '/image/review')).status).toBe(404);
    expect((await other('patch', '/cells').send({ edits: [{ row: 0, col: 0, value: 'x' }] })).status).toBe(404);
    expect((await other('post', '/confirm')).status).toBe(404);
  });

  it('access is re-checked on every call: a user who lost the project cannot keep using an old job', async () => {
    const id = (await upload()).body.data.id;
    FieldBookProject.findById.mockResolvedValue({ _id: H.PROJECT, user: H.OTHER, workspace: null, crs: 'EPSG:7800' });
    expect((await get(id)).status).toBe(403);
    expect((await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`)).status).toBe(403);
  });
});

describe('upload validation', () => {
  it('malformed file -> 400 with a sanitized message; no job is persisted', async () => {
    const res = await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', Buffer.from('this is not an image'), 'x.png');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'INVALID_IMAGE', message: 'Файлът не е валидно изображение.' });
    expect(CaptureJob.__all()).toHaveLength(0);
  });

  it('unsupported type (GIF) is refused by content even when the file is named .png -> 415', async () => {
    const gif = await sharp(capture.image).gif().toBuffer();
    const res = await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', gif, { filename: 'table.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
  });

  it('oversized file (> 8 MB) -> 413', async () => {
    const res = await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', Buffer.alloc(8 * 1024 * 1024 + 1024, 1), 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('IMAGE_TOO_LARGE');
  });

  it('pixel bomb: a small file that decodes to > 40 megapixels -> 413, never decoded', async () => {
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const res = await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', bomb, 'bomb.png');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('IMAGE_TOO_MANY_PIXELS');
    expect(CaptureJob.__all()).toHaveLength(0);
  });

  it('a hostile filename is never used: only a sanitized display label is stored', async () => {
    const res = await upload({ filename: '../../etc/passwd<script>.png' });
    expect(res.status).toBe(201);
    const stored = CaptureJob.__all()[0];
    expect(stored.source.originalName).not.toMatch(/[\\/]/);
    for (const row of storage.rows.values()) expect(row.kind).toMatch(/original|review|thumbnail/);
  });

  it('no file -> 400', async () => {
    const res = await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_FILE');
  });
});

describe('creating a job produces a DRAFT only', () => {
  it('201 with a needs_review job, the reconstructed table, summary and image links; NO SurveyPoint exists', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    const job = res.body.data;
    expect(job).toMatchObject({ status: 'needs_review', mode: 'coordinate-table', revision: 0, project: H.PROJECT, pipelineVersion: 'capture-2.3.0' });
    expect(job.arbitrationVersion).toBe('capture-arb-1.0.0');
    expect(job.provider).toMatchObject({ name: 'fixture', wordCount: expect.any(Number) });
    expect(job.table.columns.map((c) => c.semantic)).toEqual(['point', 'code', 'x', 'y', 'h', 'notes']);
    expect(job.table.rows).toHaveLength(3);
    expect(job.validationSummary).toMatchObject({ rows: 3, canConfirm: true });
    expect(job.images.review).toBe(`/api/capture/jobs/${job.id}/image/review`);
    expect(SurveyPoint.__all()).toHaveLength(0); // OCR output is never authoritative on its own
    expect(job.source.review).toEqual({ width: capture.layout.width, height: capture.layout.height });
  });

  it('cells carry rawText, normalizedValue, semantic type, confidence, page, bounding box, candidate source and review state', async () => {
    const cell = (await upload()).body.data.table.rows[0].cells[2];
    expect(cell).toMatchObject({ rawText: '4700000.25', normalizedValue: 4700000.25, semanticType: 'x', confidence: 0.98, page: 0, userValue: null, reviewState: 'accepted' });
    expect(cell.bbox).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) }));
    expect(cell.candidates[0]).toMatchObject({ text: '4700000.25', provider: 'fixture', source: 'primary' });
    expect(cell.arbitration).toMatchObject({ outcome: 'ACCEPTED' });
    expect(cell.validation).toEqual({ status: 'ok', issues: [] });
  });

  it('the stored job keeps the source metadata, transform, quality, provider metadata and retention reference', async () => {
    const id = (await upload()).body.data.id;
    const stored = CaptureJob.__all().find((j) => j._id === id);
    expect(stored.source).toMatchObject({ mime: 'image/png', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(stored.source.transform).toMatchObject({ exifOrientation: 1, deskewDegrees: 0, scale: 1 });
    expect(stored.source.quality).toEqual(expect.objectContaining({ megapixels: expect.any(Number) }));
    expect(Object.keys(stored.source.assets).sort()).toEqual(['original', 'review', 'thumbnail']);
    expect(Number.isNaN(new Date(stored.retention.expiresAt).getTime())).toBe(false);
    expect(stored.provider).toMatchObject({ name: 'fixture', requestedAt: expect.anything(), durationMs: expect.any(Number) });
  });

  it('review and thumbnail images are served (authenticated, private, never the original)', async () => {
    const id = (await upload()).body.data.id;
    const review = await get(id, '/image/review');
    expect(review.status).toBe(200);
    expect(review.headers['content-type']).toBe('image/jpeg');
    expect(review.headers['cache-control']).toContain('no-store');
    expect((await sharp(review.body).metadata()).width).toBe(capture.layout.width);
    expect((await get(id, '/image/thumbnail')).status).toBe(200);
    expect((await get(id, '/image/original')).status).toBe(404);
  });
});

describe('GET /jobs?projectId=... (Capture history)', () => {
  it('lists a project\'s jobs newest first, as summaries only (no table, no candidates, no image bytes)', async () => {
    const first = (await upload()).body.data.id;
    await new Promise((r) => setTimeout(r, 2));
    const second = (await upload()).body.data.id;
    const res = await H.authed(app, 'get', `/api/capture/jobs?projectId=${H.PROJECT}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((j) => j.id)).toEqual([second, first]); // newest first
    const row = res.body.data[0];
    expect(row).toMatchObject({ status: 'needs_review', rows: 3, invalid: 0, importedCount: 0 });
    expect(row.table).toBeUndefined();
    expect(row.thumbnail).toBe(`/api/capture/jobs/${second}/image/thumbnail`);
  });

  it('reflects confirmation (importedCount) and stays scoped to the calling user and project', async () => {
    const mineOtherProject = (await upload({ projectId: H.SHARED_PROJECT })); // I am not a member here
    expect(mineOtherProject.status).toBe(403);
    const id = (await upload()).body.data.id;
    await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`);
    const mine = await H.authed(app, 'get', `/api/capture/jobs?projectId=${H.PROJECT}`);
    expect(mine.body.data[0]).toMatchObject({ status: 'confirmed', importedCount: 3 });
    // another user, even with project access, does not see MY capture jobs (jobs stay private to their uploader)
    FieldBookProject.findById.mockImplementation(async (pid) => (String(pid) === H.PROJECT ? { _id: H.PROJECT, user: H.OTHER, workspace: 'ws1', crs: 'EPSG:7800' } : null));
    const theirs = await H.authed(app, 'get', `/api/capture/jobs?projectId=${H.PROJECT}`, H.OTHER);
    expect(theirs.body.data).toEqual([]);
  });

  it('requires a project id and project access, like every other Capture route', async () => {
    expect((await H.authed(app, 'get', '/api/capture/jobs')).status).toBe(400);
    expect((await H.authed(app, 'get', `/api/capture/jobs?projectId=${H.OTHER_PROJECT}`)).status).toBe(403);
  });
});

describe('review edits (corrections are stored separately and validation re-runs)', () => {
  const patch = (id, body) => H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send(body);

  it('a correction persists as userValue, rawText is untouched, validation is re-run and the revision moves on', async () => {
    const id = (await upload()).body.data.id;
    const res = await patch(id, { edits: [{ row: 1, col: 2, value: '4700100.5' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.revision).toBe(1);
    const cell = (await get(id)).body.data.table.rows[1].cells[2];
    expect(cell).toMatchObject({ rawText: '4700100.50', userValue: '4700100.5', normalizedValue: 4700100.5, reviewState: 'edited' });
    const stored = CaptureJob.__all().find((j) => j._id === id).table.rows[1].cells[2];
    expect(stored.rawText).toBe('4700100.50');
  });

  it('a wrong correction is flagged by the deterministic validator (never silently accepted)', async () => {
    const id = (await upload()).body.data.id;
    const res = await patch(id, { edits: [{ row: 0, col: 2, value: '47OO000' }] });
    const cell = res.body.data.table.rows[0].cells[2];
    expect(cell.reviewState).toBe('invalid');
    expect(cell.validation.issues[0]).toMatchObject({ code: 'VALUE_INVALID', severity: 'error' });
    expect(res.body.data.validationSummary).toMatchObject({ invalid: 1, canConfirm: false });
  });

  it('null reverts a correction to the OCR value', async () => {
    const id = (await upload()).body.data.id;
    await patch(id, { edits: [{ row: 0, col: 2, value: '1' }] });
    const res = await patch(id, { edits: [{ row: 0, col: 2, value: null }] });
    expect(res.body.data.table.rows[0].cells[2]).toMatchObject({ userValue: null, normalizedValue: 4700000.25 });
  });

  it('column mapping is editable and re-validated; duplicate mappings block the import', async () => {
    const id = (await upload()).body.data.id;
    const dup = await patch(id, { columns: [{ index: 3, semantic: 'x' }] });
    expect(dup.body.data.validationSummary.canConfirm).toBe(false);
    expect(dup.body.data.table.issues.some((i) => i.code === 'DUPLICATE_COLUMN_MAPPING')).toBe(true);
    const fixed = await patch(id, { columns: [{ index: 3, semantic: 'y' }] });
    expect(fixed.body.data.validationSummary.canConfirm).toBe(true);
    expect(fixed.body.data.table.columns[3].mapping).toBe('user');
  });

  it.each([
    [{}], [{ edits: [] }], [{ edits: [{ row: 99, col: 0, value: 'x' }] }], [{ edits: [{ row: 0, col: 99, value: 'x' }] }],
    [{ edits: [{ row: 0, col: 0, value: 5 }] }], [{ edits: [{ row: 0, col: 0, value: 'x'.repeat(201) }] }],
    [{ columns: [{ index: 0, semantic: 'banana' }] }], [{ edits: 'nope' }],
  ])('invalid request %j -> 400 and nothing changes', async (body) => {
    const id = (await upload()).body.data.id;
    const res = await patch(id, body);
    expect(res.status).toBe(400);
    expect(CaptureJob.__all().find((j) => j._id === id).revision).toBe(0);
  });

  it('a stale baseRevision is refused (409); a confirmed job can no longer be edited', async () => {
    const id = (await upload()).body.data.id;
    await patch(id, { edits: [{ row: 0, col: 0, value: 'Q1' }] });
    expect((await patch(id, { baseRevision: 0, edits: [{ row: 0, col: 0, value: 'Q2' }] })).status).toBe(409);
    expect((await patch(id, { baseRevision: 1, edits: [{ row: 0, col: 0, value: 'Q3' }] })).status).toBe(200);
    await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`);
    expect((await patch(id, { edits: [{ row: 0, col: 0, value: 'Q4' }] })).status).toBe(409);
  });

  it('control characters in corrections are stripped', async () => {
    const id = (await upload()).body.data.id;
    const res = await patch(id, { edits: [{ row: 0, col: 5, value: 'note  ok' }] });
    expect(res.body.data.table.rows[0].cells[5].userValue).toBe('note ok');
  });
});

describe('row exclusion ("Не импортирай този ред"): explicit and reversible', () => {
  const patch = (id, body) => H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send(body);

  it('excludes a row from validation and the summary; the row itself and its OCR evidence remain', async () => {
    const id = (await upload()).body.data.id;
    const before = (await get(id)).body.data;
    expect(before.validationSummary).toMatchObject({ rows: 3, excluded: 0 });

    const res = await patch(id, { rows: [{ index: 1, excluded: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.validationSummary).toMatchObject({ rows: 2, excluded: 1, canConfirm: true });
    const excludedRow = res.body.data.table.rows[1];
    expect(excludedRow).toMatchObject({ excluded: true, status: 'excluded' });
    expect(excludedRow.cells[0].rawText).toBe('P2'); // OCR evidence is preserved, not deleted
  });

  it('an excluded row never blocks confirmation, even if it would otherwise be invalid', async () => {
    const bad = H.fixtureProvider(capture.layout, { mutate: (w) => w.map((x) => (x.text === '4700100.50' ? { ...x, text: '47OO100.50', confidence: 0.4 } : x)) });
    setProviderForTests('google-vision', bad);
    const id = (await upload()).body.data.id;
    expect((await get(id)).body.data.validationSummary.canConfirm).toBe(false);
    const excluded = await patch(id, { rows: [{ index: 1, excluded: true }] });
    expect(excluded.body.data.validationSummary.canConfirm).toBe(true);
  });

  it('is reversible: re-including the row restores its normal validation state', async () => {
    const id = (await upload()).body.data.id;
    await patch(id, { rows: [{ index: 0, excluded: true }] });
    const restored = await patch(id, { rows: [{ index: 0, excluded: false }] });
    expect(restored.body.data.table.rows[0].excluded).toBe(false);
    expect(restored.body.data.table.rows[0].status).not.toBe('excluded');
    expect(restored.body.data.validationSummary).toMatchObject({ rows: 3, excluded: 0 });
  });

  it('an excluded row is never imported; the remaining rows keep their own row index and import normally', async () => {
    const id = (await upload()).body.data.id;
    await patch(id, { rows: [{ index: 1, excluded: true }] });
    const res = await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.importedCount).toBe(2);
    const points = SurveyPoint.__all();
    expect(points.map((p) => p.name)).toEqual(['P1', 'P3']);
    expect(points.map((p) => p.source.row)).toEqual([0, 2]);
  });

  it('invalid row-exclusion requests are refused (400) and change nothing', async () => {
    const id = (await upload()).body.data.id;
    for (const body of [{ rows: [{ index: 'x', excluded: true }] }, { rows: [{ index: 0, excluded: 'yes' }] }, { rows: [{ index: 99, excluded: true }] }]) {
      const res = await patch(id, body);
      expect(res.status).toBe(400);
    }
    expect(CaptureJob.__all().find((j) => j._id === id).revision).toBe(0);
  });
});

describe('NO import before an explicit confirmation', () => {
  it('upload, review edits and GETs never create SurveyPoints', async () => {
    const id = (await upload()).body.data.id;
    await H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send({ edits: [{ row: 0, col: 0, value: 'Z' }] });
    await get(id);
    expect(SurveyPoint.__all()).toHaveLength(0);
  });
});

describe('POST /confirm', () => {
  const confirm = (id, userId) => H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`, userId);

  it('imports the points with corrected values, provenance and the job bookkeeping', async () => {
    const id = (await upload()).body.data.id;
    const res = await confirm(id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, alreadyConfirmed: false, importedCount: 3 });
    const points = SurveyPoint.__all();
    expect(points.map((p) => [p.name, p.code, p.x, p.y, p.h, p.notes])).toEqual([
      ['P1', 'CP', 4700000.25, 500000.5, 100.125, ''],
      ['P2', 'CP', 4700100.5, 500050.75, 101.5, 'ъгъл'],
      ['P3', 'DT', 4700200, 500100.25, null, ''],
    ]);
    const stored = CaptureJob.__all().find((j) => j._id === id);
    expect(stored.status).toBe('confirmed');
    expect(Number.isNaN(new Date(stored.confirmedAt).getTime())).toBe(false);
    expect(stored.importedPointIds).toEqual(points.map((p) => p._id));
    expect(String(points[0].projectId)).toBe(H.PROJECT);
    expect(String(points[0].user)).toBe(H.OWNER);
  });

  it('every point carries capture provenance: job, row and the source cells (page + box)', async () => {
    const id = (await upload()).body.data.id;
    await confirm(id);
    const [p1, p2] = SurveyPoint.__all();
    expect(p1.source).toMatchObject({ kind: 'capture', captureJobId: id, row: 0 });
    expect(p2.source.row).toBe(1);
    expect(p1.source.cells.x).toMatchObject({ col: 2, page: 0, bbox: expect.objectContaining({ w: expect.any(Number) }) });
    expect(Object.keys(p1.source.cells).sort()).toEqual(['code', 'h', 'point', 'x', 'y']); // an empty cell (notes) has no source region
  });

  it('is IDEMPOTENT: confirming twice returns the same ids and creates no duplicates', async () => {
    const id = (await upload()).body.data.id;
    const a = await confirm(id);
    const b = await confirm(id);
    expect(b.status).toBe(200);
    expect(b.body.alreadyConfirmed).toBe(true);
    expect(b.body.pointIds).toEqual(a.body.pointIds);
    expect(SurveyPoint.__all()).toHaveLength(3);
  });

  it('concurrent confirms import exactly once', async () => {
    const id = (await upload()).body.data.id;
    const results = await Promise.all([confirm(id), confirm(id), confirm(id)]);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(SurveyPoint.__all()).toHaveLength(3);
    const ids = new Set(results.filter((r) => r.status === 200).map((r) => r.body.pointIds.join(',')));
    expect(ids.size).toBe(1);
  });

  it('the unique (job,row) guard alone prevents duplicates even if the claim was lost', async () => {
    const id = (await upload()).body.data.id;
    await confirm(id);
    // simulate a crash after the insert but before the job was marked confirmed
    CaptureJob.__mutate(id, (s) => { s.status = 'needs_review'; s.confirmClaimedAt = null; s.importedPointIds = []; delete s.confirmedAt; });
    const again = await confirm(id);
    expect(again.status).toBe(200);
    expect(SurveyPoint.__all()).toHaveLength(3); // the duplicate-key refusal was treated as "already imported"
    expect(again.body.pointIds).toHaveLength(3);
  });

  it('REVALIDATES on the server: a tampered stored table with an unresolved error is rejected and nothing is imported', async () => {
    const id = (await upload()).body.data.id;
    CaptureJob.__mutate(id, (s) => { s.table.rows[0].cells[2].rawText = '47OO000'; s.validationSummary.canConfirm = true; });
    const res = await confirm(id);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERRORS' });
    expect(res.body.errors[0]).toMatchObject({ row: 0, col: 2, code: 'VALUE_INVALID' });
    expect(SurveyPoint.__all()).toHaveLength(0);
    expect(CaptureJob.__all().find((j) => j._id === id).status).toBe('needs_review');
  });

  it('unresolved ERROR cells block the import; fixing them by correction allows it; the CORRECTED values are imported', async () => {
    const bad = H.fixtureProvider(capture.layout, { mutate: (w) => w.map((x) => (x.text === '4700100.50' ? { ...x, text: '47OO100.50', confidence: 0.4 } : x)) });
    setProviderForTests('google-vision', bad);
    const id = (await upload()).body.data.id;
    const blocked = await confirm(id);
    expect(blocked.status).toBe(422);
    expect(SurveyPoint.__all()).toHaveLength(0);
    await H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send({ edits: [{ row: 1, col: 2, value: '4700100.5' }] });
    const ok = await confirm(id);
    expect(ok.status).toBe(200);
    expect(SurveyPoint.__all()[1].x).toBe(4700100.5);
  });

  it('does NOT trust a client-provided table: the body is ignored', async () => {
    const id = (await upload()).body.data.id;
    const res = await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`).send({ table: { rows: [] }, rows: [{ name: 'EVIL', x: 1, y: 2 }], points: [{ name: 'EVIL' }] });
    expect(res.status).toBe(200);
    expect(SurveyPoint.__all().map((p) => p.name)).toEqual(['P1', 'P2', 'P3']);
  });

  it('EXISTING-POINT CONFLICT: same project + same name (case-insensitive) -> structured 409, nothing written, job stays reviewable', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'p2', x: 1, y: 2 });
    const id = (await upload()).body.data.id;
    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: 'POINT_CONFLICTS' });
    expect(res.body.conflicts).toEqual([{ row: 1, name: 'P2', existingPointId: expect.any(String) }]);
    expect(SurveyPoint.__all()).toHaveLength(1); // only the seeded one, untouched
    expect(SurveyPoint.__all()[0]).toMatchObject({ x: 1, y: 2 }); // never overwritten
    expect(CaptureJob.__all().find((j) => j._id === id).status).toBe('needs_review');
    // the user renames the point and confirms again
    await H.authed(app, 'patch', `/api/capture/jobs/${id}/cells`).send({ edits: [{ row: 1, col: 0, value: 'P2-new' }] });
    expect((await confirm(id)).status).toBe(200);
  });

  it('a same-named point in ANOTHER project is not a conflict; a matching code alone is not a conflict', async () => {
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.OTHER_PROJECT, name: 'P1', x: 1, y: 2 });
    SurveyPoint.__seed({ user: H.OWNER, projectId: H.PROJECT, name: 'Z9', code: 'CP', x: 1, y: 2 });
    const id = (await upload()).body.data.id;
    expect((await confirm(id)).status).toBe(200);
  });

  it('a failure in the middle of the import rolls back: no partial points, the job can be confirmed again', async () => {
    const id = (await upload()).body.data.id;
    SurveyPoint.__failNextInsertAfter = 1;
    const res = await confirm(id);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('IMPORT_FAILED');
    expect(res.body.message).not.toMatch(/simulated/);
    expect(SurveyPoint.__all()).toHaveLength(0);
    const stored = CaptureJob.__all().find((j) => j._id === id);
    expect(stored.status).toBe('needs_review');
    expect(stored.confirmClaimedAt).toBeNull();
    expect((await confirm(id)).status).toBe(200);
    expect(SurveyPoint.__all()).toHaveLength(3);
  });

  it('a job that is not in needs_review cannot be confirmed (failed job -> 409)', async () => {
    const id = (await upload()).body.data.id;
    CaptureJob.__mutate(id, (s) => { s.status = 'failed'; });
    expect((await confirm(id)).status).toBe(409);
  });
});

describe('provider failure and logging hygiene', () => {
  it('provider failure: sanitized 502, the job is persisted as failed, no vendor message anywhere', async () => {
    setProviderForTests('google-vision', { name: 'fixture', version: 'x', recognize: async () => { throw new Error('PERMISSION_DENIED key=SECRET-KEY-123'); } });
    const res = await upload();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|PERMISSION/);
    const stored = CaptureJob.__all()[0];
    expect(stored.status).toBe('failed');
    expect(stored.failure.message).not.toMatch(/SECRET|PERMISSION/);
  });

  it('a sanitized provider error (CaptureError) becomes 502 with the fixed Bulgarian message', async () => {
    const { CaptureError } = require('../../capture/errors');
    setProviderForTests('google-vision', { name: 'fixture', version: 'x', recognize: async () => { throw new CaptureError('PROVIDER_UNAVAILABLE'); } });
    const res = await upload();
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, code: 'PROVIDER_UNAVAILABLE', message: 'Разпознаването временно не е възможно. Опитайте отново по-късно.' });
    expect(res.body.jobId).toBeDefined();
  });

  it('no table found -> 422 NO_TABLE_DETECTED', async () => {
    setProviderForTests('google-vision', { name: 'fixture', version: 'x', recognize: async (b, d) => ({ provider: { name: 'fixture', version: 'x' }, page: { index: 0, width: d.width, height: d.height, words: [] } }) });
    const res = await upload();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_TABLE_DETECTED');
  });

  it('OCR text, image content and credentials are never written to the application logs', async () => {
    const logs = [];
    jest.spyOn(console, 'error').mockImplementation((...a) => logs.push(JSON.stringify(a)));
    jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(JSON.stringify(a)));
    setProviderForTests('google-vision', { name: 'fixture', version: 'x', recognize: async () => { throw new Error('secret OCR text 4700000.25 and SECRET-KEY-123'); } });
    await upload();
    await request(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', Buffer.from('4700000.25 raw bytes'), 'x.png');
    const all = logs.join('\n');
    expect(all).not.toMatch(/4700000|SECRET|OCR text|raw bytes/);
  });
});

describe('V2.1 backwards compatibility: an old job (pipelineVersion capture-2.1.0, old candidate shape) is read as-is', () => {
  // shaped like what capture/reconstruct.js + capture/jobService.js produced BEFORE V2.2: no recognitionVersion /
  // arbitrationVersion / validationVersion, no cell.arbitration / cell.symbolConfidence, and candidates whose
  // `source` is the PROVIDER NAME (not the new 'primary' role).
  const legacyCell = (col, semantic, rawText, normalizedValue, extra = {}) => ({
    col, rawText, normalizedValue, semanticType: semantic, confidence: 0.98, page: 0,
    bbox: { x: 10 + col * 100, y: 10, w: 80, h: 24 }, validation: { status: 'ok', issues: [] }, userValue: null,
    candidates: [{ text: rawText, confidence: 0.98, source: 'google-vision' }], ...extra,
  });
  const legacyTable = () => ({
    columns: [{ index: 0, headerText: 'Точка', semantic: 'point', mapping: 'ok' }, { index: 1, headerText: 'X', semantic: 'x', mapping: 'ok' }, { index: 2, headerText: 'Y', semantic: 'y', mapping: 'ok' }],
    issues: [],
    rows: [{ index: 0, status: 'ok', skipped: false, bbox: { x: 0, y: 0, w: 1, h: 1 }, cells: [legacyCell(0, 'point', 'P1', 'P1'), legacyCell(1, 'x', '4700000', 4700000), legacyCell(2, 'y', '500000', 500000)] }],
  });

  async function seedLegacyJob(status) {
    const created = await CaptureJob.create({
      user: H.OWNER, project: H.PROJECT, mode: 'coordinate-table', status, pipelineVersion: 'capture-2.1.0',
      source: { originalName: 'legacy.png', mime: 'image/png', bytes: 10, width: 100, height: 100, sha256: 'x', assets: { review: 'a1', thumbnail: 'a2' }, review: { width: 100, height: 100 } },
      table: legacyTable(),
      validationSummary: { rows: 1, ready: 1, review: 0, invalid: 0, canConfirm: true },
      revision: 0, importedPointIds: [], confirmClaimedAt: null,
      ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
    });
    return String(created._id);
  }

  it('GET reads a legacy job fine: no recognitionVersion/arbitrationVersion, candidates/arbitration render safely', async () => {
    const id = await seedLegacyJob('needs_review');
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.body.data.pipelineVersion).toBe('capture-2.1.0');
    expect(res.body.data.recognitionVersion).toBeNull();
    expect(res.body.data.arbitrationVersion).toBeNull();
    const cell = res.body.data.table.rows[0].cells[1];
    expect(cell.candidates[0]).toMatchObject({ text: '4700000', source: 'google-vision' }); // untouched, old shape
    expect(cell.symbolConfidence).toBeNull();
  });

  it('a legacy job already CONFIRMED is returned exactly as stored: it is never re-validated or re-arbitrated', async () => {
    const id = await seedLegacyJob('confirmed');
    const res = await get(id);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.table.rows[0].cells[1].validation).toEqual({ status: 'ok', issues: [] }); // exactly as stored
    // confirming it again is idempotent and touches nothing new
    const again = await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`);
    expect(again.body).toMatchObject({ alreadyConfirmed: true });
  });

  it('a legacy job still in needs_review can still be edited and confirmed (current rules re-validate it, as confirm always has)', async () => {
    const id = await seedLegacyJob('needs_review');
    const res = await H.authed(app, 'post', `/api/capture/jobs/${id}/confirm`);
    expect(res.status).toBe(200);
    expect(SurveyPoint.__all().map((p) => p.name)).toEqual(['P1']);
  });
});

describe('the legacy scan endpoint is untouched', () => {
  it('/api/scan/extract-input is still mounted and still Pro-gated (auth first)', async () => {
    expect((await request(app).post('/api/scan/extract-input')).status).toBe(401);
  });
});
