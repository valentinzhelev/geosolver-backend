/**
 * Report generation orchestration (V2.5): given ALREADY-FETCHED authoritative source data (a FieldProcessingRun +
 * its FieldObservationSet, or a project's current SurveyPoints snapshot), builds the deterministic report model,
 * renders it to a PDF buffer, and returns everything the route needs to persist a ReportDocument. Never fetches
 * anything itself and never re-runs a geodetic engine - that already happened when the source was first computed.
 */
const { getConfig } = require('./config');
const { buildPolarReportModel } = require('./modelBuilders/polarReportModel');
const { buildTraverseReportModel } = require('./modelBuilders/traverseReportModel');
const { buildCoordinateListReportModel } = require('./modelBuilders/coordinateListReportModel');
const { renderPolarReport } = require('./render/renderPolarReport');
const { renderTraverseReport } = require('./render/renderTraverseReport');
const { renderCoordinateListReport } = require('./render/renderCoordinateListReport');
const { generatePdfBuffer } = require('./render/pdf');

const REPORT_TYPES = ['POLAR_PROCESSING_REPORT', 'TRAVERSE_PROCESSING_REPORT', 'PROJECT_COORDINATE_LIST'];

/**
 * @param {{reportType:string, project:object, run?:object, fos?:object, points?:object[], generatedBy:object,
 *   generatedAt:Date, documentNumber?:string|null, bg?:boolean}} args
 * @returns {Promise<{model:object, pdfBuffer:Buffer, title:string, sourceType:string, sourceId:string|null,
 *   sourceVersion:object, templateVersion:string}>}
 */
async function buildAndRenderReport({ reportType, project, run, fos, points, generatedBy, generatedAt, documentNumber = null, bg = true }) {
  const { templateVersion } = getConfig();
  let model;
  let docDefinition;
  let sourceType;
  let sourceId;
  let sourceVersion;

  if (reportType === 'POLAR_PROCESSING_REPORT') {
    model = buildPolarReportModel({ run, fos, project, generatedBy, generatedAt, documentNumber });
    docDefinition = renderPolarReport(model, bg);
    sourceType = 'field-processing-run';
    sourceId = run._id;
    sourceVersion = { processingVersion: run.processingVersion, engineVersions: run.engineVersions };
  } else if (reportType === 'TRAVERSE_PROCESSING_REPORT') {
    model = buildTraverseReportModel({ run, project, generatedBy, generatedAt, documentNumber });
    docDefinition = renderTraverseReport(model, bg);
    sourceType = 'field-processing-run';
    sourceId = run._id;
    sourceVersion = { processingVersion: run.processingVersion, engineVersions: run.engineVersions };
  } else if (reportType === 'PROJECT_COORDINATE_LIST') {
    model = buildCoordinateListReportModel({ project, points, generatedBy, generatedAt, documentNumber });
    docDefinition = renderCoordinateListReport(model, bg);
    sourceType = 'project-points-snapshot';
    sourceId = null;
    sourceVersion = { pointCount: points.length, snapshotAt: generatedAt };
  } else {
    throw new Error(`Unknown report type: ${reportType}`);
  }

  const pdfBuffer = await generatePdfBuffer(docDefinition);
  return { model, pdfBuffer, title: model.title, sourceType, sourceId, sourceVersion, templateVersion };
}

module.exports = { buildAndRenderReport, REPORT_TYPES };
