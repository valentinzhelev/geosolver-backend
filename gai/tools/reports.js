/**
 * Read-only generated-report lookups (V1 section 4).
 */
const Report = require('../../models/Report');

/** @param {string} projectId */
async function listReports(projectId) {
  const reports = await Report.find({ projectId }).select('-model').sort({ createdAt: -1 }).limit(50);
  return reports.map((r) => {
    const o = typeof r.toObject === 'function' ? r.toObject() : r;
    return {
      id: String(o._id), reportType: o.reportType, title: o.title, sourceType: o.sourceType,
      sourceId: o.sourceId ? String(o.sourceId) : null, generatedAt: o.generatedAt, fileSize: o.file.size,
    };
  });
}

module.exports = { listReports };
