const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  // Operation details
  operation: {
    type: String,
    required: true,
    enum: [
      'create_assignment',
      'update_assignment',
      'delete_assignment',
      'grade_submission',
      'create_course',
      'update_course',
      'delete_course',
      'add_student',
      'remove_student',
      'create_task_template',
      'update_task_template',
      'delete_task_template',
      'view_submissions',
      'export_data',
      'system_action'
    ]
  },
  // User who performed the operation
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Target entity (optional)
  targetEntity: {
    type: {
      type: String,
      enum: ['assignment', 'course', 'submission', 'task_template', 'user', 'system']
    },
    id: {
      type: mongoose.Schema.Types.ObjectId
    }
  },
  // Operation details
  details: {
    description: {
      type: String,
      required: true
    },
    oldValues: {
      type: mongoose.Schema.Types.Mixed
    },
    newValues: {
      type: mongoose.Schema.Types.Mixed
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  // Attached files (optional)
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // IP address and user agent
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now
  },
  // Severity level
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  // Status
  status: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'success'
  }
}, { 
  timestamps: true 
});

// Indexes for efficient queries
auditSchema.index({ performedBy: 1 });
auditSchema.index({ operation: 1 });
auditSchema.index({ timestamp: 1 });
auditSchema.index({ 'targetEntity.type': 1, 'targetEntity.id': 1 });
auditSchema.index({ severity: 1 });
auditSchema.index({ status: 1 });

// Static method to log operation
auditSchema.statics.logOperation = function(data) {
  const audit = new this({
    operation: data.operation,
    performedBy: data.performedBy,
    targetEntity: data.targetEntity,
    details: {
      description: data.description,
      oldValues: data.oldValues,
      newValues: data.newValues,
      metadata: data.metadata || {}
    },
    attachments: data.attachments || [],
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    severity: data.severity || 'low',
    status: data.status || 'success'
  });
  
  return audit.save();
};

// Static method to get audit trail for entity
auditSchema.statics.getAuditTrail = function(entityType, entityId, options = {}) {
  const query = {
    'targetEntity.type': entityType,
    'targetEntity.id': entityId
  };
  
  if (options.operation) {
    query.operation = options.operation;
  }
  
  if (options.severity) {
    query.severity = options.severity;
  }
  
  if (options.dateFrom) {
    query.timestamp = { $gte: options.dateFrom };
  }
  
  if (options.dateTo) {
    query.timestamp = { ...query.timestamp, $lte: options.dateTo };
  }
  
  return this.find(query)
    .populate('performedBy', 'name email role')
    .sort({ timestamp: -1 })
    .limit(options.limit || 100);
};

// Method to add attachment
auditSchema.methods.addAttachment = function(attachmentData) {
  this.attachments.push({
    filename: attachmentData.filename,
    originalName: attachmentData.originalName,
    mimeType: attachmentData.mimeType,
    size: attachmentData.size,
    path: attachmentData.path,
    uploadedAt: new Date()
  });
  
  return this.save();
};

// Method to remove attachment
auditSchema.methods.removeAttachment = function(attachmentId) {
  this.attachments = this.attachments.filter(att => !att._id.equals(attachmentId));
  return this.save();
};

module.exports = mongoose.model('Audit', auditSchema);
