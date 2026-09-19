const SurveyPoint = require('../SurveyPoint');

describe('SurveyPoint.sourceCalculationId (Milestone 1.1)', () => {
  const base = { user: '507f1f77bcf86cd799439011', name: 'P', x: 1, y: 2 };

  it('ordinary points leave the field absent (not null) and remain valid — unlimited of them', () => {
    const a = new SurveyPoint(base);
    const b = new SurveyPoint({ ...base, name: 'Q' });
    expect(a.validateSync()).toBeUndefined();
    expect(b.validateSync()).toBeUndefined();
    expect(a.sourceCalculationId).toBeUndefined();
    expect(a.toObject()).not.toHaveProperty('sourceCalculationId');
  });

  it('a generated point carries its source calculation', () => {
    const p = new SurveyPoint({ ...base, sourceCalculationId: '507f1f77bcf86cd799439022' });
    expect(p.validateSync()).toBeUndefined();
    expect(String(p.sourceCalculationId)).toBe('507f1f77bcf86cd799439022');
  });

  it('is protected by a PARTIAL unique index that only covers ObjectId values', () => {
    const idx = SurveyPoint.schema.indexes().find(([fields]) => fields.sourceCalculationId === 1);
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
    expect(idx[1].partialFilterExpression).toEqual({ sourceCalculationId: { $type: 'objectId' } });
    // partial, not a plain unique/sparse index: null/absent values are never indexed
    expect(idx[1].sparse).toBeUndefined();
  });
});
