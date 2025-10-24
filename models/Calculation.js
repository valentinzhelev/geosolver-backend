const mongoose = require('mongoose');

const calculationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false 
  },
  toolName: { 
    type: String, 
    required: true,
    enum: [
      'first-basic-task',
      'second-basic-task', 
      'forward-intersection',
      'resection',
      'polar-intersection',
      'coordinate-transformation',
      'hansen-task',
      'area-calculation',
      'distance-bearing',
      'scientific-calculator'
    ]
  },
  toolDisplayName: {
    bg: { type: String, required: true },
    en: { type: String, required: true }
  },
  inputData: { type: mongoose.Schema.Types.Mixed, required: true },
  resultData: { type: mongoose.Schema.Types.Mixed, required: true },
  calculationTime: { type: Number }, // in milliseconds
  ipAddress: { type: String },
  userAgent: { type: String }
}, { timestamps: true });

// Index for efficient queries
calculationSchema.index({ userId: 1, createdAt: -1 });
calculationSchema.index({ toolName: 1, createdAt: -1 });

module.exports = mongoose.model('Calculation', calculationSchema);
