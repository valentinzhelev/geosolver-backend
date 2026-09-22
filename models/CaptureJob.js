const mongoose = require('mongoose');

const STATUSES = ['uploaded', 'processing', 'needs_review', 'confirmed', 'failed'];

/**
 * Capture V2.1 job: one uploaded image -> OCR -> reconstructed coordinate table -> review -> confirmed import.
 * The reconstructed table (columns, rows, cells with rawText / normalizedValue / bbox / validation / userValue) is kept
 * embedded because it is bounded (one page, a few thousand cells) and is always read and written as a unit.
 * The structure of `table` is produced and enforced by capture/reconstruct.js + capture/validation.js.
 *
 * `status` is a persisted state machine, so processing can move to an asynchronous worker later without changing the
 * API: uploaded -> processing -> needs_review -> confirmed, or failed.
 */
const captureJobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    mode: { type: String, enum: ['coordinate-table'], default: 'coordinate-table' },
    status: { type: String, enum: STATUSES, default: 'uploaded', index: true },
    pipelineVersion: { type: String, required: true },
    // V2.2: which version of each deterministic stage produced this job's table, so a V2.1 job (where these are
    // absent) is never silently reinterpreted under V2.2 rules - it is simply read as-is (see capture/config.js).
    recognitionVersion: { type: String },
    arbitrationVersion: { type: String },
    validationVersion: { type: String },

    source: {
      originalName: { type: String, default: '' }, // sanitized display label only; never used for storage
      mime: { type: String },
      bytes: { type: Number },
      width: { type: Number }, // original pixels
      height: { type: Number },
      sha256: { type: String },
      // storage references (opaque ids from the storage abstraction)
      assets: {
        original: { type: String },
        review: { type: String },
        thumbnail: { type: String },
      },
      review: { width: { type: Number }, height: { type: Number } }, // the image the OCR boxes refer to
      // every geometric transformation applied to reach the review image (bboxes are in review-image pixels)
      transform: { type: mongoose.Schema.Types.Mixed },
      quality: { type: mongoose.Schema.Types.Mixed },
    },

    provider: {
      name: { type: String },
      version: { type: String },
      requestedAt: { type: Date },
      durationMs: { type: Number },
      wordCount: { type: Number },
      rerecognitionPasses: { type: Number }, // V2.2: extra provider calls spent re-reading uncertain cells
    },

    table: { type: mongoose.Schema.Types.Mixed, default: null },
    validationSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    crs: { type: String, default: null }, // project CRS at the time of the last validation

    failure: {
      code: { type: String },
      message: { type: String }, // sanitized, never a provider message
    },

    revision: { type: Number, default: 0 }, // incremented by every review edit (optimistic concurrency)

    confirmedAt: { type: Date },
    importedPointIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SurveyPoint' }],
    // set atomically by the first confirm to claim the import (idempotency / concurrency guard)
    confirmClaimedAt: { type: Date, default: null },

    retention: { expiresAt: { type: Date } },
  },
  { timestamps: true }
);

captureJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('CaptureJob', captureJobSchema);
module.exports.STATUSES = STATUSES;
