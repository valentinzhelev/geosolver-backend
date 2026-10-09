/**
 * V1.0.2 regression for the exact production failure: the live OpenAI call returned 429 insufficient_quota and the
 * raw "OpenAI 429: {...billing...}" text reached the user. Uses the REAL OpenAI adapter with global.fetch mocked
 * (no network, no credits) through the full HTTP route, and also covers timeout, missing key, GAI disabled, an
 * unexpected internal error, and retry-after-failure without duplicate history.
 */
process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/Calculation', () => require('../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/GaiConversation', () => require('../../tests/support/fakeCaptureModels').GaiConversation);
jest.mock('../../models/GaiMessage', () => require('../../tests/support/fakeCaptureModels').GaiMessage);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const H = require('../../tests/support/captureApiHarness');
const fx = require('../../tests/support/gaiFixtures');
const { setProviderForTests } = require('../../gai/provider');

jest.setTimeout(20000);

const LEAK = /OpenAI|openai\.com|429|quota|billing|insufficient|sk-test|\{"error"|stack|at Object\./i;
const BILLING_429 = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
    type: 'insufficient_quota', param: null, code: 'insufficient_quota',
  },
};
const ORIGINAL = { enabled: process.env.GAI_V1_ENABLED, key: process.env.OPENAI_API_KEY, fetch: global.fetch };
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const ok = (content) => jsonResponse(200, { choices: [{ message: { content } }] });

beforeEach(() => {
  fx.resetAll();
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('openai', null); // the REAL adapter
  process.env.GAI_V1_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'sk-test-secret-key';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = ORIGINAL.fetch;
  process.env.GAI_V1_ENABLED = ORIGINAL.enabled;
  if (ORIGINAL.enabled === undefined) delete process.env.GAI_V1_ENABLED;
  process.env.OPENAI_API_KEY = ORIGINAL.key;
  if (ORIGINAL.key === undefined) delete process.env.OPENAI_API_KEY;
});

const post = (path, body) => H.authed(app, 'post', `/api/gai${path}`).send(body);
const get = (path) => H.authed(app, 'get', `/api/gai${path}`);
const newConversation = async () => (await post('/conversations', { projectId: H.PROJECT })).body.data;

function expectSafe(res, status, code, message) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ success: false, code, message });
  expect(JSON.stringify(res.body)).not.toMatch(LEAK);
}

describe('exact production failure: OpenAI 429 insufficient_quota', () => {
  it('returns a normalised Bulgarian error, persists nothing, and a retry succeeds without duplicate history', async () => {
    const conv = await newConversation();
    global.fetch = jest.fn(async () => jsonResponse(429, BILLING_429));

    const failed = await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' });
    expectSafe(failed, 503, 'PROVIDER_UNAVAILABLE', 'Асистентът временно не е достъпен.');
    expect((await get(`/conversations/${conv.id}`)).body.data.messages).toHaveLength(0);

    global.fetch = jest.fn(async () => ok('Проектът съдържа точки.'));
    const retried = await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' });
    expect(retried.status).toBe(201);
    const msgs = (await get(`/conversations/${conv.id}`)).body.data.messages;
    expect(msgs.map((m) => [m.role, m.text])).toEqual([['user', 'Обобщи проекта'], ['assistant', 'Проектът съдържа точки.']]);
  });
});

describe('other normalised failures', () => {
  it('timeout -> 504 PROVIDER_TIMEOUT', async () => {
    const conv = await newConversation();
    global.fetch = jest.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    expectSafe(await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' }), 504, 'PROVIDER_TIMEOUT', 'Отговорът се забави прекалено дълго. Опитайте отново.');
  });

  it('missing API key -> 503 PROVIDER_NOT_CONFIGURED, no network call', async () => {
    delete process.env.OPENAI_API_KEY;
    const conv = await newConversation();
    global.fetch = jest.fn();
    expectSafe(await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' }), 503, 'PROVIDER_NOT_CONFIGURED', 'Асистентът не е настроен.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('provider unavailable (network) -> 503 PROVIDER_UNAVAILABLE', async () => {
    const conv = await newConversation();
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.openai.com'); });
    expectSafe(await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' }), 503, 'PROVIDER_UNAVAILABLE', 'Асистентът временно не е достъпен.');
  });

  it('GAI disabled -> 503 GAI_DISABLED, no provider call', async () => {
    process.env.GAI_V1_ENABLED = 'false';
    const conv = await newConversation();
    global.fetch = jest.fn();
    expectSafe(await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' }), 503, 'GAI_DISABLED', 'Асистентът временно не е активен.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('an unexpected internal error -> 500 generic Bulgarian message, raw error text never returned', async () => {
    const conv = await newConversation();
    global.fetch = jest.fn(async () => ok('x'));
    const real = FieldBookProject.findById.getMockImplementation();
    // access check passes (first two lookups), then the summary lookup blows up with a sensitive message
    let calls = 0;
    FieldBookProject.findById.mockImplementation(async (id) => {
      calls += 1;
      if (calls > 1) throw new Error('MongoServerError: connection to 10.0.0.5:27017 refused at Object.<anonymous>');
      return real(id);
    });
    expectSafe(await post(`/conversations/${conv.id}/messages`, { text: 'Обобщи проекта' }), 500, 'INTERNAL', 'Възникна проблем при генерирането на отговора.');
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/10\.0\.0\.5/);
  });
});
