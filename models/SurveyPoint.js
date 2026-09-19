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

module.exports = mongoose.model('SurveyPoint', surveyPointSchema);
