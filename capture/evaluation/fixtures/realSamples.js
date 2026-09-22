/**
 * Loads REAL, labelled Capture sample images for the evaluation harness, from an opt-in, gitignored directory
 * (capture/evaluation/fixtures/real/manifest.json, see manifest.schema.json next to this file). Nothing here is
 * committed automatically and nothing here is required: with no manifest present, this simply returns [].
 *
 * This is deliberately separate from the synthetic fixtures (tests/support/captureFixtures.js): synthetic fixtures
 * prove the PIPELINE's logic is correct; only real samples can honestly measure real-world (especially handwriting)
 * accuracy. See capture/evaluation/README-equivalent note in the V2.2 final report for what is still needed.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, 'real');

/**
 * @param {string} dir directory containing manifest.json (defaults to capture/evaluation/fixtures/real/)
 * @returns {{image: Buffer, groundTruth: object, metadata: object, crs?: string}[]} empty when no manifest exists
 */
function loadRealSamples(dir = DEFAULT_DIR) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  return samples.map((s) => ({
    image: fs.readFileSync(path.join(dir, s.image)),
    groundTruth: s.groundTruth,
    metadata: { source: 'real', ...(s.metadata || {}) },
    crs: s.crs || null,
  }));
}

module.exports = { loadRealSamples, DEFAULT_DIR };
