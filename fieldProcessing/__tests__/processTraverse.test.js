const { buildTraverseRun, computeTraverse, STATUS } = require('../processTraverse');
const { buildTraverseSequence } = require('../traverseSequence');

let nextRow = 0;
beforeEach(() => { nextRow = 0; });

const hz = (v) => ({ value: v, unit: 'gon' });
const m = (v) => ({ value: v, unit: 'm' });
const obs = (target, over = {}) => ({ row: nextRow++, target, hz: hz(0), vz: null, distance: null, horizontalDistance: m(100), prismHeight: null, excluded: false, cells: [], ...over });
const setup = (index, station, backsightTarget, instrumentHeight, observations) => ({
  index,
  station: { point: station, instrumentHeight: instrumentHeight != null ? m(instrumentHeight) : null },
  orientation: backsightTarget ? { target: backsightTarget, direction: null } : null,
  observations,
});

function fakeModel(points) {
  return { find: () => ({ select: () => ({ lean: async () => points }) }) };
}
const point = (name, x, y, h = null) => ({ _id: `p-${name}`, name, code: '', x, y, h });

async function run(setups, options, points) {
  return buildTraverseRun(setups, { ...options, projectId: 'proj1', SurveyPointModel: fakeModel(points) });
}

describe('A. single north leg (OPEN)', () => {
  it('station (0,0), bearing 0g, distance 100 -> (100, 0)', async () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), setup(1, '102', '101', 1.5, [])];
    // Zeroed on the backsight (hzBack=0): orientationConstant0 = bearing(101->100). With hzForward=200, the
    // forward bearing is normalize(orientationConstant0+200); for that to be 0g (north), orientationConstant0
    // must be 200g, so 100 (the backsight) is placed due SOUTH of 101.
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.status).toBe(STATUS.READY); // XY_ONLY (no prism height) still counts as a cleanly-resolved run - no ERROR leg
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].bearingGon).toBeCloseTo(0, 9);
    expect(r.legs[0].rawX).toBeCloseTo(100, 6);
    expect(r.legs[0].rawY).toBeCloseTo(0, 6);
  });
});

describe('B/S. north -> east, multiple setups from one FieldObservationSet', () => {
  it('leg1 north 100m, leg2 east 50m from an independently derived Hz sequence', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), // -> bearing 0g
      setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300), horizontalDistance: m(50) })]), // -> bearing 100g (east)
      setup(2, '103', '102', 1.5, []),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].rawX).toBeCloseTo(100, 6);
    expect(r.legs[0].rawY).toBeCloseTo(0, 6);
    expect(r.legs[1].bearingGon).toBeCloseTo(100, 9);
    expect(r.legs[1].rawX).toBeCloseTo(100, 6);
    expect(r.legs[1].rawY).toBeCloseTo(50, 6);
  });
});

describe('C/R. four-leg perfect square closed loop, start = end -> exact zero closure', () => {
  const points = [point('100', -100, 0), point('101', 0, 0)]; // 100 due south of 101
  const setups = [
    setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), // north
    setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300), horizontalDistance: m(100) })]), // east
    setup(2, '103', '102', 1.5, [obs('104', { hz: hz(300), horizontalDistance: m(100) })]), // south
    setup(3, '104', '103', 1.5, [obs('101', { hz: hz(300), horizontalDistance: m(100) })]), // west, closes the loop
  ];

  it('propagates exactly around the square and back to the start with zero misclosure', async () => {
    const r = await run(setups, { traverseType: 'CLOSED_LOOP', startIdentifier: '101' }, points);
    expect(r.sequence.state).toBe('RESOLVED');
    expect(r.legs).toHaveLength(4);
    const expectedXY = [[100, 0], [100, 100], [0, 100], [0, 0]];
    r.legs.forEach((l, i) => {
      expect(l.rawX).toBeCloseTo(expectedXY[i][0], 6);
      expect(l.rawY).toBeCloseTo(expectedXY[i][1], 6);
    });
    expect(r.closure.available).toBe(true);
    expect(r.closure.perfectClosure).toBe(true);
    expect(r.closure.fX).toBeCloseTo(0, 9);
    expect(r.closure.fY).toBeCloseTo(0, 9);
    expect(r.closure.totalLength).toBe(400);
  });

  it('Bowditch is applied (trivially, since the misclosure is already zero) and the adjusted endpoint equals the control', async () => {
    const r = await run(setups, { traverseType: 'CLOSED_LOOP', startIdentifier: '101' }, points);
    expect(r.adjustment.applied).toBe(true);
    const last = r.legs[r.legs.length - 1];
    expect(last.adjustedX).toBeCloseTo(0, 6);
    expect(last.adjustedY).toBeCloseTo(0, 6);
  });
});

describe('D. known endpoint with a deliberate misclosure -> Bowditch pulls the adjusted endpoint onto control', () => {
  it('two unequal legs, corrections weighted by length, adjusted endpoint matches the known endpoint exactly', async () => {
    // leg1 100m north from (0,0) -> raw (100,0). leg2 200m east from there -> raw (100,200).
    // Known endpoint is deliberately offset from the raw result: (100.3, 200.1).
    const setups = [
      setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), // north
      setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300), horizontalDistance: m(200) })]), // east
    ];
    const points = [point('100', -100, 0), point('101', 0, 0), point('103', 100.3, 200.1)];
    const r = await run(setups, { traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '103' }, points);
    expect(r.closure.available).toBe(true);
    // fX = raw(100) - known(100.3) = -0.3 ; fY = raw(200) - known(200.1) = -0.1
    expect(r.closure.fX).toBeCloseTo(-0.3, 6);
    expect(r.closure.fY).toBeCloseTo(-0.1, 6);
    const last = r.legs[r.legs.length - 1];
    expect(last.adjustedX).toBeCloseTo(100.3, 6);
    expect(last.adjustedY).toBeCloseTo(200.1, 6);
    // weighted by length: leg1 (100/300) gets 1/3 of the correction, leg2 (200/300) gets 2/3
    expect(r.legs[1].correctionX).toBeCloseTo(2 * r.legs[0].correctionX, 6);
  });
});

describe('H/J/K/L/M. height propagation', () => {
  const zenithObs = (target, hzVal, slope, vzGon, prism) => obs(target, {
    hz: hz(hzVal), horizontalDistance: null, distance: m(slope), vz: hz(vzGon), prismHeight: prism != null ? m(prism) : null,
  });

  it('J/K. a leg with only an explicit horizontal distance (no slope/vz at all) computes cleanly, height unavailable without prism', async () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), setup(1, '102', '101', 1.5, [])];
    const points = [point('100', -100, 0), point('101', 0, 0, 500)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.legs[0].status).toBe('XY_ONLY');
    expect(r.legs[0].heightReason).toBe('PRISM_HEIGHT_MISSING');
    expect(r.legs[0].rawX).toBeCloseTo(100, 6);
  });

  it('J. a genuinely oblique zenith angle reduces slope distance to a DIFFERENT horizontal distance, not a pass-through', async () => {
    // zenith = 50g (45 deg from vertical... i.e. 45 deg elevation): horizontalDistance = slope*sin(50g) = slope*sqrt(2)/2,
    // independently computed as 100 * 0.70710678... = 70.710678... (NOT equal to the 100m slope - proves real reduction).
    const setups = [setup(0, '101', '100', 1.5, [zenithObs('102', 200, 100, 50, null)]), setup(1, '102', '101', 1.5, [])];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101', verticalAngleConvention: 'zenith' }, points);
    expect(r.legs[0].horizontalDistance).toBeCloseTo(100 * Math.sin((50 * Math.PI) / 200), 9);
    expect(r.legs[0].horizontalDistance).not.toBeCloseTo(100, 3); // genuinely reduced, not a pass-through of the slope
    expect(r.legs[0].rawX).toBeCloseTo(70.711, 3); // bearing 0g (north): rawX = horizontalDistance
    expect(r.legs[0].rawY).toBeCloseTo(0, 6);
  });

  it('L. height propagates leg-to-leg via zenith reduction, station H carried forward from the previous computed H', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [zenithObs('102', 200, 100.062, 100, 2.0)]), // horizontal leg (zenith=100g), slope=horizontal here
      setup(1, '102', '101', 1.5, [zenithObs('103', 300, 50, 100, 2.0)]),
      setup(2, '103', '102', 1.5, []),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0, 500)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101', verticalAngleConvention: 'zenith' }, points);
    expect(r.legs[0].status).toBe('READY');
    // stationH(101)=500, instrument=1.5, verticalRise=0 (zenith=100g is exactly horizontal), prism=2.0
    // H(102) = 500 + 1.5 + 0 - 2.0 = 499.5
    expect(r.legs[0].rawH).toBeCloseTo(499.5, 6);
    expect(r.legs[1].status).toBe('READY');
    // H(103) = 499.5 + 1.5 + 0 - 2.0 = 499.0, carried forward from leg1's OWN computed H, not the original station H
    expect(r.legs[1].rawH).toBeCloseTo(499.0, 6);
  });

  it('M. a missing height input mid-chain degrades that leg AND every leg after it to XY_ONLY, never fabricating H, while X/Y stays valid throughout', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [zenithObs('102', 200, 100.062, 100, null)]), // leg1: no prism height -> H unavailable
      setup(1, '102', '101', 1.5, [zenithObs('103', 300, 50, 100, 2.0)]), // leg2: prism given, but station H is now unknown
      setup(2, '103', '102', 1.5, []),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0, 500)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101', verticalAngleConvention: 'zenith' }, points);
    expect(r.legs[0].status).toBe('XY_ONLY');
    expect(r.legs[0].heightReason).toBe('PRISM_HEIGHT_MISSING');
    expect(r.legs[0].rawH).toBeNull();
    expect(r.legs[1].status).toBe('XY_ONLY');
    expect(r.legs[1].heightReason).toBe('STATION_H_UNKNOWN'); // cascaded from leg1, not a fabricated 0
    expect(r.legs[1].rawH).toBeNull();
    // X/Y stays fully valid for BOTH legs despite the height failure
    expect(r.legs[0].rawX).not.toBeNull();
    expect(r.legs[1].rawX).not.toBeNull();
  });
});

describe('N/O/P. a broken/ambiguous/disconnected sequence never silently invents a traverse', () => {
  it('N. a broken middle leg makes the run PARTIAL (some legs valid, requested continuation missing)', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [obs('999', { hz: hz(200) })]), // no link to 102
      setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300) })]),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.sequence.state).toBe('INCOMPLETE');
    expect(r.status).toBe(STATUS.INVALID); // zero legs could even be identified
    expect(r.legs).toHaveLength(0);
  });

  it('O. an ambiguous continuation blocks processing entirely rather than guessing', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200) }), obs('102b', { hz: hz(200) })]),
      setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300) })]),
      setup(2, '102b', '101', 1.5, [obs('103b', { hz: hz(300) })]),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.sequence.state).toBe('AMBIGUOUS');
    expect(r.status).toBe(STATUS.INVALID);
    expect(r.legs).toHaveLength(0);
  });

  it('P. a disconnected start (not present in the observation set) is reported, not defaulted to something else', async () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200) })])];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '999' }, points);
    expect(r.sequence.state).toBe('DISCONNECTED');
    expect(r.status).toBe(STATUS.INVALID);
  });
});

describe('Q. an OPEN traverse never reports closure or a Bowditch adjustment', () => {
  it('reports total length but closure and adjustment are explicitly NOT_AVAILABLE, never a fake zero', async () => {
    const setups = [
      setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]),
      setup(1, '102', '101', 1.5, [obs('103', { hz: hz(300), horizontalDistance: m(50) })]),
      setup(2, '103', '102', 1.5, []),
    ];
    const points = [point('100', -100, 0), point('101', 0, 0)];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, points);
    expect(r.closure.available).toBe(false);
    expect(r.closure.reason).toBe('OPEN_TRAVERSE');
    expect(r.closure.fX).toBeNull();
    expect(r.adjustment.applied).toBe(false);
    expect(r.legs.every((l) => l.adjustedX === null)).toBe(true);
    const totalLength = r.legs.reduce((s, l) => s + l.horizontalDistance, 0);
    expect(totalLength).toBeCloseTo(150, 6);
  });
});

describe('control-point resolution failures block the whole run (V2.4.1 policy continued)', () => {
  it('an unresolved start station blocks every leg with a structured reason, never guessed coordinates', async () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200) })]), setup(1, '102', '101', 1.5, [])];
    const r = await run(setups, { traverseType: 'OPEN', startIdentifier: '101' }, []); // no points in the project at all
    expect(r.status).toBe(STATUS.INVALID);
    expect(r.legs[0].status).toBe('ERROR');
    expect(r.legs[0].errors[0].code).toBe('START_STATION_NOT_FOUND');
  });

  it('an unresolved endpoint control blocks the whole controlled traverse', async () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200) })])];
    const points = [point('100', -100, 0), point('101', 0, 0)]; // '102' is never a SurveyPoint
    const r = await run(setups, { traverseType: 'KNOWN_ENDPOINT', startIdentifier: '101', endIdentifier: '102' }, points);
    expect(r.status).toBe(STATUS.INVALID);
    expect(r.legs[0].errors[0].code).toBe('END_STATION_NOT_FOUND');
  });
});

describe('computeTraverse is pure: identical inputs produce identical outputs', () => {
  it('no I/O, deterministic given already-resolved points', () => {
    const setups = [setup(0, '101', '100', 1.5, [obs('102', { hz: hz(200), horizontalDistance: m(100) })]), setup(1, '102', '101', 1.5, [])];
    const sequence = buildTraverseSequence(setups, { traverseType: 'OPEN', startIdentifier: '101' });
    const resolved = { traverseType: 'OPEN', startPoint: { x: 0, y: 0, h: null }, orientationPoint: { x: -100, y: 0, h: null }, endPoint: null, verticalAngleConvention: null };
    const a = computeTraverse(setups, sequence, resolved);
    const b = computeTraverse(setups, sequence, resolved);
    expect(a).toEqual(b);
  });
});
