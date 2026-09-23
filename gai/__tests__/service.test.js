jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/Calculation', () => require('../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldBookProject');

const SurveyPoint = require('../../models/SurveyPoint');
const CaptureJob = require('../../models/CaptureJob');
const FieldObservationSet = require('../../models/FieldObservationSet');
const FieldProcessingRun = require('../../models/FieldProcessingRun');
const Report = require('../../models/Report');
const Calculation = require('../../models/Calculation');
const FieldBook = require('../../models/FieldBook');
const FieldBookProject = require('../../models/FieldBookProject');
const { answerQuestion, isGaiV1Enabled } = require('../service');
const { setProviderForTests } = require('../provider');
const { fakeGaiProvider } = require('../../tests/support/fakeGaiProvider');
const { PROMPT_VERSION, SYSTEM_PROMPT } = require('../prompt/systemPrompt');

const PROJECT = 'proj1';
const USER = 'user1';
const ORIGINAL_GAI_V1_ENABLED = process.env.GAI_V1_ENABLED;

beforeEach(() => {
  SurveyPoint.__reset();
  CaptureJob.__reset();
  FieldObservationSet.__reset();
  FieldProcessingRun.__reset();
  Report.__reset();
  Calculation.__reset();
  FieldBook.__reset();
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === PROJECT ? { _id: PROJECT, name: 'Обект Витоша', crs: null } : null));
  setProviderForTests('openai', null);
  process.env.GAI_V1_ENABLED = 'true'; // exercised explicitly by the enabled/disabled describe block below
});

afterEach(() => {
  setProviderForTests('openai', null);
  process.env.GAI_V1_ENABLED = ORIGINAL_GAI_V1_ENABLED;
});

describe('gai/service answerQuestion', () => {
  it('never calls a live provider in tests - uses the injected fixture provider', async () => {
    const provider = fakeGaiProvider({ reply: 'Проектът има 0 точки.' });
    setProviderForTests('openai', provider);

    const result = await answerQuestion({ projectId: PROJECT, userId: USER, question: 'Обобщи проекта' });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('Проектът има 0 точки.');
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.model).toBe('fixture-model');
  });

  it('sends the versioned system prompt and evidence-bearing context, never the raw DB documents', async () => {
    await SurveyPoint.create({ user: USER, projectId: PROJECT, name: 'A1', x: 1, y: 1, h: 1 });
    const provider = fakeGaiProvider();
    setProviderForTests('openai', provider);

    await answerQuestion({ projectId: PROJECT, userId: USER, question: 'Колко точки има проектът?' });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].system).toBe(SYSTEM_PROMPT);
    const userContent = provider.calls[0].messages[0].content;
    expect(userContent).toContain('projectSummary');
    expect(userContent).toContain('"pointCount": 1');
  });

  it('returns the evidence list produced by buildContext for source-chip rendering', async () => {
    setProviderForTests('openai', fakeGaiProvider());
    const result = await answerQuestion({ projectId: PROJECT, userId: USER, question: 'Обобщи проекта' });
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.evidence.some((e) => e.kind === 'project')).toBe(true);
  });
});

describe('GAI_V1_ENABLED kill switch', () => {
  it('isGaiV1Enabled() reflects the env var exactly (default OFF for anything but the literal string "true")', () => {
    process.env.GAI_V1_ENABLED = 'true';
    expect(isGaiV1Enabled()).toBe(true);
    for (const v of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      process.env.GAI_V1_ENABLED = v;
      expect(isGaiV1Enabled()).toBe(false);
    }
  });

  it('when disabled, answerQuestion rejects with a 503 GaiError and never touches the provider', async () => {
    process.env.GAI_V1_ENABLED = 'false';
    const provider = fakeGaiProvider();
    setProviderForTests('openai', provider);

    await expect(answerQuestion({ projectId: PROJECT, userId: USER, question: 'Обобщи проекта' }))
      .rejects.toMatchObject({ name: 'GaiError', code: 'GAI_DISABLED', status: 503 });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('when the env var is simply unset, answerQuestion is disabled by default', async () => {
    delete process.env.GAI_V1_ENABLED;
    const provider = fakeGaiProvider();
    setProviderForTests('openai', provider);

    await expect(answerQuestion({ projectId: PROJECT, userId: USER, question: 'Обобщи проекта' }))
      .rejects.toMatchObject({ code: 'GAI_DISABLED' });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('when enabled, answerQuestion calls the provider normally', async () => {
    process.env.GAI_V1_ENABLED = 'true';
    const provider = fakeGaiProvider({ reply: 'Отговор.' });
    setProviderForTests('openai', provider);

    const result = await answerQuestion({ projectId: PROJECT, userId: USER, question: 'Обобщи проекта' });
    expect(result.text).toBe('Отговор.');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
