/**
 * A fixture GAI provider (section 21): CI must never call a live LLM. Tests register this via
 * setProviderForTests('openai', fakeGaiProvider(...)) to replace the real OpenAI provider, then assert on the
 * STRUCTURE handed to it (system prompt, evidence-bearing context) rather than on non-deterministic NL wording.
 */
function fakeGaiProvider({ reply = 'Фиктивен отговор.', model = 'fixture-model' } = {}) {
  const calls = [];
  return {
    name: 'fixture',
    model,
    isConfigured: () => true,
    complete: jest.fn(async ({ system, messages }) => {
      calls.push({ system, messages });
      return typeof reply === 'function' ? reply({ system, messages }) : reply;
    }),
    calls,
  };
}

module.exports = { fakeGaiProvider };
