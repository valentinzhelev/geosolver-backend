/**
 * Capture -> SurveyPoints import (the ONLY place OCR-derived data becomes project data).
 *
 * Contract (POST /confirm): the server reloads the job, re-checks permissions, re-runs the deterministic validation on
 * the STORED table (never a client-supplied one), rejects unresolved errors, uses corrected values, pre-flights point
 * conflicts (never overwrites), imports with provenance, and is idempotent.
 *
 * Conflict rule (V2.1, deliberately conservative): an incoming point conflicts with an existing point of the SAME
 * project when their names match (trimmed, case-insensitive). Codes are classifications (many points share one), so a
 * matching code alone is not a conflict. Conflicts are returned, never merged or overwritten.
 */
const CaptureJob = require('../models/CaptureJob');
const SurveyPoint = require('../models/SurveyPoint');
const { evaluateTable } = require('./validation');
const { getConfig } = require('./config');
const { CaptureError } = require('./errors');

const norm = (s) => String(s || '').trim().toLowerCase();

/** `ownJobId`: points a previous (interrupted) run of THIS job already created are not conflicts. */
async function findConflicts(projectId, rows, ownJobId = null) {
  const existing = await SurveyPoint.find({ projectId }).select('name source.captureJobId').lean();
  const byName = new Map();
  for (const p of existing) {
    if (ownJobId && p.source && String(p.source.captureJobId) === String(ownJobId)) continue;
    byName.set(norm(p.name), p);
  }
  const conflicts = [];
  for (const r of rows) {
    const hit = byName.get(norm(r.name));
    if (hit) conflicts.push({ row: r.row, name: r.name, existingPointId: String(hit._id) });
  }
  return conflicts;
}

const isDuplicateKey = (e) => e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some((w) => w.code === 11000)));

/** Points this job has already created, by row (a previous run may have been interrupted). */
async function existingImport(job) {
  const points = await SurveyPoint.find({ 'source.captureJobId': job._id }).select('_id source.row').lean();
  return points.map((p) => ({ id: String(p._id), row: p.source && p.source.row })).sort((a, b) => a.row - b.row);
}

/**
 * @param {object} job  freshly loaded CaptureJob (the caller verified owner + project permission)
 * @param {{crs?: string|null}} context project context
 */
async function confirmJob(job, { crs = null } = {}) {
  if (job.status === 'confirmed') {
    return { alreadyConfirmed: true, pointIds: (job.importedPointIds || []).map(String), job };
  }
  if (job.status !== 'needs_review') throw new CaptureError('INVALID_STATE');

  // 1. re-run the deterministic validation on the stored table
  const config = getConfig();
  const evaluated = evaluateTable(job.table, { crs, confidenceThreshold: config.confidenceThreshold });
  if (!evaluated.summary.canConfirm) {
    throw new CaptureError('VALIDATION_ERRORS', {
      summary: evaluated.summary,
      errors: evaluated.table.rows.flatMap((r) => r.cells.flatMap((c) => c.validation.issues.filter((i) => i.severity === 'error').map((i) => ({ row: r.index, col: c.col, code: i.code })))).slice(0, 100),
      tableErrors: evaluated.table.issues.filter((i) => i.severity === 'error').map((i) => ({ code: i.code, semantic: i.semantic })),
    });
  }

  // 2. pre-flight conflicts (nothing is written yet)
  const conflicts = await findConflicts(job.project, evaluated.rows, job._id);
  if (conflicts.length) throw new CaptureError('POINT_CONFLICTS', { conflicts });

  // 3. claim the import atomically: only one confirm proceeds
  const claimed = await CaptureJob.findOneAndUpdate(
    { _id: job._id, status: 'needs_review', confirmClaimedAt: null },
    { $set: { confirmClaimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await CaptureJob.findById(job._id);
    if (fresh && fresh.status === 'confirmed') return { alreadyConfirmed: true, pointIds: (fresh.importedPointIds || []).map(String), job: fresh };
    throw new CaptureError('CONFIRM_IN_PROGRESS');
  }

  // 4. import with provenance
  const docs = evaluated.rows.map((r) => ({
    user: claimed.user,
    projectId: claimed.project,
    name: r.name,
    code: r.code,
    x: r.x,
    y: r.y,
    h: r.h,
    pointClass: '',
    layer: 'default',
    notes: r.notes,
    source: { kind: 'capture', captureJobId: claimed._id, row: r.row, cells: r.cells },
  }));
  let pointIds;
  try {
    // rows a previous, interrupted run already created are not created again (the unique (job,row) index is the guard)
    const present = new Set((await existingImport(claimed)).map((p) => p.row));
    const missing = docs.filter((d) => !present.has(d.source.row));
    if (missing.length) {
      try {
        await SurveyPoint.insertMany(missing, { ordered: true });
      } catch (e) {
        if (!isDuplicateKey(e)) throw e; // a concurrent run created some of them: fine, they are read back below
      }
    }
    pointIds = (await existingImport(claimed)).map((p) => p.id);
  } catch {
    await SurveyPoint.deleteMany({ 'source.captureJobId': claimed._id }).catch(() => {});
    await CaptureJob.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
    throw new CaptureError('IMPORT_FAILED');
  }
  if (pointIds.length !== docs.length) {
    await SurveyPoint.deleteMany({ 'source.captureJobId': claimed._id }).catch(() => {});
    await CaptureJob.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
    throw new CaptureError('IMPORT_FAILED');
  }

  // 5. mark confirmed
  claimed.status = 'confirmed';
  claimed.confirmedAt = new Date();
  claimed.importedPointIds = pointIds;
  claimed.table = evaluated.table;
  claimed.validationSummary = evaluated.summary;
  claimed.crs = crs;
  claimed.markModified('table');
  claimed.markModified('validationSummary');
  await claimed.save();
  return { alreadyConfirmed: false, pointIds, job: claimed };
}

module.exports = { confirmJob, findConflicts };
