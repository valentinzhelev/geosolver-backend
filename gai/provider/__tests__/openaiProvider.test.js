/**
 * V1.0.2 provider boundary: every OpenAI failure is normalised to a public GaiError code with a fixed Bulgarian
 * message; no vendor body, HTTP code, billing link or key ever reaches the error, and logs only carry sanitised tags.
 * global.fetch is mocked - no network, no credits.
 */
const { createOpenAiProvider, resolveConfig } = require('../openaiProvider');
const { PUBLIC_ERRORS } = require('../../errors');

const BILLING_429 = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
    type: 'insufficient_quota', param: null, code: 'insufficient_quota',
  },
};
const LEAK = /OpenAI|openai\.com|429|quota|billing|insufficient|sk-test|\{"error"/i;

const ORIGINAL = { key: process.env.OPENAI_API_KEY, model: process.env.GAI_LLM_MODEL, timeout: process.env.GAI_LLM_TIMEOUT_MS, fetch: global.fetch };
let warn;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test-secret-key';
  delete process.env.GAI_LLM_MODEL;
  delete process.env.GAI_LLM_TIMEOUT_MS;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env.OPENAI_API_KEY = ORIGINAL.key;
  process.env.GAI_LLM_MODEL = ORIGINAL.model;
  process.env.GAI_LLM_TIMEOUT_MS = ORIGINAL.timeout;
  if (ORIGINAL.model === undefined) delete process.env.GAI_LLM_MODEL;
  if (ORIGINAL.timeout === undefined) delete process.env.GAI_LLM_TIMEOUT_MS;
  if (ORIGINAL.key === undefined) delete process.env.OPENAI_API_KEY;
  global.fetch = ORIGINAL.fetch;
  jest.restoreAllMocks();
});

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const call = () => createOpenAiProvider().complete({ system: 's', messages: [{ role: 'user', content: 'q' }] });

async function expectPublicError(code) {
  let err;
  try { await call(); } catch (e) { err = e; }
  expect(err).toBeDefined();
  expect(err).toMatchObject({ name: 'GaiError', code, status: PUBLIC_ERRORS[code].status, message: PUBLIC_ERRORS[code].message });
  expect(err.message).not.toMatch(LEAK);
  const logged = JSON.stringify(warn.mock.calls);
  expect(logged).not.toMatch(/exceeded your current quota|platform\.openai\.com|sk-test-secret-key/);
  return err;
}

describe('success', () => {
  it('returns the content and sends the system prompt first', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { choices: [{ message: { content: 'Отговор.' } }] }));
    await expect(call()).resolves.toBe('Отговор.');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 's' });
    expect(body.model).toBe('gpt-4o-mini');
  });
});

describe('exact production failure: 429 insufficient_quota with billing body', () => {
  it('-> PROVIDER_UNAVAILABLE "Асистентът временно не е достъпен.", only sanitised tags logged', async () => {
    global.fetch = jest.fn(async () => jsonResponse(429, BILLING_429));
    await expectPublicError('PROVIDER_UNAVAILABLE');
    expect(warn).toHaveBeenCalledWith('gai: provider error', { httpStatus: 429, type: 'insufficient_quota', code: 'insufficient_quota' });
  });
});

describe('other failure classes', () => {
  it('missing API key -> PROVIDER_NOT_CONFIGURED without calling the network', async () => {
    delete process.env.OPENAI_API_KEY;
    global.fetch = jest.fn();
    await expectPublicError('PROVIDER_NOT_CONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('invalid key (401) -> PROVIDER_NOT_CONFIGURED', async () => {
    global.fetch = jest.fn(async () => jsonResponse(401, { error: { message: 'Incorrect API key provided: sk-test-secret-key', type: 'invalid_request_error', code: 'invalid_api_key' } }));
    await expectPublicError('PROVIDER_NOT_CONFIGURED');
  });

  it('timeout (abort) -> PROVIDER_TIMEOUT', async () => {
    global.fetch = jest.fn(async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; });
    await expectPublicError('PROVIDER_TIMEOUT');
  });

  it('network failure -> PROVIDER_UNAVAILABLE', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    await expectPublicError('PROVIDER_UNAVAILABLE');
  });

  it('vendor outage (500) -> PROVIDER_UNAVAILABLE', async () => {
    global.fetch = jest.fn(async () => jsonResponse(500, { error: { message: 'The server had an error', type: 'server_error' } }));
    await expectPublicError('PROVIDER_UNAVAILABLE');
  });

  it('other 4xx (e.g. context too long) -> PROVIDER_ERROR', async () => {
    global.fetch = jest.fn(async () => jsonResponse(400, { error: { message: "This model's maximum context length is ...", type: 'invalid_request_error', code: 'context_length_exceeded' } }));
    await expectPublicError('PROVIDER_ERROR');
  });

  it('empty content -> PROVIDER_ERROR', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { choices: [{ message: { content: '  ' } }] }));
    await expectPublicError('PROVIDER_ERROR');
  });

  it('non-JSON success body -> PROVIDER_ERROR', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    await expectPublicError('PROVIDER_ERROR');
  });

  it('a vendor error tag that is not a short identifier is not logged verbatim', async () => {
    global.fetch = jest.fn(async () => jsonResponse(429, { error: { type: 'see https://platform.openai.com/account/billing now', code: null } }));
    await expectPublicError('PROVIDER_UNAVAILABLE');
    expect(warn).toHaveBeenCalledWith('gai: provider error', { httpStatus: 429, type: null, code: null });
  });
});

describe('configuration', () => {
  it('model is configurable, timeout is bounded, garbage falls back to defaults', () => {
    process.env.GAI_LLM_MODEL = ' gpt-4.1-mini ';
    process.env.GAI_LLM_TIMEOUT_MS = '999999';
    expect(resolveConfig()).toEqual({ model: 'gpt-4.1-mini', timeoutMs: 60000 });
    process.env.GAI_LLM_TIMEOUT_MS = '10';
    expect(resolveConfig().timeoutMs).toBe(1000);
    process.env.GAI_LLM_TIMEOUT_MS = 'abc';
    delete process.env.GAI_LLM_MODEL;
    expect(resolveConfig()).toEqual({ model: 'gpt-4o-mini', timeoutMs: 20000 });
    expect(createOpenAiProvider().model).toBe('gpt-4o-mini');
  });
});
