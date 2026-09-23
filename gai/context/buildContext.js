/**
 * The GAI context layer (V1 section 3/15): question -> deterministic intent -> a SMALL set of tool calls ->
 * compact structured evidence. Never fetches everything for every question - each branch below is gated by the
 * detected intent, and every list call already caps its own row count (see gai/tools/*).
 */
const { detectIntent } = require('./intent');
const {
  getProjectSummary, getSurveyPointByName, tracePointProvenance,
  listFieldData, listProcessingRuns, getProcessingRun, listReports, getCalculationHistory, extractProjectIssues,
} = require('../tools');

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

/** @param {{projectId:string, userId:string, question:string}} args */
async function buildContext({ projectId, userId, question }) {
  const intent = detectIntent(question);
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
      points.push({ requested: candidate, status: 'FOUND', point: res.point, provenanceChain: prov.status === 'FOUND' ? prov.chain : null });
      evidence.push({ kind: 'surveyPoint', id: res.point.id, label: res.point.name });
      if (prov.status === 'FOUND') {
        for (const step of prov.chain) if (step.kind !== 'point' && step.id) evidence.push({ kind: step.kind, id: step.id, label: step.label });
      }
      // if this point came from a processing run, include that run's own detail (its height-reason codes etc.)
      if (res.point.source && res.point.source.kind === 'field-processing') {
        const runStep = (prov.chain || []).find((s) => s.kind === 'processingRun');
        if (runStep) {
          const runDetail = await getProcessingRun(projectId, runStep.id);
          if (runDetail.status === 'FOUND') points[points.length - 1].sourceProcessingRun = runDetail;
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
    for (const j of data.fieldData) evidence.push({ kind: 'captureJob', id: j.id, label: j.originalName || j.mode });
  }
  if (intent.wantsReview || intent.wantsSummary) {
    data.issues = await extractProjectIssues(projectId, userId);
  }

  if (intent.wantsTraverse || intent.wantsPolar || intent.wantsCreatedPoints) {
    const runs = await listProcessingRuns(projectId);
    let filtered = runs;
    if (intent.wantsTraverse && !intent.wantsPolar) filtered = filtered.filter((r) => r.processingType === 'traverse');
    if (intent.wantsPolar && !intent.wantsTraverse) filtered = filtered.filter((r) => r.processingType === 'polar');
    if (intent.wantsOpenOnly) filtered = filtered.filter((r) => r.processingType === 'traverse' && r.traverseType === 'OPEN');
    data.processingRuns = filtered.slice(0, 10);
    if (filtered.length) {
      const detail = await getProcessingRun(projectId, filtered[0].id);
      if (detail.status === 'FOUND') {
        data.latestMatchingRunDetail = detail;
        evidence.push({ kind: 'processingRun', id: filtered[0].id, label: detail.summary.processingType === 'traverse' ? 'Полигонов ход' : 'Полярна обработка' });
      }
    }
  }

  if (intent.wantsReports) {
    data.reports = await listReports(projectId);
    for (const r of data.reports) evidence.push({ kind: 'report', id: r.id, label: r.title });
  }
  if (intent.wantsCalculations) {
    data.calculations = await getCalculationHistory(projectId);
  }

  return { intent, data, evidence: dedupeEvidence(evidence) };
}

/**
 * V1.0.1 production fix: `data` carries raw Mongo ObjectId strings (point/run/report/... `id`/`*Id` fields) so the
 * server can build `evidence` for source chips - but the LLM has no use for them (it already gets human-readable
 * `label`/`name` fields alongside every id) and a live production answer echoed one back in prose. Strip every
 * `id`/`_id`/`...Id` key before the data ever reaches the prompt; `context.evidence` (used for the API response's
 * clickable chips) is built separately and is NEVER passed through this function, so chip navigation is unaffected.
 */
function stripInternalIds(value) {
  if (Array.isArray(value)) return value.map(stripInternalIds);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (/^_?id$/i.test(key) || /Id$/.test(key)) continue;
      out[key] = stripInternalIds(v);
    }
    return out;
  }
  return value;
}

/** Renders the compact evidence bundle as a fenced JSON block for the provider prompt - never prose the LLM could reinterpret loosely. */
function formatContextForPrompt(context) {
  return JSON.stringify(stripInternalIds(context.data), null, 2);
}

module.exports = { buildContext, formatContextForPrompt, stripInternalIds };
