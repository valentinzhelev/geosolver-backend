const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    enum: ['free', 'professional', 'custom']
  },
  displayName: {
    bg: { type: String, required: true },
    en: { type: String, required: true }
  },
  price: {
    monthly: { type: Number, default: 0 },
    yearly: { type: Number, default: 0 }
  },
  stripePriceIdMonthly: { type: String },
  stripePriceIdYearly: { type: String },
  features: [{
    bg: { type: String, required: true },
    en: { type: String, required: true }
  }],
  limits: {
    calculationsPerDay: { type: Number, default: 5 },
    calculationsPerMonth: { type: Number, default: 150 },
    calculationsPerTool: { type: Number, default: 5 },
    unlimited: { type: Boolean, default: false }
  },
  isActive: { type: Boolean, default: true },
  isRecommended: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
