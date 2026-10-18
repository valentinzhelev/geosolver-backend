/**
 * Confirming a CAPTURE-BACKED Field Session: the pages are merged (fieldSessions/pageMerge.js) and become exactly ONE
 * immutable FieldObservationSet - `source: { kind: 'session', fieldSessionId }`, the same record a manual session
 * produces, so processing, points, reports and provenance read it without knowing it came from photos or from how many.
 *
 * The contract is the one of capture/notebook/importService.js and service.js#confirmManualSession, extended to N pages:
 *   1. atomically CLAIM the session (concurrent confirms cannot both proceed; page operations cannot land after the claim);
 *   2. atomically CLAIM EVERY PAGE JOB (all or nothing): this also stops the capture flow from confirming a page on its own,
 *      and tells us if it already did - never two pieces of authoritative evidence for the same photos;
 *   3. re-read the STORED notebooks and re-merge (the request body is ignored) - any blocking issue releases both claims;
 *   4. create the FieldObservationSet (a partial unique index on source.fieldSessionId is the idempotency net);
 *   5. mark the session confirmed, then FREEZE the page jobs (status confirmed, pointing at that one set), so a page can
 *      no longer be edited or confirmed anywhere.
 * A claim older than STALE_CLAIM_MS is treated as abandoned (a crashed confirm), so one lost request can never lock a session
 * forever; re-running the confirm then finds the evidence already created and just completes it.
 * NEVER creates SurveyPoints, NEVER calculates.
 */
const FieldSession = require('../models/FieldSession');
const FieldObservationSet = require('../models/FieldObservationSet');
const CaptureJob = require('../models/CaptureJob');
const { FieldSessionError } = require('./errors');
const { getConfig } = require('./config');
const { pagesOf, pageWrite } = require('./pages');
const { pageProvenance } = require('./pageMerge');
const { mergeSessionPages, isDuplicateKey } = require('./service');

const STALE_CLAIM_MS = 5 * 60 * 1000;

/** Freezes the page jobs of a confirmed session (idempotent: only jobs still in review are touched). */
async function freezePages(session, setId) {
  const ids = pagesOf(session).map((p) => p.captureJobId);
  if (!ids.length) return;
  await CaptureJob.updateMany(
    { _id: { $in: ids }, project: session.projectId, status: 'needs_review' },
    { $set: { status: 'confirmed', confirmedAt: new Date(), importedFieldObservationSetId: setId } }
  );
}

/** A version stamp shared by every page, or undefined when pages were read by different versions (the `pages` array has them all). */
const commonVersion = (versions, key) => {
  const set = new Set(versions.map((v) => v && v[key]).filter(Boolean));
  return set.size === 1 ? [...set][0] : undefined;
};

/** The ORIGINAL single-capture flow: the session's one page was confirmed through the capture review, so the session already reads that evidence. */
async function confirmedViaCapture(sessionLike) {
  const pages = pagesOf(sessionLike);
  if (pages.length !== 1) return false;
  const only = await CaptureJob.findById(pages[0].captureJobId);
  return !!(only && String(only.project) === String(sessionLike.projectId) && only.status === 'confirmed' && only.importedFieldObservationSetId);
}

async function confirmCaptureSession(session, userId) {
  if (session.status === 'confirmed') {
    await freezePages(session, session.fieldObservationSetId); // a retry completes a freeze a crash may have interrupted
    return { alreadyConfirmed: true, session };
  }

  if (await confirmedViaCapture(session)) return { alreadyConfirmed: true, session };

  const now = new Date();
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimed = await FieldSession.findOneAndUpdate(
    { _id: session._id, status: { $in: ['draft', 'review'] }, $or: [{ confirmClaimedAt: null }, { confirmClaimedAt: { $lt: stale } }] },
    { $set: { confirmClaimedAt: now } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await FieldSession.findById(session._id);
    if (fresh && fresh.status === 'confirmed') return { alreadyConfirmed: true, session: fresh };
    throw new FieldSessionError('CONFIRM_IN_PROGRESS');
  }
  const releaseSession = () => FieldSession.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});

  const claimedPages = pagesOf(claimed);
  // the capture flow may confirm the one page while this request is claiming: that IS the confirmation (re-checked wherever we would give up)
  const alreadyViaCapture = async () => {
    if (!(await confirmedViaCapture(claimed))) return null;
    await releaseSession();
    return { alreadyConfirmed: true, session: await FieldSession.findById(claimed._id) };
  };
  const early = await alreadyViaCapture();
  if (early) return early;
  if (!claimedPages.length) {
    await releaseSession();
    throw new FieldSessionError('VALIDATION_ERRORS', { summary: { pages: 0, setups: 0, observations: 0, errors: 1, warnings: 0, canConfirm: false }, errors: [{ code: 'NO_PAGES', severity: 'error', message: 'Добавете поне една страница.' }] });
  }

  // evidence from an earlier, interrupted attempt of THIS session: complete it, never create a second one
  let existing = await FieldObservationSet.findOne({ 'source.fieldSessionId': claimed._id });

  // Look BEFORE claiming any page: a page that is failed / processing / missing, or a blocking issue, is answered with the
  // specific reasons (422), not a generic "in progress". The decisive evaluation is repeated on the claimed jobs below.
  if (!existing) {
    const seen = await CaptureJob.find({ _id: { $in: claimedPages.map((p) => p.captureJobId) }, project: claimed.projectId });
    const preview = mergeSessionPages(claimed, new Map(seen.map((j) => [String(j._id), typeof j.toObject === 'function' ? j.toObject() : j])));
    if (!preview.summary.canConfirm) {
      const viaCapture = await alreadyViaCapture();
      if (viaCapture) return viaCapture;
      await releaseSession();
      throw new FieldSessionError('VALIDATION_ERRORS', { summary: preview.summary, errors: preview.issues.filter((i) => i.severity === 'error').slice(0, 100) });
    }
  }

  const claimedJobs = [];
  const releaseJobs = () => (claimedJobs.length
    ? CaptureJob.updateMany({ _id: { $in: claimedJobs.map((j) => j._id) }, status: 'needs_review' }, { $set: { confirmClaimedAt: null } }).catch(() => {})
    : Promise.resolve());

  let setId;
  if (existing) {
    setId = existing._id;
  } else {
    for (const p of claimedPages) {
      const job = await CaptureJob.findOneAndUpdate(
        { _id: p.captureJobId, project: claimed.projectId, status: 'needs_review', $or: [{ confirmClaimedAt: null }, { confirmClaimedAt: { $lt: stale } }] },
        { $set: { confirmClaimedAt: now } },
        { new: true }
      );
      if (!job) {
        // a page is gone, failed, still processing, or the capture flow took it: nothing was created, nothing stays claimed
        await releaseJobs();
        const viaCapture = await alreadyViaCapture();
        if (viaCapture) return viaCapture;
        await releaseSession();
        throw new FieldSessionError('CONFIRM_IN_PROGRESS');
      }
      claimedJobs.push(job);
    }

    const jobById = new Map(claimedJobs.map((j) => [String(j._id), typeof j.toObject === 'function' ? j.toObject() : j]));
    const merge = mergeSessionPages(claimed, jobById);
    if (!merge.summary.canConfirm) {
      await releaseJobs();
      await releaseSession();
      throw new FieldSessionError('VALIDATION_ERRORS', { summary: merge.summary, errors: merge.issues.filter((i) => i.severity === 'error').slice(0, 100) });
    }

    const input = merge.pages.map((v) => ({ order: v.order, pageId: v.pageId }));
    const versions = claimedPages.map((p) => { const j = jobById.get(p.captureJobId) || {}; return { pipelineVersion: j.pipelineVersion, recognitionVersion: j.recognitionVersion, arbitrationVersion: j.arbitrationVersion, validationVersion: j.validationVersion }; });
    const setups = merge.setups.filter((st) => !st.orphan).map(({ orphan, headingPage, ...st }, index) => ({ ...st, index }));
    try {
      const doc = await FieldObservationSet.create({
        user: userId,
        projectId: claimed.projectId,
        source: { kind: 'session', fieldSessionId: claimed._id },
        pipelineVersion: commonVersion(versions, 'pipelineVersion'),
        recognitionVersion: commonVersion(versions, 'recognitionVersion'),
        arbitrationVersion: commonVersion(versions, 'arbitrationVersion'),
        validationVersion: commonVersion(versions, 'validationVersion'),
        notebookVersion: getConfig().mergeVersion,
        pages: pageProvenance(input.map((i) => ({ ...i, versions: versions[i.order] }))),
        setups,
      });
      setId = doc._id;
    } catch (e) {
      if (!isDuplicateKey(e)) {
        await releaseJobs();
        await releaseSession();
        throw new FieldSessionError('CONFIRM_FAILED');
      }
      existing = await FieldObservationSet.findOne({ 'source.fieldSessionId': claimed._id });
      if (!existing) {
        // a duplicate that is NOT this session's own set: the legacy plain unique index (migration not applied yet)
        await releaseJobs();
        await releaseSession();
        console.error('field-sessions: confirm blocked by a legacy unique index on fieldobservationsets - run scripts/migrate-field-observation-set-indexes.js');
        throw new FieldSessionError('CONFIRM_UNAVAILABLE');
      }
      setId = existing._id; // already created for THIS session (an interrupted earlier attempt): complete it below, never duplicate
    }
  }

  const done = await FieldSession.findOneAndUpdate(
    { _id: claimed._id },
    { $set: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: userId, fieldObservationSetId: setId, ...pageWrite(claimedPages.map((p) => p.captureJobId), claimedPages) }, $inc: { revision: 1 } },
    { new: true }
  );
  await freezePages(done, setId);
  return { alreadyConfirmed: false, session: done };
}

module.exports = { confirmCaptureSession, freezePages, STALE_CLAIM_MS };
