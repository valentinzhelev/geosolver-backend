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
    // 'capture' (V2.3, an OCR-confirmed Field Notebook - every set that exists in production) or 'session' (Field
    // Sessions: manual entry confirmed by fieldSessions). Exactly one of the two ids is set, matching `kind`.
    source: {
      kind: { type: String, enum: ['capture', 'session'], default: 'capture' },
      captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob', required() { return !this.source || this.source.kind !== 'session'; } },
      fieldSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldSession' },
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

// idempotency guards: confirming the same CaptureJob / the same Field Session twice can never create a second set.
// PARTIAL unique indexes, because each kind leaves the other kind's id absent (a plain unique index would treat all
// absent values as one duplicate `null`). The pre-Field-Sessions index was a plain unique index named
// `source.captureJobId_1` - production needs scripts/migrate-field-observation-set-indexes.js run once (see it);
// Mongo will not create this one beside the old one, and Mongoose reports that without crashing the app.
fieldObservationSetSchema.index(
  { 'source.captureJobId': 1 },
  { unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } }, name: 'source_captureJobId_unique_partial' }
);
fieldObservationSetSchema.index(
  { 'source.fieldSessionId': 1 },
  { unique: true, partialFilterExpression: { 'source.fieldSessionId': { $type: 'objectId' } }, name: 'source_fieldSessionId_unique_partial' }
);
fieldObservationSetSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('FieldObservationSet', fieldObservationSetSchema);
