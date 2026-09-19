const express = require('express');
const router = express.Router();
const Calculation = require('../models/Calculation');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { getLimitsForUser } = require('../utils/calculationLimits');
const { validateEduCalculationAccess } = require('../utils/eduCalculationAccess');
const { getProjectAccess, getPointAccess, hasMinRole } = require('../utils/workspaceAccess');
const engines = require('../engines');
const { resolveClaimedCoordinates } = require('../utils/toolPointRoles');
const { extractPointResult } = require('../utils/calculationPointOutputs');
const SurveyPoint = require('../models/SurveyPoint');

// Numeric tolerance for comparing submitted inputData coordinates against a
// SurveyPoint's stored coordinates. JS's Number<->String round-trip is exact
// (parseFloat(String(n)) === n for every finite n), so an untouched
// point-derived field matches exactly; this tolerance only absorbs
// legitimate floating-point noise, not meaningful edits.
const COORDINATE_TOLERANCE = 1e-6;

function getUserIdFromRequest(req) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id;
  } catch {
    return null;
  }
}

/**
 * Milestone 1 trust boundary: the frontend sends only
 * [{ pointId, role }, ...]. This resolves each into a full, immutable
 * snapshot built from database values — never from client-supplied
 * name/code/x/y/h.
 *
 * Knowing a pointId is real and accessible is NOT sufficient: a caller
 * could submit inputData for point B while attaching a pointReferences
 * entry claiming point A. So for every reference this also:
 *   1. validates the role is one this toolName actually supports
 *      (utils/toolPointRoles.js, verified against the real frontend payloads)
 *   2. rejects duplicate roles (a tool only has one "pointA" slot)
 *   3. loads and access-checks the real SurveyPoint
 *   4. for project calculations, verifies the point belongs to the SAME project
 *   5. extracts whatever x/y the submitted inputData actually claims for that
 *      role, and numerically compares it against the point's real coordinates
 *      — string-formatting equality is never used
 * Any failure throws { status, message } so the caller rejects the WHOLE
 * request rather than silently dropping or weakening a bad entry.
 */
async function resolvePointReferences(userId, projectId, toolName, inputData, pointReferences) {
  if (!Array.isArray(pointReferences) || pointReferences.length === 0) return [];

  const seenRoles = new Set();
  const resolved = [];
  for (const ref of pointReferences) {
    const pointId = ref && ref.pointId;
    const role = ref && typeof ref.role === 'string' ? ref.role.trim() : '';
    if (!pointId || !role) {
      throw { status: 400, message: 'Invalid point reference: pointId and role are required' };
    }
    if (seenRoles.has(role)) {
      throw { status: 400, message: `Duplicate point reference role: ${role}` };
    }
    seenRoles.add(role);

    const claim = resolveClaimedCoordinates(toolName, role, inputData);
    if (!claim.ok) {
      throw {
        status: 400,
        message: claim.reason === 'unknown_role'
          ? `Role "${role}" is not valid for tool "${toolName}"`
          : `inputData is missing numeric coordinates for role "${role}"`,
      };
    }

    const access = await getPointAccess(userId, pointId);
    if (!access.ok) {
      throw { status: 403, message: `No access to referenced point ${pointId}` };
    }

    const point = access.point;
    if (projectId && String(point.projectId || '') !== String(projectId)) {
      throw { status: 400, message: `Referenced point ${pointId} does not belong to this project` };
    }

    const dx = Math.abs(claim.x - point.x);
    const dy = Math.abs(claim.y - point.y);
    if (dx > COORDINATE_TOLERANCE || dy > COORDINATE_TOLERANCE) {
      throw {
        status: 400,
        message: `Submitted input for role "${role}" does not match SurveyPoint ${pointId}`,
      };
    }

    resolved.push({
      pointId: point._id,
      role: role.slice(0, 50),
      name: point.name,
      code: point.code,
      x: point.x,
      y: point.y,
      h: point.h,
    });
  }
  return resolved;
}

const SCIENTIFIC_TOOL = 'scientific-calculator';

// Cosmetic label only; taken from the client when it is a well-formed {bg, en} pair, otherwise
// from the engine so a missing label can never turn into a schema (500) failure.
function safeDisplayName(clientValue, engine) {
  const ok = (s) => typeof s === 'string' && s.trim() && s.length <= 100;
  if (clientValue && ok(clientValue.bg) && ok(clientValue.en)) {
    return { bg: clientValue.bg.trim(), en: clientValue.en.trim() };
  }
  return engine ? engine.displayName : { bg: 'Научен калкулатор', en: 'Scientific calculator' };
}

/**
 * POST /api/calculations — CANONICAL professional path (Milestone 2).
 *
 *   auth
 *   -> resolve the CURRENT engine for toolName
 *   -> stale-client gate (offset-point / resection need clientContractVersion >= 2)
 *   -> normalize + validate the input           (structured 400, never a 500)
 *   -> project authorization
 *   -> SurveyPoint provenance ON THE NORMALIZED INPUT
 *   -> edu access / free-plan limit             (unchanged behavior)
 *   -> compute resultData with the canonical engine, format it (shipped rounding contract)
 *   -> persist { normalized inputData, server resultData, engineVersion of the computing engine,
 *                resultAuthority: 'server' }
 *
 * A client-supplied resultData is only ever an ADVISORY preview: it is compared per field with the
 * server result for diagnostics (`clientCheck`) and NEVER persisted for a professional tool.
 * engineVersion, resultAuthority, crs and referencedPoints are always server-derived; body values
 * for them are ignored. The Scientific Calculator has no engine: it keeps client authority.
 */
router.post('/', async (req, res) => {
  try {
    const {
      toolName, toolDisplayName, inputData, resultData: clientResultData, calculationTime, eduContext,
      projectId, pointReferences, clientContractVersion,
    } = req.body || {};

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const engine = engines.getCurrentEngine(toolName);
    if (!engine && toolName !== SCIENTIFIC_TOOL) {
      return res.status(400).json({ error: 'Unsupported tool', code: 'UNSUPPORTED_TOOL', field: 'toolName' });
    }

    let normalizedInput = inputData;
    if (engine) {
      // Zero silent divergence: a stale client would display one result while the backend stores another.
      const contract = engines.checkClientContract(toolName, clientContractVersion);
      if (!contract.ok) {
        return res.status(409).json({
          error: contract.error,
          code: contract.code,
          requiredClientContractVersion: contract.required,
        });
      }
      try {
        normalizedInput = engine.normalizeAndValidate(inputData);
      } catch (engineErr) {
        if (engines.isEngineError(engineErr)) return res.status(engineErr.status).json(engineErr.toResponseBody());
        throw engineErr;
      }
    }

    // Project scoping is validated before anything is stored and rejects the whole request on
    // failure — a bad/inaccessible projectId must never silently fall back to a standalone save.
    let crs = null;
    if (projectId) {
      // Scientific Calculator is a general utility, not a Project calculation.
      if (!engine) {
        return res.status(400).json({ error: 'This tool cannot be saved to a project' });
      }
      const access = await getProjectAccess(userId, projectId);
      if (!access.ok || !hasMinRole(access.role, 'editor')) {
        return res.status(403).json({ error: 'Editor access to this project is required' });
      }
      crs = access.project.crs || null;
    }

    // Provenance runs on the SAME normalized values the engine consumes and that get persisted.
    let referencedPoints;
    try {
      referencedPoints = await resolvePointReferences(userId, projectId, toolName, normalizedInput, pointReferences);
    } catch (refErr) {
      return res.status(refErr.status || 400).json({ error: refErr.message || 'Invalid point reference' });
    }

    let context = 'consumer';
    let assignmentId = null;

    if (eduContext?.assignmentId) {
      try {
        await validateEduCalculationAccess(userId, eduContext.assignmentId);
        context = 'edu';
        assignmentId = eduContext.assignmentId;
      } catch (eduErr) {
        return res.status(eduErr.status || 403).json({ error: eduErr.message });
      }
    } else {
      const limits = await getLimitsForUser(userId);
      if (!limits.canCalculate) {
        return res.status(403).json({
          error: 'Calculation limit reached',
          used: limits.used,
          limit: limits.limit,
        });
      }
    }

    let persistedResult = clientResultData; // Scientific Calculator only
    let engineVersion = null;
    let resultAuthority = 'client';
    let clientCheck;
    if (engine) {
      try {
        const full = engine.compute(normalizedInput);
        persistedResult = engine.format(full);
      } catch (engineErr) {
        if (engines.isEngineError(engineErr)) return res.status(engineErr.status).json(engineErr.toResponseBody());
        throw engineErr;
      }
      engineVersion = engine.version;
      resultAuthority = 'server';
      const comparison = engines.compareResultData(engine, persistedResult, clientResultData);
      clientCheck = { status: comparison.status, fields: comparison.fields.map((f) => ({ field: f.field, difference: f.difference })), engineVersion };
      if (comparison.status === 'mismatch') {
        engines.logClientMismatch({
          toolName,
          engineVersion,
          clientContractVersion: engines.parseClientContractVersion(clientContractVersion),
          fields: comparison.fields,
        });
      }
    }

    const declaredContract = engines.parseClientContractVersion(clientContractVersion);
    const calculation = new Calculation({
      userId: userId,
      toolName,
      toolDisplayName: safeDisplayName(toolDisplayName, engine),
      inputData: normalizedInput,
      resultData: persistedResult,
      calculationTime: Number.isFinite(calculationTime) && calculationTime >= 0 ? calculationTime : undefined,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      context,
      assignmentId,
      projectId: projectId || null,
      engineVersion,
      resultAuthority,
      ...(declaredContract !== null ? { clientContractVersion: declaredContract } : {}),
      referencedPoints,
      crs,
    });

    await calculation.save();

    const body = typeof calculation.toJSON === 'function' ? calculation.toJSON() : { ...calculation };
    res.status(201).json(clientCheck ? { ...body, clientCheck } : body);
  } catch (error) {
    if (error && error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Invalid calculation data', code: 'INVALID_CALCULATION' });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations - Calculation history
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, toolName, month, year } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = { userId: req.user.id };
    if (toolName) filter.toolName = toolName;
    
    // Filter by month only when requested
    if (month != null || year != null) {
      const now = new Date();
      const targetMonth = month != null ? parseInt(month) : now.getMonth();
      const targetYear = year != null ? parseInt(year) : now.getFullYear();
      
      const startOfMonth = new Date(targetYear, targetMonth, 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(targetYear, targetMonth + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      filter.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }
    
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
        total: Math.ceil(total / limit), // Total pages
        totalItems: total, // Total number of calculations
        hasNext: skip + calculations.length < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/stats - Calculation statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Total calculations count
    const totalCalculations = await Calculation.countDocuments({ userId: req.user.id });
    
    // Calculations for this month
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyCalculations = await Calculation.countDocuments({
      userId: req.user.id,
      createdAt: { $gte: startOfMonth }
    });
    
    // Calculations by tool
    const calculationsByTool = await Calculation.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$toolName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    res.json({
      totalCalculations,
      monthlyCalculations,
      calculationsByTool,
      userLimits: {
        used: user.calculationsUsed,
        limit: user.calculationsLimit,
        unlimited: user.subscriptionStatus === 'active'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/limits - Check shared limits (all tools combined)
router.get('/limits', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const limits = await getLimitsForUser(userId);
    res.json({
      ...limits,
      planName: 'free',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/:id - Single calculation with full payload
// Standalone calculations: creator only, exactly as before. Project-scoped
// calculations: creator, OR any user with read access to that project.
router.get('/:id', auth, async (req, res) => {
  try {
    const calculation = await Calculation.findById(req.params.id);
    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }

    const isCreator = String(calculation.userId) === String(req.user.id);
    if (isCreator) {
      return res.json(calculation);
    }

    if (calculation.projectId) {
      const access = await getProjectAccess(req.user.id, calculation.projectId);
      if (access.ok) {
        return res.json(calculation);
      }
    }

    return res.status(404).json({ error: 'Calculation not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/calculations/:id/create-point  (Milestone 1.1 — explicit "Save as point")
 *
 * Creates ONE SurveyPoint from a Project calculation. Canonical rows
 * (resultAuthority 'server') use their stored server-authoritative result;
 * legacy rows are verified per (toolName, engineVersion) first and may be
 * blocked. The client supplies only user-entered identity fields (name,
 * code); the coordinates, project and provenance are all derived here and
 * the Calculation document is never modified.
 *
 * Product rules: never automatic; project calculations only; caller needs
 * editor role on that project (not necessarily the calculation's creator);
 * only tools in utils/calculationPointOutputs.js; at most one live generated
 * point per calculation (partial unique index on SurveyPoint); refused when
 * the calculation's CRS snapshot no longer matches the project's CRS.
 */
router.post('/:id/create-point', auth, async (req, res) => {
  try {
    // Only these two body fields are ever read. x/y/projectId/
    // sourceCalculationId/engineVersion etc. in the body are ignored.
    const { name, code } = req.body || {};

    const calculation = await Calculation.findById(req.params.id);
    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }

    if (!calculation.projectId) {
      // Standalone calculations are out of scope. Don't reveal other users'
      // standalone calculations to callers who couldn't read them anyway.
      if (String(calculation.userId) !== String(req.user.id)) {
        return res.status(404).json({ error: 'Calculation not found' });
      }
      return res.status(400).json({
        error: 'Only project calculations can be saved as a point',
        code: 'NOT_A_PROJECT_CALCULATION',
      });
    }

    const access = await getProjectAccess(req.user.id, calculation.projectId);
    if (!access.ok) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    if (!hasMinRole(access.role, 'editor')) {
      return res.status(403).json({ error: 'Editor access to this project is required' });
    }

    const output = extractPointResult(calculation.toolName, calculation.resultData);
    if (!output.ok) {
      return res.status(400).json({
        error: output.reason === 'unsupported_tool'
          ? 'This calculation does not produce a single point'
          : 'The stored result has no valid coordinates',
        code: output.reason === 'unsupported_tool' ? 'UNSUPPORTED_TOOL' : 'RESULT_MISSING',
      });
    }

    const pointName = typeof name === 'string' ? name.trim() : '';
    if (!pointName) {
      return res.status(400).json({ error: 'Point name is required', code: 'NAME_REQUIRED' });
    }
    const pointCode = typeof code === 'string' ? code.trim() : '';

    // The result was computed in the grid the project declared at that time.
    // If the project's CRS was edited since, saving old-grid coordinates into
    // it would be silently wrong — refuse and let the user decide.
    const calcCrs = calculation.crs || null;
    const projectCrs = access.project.crs || null;
    if (calcCrs !== projectCrs) {
      return res.status(409).json({
        error: 'The project CRS changed after this calculation was made',
        code: 'CRS_MISMATCH',
        calculationCrs: calcCrs,
        projectCrs,
      });
    }

    const existing = await SurveyPoint.findOne({ sourceCalculationId: calculation._id });
    if (existing) {
      return res.status(409).json({
        error: 'A point was already created from this calculation',
        code: 'ALREADY_CREATED',
        data: existing,
      });
    }

    // Canonical rows (resultAuthority 'server') use their stored server-authoritative result
    // directly. Anything else is a LEGACY row whose stored result was client-computed: it is
    // verified per (toolName, engineVersion) — see engines/legacyVerification.js — and blocked
    // when it cannot be verified. The Calculation is never rewritten and there is no override.
    let pointXY = { x: output.x, y: output.y };
    if (calculation.resultAuthority !== 'server') {
      const legacy = engines.verifyLegacyCalculation(calculation);
      if (!legacy.allowed) {
        return res.status(legacy.status).json({ error: legacy.error, code: legacy.code });
      }
      pointXY = { x: legacy.x, y: legacy.y };
    }

    try {
      const point = await SurveyPoint.create({
        user: req.user.id,
        projectId: calculation.projectId,
        name: pointName,
        code: pointCode,
        x: pointXY.x,
        y: pointXY.y,
        h: null,
        sourceCalculationId: calculation._id,
      });
      return res.status(201).json({ success: true, data: point });
    } catch (createErr) {
      // Lost a race against a concurrent request: the unique index held.
      if (createErr && createErr.code === 11000) {
        const winner = await SurveyPoint.findOne({ sourceCalculationId: calculation._id });
        return res.status(409).json({
          error: 'A point was already created from this calculation',
          code: 'ALREADY_CREATED',
          data: winner,
        });
      }
      throw createErr;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
