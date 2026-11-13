import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { WorkflowConfig } from '../models/WorkflowConfig.js';
import { WorkflowInstance } from '../models/WorkflowInstance.js';
import { AuditLog } from '../models/AuditLog.js';
import { IdempotencyRecord } from '../models/IdempotencyRecord.js';
import { WorkflowEngine } from '../engines/workflowEngine.js';
import { logger } from '../utils/logger.js';

export const loanApprovalConfig = {
  name: 'Standard Loan Application Approval',
  description: 'Automated underwriting workflow for consumer personal and auto loans with bureau verification',
  workflowType: 'LOAN_APPLICATION',
  version: 1,
  isActive: true,
  inputSchema: {
    type: 'object',
    required: ['applicantName', 'email', 'monthlyIncome', 'creditScore', 'loanAmount', 'employmentStatus'],
    properties: {
      applicantName: { type: 'string', minLength: 2 },
      email: { type: 'string', format: 'email' },
      monthlyIncome: { type: 'number', minimum: 0 },
      creditScore: { type: 'integer', minimum: 300, maximum: 850 },
      loanAmount: { type: 'number', minimum: 1000, maximum: 5000000 },
      employmentStatus: {
        type: 'string',
        enum: ['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED']
      }
    }
  },
  stages: [
    { id: 'VALIDATING', name: 'Schema & Input Validation', order: 1 },
    { id: 'EXTERNAL_VERIFICATION', name: 'Credit Bureau & Risk Verification', order: 2, isExternal: true, externalServiceName: 'creditScoreBureau' },
    { id: 'EVALUATING_RULES', name: 'Underwriting Business Rules Evaluation', order: 3 }
  ],
  rules: [
    {
      ruleId: 'min_income_threshold',
      name: 'Minimum Income Requirement',
      description: 'Monthly income must be at least 30,000 for eligibility',
      field: 'monthlyIncome',
      operator: '<',
      value: 30000,
      result: 'REJECT',
      priority: 1,
      isMandatory: true,
      failureMessage: 'Monthly income is sufficient (>= 30,000)',
      passMessage: 'Monthly income is below the mandatory 30,000 threshold'
    },
    {
      ruleId: 'subprime_credit_risk',
      name: 'Subprime Credit Rejection',
      description: 'Credit score below 600 indicates severe default probability',
      field: 'creditScore',
      operator: '<',
      value: 600,
      result: 'REJECT',
      priority: 2,
      isMandatory: true,
      failureMessage: 'Credit score is above subprime threshold (>= 600)',
      passMessage: 'Credit score is below 600 minimum threshold'
    },
    {
      ruleId: 'borderline_credit_manual_review',
      name: 'Borderline Credit Score Review',
      description: 'Credit score between 600 and 749 requires senior underwriter review',
      operator: 'AND',
      conditions: [
        { field: 'creditScore', operator: '>=', value: 600 },
        { field: 'creditScore', operator: '<', value: 750 }
      ],
      result: 'MANUAL_REVIEW',
      priority: 3,
      passMessage: 'Credit score is in borderline tier (600 - 749); routed for underwriter manual review',
      failureMessage: 'Credit score is not in borderline range'
    },
    {
      ruleId: 'prime_tier1_auto_approval',
      name: 'Prime Tier 1 Auto Approval',
      description: 'Prime credit (>= 750) and strong monthly income (>= 40,000)',
      operator: 'AND',
      conditions: [
        { field: 'creditScore', operator: '>=', value: 750 },
        { field: 'monthlyIncome', operator: '>=', value: 40000 }
      ],
      result: 'APPROVE',
      priority: 4,
      passMessage: 'Applicant satisfies all Prime Tier 1 automatic approval criteria',
      failureMessage: 'Did not meet Tier 1 auto-approval criteria'
    }
  ],
  retryPolicy: {
    maxRetries: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    retryableErrors: ['EXTERNAL_SERVICE_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'TEMPORARY_NETWORK_FAILURE'],
    onExhaustion: 'MANUAL_REVIEW'
  }
};

export const insuranceClaimConfig = {
  name: 'Auto & Health Insurance Claim Processing',
  description: 'First notice of loss claim adjudication and fraud screen',
  workflowType: 'INSURANCE_CLAIM',
  version: 1,
  isActive: true,
  inputSchema: {
    type: 'object',
    required: ['claimantName', 'policyNumber', 'claimAmount', 'incidentDate', 'claimType'],
    properties: {
      claimantName: { type: 'string', minLength: 2 },
      policyNumber: { type: 'string' },
      claimAmount: { type: 'number', minimum: 1 },
      incidentDate: { type: 'string' },
      claimType: { type: 'string', enum: ['AUTO', 'HEALTH', 'PROPERTY'] }
    }
  },
  stages: [
    { id: 'VALIDATING', name: 'Policy & Input Validation', order: 1 },
    { id: 'EVALUATING_RULES', name: 'Claim Adjudication Rules', order: 2 }
  ],
  rules: [
    {
      ruleId: 'high_value_claim_review',
      name: 'High Value Claim Review',
      field: 'claimAmount',
      operator: '>',
      value: 100000,
      result: 'MANUAL_REVIEW',
      priority: 1,
      passMessage: 'Claim amount exceeds $100,000; routed for senior adjuster review'
    },
    {
      ruleId: 'fast_track_claim_approval',
      name: 'Fast Track Auto Settlement',
      field: 'claimAmount',
      operator: '<=',
      value: 10000,
      result: 'APPROVE',
      priority: 2,
      passMessage: 'Claim eligible for express fast-track settlement'
    }
  ],
  retryPolicy: {
    maxRetries: 2,
    initialDelayMs: 2000,
    backoffMultiplier: 2,
    onExhaustion: 'FAILED'
  }
};

export const vendorApprovalConfig = {
  name: 'Enterprise Vendor Procurement Approval',
  description: 'Vendor compliance, tax ID, and security risk evaluation',
  workflowType: 'VENDOR_APPROVAL',
  version: 1,
  isActive: true,
  inputSchema: {
    type: 'object',
    required: ['vendorName', 'taxId', 'annualContractValue', 'category'],
    properties: {
      vendorName: { type: 'string', minLength: 2 },
      taxId: { type: 'string' },
      annualContractValue: { type: 'number', minimum: 0 },
      category: { type: 'string', enum: ['SAAS', 'HARDWARE', 'CONSULTING', 'FACILITIES'] }
    }
  },
  stages: [
    { id: 'VALIDATING', name: 'Vendor Data Validation', order: 1 },
    { id: 'EVALUATING_RULES', name: 'Procurement Risk Rules', order: 2 }
  ],
  rules: [
    {
      ruleId: 'major_contract_procurement_review',
      name: 'Major Contract Review',
      field: 'annualContractValue',
      operator: '>',
      value: 250000,
      result: 'MANUAL_REVIEW',
      priority: 1,
      passMessage: 'Contract exceeds $250k; executive procurement sign-off required'
    },
    {
      ruleId: 'standard_vendor_auto_approve',
      name: 'Standard Vendor Qualification',
      field: 'annualContractValue',
      operator: '<=',
      value: 50000,
      result: 'APPROVE',
      priority: 2,
      passMessage: 'Vendor qualified for standard catalog onboarding'
    }
  ]
};

export async function seedDatabase() {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform';
    await connectDB(uri);

    logger.info('Purging existing database collections for clean demo state...');
    await Promise.all([
      WorkflowConfig.deleteMany({}),
      WorkflowInstance.deleteMany({}),
      AuditLog.deleteMany({}),
      IdempotencyRecord.deleteMany({})
    ]);

    logger.info('Seeding default workflow configurations...');
    const [loanConfigDoc] = await Promise.all([
      WorkflowConfig.create(loanApprovalConfig),
      WorkflowConfig.create(insuranceClaimConfig),
      WorkflowConfig.create(vendorApprovalConfig)
    ]);

    logger.info(`Seeded 3 workflow configurations. Loan config ID: ${loanConfigDoc._id}`);

    // Seed realistic demo instances demonstrating all outcomes:
    logger.info('Executing demonstration workflow instances...');

    // 1. Happy Path Approval (Prime credit, high income)
    const approvedInstance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'Sarah Jenkins',
        email: 'sarah.jenkins@example.com',
        monthlyIncome: 75000,
        creditScore: 790,
        loanAmount: 250000,
        employmentStatus: 'EMPLOYED'
      },
      idempotencyKey: 'DEMO-KEY-APPROVE-001'
    });
    logger.info(`Demo instance 1 (APPROVED): ${approvedInstance.requestId}`);

    // 2. Rejection Path (Subprime credit score < 600)
    const rejectedInstance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'David Miller',
        email: 'david.miller@example.com',
        monthlyIncome: 42000,
        creditScore: 540,
        loanAmount: 180000,
        employmentStatus: 'EMPLOYED'
      },
      idempotencyKey: 'DEMO-KEY-REJECT-002'
    });
    logger.info(`Demo instance 2 (REJECTED): ${rejectedInstance.requestId}`);

    // 3. Manual Review Path (Borderline credit 600-749)
    const reviewInstance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'Michael Chang',
        email: 'michael.chang@example.com',
        monthlyIncome: 58000,
        creditScore: 680,
        loanAmount: 320000,
        employmentStatus: 'SELF_EMPLOYED'
      },
      idempotencyKey: 'DEMO-KEY-REVIEW-003'
    });
    logger.info(`Demo instance 3 (MANUAL_REVIEW): ${reviewInstance.requestId}`);

    // 4. Retry Pending Path (Simulated external dependency transient failure)
    const retryPendingInstance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'Elena Rostova',
        email: 'elena.rostova@example.com',
        monthlyIncome: 62000,
        creditScore: 760,
        loanAmount: 200000,
        employmentStatus: 'EMPLOYED'
      },
      idempotencyKey: 'DEMO-KEY-RETRY-004',
      simulationOptions: {
        forceFailure: true,
        failureType: 'EXTERNAL_SERVICE_UNAVAILABLE'
      }
    });
    logger.info(`Demo instance 4 (RETRY_PENDING): ${retryPendingInstance.requestId}`);

    // 5. Insurance Claim fast-track approval demo
    await WorkflowEngine.execute({
      workflowType: 'INSURANCE_CLAIM',
      inputData: {
        claimantName: 'Robert Vance',
        policyNumber: 'POL-AUTO-89912',
        claimAmount: 4500,
        incidentDate: '2026-11-01',
        claimType: 'AUTO'
      },
      idempotencyKey: 'DEMO-KEY-INS-005'
    });

    logger.info('Database seeding completed successfully!');
    if (process.argv[1]?.includes('seed.js')) {
      await disconnectDB();
      process.exit(0);
    }
  } catch (err) {
    logger.error('Database seeding failed', { error: err.message, stack: err.stack });
    if (process.argv[1]?.includes('seed.js')) {
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1]?.includes('seed.js')) {
  seedDatabase();
}

