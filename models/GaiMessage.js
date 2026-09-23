const mongoose = require('mongoose');

/**
 * One turn in a GaiConversation (V1 section 12). For an assistant message we persist the final text, the
 * machine-readable evidence references (for source chips - section 6), and provider/prompt metadata for
 * reproducibility. We deliberately do NOT persist hidden chain-of-thought or the raw context JSON sent to the
 * provider - only what the UI actually needs to render and what's needed to know which rules produced the answer.
 */
const evidenceRefSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true }, // 'project' | 'surveyPoint' | 'captureJob' | 'fieldObservationSet' | 'processingRun' | 'report' | 'calculation'
    id: { type: String, default: null },
    label: { type: String, default: null },
  },
  { _id: false }
);

const gaiMessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'GaiConversation', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true },
    evidence: { type: [evidenceRefSchema], default: [] }, // only ever set on assistant messages
    model: { type: String, default: null }, // provider/model name, assistant messages only
    promptVersion: { type: String, default: null }, // gai/prompt/systemPrompt.js PROMPT_VERSION, assistant messages only
  },
  { timestamps: true }
);

gaiMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('GaiMessage', gaiMessageSchema);
