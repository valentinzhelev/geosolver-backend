/**
 * Deterministic image preprocessing for Capture (sharp). No network, no randomness.
 *
 * Produces:
 *  - review image: EXIF-oriented, size-limited, optionally deskewed. THIS is the coordinate system of every OCR box;
 *  - OCR image: same geometry as the review image (so boxes need no conversion), grayscale + normalize + sharpen;
 *  - thumbnail;
 *  - `transform`: every geometric step, enough to map a review-image point back to the ORIGINAL pixels;
 *  - `quality`: basic measurements and warnings.
 *
 * Only orientation, uniform scaling and a small rotation (deskew) are geometric. There is deliberately NO
 * perspective correction in V2.1.
 */
const sharp = require('sharp');
const crypto = require('crypto');
const { CaptureError } = require('./errors');

const MAX_SKEW = 5; // degrees searched
const MIN_APPLIED_SKEW = 0.4; // smaller corrections are noise
const MIN_SCORE_GAIN = 1.03; // the correction must clearly sharpen the row profile

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** Validates the bytes (format from the content, pixel count, minimum size) BEFORE any full decode. */
async function inspectImage(buffer, config) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new CaptureError('NO_FILE');
  if (buffer.length > config.maxBytes) throw new CaptureError('IMAGE_TOO_LARGE');
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: false, failOn: 'error' }).metadata();
  } catch {
    throw new CaptureError('INVALID_IMAGE');
  }
  if (!meta.format || !config.allowedFormats.includes(meta.format)) throw new CaptureError('UNSUPPORTED_MEDIA_TYPE');
  if (!meta.width || !meta.height) throw new CaptureError('INVALID_IMAGE');
  // pixel-bomb guard: header dimensions are checked before anything is decoded
  if (meta.width * meta.height > config.maxPixels) throw new CaptureError('IMAGE_TOO_MANY_PIXELS');
  if (Math.min(meta.width, meta.height) < config.minSide) throw new CaptureError('IMAGE_TOO_SMALL');
  return { format: meta.format, width: meta.width, height: meta.height, orientation: meta.orientation || 1, sha256: sha256(buffer) };
}

/** Clockwise rotation (degrees) that best straightens text lines, by maximising the row-ink profile sharpness. */
async function estimateSkewDegrees(buffer) {
  const base = await sharp(buffer).grayscale().normalize().resize({ width: 700, withoutEnlargement: true }).threshold(140).png().toBuffer();
  const score = async (angle) => {
    let img = sharp(base);
    if (angle !== 0) img = img.rotate(angle, { background: '#ffffff' });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const rows = new Float64Array(info.height);
    for (let y = 0; y < info.height; y += 1) {
      let ink = 0;
      const off = y * info.width * info.channels;
      for (let x = 0; x < info.width; x += 1) if (data[off + x * info.channels] < 128) ink += 1;
      rows[y] = ink;
    }
    let s = 0;
    for (let y = 0; y < rows.length; y += 1) s += rows[y] * rows[y];
    return s;
  };
  const base0 = await score(0);
  if (base0 === 0) return { degrees: 0, gain: 1 };
  let best = 0;
  let bestScore = base0;
  for (let a = -MAX_SKEW; a <= MAX_SKEW + 1e-9; a += 0.5) {
    if (a === 0) continue;
    const s = await score(a);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  const coarse = best;
  for (let a = coarse - 0.4; a <= coarse + 0.4 + 1e-9; a += 0.1) {
    const angle = Math.round(a * 10) / 10;
    if (angle === coarse) continue;
    const s = await score(angle);
    if (s > bestScore) { bestScore = s; best = angle; }
  }
  return { degrees: best, gain: bestScore / base0 };
}

async function laplacianVariance(grayBuffer) {
  const small = await sharp(grayBuffer).resize({ width: 1000, withoutEnlargement: true }).grayscale().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).stats();
  const sd = small.channels[0].stdev;
  return sd * sd;
}

async function measureQuality(orientedBuffer, info, skewDegrees, config) {
  const stats = await sharp(orientedBuffer).grayscale().stats();
  const ch = stats.channels[0];
  const sharpness = await laplacianVariance(orientedBuffer);
  const megapixels = (info.width * info.height) / 1e6;
  const warnings = [];
  if (Math.max(info.width, info.height) < 900) warnings.push('LOW_RESOLUTION');
  if (sharpness < 25) warnings.push('BLURRY');
  if (ch.stdev < 35) warnings.push('LOW_CONTRAST');
  if (ch.mean < 60) warnings.push('DARK');
  if (ch.mean > 245) warnings.push('OVEREXPOSED');
  return {
    megapixels: Math.round(megapixels * 100) / 100,
    sharpness: Math.round(sharpness * 10) / 10,
    brightness: Math.round(ch.mean * 10) / 10,
    contrast: Math.round(ch.stdev * 10) / 10,
    skewDegrees,
    warnings,
    reviewMaxSide: config.reviewMaxSide,
  };
}

/**
 * @returns {Promise<{review:{buffer,width,height,mime}, ocr:{buffer,width,height,mime}, thumbnail:{buffer,width,height,mime}, transform:object, quality:object}>}
 */
async function preprocessImage(buffer, config, inspected) {
  try {
    const meta = inspected || (await inspectImage(buffer, config));
    // 1. EXIF orientation (sharp .rotate() with no argument) and one uniform downscale, in a single lossless pass
    const swap = (meta.orientation || 1) >= 5;
    const orientedInfo = { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
    const maxSide = Math.max(orientedInfo.width, orientedInfo.height);
    const scale = maxSide > config.reviewMaxSide ? config.reviewMaxSide / maxSide : 1;
    let pipeline = sharp(buffer, { limitInputPixels: config.maxPixels }).rotate();
    if (scale < 1) {
      pipeline = pipeline.resize({ width: Math.round(orientedInfo.width * scale), height: Math.round(orientedInfo.height * scale), fit: 'fill' });
    }
    const prepared = await pipeline.png().toBuffer({ resolveWithObject: true });
    let working = prepared.data;
    let width = prepared.info.width;
    let height = prepared.info.height;
    const scaled = { width, height };

    // 2. deskew (only when clearly justified)
    const skew = await estimateSkewDegrees(working);
    const applied = Math.abs(skew.degrees) >= MIN_APPLIED_SKEW && skew.gain >= MIN_SCORE_GAIN ? skew.degrees : 0;
    if (applied !== 0) {
      const rotated = await sharp(working).rotate(applied, { background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
      working = rotated.data;
      width = rotated.info.width;
      height = rotated.info.height;
    }

    // 3. outputs: review (colour, JPEG), OCR (contrast-enhanced gray, PNG), thumbnail. Same geometry.
    const review = await sharp(working).jpeg({ quality: 92 }).toBuffer();
    const ocr = await sharp(working).flatten({ background: '#ffffff' }).grayscale().normalize().sharpen({ sigma: 0.6 }).toColourspace('b-w').png().toBuffer();
    const thumb = await sharp(working).resize({ width: config.thumbnailSide, height: config.thumbnailSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });

    const transform = {
      exifOrientation: meta.orientation || 1,
      original: { width: meta.width, height: meta.height },
      oriented: { width: orientedInfo.width, height: orientedInfo.height },
      scale,
      scaled,
      deskewDegrees: applied,
      review: { width, height },
    };
    const quality = await measureQuality(working, { width, height }, applied, config);
    return {
      review: { buffer: review, width, height, mime: 'image/jpeg' },
      ocr: { buffer: ocr, width, height, mime: 'image/png' },
      thumbnail: { buffer: thumb.data, width: thumb.info.width, height: thumb.info.height, mime: 'image/jpeg' },
      transform,
      quality,
    };
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError('PREPROCESS_FAILED');
  }
}

// ---- mapping review-image points back to the original file's pixels -------------------------------------------------

/** EXIF orientation -> maps a point of the ORIENTED image back to the stored (raw) image. */
function orientedToRaw(p, orientation, raw) {
  const { width: W, height: H } = raw; // raw (as stored) dimensions
  switch (orientation) {
    case 2: return { x: W - p.x, y: p.y };
    case 3: return { x: W - p.x, y: H - p.y };
    case 4: return { x: p.x, y: H - p.y };
    case 5: return { x: p.y, y: p.x };
    case 6: return { x: p.y, y: H - p.x };
    case 7: return { x: W - p.y, y: H - p.x };
    case 8: return { x: W - p.y, y: p.x };
    default: return { x: p.x, y: p.y };
  }
}

/** Inverse of: [scale] then [rotate clockwise by deskewDegrees about the centre, canvas grown]. */
function reviewToOriginal(point, transform) {
  const { scale, scaled, deskewDegrees, review, exifOrientation, original } = transform;
  let p = { x: point.x, y: point.y };
  if (deskewDegrees) {
    const t = (-deskewDegrees * Math.PI) / 180;
    const cxr = review.width / 2;
    const cyr = review.height / 2;
    const dx = p.x - cxr;
    const dy = p.y - cyr;
    p = { x: scaled.width / 2 + dx * Math.cos(t) - dy * Math.sin(t), y: scaled.height / 2 + dx * Math.sin(t) + dy * Math.cos(t) };
  }
  p = { x: p.x / scale, y: p.y / scale };
  return orientedToRaw(p, exifOrientation, original);
}

module.exports = { inspectImage, preprocessImage, estimateSkewDegrees, reviewToOriginal, orientedToRaw, sha256, MIN_APPLIED_SKEW };
