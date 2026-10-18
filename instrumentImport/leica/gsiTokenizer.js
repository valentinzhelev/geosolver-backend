/**
 * Leica GSI word tokenizer (pure). A GSI line is a sequence of fixed-width WORDS:
 *
 *   positions 1-6   word information (word index + info)        GSI-8: 16 characters per word
 *   position  7     sign "+" / "-"                              GSI-16: 24 characters per word,
 *   then            data: 8 (GSI-8) or 16 (GSI-16) characters            and every line starts with "*"
 *   then            one separating blank (may be missing after the last word)
 *
 * Words are cut by WIDTH, never by splitting on spaces, so a value is never shifted into its neighbour. A line that does not fit the
 * grid exactly is not "repaired": the tokenizer returns null and the parser reports it as an INVALID_RECORD.
 */
const WIDTH = { 'GSI-8': 16, 'GSI-16': 24 };
const WORD = {
  'GSI-8': /^([0-9]{2})([0-9.]{4})([+-])([!-~]{8})$/,
  'GSI-16': /^([0-9]{2})([0-9.]{4})([+-])([!-~]{16})$/,
};

/**
 * @param {string} text one line of the file (line ending already removed)
 * @param {'GSI-8'|'GSI-16'} format
 * @param {{requireMarker?: boolean}} [opts] GSI-16 lines carry a leading "*"; `requireMarker:false` is only used by detection to
 *   recognise 16-character words that LACK the marker (which makes a file ambiguous, never silently GSI-16)
 * @returns {{raw:string, col:number, wi2:string, info:string, sign:string, data:string}[]|null}
 */
function tokenizeLine(text, format, { requireMarker = true } = {}) {
  let s = String(text);
  let offset = 0;
  if (format === 'GSI-16') {
    if (s[0] === '*') { s = s.slice(1); offset = 1; } else if (requireMarker) return null;
  } else if (s[0] === '*') {
    return null;
  }
  s = s.replace(/\s+$/, '');
  if (!s) return null;
  const width = WIDTH[format];
  const words = [];
  for (let pos = 0; pos < s.length; pos += width) {
    const chunk = s.slice(pos, pos + width - 1);
    if (chunk.length !== width - 1) return null;
    const sep = s[pos + width - 1];
    if (sep !== undefined && sep !== ' ') return null;
    const m = WORD[format].exec(chunk);
    if (!m) return null;
    words.push({ raw: chunk, col: pos + offset + 1, wi2: m[1], info: m[2], sign: m[3], data: m[4] });
  }
  return words;
}

module.exports = { tokenizeLine, WIDTH };
