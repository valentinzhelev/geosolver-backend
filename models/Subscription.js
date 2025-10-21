const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  planId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Plan', 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['active', 'cancelled', 'expired', 'pending'], 
    default: 'active' 
  },
  billingCycle: { 
    type: String, 
    enum: ['monthly', 'yearly'], 
    required: true 
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  autoRenew: { type: Boolean, default: true },
  paymentMethodId: { type: String }, // Stripe payment method ID
  stripeSubscriptionId: { type: String }, // Stripe subscription ID
  lastPaymentDate: { type: Date },
  nextPaymentDate: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
