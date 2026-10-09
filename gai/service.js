/**
 * Ties the pieces together for one GAI turn (sections 3/13/14): deterministic context -> semantic projection ->
 * versioned system prompt -> provider.complete() -> {text, evidence, model, promptVersion}. This is the ONLY place
 * that calls a provider - the read-only tool layer never does, and routes/gai.js never calls a provider directly.
 *
 * Independent kill switch: GAI_V1_ENABLED=true in Railway/env allows this project assistant to call a provider.
 * Default is OFF (any other/missing value). When off, answerQuestion refuses before touching buildContext or the
 * provider at all.
 *
 * Conversation history (V1.0.2): the last few prior turns are passed so a follow-up ("…от него?") is understood,
 * but they are NEVER evidence - they are length-capped and id-masked, the system prompt marks them as
 * non-authoritative, and every turn gets a freshly built data block from the deterministic tools.
 */
const { buildContext } = require('./context/buildContext');
const { toSemanticContext, renderUserTurn, untrusted } = require('./context/semanticContext');
const { SYSTEM_PROMPT, PROMPT_VERSION } = require('./prompt/systemPrompt');
const { getProvider } = require('./provider');
const { gaiError } = require('./errors');

const HISTORY_TEXT_CAP = { user: 500, assistant: 800 };

function isGaiV1Enabled() {
  return process.env.GAI_V1_ENABLED === 'true';
}

/** Prior turns -> provider messages (oldest first). Only plain text; never prior evidence or data blocks. */
function historyMessages(history) {
  return (history || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role, content: untrusted(m.text, HISTORY_TEXT_CAP[m.role]) }));
}

/**
 * @param {{projectId:string, userId:string, question:string, history?:{role:string,text:string}[], providerName?:string}} args
 * @returns {Promise<{text:string, evidence:Array, model:string, promptVersion:string}>}
 */
async function answerQuestion({ projectId, userId, question, history = [], providerName = 'openai' }) {
  if (!isGaiV1Enabled()) throw gaiError('GAI_DISABLED');

  const previousUser = [...(history || [])].reverse().find((m) => m.role === 'user');
  const context = await buildContext({ projectId, userId, question, previousQuestion: previousUser && previousUser.text });
  const provider = getProvider(providerName);

  const text = await provider.complete({
    system: SYSTEM_PROMPT,
    messages: [...historyMessages(history), { role: 'user', content: renderUserTurn(toSemanticContext(context), question) }],
  });

  return { text, evidence: context.evidence, model: provider.model || provider.name, promptVersion: PROMPT_VERSION };
}

module.exports = { answerQuestion, isGaiV1Enabled };
