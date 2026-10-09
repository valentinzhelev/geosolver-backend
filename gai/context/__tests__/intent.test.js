/** V1.0.2 deterministic routing table (Section 23) - each question pulls only the evidence it needs. */
const { detectIntent, extractPointNameCandidates } = require('../intent');

const route = (q, opts) => {
  const i = detectIntent(q, opts);
  return Object.keys(i).filter((k) => k.startsWith('wants') && k !== 'wantsSummary' && i[k]).sort();
};

describe('routing table', () => {
  it.each([
    ['Обобщи проекта', ['wantsOverview']],
    ['Колко точки има?', []],
    ['Как е получена точка 201?', []],
    ['Защо точка 202 няма H?', []],
    ['Каква е невръзката на последния ход?', ['wantsTraverse']],
    ['Кои данни чакат проверка?', ['wantsReview']],
    ['Кои отчети са генерирани?', ['wantsReports']],
    ['Има ли отворени полигонови ходове?', ['wantsOpenOnly', 'wantsTraverse']],
    ['Обясни Bowditch обработката.', ['wantsProcessing', 'wantsTraverse']],
    ['Обясни последната обработка', ['wantsProcessing']],
    ['Кои точки са създадени от последната обработка?', ['wantsCreatedPoints', 'wantsProcessing']],
    ['Какво се промени последно в проекта?', ['wantsOverview']],
  ])('%s', (q, expected) => {
    expect(route(q)).toEqual(expected);
  });

  it('point questions extract the point name; nonexistent-looking names are still looked up (never invented)', () => {
    expect(detectIntent('Как е получена точка 201?').pointNameCandidates).toEqual(['201']);
    expect(detectIntent('Какви са координатите на точка 999999?').pointNameCandidates).toEqual(['999999']);
  });
});

describe('point-name extraction ignores numbers that are not point names', () => {
  it.each([
    ['Проектът в EPSG:7801 ли е?', []],
    ['Проектът има ли 31 точки?', []],
    ['Невръзката 0.037 m ли е?', []],
    ['Какво е заснето на 22.09.2026?', []],
    ['Покажи 5 отчета', []],
    ['точка 101А и точка 7', ['101А', '7']],
  ])('%s', (q, expected) => {
    expect(extractPointNameCandidates(q)).toEqual(expected);
  });
});

describe('follow-up questions inherit the previous topic only when referential and topic-less', () => {
  it('"Кои точки са създадени от него?" after a traverse question -> traverse runs', () => {
    const i = detectIntent('Кои точки са създадени от него?', { previousQuestion: 'Обясни последния полигонов ход' });
    expect(i.followUp).toBe(true);
    expect(i.wantsTraverse).toBe(true);
    expect(i.wantsCreatedPoints).toBe(true);
  });

  it('"А защо тя няма H?" style follow-up inherits the point', () => {
    const i = detectIntent('А защо тази точка няма H?', { previousQuestion: 'Как е получена точка 202?' });
    expect(i.pointNameCandidates).toEqual(['202']);
  });

  it('a question with its own topic is never overridden by history', () => {
    const i = detectIntent('Кои отчети са генерирани от тази обработка?', { previousQuestion: 'Обясни последния полигонов ход' });
    expect(i.followUp).toBe(false);
    expect(i.wantsTraverse).toBe(false);
  });

  it('no previous question -> no inheritance', () => {
    expect(detectIntent('Кои точки са създадени от него?').wantsTraverse).toBe(false);
  });
});
