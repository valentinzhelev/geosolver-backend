/**
 * The full read-only GAI tool registry (V1 section 4). Every function here is project-scoped by construction
 * (each query filters by the caller-supplied, already access-checked projectId) - there are no write tools, not
 * even hidden ones (section 17).
 */
const { getProjectSummary } = require('./projectSummary');
const { listProjectPoints, getSurveyPointByName, getSurveyPointById, pickExamplePointName } = require('./points');
const { tracePointProvenance } = require('./provenance');
const { listFieldData, getFieldDataItem } = require('./fieldData');
const { listProcessingRuns, getProcessingRun } = require('./processing');
const { listReports } = require('./reports');
const { getCalculationHistory } = require('./calculations');
const { extractProjectIssues } = require('./issues');

module.exports = {
  getProjectSummary,
  listProjectPoints, getSurveyPointByName, getSurveyPointById, pickExamplePointName,
  tracePointProvenance,
  listFieldData, getFieldDataItem,
  listProcessingRuns, getProcessingRun,
  listReports,
  getCalculationHistory,
  extractProjectIssues,
};
