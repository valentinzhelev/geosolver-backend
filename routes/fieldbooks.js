const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireFieldBookPilot = require('../middleware/requireFieldBookPilot');
const FieldBookProject = require('../models/FieldBookProject');
const FieldBook = require('../models/FieldBook');
const { computeLevelingCarnet } = require('../utils/levelingCarnet');
const { computeCoordinateCarnet } = require('../utils/coordinateCarnet');
const { getSharedProjectIds, getProjectAccess, getWorkspaceMembership, hasMinRole } = require('../utils/workspaceAccess');

router.use(auth, requireFieldBookPilot);

const VALID_TYPES = ['leveling', 'coordinate'];

function normalizeRows(rows = []) {
  return rows.map((row) => ({
    _id: row._id,
    // Leveling
    station: row.station ?? '',
    back: row.back ?? null,
    fore: row.fore ?? null,
    delta: row.delta ?? null,
    height: row.height ?? null,
    // Coordinate
    pointNo: row.pointNo ?? '',
    beta: row.beta ?? null,
    alpha: row.alpha ?? null,
    distance: row.distance ?? null,
    deltaY: row.deltaY ?? null,
    deltaX: row.deltaX ?? null,
    y: row.y ?? null,
    x: row.x ?? null,
    // Shared
    isControl: !!row.isControl,
    comment: row.comment || '',
  }));
}

function computeByType(type, rows, settings) {
  if (type === 'coordinate') return computeCoordinateCarnet(rows, settings);
  return computeLevelingCarnet(rows, settings);
}

// --- Projects ---

router.get('/projects', async (req, res) => {
  try {
    const sharedIds = await getSharedProjectIds(req.userId);
    const filter = sharedIds.length
      ? { $or: [{ user: req.userId }, { _id: { $in: sharedIds } }] }
      : { user: req.userId };
    const projects = await FieldBookProject.find(filter).sort({ updatedAt: -1 });
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { name, year, team, site, notes, workspaceId, crs } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Името на проекта е задължително.' });
    }
    if (workspaceId) {
      const wsAccess = await getWorkspaceMembership(req.userId, workspaceId);
      if (!wsAccess.ok || !hasMinRole(wsAccess.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за този workspace.' });
      }
    }
    const project = await FieldBookProject.create({
      user: req.userId,
      workspace: workspaceId || null,
      name: String(name).trim(),
      year: year || '',
      team: team || '',
      site: site || '',
      notes: notes || '',
      crs: crs || 'EPSG:7801',
    });
    res.status(201).json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const access = await getProjectAccess(req.userId, req.params.id);
    if (!access.ok || !hasMinRole(access.role, 'editor')) {
      return res.status(404).json({ success: false, message: 'Проектът не е намерен.' });
    }
    const project = access.project;
    const nextWorkspace =
      req.body.workspaceId !== undefined
        ? req.body.workspaceId || null
        : req.body.workspace !== undefined
          ? req.body.workspace || null
          : undefined;
    if (nextWorkspace) {
      const wsAccess = await getWorkspaceMembership(req.userId, nextWorkspace);
      if (!wsAccess.ok || !hasMinRole(wsAccess.role, 'editor')) {
        return res.status(403).json({ success: false, message: 'Нямате права за този workspace.' });
      }
    }
    const fields = ['name', 'year', 'team', 'site', 'notes', 'crs'];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) project[f] = req.body[f];
    });
    if (nextWorkspace !== undefined) project.workspace = nextWorkspace;
    await project.save();
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const access = await getProjectAccess(req.userId, req.params.id);
    if (!access.ok || access.role !== 'owner') {
      return res.status(404).json({ success: false, message: 'Проектът не е намерен.' });
    }
    const project = access.project;
    await FieldBook.deleteMany({ project: project._id });
    await project.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- Field books ---

router.get('/projects/:projectId/books', async (req, res) => {
  try {
    const access = await getProjectAccess(req.userId, req.params.projectId);
    if (!access.ok) {
      return res.status(404).json({ success: false, message: 'Проектът не е намерен.' });
    }
    const books = await FieldBook.find({ project: access.project._id }).sort({ updatedAt: -1 });
    res.json({ success: true, data: books });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/projects/:projectId/books', async (req, res) => {
  try {
    const access = await getProjectAccess(req.userId, req.params.projectId);
    if (!access.ok || !hasMinRole(access.role, 'editor')) {
      return res.status(404).json({ success: false, message: 'Проектът не е намерен.' });
    }
    const project = access.project;
    const { name, date, crew, site, notes, settings, type } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Името на карнета е задължително.' });
    }
    const bookType = VALID_TYPES.includes(type) ? type : 'leveling';
    const book = await FieldBook.create({
      user: req.userId,
      project: project._id,
      name: String(name).trim(),
      type: bookType,
      date: date || new Date().toISOString().slice(0, 10),
      crew: crew || '',
      site: site || project.site || '',
      notes: notes || '',
      settings: settings || {},
      rows: [],
    });
    res.status(201).json({ success: true, data: book });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

async function loadBookWithAccess(userId, bookId, minRole = 'viewer') {
  const book = await FieldBook.findById(bookId);
  if (!book) return { ok: false, book: null };
  const access = await getProjectAccess(userId, book.project);
  if (!access.ok || !hasMinRole(access.role, minRole)) {
    return { ok: false, book: null };
  }
  return { ok: true, book, access };
}

router.get('/books/:id', async (req, res) => {
  try {
    const { ok, book } = await loadBookWithAccess(req.userId, req.params.id, 'viewer');
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Карнетът не е намерен.' });
    }
    res.json({ success: true, data: book });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/books/:id', async (req, res) => {
  try {
    const { ok, book } = await loadBookWithAccess(req.userId, req.params.id, 'editor');
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Карнетът не е намерен.' });
    }
    const { name, date, crew, site, notes, settings, rows, locked, archived } = req.body;

    if (book.locked) {
      // A locked book may only be unlocked or have its archive flag toggled.
      const allowedWhenLocked = ['locked', 'archived'];
      const touchesOther = Object.keys(req.body).some((k) => !allowedWhenLocked.includes(k));
      if (touchesOther) {
        return res.status(400).json({ success: false, message: 'Карнетът е заключен.' });
      }
    }

    if (name !== undefined) book.name = name;
    if (date !== undefined) book.date = date;
    if (crew !== undefined) book.crew = crew;
    if (site !== undefined) book.site = site;
    if (notes !== undefined) book.notes = notes;
    if (settings !== undefined) {
      const prev = book.settings?.toObject?.() || book.settings || {};
      book.settings = { ...prev, ...settings };
    }
    if (rows !== undefined) book.rows = normalizeRows(rows);
    if (locked !== undefined) book.locked = locked;
    if (archived !== undefined) book.archived = archived;

    await book.save();
    res.json({ success: true, data: book });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/books/:id/calculate', async (req, res) => {
  try {
    const { ok, book } = await loadBookWithAccess(req.userId, req.params.id, 'editor');
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Карнетът не е намерен.' });
    }
    if (book.locked) {
      return res.status(400).json({ success: false, message: 'Карнетът е заключен.' });
    }

    const inputRows = normalizeRows(req.body.rows ?? book.rows);
    const settings = { ...book.settings.toObject?.() || book.settings, ...(req.body.settings || {}) };
    const { rows, warnings, summary } = computeByType(book.type, inputRows, settings);

    book.rows = rows;
    book.settings = settings;
    book.lastCalculated = new Date();
    book.calculationHistory.unshift({
      timestamp: new Date(),
      warnings,
      summary,
    });
    if (book.calculationHistory.length > 50) {
      book.calculationHistory = book.calculationHistory.slice(0, 50);
    }
    await book.save();

    res.json({
      success: true,
      data: book,
      warnings,
      summary,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/books/:id', async (req, res) => {
  try {
    const { ok, book } = await loadBookWithAccess(req.userId, req.params.id, 'editor');
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Карнетът не е намерен.' });
    }
    await book.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/books/:id/copy', async (req, res) => {
  try {
    const { ok, book } = await loadBookWithAccess(req.userId, req.params.id, 'editor');
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Карнетът не е намерен.' });
    }
    const copy = await FieldBook.create({
      user: req.userId,
      project: book.project,
      name: `${book.name} (копие)`,
      type: book.type,
      date: book.date,
      crew: book.crew,
      site: book.site,
      notes: book.notes,
      settings: book.settings,
      rows: book.rows.map((r) => ({ ...r.toObject?.() || r })),
      locked: false,
      archived: false,
    });
    res.status(201).json({ success: true, data: copy });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
