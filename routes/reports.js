/**
 * Report / Document Engine API (V2.5).
 *
 *   POST /api/reports                 generate a new report -> a Report (immutable once created)
 *   GET  /api/reports?projectId=...   list reports for a project, newest first (metadata only, no PDF bytes)
 *   GET  /api/reports/:id             one report's metadata
 *   GET  /api/reports/:id/file        the exact persisted PDF bytes
 *
 * Every route: authentication + Project editor permission (same convention as routes/fieldProcessing.js). The
 * client never supplies authoritative coordinates/results - POST only ever identifies WHICH already-persisted
 * source to render (a FieldProcessingRun id, or nothing for a coordinate-list snapshot); the server resolves and
 * re-verifies everything else, including that a given sourceId actually belongs to the requested project.
 */
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');
const FieldBookProject = require('../models/FieldBookProject');
const FieldProcessingRun = require('../models/FieldProcessingRun');
const FieldObservationSet = require('../models/FieldObservationSet');
const SurveyPoint = require('../models/SurveyPoint');
const Report = require('../models/Report');
const User = require('../models/User');
const { getStorage } = require('../reports/storage');
const { buildAndRenderReport, REPORT_TYPES } = require('../reports/buildReport');

const router = express.Router();
router.use(auth);

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('reports: unexpected error', { name: e && e.name }); // never the message/model/PDF content
  fail(res, 500, 'INTERNAL', 'Грешка.');
});

const REPORT_TYPE_SOURCE = {
  POLAR_PROCESSING_REPORT: { processingType: 'polar' },
  TRAVERSE_PROCESSING_REPORT: { processingType: 'traverse' },
  PROJECT_COORDINATE_LIST: null, // no FieldProcessingRun source
};

/** Strips characters unsafe for a filename while leaving legitimate Bulgarian/geodetic text intact. */
function sanitizeFilenamePart(s, maxLen = 60) {
  return String(s || '')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '') // control chars + filesystem-unsafe chars only
    .trim()
    .slice(0, maxLen);
}

function reportFilename(report) {
  const date = new Date(report.generatedAt).toISOString().slice(0, 10);
  const base = sanitizeFilenamePart(`GeoSolver_${report.model.project.name}_${report.title}_${date}`) || 'GeoSolver_report';
  const asciiFallback = base.replace(/[^\x20-\x7E]/g, '_').replace(/\s+/g, '_');
  return { utf8: `${base}.pdf`, ascii: `${asciiFallback || 'report'}.pdf` };
}

/** Loads a report and verifies the caller has at least editor access to its project. Never reveals existence otherwise. */
async function loadAccessibleReport(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return { error: ['NOT_FOUND', 404, 'Отчетът не е намерен.'] };
  const report = await Report.findById(req.params.id);
  if (!report) return { error: ['NOT_FOUND', 404, 'Отчетът не е намерен.'] };
  const access = await getProjectAccess(req.userId, report.projectId);
  if (!access.ok) return { error: ['NOT_FOUND', 404, 'Отчетът не е намерен.'] };
  if (!hasMinRole(access.role, 'editor')) return { error: ['FORBIDDEN', 403, 'Нямате права за този проект.'] };
  return { report };
}

function publicReport(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id),
    projectId: String(o.projectId),
    reportType: o.reportType,
    title: o.title,
    documentNumber: o.documentNumber || null,
    sourceType: o.sourceType,
    sourceId: o.sourceId ? String(o.sourceId) : null,
    templateVersion: o.templateVersion,
    generatedAt: o.generatedAt,
    // the AT-THE-TIME name baked into the model snapshot, not a live lookup - matches what the PDF itself says.
    generatedBy: { id: String(o.generatedBy), name: (o.model && o.model.generatedBy && o.model.generatedBy.name) || null },
    fileSize: o.file.size,
    fileMime: o.file.mime,
    createdAt: o.createdAt,
  };
}

router.post('/', express.json({ limit: '16kb' }), wrap(async (req, res) => {
  const body = req.body || {};
  const { reportType, projectId } = body;
  const sourceId = body.sourceId || null;

  if (!REPORT_TYPES.includes(reportType)) {
    return fail(res, 400, 'INVALID_REQUEST', 'Невалиден тип отчет.');
  }
  if (!projectId || !mongoose.isValidObjectId(projectId)) {
    return fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на проект.');
  }
  const sourceRule = REPORT_TYPE_SOURCE[reportType];
  if (sourceRule && (!sourceId || !mongoose.isValidObjectId(sourceId))) {
    return fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на обработка.');
  }

  const project = await FieldBookProject.findById(projectId);
  if (!project) return fail(res, 404, 'NOT_FOUND', 'Проектът не е намерен.');
  const access = await getProjectAccess(req.userId, projectId);
  if (!access.ok) return fail(res, 404, 'NOT_FOUND', 'Проектът не е намерен.');
  if (!hasMinRole(access.role, 'editor')) return fail(res, 403, 'FORBIDDEN', 'Нямате права за този проект.');

  // req.user from the JWT only carries {id, role} (middleware/auth.js) - fetch the display name for the document.
  const userDoc = await User.findById(req.userId).select('name email');
  const generatedBy = { id: req.userId, name: (userDoc && (userDoc.name || userDoc.email)) || '' };

  let run = null;
  let fos = null;
  let points = null;

  if (sourceRule) {
    run = await FieldProcessingRun.findById(sourceId);
    if (!run) return fail(res, 404, 'NOT_FOUND', 'Обработката не е намерена.');
    // the source must belong to the SAME project the caller has access to - never trust the client's pairing.
    if (String(run.projectId) !== String(projectId)) {
      return fail(res, 400, 'SOURCE_PROJECT_MISMATCH', 'Обработката не принадлежи на този проект.');
    }
    const actualType = run.processingType || 'polar';
    if (actualType !== sourceRule.processingType) {
      return fail(res, 400, 'SOURCE_TYPE_MISMATCH', 'Типът на обработката не съответства на вида отчет.');
    }
    if (reportType === 'POLAR_PROCESSING_REPORT') {
      fos = await FieldObservationSet.findById(run.source.fieldObservationSetId);
      if (!fos) return fail(res, 404, 'NOT_FOUND', 'Източният набор от наблюдения не е намерен.');
    }
  } else {
    points = await SurveyPoint.find({ projectId }).lean();
  }

  const generatedAt = new Date();
  const { model, pdfBuffer, title, sourceType, sourceId: resolvedSourceId, sourceVersion, templateVersion } =
    await buildAndRenderReport({ reportType, project, run, fos, points, generatedBy, generatedAt, documentNumber: body.documentNumber || null });

  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const storage = getStorage();

  // pre-generate the Report's id so the ReportAsset can reference it, then create both in the usual order -
  // matches routes/fieldProcessing.js's Model.create({...}) convention (no `new Model()` + `.save()`).
  const reportId = new mongoose.Types.ObjectId();
  const storageKey = await storage.put({ reportId, userId: req.userId, buffer: pdfBuffer, mime: 'application/pdf' });

  const reportDoc = await Report.create({
    _id: reportId,
    user: req.userId,
    projectId,
    reportType,
    sourceType,
    sourceId: resolvedSourceId,
    sourceVersion,
    templateVersion,
    title,
    documentNumber: body.documentNumber || null,
    generatedAt,
    generatedBy: req.userId,
    model,
    file: { storageKey, mime: 'application/pdf', size: pdfBuffer.length, hash },
  });

  res.status(201).json({ success: true, data: publicReport(reportDoc) });
}));

router.get('/', wrap(async (req, res) => {
  const projectId = req.query && req.query.projectId;
  if (!projectId || !mongoose.isValidObjectId(projectId)) {
    return fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на проект.');
  }
  const access = await getProjectAccess(req.userId, projectId);
  if (!access.ok || !hasMinRole(access.role, 'editor')) return fail(res, 404, 'NOT_FOUND', 'Проектът не е намерен.');

  // list view never needs the full model snapshot - keep the payload light.
  const reports = await Report.find({ projectId }).select('-model').sort({ createdAt: -1 });
  res.json({ success: true, data: reports.map(publicReport) });
}));

router.get('/:id', wrap(async (req, res) => {
  const { report, error } = await loadAccessibleReport(req);
  if (error) return fail(res, error[1], error[0], error[2]);
  res.json({ success: true, data: publicReport(report) });
}));

router.get('/:id/file', wrap(async (req, res) => {
  const { report, error } = await loadAccessibleReport(req);
  if (error) return fail(res, error[1], error[0], error[2]);

  const storage = getStorage();
  const asset = await storage.get(report.file.storageKey);
  if (!asset) return fail(res, 404, 'NOT_FOUND', 'Файлът на отчета не е намерен.');

  const { utf8, ascii } = reportFilename(report);
  res.setHeader('Content-Type', asset.mime || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`);
  res.setHeader('Content-Length', String(asset.buffer.length));
  res.end(asset.buffer);
}));

module.exports = router;
