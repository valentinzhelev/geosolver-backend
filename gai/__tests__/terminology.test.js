/** V1.0.2 terminology contract: every user-facing label is Bulgarian product language; unknown codes never leak. */
const T = require('../terminology');

const MAPS = ['CAPTURE_STATUS', 'CAPTURE_MODE', 'LEGACY_BOOK_TYPE', 'PROCESSING_TYPE', 'TRAVERSE_TYPE', 'TRAVERSE_STATUS', 'OBSERVATION_STATUS', 'REPORT_TYPE', 'VERTICAL_ANGLE_CONVENTION', 'ISSUE_KIND', 'CLOSURE_REASON'];

describe('label maps', () => {
  it.each(MAPS)('%s: every value is Cyrillic and free of internal terms', (name) => {
    for (const v of Object.values(T[name])) {
      expect(v).toMatch(/[А-Яа-я]/);
      for (const term of T.FORBIDDEN_PROVIDER_TERMS) expect(v).not.toMatch(new RegExp(`(^|[^A-Za-z_])${term.replace(/[-]/g, '\\-')}([^A-Za-z_]|$)`));
    }
  });

  it('specified product terms (Section 2)', () => {
    expect(T.CAPTURE_STATUS.needs_review).toBe('За проверка');
    expect(T.CAPTURE_STATUS.confirmed).toBe('Потвърдено');
    expect(T.TRAVERSE_STATUS.PARTIAL).toBe('Частичен резултат');
    expect(T.TRAVERSE_TYPE.OPEN).toBe('Отворен полигонов ход');
    expect(T.CAPTURE_MODE['field-notebook']).toBe('Полеви карнет');
    expect(T.PROCESSING_TYPE.polar).toBe('Полярна обработка');
    expect(T.PROCESSING_TYPE.traverse).toBe('Обработка на полигонов ход');
  });

  it('unknown codes never fall back to the raw code', () => {
    expect(T.label(T.CAPTURE_STATUS, 'some_new_status')).toBe(T.UNKNOWN_STATE);
    expect(T.reasonMessage('SOME_NEW_REASON')).toBe('Неуточнена причина.');
    expect(T.reasonMessage('PRISM_HEIGHT_MISSING')).toBe('Липсва височина на призмата.');
  });
});

describe('formatters and labels', () => {
  it('dates are dd.mm.yyyy in Bulgarian local time', () => {
    expect(T.formatDate('2026-09-22T22:30:00Z')).toBe('23.09.2026'); // UTC+3 in September
    expect(T.formatDate(null)).toBeNull();
  });

  it('measurements are shown exactly as recorded, never converted', () => {
    expect(T.formatMeasurement({ value: 123.4567, unit: 'gon' })).toBe('123.4567 gon');
    expect(T.formatMeasurement({ value: 50.123, unit: 'm' })).toBe('50.123 m');
    expect(T.formatMeasurement(null)).toBeNull();
  });

  it('run labels: known end, OPEN (last foresight), polar stations', () => {
    expect(T.runLabel({ processingType: 'traverse', start: '101', end: '107' })).toBe('Полигонов ход 101 → 107');
    expect(T.runLabel({ processingType: 'traverse', start: '101', end: null, lastIdentifier: '104' })).toBe('Полигонов ход 101 → 104');
    expect(T.runLabel({ processingType: 'polar', stations: ['101', '102'] })).toBe('Полярна обработка · ст. 101, 102');
    expect(T.captureLabel('field-notebook', '2026-09-22T08:00:00Z')).toBe('Полеви карнет · 22.09.2026');
  });
});
