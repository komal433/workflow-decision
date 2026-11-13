import mongoose from 'mongoose';

const RuleConditionSchema = new mongoose.Schema({
  field: { type: String, required: true },
  operator: {
    type: String,
    required: true,
    enum: ['>', '<', '>=', '<=', '==', '!=', 'IN', 'NOT_IN', 'BETWEEN', 'CONTAINS', 'REGEX']
  },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const RuleSchema = new mongoose.Schema({
  ruleId: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  field: { type: String },
  operator: {
    type: String,
    enum: ['>', '<', '>=', '<=', '==', '!=', 'IN', 'NOT_IN', 'BETWEEN', 'CONTAINS', 'REGEX', 'AND', 'OR']
  },
  value: { type: mongoose.Schema.Types.Mixed },
  conditions: [RuleConditionSchema],
  result: {
    type: String,
    required: true,
    enum: ['APPROVE', 'REJECT', 'MANUAL_REVIEW']
  },
  priority: { type: Number, required: true, default: 100 },
  isMandatory: { type: Boolean, default: false },
  failureMessage: { type: String, default: 'Rule criteria not satisfied' },
  passMessage: { type: String, default: 'Rule criteria met successfully' }
}, { _id: false });

const StageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  order: { type: Number, required: true },
  description: { type: String, default: '' },
  isExternal: { type: Boolean, default: false },
  externalServiceName: { type: String }
}, { _id: false });

const RetryPolicySchema = new mongoose.Schema({
  maxRetries: { type: Number, default: 3 },
  initialDelayMs: { type: Number, default: 1000 },
  backoffMultiplier: { type: Number, default: 2 },
  retryableErrors: {
    type: [String],
    default: ['EXTERNAL_SERVICE_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'TEMPORARY_NETWORK_FAILURE']
  },
  onExhaustion: {
    type: String,
    enum: ['MANUAL_REVIEW', 'FAILED'],
    default: 'MANUAL_REVIEW'
  }
}, { _id: false });

const WorkflowConfigSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  workflowType: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  version: { type: Number, required: true, default: 1 },
  inputSchema: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {
      type: 'object',
      required: [],
      properties: {}
    }
  },
  stages: {
    type: [StageSchema],
    default: [
      { id: 'VALIDATING', name: 'Input Validation', order: 1 },
      { id: 'EXTERNAL_VERIFICATION', name: 'External Data Verification', order: 2, isExternal: true, externalServiceName: 'creditScoreBureau' },
      { id: 'EVALUATING_RULES', name: 'Rules Evaluation', order: 3 }
    ]
  },
  rules: [RuleSchema],
  transitions: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      RECEIVED: ['VALIDATING', 'FAILED'],
      VALIDATING: ['EXTERNAL_VERIFICATION', 'EVALUATING_RULES', 'REJECTED', 'FAILED'],
      EXTERNAL_VERIFICATION: ['EVALUATING_RULES', 'RETRY_PENDING', 'MANUAL_REVIEW', 'FAILED'],
      EVALUATING_RULES: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED'],
      RETRY_PENDING: ['EXTERNAL_VERIFICATION', 'MANUAL_REVIEW', 'FAILED'],
      MANUAL_REVIEW: ['APPROVED', 'REJECTED', 'FAILED'],
      APPROVED: [],
      REJECTED: [],
      FAILED: []
    }
  },
  retryPolicy: {
    type: RetryPolicySchema,
    default: () => ({})
  },
  isActive: { type: Boolean, default: false }
}, {
  timestamps: true
});

WorkflowConfigSchema.index({ workflowType: 1, version: 1 }, { unique: true });
WorkflowConfigSchema.index({ workflowType: 1, isActive: 1 });

export const WorkflowConfig = mongoose.model('WorkflowConfig', WorkflowConfigSchema);

