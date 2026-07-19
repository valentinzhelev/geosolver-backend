const mongoose = require('mongoose');
const crypto = require('crypto');

const MEMBER_ROLES = ['viewer', 'editor', 'admin'];

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inviteCode: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(4).toString('hex').toUpperCase(),
    },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: MEMBER_ROLES, default: 'editor' },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

workspaceSchema.index({ 'members.user': 1 });

module.exports = mongoose.model('Workspace', workspaceSchema);
module.exports.MEMBER_ROLES = MEMBER_ROLES;
