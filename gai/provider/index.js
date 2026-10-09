/**
 * GAI LLM provider registry (V1) - mirrors capture/providers/index.js's exact pattern: a provider implements
 * `complete({ system, messages }) -> Promise<string>`; production uses OpenAI (the only LLM vendor already
 * configured anywhere in this repo - utils/gaiLlm.js), tests register a deterministic fixture provider so CI
 * never calls a live LLM (V2.5.x... V1 section 21).
 */
const { createOpenAiProvider } = require('./openaiProvider');
const { gaiError } = require('../errors');

const overrides = new Map();
let cached = null;

function getProvider(name = 'openai') {
  if (overrides.has(name)) return overrides.get(name);
  if (name === 'openai') {
    if (!cached) cached = createOpenAiProvider();
    return cached;
  }
  throw gaiError('PROVIDER_NOT_CONFIGURED');
}

/** Test seam: replace (or with `null` restore) a provider by name. */
function setProviderForTests(name, provider) {
  if (provider) overrides.set(name, provider);
  else overrides.delete(name);
}

module.exports = { getProvider, setProviderForTests };
