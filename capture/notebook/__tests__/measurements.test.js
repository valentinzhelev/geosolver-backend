const { parseMeasurement } = require('../measurements');

describe('explicit units are preserved and never silently converted', () => {
  it.each([
    ['1.500 m', 1.5, 'm'], ['1,500 m', 1.5, 'm'], ['150 cm', 150, 'cm'], ['1500 mm', 1500, 'mm'], ['1.5м', 1.5, 'm'],
  ])('%s -> %s %s (explicit)', (text, value, unit) => {
    expect(parseMeasurement(text)).toMatchObject({ status: 'ok', value, unit, explicit: true });
  });
});

describe('the ONE documented default: no unit at all -> meters, but visibly NOT explicit', () => {
  it('a bare number is treated as meters, flagged as an assumption (not silently final)', () => {
    expect(parseMeasurement('1.500')).toMatchObject({ status: 'ok', value: 1.5, unit: 'm', explicit: false });
  });
  it('a caller can choose a different default unit explicitly (still flagged non-explicit)', () => {
    expect(parseMeasurement('150', { defaultUnit: 'cm' })).toMatchObject({ status: 'ok', value: 150, unit: 'cm', explicit: false });
  });
});

describe('malformed values are rejected, never guessed', () => {
  it.each(['abc', '1.2.3 m', '', null, undefined])('rejects %p', (text) => {
    const r = parseMeasurement(text);
    expect(['invalid', 'empty']).toContain(r.status);
    expect(r.value).toBeNull();
  });
});

describe('reuses capture/numeric.js for the numeric part (thousands separators, decimal comma)', () => {
  it('a long slope distance with a thousands separator parses correctly', () => {
    expect(parseMeasurement('1 234.567 m')).toMatchObject({ status: 'ok', value: 1234.567, unit: 'm' });
  });
});
