/**
 * Read-only SurveyPoint lookups (V1 section 4). Every function is project-scoped - a point id/name that does not
 * belong to the given project is treated as not found, never returned from another project (section 16).
 */
const SurveyPoint = require('../../models/SurveyPoint');

const norm = (s) => String(s || '').trim().toLowerCase();

function publicPoint(p) {
  return {
    id: String(p._id), name: p.name, code: p.code || '',
    x: typeof p.x === 'number' ? p.x : null, y: typeof p.y === 'number' ? p.y : null, h: typeof p.h === 'number' ? p.h : null,
    source: p.source ? { kind: p.source.kind, processingType: p.source.processingType || null } : null,
    notes: p.notes || '',
  };
}

/** @param {string} projectId @param {{limit?:number}} [opts] */
async function listProjectPoints(projectId, opts = {}) {
  const limit = Math.min(opts.limit || 200, 500);
  const points = await SurveyPoint.find({ projectId }).select('name code x y h source notes').limit(limit).lean();
  return points.map(publicPoint);
}

/** Resolves a point by NAME within the project (never trusts a bare id that wasn't already verified project-scoped). */
async function getSurveyPointByName(projectId, name) {
  const target = norm(name);
  if (!target) return { status: 'NOT_FOUND' };
  const points = await SurveyPoint.find({ projectId }).select('name code x y h source notes createdAt').lean();
  const matches = points.filter((p) => norm(p.name) === target);
  if (matches.length === 0) return { status: 'NOT_FOUND' };
  if (matches.length > 1) return { status: 'AMBIGUOUS', candidates: matches.map(publicPoint) };
  return { status: 'FOUND', point: publicPoint(matches[0]) };
}

/** Resolves a point by id, but ONLY if it belongs to the given project. */
async function getSurveyPointById(projectId, pointId) {
  const p = await SurveyPoint.findOne({ _id: pointId, projectId }).select('name code x y h source notes').lean();
  return p ? { status: 'FOUND', point: publicPoint(p) } : { status: 'NOT_FOUND' };
}

/**
 * One real point name from this project for a starter question - preferring a processing-generated point (the
 * most informative provenance), then a captured one, then any. Never suggests a point that does not exist.
 */
async function pickExamplePointName(projectId) {
  for (const filter of [{ 'source.kind': 'field-processing' }, { 'source.kind': 'capture' }, {}]) {
    // eslint-disable-next-line no-await-in-loop
    const [p] = await SurveyPoint.find({ projectId, ...filter }).select('name').limit(1).lean();
    if (p && p.name) return p.name;
  }
  return null;
}

module.exports = { listProjectPoints, getSurveyPointByName, getSurveyPointById, publicPoint, pickExamplePointName };
