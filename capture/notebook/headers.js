/**
 * Label/header interpretation for Field Notebook layout (Bulgarian + English/common geodetic labels). Pure.
 *
 * Mirrors capture/headers.js's approach (text-based matching, Cyrillic look-alike folding, never a silent guess
 * for an ambiguous label) but for the field-notebook vocabulary: station, orientation and observation fields
 * instead of coordinate-table columns.
 */
const { normalizeHeader, fold } = require('../headers');

const FIELD_TYPES = ['station', 'instrumentHeight', 'orientation', 'target', 'hz', 'vz', 'distance', 'horizontalDistance', 'prismHeight', 'code', 'notes'];

const SYNONYMS = {
  station: ['станция', 'ст', 'ст.', 'station', 'st', 'stn'],
  instrumentHeight: ['i', 'hi', 'височина на инструмента', 'височина инстр', 'inst height', 'instrument height', 'ih'],
  orientation: ['ориентация', 'ориентир', 'backsight', 'bs'],
  target: ['точка', '№', 'no', 'nr', 'point', 'target', 'pt', 'цел'],
  hz: ['hz', 'хор ъгъл', 'хоризонтален ъгъл', 'horizontal angle'],
  vz: ['v', 'z', 'zenith', 'вертикален ъгъл', 'зенитно разстояние', 'vertical angle'],
  distance: ['s', 'sd', 'distance', 'разстояние', 'наклонено разстояние', 'slope distance'],
  horizontalDistance: ['hd', 'хоризонтално разстояние', 'horizontal distance'],
  prismHeight: ['p', 'ht', 'prism', 'височина на призмата', 'prism height', 'target height'],
  code: ['код', 'code'],
  notes: ['бележка', 'бележки', 'забележка', 'note', 'notes', 'description', 'описание'],
};

/** @returns {{field: string|null, ambiguous: boolean, matches: string[]}} */
function mapLabel(text) {
  const norm = normalizeHeader(text);
  if (!norm) return { field: null, ambiguous: false, matches: [] };
  const compact = norm.replace(/\s+/g, '');
  const folded = fold(compact);
  const matches = [];
  for (const [field, words] of Object.entries(SYNONYMS)) {
    const hit = words.some((w) => w === compact || w === norm || fold(w) === folded);
    if (hit) matches.push(field);
  }
  const unique = [...new Set(matches)];
  if (unique.length === 1) return { field: unique[0], ambiguous: false, matches: unique };
  if (unique.length > 1) return { field: null, ambiguous: true, matches: unique };
  return { field: null, ambiguous: false, matches: [] };
}

/** Header-like tokens of a text line, and which field families it names (used to recognise a table/label line). */
function labelHits(words) {
  let hits = 0;
  const found = new Set();
  for (const w of words) {
    const m = mapLabel(w);
    if (m.field) {
      hits += 1;
      found.add(m.field);
    }
  }
  return { hits, fields: [...found] };
}

/**
 * An explicit angle unit hint written INSIDE a header/label, e.g. "Hz (gon)", "V [°]", "Hz, gon". Never guessed:
 * only an explicit gon/degree marker in the text counts.
 * @returns {'gon'|'deg'|null}
 */
function angleUnitHint(text) {
  const s = String(text || '').toLowerCase();
  if (/\bgon\b|\bgrad\b|\bg\.?\)|\(g\)|,\s*g\b/.test(s)) return 'gon';
  if (/[°º]|\bdeg\b|\bdegrees?\b/.test(s)) return 'deg';
  return null;
}

module.exports = { FIELD_TYPES, SYNONYMS, mapLabel, labelHits, angleUnitHint };
