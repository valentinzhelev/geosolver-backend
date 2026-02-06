const Tesseract = require('tesseract.js');

function parseNumber(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractFirstTaskData(text) {
  const result = { y1: null, x1: null, alpha: null, s: null };
  const normalized = text.replace(/\r\n/g, '\n').replace(/[₁₂]/g, '1').replace(/[′'`]/g, "'");

  const yPatterns = [
    /Y[1₁]?\s*[=:]\s*([\d\s.,]+)/gi,
    /Y\s*[=:]\s*([\d\s.,]+)/gi,
    /координата\s*Y[1₁]?\s*[=:]\s*([\d\s.,]+)/gi
  ];
  for (const p of yPatterns) {
    const m = p.exec(normalized);
    if (m && m[1]) {
      const val = parseNumber(m[1]);
      if (val !== null) { result.y1 = val; break; }
    }
  }

  const xPatterns = [
    /X[1₁]?\s*[=:]\s*([\d\s.,]+)/gi,
    /X\s*[=:]\s*([\d\s.,]+)/gi,
    /координата\s*X[1₁]?\s*[=:]\s*([\d\s.,]+)/gi
  ];
  for (const p of xPatterns) {
    const m = p.exec(normalized);
    if (m && m[1]) {
      const val = parseNumber(m[1]);
      if (val !== null) { result.x1 = val; break; }
    }
  }

  const alphaPatterns = [
    /[αa]lpha?\s*[=:]\s*([\d\s.,]+)/gi,
    /ъгъл\s*[αa]?\s*[=:]\s*([\d\s.,]+)/gi,
    /α\s*[=:]\s*([\d\s.,]+)/gi,
    /\bd\s*[=:]\s*([\d\s.,]+)/gi,
    /([\d\s.,]+)\s*(?:gon|град[иa]?)/gi
  ];
  for (const p of alphaPatterns) {
    const m = p.exec(normalized);
    if (m && m[1]) {
      const val = parseNumber(m[1]);
      if (val !== null && val >= 0 && val < 400) { result.alpha = val; break; }
    }
  }

  const sPatterns = [
    /S\s*[=:]\s*([\d\s.,]+)/gi,
    /дължина\s*S?\s*[=:]\s*([\d\s.,]+)/gi,
    /разстояние\s*[=:]\s*([\d\s.,]+)/gi,
    /([\d\s.,]+)\s*(?:m|м)\b/gi
  ];
  for (const p of sPatterns) {
    const m = p.exec(normalized);
    if (m && m[1]) {
      const val = parseNumber(m[1]);
      if (val !== null && val > 0 && val < 100000) { result.s = val; break; }
    }
  }

  return result;
}

async function extractTaskInputFromImage(buffer) {
  const { data: { text } } = await Tesseract.recognize(buffer, 'bul+eng', {
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
