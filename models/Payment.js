const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  subscriptionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Subscription' 
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'EUR' },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded'], 
    default: 'pending' 
  },
  paymentMethod: {
    type: { type: String, required: true }, // 'card', 'paypal'
    last4: { type: String },
    brand: { type: String }, // 'visa', 'mastercard', etc.
    expiryMonth: { type: Number },
    expiryYear: { type: Number }
  },
  stripePaymentIntentId: { type: String },
  stripeChargeId: { type: String },
  description: { type: String },
  receiptUrl: { type: String },
  failureReason: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
