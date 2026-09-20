/**
 * In-memory stand-ins for the Mongoose models the Capture domain touches (CaptureJob, SurveyPoint) plus an in-memory
 * storage implementation. They keep SNAPSHOTS (like a database): documents handed out are copies, and only save() /
 * atomic updates change what is stored, so persistence, idempotency and the (job,row) unique guard are really exercised.
 * Ids are plain 24-hex strings.
 */
const mongoose = require('mongoose');

const newId = () => String(new mongoose.Types.ObjectId());
const clone = (v) => structuredClone(v);
const isNil = (v) => v === null || v === undefined;
const getPath = (o, p) => p.split('.').reduce((a, k) => (isNil(a) ? undefined : a[k]), o);

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const v = getPath(doc, key);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$gte' in cond) return v >= cond.$gte;
      if ('$exists' in cond) return cond.$exists ? v !== undefined : v === undefined;
      if ('$in' in cond) return cond.$in.map(String).includes(String(v));
    }
    if (isNil(cond)) return isNil(v);
    return String(v) === String(cond);
  });
}

function makeStore(name) {
  const rows = new Map();
  return { name, rows };
}

/* ------------------------------------------------------------------ CaptureJob */
const jobStore = makeStore('CaptureJob');

function wrapJob(snapshot) {
  const doc = clone(snapshot);
  Object.defineProperties(doc, {
    save: { enumerable: false, value: async function save() { const plain = plainOf(this); plain.updatedAt = new Date(); jobStore.rows.set(plain._id, clone(plain)); this.updatedAt = plain.updatedAt; return this; } },
    markModified: { enumerable: false, value: () => {} },
    toObject: { enumerable: false, value: function toObject() { return plainOf(this); } },
  });
  return doc;
}
function plainOf(doc) {
  const out = {};
  for (const k of Object.keys(doc)) out[k] = doc[k];
  return clone(out);
}

const CaptureJob = {
  STATUSES: ['uploaded', 'processing', 'needs_review', 'confirmed', 'failed'],
  async create(data) {
    const now = new Date();
    const snap = clone({
      status: 'uploaded', revision: 0, importedPointIds: [], confirmClaimedAt: null, table: null, validationSummary: null, crs: null,
      mode: 'coordinate-table', ...data, _id: newId(), createdAt: now, updatedAt: now,
    });
    snap.user = String(snap.user);
    snap.project = String(snap.project);
    snap.source = { ...(snap.source || {}), assets: { ...((snap.source || {}).assets || {}) } };
    jobStore.rows.set(snap._id, snap);
    return wrapJob(snap);
  },
  async findById(id) { const s = jobStore.rows.get(String(id)); return s ? wrapJob(s) : null; },
  async findOneAndUpdate(filter, update) {
    for (const [id, snap] of jobStore.rows) {
      if (matches(snap, filter)) {
        Object.assign(snap, update.$set || {});
        jobStore.rows.set(id, snap);
        return wrapJob(snap);
      }
    }
    return null;
  },
  async updateOne(filter, update) {
    for (const [id, snap] of jobStore.rows) if (matches(snap, filter)) { Object.assign(snap, update.$set || {}); jobStore.rows.set(id, snap); return { modifiedCount: 1 }; }
    return { modifiedCount: 0 };
  },
  async countDocuments(filter) { return [...jobStore.rows.values()].filter((s) => matches(s, filter)).length; },
  __store: jobStore,
  __reset() { jobStore.rows.clear(); },
  /** test helper: mutate the stored snapshot directly (simulates a tampered / stale record) */
  __mutate(id, fn) { const s = jobStore.rows.get(String(id)); fn(s); jobStore.rows.set(String(id), s); },
  __all() { return [...jobStore.rows.values()].map(clone); },
};

/* ---------------------------------------------------------------- SurveyPoint */
const pointStore = makeStore('SurveyPoint');

function query(rowsFn) {
  const q = { select() { return q; }, lean() { return q; }, then(res, rej) { return Promise.resolve(rowsFn().map(clone)).then(res, rej); } };
  return q;
}

const SurveyPoint = {
  find(filter = {}) { return query(() => [...pointStore.rows.values()].filter((p) => matches(p, filter))); },
  async insertMany(docs) {
    const created = [];
    for (const d of docs) {
      if (SurveyPoint.__failNextInsertAfter !== undefined && created.length >= SurveyPoint.__failNextInsertAfter) {
        SurveyPoint.__failNextInsertAfter = undefined;
        throw new Error('simulated database failure');
      }
      const key = d.source && d.source.captureJobId ? `${d.source.captureJobId}:${d.source.row}` : null;
      if (key && [...pointStore.rows.values()].some((p) => p.source && `${p.source.captureJobId}:${p.source.row}` === key)) {
        const err = new Error('E11000 duplicate key error');
        err.code = 11000;
        throw err;
      }
      const snap = clone({ ...d, _id: newId(), user: String(d.user), projectId: d.projectId ? String(d.projectId) : null, source: d.source && { ...d.source, captureJobId: String(d.source.captureJobId) } });
      pointStore.rows.set(snap._id, snap);
      created.push(clone(snap));
    }
    return created;
  },
  async deleteMany(filter) { for (const [id, p] of pointStore.rows) if (matches(p, filter)) pointStore.rows.delete(id); return {}; },
  __seed(p) { const snap = clone({ _id: newId(), code: '', h: null, notes: '', layer: 'default', ...p }); pointStore.rows.set(snap._id, snap); return snap; },
  __reset() { pointStore.rows.clear(); SurveyPoint.__failNextInsertAfter = undefined; },
  __all() { return [...pointStore.rows.values()].map(clone); },
  __failNextInsertAfter: undefined,
};

/* -------------------------------------------------------------------- Storage */
function createMemoryStorage() {
  const rows = new Map();
  let n = 0;
  return {
    rows,
    async put({ jobId, kind, buffer, mime }) { const id = `mem${++n}`; rows.set(id, { jobId: String(jobId), kind, buffer: Buffer.from(buffer), mime }); return id; },
    async get(id) { const r = rows.get(id); return r ? { buffer: r.buffer, mime: r.mime } : null; },
    async deleteForJob(jobId) { for (const [k, v] of rows) if (v.jobId === String(jobId)) rows.delete(k); },
  };
}

module.exports = { CaptureJob, SurveyPoint, createMemoryStorage, newId };
