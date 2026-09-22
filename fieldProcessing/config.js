/**
 * Field Processing V2.4.1 configuration - the label stamped on every FieldProcessingRun (alongside the exact
 * fieldProcessing/engines/registry.js engine versions used), so a future change to the orchestration logic itself
 * (fieldProcessing/processRun.js) never silently reinterprets a historical run.
 */
function getConfig() {
  return {
    processingVersion: 'field-processing-2.4.1.0',
  };
}

module.exports = { getConfig };
