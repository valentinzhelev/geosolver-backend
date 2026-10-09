const { evaluateSession, referenceIssues } = require('../evaluate');
const { normalizeSetups } = require('../entry');

const S = (setups, angleUnit = 'gon') => ({ angleUnit, setups: normalizeSetups(setups) });
const setup = (over = {}) => ({ index: 0, station: { point: '101', instrumentHeight: '1.52', notes: '' }, orientation: { target: '102', direction: '0' }, observations: [], ...over });
const obs = (over = {}) => ({ target: '201', hz: '100.1234', vz: '98.5', distance: '50.123', prismHeight: '1.8', ...over });
const codes = (r, severity) => r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const issueAt = (r, code) => r.issues.find((i) => i.code === code);

describe('a clean manual session', () => {
  const r = evaluateSession(S([setup({ observations: [obs(), obs({ target: '202', hz: '200', vz: '', prismHeight: '', distance: '', horizontalDistance: '30,5' })] })]));

  it('can be confirmed and has no issues', () => {
    expect(r.issues).toEqual([]);
    expect(r.summary).toEqual({ setups: 1, observations: 2, errors: 0, warnings: 0, canConfirm: true });
  });

  it('produces exactly the import-ready shape evaluateNotebook produces (same evidence model)', () => {
    expect(r.setups[0]).toEqual({
      index: 0,
      station: { point: '101', instrumentHeight: { value: 1.52, unit: 'm', explicit: false }, notes: '' },
      orientation: { target: '102', direction: { value: 0, unit: 'gon', components: null } },
      observations: [
        {
          row: 0, target: '201', hz: { value: 100.1234, unit: 'gon', components: null }, vz: { value: 98.5, unit: 'gon', components: null },
          distance: { value: 50.123, unit: 'm', explicit: false }, horizontalDistance: null, prismHeight: { value: 1.8, unit: 'm', explicit: false },
          code: '', notes: '', cells: {},
        },
        expect.objectContaining({ row: 1, target: '202', distance: null, horizontalDistance: { value: 30.5, unit: 'm', explicit: false }, vz: null, prismHeight: null }),
      ],
    });
  });
});

describe('blocking errors (each is located on its exact field)', () => {
  const one = (o, s = {}) => evaluateSession(S([setup({ ...s, observations: [o] })]));

  it('missing target / hz / any distance', () => {
    const r = one({ target: '', hz: '', vz: '', distance: '', horizontalDistance: '', prismHeight: '', code: 'x', notes: '' });
    expect(codes(r, 'error')).toEqual(['TARGET_REQUIRED', 'VALUE_REQUIRED', 'DISTANCE_REQUIRED']);
    expect(issueAt(r, 'VALUE_REQUIRED')).toMatchObject({ setup: 0, section: 'observation', row: 0, field: 'hz' });
    expect(r.summary.canConfirm).toBe(false);
  });

  it('malformed / out-of-range / impossible-minutes angles', () => {
    expect(codes(one(obs({ hz: 'abc' })), 'error')).toEqual(['MALFORMED_ANGLE']);
    expect(codes(one(obs({ hz: '400.5' })), 'error')).toEqual(['ANGLE_OUT_OF_RANGE']);
    expect(codes(one(obs({ hz: "94°75'10\"" })), 'error')).toEqual(['MINUTES_OUT_OF_RANGE']);
    expect(codes(one(obs({ vz: "94°30'75\"" })), 'error')).toEqual(['SECONDS_OUT_OF_RANGE']);
  });

  it('malformed, zero and negative distances; negative heights', () => {
    expect(codes(one(obs({ distance: '5x0' })), 'error')).toEqual(['MALFORMED_DISTANCE']);
    expect(codes(one(obs({ distance: '0' })), 'error')).toEqual(['NON_POSITIVE_DISTANCE']);
    expect(codes(one(obs({ distance: '-4' })), 'error')).toEqual(['NON_POSITIVE_DISTANCE']);
    expect(codes(one(obs({ prismHeight: '-1' })), 'error')).toEqual(['NEGATIVE_HEIGHT']);
    expect(codes(one(obs(), { station: { point: '101', instrumentHeight: '-1.5', notes: '' } }), 'error')).toEqual(['NEGATIVE_HEIGHT']);
  });

  it('a target that is the station itself; a duplicate target (all duplicate rows are flagged)', () => {
    expect(codes(one(obs({ target: '101' })), 'error')).toEqual(['TARGET_IS_STATION']);
    const r = evaluateSession(S([setup({ observations: [obs(), obs({ hz: '5' }), obs({ target: '203' })] })]));
    const dups = r.issues.filter((i) => i.code === 'DUPLICATE_OBSERVATION');
    expect(dups.map((i) => i.row)).toEqual([0, 1]);
  });

  it('missing station; orientation that is the station; orientation direction malformed; orientation without target', () => {
    expect(codes(evaluateSession(S([setup({ station: { point: '', instrumentHeight: '' }, observations: [obs()] })])), 'error')).toEqual(['STATION_REQUIRED']);
    expect(codes(evaluateSession(S([setup({ orientation: { target: '101', direction: '' }, observations: [obs()] })])), 'error')).toEqual(['COINCIDENT_ORIENTATION']);
    expect(codes(evaluateSession(S([setup({ orientation: { target: '102', direction: 'x' }, observations: [obs()] })])), 'error')).toEqual(['MALFORMED_ANGLE']);
    expect(codes(evaluateSession(S([setup({ orientation: { target: '', direction: '12' }, observations: [obs()] })])), 'error')).toEqual(['TARGET_REQUIRED']);
  });

  it('a session with no observations cannot be confirmed', () => {
    const r = evaluateSession(S([setup()]));
    expect(codes(r, 'error')).toEqual(['NO_OBSERVATIONS']);
    expect(r.summary.canConfirm).toBe(false);
    expect(evaluateSession(S([])).summary.canConfirm).toBe(false);
  });

  it('a fully blank row is ignored - never counted, never flagged', () => {
    const r = evaluateSession(S([setup({ observations: [obs(), { target: '', hz: '', vz: '', distance: '', horizontalDistance: '', prismHeight: '', code: '', notes: '' }] })]));
    expect(r.issues).toEqual([]);
    expect(r.summary.observations).toBe(1);
  });
});

describe('angle units: declared by the user, never guessed', () => {
  it('a bare number takes the session unit; an explicit unit wins and a different one is flagged', () => {
    const gon = evaluateSession(S([setup({ observations: [obs({ hz: '100' })] })], 'gon'));
    expect(gon.setups[0].observations[0].hz.unit).toBe('gon');
    const deg = evaluateSession(S([setup({ observations: [obs({ hz: '90' })] })], 'deg'));
    expect(deg.setups[0].observations[0].hz.unit).toBe('deg');

    const mixed = evaluateSession(S([setup({ observations: [obs({ hz: '94°30\'' })] })], 'gon'));
    expect(mixed.setups[0].observations[0].hz).toMatchObject({ unit: 'deg' });
    expect(codes(mixed, 'warning')).toEqual(['INCONSISTENT_ANGLE_UNIT']);
    expect(mixed.summary.canConfirm).toBe(true);
  });
});

describe('warnings never block confirmation', () => {
  it('missing orientation, duplicate stations, empty setup', () => {
    const r = evaluateSession(S([
      setup({ orientation: null, observations: [obs()] }),
      setup({ index: 1, observations: [] }),
    ]));
    expect(codes(r, 'warning').sort()).toEqual(['DUPLICATE_STATION', 'DUPLICATE_STATION', 'EMPTY_SETUP', 'MISSING_ORIENTATION'].sort());
    expect(r.summary.canConfirm).toBe(true);
  });

  it('measurements carry an explicit unit when written; a bare number is meters', () => {
    const r = evaluateSession(S([setup({ station: { point: '101', instrumentHeight: '152 cm' }, observations: [obs({ distance: '5000 mm' })] })]));
    expect(r.setups[0].station.instrumentHeight).toEqual({ value: 152, unit: 'cm', explicit: true });
    expect(r.setups[0].observations[0].distance).toEqual({ value: 5000, unit: 'mm', explicit: true });
  });
});

describe('referenceIssues (project points)', () => {
  const pts = [{ name: '101', x: 1, y: 2 }, { name: '102', x: 3, y: 4 }, { name: 'dup', x: 1, y: 1 }, { name: 'DUP', x: 2, y: 2 }, { name: 'nocoord', x: null, y: null }];
  const sessionSetups = (a, b) => normalizeSetups([setup({ station: { point: a }, orientation: { target: b, direction: '0' }, observations: [obs()] })]);

  it('resolved station and orientation -> no warnings (case-insensitive)', () => {
    expect(referenceIssues(sessionSetups('101', '102'), pts)).toEqual([]);
    expect(referenceIssues(sessionSetups('  101 ', '102'), pts)).toEqual([]);
  });

  it('missing / ambiguous / coordinate-less references are warnings with fixed messages', () => {
    const r = referenceIssues(sessionSetups('999', 'dup'), pts);
    expect(r.map((i) => i.code)).toEqual(['STATION_NOT_FOUND', 'ORIENTATION_AMBIGUOUS']);
    expect(r.every((i) => i.severity === 'warning' && i.message)).toBe(true);
    expect(referenceIssues(sessionSetups('nocoord', '102'), pts).map((i) => i.code)).toEqual(['STATION_COORDINATES_UNKNOWN']);
  });

  it('points a traverse derives are not flagged: a station observed from another setup, a backsight that is another setup\'s station', () => {
    const setups = normalizeSetups([
      setup({ station: { point: '101' }, orientation: { target: '102', direction: '0' }, observations: [obs({ target: 'B' })] }),
      setup({ index: 1, station: { point: 'B' }, orientation: { target: '101', direction: '0' }, observations: [obs({ target: 'C' })] }),
    ]);
    expect(referenceIssues(setups, pts)).toEqual([]);
  });
});
