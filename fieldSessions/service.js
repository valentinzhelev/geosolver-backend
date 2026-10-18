/**
 * Field Session orchestration: assembling the user-facing view (always from authoritative records, in a handful of
 * batched queries) and the one write that creates evidence - confirming a manual session.
 *
 * Everything is scoped to ONE project: every secondary lookup (capture jobs, observation sets, runs, reports) is
 * queried with the session's own projectId, so a record from another project that somehow got referenced is simply
 * absent from the view, never followed.
 */
const FieldSession = require('../models/FieldSession');
const FieldObservationSet = require('../models/FieldObservationSet');
const FieldProcessingRun = require('../models/FieldProcessingRun');
const CaptureJob = require('../models/CaptureJob');
const Report = require('../models/Report');
const SurveyPoint = require('../models/SurveyPoint');
const { evaluateSession, referenceIssues } = require('./evaluate');
const { isBlankRow } = require('./entry');
const { deriveStatus } = require('./status');
const { processingOptions } = require('./options');
const { displayTitle, sourceLabel, sourceKey, formatDay, formatInstant } = require('./labels');
const { getConfig } = require('./config');
const { FieldSessionError } = require('./errors');
const { pagesOf, isCaptureBacked } = require('./pages');
const { mergePages } = require('./pageMerge');
const { evaluateNotebook } = require('../capture/notebook/validation');
const { getConfig: getCaptureConfig } = require('../capture/config');

const isDuplicateKey = (e) => e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some((w) => w.code === 11000)));
const str = (v) => (v === null || v === undefined ? null : String(v));
const ids = (list) => [...new Set(list.filter(Boolean).map(String))];

const manualObservationCount = (setups) => (setups || []).reduce((n, s) => n + (s.observations || []).filter((o) => !isBlankRow(o)).length, 0);
const evidenceObservationCount = (setups) => (setups || []).reduce((n, s) => n + (s.observations || []).length, 0);

// what a page job contributes to a session view; the heavy `notebook` is loaded only for sessions that still need merging
const JOB_FIELDS = 'status mode user validationSummary importedFieldObservationSetId failure confirmClaimedAt revision source.assets pipelineVersion recognitionVersion arbitrationVersion validationVersion notebookVersion';

/** Evaluates each page job on its own (continuation-aware) and merges them: the one place a capture session is interpreted. */
function mergeSessionPages(session, jobById) {
  const config = getCaptureConfig();
  return mergePages(pagesOf(session).map((p) => {
    const job = jobById.get(p.captureJobId);
    const ready = job && job.status === 'needs_review' && job.notebook;
    return {
      order: p.order,
      pageId: p.pageId,
      status: job ? job.status : 'missing',
      failure: job && job.failure ? job.failure : null,
      evaluated: ready ? evaluateNotebook(job.notebook, { arbitration: config.arbitration, allowContinuation: true }) : null,
      versions: job ? { pipelineVersion: job.pipelineVersion, recognitionVersion: job.recognitionVersion, arbitrationVersion: job.arbitrationVersion, validationVersion: job.validationVersion } : {},
    };
  }));
}

/** Batched lookups for a set of sessions of ONE project. */
async function loadContext(projectId, sessions) {
  const captureSessions = sessions.filter(isCaptureBacked);
  const pageIdsOf = new Map(captureSessions.map((x) => [String(x._id), pagesOf(x).map((p) => p.captureJobId)]));
  const needMerge = captureSessions.filter((x) => x.status !== 'confirmed');
  const mergeIds = ids(needMerge.flatMap((x) => pageIdsOf.get(String(x._id))));
  const summaryIds = ids(captureSessions.flatMap((x) => pageIdsOf.get(String(x._id)))).filter((id) => !mergeIds.includes(id));
  const [full, light] = await Promise.all([
    mergeIds.length ? CaptureJob.find({ _id: { $in: mergeIds }, project: projectId }).select(`${JOB_FIELDS} notebook`).lean() : [],
    summaryIds.length ? CaptureJob.find({ _id: { $in: summaryIds }, project: projectId }).select(JOB_FIELDS).lean() : [],
  ]);
  const jobById = new Map([...full, ...light].map((j) => [String(j._id), j]));
  const mergeBySession = new Map(needMerge.map((x) => [String(x._id), mergeSessionPages(x, jobById)]));
  const jobsOf = (x) => pageIdsOf.get(String(x._id)).map((id) => jobById.get(id)).filter(Boolean);

  // the evidence a session reads: its own confirmed set; or - the ORIGINAL single-capture flow only - the confirmed set
  // of its one page job (a session of several pages has evidence only through its own confirm)
  const fosIdOf = (s) => {
    if (isCaptureBacked(s) && s.status !== 'confirmed') {
      const list = jobsOf(s);
      return list.length === 1 && list[0].status === 'confirmed' ? str(list[0].importedFieldObservationSetId) : null;
    }
    return str(s.fieldObservationSetId);
  };
  const fosIds = ids(sessions.map(fosIdOf));
  const fosList = fosIds.length ? await FieldObservationSet.find({ _id: { $in: fosIds }, projectId }).select('setups confirmedAt source').lean() : [];
  const fosById = new Map(fosList.map((f) => [String(f._id), f]));

  const runs = fosIds.length
    ? await FieldProcessingRun.find({ projectId, 'source.fieldObservationSetId': { $in: fosIds } }).select('processingType source generatedPointIds createdAt traverse.status traverse.traverseType traverse.startIdentifier traverse.endIdentifier').lean()
    : [];
  const runsByFos = new Map();
  for (const r of runs) {
    const k = String(r.source.fieldObservationSetId);
    runsByFos.set(k, [...(runsByFos.get(k) || []), r]);
  }

  const runIds = ids(runs.map((r) => r._id));
  const reports = runIds.length
    ? await Report.find({ projectId, sourceType: 'field-processing-run', sourceId: { $in: runIds } }).select('-model').lean()
    : [];
  const reportsByRun = new Map();
  for (const rep of reports) {
    const k = String(rep.sourceId);
    reportsByRun.set(k, [...(reportsByRun.get(k) || []), rep]);
  }

  const revisions = sessions.length ? await FieldSession.find({ projectId, revisionOf: { $in: ids(sessions.map((s) => s._id)) } }).select('revisionOf').lean() : [];
  const revisedIds = new Set(revisions.map((r) => String(r.revisionOf)));

  // station/orientation reference warnings for editable manual sessions: ONE project-points query for the whole build,
  // so the list and the detail always agree on a session's issue counts
  const editable = sessions.filter((s) => s.source && s.source.kind === 'manual' && s.status !== 'confirmed');
  const referenceBySession = new Map();
  if (editable.length) {
    const points = await SurveyPoint.find({ projectId }).select('name x y').lean();
    for (const s of editable) referenceBySession.set(String(s._id), referenceIssues(s.setups || [], points));
  }

  return { jobById, jobsOf, mergeBySession, fosIdOf, fosById, runsByFos, reportsByRun, revisedIds, referenceBySession };
}

/** The FIRST page, in the shape older clients read (a one-capture session). New clients read `pages`. */
function captureInfo(session, jobs, userId) {
  if (!isCaptureBacked(session)) return null;
  const first = pagesOf(session)[0];
  const job = first && jobs.find((j) => String(j._id) === first.captureJobId);
  const sum = (job && job.validationSummary) || {};
  return {
    attached: true,
    available: !!job, // false: the job is gone / not in this project - the session says so instead of guessing
    status: job ? job.status : null,
    mine: !!job && String(job.user) === String(userId), // only the uploader can open the OCR review
    jobId: first ? first.captureJobId : null,
    rows: sum.observations || 0,
    review: sum.review || 0,
    invalid: sum.invalid || 0,
  };
}

const unionBox = (cells) => {
  const boxes = Object.values(cells || {}).map((c) => c && c.bbox).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
};

/**
 * One page as the client sees it. `state`: ready | failed | processing | missing | confirmed. `id` is an opaque handle
 * the UI uses for its calls and never prints. `mine`: only the uploader may open/edit the page's OCR review.
 */
function pageView(page, job, mergePage, userId, confirmedObservations) {
  const sum = (job && job.validationSummary) || {};
  return {
    id: page.pageId,
    page: page.order + 1,
    state: mergePage ? mergePage.state : (job ? (job.status === 'failed' ? 'failed' : 'confirmed') : 'missing'),
    mine: !!job && String(job.user) === String(userId),
    hasImage: !!(job && job.source && job.source.assets && job.source.assets.thumbnail),
    setupCount: mergePage ? mergePage.setups : (sum.setups || 0),
    observationCount: mergePage ? mergePage.observations : (confirmedObservations !== undefined ? confirmedObservations : (sum.observations || 0)),
    errors: mergePage ? mergePage.errors : 0,
    warnings: mergePage ? mergePage.warnings : 0,
    continuesStation: mergePage ? mergePage.continuesStation : null,
    repeatsStation: mergePage ? mergePage.repeatsStation : null,
  };
}

/** The merged notebook for the unified review: typed values and page numbers only - no OCR cells, no internal ids. */
function logicalView(merge) {
  return {
    setups: merge.setups.map((st) => ({
      index: st.index,
      station: st.station,
      orientation: st.orientation,
      pages: st.pages.map((o) => o + 1),
      observations: st.observations.map(({ cells, source, ...o }) => ({ ...o, page: source.page + 1, pageSetup: source.setup, pageRow: source.row, bbox: unionBox(cells) })),
    })),
  };
}

/** One session -> its user-facing view. `detail` adds the heavy parts (raw setups, evaluation, runs, options). */
function toView(session, ctx, { userId, detail = false }) {
  const extraIssues = ctx.referenceBySession.get(String(session._id)) || [];
  const jobs = isCaptureBacked(session) ? ctx.jobsOf(session) : [];
  const merge = ctx.mergeBySession.get(String(session._id)) || null;
  const fosId = ctx.fosIdOf(session);
  const fos = fosId ? ctx.fosById.get(fosId) : null;
  const runs = (fos && ctx.runsByFos.get(String(fos._id))) || [];
  const derived = deriveStatus({ session, jobs, runCount: runs.length });
  const kind = sourceKey(session);
  const pages = pagesOf(session);

  let setupCount = 0;
  let observationCount = 0;
  let issues = { errors: 0, warnings: 0 };
  let evaluation = null;
  if (fos) {
    setupCount = (fos.setups || []).length;
    observationCount = evidenceObservationCount(fos.setups);
  } else if (kind === 'manual') {
    setupCount = (session.setups || []).length;
    observationCount = manualObservationCount(session.setups);
    evaluation = evaluateSession(session);
    issues = { errors: evaluation.summary.errors, warnings: evaluation.summary.warnings + extraIssues.length };
  } else if (kind === 'capture' && merge) {
    // the SAME evaluation the confirm re-runs, so the list, the detail and the confirm always agree
    setupCount = merge.summary.setups;
    observationCount = merge.summary.observations;
    issues = { errors: merge.summary.errors, warnings: merge.summary.warnings };
    evaluation = { summary: { setups: merge.summary.setups, observations: merge.summary.observations, errors: merge.summary.errors, warnings: merge.summary.warnings, canConfirm: merge.summary.canConfirm, pages: merge.summary.pages }, issues: merge.issues };
  }

  const reportList = runs.flatMap((r) => ctx.reportsByRun.get(String(r._id)) || []);
  const pointCount = runs.reduce((n, r) => n + (r.generatedPointIds || []).length, 0);

  const view = {
    id: String(session._id),
    projectId: String(session.projectId),
    title: displayTitle(session),
    customTitle: session.title || '',
    date: session.date || '',
    dateLabel: formatDay(session.date) || formatInstant(session.createdAt),
    operator: session.operator || '',
    instrument: session.instrument || '',
    source: kind,
    sourceLabel: sourceLabel(session),
    status: derived.status,
    statusLabel: derived.label,
    confirmed: derived.confirmed,
    setupCount,
    observationCount,
    issues,
    capture: captureInfo(session, jobs, userId),
    pageCount: pages.length,
    processing: { runCount: runs.length, pointCount, reportCount: reportList.length },
    revisionOf: str(session.revisionOf),
    hasRevision: ctx.revisedIds.has(String(session._id)),
    createdByMe: String(session.user) === String(userId),
    revision: session.revision || 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  if (!detail) return view;

  const confirmedAt = (fos && fos.confirmedAt) || session.confirmedAt || null;
  return {
    ...view,
    instrumentSerial: session.instrumentSerial || '',
    conditions: session.conditions || '',
    notes: session.notes || '',
    angleUnit: session.angleUnit || 'gon',
    confirmedAt,
    observationSetId: fos ? String(fos._id) : null, // an opaque handle for the existing processing API, never shown
    // manual drafts/reviews (and the frozen entries of a confirmed manual session): the raw text exactly as entered
    setups: kind === 'manual' ? (session.setups || []) : [],
    evaluation: evaluation ? { summary: { ...evaluation.summary, warnings: evaluation.summary.warnings + extraIssues.length }, issues: [...evaluation.issues, ...extraIssues] } : null,
    // the pages of a capture-backed session, in order (empty for manual sessions), and - while it is still a draft - the
    // merged logical notebook they currently make up
    pages: pages.map((p) => {
      const job = jobs.find((j) => String(j._id) === p.captureJobId);
      const confirmedObs = fos && fos.pages
        ? (fos.setups || []).reduce((n, st) => n + (st.observations || []).filter((o) => o.source && o.source.page === p.order).length, 0)
        : undefined;
      return pageView(p, job, merge && merge.pages.find((v) => v.order === p.order), userId, confirmedObs);
    }),
    logical: merge ? logicalView(merge) : null,
    // confirmed evidence, typed, without OCR cell geometry or internal ids (a merged observation says which PAGE it came from)
    evidence: fos ? { setups: (fos.setups || []).map((st) => ({ ...st, observations: (st.observations || []).map(({ cells, source, ...o }) => ({ ...o, ...(source && Number.isInteger(source.page) ? { page: source.page + 1 } : {}) })) })) } : null,
    processingOptions: fos ? processingOptions(fos.setups) : null,
    runs: runs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((r) => ({
      id: String(r._id),
      processingType: r.processingType || 'polar',
      createdAt: r.createdAt,
      pointCount: (r.generatedPointIds || []).length,
      traverseType: (r.traverse && r.traverse.traverseType) || null,
      status: (r.traverse && r.traverse.status) || null,
      start: (r.traverse && r.traverse.startIdentifier) || null,
      end: (r.traverse && r.traverse.endIdentifier) || null,
    })),
    reports: reportList.map((rep) => ({ id: String(rep._id), title: rep.title, reportType: rep.reportType, generatedAt: rep.generatedAt })),
  };
}

/** @returns {Promise<object[]>} views for sessions of one project */
async function buildViews(projectId, sessions, opts) {
  if (!sessions.length) return [];
  const ctx = await loadContext(projectId, sessions);
  return sessions.map((s) => toView(s, ctx, opts));
}

/**
 * Confirms a MANUAL session into an immutable FieldObservationSet. The same contract as
 * capture/notebook/importService.js#confirmNotebookJob:
 *   1. atomically CLAIM the confirm (so concurrent confirms, and any edit after the claim, are impossible),
 *   2. re-evaluate the STORED entries (never a client-supplied body) - on errors release the claim and refuse,
 *   3. create the FieldObservationSet (a partial unique index on source.fieldSessionId is the idempotency net),
 *   4. mark the session confirmed. Never creates SurveyPoints, never calculates.
 */
async function confirmManualSession(session, userId) {
  if (session.source && session.source.kind === 'capture') throw new FieldSessionError('USE_CAPTURE_REVIEW');
  if (session.status === 'confirmed') return { alreadyConfirmed: true, session };

  const claimed = await FieldSession.findOneAndUpdate(
    { _id: session._id, status: { $in: ['draft', 'review'] }, confirmClaimedAt: null },
    { $set: { confirmClaimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await FieldSession.findById(session._id);
    if (fresh && fresh.status === 'confirmed') return { alreadyConfirmed: true, session: fresh };
    throw new FieldSessionError('CONFIRM_IN_PROGRESS');
  }

  const release = () => FieldSession.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
  const evaluated = evaluateSession(claimed);
  if (!evaluated.summary.canConfirm) {
    await release();
    throw new FieldSessionError('VALIDATION_ERRORS', { summary: evaluated.summary, errors: evaluated.issues.filter((i) => i.severity === 'error').slice(0, 100) });
  }

  let setId;
  try {
    const doc = await FieldObservationSet.create({
      user: userId,
      projectId: claimed.projectId,
      source: { kind: 'session', fieldSessionId: claimed._id },
      notebookVersion: getConfig().version,
      setups: evaluated.setups,
    });
    setId = doc._id;
  } catch (e) {
    if (!isDuplicateKey(e)) { await release(); throw new FieldSessionError('CONFIRM_FAILED'); }
    const existing = await FieldObservationSet.findOne({ 'source.fieldSessionId': claimed._id });
    if (!existing) {
      // A duplicate key that is NOT this session's own set: the only other unique index a set can hit is the legacy plain
      // source.captureJobId_1 (every session-origin set has no captureJobId, i.e. null). The migration has not been applied.
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
  return { alreadyConfirmed: false, session: done };
}

module.exports = { buildViews, confirmManualSession, manualObservationCount, isDuplicateKey, mergeSessionPages };
