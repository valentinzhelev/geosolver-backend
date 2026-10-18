/**
 * Field Sessions API (Теренна сесия) - the front door of the field-to-office workflow.
 *
 *   POST   /api/field-sessions                      create a session (optionally attach a Field Notebook capture)
 *   GET    /api/field-sessions?projectId=...        a project's sessions (summaries, newest first) + legacy carnet counts
 *   GET    /api/field-sessions/:id                  one session: entries, review, evidence, processing, documents
 *   PATCH  /api/field-sessions/:id                  metadata and/or manual entries (draft/review only, revision-checked)
 *   POST   /api/field-sessions/:id/submit           move to "За проверка" (manual)
 *   POST   /api/field-sessions/:id/confirm          explicit, re-validated, idempotent -> ONE immutable evidence set (manual entries,
 *                                                   or all the pages merged)
 *   POST   /api/field-sessions/:id/attach-capture   attach ONE Field Notebook capture as the session's source (original contract)
 *   POST   /api/field-sessions/:id/pages            add a notebook page (a Field Notebook capture) at the end or at `position`
 *   DELETE /api/field-sessions/:id/pages/:pageId    detach a page (the capture itself is never deleted; only before confirmation)
 *   PATCH  /api/field-sessions/:id/pages/reorder    set the page order (exactly the current pages; never re-runs OCR)
 *   POST   /api/field-sessions/:id/instrument-import   upload an instrument file (Leica GSI-8 / GSI-16) as the session's source
 *   PATCH  /api/field-sessions/:id/instrument-import   the review decisions (orientation per setup, excluded records, station)
 *   DELETE /api/field-sessions/:id/instrument-import   remove the file before confirmation (the import record is kept, detached)
 *   POST   /api/field-sessions/:id/revise           start a NEW editable session from confirmed evidence (correction)
 *   DELETE /api/field-sessions/:id                  remove an unconfirmed session (never confirmed evidence)
 *
 * Every route: authentication + project access re-checked on every call (read = viewer, write = editor). A session
 * is a shared PROJECT resource (like a processing run). No Pro gate: manual entry has no external cost; the OCR
 * upload that may feed a session is gated by the Capture routes it already goes through.
 * Client input is never trusted for results: entries are RAW TEXT, interpretation/validation/confirmation are
 * server-side, and the observation set a confirm creates is built from the stored entries only.
 */
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');
const FieldSession = require('../models/FieldSession');
const FieldObservationSet = require('../models/FieldObservationSet');
const CaptureJob = require('../models/CaptureJob');
const FieldBook = require('../models/FieldBook');
const { FieldSessionError, isFieldSessionError } = require('../fieldSessions/errors');
const { normalizeSetups, normalizeMetadata } = require('../fieldSessions/entry');
const { setupsToRaw } = require('../fieldSessions/revise');
const { buildViews, confirmManualSession, manualObservationCount, isDuplicateKey } = require('../fieldSessions/service');
const { confirmCaptureSession } = require('../fieldSessions/captureConfirm');
const { attachPage, detachPage, reorderPages } = require('../fieldSessions/pageOps');
const { pagesOf, pageWrite, ownerOfJob, isCaptureBacked } = require('../fieldSessions/pages');
const {
  importInstrumentFile, updateInstrumentDecisions, detachInstrumentImport, confirmInstrumentSession, reviseInstrumentSession,
} = require('../fieldSessions/instrumentOps');
const { InstrumentImportError, isInstrumentImportError } = require('../instrumentImport/errors');
const { getConfig: getImportConfig } = require('../instrumentImport/config');

const router = express.Router();
router.use(auth);
router.use(express.json({ limit: '512kb' }));

// instrument files: memory only (never written to disk, never a path), one file, a handful of fields
const instrumentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: getImportConfig().limits.maxBytes, files: 1, fields: 4, parts: 6 } });

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (isFieldSessionError(e)) return res.status(e.status).json({ success: false, code: e.code, message: e.message, ...e.extra });
  if (isInstrumentImportError(e)) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  console.error('field-sessions: unexpected error', { name: e && e.name }); // never the message/content
  return res.status(500).json({ success: false, code: 'INTERNAL', message: 'Грешка.' });
});

const validId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

async function requireProject(req, projectId, minRole) {
  if (!validId(projectId)) throw new FieldSessionError('INVALID_REQUEST');
  const access = await getProjectAccess(req.userId, projectId);
  if (!access.ok) throw new FieldSessionError('NOT_FOUND'); // never reveal a project the caller cannot see
  if (!hasMinRole(access.role, minRole)) throw new FieldSessionError('FORBIDDEN');
  return access;
}

async function loadSession(req, minRole) {
  if (!validId(req.params.id)) throw new FieldSessionError('NOT_FOUND');
  const session = await FieldSession.findById(req.params.id);
  if (!session) throw new FieldSessionError('NOT_FOUND');
  await requireProject(req, String(session.projectId), minRole);
  return session;
}

const isLocked = (session) => session.status === 'confirmed' || !!session.confirmClaimedAt;

/**
 * A capture may become a page of a session only when it is this user's own Field Notebook in the SAME project, not a page of
 * another session. Every refusal for "not yours / not here" is the same CAPTURE_NOT_FOUND - nothing about someone else's
 * capture (or another project's) is revealed.
 * @param {{allowFailed?: boolean, rejectConfirmed?: boolean}} [opts] pages may be FAILED captures (shown retryable);
 *   a CONFIRMED capture is never a new page (it is already evidence of its own)
 */
async function resolveAttachableJob(req, projectId, captureJobId, exceptSessionId = null, { allowFailed = false, rejectConfirmed = false } = {}) {
  if (!validId(captureJobId)) throw new FieldSessionError('INVALID_REQUEST');
  const job = await CaptureJob.findById(captureJobId);
  if (!job || String(job.project) !== String(projectId) || String(job.user) !== String(req.userId)) throw new FieldSessionError('CAPTURE_NOT_FOUND');
  if (job.mode !== 'field-notebook') throw new FieldSessionError('CAPTURE_NOT_NOTEBOOK');
  if (job.status === 'failed' && !allowFailed) throw new FieldSessionError('CAPTURE_FAILED');
  if (job.status === 'confirmed' && rejectConfirmed) throw new FieldSessionError('CAPTURE_CONFIRMED');
  const other = await FieldSession.findOne(ownerOfJob(job._id));
  if (other && String(other._id) !== String(exceptSessionId)) throw new FieldSessionError('CAPTURE_ALREADY_ATTACHED');
  return job;
}

async function viewOne(req, session) {
  const [view] = await buildViews(String(session.projectId), [session], { userId: req.userId, detail: true });
  return view;
}

router.post('/', wrap(async (req, res) => {
  const body = req.body || {};
  await requireProject(req, body.projectId, 'editor');
  const meta = normalizeMetadata(body);
  const doc = { user: req.userId, projectId: body.projectId, ...meta, status: 'draft', setups: [] };
  if (body.captureJobId !== undefined) {
    const job = await resolveAttachableJob(req, body.projectId, body.captureJobId);
    const first = pageWrite([String(job._id)]);
    doc.source = { kind: 'capture', captureJobId: job._id };
    doc.sources = first.sources;
  } else if (body.setups !== undefined) {
    doc.setups = normalizeSetups(body.setups);
    doc.source = { kind: 'manual' };
  }
  let session;
  try {
    session = await FieldSession.create(doc);
  } catch (e) {
    if (isDuplicateKey(e)) throw new FieldSessionError('CAPTURE_ALREADY_ATTACHED');
    throw e;
  }
  res.status(201).json({ success: true, data: await viewOne(req, session) });
}));

router.get('/', wrap(async (req, res) => {
  const projectId = req.query && req.query.projectId;
  await requireProject(req, projectId, 'viewer');
  const sessions = await FieldSession.find({ projectId }).sort({ createdAt: -1 }).limit(200);
  const [views, books] = await Promise.all([
    buildViews(projectId, sessions, { userId: req.userId }),
    FieldBook.find({ project: projectId }).select('type archived').lean(),
  ]);
  // legacy digital carnets (models/FieldBook.js): COUNTS only - their content stays behind their own pilot gate
  const active = books.filter((b) => !b.archived);
  res.json({
    success: true,
    data: views,
    attachedCaptureJobIds: [...new Set(sessions.flatMap((x) => pagesOf(x).map((p) => p.captureJobId)))],
    legacyFieldBooks: { total: books.length, active: active.length },
  });
}));

router.get('/:id', wrap(async (req, res) => {
  const session = await loadSession(req, 'viewer');
  res.json({ success: true, data: await viewOne(req, session) });
}));

router.patch('/:id', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  const body = req.body || {};

  const $set = normalizeMetadata(body);
  if (body.setups !== undefined) {
    if (session.source && (session.source.kind === 'capture' || session.source.kind === 'instrument')) throw new FieldSessionError('SOURCE_CONFLICT');
    $set.setups = normalizeSetups(body.setups);
    $set['source.kind'] = 'manual';
  }
  if (!Object.keys($set).length) throw new FieldSessionError('INVALID_REQUEST');
  const baseRevision = body.baseRevision === undefined ? session.revision : Number(body.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision !== session.revision) throw new FieldSessionError('REVISION_CONFLICT');

  // the revision AND the not-locked state are part of the write itself: a concurrent save, attach or confirm that
  // got in first makes this update match nothing, so it can never overwrite (or edit after) them
  const updated = await FieldSession.findOneAndUpdate(
    { _id: session._id, revision: baseRevision, status: { $in: ['draft', 'review'] }, confirmClaimedAt: null },
    { $set, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) throw new FieldSessionError('REVISION_CONFLICT');
  res.json({ success: true, data: await viewOne(req, updated) });
}));

router.post('/:id/submit', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  if (session.source && session.source.kind === 'capture') throw new FieldSessionError('USE_CAPTURE_REVIEW');
  const isInstrument = session.source && session.source.kind === 'instrument';
  if (!isInstrument && manualObservationCount(session.setups) === 0) throw new FieldSessionError('NOTHING_TO_SUBMIT');
  const updated = await FieldSession.findOneAndUpdate(
    { _id: session._id, status: { $in: ['draft', 'review'] }, confirmClaimedAt: null },
    { $set: { status: 'review' }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) throw new FieldSessionError('REVISION_CONFLICT');
  res.json({ success: true, data: await viewOne(req, updated) });
}));

router.post('/:id/confirm', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor'); // the body is ignored: only the stored entries / pages are ever confirmed
  const kind = session.source && session.source.kind;
  const result = isCaptureBacked(session)
    ? await confirmCaptureSession(session, req.userId)
    : kind === 'instrument' ? await confirmInstrumentSession(session, req.userId) : await confirmManualSession(session, req.userId);
  res.json({ success: true, alreadyConfirmed: result.alreadyConfirmed, data: await viewOne(req, result.session) });
}));

router.post('/:id/attach-capture', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  if (session.source && session.source.kind === 'instrument') throw new FieldSessionError('SOURCE_CONFLICT');
  const job = await resolveAttachableJob(req, String(session.projectId), (req.body || {}).captureJobId, session._id);
  const pages = pagesOf(session);
  if (pages.some((p) => p.captureJobId === String(job._id))) return res.json({ success: true, data: await viewOne(req, session) }); // idempotent
  // the original single-source contract: a session that already has a capture, or typed entries, does not silently change source
  if (pages.length || (session.source && session.source.kind === 'instrument') || (session.source && session.source.kind === 'manual' && manualObservationCount(session.setups) > 0)) throw new FieldSessionError('SOURCE_CONFLICT');
  const { session: updated } = await attachPage(session, job);
  res.json({ success: true, data: await viewOne(req, updated) });
}));

/** Optional optimistic check: a client that sends the revision it last saw is refused if the session moved on. */
const checkRevision = (session, supplied) => {
  if (supplied === undefined || supplied === null || supplied === '') return;
  if (!Number.isInteger(Number(supplied)) || Number(supplied) !== session.revision) throw new FieldSessionError('REVISION_CONFLICT');
};

router.post('/:id/pages', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  const body = req.body || {};
  if (session.source && session.source.kind === 'manual' && manualObservationCount(session.setups) > 0) throw new FieldSessionError('SOURCE_CONFLICT');
  if (session.source && session.source.kind === 'instrument') throw new FieldSessionError('SOURCE_CONFLICT');
  if (body.position !== undefined && !(Number.isInteger(body.position) && body.position >= 0)) throw new FieldSessionError('INVALID_REQUEST');
  checkRevision(session, body.baseRevision);
  const job = await resolveAttachableJob(req, String(session.projectId), body.captureJobId, session._id, { allowFailed: true, rejectConfirmed: true });
  const { session: updated } = await attachPage(session, job, { position: body.position, strict: true });
  res.status(201).json({ success: true, data: await viewOne(req, updated) });
}));

router.patch('/:id/pages/reorder', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  const body = req.body || {};
  checkRevision(session, body.baseRevision);
  const { session: updated } = await reorderPages(session, body.pageIds);
  res.json({ success: true, data: await viewOne(req, updated) });
}));

router.delete('/:id/pages/:pageId', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  if (!validId(req.params.pageId)) throw new FieldSessionError('PAGE_NOT_FOUND');
  checkRevision(session, req.query && req.query.baseRevision);
  const { session: updated } = await detachPage(session, req.params.pageId);
  res.json({ success: true, data: await viewOne(req, updated) });
}));

/**
 * Instrument file upload. Session state is checked BEFORE the file is read (a locked or conflicting session never has its
 * upload parsed); the file itself is untrusted text - see instrumentImport/text.js. A file-level refusal (not GSI, ambiguous,
 * binary, too large...) stores nothing and answers with its fixed Bulgarian message.
 */
router.post('/:id/instrument-import', (req, res, next) => {
  instrumentUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const e = err.code === 'LIMIT_FILE_SIZE' ? new InstrumentImportError('FILE_TOO_LARGE') : new FieldSessionError('INVALID_REQUEST');
    return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  });
}, wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  const kind = session.source && session.source.kind;
  if (kind === 'capture' || kind === 'instrument' || pagesOf(session).length) throw new FieldSessionError('SOURCE_CONFLICT');
  if (kind === 'manual' && manualObservationCount(session.setups) > 0) throw new FieldSessionError('SOURCE_CONFLICT');
  checkRevision(session, req.body && req.body.baseRevision);
  if (!req.file || !req.file.buffer) throw new InstrumentImportError('NO_FILE');
  const updated = await importInstrumentFile(session, req.file, req.userId);
  res.status(201).json({ success: true, data: await viewOne(req, updated) });
}));

router.patch('/:id/instrument-import', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  if (!session.source || session.source.kind !== 'instrument') throw new FieldSessionError('INSTRUMENT_IMPORT_MISSING');
  const body = req.body || {};
  const updated = await updateInstrumentDecisions(session, body.decisions, body.baseRevision);
  res.json({ success: true, data: await viewOne(req, updated) });
}));

router.delete('/:id/instrument-import', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  if (isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  if (!session.source || session.source.kind !== 'instrument') throw new FieldSessionError('INSTRUMENT_IMPORT_MISSING');
  checkRevision(session, req.query && req.query.baseRevision);
  const updated = await detachInstrumentImport(session);
  res.json({ success: true, data: await viewOne(req, updated) });
}));

router.post('/:id/revise', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  const [view] = await buildViews(String(session.projectId), [session], { userId: req.userId, detail: true });
  if (!view.confirmed || !view.observationSetId) throw new FieldSessionError('NOT_CONFIRMED');
  const fos = await FieldObservationSet.findOne({ _id: view.observationSetId, projectId: session.projectId });
  if (!fos) throw new FieldSessionError('NOT_CONFIRMED');

  const fields = {
    title: `${view.title} (ревизия)`.slice(0, 120),
    date: session.date, operator: session.operator, instrument: session.instrument, instrumentSerial: session.instrumentSerial,
    conditions: session.conditions, notes: session.notes, angleUnit: session.angleUnit,
  };
  if (session.source && session.source.kind === 'instrument') {
    // a correction of an imported file re-reads the same file (full instrument resolution), it is never retyped
    const revised = await reviseInstrumentSession(session, fields, req.userId);
    return res.status(201).json({ success: true, data: await viewOne(req, revised) });
  }

  const created = await FieldSession.create({
    user: req.userId,
    projectId: session.projectId,
    ...fields,
    source: { kind: 'manual' },
    status: 'draft',
    setups: normalizeSetups(setupsToRaw(fos.setups)),
    revisionOf: session._id,
  });
  res.status(201).json({ success: true, data: await viewOne(req, created) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const session = await loadSession(req, 'editor');
  const [view] = await buildViews(String(session.projectId), [session], { userId: req.userId });
  if (view.confirmed || isLocked(session)) throw new FieldSessionError('SESSION_CONFIRMED');
  await FieldSession.deleteOne({ _id: session._id, confirmClaimedAt: null, status: { $in: ['draft', 'review'] } });
  res.json({ success: true });
}));

module.exports = router;
