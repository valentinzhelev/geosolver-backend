const express = require('express');
const router = express.Router();
const Calculation = require('../models/Calculation');
const auth = require('../middleware/auth');
const { getProjectAccess } = require('../utils/workspaceAccess');

/**
 * GET /api/projects/:projectId/calculations
 * The project's shared calculation history — every contributor's saved
 * calculations for this project, not just the caller's own (that's what
 * GET /api/calculations already is, and remains, unchanged).
 * Read access only (viewer or above); mirrors the list-view shape of
 * GET /api/calculations (paginated, input/result stripped) so
 * CalculationHistoryPage can be reused in a "project mode" instead of
 * duplicated.
 */
router.get('/:projectId/calculations', auth, async (req, res) => {
  try {
    const access = await getProjectAccess(req.user.id, req.params.projectId);
    if (!access.ok) {
      return res.status(403).json({ error: 'No access to this project' });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { projectId: req.params.projectId };

    const calculations = await Calculation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-inputData -resultData');

    const total = await Calculation.countDocuments(filter);

    res.json({
      calculations,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        totalItems: total,
        hasNext: skip + calculations.length < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
