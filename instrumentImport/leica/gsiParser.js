/**
 * Leica GSI record parser (pure, deterministic): lines -> RECORDS of decoded WORDS, in file order. Nothing is dropped:
 *   - every line becomes a record (a line that does not fit the word grid is an `invalid` record with INVALID_RECORD);
 *   - every word keeps its raw text, word index, info positions (auto index, input mode, unit), sign and data;
 *   - a word whose index is not in the supported subset (gsiWords.js) is kept as an UNKNOWN word with a warning.
 *
 * Values are decoded from the digits as written (no floating-point division: the decimal point is placed by the unit code) and then
 * read through GeoSolver's EXISTING notebook parsers (capture/notebook/angles.js, measurements.js), so an imported angle or
 * distance is the very same typed value a manual or photographed notebook produces: { value, unit, ... }.
 *
 * Record kinds (explicit evidence only - no inference):
 *   station      has a station word (84 / 85 / 86 / 88) and NO measurement word (21 / 22 / 31 / 32)
 *   measurement  has a measurement word (21 / 22 / 31 / 32)
 *   point        has target coordinates (81 / 82 / 83) and no measurement word - a known/coordinate point, not an observation
 *   code         a code / information block (41-49) without a point number - kept, NOT attached to any point
 *   other        anything else (service data only)
 *   invalid      the line is not a GSI record
 */
const { tokenizeLine } = require('./gsiTokenizer');
const { WORDS, EXTENDED, UNITS, INPUT_MODES } = require('./gsiWords');
const { ISSUES } = require('../errors');
const { parseAngle, angleWithUnit } = require('../../capture/notebook/angles');
const { parseMeasurement } = require('../../capture/notebook/measurements');

const issue = (code, severity, extra = {}) => ({ code, severity, message: ISSUES[code], ...extra });

/** Places the decimal point `decimals` digits from the right of an all-digit string: "00156134",3 -> "156.134". */
function withDecimals(digits, decimals) {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (!decimals) return d;
  const padded = d.padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/** Text data is right-aligned and zero-padded by the instrument ("00000H66" -> "H66"); the raw data is always kept as well. */
const textValue = (data) => data.replace(/^0+(?=.)/, '');

function decodeAngle(word, unitDef) {
  if (!/^\d+$/.test(word.data)) return { issue: issue('MALFORMED_NUMBER', 'error', { word: word.code }) };
  const sign = word.sign === '-' ? '-' : '';
  const text = withDecimals(word.data, unitDef.decimals);
  let source;
  if (unitDef.unit === 'gon' || unitDef.unit === 'deg') {
    const p = angleWithUnit(`${sign}${text}`, unitDef.unit);
    if (p.status !== 'ok') return { issue: issue('MALFORMED_NUMBER', 'error', { word: word.code }) };
    return { value: { value: p.value, unit: p.unit, components: null }, display: `${sign}${text} ${unitDef.unit === 'gon' ? 'gon' : '°'}` };
  } else {
    // sexagesimal DDD.MMSSs: minutes = first two decimals, seconds = next two, tenths of a second = the last
    const [deg, frac] = text.split('.');
    source = `${sign}${Number(deg)}°${frac.slice(0, 2)}'${frac.slice(2, 4)}.${frac.slice(4)}"`;
  }
  const p = parseAngle(source);
  if (p.status !== 'ok') return { issue: issue('MALFORMED_NUMBER', 'error', { word: word.code }) };
  return { value: { value: p.value, unit: p.unit, components: p.components || null }, display: source };
}

function decodeLength(word, unitDef) {
  if (!/^\d+$/.test(word.data)) return { issue: issue('MALFORMED_NUMBER', 'error', { word: word.code }) };
  const text = `${word.sign === '-' ? '-' : ''}${withDecimals(word.data, unitDef.decimals)}`;
  const p = parseMeasurement(`${text} m`);
  if (p.status !== 'ok') return { issue: issue('MALFORMED_NUMBER', 'error', { word: word.code }) };
  return { value: { value: p.value, unit: p.unit, explicit: true }, display: `${text} m` };
}

/** One tokenized word -> a decoded word (raw always kept). */
function decodeWord(tok) {
  const three = `${tok.wi2}${tok.info[0]}`;
  const extended = /\d/.test(tok.info[0]) && EXTENDED.has(three);
  const code = extended ? three : tok.wi2;
  const def = extended ? { category: 'unused', key: 'service', label: 'Служебна информация' } : WORDS[Number(tok.wi2)] || null;
  const word = {
    code,
    raw: tok.raw,
    col: tok.col,
    info: tok.info,
    autoIndex: tok.info[1],
    inputMode: tok.info[2],
    inputModeLabel: INPUT_MODES[tok.info[2]] || null,
    unitCode: tok.info[3],
    sign: tok.sign,
    data: tok.data,
    category: def ? def.category : 'unknown',
    key: def ? def.key : null,
    label: def ? def.label : 'Неизвестно поле Leica',
    value: null,
    display: null,
    unitLabel: null,
    issue: null,
  };
  if (code === '11' && /^\d{4}$/.test(tok.info)) word.block = tok.info; // WI 11: positions 3-6 are the block number
  if (!def) {
    word.issue = issue('UNKNOWN_WORD', 'warning', { word: code });
    return word;
  }
  if (def.category === 'text') {
    word.value = textValue(tok.data);
    word.display = word.value;
  } else if (def.category === 'angle' || def.category === 'length') {
    const unitDef = UNITS[tok.info[3]];
    if (!unitDef || unitDef.kind !== def.category || unitDef.unsupported) {
      word.issue = issue('UNSUPPORTED_UNIT', 'error', { word: code });
      if (unitDef) word.unitLabel = unitDef.label;
      return word;
    }
    word.unitLabel = unitDef.label;
    const out = def.category === 'angle' ? decodeAngle(word, unitDef) : decodeLength(word, unitDef);
    if (out.issue) word.issue = out.issue;
    else { word.value = out.value; word.display = out.display; }
  }
  return word;
}

const has = (rec, ...codes) => rec.words.some((w) => codes.includes(w.code));

function classify(rec) {
  if (has(rec, '21', '22', '31', '32')) return 'measurement';
  if (has(rec, '84', '85', '86', '88')) return 'station';
  if (has(rec, '81', '82', '83')) return 'point';
  if (!has(rec, '11') && rec.words.some((w) => /^4[1-9]$/.test(w.code))) return 'code';
  return 'other';
}

/**
 * @param {{n:number, text:string, truncated?: boolean}[]} lines
 * @param {'GSI-8'|'GSI-16'} format
 * @returns {object[]} records in file order, `seq` 1-based
 */
function parseGsi(lines, format) {
  return lines.map((line, i) => {
    const tokens = line.truncated ? null : tokenizeLine(line.text, format);
    const rec = { seq: i + 1, line: line.n, raw: line.text, words: [], kind: 'invalid', issues: [] };
    if (!tokens) {
      rec.issues.push(issue('INVALID_RECORD', 'error'));
      return rec;
    }
    rec.words = tokens.map(decodeWord);
    rec.kind = classify(rec);
    for (const w of rec.words) if (w.issue) rec.issues.push({ ...w.issue, word: w.code });
    return rec;
  });
}

/** The first word of a record with this key (`pointId`, `hz`, `slopeDistance`...). */
const wordOf = (rec, key) => rec.words.find((w) => w.key === key) || null;

module.exports = { parseGsi, decodeWord, wordOf, withDecimals, classify };
