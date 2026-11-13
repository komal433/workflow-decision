import mongoose from 'mongoose';

const IdempotencyRecordSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  workflowInstanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkflowInstance',
    default: null
  },
  requestHash: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
    default: 'IN_PROGRESS'
  },
  responseData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // Keep idempotency records for 24 hours
    expires: 86400
  }
}, {
  timestamps: true
});

export const IdempotencyRecord = mongoose.model('IdempotencyRecord', IdempotencyRecordSchema);

