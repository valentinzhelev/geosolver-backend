const {
  planIndexMigration, findViolations, judgeFindings, runMigration, CHECKS, OLD_NAME,
} = require('../../scripts/migrate-field-observation-set-indexes');

/**
 * The index migration's DOCUMENT CHECK (dry-run and --apply). The Mongo semantics of the queries themselves are
 * verified against a real mongod (see the release verification); here a small in-memory collection that understands
 * exactly these queries proves the verdict logic and, above all, that an UNSAFE verdict never touches an index.
 */
const oid = (n) => ({ __oid: n }); // an "ObjectId"; anything else (a string, null, a number) is "not an ObjectId"
const isOid = (v) => !!v && v.__oid !== undefined;

function fakeCollection(docs, indexes) {
  const calls = { dropIndex: [], createIndex: [] };
  const has = (d, path) => path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), d) !== undefined;
  const get = (d, path) => path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), d);
  const key = (obj) => JSON.stringify(obj);
  const counters = {
    [key(CHECKS.captureIdNotObjectId)]: (d) => has(d, 'source.captureJobId') && !isOid(get(d, 'source.captureJobId')),
    [key(CHECKS.sessionIdNotObjectId)]: (d) => has(d, 'source.fieldSessionId') && !isOid(get(d, 'source.fieldSessionId')),
    [key(CHECKS.noSourceId)]: (d) => !has(d, 'source.captureJobId') && !has(d, 'source.fieldSessionId'),
    [key(CHECKS.kindMismatch)]: (d) => (get(d, 'source.kind') === 'session' && has(d, 'source.captureJobId')) || (get(d, 'source.kind') === 'capture' && has(d, 'source.fieldSessionId')),
  };
  return {
    calls,
    indexes: async () => indexes,
    countDocuments: async (filter) => {
      const fn = counters[key(filter)];
      if (!fn) throw new Error('unexpected filter ' + key(filter));
      return docs.filter(fn).length;
    },
    aggregate: (pipeline) => ({
      toArray: async () => {
        const field = Object.keys(pipeline[0].$match)[0];
        const groups = new Map();
        for (const d of docs) {
          const v = get(d, field);
          if (isOid(v)) groups.set(v.__oid, (groups.get(v.__oid) || 0) + 1);
        }
        const dups = [...groups].filter(([, n]) => n > 1).map(([id, count]) => ({ _id: id, count }));
        if (pipeline.some((p) => p.$count)) return dups.length ? [{ n: dups.length }] : [];
        const limit = (pipeline.find((p) => p.$limit) || {}).$limit;
        return limit ? dups.slice(0, limit) : dups;
      },
    }),
    dropIndex: async (n) => { calls.dropIndex.push(n); },
    createIndex: async (k, o) => { calls.createIndex.push(o.name); },
  };
}

const legacyIndexes = [{ name: '_id_', key: { _id: 1 } }, { name: OLD_NAME, key: { 'source.captureJobId': 1 }, unique: true }];
const capture = (n) => ({ source: { kind: 'capture', captureJobId: oid(n) } });
const session = (n) => ({ source: { kind: 'session', fieldSessionId: oid(n) } });
const silent = () => { const out = { log: [], error: [] }; return { out, log: (...a) => out.log.push(a.join(' ')), error: (...a) => out.error.push(a.join(' ')) }; };

describe('document check: findViolations + judgeFindings', () => {
  it('clean production-like data (unique capture ids) is SAFE with no notes', async () => {
    const f = await findViolations(fakeCollection([capture('a'), capture('b'), capture('c')], legacyIndexes));
    expect(f).toMatchObject({ duplicateCaptureJobIds: { total: 0 }, duplicateFieldSessionIds: { total: 0 }, captureIdNotObjectId: 0, sessionIdNotObjectId: 0 });
    expect(judgeFindings(f)).toEqual({ safe: true, problems: [], notes: [] });
  });

  it('an empty collection is SAFE', async () => {
    expect(judgeFindings(await findViolations(fakeCollection([], [])))).toMatchObject({ safe: true });
  });

  it('a duplicate captureJobId is UNSAFE and the offending id is reported with its count', async () => {
    const f = await findViolations(fakeCollection([capture('a'), capture('a'), capture('b')], legacyIndexes));
    expect(f.duplicateCaptureJobIds).toEqual({ total: 1, sample: [{ id: 'a', count: 2 }] });
    const v = judgeFindings(f);
    expect(v.safe).toBe(false);
    expect(v.problems.join(' ')).toMatch(/captureJobId .*more than one set/);
  });

  it('a duplicate fieldSessionId is UNSAFE', async () => {
    const f = await findViolations(fakeCollection([session('s'), session('s'), session('t')], legacyIndexes));
    expect(f.duplicateFieldSessionIds.total).toBe(1);
    expect(judgeFindings(f).problems.join(' ')).toMatch(/fieldSessionId .*more than one set/);
  });

  it('non-ObjectId source ids (string / explicit null) are UNSAFE: a partial index would silently skip them', async () => {
    const stringId = { source: { kind: 'capture', captureJobId: '6acb9cb37886e3bcf890b98f' } };
    const nullId = { source: { kind: 'capture', captureJobId: null } };
    const sessString = { source: { kind: 'session', fieldSessionId: 'not-an-object-id' } };
    const f = await findViolations(fakeCollection([capture('a'), stringId, nullId, sessString], legacyIndexes));
    expect(f.captureIdNotObjectId).toBe(2);
    expect(f.sessionIdNotObjectId).toBe(1);
    const v = judgeFindings(f);
    expect(v.safe).toBe(false);
    expect(v.problems).toHaveLength(2);
    expect(v.problems.join(' ')).toMatch(/not an ObjectId/);
  });

  it('a missing id on the OTHER kind is normal (session sets have no captureJobId) - not a problem', async () => {
    const f = await findViolations(fakeCollection([capture('a'), session('s'), session('t')], legacyIndexes));
    expect(judgeFindings(f)).toMatchObject({ safe: true, problems: [] });
  });

  it('sets with neither id, or an id that contradicts their kind, are notes only (cannot violate an index)', async () => {
    const f = await findViolations(fakeCollection([capture('a'), { source: { kind: 'capture' } }, { source: { kind: 'session', fieldSessionId: oid('s'), captureJobId: oid('c') } }], legacyIndexes));
    const v = judgeFindings(f);
    expect(v.safe).toBe(true);
    expect(v.notes).toHaveLength(2);
  });
});

describe('runMigration: SAFE applies, UNSAFE refuses (dry-run and --apply)', () => {
  const safeDocs = [capture('a'), capture('b')];
  const unsafeDocs = [capture('a'), capture('a')];

  it('dry run on safe data: prints the plan and SAFE, changes nothing, exit 0', async () => {
    const c = fakeCollection(safeDocs, legacyIndexes);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: false, log, error })).toBe(0);
    expect(out.log.join('\n')).toMatch(/Plan: .*"drop":\["source.captureJobId_1"\]/);
    expect(out.log).toContain('Result: SAFE');
    expect(out.log.join('\n')).toMatch(/Dry run - re-run with --apply/);
    expect(c.calls).toEqual({ dropIndex: [], createIndex: [] });
  });

  it('--apply on safe data: drops the old index, creates both partial ones, exit 0', async () => {
    const c = fakeCollection(safeDocs, legacyIndexes);
    const { log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(c.calls.dropIndex).toEqual([OLD_NAME]);
    expect(c.calls.createIndex).toEqual(['source_captureJobId_unique_partial', 'source_fieldSessionId_unique_partial']);
  });

  it('dry run on UNSAFE data: reports UNSAFE and exits non-zero, nothing changed', async () => {
    const c = fakeCollection(unsafeDocs, legacyIndexes);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: false, log, error })).toBe(1);
    expect(out.error.join('\n')).toMatch(/Result: UNSAFE/);
    expect(out.error.join('\n')).toMatch(/more than one set/);
    expect(out.log).not.toContain('Result: SAFE');
    expect(c.calls).toEqual({ dropIndex: [], createIndex: [] });
  });

  it('--apply on UNSAFE data REFUSES: no index is dropped or created, exit non-zero', async () => {
    const c = fakeCollection([capture('a'), capture('a'), { source: { kind: 'capture', captureJobId: 'str' } }], legacyIndexes);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(1);
    expect(out.error.join('\n')).toMatch(/Refusing to --apply: no index was changed/);
    expect(c.calls).toEqual({ dropIndex: [], createIndex: [] });
  });

  it('already migrated: SAFE and "Nothing to do" (idempotent), --apply included', async () => {
    const migrated = [{ name: '_id_' }, { name: 'source_captureJobId_unique_partial' }, { name: 'source_fieldSessionId_unique_partial' }];
    const c = fakeCollection([capture('a'), session('s')], migrated);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(out.log).toContain('Nothing to do.');
    expect(c.calls).toEqual({ dropIndex: [], createIndex: [] });
  });

  it('a collection that does not exist yet is SAFE (nothing to violate) and gets its indexes created', async () => {
    const c = fakeCollection([], []);
    c.indexes = async () => { throw Object.assign(new Error('ns not found'), { codeName: 'NamespaceNotFound' }); };
    const { log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(c.calls.dropIndex).toEqual([]);
    expect(c.calls.createIndex).toHaveLength(2);
  });

  it('the plan itself is unchanged by the document check', () => {
    expect(planIndexMigration(legacyIndexes).drop).toEqual([OLD_NAME]);
  });
});
