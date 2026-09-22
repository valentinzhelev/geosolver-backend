const mongoose = require('mongoose');
const CaptureJob = require('../CaptureJob');
const CaptureAsset = require('../CaptureAsset');
const SurveyPoint = require('../SurveyPoint');

const oid = () => new mongoose.Types.ObjectId();

describe('CaptureJob schema', () => {
  it('defaults: coordinate-table mode, uploaded status, revision 0, no confirmation', () => {
    const job = new CaptureJob({ user: oid(), project: oid(), pipelineVersion: 'v' });
    expect(job.validateSync()).toBeUndefined();
    expect(job.mode).toBe('coordinate-table');
    expect(job.status).toBe('uploaded');
    expect(job.revision).toBe(0);
    expect(job.confirmedAt).toBeUndefined();
    expect(job.importedPointIds).toHaveLength(0);
    expect(job.confirmClaimedAt).toBeNull();
  });

  it('supports the required statuses/modes and rejects unknown ones', () => {
    expect(CaptureJob.STATUSES).toEqual(['uploaded', 'processing', 'needs_review', 'confirmed', 'failed']);
    const bad = new CaptureJob({ user: oid(), project: oid(), pipelineVersion: 'v', status: 'done', mode: 'nonsense-mode' });
    const err = bad.validateSync();
    expect(err.errors.status).toBeDefined();
    expect(err.errors.mode).toBeDefined();
    // V2.3 adds 'field-notebook' alongside the original 'coordinate-table' - both are valid
    const ok = new CaptureJob({ user: oid(), project: oid(), pipelineVersion: 'v', mode: 'field-notebook' });
    const okErr = ok.validateSync();
    expect(okErr === undefined || okErr.errors.mode === undefined).toBe(true);
  });

  it('a project and a user are mandatory (no project -> no CaptureJob)', () => {
    const err = new CaptureJob({ pipelineVersion: 'v' }).validateSync();
    expect(err.errors.project).toBeDefined();
    expect(err.errors.user).toBeDefined();
  });
});

describe('CaptureAsset schema', () => {
  it('never selects the binary by default and expires automatically (TTL)', () => {
    expect(CaptureAsset.schema.path('data').options.select).toBe(false);
    const ttl = CaptureAsset.schema.indexes().find(([fields]) => fields.expiresAt === 1);
    expect(ttl[1].expireAfterSeconds).toBe(0);
  });
});

describe('SurveyPoint capture provenance (backwards compatible)', () => {
  it('an ordinary point has no source at all', () => {
    const p = new SurveyPoint({ user: oid(), name: 'A', x: 1, y: 2 });
    expect(p.validateSync()).toBeUndefined();
    expect(p.source).toBeUndefined();
    expect(p.toObject().source).toBeUndefined();
  });

  it('a capture point keeps the job, the row and the source cells', () => {
    const jobId = oid();
    const p = new SurveyPoint({ user: oid(), name: 'A', x: 1, y: 2, source: { kind: 'capture', captureJobId: jobId, row: 3, cells: { x: { col: 2, page: 0, bbox: { x: 1, y: 2, w: 3, h: 4 } } } } });
    expect(p.validateSync()).toBeUndefined();
    expect(String(p.source.captureJobId)).toBe(String(jobId));
    expect(p.source.row).toBe(3);
    expect(p.source.cells.x.bbox.w).toBe(3);
  });

  it('a partial unique index guards (captureJobId, row) so a repeated confirm cannot duplicate points', () => {
    const idx = SurveyPoint.schema.indexes().find(([f]) => f['source.captureJobId'] === 1 && f['source.row'] === 1);
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
    expect(idx[1].partialFilterExpression).toEqual({ 'source.captureJobId': { $type: 'objectId' } });
  });

  it('the existing Calculation provenance index is untouched', () => {
    expect(SurveyPoint.schema.indexes().some(([f]) => f.sourceCalculationId === 1)).toBe(true);
  });
});
