const mongoose = require('mongoose');

/**
 * A project-scoped GAI conversation (V1 section 12). Holds only identity/lifecycle fields - the actual turns live
 * in GaiMessage, one document per message, so a long conversation never requires rewriting/growing one giant array.
 */
const gaiConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldBookProject', required: true, index: true },
    title: { type: String, default: null }, // set from the first question, purely for the conversation list UI
  },
  { timestamps: true }
);

gaiConversationSchema.index({ projectId: 1, user: 1, createdAt: -1 });

module.exports = mongoose.model('GaiConversation', gaiConversationSchema);
