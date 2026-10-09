/**
 * One-time index migration for Field Sessions (V2).
 *
 * WHY: until now `fieldobservationsets` had a PLAIN unique index `source.captureJobId_1`. A Field Session's manual
 * evidence has no captureJobId, and a plain unique index treats every absent value as the same `null` - the second
 * manual session would fail with E11000. The model (models/FieldObservationSet.js) now declares PARTIAL unique
 * indexes instead (a captureJobId index and a fieldSessionId index, each only over documents that have that id).
 * MongoDB will not create the new captureJobId index beside the old one, so the old one must be dropped first.
 *
 * SAFE: touches indexes only, never documents. DRY-RUN by default - prints the plan and changes nothing.
 * The window between "drop old" and "create new" is a single script run; capture confirms are protected in that
 * window only by their own atomic claim (CaptureJob.confirmClaimedAt), so run it at a quiet moment. Idempotent:
 * running it again after success is a no-op.
 *
 * Usage:
 *   node scripts/migrate-field-observation-set-indexes.js            # dry run
 *   node scripts/migrate-field-observation-set-indexes.js --apply    # drop old index, create the partial ones
 *
 * Rollback: the old index can be recreated with
 *   db.fieldobservationsets.createIndex({ 'source.captureJobId': 1 }, { unique: true })
 * but only while no session-origin set (no captureJobId) exists, or it will fail on the duplicate nulls.
 */
const OLD_NAME = 'source.captureJobId_1';
const NEW_CAPTURE = { name: 'source_captureJobId_unique_partial', key: { 'source.captureJobId': 1 }, partial: { 'source.captureJobId': { $type: 'objectId' } } };
const NEW_SESSION = { name: 'source_fieldSessionId_unique_partial', key: { 'source.fieldSessionId': 1 }, partial: { 'source.fieldSessionId': { $type: 'objectId' } } };

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

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const coll = mongoose.connection.collection('fieldobservationsets');
    const indexes = await coll.indexes().catch((e) => (e && e.codeName === 'NamespaceNotFound' ? [] : Promise.reject(e)));
    const plan = planIndexMigration(indexes);
    console.log('Current indexes:', indexes.map((i) => i.name).join(', ') || '(none)');
    console.log('Plan:', JSON.stringify({ drop: plan.drop, create: plan.create.map((c) => c.name) }));
    if (!plan.drop.length && !plan.create.length) { console.log('Nothing to do.'); return; }
    if (!apply) { console.log('Dry run - re-run with --apply to execute.'); return; }
    for (const name of plan.drop) { await coll.dropIndex(name); console.log('Dropped', name); }
    for (const c of plan.create) {
      await coll.createIndex(c.key, { unique: true, name: c.name, partialFilterExpression: c.partial });
      console.log('Created', c.name);
    }
    console.log('Done.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('Migration failed:', e && e.message); process.exit(1); });
}

module.exports = { planIndexMigration, OLD_NAME, NEW_CAPTURE, NEW_SESSION };
