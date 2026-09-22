const mongoose = require('mongoose');

/**
 * Binary storage for generated Report PDFs (V2.5), kept behind the storage abstraction in reports/storage.js so
 * domain code never depends on this model directly - mirrors models/CaptureAsset.js's shape, but WITHOUT a TTL:
 * a generated professional document is a permanent record, never auto-deleted like a temporary OCR review image.
 */
const reportAssetSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    // never returned by default queries; storage.get selects it explicitly
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReportAsset', reportAssetSchema);
