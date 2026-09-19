const { ENGINE_VERSIONS, getEngineVersion, isProjectCapableTool } = require('../engineVersions');

describe('engine version map', () => {
  it('covers exactly the 12 professional tools; scientific-calculator is not a versioned engine', () => {
    expect(Object.keys(ENGINE_VERSIONS).sort()).toEqual([
      'area-calculation', 'coordinate-transformation', 'distance-bearing', 'first-basic-task',
      'forward-intersection', 'hansen-task', 'line-intersection', 'offset-point',
      'polar-intersection', 'resection', 'second-basic-task', 'segment-division',
    ]);
    expect(getEngineVersion('scientific-calculator')).toBeNull();
    expect(isProjectCapableTool('scientific-calculator')).toBe(false);
  });

  it('offset-point (2.0B: LEFT) and resection (2.0C: directed clockwise angles) are engine v2 and the ONLY tools above v1', () => {
    expect(getEngineVersion('offset-point')).toBe(2);
    expect(getEngineVersion('resection')).toBe(2);
    const others = Object.entries(ENGINE_VERSIONS).filter(([tool]) => !['offset-point', 'resection'].includes(tool));
    expect(others).toHaveLength(10);
    others.forEach(([, version]) => expect(version).toBe(1));
  });
});
