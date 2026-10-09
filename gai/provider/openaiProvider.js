/**
 * The real OpenAI provider (V1's only configured LLM vendor - same OPENAI_API_KEY/GAI_LLM_MODEL env vars as the
 * existing classroom narrative feature in utils/gaiLlm.js, same raw-fetch style, no SDK dependency added).
 *
 * V1.0.2: this adapter is the boundary where every vendor-specific failure is normalised into a GaiError with a
 * public code (gai/errors.js) - nothing above it ever sees OpenAI status codes, error JSON, billing links or the
 * API key. Only sanitised diagnostics (HTTP status + the vendor's short error type/code) are logged server-side.
 * Model and timeout are read per call (configurable without a restart in tests; bounded timeout).
 */
const { gaiError } = require('../errors');

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 20000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;

function resolveConfig() {
  const model = String(process.env.GAI_LLM_MODEL || '').trim() || DEFAULT_MODEL;
  const raw = Number(process.env.GAI_LLM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  return { model, timeoutMs };
}

function isConfigured() {
  return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

/** Short, non-sensitive vendor error identifiers only (e.g. "insufficient_quota") - never the message/body. */
async function vendorErrorTags(res) {
  try {
    const body = await res.json();
    const e = (body && body.error) || {};
    const safe = (v) => (typeof v === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(v) ? v : null);
    return { type: safe(e.type), code: safe(e.code) };
  } catch {
    return { type: null, code: null };
  }
}

function codeForHttpStatus(status) {
  if (status === 401 || status === 403) return 'PROVIDER_NOT_CONFIGURED'; // invalid/revoked key = configuration
  if (status === 402 || status === 429) return 'PROVIDER_UNAVAILABLE'; // quota, billing, rate limit
  if (status === 408 || status === 504) return 'PROVIDER_TIMEOUT';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE'; // vendor outage
  return 'PROVIDER_ERROR';
}

/** @param {{system:string, messages:{role:'user'|'assistant', content:string}[]}} args @returns {Promise<string>} */
async function complete({ system, messages }) {
  if (!isConfigured()) throw gaiError('PROVIDER_NOT_CONFIGURED');
  const { model, timeoutMs } = resolveConfig();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, ...messages] }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      console.warn('gai: provider timeout', { timeoutMs });
      throw gaiError('PROVIDER_TIMEOUT');
    }
    console.warn('gai: provider network error', { name: e && e.name });
    throw gaiError('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const tags = await vendorErrorTags(res);
    console.warn('gai: provider error', { httpStatus: res.status, ...tags });
    throw gaiError(codeForHttpStatus(res.status));
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.warn('gai: provider returned non-JSON body');
    throw gaiError('PROVIDER_ERROR');
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) {
    console.warn('gai: provider returned empty content');
    throw gaiError('PROVIDER_ERROR');
  }
  return content;
}

function createOpenAiProvider() {
  return {
    name: 'openai',
    get model() { return resolveConfig().model; },
    isConfigured,
    complete,
  };
}

module.exports = { createOpenAiProvider, resolveConfig };
