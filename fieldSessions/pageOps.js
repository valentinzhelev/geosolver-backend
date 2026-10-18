/**
 * Page operations of a capture-backed Field Session: attach, detach, reorder.
 *
 * Every operation is ONE compare-and-set on the session document: the filter carries the revision the caller read, the
 * "still open" state (draft/review, no confirm claimed) and the source kind, and the update rewrites the whole `sources`
 * array (dense order, legacy mirror - see pages.js#pageWrite). So two concurrent operations cannot both win, an operation
 * can never land after a confirm claimed the session, and a reorder can never lose or duplicate a page.
 *
 * Cross-session ownership (a CaptureJob is a page of at most ONE session) is MongoDB's own unique partial multikey index on
 * `sources.captureJobId`; a violation surfaces as E11000 and becomes CAPTURE_ALREADY_ATTACHED. The same job twice inside ONE
 * session is rejected here (an unique index cannot see inside one document's array).
 *
 * None of these touches a CaptureJob or the OCR provider: detaching never deletes the capture, reordering never re-reads a
 * page, and a session's metadata change never re-runs anything.
 */
const FieldSession = require('../models/FieldSession');
const CaptureJob = require('../models/CaptureJob');
const { FieldSessionError } = require('./errors');
const { pagesOf, pageWrite, withInserted, validateOrder, maxPages } = require('./pages');

const isDuplicateKey = (e) => e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some((w) => w.code === 11000)));

/** A page whose job was confirmed - or is being confirmed - through the capture flow: the session can no longer change. */
async function pagesLocked(jobIds) {
  if (!jobIds.length) return false;
  const busy = await CaptureJob.find({ _id: { $in: jobIds }, $or: [{ status: 'confirmed' }, { confirmClaimedAt: { $ne: null } }] });
  return busy.length > 0;
}

/** Why a compare-and-set matched nothing: a confirm got in first (locked) or somebody else changed the session. */
async function explainMiss(sessionId) {
  const fresh = await FieldSession.findById(sessionId);
  if (!fresh) return new FieldSessionError('NOT_FOUND');
  if (fresh.status === 'confirmed' || fresh.confirmClaimedAt) return new FieldSessionError('SESSION_CONFIRMED');
  return new FieldSessionError('REVISION_CONFLICT');
}

async function writePages(session, jobIds, extraSet = {}) {
  const kind = session.source && session.source.kind ? session.source.kind : null;
  const filter = { _id: session._id, revision: session.revision, status: { $in: ['draft', 'review'] }, confirmClaimedAt: null, 'source.kind': kind };
  let updated;
  try {
    updated = await FieldSession.findOneAndUpdate(filter, { $set: { ...pageWrite(jobIds, pagesOf(session)), ...extraSet }, $inc: { revision: 1 } }, { new: true });
  } catch (e) {
    if (isDuplicateKey(e)) throw new FieldSessionError('CAPTURE_ALREADY_ATTACHED');
    throw e;
  }
  if (!updated) throw await explainMiss(session._id);
  return updated;
}

/**
 * @param {object} session the freshly loaded session
 * @param {object} job     an already validated attachable CaptureJob (own, same project, notebook mode - see the route)
 * @param {{position?: number, strict?: boolean}} [opts] `strict`: the job already being a page is an error (PAGE_DUPLICATE);
 *   otherwise it is an idempotent no-op (the original attach-capture contract)
 * @returns {Promise<{session: object, changed: boolean}>}
 */
async function attachPage(session, job, { position, strict = false } = {}) {
  const ids = pagesOf(session).map((p) => p.captureJobId);
  const jobId = String(job._id);
  if (ids.includes(jobId)) {
    if (strict) throw new FieldSessionError('PAGE_DUPLICATE');
    return { session, changed: false };
  }
  const limit = maxPages();
  if (ids.length >= limit) throw new FieldSessionError('PAGE_LIMIT_REACHED', { maxPages: limit });
  if (await pagesLocked(ids)) throw new FieldSessionError('SESSION_CONFIRMED');

  // a session that held an EMPTY manual draft becomes capture-backed (the route refuses one that has entries)
  const wasManual = session.source && session.source.kind === 'manual';
  const updated = await writePages(session, withInserted(ids, jobId, position), wasManual ? { setups: [] } : {});

  // Dekker-style re-check: if an existing page was claimed by the capture flow between the check above and the write, the
  // capture flow's own guard (routes/capture.js) sees the new second page and refuses - and so do we, undoing the attach.
  if (ids.length && await pagesLocked(ids)) {
    await writePages(updated, ids).catch(() => {});
    throw new FieldSessionError('SESSION_CONFIRMED');
  }
  return { session: updated, changed: true };
}

async function detachPage(session, pageId) {
  const ids = pagesOf(session).map((p) => p.captureJobId);
  if (!ids.includes(String(pageId))) throw new FieldSessionError('PAGE_NOT_FOUND');
  if (await pagesLocked(ids)) throw new FieldSessionError('SESSION_CONFIRMED');
  return { session: await writePages(session, ids.filter((id) => id !== String(pageId))), changed: true };
}

async function reorderPages(session, requestedIds) {
  const ids = pagesOf(session).map((p) => p.captureJobId);
  const wanted = validateOrder(ids, requestedIds);
  if (wanted.every((id, i) => id === ids[i])) return { session, changed: false }; // nothing to do: no write, no revision bump
  if (await pagesLocked(ids)) throw new FieldSessionError('SESSION_CONFIRMED');
  return { session: await writePages(session, wanted), changed: true };
}

module.exports = { attachPage, detachPage, reorderPages, pagesLocked, isDuplicateKey };
