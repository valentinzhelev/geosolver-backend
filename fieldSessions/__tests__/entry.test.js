const { normalizeSetups, normalizeMetadata, isBlankRow } = require('../entry');
const { getConfig } = require('../config');

const setup = (over = {}) => ({ index: 0, station: { point: '101', instrumentHeight: '1.52', notes: '' }, orientation: { target: '102', direction: '0' }, observations: [], ...over });
const obs = (over = {}) => ({ target: '201', hz: '10', distance: '50', ...over });

describe('normalizeSetups', () => {
  it('keeps order, trims, allow-lists fields and drops unknown keys', () => {
    const out = normalizeSetups([setup({ evil: 'x', station: { point: '  101 ', instrumentHeight: 1.52, notes: '', __proto__x: 1 }, observations: [obs({ hacker: 'y', hz: ' 12,5 ' })] })]);
    expect(out[0].station).toEqual({ point: '101', instrumentHeight: '1.52', notes: '' });
    expect(out[0].observations[0]).toEqual({ row: 0, target: '201', hz: '12,5', vz: '', distance: '50', horizontalDistance: '', prismHeight: '', code: '', notes: '' });
    expect(out[0].evil).toBeUndefined();
    expect(out[0].observations[0].hacker).toBeUndefined();
  });

  it('assigns stable unique ids: keeps valid unique ones, fills the rest after the maximum', () => {
    const out = normalizeSetups([
      setup({ index: 5, observations: [obs({ row: 7 }), obs({ target: '202' }), obs({ target: '203', row: 7 }), obs({ target: '204', row: 2 })] }),
      setup({ index: 5, station: { point: '102' } }),
      setup({ index: undefined, station: { point: '103' } }),
    ]);
    expect(out.map((s) => s.index)).toEqual([5, 6, 7]);
    expect(out[0].observations.map((o) => o.row)).toEqual([7, 8, 9, 2]);
  });

  it('strips control characters and newlines from every text field', () => {
    const out = normalizeSetups([setup({ station: { point: '10\u00001\n', instrumentHeight: '', notes: 'a\r\nb' } })]);
    expect(out[0].station.point).toBe('101');
    expect(out[0].station.notes).toBe('a b');
  });

  it('an empty orientation pair is preserved as the pair (the form always sends it); a missing one is null', () => {
    expect(normalizeSetups([setup({ orientation: { target: '', direction: '' } })])[0].orientation).toEqual({ target: '', direction: '' });
    expect(normalizeSetups([setup({ orientation: undefined })])[0].orientation).toBeNull();
  });

  it.each([
    ['not an array', 'x'],
    ['a non-object setup', [1]],
    ['a non-array observations', [setup({ observations: 'x' })]],
    ['an object-valued field', [setup({ observations: [obs({ target: { $gt: '' } })] })]],
    ['an over-long field', [setup({ station: { point: 'x'.repeat(201) } })]],
  ])('rejects %s', (_, input) => {
    expect(() => normalizeSetups(input)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }));
  });

  it('enforces the structural bounds', () => {
    const { limits } = getConfig();
    expect(() => normalizeSetups(Array.from({ length: limits.maxSetups + 1 }, () => setup()))).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => normalizeSetups([setup({ observations: Array.from({ length: limits.maxObservationsPerSetup + 1 }, () => obs()) })])).toThrow();
    const many = Array.from({ length: 10 }, (_, i) => setup({ index: i, observations: Array.from({ length: 400 }, () => obs()) }));
    expect(() => normalizeSetups(many)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' })); // 4000 > 3000 total
  });
});

describe('normalizeMetadata', () => {
  it('accepts optional metadata and a calendar date', () => {
    expect(normalizeMetadata({ title: ' Сесия ', date: '2026-10-09', operator: 'В. Желев', angleUnit: 'deg' }))
      .toEqual({ title: 'Сесия', date: '2026-10-09', operator: 'В. Желев', angleUnit: 'deg' });
    expect(normalizeMetadata({})).toEqual({});
    expect(normalizeMetadata({ date: '' })).toEqual({ date: '' });
  });

  it.each([['bad date', { date: '09.10.2026' }], ['impossible date', { date: '2026-13-45' }], ['bad unit', { angleUnit: 'rad' }], ['object title', { title: {} }]])('rejects %s', (_, input) => {
    expect(() => normalizeMetadata(input)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });
});

describe('isBlankRow', () => {
  it('only a row with every field empty is blank', () => {
    expect(isBlankRow({ target: '', hz: ' ', vz: '', distance: '', horizontalDistance: '', prismHeight: '', code: '', notes: '' })).toBe(true);
    expect(isBlankRow({ target: '', hz: '', vz: '', distance: '', horizontalDistance: '', prismHeight: '', code: 'K', notes: '' })).toBe(false);
  });
});
