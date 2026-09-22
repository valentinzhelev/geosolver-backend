const { fmtCoord, fmtHeight, heightUnavailableLabel, fmtDistance, fmtGon, fmtDeg, fmtDMS, fmtRelativeClosure, fmtDateTime, DASH } = require('../formatting');

describe('fmtCoord: never rounds the underlying value, only formats for display', () => {
  it('formats to 3 decimals by default', () => {
    expect(fmtCoord(4700030)).toBe('4700030.000');
    expect(fmtCoord(500050.4567)).toBe('500050.457'); // presentation rounding only, the persisted number is untouched
  });
  it('a custom decimals count is honoured', () => {
    expect(fmtCoord(100.123456, 6)).toBe('100.123456');
  });
  it('null/undefined/NaN become a dash, never a fabricated 0', () => {
    expect(fmtCoord(null)).toBe(DASH);
    expect(fmtCoord(undefined)).toBe(DASH);
    expect(fmtCoord(NaN)).toBe(DASH);
  });
});

describe('fmtHeight / heightUnavailableLabel', () => {
  it('formats a real height like a coordinate', () => {
    expect(fmtHeight(499.5)).toBe('499.500');
  });
  it('a missing height is a dash in the table, with a separate BG/EN label available for detail text', () => {
    expect(fmtHeight(null)).toBe(DASH);
    expect(heightUnavailableLabel(true)).toBe('не е налична');
    expect(heightUnavailableLabel(false)).toBe('not available');
  });
});

describe('fmtDistance', () => {
  it('appends the unit: "125.438 m"', () => {
    expect(fmtDistance(125.438)).toBe('125.438 m');
  });
  it('a missing distance is a dash, not "— m"', () => {
    expect(fmtDistance(null)).toBe(DASH);
  });
});

describe('fmtGon / fmtDeg', () => {
  it('gon: 4 decimals by default, unit suffix', () => {
    expect(fmtGon(123.4567)).toBe('123.4567 gon');
    expect(fmtGon(100)).toBe('100.0000 gon');
  });
  it('degrees: degree symbol suffix', () => {
    expect(fmtDeg(94.5042)).toBe('94.5042°');
  });
});

describe('fmtDMS: degrees/minutes/seconds, independently derived', () => {
  it('94.504222 deg -> 94 deg 30 min 15.2 sec (hand-derived: 0.504222*60=30.25332min, 0.25332*60=15.1992sec)', () => {
    expect(fmtDMS(94.504222)).toBe('94°30\'15.2"');
  });
  it('an exact whole-degree value shows zero minutes/seconds, zero-padded', () => {
    expect(fmtDMS(100)).toBe('100°00\'00.0"');
  });
  it('carries a seconds rounding of 60.0 into minutes (never displays "60.0\\"")', () => {
    // 10 deg, 29 min, 59.97 sec -> rounds to 60.0s at 1 decimal -> carries to 10 deg 30 min 0.0 sec
    const value = 10 + 29 / 60 + 59.97 / 3600;
    expect(fmtDMS(value)).toBe('10°30\'00.0"');
  });
  it('a negative angle keeps its sign on the whole value', () => {
    expect(fmtDMS(-45.5)).toBe('-45°30\'00.0"');
  });
  it('a missing value is a dash', () => {
    expect(fmtDMS(null)).toBe(DASH);
  });
});

describe('fmtRelativeClosure: "1 : N", never a fabricated ratio', () => {
  it('formats and rounds the denominator', () => {
    expect(fmtRelativeClosure(18492.6)).toBe(`1 : ${(18493).toLocaleString('bg-BG')}`);
  });
  it('an unavailable denominator (e.g. perfect closure or OPEN traverse) is a dash', () => {
    expect(fmtRelativeClosure(null)).toBe(DASH);
    expect(fmtRelativeClosure(undefined)).toBe(DASH);
  });
});

describe('fmtDateTime', () => {
  it('formats a real date', () => {
    expect(fmtDateTime('2026-09-22T14:05:00Z', true)).toMatch(/2026/);
  });
  it('an invalid date is a dash, never "Invalid Date"', () => {
    expect(fmtDateTime('not-a-date')).toBe(DASH);
  });
});
