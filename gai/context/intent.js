/**
 * Deterministic, rule-based intent detection (V1 section 3/15): a fixed set of Bulgarian keyword rules decides
 * which tools to call - never an LLM guessing what data it needs. Intentionally simple (no NLU model), which is
 * exactly what keeps it testable without a live provider.
 *
 * V1.0.2: tighter routing (a count question no longer pulls issue extraction; "генерирани отчети" no longer pulls
 * processing runs), cleaner point-name extraction (EPSG codes, dates, decimals and counts are not point names),
 * and a small deterministic follow-up rule: a referential question ("…от него?") inherits the previous question's
 * topic so the right evidence is fetched. Facts still always come from fresh tool calls, never from old answers.
 */
const KEYWORDS = {
  overview: ['обобщи', 'обобщение', 'обзор', 'какво се промени', 'последна активност', 'последни промени', 'състояние на проекта'],
  review: ['чакат преглед', 'чакат проверка', 'за преглед', 'за проверка', 'непроверени', 'проблем', 'грешк', 'нередност'],
  reports: ['отчет', 'документ'],
  calculations: ['изчислени'],
  traverse: ['полигонов', 'traverse', 'bowditch', 'боудич', 'невръзк', 'closure', 'затваряне', 'изравнен'],
  polar: ['полярн', 'polar'],
  processing: ['обработк'],
  open: ['отворен'],
  fieldData: ['теренни данни', 'карнет', 'заснем', 'notebook'],
};
const CREATED = ['създаден', 'генериран'];
const REFERENTIAL = ['той', 'тя', 'то', 'те', 'него', 'нея', 'тях', 'този', 'тази', 'това', 'тези', 'същия', 'същата', 'същото', 'горния', 'горната', 'предишния', 'предишната', 'там'];
/** Whole-word match (Cyrillic-aware): "тя" must not match inside "тяло". */
const REFERENTIAL_RE = new RegExp(`(^|[^\\p{L}])(${REFERENTIAL.join('|')})(?=$|[^\\p{L}])`, 'u');

function containsAny(text, words) {
  return words.some((w) => text.includes(w));
}

/**
 * Candidate point-name tokens (numeric-led, matching real GeoSolver point naming: "201", "101A", "101А"). Removes
 * things that look numeric but are not point names before matching: EPSG codes, dates, decimals/measurements, and
 * a number directly followed by a counted noun/unit ("31 точки", "5 m").
 */
function extractPointNameCandidates(question) {
  const text = String(question || '')
    .replace(/epsg\s*[:\s]\s*\d+/gi, ' ')
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\d+[.,]\d+/g, ' ');
  const out = [];
  const re = /(?<![\p{L}\d])(\d{1,6}\p{L}{0,3})(?![\p{L}\d])(\s*(?:точк|обработк|отчет|документ|заснем|карнет|ход|станц|m\b|м\b|mm\b|мм\b|см\b|cm\b|gon\b|°))?/giu;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) continue; // "31 точки" is a count, "5 m" a measurement
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out.slice(0, 6);
}

/**
 * @param {string} question
 * @param {{previousQuestion?: string}} [opts]
 */
function detectIntent(question, opts = {}) {
  const text = String(question || '').toLowerCase();
  const intent = {
    wantsOverview: containsAny(text, KEYWORDS.overview),
    wantsReview: containsAny(text, KEYWORDS.review),
    wantsReports: containsAny(text, KEYWORDS.reports),
    wantsCalculations: containsAny(text, KEYWORDS.calculations),
    wantsTraverse: containsAny(text, KEYWORDS.traverse),
    wantsPolar: containsAny(text, KEYWORDS.polar),
    wantsProcessing: containsAny(text, KEYWORDS.processing),
    wantsOpenOnly: containsAny(text, KEYWORDS.open) || /\bopen\b/.test(text),
    wantsFieldData: containsAny(text, KEYWORDS.fieldData),
    wantsCreatedPoints: containsAny(text, CREATED) && text.includes('точк'),
    pointNameCandidates: extractPointNameCandidates(question),
    followUp: false,
  };
  // backwards-compatible alias: older callers/tests read `wantsSummary`
  intent.wantsSummary = intent.wantsOverview;

  if (opts.previousQuestion && REFERENTIAL_RE.test(text)) {
    const prev = detectIntent(opts.previousQuestion);
    const hasOwnTopic = intent.wantsTraverse || intent.wantsPolar || intent.wantsReports || intent.wantsReview
      || intent.wantsFieldData || intent.wantsCalculations || intent.pointNameCandidates.length > 0;
    if (!hasOwnTopic) {
      for (const k of ['wantsTraverse', 'wantsPolar', 'wantsOpenOnly', 'wantsProcessing', 'wantsReports', 'wantsReview', 'wantsFieldData', 'wantsCalculations']) {
        if (prev[k]) intent[k] = true;
      }
      if (!intent.pointNameCandidates.length) intent.pointNameCandidates = prev.pointNameCandidates;
      intent.followUp = true;
    }
  }
  return intent;
}

module.exports = { detectIntent, extractPointNameCandidates };
