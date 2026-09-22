const { buildCoordinateListReportModel } = require('../coordinateListReportModel');

const project = () => ({ _id: 'proj1', name: 'Обект Витоша', crs: 'EPSG:7801' });
const generatedBy = () => ({ id: 'user1', name: 'Иван Иванов' });
const generatedAt = () => new Date('2026-09-22T10:00:00Z');

const points = () => [
  { _id: 'pt1', name: 'A1', code: 'GB', x: 4700030.123, y: 500050.456, h: 120.789, notes: '' },
  { _id: 'pt2', name: '201', code: '', x: 4700100, y: 500100, h: null, source: { kind: 'field-processing', processingType: 'polar' } },
  { _id: 'pt3', name: '102', code: '', x: 4700200, y: 500200, h: 130, source: { kind: 'field-processing', processingType: 'traverse' } },
  { _id: 'pt4', name: 'CAP1', code: '', x: 4700300, y: 500300, h: 140, source: { kind: 'capture' } },
  { _id: 'pt5', name: 'CALC1', code: '', x: 4700400, y: 500400, h: 150, sourceCalculationId: 'calc1' },
];

describe('buildCoordinateListReportModel: a numbered register, snapshotted at generation time', () => {
  it('numbers rows sequentially (№) and carries X/Y/H through unchanged', () => {
    const model = buildCoordinateListReportModel({ project: project(), points: points(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(model.reportType).toBe('PROJECT_COORDINATE_LIST');
    expect(model.pointCount).toBe(5);
    expect(model.points[0]).toMatchObject({ no: 1, name: 'A1', code: 'GB', x: 4700030.123, y: 500050.456, h: 120.789 });
    expect(model.points[1].no).toBe(2);
  });

  it('labels source type in professional Bulgarian for each provenance kind', () => {
    const model = buildCoordinateListReportModel({ project: project(), points: points(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(model.points[0].sourceType).toBe('Ръчно въведена'); // no source at all -> manual
    expect(model.points[1].sourceType).toContain('полярна');
    expect(model.points[2].sourceType).toContain('полигонов ход');
    expect(model.points[3].sourceType).toBe('От заснемане');
    expect(model.points[4].sourceType).toBe('От изчисление');
  });

  it('a missing height is null, never a fabricated 0', () => {
    const model = buildCoordinateListReportModel({ project: project(), points: points(), generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(model.points[1].h).toBeNull();
  });

  it('is a true snapshot: later mutating the source points array/objects never changes an already-built model', () => {
    const src = points();
    const model = buildCoordinateListReportModel({ project: project(), points: src, generatedBy: generatedBy(), generatedAt: generatedAt() });
    src[0].x = 999999; // mutate the SOURCE after building
    src.push({ _id: 'ptNew', name: 'NEW', code: '', x: 1, y: 1, h: 1 });
    expect(model.points[0].x).toBe(4700030.123); // unchanged
    expect(model.pointCount).toBe(5); // unchanged
  });

  it('an empty project has zero points, not an error', () => {
    const model = buildCoordinateListReportModel({ project: project(), points: [], generatedBy: generatedBy(), generatedAt: generatedAt() });
    expect(model.pointCount).toBe(0);
    expect(model.points).toEqual([]);
  });
});
