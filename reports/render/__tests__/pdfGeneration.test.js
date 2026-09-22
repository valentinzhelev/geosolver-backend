const pdfParse = require('pdf-parse');
const { buildPolarReportModel } = require('../../modelBuilders/polarReportModel');
const { buildTraverseReportModel } = require('../../modelBuilders/traverseReportModel');
const { buildCoordinateListReportModel } = require('../../modelBuilders/coordinateListReportModel');
const { renderPolarReport } = require('../renderPolarReport');
const { renderTraverseReport } = require('../renderTraverseReport');
const { renderCoordinateListReport } = require('../renderCoordinateListReport');
const { generatePdfBuffer } = require('../pdf');

jest.setTimeout(30000);

const project = { _id: 'proj1', name: 'Обект Витоша', crs: 'EPSG:7801' };
const generatedBy = { id: 'user1', name: 'Иван Иванов' };
const generatedAt = new Date('2026-09-22T10:00:00Z');

const PDF_SIGNATURE = '%PDF-';

function polarRunFixture() {
  return {
    _id: 'run1', source: { fieldObservationSetId: 'fos1', captureJobId: 'job1' },
    processingVersion: 'field-processing-2.4.2.0', engineVersions: { 'orientation-constant': 1, 'polar-horizontal': 1 }, verticalAngleConvention: 'zenith',
    setups: [{
      index: 0,
      station: { identifier: '101', point: { id: 'p101', name: '101', code: '', x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '102', point: { id: 'p102', name: '102', code: '', x: 1000, y: 2100, h: 500 } },
      orientationConstantGon: 100, setupError: null,
      observations: [
        { index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, heightReason: null, errors: [], warnings: [] },
        { index: 1, target: '202', status: 'XY_ONLY', x: 1030, y: 2000, h: null, direction: 0, horizontalDistance: 30, heightReason: 'PRISM_HEIGHT_MISSING', errors: [], warnings: [] },
      ],
    }],
  };
}
function polarFosFixture() {
  return {
    setups: [{
      index: 0, station: { instrumentHeight: { value: 1.5, unit: 'm' } },
      observations: [
        { row: 0, target: '201', hz: { value: 0, unit: 'gon' }, vz: { value: 100, unit: 'gon' }, distance: { value: 50, unit: 'm' }, prismHeight: { value: 2.0, unit: 'm' } },
        { row: 1, target: '202', hz: { value: 300, unit: 'gon' }, vz: { value: 100, unit: 'gon' }, distance: { value: 30, unit: 'm' }, prismHeight: null },
      ],
    }],
  };
}

function traverseLeg(i, over = {}) {
  return {
    index: i, from: `${100 + i}`, to: `${101 + i}`, status: 'READY',
    bearingGon: 0, horizontalDistance: 20, rawDeltaX: 20, rawDeltaY: 0, rawX: 1000 + i * 20, rawY: 2000, rawH: 500, heightReason: null,
    adjustedX: 1000 + i * 20 + 0.01, adjustedY: 2000, correctionX: 0.01, correctionY: 0, errors: [], warnings: [],
    ...over,
  };
}
function traverseRunFixture(legCount = 2, traverseOver = {}) {
  const legs = Array.from({ length: legCount }, (_, i) => traverseLeg(i));
  return {
    _id: 'run2', source: { fieldObservationSetId: 'fos1', captureJobId: 'job1' },
    processingVersion: 'field-processing-2.4.2.0', engineVersions: { 'traverse-bowditch': 1 }, verticalAngleConvention: 'zenith',
    traverse: {
      traverseType: 'KNOWN_ENDPOINT', startIdentifier: '100', endIdentifier: `${100 + legCount}`, status: 'READY',
      start: { identifier: '100', point: { id: 'p100', name: '100', x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '099', point: { id: 'p099', name: '099', x: 900, y: 2000, h: 500 } },
      end: { identifier: `${100 + legCount}`, point: { id: 'pEnd', name: `${100 + legCount}`, x: 1000 + legCount * 20, y: 2000, h: 500 } },
      legs,
      closure: { available: true, reason: null, totalLength: legCount * 20, fX: -0.06, fY: -0.03, linearMisclosure: 0.067, perfectClosure: false, relativeClosureDenominator: 2237 },
      adjustment: { method: 'bowditch', version: 1, applied: true, reasonNotApplied: null },
      ...traverseOver,
    },
  };
}

describe('renderPolarReport: valid, readable Cyrillic PDF', () => {
  it('produces a PDF starting with the correct signature and non-zero sensible size', async () => {
    const model = buildPolarReportModel({ run: polarRunFixture(), fos: polarFosFixture(), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderPolarReport(model, true));
    expect(buf.slice(0, 5).toString()).toBe(PDF_SIGNATURE);
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('extracted text contains the title, station identifier, and the exact persisted coordinates/status', async () => {
    const model = buildPolarReportModel({ run: polarRunFixture(), fos: polarFosFixture(), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderPolarReport(model, true));
    const { text, numpages } = await pdfParse(buf);
    expect(numpages).toBe(1);
    expect(text).toContain('Отчет за полярна обработка'); // title
    expect(text).toContain('101'); // station
    expect(text).toContain('499.500'); // exact persisted H
    expect(text).toContain('Само X/Y'); // XY_ONLY status label
    expect(text).toContain(project.name);
  });

  it('a blocked setup shows its error message, no observation table', async () => {
    const blocked = polarRunFixture();
    blocked.setups[0].setupError = 'STATION_MISSING';
    const model = buildPolarReportModel({ run: blocked, fos: polarFosFixture(), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderPolarReport(model, true));
    const { text } = await pdfParse(buf);
    expect(text).toContain('не е намерена'); // "not found" reason text
  });
});

describe('renderTraverseReport: KNOWN_ENDPOINT with Bowditch', () => {
  it('shows both raw and adjusted coordinates as distinct values, and labels Bowditch correctly (never "least squares")', async () => {
    const model = buildTraverseReportModel({ run: traverseRunFixture(2), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderTraverseReport(model, true));
    const { text } = await pdfParse(buf);
    expect(text).toContain('1000.000'); // raw X of leg 0's endpoint
    expect(text).toContain('1000.010'); // adjusted X of leg 0's endpoint
    expect(text).toContain('Bowditch');
    expect(text.toLowerCase()).not.toContain('least squares');
    expect(text.toLowerCase()).not.toContain('най-малки квадрати'.toLowerCase()); // "least squares" in Bulgarian, must not appear as a claim
  });

  it('the closure block reports the exact persisted fX/fY/misclosure', async () => {
    const model = buildTraverseReportModel({ run: traverseRunFixture(2), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderTraverseReport(model, true));
    const { text } = await pdfParse(buf);
    expect(text).toContain('-0.060'); // fX
    expect(text).toContain('-0.030'); // fY
  });
});

describe('renderTraverseReport: OPEN traverse', () => {
  it('states closure and Bowditch are not applicable, shows no Bowditch table, no adjusted coordinates', async () => {
    const run = traverseRunFixture(2, {
      traverseType: 'OPEN', endIdentifier: null, end: null,
      closure: { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null, perfectClosure: null, relativeClosureDenominator: null },
      adjustment: { method: 'bowditch', version: 1, applied: false, reasonNotApplied: 'OPEN_TRAVERSE' },
    });
    const model = buildTraverseReportModel({ run, project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderTraverseReport(model, true));
    const { text } = await pdfParse(buf);
    expect(text).toContain('не са приложими'); // "are not applicable" - explicitly names Bowditch in that sentence, which is correct
    expect(text).not.toContain('cX'); // no Bowditch correction TABLE (column headers) - the section itself is omitted
    expect(text).not.toContain('cY');
    expect(text).toContain('Не е приложимо'); // "Not applicable" in the results table's adjusted columns
  });
});

describe('pagination: long documents paginate correctly with repeated table headers', () => {
  it('a long coordinate list spans multiple pages, and the last row is still present in extracted text', async () => {
    const points = Array.from({ length: 80 }, (_, i) => ({ _id: `pt${i}`, name: `T${String(i).padStart(3, '0')}`, code: '', x: 4700000 + i, y: 500000 + i, h: 100 + i }));
    const model = buildCoordinateListReportModel({ project, points, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderCoordinateListReport(model, true));
    const { text, numpages } = await pdfParse(buf);
    expect(numpages).toBeGreaterThan(1);
    expect(text).toContain('T000'); // first row
    expect(text).toContain('T079'); // last row - never clipped off a later page
    expect(text).toContain('Общ брой точки: 80');
  });

  it('a long traverse (many legs) also paginates, with the final leg still readable', async () => {
    const model = buildTraverseReportModel({ run: traverseRunFixture(60), project, generatedBy, generatedAt });
    const buf = await generatePdfBuffer(renderTraverseReport(model, true));
    const { text, numpages } = await pdfParse(buf);
    expect(numpages).toBeGreaterThan(1);
    expect(text).toContain('100'); // first station
    expect(text).toContain('160'); // last station (100 + 60 legs)
  });
});
