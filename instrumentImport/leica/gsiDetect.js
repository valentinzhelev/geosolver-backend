/**
 * Deterministic Leica GSI format detection (pure). Returns { vendor: 'leica', format: 'GSI-8' | 'GSI-16' } or throws:
 *   - every non-empty line starts with "*"  -> candidate GSI-16; no line does -> candidate GSI-8; SOME do -> AMBIGUOUS_GSI_FORMAT
 *     (a file mixing both families is never read as either);
 *   - at least 90% of the lines must tokenize EXACTLY on the candidate's word grid, and at least one line must carry a word index
 *     GeoSolver recognises - otherwise the file is not confidently GSI: UNSUPPORTED_FORMAT ("Форматът не е разпознат.");
 *   - lines that DO tokenize as 16-digit words but have no "*" marker are GSI-16 data without the marker: AMBIGUOUS_GSI_FORMAT,
 *     never silently guessed.
 * The few lines that do not fit (<10%) are kept and reported per record by the parser - detection never drops them.
 */
const { tokenizeLine } = require('./gsiTokenizer');
const { WORDS } = require('./gsiWords');
const { InstrumentImportError } = require('../errors');

const MIN_FIT = 0.9;

function detectGsi(lines) {
  if (!lines.length) throw new InstrumentImportError('EMPTY_FILE');
  const starred = lines.filter((l) => l.text[0] === '*').length;
  if (starred && starred !== lines.length) throw new InstrumentImportError('AMBIGUOUS_GSI_FORMAT');
  const format = starred ? 'GSI-16' : 'GSI-8';

  const parsed = lines.map((l) => tokenizeLine(l.text, format));
  const fit = parsed.filter(Boolean).length / lines.length;
  if (fit < MIN_FIT) {
    // 16-digit words without the "*" marker: recognisably GSI-16 data, but not a file we can identify with certainty
    if (format === 'GSI-8') {
      const asSixteen = lines.filter((l) => tokenizeLine(l.text, 'GSI-16', { requireMarker: false })).length / lines.length;
      if (asSixteen >= MIN_FIT) throw new InstrumentImportError('AMBIGUOUS_GSI_FORMAT', { variant: 'UNMARKED_GSI16' });
    }
    throw new InstrumentImportError('UNSUPPORTED_FORMAT');
  }
  const recognised = parsed.some((ws) => ws && ws.some((w) => WORDS[Number(w.wi2)]));
  if (!recognised) throw new InstrumentImportError('UNSUPPORTED_FORMAT');
  return { vendor: 'leica', format, fit };
}

module.exports = { detectGsi, MIN_FIT };
