const Calculation = require('../Calculation');

describe('Calculation schema — Milestone 1 backward compatibility', () => {
  it('a legacy-shaped document (no projectId/engineVersion/referencedPoints/crs) constructs without error and is not defaulted to version 1', () => {
    const legacy = new Calculation({
      userId: '507f1f77bcf86cd799439011',
      toolName: 'first-basic-task',
      toolDisplayName: { bg: 'Първа задача', en: 'First task' },
      inputData: { y1: 1, x1: 1, alpha: 1, s: 1 },
      resultData: { y2: 2, x2: 2 },
    });

    const err = legacy.validateSync();
    expect(err).toBeUndefined();

    // Do NOT default old documents to engineVersion 1 — must remain unset.
    expect(legacy.engineVersion).toBeUndefined();
    expect(legacy.projectId).toBeNull();
    expect(legacy.crs).toBeNull();
    expect(legacy.referencedPoints).toEqual([]);
  });

  it('a new project calculation with an explicit engineVersion and referencedPoints validates correctly', () => {
    const doc = new Calculation({
      userId: '507f1f77bcf86cd799439011',
      toolName: 'resection',
      toolDisplayName: { bg: 'Обратна засечка', en: 'Resection' },
      inputData: {},
      resultData: {},
      projectId: '507f1f77bcf86cd799439022',
      engineVersion: 1,
      crs: 'EPSG:7801',
      referencedPoints: [{
        pointId: '507f1f77bcf86cd799439033',
        role: 'stationA',
        name: 'P1',
        code: 'C1',
        x: 1, y: 2, h: 3,
      }],
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.engineVersion).toBe(1);
    expect(String(doc.projectId)).toBe('507f1f77bcf86cd799439022');
    expect(doc.referencedPoints[0].role).toBe('stationA');
  });
});
