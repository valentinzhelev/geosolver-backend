/**
 * Read-only Canonical Calculation history lookup (V1 section 4). Reuses the Calculation model directly (the
 * Canonical Calculation Engine itself is never touched by GAI - see CLAUDE.md).
 */
const Calculation = require('../../models/Calculation');

/** @param {string} projectId */
async function getCalculationHistory(projectId) {
  const calcs = await Calculation.find({ projectId }).select('toolName toolDisplayName createdAt resultAuthority').sort({ createdAt: -1 }).limit(50).lean();
  return calcs.map((c) => ({
    id: String(c._id), toolName: c.toolName, title: c.toolDisplayName ? c.toolDisplayName.bg : c.toolName, createdAt: c.createdAt,
  }));
}

module.exports = { getCalculationHistory };
