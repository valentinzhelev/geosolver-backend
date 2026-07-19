const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SurveyPoint = require('../models/SurveyPoint');
const { getSharedProjectIds, getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');

router.use(auth);

function parseCoord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getPointAccess(userId, pointId) {
  const point = await SurveyPoint.findById(pointId);
  if (!point) return { ok: false, point: null };
  if (String(point.user) === String(userId)) {
    return { ok: true, role: 'owner', point };
  }
  if (point.projectId) {
    const access = await getProjectAccess(userId, point.projectId);
    if (access.ok) return { ok: true, role: access.role, point };
  }
  return { ok: false, point };
}

router.get('/', async (req, res) => {
  try {
    let ownership;
    if (req.query.projectId) {
      const access = await getProjectAccess(req.userId, req.query.projectId);
      if (!access.ok) {
        return res.status(403).json({ success: false, message: 'Нямате достъп до този проект.' });
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
    res.json({ success: true, data: points });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, code, x, y, h, pointClass, layer, notes, projectId } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Името на точката е задължително.' });
    }
    if (projectId) {
      const access = await getProjectAccess(req.userId, projectId);
      if (!access.ok || !hasMinRole(access.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за този проект.' });
      }
    }
    const point = await SurveyPoint.create({
      user: req.userId,
      projectId: projectId || null,
      name: String(name).trim(),
      code: code ? String(code).trim() : '',
      x: parseCoord(x),
      y: parseCoord(y),
      h: parseCoord(h),
      pointClass: pointClass ? String(pointClass).trim() : '',
      layer: layer ? String(layer).trim() : 'default',
      notes: notes || '',
    });
    res.status(201).json({ success: true, data: point });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { points = [], projectId } = req.body;
    if (!Array.isArray(points) || !points.length) {
      return res.status(400).json({ success: false, message: 'Липсват точки за import.' });
    }
    if (projectId) {
      const access = await getProjectAccess(req.userId, projectId);
      if (!access.ok || !hasMinRole(access.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за този проект.' });
      }
    }
    const docs = points
      .filter((p) => p && String(p.name || '').trim())
      .slice(0, 200)
      .map((p) => ({
        user: req.userId,
        projectId: projectId || null,
        name: String(p.name).trim(),
        code: p.code ? String(p.code).trim() : '',
        x: parseCoord(p.x),
        y: parseCoord(p.y),
        h: parseCoord(p.h),
        pointClass: p.pointClass ? String(p.pointClass).trim() : '',
        layer: p.layer ? String(p.layer).trim() : 'default',
        notes: p.notes || '',
      }));
    const created = await SurveyPoint.insertMany(docs);
    res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const access = await getPointAccess(req.userId, req.params.id);
    if (!access.ok || !hasMinRole(access.role, 'editor')) {
      return res.status(404).json({ success: false, message: 'Точката не е намерена.' });
    }
    const point = access.point;
    const { name, code, x, y, h, pointClass, layer, notes, projectId } = req.body;
    if (projectId !== undefined && projectId) {
      const dest = await getProjectAccess(req.userId, projectId);
      if (!dest.ok || !hasMinRole(dest.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за целевия проект.' });
      }
    }
    if (name !== undefined) point.name = String(name).trim();
    if (code !== undefined) point.code = String(code).trim();
    if (x !== undefined) point.x = parseCoord(x);
    if (y !== undefined) point.y = parseCoord(y);
    if (h !== undefined) point.h = parseCoord(h);
    if (pointClass !== undefined) point.pointClass = String(pointClass).trim();
    if (layer !== undefined) point.layer = String(layer).trim();
    if (notes !== undefined) point.notes = notes;
    if (projectId !== undefined) point.projectId = projectId || null;
    await point.save();
    res.json({ success: true, data: point });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const access = await getPointAccess(req.userId, req.params.id);
    if (!access.ok || !hasMinRole(access.role, 'editor')) {
      return res.status(404).json({ success: false, message: 'Точката не е намерена.' });
    }
    await SurveyPoint.deleteOne({ _id: access.point._id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
