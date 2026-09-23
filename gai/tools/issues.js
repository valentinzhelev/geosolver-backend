/**
 * Deterministic issue extraction (V1 section 11): a fixed set of RULES over persisted data, computed BEFORE the
 * LLM is ever involved. The LLM may explain an issue in prose; it never decides whether one exists.
 */
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const { listFieldData } = require('./fieldData');

/** @param {string} projectId @param {string} userId */
async function extractProjectIssues(projectId, userId) {
  const issues = [];

  const jobs = await listFieldData(projectId, userId);
  for (const j of jobs.filter((x) => x.status === 'needs_review')) {
    issues.push({ kind: 'CAPTURE_NEEDS_REVIEW', label: `Заснемане "${j.originalName || ''}" чака преглед`, refKind: 'captureJob', refId: j.id });
  }

  const [allFos, allRuns] = await Promise.all([
    FieldObservationSet.find({ projectId }).select('_id').lean(),
    FieldProcessingRun.find({ projectId }).select('processingType source.fieldObservationSetId traverse.status setups').lean(),
  ]);
  const processedFosIds = new Set(allRuns.map((r) => String(r.source.fieldObservationSetId)));
  for (const f of allFos.filter((x) => !processedFosIds.has(String(x._id)))) {
    issues.push({ kind: 'NOTEBOOK_NOT_PROCESSED', label: 'Потвърден полев карнет още не е обработен', refKind: 'fieldObservationSet', refId: String(f._id) });
  }

  for (const r of allRuns) {
    const isTraverse = (r.processingType || 'polar') === 'traverse';
    if (isTraverse) {
      const status = r.traverse && r.traverse.status;
      if (status === 'PARTIAL') issues.push({ kind: 'TRAVERSE_PARTIAL', label: 'Полигонов ход с частичен резултат', refKind: 'processingRun', refId: String(r._id) });
      if (status === 'INVALID') issues.push({ kind: 'TRAVERSE_INVALID', label: 'Невалиден полигонов ход', refKind: 'processingRun', refId: String(r._id) });
      if (r.traverse && r.traverse.status === 'READY' && r.traverse.closure && r.traverse.closure.available === false && r.traverse.closure.reason === 'OPEN_TRAVERSE') {
        issues.push({ kind: 'TRAVERSE_OPEN_NO_CLOSURE', label: 'Отворен полигонов ход без независима невръзка (очаквано)', refKind: 'processingRun', refId: String(r._id) });
      }
    } else {
      const hasError = (r.setups || []).some((s) => (s.observations || []).some((o) => o.status === 'ERROR'));
      const hasXyOnly = (r.setups || []).some((s) => (s.observations || []).some((o) => o.status === 'XY_ONLY'));
      if (hasError) issues.push({ kind: 'POLAR_HAS_ERRORS', label: 'Полярна обработка с невалидни цели', refKind: 'processingRun', refId: String(r._id) });
      if (hasXyOnly) issues.push({ kind: 'POLAR_XY_ONLY', label: 'Полярна обработка с цели без кота (само X/Y)', refKind: 'processingRun', refId: String(r._id) });
    }
  }

  return issues;
}

module.exports = { extractProjectIssues };
