/**
 * V1.0.2 acceptance (Section 35): the ten acceptance questions against a deterministic rich fixture, through
 * gai/service.js#answerQuestion with a capturing fake provider. Asserts the grounding the SERVER supplies (the data
 * block the model receives + the evidence chips returned), never the model's wording. No live LLM.
 */
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/Calculation', () => require('../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/FieldBookProject');

const FieldBookProject = require('../../models/FieldBookProject');
const { newId } = require('../../tests/support/fakeCaptureModels');
const fx = require('../../tests/support/gaiFixtures');
const { answerQuestion } = require('../service');
const { setProviderForTests } = require('../provider');
const { fakeGaiProvider } = require('../../tests/support/fakeGaiProvider');
const { DATA_START, DATA_END } = require('../context/semanticContext');
const { PROMPT_VERSION } = require('../prompt/systemPrompt');

const PROJECT = newId();
const USER = newId();
const OBJECT_ID = /\b[0-9a-f]{24}\b/i;
const ORIGINAL_ENABLED = process.env.GAI_V1_ENABLED;
const SELECTED = 'Избрана обработка (най-новата съответстваща)';

let provider;
let seeded;
beforeEach(async () => {
  fx.resetAll();
  FieldBookProject.findById.mockImplementation(async () => ({ _id: PROJECT, name: 'Обект Витоша', crs: 'EPSG:7801' }));
  process.env.GAI_V1_ENABLED = 'true';
  provider = fakeGaiProvider({ reply: 'Отговор.' });
  setProviderForTests('openai', provider);
  seeded = await fx.seedRichProject({ projectId: PROJECT, userId: USER });
});
afterEach(() => {
  setProviderForTests('openai', null);
  process.env.GAI_V1_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_ENABLED === undefined) delete process.env.GAI_V1_ENABLED;
});

async function ask(question) {
  const result = await answerQuestion({ projectId: PROJECT, userId: USER, question });
  const turn = provider.calls[provider.calls.length - 1].messages.slice(-1)[0].content;
  const data = JSON.parse(turn.slice(DATA_START.length, turn.indexOf(DATA_END)));
  expect(OBJECT_ID.test(turn)).toBe(false);
  expect(result.promptVersion).toBe(PROMPT_VERSION);
  return { data, evidence: result.evidence, turn };
}

const labels = (evidence) => evidence.map((e) => e.label);

describe('Section 35 acceptance questions', () => {
  it('1. "Обобщи проекта" -> deterministic counts, scoped review result, recent activity and runs', async () => {
    const { data, evidence } = await ask('Обобщи проекта');
    expect(data['Точки']['Брой точки в проекта']).toBe(3);
    expect(data['Обработки']).toMatchObject({ 'Полярни обработки': 1, 'Обработки на полигонов ход': 2 });
    expect(data['Проверка за отворени въпроси']['Резултат']).toBe('Открити елементи: 3');
    expect(data['Последни обработки'].map((r) => r['Обработка'])).toEqual(['Полигонов ход 101 → 104', 'Полигонов ход 101 → 103', 'Полярна обработка · ст. 101']);
    expect(labels(evidence)).toEqual(['Обект Витоша']);
  });

  it('2. "Колко точки има проектът?" -> the count only (no point list, no issue extraction)', async () => {
    const { data } = await ask('Колко точки има проектът?');
    expect(data['Точки']['Брой точки в проекта']).toBe(3);
    expect(data['Запитани точки']).toBeUndefined();
    expect(data['Проверка за отворени въпроси']).toBeUndefined();
  });

  it('3. "Кои данни чакат проверка?" -> review items with product labels + the user\'s captures', async () => {
    const { data, evidence } = await ask('Кои данни чакат проверка?');
    const items = data['Проверка за отворени въпроси']['Открити елементи'];
    expect(items).toEqual(expect.arrayContaining([
      { 'Вид': 'Заснемане със статус „За проверка“', 'Отнася се за': 'Полеви карнет · 24.09.2026', 'Файл': 'polygon_22_09.jpg' },
    ]));
    expect(data['Заснемания, качени от вас (най-новите първи)'][0]['Състояние']).toBe('За проверка');
    expect(labels(evidence)).toEqual(['Обект Витоша', 'Полеви карнет · 24.09.2026']); // only the item that needs review
  });

  it('4. "Как е получена точка 201?" -> point + stepwise product-language provenance + source observation', async () => {
    const { data, evidence } = await ask('Как е получена точка 201?');
    const p = data['Запитани точки'][0];
    expect(p['Точка']).toEqual({ 'Име': '201', X: 1000, Y: 2050, H: 499.5 });
    expect(p['Произход'].map((s) => s['Стъпка'])).toEqual(['Създадена от обработка', 'Входни данни на обработката', 'Първоизточник']);
    expect(p['Изходен резултат от обработката']).toMatchObject({ 'Станция': '101', 'Ориентир': '102', 'Цел': '201', 'Дирекционен ъгъл към целта (gon)': 100, 'Хоризонтално разстояние (m)': 50 });
    expect(p['Полеви измервания (потвърдени)']['Наклонено разстояние']).toBe('50 m');
    expect(labels(evidence)).toEqual(['Обект Витоша', 'Точка 201', 'Полярна обработка · ст. 101', 'Потвърдени теренни наблюдения · 22.09.2026', 'Полеви карнет · 22.09.2026']);
  });

  it('5. "Защо точка 202 няма H?" -> the persisted reason, verbatim', async () => {
    const { data } = await ask('Защо точка 202 няма H?');
    const p = data['Запитани точки'][0];
    expect(p['Точка'].H).toBe('Няма записана кота');
    expect(p['Изходен резултат от обработката']['Причина за липса на кота']).toBe('Липсва височина на призмата.');
  });

  it('6. "Каква е невръзката на последния полигонов ход?" -> the latest (OPEN) is not applicable; the persisted 0.037 m is listed for 101 → 103', async () => {
    const { data, evidence } = await ask('Каква е невръзката на последния полигонов ход?');
    expect(data[SELECTED]['Невръзка']['Състояние']).toBe('Не е приложимо');
    const list = data['Съответстващи обработки (най-новите първи)'];
    expect(list.find((r) => r['Обработка'] === 'Полигонов ход 101 → 103')['Линейна невръзка (m)']).toBe(0.037);
    expect(labels(evidence)).toContain('Полигонов ход 101 → 104');
  });

  it('7. "Има ли отворени полигонови ходове?" -> only OPEN runs, no closure claimed', async () => {
    const { data } = await ask('Има ли отворени полигонови ходове?');
    expect(data[SELECTED]['Тип на хода']).toBe('Отворен полигонов ход');
    expect(data['Съответстващи обработки (най-новите първи)']).toBeUndefined(); // exactly one OPEN run
    expect(JSON.stringify(data[SELECTED])).not.toMatch(/Линейна невръзка/);
  });

  it('8. "Кои отчети са генерирани?" -> reports only (no processing pulled by "генерирани")', async () => {
    const { data, evidence } = await ask('Кои отчети са генерирани?');
    expect(data['Генерирани отчети (най-новите първи)']).toEqual([{ 'Отчет': 'Координатен регистър', 'Вид': 'Координатен регистър', 'Генериран на': '23.09.2026' }]);
    expect(data[SELECTED]).toBeUndefined();
    expect(labels(evidence)).toEqual(['Обект Витоша', 'Координатен регистър']);
  });

  it('9. "Какви са координатите на точка 999999?" -> not found, nothing invented', async () => {
    const { data, evidence } = await ask('Какви са координатите на точка 999999?');
    expect(data['Запитани точки']).toEqual([{ 'Търсено име': '999999', 'Резултат': 'В проекта няма точка с това име.' }]);
    expect(evidence.some((e) => e.kind === 'surveyPoint')).toBe(false);
  });

  it('10. "Обясни Bowditch обработката." -> compass rule, raw vs adjusted, never least squares', async () => {
    const { data, turn } = await ask('Обясни Bowditch обработката.');
    const list = data['Съответстващи обработки (най-новите първи)'];
    expect(list.find((r) => r['Обработка'] === 'Полигонов ход 101 → 103')['Изравняване по Bowditch']).toBe('Приложено');
    expect(data[SELECTED]['Изравняване']['Метод']).toMatch(/^Bowditch \(компасно правило\)/);
    expect(data[SELECTED]['Отсечки'][0]).toHaveProperty('Сурови координати (преди изравняване)');
    expect(turn).not.toMatch(/най-малките квадрати|МНМК|least squares/i);
  });
});

describe('an earlier (hallucinated) assistant answer never becomes evidence', () => {
  it('a follow-up about a nonexistent point gets fresh NOT_FOUND evidence even if the previous answer invented coordinates', async () => {
    const history = [
      { role: 'user', text: 'Има ли точка 999 в проекта?' },
      { role: 'assistant', text: 'Да, точка 999 е с координати X=0, Y=0, H=100.' }, // invented by a model
    ];
    await answerQuestion({ projectId: PROJECT, userId: USER, question: 'А каква кота има тя?', history });
    const msgs = provider.calls[0].messages;
    const turn = msgs[msgs.length - 1].content;
    const data = JSON.parse(turn.slice(DATA_START.length, turn.indexOf(DATA_END)));
    // topic inherited from the USER's previous question only; the evidence is a fresh lookup
    expect(data['Запитани точки']).toEqual([{ 'Търсено име': '999', 'Резултат': 'В проекта няма точка с това име.' }]);
    // the old answer is passed as conversation text, outside the data block, never inside it
    expect(turn).not.toContain('X=0, Y=0');
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Да, точка 999 е с координати X=0, Y=0, H=100.' });
  });
});

describe('evidence chips carry product names, never internal kinds or ids as labels', () => {
  it.each(['Обобщи проекта', 'Как е получена точка 201?', 'Кои данни чакат проверка?', 'Обясни последния полигонов ход', 'Кои отчети са генерирани?'])('%s', async (q) => {
    const { evidence } = await answerQuestion({ projectId: PROJECT, userId: USER, question: q });
    for (const e of evidence) {
      expect(e.label).toBeTruthy();
      expect(e.label).not.toMatch(OBJECT_ID);
      expect(e.label).not.toMatch(/^(surveyPoint|captureJob|processingRun|fieldObservationSet|report|project|calculation)$/);
      expect(e.label).not.toMatch(/field-notebook|coordinate-table|SurveyPoint|FieldProcessingRun/);
    }
    // ids stay available for navigation
    expect(evidence.every((e) => e.id)).toBe(true);
  });

  it('a processing-generated point links to its real run/notebook/capture ids (scoped to this project)', async () => {
    const { evidence } = await answerQuestion({ projectId: PROJECT, userId: USER, question: 'Как е получена точка 201?' });
    expect(evidence.find((e) => e.kind === 'processingRun').id).toBe(String(seeded.polarRun._id));
    expect(evidence.find((e) => e.kind === 'captureJob').id).toBe(String(seeded.job._id));
  });
});
