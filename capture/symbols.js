/**
 * Symbol (character)-level confidence analysis for a reconstructed cell (pure, no I/O).
 *
 * A word's overall confidence can hide a single bad character: "4700030.50" read at 0.9 word confidence may still
 * have one digit read at 0.3 symbol confidence. Treating the whole number as trustworthy because of the word-level
 * score would be exactly the "misleadingly strong confidence" the product rule forbids. This module surfaces the
 * worst symbol(s) so the arbitration layer (arbitration.js) can downgrade trust even when the aggregate looks fine.
 */

const DEFAULT_THRESHOLD = 0.75;

/**
 * @param {{text:string, confidence:number|null, symbols?: {text:string, confidence:number|null}[]}[]} words the
 *   words that make up ONE cell (in reading order, as stored on the cell)
 * @param {number} threshold a symbol below this confidence is "suspicious"
 * @returns {{min: number|null, suspicious: {word:number, index:number, text:string, confidence:number}[]}}
 */
function analyzeCellSymbols(words, threshold = DEFAULT_THRESHOLD) {
  let min = null;
  const suspicious = [];
  (words || []).forEach((word, wordIndex) => {
    const symbols = word && Array.isArray(word.symbols) ? word.symbols : null;
    if (!symbols || !symbols.length) return;
    symbols.forEach((sym, symbolIndex) => {
      if (typeof sym.confidence !== 'number') return;
      if (min === null || sym.confidence < min) min = sym.confidence;
      if (sym.confidence < threshold) suspicious.push({ word: wordIndex, index: symbolIndex, text: sym.text, confidence: sym.confidence });
    });
  });
  return { min, suspicious };
}

/** True when the cell has at least one symbol read below the confidence threshold. */
const hasSuspiciousSymbol = (symbolConfidence) => Boolean(symbolConfidence && symbolConfidence.suspicious && symbolConfidence.suspicious.length > 0);

module.exports = { analyzeCellSymbols, hasSuspiciousSymbol, DEFAULT_SYMBOL_CONFIDENCE_THRESHOLD: DEFAULT_THRESHOLD };
