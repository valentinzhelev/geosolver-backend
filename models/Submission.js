const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  variantIndex: {
    type: Number,
    required: true,
    min: 0
  },
  // Student's answers
  answers: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Computed score (0-100)
  computedScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  // Raw comparison results
  rawComparison: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Manual override by teacher
  manualScore: {
    type: Number,
    min: 0,
    max: 100
  },
  // Teacher feedback
  feedback: {
    type: String,
    default: ''
  },
  // Submission metadata
  submittedAt: {
    type: Date,
    default: Date.now
  },
  // Attempt number
  attemptNumber: {
    type: Number,
    default: 1,
    min: 1
  },
  // Time spent (in minutes)
  timeSpent: {
    type: Number,
    default: 0,
    min: 0
  },
  // Status
  status: {
    type: String,
    enum: ['submitted', 'graded', 'needs_review', 'returned'],
    default: 'submitted'
  },
  // Grading details
  gradingDetails: {
    isAutoGraded: {
      type: Boolean,
      default: false
    },
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    gradedAt: {
      type: Date
    },
    gradingComments: {
      type: String
    }
  },
  // Late submission tracking
  isLate: {
    type: Boolean,
    default: false
  },
  latePenalty: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  // Final score after penalties
  finalScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  }
}, { 
  timestamps: true 
});

// Indexes for efficient queries
submissionSchema.index({ assignment: 1, student: 1 });
submissionSchema.index({ student: 1 });
submissionSchema.index({ submittedAt: 1 });
submissionSchema.index({ status: 1 });
submissionSchema.index({ variantIndex: 1 });

// Virtual for final score calculation
submissionSchema.virtual('calculatedFinalScore').get(function() {
  const baseScore = this.manualScore !== undefined ? this.manualScore : this.computedScore;
  const penalty = this.isLate ? this.latePenalty : 0;
  return Math.max(0, baseScore * (1 - penalty));
});

// Method to calculate late penalty
submissionSchema.methods.calculateLatePenalty = function(assignment) {
  if (!this.isLate || !assignment.options.allowLateSubmissions) {
    return 0;
  }
  
  const daysLate = Math.ceil((this.submittedAt - assignment.dueDate) / (1000 * 60 * 60 * 24));
  const penaltyPerDay = assignment.options.lateSubmissionPenalty || 0.1;
  
  return Math.min(0.9, daysLate * penaltyPerDay); // Max 90% penalty
};

// Method to auto-grade submission
submissionSchema.methods.autoGrade = function(assignment, taskTemplate) {
  try {
    const variant = assignment.getVariant(this.variantIndex);
    if (!variant) {
      throw new Error('Variant not found');
    }

    const tolerance = assignment.settings.customTolerance || taskTemplate.gradingSettings.tolerance;
    const toleranceType = assignment.settings.customToleranceType || taskTemplate.gradingSettings.toleranceType;
    
    // Compare answers with solution
    const comparison = this.compareAnswers(this.answers, variant.solution, tolerance, toleranceType);
    
    this.rawComparison = comparison;
    this.computedScore = comparison.score;
    this.gradingDetails.isAutoGraded = true;
    this.status = 'graded';
    
    return comparison;
  } catch (error) {
    this.status = 'needs_review';
    throw error;
  }
};

// Method to compare student answers with solution
submissionSchema.methods.compareAnswers = function(studentAnswers, solution, tolerance, toleranceType) {
  const results = {
    score: 0,
    totalPoints: 0,
    correctAnswers: 0,
    totalAnswers: 0,
    details: []
  };

  // Simple comparison logic - can be extended based on task type
  if (typeof studentAnswers === 'number' && typeof solution === 'number') {
    results.totalAnswers = 1;
    results.totalPoints = 100;
    
    let isCorrect = false;
    if (toleranceType === 'absolute') {
      isCorrect = Math.abs(studentAnswers - solution) <= tolerance;
    } else if (toleranceType === 'relative') {
      isCorrect = Math.abs(studentAnswers - solution) / Math.abs(solution) <= tolerance;
    } else if (toleranceType === 'percentage') {
      isCorrect = Math.abs(studentAnswers - solution) / Math.abs(solution) * 100 <= tolerance;
    }
    
    if (isCorrect) {
      results.correctAnswers = 1;
      results.score = 100;
    } else {
      results.score = Math.max(0, 100 - Math.abs(studentAnswers - solution) / Math.abs(solution) * 100);
    }
    
    results.details.push({
      field: 'answer',
      studentValue: studentAnswers,
      correctValue: solution,
      isCorrect,
      difference: Math.abs(studentAnswers - solution)
    });
  } else if (typeof studentAnswers === 'object' && typeof solution === 'object') {
    // Compare object answers
    const keys = Object.keys(solution);
    results.totalAnswers = keys.length;
    results.totalPoints = 100;
    
    keys.forEach(key => {
      const studentValue = studentAnswers[key];
      const correctValue = solution[key];
      
      if (typeof studentValue === 'number' && typeof correctValue === 'number') {
        let isCorrect = false;
        if (toleranceType === 'absolute') {
          isCorrect = Math.abs(studentValue - correctValue) <= tolerance;
        } else if (toleranceType === 'relative') {
          isCorrect = Math.abs(studentValue - correctValue) / Math.abs(correctValue) <= tolerance;
        } else if (toleranceType === 'percentage') {
          isCorrect = Math.abs(studentValue - correctValue) / Math.abs(correctValue) * 100 <= tolerance;
        }
        
        if (isCorrect) {
          results.correctAnswers++;
        }
        
        results.details.push({
          field: key,
          studentValue,
          correctValue,
          isCorrect,
          difference: Math.abs(studentValue - correctValue)
        });
      }
    });
    
    results.score = (results.correctAnswers / results.totalAnswers) * 100;
  }

  return results;
};

// Pre-save middleware to calculate final score
submissionSchema.pre('save', function(next) {
  this.finalScore = this.calculatedFinalScore;
  next();
});

module.exports = mongoose.model('Submission', submissionSchema);