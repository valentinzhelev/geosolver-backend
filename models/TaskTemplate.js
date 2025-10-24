const mongoose = require('mongoose');

const taskTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['coordinate-transformation', 'forward-intersection', 'resection', 'distance-calculation', 'angle-calculation', 'custom'],
    default: 'custom'
  },
  description: {
    type: String,
    required: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    default: 'medium'
  },
  level: {
    type: Number,
    min: 1,
    max: 10,
    default: 5
  },
  // Parameters schema for the generator
  paramsSchema: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // JavaScript function as string for generating task data
  generatorScript: {
    type: String,
    required: true
  },
  // JavaScript function as string for generating solution
  solutionScript: {
    type: String,
    required: true
  },
  // Test cases for validation
  testCases: [{
    input: mongoose.Schema.Types.Mixed,
    expectedOutput: mongoose.Schema.Types.Mixed,
    description: String
  }],
  // Tolerance settings for automatic grading
  gradingSettings: {
    tolerance: {
      type: Number,
      default: 0.001
    },
    toleranceType: {
      type: String,
      enum: ['absolute', 'relative', 'percentage'],
      default: 'absolute'
    },
    maxScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100
    }
  },
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true
  }],
  // Usage statistics
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsed: {
    type: Date
  }
}, { 
  timestamps: true 
});

// Indexes for efficient queries
taskTemplateSchema.index({ createdBy: 1 });
taskTemplateSchema.index({ type: 1 });
taskTemplateSchema.index({ difficulty: 1 });
taskTemplateSchema.index({ isPublic: 1 });
taskTemplateSchema.index({ tags: 1 });

// Method to validate generator script
taskTemplateSchema.methods.validateGenerator = function() {
  try {
    // Basic syntax validation
    new Function(this.generatorScript);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// Method to validate solution script
taskTemplateSchema.methods.validateSolution = function() {
  try {
    // Basic syntax validation
    new Function(this.solutionScript);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// Method to generate test data
taskTemplateSchema.methods.generateTestData = function(variantIndex = 0, seed = null) {
  try {
    const { SandboxExecutor } = require('../utils/sandbox');
    const executor = new SandboxExecutor();
    
    const result = executor.executeGenerator(this.generatorScript, variantIndex, seed);
    
    if (!result.success) {
      throw new Error(`Generator execution failed: ${result.error}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Generator execution failed: ${error.message}`);
  }
};

// Method to generate solution
taskTemplateSchema.methods.generateSolution = function(inputData) {
  try {
    const { SandboxExecutor } = require('../utils/sandbox');
    const executor = new SandboxExecutor();
    
    const result = executor.executeSolution(this.solutionScript, inputData);
    
    if (!result.success) {
      throw new Error(`Solution generation failed: ${result.error}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Solution generation failed: ${error.message}`);
  }
};

// Pre-save middleware to update usage statistics
taskTemplateSchema.pre('save', function(next) {
  if (this.isModified('usageCount')) {
    this.lastUsed = new Date();
  }
  next();
});

module.exports = mongoose.model('TaskTemplate', taskTemplateSchema);
