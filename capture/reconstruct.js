/**
 * Deterministic table reconstruction from OCR word geometry (pure, no I/O).
 *
 * Input: one normalized page { index, width, height, words: [{ text, confidence, bbox: {x,y,w,h} }] }
 * Output: a coordinate-table structure whose every cell keeps the bounding boxes of its source words.
 *
 * Steps: cluster words into text lines -> pick the header line (Bulgarian/English synonyms) -> derive column
 * intervals from the DATA rows (so wide headers cannot merge columns) -> assign words to cells -> map headers to
 * semantic columns. Nothing is guessed silently: an unrecognised or ambiguous header leaves the column unmapped /
 * ambiguous for the user to decide.
 */

const { mapHeader, headerHits } = require('./headers');
const { analyzeCellSymbols } = require('./symbols');

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cx = (b) => b.x + b.w / 2;
const cy = (b) => b.y + b.h / 2;
const union = (boxes) => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

function clusterLines(words, medianH) {
  const tol = 0.6 * medianH;
  const sorted = [...words].sort((a, b) => cy(a.bbox) - cy(b.bbox));
  const lines = [];
  for (const w of sorted) {
    const c = cy(w.bbox);
    let line = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i -= 1) {
      if (Math.abs(lines[i].cy - c) <= tol) {
        line = lines[i];
        break;
      }
    }
    if (!line) {
      line = { words: [], cy: c };
      lines.push(line);
    }
    line.words.push(w);
    line.cy = line.words.reduce((s, x) => s + cy(x.bbox), 0) / line.words.length;
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.bbox.x - b.bbox.x);
    line.bbox = union(line.words.map((w) => w.bbox));
  }
  return lines.sort((a, b) => a.cy - b.cy);
}

function findHeaderLine(lines) {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(lines.length, 10);
  for (let i = 0; i < limit; i += 1) {
    const { semantics } = headerHits(lines[i].words.map((w) => w.text));
    // a header line names at least two distinct fields, one of them a key one
    const key = semantics.some((s) => ['point', 'x', 'y'].includes(s));
    if (semantics.length >= 2 && key && semantics.length > bestScore) {
      best = i;
      bestScore = semantics.length;
    }
  }
  return best;
}

function columnIntervals(dataLines, medianH) {
  const pad = 0.7 * medianH;
  const spans = [];
  for (const line of dataLines) for (const w of line.words) spans.push([w.bbox.x, w.bbox.x + w.bbox.w]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [x0, x1] of spans) {
    const last = merged[merged.length - 1];
    if (last && x0 - last[1] <= pad) last[1] = Math.max(last[1], x1);
    else merged.push([x0, x1]);
  }
  return merged.map(([x0, x1], index) => ({ index, x0, x1 }));
}

function nearestColumn(columns, x) {
  let best = 0;
  let bestDist = Infinity;
  for (const c of columns) {
    const d = x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0;
    if (d < bestDist) {
      bestDist = d;
      best = c.index;
    }
  }
  return best;
}

/**
 * @param {{index:number,width:number,height:number,words:object[]}} page
 * @param {{provider?: string}} options
 * @returns {{table: object|null, reason?: string, diagnostics: object}}
 */
function reconstructTable(page, options = {}) {
  const providerName = options.provider || null;
  const words = (page.words || []).filter((w) => w && typeof w.text === 'string' && w.text.trim() !== '' && w.bbox);
  if (!words.length) return { table: null, reason: 'NO_TEXT', diagnostics: {} };

  const medianH = median(words.map((w) => w.bbox.h)) || 1;
  const lines = clusterLines(words, medianH);
  const headerIdx = findHeaderLine(lines);
  const headerLine = headerIdx >= 0 ? lines[headerIdx] : null;
  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  // columns from data lines that look like table rows (>= 2 words); fall back to all data lines
  const rowLike = dataLines.filter((l) => l.words.length >= 2);
  const basis = rowLike.length ? rowLike : dataLines;
  if (!basis.length) return { table: null, reason: 'NO_TABLE', diagnostics: { medianHeight: medianH, lines: lines.length } };
  const columns = columnIntervals(basis, medianH);

  // A header over a column that has NO data in any row (e.g. an empty "Notes" column) must not be glued onto the nearest
  // data column: it becomes a column of its own (with empty cells).
  if (headerLine) {
    const pad = 0.7 * medianH;
    const extras = [];
    for (const w of headerLine.words) {
      const wx0 = w.bbox.x;
      const wx1 = w.bbox.x + w.bbox.w;
      // the header word touches (within the word gap) some data column -> it names that column
      if (!columns.some((col) => wx0 <= col.x1 + pad && wx1 >= col.x0 - pad)) extras.push([wx0, wx1]);
    }
    extras.sort((p, q) => p[0] - q[0]);
    const mergedExtras = [];
    for (const [x0, x1] of extras) {
      const last = mergedExtras[mergedExtras.length - 1];
      if (last && x0 - last[1] <= pad) last[1] = Math.max(last[1], x1);
      else mergedExtras.push([x0, x1]);
    }
    for (const [x0, x1] of mergedExtras) columns.push({ index: -1, x0, x1 });
    columns.sort((p, q) => p.x0 - q.x0);
    columns.forEach((col, i) => { col.index = i; });
  }

  // header text per column
  const headerWords = new Map();
  if (headerLine) {
    for (const w of headerLine.words) {
      const col = nearestColumn(columns, cx(w.bbox));
      (headerWords.get(col) || headerWords.set(col, []).get(col)).push(w);
    }
  }
  const cols = columns.map((c) => {
    const hw = headerWords.get(c.index) || [];
    const headerText = hw.map((w) => w.text).join(' ').trim();
    let semantic = null;
    let mapping = 'unmapped';
    let matches = [];
    if (headerText) {
      const m = mapHeader(headerText);
      matches = m.matches;
      if (m.semantic) {
        semantic = m.semantic;
        mapping = 'ok';
      } else if (m.ambiguous) mapping = 'ambiguous';
    }
    return {
      index: c.index,
      x0: c.x0,
      x1: c.x1,
      headerText,
      headerBbox: hw.length ? union(hw.map((w) => w.bbox)) : null,
      proposedSemantic: semantic,
      semantic,
      mapping,
      matches,
    };
  });

  // a semantic claimed by several columns is ambiguous: keep it visible, the validator blocks the import
  const claimed = {};
  for (const c of cols) if (c.semantic) (claimed[c.semantic] = claimed[c.semantic] || []).push(c);
  for (const list of Object.values(claimed)) {
    if (list.length > 1) list.forEach((c) => { c.mapping = 'ambiguous'; });
  }

  const rows = [];
  const ignoredLines = [];
  for (const line of dataLines) {
    const cellWords = new Map(cols.map((c) => [c.index, []]));
    for (const w of line.words) cellWords.get(nearestColumn(columns, cx(w.bbox))).push(w);
    const nonEmpty = [...cellWords.values()].filter((ws) => ws.length).length;
    if (nonEmpty < 2) {
      ignoredLines.push({ text: line.words.map((w) => w.text).join(' ').slice(0, 80), bbox: line.bbox });
      continue;
    }
    const cells = cols.map((c) => {
      const ws = cellWords.get(c.index).sort((a, b) => a.bbox.x - b.bbox.x);
      if (!ws.length) {
        return {
          col: c.index, rawText: '', confidence: null, page: page.index,
          bbox: { x: c.x0, y: line.bbox.y, w: c.x1 - c.x0, h: line.bbox.h, synthetic: true },
          words: [], symbolConfidence: { min: null, suspicious: [] }, candidates: [], arbitration: null,
          source: { provider: providerName }, userValue: null,
        };
      }
      const confs = ws.map((w) => w.confidence).filter((v) => typeof v === 'number');
      const rawText = ws.map((w) => w.text).join(' ');
      const confidence = confs.length === ws.length ? Math.min(...confs) : null;
      const words = ws.map((w) => ({ text: w.text, confidence: typeof w.confidence === 'number' ? w.confidence : null, bbox: w.bbox, symbols: Array.isArray(w.symbols) ? w.symbols : undefined }));
      const symbolConfidence = analyzeCellSymbols(words);
      return {
        col: c.index,
        rawText,
        confidence,
        page: page.index,
        bbox: union(ws.map((w) => w.bbox)),
        words,
        symbolConfidence,
        // candidates[0] is always the PRIMARY (whole-page) reading; capture/rerecognition.js appends further passes.
        candidates: [{ text: rawText, normalizedValue: null, provider: providerName, providerVersion: null, recognitionPass: 0, preprocessingVariant: 'primary', confidence, bbox: union(ws.map((w) => w.bbox)), symbolConfidence, source: 'primary' }],
        arbitration: null,
        source: { provider: providerName },
        userValue: null,
      };
    });
    rows.push({ index: rows.length, bbox: line.bbox, cells });
  }
  if (!rows.length) return { table: null, reason: 'NO_TABLE', diagnostics: { medianHeight: medianH, lines: lines.length } };

  const allBoxes = rows.flatMap((r) => r.cells.map((c) => c.bbox));
  if (headerLine) allBoxes.push(headerLine.bbox);
  const table = {
    pageIndex: page.index,
    bbox: union(allBoxes),
    headerBbox: headerLine ? headerLine.bbox : null,
    hasHeader: Boolean(headerLine),
    columns: cols,
    rows,
    ignoredLines,
    issues: [],
  };
  return { table, diagnostics: { medianHeight: medianH, lines: lines.length, headerLine: headerIdx, columns: cols.length, rows: rows.length } };
}

module.exports = { reconstructTable, median, union };
