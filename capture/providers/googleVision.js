/**
 * Google Vision OCR adapter. The vendor response is translated IMMEDIATELY into the internal normalized shape:
 *
 *   { provider: { name, version }, page: { index, width, height, words: [ { text, confidence, bbox:{x,y,w,h}, symbols:[{text,confidence}] } ] } }
 *
 * Nothing vendor-specific leaves this file. Failures become sanitized CaptureErrors (no provider message, no
 * response content, no credentials); only the code is logged by callers.
 */
const { CaptureError } = require('../errors');

const NAME = 'google-vision';
const VERSION = 'documentTextDetection';
const TIMEOUT_MS = 30000;

function defaultClientFactory() {
  const raw = process.env.GCP_SA_JSON;
  if (!raw || typeof raw !== 'string') throw new CaptureError('PROVIDER_NOT_CONFIGURED');
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new CaptureError('PROVIDER_NOT_CONFIGURED');
  }
  // required lazily so the module (and the whole Capture domain) loads without the vendor library in tests
  const { ImageAnnotatorClient } = require('@google-cloud/vision');
  return new ImageAnnotatorClient({ credentials, projectId: credentials.project_id });
}

function boxOf(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 2) return null;
  const xs = vertices.map((v) => v.x || 0);
  const ys = vertices.map((v) => v.y || 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Pure translation of a Vision `fullTextAnnotation` into normalized words (exported for tests). */
function normalizeVisionResponse(response, dims) {
  const full = response && response.fullTextAnnotation;
  const words = [];
  const visionPage = full && Array.isArray(full.pages) ? full.pages[0] : null;
  for (const block of (visionPage && visionPage.blocks) || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const word of paragraph.words || []) {
        const symbols = (word.symbols || []).map((s) => ({ text: s.text || '', confidence: typeof s.confidence === 'number' ? s.confidence : null }));
        const text = symbols.map((s) => s.text).join('');
        const bbox = boxOf(word.boundingBox && word.boundingBox.vertices);
        if (!text.trim() || !bbox) continue;
        words.push({ text: text.trim(), confidence: typeof word.confidence === 'number' ? word.confidence : null, bbox, symbols });
      }
    }
  }
  return {
    provider: { name: NAME, version: VERSION },
    page: { index: 0, width: (visionPage && visionPage.width) || dims.width, height: (visionPage && visionPage.height) || dims.height, words },
  };
}

function createGoogleVisionProvider({ clientFactory = defaultClientFactory, timeoutMs = TIMEOUT_MS } = {}) {
  return {
    name: NAME,
    version: VERSION,
    async recognize(imageBuffer, dims) {
      let client;
      try {
        client = clientFactory();
      } catch (e) {
        throw e instanceof CaptureError ? e : new CaptureError('PROVIDER_NOT_CONFIGURED');
      }
      let timer;
      try {
        const call = client.documentTextDetection({
          image: { content: imageBuffer.toString('base64') },
          imageContext: { languageHints: ['bg', 'en'] }, // printed tables; no handwriting-specific hints in V2.1
        });
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); });
        const [response] = await Promise.race([call, timeout]);
        return normalizeVisionResponse(response, dims);
      } catch {
        // the vendor message is deliberately dropped: it may contain request details
        throw new CaptureError('PROVIDER_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createGoogleVisionProvider, normalizeVisionResponse, NAME };
