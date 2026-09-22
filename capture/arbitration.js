/**
 * Deterministic candidate arbitration (pure, no I/O, no randomness).
 *
 * Decides how much a cell's recognized value should be trusted, from the pool of candidates gathered for it
 * (the primary whole-page reading, plus any bounded re-recognition passes from capture/rerecognition.js). This is
 * the layer the product rule is about: "A wrong value must NEVER be silently presented as trustworthy merely
 * because one OCR provider had high confidence." Confidence alone NEVER decides ACCEPTED here - only agreement
 * between INDEPENDENT recognition passes (consensus), a clean numeric/identifier parse, and the absence of a
 * suspicious low-confidence symbol can.
 *
 * Outcomes: ACCEPTED | REVIEW_SUGGESTED | UNCERTAIN | INVALID (see the rules inline below - deliberately explicit
 * rather than scored/weighted, so the decision is auditable). This module NEVER changes rawText or normalizedValue;
 * it only classifies trust and lists alternative readings for the human reviewer.
 */
const { parseNumericCell } = require('./numeric');
const { generateLetterDigitAlternatives, compareDigitStrings } = require('./confusion');
const { hasSuspiciousSymbol } = require('./symbols');

const ARBITRATION_VERSION = 'capture-arb-1.0.0';

const NUMERIC_SEMANTICS = new Set(['x', 'y', 'h']);
const TRACKED_SEMANTICS = new Set(['point', 'code', 'x', 'y', 'h']);

const DEFAULT_THRESHOLDS = {
  minConsensus: 2, // independent passes required to call a value "confirmed by consensus"
  symbolConfidenceThreshold: 0.75,
  acceptConfidenceThreshold: 0.85,
  uncertainConfidenceFloor: 0.5,
};

/** A candidate's comparable value: a rounded number for x/y/h, trimmed lowercase text for point/code. */
function normalizeCandidateValue(candidate, semantic, numericStyle) {
  const text = String((candidate && candidate.text) || '');
  if (!NUMERIC_SEMANTICS.has(semantic)) {
    const t = text.trim();
    return { key: t === '' ? null : t.toLowerCase(), status: t === '' ? 'empty' : 'ok', display: t };
  }
  const p = parseNumericCell(text, numericStyle);
  if (p.status !== 'ok') return { key: null, status: p.status, display: text };
  return { key: Math.round(p.value * 1e6) / 1e6, status: 'ok', display: p.value };
}

/** Other groups than the primary's own, most-supported first, summarized for the review UI. */
function alternativesFrom(scoredGroups, primaryKey) {
  return scoredGroups
    .filter((g) => g.key !== primaryKey)
    .map((g) => {
      const best = [...g.items].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))[0];
      return { text: best.text, normalizedValue: g.key, passCount: g.passCount, confidence: best.confidence ?? null, source: best.source };
    });
}

/**
 * @param {object} cell a reconstructed/re-recognized cell (has `candidates`, `symbolConfidence`)
 * @param {{semantic: string, numericStyle?: {decimalSep:string}|null, minConsensus?: number, symbolConfidenceThreshold?: number, acceptConfidenceThreshold?: number, uncertainConfidenceFloor?: number}} options
 * @returns {{outcome:'ACCEPTED'|'REVIEW_SUGGESTED'|'UNCERTAIN'|'INVALID', reason:string, version:string, alternatives:object[], evidence:object}|null}
 *   null when the semantic is not tracked, or the cell has no candidates (nothing to arbitrate: e.g. a truly empty cell)
 */
function arbitrateCell(cell, options = {}) {
  const semantic = options.semantic;
  // `tracked`/`parseValue` let a caller outside the coordinate-table semantics (e.g. capture/notebook/validation.js,
  // for angle/measurement fields) reuse this exact decision logic with its own value-comparison function, without
  // touching the coordinate-table default behaviour at all when they are not passed.
  const tracked = options.tracked !== undefined ? options.tracked : TRACKED_SEMANTICS.has(semantic);
  if (!tracked) return null;
  const candidates = Array.isArray(cell.candidates) ? cell.candidates : [];
  if (!candidates.length) return null;
  const cfg = { ...DEFAULT_THRESHOLDS, ...options };
  const numericStyle = NUMERIC_SEMANTICS.has(semantic) ? options.numericStyle || null : null;
  const parseValue = options.parseValue || normalizeCandidateValue;
  const numericLike = options.numericLike !== undefined ? options.numericLike : NUMERIC_SEMANTICS.has(semantic);

  const enriched = candidates.map((c) => ({ ...c, _norm: parseValue(c, semantic, numericStyle), _suspicious: hasSuspiciousSymbol(c.symbolConfidence) }));
  const primary = enriched.find((c) => c.recognitionPass === 0 && c.source === 'primary') || enriched[0];
  const real = enriched.filter((c) => c.source !== 'generated-alternative');

  const groups = new Map();
  for (const c of real) {
    if (c._norm.status !== 'ok') continue;
    const g = groups.get(c._norm.key) || { key: c._norm.key, items: [] };
    g.items.push(c);
    groups.set(c._norm.key, g);
  }
  const scored = [...groups.values()]
    .map((g) => ({ ...g, passCount: new Set(g.items.map((i) => i.recognitionPass)).size, hasSuspicious: g.items.some((i) => i._suspicious) }))
    .sort((a, b) => b.passCount - a.passCount || Math.max(...b.items.map((i) => i.confidence ?? -1)) - Math.max(...a.items.map((i) => i.confidence ?? -1)));

  // the primary text itself does not parse (e.g. a letter among the digits): look for a bounded, EXPLICIT
  // letter->digit alternative before giving up. A generated alternative can only reach REVIEW_SUGGESTED, never
  // ACCEPTED: it is an inferred possibility, not a corrected value.
  if (primary._norm.status !== 'ok') {
    const generated = generateLetterDigitAlternatives(primary.text)
      .map((text) => ({ text, source: 'generated-alternative', _norm: parseValue({ text }, semantic, numericStyle) }))
      .filter((g) => g._norm.status === 'ok');
    if (generated.length) {
      const digitDiff = numericLike ? compareDigitStrings(String(primary.text).replace(/[^0-9]/g, ''), String(generated[0].text).replace(/[^0-9]/g, '')) : null;
      return {
        outcome: 'REVIEW_SUGGESTED',
        reason: 'GENERATED_ALTERNATIVE_FROM_LOOKALIKE',
        version: ARBITRATION_VERSION,
        alternatives: [
          ...generated.map((g) => ({ text: g.text, normalizedValue: g._norm.key, passCount: 0, confidence: null, source: 'generated-alternative' })),
          ...alternativesFrom(scored, null),
        ],
        evidence: { digitDiff },
      };
    }
    return { outcome: 'INVALID', reason: 'PRIMARY_UNPARSEABLE', version: ARBITRATION_VERSION, alternatives: alternativesFrom(scored, null), evidence: {} };
  }

  const primaryGroup = scored.find((g) => g.key === primary._norm.key) || { key: primary._norm.key, items: [primary], passCount: 1, hasSuspicious: primary._suspicious };
  const bestOther = scored.find((g) => g.key !== primary._norm.key);

  // only the primary reading exists (re-recognition never ran, or produced nothing usable): confidence alone may
  // accept it, but ONLY above the accept threshold and with no suspicious symbol - this preserves the V2.1
  // behaviour for the common case of one clean, high-confidence reading.
  if (candidates.length === 1) {
    if (typeof primary.confidence === 'number' && primary.confidence >= cfg.acceptConfidenceThreshold && !primary._suspicious) {
      return { outcome: 'ACCEPTED', reason: 'SINGLE_HIGH_CONFIDENCE', version: ARBITRATION_VERSION, alternatives: [], evidence: {} };
    }
    if (typeof primary.confidence !== 'number' || primary.confidence < cfg.uncertainConfidenceFloor || primary._suspicious) {
      return { outcome: 'UNCERTAIN', reason: 'SINGLE_LOW_CONFIDENCE', version: ARBITRATION_VERSION, alternatives: [], evidence: {} };
    }
    return { outcome: 'REVIEW_SUGGESTED', reason: 'SINGLE_MODERATE_CONFIDENCE', version: ARBITRATION_VERSION, alternatives: [], evidence: {} };
  }

  // multiple independent readings exist: agreement (consensus) decides, never raw confidence alone.
  if (bestOther && bestOther.passCount >= cfg.minConsensus && bestOther.key !== primaryGroup.key) {
    // an independent consensus CONTRADICTS the primary reading - even if the primary had higher confidence, it is
    // never trusted silently. The alternative is surfaced for the human reviewer.
    return { outcome: 'REVIEW_SUGGESTED', reason: 'CONTRADICTED_BY_CONSENSUS', version: ARBITRATION_VERSION, alternatives: alternativesFrom(scored, primaryGroup.key), evidence: { contradictingPassCount: bestOther.passCount } };
  }
  if (primaryGroup.passCount >= cfg.minConsensus) {
    if (!primaryGroup.hasSuspicious) {
      return { outcome: 'ACCEPTED', reason: 'CONSENSUS_CONFIRMS_PRIMARY', version: ARBITRATION_VERSION, alternatives: [], evidence: { passCount: primaryGroup.passCount } };
    }
    return { outcome: 'REVIEW_SUGGESTED', reason: 'CONSENSUS_BUT_SUSPICIOUS_SYMBOL', version: ARBITRATION_VERSION, alternatives: alternativesFrom(scored, primaryGroup.key), evidence: {} };
  }
  if (bestOther) {
    return { outcome: 'REVIEW_SUGGESTED', reason: 'DISAGREEMENT_NO_CONSENSUS', version: ARBITRATION_VERSION, alternatives: alternativesFrom(scored, primaryGroup.key), evidence: {} };
  }
  return { outcome: 'UNCERTAIN', reason: 'INSUFFICIENT_EVIDENCE', version: ARBITRATION_VERSION, alternatives: [], evidence: {} };
}

module.exports = { arbitrateCell, normalizeCandidateValue, ARBITRATION_VERSION, TRACKED_SEMANTICS, NUMERIC_SEMANTICS, DEFAULT_THRESHOLDS };
