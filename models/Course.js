const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  assignments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    allowLateSubmissions: {
      type: Boolean,
      default: true
    },
    lateSubmissionPenalty: {
      type: Number,
      default: 0.1, // 10% penalty per day
      min: 0,
      max: 1
    },
    autoGrade: {
      type: Boolean,
      default: true
    }
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
courseSchema.index({ owner: 1 });
courseSchema.index({ code: 1 });
courseSchema.index({ students: 1 });

// Virtual for student count
courseSchema.virtual('studentCount').get(function() {
  return this.students.length;
});

// Method to add student to course
courseSchema.methods.addStudent = function(studentId) {
  if (!this.students.includes(studentId)) {
    this.students.push(studentId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to remove student from course
courseSchema.methods.removeStudent = function(studentId) {
  this.students = this.students.filter(id => !id.equals(studentId));
  return this.save();
};

module.exports = mongoose.model('Course', courseSchema);
