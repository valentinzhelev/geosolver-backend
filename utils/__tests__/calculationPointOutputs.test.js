const { POINT_OUTPUT_FIELDS, isPointProducingTool, extractPointResult } = require('../calculationPointOutputs');
const { ENGINE_VERSIONS } = require('../engineVersions');

describe('calculationPointOutputs allow-list', () => {
  it('supports exactly the nine verified single-point professional tools', () => {
    expect(Object.keys(POINT_OUTPUT_FIELDS).sort()).toEqual([
      'coordinate-transformation', 'first-basic-task', 'forward-intersection', 'hansen-task',
      'line-intersection', 'offset-point', 'polar-intersection', 'resection', 'segment-division',
    ]);
  });

  it('every supported tool is a professional (engine-versioned) tool — no overlap with utilities', () => {
    Object.keys(POINT_OUTPUT_FIELDS).forEach((t) => expect(ENGINE_VERSIONS).toHaveProperty(t));
  });

  it.each(['second-basic-task', 'distance-bearing', 'area-calculation', 'scientific-calculator', 'nonsense'])(
    '%s is not point-producing and never yields coordinates',
    (toolName) => {
      expect(isPointProducingTool(toolName)).toBe(false);
      expect(extractPointResult(toolName, { x2: 1, y2: 2, xP: 1, yP: 2 })).toEqual({ ok: false, reason: 'unsupported_tool' });
    }
  );

  it('extracts only the mapped fields and never guesses from other fields', () => {
    expect(extractPointResult('first-basic-task', { x2: 5, y2: 6, xP: 100, yP: 200 })).toEqual({ ok: true, x: 5, y: 6 });
    // resection maps xP/yP, so x2/y2 must be ignored
    expect(extractPointResult('resection', { x2: 5, y2: 6 })).toEqual({ ok: false, reason: 'result_missing' });
  });

  it('rejects non-finite or non-numeric stored values', () => {
    expect(extractPointResult('resection', { xP: NaN, yP: 1 }).ok).toBe(false);
    expect(extractPointResult('resection', { xP: '1', yP: 1 }).ok).toBe(false);
    expect(extractPointResult('resection', undefined).ok).toBe(false);
  });
});
