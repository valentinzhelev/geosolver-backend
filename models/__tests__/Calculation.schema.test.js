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

describe('Calculation schema — canonical engine fields (Milestone 2)', () => {
  const base = {
    userId: '507f1f77bcf86cd799439011',
    toolName: 'first-basic-task',
    toolDisplayName: { bg: 'Първа задача', en: 'First task' },
    inputData: { y1: 1, x1: 1, alpha: 1, s: 1 },
    resultData: { y2: 2, x2: 2 },
  };

  it('a HISTORICAL row has NO resultAuthority and no clientContractVersion (no default, never backfilled)', () => {
    const legacy = new Calculation(base);
    expect(legacy.resultAuthority).toBeUndefined();
    expect(legacy.clientContractVersion).toBeUndefined();
    expect(legacy.validateSync()).toBeUndefined();
    expect(legacy.toObject()).not.toHaveProperty('resultAuthority');
  });

  it('resultAuthority accepts exactly "server" and "client"', () => {
    for (const value of ['server', 'client']) {
      const doc = new Calculation({ ...base, resultAuthority: value });
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.resultAuthority).toBe(value);
    }
    for (const bad of ['SERVER', 'trusted', '', 'legacy', true]) {
      const doc = new Calculation({ ...base, resultAuthority: bad });
      expect(doc.validateSync()).toBeDefined();
    }
  });

  it('clientContractVersion is an optional diagnostic number', () => {
    const doc = new Calculation({ ...base, resultAuthority: 'server', clientContractVersion: 2 });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.clientContractVersion).toBe(2);
  });

  it('a canonical row carries the engineVersion that computed it', () => {
    const doc = new Calculation({ ...base, toolName: 'offset-point', engineVersion: 2, resultAuthority: 'server' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.engineVersion).toBe(2);
  });

  it('a Scientific Calculator row is client-authored with no engineVersion', () => {
    const doc = new Calculation({
      ...base, toolName: 'scientific-calculator', inputData: { expression: '1+1' }, resultData: { value: 2 }, resultAuthority: 'client',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.engineVersion).toBeUndefined();
    expect(doc.resultAuthority).toBe('client');
  });
});
