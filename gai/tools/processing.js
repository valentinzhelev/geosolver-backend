/**
 * Read-only Field Processing lookups (V1 section 4/10). Deliberately compact summaries, NOT the raw persisted
 * `setups`/`traverse.legs` structure verbatim - section 3/15 ("do not stuff every historical row into every
 * prompt", "use limits internally"). Detail rows are capped so one pathologically large run cannot blow the
 * context budget. Every number here is read from the persisted FieldProcessingRun, never recomputed.
 */
const FieldProcessingRun = require('../../models/FieldProcessingRun');

const ROW_CAP = 30;

function observationCounts(setups) {
  const counts = { READY: 0, XY_ONLY: 0, WARNING: 0, ERROR: 0 };
  for (const setup of setups) for (const o of setup.observations) counts[o.status] = (counts[o.status] || 0) + 1;
  return counts;
}

function summarizeRun(run) {
  const isTraverse = (run.processingType || 'polar') === 'traverse';
  if (isTraverse) {
    const t = run.traverse;
    return {
      id: String(run._id), processingType: 'traverse', createdAt: run.createdAt,
      traverseType: t.traverseType, start: t.startIdentifier, end: t.endIdentifier || null,
      legCount: t.legs.length, status: t.status,
      closureAvailable: !!(t.closure && t.closure.available),
      adjustmentApplied: !!(t.adjustment && t.adjustment.applied),
      generatedPointCount: (run.generatedPointIds || []).length,
    };
  }
  const targetCount = run.setups.reduce((s, setup) => s + setup.observations.length, 0);
  return {
    id: String(run._id), processingType: 'polar', createdAt: run.createdAt,
    stations: run.setups.map((s) => s.station.identifier),
    targetCount, counts: observationCounts(run.setups),
    generatedPointCount: (run.generatedPointIds || []).length,
  };
}

/** @param {string} projectId */
async function listProcessingRuns(projectId) {
  const runs = await FieldProcessingRun.find({ projectId }).sort({ createdAt: -1 }).limit(50);
  return runs.map((r) => summarizeRun(typeof r.toObject === 'function' ? r.toObject() : r));
}

function polarDetail(run) {
  const setups = run.setups.map((setup) => ({
    stationIdentifier: setup.station.identifier,
    stationPoint: setup.station.point ? { x: setup.station.point.x, y: setup.station.point.y, h: setup.station.point.h } : null,
    orientationIdentifier: setup.orientation ? setup.orientation.identifier : null,
    orientationConstantGon: setup.orientationConstantGon,
    setupError: setup.setupError,
    observations: setup.observations.slice(0, ROW_CAP).map((o) => ({
      target: o.target, status: o.status, directionGon: o.direction, horizontalDistance: o.horizontalDistance,
      x: o.x, y: o.y, h: o.h, heightReason: o.heightReason || null,
    })),
  }));
  return { processingType: 'polar', verticalAngleConvention: run.verticalAngleConvention || null, setups };
}

function traverseDetail(run) {
  const t = run.traverse;
  return {
    processingType: 'traverse',
    traverseType: t.traverseType,
    start: t.start ? { identifier: t.start.identifier, point: t.start.point } : null,
    orientation: t.orientation ? { identifier: t.orientation.identifier, point: t.orientation.point } : null,
    end: t.end ? { identifier: t.end.identifier, point: t.end.point } : null,
    sequenceState: t.sequence ? t.sequence.state : null,
    status: t.status,
    closure: t.closure,
    adjustment: t.adjustment ? { method: t.adjustment.method, applied: t.adjustment.applied, reasonNotApplied: t.adjustment.reasonNotApplied || null } : null,
    legs: t.legs.slice(0, ROW_CAP).map((l) => ({
      from: l.from, to: l.to, status: l.status, bearingGon: l.bearingGon, horizontalDistance: l.horizontalDistance,
      rawX: l.rawX, rawY: l.rawY, rawH: l.rawH, adjustedX: l.adjustedX, adjustedY: l.adjustedY, heightReason: l.heightReason || null,
    })),
  };
}

/** @param {string} projectId @param {string} runId */
async function getProcessingRun(projectId, runId) {
  const run = await FieldProcessingRun.findOne({ _id: runId, projectId });
  if (!run) return { status: 'NOT_FOUND' };
  const o = typeof run.toObject === 'function' ? run.toObject() : run;
  const isTraverse = (o.processingType || 'polar') === 'traverse';
  return {
    status: 'FOUND',
    summary: summarizeRun(o),
    detail: isTraverse ? traverseDetail(o) : polarDetail(o),
    generatedPointIds: (o.generatedPointIds || []).map(String),
    sourceCaptureJobId: o.source ? String(o.source.captureJobId) : null,
  };
}

module.exports = { listProcessingRuns, getProcessingRun };
