const mongoose = require('mongoose');

/**
 * A deterministic geodetic processing result over a CONFIRMED FieldObservationSet (V2.4.1) - the third layer in the
 * architecture: FieldObservationSet = observed evidence, ProcessingResult (this model) = deterministic DERIVED
 * result, SurveyPoint = an explicitly persisted project point. Never overwrites the evidence it was computed from.
 *
 * Immutable once created: a FieldProcessingRun retains the exact station/orientation snapshots and normalized
 * inputs used at processing time (in `setups`, see fieldProcessing/processRun.js), so it is reproducible from its
 * own persisted data and `engineVersions` alone, and stays historically correct even if the underlying SurveyPoint
 * coordinates are edited later - a NEW run would use the new coordinates, this one does not change. The only
 * fields ever updated after creation are `generatedPointIds`/`pointsCreatedAt` (bookkeeping for explicit
 * "Създай точки" saves), never `setups`.
 *
 * Deliberately NOT bound to "polar setup" in its shape (`setups` is Mixed, and the model itself carries no
 * polar-specific fields) so other processing modes can reuse this same model - V2.4.2 adds TRAVERSE processing
 * this way: `processingType` discriminates 'polar' (unchanged, uses `setups`, exactly as V2.4.1 persisted it) from
 * 'traverse' (uses the new `traverse` field, see fieldProcessing/processTraverse.js#buildTraverseRun's return
 * shape - sequence/start/orientation/end/legs/closure/adjustment). A document with no `processingType` at all
 * (every run created before V2.4.2) reads as 'polar' via the schema default, so historical runs are read back
 * exactly as before, never reinterpreted.
 */
const fieldProcessingRunSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // the run's creator
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    source: {
      fieldObservationSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldObservationSet', required: true, index: true },
      captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob', required: true },
    },
    processingVersion: { type: String, required: true },
    // { orientation, horizontal, heightZenith, heightVertical, heightCombination } - the exact engine versions used,
    // a snapshot from fieldProcessing/engines/registry.js#currentVersions() at run time (never recomputed later).
    engineVersions: { type: mongoose.Schema.Types.Mixed, required: true },
    // Explicit, user-declared for this run (V2.4.1 never infers it) - null means "not declared", so no observation
    // in this run could get a calculated H even if it looked plausible.
    verticalAngleConvention: { type: String, enum: ['zenith', 'vertical', null], default: null },
    // Always 'server': this model exists ONLY for backend-computed results (mirrors Calculation.resultAuthority,
    // which additionally allows 'client' for the scientific calculator - there is no client-authored equivalent
    // here, so the field is kept for symmetry/explicitness rather than as a real choice).
    resultAuthority: { type: String, enum: ['server'], default: 'server', required: true },
    status: { type: String, enum: ['completed'], default: 'completed' }, // room to add e.g. 'failed' later
    processingType: { type: String, enum: ['polar', 'traverse'], default: 'polar' },
    // POLAR only. [{ index, station, orientation, orientationConstantGon, bearingGon, observedHzToBacksightGon,
    //   setupError, observations: [{ index, target, status, x, y, h, direction, horizontalDistance, deltaX, deltaY,
    //   heightReason, errors, warnings, cells }] }] - exactly processRun.js#buildProcessingRun's output.
    setups: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // TRAVERSE only. { traverseType, startIdentifier, endIdentifier, sequence, start, orientation, end, legs,
    //   closure, adjustment, status } - exactly processTraverse.js#buildTraverseRun's output.
    traverse: { type: mongoose.Schema.Types.Mixed, default: undefined },
    generatedPointIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SurveyPoint' }],
    pointsCreatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

fieldProcessingRunSchema.index({ projectId: 1, createdAt: -1 });
fieldProcessingRunSchema.index({ 'source.fieldObservationSetId': 1, createdAt: -1 });

module.exports = mongoose.model('FieldProcessingRun', fieldProcessingRunSchema);
