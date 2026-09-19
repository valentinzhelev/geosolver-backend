const mongoose = require('mongoose');

const calculationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false 
  },
  toolName: { 
    type: String, 
    required: true,
    enum: [
      'first-basic-task',
      'second-basic-task', 
      'forward-intersection',
      'resection',
      'polar-intersection',
      'coordinate-transformation',
      'hansen-task',
      'area-calculation',
      'distance-bearing',
      'line-intersection',
      'offset-point',
      'segment-division',
      'scientific-calculator'
    ]
  },
  toolDisplayName: {
    bg: { type: String, required: true },
    en: { type: String, required: true }
  },
  inputData: { type: mongoose.Schema.Types.Mixed, required: true },
  resultData: { type: mongoose.Schema.Types.Mixed, required: true },
  calculationTime: { type: Number }, // in milliseconds
  ipAddress: { type: String },
  userAgent: { type: String },
  context: {
    type: String,
    enum: ['consumer', 'edu'],
    default: 'consumer',
  },
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    default: null,
  },
  // Milestone 1 — Project Calculations V1
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FieldBookProject',
    default: null,
  },
  // Provenance/version label for the geodetic engine that produced this
  // result. Intentionally has NO schema default: historical documents that
  // predate this field must remain unversioned (absent), not silently
  // backfilled to 1. Every NEW save is stamped explicitly by the backend
  // from utils/engineVersions.js. This is a label, not proof the backend
  // recomputed/verified the result — see utils/engineVersions.js.
  engineVersion: {
    type: Number,
  },
  // Who produced resultData. NO DEFAULT, and never settable from a request body (the route sets
  // it explicitly), so the three states stay distinguishable:
  //   'server' -> computed by the canonical backend engine (engines/), i.e. `engineVersion` names
  //               the engine that actually computed this row;
  //   'client' -> a NEW row that intentionally stays client-authored (Scientific Calculator only,
  //               which has no engine and no engineVersion);
  //   absent   -> a HISTORICAL row from before the canonical engine: resultData was client-computed
  //               and `engineVersion` (if any) was only a label. Never backfilled.
  resultAuthority: {
    type: String,
    enum: ['server', 'client'],
  },
  // Diagnostic only: the frontend calculation contract the client declared (see
  // engines/clientContract.js). It never defines mathematical authority.
  clientContractVersion: {
    type: Number,
  },
  // Immutable snapshots of any SurveyPoints that fed this calculation's
  // input, built server-side from database values only — see
  // routes/calculations.js's point-reference resolution. Never trust
  // client-supplied name/code/x/y/h here.
  referencedPoints: {
    type: [
      {
        pointId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyPoint', required: true },
        role: { type: String, required: true, trim: true },
        name: String,
        code: String,
        x: Number,
        y: Number,
        h: Number,
        _id: false,
      },
    ],
    default: [],
  },
  // Snapshot of the project's CRS at save time (never live-updated if the
  // project's CRS later changes). Null for standalone calculations, since
  // none of the base calculators have any CRS concept today.
  crs: {
    type: String,
    default: null,
  },
}, { timestamps: true });

calculationSchema.index({ userId: 1, context: 1 });

// Index for efficient queries
calculationSchema.index({ userId: 1, createdAt: -1 });
calculationSchema.index({ toolName: 1, createdAt: -1 });
calculationSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('Calculation', calculationSchema);
