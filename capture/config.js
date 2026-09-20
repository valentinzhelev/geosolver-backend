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
    pipelineVersion: 'capture-2.1.0',
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
  };
}

module.exports = { getConfig };
