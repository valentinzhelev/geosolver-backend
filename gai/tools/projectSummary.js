/**
 * Deterministic project summary (V1 section 8). Every count comes from an actual query, never an LLM guess.
 */
const SurveyPoint = require('../../models/SurveyPoint');
const CaptureJob = require('../../models/CaptureJob');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const Report = require('../../models/Report');
const Calculation = require('../../models/Calculation');
const FieldBookProject = require('../../models/FieldBookProject');

/** @param {string} projectId (already access-checked by the caller) */
async function getProjectSummary(projectId) {
  const [project, points, jobs, runs, reports, calcCount] = await Promise.all([
    FieldBookProject.findById(projectId), // never chainable in this codebase's convention (see routes/reports.js)
    SurveyPoint.find({ projectId }).select('_id').lean(),
    CaptureJob.find({ project: projectId }).select('status mode createdAt').lean(),
    FieldProcessingRun.find({ projectId }).select('processingType traverse.status setups createdAt').lean(),
    Report.find({ projectId }).select('_id reportType createdAt').lean(),
    Calculation.countDocuments({ projectId }),
  ]);

  const captureByStatus = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});
  const captureByMode = jobs.reduce((acc, j) => { acc[j.mode] = (acc[j.mode] || 0) + 1; return acc; }, {});

  const polarRuns = runs.filter((r) => (r.processingType || 'polar') === 'polar');
  const traverseRuns = runs.filter((r) => r.processingType === 'traverse');
  const traverseByStatus = traverseRuns.reduce((acc, r) => {
    const s = (r.traverse && r.traverse.status) || 'UNKNOWN';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const latestActivity = [
    ...jobs.map((j) => ({ kind: 'capture', date: j.createdAt })),
    ...runs.map((r) => ({ kind: 'processing', date: r.createdAt })),
    ...reports.map((r) => ({ kind: 'report', date: r.createdAt })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  return {
    project: project ? { id: String(project._id), name: project.name, crs: project.crs || null } : null,
    pointCount: points.length,
    capture: { total: jobs.length, byStatus: captureByStatus, byMode: captureByMode, needsReview: captureByStatus.needs_review || 0 },
    processing: { total: runs.length, polarCount: polarRuns.length, traverseCount: traverseRuns.length, traverseByStatus },
    reportCount: reports.length,
    calculationCount: calcCount,
    latestActivityCount: latestActivity.length,
  };
}

module.exports = { getProjectSummary };
