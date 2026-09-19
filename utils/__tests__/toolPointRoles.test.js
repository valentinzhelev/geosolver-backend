const { resolveClaimedCoordinates } = require('../toolPointRoles');

describe('resolveClaimedCoordinates — fixed-role tools', () => {
  it('resolves a known role to its coordinate fields', () => {
    const result = resolveClaimedCoordinates('first-basic-task', 'station', { y1: 10, x1: 20, alpha: 1, s: 2 });
    expect(result).toEqual({ ok: true, x: 20, y: 10 });
  });

  it('resolves each of a multi-point tool\'s roles independently', () => {
    const inputData = { xA: 1, yA: 2, xB: 3, yB: 4, xC: 5, yC: 6, beta1: 0, beta2: 0 };
    expect(resolveClaimedCoordinates('resection', 'pointA', inputData)).toEqual({ ok: true, x: 1, y: 2 });
    expect(resolveClaimedCoordinates('resection', 'pointB', inputData)).toEqual({ ok: true, x: 3, y: 4 });
    expect(resolveClaimedCoordinates('resection', 'pointC', inputData)).toEqual({ ok: true, x: 5, y: 6 });
  });

  it('rejects a role that does not exist for the tool', () => {
    const result = resolveClaimedCoordinates('first-basic-task', 'pointA', { y1: 1, x1: 1 });
    expect(result).toEqual({ ok: false, reason: 'unknown_role' });
  });

  it('rejects when the claimed fields are missing or non-numeric', () => {
    expect(resolveClaimedCoordinates('first-basic-task', 'station', {})).toEqual({ ok: false, reason: 'input_missing' });
    expect(resolveClaimedCoordinates('first-basic-task', 'station', { y1: 'not-a-number', x1: 1 })).toEqual({ ok: false, reason: 'input_missing' });
  });

  it('rejects any role for a tool with no role map (e.g. scientific-calculator)', () => {
    const result = resolveClaimedCoordinates('scientific-calculator', 'station', { y1: 1, x1: 1 });
    expect(result).toEqual({ ok: false, reason: 'unknown_role' });
  });
});

describe('resolveClaimedCoordinates — dynamic-role tools (area-calculation)', () => {
  const inputData = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], method: 'shoelace' };

  it('resolves vertex:0 and vertex:1 to their array entries', () => {
    expect(resolveClaimedCoordinates('area-calculation', 'vertex:0', inputData)).toEqual({ ok: true, x: 1, y: 2 });
    expect(resolveClaimedCoordinates('area-calculation', 'vertex:1', inputData)).toEqual({ ok: true, x: 3, y: 4 });
  });

  it('rejects an out-of-range vertex index', () => {
    expect(resolveClaimedCoordinates('area-calculation', 'vertex:5', inputData)).toEqual({ ok: false, reason: 'input_missing' });
  });

  it('rejects a malformed or wrong-prefix role', () => {
    expect(resolveClaimedCoordinates('area-calculation', 'vertexA', inputData)).toEqual({ ok: false, reason: 'unknown_role' });
    expect(resolveClaimedCoordinates('area-calculation', 'pointA', inputData)).toEqual({ ok: false, reason: 'unknown_role' });
  });

  it('rejects when the points array itself is missing', () => {
    expect(resolveClaimedCoordinates('area-calculation', 'vertex:0', {})).toEqual({ ok: false, reason: 'input_missing' });
  });
});

describe('forward-intersection provenance (Milestone 2.0 preflight)', () => {
  // The exact numeric shape the frontend now persists
  // (GEOSOLVER.BG/src/utils/forwardIntersectionInput.js).
  const numeric = { yA: 200.5, xA: 100.25, yB: 310, xB: 420.125, beta1: 50, beta2: 60 };

  it('resolves pointA and pointB from the numeric inputData shape', () => {
    expect(resolveClaimedCoordinates('forward-intersection', 'pointA', numeric)).toEqual({ ok: true, x: 100.25, y: 200.5 });
    expect(resolveClaimedCoordinates('forward-intersection', 'pointB', numeric)).toEqual({ ok: true, x: 420.125, y: 310 });
  });

  it('still rejects string coordinates — the validator is intentionally NOT loosened', () => {
    const asStrings = { ...numeric, yA: '200.5', xA: '100.25' };
    expect(resolveClaimedCoordinates('forward-intersection', 'pointA', asStrings)).toEqual({ ok: false, reason: 'input_missing' });
  });
});
