/**
 * Column header interpretation for coordinate tables (Bulgarian + English/common geodetic headers). Pure.
 *
 * Official GeoSolver convention: X = Northing, Y = Easting. Headers are mapped by their TEXT, never by position.
 * An ambiguous header (matches several meanings) is never mapped silently.
 */

const SEMANTIC_TYPES = ['point', 'code', 'x', 'y', 'h', 'notes'];

// Cyrillic letters that look like Latin ones are folded so "Х"/"У"/"Н" typed in Cyrillic still read as X/Y/H.
const LOOKALIKES = { х: 'x', у: 'y', н: 'h', а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', к: 'k', м: 'm', т: 't', в: 'b' };

const SYNONYMS = {
  point: ['точка', 'точки', 'т', '№', 'no', 'nr', 'n°', 'номер', 'номерът', 'point', 'points', 'pt', 'pointid', 'pointname', 'pnt', 'name', 'име', 'id'],
  code: ['код', 'кодове', 'code', 'codes', 'кодоване', 'кодточ'],
  x: ['x', 'север', 'northing', 'north', 'х'],
  y: ['y', 'изток', 'easting', 'east', 'у'],
  h: ['h', 'z', 'elev', 'elevation', 'height', 'кота', 'височина', 'alt', 'altitude', 'н'],
  notes: ['бележка', 'бележки', 'забележка', 'забележки', 'note', 'notes', 'description', 'desc', 'описание', 'коментар', 'comment', 'comments', 'remark', 'remarks'],
};

function normalizeHeader(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[([{].*?[)\]}]/g, ' '); // "(m)", "[м]" unit annotations
  s = s.replace(/[.,;:_/\\|-]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // trailing unit words: "x m", "y м"
  s = s.replace(/\s+(m|м|meters|metres|метри)$/u, '');
  return s.trim();
}

function fold(s) {
  return s.replace(/[а-яё]/gu, (ch) => LOOKALIKES[ch] || ch);
}

/**
 * @returns {{semantic: string|null, ambiguous: boolean, matches: string[]}}
 */
function mapHeader(text) {
  const norm = normalizeHeader(text);
  if (!norm) return { semantic: null, ambiguous: false, matches: [] };
  const compact = norm.replace(/\s+/g, '');
  const folded = fold(compact);
  const matches = [];
  for (const [semantic, words] of Object.entries(SYNONYMS)) {
    const hit = words.some((w) => w === compact || w === norm || fold(w) === folded);
    if (hit) matches.push(semantic);
  }
  // "н"/"h" style single letters that fold onto the same Latin letter can double-match; collapse duplicates
  const unique = [...new Set(matches)];
  if (unique.length === 1) return { semantic: unique[0], ambiguous: false, matches: unique };
  if (unique.length > 1) return { semantic: null, ambiguous: true, matches: unique };
  return { semantic: null, ambiguous: false, matches: [] };
}

/** Header-like tokens of a text line: used to recognise WHICH line of a table is the header. */
function headerHits(words) {
  let hits = 0;
  const found = new Set();
  for (const w of words) {
    const m = mapHeader(w);
    if (m.semantic) {
      hits += 1;
      found.add(m.semantic);
    }
  }
  return { hits, semantics: [...found] };
}

module.exports = { SEMANTIC_TYPES, SYNONYMS, normalizeHeader, mapHeader, headerHits };
