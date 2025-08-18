const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['free', 'premium', 'teacher', 'admin'], default: 'free' },
  refreshTokens: [{ type: String }],
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  userPreferences: {
    showToolsInDevelopment: { type: Boolean, default: false }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema); 