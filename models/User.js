const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['free', 'premium', 'teacher', 'admin'], default: 'free' },
  currentPlan: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Plan' 
  },
  subscriptionStatus: { 
    type: String, 
    enum: ['free', 'active', 'cancelled', 'expired'], 
    default: 'free' 
  },
  calculationsUsed: { type: Number, default: 0 },
  calculationsLimit: { type: Number, default: 5 },
  lastCalculationReset: { type: Date, default: Date.now },
  refreshTokens: [{ type: String }],
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  googleId: { type: String, sparse: true }, // Google OAuth ID
  profilePicture: { type: String }, // Profile picture URL
  userPreferences: {
    showToolsInDevelopment: { type: Boolean, default: false }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema); 