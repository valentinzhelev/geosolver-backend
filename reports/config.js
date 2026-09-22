/**
 * Report engine template version (V2.5 section 2/10). Stamped onto every ReportDocument alongside its full model
 * snapshot, so a historical document's exact rendering can be distinguished from a later template revision even
 * though it is never actually re-rendered from live data.
 */
function getConfig() {
  return { templateVersion: 'report-engine-2.5.0.0' };
}

module.exports = { getConfig };
