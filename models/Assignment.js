const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  taskTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaskTemplate',
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  variantsCount: {
    type: Number,
    required: true,
    min: 1,
    max: 1000,
    default: 1
  },
  dueDate: {
    type: Date,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Assignment-specific options
  options: {
    allowLateSubmissions: {
      type: Boolean,
      default: true
    },
    lateSubmissionPenalty: {
      type: Number,
      default: 0.1,
      min: 0,
      max: 1
    },
    autoGrade: {
      type: Boolean,
      default: true
    },
    maxAttempts: {
      type: Number,
      default: 3,
      min: 1
    },
    timeLimit: {
      type: Number, // in minutes
      default: null
    },
    showCorrectAnswers: {
      type: Boolean,
      default: false
    },
    showFeedback: {
      type: Boolean,
      default: true
    }
  },
  // Generated variants data
  variants: [{
    variantIndex: {
      type: Number,
      required: true
    },
    inputData: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    solution: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    // Store hashed/rounded solutions for security
    solutionHash: {
      type: String
    }
  }],
  // Status tracking
  status: {
    type: String,
    enum: ['draft', 'active', 'completed', 'archived'],
    default: 'draft'
  },
  // Statistics
  statistics: {
    totalSubmissions: {
      type: Number,
      default: 0
    },
    averageScore: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number,
      default: 0
    }
  },
  // Assignment settings
  settings: {
    gradingCriteria: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    customTolerance: {
      type: Number,
      default: null
    },
    customToleranceType: {
      type: String,
      enum: ['absolute', 'relative', 'percentage'],
      default: 'absolute'
    }
  }
}, { 
  timestamps: true 
});

// Indexes for efficient queries
assignmentSchema.index({ course: 1 });
assignmentSchema.index({ createdBy: 1 });
assignmentSchema.index({ dueDate: 1 });
assignmentSchema.index({ status: 1 });
assignmentSchema.index({ 'variants.variantIndex': 1 });

// Virtual for submission count
assignmentSchema.virtual('submissionCount').get(function() {
  return this.statistics.totalSubmissions;
});

// Method to generate variants
assignmentSchema.methods.generateVariants = async function() {
  const TaskTemplate = mongoose.model('TaskTemplate');
  const template = await TaskTemplate.findById(this.taskTemplate);
  
  if (!template) {
    throw new Error('Task template not found');
  }

  this.variants = [];
  
  for (let i = 0; i < this.variantsCount; i++) {
    try {
      const inputData = template.generateTestData(i, Date.now());
      const solution = template.generateSolution(inputData);
      
      // Create solution hash for security
      const crypto = require('crypto');
      const solutionHash = crypto.createHash('sha256')
        .update(JSON.stringify(solution))
        .digest('hex');
      
      this.variants.push({
        variantIndex: i,
        inputData,
        solution,
        solutionHash
      });
    } catch (error) {
      throw new Error(`Failed to generate variant ${i}: ${error.message}`);
    }
  }
  
  return this.save();
};

// Method to get variant by index
assignmentSchema.methods.getVariant = function(variantIndex) {
  return this.variants.find(v => v.variantIndex === variantIndex);
};

// Method to check if assignment is active
assignmentSchema.methods.isActive = function() {
  return this.status === 'active' && new Date() <= this.dueDate;
};

// Method to check if late submissions are allowed
assignmentSchema.methods.isLateSubmissionAllowed = function() {
  return this.options.allowLateSubmissions && new Date() > this.dueDate;
};

// Pre-save middleware to update statistics
assignmentSchema.pre('save', function(next) {
  if (this.isModified('variants')) {
    // Update statistics when variants change
    this.statistics.totalSubmissions = 0; // This will be updated by submissions
  }
  next();
});

module.exports = mongoose.model('Assignment', assignmentSchema);