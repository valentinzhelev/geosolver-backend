/**
 * The provenance graph resolver (V1 section 5): "Откъде идва тази точка?" -> an explicit step-by-step chain,
 * server-resolved, never guessed - and never exposing a raw Mongo model name to the user (the LLM turns this
 * structured chain into Bulgarian prose; this function only supplies the facts).
 *
 * Chains understood:
 *   SurveyPoint -> FieldProcessingRun -> FieldObservationSet -> CaptureJob   (polar/traverse-generated point)
 *   SurveyPoint -> CaptureJob                                                (coordinate-table import)
 *   SurveyPoint -> Calculation                                               (Canonical Engine "create point")
 *   SurveyPoint (no source at all)                                           (manually entered)
 *
 * Every id in the chain is re-resolved by querying with the SAME projectId the caller already verified access
 * to - a point/run/job that does not belong to this project is simply absent from the chain, never followed.
 */
const SurveyPoint = require('../../models/SurveyPoint');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const FieldObservationSet = require('../../models/FieldObservationSet');
const CaptureJob = require('../../models/CaptureJob');
const Calculation = require('../../models/Calculation');
const { publicPoint } = require('./points');

const CAPTURE_MODE_LABEL = { 'field-notebook': 'Полев карнет', 'coordinate-table': 'Таблица с координати' };

/** @param {string} projectId @param {string} pointId */
async function tracePointProvenance(projectId, pointId) {
  const point = await SurveyPoint.findOne({ _id: pointId, projectId });
  if (!point) return { status: 'NOT_FOUND' };

  const chain = [{ kind: 'point', id: String(point._id), label: point.name }];
  const source = point.source;

  if (source && source.kind === 'field-processing' && source.processingRunId) {
    const run = await FieldProcessingRun.findOne({ _id: source.processingRunId, projectId });
    if (run) {
      const isTraverse = (run.processingType || 'polar') === 'traverse';
      chain.push({
        kind: 'processingRun', id: String(run._id),
        label: isTraverse ? 'Обработка на полигонов ход' : 'Полярна обработка',
        processingType: run.processingType || 'polar',
      });
      const fos = run.source ? await FieldObservationSet.findOne({ _id: run.source.fieldObservationSetId, projectId }) : null;
      if (fos) {
        chain.push({ kind: 'fieldObservationSet', id: String(fos._id), label: 'Потвърден полев карнет' });
        const job = fos.source ? await CaptureJob.findOne({ _id: fos.source.captureJobId, project: projectId }) : null;
        if (job) chain.push({ kind: 'captureJob', id: String(job._id), label: job.originalName || (CAPTURE_MODE_LABEL[job.mode] || 'Заснемане'), mode: job.mode });
      }
    }
  } else if (source && source.kind === 'capture' && source.captureJobId) {
    const job = await CaptureJob.findOne({ _id: source.captureJobId, project: projectId });
    if (job) chain.push({ kind: 'captureJob', id: String(job._id), label: job.originalName || (CAPTURE_MODE_LABEL[job.mode] || 'Заснемане'), mode: job.mode });
  } else if (point.sourceCalculationId) {
    const calc = await Calculation.findOne({ _id: point.sourceCalculationId, projectId }).select('toolDisplayName');
    if (calc) chain.push({ kind: 'calculation', id: String(calc._id), label: (calc.toolDisplayName && calc.toolDisplayName.bg) || 'Изчисление' });
  } else {
    chain.push({ kind: 'manual', label: 'Ръчно въведена точка' });
  }

  return { status: 'FOUND', point: publicPoint(point), chain };
}

module.exports = { tracePointProvenance };
