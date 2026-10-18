/**
 * The provenance graph resolver (V1 section 5): "Откъде идва тази точка?" -> an explicit step-by-step chain,
 * server-resolved, never guessed. Step `label`s are product-level Bulgarian (gai/terminology.js) - internal model
 * names never appear in them; the `kind`/`id` pair stays machine-readable for evidence chips only.
 *
 * Chains understood:
 *   SurveyPoint -> FieldProcessingRun -> FieldObservationSet -> CaptureJob   (polar/traverse-generated point)
 *   SurveyPoint -> FieldProcessingRun -> FieldObservationSet -> FieldSession -> InstrumentImport  (from an instrument file)
 *   SurveyPoint -> CaptureJob                                                (coordinate-table import)
 *   SurveyPoint -> Calculation                                               (Canonical Engine "create point")
 *   SurveyPoint (no recorded source)                                         (entered manually or imported)
 *
 * V1.0.2: for a processing-generated point it also resolves WHICH observation produced it - the run-level result
 * (`sourceResult`: the polar target or traverse leg, incl. its persisted height reason) and the raw confirmed field
 * measurement (`fieldMeasurement`). Every id is re-resolved with the SAME projectId - a record that does not belong
 * to this project is simply absent from the chain, never followed.
 */
const SurveyPoint = require('../../models/SurveyPoint');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const FieldObservationSet = require('../../models/FieldObservationSet');
const CaptureJob = require('../../models/CaptureJob');
const Calculation = require('../../models/Calculation');
const FieldSession = require('../../models/FieldSession');
const InstrumentImport = require('../../models/InstrumentImport');
const { publicPoint } = require('./points');
const { summarizeRun, findRunResultForPoint } = require('./processing');
const T = require('../terminology');
const { ownerOfJob, pagesOf } = require('../../fieldSessions/pages');

function fieldMeasurementFor(fos, runResult) {
  if (!fos || !runResult) return null;
  const setupIndex = runResult.kind === 'leg' ? runResult.leg.sourceObservation.setupIndex : runResult.setup.index;
  const row = runResult.kind === 'leg' ? runResult.leg.sourceObservation.row : runResult.observation.index;
  const setup = (fos.setups || []).find((s) => s.index === setupIndex);
  const obs = setup && (setup.observations || []).find((o) => o.row === row);
  if (!obs) return null;
  return {
    // a multi-page session's observation says which notebook PAGE it was read from (1-based); absent for manual / single-capture data
    page: obs.source && Number.isInteger(obs.source.page) ? obs.source.page + 1 : null,
    // an instrument-imported observation says which LINE of the file it came from; absent otherwise
    fileLine: obs.source && obs.source.kind === 'instrument' && Number.isInteger(obs.source.line) ? obs.source.line : null,
    station: setup.station ? setup.station.point : null,
    instrumentHeight: setup.station ? setup.station.instrumentHeight || null : null,
    orientationTarget: setup.orientation ? setup.orientation.target : null,
    target: obs.target, hz: obs.hz || null, vz: obs.vz || null, slopeDistance: obs.distance || null,
    horizontalDistance: obs.horizontalDistance || null, prismHeight: obs.prismHeight || null,
    code: obs.code || '', notes: obs.notes || '',
  };
}

/** @param {string} projectId @param {string} pointId */
async function tracePointProvenance(projectId, pointId) {
  const point = await SurveyPoint.findOne({ _id: pointId, projectId });
  if (!point) return { status: 'NOT_FOUND' };

  const chain = [{ kind: 'point', id: String(point._id), label: T.pointLabel(point.name) }];
  const source = point.source;
  let sourceResult = null;
  let fieldMeasurement = null;
  let runSummary = null;
  let originKind = 'unrecorded';

  if (source && source.kind === 'field-processing' && source.processingRunId) {
    originKind = 'processing';
    const run = await FieldProcessingRun.findOne({ _id: source.processingRunId, projectId });
    if (run) {
      const r = typeof run.toObject === 'function' ? run.toObject() : run;
      runSummary = summarizeRun(r);
      chain.push({ kind: 'processingRun', id: String(r._id), label: T.runLabel(runSummary), processingType: runSummary.processingType });
      sourceResult = findRunResultForPoint(r, source);
      const fos = r.source ? await FieldObservationSet.findOne({ _id: r.source.fieldObservationSetId, projectId }) : null;
      if (fos) {
        chain.push({ kind: 'fieldObservationSet', id: String(fos._id), label: T.observationSetLabel(fos.confirmedAt) });
        fieldMeasurement = fieldMeasurementFor(fos, sourceResult);
        // Field Sessions: a session-origin set names its session; an OCR-origin set may sit inside a session too
        // (found through its capture job). Either way the session is a step between the evidence and its source.
        const fromSession = !!(fos.source && fos.source.kind === 'session' && fos.source.fieldSessionId);
        const job = !fromSession && fos.source && fos.source.captureJobId ? await CaptureJob.findOne({ _id: fos.source.captureJobId, project: projectId }) : null;
        const session = fromSession
          ? await FieldSession.findOne({ _id: fos.source.fieldSessionId, projectId })
          : (job ? await FieldSession.findOne({ ...ownerOfJob(job._id), projectId }) : null);
        if (session) {
          const pageCount = fromSession && Array.isArray(fos.pages) ? fos.pages.length : pagesOf(session).length;
          chain.push({
            kind: 'fieldSession', id: String(session._id), label: T.sessionLabel(session), sourceKind: session.source && session.source.kind,
            ...(pageCount > 1 ? { pageCount } : {}),
            ...(pageCount > 1 && fieldMeasurement && fieldMeasurement.page ? { page: fieldMeasurement.page } : {}),
          });
        }
        if (job) chain.push({ kind: 'captureJob', id: String(job._id), label: T.captureLabel(job.mode, job.createdAt), mode: job.mode, fileName: (job.source && job.source.originalName) || '' });
        // Instrument Import: the set records the file it was confirmed from; the import record (same project) adds its counts
        if (fromSession && fos.instrumentImport && fos.instrumentImport.importId) {
          const info = fos.instrumentImport;
          const imp = await InstrumentImport.findOne({ _id: info.importId, projectId }).select('confirmed').lean();
          const summary = imp && imp.confirmed && imp.confirmed.summary;
          chain.push({
            kind: 'instrumentImport',
            id: String(info.importId),
            label: T.instrumentImportLabel(info.vendor, info.format),
            vendor: info.vendor,
            format: info.format,
            fileName: info.fileName || '',
            observationCount: (fos.setups || []).reduce((n, s) => n + (s.observations || []).length, 0),
            ...(summary ? { warningCount: summary.warnings || 0, excludedCount: summary.excluded || 0 } : {}),
          });
        }
      }
    }
  } else if (source && source.kind === 'capture' && source.captureJobId) {
    originKind = 'capture';
    const job = await CaptureJob.findOne({ _id: source.captureJobId, project: projectId });
    if (job) chain.push({ kind: 'captureJob', id: String(job._id), label: T.captureLabel(job.mode, job.createdAt), mode: job.mode, fileName: (job.source && job.source.originalName) || '' });
  } else if (point.sourceCalculationId) {
    originKind = 'calculation';
    const calc = await Calculation.findOne({ _id: point.sourceCalculationId, projectId }).select('toolDisplayName createdAt');
    if (calc) chain.push({ kind: 'calculation', id: String(calc._id), label: (calc.toolDisplayName && calc.toolDisplayName.bg) || 'Изчисление' });
  } else {
    chain.push({ kind: 'manual', label: 'Няма записан източник (въведена ръчно или импортирана)' });
  }

  return { status: 'FOUND', point: publicPoint(point), chain, originKind, runSummary, sourceResult, fieldMeasurement };
}

module.exports = { tracePointProvenance };
