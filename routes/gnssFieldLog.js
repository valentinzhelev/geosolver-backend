const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const GnssFieldLog = require('../models/GnssFieldLog');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');

router.use(auth);

function sanitizeBody(body = {}) {
  return {
    date: body.date != null ? String(body.date) : '',
    site: body.site != null ? String(body.site).trim() : '',
    base: body.base != null ? String(body.base).trim() : '',
    rover: body.rover != null ? String(body.rover).trim() : '',
    antennaHeight: body.antennaHeight != null ? String(body.antennaHeight) : '',
    fixType: body.fixType != null ? String(body.fixType).trim() : '',
    hdop: body.hdop != null ? String(body.hdop) : '',
    notes: body.notes != null ? String(body.notes) : '',
  };
}

router.get('/', async (req, res) => {
  try {
    const filter = { user: req.userId };
    if (req.query.projectId) {
      const access = await getProjectAccess(req.userId, req.query.projectId);
      if (!access.ok) {
        return res.status(403).json({ success: false, message: 'Нямате достъп до този проект.' });
      }
      filter.projectId = req.query.projectId;
    }
    const entries = await GnssFieldLog.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const fields = sanitizeBody(req.body);
    let projectId = req.body.projectId || null;
    if (projectId) {
      const access = await getProjectAccess(req.userId, projectId);
      if (!access.ok || !hasMinRole(access.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за този проект.' });
      }
    }
    const entry = await GnssFieldLog.create({
      user: req.userId,
      projectId,
      ...fields,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await GnssFieldLog.deleteOne({ _id: req.params.id, user: req.userId });
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: 'Записът не е намерен.' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/** Import local browser entries once (idempotent by notes+date+site fingerprint not required — client sends only unsynced). */
router.post('/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Няма записи за import.' });
    }
    const docs = rows.slice(0, 100).map((e) => ({
      user: req.userId,
      projectId: null,
      ...sanitizeBody(e),
    }));
    const created = await GnssFieldLog.insertMany(docs);
    res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
