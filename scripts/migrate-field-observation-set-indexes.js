/**
 * One-time index migration for Field Sessions (V2).
 *
 * WHY: until now `fieldobservationsets` had a PLAIN unique index `source.captureJobId_1`. A Field Session's manual
 * evidence has no captureJobId, and a plain unique index treats every absent value as the same `null` - the first
 * session-origin set fits, the SECOND fails with E11000 (the API answers 503 CONFIRM_UNAVAILABLE, nothing is lost).
 * The model (models/FieldObservationSet.js) now declares PARTIAL unique indexes instead (a captureJobId index and a
 * fieldSessionId index, each only over documents that have that id).
 *
 * MongoDB 7 CAN build the new partial captureJobId index beside the old plain one (verified on 7.0.14: Mongoose's
 * autoIndex creates both new indexes when the new code boots), so the new code starts without any error. That does
 * NOT fix anything by itself: the old plain unique index is still there and still rejects the second session-origin
 * set, so it must be DROPPED for session evidence to work. Other server versions were not verified - if one refuses
 * to build the new index beside the old, the plan below (drop first, then create) still applies unchanged.
 *
 * SAFE: touches indexes only, never documents. DRY-RUN by default - prints the plan and the document check and
 * changes nothing. Idempotent: running it again after success is a no-op.
 *
 * DOCUMENT CHECK (always runs, dry-run and --apply): before any index is touched the collection is scanned for
 * documents that would break or silently bypass the new unique indexes:
 *   - the same source.captureJobId on more than one set          (the new capture index could not be built)
 *   - the same source.fieldSessionId on more than one set        (the new session index could not be built)
 *   - a source id that is present but not an ObjectId            (a partial index only covers objectId values, so such
 *                                                                 a set would silently escape the uniqueness guarantee)
 * Any of these is UNSAFE: the script prints what it found and exits non-zero, and --apply REFUSES to change anything.
 * Sets with neither id, or with an id that does not match their `kind`, are reported as notes only (they cannot
 * violate an index). Fix UNSAFE data by hand, then re-run.
 *
 * The window between "drop old" and "create new" is a single script run; capture confirms are protected in that
 * window only by their own atomic claim (CaptureJob.confirmClaimedAt), so run it at a quiet moment.
 *
 * Usage:
 *   node scripts/migrate-field-observation-set-indexes.js            # dry run (index plan + document check)
 *   node scripts/migrate-field-observation-set-indexes.js --apply    # drop old index, create the partial ones
 *
 * Exit code: 0 = SAFE (and applied when --apply), 1 = UNSAFE or an error.
 *
 * Rollback: the old index can be recreated with
 *   db.fieldobservationsets.createIndex({ 'source.captureJobId': 1 }, { unique: true })
 * but only while no session-origin set (no captureJobId) exists, or it will fail on the duplicate nulls.
 */
const OLD_NAME = 'source.captureJobId_1';
const NEW_CAPTURE = { name: 'source_captureJobId_unique_partial', key: { 'source.captureJobId': 1 }, partial: { 'source.captureJobId': { $type: 'objectId' } } };
const NEW_SESSION = { name: 'source_fieldSessionId_unique_partial', key: { 'source.fieldSessionId': 1 }, partial: { 'source.fieldSessionId': { $type: 'objectId' } } };

const SAMPLE_LIMIT = 10;

/**
 * Pure: decides what to do from the collection's current indexes.
 * @param {{name:string, key:object, unique?:boolean, partialFilterExpression?:object}[]} indexes
 * @returns {{drop: string[], create: object[]}}
 */
function planIndexMigration(indexes) {
  const byName = new Map(indexes.map((i) => [i.name, i]));
  const old = byName.get(OLD_NAME);
  const drop = old && !old.partialFilterExpression ? [OLD_NAME] : [];
  const create = [NEW_CAPTURE, NEW_SESSION].filter((n) => !byName.has(n.name));
  return { drop, create };
}

// "present but not an ObjectId" (a missing field is fine for the other kind; an explicit null or a string is not)
const presentNotObjectId = (field) => ({ [field]: { $exists: true, $not: { $type: 'objectId' } } });
const duplicateGroups = (field) => [
  { $match: { [field]: { $type: 'objectId' } } },
  { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $limit: SAMPLE_LIMIT },
];
const countDistinctDuplicates = (field) => [...duplicateGroups(field).slice(0, 3), { $count: 'n' }];

/** The filters used for the counted checks (exported so tests can see exactly what is asked of Mongo). */
const CHECKS = {
  captureIdNotObjectId: presentNotObjectId('source.captureJobId'),
  sessionIdNotObjectId: presentNotObjectId('source.fieldSessionId'),
  noSourceId: { 'source.captureJobId': { $exists: false }, 'source.fieldSessionId': { $exists: false } },
  kindMismatch: { $or: [
    { 'source.kind': 'session', 'source.captureJobId': { $exists: true } },
    { 'source.kind': 'capture', 'source.fieldSessionId': { $exists: true } },
  ] },
};

/**
 * Scans the collection (read-only). Resolves plain findings; the verdict is `judgeFindings`.
 * @param {{aggregate: Function, countDocuments: Function}} coll
 */
async function findViolations(coll) {
  const dupCapture = await coll.aggregate(duplicateGroups('source.captureJobId')).toArray();
  const dupSession = await coll.aggregate(duplicateGroups('source.fieldSessionId')).toArray();
  const dupCaptureTotal = ((await coll.aggregate(countDistinctDuplicates('source.captureJobId')).toArray())[0] || {}).n || 0;
  const dupSessionTotal = ((await coll.aggregate(countDistinctDuplicates('source.fieldSessionId')).toArray())[0] || {}).n || 0;
  return {
    duplicateCaptureJobIds: { total: dupCaptureTotal, sample: dupCapture.map((d) => ({ id: String(d._id), count: d.count })) },
    duplicateFieldSessionIds: { total: dupSessionTotal, sample: dupSession.map((d) => ({ id: String(d._id), count: d.count })) },
    captureIdNotObjectId: await coll.countDocuments(CHECKS.captureIdNotObjectId),
    sessionIdNotObjectId: await coll.countDocuments(CHECKS.sessionIdNotObjectId),
    noSourceId: await coll.countDocuments(CHECKS.noSourceId),
    kindMismatch: await coll.countDocuments(CHECKS.kindMismatch),
  };
}

/**
 * Pure: SAFE / UNSAFE from the findings.
 * @returns {{safe: boolean, problems: string[], notes: string[]}}
 */
function judgeFindings(f) {
  const problems = [];
  const notes = [];
  if (f.duplicateCaptureJobIds.total > 0) problems.push(`${f.duplicateCaptureJobIds.total} captureJobId value(s) are used by more than one set (the unique capture index could not be built)`);
  if (f.duplicateFieldSessionIds.total > 0) problems.push(`${f.duplicateFieldSessionIds.total} fieldSessionId value(s) are used by more than one set (the unique session index could not be built)`);
  if (f.captureIdNotObjectId > 0) problems.push(`${f.captureIdNotObjectId} set(s) have a source.captureJobId that is not an ObjectId (the partial index would silently skip them)`);
  if (f.sessionIdNotObjectId > 0) problems.push(`${f.sessionIdNotObjectId} set(s) have a source.fieldSessionId that is not an ObjectId (the partial index would silently skip them)`);
  if (f.noSourceId > 0) notes.push(`${f.noSourceId} set(s) have neither a captureJobId nor a fieldSessionId (not covered by either index; not a conflict)`);
  if (f.kindMismatch > 0) notes.push(`${f.kindMismatch} set(s) carry an id that does not match their source.kind (not a conflict)`);
  return { safe: problems.length === 0, problems, notes };
}

/**
 * Runs the whole migration against one collection (everything except the connection, so it is testable).
 * Order matters: the document check comes BEFORE any index is touched, and an UNSAFE verdict returns before the
 * drop/create block - dry-run and --apply alike. Resolves the process exit code (0 SAFE, 1 UNSAFE).
 * @param {object} coll   a Mongo collection (indexes, aggregate, countDocuments, dropIndex, createIndex)
 * @param {{apply?: boolean, log?: Function, error?: Function}} [opts]
 * @returns {Promise<number>}
 */
async function runMigration(coll, { apply = false, log = console.log, error = console.error } = {}) {
  const missing = (e) => (e && e.codeName === 'NamespaceNotFound' ? null : Promise.reject(e));
  const indexes = await coll.indexes().catch((e) => missing(e) || []);
  const plan = planIndexMigration(indexes);
  log('Current indexes:', indexes.map((i) => i.name).join(', ') || '(none)');
  log('Plan:', JSON.stringify({ drop: plan.drop, create: plan.create.map((c) => c.name) }));

  const findings = await findViolations(coll).catch((e) => missing(e) || judgeEmpty());
  const verdict = judgeFindings(findings);
  log('Document check:', JSON.stringify(findings));
  for (const n of verdict.notes) log('Note:', n);
  if (!verdict.safe) {
    error('Result: UNSAFE');
    for (const p of verdict.problems) error(' -', p);
    error(apply ? 'Refusing to --apply: no index was changed. Fix the data above and re-run.' : 'Dry run only - nothing was changed. Fix the data above before running with --apply.');
    return 1;
  }
  log('Result: SAFE');

  if (!plan.drop.length && !plan.create.length) { log('Nothing to do.'); return 0; }
  if (!apply) { log('Dry run - re-run with --apply to execute.'); return 0; }
  for (const name of plan.drop) { await coll.dropIndex(name); log('Dropped', name); }
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
    process.exitCode = await runMigration(mongoose.connection.collection('fieldobservationsets'), { apply: process.argv.includes('--apply') });
  } finally {
    await mongoose.disconnect();
  }
}

// a collection that does not exist yet has nothing to violate
const judgeEmpty = () => ({ duplicateCaptureJobIds: { total: 0, sample: [] }, duplicateFieldSessionIds: { total: 0, sample: [] }, captureIdNotObjectId: 0, sessionIdNotObjectId: 0, noSourceId: 0, kindMismatch: 0 });

if (require.main === module) {
  main().catch((e) => { console.error('Migration failed:', e && e.message); process.exit(1); });
}

module.exports = { planIndexMigration, findViolations, judgeFindings, runMigration, CHECKS, OLD_NAME, NEW_CAPTURE, NEW_SESSION };
