const { parseAngle, inferColumnAngleUnit, inCircleBounds } = require('../angles');

describe('gon parsing (explicit suffix)', () => {
  it.each(['94.5000g', '94,5000 gon', '94.5 grad', '94.5G'])('%s -> 94.5 gon', (text) => {
    expect(parseAngle(text)).toMatchObject({ status: 'ok', value: 94.5, unit: 'gon' });
  });
});

describe('decimal degree parsing (explicit degree symbol)', () => {
  it.each(['94.5°', '94,5°', '94.5º'])('%s -> 94.5 deg', (text) => {
    expect(parseAngle(text)).toMatchObject({ status: 'ok', value: 94.5, unit: 'deg' });
  });
});

describe('DMS parsing', () => {
  it('full degrees/minutes/seconds', () => {
    const r = parseAngle('94°30\'15"');
    expect(r.status).toBe('ok');
    expect(r.unit).toBe('deg');
    expect(r.value).toBeCloseTo(94 + 30 / 60 + 15 / 3600, 6);
    expect(r.components).toEqual({ deg: 94, min: 30, sec: 15 });
  });

  it('degrees and minutes only (no seconds)', () => {
    const r = parseAngle('94°30\'');
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(94.5, 6);
    expect(r.components).toEqual({ deg: 94, min: 30, sec: 0 });
  });

  it('a negative DMS angle keeps its sign across all three components', () => {
    const r = parseAngle('-10°15\'30"');
    expect(r.value).toBeCloseTo(-(10 + 15 / 60 + 30 / 3600), 6);
    expect(r.components.deg).toBe(-10);
  });

  it('accepts a comma decimal in seconds', () => {
    expect(parseAngle('94°30\'15,5"').value).toBeCloseTo(94 + 30 / 60 + 15.5 / 3600, 6);
  });
});

describe('validation catches malformed / impossible angles, never normalizes them silently', () => {
  it('minutes >= 60 is rejected', () => {
    expect(parseAngle('94°60\'00"')).toMatchObject({ status: 'invalid', reason: 'MINUTES_OUT_OF_RANGE', value: null });
  });
  it('seconds >= 60 is rejected', () => {
    expect(parseAngle('94°30\'60"')).toMatchObject({ status: 'invalid', reason: 'SECONDS_OUT_OF_RANGE', value: null });
  });
  it('gon outside [0,400) is rejected', () => {
    expect(parseAngle('400.0000g')).toMatchObject({ status: 'invalid', reason: 'ANGLE_OUT_OF_RANGE' });
    expect(parseAngle('450g')).toMatchObject({ status: 'invalid' });
  });
  it('degrees outside [0,360) is rejected', () => {
    expect(parseAngle('360.0°')).toMatchObject({ status: 'invalid', reason: 'ANGLE_OUT_OF_RANGE' });
  });
  it('malformed symbols are rejected, not guessed', () => {
    expect(parseAngle('94#30').status).toBe('invalid');
    expect(parseAngle('abc').status).toBe('invalid');
    expect(parseAngle("94°'15\"").status).toBe('invalid'); // minutes missing but a seconds mark present
  });
  it('empty / null / whitespace is "empty", not "invalid"', () => {
    expect(parseAngle('').status).toBe('empty');
    expect(parseAngle('   ').status).toBe('empty');
    expect(parseAngle(null).status).toBe('empty');
    expect(parseAngle(undefined).status).toBe('empty');
  });
});

describe('ambiguous angle unit: NEVER guessed between gon and degrees', () => {
  it('a bare number with no symbol and no column context is ambiguous', () => {
    expect(parseAngle('94.5000')).toMatchObject({ status: 'ambiguous', reason: 'AMBIGUOUS_ANGLE_UNIT', value: 94.5 });
  });

  it('a column unit hint resolves an otherwise-ambiguous bare number - but is still validated', () => {
    expect(parseAngle('94.5000', { columnUnit: 'gon' })).toMatchObject({ status: 'ok', value: 94.5, unit: 'gon' });
    expect(parseAngle('94.5000', { columnUnit: 'deg' })).toMatchObject({ status: 'ok', value: 94.5, unit: 'deg' });
    expect(parseAngle('450', { columnUnit: 'gon' })).toMatchObject({ status: 'invalid', reason: 'ANGLE_OUT_OF_RANGE' });
  });

  it('an explicit marker on the cell itself is never overridden by a column hint', () => {
    expect(parseAngle('94.5°', { columnUnit: 'gon' })).toMatchObject({ status: 'ok', unit: 'deg' });
  });
});

describe('inferColumnAngleUnit: resolves a column from its OWN unambiguous cells (numeric.js-style)', () => {
  it('a single consistent unit across explicit cells resolves the column', () => {
    expect(inferColumnAngleUnit(['94.5000g', '10.0000g', '200.0000g'])).toEqual({ unit: 'gon', mixed: false });
    expect(inferColumnAngleUnit(['94.5°', '10.0°'])).toEqual({ unit: 'deg', mixed: false });
  });
  it('no explicit cell at all -> no unit resolved, not a guess', () => {
    expect(inferColumnAngleUnit(['94.5000', '10.0000'])).toEqual({ unit: null, mixed: false });
  });
  it('mixed gon and degree cells in the same column are flagged, not resolved', () => {
    expect(inferColumnAngleUnit(['94.5g', '10.0°'])).toEqual({ unit: null, mixed: true });
  });
});

describe('inCircleBounds', () => {
  it('is exported for reuse and matches the documented bounds', () => {
    expect(inCircleBounds(399.9999, 'gon')).toBe(true);
    expect(inCircleBounds(400, 'gon')).toBe(false);
    expect(inCircleBounds(359.9, 'deg')).toBe(true);
    expect(inCircleBounds(-10, 'deg')).toBe(true); // magnitude-based, a negative bearing offset is still "in bounds"
  });
});
