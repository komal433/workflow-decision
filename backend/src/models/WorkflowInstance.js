import mongoose from 'mongoose';

const WorkflowInstanceSchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  idempotencyKey: {
    type: String,
    sparse: true,
    index: true
  },
  workflowConfigId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkflowConfig',
    required: true
  },
  workflowConfigVersion: {
    type: Number,
    required: true
  },
  workflowType: {
    type: String,
    required: true,
    index: true
  },
  inputData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  currentStage: {
    type: String,
    required: true,
    default: 'RECEIVED'
  },
  status: {
    type: String,
    required: true,
    enum: ['RECEIVED', 'VALIDATING', 'EXTERNAL_VERIFICATION', 'EVALUATING_RULES', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'RETRY_PENDING', 'FAILED'],
    default: 'RECEIVED',
    index: true
  },
  previousStatus: {
    type: String,
    default: null
  },
  decision: {
    type: String,
    enum: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', null],
    default: null
  },
  decisionExplanation: {
    type: String,
    default: ''
  },
  ruleEvaluationResults: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  externalServiceResults: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  executionAttempts: {
    type: Number,
    default: 1
  },
  nextRetryAt: {
    type: Date,
    default: null,
    index: true
  },
  failureDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  manualReview: {
    reviewedBy: { type: String, default: null },
    comment: { type: String, default: null },
    action: { type: String, enum: ['APPROVE', 'REJECT', null], default: null },
    reviewedAt: { type: Date, default: null }
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

WorkflowInstanceSchema.index({ status: 1, nextRetryAt: 1 });
WorkflowInstanceSchema.index({ workflowType: 1, createdAt: -1 });

export const WorkflowInstance = mongoose.model('WorkflowInstance', WorkflowInstanceSchema);

