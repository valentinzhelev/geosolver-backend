const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['submitted', 'graded', 'returned'],
    default: 'submitted'
  },
  files: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    path: String
  }],
  aiAnalysis: {
    overallScore: {
      type: Number,
      min: 0,
      max: 10
    },
    totalErrors: {
      type: Number,
      default: 0
    },
    errors: [{
      type: {
        type: String,
        enum: ['calculation', 'formula', 'unit', 'logic', 'format']
      },
      description: String,
      location: {
        x: Number,
        y: Number
      },
      severity: {
        type: String,
        enum: ['low', 'medium', 'high']
      },
      suggestion: String
    }],
    correctSteps: [String],
    feedback: String,
    analyzedAt: {
      type: Date,
      default: Date.now
    }
  },
  teacherGrade: {
    score: {
      type: Number,
      min: 0,
      max: 10
    },
    feedback: String,
    gradedAt: Date,
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  finalScore: {
    type: Number,
    min: 0,
    max: 10
  }
});

// Calculate final score when teacher grade is added
submissionSchema.pre('save', function(next) {
  if (this.teacherGrade && this.teacherGrade.score) {
    this.finalScore = this.teacherGrade.score;
  } else if (this.aiAnalysis && this.aiAnalysis.overallScore) {
    this.finalScore = this.aiAnalysis.overallScore;
  }
  next();
});

module.exports = mongoose.model('Submission', submissionSchema);
