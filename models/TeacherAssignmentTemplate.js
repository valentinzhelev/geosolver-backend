const mongoose = require('mongoose');

const teacherAssignmentTemplateSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    toolKey: { type: String, required: true },
    description: { type: String, default: '' },
    variantsCount: { type: Number, default: 1, min: 1, max: 30 },
    maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
    daysUntilDue: { type: Number, default: 7, min: 1, max: 90 },
    customTolerance: { type: Number, default: 0.01 },
    customToleranceType: {
      type: String,
      enum: ['absolute', 'relative', 'percentage'],
      default: 'absolute',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TeacherAssignmentTemplate', teacherAssignmentTemplateSchema);
