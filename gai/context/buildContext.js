/**
 * The GAI context layer (V1 section 3/15): question -> deterministic intent -> a SMALL set of tool calls ->
 * internal evidence `data` + machine-readable `evidence` refs. Never fetches everything for every question - each
 * branch is gated by the detected intent, and every list call caps its own row count (see gai/tools/*).
 *
 * `data` is INTERNAL (tool-shaped, contains ids/codes) and is never sent to a provider as-is: the provider only ever
 * sees gai/context/semanticContext.js's projection of it (formatContextForPrompt). `evidence` keeps real ids for
 * the UI's source chips and carries product-language labels only.
 */
const { detectIntent } = require('./intent');
const { toSemanticContext, redactInternalIdentifiers } = require('./semanticContext');
const {
  getProjectSummary, getSurveyPointByName, tracePointProvenance,
  listFieldData, listProcessingRuns, getProcessingRun, listReports, getCalculationHistory, extractProjectIssues,
} = require('../tools');
const T = require('../terminology');

const FIELD_DATA_CHIP_CAP = 5;

function dedupeEvidence(evidence) {
  const seen = new Set();
  const out = [];
  for (const e of evidence) {
    const key = `${e.kind}:${e.id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function processingFilter(intent) {
  if (intent.wantsOpenOnly) return 'open';
  if (intent.wantsTraverse && !intent.wantsPolar) return 'traverse';
  if (intent.wantsPolar && !intent.wantsTraverse) return 'polar';
  return 'any';
}

/** @param {{projectId:string, userId:string, question:string, previousQuestion?:string}} args */
async function buildContext({ projectId, userId, question, previousQuestion }) {
  const intent = detectIntent(question, { previousQuestion });
  const evidence = [];
  const data = {};

  const summary = await getProjectSummary(projectId);
  data.projectSummary = summary;
  evidence.push({ kind: 'project', id: projectId, label: (summary.project && summary.project.name) || 'Проект' });

  const points = [];
  for (const candidate of intent.pointNameCandidates) {
    const res = await getSurveyPointByName(projectId, candidate);
    if (res.status === 'FOUND') {
      const prov = await tracePointProvenance(projectId, res.point.id);
      const entry = { requested: candidate, status: 'FOUND', point: res.point, provenanceChain: prov.status === 'FOUND' ? prov.chain : null, provenance: prov.status === 'FOUND' ? prov : null };
      points.push(entry);
      evidence.push({ kind: 'surveyPoint', id: res.point.id, label: T.pointLabel(res.point.name) });
      if (prov.status === 'FOUND') {
        for (const step of prov.chain) if (step.kind !== 'point' && step.id) evidence.push({ kind: step.kind, id: step.id, label: step.label });
      }
      // internal only: the full source run detail (the provider sees just the one relevant observation of it)
      if (res.point.source && res.point.source.kind === 'field-processing') {
        const runStep = (prov.chain || []).find((s) => s.kind === 'processingRun');
        if (runStep) {
          const runDetail = await getProcessingRun(projectId, runStep.id);
          if (runDetail.status === 'FOUND') entry.sourceProcessingRun = runDetail;
        }
      }
    } else if (res.status === 'AMBIGUOUS') {
      points.push({ requested: candidate, status: 'AMBIGUOUS', candidates: res.candidates });
    } else {
      points.push({ requested: candidate, status: 'NOT_FOUND' });
    }
  }
  if (points.length) data.points = points;

  if (intent.wantsReview || intent.wantsFieldData) {
    data.fieldData = await listFieldData(projectId, userId);
    const relevant = intent.wantsReview ? data.fieldData.filter((j) => j.status === 'needs_review') : data.fieldData;
    for (const j of relevant.slice(0, FIELD_DATA_CHIP_CAP)) evidence.push({ kind: 'captureJob', id: j.id, label: T.captureLabel(j.mode, j.createdAt) });
  }
  if (intent.wantsReview || intent.wantsOverview) {
    data.issues = await extractProjectIssues(projectId, userId);
  }

  if (intent.wantsTraverse || intent.wantsPolar || intent.wantsProcessing || intent.wantsCreatedPoints) {
    const filter = processingFilter(intent);
    const runs = await listProcessingRuns(projectId);
    const filtered = runs.filter((r) => {
      if (filter === 'open') return r.processingType === 'traverse' && r.traverseType === 'OPEN';
      if (filter === 'traverse') return r.processingType === 'traverse';
      if (filter === 'polar') return r.processingType === 'polar';
      return true;
    });
    data.processingQuery = { filter, matchCount: filtered.length };
    data.processingRuns = filtered.slice(0, 10);
    if (filtered.length) {
      const detail = await getProcessingRun(projectId, filtered[0].id);
      if (detail.status === 'FOUND') {
        data.latestMatchingRunDetail = detail;
        evidence.push({ kind: 'processingRun', id: filtered[0].id, label: T.runLabel(detail.summary) });
      }
    }
  } else if (intent.wantsOverview && summary.processing && summary.processing.total > 0) {
    data.recentRuns = (await listProcessingRuns(projectId)).slice(0, 3);
  }

  if (intent.wantsReports) {
    data.reports = await listReports(projectId);
    for (const r of data.reports.slice(0, FIELD_DATA_CHIP_CAP)) evidence.push({ kind: 'report', id: r.id, label: r.title });
  }
  if (intent.wantsCalculations) {
    data.calculations = await getCalculationHistory(projectId);
  }

  return { intent, data, evidence: dedupeEvidence(evidence) };
}

/** The provider-facing data block: the semantic projection, never the internal `data` itself. */
function formatContextForPrompt(context) {
  return JSON.stringify(toSemanticContext(context), null, 2);
}

/** Back-compat name (V1.0.1) for the hardened identifier redaction now living in semanticContext.js. */
const stripInternalIds = redactInternalIdentifiers;

module.exports = { buildContext, formatContextForPrompt, stripInternalIds };
