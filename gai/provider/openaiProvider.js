/**
 * The real OpenAI provider (V1's only configured LLM vendor - same OPENAI_API_KEY/GAI_LLM_MODEL env vars as the
 * existing classroom narrative feature in utils/gaiLlm.js, same raw-fetch style, no SDK dependency added). A
 * SEPARATE implementation, not a reuse of gaiLlm.js's functions - that module generates a fixed-schema narrative
 * for one classroom submission; this one drives a multi-turn, evidence-grounded project conversation.
 */
const { GaiError } = require('../errors');

const DEFAULT_MODEL = process.env.GAI_LLM_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.GAI_LLM_TIMEOUT_MS || 20000);

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** @param {{system:string, messages:{role:'user'|'assistant', content:string}[]}} args @returns {Promise<string>} */
async function complete({ system, messages }) {
  if (!isConfigured()) throw new GaiError('PROVIDER_NOT_CONFIGURED', 'Асистентът не е настроен.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new GaiError('PROVIDER_ERROR', `OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new GaiError('PROVIDER_ERROR', 'Празен отговор от асистента.');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function createOpenAiProvider() {
  return { name: 'openai', model: DEFAULT_MODEL, isConfigured, complete };
}

module.exports = { createOpenAiProvider };
