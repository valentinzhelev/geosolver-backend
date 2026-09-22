/**
 * Field Processing API (V2.4.1) - deterministic geodetic processing over a CONFIRMED FieldObservationSet.
 *
 *   POST /api/field-processing                  run processing for one FieldObservationSet -> a FieldProcessingRun
 *   GET  /api/field-processing/:id               the run (read-only, immutable)
 *   GET  /api/field-processing?fieldObservationSetId=...  runs for one FieldObservationSet, newest first
 *   POST /api/field-processing/:id/create-points  explicit, idempotent "Създай точки" for READY/XY_ONLY targets
 *
 * Every route: authentication + Project editor permission (re-checked on every call, like Capture). A
 * FieldProcessingRun is treated as a shared PROJECT resource once it exists (like a Calculation), not restricted
 * to its own creator - the underlying FieldObservationSet a project editor is processing already belongs to a
 * project they can edit.
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { getProjectAccess, hasMinRole } = require('../utils/workspaceAccess');
const FieldObservationSet = require('../models/FieldObservationSet');
const FieldProcessingRun = require('../models/FieldProcessingRun');
const SurveyPoint = require('../models/SurveyPoint');
const { getConfig } = require('../fieldProcessing/config');
const { buildProcessingRun } = require('../fieldProcessing/processRun');
const { currentVersions } = require('../fieldProcessing/engines');

const router = express.Router();
router.use(auth);

const fail = (res, status, code, message, extra = {}) => res.status(status).json({ success: false, code, message, ...extra });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('field-processing: unexpected error', { name: e && e.name }); // never the message/content
  fail(res, 500, 'INTERNAL', 'Грешка.');
});

const VALID_CONVENTIONS = ['zenith', 'vertical'];
const norm = (s) => String(s || '').trim().toLowerCase();

/** Loads a run and verifies the caller has at least editor access to its project. Never reveals existence otherwise. */
async function loadAccessibleRun(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return { error: ['NOT_FOUND', 404, 'Обработката не е намерена.'] };
  const run = await FieldProcessingRun.findById(req.params.id);
  if (!run) return { error: ['NOT_FOUND', 404, 'Обработката не е намерена.'] };
  const access = await getProjectAccess(req.userId, run.projectId);
  if (!access.ok) return { error: ['NOT_FOUND', 404, 'Обработката не е намерена.'] };
  if (!hasMinRole(access.role, 'editor')) return { error: ['FORBIDDEN', 403, 'Нямате права за този проект.'] };
  return { run, access };
}

function publicRun(run) {
  const o = typeof run.toObject === 'function' ? run.toObject() : run;
  return {
    id: String(o._id),
    project: String(o.projectId),
    source: { fieldObservationSetId: String(o.source.fieldObservationSetId), captureJobId: String(o.source.captureJobId) },
    processingVersion: o.processingVersion,
    engineVersions: o.engineVersions,
    verticalAngleConvention: o.verticalAngleConvention || null,
    resultAuthority: o.resultAuthority,
    status: o.status,
    setups: o.setups,
    generatedPointIds: (o.generatedPointIds || []).map(String),
    pointsCreatedAt: o.pointsCreatedAt || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

router.post('/', express.json({ limit: '64kb' }), wrap(async (req, res) => {
  const body = req.body || {};
  const fieldObservationSetId = body.fieldObservationSetId;
  if (!fieldObservationSetId || !mongoose.isValidObjectId(fieldObservationSetId)) {
    return fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на набор от наблюдения.');
  }
  let verticalAngleConvention = null;
  if (body.verticalAngleConvention !== undefined && body.verticalAngleConvention !== null) {
    if (!VALID_CONVENTIONS.includes(body.verticalAngleConvention)) {
      return fail(res, 400, 'INVALID_REQUEST', 'Невалидна конвенция за вертикалния ъгъл (zenith или vertical).');
    }
    verticalAngleConvention = body.verticalAngleConvention;
  }

  const fos = await FieldObservationSet.findById(fieldObservationSetId);
  if (!fos) return fail(res, 404, 'NOT_FOUND', 'Наборът от наблюдения не е намерен.');
  const access = await getProjectAccess(req.userId, fos.projectId);
  if (!access.ok) return fail(res, 404, 'NOT_FOUND', 'Наборът от наблюдения не е намерен.');
  if (!hasMinRole(access.role, 'editor')) return fail(res, 403, 'FORBIDDEN', 'Нямате права за този проект.');

  const setups = await buildProcessingRun(fos.setups, { projectId: fos.projectId, SurveyPointModel: SurveyPoint, verticalAngleConvention });

  const run = await FieldProcessingRun.create({
    user: req.userId,
    projectId: fos.projectId,
    source: { fieldObservationSetId: fos._id, captureJobId: fos.source.captureJobId },
    processingVersion: getConfig().processingVersion,
    engineVersions: currentVersions(),
    verticalAngleConvention,
    resultAuthority: 'server',
    status: 'completed',
    setups,
  });
  res.status(201).json({ success: true, data: publicRun(run) });
}));

router.get('/', wrap(async (req, res) => {
  const fieldObservationSetId = req.query && req.query.fieldObservationSetId;
  if (!fieldObservationSetId || !mongoose.isValidObjectId(fieldObservationSetId)) {
    return fail(res, 400, 'INVALID_REQUEST', 'Липсва валиден идентификатор на набор от наблюдения.');
  }
  const fos = await FieldObservationSet.findById(fieldObservationSetId);
  if (!fos) return fail(res, 404, 'NOT_FOUND', 'Наборът от наблюдения не е намерен.');
  const access = await getProjectAccess(req.userId, fos.projectId);
  if (!access.ok || !hasMinRole(access.role, 'editor')) return fail(res, 404, 'NOT_FOUND', 'Наборът от наблюдения не е намерен.');

  const runs = await FieldProcessingRun.find({ 'source.fieldObservationSetId': fos._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: runs.map(publicRun) });
}));

router.get('/:id', wrap(async (req, res) => {
  const { run, error } = await loadAccessibleRun(req);
  if (error) return fail(res, error[1], error[0], error[2]);
  res.json({ success: true, data: publicRun(run) });
}));

router.post('/:id/create-points', wrap(async (req, res) => {
  const { run, error } = await loadAccessibleRun(req);
  if (error) return fail(res, error[1], error[0], error[2]);
  if (run.resultAuthority !== 'server') return fail(res, 400, 'NOT_AUTHORITATIVE', 'Резултатът не е сървърно изчислен.');

  // 1. gather candidates: READY/XY_ONLY observations across every setup (WARNING/ERROR are never auto-saved)
  const candidates = [];
  for (const setup of run.setups) {
    for (const obs of setup.observations) {
      if (obs.status === 'READY' || obs.status === 'XY_ONLY') candidates.push({ setupIndex: setup.index, obs });
    }
  }

  // 2. idempotency: points this SAME run already created
  const already = await SurveyPoint.find({ 'source.processingRunId': run._id }).select('source.setup source.observation').lean();
  const alreadyKeys = new Set(already.map((p) => `${p.source.setup}:${p.source.observation}`));

  // 3. name conflicts: OTHER project points (never this run's own, so a resumed/repeated save is not self-conflicting)
  const projectPoints = await SurveyPoint.find({ projectId: run.projectId }).select('name source.processingRunId').lean();
  const byName = new Map();
  for (const p of projectPoints) {
    if (p.source && String(p.source.processingRunId) === String(run._id)) continue;
    byName.set(norm(p.name), p);
  }

  const created = [];
  const skipped = [];
  for (const { setupIndex, obs } of candidates) {
    const key = `${setupIndex}:${obs.index}`;
    if (alreadyKeys.has(key)) {
      skipped.push({ setup: setupIndex, observation: obs.index, target: obs.target, reason: 'ALREADY_CREATED' });
      continue;
    }
    const conflict = byName.get(norm(obs.target));
    if (conflict) {
      skipped.push({ setup: setupIndex, observation: obs.index, target: obs.target, reason: 'NAME_CONFLICT', existingPointId: String(conflict._id) });
      continue;
    }
    try {
      const point = await SurveyPoint.create({
        user: req.userId,
        projectId: run.projectId,
        name: obs.target,
        code: '',
        x: obs.x,
        y: obs.y,
        h: typeof obs.h === 'number' ? obs.h : null,
        source: { kind: 'field-processing', processingRunId: run._id, fieldObservationSetId: run.source.fieldObservationSetId, setup: setupIndex, observation: obs.index, cells: obs.cells },
      });
      created.push(point);
      byName.set(norm(obs.target), point);
    } catch (e) {
      if (e && e.code === 11000) {
        // lost a race against a concurrent save: idempotent, not an error
        skipped.push({ setup: setupIndex, observation: obs.index, target: obs.target, reason: 'ALREADY_CREATED' });
        continue;
      }
      throw e;
    }
  }

  if (created.length) {
    run.generatedPointIds = [...new Set([...(run.generatedPointIds || []).map(String), ...created.map((p) => String(p._id))])];
    run.pointsCreatedAt = run.pointsCreatedAt || new Date();
    await run.save();
  }

  res.json({
    success: true,
    created: created.map((p) => ({ id: String(p._id), name: p.name, x: p.x, y: p.y, h: p.h })),
    skipped,
    data: publicRun(run),
  });
}));

module.exports = router;
