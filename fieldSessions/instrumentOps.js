/**
 * Instrument-import operations of a Field Session (V1: Leica GSI): upload, review decisions, detach, confirm, revise.
 *
 * The import feeds the EXISTING field workflow - nothing here is a second processing path:
 *
 *   file -> InstrumentImport (immutable lines snapshot) -> session review (decisions, revision-checked) -> confirm ->
 *   ONE ordinary session-origin FieldObservationSet (the same typed setups manual and photographed sessions produce) ->
 *   the existing Polar / Traverse processing -> SurveyPoints -> Reports
 *
 * Every session write is ONE compare-and-set (revision + "still open" + source kind in the filter), exactly like manual entries
 * and notebook pages, so a concurrent edit, attach or confirm can never be overwritten. The confirm re-reads the STORED lines
 * with the STORED decisions through the same deterministic pipeline the review shows (instrumentImport/index.js) - a client
 * body is never evidence.
 */
const mongoose = require('mongoose');
const FieldSession = require('../models/FieldSession');
const FieldObservationSet = require('../models/FieldObservationSet');
const InstrumentImport = require('../models/InstrumentImport');
const { readInstrumentFile, reviewInstrumentImport } = require('../instrumentImport');
const { safeFileName } = require('../instrumentImport/text');
const { getConfig: getImportConfig } = require('../instrumentImport/config');
const { FieldSessionError } = require('./errors');
const { getConfig } = require('./config');

const OPEN = { status: { $in: ['draft', 'review'] }, confirmClaimedAt: null };
const isDuplicateKey = (e) => e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some((w) => w.code === 11000)));
const VENDOR_LABEL = { leica: 'Leica' };

async function explainMiss(sessionId) {
  const fresh = await FieldSession.findById(sessionId);
  if (!fresh) return new FieldSessionError('NOT_FOUND');
  if (fresh.status === 'confirmed' || fresh.confirmClaimedAt) return new FieldSessionError('SESSION_CONFIRMED');
  return new FieldSessionError('REVISION_CONFLICT');
}

/**
 * Client decisions -> the stored shape, or INVALID_DECISION. Only the structure is checked here; whether a decision matches the
 * file (an existing record, a measurement of that setup) is the normalizer's job, and a mismatch is shown as an issue.
 */
function sanitizeDecisions(input) {
  const { limits } = getImportConfig();
  const bad = () => new FieldSessionError('INVALID_DECISION');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad();
  const out = { excluded: [], orientation: {}, orphanStation: null };
  const posInt = (v) => Number.isInteger(v) && v > 0 && v <= limits.maxRecords;

  if (input.excluded !== undefined) {
    if (!Array.isArray(input.excluded) || input.excluded.length > limits.maxRecords || !input.excluded.every(posInt)) throw bad();
    out.excluded = [...new Set(input.excluded)].sort((a, b) => a - b);
  }
  if (input.orientation !== undefined) {
    const o = input.orientation;
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length > limits.maxSetups + 1) throw bad();
    for (const [key, value] of Object.entries(o)) {
      if (!/^(s[1-9]\d{0,5}|orphan)$/.test(key)) throw bad();
      if (value !== null && !posInt(value)) throw bad();
      out.orientation[key] = value;
    }
  }
  if (input.orphanStation !== undefined && input.orphanStation !== null) {
    const s = input.orphanStation;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw bad();
    const point = s.point === undefined || s.point === null ? '' : s.point;
    const hi = s.instrumentHeight === undefined || s.instrumentHeight === null ? '' : s.instrumentHeight;
    if (typeof point !== 'string' || point.length > 60 || typeof hi !== 'string' || hi.length > 20) throw bad();
    out.orphanStation = { point: point.trim(), instrumentHeight: hi.trim() };
  }
  return out;
}

/** The import a session reads - always scoped to the session's own project AND to the session itself. */
async function importOf(session, { lean = true } = {}) {
  const id = session.source && session.source.instrumentImportId;
  if (!id) return null;
  const q = InstrumentImport.findOne({ _id: id, projectId: session.projectId, fieldSessionId: session._id });
  return lean ? q.lean() : q;
}

/**
 * Upload: the file is read, detected and checked (a refusal is a structured InstrumentImportError, nothing is stored), the
 * import record is created, and the session switches to the instrument source in one compare-and-set. If that write loses
 * (a concurrent edit / upload / confirm), the just-created import is removed again - a lost race leaves nothing behind.
 * @param {{buffer: Buffer, originalname?: string}} file
 */
async function importInstrumentFile(session, file, userId) {
  const read = readInstrumentFile(file.buffer);
  const review = reviewInstrumentImport(read, {});
  const versions = getImportConfig();
  const id = String(new mongoose.Types.ObjectId());
  await InstrumentImport.create({
    _id: id,
    user: userId,
    projectId: session.projectId,
    fieldSessionId: session._id,
    vendor: read.vendor,
    format: read.format,
    originalName: safeFileName(file.originalname),
    sha256: read.sha256,
    bytes: read.bytes,
    lines: read.lines,
    parserVersion: versions.parserVersion,
    normalizerVersion: versions.normalizerVersion,
    validationVersion: versions.validationVersion,
    upload: { summary: review.summary, issues: review.issues.slice(0, 200) },
    status: 'draft',
    lineage: id,
  });
  const updated = await FieldSession.findOneAndUpdate(
    { _id: session._id, revision: session.revision, ...OPEN, 'source.kind': { $in: [null, 'manual'] } },
    { $set: { 'source.kind': 'instrument', 'source.instrumentImportId': id, instrumentDecisions: { excluded: [], orientation: {}, orphanStation: null }, setups: [] }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) {
    await InstrumentImport.deleteOne({ _id: id }).catch(() => {});
    throw await explainMiss(session._id);
  }
  return updated;
}

async function updateInstrumentDecisions(session, decisions, baseRevision) {
  const clean = sanitizeDecisions(decisions);
  if (baseRevision !== undefined && baseRevision !== null && (!Number.isInteger(Number(baseRevision)) || Number(baseRevision) !== session.revision)) {
    throw new FieldSessionError('REVISION_CONFLICT');
  }
  const updated = await FieldSession.findOneAndUpdate(
    { _id: session._id, revision: session.revision, ...OPEN, 'source.kind': 'instrument', 'source.instrumentImportId': session.source.instrumentImportId },
    { $set: { instrumentDecisions: clean }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) throw await explainMiss(session._id);
  return updated;
}

/** Removes the file from an unconfirmed session (the session can then take another file or manual entries). The import record
 * stays, marked 'detached', for the audit trail. */
async function detachInstrumentImport(session) {
  const importId = session.source.instrumentImportId;
  const updated = await FieldSession.findOneAndUpdate(
    { _id: session._id, revision: session.revision, ...OPEN, 'source.kind': 'instrument', 'source.instrumentImportId': importId },
    { $set: { 'source.kind': null }, $unset: { 'source.instrumentImportId': 1, instrumentDecisions: 1 }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!updated) throw await explainMiss(session._id);
  await InstrumentImport.updateOne({ _id: importId, status: 'draft' }, { $set: { status: 'detached', detachedAt: new Date() } }).catch(() => {});
  return updated;
}

/** Review setups -> evidence setups: exactly the canonical FieldObservationSet shape, plus each observation's file origin. */
function evidenceSetups(setups) {
  return setups.map((s) => ({
    index: s.index,
    station: s.station,
    orientation: s.orientation,
    observations: s.observations.map((o) => ({
      row: o.row,
      target: o.target,
      hz: o.hz,
      vz: o.vz,
      distance: o.distance,
      horizontalDistance: o.horizontalDistance,
      prismHeight: o.prismHeight,
      code: o.code,
      notes: o.notes,
      cells: {},
      source: { kind: 'instrument', record: o.source.record, line: o.source.line },
    })),
  }));
}

/**
 * Confirms an instrument session - the same contract as fieldSessions/service.js#confirmManualSession: claim, re-evaluate the
 * STORED import with the STORED decisions (refuse and release on errors), create the one set (the partial unique index on
 * source.fieldSessionId is the idempotency net), mark the session confirmed, then the import. Never creates points.
 */
async function confirmInstrumentSession(session, userId) {
  if (session.status === 'confirmed') return { alreadyConfirmed: true, session };
  const claimed = await FieldSession.findOneAndUpdate(
    { _id: session._id, ...OPEN, 'source.kind': 'instrument' },
    { $set: { confirmClaimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await FieldSession.findById(session._id);
    if (fresh && fresh.status === 'confirmed') return { alreadyConfirmed: true, session: fresh };
    throw new FieldSessionError('CONFIRM_IN_PROGRESS');
  }
  const release = () => FieldSession.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});

  const imp = await importOf(claimed);
  if (!imp || imp.status === 'detached') { await release(); throw new FieldSessionError('INSTRUMENT_IMPORT_MISSING'); }
  let review;
  try {
    review = reviewInstrumentImport(imp, claimed.instrumentDecisions || {});
  } catch {
    await release();
    throw new FieldSessionError('CONFIRM_FAILED');
  }
  if (!review.summary.canConfirm) {
    await release();
    throw new FieldSessionError('VALIDATION_ERRORS', { summary: review.summary, errors: review.issues.filter((i) => i.severity === 'error').slice(0, 100) });
  }

  let setId;
  try {
    const doc = await FieldObservationSet.create({
      user: userId,
      projectId: claimed.projectId,
      source: { kind: 'session', fieldSessionId: claimed._id },
      notebookVersion: getConfig().version,
      validationVersion: review.versions.validationVersion,
      instrumentImport: {
        importId: imp._id,
        vendor: imp.vendor,
        format: imp.format,
        fileName: imp.originalName,
        sha256: imp.sha256,
        parserVersion: review.versions.parserVersion,
        normalizerVersion: review.versions.normalizerVersion,
        validationVersion: review.versions.validationVersion,
      },
      setups: evidenceSetups(review.setups),
    });
    setId = doc._id;
  } catch (e) {
    if (!isDuplicateKey(e)) { await release(); throw new FieldSessionError('CONFIRM_FAILED'); }
    const existing = await FieldObservationSet.findOne({ 'source.fieldSessionId': claimed._id });
    if (!existing) {
      await release();
      console.error('field-sessions: confirm blocked by a legacy unique index on fieldobservationsets - run scripts/migrate-field-observation-set-indexes.js');
      throw new FieldSessionError('CONFIRM_UNAVAILABLE');
    }
    setId = existing._id;
  }

  const done = await FieldSession.findOneAndUpdate(
    { _id: claimed._id },
    { $set: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: userId, fieldObservationSetId: setId }, $inc: { revision: 1 } },
    { new: true }
  );
  await InstrumentImport.updateOne(
    { _id: imp._id },
    { $set: { status: 'confirmed', confirmedAt: new Date(), fieldObservationSetId: setId, confirmed: { summary: review.summary, decisions: claimed.instrumentDecisions || {} } } }
  ).catch(() => {});
  return { alreadyConfirmed: false, session: done };
}

/**
 * A correction of a confirmed instrument session: a NEW instrument session over a COPY of the same import (same lines, same
 * versions, `derivedFrom` + `lineage`), starting from the decisions that were confirmed. The original session, its evidence and
 * its processing stay untouched. Re-reading the instrument file keeps its full resolution (a manual rendering would not).
 */
async function reviseInstrumentSession(session, fields, userId) {
  const imp = await importOf(session);
  if (!imp) throw new FieldSessionError('INSTRUMENT_IMPORT_MISSING');
  const copyId = String(new mongoose.Types.ObjectId());
  const decisions = (imp.confirmed && imp.confirmed.decisions) || session.instrumentDecisions || {};
  const created = await FieldSession.create({
    ...fields,
    user: userId,
    projectId: session.projectId,
    source: { kind: 'instrument', instrumentImportId: copyId },
    instrumentDecisions: decisions,
    status: 'draft',
    setups: [],
    revisionOf: session._id,
  });
  try {
    await InstrumentImport.create({
      _id: copyId,
      user: userId,
      projectId: session.projectId,
      fieldSessionId: created._id,
      vendor: imp.vendor,
      format: imp.format,
      originalName: imp.originalName,
      sha256: imp.sha256,
      bytes: imp.bytes,
      lines: imp.lines,
      parserVersion: imp.parserVersion,
      normalizerVersion: imp.normalizerVersion,
      validationVersion: imp.validationVersion,
      upload: imp.upload,
      status: 'draft',
      lineage: imp.lineage || imp._id,
      derivedFrom: imp._id,
    });
  } catch (e) {
    await FieldSession.deleteOne({ _id: created._id }).catch(() => {});
    throw e;
  }
  return created;
}

/** Batched view context for a list of sessions of ONE project. */
async function loadInstrumentContext(projectId, sessions) {
  const instrumentSessions = sessions.filter((s) => s.source && s.source.kind === 'instrument' && s.source.instrumentImportId);
  if (!instrumentSessions.length) return { importBySession: new Map(), duplicateIds: new Set() };
  const open = instrumentSessions.filter((s) => s.status !== 'confirmed').map((s) => String(s.source.instrumentImportId));
  const all = instrumentSessions.map((s) => String(s.source.instrumentImportId));
  const LIGHT = 'user projectId fieldSessionId vendor format originalName sha256 bytes status lineage derivedFrom createdAt parserVersion normalizerVersion validationVersion';
  const closed = all.filter((id) => !open.includes(id));
  const [full, light] = await Promise.all([
    open.length ? InstrumentImport.find({ _id: { $in: open }, projectId }).lean() : [],
    closed.length ? InstrumentImport.find({ _id: { $in: closed }, projectId }).select(LIGHT).lean() : [],
  ]);
  const byId = new Map([...full, ...light].map((d) => [String(d._id), d]));
  const importBySession = new Map();
  for (const s of instrumentSessions) {
    const d = byId.get(String(s.source.instrumentImportId));
    if (d && String(d.fieldSessionId) === String(s._id)) importBySession.set(String(s._id), d);
  }
  // duplicate warning: the same file content imported elsewhere in this project (a revision copy is not a duplicate of its
  // own lineage); detached imports do not count
  const shas = [...new Set([...importBySession.values()].map((d) => d.sha256))];
  const same = shas.length ? await InstrumentImport.find({ projectId, sha256: { $in: shas }, status: { $ne: 'detached' } }).select('sha256 lineage').lean() : [];
  const duplicateIds = new Set();
  for (const d of importBySession.values()) {
    const mine = String(d.lineage || d._id);
    if (same.some((x) => x.sha256 === d.sha256 && String(x.lineage || x._id) !== mine)) duplicateIds.add(String(d._id));
  }
  return { importBySession, duplicateIds };
}

const instrumentSourceLabel = (imp) => (imp ? `Импорт от ${VENDOR_LABEL[imp.vendor] || 'инструмент'} ${imp.format}` : 'Импорт от инструмент');

module.exports = {
  importInstrumentFile,
  updateInstrumentDecisions,
  detachInstrumentImport,
  confirmInstrumentSession,
  reviseInstrumentSession,
  loadInstrumentContext,
  sanitizeDecisions,
  evidenceSetups,
  instrumentSourceLabel,
  VENDOR_LABEL,
};
