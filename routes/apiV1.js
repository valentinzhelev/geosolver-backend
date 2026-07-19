const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SurveyPoint = require('../models/SurveyPoint');
const FieldBookProject = require('../models/FieldBookProject');
const User = require('../models/User');
const { getSharedProjectIds, getProjectAccess } = require('../utils/workspaceAccess');

router.use(auth);

/** GET /api/v1/me — account summary for integrations */
router.get('/me', async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('email name role createdAt');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /api/v1/points — same ownership filters as /api/points */
router.get('/points', async (req, res) => {
  try {
    let ownership;
    if (req.query.projectId) {
      const access = await getProjectAccess(req.userId, req.query.projectId);
      if (!access.ok) {
        return res.status(403).json({ success: false, message: 'No access to this project.' });
      }
      ownership = { projectId: req.query.projectId };
    } else {
      const sharedIds = await getSharedProjectIds(req.userId);
      ownership = sharedIds.length
        ? { $or: [{ user: req.userId }, { projectId: { $in: sharedIds } }] }
        : { user: req.userId };
    }

    const andParts = [ownership];
    if (req.query.layer) andParts.push({ layer: req.query.layer });
    const q = String(req.query.q || '').trim();
    if (q) {
      andParts.push({
        $or: [
          { name: new RegExp(q, 'i') },
          { code: new RegExp(q, 'i') },
          { notes: new RegExp(q, 'i') },
        ],
      });
    }

    const filter = andParts.length === 1 ? andParts[0] : { $and: andParts };
    const points = await SurveyPoint.find(filter).sort({ updatedAt: -1 }).limit(500);
    res.json({ success: true, data: points, count: points.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** GET /api/v1/projects — user's field book projects (sites) */
router.get('/projects', async (req, res) => {
  try {
    const sharedIds = await getSharedProjectIds(req.userId);
    const filter = sharedIds.length
      ? { $or: [{ user: req.userId }, { _id: { $in: sharedIds } }] }
      : { user: req.userId };
    const projects = await FieldBookProject.find(filter).sort({ updatedAt: -1 });
    res.json({ success: true, data: projects, count: projects.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
