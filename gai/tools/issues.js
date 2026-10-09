/**
 * Deterministic issue extraction (V1 section 11): a fixed set of RULES over persisted data, computed BEFORE the
 * LLM is ever involved. The LLM may explain an issue in prose; it never decides whether one exists. The categories
 * checked are listed in gai/terminology.js#ISSUE_CATEGORIES_CHECKED so an empty result is always reported with its
 * real scope, never as "the project has no problems".
 */
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const { listFieldData } = require('./fieldData');
const { summarizeRun } = require('./processing');
const T = require('../terminology');

/** @param {string} projectId @param {string} userId */
async function extractProjectIssues(projectId, userId) {
  const issues = [];
  const push = (kind, refKind, refId, refLabel, extra = {}) => issues.push({ kind, label: T.label(T.ISSUE_KIND, kind), refKind, refId, refLabel, ...extra });

  const jobs = await listFieldData(projectId, userId);
  for (const j of jobs.filter((x) => x.status === 'needs_review')) {
    push('CAPTURE_NEEDS_REVIEW', 'captureJob', j.id, T.captureLabel(j.mode, j.createdAt), { fileName: j.originalName || '' });
  }

  const [allFos, allRuns] = await Promise.all([
    FieldObservationSet.find({ projectId }).select('_id confirmedAt').lean(),
    FieldProcessingRun.find({ projectId }).select('processingType source.fieldObservationSetId traverse setups generatedPointIds createdAt').lean(),
  ]);
  const processedFosIds = new Set(allRuns.map((r) => String(r.source.fieldObservationSetId)));
  for (const f of allFos.filter((x) => !processedFosIds.has(String(x._id)))) {
    push('NOTEBOOK_NOT_PROCESSED', 'fieldObservationSet', String(f._id), T.observationSetLabel(f.confirmedAt));
  }

  for (const r of allRuns) {
    const isTraverse = (r.processingType || 'polar') === 'traverse';
    const runLabel = T.runLabel(summarizeRun(r));
    if (isTraverse) {
      const status = r.traverse && r.traverse.status;
      if (status === 'PARTIAL') push('TRAVERSE_PARTIAL', 'processingRun', String(r._id), runLabel);
      if (status === 'INVALID') push('TRAVERSE_INVALID', 'processingRun', String(r._id), runLabel);
      if (r.traverse && r.traverse.status === 'READY' && r.traverse.closure && r.traverse.closure.available === false && r.traverse.closure.reason === 'OPEN_TRAVERSE') {
        push('TRAVERSE_OPEN_NO_CLOSURE', 'processingRun', String(r._id), runLabel);
      }
    } else {
      const hasError = (r.setups || []).some((s) => (s.observations || []).some((o) => o.status === 'ERROR'));
      const hasXyOnly = (r.setups || []).some((s) => (s.observations || []).some((o) => o.status === 'XY_ONLY'));
      if (hasError) push('POLAR_HAS_ERRORS', 'processingRun', String(r._id), runLabel);
      if (hasXyOnly) push('POLAR_XY_ONLY', 'processingRun', String(r._id), runLabel);
    }
  }

  return issues;
}

module.exports = { extractProjectIssues };
