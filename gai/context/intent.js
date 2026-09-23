/**
 * Deterministic, rule-based intent detection (V1 section 3/15): a fixed set of Bulgarian keyword rules decides
 * which tools to call - never an LLM guessing what data it needs. This is intentionally simple for V1 (no NLU
 * model), which is exactly what keeps it testable without a live provider (section 21/22).
 */
const KEYWORDS = {
  summary: ['обобщи', 'обобщение', 'колко точки', 'какво се промени', 'последна активност', 'обзор'],
  review: ['чакат преглед', 'чакат проверка', 'за преглед', 'за проверка', 'непроверени', 'проблем'],
  reports: ['отчет', 'документ'],
  calculations: ['изчислени'],
  traverse: ['полигонов', 'traverse', 'bowditch', 'невръзк', 'closure', 'затваряне'],
  polar: ['полярн', 'polar'],
  open: ['отворен', 'open'],
  fieldData: ['теренни данни', 'карнет', 'заснем', 'notebook'],
  createdPoints: ['създадени', 'генерирани'],
};

function containsAny(text, words) {
  return words.some((w) => text.includes(w));
}

/** Extracts candidate point-name tokens (numeric-led, matching real GeoSolver point naming: "201", "101A"). */
function extractPointNameCandidates(question) {
  const matches = question.match(/\d{1,6}[A-Za-zА-я]{0,3}\b/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

/**
 * @param {string} question
 * @returns {{
 *   wantsSummary: boolean, wantsReview: boolean, wantsReports: boolean, wantsCalculations: boolean,
 *   wantsTraverse: boolean, wantsPolar: boolean, wantsOpenOnly: boolean, wantsFieldData: boolean,
 *   wantsCreatedPoints: boolean, pointNameCandidates: string[],
 * }}
 */
function detectIntent(question) {
  const text = String(question || '').toLowerCase();
  return {
    wantsSummary: containsAny(text, KEYWORDS.summary),
    wantsReview: containsAny(text, KEYWORDS.review),
    wantsReports: containsAny(text, KEYWORDS.reports),
    wantsCalculations: containsAny(text, KEYWORDS.calculations),
    wantsTraverse: containsAny(text, KEYWORDS.traverse),
    wantsPolar: containsAny(text, KEYWORDS.polar),
    wantsOpenOnly: containsAny(text, KEYWORDS.open),
    wantsFieldData: containsAny(text, KEYWORDS.fieldData),
    wantsCreatedPoints: containsAny(text, KEYWORDS.createdPoints),
    pointNameCandidates: extractPointNameCandidates(text),
  };
}

module.exports = { detectIntent, extractPointNameCandidates };
