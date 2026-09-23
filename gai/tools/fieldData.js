/**
 * Read-only Capture / Field Data lookups (V1 section 4). Reuses capture/jobService.js's OWN listing/summary
 * functions directly (never re-derives the same row/review/status computation a second time), which also means
 * GAI inherits the EXACT same per-uploader visibility scoping the Capture history UI already has (routes/
 * capture.js's GET /jobs is scoped to the asking user, not every project editor) - GAI must never reveal more
 * than the product already shows that user.
 */
const CaptureJob = require('../../models/CaptureJob');
const { listJobs, publicJobSummary } = require('../../capture/jobService');

/** @param {string} projectId @param {string} userId */
async function listFieldData(projectId, userId) {
  return listJobs(userId, projectId, { limit: 50 });
}

/** One Capture/Field Notebook job's compact summary - never the full OCR review payload (candidates/bboxes). */
async function getFieldDataItem(projectId, userId, jobId) {
  const job = await CaptureJob.findOne({ _id: jobId, project: projectId, user: userId });
  if (!job) return { status: 'NOT_FOUND' };
  return { status: 'FOUND', item: publicJobSummary(job) };
}

module.exports = { listFieldData, getFieldDataItem };
