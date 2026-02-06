const mongoose = require('mongoose');

const stripeEventSchema = new mongoose.Schema({
  stripeEventId: { type: String, required: true, unique: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
}, { timestamps: true });

stripeEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('StripeEvent', stripeEventSchema);
