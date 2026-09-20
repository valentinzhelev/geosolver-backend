const { parseNumericCell, inferColumnStyle, parseColumn } = require('../numeric');

const ok = (raw, value, extra = {}) => {
  const r = parseNumericCell(raw);
  expect({ raw, status: r.status, value: r.value }).toEqual({ raw, status: 'ok', value });
  return r;
};

describe('unambiguous formats', () => {
  it('plain integers and signs', () => {
    ok('4700000', 4700000);
    ok('  4700000 ', 4700000);
    ok('-12', -12);
    ok('+7', 7);
    ok('−12.5', -12.5); // unicode minus
    ok('0', 0);
  });

  it('decimal point and decimal comma (any number of decimals except exactly three after a short integer part)', () => {
    ok('4700000.25', 4700000.25);
    ok('4700000,25', 4700000.25);
    ok('12.5', 12.5);
    ok('12,5', 12.5);
    ok('100.1', 100.1);
    ok('4700000.250', 4700000.25); // > 3 digits before the separator: cannot be grouping
    ok('4700000,250', 4700000.25);
    ok('0,125', 0.125);
    ok('.5', 0.5);
  });

  it('thousands separators together with a decimal separator', () => {
    ok('4.700.000,25', 4700000.25); // the case the legacy parser turned into 4.7
    ok('4,700,000.25', 4700000.25);
    ok('4 700 000,25', 4700000.25);
    ok('4 700 000.25', 4700000.25);
    ok('4 700 000,25', 4700000.25); // no-break spaces
    ok('4 700 000,25', 4700000.25); // narrow no-break spaces
    ok("4'700'000.25", 4700000.25);
    ok('1.234,5', 1234.5);
    ok('1,234.5', 1234.5);
  });

  it('a repeated separator is a thousands separator', () => {
    ok('4.700.000', 4700000);
    ok('4,700,000', 4700000);
    ok('4 700 000', 4700000);
  });

  it('NEVER turns 4.700.000,25 into 4.7', () => {
    expect(parseNumericCell('4.700.000,25').value).toBe(4700000.25);
    expect(parseNumericCell('4.700.000,25').value).not.toBe(4.7);
  });

  it('records the format that was used', () => {
    expect(parseNumericCell('4.700.000,25').format).toMatchObject({ decimalSep: ',', groupSep: '.', decimals: 2, definite: true });
    expect(parseNumericCell('4700000').format).toMatchObject({ decimalSep: null, groupSep: null, decimals: 0 });
  });
});

describe('ambiguous formats are never guessed', () => {
  it.each(['4.700', '4,700', '500,123', '12.345'])('"%s" is ambiguous on its own', (raw) => {
    const r = parseNumericCell(raw);
    expect(r.status).toBe('ambiguous');
    expect(r.value).toBeNull();
    expect(r.candidates).toHaveLength(2); // both readings are reported, none chosen
  });

  it('a space is only a digit-group separator: "5 25" is NOT 5.25', () => {
    const r = parseNumericCell('5 25');
    expect(r.status).toBe('invalid');
    expect(r.reason).toBe('AMBIGUOUS_SPACE_SEPARATOR');
  });

  it('the column style may settle an ambiguous cell, but only from the column\'s own definite cells', () => {
    expect(parseNumericCell('4.700', { decimalSep: '.' }).value).toBe(4.7);
    expect(parseNumericCell('4.700', { decimalSep: ',' }).value).toBe(4700);
    const { parsed, style } = parseColumn(['12,5', '4,700', '13,25']);
    expect(style.decimalSep).toBe(',');
    expect(parsed[1]).toMatchObject({ status: 'ok', value: 4.7 });
    expect(parsed[1].format.definite).toBe(false);
    // no definite cell in the column -> stays ambiguous
    expect(parseColumn(['4,700', '5,123']).parsed.map((p) => p.status)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('mixed separators in one column give no style (and are reported as mixed)', () => {
    expect(inferColumnStyle(parseColumn(['12,5', '13.25']).parsed)).toEqual({ decimalSep: null, mixed: true });
  });
});

describe('malformed values are rejected, never repaired', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
  ])('%p -> %s', (raw, status) => expect(parseNumericCell(raw).status).toBe(status));

  it.each(['12a', 'O1', 'l00', '4700000m', '12..5', '1,,5', '1.2.3,4,5', '4700000.', '4700000,', '--1', '4.700,000,25', '4 7000 00', "4'700 000", 'abc', '12 34 5', '1.2.3'])(
    '"%s" is invalid',
    (raw) => {
      const r = parseNumericCell(raw);
      expect(r.status === 'invalid' || r.status === 'ambiguous').toBe(true);
      expect(r.value).toBeNull();
    }
  );

  it('letters are not silently converted to digits (no O->0, l->1)', () => {
    expect(parseNumericCell('4700O00').status).toBe('invalid');
    expect(parseNumericCell('l0.5').status).toBe('invalid');
  });

  it('null / undefined are empty', () => {
    expect(parseNumericCell(null).status).toBe('empty');
    expect(parseNumericCell(undefined).status).toBe('empty');
  });

  it('never mutates its input and is deterministic', () => {
    const raw = '4.700.000,25';
    const a = parseNumericCell(raw);
    const b = parseNumericCell(raw);
    expect(a).toEqual(b);
    expect(raw).toBe('4.700.000,25');
  });
});
