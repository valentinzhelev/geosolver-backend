/**
 * Locale-aware numeric parsing for Capture V2.1 (pure, no I/O).
 *
 * Replaces the unsafe legacy parseNumber (which turned "4.700.000,25" into 4.7). Rules:
 *  - rawText is never mutated; this returns a separate interpretation;
 *  - only digits, an optional leading sign, "." "," and group spaces / apostrophes are accepted;
 *    letters are NOT silently repaired (no O->0, l->1): they make the cell invalid;
 *  - an unambiguous format is parsed; an ambiguous one is reported as 'ambiguous' (never guessed) unless the
 *    COLUMN's own unambiguous cells settle it (column style), because formatting is a property of a column;
 *  - a space is only ever a digit-group separator (groups of exactly 3): "5 25" is NOT 5.25.
 *
 * Result: { status: 'ok'|'ambiguous'|'invalid'|'empty', value, format, reason }
 *   format = { decimalSep: '.'|','|null, groupSep: '.'|','|' '|"'"|null, decimals: number, definite: boolean }
 *   `definite` = the separators were decided by the cell itself (not by column context).
 */

const MINUS = /[−‒–—]/g; // unicode minus / dashes -> '-'
const SPACES = /[    ]/g; // no-break / thin / figure spaces -> ' '
const ALLOWED = /^[+-]?[0-9][0-9 .,']*$|^[+-]?[.,][0-9]+$/;

const result = (status, extra = {}) => ({ status, value: null, format: null, reason: null, ...extra });
const isGroupOf3 = (s) => /^\d{3}$/.test(s);

/**
 * @param {string} raw
 * @param {{decimalSep: '.'|','}|null} columnStyle  decimal separator settled by the column's definite cells
 */
function parseNumericCell(raw, columnStyle = null) {
  if (raw === null || raw === undefined) return result('empty', { reason: 'EMPTY' });
  let text = String(raw).replace(SPACES, ' ').replace(MINUS, '-').trim();
  if (text === '') return result('empty', { reason: 'EMPTY' });
  if (!ALLOWED.test(text)) return result('invalid', { reason: 'NON_NUMERIC_CHARACTERS' });

  let sign = 1;
  if (text[0] === '+' || text[0] === '-') {
    sign = text[0] === '-' ? -1 : 1;
    text = text.slice(1).trim();
  }
  if (text === '') return result('invalid', { reason: 'NON_NUMERIC_CHARACTERS' });

  // Space / apostrophe are group separators only: every group after the first must have exactly 3 digits
  const hasBlankGroup = /[ ']/.test(text);
  if (hasBlankGroup) {
    const blankSep = text.includes("'") ? "'" : ' ';
    if (text.includes(' ') && text.includes("'")) return result('invalid', { reason: 'MIXED_GROUP_SEPARATORS' });
    // split the integer part on the blank separator; a decimal separator can only appear in the LAST chunk
    const chunks = text.split(blankSep);
    const first = chunks[0];
    const rest = chunks.slice(1);
    if (chunks.some((c) => c === '')) return result('invalid', { reason: 'MALFORMED_GROUPING' });
    if (!/^\d{1,3}$/.test(first)) return result('invalid', { reason: 'MALFORMED_GROUPING' });
    const last = rest[rest.length - 1];
    const lastMatch = last.match(/^(\d{3})(?:([.,])(\d+))?$/);
    const middleOk = rest.slice(0, -1).every(isGroupOf3);
    if (!lastMatch || !middleOk) return result('invalid', { reason: 'AMBIGUOUS_SPACE_SEPARATOR' });
    // digits with a group separator: an optional fraction after the last group must use a single '.' or ','
    if (/[.,]/.test(first) || rest.slice(0, -1).some((c) => /[.,]/.test(c))) {
      return result('invalid', { reason: 'MALFORMED_GROUPING' });
    }
    const intDigits = first + rest.map((c, i) => (i === rest.length - 1 ? lastMatch[1] : c)).join('');
    const decSep = lastMatch[2] || null;
    const frac = lastMatch[3] || '';
    return finish(sign, intDigits, frac, { decimalSep: decSep, groupSep: blankSep, decimals: frac.length, definite: true });
  }

  const dots = (text.match(/\./g) || []).length;
  const commas = (text.match(/,/g) || []).length;

  if (dots === 0 && commas === 0) {
    return finish(sign, text, '', { decimalSep: null, groupSep: null, decimals: 0, definite: true });
  }

  // both kinds present: the LAST separator is the decimal one and must occur once; the other groups thousands
  if (dots > 0 && commas > 0) {
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    const decSep = lastDot > lastComma ? '.' : ',';
    const groupSep = decSep === '.' ? ',' : '.';
    const decCount = decSep === '.' ? dots : commas;
    if (decCount !== 1) return result('invalid', { reason: 'MALFORMED_SEPARATORS' });
    const [intPart, frac] = text.split(decSep);
    const groups = intPart.split(groupSep);
    if (!/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every(isGroupOf3)) return result('invalid', { reason: 'MALFORMED_GROUPING' });
    if (!/^\d+$/.test(frac)) return result('invalid', { reason: 'MALFORMED_SEPARATORS' });
    return finish(sign, groups.join(''), frac, { decimalSep: decSep, groupSep, decimals: frac.length, definite: true });
  }

  // one kind of separator only
  const sep = dots > 0 ? '.' : ',';
  const count = dots > 0 ? dots : commas;
  const parts = text.split(sep);

  if (count > 1) {
    // repeated separator can only be a thousands separator: 4.700.000 / 4,700,000
    if (!/^\d{1,3}$/.test(parts[0]) || !parts.slice(1).every(isGroupOf3)) return result('invalid', { reason: 'MALFORMED_GROUPING' });
    return finish(sign, parts.join(''), '', { decimalSep: null, groupSep: sep, decimals: 0, definite: true });
  }

  const [intPart, frac] = parts;
  if (frac === '') return result('invalid', { reason: 'DANGLING_SEPARATOR' });
  if (!/^\d*$/.test(intPart) || !/^\d+$/.test(frac)) return result('invalid', { reason: 'MALFORMED_SEPARATORS' });

  // "4700000.25", "12,5": not exactly 3 fraction digits -> can only be a decimal separator
  if (frac.length !== 3) {
    return finish(sign, intPart === '' ? '0' : intPart, frac, { decimalSep: sep, groupSep: null, decimals: frac.length, definite: true });
  }
  // exactly 3 digits after a lone separator: "4700000.250" cannot be grouping (first group has > 3 digits) -> decimal
  if (intPart.length > 3) {
    return finish(sign, intPart, frac, { decimalSep: sep, groupSep: null, decimals: 3, definite: true });
  }
  // an integer part that starts with 0 ("0,125") cannot be a first thousands group
  if (intPart === '' || intPart[0] === '0') {
    return finish(sign, intPart === '' ? '0' : intPart, frac, { decimalSep: sep, groupSep: null, decimals: 3, definite: true });
  }
  // "4.700" / "500,123": genuinely ambiguous (4.7 or 4700). Only the column's own definite cells may decide.
  if (columnStyle && columnStyle.decimalSep) {
    if (columnStyle.decimalSep === sep) {
      return finish(sign, intPart, frac, { decimalSep: sep, groupSep: null, decimals: 3, definite: false });
    }
    return finish(sign, intPart + frac, '', { decimalSep: null, groupSep: sep, decimals: 0, definite: false });
  }
  return result('ambiguous', { reason: 'AMBIGUOUS_SEPARATOR', candidates: [Number(`${sign < 0 ? '-' : ''}${intPart}.${frac}`), Number(`${sign < 0 ? '-' : ''}${intPart}${frac}`)] });
}

function finish(sign, intDigits, frac, format) {
  const text = frac ? `${intDigits}.${frac}` : intDigits;
  const value = sign * Number(text);
  if (!Number.isFinite(value)) return result('invalid', { reason: 'NOT_FINITE' });
  return { status: 'ok', value, format, reason: null };
}

/**
 * Infers a column's decimal-separator style from the DEFINITE cells of that column (a cell whose format is decided by
 * itself). Returns { decimalSep, mixed } - `decimalSep` is set only when all definite cells agree; `mixed` is true when
 * both '.' and ',' are used as decimal separators in the same column (a formatting inconsistency).
 */
function inferColumnStyle(parsedCells) {
  const seps = new Set();
  for (const p of parsedCells) {
    if (p && p.status === 'ok' && p.format && p.format.definite && p.format.decimalSep) seps.add(p.format.decimalSep);
  }
  if (seps.size === 1) return { decimalSep: [...seps][0], mixed: false };
  return { decimalSep: null, mixed: seps.size > 1 };
}

/**
 * Parses a whole column consistently: infer the style from the column's own definite cells, then resolve ambiguous cells
 * with it. A column with no definite cell of its own may fall back to `fallbackStyle` (the decimal separator shared by
 * the other numeric columns of the same document); a resolved cell is marked `format.definite === false`.
 */
function parseColumn(rawValues, fallbackStyle = null) {
  const first = rawValues.map((v) => parseNumericCell(v));
  const own = inferColumnStyle(first);
  const style = own.decimalSep ? own : fallbackStyle && fallbackStyle.decimalSep && !own.mixed ? { decimalSep: fallbackStyle.decimalSep, mixed: false, fromTable: true } : own;
  const parsed = first.map((p, i) => (p.status === 'ambiguous' && style.decimalSep ? parseNumericCell(rawValues[i], style) : p));
  return { parsed, style, own };
}

module.exports = { parseNumericCell, inferColumnStyle, parseColumn };
