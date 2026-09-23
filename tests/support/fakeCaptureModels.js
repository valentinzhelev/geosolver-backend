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
  async findOne(filter) { const s = [...jobStore.rows.values()].find((r) => matches(r, filter)); return s ? wrapJob(s) : null; },
  /** minimal chainable query: find(filter).sort({field:1|-1}).limit(n) - enough for capture/jobService.js#listJobs */
  find(filter = {}) {
    let sortSpec = null;
    let limitN = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      select() { return q; }, // no-op: fake docs are already "full" objects
      lean() { return q; },
      then(resolve, reject) {
        let arr = [...jobStore.rows.values()].filter((s) => matches(s, filter)).map((s) => wrapJob(s));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        if (limitN) arr = arr.slice(0, limitN);
        return Promise.resolve(arr).then(resolve, reject);
      },
    };
    return q;
  },
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
  let limitN = null;
  const q = {
    select() { return q; },
    lean() { return q; },
    limit(n) { limitN = n; return q; },
    then(res, rej) {
      let arr = rowsFn().map(clone);
      if (limitN) arr = arr.slice(0, limitN);
      return Promise.resolve(arr).then(res, rej);
    },
  };
  return q;
}

/** Both partial-unique-index guards SurveyPoint.js declares, simulated here for the fakes. */
function duplicateKeyOf(d) {
  if (d.source && d.source.captureJobId) return `capture:${d.source.captureJobId}:${d.source.row}`;
  if (d.source && d.source.processingRunId) return `field-processing:${d.source.processingRunId}:${d.source.setup}:${d.source.observation}`;
  return null;
}

const SurveyPoint = {
  find(filter = {}) { return query(() => [...pointStore.rows.values()].filter((p) => matches(p, filter))); },
  findOne(filter = {}) {
    const q = {
      select() { return q; },
      lean() { return q; },
      then(res, rej) {
        const p = [...pointStore.rows.values()].find((r) => matches(r, filter));
        return Promise.resolve(p ? clone(p) : null).then(res, rej);
      },
    };
    return q;
  },
  async create(d) {
    const key = duplicateKeyOf(d);
    if (key && [...pointStore.rows.values()].some((p) => duplicateKeyOf(p) === key)) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    const snap = clone({
      code: '', h: null, notes: '', layer: 'default', ...d, _id: newId(), user: String(d.user), projectId: d.projectId ? String(d.projectId) : null,
      source: d.source && { ...d.source, captureJobId: d.source.captureJobId ? String(d.source.captureJobId) : undefined, processingRunId: d.source.processingRunId ? String(d.source.processingRunId) : undefined, fieldObservationSetId: d.source.fieldObservationSetId ? String(d.source.fieldObservationSetId) : undefined },
    });
    pointStore.rows.set(snap._id, snap);
    return clone(snap);
  },
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

/* ------------------------------------------------------------- FieldObservationSet (V2.3) */
const observationSetStore = makeStore('FieldObservationSet');

const FieldObservationSet = {
  async create(data) {
    const key = String(data.source.captureJobId);
    if ([...observationSetStore.rows.values()].some((d) => String(d.source.captureJobId) === key)) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    const now = new Date();
    const snap = clone({ ...data, _id: newId(), user: String(data.user), projectId: String(data.projectId), source: { ...data.source, captureJobId: String(data.source.captureJobId) }, confirmedAt: data.confirmedAt || now, createdAt: now, updatedAt: now });
    observationSetStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  async findOne(filter) {
    const found = [...observationSetStore.rows.values()].find((d) => matches(d, filter));
    return found ? clone(found) : null;
  },
  async findById(id) { const s = observationSetStore.rows.get(String(id)); return s ? clone(s) : null; },
  find(filter = {}) { return query(() => [...observationSetStore.rows.values()].filter((d) => matches(d, filter))); },
  __reset() { observationSetStore.rows.clear(); },
  __all() { return [...observationSetStore.rows.values()].map(clone); },
};

/* ------------------------------------------------------------- FieldProcessingRun (V2.4.1) */
const processingRunStore = makeStore('FieldProcessingRun');

function wrapRun(snapshot) {
  const doc = clone(snapshot);
  Object.defineProperties(doc, {
    save: { enumerable: false, value: async function save() { const plain = plainOf(this); plain.updatedAt = new Date(); processingRunStore.rows.set(plain._id, clone(plain)); this.updatedAt = plain.updatedAt; return this; } },
    toObject: { enumerable: false, value: function toObject() { return plainOf(this); } },
  });
  return doc;
}

const FieldProcessingRun = {
  async create(data) {
    const now = new Date();
    const snap = clone({
      generatedPointIds: [], pointsCreatedAt: null, status: 'completed', resultAuthority: 'server', ...data,
      _id: newId(), createdAt: now, updatedAt: now,
    });
    snap.user = String(snap.user);
    snap.projectId = String(snap.projectId);
    snap.source = { fieldObservationSetId: String(snap.source.fieldObservationSetId), captureJobId: String(snap.source.captureJobId) };
    processingRunStore.rows.set(snap._id, snap);
    return wrapRun(snap);
  },
  async findById(id) { const s = processingRunStore.rows.get(String(id)); return s ? wrapRun(s) : null; },
  async findOne(filter) { const s = [...processingRunStore.rows.values()].find((r) => matches(r, filter)); return s ? wrapRun(s) : null; },
  find(filter = {}) {
    let sortSpec = null;
    let limitN = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      select() { return q; }, // no-op: fake docs are already "full" objects
      lean() { return q; },
      then(resolve, reject) {
        let arr = [...processingRunStore.rows.values()].filter((s) => matches(s, filter)).map((s) => wrapRun(s));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        if (limitN) arr = arr.slice(0, limitN);
        return Promise.resolve(arr).then(resolve, reject);
      },
    };
    return q;
  },
  __reset() { processingRunStore.rows.clear(); },
  __all() { return [...processingRunStore.rows.values()].map(clone); },
};

/* ------------------------------------------------------------------------- Report (V2.5) */
const reportStore = makeStore('Report');

function wrapReport(snapshot) {
  const doc = clone(snapshot);
  Object.defineProperties(doc, {
    save: { enumerable: false, value: async function save() { const plain = plainOf(this); plain.updatedAt = new Date(); reportStore.rows.set(String(plain._id), clone(plain)); this.updatedAt = plain.updatedAt; return this; } },
    toObject: { enumerable: false, value: function toObject() { return plainOf(this); } },
  });
  return doc;
}

const Report = {
  async create(data) {
    const now = new Date();
    const snap = clone({ ...data, _id: data._id ? String(data._id) : newId(), createdAt: now, updatedAt: now });
    snap.user = String(snap.user);
    snap.projectId = String(snap.projectId);
    snap.generatedBy = String(snap.generatedBy);
    if (snap.sourceId) snap.sourceId = String(snap.sourceId);
    reportStore.rows.set(snap._id, snap);
    return wrapReport(snap);
  },
  async findById(id) { const s = reportStore.rows.get(String(id)); return s ? wrapReport(s) : null; },
  find(filter = {}) {
    let sortSpec = null;
    let excludeModel = false;
    let limitN = null;
    const q = {
      select(spec) { if (spec === '-model') excludeModel = true; return q; },
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      lean() { return q; },
      then(resolve, reject) {
        let arr = [...reportStore.rows.values()].filter((s) => matches(s, filter)).map((s) => wrapReport(excludeModel ? { ...s, model: undefined } : s));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        if (limitN) arr = arr.slice(0, limitN);
        return Promise.resolve(arr).then(resolve, reject);
      },
    };
    return q;
  },
  __reset() { reportStore.rows.clear(); },
  __all() { return [...reportStore.rows.values()].map(clone); },
};

/* --------------------------------------------------------------------- ReportAsset (V2.5) */
const reportAssetStore = makeStore('ReportAsset');

const ReportAsset = {
  async create(data) {
    const snap = clone({ ...data, _id: newId(), report: data.report ? String(data.report) : null, user: String(data.user) });
    reportAssetStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  findById(id) {
    const q = {
      select() { return q; },
      then(resolve, reject) {
        const s = reportAssetStore.rows.get(String(id));
        return Promise.resolve(s ? clone(s) : null).then(resolve, reject);
      },
    };
    return q;
  },
  async deleteMany(filter) { for (const [id, a] of reportAssetStore.rows) if (matches(a, filter)) reportAssetStore.rows.delete(id); return {}; },
  __reset() { reportAssetStore.rows.clear(); },
  __all() { return [...reportAssetStore.rows.values()].map(clone); },
};

/* --------------------------------------------------------------------- Calculation (GAI V1) */
const calculationStore = makeStore('Calculation');

const Calculation = {
  async create(data) {
    const now = new Date();
    const snap = clone({ ...data, _id: newId(), createdAt: now, updatedAt: now });
    if (snap.projectId) snap.projectId = String(snap.projectId);
    if (snap.userId) snap.userId = String(snap.userId);
    calculationStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  find(filter = {}) {
    let sortSpec = null;
    let limitN = null;
    const q = {
      select() { return q; },
      lean() { return q; },
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      then(resolve, reject) {
        let arr = [...calculationStore.rows.values()].filter((s) => matches(s, filter));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        if (limitN) arr = arr.slice(0, limitN);
        return Promise.resolve(arr.map(clone)).then(resolve, reject);
      },
    };
    return q;
  },
  findOne(filter) {
    const q = {
      select() { return q; },
      then(resolve, reject) {
        const s = [...calculationStore.rows.values()].find((r) => matches(r, filter));
        return Promise.resolve(s ? clone(s) : null).then(resolve, reject);
      },
    };
    return q;
  },
  async countDocuments(filter) { return [...calculationStore.rows.values()].filter((s) => matches(s, filter)).length; },
  __seed(c) { const snap = clone({ _id: newId(), createdAt: new Date(), ...c }); calculationStore.rows.set(snap._id, snap); return snap; },
  __reset() { calculationStore.rows.clear(); },
  __all() { return [...calculationStore.rows.values()].map(clone); },
};

/* --------------------------------------------------------------- GaiConversation/GaiMessage (GAI V1) */
const conversationStore = makeStore('GaiConversation');

function wrapConversation(snapshot) {
  const doc = clone(snapshot);
  Object.defineProperties(doc, {
    save: { enumerable: false, value: async function save() { const plain = plainOf(this); plain.updatedAt = new Date(); conversationStore.rows.set(String(plain._id), clone(plain)); this.updatedAt = plain.updatedAt; return this; } },
    toObject: { enumerable: false, value: function toObject() { return plainOf(this); } },
  });
  return doc;
}

const GaiConversation = {
  async create(data) {
    const now = new Date();
    const snap = clone({ title: null, ...data, _id: newId(), createdAt: now, updatedAt: now });
    snap.user = String(snap.user);
    snap.projectId = String(snap.projectId);
    conversationStore.rows.set(snap._id, snap);
    return wrapConversation(snap);
  },
  async findById(id) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(id))) return null;
    const s = conversationStore.rows.get(String(id));
    return s ? wrapConversation(s) : null;
  },
  find(filter = {}) {
    let sortSpec = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      then(resolve, reject) {
        let arr = [...conversationStore.rows.values()].filter((s) => matches(s, filter)).map((s) => wrapConversation(s));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        return Promise.resolve(arr).then(resolve, reject);
      },
    };
    return q;
  },
  __reset() { conversationStore.rows.clear(); },
  __all() { return [...conversationStore.rows.values()].map(clone); },
};

const messageStore = makeStore('GaiMessage');

const GaiMessage = {
  async create(data) {
    const now = new Date();
    const snap = clone({ evidence: [], model: null, promptVersion: null, ...data, _id: newId(), createdAt: now, updatedAt: now });
    snap.conversationId = String(snap.conversationId);
    snap.projectId = String(snap.projectId);
    snap.user = String(snap.user);
    messageStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  find(filter = {}) {
    let sortSpec = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      then(resolve, reject) {
        let arr = [...messageStore.rows.values()].filter((s) => matches(s, filter));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          arr.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        return Promise.resolve(arr.map(clone)).then(resolve, reject);
      },
    };
    return q;
  },
  __reset() { messageStore.rows.clear(); },
  __all() { return [...messageStore.rows.values()].map(clone); },
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

module.exports = { CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, Calculation, GaiConversation, GaiMessage, createMemoryStorage, newId };
