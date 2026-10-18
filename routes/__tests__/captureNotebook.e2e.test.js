process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

/**
 * CAPTURE V2.3 - FIELD NOTEBOOK AUTOMATED END-TO-END ACCEPTANCE
 *
 * generated field-notebook image (one station, an orientation, three gon observations)
 *   -> POST /api/capture/jobs (mode=field-notebook) -> OCR provider fixture (one intentionally wrong, low-confidence Hz)
 *   -> reconstructed notebook -> deterministic validation flags the problem
 *   -> the user corrects it (PATCH) -> validation passes -> POST /confirm
 *   -> a FieldObservationSet, checked against the KNOWN ground truth, with provenance.
 *
 * Verifies explicitly: no SurveyPoints were created, no calculation ran, the final measurements exactly match
 * ground truth, provenance points back to the CaptureJob and source cells, and a second confirm is a no-op.
 */
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
const { layoutNotebook, renderTableImage, TRUTH } = require('../../tests/support/notebookFixtures');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(90000);

const fmtGon = (n) => `${n.toFixed(4)}g`;
const spec = {
  setups: [{
    station: TRUTH.setups[0].station,
    hi: String(TRUTH.setups[0].instrumentHeight),
    orientationTarget: TRUTH.setups[0].orientation.target,
    orientationDirection: fmtGon(TRUTH.setups[0].orientation.direction.value),
    observations: TRUTH.setups[0].observations.map((o) => ({ target: o.target, hz: fmtGon(o.hz.value), vz: fmtGon(o.vz.value), distance: String(o.distance), prism: String(o.prism) })),
  }],
};

let capture;
beforeAll(async () => {
  const layout = layoutNotebook(spec);
  const image = await renderTableImage(layout);
  capture = { layout, image };
});
beforeEach(() => {
  CaptureJob.__reset();
  SurveyPoint.__reset();
  FieldObservationSet.__reset();
  setStorage(createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

it('image -> upload -> notebook interpretation -> validation -> correction -> confirm -> FieldObservationSet == ground truth', async () => {
  // the OCR misreads A2's Hz (letter O for a zero, low confidence)
  const misread = fmtGon(TRUTH.setups[0].observations[1].hz.value).replace('0', 'O');
  const provider = H.fixtureProvider(capture.layout, {
    mutate: (words) => words.map((w) => (w.text === fmtGon(TRUTH.setups[0].observations[1].hz.value) ? { ...w, text: misread, confidence: 0.4 } : w)),
  });
  setProviderForTests('google-vision', provider);

  // 1. upload
  const res = await H.upload(app, capture.image, { mode: 'field-notebook' });
  expect(res.status).toBe(201);
  const job = res.body.data;
  expect(job.status).toBe('needs_review');
  expect(job.mode).toBe('field-notebook');
  expect(SurveyPoint.__all()).toHaveLength(0);
  expect(FieldObservationSet.__all()).toHaveLength(0); // still a draft

  // 2. the reconstructed notebook matches the printed one
  const setup = job.notebook.setups[0];
  expect(setup.station.point.rawText).toBe('T1');
  expect(setup.orientation.target.rawText).toBe('T0');
  expect(setup.observations).toHaveLength(3);
  expect(setup.observations.map((o) => o.cells[0].rawText)).toEqual(['A1', 'A2', 'A3']);

  // 3. the misread cell is flagged; the import is blocked
  const a2 = setup.observations[1];
  const hzCell = a2.cells[a2.cols.findIndex((c) => c.field === 'hz')];
  expect(hzCell.rawText).toBe(misread);
  expect(hzCell.reviewState).toBe('invalid');
  expect(job.validationSummary.canConfirm).toBe(false);
  const blocked = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(blocked.status).toBe(422);
  expect(FieldObservationSet.__all()).toHaveLength(0);

  // 4. the user corrects it (rawText is kept beside the correction)
  const fixed = await H.authed(app, 'patch', `/api/capture/jobs/${job.id}/cells`).send({
    baseRevision: 0, edits: [{ setup: 0, section: 'observation', row: 1, field: 'hz', value: fmtGon(TRUTH.setups[0].observations[1].hz.value) }],
  });
  expect(fixed.status).toBe(200);
  const correctedCell = fixed.body.data.notebook.setups[0].observations[1];
  const correctedHz = correctedCell.cells[correctedCell.cols.findIndex((c) => c.field === 'hz')];
  expect(correctedHz).toMatchObject({ rawText: misread, userValue: fmtGon(TRUTH.setups[0].observations[1].hz.value), reviewState: 'edited' });
  expect(fixed.body.data.validationSummary.canConfirm).toBe(true);

  // 5. explicit confirmation
  const confirmed = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body).toMatchObject({ success: true, alreadyConfirmed: false });
  expect(confirmed.body.observationSetId).toBeTruthy();

  // 6. NEVER a SurveyPoint, NEVER a calculation - only a FieldObservationSet, matching ground truth exactly
  expect(SurveyPoint.__all()).toHaveLength(0);
  const sets = FieldObservationSet.__all();
  expect(sets).toHaveLength(1);
  const savedSetup = sets[0].setups[0];
  expect(savedSetup.station).toMatchObject({ point: 'T1', instrumentHeight: { value: TRUTH.setups[0].instrumentHeight, unit: 'm' } });
  expect(savedSetup.orientation).toMatchObject({ target: 'T0', direction: { value: TRUTH.setups[0].orientation.direction.value, unit: 'gon' } });
  expect(savedSetup.observations.map((o) => o.target)).toEqual(TRUTH.setups[0].observations.map((o) => o.target));
  TRUTH.setups[0].observations.forEach((truth, i) => {
    const saved = savedSetup.observations[i];
    expect(saved.hz).toMatchObject({ value: truth.hz.value, unit: 'gon' });
    expect(saved.vz).toMatchObject({ value: truth.vz.value, unit: 'gon' });
    expect(saved.distance).toMatchObject({ value: truth.distance, unit: 'm' });
    expect(saved.prismHeight).toMatchObject({ value: truth.prism, unit: 'm' });
  });

  // 7. provenance back to the CaptureJob and source cells
  expect(String(sets[0].source.captureJobId)).toBe(job.id);
  expect(sets[0].source.kind).toBe('capture');
  expect(savedSetup.observations[0].cells.hz.bbox.w).toBeGreaterThan(0);
  expect(savedSetup.observations[1].cells.hz.bbox.w).toBeGreaterThan(0); // the corrected cell still carries its source region

  // 8. bookkeeping and idempotency: the job is confirmed, a second confirm creates no duplicate
  const stored = CaptureJob.__all().find((j) => j._id === job.id);
  expect(stored.status).toBe('confirmed');
  expect(String(stored.importedFieldObservationSetId)).toBe(String(sets[0]._id));
  const again = await H.authed(app, 'post', `/api/capture/jobs/${job.id}/confirm`);
  expect(again.body).toMatchObject({ alreadyConfirmed: true, observationSetId: confirmed.body.observationSetId });
  expect(FieldObservationSet.__all()).toHaveLength(1);
  expect(SurveyPoint.__all()).toHaveLength(0);
});
