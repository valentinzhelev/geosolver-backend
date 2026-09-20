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
  // SECURITY: server-only provenance marker. Set exclusively by
  // utils/ensureMvpTemplates.js (never read from req.body anywhere —
  // routes/taskTemplates.js must never add this to its create/update
  // field lists). This — not `tags`, which is plain client-writable
  // input and was never a trust boundary — is what utils/templateTrust.js
  // relies on to identify a genuine system-seeded template.
  isSystemTemplate: {
    type: Boolean,
    default: false
  },
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
// SECURITY (Milestone 0): scripts run through Node's `vm` module, which is
// not a security boundary. Execution is restricted to trusted templates —
// see utils/templateTrust.js. Do not remove this check without replacing
// the underlying sandbox.
taskTemplateSchema.methods.generateTestData = async function(variantIndex = 0, seed = null) {
  const { isTaskTemplateTrusted } = require('../utils/templateTrust');
  if (!(await isTaskTemplateTrusted(this))) {
    throw new Error('Untrusted template: script execution is not permitted for this template.');
  }
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
// SECURITY (Milestone 0): see generateTestData above — same trust gate.
taskTemplateSchema.methods.generateSolution = async function(inputData) {
  const { isTaskTemplateTrusted } = require('../utils/templateTrust');
  if (!(await isTaskTemplateTrusted(this))) {
    throw new Error('Untrusted template: script execution is not permitted for this template.');
  }
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

// Generates ONE variant: the student-visible inputData and the server-side solution.
// SECURITY: goes through generateTestData / generateSolution, so the Milestone 0 trust gate
// (utils/templateTrust.js) still applies — an untrusted template is never executed. When a trusted
// generator provides a reserved `__groundTruth` (utils/taskGroundTruth.js) it is removed from the
// inputData and stored as the solution, so the answer never reaches the student payload.
taskTemplateSchema.methods.generateVariantData = async function(variantIndex = 0, seed = null) {
  const { splitGroundTruth } = require('../utils/taskGroundTruth');
  const generated = await this.generateTestData(variantIndex, seed);
  const { inputData, groundTruth } = splitGroundTruth(generated);
  const solution = groundTruth !== undefined ? groundTruth : await this.generateSolution(inputData);
  return { inputData, solution };
};

// Pre-save middleware to update usage statistics
taskTemplateSchema.pre('save', function(next) {
  if (this.isModified('usageCount')) {
    this.lastUsed = new Date();
  }
  next();
});

module.exports = mongoose.model('TaskTemplate', taskTemplateSchema);
