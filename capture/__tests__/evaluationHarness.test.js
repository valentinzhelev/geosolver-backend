/**
 * Capture evaluation harness tests, and the required synthetic acceptance benchmark:
 * "Expected synthetic false-accept rate: ZERO" (V2.2 section 18/19).
 */
const { evaluateDocument, runBenchmark, aggregateReports, aggregateByMetadata } = require('../evaluation/harness');
const { loadRealSamples } = require('../evaluation/fixtures/realSamples');
const { layoutTable, renderTableImage, stripPrivate, TRUTH } = require('../../tests/support/captureFixtures');
const { getConfig } = require('../config');

jest.setTimeout(30000);
const config = getConfig();
const HEADERS = ['Точка', 'Код', 'X', 'Y', 'H'];
const bg = (n) => (n === null ? '' : String(n));
const truthRows = () => TRUTH.map((p) => ({ point: p.name, code: p.code, x: p.x, y: p.y, h: p.h }));

/**
 * A crop-aware fixture provider: the WHOLE-PAGE (primary) call gets `mutate` applied (to inject a misread); a crop
 * call (recognized by the `dims.crop` field capture/rerecognition.js passes) instead returns the TRUE words that
 * fall inside that crop rectangle, in crop-local coordinates - a focused re-read genuinely reads the real pixels.
 */
function fixtureProvider(layout, { mutate } = {}) {
  return {
    name: 'fixture',
    version: 'test',
    async recognize(buffer, dims) {
      let words = stripPrivate(layout.words);
      if (dims && dims.crop) {
        const { x, y, w, h } = dims.crop;
        words = words
          .filter((word) => {
            const cx = word.bbox.x + word.bbox.w / 2;
            const cy = word.bbox.y + word.bbox.h / 2;
            return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
          })
          .map((word) => ({ ...word, bbox: { ...word.bbox, x: word.bbox.x - x, y: word.bbox.y - y } }));
      } else if (mutate) {
        words = mutate(words, dims);
      }
      return { provider: { name: 'fixture', version: 'test' }, page: { index: 0, width: dims.width, height: dims.height, words } };
    },
  };
}

/** @param {(words) => words} mutateWholePage only applied to the WHOLE-PAGE (primary) recognize call. */
async function buildDocument({ mutateWholePage, metadata } = {}) {
  const rows = TRUTH.map((p) => [p.name, p.code, bg(p.x), bg(p.y), bg(p.h)]);
  const layout = layoutTable({ headers: HEADERS, rows });
  const image = await renderTableImage(layout);
  return { image, groundTruth: { rows: truthRows() }, provider: fixtureProvider(layout, { mutate: mutateWholePage }), metadata: { source: 'synthetic', handwriting: 'printed', capture: 'scan', lighting: 'good', orientation: 'upright', ...metadata } };
}

describe('evaluateDocument: a clean, correctly-read document', () => {
  it('detects the table, reconstructs every row and column, and has zero false accepts', async () => {
    const doc = await buildDocument();
    const report = await evaluateDocument({ ...doc, config });
    expect(report.tableDetected).toBe(true);
    expect(report.rowReconstructionAccuracy).toBe(1);
    expect(report.columnMappingAccuracy).toBe(1);
    expect(report.exactNumericValueAccuracy).toBe(1);
    expect(report.falseAcceptedCells).toBe(0);
    expect(report.falseAcceptRate).toBe(0);
    expect(report.acceptedCells).toBeGreaterThan(0);
    expect(report.metadata.source).toBe('synthetic');
  });

  it('a document with no table at all is reported honestly (not a crash, not a silent pass)', async () => {
    const blank = await require('sharp')({ create: { width: 400, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
    const report = await evaluateDocument({
      image: blank, groundTruth: { rows: [{ point: 'P1', x: 1, y: 2 }] },
      provider: { name: 'fixture', version: 'test', recognize: async () => ({ provider: { name: 'fixture', version: 'test' }, page: { index: 0, width: 1, height: 1, words: [] } }) },
      config,
    });
    expect(report.tableDetected).toBe(false);
    expect(report.missedCells).toBeGreaterThan(0);
    expect(report.falseAcceptRate).toBe(0);
  });
});

describe('evaluateDocument: recognition problems are never silently accepted (the false-accept-rate promise)', () => {
  it('a LOW-CONFIDENCE misread is caught: never counted as a false accept', async () => {
    const doc = await buildDocument({
      mutateWholePage: (words) => words.map((w) => (w.text === String(TRUTH[1].x) ? { ...w, text: '600100.5', confidence: 0.3 } : w)),
      metadata: { notes: 'low-confidence digit misread' },
    });
    const report = await evaluateDocument({ ...doc, config });
    expect(report.falseAcceptedCells).toBe(0);
    expect(report.falseAcceptRate).toBe(0);
    // the wrong cell must have been flagged for review (or blocked outright), never silently trusted
    expect(report.uncertainCells + report.invalidCells + report.reviewCells).toBeGreaterThan(0);
  });

  it('a letter/digit look-alike misread (O for 0) is caught via the generated-alternative path, never accepted', async () => {
    const doc = await buildDocument({
      mutateWholePage: (words) => words.map((w) => (w.text === String(TRUTH[0].x) ? { ...w, text: '47O0000.25', confidence: 0.95 } : w)),
      metadata: { notes: 'O/0 look-alike misread' },
    });
    const report = await evaluateDocument({ ...doc, config });
    expect(report.falseAcceptedCells).toBe(0);
    expect(report.falseAcceptRate).toBe(0);
  });
});

describe('runBenchmark: synthetic acceptance benchmark - false-accept rate MUST be zero', () => {
  it('aggregates a batch of clean + adversarial documents with a zero false-accept rate', async () => {
    const clean = await buildDocument();
    const lowConfidence = await buildDocument({ mutateWholePage: (words) => words.map((w) => (w.text === String(TRUTH[1].y) ? { ...w, text: '900050.75', confidence: 0.25 } : w)) });
    const lookalike = await buildDocument({ mutateWholePage: (words) => words.map((w) => (w.text === String(TRUTH[2].x) ? { ...w, text: '47O0200', confidence: 0.9 } : w)) });
    const nullConfidence = await buildDocument({ mutateWholePage: (words) => words.map((w) => (w.text === String(TRUTH[3].h) ? { ...w, text: '199.875', confidence: null } : w)) });

    const aggregate = await runBenchmark([clean, lowConfidence, lookalike, nullConfidence], { config });
    expect(aggregate.documents).toBe(4);
    expect(aggregate.tableDetectionRate).toBe(1);
    expect(aggregate.falseAcceptedCells).toBe(0);
    expect(aggregate.falseAcceptRate).toBe(0);
    expect(aggregate.acceptedCells).toBeGreaterThan(0);
    expect(aggregate.perDocument).toHaveLength(4);
  });
});

describe('aggregateReports', () => {
  it('sums counts and averages ratios across documents, ignoring documents with no value for a ratio', () => {
    const agg = aggregateReports([
      { tableDetected: true, rowReconstructionAccuracy: 1, columnMappingAccuracy: 1, exactNumericValueAccuracy: 1, acceptedCells: 4, falseAcceptedCells: 0, uncertainCells: 0, invalidCells: 0, missedCells: 0, checkedCells: 4 },
      { tableDetected: false, rowReconstructionAccuracy: 0, columnMappingAccuracy: null, exactNumericValueAccuracy: null, acceptedCells: 0, falseAcceptedCells: 0, uncertainCells: 0, invalidCells: 0, missedCells: 3, checkedCells: 0 },
    ]);
    expect(agg.documents).toBe(2);
    expect(agg.tableDetectionRate).toBe(0.5);
    expect(agg.columnMappingAccuracy).toBe(1); // only the first document had a value
    expect(agg.missedCells).toBe(3);
    expect(agg.falseAcceptRate).toBe(0);
  });
});

describe('aggregateByMetadata: slicing a benchmark by metadata (e.g. printed vs handwritten)', () => {
  it('buckets and aggregates separately per metadata value, so one weak bucket cannot hide behind a strong one', async () => {
    const printed = await buildDocument({ metadata: { handwriting: 'printed' } });
    // synthetic fixtures cannot actually render handwriting (see the honesty note below): this only proves the
    // SLICING mechanism works, not that GeoSolver has any measured handwriting accuracy.
    const labelledHandwritten = await buildDocument({ metadata: { handwriting: 'handwritten' } });
    const reports = [await evaluateDocument({ ...printed, config }), await evaluateDocument({ ...labelledHandwritten, config })];
    const byHandwriting = aggregateByMetadata(reports, 'handwriting');
    expect(Object.keys(byHandwriting).sort()).toEqual(['handwritten', 'printed']);
    expect(byHandwriting.printed.documents).toBe(1);
    expect(byHandwriting.handwritten.documents).toBe(1);
  });

  it('a document with no value for the key is bucketed under "unknown", not dropped', () => {
    const agg = aggregateByMetadata([{ metadata: {}, acceptedCells: 1, falseAcceptedCells: 0 }], 'handwriting');
    expect(Object.keys(agg)).toEqual(['unknown']);
  });
});

describe('HONESTY NOTE (V2.2 section 13): synthetic fixtures cannot measure real handwriting accuracy', () => {
  it('the synthetic fixture renderer draws geometric placeholders, not glyphs - it cannot stand in for real handwritten samples', async () => {
    // tests/support/captureFixtures.js renders dark RECTANGLES per word (see renderTableImage), not actual character
    // shapes. This is why V2.2 never asserts a handwriting accuracy NUMBER from these fixtures: doing so would be
    // exactly the "tune against synthetic examples and call it production accuracy" the spec forbids. The metadata
    // tag and aggregateByMetadata exist so a REAL, labelled sample set (capture/evaluation/fixtures/real/, see
    // manifest.schema.json) can report this honestly once it exists - see the V2.2 final report, section O.
    const doc = await buildDocument({ metadata: { handwriting: 'handwritten' } });
    const report = await evaluateDocument({ ...doc, config });
    // the pipeline still runs end-to-end (nothing crashes on the metadata tag) - that is all this proves
    expect(report.tableDetected).toBe(true);
  });
});

describe('loadRealSamples: opt-in, gitignored, never required', () => {
  it('returns [] when no manifest exists (the default state of a fresh checkout)', () => {
    expect(loadRealSamples('/definitely/not/a/real/path')).toEqual([]);
  });
});
