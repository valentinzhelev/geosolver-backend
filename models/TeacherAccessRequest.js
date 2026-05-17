const mongoose = require('mongoose');

const teacherAccessRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    message: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TeacherAccessRequest', teacherAccessRequestSchema);
