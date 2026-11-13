import { describe, it, before, after, expect } from './testHelper.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { WorkflowConfig } from '../src/models/WorkflowConfig.js';
import { WorkflowInstance } from '../src/models/WorkflowInstance.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { WorkflowEngine } from '../src/engines/workflowEngine.js';
import { RetryService } from '../src/services/retryService.js';
import { AuditService } from '../src/services/auditService.js';
import { ExplanationService } from '../src/services/explanationService.js';
import { loanApprovalConfig } from '../src/seeds/seed.js';

describe('End-to-End Workflow & Reliability Integration', () => {
  before(async () => {
    await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/workflow_decision_platform');
    // Ensure active config exists
    await WorkflowConfig.deleteMany({ workflowType: 'LOAN_APPLICATION' });
    await WorkflowConfig.create(loanApprovalConfig);
  });

  after(async () => {
    await disconnectDB();
  });

  it('1. Happy path: executes approval for prime applicant with full audit trail', async () => {
    const input = {
      applicantName: 'Alice Morgan',
      email: 'alice.morgan@example.com',
      monthlyIncome: 80000,
      creditScore: 780,
      loanAmount: 200000,
      employmentStatus: 'EMPLOYED'
    };

    const instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: input,
      idempotencyKey: 'TEST-KEY-001'
    });

    expect(instance.status).toBe('APPROVED');
    expect(instance.decision).toBe('APPROVED');
    expect(instance.workflowConfigVersion).toBe(1);
    expect(instance.ruleEvaluationResults.length).toBeGreaterThan(0);

    // Verify audit logs generated
    const auditLogs = await AuditService.getHistoryForInstance(instance._id);
    expect(auditLogs.length).toBeGreaterThanOrEqual(6);
    const eventTypes = auditLogs.map(a => a.eventType);
    expect(eventTypes).toContain('REQUEST_RECEIVED');
    expect(eventTypes).toContain('INPUT_VALIDATION_PASSED');
    expect(eventTypes).toContain('EXTERNAL_SERVICE_SUCCESS');
    expect(eventTypes).toContain('RULES_EVALUATION_STARTED');
    expect(eventTypes).toContain('DECISION_GENERATED');
    expect(eventTypes).toContain('STAGE_TRANSITION');

    // Verify explainable decision
    const explanation = ExplanationService.generateExplanation(instance);
    expect(explanation.decision).toBe('APPROVED');
    expect(explanation.rulesTriggered.length).toBeGreaterThan(0);
  });

  it('2. Rejection path: rejects application when credit score is below 600', async () => {
    const input = {
      applicantName: 'Tom Risk',
      email: 'tom.risk@example.com',
      monthlyIncome: 50000,
      creditScore: 520, // < 600 REJECT
      loanAmount: 150000,
      employmentStatus: 'EMPLOYED'
    };

    const instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: input
    });

    expect(instance.status).toBe('REJECTED');
    expect(instance.decision).toBe('REJECTED');
    expect(instance.decisionExplanation).toContain('below 600');
  });

  it('3. Manual review path: routes application to MANUAL_REVIEW when credit is borderline', async () => {
    const input = {
      applicantName: 'Carol Review',
      email: 'carol.review@example.com',
      monthlyIncome: 60000,
      creditScore: 680, // 600 - 749 -> MANUAL_REVIEW
      loanAmount: 200000,
      employmentStatus: 'EMPLOYED'
    };

    const instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: input
    });

    expect(instance.status).toBe('MANUAL_REVIEW');
    expect(instance.decision).toBe('MANUAL_REVIEW');
  });

  it('4. External dependency failure: transitions to RETRY_PENDING with backoff', async () => {
    const input = {
      applicantName: 'Dave Dependency',
      email: 'dave@example.com',
      monthlyIncome: 70000,
      creditScore: 760,
      loanAmount: 100000,
      employmentStatus: 'EMPLOYED'
    };

    const instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: input,
      simulationOptions: { forceFailure: true, failureType: 'EXTERNAL_SERVICE_UNAVAILABLE' }
    });

    expect(instance.status).toBe('RETRY_PENDING');
    expect(instance.nextRetryAt).toBeTruthy();
    expect(instance.failureDetails.errorType).toBe('EXTERNAL_SERVICE_UNAVAILABLE');

    // Verify retry audit event
    const auditLogs = await AuditService.getHistoryForInstance(instance._id);
    expect(auditLogs.some(a => a.eventType === 'RETRY_SCHEDULED')).toBe(true);

    // 5. Successful retry execution resolves the pending instance
    const retriedInstance = await RetryService.retryInstance(instance._id, { forceFailure: false });
    expect(retriedInstance.status).toBe('APPROVED');
    expect(retriedInstance.executionAttempts).toBe(2);
  });

  it('6. Retry exhaustion: escalates to MANUAL_REVIEW after reaching max retries', async () => {
    const input = {
      applicantName: 'Frank Flaky',
      email: 'frank@example.com',
      monthlyIncome: 70000,
      creditScore: 760,
      loanAmount: 100000,
      employmentStatus: 'EMPLOYED'
    };

    // First attempt -> RETRY_PENDING (attempt 1)
    let instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: input,
      simulationOptions: { forceFailure: true }
    });
    expect(instance.status).toBe('RETRY_PENDING');

    // Attempt 2 -> RETRY_PENDING (attempt 2)
    instance = await RetryService.retryInstance(instance._id, { forceFailure: true });
    expect(instance.status).toBe('RETRY_PENDING');
    expect(instance.executionAttempts).toBe(2);

    // Attempt 3 -> RETRY_PENDING (attempt 3)
    instance = await RetryService.retryInstance(instance._id, { forceFailure: true });
    expect(instance.status).toBe('RETRY_PENDING');
    expect(instance.executionAttempts).toBe(3);

    // Attempt 4 -> Retries exhausted! Policy specifies onExhaustion: 'MANUAL_REVIEW'
    instance = await RetryService.retryInstance(instance._id, { forceFailure: true });
    expect(instance.status).toBe('MANUAL_REVIEW');
    expect(instance.decision).toBe('MANUAL_REVIEW');

    const auditLogs = await AuditService.getHistoryForInstance(instance._id);
    expect(auditLogs.some(a => a.eventType === 'RETRY_EXHAUSTED')).toBe(true);
  });

  it('7. Configuration versioning: previous instance preserves original config version when new version created', async () => {
    // Check initial version
    const activeV1 = await WorkflowConfig.findOne({ workflowType: 'LOAN_APPLICATION', isActive: true });
    expect(activeV1.version).toBe(1);

    // Create v2 config with different rule
    await WorkflowConfig.updateMany({ workflowType: 'LOAN_APPLICATION' }, { isActive: false });
    const v2 = new WorkflowConfig({
      ...loanApprovalConfig,
      name: 'Standard Loan Application v2',
      version: 2,
      isActive: true,
      rules: [
        {
          ruleId: 'v2_strict_rule',
          name: 'Stricter Credit Rule',
          field: 'creditScore',
          operator: '>=',
          value: 800,
          result: 'APPROVE',
          priority: 1
        }
      ]
    });
    await v2.save();

    // Execute request under v2
    const v2Instance = await WorkflowEngine.execute({
      workflowType: 'LOAN_APPLICATION',
      inputData: {
        applicantName: 'V2 Applicant',
        email: 'v2@example.com',
        monthlyIncome: 90000,
        creditScore: 810,
        loanAmount: 200000,
        employmentStatus: 'EMPLOYED'
      }
    });

    expect(v2Instance.workflowConfigVersion).toBe(2);

    // Reset back to v1 active for other tests
    await WorkflowConfig.updateOne({ _id: activeV1._id }, { isActive: true });
    await WorkflowConfig.updateOne({ _id: v2._id }, { isActive: false });
  });
});
