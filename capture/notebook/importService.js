/**
 * Field Notebook -> FieldObservationSet import (V2.3). The ONLY place a confirmed structured observation record is
 * created. Mirrors capture/importService.js's contract exactly:
 *
 *   1. the caller reloads the job and re-checks permissions (routes/capture.js#loadOwnedJob, same as every route)
 *   2. rerun the deterministic notebook validation on the STORED notebook (never a client-supplied one)
 *   3. reject unresolved ERROR/UNCERTAIN cells (evaluateNotebook already turns those into blocking errors)
 *   4. atomically claim the confirm (the same CaptureJob.confirmClaimedAt guard coordinate-table Capture uses)
 *   5. create the FieldObservationSet (idempotent: a unique index on source.captureJobId is the safety net)
 *   6. mark the job confirmed, with full provenance back to the CaptureJob
 *
 * NEVER creates SurveyPoints. NEVER runs a calculation. See the module doc for what a future milestone may do with
 * a ConfirmedObservationSet - nothing here is that milestone.
 */
const CaptureJob = require('../../models/CaptureJob');
const FieldObservationSet = require('../../models/FieldObservationSet');
const { evaluateNotebook } = require('./validation');
const { getConfig } = require('../config');
const { CaptureError } = require('../errors');

const isDuplicateKey = (e) => e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some((w) => w.code === 11000)));

/** Flattens every blocking (error-severity) issue across the notebook into a flat list for the 422 response. */
function flattenErrors(notebook) {
  const out = [];
  for (const setup of notebook.setups) {
    for (const is of setup.issues) if (is.severity === 'error') out.push({ setup: setup.index, code: is.code, field: is.field });
    const cellIssues = (cell, section, row) => {
      for (const is of cell.validation.issues) if (is.severity === 'error') out.push({ setup: setup.index, section, row, code: is.code });
    };
    cellIssues(setup.station.point, 'station', null);
    cellIssues(setup.station.instrumentHeight, 'station', null);
    if (setup.orientation) {
      cellIssues(setup.orientation.target, 'orientation', null);
      if (setup.orientation.direction) cellIssues(setup.orientation.direction, 'orientation', null);
    }
    for (const row of setup.observations) {
      if (row.excluded || row.skipped) continue;
      for (const cell of row.cells) cellIssues(cell, 'observation', row.index);
    }
  }
  return out.slice(0, 100);
}

/**
 * @param {object} job a freshly loaded CaptureJob (mode 'field-notebook') - the caller verified owner + project permission
 * @param {{guard?: (claimedJob: object) => Promise<void>}} [options] `guard` runs AFTER the claim and BEFORE any evidence is
 *   created; if it throws, the claim is released and the confirm is refused. routes/capture.js uses it so a page that
 *   belongs to a multi-page Field Session can only ever be confirmed through that session (see fieldSessions/service.js).
 */
async function confirmNotebookJob(job, { guard } = {}) {
  if (job.status === 'confirmed') {
    return { alreadyConfirmed: true, observationSetId: job.importedFieldObservationSetId ? String(job.importedFieldObservationSetId) : null, job };
  }
  if (job.status !== 'needs_review') throw new CaptureError('INVALID_STATE');

  const config = getConfig();
  const evaluated = evaluateNotebook(job.notebook, { arbitration: config.arbitration });
  if (!evaluated.summary.canConfirm) {
    throw new CaptureError('VALIDATION_ERRORS', { summary: evaluated.summary, errors: flattenErrors(evaluated.notebook) });
  }

  const claimed = await CaptureJob.findOneAndUpdate(
    { _id: job._id, status: 'needs_review', confirmClaimedAt: null },
    { $set: { confirmClaimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await CaptureJob.findById(job._id);
    if (fresh && fresh.status === 'confirmed') {
      return { alreadyConfirmed: true, observationSetId: fresh.importedFieldObservationSetId ? String(fresh.importedFieldObservationSetId) : null, job: fresh };
    }
    throw new CaptureError('CONFIRM_IN_PROGRESS');
  }

  if (guard) {
    try {
      await guard(claimed);
    } catch (e) {
      await CaptureJob.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
      throw e;
    }
  }

  let setId;
  try {
    const doc = await FieldObservationSet.create({
      user: claimed.user,
      projectId: claimed.project,
      source: { kind: 'capture', captureJobId: claimed._id },
      pipelineVersion: claimed.pipelineVersion,
      recognitionVersion: claimed.recognitionVersion,
      arbitrationVersion: claimed.arbitrationVersion,
      validationVersion: claimed.validationVersion,
      notebookVersion: config.notebookValidationVersion,
      setups: evaluated.setups,
    });
    setId = doc._id;
  } catch (e) {
    if (!isDuplicateKey(e)) {
      await CaptureJob.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
      throw new CaptureError('IMPORT_FAILED');
    }
    // a concurrent confirm already created it: idempotent, read it back rather than failing
    const existing = await FieldObservationSet.findOne({ 'source.captureJobId': claimed._id });
    if (!existing) {
      await CaptureJob.updateOne({ _id: claimed._id }, { $set: { confirmClaimedAt: null } }).catch(() => {});
      throw new CaptureError('IMPORT_FAILED');
    }
    setId = existing._id;
  }

  claimed.status = 'confirmed';
  claimed.confirmedAt = new Date();
  claimed.importedFieldObservationSetId = setId;
  claimed.notebook = evaluated.notebook;
  claimed.validationSummary = evaluated.summary;
  claimed.markModified('notebook');
  claimed.markModified('validationSummary');
  await claimed.save();
  return { alreadyConfirmed: false, observationSetId: String(setId), job: claimed };
}

module.exports = { confirmNotebookJob, flattenErrors };
