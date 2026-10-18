/**
 * Capture API - two modes: coordinate-table (V2.1/V2.2) and field-notebook (V2.3, POST body `mode`).
 *
 *   POST   /api/capture/jobs                 upload an image for a project -> OCR -> reconstructed draft
 *   GET    /api/capture/jobs?projectId=...   Capture history for a project (summaries only, newest first)
 *   GET    /api/capture/jobs/:id             the job (table or notebook, cell states, summary)
 *   GET    /api/capture/jobs/:id/image/:kind review | thumbnail image (authenticated)
 *   PATCH  /api/capture/jobs/:id/cells       review corrections and column/field mapping (rawText never changes)
 *   POST   /api/capture/jobs/:id/confirm     explicit, re-validated, idempotent confirmation:
 *                                             coordinate-table -> SurveyPoints; field-notebook -> a
 *                                             FieldObservationSet (never SurveyPoints, never a calculation)
 *
 * Every route: authentication + Pro gate + project authorization (editor or above, re-checked on every call).
 * Errors are fixed sanitized messages (capture/errors.js); provider messages, OCR text and file content never leave.
 */
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const CaptureJob = require('../models/CaptureJob');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');
const { getConfig } = require('../capture/config');
const { CaptureError, isCaptureError } = require('../capture/errors');
const { createJob, processJob, applyReviewEdits, publicJob, listJobs } = require('../capture/jobService');
const { confirmJob } = require('../capture/importService');
const { applyNotebookReviewEdits } = require('../capture/notebook/jobService');
const { evaluateNotebook } = require('../capture/notebook/validation');
const { confirmNotebookJob } = require('../capture/notebook/importService');
const { assertWithinQuota } = require('../capture/quota');
const { getStorage } = require('../capture/storage');
const FieldSession = require('../models/FieldSession');
const { pagesOf, ownerOfJob } = require('../fieldSessions/pages');

const VALID_MODES = ['coordinate-table', 'field-notebook'];

const router = express.Router();
router.use(auth, requireActiveSubscription);

const config = getConfig();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxBytes, files: 1, fields: 5, parts: 8 } });

const fail = (res, err, jobId) => {
  if (isCaptureError(err)) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(jobId ? { jobId } : {}), ...err.extra });
  }
  console.error('capture: unexpected error', { name: err && err.name }); // no message, no content
  return res.status(500).json({ success: false, code: 'INTERNAL', message: 'Грешка.' });
};
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => fail(res, e));

/** Project authorization (re-checked on every call): editor or above. Returns the project's CRS. */
async function requireProjectEditor(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  if (!access.ok || !hasMinRole(access.role, 'editor')) throw new CaptureError('PROJECT_FORBIDDEN');
  return { crs: access.project.crs || null };
}

async function loadOwnedJob(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new CaptureError('NOT_FOUND');
  const job = await CaptureJob.findById(req.params.id);
  if (!job || String(job.user) !== String(req.userId)) throw new CaptureError('NOT_FOUND'); // never reveal others' jobs
  const ctx = await requireProjectEditor(req.userId, job.project);
  return { job, ctx };
}

router.post('/jobs', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return fail(res, new CaptureError('IMAGE_TOO_LARGE'));
    return fail(res, new CaptureError('INVALID_REQUEST'));
  });
}, wrap(async (req, res) => {
  const projectId = req.body && req.body.projectId;
  if (!projectId || !mongoose.isValidObjectId(projectId)) throw new CaptureError('PROJECT_REQUIRED');
  const mode = req.body.mode === undefined ? 'coordinate-table' : req.body.mode;
  if (!VALID_MODES.includes(mode)) throw new CaptureError('INVALID_REQUEST');
  const ctx = await requireProjectEditor(req.userId, projectId); // no project access -> no CaptureJob
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) throw new CaptureError('NO_FILE');
  await assertWithinQuota(req.userId, config.monthlyQuota);

  const job = await createJob({ userId: req.userId, projectId, buffer: req.file.buffer, originalName: req.file.originalname, mode });
  await processJob(job, ctx);
  if (job.status === 'failed') return fail(res, new CaptureError(job.failure.code), String(job._id));
  return res.status(201).json({ success: true, data: publicJob(job) });
}));

router.get('/jobs', wrap(async (req, res) => {
  const projectId = req.query && req.query.projectId;
  if (!projectId || !mongoose.isValidObjectId(projectId)) throw new CaptureError('PROJECT_REQUIRED');
  await requireProjectEditor(req.userId, projectId); // re-checked on every call, like every other route here
  const jobs = await listJobs(req.userId, projectId, { limit: req.query.limit });
  res.json({ success: true, data: jobs });
}));

router.get('/jobs/:id', wrap(async (req, res) => {
  const { job } = await loadOwnedJob(req);
  // A page that belongs to a Field Session is shown the way the SESSION judges it: a leading table without a station line is the
  // continuation of the previous page, not an unidentified station. Display only (nothing is stored); a standalone capture is
  // shown exactly as stored, and its confirm still refuses a blank station.
  if (job.mode === 'field-notebook' && job.notebook && job.status === 'needs_review' && await findSessionOwner(job._id)) {
    const ev = evaluateNotebook(job.notebook, { arbitration: config.arbitration, allowContinuation: true });
    const plain = typeof job.toObject === 'function' ? job.toObject() : { ...job };
    return res.json({ success: true, data: publicJob({ ...plain, notebook: ev.notebook, validationSummary: ev.summary }) });
  }
  res.json({ success: true, data: publicJob(job) });
}));

router.get('/jobs/:id/image/:kind', wrap(async (req, res) => {
  const { job } = await loadOwnedJob(req);
  const kind = req.params.kind;
  if (!['review', 'thumbnail'].includes(kind)) throw new CaptureError('NOT_FOUND');
  const assetId = job.source && job.source.assets && job.source.assets[kind];
  if (!assetId) throw new CaptureError('NOT_FOUND');
  const asset = await getStorage().get(assetId);
  if (!asset) throw new CaptureError('IMAGE_EXPIRED');
  res.set({ 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(asset.buffer);
}));

router.patch('/jobs/:id/cells', express.json({ limit: '256kb' }), wrap(async (req, res) => {
  const { job, ctx } = await loadOwnedJob(req);
  if (job.mode === 'field-notebook') await applyNotebookReviewEdits(job, req.body || {}, config, { allowContinuation: !!(await findSessionOwner(job._id)) });
  else await applyReviewEdits(job, req.body || {}, ctx);
  res.json({ success: true, data: publicJob(job) });
}));

/**
 * A notebook page that belongs to a Field Session of TWO OR MORE pages is only ever confirmed as part of that session (one
 * merged FieldObservationSet) - confirming one page alone would create a second, partial piece of authoritative evidence.
 * A single-page session may still be confirmed here (the original flow). Runs before AND, via `guard`, after the claim.
 */
const findSessionOwner = (jobId) => FieldSession.findOne(ownerOfJob(jobId));

async function refuseIfSessionPage(jobId) {
  const owner = await findSessionOwner(jobId);
  if (owner && (owner.status === 'confirmed' || pagesOf(owner).length >= 2)) throw new CaptureError('BELONGS_TO_SESSION');
}

router.post('/jobs/:id/confirm', wrap(async (req, res) => {
  const { job, ctx } = await loadOwnedJob(req); // the body is ignored: the server never trusts a client-supplied table
  if (job.mode === 'field-notebook') {
    if (job.status !== 'confirmed') await refuseIfSessionPage(job._id);
    const result = await confirmNotebookJob(job, { guard: (claimed) => refuseIfSessionPage(claimed._id) });
    return res.json({ success: true, alreadyConfirmed: result.alreadyConfirmed, observationSetId: result.observationSetId, data: publicJob(result.job) });
  }
  const result = await confirmJob(job, ctx);
  res.json({ success: true, alreadyConfirmed: result.alreadyConfirmed, importedCount: result.pointIds.length, pointIds: result.pointIds, data: publicJob(result.job) });
}));

module.exports = router;
