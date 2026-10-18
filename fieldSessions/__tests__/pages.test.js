const {
  hasPages, pagesOf, isCaptureBacked, ownerOfJob, pageWrite, withInserted, validateOrder, maxPages,
} = require('../pages');
const { getConfig } = require('../config');
const FieldSession = require('../../models/FieldSession');

const J = (n) => `6acb9cb37886e3bcf890b9${String(n).padStart(2, '0')}`;

describe('pagesOf: legacy single-capture records read as one page, new records in persisted order', () => {
  it('a legacy production-style record (source.captureJobId, NO sources) is exactly one page', () => {
    const legacy = { _id: 's1', source: { kind: 'capture', captureJobId: J(1) }, createdAt: '2026-10-09T10:00:00Z' };
    expect(hasPages(legacy)).toBe(false);
    expect(pagesOf(legacy)).toEqual([{ pageId: J(1), captureJobId: J(1), order: 0, addedAt: '2026-10-09T10:00:00Z' }]);
    expect(isCaptureBacked(legacy)).toBe(true);
  });

  it('manual / empty sessions have no pages', () => {
    expect(pagesOf({ source: { kind: 'manual' }, setups: [{}] })).toEqual([]);
    expect(pagesOf({ source: { kind: null } })).toEqual([]);
    expect(pagesOf({ source: { kind: 'capture' } })).toEqual([]); // capture-backed but nothing attached yet
    expect(pagesOf(null)).toEqual([]);
  });

  it('sources are returned in PERSISTED order, not array position, and re-numbered densely', () => {
    const s = { source: { kind: 'capture' }, sources: [
      { captureJobId: J(3), order: 7, addedAt: '2026-10-09T10:03:00Z' },
      { captureJobId: J(1), order: 2, addedAt: '2026-10-09T10:01:00Z' },
      { captureJobId: J(2), order: 5, addedAt: '2026-10-09T10:02:00Z' },
    ] };
    expect(pagesOf(s).map((p) => [p.captureJobId, p.order])).toEqual([[J(1), 0], [J(2), 1], [J(3), 2]]);
  });

  it('equal order values never reorder at random: ties break by addedAt, then job id', () => {
    const s = { sources: [
      { captureJobId: J(9), order: 0, addedAt: '2026-10-09T10:00:00Z' },
      { captureJobId: J(5), order: 0, addedAt: '2026-10-09T10:00:00Z' },
      { captureJobId: J(7), order: 0, addedAt: '2026-10-09T09:00:00Z' },
    ] };
    const once = pagesOf(s).map((p) => p.captureJobId);
    expect(once).toEqual([J(7), J(5), J(9)]);
    expect(pagesOf({ sources: [...s.sources].reverse() }).map((p) => p.captureJobId)).toEqual(once);
  });

  it('when `sources` exists it is the authority (the legacy mirror is ignored)', () => {
    const s = { source: { kind: 'capture', captureJobId: J(1) }, sources: [{ captureJobId: J(2), order: 0 }] };
    expect(pagesOf(s).map((p) => p.captureJobId)).toEqual([J(2)]);
    expect(pagesOf({ source: { kind: 'capture', captureJobId: J(1) }, sources: [] })).toEqual([]); // emptied on purpose
  });
});

describe('pageWrite / withInserted / validateOrder', () => {
  it('writes dense order, the kind, and the legacy mirror of page 1', () => {
    const w = pageWrite([J(2), J(1), J(3)]);
    expect(w['source.kind']).toBe('capture');
    expect(w['source.captureJobId']).toBe(J(2));
    expect(w.sources.map((x) => [x.captureJobId, x.order])).toEqual([[J(2), 0], [J(1), 1], [J(3), 2]]);
  });

  it('keeps each page\'s original addedAt across a reorder', () => {
    const w = pageWrite([J(2), J(1)], [{ captureJobId: J(1), addedAt: new Date('2026-01-01') }, { captureJobId: J(2), addedAt: new Date('2026-02-02') }]);
    expect(w.sources.map((x) => x.addedAt.toISOString().slice(0, 10))).toEqual(['2026-02-02', '2026-01-01']);
  });

  it('no pages left -> kind back to null and the mirror cleared (a manual entry may start again)', () => {
    expect(pageWrite([])).toMatchObject({ 'source.kind': null, 'source.captureJobId': null, sources: [] });
  });

  it('inserts at a position, or appends when the position is absent/out of range', () => {
    expect(withInserted(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(withInserted(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(withInserted(['a', 'b'], 'x')).toEqual(['a', 'b', 'x']);
    expect(withInserted(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(withInserted(['a', 'b'], 'x', -1)).toEqual(['a', 'b', 'x']);
    expect(withInserted(['a', 'b'], 'x', 'nope')).toEqual(['a', 'b', 'x']);
  });

  it('a requested order must be exactly the current set: nothing added, dropped or duplicated', () => {
    expect(validateOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    for (const bad of [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'a', 'b'], ['a', 'b', 'x'], 'abc', null, undefined, [1, 2, 3]]) {
      expect(() => validateOrder(['a', 'b', 'c'], bad)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    }
  });
});

describe('ownership query and limits', () => {
  it('finds the owning session through BOTH the new structure and the legacy field', () => {
    expect(ownerOfJob('X')).toEqual({ $or: [{ 'sources.captureJobId': 'X' }, { 'source.captureJobId': 'X' }] });
  });

  it('the page limit is configurable and bounded (default 15, env 1..100, junk ignored)', () => {
    const old = process.env.FIELD_SESSION_MAX_PAGES;
    try {
      delete process.env.FIELD_SESSION_MAX_PAGES;
      expect(maxPages()).toBe(15);
      for (const [v, want] of [['5', 5], ['100', 100], ['101', 15], ['0', 15], ['-3', 15], ['abc', 15], ['2.5', 15], ['', 15]]) {
        process.env.FIELD_SESSION_MAX_PAGES = v;
        expect(getConfig().limits.maxPages).toBe(want);
      }
    } finally {
      if (old === undefined) delete process.env.FIELD_SESSION_MAX_PAGES; else process.env.FIELD_SESSION_MAX_PAGES = old;
    }
  });
});

describe('model contract', () => {
  it('declares the unique partial multikey index for page ownership, beside the legacy one', () => {
    const indexes = FieldSession.schema.indexes();
    const pages = indexes.find(([k]) => k['sources.captureJobId'] === 1);
    expect(pages[1]).toMatchObject({ unique: true, name: 'sources_captureJobId_unique_partial', partialFilterExpression: { 'sources.captureJobId': { $type: 'objectId' } } });
    expect(indexes.some(([k, o]) => k['source.captureJobId'] === 1 && o.name === 'source_captureJobId_unique_partial')).toBe(true);
  });

  it('a record without pages stays WITHOUT `sources` (absent, never defaulted to []): the legacy shape survives a load/save', () => {
    const doc = new FieldSession({ user: '507f1f77bcf86cd799439011', projectId: '507f1f77bcf86cd799439aaa', source: { kind: 'capture', captureJobId: J(1) } });
    expect(doc.sources).toBeUndefined();
    expect(doc.toObject().sources).toBeUndefined();
    expect(pagesOf(doc.toObject())).toHaveLength(1);
  });
});
