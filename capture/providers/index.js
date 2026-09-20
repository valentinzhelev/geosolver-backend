/**
 * OCR provider registry. A provider implements `recognize(imageBuffer, {width, height})` and resolves the normalized
 * shape documented in googleVision.js. Tests register a deterministic fixture provider; production uses Google Vision.
 * No LLM / multimodal provider exists in V2.1.
 */
const { createGoogleVisionProvider } = require('./googleVision');
const { CaptureError } = require('../errors');

const overrides = new Map();
let cached = null;

function getProvider(name) {
  if (overrides.has(name)) return overrides.get(name);
  if (name === 'google-vision') {
    if (!cached) cached = createGoogleVisionProvider();
    return cached;
  }
  throw new CaptureError('PROVIDER_NOT_CONFIGURED');
}

/** Test seam: replace (or with `null` restore) a provider by name. */
function setProviderForTests(name, provider) {
  if (provider) overrides.set(name, provider);
  else overrides.delete(name);
}

module.exports = { getProvider, setProviderForTests };
