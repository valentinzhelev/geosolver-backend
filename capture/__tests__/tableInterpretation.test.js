const { mapHeader, normalizeHeader } = require('../headers');
const { reconstructTable } = require('../reconstruct');
const { evaluateTable, cellReviewState } = require('../validation');
const { layoutTable, stripPrivate } = require('../../tests/support/captureFixtures');

const page = (layout) => ({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) });
const build = (headers, rows, extra = {}) => {
  const layout = layoutTable({ headers, rows, ...extra });
  const { table, reason } = reconstructTable(page(layout), { provider: 'fixture' });
  expect(reason).toBeUndefined();
  return { layout, table };
};
const semantics = (table) => table.columns.map((c) => c.semantic);

describe('header mapping (Bulgarian and English)', () => {
  it.each([
    ['Точка', 'point'], ['№', 'point'], ['Номер', 'point'], ['Point', 'point'], ['Pt', 'point'], ['No', 'point'],
    ['Код', 'code'], ['Code', 'code'],
    ['X', 'x'], ['x', 'x'], ['Х', 'x'], ['Север', 'x'], ['Northing', 'x'], ['X (m)', 'x'], ['X, м', 'x'],
    ['Y', 'y'], ['У', 'y'], ['Изток', 'y'], ['Easting', 'y'], ['Y [m]', 'y'],
    ['H', 'h'], ['Z', 'h'], ['Кота', 'h'], ['Височина', 'h'], ['Elevation', 'h'], ['Н', 'h'], ['Elev.', 'h'],
    ['Бележка', 'notes'], ['Бележки', 'notes'], ['Забележка', 'notes'], ['Notes', 'notes'], ['Description', 'notes'], ['Описание', 'notes'],
  ])('%s -> %s', (text, semantic) => {
    expect(mapHeader(text)).toMatchObject({ semantic, ambiguous: false });
  });

  it('unknown headers are not mapped, and single letters that could mean several things are not guessed', () => {
    expect(mapHeader('Дата').semantic).toBeNull();
    expect(mapHeader('N').semantic).toBeNull(); // could be "number" or "north": never silent
    expect(mapHeader('E').semantic).toBeNull();
    expect(mapHeader('').semantic).toBeNull();
    expect(normalizeHeader('  Y (m) ')).toBe('y');
  });
});

describe('row and column reconstruction', () => {
  const headers = ['Точка', 'Код', 'X', 'Y', 'H', 'Бележка'];
  const rows = [
    ['P1', 'CP', '4700000.25', '500000.50', '100.125', 'ъгъл'],
    ['P2', 'CP', '4700100.50', '500050.75', '101.50', ''],
    ['P3', 'DT', '4700200.00', '500100.25', '', 'няма кота'],
  ];

  it('finds the header row, the columns, every row and every cell (Bulgarian headers)', () => {
    const { table } = build(headers, rows);
    expect(table.hasHeader).toBe(true);
    expect(table.columns.map((c) => c.headerText)).toEqual(headers);
    expect(semantics(table)).toEqual(['point', 'code', 'x', 'y', 'h', 'notes']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows.map((r) => r.cells.map((c) => c.rawText))).toEqual(rows);
  });

  it('English headers, reordered columns (X before Y, H first)', () => {
    const { table } = build(['H', 'Point', 'Y', 'X'], [['100.1', 'A1', '500000', '4700000'], ['101.2', 'A2', '500010', '4700010']]);
    expect(semantics(table)).toEqual(['h', 'point', 'y', 'x']);
    const { table: evaluated, summary } = evaluateTable(table);
    expect(summary.canConfirm).toBe(true);
    const row0 = evaluated.rows[0].cells;
    expect(row0.map((c) => c.normalizedValue)).toEqual([100.1, 'A1', 500000, 4700000]);
  });

  it('missing H, code and notes: optional columns can be absent', () => {
    const { table } = build(['Point', 'X', 'Y'], [['1', '4700000', '500000'], ['2', '4700001', '500001']]);
    const { summary, rows } = evaluateTable(table);
    expect(summary).toMatchObject({ rows: 2, ready: 2, invalid: 0, canConfirm: true });
    expect(rows[0]).toMatchObject({ name: '1', x: 4700000, y: 500000, h: null, code: '', notes: '' });
  });

  it('a missing cell inside a row keeps its column (empty synthetic cell with a box)', () => {
    const { table } = build(headers, rows);
    const hCell = table.rows[2].cells[4];
    expect(hCell.rawText).toBe('');
    expect(hCell.bbox.synthetic).toBe(true);
    expect(hCell.bbox.w).toBeGreaterThan(0);
  });

  it('cell bounding boxes are the union of their source word boxes (and words are kept)', () => {
    const layout = layoutTable({ headers, rows });
    const { table } = reconstructTable(page(layout), { provider: 'fixture' });
    const cell = table.rows[0].cells[2]; // "4700000.25"
    const word = layout.words.find((w) => w.text === '4700000.25');
    expect(cell.bbox).toEqual(word.bbox);
    expect(cell.words).toHaveLength(1);
    expect(cell.confidence).toBe(0.98);
    expect(cell.page).toBe(0);
    expect(cell.candidates[0]).toMatchObject({ text: '4700000.25', provider: 'fixture', source: 'primary', recognitionPass: 0 });
  });

  it('multi-word cells (thousands separated by spaces) stay ONE cell', () => {
    const { table } = build(['Point', 'X', 'Y'], [['1', '4 700 000,25', '500 000,50'], ['2', '4 700 010,25', '500 010,50']]);
    expect(table.rows[0].cells.map((c) => c.rawText)).toEqual(['1', '4 700 000,25', '500 000,50']);
    expect(table.rows[0].cells[1].words).toHaveLength(3);
  });

  it('tolerates small vertical jitter inside a row', () => {
    const layout = layoutTable({ headers: ['Point', 'X', 'Y'], rows: [['1', '4700000', '500000'], ['2', '4700001', '500001']] });
    layout.words.forEach((w, i) => { w.bbox.y += (i % 3) * 3 - 3; });
    const { table } = reconstructTable(page(layout), { provider: 'fixture' });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1].cells.map((c) => c.rawText)).toEqual(['2', '4700001', '500001']);
  });

  it('title/footer lines that are not table rows are ignored, not turned into rows', () => {
    const layout = layoutTable({ headers: ['Point', 'X', 'Y'], rows: [['1', '4700000', '500000'], ['2', '4700001', '500001'], ['Изготвил', '', '']] });
    const { table } = reconstructTable(page(layout), { provider: 'fixture' });
    expect(table.rows).toHaveLength(2);
    expect(table.ignoredLines.map((l) => l.text)).toEqual(['Изготвил']);
  });

  it('no header row: columns are NOT mapped silently (user must assign them)', () => {
    const { table } = build(['1', '4700000', '500000'], [['2', '4700001', '500001'], ['3', '4700002', '500002']]);
    expect(table.hasHeader).toBe(false);
    expect(semantics(table)).toEqual([null, null, null]);
    expect(table.columns.every((c) => c.mapping === 'unmapped')).toBe(true);
    expect(evaluateTable(table).summary.canConfirm).toBe(false);
  });

  it('two columns claiming the same meaning are ambiguous and block the import', () => {
    const { table } = build(['Point', 'X', 'X', 'Y'], [['1', '4700000', '4700000', '500000'], ['2', '4700001', '4700001', '500001']]);
    expect(table.columns.filter((c) => c.semantic === 'x').every((c) => c.mapping === 'ambiguous')).toBe(true);
    const { table: t, summary } = evaluateTable(table);
    expect(t.issues.some((i) => i.code === 'DUPLICATE_COLUMN_MAPPING' && i.severity === 'error')).toBe(true);
    expect(summary.canConfirm).toBe(false);
  });

  it('an empty page or a page without a table yields no table', () => {
    expect(reconstructTable({ index: 0, words: [] }).reason).toBe('NO_TEXT');
    expect(reconstructTable({ index: 0, words: [{ text: 'само', confidence: 0.9, bbox: { x: 1, y: 1, w: 40, h: 20 } }] }).reason).toBe('NO_TABLE');
  });
});

describe('deterministic validation (never changes a value)', () => {
  const evaluate = (headers, rows, opts, layoutExtra) => evaluateTable(build(headers, rows, layoutExtra).table, opts);
  const issuesOf = (table, r, semantic) => table.rows[r].cells.find((c) => c.semanticType === semantic).validation.issues.map((i) => i.code);

  it('comma decimals and thousands separators are normalized; rawText is never mutated', () => {
    const { table: raw } = build(['Point', 'X', 'Y', 'H'], [['1', '4.700.000,25', '500.000,50', '100,125'], ['2', '4.700.100,50', '500.050,75', '101,5']]);
    const before = JSON.stringify(raw);
    const { table, summary } = evaluateTable(raw);
    expect(JSON.stringify(raw)).toBe(before); // input untouched
    expect(table.rows[0].cells.map((c) => c.rawText)).toEqual(['1', '4.700.000,25', '500.000,50', '100,125']);
    expect(table.rows[0].cells.map((c) => c.normalizedValue)).toEqual(['1', 4700000.25, 500000.5, 100.125]);
    expect(summary.canConfirm).toBe(true);
  });

  it('a missing point name and missing X/Y are errors; a missing H is not', () => {
    const { table, summary } = evaluate(['Point', 'X', 'Y', 'H'], [['', '4700000', '500000', ''], ['2', '', '500001', ''], ['3', '4700002', '500002', '']]);
    expect(issuesOf(table, 0, 'point')).toContain('POINT_REQUIRED');
    expect(issuesOf(table, 1, 'x')).toContain('VALUE_REQUIRED');
    expect(table.rows[2].status).toBe('ok');
    expect(summary).toMatchObject({ rows: 3, invalid: 2, ready: 1, canConfirm: false });
  });

  it('malformed and ambiguous numbers are errors with a reason (never repaired)', () => {
    const { table } = evaluate(['Point', 'X', 'Y'], [['1', '47OO000', '500000'], ['2', '4.700', '500001'], ['3', '4700002', '5 25']]);
    expect(issuesOf(table, 0, 'x')).toContain('VALUE_INVALID');
    expect(issuesOf(table, 1, 'x')).toContain('VALUE_AMBIGUOUS');
    expect(issuesOf(table, 2, 'y')).toContain('VALUE_INVALID');
    expect(table.rows[0].cells[1].normalizedValue).toBeNull();
  });

  it('an ambiguous number is settled by the column\'s own definite cells, and only then', () => {
    const { table } = evaluate(['Point', 'X', 'Y'], [['1', '4700000,25', '500000,5'], ['2', '4700001,5', '500,123'], ['3', '4700002,5', '500001,5']]);
    expect(table.rows[1].cells[2].normalizedValue).toBe(500.123);
    // readable only through the column's format -> a review WARNING, never a silent accept
    expect(table.rows[1].cells[2].validation.issues.map((i) => i.code)).toEqual(['FORMAT_INFERRED']);
    expect(table.rows[1].cells[2].validation.status).toBe('warning');
  });

  it('duplicate point identifiers inside the capture are errors on every occurrence (case-insensitive)', () => {
    const { table, summary } = evaluate(['Point', 'X', 'Y'], [['A1', '4700000', '500000'], ['a1 ', '4700001', '500001'], ['A2', '4700002', '500002']]);
    expect(issuesOf(table, 0, 'point')).toContain('DUPLICATE_POINT');
    expect(issuesOf(table, 1, 'point')).toContain('DUPLICATE_POINT');
    expect(issuesOf(table, 2, 'point')).not.toContain('DUPLICATE_POINT');
    expect(summary.canConfirm).toBe(false);
  });

  it('low OCR confidence is a WARNING (review suggested), and a user correction counts as reviewed', () => {
    // a single moderate-confidence reading (no re-recognition ran: this test calls evaluateTable directly): the
    // V2.2 arbitration layer keeps this a warning, not a block (0.5 <= confidence < accept threshold).
    const layoutOpts = { confidence: (r, c) => (r === 1 && c === 1 ? 0.7 : 0.99) };
    const { table: base } = build(['Point', 'X', 'Y'], [['1', '4700000', '500000'], ['2', '4700001', '500001']], layoutOpts);
    const first = evaluateTable(base);
    expect(issuesOf(first.table, 1, 'x')).toContain('LOW_CONFIDENCE');
    expect(first.table.rows[1].status).toBe('warning');
    expect(first.summary).toMatchObject({ ready: 1, review: 1, invalid: 0, canConfirm: true });

    const corrected = structuredClone(base);
    corrected.rows[1].cells[1].userValue = '4700001';
    const second = evaluateTable(corrected);
    expect(issuesOf(second.table, 1, 'x')).not.toContain('LOW_CONFIDENCE');
    expect(cellReviewState(second.table.rows[1].cells[1])).toBe('edited');
  });

  it('V2.2: a single VERY low-confidence reading (<0.5, no corroborating pass) is UNCERTAIN and BLOCKS confirmation until reviewed', () => {
    const layoutOpts = { confidence: (r, c) => (r === 1 && c === 1 ? 0.2 : 0.99) };
    const { table: base } = build(['Point', 'X', 'Y'], [['1', '4700000', '500000'], ['2', '4700001', '500001']], layoutOpts);
    const first = evaluateTable(base);
    expect(issuesOf(first.table, 1, 'x')).toContain('RECOGNITION_UNCERTAIN');
    expect(first.table.rows[1].status).toBe('error');
    expect(first.summary.canConfirm).toBe(false);
    expect(first.table.rows[1].cells[1].arbitration).toMatchObject({ outcome: 'UNCERTAIN' });

    // an explicit user correction resolves it, exactly like any other correction
    const corrected = structuredClone(base);
    corrected.rows[1].cells[1].userValue = '4700001';
    const second = evaluateTable(corrected);
    expect(issuesOf(second.table, 1, 'x')).not.toContain('RECOGNITION_UNCERTAIN');
    expect(second.summary.canConfirm).toBe(true);
  });

  it('inconsistent decimal separators in one column are flagged (warning) on the minority cells', () => {
    const { table } = evaluate(['Point', 'X', 'Y'], [['1', '4700000,25', '500000'], ['2', '4700001,5', '500001'], ['3', '4700002.75', '500002']]);
    expect(issuesOf(table, 2, 'x')).toContain('DECIMAL_SEPARATOR_MIXED');
    expect(issuesOf(table, 0, 'x')).not.toContain('DECIMAL_SEPARATOR_MIXED');
  });

  it('review states: accepted / review / invalid / edited each map from the validation result', () => {
    const cell = (status, userValue = null) => ({ validation: { status }, userValue });
    expect(cellReviewState(cell('ok'))).toBe('accepted');
    expect(cellReviewState(cell('warning'))).toBe('review');
    expect(cellReviewState(cell('error'))).toBe('invalid');
    expect(cellReviewState(cell('ok', '5'))).toBe('edited');
  });

  it('required columns must be mapped', () => {
    const { table, summary } = evaluate(['Point', 'X'], [['1', '4700000'], ['2', '4700001']]);
    expect(table.issues.find((i) => i.code === 'MISSING_COLUMN' && i.semantic === 'y')).toBeTruthy();
    expect(summary.canConfirm).toBe(false);
  });
});

describe('CRS-justified plausibility and X/Y swap (warnings only, nothing is swapped)', () => {
  const rows = [['1', '4700000', '600000'], ['2', '4700100', '600100']];
  const swapped = [['1', '600000', '4700000'], ['2', '600100', '4700100']];
  const evalWith = (r, crs) => evaluateTable(build(['Point', 'X', 'Y'], r).table, { crs });
  const codes = (table, r, semantic) => table.rows[r].cells.find((c) => c.semanticType === semantic).validation.issues.map((i) => i.code);

  it('correct X/Y in a Bulgarian UTM CRS: no warning', () => {
    const { table, summary } = evalWith(rows, 'EPSG:7799');
    expect(codes(table, 0, 'x')).toEqual([]);
    expect(summary.review).toBe(0);
  });

  it('X and Y swapped: WARNING on both cells, values untouched, import still possible', () => {
    const { table, summary, rows: out } = evalWith(swapped, 'EPSG:7799');
    expect(codes(table, 0, 'x')).toContain('POSSIBLE_XY_SWAP');
    expect(codes(table, 0, 'y')).toContain('POSSIBLE_XY_SWAP');
    expect(table.rows[0].cells[1].validation.status).toBe('warning');
    expect(table.rows[0].cells[1].normalizedValue).toBe(600000); // NOT swapped
    expect(summary.canConfirm).toBe(true);
    expect(out[0]).toMatchObject({ x: 600000, y: 4700000 });
  });

  it('a value outside the CRS extent is an OUT_OF_CRS_EXTENT warning (e.g. a dropped digit)', () => {
    const { table } = evalWith([['1', '470000', '600000'], ['2', '4700100', '600100']], 'EPSG:7799');
    expect(codes(table, 0, 'x')).toContain('OUT_OF_CRS_EXTENT');
  });

  it('no universal range is assumed: an unknown CRS, no CRS, or EPSG:7801 (no safe extent) give no plausibility warnings', () => {
    for (const crs of [null, undefined, 'EPSG:7801', 'EPSG:9999']) {
      const { table } = evalWith(swapped, crs);
      expect(codes(table, 0, 'x')).toEqual([]);
    }
  });
});
