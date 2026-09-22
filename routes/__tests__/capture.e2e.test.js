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

/**
 * CAPTURE V2.1 - AUTOMATED END-TO-END ACCEPTANCE
 *
 * generated coordinate-table image (a printed Bulgarian table with comma decimals and thousands spaces)
 *   -> POST /api/capture/jobs -> OCR provider fixture (with a real misread and a low-confidence cell)
 *   -> reconstructed table -> deterministic validation flags the problems
 *   -> the user corrects them (PATCH) -> validation passes -> POST /confirm
 *   -> SurveyPoints in the project, checked against the KNOWN ground truth, with provenance.
 */
const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const CaptureJob = require('../../models/CaptureJob');
const SurveyPoint = require('../../models/SurveyPoint');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const { TRUTH } = require('../../tests/support/captureFixtures');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(90000);

// Bulgarian formatting: thousands separated by spaces, decimal comma (X = Northing, Y = Easting)
const bg = (n, decimals) => {
  if (n === null) return '';
  const [i, d] = n.toFixed(decimals).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}`;
};
const HEADERS = ['Точка', 'Код', 'X', 'Y', 'H', 'Бележка'];
const ROWS = TRUTH.map((p) => [p.name, p.code, bg(p.x, 2), bg(p.y, 2), p.h === null ? '' : bg(p.h, 3), '']);

let capture;
beforeAll(async () => { capture = await H.makeCapture(HEADERS, ROWS); });
beforeEach(() => {
  CaptureJob.__reset();
  SurveyPoint.__reset();
  setStorage(createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace }, { crs: 'EPSG:7800' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

it('image -> upload -> OCR -> table -> validation -> user correction -> confirm -> SurveyPoints == ground truth', async () => {
  // The OCR "misreads" P2's X (letter O for zeros, low confidence) and P4's H confidence is low.
  const misread = '4 7OO 100,50';
  const provider = H.fixtureProvider(capture.layout, {
    mutate: (words) => words.map((w) => {
      if (w.text === '4' && Math.abs(w.bbox.y - capture.layout.words.find((x) => x.text === 'P2').bbox.y) < 5 && w.bbox.x > 100) return w; // keep the leading "4" of P2's X
      if (w.text === '700' && Math.abs(w.bbox.y - capture.layout.words.find((x) => x.text === 'P2').bbox.y) < 5 && w.bbox.x < 400) return { ...w, text: '7OO', confidence: 0.41 };
      return w;
    }),
  });
  setProviderForTests('google-vision', provider);

  // 1. upload. The whole-page pass reads P2's X wrong at low confidence, so V2.2 re-recognizes just that cell
  // (3 bounded crop variants: original / enhanced / threshold) before arbitration judges trust.
  const res = await H.upload(app, capture.image);
  expect(res.status).toBe(201);
  expect(provider.recognize).toHaveBeenCalledTimes(4);
  const job = res.body.data;
  expect(job.status).toBe('needs_review');
  expect(SurveyPoint.__all()).toHaveLength(0); // still a draft

  // 2. the reconstructed table is exactly the printed one
  expect(job.table.columns.map((c) => c.semantic)).toEqual(['point', 'code', 'x', 'y', 'h', 'notes']);
  expect(job.table.rows).toHaveLength(TRUTH.length);
  expect(job.table.rows.map((r) => r.cells[0].rawText)).toEqual(TRUTH.map((p) => p.name));
  expect(job.table.rows[0].cells[2].rawText).toBe('4 700 000,25'); // multi-word cell kept whole
  expect(job.table.rows[0].cells[2].normalizedValue).toBe(4700000.25); // NOT 4.7

  // 3. the validator flags the misread; the import is blocked
  const p2x = job.table.rows[1].cells[2];
  expect(p2x.rawText).toBe('4 7OO 100,50');
  expect(p2x.reviewState).toBe('invalid');
  expect(p2x.validation.issues.map((i) => i.code)).toContain('VALUE_INVALID');
  // V2.2: the letter/digit look-alike (O -> 0) generates an explicit alternative reading, never a silent fix
  expect(p2x.candidates.length).toBeGreaterThan(1); // primary + re-recognition crop passes
  expect(p2x.arbitration).toMatchObject({ outcome: 'REVIEW_SUGGESTED' });
  expect(p2x.arbitration.alternatives.some((a) => a.normalizedValue === 4700100.5)).toBe(true);
  // H uses three decimals with a comma ("100,125"): readable only through the document's decimal comma -> review suggested
  expect(job.table.rows[0].cells[4].validation.issues.map((i) => i.code)).toEqual(['FORMAT_INFERRED']);
  expect(job.table.rows[0].cells[4].normalizedValue).toBe(100.125);
  expect(job.validationSummary).toMatchObject({ rows: 4, invalid: 1, review: 2, ready: 1, canConfirm: false });
  const blocked = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(blocked.status).toBe(422);
  expect(SurveyPoint.__all()).toHaveLength(0);

  // 4. the user corrects the value (the original OCR text is kept beside it)
  const fixed = await H.authed(app, 'patch', `/api/capture/jobs/${job.id}/cells`).send({ baseRevision: 0, edits: [{ row: 1, col: 2, value: '4 700 100,50' }] });
  expect(fixed.status).toBe(200);
  const corrected = fixed.body.data.table.rows[1].cells[2];
  expect(corrected).toMatchObject({ rawText: '4 7OO 100,50', userValue: '4 700 100,50', normalizedValue: 4700100.5, reviewState: 'edited' });
  expect(fixed.body.data.validationSummary).toMatchObject({ invalid: 0, canConfirm: true });

  // 5. explicit confirmation
  const confirmed = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body).toMatchObject({ success: true, alreadyConfirmed: false, importedCount: TRUTH.length });

  // 6. the project's SurveyPoints equal the ground truth, exactly
  const points = SurveyPoint.__all();
  expect(points.map((p) => ({ name: p.name, code: p.code, x: p.x, y: p.y, h: p.h }))).toEqual(
    TRUTH.map((t) => ({ name: t.name, code: t.code, x: t.x, y: t.y, h: t.h }))
  );
  points.forEach((p, i) => {
    expect(String(p.projectId)).toBe(H.PROJECT);
    expect(p.source).toMatchObject({ kind: 'capture', captureJobId: job.id, row: i });
    expect(p.source.cells.x.bbox.w).toBeGreaterThan(0);
  });

  // 7. bookkeeping and idempotency
  const stored = CaptureJob.__all()[0];
  expect(stored).toMatchObject({ status: 'confirmed' });
  expect(stored.importedPointIds).toEqual(points.map((p) => p._id));
  const again = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(again.body).toMatchObject({ alreadyConfirmed: true, importedCount: TRUTH.length });
  expect(SurveyPoint.__all()).toHaveLength(TRUTH.length);
});

it('a clean table needs no correction: upload -> confirm gives the ground truth directly (dot decimals, reordered columns, no code column)', async () => {
  const rows = TRUTH.map((p) => [p.h === null ? '' : String(p.h), p.name, String(p.y), String(p.x)]);
  const { layout, image } = await H.makeCapture(['H', 'Point', 'Y', 'X'], rows);
  setProviderForTests('google-vision', H.fixtureProvider(layout));
  const res = await H.upload(app, image);
  expect(res.body.data.validationSummary).toMatchObject({ rows: 4, invalid: 0, canConfirm: true });
  const ok = await H.authed(app, 'post', `/api/capture/jobs/${res.body.data.id}/confirm`);
  expect(ok.status).toBe(200);
  expect(SurveyPoint.__all().map((p) => [p.name, p.x, p.y, p.h])).toEqual(TRUTH.map((t) => [t.name, t.x, t.y, t.h]));
});
