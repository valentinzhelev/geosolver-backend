const Tesseract = require('tesseract.js');

function parseNumber(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractFirstTaskData(text) {
  const result = { y1: null, x1: null, alpha: null, s: null };
  let normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[₁₂]/g, '1')
    .replace(/[′'`]/g, "'")
    .replace(/\u0423/g, 'Y')
    .replace(/\u0443/g, 'y')
    .replace(/\u0425/g, 'X')
    .replace(/\u0445/g, 'x');

  function tryMatch(str, patterns) {
    for (const p of patterns) {
      const m = str.match(p);
      if (m && m[1]) return parseNumber(m[1]);
    }
    return null;
  }

  result.y1 = tryMatch(normalized, [
    /[Yy][1₁]?\s*[=:]\s*([\d\s.,]+)/,
    /\b[Yy]\s*[=:]\s*([\d\s.,]+)/
  ]);

  result.x1 = tryMatch(normalized, [
    /[Xx][1₁]?\s*[=:]\s*([\d\s.,]+)/,
    /\b[Xx]\s*[=:]\s*([\d\s.,]+)/
  ]);

  const alphaVal = tryMatch(normalized, [
    /[αa]lpha?\s*[=:]\s*([\d\s.,]+)/i,
    /ъгъл\s*[αa]?\s*[=:]\s*([\d\s.,]+)/i,
    /α\s*[=:]\s*([\d\s.,]+)/,
    /\bd\s*[=:]\s*([\d\s.,]+)/,
    /([\d\s.,]+)\s*(?:gon|град[иa]?)/i
  ]);
  if (alphaVal !== null && alphaVal >= 0 && alphaVal < 400) result.alpha = alphaVal;

  const sVal = tryMatch(normalized, [
    /\bS\s*[=:]\s*([\d\s.,]+)/,
    /дължина\s*S?\s*[=:]\s*([\d\s.,]+)/i,
    /разстояние\s*[=:]\s*([\d\s.,]+)/i,
    /([\d\s.,]+)\s*(?:m|м)\b/
  ]);
  if (sVal !== null && sVal > 0 && sVal < 100000) result.s = sVal;

  return result;
}

async function extractTaskInputFromImage(buffer) {
  const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
    logger: () => {}
  });

  const firstTask = extractFirstTaskData(text);
  const hasAny = firstTask.y1 !== null || firstTask.x1 !== null || firstTask.alpha !== null || firstTask.s !== null;

  return {
    success: hasAny,
    taskType: hasAny ? 'first-task' : null,
    inputData: hasAny ? firstTask : null,
    rawText: text ? text.slice(0, 1000) : '',
    confidence: hasAny ? 'extracted' : 'no_data'
  };
}

module.exports = {
  extractTaskInputFromImage,
  extractFirstTaskData
};
