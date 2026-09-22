const { buildPolarReportModel } = require('../polarReportModel');

const run = () => ({
  _id: 'run1',
  source: { fieldObservationSetId: 'fos1', captureJobId: 'job1' },
  processingVersion: 'field-processing-2.4.2.0',
  engineVersions: { 'orientation-constant': 1, 'polar-horizontal': 1 },
  verticalAngleConvention: 'zenith',
  setups: [
    {
      index: 0,
      station: { identifier: '101', point: { id: 'p101', name: '101', code: '', x: 1000, y: 2000, h: 500 } },
      orientation: { identifier: '102', point: { id: 'p102', name: '102', code: '', x: 1000, y: 2100, h: 500 } },
      orientationConstantGon: 100,
      setupError: null,
      observations: [
        { index: 0, target: '201', status: 'READY', x: 1000, y: 2050, h: 499.5, direction: 100, horizontalDistance: 50, heightReason: null, errors: [], warnings: [] },
        { index: 1, target: '202', status: 'XY_ONLY', x: 1030, y: 2000, h: null, direction: 0, horizontalDistance: 30, heightReason: 'PRISM_HEIGHT_MISSING', errors: [], warnings: [{ code: 'PRISM_HEIGHT_MISSING', message: 'Липсва височина на призмата.' }] },
      ],
    },
  ],
});

const fos = () => ({
  setups: [
    {
      index: 0,
      station: { instrumentHeight: { value: 1.5, unit: 'm' } },
      observations: [
        { row: 0, target: '201', hz: { value: 0, unit: 'gon' }, vz: { value: 100, unit: 'gon' }, distance: { value: 50, unit: 'm' }, horizontalDistance: null, prismHeight: { value: 2.0, unit: 'm' } },
        { row: 1, target: '202', hz: { value: 300, unit: 'gon' }, vz: { value: 100, unit: 'gon' }, distance: { value: 30, unit: 'm' }, horizontalDistance: null, prismHeight: null },
      ],
    },
  ],
});

const project = () => ({ _id: 'proj1', name: 'Обект Витоша', crs: 'EPSG:7801' });
const generatedBy = () => ({ id: 'user1', name: 'Иван Иванов' });
const generatedAt = () => new Date('2026-09-22T10:00:00Z');

describe('buildPolarReportModel: a pure snapshot, never a recalculation', () => {
  it('carries project/source/generation metadata through unchanged', () => {
    const model = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt(), documentNumber: 'DOC-1' });
    expect(model.reportType).toBe('POLAR_PROCESSING_REPORT');
    expect(model.title).toContain('полярна');
    expect(model.documentNumber).toBe('DOC-1');
    expect(model.project).toEqual({ id: 'proj1', name: 'Обект Витоша', crs: 'EPSG:7801' });
    expect(model.source).toMatchObject({ fieldObservationSetId: 'fos1', captureJobId: 'job1', processingRunId: 'run1', processingVersion: 'field-processing-2.4.2.0' });
  });

  it('uses the run\'s OWN persisted X/Y/H/status, never recomputes them', () => {
    const model = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    const obs201 = model.setups[0].observations[0];
    expect(obs201).toMatchObject({ target: '201', x: 1000, y: 2050, h: 499.5, status: 'READY' });
  });

  it('joins raw Hz/slope-distance/prism-height from the source FieldObservationSet by (setup, row)', () => {
    const model = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    const obs201 = model.setups[0].observations[0];
    expect(obs201.hz).toEqual({ value: 0, unit: 'gon' });
    expect(obs201.slopeDistance).toEqual({ value: 50, unit: 'm' });
    expect(obs201.heightDetail).toMatchObject({ stationH: 500, derivedH: 499.5 });
    expect(obs201.heightDetail.instrumentHeight).toEqual({ value: 1.5, unit: 'm' });
    expect(obs201.heightDetail.prismHeight).toEqual({ value: 2.0, unit: 'm' });
  });

  it('an observation with unavailable height gets no heightDetail block, but keeps its heightReason', () => {
    const model = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    const obs202 = model.setups[0].observations[1];
    expect(obs202.h).toBeNull();
    expect(obs202.heightDetail).toBeNull();
    expect(obs202.heightReason).toBe('PRISM_HEIGHT_MISSING');
  });

  it('a setup-level error blocks the whole setup, reflected verbatim from the run', () => {
    const blockedRun = run();
    blockedRun.setups[0].setupError = 'STATION_MISSING';
    const model = buildPolarReportModel({ run: blockedRun, fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(model.setups[0].setupError).toBe('STATION_MISSING');
  });

  it('is deterministic: the same inputs produce the identical model', () => {
    const a = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    const b = buildPolarReportModel({ run: run(), fos: fos(), project: project(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(a).toEqual(b);
  });
});
