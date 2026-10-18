const { planPagesMigration, findViolations, judgeFindings, runMigration, CHECKS, NEEDS_BACKFILL, INDEX } = require('../../scripts/migrate-field-session-pages');

/**
 * The multi-page migration's DOCUMENT CHECK (dry-run and --apply). Mongo semantics of the queries are verified against
 * a real mongod (release verification); here an in-memory collection that understands exactly these queries proves the
 * verdict logic and, above all, that an UNSAFE verdict never backfills or creates anything.
 */
const oid = (n) => ({ __oid: n });
const isOid = (v) => !!v && v.__oid !== undefined;
const get = (d, path) => path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), d);

function fakeCollection(docs, indexes) {
  const calls = { updateMany: [], createIndex: [] };
  const legacyIds = (d) => (isOid(get(d, 'source.captureJobId')) ? [get(d, 'source.captureJobId').__oid] : []);
  const pageIds = (d) => (Array.isArray(d.sources) ? d.sources.map((s) => s.captureJobId).filter(isOid).map((x) => x.__oid) : []);
  const counters = new Map([
    [JSON.stringify(NEEDS_BACKFILL), (d) => get(d, 'source.kind') === 'capture' && isOid(get(d, 'source.captureJobId')) && d.sources === undefined],
    [JSON.stringify(CHECKS.legacyIdNotObjectId), (d) => get(d, 'source.kind') === 'capture' && get(d, 'source.captureJobId') !== undefined && get(d, 'source.captureJobId') !== null && !isOid(get(d, 'source.captureJobId'))],
    [JSON.stringify(CHECKS.pageIdNotObjectId), (d) => Array.isArray(d.sources) && d.sources.some((s) => !isOid(s.captureJobId))],
    [JSON.stringify(CHECKS.captureWithoutId), (d) => get(d, 'source.kind') === 'capture' && !isOid(get(d, 'source.captureJobId')) && d.sources === undefined],
  ]);
  return {
    calls,
    indexes: async () => indexes,
    countDocuments: async (filter) => {
      const fn = counters.get(JSON.stringify(filter));
      if (!fn) throw new Error('unexpected filter ' + JSON.stringify(filter));
      return docs.filter(fn).length;
    },
    aggregate: (pipeline) => ({
      toArray: async () => {
        const wantCount = pipeline.some((p) => p.$count);
        const limit = (pipeline.find((p) => p.$limit) || {}).$limit;
        let out;
        if (pipeline[0].$project && pipeline[0].$project.ids) {
          const owners = new Map();
          docs.forEach((d, i) => { for (const id of new Set([...legacyIds(d), ...pageIds(d)])) owners.set(id, [...(owners.get(id) || []), i]); });
          out = [...owners].filter(([, s]) => s.length > 1).map(([id, s]) => ({ _id: id, sessions: s }));
        } else {
          out = docs.filter((d) => { const a = pageIds(d); return a.length !== new Set(a).size; }).map((d, i) => ({ _id: i }));
        }
        if (wantCount) return out.length ? [{ n: out.length }] : [];
        return limit ? out.slice(0, limit) : out;
      },
    }),
    updateMany: async (filter, update) => { calls.updateMany.push({ filter, update }); return { modifiedCount: docs.filter(counters.get(JSON.stringify(NEEDS_BACKFILL))).length }; },
    createIndex: async (k, o) => { calls.createIndex.push(o.name); },
  };
}

const baseIndexes = [{ name: '_id_' }, { name: 'source_captureJobId_unique_partial' }];
const legacy = (n) => ({ source: { kind: 'capture', captureJobId: oid(n) } });
const paged = (...ns) => ({ source: { kind: 'capture', captureJobId: oid(ns[0]) }, sources: ns.map((n, order) => ({ kind: 'capture', captureJobId: oid(n), order })) });
const silent = () => { const out = { log: [], error: [] }; return { out, log: (...a) => out.log.push(a.join(' ')), error: (...a) => out.error.push(a.join(' ')) }; };

describe('plan', () => {
  it('creates the index only when missing; reports how many legacy sessions need a backfill', () => {
    expect(planPagesMigration(baseIndexes, 3)).toEqual({ backfill: 3, create: [INDEX] });
    expect(planPagesMigration([...baseIndexes, { name: INDEX.name }], 0)).toEqual({ backfill: 0, create: [] });
  });
});

describe('document check: findViolations + judgeFindings', () => {
  it('production-like data (legacy single-capture sessions + manual ones) is SAFE and counts the backfill', async () => {
    const f = await findViolations(fakeCollection([legacy('a'), legacy('b'), { source: { kind: 'manual' } }], baseIndexes));
    expect(f).toMatchObject({ toBackfill: 2, sessionsWithRepeatedPage: 0, jobsInSeveralSessions: { total: 0 } });
    expect(judgeFindings(f)).toEqual({ safe: true, problems: [], notes: [] });
  });

  it('an already-migrated collection has nothing left to backfill', async () => {
    const f = await findViolations(fakeCollection([paged('a'), paged('b', 'c')], baseIndexes));
    expect(f.toBackfill).toBe(0);
    expect(judgeFindings(f).safe).toBe(true);
  });

  it('one CaptureJob in two sessions is UNSAFE - whichever structure holds it', async () => {
    for (const docs of [[legacy('a'), legacy('a')], [legacy('a'), paged('x', 'a')], [paged('a'), paged('b', 'a')]]) {
      const f = await findViolations(fakeCollection(docs, baseIndexes));
      expect(f.jobsInSeveralSessions.total).toBe(1);
      expect(f.jobsInSeveralSessions.sample).toEqual([{ id: 'a', sessions: 2 }]);
      expect(judgeFindings(f).safe).toBe(false);
    }
  });

  it('the legacy field and sources of the SAME session naming the same job (the mirror) is NOT a conflict', async () => {
    expect(judgeFindings(await findViolations(fakeCollection([paged('a', 'b')], baseIndexes))).safe).toBe(true);
  });

  it('the same job listed twice inside one session is UNSAFE', async () => {
    const f = await findViolations(fakeCollection([{ source: { kind: 'capture', captureJobId: oid('a') }, sources: [{ captureJobId: oid('a'), order: 0 }, { captureJobId: oid('a'), order: 1 }] }], baseIndexes));
    expect(f.sessionsWithRepeatedPage).toBe(1);
    expect(judgeFindings(f).problems.join(' ')).toMatch(/more than once among their pages/);
  });

  it('non-ObjectId capture ids (legacy field or a page) are UNSAFE', async () => {
    const f = await findViolations(fakeCollection([
      { source: { kind: 'capture', captureJobId: '6acb9cb37886e3bcf890b98f' } },
      { source: { kind: 'capture' }, sources: [{ captureJobId: 'oops', order: 0 }] },
    ], baseIndexes));
    expect(f.legacyIdNotObjectId).toBe(1);
    expect(f.pageIdNotObjectId).toBe(1);
    expect(judgeFindings(f).problems).toHaveLength(2);
  });

  it('a capture-backed session with no id at all is a note, not a conflict', async () => {
    const v = judgeFindings(await findViolations(fakeCollection([{ source: { kind: 'capture' } }], baseIndexes)));
    expect(v.safe).toBe(true);
    expect(v.notes).toHaveLength(1);
  });
});

describe('runMigration: SAFE applies, UNSAFE refuses (dry-run and --apply)', () => {
  it('dry run on safe data: plan + SAFE, changes nothing, exit 0', async () => {
    const c = fakeCollection([legacy('a')], baseIndexes);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: false, log, error })).toBe(0);
    expect(out.log).toContain('Result: SAFE');
    expect(out.log.join('\n')).toMatch(/backfillSessions":1.*createIndexes":\["sources_captureJobId_unique_partial"\]/);
    expect(out.log.join('\n')).toMatch(/Dry run - re-run with --apply/);
    expect(c.calls).toEqual({ updateMany: [], createIndex: [] });
  });

  it('--apply on safe data: backfills with an ADDITIVE pipeline update, then creates the index', async () => {
    const c = fakeCollection([legacy('a'), legacy('b')], baseIndexes);
    const { log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(c.calls.updateMany).toHaveLength(1);
    const { filter, update } = c.calls.updateMany[0];
    expect(filter).toEqual(NEEDS_BACKFILL); // only records that have NO `sources` yet
    expect(Array.isArray(update)).toBe(true);
    expect(Object.keys(update[0])).toEqual(['$set']); // sets `sources` - never unsets/removes anything
    expect(Object.keys(update[0].$set)).toEqual(['sources']);
    expect(update[0].$set.sources[0]).toMatchObject({ kind: 'capture', captureJobId: '$source.captureJobId', order: 0 });
    expect(c.calls.createIndex).toEqual(['sources_captureJobId_unique_partial']);
  });

  it('UNSAFE data: dry run exits non-zero; --apply REFUSES - nothing backfilled, no index created', async () => {
    for (const apply of [false, true]) {
      const c = fakeCollection([legacy('a'), legacy('a')], baseIndexes);
      const { out, log, error } = silent();
      expect(await runMigration(c, { apply, log, error })).toBe(1);
      expect(out.error.join('\n')).toMatch(/Result: UNSAFE/);
      expect(out.log).not.toContain('Result: SAFE');
      expect(c.calls).toEqual({ updateMany: [], createIndex: [] });
    }
  });

  it('already migrated: SAFE and "Nothing to do" (idempotent), --apply included', async () => {
    const c = fakeCollection([paged('a')], [...baseIndexes, { name: INDEX.name }]);
    const { out, log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(out.log).toContain('Nothing to do.');
    expect(c.calls).toEqual({ updateMany: [], createIndex: [] });
  });

  it('a collection that does not exist yet is SAFE and just gets its index', async () => {
    const c = fakeCollection([], []);
    c.indexes = async () => { throw Object.assign(new Error('ns not found'), { codeName: 'NamespaceNotFound' }); };
    const { log, error } = silent();
    expect(await runMigration(c, { apply: true, log, error })).toBe(0);
    expect(c.calls.updateMany).toEqual([]);
    expect(c.calls.createIndex).toEqual(['sources_captureJobId_unique_partial']);
  });
});
