import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  workflowInstanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkflowInstance',
    required: true,
    index: true
  },
  requestId: {
    type: String,
    required: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    enum: [
      'REQUEST_RECEIVED',
      'INPUT_VALIDATION_PASSED',
      'INPUT_VALIDATION_FAILED',
      'EXTERNAL_SERVICE_CALL',
      'EXTERNAL_SERVICE_SUCCESS',
      'EXTERNAL_SERVICE_FAILED',
      'RULES_EVALUATION_STARTED',
      'RULE_EVALUATED',
      'RULES_EVALUATION_COMPLETED',
      'STAGE_TRANSITION',
      'RETRY_SCHEDULED',
      'RETRY_ATTEMPTED',
      'RETRY_EXHAUSTED',
      'MANUAL_REVIEW_SUBMITTED',
      'DECISION_GENERATED'
    ]
  },
  previousState: {
    type: String,
    default: null
  },
  newState: {
    type: String,
    default: null
  },
  ruleId: {
    type: String,
    default: null
  },
  result: {
    type: String,
    default: null
  },
  explanation: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  configVersion: {
    type: Number,
    default: 1
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  // Audit logs are append-only.
  versionKey: false
});

AuditLogSchema.index({ workflowInstanceId: 1, timestamp: 1 });
AuditLogSchema.index({ eventType: 1, timestamp: -1 });

export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

