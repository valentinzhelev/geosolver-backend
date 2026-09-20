/**
 * Deterministic Capture fixtures (test support, not a test): a coordinate table with KNOWN ground truth is turned into
 *  - OCR words with bounding boxes (what a provider would return),
 *  - a PNG image (grid lines + text-like blocks; no fonts needed, so rendering is identical everywhere),
 *  - a Google-Vision-shaped response (fullTextAnnotation) for the provider adapter test.
 */
const sharp = require('sharp');

const CHAR_W = 14;
const ROW_H = 40;
const WORD_H = 26;
const PAD_X = 30;
const PAD_Y = 30;

/**
 * @param {{headers: string[], rows: string[][], colGap?: number, confidence?: number|((r:number,c:number)=>number),
 *          alignRight?: boolean}} spec
 */
function layoutTable(spec) {
  const { headers, rows } = spec;
  const colGap = spec.colGap ?? 60;
  const nCols = headers.length;
  const colChars = headers.map((h, c) => Math.max(String(h).length, ...rows.map((r) => String(r[c] ?? '').length), 3));
  const colX = [];
  let x = PAD_X;
  for (let c = 0; c < nCols; c += 1) {
    colX.push(x);
    x += colChars[c] * CHAR_W + colGap;
  }
  const width = x - colGap + PAD_X;
  const words = [];
  const confOf = (r, c) => (typeof spec.confidence === 'function' ? spec.confidence(r, c) : spec.confidence ?? 0.98);
  const place = (text, r, c, y) => {
    let cursor = colX[c];
    if (spec.alignRight && c > 0) cursor = colX[c] + (colChars[c] - String(text).length) * CHAR_W;
    for (const part of String(text).split(' ')) {
      if (part === '') { cursor += CHAR_W; continue; }
      const w = part.length * CHAR_W;
      words.push({ text: part, confidence: confOf(r, c), bbox: { x: cursor, y, w, h: WORD_H }, _r: r, _c: c });
      cursor += w + CHAR_W;
    }
  };
  headers.forEach((h, c) => place(h, -1, c, PAD_Y));
  rows.forEach((row, r) => row.forEach((text, c) => { if (String(text) !== '') place(text, r, c, PAD_Y + (r + 1) * ROW_H + 10); }));
  const height = PAD_Y + (rows.length + 1) * ROW_H + 40;
  return { words, width, height, colX, colChars };
}

/** PNG of the layout: grid lines + a dark block per word (deskew-friendly, font-free). */
async function renderTableImage(layout, { skewDeg = 0, background = '#ffffff' } = {}) {
  const { width, height, words } = layout;
  const rects = words.map((w) => `<rect x="${w.bbox.x}" y="${w.bbox.y}" width="${w.bbox.w}" height="${w.bbox.h}" fill="#222"/>`).join('');
  const rowsN = Math.round((height - 70) / ROW_H) + 1;
  const lines = [];
  for (let i = 0; i <= rowsN; i += 1) {
    const y = PAD_Y - 6 + i * ROW_H;
    lines.push(`<line x1="8" y1="${y}" x2="${width - 8}" y2="${y}" stroke="#555" stroke-width="2"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/>${lines.join('')}${rects}</svg>`;
  let img = sharp(Buffer.from(svg)).png();
  if (skewDeg) {
    const buf = await img.toBuffer();
    img = sharp(buf).rotate(skewDeg, { background }).png();
  }
  return img.toBuffer();
}

const stripPrivate = (words) => words.map(({ _r, _c, ...w }) => w);

/** A Vision-shaped fullTextAnnotation (page -> block -> paragraph -> word -> symbols) for the adapter test. */
function toVisionResponse(words, { width, height }) {
  const vertices = (b) => [
    { x: Math.round(b.x), y: Math.round(b.y) },
    { x: Math.round(b.x + b.w), y: Math.round(b.y) },
    { x: Math.round(b.x + b.w), y: Math.round(b.y + b.h) },
    { x: Math.round(b.x), y: Math.round(b.y + b.h) },
  ];
  return {
    fullTextAnnotation: {
      text: words.map((w) => w.text).join(' '),
      pages: [{
        width, height,
        blocks: [{
          paragraphs: [{
            words: stripPrivate(words).map((w) => ({
              confidence: w.confidence,
              boundingBox: { vertices: vertices(w.bbox) },
              symbols: [...w.text].map((ch) => ({ text: ch, confidence: w.confidence })),
            })),
          }],
        }],
      }],
    },
  };
}

/** Ground-truth coordinate table used by the E2E test (Y=Easting, X=Northing). */
const TRUTH = [
  { name: 'P1', code: 'CP', x: 4700000.25, y: 500000.5, h: 100.125 },
  { name: 'P2', code: 'CP', x: 4700100.5, y: 500050.75, h: 101.5 },
  { name: 'P3', code: 'DT', x: 4700200, y: 500100.25, h: null },
  { name: 'P4', code: '', x: 4700300.75, y: 500150, h: 99.875 },
];
const fmtDot = (n) => (n === null ? '' : String(n));

module.exports = { layoutTable, renderTableImage, toVisionResponse, stripPrivate, TRUTH, fmtDot, ROW_H, WORD_H, CHAR_W };
