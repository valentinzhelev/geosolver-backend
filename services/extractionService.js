const { ImageAnnotatorClient } = require('@google-cloud/vision');

function getVisionClient() {
  const raw = process.env.GCP_SA_JSON;
  if (!raw || typeof raw !== 'string') {
    throw new Error('GCP_SA_JSON environment variable is required');
  }
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GCP_SA_JSON must be valid JSON');
  }
  return new ImageAnnotatorClient({
    credentials,
    projectId: credentials.project_id
  });
}

function parseNumber(str) {
  if (!str || typeof str !== 'string') return null;
  let cleaned = str.trim();
  cleaned = cleaned.replace(/(\d)[\s\u00A0]+(\d{2})\b/g, '$1.$2');
  cleaned = cleaned.replace(/[\s\u00A0]/g, '');
  cleaned = cleaned.replace(/[,‚\u060C]/g, '.');
  cleaned = cleaned.replace(/[Oo]/g, '0').replace(/[l|]/g, '1');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getWordCenter(vertices) {
  if (!vertices || vertices.length < 2) return null;
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2
  };
}

function collectTokens(fullText) {
  const tokens = [];
  if (!fullText || !fullText.pages) return tokens;
  for (const page of fullText.pages) {
    const blocks = page.blocks || [];
    for (const block of blocks) {
      const paragraphs = block.paragraphs || [];
      for (const paragraph of paragraphs) {
        const words = paragraph.words || [];
        for (const word of words) {
          const text = (word.symbols || []).map(s => s.text || '').join('');
          const conf = word.confidence != null ? word.confidence : 0.9;
          const box = word.boundingBox && word.boundingBox.vertices;
          const center = getWordCenter(box);
          if (text.trim()) {
            tokens.push({ text: text.trim(), confidence: conf, center, vertices: box });
          }
        }
      }
    }
  }
  return tokens;
}

const LABEL_Y = /^(Y|Y1|Yl|YI|y|у)$/i;
const LABEL_X = /^(X|X1|Xl|XI|x|х)$/i;
const LABEL_ALPHA = /^(α|a|alpha|d|ъгъл)$/i;
const LABEL_S = /^(S|s|5|8)$/;
const NUMERIC = /^[\d\s.,\-]+$/;

function findValueForLabel(tokens, labelRegex, validate) {
  for (let i = 0; i < tokens.length; i++) {
    if (!labelRegex.test(tokens[i].text)) continue;
    const labelCenter = tokens[i].center;
    if (!labelCenter) continue;

    let best = null;
    let bestDist = Infinity;
    const yTol = 30;

    for (let j = 0; j < tokens.length; j++) {
      if (i === j) continue;
      const t = tokens[j];
      if (!NUMERIC.test(t.text.replace(/\s/g, ''))) continue;
      const num = parseNumber(t.text);
      if (num === null || !validate(num)) continue;

      const c = t.center;
      if (!c) continue;

      const sameLine = Math.abs(c.y - labelCenter.y) < yTol;
      const toRight = c.x > labelCenter.x - 20;
      const below = c.y > labelCenter.y - 10;

      if (!sameLine && !below) continue;
      if (!toRight && sameLine) continue;

      const dx = c.x - labelCenter.x;
      const dy = c.y - labelCenter.y;
      const dist = sameLine ? Math.abs(dx) : Math.hypot(dx, dy);

      if (dist < bestDist) {
        bestDist = dist;
        best = { value: num, confidence: t.confidence };
      }
    }

    if (best) return best;
  }
  return null;
}

function extractFromVisionTokens(tokens) {
  const result = {
    y1: null,
    x1: null,
    alpha: null,
    s: null
  };
  const confidence = { y1: 0, x1: 0, alpha: 0, s: 0 };

  const yRes = findValueForLabel(tokens, LABEL_Y, () => true);
  if (yRes) {
    result.y1 = yRes.value;
    confidence.y1 = yRes.confidence;
  }

  const xRes = findValueForLabel(tokens, LABEL_X, () => true);
  if (xRes) {
    result.x1 = xRes.value;
    confidence.x1 = xRes.confidence;
  }

  const aRes = findValueForLabel(
    tokens,
    LABEL_ALPHA,
    (n) => (n >= 0 && n <= 360) || (n >= 0 && n <= 400)
  );
  if (aRes) {
    result.alpha = aRes.value;
    confidence.alpha = aRes.confidence;
  }

  const sRes = findValueForLabel(tokens, LABEL_S, (n) => n > 0 && n < 100000);
  if (sRes) {
    result.s = sRes.value;
    confidence.s = sRes.confidence;
  }

  return { result, confidence };
}

async function extractTaskInputFromImage(buffer) {
  const client = getVisionClient();
  const [response] = await client.documentTextDetection({
    image: { content: buffer.toString('base64') }
  });

  const fullText = response.fullTextAnnotation;
  const rawText = fullText ? (fullText.text || '') : '';

  const tokens = collectTokens(fullText);
  const { result, confidence } = extractFromVisionTokens(tokens);

  const hasAny = result.y1 !== null || result.x1 !== null || result.alpha !== null || result.s !== null;

  return {
    success: hasAny,
    taskType: hasAny ? 'first-task' : null,
    inputData: hasAny ? result : null,
    confidence: hasAny ? confidence : null,
    rawText: rawText.slice(0, 1000)
  };
}

module.exports = {
  extractTaskInputFromImage
};
