const { computeSetup, buildProcessingRun } = require('../processRun');

// ---- fixture builders, matching the EXACT confirmed FieldObservationSet shape (capture/notebook/validation.js) --
const meas = (value, unit = 'm', explicit = true) => (value === null ? null : { value, unit, explicit });
const ang = (value, unit = 'gon') => (value === null ? null : { value, unit, components: null });
const obs = (row, over = {}) => ({
  row, target: `T${row}`, hz: ang(0), vz: null, distance: null, horizontalDistance: meas(50), prismHeight: null, code: '', notes: '', cells: {}, ...over,
});
const setup = (index, over = {}) => ({
  index,
  station: { point: '101', instrumentHeight: meas(1.5), notes: '' },
  orientation: { target: '102', direction: null },
  observations: [obs(0)],
  ...over,
});

const STATION = { status: 'RESOLVED', point: { id: 's1', name: '101', code: '', x: 1000, y: 2000, h: 500 } };
// due EAST of the station (bearing 100 gon) - a simple, independently-verifiable orientation geometry
const BACKSIGHT_EAST = { status: 'RESOLVED', point: { id: 'o1', name: '102', code: '', x: 1000, y: 2100, h: 500 } };

describe('computeSetup: point resolution gating (never guessed)', () => {
  it('MISSING station blocks the whole setup; every observation is ERROR with that reason', () => {
    const r = computeSetup(setup(0), { station: { status: 'MISSING' }, orientation: BACKSIGHT_EAST });
    expect(r.setupError).toBe('STATION_MISSING');
    expect(r.observations[0]).toMatchObject({ status: 'ERROR', x: null, y: null, h: null });
    expect(r.observations[0].errors[0].code).toBe('STATION_MISSING');
  });

  it('AMBIGUOUS station blocks the whole setup and reports it distinctly from MISSING', () => {
    const r = computeSetup(setup(0), { station: { status: 'AMBIGUOUS', candidates: [{ id: 'a' }, { id: 'b' }] }, orientation: BACKSIGHT_EAST });
    expect(r.setupError).toBe('STATION_AMBIGUOUS');
    expect(r.station.candidates).toHaveLength(2);
  });

  it('a setup with NO orientation recorded in the notebook is unprocessable (cannot orient at all)', () => {
    const r = computeSetup(setup(0, { orientation: null }), { station: STATION, orientation: null });
    expect(r.setupError).toBe('NO_ORIENTATION_REFERENCE');
  });

  it('MISSING orientation point blocks the setup even when the station resolved fine', () => {
    const r = computeSetup(setup(0), { station: STATION, orientation: { status: 'MISSING' } });
    expect(r.setupError).toBe('ORIENTATION_MISSING');
  });

  it('AMBIGUOUS orientation point blocks the setup', () => {
    const r = computeSetup(setup(0), { station: STATION, orientation: { status: 'AMBIGUOUS', candidates: [{}, {}] } });
    expect(r.setupError).toBe('ORIENTATION_AMBIGUOUS');
  });

  it('a resolved station/orientation with unknown (null) coordinates is still blocked, never treated as (0,0)', () => {
    const noCoords = { status: 'RESOLVED', point: { id: 's1', name: '101', code: '', x: null, y: null, h: null } };
    const r = computeSetup(setup(0), { station: noCoords, orientation: BACKSIGHT_EAST });
    expect(r.setupError).toBe('STATION_COORDINATES_UNKNOWN');
  });
});

describe('computeSetup: orientation and horizontal computation (RESOLVED station+orientation)', () => {
  it('a zeroed backsight (no recorded direction) orients directly from the bearing, and Hz=0 hits the backsight bearing', () => {
    const r = computeSetup(setup(0, { observations: [obs(0, { hz: ang(0), horizontalDistance: meas(50) })] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.orientationConstantGon).toBeCloseTo(100, 6); // bearing to backsight (due east)
    expect(r.observedHzToBacksightGon).toBe(0);
    const o = r.observations[0];
    expect(o.status).toBe('XY_ONLY'); // no height inputs in this fixture
    expect(o.x).toBeCloseTo(1000, 3);
    expect(o.y).toBeCloseTo(2050, 3); // due east, +50
  });

  it('an explicit recorded backsight direction offsets the orientation constant accordingly', () => {
    const withDirection = setup(0, { orientation: { target: '102', direction: ang(50) } }); // observed Hz=50 while sighting backsight
    const r = computeSetup(withDirection, { station: STATION, orientation: BACKSIGHT_EAST });
    // bearing 100, observed 50 -> constant = 50
    expect(r.orientationConstantGon).toBeCloseTo(50, 6);
  });

  it('uses horizontalDistance directly when present, never derives it from a slope distance that was not asked for', () => {
    const r = computeSetup(setup(0, { observations: [obs(0, { hz: ang(0), horizontalDistance: meas(50), distance: meas(999) })] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.observations[0].horizontalDistance).toBeCloseTo(50, 6); // not 999
  });

  it('an angle recorded in degrees is converted internally before combining with a gon orientation constant', () => {
    // 90 deg == 100 gon: Hz "90 deg" should land exactly where Hz "100 gon" would
    const gonObs = computeSetup(setup(0, { observations: [obs(0, { hz: ang(100, 'gon') })] }), { station: STATION, orientation: BACKSIGHT_EAST }).observations[0];
    const degObs = computeSetup(setup(0, { observations: [obs(0, { hz: ang(90, 'deg') })] }), { station: STATION, orientation: BACKSIGHT_EAST }).observations[0];
    expect(degObs.x).toBeCloseTo(gonObs.x, 6);
    expect(degObs.y).toBeCloseTo(gonObs.y, 6);
  });
});

describe('distance types (V2.4.1 section 5): never silently treat slope as horizontal', () => {
  it('slope distance alone, with a zenith angle and an explicit convention, reduces correctly', () => {
    const o = obs(0, { horizontalDistance: null, distance: meas(100), vz: ang(100) }); // horizontal shot -> HD == slope
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0].horizontalDistance).toBeCloseTo(100, 6);
    expect(r.observations[0].status).not.toBe('ERROR');
  });

  it('slope distance with NO vertical angle is unprocessable (never assumed horizontal)', () => {
    const o = obs(0, { horizontalDistance: null, distance: meas(100), vz: null });
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0]).toMatchObject({ status: 'ERROR' });
    expect(r.observations[0].errors[0].code).toBe('DISTANCE_REDUCTION_UNAVAILABLE');
  });

  it('slope distance with a vertical angle but NO declared convention is unprocessable', () => {
    const o = obs(0, { horizontalDistance: null, distance: meas(100), vz: ang(100) });
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }); // no verticalAngleConvention
    expect(r.observations[0].status).toBe('ERROR');
    expect(r.observations[0].errors[0].code).toBe('DISTANCE_REDUCTION_UNAVAILABLE');
  });

  it('neither horizontal nor slope distance present -> MISSING_DISTANCE', () => {
    const o = obs(0, { horizontalDistance: null, distance: null });
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.observations[0].errors[0].code).toBe('MISSING_DISTANCE');
  });
});

describe('height computation (V2.4.1 section 6): H unavailable is reported, never invented as 0', () => {
  const full = (over) => obs(0, { horizontalDistance: null, distance: meas(100), vz: ang(100), prismHeight: meas(2.0), ...over });

  it('READY: every height input present (station H, instrument height, prism height, vz, convention)', () => {
    const r = computeSetup(setup(0, { observations: [full()] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    // horizontal shot (zenith 100) -> verticalRise 0 -> h = 500 (stationH) + 1.5 (instrument) + 0 - 2.0 (prism) = 499.5
    expect(r.observations[0]).toMatchObject({ status: 'READY', h: 499.5 });
  });

  it('M. missing station H -> XY_ONLY with a specific, honest reason, X/Y still computed', () => {
    const noH = { status: 'RESOLVED', point: { id: 's1', name: '101', code: '', x: 1000, y: 2000, h: null } };
    const r = computeSetup(setup(0, { observations: [full()] }), { station: noH, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0]).toMatchObject({ status: 'XY_ONLY', h: null, heightReason: 'STATION_H_UNKNOWN' });
    expect(r.observations[0].x).not.toBeNull();
  });

  it('M. missing instrument height -> XY_ONLY, reason reported', () => {
    const r = computeSetup(setup(0, { station: { point: '101', instrumentHeight: null, notes: '' }, observations: [full()] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0].heightReason).toBe('INSTRUMENT_HEIGHT_MISSING');
  });

  it('M. missing prism height -> XY_ONLY, reason reported', () => {
    const r = computeSetup(setup(0, { observations: [full({ prismHeight: null })] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0].heightReason).toBe('PRISM_HEIGHT_MISSING');
  });

  it('M. missing vertical angle -> XY_ONLY (X/Y came from an explicit horizontalDistance), reason reported', () => {
    const o = obs(0, { horizontalDistance: meas(50), distance: null, vz: null, prismHeight: meas(2.0) });
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0].status).toBe('XY_ONLY');
    expect(r.observations[0].heightReason).toBe('VERTICAL_ANGLE_MISSING');
  });

  it('M. no declared vertical-angle convention -> XY_ONLY even with a vz value present (never assumed zenith or vertical)', () => {
    // horizontalDistance given directly, so X/Y does not even need the convention - only H does
    const o = full({ horizontalDistance: meas(50) });
    const r = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }); // no convention
    expect(r.observations[0].status).toBe('XY_ONLY');
    expect(r.observations[0].x).not.toBeNull();
    expect(r.observations[0].heightReason).toBe('VERTICAL_ANGLE_CONVENTION_UNKNOWN');
  });

  it('never invents H=0: an XY_ONLY row always has h === null, not 0', () => {
    const r = computeSetup(setup(0, { observations: [full({ prismHeight: null })] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    expect(r.observations[0].h).toBeNull();
  });

  it('the zenith and vertical conventions are never interchanged: the same setup gives a different H under each', () => {
    const o = full({ vz: ang(90) }); // ambiguous-looking "90" - meaning depends entirely on the declared convention
    const zenithRun = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'zenith' });
    const verticalRun = computeSetup(setup(0, { observations: [o] }), { station: STATION, orientation: BACKSIGHT_EAST }, { verticalAngleConvention: 'vertical' });
    expect(zenithRun.observations[0].h).not.toBeCloseTo(verticalRun.observations[0].h, 2);
  });
});

describe('N. invalid observation: malformed inputs are reported per-observation, not silently dropped', () => {
  it('a missing Hz is an ERROR with a specific code', () => {
    const r = computeSetup(setup(0, { observations: [obs(0, { hz: null })] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.observations[0]).toMatchObject({ status: 'ERROR' });
    expect(r.observations[0].errors[0].code).toBe('MISSING_HZ');
  });

  it('a non-positive horizontal distance is an ERROR surfaced from the engine, not a silent zero result', () => {
    const r = computeSetup(setup(0, { observations: [obs(0, { horizontalDistance: meas(0) })] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.observations[0].status).toBe('ERROR');
    expect(r.observations[0].errors[0].code).toBe('INVALID_GEOMETRY');
  });
});

describe('O. multiple targets: one bad target does not invalidate the others in a valid setup', () => {
  it('a mix of READY/XY_ONLY and ERROR observations in the same (valid) setup', () => {
    const good = obs(0, { target: 'A', horizontalDistance: meas(50) });
    const bad = obs(1, { target: 'B', hz: null });
    const r = computeSetup(setup(0, { observations: [good, bad] }), { station: STATION, orientation: BACKSIGHT_EAST });
    expect(r.setupError).toBeNull();
    expect(r.observations[0].status).not.toBe('ERROR');
    expect(r.observations[1].status).toBe('ERROR');
  });
});

describe('P. multiple setups: independent processing via buildProcessingRun', () => {
  const fakeModel = (points) => ({
    find(filter) {
      return { select() { return this; }, lean: async () => points.filter((p) => String(p.projectId) === String(filter.projectId)) };
    },
  });
  const pt = (name, x, y, h) => ({ _id: name + '-id', projectId: 'proj1', name, code: '', x, y, h });

  it('a bad setup does not affect a good setup elsewhere in the same run', async () => {
    const model = fakeModel([pt('101', 1000, 2000, 500), pt('102', 1000, 2100, 500)]); // no '999'
    const setups = [
      setup(0, { station: { point: '101', instrumentHeight: meas(1.5), notes: '' }, orientation: { target: '102', direction: null } }),
      setup(1, { station: { point: '999', instrumentHeight: null, notes: '' }, orientation: null, observations: [obs(0, { target: 'X' })] }),
    ];
    const results = await buildProcessingRun(setups, { projectId: 'proj1', SurveyPointModel: model });
    expect(results[0].setupError).toBeNull();
    expect(results[0].observations[0].status).not.toBe('ERROR');
    expect(results[1].setupError).toBe('STATION_MISSING');
  });

  it('a target name that repeats across DIFFERENT setups in the same run is flagged WARNING (save-conflict predictor)', async () => {
    const model = fakeModel([pt('101', 1000, 2000, 500), pt('102', 1000, 2100, 500), pt('201', 2000, 3000, 500), pt('202', 2000, 3100, 500)]);
    const setups = [
      setup(0, { observations: [obs(0, { target: 'DUP', horizontalDistance: meas(50) })] }),
      setup(1, { station: { point: '201', instrumentHeight: null, notes: '' }, orientation: { target: '202', direction: null }, observations: [obs(0, { target: 'DUP', horizontalDistance: meas(30) })] }),
    ];
    const results = await buildProcessingRun(setups, { projectId: 'proj1', SurveyPointModel: model });
    expect(results[0].observations[0].status).toBe('WARNING');
    expect(results[1].observations[0].status).toBe('WARNING');
    expect(results[0].observations[0].warnings.map((w) => w.code)).toContain('DUPLICATE_TARGET_NAME_IN_RUN');
  });

  it('a unique target name is unaffected by the duplicate check', async () => {
    const model = fakeModel([pt('101', 1000, 2000, 500), pt('102', 1000, 2100, 500)]);
    const results = await buildProcessingRun([setup(0)], { projectId: 'proj1', SurveyPointModel: model });
    expect(results[0].observations[0].status).not.toBe('WARNING');
  });
});
