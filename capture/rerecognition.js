/**
 * Bounded re-recognition of uncertain cells (V2.2).
 *
 * Whole-page OCR gives one reading per cell. For cells that look uncertain (low confidence, a suspicious symbol, or
 * an unparseable value) we crop just that region from the REVIEW image (the same pixel space as every cell bbox),
 * build a small, bounded set of image variants, and ask the SAME provider adapter to read each crop. Every result
 * becomes an additional candidate on the cell (capture/arbitration.js then judges trust from the whole pool).
 *
 * This never re-runs OCR on the whole page, never runs unboundedly, and never invents a provider: it calls the
 * same `provider.recognize(buffer, dims)` interface used for the primary pass, so any future provider works here
 * for free. The optional third field on `dims` (`crop`) is a courtesy for deterministic TEST providers that want
 * to simulate "reading just this region" - real providers ignore fields they don't recognise.
 */
const sharp = require('sharp');
const { TRACKED_SEMANTICS } = require('./arbitration');
const { hasSuspiciousSymbol } = require('./symbols');
const { isCaptureError } = require('./errors');

/** Cells worth spending a re-recognition budget on: identifiers/numerics that look uncertain from the primary pass. */
function needsRerecognition(cell, semantic, config) {
  if (!TRACKED_SEMANTICS.has(semantic)) return false;
  if (!cell.rawText) return false; // nothing to re-read
  if (typeof cell.confidence !== 'number') return true;
  if (cell.confidence < config.confidenceThreshold) return true;
  if (hasSuspiciousSymbol(cell.symbolConfidence)) return true;
  return false;
}

/** A padded, clamped crop rectangle (review-image pixel space) around a cell's bounding box. */
function cropRect(bbox, padding, bounds) {
  const x0 = Math.max(0, Math.floor(bbox.x - padding));
  const y0 = Math.max(0, Math.floor(bbox.y - padding));
  const x1 = Math.min(bounds.width, Math.ceil(bbox.x + bbox.w + padding));
  const y1 = Math.min(bounds.height, Math.ceil(bbox.y + bbox.h + padding));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * A small, bounded set of image variants for one crop. Kept intentionally short: each variant is a real provider
 * call, so "just try more things" is not free. `original` is always first (closest to what the primary pass saw,
 * just isolated); the rest target specific failure modes (low contrast, faint ink).
 */
async function buildVariants(reviewBuffer, rect, config) {
  const base = sharp(reviewBuffer).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });
  const variants = [{ kind: 'original', buffer: await base.clone().png().toBuffer() }];
  variants.push({ kind: 'enhanced', buffer: await base.clone().grayscale().normalize().sharpen({ sigma: 0.8 }).png().toBuffer() });
  variants.push({ kind: 'threshold', buffer: await base.clone().grayscale().normalize().threshold(150).png().toBuffer() });
  if (Math.min(rect.w, rect.h) < config.minCropSide) {
    variants.push({ kind: 'enlarged', buffer: await base.clone().resize({ width: rect.w * config.enlargeFactor, height: rect.h * config.enlargeFactor, kernel: 'cubic' }).grayscale().normalize().png().toBuffer() });
  }
  return variants.slice(0, config.maxPassesPerCell);
}

/** One candidate entry built from a crop recognition result (may be empty text: still recorded as evidence). */
function candidateFromCropResult(recognized, { pass, variantKind }) {
  const words = (recognized && recognized.page && recognized.page.words) || [];
  const text = words.map((w) => w.text).join(' ').trim();
  const confs = words.map((w) => w.confidence).filter((v) => typeof v === 'number');
  const confidence = confs.length && confs.length === words.length ? Math.min(...confs) : confs.length ? Math.min(...confs) : null;
  const symbolConfidence = { min: null, suspicious: [] };
  let min = null;
  const suspicious = [];
  words.forEach((w, wi) => (w.symbols || []).forEach((s, si) => {
    if (typeof s.confidence !== 'number') return;
    if (min === null || s.confidence < min) min = s.confidence;
    if (s.confidence < 0.75) suspicious.push({ word: wi, index: si, text: s.text, confidence: s.confidence });
  }));
  symbolConfidence.min = min;
  symbolConfidence.suspicious = suspicious;
  return {
    text,
    normalizedValue: null,
    provider: (recognized && recognized.provider && recognized.provider.name) || null,
    providerVersion: (recognized && recognized.provider && recognized.provider.version) || null,
    recognitionPass: pass,
    preprocessingVariant: variantKind,
    confidence,
    bbox: null, // crop-relative; not mapped back to the page (the crop rect itself is the evidence)
    symbolConfidence,
    source: 're-recognition',
  };
}

/**
 * Re-recognizes uncertain cells of a reconstructed table, appending candidates in place (mutates `table`).
 * Bounded by config.maxCellsPerJob (across the whole table) and config.maxPassesPerCell (per cell).
 * @param {object} table reconstructed table (capture/reconstruct.js shape)
 * @param {Buffer} reviewBuffer the review-size image the cell bboxes are expressed in
 * @param {{width:number, height:number}} reviewBounds
 * @param {object} provider an OCR provider (capture/providers)
 * @param {object} config `getConfig().rerecognition`
 * @returns {Promise<{cellsProcessed: number, passesRun: number}>}
 */
async function rerecognizeUncertainCells(table, reviewBuffer, reviewBounds, provider, config) {
  if (!config.enabled) return { cellsProcessed: 0, passesRun: 0 };
  const semanticOf = (colIndex) => (table.columns.find((c) => c.index === colIndex) || {}).semantic || null;
  const candidates = [];
  for (const row of table.rows) {
    if (row.excluded) continue;
    for (const cell of row.cells) {
      const semantic = semanticOf(cell.col);
      if (needsRerecognition(cell, semantic, { confidenceThreshold: 0.85 })) candidates.push(cell);
    }
  }
  const targets = candidates.slice(0, config.maxCellsPerJob);
  let passesRun = 0;
  for (const cell of targets) {
    const rect = cropRect(cell.bbox, config.cropPaddingPx, reviewBounds);
    let variants;
    try {
      variants = await buildVariants(reviewBuffer, rect, config);
    } catch {
      continue; // a crop failure never fails the whole job: the cell simply keeps only its primary candidate
    }
    let pass = 1;
    for (const variant of variants) {
      try {
        const recognized = await provider.recognize(variant.buffer, { width: rect.w, height: rect.h, crop: rect });
        cell.candidates.push(candidateFromCropResult(recognized, { pass, variantKind: variant.kind }));
        passesRun += 1;
      } catch (e) {
        if (!isCaptureError(e)) throw e; // an unexpected bug should not be silently swallowed
        // a sanitized provider failure for ONE crop pass: skip it, keep whatever candidates were already gathered
      }
      pass += 1;
    }
  }
  return { cellsProcessed: targets.length, passesRun };
}

module.exports = { needsRerecognition, cropRect, buildVariants, rerecognizeUncertainCells };
