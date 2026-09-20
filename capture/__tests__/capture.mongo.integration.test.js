/**
 * Real-MongoDB integration test for Capture V2.1. It validates what in-memory fakes cannot: the actual Mongoose schemas
 * (embedded table, SurveyPoint.source), the storage model, the TTL and partial-unique indexes and the atomic claim.
 * Runs only when CAPTURE_TEST_MONGO_URI is set (a throwaway database on the local QA container, never production):
 *   CAPTURE_TEST_MONGO_URI=mongodb://localhost:27017/geosolver_capture_it npx jest capture.mongo.integration
 */
const mongoose = require('mongoose');

const URI = process.env.CAPTURE_TEST_MONGO_URI;
const suite = URI && /localhost|127\.0\.0\.1/.test(URI) ? describe : describe.skip; // refuses any non-local database

jest.setTimeout(90000);

suite('Capture on a real MongoDB', () => {
  let CaptureJob; let CaptureAsset; let SurveyPoint;
  let jobService; let importService; let setProviderForTests; let H; let fixtures;
  let capture;
  const userId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
    CaptureJob = require('../../models/CaptureJob');
    CaptureAsset = require('../../models/CaptureAsset');
    SurveyPoint = require('../../models/SurveyPoint');
    await Promise.all([CaptureJob.init(), CaptureAsset.init(), SurveyPoint.init()]);
    jobService = require('../jobService');
    importService = require('../importService');
    ({ setProviderForTests } = require('../providers'));
    fixtures = require('../../tests/support/captureFixtures');
    H = require('../../tests/support/captureApiHarness');
    capture = await H.makeCapture(['Точка', 'Код', 'X', 'Y', 'H'], fixtures.TRUTH.map((p) => [p.name, p.code, String(p.x), String(p.y), p.h === null ? '' : String(p.h)]));
    setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  });
  afterAll(async () => {
    setProviderForTests('google-vision', null);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it('indexes exist: TTL on assets and the partial unique (job,row) guard on points', async () => {
    const assetIdx = await CaptureAsset.collection.indexes();
    expect(assetIdx.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
    const pointIdx = await SurveyPoint.collection.indexes();
    const guard = pointIdx.find((i) => i.key['source.captureJobId'] === 1 && i.key['source.row'] === 1);
    expect(guard.unique).toBe(true);
    expect(guard.partialFilterExpression).toEqual({ 'source.captureJobId': { $type: 'objectId' } });
  });

  it('pipeline -> stored draft -> correction -> confirm -> points with provenance, all through the real models and storage', async () => {
    const job = await jobService.createJob({ userId, projectId, buffer: capture.image, originalName: 'table.png' });
    await jobService.processJob(job, { crs: 'EPSG:7800' });
    const reloaded = await CaptureJob.findById(job._id);
    expect(reloaded.status).toBe('needs_review');
    expect(reloaded.table.rows).toHaveLength(4);
    expect(reloaded.table.rows[0].cells[2]).toMatchObject({ rawText: String(fixtures.TRUTH[0].x), normalizedValue: fixtures.TRUTH[0].x });
    expect(await CaptureAsset.countDocuments({ job: job._id })).toBe(3);
    expect(await SurveyPoint.countDocuments({ projectId })).toBe(0);

    await jobService.applyReviewEdits(reloaded, { edits: [{ row: 0, col: 0, value: 'P1-corrected' }] }, { crs: 'EPSG:7800' });
    const edited = await CaptureJob.findById(job._id);
    expect(edited.revision).toBe(1);
    expect(edited.table.rows[0].cells[0]).toMatchObject({ rawText: 'P1', userValue: 'P1-corrected' });

    const result = await importService.confirmJob(edited, { crs: 'EPSG:7800' });
    expect(result.alreadyConfirmed).toBe(false);
    const points = await SurveyPoint.find({ 'source.captureJobId': job._id }).sort({ 'source.row': 1 }).lean();
    expect(points.map((p) => [p.name, p.x, p.y, p.h])).toEqual(fixtures.TRUTH.map((t, i) => [i === 0 ? 'P1-corrected' : t.name, t.x, t.y, t.h]));
    expect(points[0].source).toMatchObject({ kind: 'capture', row: 0 });
    expect(String(points[0].source.captureJobId)).toBe(String(job._id));
    expect(points[0].source.cells.x.bbox.w).toBeGreaterThan(0);
    const done = await CaptureJob.findById(job._id);
    expect(done.status).toBe('confirmed');
    expect(done.importedPointIds.map(String)).toEqual(points.map((p) => String(p._id)));
  });

  it('confirm is idempotent and safe under concurrency against the real atomic claim + unique index', async () => {
    const job = await jobService.createJob({ userId, projectId: new mongoose.Types.ObjectId(), buffer: capture.image, originalName: 't.png' });
    await jobService.processJob(job, { crs: 'EPSG:7800' });
    const results = await Promise.allSettled([1, 2, 3, 4].map(async () => importService.confirmJob(await CaptureJob.findById(job._id), { crs: 'EPSG:7800' })));
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) if (r.status === 'rejected') expect(r.reason.code).toBe('CONFIRM_IN_PROGRESS');
    expect(await SurveyPoint.countDocuments({ 'source.captureJobId': job._id })).toBe(4);
    const again = await importService.confirmJob(await CaptureJob.findById(job._id), { crs: 'EPSG:7800' });
    expect(again.alreadyConfirmed).toBe(true);
    expect(await SurveyPoint.countDocuments({ 'source.captureJobId': job._id })).toBe(4);
  });

  it('the database refuses a duplicate (job,row); ordinary points (no source) are unaffected', async () => {
    const jobId = new mongoose.Types.ObjectId();
    const mk = (row) => ({ user: userId, name: `D${row}`, x: 1, y: 2, source: { kind: 'capture', captureJobId: jobId, row } });
    await SurveyPoint.create(mk(0));
    await expect(SurveyPoint.create(mk(0))).rejects.toMatchObject({ code: 11000 });
    await SurveyPoint.create({ user: userId, name: 'same', x: 1, y: 2 });
    await SurveyPoint.create({ user: userId, name: 'same', x: 1, y: 2 });
    expect(await SurveyPoint.countDocuments({ name: 'same' })).toBe(2);
  });

  it('an existing project point with the same name is a conflict and nothing is written', async () => {
    const pid = new mongoose.Types.ObjectId();
    await SurveyPoint.create({ user: userId, projectId: pid, name: 'p2', x: 9, y: 9 });
    const job = await jobService.createJob({ userId, projectId: pid, buffer: capture.image, originalName: 't.png' });
    await jobService.processJob(job, { crs: 'EPSG:7800' });
    await expect(importService.confirmJob(await CaptureJob.findById(job._id), { crs: 'EPSG:7800' })).rejects.toMatchObject({ code: 'POINT_CONFLICTS' });
    expect(await SurveyPoint.countDocuments({ 'source.captureJobId': job._id })).toBe(0);
    expect((await SurveyPoint.findOne({ projectId: pid, name: 'p2' })).x).toBe(9);
  });
});
