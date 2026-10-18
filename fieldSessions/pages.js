/**
 * Notebook pages of a capture-backed Field Session (pure helpers, no I/O).
 *
 * A session's pages live in `session.sources` - an ORDERED array of `{ kind:'capture', captureJobId, order, addedAt }`.
 * Records written before multi-page sessions have no `sources` (the field is absent, not empty) and a single
 * `source.captureJobId`; `pagesOf` reads such a record as exactly one page, so nothing has to be rewritten for it to
 * keep working. The legacy field stays as a MIRROR of page 1 whenever a page operation writes (`pageWrite`), so code
 * that only knows the old shape - an older deployment, a rollback - still sees a sensible first capture.
 *
 * The page id exposed through the API is the CaptureJob id string: stable across the legacy projection and the new
 * structure, and an opaque handle the UI never prints.
 */
const { FieldSessionError } = require('./errors');
const { getConfig } = require('./config');

const idStr = (v) => (v === null || v === undefined ? null : String(v));

/** True when the record carries the multi-page structure (even if it currently holds no page). */
const hasPages = (session) => Array.isArray(session && session.sources);

/**
 * The session's pages in page order, as plain `{ pageId, captureJobId, order, addedAt }` - `order` re-derived densely
 * (0..n-1) from the persisted order so a hand-edited or partially migrated record still reads deterministically
 * (ties broken by `addedAt`, then job id - never by array position alone).
 */
function pagesOf(session) {
  if (!session) return [];
  let raw = [];
  if (hasPages(session)) {
    raw = session.sources.filter((s) => s && s.captureJobId).map((s) => ({ captureJobId: idStr(s.captureJobId), order: Number.isFinite(s.order) ? s.order : 0, addedAt: s.addedAt || null }));
  } else if (session.source && session.source.kind === 'capture' && session.source.captureJobId) {
    raw = [{ captureJobId: idStr(session.source.captureJobId), order: 0, addedAt: session.createdAt || null }];
  }
  const t = (d) => (d ? new Date(d).getTime() : 0);
  raw.sort((a, b) => a.order - b.order || t(a.addedAt) - t(b.addedAt) || (a.captureJobId < b.captureJobId ? -1 : 1));
  return raw.map((p, i) => ({ pageId: p.captureJobId, captureJobId: p.captureJobId, order: i, addedAt: p.addedAt }));
}

const isCaptureBacked = (session) => !!(session && session.source && session.source.kind === 'capture');

/** Mongo filter: the session that owns a CaptureJob as a page - in the new structure OR the legacy field. */
const ownerOfJob = (captureJobId) => ({ $or: [{ 'sources.captureJobId': captureJobId }, { 'source.captureJobId': captureJobId }] });

/**
 * The fields a page operation writes for a given ordered list of job ids: the whole `sources` array (dense order),
 * `source.kind` (null again when no page is left, so a manual entry may start), and the legacy mirror of page 1.
 * @param {string[]} jobIds ids in the new page order
 * @param {object[]} [previous] the session's current pages (to keep each page's original `addedAt`)
 */
function pageWrite(jobIds, previous = []) {
  const added = new Map(previous.map((p) => [p.captureJobId, p.addedAt]));
  const now = new Date();
  return {
    'source.kind': jobIds.length ? 'capture' : null,
    'source.captureJobId': jobIds.length ? jobIds[0] : null,
    sources: jobIds.map((id, order) => ({ kind: 'capture', captureJobId: id, order, addedAt: added.get(id) || now })),
  };
}

/** New order of ids after inserting `jobId` at `position` (0-based; absent/out of range = at the end). */
function withInserted(ids, jobId, position) {
  const at = Number.isInteger(position) && position >= 0 && position <= ids.length ? position : ids.length;
  return [...ids.slice(0, at), jobId, ...ids.slice(at)];
}

/**
 * Validates a client-supplied page order: it must be EXACTLY the current set of page ids (no more, no fewer, no
 * duplicates) - reordering can never add, drop or invent a page.
 * @returns {string[]} the validated order
 */
function validateOrder(currentIds, requested) {
  if (!Array.isArray(requested) || requested.length !== currentIds.length) throw new FieldSessionError('INVALID_REQUEST');
  const wanted = requested.map(String);
  if (new Set(wanted).size !== wanted.length) throw new FieldSessionError('INVALID_REQUEST');
  const have = new Set(currentIds);
  if (!wanted.every((id) => have.has(id))) throw new FieldSessionError('INVALID_REQUEST');
  return wanted;
}

const maxPages = () => getConfig().limits.maxPages;

module.exports = { hasPages, pagesOf, isCaptureBacked, ownerOfJob, pageWrite, withInserted, validateOrder, maxPages };
