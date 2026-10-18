/**
 * Capture V2.1 configuration. Everything a business decision could change lives here (or in the environment),
 * not inside the OCR pipeline. There is no approved monthly quota yet, so it is unset (= not enforced) by default;
 * set CAPTURE_MONTHLY_QUOTA to enforce one. No pricing is encoded anywhere.
 */
const int = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

function getConfig() {
  return {
    pipelineVersion: 'capture-2.3.0',
    reconstructionVersion: 'capture-reconstruct-1.0.0',
    validationVersion: 'capture-validate-2.2.0',
    // V2.3: Field Notebook mode versions, tracked separately from the coordinate-table ones above (a job's mode
    // decides which versions are meaningful; see models/CaptureJob.js).
    // 1.1.0: a table header with rows but no station line opens a leading continuation setup (multi-page notebooks)
    notebookReconstructionVersion: 'capture-notebook-reconstruct-1.1.0',
    notebookValidationVersion: 'capture-notebook-validate-1.0.0',
    maxBytes: int('CAPTURE_MAX_BYTES', 8 * 1024 * 1024),
    maxPixels: int('CAPTURE_MAX_PIXELS', 40 * 1000 * 1000), // decoded-size guard (pixel bomb protection)
    minSide: int('CAPTURE_MIN_SIDE', 200),
    reviewMaxSide: int('CAPTURE_REVIEW_MAX_SIDE', 2200),
    thumbnailSide: int('CAPTURE_THUMBNAIL_SIDE', 480),
    allowedFormats: ['jpeg', 'png', 'webp'], // detected from the bytes, never from the filename / declared type
    retentionDays: int('CAPTURE_RETENTION_DAYS', 30),
    monthlyQuota: process.env.CAPTURE_MONTHLY_QUOTA ? int('CAPTURE_MONTHLY_QUOTA', null) : null, // null = not enforced
    confidenceThreshold: 0.85,
    maxEditsPerRequest: 500,
    maxValueLength: 200,
    provider: process.env.CAPTURE_PROVIDER || 'google-vision',
    // V2.2: candidate arbitration (capture/arbitration.js). Centralized and versioned; never hard-coded in the
    // recognition/validation modules themselves.
    arbitration: {
      version: 'capture-arb-1.0.0',
      minConsensus: int('CAPTURE_ARBITRATION_MIN_CONSENSUS', 2),
      symbolConfidenceThreshold: 0.75,
      acceptConfidenceThreshold: 0.85,
      uncertainConfidenceFloor: 0.5,
    },
    // V2.2: bounded re-recognition of uncertain cells (capture/rerecognition.js). Costs a real provider call per
    // variant, so every knob here is a hard cap, not a target.
    rerecognition: {
      enabled: process.env.CAPTURE_RERECOGNITION_DISABLED !== '1',
      maxCellsPerJob: int('CAPTURE_RERECOGNITION_MAX_CELLS', 30),
      maxPassesPerCell: int('CAPTURE_RERECOGNITION_MAX_PASSES', 3),
      cropPaddingPx: int('CAPTURE_RERECOGNITION_PADDING', 12),
      minCropSide: int('CAPTURE_RERECOGNITION_MIN_CROP_SIDE', 20),
      enlargeFactor: 2, // used only by the 'enlarged' variant, itself only added when a crop is small
    },
  };
}

module.exports = { getConfig };
