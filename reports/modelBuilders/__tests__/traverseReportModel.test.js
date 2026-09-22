const { buildTraverseReportModel } = require('../traverseReportModel');

const leg = (over = {}) => ({
  index: 0, from: '101', to: '102', status: 'READY',
  bearingGon: 0, horizontalDistance: 100, rawDeltaX: 100, rawDeltaY: 0, rawX: 1100, rawY: 2000, rawH: 499.5, heightReason: null,
  adjustedX: 1100.04, adjustedY: 2000.02, correctionX: 0.04, correctionY: 0.02, errors: [], warnings: [],
  ...over,
});

const baseRun = (traverseOver = {}) => ({
  _id: 'run1',
  source: { fieldObservationSetId: 'fos1', captureJobId: 'job1' },
  processingVersion: 'field-processing-2.4.2.0',
  engineVersions: { 'traverse-propagation': 1, 'traverse-bowditch': 1 },
  verticalAngleConvention: 'zenith',
  traverse: {
    traverseType: 'KNOWN_ENDPOINT',
    startIdentifier: '101',
    endIdentifier: '103',
    status: 'READY',
    start: { identifier: '101', point: { id: 'p101', name: '101', x: 1000, y: 2000, h: 500 } },
    orientation: { identifier: '100', point: { id: 'p100', name: '100', x: 900, y: 2000, h: 500 } },
    end: { identifier: '103', point: { id: 'p103', name: '103', x: 1100.06, y: 2050.03, h: 500 } },
    legs: [leg(), leg({ index: 1, from: '102', to: '103', status: 'XY_ONLY', rawX: 1100, rawY: 2050, rawH: null, heightReason: 'PRISM_HEIGHT_MISSING', adjustedX: 1100.06, adjustedY: 2050.03, correctionX: 0.02, correctionY: 0.01 })],
    closure: { available: true, reason: null, totalLength: 150, fX: -0.06, fY: -0.03, linearMisclosure: 0.067, perfectClosure: false, relativeClosureDenominator: 2237 },
    adjustment: { method: 'bowditch', version: 1, applied: true, reasonNotApplied: null },
    ...traverseOver,
  },
});

const project = () => ({ _id: 'proj1', name: 'Обект Витоша', crs: 'EPSG:7801' });
const generatedBy = () => ({ id: 'user1', name: 'Иван Иванов' });
const generatedAt = () => new Date('2026-09-22T10:00:00Z');
const build = (traverseOver, over = {}) => buildTraverseReportModel({ run: baseRun(traverseOver), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt(), ...over });

describe('buildTraverseReportModel: KNOWN_ENDPOINT with Bowditch adjustment applied', () => {
  it('carries control snapshots, closure and adjustment verbatim from the run', () => {
    const model = build();
    expect(model.reportType).toBe('TRAVERSE_PROCESSING_REPORT');
    expect(model.traverseType).toBe('KNOWN_ENDPOINT');
    expect(model.control.start.point).toMatchObject({ name: '101', x: 1000, y: 2000 });
    expect(model.control.end.point).toMatchObject({ name: '103', x: 1100.06, y: 2050.03 });
    expect(model.closure).toEqual({ available: true, reason: null, totalLength: 150, fX: -0.06, fY: -0.03, linearMisclosure: 0.067, perfectClosure: false, relativeClosureDenominator: 2237 });
    expect(model.adjustment.method).toBe('bowditch');
  });

  it('raw and adjusted coordinates remain distinct per leg, never collapsed into one', () => {
    const model = build();
    expect(model.legs[0].rawX).toBe(1100);
    expect(model.legs[0].adjustedX).toBe(1100.04);
    expect(model.legs[0].rawX).not.toBe(model.legs[0].adjustedX);
  });

  it('Bowditch corrections (cX/cY) are present per leg', () => {
    const model = build();
    expect(model.legs[0].correctionX).toBe(0.04);
    expect(model.legs[1].correctionX).toBe(0.02);
  });
});

describe('buildTraverseReportModel: CLOSED_LOOP', () => {
  it('reports traverseType CLOSED_LOOP and a control end equal to the start (loop closure)', () => {
    const model = build({ traverseType: 'CLOSED_LOOP', endIdentifier: '101', end: { identifier: '101', point: { id: 'p101', name: '101', x: 1000, y: 2000, h: 500 } } });
    expect(model.traverseType).toBe('CLOSED_LOOP');
    expect(model.control.end.point.name).toBe('101');
  });
});

describe('buildTraverseReportModel: OPEN traverse - no closure, no adjustment applied', () => {
  it('never carries adjusted coordinates, closure is explicitly unavailable', () => {
    const model = build({
      traverseType: 'OPEN', endIdentifier: null, end: null,
      closure: { available: false, reason: 'OPEN_TRAVERSE', totalLength: null, fX: null, fY: null, linearMisclosure: null, perfectClosure: null, relativeClosureDenominator: null },
      adjustment: { method: 'bowditch', version: 1, applied: false, reasonNotApplied: 'OPEN_TRAVERSE' },
    });
    expect(model.closure.available).toBe(false);
    expect(model.closure.reason).toBe('OPEN_TRAVERSE');
    expect(model.adjustment.applied).toBe(false);
    expect(model.control.end).toBeNull();
    // even though the persisted leg still HAS adjustedX (e.g. stale/never set), the model must not surface it
    expect(model.legs.every((l) => l.adjustedX === null)).toBe(true);
    expect(model.legs.every((l) => l.correctionX === null)).toBe(true);
  });
});

describe('buildTraverseReportModel: determinism', () => {
  it('the same inputs produce the identical model', () => {
    const a = build();
    const b = build();
    expect(a).toEqual(b);
  });
});
