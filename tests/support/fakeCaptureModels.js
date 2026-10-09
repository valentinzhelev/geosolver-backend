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
    const isSession = data.source && data.source.kind === 'session';
    const dupKey = isSession ? ['fieldSessionId', data.source.fieldSessionId] : ['captureJobId', data.source.captureJobId];
    // the partial unique indexes: one set per capture job, one per field session
    if (dupKey[1] !== undefined && dupKey[1] !== null && [...observationSetStore.rows.values()].some((d) => String(d.source[dupKey[0]]) === String(dupKey[1]))) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    if (!isSession && !data.source.captureJobId) throw new Error('FieldObservationSet validation failed: source.captureJobId is required');
    const now = new Date();
    const source = { ...data.source };
    if (source.captureJobId) source.captureJobId = String(source.captureJobId);
    if (source.fieldSessionId) source.fieldSessionId = String(source.fieldSessionId);
    const snap = clone({ ...data, _id: newId(), user: String(data.user), projectId: String(data.projectId), source, confirmedAt: data.confirmedAt || now, createdAt: now, updatedAt: now });
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
    snap.source = {
      fieldObservationSetId: String(snap.source.fieldObservationSetId),
      ...(snap.source.captureJobId ? { captureJobId: String(snap.source.captureJobId) } : {}),
      ...(snap.source.fieldSessionId ? { fieldSessionId: String(snap.source.fieldSessionId) } : {}),
    };
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

/* --------------------------------------------------------------------- FieldBook (legacy digital carnets) */
const fieldBookStore = makeStore('FieldBook');

const FieldBook = {
  async create(data) {
    const now = new Date();
    const snap = clone({ archived: false, type: 'leveling', rows: [], calculationHistory: [], ...data, _id: newId(), createdAt: now, updatedAt: now });
    snap.user = String(snap.user);
    snap.project = String(snap.project);
    fieldBookStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  find(filter = {}) { return query(() => [...fieldBookStore.rows.values()].filter((b) => matches(b, filter))); },
  __seed(b) { const snap = clone({ _id: newId(), archived: false, type: 'leveling', ...b }); fieldBookStore.rows.set(snap._id, snap); return snap; },
  __reset() { fieldBookStore.rows.clear(); },
  __all() { return [...fieldBookStore.rows.values()].map(clone); },
};

/* ------------------------------------------------------------------ FieldSession (Field Sessions V2) */
const sessionStore = makeStore('FieldSession');
let sessionClock = 0;

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) { if (isNil(cur[k]) || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[keys[keys.length - 1]] = value;
}

/** Applies a Mongo-style update (`$set` with dotted paths, `$inc`) to a snapshot in place. */
function applyUpdate(snap, update) {
  for (const [path, value] of Object.entries(update.$set || {})) setPath(snap, path, value instanceof Date ? value : clone(value));
  for (const [path, by] of Object.entries(update.$inc || {})) setPath(snap, path, (getPath(snap, path) || 0) + by);
  snap.updatedAt = new Date();
}

function dupCaptureAttach(snapshot, exceptId) {
  const cj = snapshot.source && snapshot.source.captureJobId;
  if (isNil(cj)) return;
  if ([...sessionStore.rows.values()].some((r) => r._id !== exceptId && r.source && String(r.source.captureJobId) === String(cj))) {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    throw err;
  }
}

const FieldSession = {
  async create(data) {
    sessionClock += 1;
    const now = new Date(Date.now() + sessionClock); // strictly increasing, so "newest first" is deterministic
    const snap = clone({
      title: '', date: '', operator: '', instrument: '', instrumentSerial: '', conditions: '', notes: '', angleUnit: 'gon',
      status: 'draft', revision: 0, setups: [], confirmClaimedAt: null, ...data,
      source: { kind: null, ...(data.source || {}) }, _id: newId(), createdAt: now, updatedAt: now,
    });
    snap.user = String(snap.user);
    snap.projectId = String(snap.projectId);
    if (snap.source.captureJobId) snap.source.captureJobId = String(snap.source.captureJobId);
    if (snap.revisionOf) snap.revisionOf = String(snap.revisionOf);
    dupCaptureAttach(snap, snap._id);
    sessionStore.rows.set(snap._id, snap);
    return clone(snap);
  },
  async findById(id) { const s = sessionStore.rows.get(String(id)); return s ? clone(s) : null; },
  async findOne(filter) { const s = [...sessionStore.rows.values()].find((r) => matches(r, filter)); return s ? clone(s) : null; },
  find(filter = {}) {
    let sortSpec = null;
    let limitN = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      select() { return q; },
      lean() { return q; },
      then(resolve, reject) {
        let arr = [...sessionStore.rows.values()].filter((r) => matches(r, filter));
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
  async findOneAndUpdate(filter, update, opts = {}) {
    const found = [...sessionStore.rows.values()].find((r) => matches(r, filter));
    if (!found) return null;
    const before = clone(found);
    const next = clone(found);
    applyUpdate(next, update);
    dupCaptureAttach(next, next._id); // may throw E11000 before anything is stored
    sessionStore.rows.set(next._id, next);
    return clone(opts.new ? next : before);
  },
  async updateOne(filter, update) {
    const found = [...sessionStore.rows.values()].find((r) => matches(r, filter));
    if (!found) return { modifiedCount: 0 };
    const next = clone(found);
    applyUpdate(next, update);
    sessionStore.rows.set(next._id, next);
    return { modifiedCount: 1 };
  },
  async deleteOne(filter) {
    const found = [...sessionStore.rows.values()].find((r) => matches(r, filter));
    if (found) sessionStore.rows.delete(found._id);
    return { deletedCount: found ? 1 : 0 };
  },
  async countDocuments(filter = {}) { return [...sessionStore.rows.values()].filter((r) => matches(r, filter)).length; },
  /** test helper: write a stored snapshot directly (simulates a tampered / racing record) */
  __mutate(id, fn) { const s = sessionStore.rows.get(String(id)); fn(s); sessionStore.rows.set(String(id), s); },
  __reset() { sessionStore.rows.clear(); },
  __all() { return [...sessionStore.rows.values()].map(clone); },
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
    let limitN = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitN = n; return q; },
      then(resolve, reject) {
        let arr = [...messageStore.rows.values()].filter((s) => matches(s, filter));
        if (sortSpec) {
          // every key in order (e.g. {createdAt:1, _id:1}) - same tie-breaking as a real compound sort
          const keys = Object.entries(sortSpec);
          arr.sort((a, b) => {
            for (const [key, dir] of keys) {
              const av = a[key] instanceof Date ? a[key].getTime() : a[key];
              const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
              if (av > bv) return dir;
              if (av < bv) return -dir;
            }
            return 0;
          });
        }
        if (limitN) arr = arr.slice(0, limitN);
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

module.exports = { CaptureJob, SurveyPoint, FieldObservationSet, FieldProcessingRun, Report, ReportAsset, Calculation, FieldBook, FieldSession, GaiConversation, GaiMessage, createMemoryStorage, newId };
