/**
 * Capture evaluation harness (V2.2).
 *
 * Runs the REAL deterministic pipeline (preprocess -> provider.recognize -> reconstruct -> bounded re-recognition
 * -> arbitration -> validation, exactly what capture/jobService.js does) against a document with KNOWN ground
 * truth, and reports how well it did. Works with a fixture provider in CI (no live OCR ever required) and can be
 * pointed at a real provider locally when credentials are intentionally supplied - the harness itself does not care
 * which provider it is given.
 *
 * The single most important number this produces is the FALSE ACCEPT RATE: how often GeoSolver marked a cell
 * "accepted" (trustworthy, cellReviewState === 'accepted') while its value was actually wrong. That is exactly the
 * mistake the product rule forbids, so it is reported first and worst-case (see `report.falseAcceptRate`).
 */
const { inspectImage, preprocessImage } = require('../preprocess');
const { reconstructTable } = require('../reconstruct');
const { rerecognizeUncertainCells, fieldsFromTable } = require('../rerecognition');
const { evaluateTable, cellReviewState } = require('../validation');
const { getConfig } = require('../config');

const NUMERIC = ['x', 'y', 'h'];
const norm = (s) => String(s == null ? '' : s).trim();
const normLower = (s) => norm(s).toLowerCase();
const numbersClose = (a, b, eps = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;

/** True when the cell's INTERPRETED value equals the ground-truth value for its semantic field. */
function valueMatches(semantic, cellValue, truthValue) {
  if (truthValue === undefined) return true; // the ground truth does not assert this field: nothing to check
  if (NUMERIC.includes(semantic)) {
    if (truthValue === null) return cellValue === null || cellValue === undefined;
    return numbersClose(cellValue, truthValue);
  }
  if (semantic === 'point') return normLower(cellValue) === normLower(truthValue);
  if (semantic === 'code' || semantic === 'notes') return norm(cellValue || '') === norm(truthValue || '');
  return true;
}

/**
 * @param {{image: Buffer, groundTruth: {rows: object[]}, metadata?: object, provider: object, crs?: string|null, config?: object}} input
 *   `groundTruth.rows[i]` has the fields that matter, e.g. { point, code, x, y, h, notes, rawText? }. `rawText` per
 *   field is optional: when given, it is compared against the cell's OCR rawText (exact-text accuracy); otherwise
 *   only the semantic VALUE is checked (numeric-value / identifier accuracy).
 * @returns {Promise<object>} the per-document report
 */
async function evaluateDocument(input) {
  const config = input.config || getConfig();
  const provider = input.provider;
  const truthRows = (input.groundTruth && input.groundTruth.rows) || [];
  const expectedCells = truthRows.reduce((n, r) => n + Object.keys(r).filter((k) => k !== 'rawText').length, 0);

  const report = {
    metadata: input.metadata || {},
    tableDetected: false,
    expectedRows: truthRows.length,
    reconstructedRows: 0,
    matchedRows: 0,
    rowReconstructionAccuracy: 0,
    columnMappingAccuracy: null,
    exactCellTextAccuracy: null,
    exactNumericValueAccuracy: null,
    falseAcceptedCells: 0,
    falseAcceptedDetail: [],
    uncertainCells: 0,
    reviewCells: 0,
    invalidCells: 0,
    missedCells: 0,
    correctedAfterReviewCount: 0, // not measured by this automated harness (requires a human review session)
    acceptedCells: 0,
    checkedCells: 0,
    falseAcceptRate: 0,
  };

  const inspected = await inspectImage(input.image, config);
  const pre = await preprocessImage(input.image, config, inspected);
  const recognized = await provider.recognize(pre.ocr.buffer, { width: pre.ocr.width, height: pre.ocr.height });
  const { table } = reconstructTable(recognized.page, { provider: recognized.provider.name });
  if (!table) {
    report.missedCells = expectedCells;
    return report;
  }
  report.tableDetected = true;

  await rerecognizeUncertainCells(fieldsFromTable(table), pre.review.buffer, { width: pre.review.width, height: pre.review.height }, provider, config.rerecognition);
  const evaluated = evaluateTable(table, { crs: input.crs || null, confidenceThreshold: config.confidenceThreshold, arbitration: config.arbitration });
  const dataRows = evaluated.table.rows.filter((r) => !r.skipped && !r.excluded);
  report.reconstructedRows = dataRows.length;

  const cellAt = (row, semantic) => row.cells.find((c) => c.semanticType === semantic) || null;
  const expectedSemantics = new Set();
  truthRows.forEach((r) => Object.keys(r).forEach((k) => k !== 'rawText' && expectedSemantics.add(k)));
  let columnHits = 0;
  for (const semantic of expectedSemantics) {
    if (evaluated.table.columns.some((c) => c.semantic === semantic)) columnHits += 1;
  }
  report.columnMappingAccuracy = expectedSemantics.size ? columnHits / expectedSemantics.size : null;

  let textChecked = 0;
  let textCorrect = 0;
  let numericChecked = 0;
  let numericCorrect = 0;

  truthRows.forEach((truth, i) => {
    const row = dataRows[i];
    if (!row) {
      report.missedCells += Object.keys(truth).filter((k) => k !== 'rawText').length;
      return;
    }
    report.matchedRows += 1;
    for (const [semantic, truthValue] of Object.entries(truth)) {
      if (semantic === 'rawText') continue;
      const cell = cellAt(row, semantic);
      if (!cell) {
        report.missedCells += 1;
        continue;
      }
      report.checkedCells += 1;
      const state = cellReviewState(cell);
      if (state === 'invalid') report.invalidCells += 1;
      if (state === 'review') report.reviewCells += 1;
      if (cell.arbitration && cell.arbitration.outcome === 'UNCERTAIN') report.uncertainCells += 1;

      const ok = valueMatches(semantic, cell.normalizedValue, truthValue);
      if (NUMERIC.includes(semantic)) {
        numericChecked += 1;
        if (ok) numericCorrect += 1;
      }
      if (truth.rawText !== undefined) {
        textChecked += 1;
        if (norm(cell.rawText) === norm(truth.rawText)) textCorrect += 1;
      }

      // THE key metric: a cell GeoSolver presented as trustworthy (accepted) but whose value is wrong.
      if (state === 'accepted') {
        report.acceptedCells += 1;
        if (!ok) {
          report.falseAcceptedCells += 1;
          report.falseAcceptedDetail.push({ row: i, semantic, expected: truthValue, got: cell.normalizedValue, rawText: cell.rawText });
        }
      }
    }
  });

  report.rowReconstructionAccuracy = truthRows.length ? report.matchedRows / truthRows.length : 1;
  report.exactCellTextAccuracy = textChecked ? textCorrect / textChecked : null;
  report.exactNumericValueAccuracy = numericChecked ? numericCorrect / numericChecked : null;
  // false-accept RATE = wrongly-trusted cells / all cells GeoSolver told the user were trustworthy. An empty
  // "accepted" set has an undefined rate, not a false one: report 0 (there was nothing to be wrong about).
  report.falseAcceptRate = report.acceptedCells ? report.falseAcceptedCells / report.acceptedCells : 0;
  return report;
}

/** Aggregates per-document reports into one summary. Sums counts; averages the accuracy ratios over documents that had a value. */
function aggregateReports(reports) {
  const sum = (key) => reports.reduce((s, r) => s + (r[key] || 0), 0);
  const avg = (key) => {
    const vals = reports.map((r) => r[key]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const acceptedCells = sum('acceptedCells');
  const falseAcceptedCells = sum('falseAcceptedCells');
  return {
    documents: reports.length,
    tableDetectionRate: reports.length ? reports.filter((r) => r.tableDetected).length / reports.length : 0,
    rowReconstructionAccuracy: avg('rowReconstructionAccuracy'),
    columnMappingAccuracy: avg('columnMappingAccuracy'),
    exactCellTextAccuracy: avg('exactCellTextAccuracy'),
    exactNumericValueAccuracy: avg('exactNumericValueAccuracy'),
    acceptedCells,
    falseAcceptedCells,
    falseAcceptRate: acceptedCells ? falseAcceptedCells / acceptedCells : 0,
    uncertainCells: sum('uncertainCells'),
    reviewCells: sum('reviewCells'),
    invalidCells: sum('invalidCells'),
    missedCells: sum('missedCells'),
    checkedCells: sum('checkedCells'),
    perDocument: reports,
  };
}

/** @param {{image,groundTruth,metadata,provider,crs?}[]} documents */
async function runBenchmark(documents, { config } = {}) {
  const reports = [];
  for (const doc of documents) reports.push(await evaluateDocument({ ...doc, config }));
  return aggregateReports(reports);
}

/**
 * Buckets per-document reports by a metadata field (e.g. 'handwriting': 'printed'|'handwritten'|'mixed') and
 * aggregates each bucket separately - so a benchmark run over a mixed batch can honestly report, say, printed vs
 * handwritten accuracy instead of one blended number that hides the weaker case. A document whose metadata lacks
 * the field is bucketed under 'unknown'.
 * @param {object[]} reports per-document reports (e.g. from evaluateDocument, or aggregate.perDocument)
 * @param {string} metadataKey
 * @returns {Object<string, object>} { [value]: aggregateReport }
 */
function aggregateByMetadata(reports, metadataKey) {
  const buckets = new Map();
  for (const r of reports) {
    const value = (r.metadata && r.metadata[metadataKey]) ?? 'unknown';
    (buckets.get(value) || buckets.set(value, []).get(value)).push(r);
  }
  const out = {};
  for (const [value, group] of buckets) out[value] = aggregateReports(group);
  return out;
}

module.exports = { evaluateDocument, aggregateReports, runBenchmark, aggregateByMetadata };
