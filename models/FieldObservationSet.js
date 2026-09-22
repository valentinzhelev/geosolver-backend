const mongoose = require('mongoose');

/**
 * The CONFIRMED, materialized output of a Field Notebook Capture (V2.3) - the notebook equivalent of what
 * SurveyPoint is for coordinate-table Capture. Created ONLY by capture/notebook/importService.js, on explicit
 * confirmation, never before.
 *
 * Deliberately NOT a SurveyPoint and NOT tied to any calculation type: these are raw OBSERVATIONS (station,
 * orientation, angles, distances), not computed coordinates. A future milestone (traverse processing, polar
 * observations, orientation computation - see capture/notebook/README's "future calculation boundary") consumes
 * this as input evidence through a deterministic engine; nothing here calculates anything.
 *
 * One set per CaptureJob (unique index below): confirming twice must never create a second one.
 */
const fieldObservationSetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    source: {
      kind: { type: String, enum: ['capture'], default: 'capture' },
      captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob', required: true },
    },
    // the exact pipeline/recognition/arbitration/validation/notebook versions that produced this confirmed data
    pipelineVersion: { type: String },
    recognitionVersion: { type: String },
    arbitrationVersion: { type: String },
    validationVersion: { type: String },
    notebookVersion: { type: String },
    // setups: [{ index, station:{point,instrumentHeight,notes}, orientation:{target,direction}|null,
    //            observations: [{row,target,hz,vz,distance,horizontalDistance,prismHeight,code,notes,cells}] }]
    // (see capture/notebook/validation.js#evaluateNotebook - `setups` is exactly its import-ready output)
    setups: { type: mongoose.Schema.Types.Mixed, required: true },
    confirmedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// idempotency guard: confirming the same CaptureJob twice can never create a second FieldObservationSet
fieldObservationSetSchema.index({ 'source.captureJobId': 1 }, { unique: true });
fieldObservationSetSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('FieldObservationSet', fieldObservationSetSchema);
