const mongoose = require('mongoose');

/**
 * A generated professional document (V2.5) - the third artifact type alongside FieldProcessingRun and SurveyPoint.
 * Immutable once created: nothing here is ever updated after `create()` (no PATCH/PUT route exists). Regenerating
 * the "same" report creates a brand new ReportDocument, never overwrites an existing one - see reports/buildReport.js.
 *
 * `model` retains the FULL normalized report-model snapshot (reports/modelBuilders/*) the PDF was rendered from,
 * and `templateVersion` the renderer version that rendered it, so the exact historical document is reproducible
 * even if the project name, SurveyPoint coordinates, or the report templates themselves change later - this
 * document is never rebuilt by re-querying current mutable data.
 */
const reportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // creator
    // Named `projectId` (not `project`) to match FieldProcessingRun's own field name - the same architectural layer.
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    reportType: { type: String, enum: ['POLAR_PROCESSING_REPORT', 'TRAVERSE_PROCESSING_REPORT', 'PROJECT_COORDINATE_LIST'], required: true },
    // 'field-processing-run' (polar/traverse reports) or 'project-points-snapshot' (coordinate list, no single source doc).
    sourceType: { type: String, enum: ['field-processing-run', 'project-points-snapshot'], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null }, // the FieldProcessingRun id, or null
    // Authority/version metadata proving WHICH exact source state this was rendered from - never recomputed later.
    sourceVersion: { type: mongoose.Schema.Types.Mixed, required: true },
    templateVersion: { type: String, required: true },
    title: { type: String, required: true },
    documentNumber: { type: String, default: null },
    generatedAt: { type: Date, required: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The full normalized model snapshot the PDF was rendered from (reports/modelBuilders/*'s output) - the
    // reproducibility guarantee (V2.5 section 10).
    model: { type: mongoose.Schema.Types.Mixed, required: true },
    file: {
      storageKey: { type: String, required: true }, // opaque ReportAsset id from reports/storage.js
      mime: { type: String, required: true },
      size: { type: Number, required: true },
      hash: { type: String, required: true }, // sha256 of the PDF bytes
    },
  },
  { timestamps: true }
);

reportSchema.index({ projectId: 1, createdAt: -1 });
reportSchema.index({ sourceType: 1, sourceId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
