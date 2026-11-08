const { decodeText, safeFileName } = require('../text');
const { detectGsi } = require('../leica/gsiDetect');
const { tokenizeLine } = require('../leica/gsiTokenizer');
const { parseGsi, wordOf, withDecimals } = require('../leica/gsiParser');
const { readInstrumentFile } = require('..');
const F = require('../../tests/support/gsiFixtures');

const buf = (s) => Buffer.from(s, 'utf8');
const read = (s) => {
  const { lines } = decodeText(buf(s));
  const { format } = detectGsi(lines);
  return { format, records: parseGsi(lines, format) };
};
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const v = (rec, key) => wordOf(rec, key) && wordOf(rec, key).value;

describe('text intake', () => {
  test('LF, CRLF and lone CR give the same lines; blank lines are dropped but line numbers are the file\'s', () => {
    const a = decodeText(buf('x1\ny2\n\nz3\n')).lines;
    const b = decodeText(buf('x1\r\ny2\r\n\r\nz3\r\n')).lines;
    const c = decodeText(buf('x1\ry2\r\rz3\r')).lines;
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.map((l) => [l.n, l.text])).toEqual([[1, 'x1'], [2, 'y2'], [4, 'z3']]);
  });

  test('UTF-8 BOM and the DOS end-of-file mark are removed', () => {
    const { lines } = decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf('abc\r\n'), Buffer.from([0x1a])]));
    expect(lines.map((l) => l.text)).toEqual(['abc']);
  });

  test('refuses empty, binary, UTF-16 and non-UTF-8 (legacy code page) files with a structured code', () => {
    expect(codeOf(() => decodeText(Buffer.alloc(0)))).toBe('EMPTY_FILE');
    expect(codeOf(() => decodeText(buf('\n \n\r\n')))).toBe('EMPTY_FILE');
    expect(codeOf(() => decodeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])))).toBe('BINARY_FILE');
    expect(codeOf(() => decodeText(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x41, 0x42])))).toBe('BINARY_FILE');
    expect(codeOf(() => decodeText(Buffer.from([0xff, 0xfe, 0x31, 0x00])))).toBe('UNSUPPORTED_ENCODING');
    expect(codeOf(() => decodeText(Buffer.from([0x31, 0x31, 0xe4, 0x20, 0x41])))).toBe('UNSUPPORTED_ENCODING'); // cp1252 "ä"
  });

  test('size and line limits', () => {
    const old = { ...process.env };
    try {
      process.env.INSTRUMENT_IMPORT_MAX_BYTES = '100';
      expect(codeOf(() => decodeText(buf('a'.repeat(101))))).toBe('FILE_TOO_LARGE');
      process.env.INSTRUMENT_IMPORT_MAX_BYTES = '100000';
      process.env.INSTRUMENT_IMPORT_MAX_LINES = '3';
      expect(codeOf(() => decodeText(buf('a\nb\nc\nd')))).toBe('TOO_MANY_LINES');
    } finally {
      process.env = old;
    }
  });

  test('a very long line is truncated, flagged, and becomes an INVALID record (never silently fitted)', () => {
    const { lines } = decodeText(buf(`${'1'.repeat(3000)}\n`));
    expect(lines[0]).toMatchObject({ truncated: true });
    expect(lines[0].text).toHaveLength(1024);
    const [rec] = parseGsi(lines, 'GSI-8');
    expect(rec.kind).toBe('invalid');
    expect(rec.issues.map((i) => i.code)).toEqual(['INVALID_RECORD']);
  });

  test('file names are display-only: path, control and markup characters removed', () => {
    expect(safeFileName('..\\..\\windows/system32/evil<script>.gsi')).toBe('evilscript.gsi');
    expect(safeFileName('a\u0000b\u001fc.gsi')).toBe('abc.gsi');
    expect(safeFileName('')).toBe('instrument.gsi');
    expect(safeFileName(`${'x'.repeat(500)}.gsi`)).toHaveLength(120);
  });

  test('sha256 is of the original bytes', () => {
    expect(decodeText(buf('abc')).sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('tokenizer', () => {
  test('cuts words by WIDTH, keeping raw text, column and positions', () => {
    const words = tokenizeLine('110001+00000101 21.322+05012340', 'GSI-8');
    expect(words).toEqual([
      { raw: '110001+00000101', col: 1, wi2: '11', info: '0001', sign: '+', data: '00000101' },
      { raw: '21.322+05012340', col: 17, wi2: '21', info: '.322', sign: '+', data: '05012340' },
    ]);
  });

  test('a misaligned line is NOT repaired', () => {
    expect(tokenizeLine('110001+0000101 21.322+05012340', 'GSI-8')).toBeNull(); // one digit short
    expect(tokenizeLine('110001+00000101_21.322+05012340', 'GSI-8')).toBeNull(); // wrong separator
    expect(tokenizeLine('110001*00000101', 'GSI-8')).toBeNull(); // no sign
    expect(tokenizeLine('*110001+0000000000000101', 'GSI-8')).toBeNull(); // GSI-16 marker in GSI-8
    expect(tokenizeLine('110001+0000000000000101', 'GSI-16')).toBeNull(); // GSI-16 needs "*"
    expect(tokenizeLine('*110001+0000000000000101', 'GSI-16')[0]).toMatchObject({ col: 2, data: '0000000000000101' });
  });
});

describe('format detection', () => {
  test.each([
    ['A', 'GSI-8', F.A_GSI8_SINGLE],
    ['B', 'GSI-16', F.B_GSI16_SINGLE],
    ['C', 'GSI-8', F.C_MULTI_STATION],
    ['F', 'GSI-8', F.F_DEGREES_AND_CODES],
  ])('fixture %s -> Leica %s', (_n, format, text) => {
    expect(detectGsi(decodeText(buf(text)).lines)).toMatchObject({ vendor: 'leica', format });
  });

  test('mixed GSI-8 / GSI-16 lines -> AMBIGUOUS_GSI_FORMAT', () => {
    expect(codeOf(() => detectGsi(decodeText(buf(F.L_MIXED_MARKERS)).lines))).toBe('AMBIGUOUS_GSI_FORMAT');
  });

  test('16-character words without the "*" marker -> AMBIGUOUS_GSI_FORMAT (never guessed as GSI-16), worded for that cause', () => {
    let err;
    try { detectGsi(decodeText(buf(F.L_SIXTEEN_WITHOUT_MARKER)).lines); } catch (e) { err = e; }
    expect(err.code).toBe('AMBIGUOUS_GSI_FORMAT');
    expect(err.message).toBe('Файлът прилича на Leica GSI-16, но липсва очакваният маркер. Форматът не може да бъде потвърден безопасно.');
    // the mixed-marker refusal keeps its own wording
    let mixed;
    try { detectGsi(decodeText(buf(F.L_MIXED_MARKERS)).lines); } catch (e) { mixed = e; }
    expect(mixed.message).toBe('Форматът не може да бъде определен еднозначно (GSI-8 или GSI-16). Проверете настройките на експорта.');
  });

  test('anything else -> UNSUPPORTED_FORMAT "Форматът не е разпознат."', () => {
    for (const text of [F.NOT_GSI, 'hello world', '000000+00000000 000000+00000000']) {
      let err;
      try { detectGsi(decodeText(buf(text)).lines); } catch (e) { err = e; }
      expect(err.code).toBe('UNSUPPORTED_FORMAT');
      expect(err.message).toBe('Форматът не е разпознат.');
    }
  });

  test('readInstrumentFile: the whole intake in one call, with record / setup limits', () => {
    const r = readInstrumentFile(buf(F.A_GSI8_SINGLE));
    expect(r).toMatchObject({ vendor: 'leica', format: 'GSI-8', bytes: Buffer.byteLength(F.A_GSI8_SINGLE) });
    expect(r.lines).toHaveLength(3);
    const old = { ...process.env };
    try {
      process.env.INSTRUMENT_IMPORT_MAX_RECORDS = '2';
      expect(codeOf(() => readInstrumentFile(buf(F.A_GSI8_SINGLE)))).toBe('TOO_MANY_RECORDS');
      process.env.INSTRUMENT_IMPORT_MAX_RECORDS = '100';
      process.env.INSTRUMENT_IMPORT_MAX_SETUPS = '1';
      expect(codeOf(() => readInstrumentFile(buf(F.C_MULTI_STATION)))).toBe('TOO_MANY_SETUPS');
    } finally {
      process.env = old;
    }
  });
});

describe('record parsing - golden values (derived by hand from the word layout)', () => {
  test('A: GSI-8 gon / metres', () => {
    const { records } = read(F.A_GSI8_SINGLE);
    expect(records.map((r) => r.kind)).toEqual(['station', 'measurement', 'measurement']);
    const [st, m1, m2] = records;
    expect(v(st, 'pointId')).toBe('101');
    expect(wordOf(st, 'pointId').block).toBe('0001');
    expect(v(st, 'stationEasting')).toEqual({ value: 1000, unit: 'm', explicit: true });
    expect(v(st, 'stationNorthing')).toEqual({ value: 2000, unit: 'm', explicit: true });
    expect(v(st, 'stationHeight')).toEqual({ value: 125, unit: 'm', explicit: true });
    expect(v(st, 'instrumentHeight')).toEqual({ value: 1.55, unit: 'm', explicit: true });
    expect(wordOf(st, 'instrumentHeight').inputModeLabel).toBe('ръчно въведено');
    expect(v(m1, 'hz')).toEqual({ value: 0, unit: 'gon', components: null });
    expect(v(m1, 'v')).toEqual({ value: 100, unit: 'gon', components: null });
    expect(v(m2, 'hz')).toEqual({ value: 50.1234, unit: 'gon', components: null });
    expect(v(m2, 'v')).toEqual({ value: 98.7654, unit: 'gon', components: null });
    expect(v(m2, 'slopeDistance')).toEqual({ value: 85.432, unit: 'm', explicit: true });
    expect(v(m2, 'reflectorHeight')).toEqual({ value: 1.6, unit: 'm', explicit: true });
    expect(wordOf(m2, 'hz').display).toBe('50.12340 gon');
    expect(records.every((r) => r.issues.length === 0)).toBe(true);
  });

  test('B: GSI-16 sexagesimal degrees, large coordinates', () => {
    const { records } = read(F.B_GSI16_SINGLE);
    const [st, , m2] = records;
    expect(v(st, 'stationNorthing').value).toBe(4700000);
    expect(v(st, 'stationEasting').value).toBe(500000);
    const hz = v(m2, 'hz');
    expect(hz.unit).toBe('deg');
    expect(hz.value).toBeCloseTo(45 + 30 / 60 + 15 / 3600, 12);
    expect(wordOf(m2, 'hz').display).toBe('45°30\'15.0"');
    expect(v(m2, 'v').value).toBeCloseTo(89 + 59 / 60 + 58 / 3600, 12);
    expect(v(m2, 'targetEasting').value).toBe(500060.408);
    expect(v(m2, 'targetNorthing').value).toBe(4700060.408);
    expect(v(m2, 'targetHeight').value).toBe(125.432);
  });

  test('E: 32 is an explicit HORIZONTAL distance - never a slope distance', () => {
    const { records } = read(F.E_HORIZONTAL);
    expect(v(records[1], 'horizontalDistance')).toEqual({ value: 42.195, unit: 'm', explicit: true });
    expect(wordOf(records[1], 'slopeDistance')).toBeNull();
  });

  test('F: decimal degrees, 4-decimal metres, codes and remarks; a standalone code block is its own record', () => {
    const { records } = read(F.F_DEGREES_AND_CODES);
    const m = records[1];
    expect(v(m, 'hz')).toEqual({ value: 123.45678, unit: 'deg', components: null });
    expect(v(m, 'v')).toEqual({ value: 91.2345, unit: 'deg', components: null });
    expect(v(m, 'slopeDistance')).toEqual({ value: 10, unit: 'm', explicit: true });
    expect(v(m, 'code')).toBe('H66');
    expect(v(m, 'remark1')).toBe('FENCE');
    expect(records[2].kind).toBe('code');
    expect(records[2].words.map((w) => [w.code, w.value])).toEqual([['41', '20'], ['42', 'OFFICE']]);
  });

  test('I: an unknown word is kept with its raw code and a warning, and never used', () => {
    const { records } = read(F.I_UNKNOWN_WORD);
    const w = records[1].words.find((x) => x.code === '99');
    expect(w).toMatchObject({ category: 'unknown', label: 'Неизвестно поле Leica', raw: '99..00+00004711', value: null, key: null });
    expect(records[1].issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_WORD', severity: 'warning', word: '99' })]);
  });

  test('J: a malformed number is an error on that word only; the other records are untouched', () => {
    const { records } = read(F.J_MALFORMED_WORD);
    expect(records[1].issues).toEqual([expect.objectContaining({ code: 'MALFORMED_NUMBER', severity: 'error', word: '21' })]);
    expect(wordOf(records[1], 'hz').value).toBeNull();
    expect(wordOf(records[1], 'hz').raw).toBe('21.322+0A000000');
    expect(records[2].issues).toEqual([]);
  });

  test('K: feet and mil are UNSUPPORTED_UNIT errors - never converted', () => {
    const feet = read(F.K_FEET).records[1];
    expect(feet.issues).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_UNIT', word: '31' })]);
    expect(wordOf(feet, 'slopeDistance')).toMatchObject({ value: null, unitLabel: 'футове' });
    const mil = read(F.K_MIL).records[1];
    expect(mil.issues).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_UNIT', word: '21' })]);
  });

  test('an angle unit on a length word (or vice versa) is UNSUPPORTED_UNIT, an out-of-circle angle is MALFORMED_NUMBER', () => {
    const [rec] = parseGsi([{ n: 1, text: '110001+00000201 21.320+05000000 31..02+00012345 22.322+45000000' }], 'GSI-8');
    expect(rec.issues.map((i) => [i.code, i.word])).toEqual([['UNSUPPORTED_UNIT', '21'], ['UNSUPPORTED_UNIT', '31'], ['MALFORMED_NUMBER', '22']]);
  });

  test('DMS minutes / seconds >= 60 are MALFORMED_NUMBER', () => {
    // 45.60000 = 45 deg 60'; 45.06610 = 45 deg 06' 61.0"; 45.06100 = 45 deg 06' 10.0" (valid)
    const [rec] = parseGsi([{ n: 1, text: '110001+00000201 21.324+04560000 22.324+04506610 21.324+04506100' }], 'GSI-8');
    expect(rec.issues.map((i) => i.code)).toEqual(['MALFORMED_NUMBER', 'MALFORMED_NUMBER']);
    expect(rec.words[3].display).toBe('45°06\'10.0"');
  });

  test('3-digit service word indices are recognised only from the documented list', () => {
    const [rec] = parseGsi([{ n: 1, text: '110001+00000201 560.08+00000012 539.08+00000099' }], 'GSI-8');
    // 560 is a documented 3-digit index; 539 is not, so it is word 53 with info "9.08"
    expect(rec.words.map((w) => [w.code, w.category])).toEqual([['11', 'text'], ['560', 'unused'], ['53', 'unused']]);
  });

  test('withDecimals places the point by digits, never by floating division', () => {
    expect(withDecimals('00156134', 3)).toBe('156.134');
    expect(withDecimals('00000000', 3)).toBe('0.000');
    expect(withDecimals('00000007', 5)).toBe('0.00007');
    expect(withDecimals('39999999', 5)).toBe('399.99999');
    expect(withDecimals('0000000000000101', 0)).toBe('101');
  });
});

describe('properties', () => {
  // deterministic pseudo-random GSI-ish lines (some valid, some broken), seeded
  function lines(seed, n) {
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const wis = ['11', '21', '22', '31', '32', '41', '81', '82', '87', '88', '99', '12', '71'];
    const info = ['0001', '.322', '.324', '..00', '..10', '..06', '....', '..01', '.325'];
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const words = [];
      const k = 1 + Math.floor(rnd() * 6);
      for (let j = 0; j < k; j += 1) {
        const data = Math.floor(rnd() * 1e8).toString().padStart(8, '0');
        const broken = rnd() < 0.05 ? 'X' : '';
        words.push(`${wis[Math.floor(rnd() * wis.length)]}${info[Math.floor(rnd() * info.length)]}${rnd() < 0.1 ? '-' : '+'}${broken}${broken ? data.slice(1) : data}`);
      }
      out.push({ n: i + 1, text: rnd() < 0.04 ? words.join(' ').slice(0, -1) : words.join(' ') });
    }
    return out;
  }

  test.each([1, 7, 42, 1234, 99999])('seed %i: deterministic, order + raw preserved, nothing lost, no NaN / Infinity', (seed) => {
    const input = lines(seed, 120);
    const a = parseGsi(input, 'GSI-8');
    const b = parseGsi(JSON.parse(JSON.stringify(input)), 'GSI-8');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(input.length);
    a.forEach((rec, i) => {
      expect(rec.seq).toBe(i + 1);
      expect(rec.line).toBe(input[i].n);
      expect(rec.raw).toBe(input[i].text);
      if (rec.kind !== 'invalid') {
        expect(rec.words.map((w) => w.raw).join(' ')).toBe(input[i].text.replace(/\s+$/, ''));
        for (const w of rec.words) {
          if (w.category === 'unknown') expect(w.issue && w.issue.code).toBe('UNKNOWN_WORD');
          if (w.value && typeof w.value === 'object') expect(Number.isFinite(w.value.value)).toBe(true);
          if ((w.category === 'angle' || w.category === 'length') && !w.issue) expect(w.value).not.toBeNull();
        }
      } else {
        expect(rec.issues.map((x) => x.code)).toEqual(['INVALID_RECORD']);
      }
    });
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
  });
});
