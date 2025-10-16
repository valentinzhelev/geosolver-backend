const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  inviteCode: {
    type: String,
    unique: true,
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  assignments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

classSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate unique invite code
classSchema.pre('save', async function(next) {
  if (!this.inviteCode) {
    let code;
    let isUnique = false;
    
    while (!isUnique) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existingClass = await this.constructor.findOne({ inviteCode: code });
      if (!existingClass) {
        isUnique = true;
      }
    }
    
    this.inviteCode = code;
  }
  next();
});

module.exports = mongoose.model('Class', classSchema);
