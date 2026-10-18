/**
 * One-time, ADDITIVE migration for multi-page Field Sessions.
 *
 * WHAT CHANGED: a capture-backed Field Session used to hold ONE CaptureJob in `source.captureJobId`. It now holds
 * ordered pages in `sources` (see models/FieldSession.js, fieldSessions/pages.js). The application already reads an
 * old record as a one-page session (`pagesOf`), so NOTHING in this script is needed for old sessions to keep working.
 * What it adds is the database-level guarantee that a CaptureJob is a page of at most ONE session:
 *   1. BACKFILL  - every legacy capture-backed session (source.kind 'capture', an ObjectId source.captureJobId, no
 *                  `sources`) gets `sources: [{ kind:'capture', captureJobId, order: 0, addedAt }]`. Nothing is removed or
 *                  rewritten: the legacy `source.captureJobId` stays as it is (it is the mirror of page 1).
 *   2. INDEX     - creates the unique partial multikey index `sources_captureJobId_unique_partial` (Mongoose's autoIndex
 *                  also builds it when the new code boots; this script makes it explicit and verified).
 *
 * SAFE and IDEMPOTENT: it never deletes data or drops an index; running it again after success is a no-op.
 * DRY-RUN by default - prints the plan and the document check and changes nothing.
 *
 * DOCUMENT CHECK (always runs, dry-run and --apply): before touching anything the collection is scanned for data that
 * would make the unique index impossible to build or silently weaker than it should be:
 *   - a CaptureJob referenced by MORE THAN ONE session (across `source.captureJobId` and `sources`)
 *   - a CaptureJob listed twice inside ONE session's `sources`
 *   - a capture id that is present but not an ObjectId (a partial index only covers ObjectId values)
 * Any of these is UNSAFE: the script prints what it found and exits non-zero, and --apply REFUSES to change anything.
 * Capture-backed sessions without any capture id are notes only. Fix UNSAFE data by hand, then re-run.
 *
 * Requires MongoDB >= 4.2 (the backfill is a pipeline-style update).
 *
 * Usage:
 *   node scripts/migrate-field-session-pages.js            # dry run (plan + document check)
 *   node scripts/migrate-field-session-pages.js --apply    # backfill `sources`, create the index
 *
 * Exit code: 0 = SAFE (and applied when --apply), 1 = UNSAFE or an error.
 *
 * Rollback: nothing destructive happened. To undo, drop the index (`db.fieldsessions.dropIndex(
 * 'sources_captureJobId_unique_partial')`); the backfilled `sources` arrays are ignored by older code. Do not roll the
 * APPLICATION back once sessions with several pages exist (older code only knows page 1).
 */
const INDEX = { name: 'sources_captureJobId_unique_partial', key: { 'sources.captureJobId': 1 }, partial: { 'sources.captureJobId': { $type: 'objectId' } } };
const SAMPLE_LIMIT = 10;

const NEEDS_BACKFILL = { 'source.kind': 'capture', 'source.captureJobId': { $type: 'objectId' }, sources: { $exists: false } };

/**
 * Pure: what to do from the collection's current indexes and the number of legacy sessions still to backfill.
 * @returns {{backfill: number, create: object[]}}
 */
function planPagesMigration(indexes, backfillCount) {
  const have = new Set(indexes.map((i) => i.name));
  return { backfill: backfillCount, create: have.has(INDEX.name) ? [] : [INDEX] };
}

// every capture id a session references, from BOTH structures, as one array of ObjectIds
const idsExpr = {
  $setUnion: [
    { $cond: [{ $eq: [{ $type: '$source.captureJobId' }, 'objectId'] }, ['$source.captureJobId'], []] },
    { $filter: { input: { $ifNull: ['$sources.captureJobId', []] }, cond: { $eq: [{ $type: '$$this' }, 'objectId'] } } },
  ],
};
const CHECKS = {
  sharedAcrossSessions: [
    { $project: { ids: idsExpr } },
    { $unwind: '$ids' },
    { $group: { _id: '$ids', sessions: { $addToSet: '$_id' } } },
    { $match: { 'sessions.1': { $exists: true } } },
  ],
  repeatedWithinSession: [
    { $project: { arr: { $ifNull: ['$sources.captureJobId', []] } } },
    { $match: { $expr: { $ne: [{ $size: '$arr' }, { $size: { $setUnion: ['$arr', []] } }] } } },
  ],
  legacyIdNotObjectId: { 'source.kind': 'capture', 'source.captureJobId': { $exists: true, $not: { $type: 'objectId' }, $ne: null } },
  pageIdNotObjectId: { sources: { $elemMatch: { captureJobId: { $not: { $type: 'objectId' } } } } },
  captureWithoutId: { 'source.kind': 'capture', 'source.captureJobId': { $not: { $type: 'objectId' } }, sources: { $exists: false } },
};

/** Scans the collection (read-only). Plain findings; the verdict is `judgeFindings`. */
async function findViolations(coll) {
  const shared = await coll.aggregate([...CHECKS.sharedAcrossSessions, { $limit: SAMPLE_LIMIT }]).toArray();
  const sharedTotal = ((await coll.aggregate([...CHECKS.sharedAcrossSessions, { $count: 'n' }]).toArray())[0] || {}).n || 0;
  const repeated = ((await coll.aggregate([...CHECKS.repeatedWithinSession, { $count: 'n' }]).toArray())[0] || {}).n || 0;
  return {
    jobsInSeveralSessions: { total: sharedTotal, sample: shared.map((d) => ({ id: String(d._id), sessions: d.sessions.length })) },
    sessionsWithRepeatedPage: repeated,
    legacyIdNotObjectId: await coll.countDocuments(CHECKS.legacyIdNotObjectId),
    pageIdNotObjectId: await coll.countDocuments(CHECKS.pageIdNotObjectId),
    captureWithoutId: await coll.countDocuments(CHECKS.captureWithoutId),
    toBackfill: await coll.countDocuments(NEEDS_BACKFILL),
  };
}

/** Pure: SAFE / UNSAFE from the findings. @returns {{safe: boolean, problems: string[], notes: string[]}} */
function judgeFindings(f) {
  const problems = [];
  const notes = [];
  if (f.jobsInSeveralSessions.total > 0) problems.push(`${f.jobsInSeveralSessions.total} CaptureJob(s) are referenced by more than one session (the unique index could not be built)`);
  if (f.sessionsWithRepeatedPage > 0) problems.push(`${f.sessionsWithRepeatedPage} session(s) list the same CaptureJob more than once among their pages`);
  if (f.legacyIdNotObjectId > 0) problems.push(`${f.legacyIdNotObjectId} session(s) have a source.captureJobId that is not an ObjectId (it could not be carried into the unique index)`);
  if (f.pageIdNotObjectId > 0) problems.push(`${f.pageIdNotObjectId} session(s) have a page whose captureJobId is not an ObjectId (the partial index would silently skip it)`);
  if (f.captureWithoutId > 0) notes.push(`${f.captureWithoutId} capture-backed session(s) have no capture id at all (nothing to backfill; not a conflict)`);
  return { safe: problems.length === 0, problems, notes };
}

// a collection that does not exist yet has nothing to violate
const emptyFindings = () => ({ jobsInSeveralSessions: { total: 0, sample: [] }, sessionsWithRepeatedPage: 0, legacyIdNotObjectId: 0, pageIdNotObjectId: 0, captureWithoutId: 0, toBackfill: 0 });

/**
 * Runs the whole migration against one collection (everything except the connection, so it is testable). The document
 * check comes BEFORE anything is changed; an UNSAFE verdict returns before the backfill/index block - dry-run and
 * --apply alike. Resolves the process exit code (0 SAFE, 1 UNSAFE).
 * @param {object} coll a Mongo collection (indexes, aggregate, countDocuments, updateMany, createIndex)
 * @param {{apply?: boolean, log?: Function, error?: Function}} [opts]
 * @returns {Promise<number>}
 */
async function runMigration(coll, { apply = false, log = console.log, error = console.error } = {}) {
  const missing = (e) => (e && e.codeName === 'NamespaceNotFound' ? null : Promise.reject(e));
  const indexes = await coll.indexes().catch((e) => missing(e) || []);
  const findings = await findViolations(coll).catch((e) => missing(e) || emptyFindings());
  const plan = planPagesMigration(indexes, findings.toBackfill);
  log('Current indexes:', indexes.map((i) => i.name).join(', ') || '(none)');
  log('Plan:', JSON.stringify({ backfillSessions: plan.backfill, createIndexes: plan.create.map((c) => c.name) }));
  const verdict = judgeFindings(findings);
  log('Document check:', JSON.stringify(findings));
  for (const n of verdict.notes) log('Note:', n);
  if (!verdict.safe) {
    error('Result: UNSAFE');
    for (const p of verdict.problems) error(' -', p);
    error(apply ? 'Refusing to --apply: nothing was changed. Fix the data above and re-run.' : 'Dry run only - nothing was changed. Fix the data above before running with --apply.');
    return 1;
  }
  log('Result: SAFE');

  if (!plan.backfill && !plan.create.length) { log('Nothing to do.'); return 0; }
  if (!apply) { log('Dry run - re-run with --apply to execute.'); return 0; }
  if (plan.backfill) {
    const res = await coll.updateMany(NEEDS_BACKFILL, [
      { $set: { sources: [{ kind: 'capture', captureJobId: '$source.captureJobId', order: 0, addedAt: { $ifNull: ['$createdAt', '$$NOW'] } }] } },
    ]);
    log('Backfilled', res && res.modifiedCount !== undefined ? res.modifiedCount : plan.backfill, 'session(s)');
  }
  for (const c of plan.create) {
    await coll.createIndex(c.key, { unique: true, name: c.name, partialFilterExpression: c.partial });
    log('Created', c.name);
  }
  log('Done.');
  return 0;
}

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    process.exitCode = await runMigration(mongoose.connection.collection('fieldsessions'), { apply: process.argv.includes('--apply') });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('Migration failed:', e && e.message); process.exit(1); });
}

module.exports = { planPagesMigration, findViolations, judgeFindings, runMigration, CHECKS, NEEDS_BACKFILL, INDEX };
