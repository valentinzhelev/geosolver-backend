const mongoose = require('mongoose');

const surveyPointSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', default: null, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    h: { type: Number, default: null },
    pointClass: { type: String, default: '', trim: true },
    layer: { type: String, default: 'default', trim: true },
    notes: { type: String, default: '' },
    // Provenance only (Milestone 1.1): set exclusively by
    // POST /api/calculations/:id/create-point, never from a request body
    // (POST/import/PUT on /api/points use explicit field allow-lists and
    // cannot set, change or clear it).
    // MEANING: "created from the STORED result of Calculation X". It does NOT
    // mean the backend independently verified Calculation X's mathematics —
    // the backend does not recompute resultData from inputData (calculations
    // still run client-side). A future canonical-engine milestone would be
    // needed for that stronger claim.
    // Deliberately NO default — ordinary points must leave the field absent
    // (not null), which is what the partial unique index below relies on.
    sourceCalculationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calculation' },
    // Capture V2.1 / Field Processing V2.4.1-2 provenance: set ONLY by the respective import/create service
    // (capture/importService.js, routes/fieldProcessing.js), never from a request body (the /api/points routes
    // build their documents from explicit allow-lists). Ordinary and calculation-generated points leave the whole
    // field absent. Two kinds share this one sub-schema (kept together, not a Mongoose discriminator, since both
    // are small and the fields do not collide): 'capture' (row/cells from a coordinate-table CaptureJob) and
    // 'field-processing' (processingRunId/fieldObservationSetId/setup/observation from a FieldProcessingRun).
    // `processingType` ('polar' default | 'traverse', V2.4.2) is purely informational provenance metadata - for a
    // traverse-generated point, `setup`/`observation` are the OCCUPYING setup's index and the chosen foresight
    // observation's row (a leg is uniquely identified by that same tuple, so it reuses the existing unique index
    // below unchanged rather than needing a new one).
    source: {
      type: new mongoose.Schema(
        {
          kind: { type: String, enum: ['capture', 'field-processing'] },
          // kind: 'capture'
          captureJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob' },
          row: { type: Number },
          // kind: 'field-processing'
          processingRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldProcessingRun' },
          fieldObservationSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldObservationSet' },
          processingType: { type: String, enum: ['polar', 'traverse'], default: 'polar' },
          setup: { type: Number },
          observation: { type: Number },
          // semantic -> { col, page, bbox } of the OCR cell each value came from (either kind)
          cells: { type: mongoose.Schema.Types.Mixed },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

surveyPointSchema.index({ user: 1, name: 1 });
// At most one live generated point per Calculation. Partial (not sparse, not
// plain unique): only documents whose sourceCalculationId is an ObjectId are
// indexed, so unlimited ordinary points remain valid, and deleting a
// generated point frees its Calculation to be saved as a point again.
surveyPointSchema.index(
  { sourceCalculationId: 1 },
  { unique: true, partialFilterExpression: { sourceCalculationId: { $type: 'objectId' } } }
);

// One imported row per (CaptureJob, row): a database-level guard that makes a repeated/concurrent confirm unable to
// create duplicate points. Partial, so ordinary points are unaffected.
surveyPointSchema.index(
  { 'source.captureJobId': 1, 'source.row': 1 },
  { unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } } }
);

// One point per (FieldProcessingRun, setup, observation): the database-level guard that makes a repeated/
// concurrent "Създай точки" unable to create duplicates (V2.4.1). Partial, so ordinary/capture/calculation points
// are unaffected.
surveyPointSchema.index(
  { 'source.processingRunId': 1, 'source.setup': 1, 'source.observation': 1 },
  { unique: true, partialFilterExpression: { 'source.processingRunId': { $type: 'objectId' } } }
);

module.exports = mongoose.model('SurveyPoint', surveyPointSchema);
