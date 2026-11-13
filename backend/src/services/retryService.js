import { WorkflowInstance } from '../models/WorkflowInstance.js';
import { WorkflowConfig } from '../models/WorkflowConfig.js';
import { WorkflowEngine } from '../engines/workflowEngine.js';
import { AuditService } from './auditService.js';
import { externalCreditBureauService } from './externalService.js';
import { RulesEngine } from '../engines/rulesEngine.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Retry Manager
 * Coordinates automated background retries and manual retry invocations.
 */
export class RetryService {
  /**
   * Retries an instance currently in RETRY_PENDING status
   * @param {string} instanceId - WorkflowInstance ID
   * @param {Object} overrideSimulation - Optional simulation flags
   */
  static async retryInstance(instanceId, overrideSimulation = {}) {
    const instance = await WorkflowInstance.findById(instanceId);
    if (!instance) {
      throw new AppError('Workflow instance not found', 404, 'NOT_FOUND');
    }

    if (instance.status !== 'RETRY_PENDING') {
      throw new AppError(`Cannot retry instance with status '${instance.status}'. Must be 'RETRY_PENDING'`, 400, 'INVALID_RETRY_STATE');
    }

    const config = await WorkflowConfig.findById(instance.workflowConfigId);
    if (!config) {
      throw new AppError('Workflow configuration not found for instance', 404, 'CONFIG_NOT_FOUND');
    }
    instance.workflowConfig = config;

    instance.executionAttempts += 1;
    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'RETRY_ATTEMPTED',
      explanation: `Executing retry attempt #${instance.executionAttempts}`,
      metadata: { attempt: instance.executionAttempts },
      configVersion: instance.workflowConfigVersion
    });

    // Re-attempt external verification stage
    await WorkflowEngine.transitionStatus(
      instance,
      'EXTERNAL_VERIFICATION',
      'EXTERNAL_VERIFICATION',
      `Retry attempt #${instance.executionAttempts} for external verification`
    );

    let externalData = {};
    try {
      const extResult = await externalCreditBureauService.verifyCreditProfile(instance.inputData, overrideSimulation);
      instance.externalServiceResults.push(extResult);
      externalData = extResult;

      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'EXTERNAL_SERVICE_SUCCESS',
        result: 'SUCCESS',
        explanation: `Credit bureau verification succeeded on retry #${instance.executionAttempts}`,
        metadata: extResult,
        configVersion: instance.workflowConfigVersion
      });
    } catch (err) {
      logger.warn(`Retry attempt #${instance.executionAttempts} failed`, { error: err.message, id: instanceId });

      const retryPolicy = config.retryPolicy || {};
      const maxRetries = retryPolicy.maxRetries ?? 3;
      const isRetryable = err.isRetryable ?? true;

      instance.failureDetails = {
        errorType: err.code || 'EXTERNAL_SERVICE_ERROR',
        message: err.message,
        retryCount: instance.executionAttempts,
        timestamp: new Date()
      };

      if (isRetryable && instance.executionAttempts <= maxRetries) {
        const delayMs = (retryPolicy.initialDelayMs || 1000) * Math.pow(retryPolicy.backoffMultiplier || 2, instance.executionAttempts - 1);
        instance.nextRetryAt = new Date(Date.now() + delayMs);

        await AuditService.logEvent({
          workflowInstanceId: instance._id,
          requestId: instance.requestId,
          eventType: 'RETRY_SCHEDULED',
          explanation: `Retry attempt failed. Scheduled next retry (${instance.executionAttempts + 1}/${maxRetries}) in ${delayMs}ms`,
          metadata: { delayMs, nextRetryAt: instance.nextRetryAt },
          configVersion: instance.workflowConfigVersion
        });

        await WorkflowEngine.transitionStatus(instance, 'RETRY_PENDING', 'EXTERNAL_VERIFICATION', `Scheduled retry after error: ${err.message}`);
        return instance;
      } else {
        // Retries exhausted
        const onExhaustion = retryPolicy.onExhaustion || 'MANUAL_REVIEW';
        await AuditService.logEvent({
          workflowInstanceId: instance._id,
          requestId: instance.requestId,
          eventType: 'RETRY_EXHAUSTED',
          result: onExhaustion,
          explanation: `Retries exhausted after ${instance.executionAttempts} attempts. Moving to ${onExhaustion}.`,
          configVersion: instance.workflowConfigVersion
        });

        if (onExhaustion === 'MANUAL_REVIEW') {
          instance.decision = 'MANUAL_REVIEW';
          instance.decisionExplanation = `External dependency unavailable after ${instance.executionAttempts} attempts; routed for manual review.`;
          await WorkflowEngine.transitionStatus(instance, 'MANUAL_REVIEW', 'MANUAL_REVIEW', 'Dependency retry exhausted; routed to manual review');
        } else {
          instance.decision = 'REJECTED';
          instance.decisionExplanation = `Dependency retries exhausted.`;
          await WorkflowEngine.transitionStatus(instance, 'FAILED', 'COMPLETED', 'Dependency retries exhausted');
        }
        return instance;
      }
    }

    // External service succeeded! Now evaluate rules
    await WorkflowEngine.transitionStatus(instance, 'EVALUATING_RULES', 'EVALUATING_RULES', 'Evaluating business rules following successful retry');

    const combinedContext = {
      ...instance.inputData,
      external: externalData,
      bureauScore: externalData.bureauScore,
      fraudRiskScore: externalData.fraudRiskScore
    };

    const ruleResults = RulesEngine.evaluateAll(config.rules, combinedContext);
    instance.ruleEvaluationResults = ruleResults.rulesEvaluated;
    instance.decision = ruleResults.decision;
    instance.decisionExplanation = ruleResults.explanation;

    for (const trace of ruleResults.rulesEvaluated) {
      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'RULE_EVALUATED',
        ruleId: trace.ruleId,
        result: trace.passed ? 'PASSED' : 'FAILED',
        explanation: trace.explanation,
        metadata: {
          field: trace.field,
          actual: trace.actualValue,
          expected: trace.expectedValue
        },
        configVersion: instance.workflowConfigVersion
      });
    }

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'DECISION_GENERATED',
      result: ruleResults.decision,
      explanation: ruleResults.explanation,
      metadata: ruleResults.summary,
      configVersion: instance.workflowConfigVersion
    });

    let finalStatus = 'APPROVED';
    if (ruleResults.decision === 'REJECTED') finalStatus = 'REJECTED';
    else if (ruleResults.decision === 'MANUAL_REVIEW') finalStatus = 'MANUAL_REVIEW';

    await WorkflowEngine.transitionStatus(
      instance,
      finalStatus,
      finalStatus === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'COMPLETED',
      ruleResults.explanation
    );

    return instance;
  }

  /**
   * Processes all pending retries whose nextRetryAt is in the past
   */
  static async processPendingRetries() {
    try {
      const now = new Date();
      const pendingList = await WorkflowInstance.find({
        status: 'RETRY_PENDING',
        nextRetryAt: { $lte: now }
      }).limit(10);

      for (const item of pendingList) {
        try {
          await this.retryInstance(item._id);
        } catch (err) {
          logger.error('Error during scheduled background retry', { id: item._id, error: err.message });
        }
      }
    } catch (err) {
      logger.error('Error in retry queue processor loop', { error: err.message });
    }
  }

  /**
   * Starts background retry polling loop (non-blocking)
   */
  static startBackgroundWorker(intervalMs = 5000) {
    logger.info(`Starting background retry worker (interval: ${intervalMs}ms)`);
    const interval = setInterval(() => {
      this.processPendingRetries().catch(() => {});
    }, intervalMs);
    // Don't prevent process from exiting cleanly if needed
    if (interval.unref) interval.unref();
    return interval;
  }
}

