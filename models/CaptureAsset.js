const mongoose = require('mongoose');

/**
 * Binary storage for Capture images (V2.1: kept in MongoDB behind the storage abstraction in capture/storage, so
 * the domain code never depends on this model directly). Assets expire automatically (TTL on expiresAt).
 */
const captureAssetSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'CaptureJob', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['original', 'review', 'thumbnail'], required: true },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    // never returned by default queries; storage.get selects it explicitly
    data: { type: Buffer, required: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

captureAssetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CaptureAsset', captureAssetSchema);
