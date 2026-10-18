const { readInstrumentFile, reviewInstrumentImport } = require('..');
const F = require('../../tests/support/gsiFixtures');

const snap = (text) => readInstrumentFile(Buffer.from(text, 'utf8'));
const review = (text, decisions) => reviewInstrumentImport(snap(text), decisions);
const codes = (r, severity) => r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const m = (value) => ({ value, unit: 'm', explicit: true });
const gon = (value) => ({ value, unit: 'gon', components: null });

describe('setups - explicit evidence only', () => {
  test('A: one station record opens one setup; without a chosen orientation every measurement is an observation', () => {
    const r = review(F.A_GSI8_SINGLE);
    expect(r.setups).toHaveLength(1);
    const [s] = r.setups;
    expect(s).toMatchObject({ index: 0, key: 's1', station: { point: '101', instrumentHeight: m(1.55), notes: '' }, orientation: null });
    expect(s.observations.map((o) => o.target)).toEqual(['102', '201']);
    expect(codes(r)).toEqual(['MISSING_ORIENTATION']);
    expect(r.summary).toMatchObject({ records: 3, stations: 1, setups: 1, observations: 2, errors: 0, warnings: 1, canConfirm: true });
    expect(r.versions).toEqual({ parserVersion: 'leica-gsi-parser/v1', normalizerVersion: 'leica-gsi-normalize/v1', validationVersion: 'leica-gsi-validate/v1' });
  });

  test('A: the user\'s orientation choice moves that measurement to the orientation (its Hz is the direction)', () => {
    const r = review(F.A_GSI8_SINGLE, { orientation: { s1: 2 } });
    const [s] = r.setups;
    expect(s.orientation).toEqual({ target: '102', direction: gon(0) });
    expect(s.orientationRecord).toBe(2);
    expect(s.observations).toEqual([{
      row: 0,
      target: '201',
      hz: gon(50.1234),
      vz: gon(98.7654),
      distance: m(85.432),
      horizontalDistance: null,
      prismHeight: m(1.6),
      code: '',
      notes: '',
      cells: {},
      instrumentCoordinates: null,
      source: { record: 3, line: 3 },
    }]);
    expect(codes(r)).toEqual([]);
  });

  test('C: multi-station - each station record starts a new setup; a stationless backsight is fine as the orientation', () => {
    const plain = review(F.C_MULTI_STATION);
    expect(plain.setups.map((s) => [s.key, s.station.point, s.observations.map((o) => o.target)])).toEqual([
      ['s1', '101', ['102']], // 100 has no distance -> error record, not evidence
      ['s4', '102', ['101', '103']],
    ]);
    expect(codes(plain, 'error')).toEqual(['MISSING_DISTANCE']);
    expect(plain.summary.canConfirm).toBe(false);

    const r = review(F.C_MULTI_STATION, { orientation: { s1: 2, s4: 5 } });
    expect(r.setups.map((s) => [s.station.point, s.station.instrumentHeight, s.orientation.target, s.observations.map((o) => o.target)])).toEqual([
      ['101', m(1.5), '100', ['102']],
      ['102', m(1.45), '101', ['103']],
    ]);
    expect(r.setups[1].observations[0]).toMatchObject({ hz: gon(210), distance: m(80) });
    expect(r.summary).toMatchObject({ setups: 2, observations: 2, errors: 0, canConfirm: true });
  });

  test('a repeated station record is a new occupation (never merged)', () => {
    const text = [F.A_GSI8_SINGLE, '110004+00000101 88..10+00001600 ', '110005+00000202 21.322+07000000 31..00+00010000 '].join('\n');
    const r = review(text);
    expect(r.setups.map((s) => [s.key, s.station.point, s.station.instrumentHeight.value])).toEqual([['s1', '101', 1.55], ['s4', '101', 1.6]]);
  });

  test('measurements before any station record: MISSING_STATION until the user names the station explicitly', () => {
    const text = ['110001+00000201 21.322+05000000 22.322+10000000 31..00+00012345 ', F.A_GSI8_SINGLE].join('\n');
    const r = review(text);
    expect(r.setups.map((s) => s.key)).toEqual(['orphan', 's2']);
    expect(r.setups[0].station.point).toBeNull();
    expect(r.issues.filter((i) => i.code === 'MISSING_STATION')).toEqual([expect.objectContaining({ severity: 'error', setup: 0, setupKey: 'orphan' })]);
    expect(r.summary.canConfirm).toBe(false);

    const ok = review(text, { orphanStation: { point: ' 100 ', instrumentHeight: '1,48' } });
    expect(ok.setups[0].station).toEqual({ point: '100', instrumentHeight: m(1.48), notes: '' });
    expect(codes(ok, 'error')).toEqual([]);

    expect(codes(review(text, { orphanStation: { point: '100', instrumentHeight: 'abc' } }), 'error')).toEqual(['INVALID_DECISION']);
    // or excluded instead
    expect(codes(review(text, { excluded: [1] }), 'error')).toEqual([]);
  });

  test('point and code-block records are kept and listed, but never attached to an observation', () => {
    const r = review(F.F_DEGREES_AND_CODES);
    expect(r.records.map((x) => [x.seq, x.kind, x.setupKey, x.status])).toEqual([[1, 'station', 's1', 'ok'], [2, 'measurement', 's1', 'ok'], [3, 'code', null, 'ok']]);
    expect(r.setups[0].observations[0]).toMatchObject({ target: '201', code: 'H66', notes: 'FENCE', distance: m(10) });
  });
});

describe('semantics', () => {
  test('E: an explicit horizontal distance stays horizontal; slope stays empty (never derived either way)', () => {
    const o = review(F.E_HORIZONTAL).setups[0].observations[0];
    expect(o.horizontalDistance).toEqual(m(42.195));
    expect(o.distance).toBeNull();
    expect(o.vz).toBeNull();
  });

  test('A: the slope distance stays slope; V is kept exactly as recorded (convention is chosen at processing)', () => {
    const o = review(F.A_GSI8_SINGLE).setups[0].observations[1];
    expect(o.distance).toEqual(m(85.432));
    expect(o.horizontalDistance).toBeNull();
    expect(o.vz).toEqual(gon(98.7654));
  });

  test('B: AXIS golden - Leica Easting/Northing -> GeoSolver Y/X (X = north)', () => {
    const r = review(F.B_GSI16_SINGLE);
    expect(r.setups[0].stationCoordinates).toEqual({ x: 4700000, y: 500000, h: 125 });
    expect(r.setups[0].observations[1].instrumentCoordinates).toEqual({ x: 4700060.408, y: 500060.408, h: 125.432 });
  });

  test('only one horizontal coordinate word -> AXIS_MAPPING_UNRESOLVED and no coordinates (never half-mapped)', () => {
    const text = ['110001+00000101 84..10+01000000 88..10+00001500 ', '110002+00000201 21.322+05000000 31..00+00012345 82..00+02000000 '].join('\n');
    const r = review(text);
    expect(r.issues.filter((i) => i.code === 'AXIS_MAPPING_UNRESOLVED').map((i) => i.record)).toEqual([1, 2]);
    expect(r.setups[0].stationCoordinates).toBeNull();
    expect(r.setups[0].observations[0].instrumentCoordinates).toBeNull();
  });

  test('DMS angles keep their components (the same shape a notebook DMS angle has)', () => {
    const o = review(F.B_GSI16_SINGLE).setups[0].observations[1];
    expect(o.hz.unit).toBe('deg');
    expect(o.hz.components).toBeTruthy();
  });
});

describe('issues, exclusions and partial imports', () => {
  test('J: a malformed record is an error record (never evidence); excluding it explicitly makes the rest confirmable', () => {
    const r = review(F.J_MALFORMED_WORD, { orientation: {} });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([expect.objectContaining({ code: 'MALFORMED_NUMBER', record: 2, line: 2, word: '21' })]);
    expect(r.setups[0].observations.map((o) => o.target)).toEqual(['202']);
    expect(r.records.map((x) => x.status)).toEqual(['ok', 'error', 'ok']);
    expect(r.summary.canConfirm).toBe(false);

    const ok = review(F.J_MALFORMED_WORD, { excluded: [2] });
    expect(ok.records.map((x) => x.status)).toEqual(['ok', 'excluded', 'ok']);
    expect(ok.summary).toMatchObject({ excluded: 1, errors: 0, canConfirm: true });
  });

  test('I: an unknown optional word is a warning only - the observation is still evidence', () => {
    const r = review(F.I_UNKNOWN_WORD);
    expect(codes(r, 'warning')).toEqual(['UNKNOWN_WORD', 'MISSING_ORIENTATION']);
    expect(r.summary).toMatchObject({ unknownWords: 1, canConfirm: true, observations: 1 });
    expect(r.records[1].words.find((w) => w.code === '99')).toMatchObject({ label: 'Неизвестно поле Leica', raw: '99..00+00004711', category: 'unknown' });
  });

  test('K: an unsupported unit blocks the record; excluding it leaves no observations', () => {
    expect(codes(review(F.K_FEET), 'error')).toEqual(['UNSUPPORTED_UNIT']);
    expect(codes(review(F.K_FEET, { excluded: [2] }), 'error')).toEqual(['NO_OBSERVATIONS']);
  });

  test('excluding a station record excludes its whole setup - its measurements are never moved to another station', () => {
    const r = review(F.C_MULTI_STATION, { excluded: [4], orientation: { s1: 2 } });
    expect(r.setups.map((s) => s.key)).toEqual(['s1']);
    expect(r.setups[0].observations.map((o) => o.target)).toEqual(['102']);
    expect(r.records.filter((x) => x.status === 'excluded').map((x) => x.seq)).toEqual([4, 5, 6]);
  });

  test('duplicate target within a setup is an error on both (no averaging)', () => {
    const text = [F.A_GSI8_SINGLE, '110004+00000201 21.322+05012350 22.322+09876540 31..00+00085433 '].join('\n');
    const r = review(text, { orientation: { s1: 2 } });
    expect(r.issues.filter((i) => i.code === 'DUPLICATE_OBSERVATION').map((i) => i.record)).toEqual([3, 4]);
    expect(review(text, { orientation: { s1: 2 }, excluded: [4] }).summary.canConfirm).toBe(true);
  });

  test('target / orientation equal to the station, missing point number / Hz, non-positive distance', () => {
    const base = '110001+00000101 88..10+00001500 ';
    const one = (rec, d) => codes(review([base, rec].join('\n'), d), 'error');
    expect(one('110002+00000101 21.322+05000000 31..00+00012345 ')).toEqual(['TARGET_IS_STATION']);
    expect(one('110002+00000101 21.322+05000000 31..00+00012345 ', { orientation: { s1: 2 } })).toEqual(['COINCIDENT_ORIENTATION', 'NO_OBSERVATIONS']);
    expect(one('21.322+05000000 31..00+00012345 ')).toEqual(['MISSING_TARGET']);
    expect(one('110002+00000201 31..00+00012345 ')).toEqual(['MISSING_DIRECTION']);
    expect(one('110002+00000201 21.322+05000000 31..00+00000000 ')).toEqual(['NON_POSITIVE_DISTANCE']);
    expect(one('110002+00000201 21.322+05000000 31..00+00012345 87..10-00001000 ')).toEqual(['NEGATIVE_HEIGHT']);
  });

  test('decisions that do not match the file are INVALID_DECISION, never silently ignored', () => {
    expect(codes(review(F.A_GSI8_SINGLE, { orientation: { s1: 99 } }), 'error')).toEqual(['INVALID_DECISION']);
    expect(codes(review(F.A_GSI8_SINGLE, { orientation: { s1: 1 } }), 'error')).toEqual(['INVALID_DECISION']); // a station record
    expect(codes(review(F.A_GSI8_SINGLE, { excluded: [42] }), 'error')).toEqual(['INVALID_DECISION']);
  });
});

describe('properties', () => {
  const all = [F.A_GSI8_SINGLE, F.B_GSI16_SINGLE, F.C_MULTI_STATION, F.E_HORIZONTAL, F.F_DEGREES_AND_CODES, F.I_UNKNOWN_WORD, F.J_MALFORMED_WORD, F.K_FEET];
  test.each(all.map((t, i) => [i, t]))('fixture %i: deterministic, every record listed, no NaN / Infinity', (_i, text) => {
    const a = review(text, { orientation: { s1: 2 } });
    const b = review(text, { orientation: { s1: 2 } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.records.map((r) => r.seq)).toEqual(snap(text).lines.map((_l, i) => i + 1));
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
    // every non-excluded measurement is either evidence or carries an error - nothing disappears
    const evidence = new Set(a.setups.flatMap((s) => [...s.observations.map((o) => o.source.record), s.orientationRecord]));
    const errored = new Set(a.issues.filter((i) => i.severity === 'error').map((i) => i.record));
    for (const r of a.records.filter((x) => x.kind === 'measurement' && x.status !== 'excluded')) {
      expect(evidence.has(r.seq) || errored.has(r.seq)).toBe(true);
    }
  });
});
