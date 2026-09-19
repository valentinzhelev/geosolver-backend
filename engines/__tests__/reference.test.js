const registry = require('../registry');

/**
 * INDEPENDENT hand-known references for the backend engines (no fixtures, no frontend copies):
 * axes, 3-4-5 geometry, isosceles constructions, known areas. Frame: X = north, Y = east,
 * bearings clockwise from +X, angles in gon. Two engines that agree with the frontend could still
 * share a bug — these assertions come from geometry, not from another implementation.
 */

const run = (tool, input, version) => (version ? registry.getEngine(tool, version) : registry.getCurrentEngine(tool)).run(input).resultData;
const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const BEARING_345 = (Math.atan2(80, 60) * 200) / Math.PI; // 59.0334... gon

describe('first-basic-task', () => {
  it('axes: 0 -> +X, 100 -> +Y, 200 -> -X, 300 -> -Y', () => {
    const at = (alpha) => run('first-basic-task', { y1: 1000, x1: 2000, alpha, s: 50 });
    close(at(0).x2, 2050, 3); close(at(0).y2, 1000, 3);
    close(at(100).x2, 2000, 3); close(at(100).y2, 1050, 3);
    close(at(200).x2, 1950, 3); close(at(200).y2, 1000, 3);
    close(at(300).x2, 2000, 3); close(at(300).y2, 950, 3);
  });

  it('3-4-5: dX = 60, dY = 80 for S = 100', () => {
    const r = run('first-basic-task', { y1: 200, x1: 100, alpha: BEARING_345, s: 100 });
    expect(r).toEqual({ y2: 280, x2: 160, deltaX: 60, deltaY: 80 });
  });
});

describe('second-basic-task and distance-bearing agree with geometry, not just with each other', () => {
  it('3-4-5: alpha = atan(80/60), distance 100', () => {
    const r = run('second-basic-task', { x1: 100, y1: 200, x2: 160, y2: 280 });
    close(r.alpha, BEARING_345, 3);
    expect(r.distance).toBe(100);
    const d = run('distance-bearing', { y1: 200, x1: 100, y2: 280, x2: 160 });
    expect(d.distance).toBe(100);
    close(d.bearingGon, BEARING_345, 2);
  });

  it('axis bearings: 0, 100, 200, 300 gon', () => {
    const at = (x2, y2) => run('distance-bearing', { y1: 0, x1: 0, y2, x2 }).bearingGon;
    expect(at(100, 0)).toBe(0);
    expect(at(0, 100)).toBe(100);
    expect(at(-100, 0)).toBe(200);
    expect(at(0, -100)).toBe(300);
    expect(run('second-basic-task', { x1: 0, y1: 0, x2: -100, y2: 0 }).alpha).toBe(200);
    expect(run('second-basic-task', { x1: 0, y1: 0, x2: 0, y2: -100 }).alpha).toBe(300);
  });
});

describe('polar, forward and Hansen', () => {
  it('polar 3-4-5 (compute order is X first)', () => {
    const r = run('polar-intersection', { yA: 200, xA: 100, angle: BEARING_345, distance: 100 });
    expect(r).toEqual({ xP: 160, yP: 280 });
  });

  it('forward isosceles: A=(X0,Y0), B=(X0,Y100), 50/50 gon -> P=(50, 50), sAP = sBP = 70.711', () => {
    const r = run('forward-intersection', { yA: 0, xA: 0, yB: 100, xB: 0, beta1: 50, beta2: 50 });
    expect(r).toEqual({ xP: 50, yP: 50, sAP: 70.711, sBP: 70.711 });
  });

  it('forward puts P on the LEFT of A->B (facing east, left is north: X > 0)', () => {
    expect(run('forward-intersection', { yA: 0, xA: 0, yB: 100, xB: 0, beta1: 40, beta2: 60 }).xP).toBeGreaterThan(0);
  });

  it('Hansen (a forward intersection) on the same isosceles construction; argument order is X first', () => {
    const r = run('hansen-task', { yA: 0, xA: 0, yB: 100, xB: 0, alpha: 50, beta: 50 });
    close(r.xP, 50); close(r.yP, 50);
    const shifted = run('hansen-task', { yA: 200, xA: 10, yB: 300, xB: 30, alpha: 55, beta: 45 });
    const fwd = run('forward-intersection', { yA: 200, xA: 10, yB: 300, xB: 30, beta1: 55, beta2: 45 });
    close(shifted.xP, fwd.xP, 3);
    close(shifted.yP, fwd.yP, 3);
  });
});

describe('coordinate transformation', () => {
  it('translation, rotation (positive angle increases bearing) and scaling', () => {
    expect(run('coordinate-transformation', { x: 100, y: 200, transformationType: 'translation', parameters: { dx: 10, dy: -5 } }))
      .toEqual({ xTransformed: 110, yTransformed: 195 });
    const rot = run('coordinate-transformation', { x: 100, y: 0, transformationType: 'rotation', parameters: { angle: 100 } });
    close(rot.xTransformed, 0, 3); close(rot.yTransformed, 100, 3);
    expect(run('coordinate-transformation', { x: 100, y: 200, transformationType: 'scaling', parameters: { scaleX: 2, scaleY: 0.5 } }))
      .toEqual({ xTransformed: 200, yTransformed: 100 });
  });
});

describe('line intersection, segment division, area', () => {
  it('orthogonal crossing at (50, 0) and the non-obvious (2.4, 3.8)', () => {
    let r = run('line-intersection', { y1: 0, x1: 0, y2: 0, x2: 100, y3: -50, x3: 50, y4: 50, x4: 50 });
    close(r.xI, 50); close(r.yI, 0);
    r = run('line-intersection', { y1: 1, x1: 1, y2: 7, x2: 4, y3: 5, x3: 0, y4: 2, x4: 6 });
    close(r.xI, 2.4); close(r.yI, 3.8);
  });

  it('segment division: midpoint (distance and ratio) and 0.25 of a 3-4-5 segment', () => {
    let r = run('segment-division', { yA: 0, xA: 0, yB: 0, xB: 100, value: 50, mode: 'distance' });
    expect(r).toEqual({ yP: 0, xP: 50 });
    r = run('segment-division', { yA: 0, xA: 0, yB: 40, xB: 30, value: 0.25, mode: 'ratio' });
    close(r.xP, 7.5); close(r.yP, 10);
  });

  it('area: rectangle 100 x 100 = 10000 and triangle base 100 x height 100 / 2 = 5000, both methods, either orientation', () => {
    const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    for (const method of ['shoelace', 'trapezoidal']) {
      expect(run('area-calculation', { points: rect, method }).area).toBe(10000);
      expect(run('area-calculation', { points: [...rect].reverse(), method }).area).toBe(10000);
      expect(run('area-calculation', { points: tri, method }).area).toBe(5000);
    }
  });
});

describe('offset-point: v2 puts positive d on the LEFT; v1 (historical) on the RIGHT', () => {
  const at = (version, seg, d) => run('offset-point', { yA: 0, xA: 0, ...seg, s: 50, d }, version);
  const north = { yB: 0, xB: 100 }; // facing north
  const east = { yB: 100, xB: 0 }; // facing east

  it('v2 north axis: d=+10 -> Y=-10 (west = left); d=-10 -> Y=+10', () => {
    close(at(2, north, 10).yP, -10); close(at(2, north, 10).xP, 50);
    close(at(2, north, -10).yP, 10);
  });

  it('v2 east axis: d=+10 -> X=+10 (north = left); d=-10 -> X=-10', () => {
    close(at(2, east, 10).xP, 10); close(at(2, east, 10).yP, 50);
    close(at(2, east, -10).xP, -10);
  });

  it('v2 diagonal (bearing 50 gon): d=+10 -> north-west of the foot point', () => {
    const r = run('offset-point', { yA: 0, xA: 0, yB: 100, xB: 100, s: Math.hypot(50, 50), d: 10 }, 2);
    close(r.xP, 50 + 10 * Math.SQRT1_2); close(r.yP, 50 - 10 * Math.SQRT1_2);
  });

  it('v1 is the mirror: d=+10 on the north axis -> Y=+10 (RIGHT)', () => {
    close(at(1, north, 10).yP, 10);
    close(at(1, east, 10).xP, -10);
  });

  it('d = 0 is version-independent, and s = 0 / s = len start at A / B', () => {
    for (const version of [1, 2]) {
      const r = run('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 50, d: 0 }, version);
      close(r.xP, 50); close(r.yP, 0);
    }
    close(run('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 0, d: 10 }, 2).yP, -10);
    close(run('offset-point', { yA: 0, xA: 0, yB: 0, xB: 100, s: 100, d: 10 }, 2).xP, 100);
  });
});

describe('resection v2 (directed clockwise angles) — independent atan2 construction', () => {
  const clockwise = (from, to, P) => {
    let d = Math.atan2(to.y - P.y, to.x - P.x) - Math.atan2(from.y - P.y, from.x - P.x);
    while (d < 0) d += 2 * Math.PI;
    return (d * 200) / Math.PI;
  };

  it('recovers a station from angles derived independently from that station', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 100, y: 0 };
    const C = { x: 50, y: 80 };
    for (const P of [{ x: 50, y: 35 }, { x: 40.5, y: 30.25 }, { x: 30, y: -40 }, { x: -60, y: 20 }]) {
      const r = registry.getCurrentEngine('resection').compute(
        registry.getCurrentEngine('resection').normalizeAndValidate({
          xA: A.x, yA: A.y, xB: B.x, yB: B.y, xC: C.x, yC: C.y, beta1: clockwise(A, B, P), beta2: clockwise(B, C, P),
        })
      );
      close(r.xP, P.x, 6); close(r.yP, P.y, 6);
    }
  });

  it('the documented worked example: station (X 2000, Y 1000) from angles 81.1917 / 102.4266', () => {
    const r = run('resection', {
      xA: 2100, yA: 900, xB: 2150, yB: 1080, xC: 1930, yC: 1120, beta1: 81.1917, beta2: 102.4266,
    });
    expect(Math.abs(r.xP - 2000)).toBeLessThan(0.005);
    expect(Math.abs(r.yP - 1000)).toBeLessThan(0.005);
    expect(r.method).toBe('circle-intersection');
  });
});
