/**
 * Deterministic interpretation + validation of a reconstructed coordinate table (pure, no I/O).
 *
 * The validator NEVER changes a value: it derives `normalizedValue` from the effective text (the user's correction
 * when present, otherwise the OCR rawText), and attaches issues. rawText and userValue are left exactly as stored.
 * Severities: 'ok' | 'warning' | 'error'. Errors block the import; warnings ask for review.
 */

const { parseColumn } = require('./numeric');
const { arbitrateCell, TRACKED_SEMANTICS } = require('./arbitration');

const NUMERIC = ['x', 'y', 'h'];
const REQUIRED = ['point', 'x', 'y'];
const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Plausible ranges, ONLY where the project's CRS justifies them. These are the Bulgarian UTM zones, derived by
 * transforming Bulgaria's bounding box (lat 41.2-44.3, lon 22.3-28.7) with the CRS and adding a margin.
 * EPSG:7801 is deliberately absent: its definition in this app (false easting 5,000,000) does not give a
 * range that is safe to assert, and no universal range is assumed.
 */
const CRS_EXTENTS = {
  'EPSG:7799': { x: [4500000, 5000000], y: [550000, 1200000] },
  'EPSG:7800': { x: [4500000, 5000000], y: [50000, 700000] },
};

const inRange = (v, [lo, hi]) => v >= lo && v <= hi;

const issue = (code, severity, message, extra = {}) => ({ code, severity, message, ...extra });

const MESSAGES = {
  POINT_REQUIRED: 'Липсва име/номер на точка.',
  VALUE_REQUIRED: 'Липсва задължителна стойност.',
  VALUE_INVALID: 'Стойността не е валидно число.',
  VALUE_AMBIGUOUS: 'Форматът на числото е двусмислен (точка/запетая). Въведете го ръчно.',
  FORMAT_INFERRED: 'Форматът на числото е определен по останалите стойности в документа - проверете го.',
  LOW_CONFIDENCE: 'Ниска сигурност на разпознаването - проверете стойността.',
  DUPLICATE_POINT: 'Повтарящо се име на точка в това сканиране.',
  DECIMAL_SEPARATOR_MIXED: 'В колоната се използват различни десетични разделители.',
  DECIMAL_PRECISION_INCONSISTENT: 'Броят десетични знаци се различава от останалите в колоната.',
  POSSIBLE_XY_SWAP: 'Възможна размяна на X и Y (X е север, Y е изток) - проверете колоните.',
  OUT_OF_CRS_EXTENT: 'Стойността е извън очаквания обхват за координатната система на проекта.',
  MISSING_COLUMN: 'Не е зададена колона за задължителното поле.',
  DUPLICATE_COLUMN_MAPPING: 'Повече от една колона е зададена за едно и също поле.',
  COLUMN_UNRESOLVED: 'Значението на колона не е потвърдено.',
  NO_DATA_ROWS: 'Не са намерени редове с данни.',
  // V2.2: candidate arbitration (capture/arbitration.js) - these judge the TRUSTWORTHINESS of the recognition,
  // separately from whether the text happens to parse as a number.
  RECOGNITION_UNCERTAIN: 'Разпознаването не е достатъчно сигурно - въведете стойността ръчно или изберете разчитане.',
  RECOGNITION_INVALID: 'Разпознаването не изглежда надеждно - въведете стойността ръчно.',
  RECOGNITION_REVIEW_SUGGESTED: 'Има разминаване между няколко разчитания на тази клетка - проверете стойността.',
};

const effectiveText = (cell) => (cell.userValue !== null && cell.userValue !== undefined ? String(cell.userValue) : cell.rawText || '');
const isBlank = (s) => String(s || '').trim() === '';
const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * @param {object} table reconstructed table (see capture/reconstruct.js)
 * @param {{crs?: string|null, confidenceThreshold?: number}} options
 * @returns {{table: object, summary: object, rows: object[]}} a NEW table (input untouched), the summary and the
 *          import-ready rows (only meaningful when summary.canConfirm)
 */
function evaluateTable(table, options = {}) {
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const extents = options.crs ? CRS_EXTENTS[options.crs] || null : null;
  const t = structuredClone(table);
  t.issues = [];

  // ---- column mapping (table-level) ------------------------------------------------------------------------
  const bySemantic = {};
  for (const col of t.columns) {
    if (col.semantic) (bySemantic[col.semantic] = bySemantic[col.semantic] || []).push(col.index);
    if (!col.semantic && col.mapping === 'ambiguous') {
      t.issues.push(issue('COLUMN_UNRESOLVED', 'warning', MESSAGES.COLUMN_UNRESOLVED, { col: col.index }));
    }
  }
  for (const [semantic, cols] of Object.entries(bySemantic)) {
    if (cols.length > 1) t.issues.push(issue('DUPLICATE_COLUMN_MAPPING', 'error', MESSAGES.DUPLICATE_COLUMN_MAPPING, { semantic, cols }));
  }
  for (const semantic of REQUIRED) {
    if (!bySemantic[semantic]) t.issues.push(issue('MISSING_COLUMN', 'error', MESSAGES.MISSING_COLUMN, { semantic }));
  }
  const semanticOf = (colIndex) => (t.columns.find((c) => c.index === colIndex) || {}).semantic || null;

  // ---- reset derived state, keep raw/user input --------------------------------------------------------------
  for (const row of t.rows) {
    for (const cell of row.cells) {
      cell.semanticType = semanticOf(cell.col);
      cell.normalizedValue = null;
      cell.validation = { status: 'ok', issues: [] };
    }
  }
  const cellAt = (row, semantic) => row.cells.find((c) => c.semanticType === semantic) || null;
  const add = (cell, is) => {
    cell.validation.issues.push(is);
    if (is.severity === 'error') cell.validation.status = 'error';
    else if (is.severity === 'warning' && cell.validation.status !== 'error') cell.validation.status = 'warning';
  };

  // ---- numeric columns: parse each column TOGETHER (formatting is a column property) ------------------------
  // pass 1: each column's own style; the decimal separator shared by ALL numeric columns is the document's style
  const numericColumns = NUMERIC.flatMap((semantic) => bySemantic[semantic] || []);
  const rawsOf = (colIndex) => t.rows.map((r) => { const c = r.cells.find((x) => x.col === colIndex); return c ? effectiveText(c) : ''; });
  const ownSeps = new Set();
  for (const colIndex of numericColumns) {
    const { own } = parseColumn(rawsOf(colIndex));
    if (own.decimalSep) ownSeps.add(own.decimalSep);
  }
  const documentStyle = ownSeps.size === 1 ? { decimalSep: [...ownSeps][0] } : null;
  const columnStyles = {}; // colIndex -> the resolved numeric style, reused by candidate arbitration below
  for (const semantic of NUMERIC) {
    for (const colIndex of bySemantic[semantic] || []) {
      const cells = t.rows.map((r) => r.cells.find((c) => c.col === colIndex));
      const raws = rawsOf(colIndex);
      const { parsed, style } = parseColumn(raws, documentStyle);
      columnStyles[colIndex] = style;
      cells.forEach((cell, i) => {
        if (!cell) return;
        const p = parsed[i];
        cell._parse = p; // transient, removed below
        if (p.status === 'ok') cell.normalizedValue = p.value;
      });
    }
  }
  const arbitrationOptions = { ...options.arbitration };

  // ---- per-row / per-cell rules ------------------------------------------------------------------------------
  const pointNames = new Map();
  for (const row of t.rows) {
    // V2.2 row exclusion ("Не импортирай този ред"): an explicit, reversible user decision. An excluded row keeps
    // its OCR evidence and is still shown, but never blocks confirmation and is never imported - no validation
    // issues are raised for it at all.
    if (row.excluded) {
      row._skip = true;
      row._excluded = true;
      continue;
    }
    const point = cellAt(row, 'point');
    const anyContent = row.cells.some((c) => c.semanticType && !isBlank(effectiveText(c)));
    row._skip = !anyContent;
    if (row._skip) continue;

    if (point) {
      const name = cleanText(effectiveText(point));
      point.normalizedValue = name === '' ? null : name;
      if (name === '') add(point, issue('POINT_REQUIRED', 'error', MESSAGES.POINT_REQUIRED));
      else {
        const key = name.toLowerCase();
        (pointNames.get(key) || pointNames.set(key, []).get(key)).push(point);
      }
    }
    for (const semantic of ['code', 'notes']) {
      const cell = cellAt(row, semantic);
      if (cell) cell.normalizedValue = cleanText(effectiveText(cell)) || null;
    }
    for (const semantic of NUMERIC) {
      const cell = cellAt(row, semantic);
      if (!cell) continue;
      const p = cell._parse;
      if (!p) continue;
      if (p.status === 'empty') {
        if (semantic !== 'h') add(cell, issue('VALUE_REQUIRED', 'error', MESSAGES.VALUE_REQUIRED, { field: semantic }));
      } else if (p.status === 'ambiguous') {
        add(cell, issue('VALUE_AMBIGUOUS', 'error', MESSAGES.VALUE_AMBIGUOUS, { field: semantic, reason: p.reason }));
      } else if (p.status === 'invalid') {
        add(cell, issue('VALUE_INVALID', 'error', MESSAGES.VALUE_INVALID, { field: semantic, reason: p.reason }));
      } else if (p.status === 'ok' && p.format && p.format.definite === false) {
        // the number is only readable through the column/document format, not by itself: review suggested
        add(cell, issue('FORMAT_INFERRED', 'warning', MESSAGES.FORMAT_INFERRED, { field: semantic }));
      }
    }
    // OCR confidence: a cell the user has already corrected is treated as reviewed
    for (const cell of row.cells) {
      if (!cell.semanticType) continue;
      const edited = cell.userValue !== null && cell.userValue !== undefined;
      if (!edited && typeof cell.confidence === 'number' && cell.confidence < threshold && !isBlank(cell.rawText)) {
        add(cell, issue('LOW_CONFIDENCE', 'warning', MESSAGES.LOW_CONFIDENCE, { confidence: cell.confidence }));
      }
    }
    // V2.2 candidate arbitration: judges the TRUST of the recognition (agreement between independent passes,
    // symbol confidence), separately from whether the text parses. Never runs for an already-edited cell: the
    // user's explicit correction IS the resolution.
    for (const cell of row.cells) {
      if (!cell.semanticType || !TRACKED_SEMANTICS.has(cell.semanticType)) continue;
      const result = arbitrateCell(cell, { semantic: cell.semanticType, numericStyle: columnStyles[cell.col] || null, ...arbitrationOptions });
      cell.arbitration = result;
      const edited = cell.userValue !== null && cell.userValue !== undefined;
      if (!result || edited) continue;
      if (result.outcome === 'UNCERTAIN') add(cell, issue('RECOGNITION_UNCERTAIN', 'error', MESSAGES.RECOGNITION_UNCERTAIN, { reason: result.reason }));
      else if (result.outcome === 'INVALID' && cell.validation.status !== 'error') add(cell, issue('RECOGNITION_INVALID', 'error', MESSAGES.RECOGNITION_INVALID, { reason: result.reason }));
      else if (result.outcome === 'REVIEW_SUGGESTED') add(cell, issue('RECOGNITION_REVIEW_SUGGESTED', 'warning', MESSAGES.RECOGNITION_REVIEW_SUGGESTED, { reason: result.reason }));
    }
    // CRS-justified plausibility and possible X/Y swap (warnings only; never swaps anything)
    const xc = cellAt(row, 'x');
    const yc = cellAt(row, 'y');
    if (extents && xc && yc && typeof xc.normalizedValue === 'number' && typeof yc.normalizedValue === 'number') {
      const xOk = inRange(xc.normalizedValue, extents.x);
      const yOk = inRange(yc.normalizedValue, extents.y);
      const swapped = inRange(xc.normalizedValue, extents.y) && inRange(yc.normalizedValue, extents.x);
      if (!(xOk && yOk)) {
        if (swapped) {
          add(xc, issue('POSSIBLE_XY_SWAP', 'warning', MESSAGES.POSSIBLE_XY_SWAP));
          add(yc, issue('POSSIBLE_XY_SWAP', 'warning', MESSAGES.POSSIBLE_XY_SWAP));
        } else {
          if (!xOk) add(xc, issue('OUT_OF_CRS_EXTENT', 'warning', MESSAGES.OUT_OF_CRS_EXTENT, { field: 'x' }));
          if (!yOk) add(yc, issue('OUT_OF_CRS_EXTENT', 'warning', MESSAGES.OUT_OF_CRS_EXTENT, { field: 'y' }));
        }
      }
    }
  }

  // ---- duplicate point identifiers inside this capture ----------------------------------------------------------
  for (const cells of pointNames.values()) {
    if (cells.length > 1) cells.forEach((c) => add(c, issue('DUPLICATE_POINT', 'error', MESSAGES.DUPLICATE_POINT)));
  }

  // ---- decimal-format consistency per numeric column ----------------------------------------------------------------
  for (const semantic of NUMERIC) {
    for (const colIndex of bySemantic[semantic] || []) {
      const cells = t.rows.filter((r) => !r._skip).map((r) => r.cells.find((c) => c.col === colIndex)).filter((c) => c && c._parse && c._parse.status === 'ok');
      const seps = new Map();
      for (const c of cells) {
        const s = c._parse.format.decimalSep;
        if (s) seps.set(s, (seps.get(s) || 0) + 1);
      }
      if (seps.size > 1) {
        const majority = [...seps.entries()].sort((a, b) => b[1] - a[1])[0][0];
        cells.forEach((c) => {
          const s = c._parse.format.decimalSep;
          if (s && s !== majority) add(c, issue('DECIMAL_SEPARATOR_MIXED', 'warning', MESSAGES.DECIMAL_SEPARATOR_MIXED));
        });
        t.issues.push(issue('DECIMAL_SEPARATOR_MIXED', 'warning', MESSAGES.DECIMAL_SEPARATOR_MIXED, { col: colIndex }));
      }
      const decimalsCounts = new Map();
      cells.forEach((c) => decimalsCounts.set(c._parse.format.decimals, (decimalsCounts.get(c._parse.format.decimals) || 0) + 1));
      if (cells.length >= 4) {
        const [modal, modalCount] = [...decimalsCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (modalCount / cells.length >= 0.6) {
          cells.forEach((c) => {
            if (Math.abs(c._parse.format.decimals - modal) >= 2) add(c, issue('DECIMAL_PRECISION_INCONSISTENT', 'warning', MESSAGES.DECIMAL_PRECISION_INCONSISTENT));
          });
        }
      }
    }
  }

  // ---- summary + import-ready rows -----------------------------------------------------------------------------------
  const excludedRows = t.rows.filter((r) => r._excluded);
  const dataRows = t.rows.filter((r) => !r._skip);
  if (dataRows.length === 0 && excludedRows.length === 0) t.issues.push(issue('NO_DATA_ROWS', 'error', MESSAGES.NO_DATA_ROWS));
  const summary = { rows: dataRows.length, ready: 0, review: 0, invalid: 0, excluded: excludedRows.length, errors: 0, warnings: 0, tableErrors: 0, tableWarnings: 0, canConfirm: false };
  for (const is of t.issues) {
    if (is.severity === 'error') summary.tableErrors += 1;
    else summary.tableWarnings += 1;
  }
  const importRows = [];
  for (const row of dataRows) {
    const statuses = row.cells.map((c) => c.validation.status);
    const errors = row.cells.reduce((n, c) => n + c.validation.issues.filter((i) => i.severity === 'error').length, 0);
    const warnings = row.cells.reduce((n, c) => n + c.validation.issues.filter((i) => i.severity === 'warning').length, 0);
    summary.errors += errors;
    summary.warnings += warnings;
    row.status = statuses.includes('error') ? 'error' : statuses.includes('warning') ? 'warning' : 'ok';
    if (row.status === 'error') summary.invalid += 1;
    else if (row.status === 'warning') summary.review += 1;
    else summary.ready += 1;
    if (row.status !== 'error') {
      const g = (s) => (cellAt(row, s) || {}).normalizedValue;
      importRows.push({
        row: row.index,
        name: g('point'),
        code: g('code') || '',
        x: g('x'),
        y: g('y'),
        h: typeof g('h') === 'number' ? g('h') : null,
        notes: g('notes') || '',
        cells: Object.fromEntries(
          ['point', 'code', 'x', 'y', 'h', 'notes']
            .map((s) => [s, cellAt(row, s)])
            .filter(([, c]) => c && c.bbox && !c.bbox.synthetic) // an empty cell has no source region
            .map(([s, c]) => [s, { col: c.col, page: c.page, bbox: c.bbox }])
        ),
      });
    }
  }
  summary.canConfirm = summary.tableErrors === 0 && summary.invalid === 0 && summary.rows > 0;

  // strip transient fields
  for (const row of t.rows) {
    delete row._skip;
    row.excluded = Boolean(row.excluded); // normalized, always present
    if (row._excluded) row.status = 'excluded';
    delete row._excluded;
    row.skipped = row.cells.every((c) => !c.semanticType || isBlank(effectiveText(c)));
    for (const cell of row.cells) delete cell._parse;
  }
  return { table: t, summary, rows: importRows };
}

/** UI review state of one cell: invalid | review | edited | accepted (also usable without colour: see labels). */
function cellReviewState(cell) {
  const status = cell.validation && cell.validation.status;
  if (status === 'error') return 'invalid';
  if (status === 'warning') return 'review';
  if (cell.userValue !== null && cell.userValue !== undefined) return 'edited';
  return 'accepted';
}

module.exports = { evaluateTable, cellReviewState, effectiveText, CRS_EXTENTS, DEFAULT_CONFIDENCE_THRESHOLD, REQUIRED, NUMERIC, MESSAGES };
