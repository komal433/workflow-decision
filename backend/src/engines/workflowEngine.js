import crypto from 'node:crypto';
import { WorkflowConfig } from '../models/WorkflowConfig.js';
import { WorkflowInstance } from '../models/WorkflowInstance.js';
import { AuditService } from '../services/auditService.js';
import { ValidationEngine } from './validationEngine.js';
import { RulesEngine } from './rulesEngine.js';
import { externalCreditBureauService } from '../services/externalService.js';
import { TransitionError, NotFoundError, AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_TRANSITIONS = {
  RECEIVED: ['VALIDATING', 'FAILED'],
  VALIDATING: ['EXTERNAL_VERIFICATION', 'EVALUATING_RULES', 'REJECTED', 'FAILED'],
  EXTERNAL_VERIFICATION: ['EVALUATING_RULES', 'RETRY_PENDING', 'MANUAL_REVIEW', 'FAILED'],
  EVALUATING_RULES: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'FAILED'],
  RETRY_PENDING: ['EXTERNAL_VERIFICATION', 'MANUAL_REVIEW', 'FAILED'],
  MANUAL_REVIEW: ['APPROVED', 'REJECTED', 'FAILED'],
  APPROVED: [],
  REJECTED: [],
  FAILED: []
};

/**
 * Generic Workflow Orchestration Engine
 * Coordinates validation, external enrichment, rule evaluation, and state transitions.
 */
export class WorkflowEngine {
  /**
   * Validates state transition against configured or default state machine rules
   */
  static validateTransition(currentStatus, targetStatus, allowedTransitions = DEFAULT_TRANSITIONS) {
    if (currentStatus === targetStatus) return true;
    const permitted = allowedTransitions[currentStatus] || [];
    if (!permitted.includes(targetStatus)) {
      throw new TransitionError(
        `Invalid state transition from '${currentStatus}' to '${targetStatus}'. Allowed target states: [${permitted.join(', ')}]`,
        { currentStatus, targetStatus, permitted }
      );
    }
    return true;
  }

  /**
   * Performs an audited state transition on a workflow instance
   */
  static async transitionStatus(instance, newStatus, currentStage = null, reason = '', metadata = {}) {
    const oldStatus = instance.status;
    const transitions = instance.workflowConfig?.transitions || DEFAULT_TRANSITIONS;

    this.validateTransition(oldStatus, newStatus, transitions);

    instance.previousStatus = oldStatus;
    instance.status = newStatus;
    if (currentStage) instance.currentStage = currentStage;
    if (['APPROVED', 'REJECTED', 'FAILED'].includes(newStatus)) {
      instance.completedAt = new Date();
    }

    await instance.save();

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'STAGE_TRANSITION',
      previousState: oldStatus,
      newState: newStatus,
      explanation: reason || `Transitioned from ${oldStatus} to ${newStatus}`,
      metadata: { currentStage: instance.currentStage, ...metadata },
      configVersion: instance.workflowConfigVersion
    });

    logger.info(`Workflow instance ${instance.requestId} transitioned: ${oldStatus} -> ${newStatus}`);
    return instance;
  }

  /**
   * Executes the workflow end-to-end for a given payload
   * @param {Object} params - { workflowType, inputData, idempotencyKey, simulationOptions }
   * @returns {Promise<Object>} Completed or updated workflow instance
   */
  static async execute({ workflowType, inputData, idempotencyKey = null, simulationOptions = {} }) {
    // 1. Fetch active workflow configuration
    const config = await WorkflowConfig.findOne({ workflowType: workflowType.toUpperCase(), isActive: true });
    if (!config) {
      throw new NotFoundError(`No active configuration found for workflow type '${workflowType}'`);
    }

    const requestId = crypto.randomUUID();

    // 2. Initialize WorkflowInstance
    const instance = new WorkflowInstance({
      requestId,
      idempotencyKey,
      workflowConfigId: config._id,
      workflowConfigVersion: config.version,
      workflowType: config.workflowType,
      inputData,
      currentStage: 'RECEIVED',
      status: 'RECEIVED',
      executionAttempts: 1
    });
    // Attach config temporarily for transition checks
    instance.workflowConfig = config;
    await instance.save();

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'REQUEST_RECEIVED',
      newState: 'RECEIVED',
      explanation: `New ${config.workflowType} request received with config version v${config.version}`,
      metadata: { inputData },
      configVersion: config.version
    });

    // 3. Stage 1: Validation
    await this.transitionStatus(instance, 'VALIDATING', 'VALIDATING', 'Beginning schema validation');

    const validationResult = ValidationEngine.validate(config.inputSchema, inputData);
    if (!validationResult.isValid) {
      const errorMsg = `Input validation failed: ${validationResult.errors.map(e => e.message).join('; ')}`;
      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'INPUT_VALIDATION_FAILED',
        result: 'FAILED',
        explanation: errorMsg,
        metadata: { errors: validationResult.errors },
        configVersion: config.version
      });

      instance.decision = 'REJECTED';
      instance.decisionExplanation = errorMsg;
      instance.failureDetails = { errorType: 'VALIDATION_ERROR', errors: validationResult.errors };
      await this.transitionStatus(instance, 'REJECTED', 'COMPLETED', errorMsg);
      return instance;
    }

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'INPUT_VALIDATION_PASSED',
      result: 'PASSED',
      explanation: 'All input fields successfully validated against schema',
      configVersion: config.version
    });

    // 4. Stage 2: External Data Verification (if configured in stages)
    const hasExternalStage = config.stages.some(s => s.id === 'EXTERNAL_VERIFICATION' || s.isExternal);
    let externalData = {};

    if (hasExternalStage) {
      await this.transitionStatus(
        instance,
        'EXTERNAL_VERIFICATION',
        'EXTERNAL_VERIFICATION',
        'Querying external credit bureau verification service'
      );

      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'EXTERNAL_SERVICE_CALL',
        explanation: 'Calling external credit bureau API',
        metadata: { service: 'creditScoreBureau', options: simulationOptions },
        configVersion: config.version
      });

      try {
        const extResult = await externalCreditBureauService.verifyCreditProfile(inputData, simulationOptions);
        instance.externalServiceResults.push(extResult);
        externalData = extResult;

        await AuditService.logEvent({
          workflowInstanceId: instance._id,
          requestId: instance.requestId,
          eventType: 'EXTERNAL_SERVICE_SUCCESS',
          result: 'SUCCESS',
          explanation: `Credit bureau verification successful. Score: ${extResult.bureauScore}, Reference: ${extResult.bureauReferenceId}`,
          metadata: extResult,
          configVersion: config.version
        });
      } catch (err) {
        logger.warn('External service call failed', { error: err.message, requestId });

        instance.failureDetails = {
          errorType: err.details?.errorType || err.code || 'EXTERNAL_SERVICE_ERROR',
          message: err.message,
          retryCount: instance.executionAttempts,
          timestamp: new Date()
        };

        const isRetryable = err.isRetryable ?? true;
        const retryPolicy = config.retryPolicy || {};
        const maxRetries = retryPolicy.maxRetries ?? 3;

        await AuditService.logEvent({
          workflowInstanceId: instance._id,
          requestId: instance.requestId,
          eventType: 'EXTERNAL_SERVICE_FAILED',
          result: 'FAILURE',
          explanation: `External service call failed: ${err.message}`,
          metadata: { isRetryable, attempts: instance.executionAttempts },
          configVersion: config.version
        });

        if (isRetryable && instance.executionAttempts <= maxRetries) {
          // Calculate exponential backoff delay
          const delayMs = (retryPolicy.initialDelayMs || 1000) * Math.pow(retryPolicy.backoffMultiplier || 2, instance.executionAttempts - 1);
          instance.nextRetryAt = new Date(Date.now() + delayMs);

          await AuditService.logEvent({
            workflowInstanceId: instance._id,
            requestId: instance.requestId,
            eventType: 'RETRY_SCHEDULED',
            explanation: `Scheduled retry attempt ${instance.executionAttempts + 1} of ${maxRetries} in ${delayMs}ms`,
            metadata: { nextRetryAt: instance.nextRetryAt, delayMs },
            configVersion: config.version
          });

          await this.transitionStatus(instance, 'RETRY_PENDING', 'EXTERNAL_VERIFICATION', `Retry scheduled after transient error: ${err.message}`);
          return instance;
        } else {
          // Retries exhausted or non-retryable
          const exhaustionTarget = retryPolicy.onExhaustion || 'MANUAL_REVIEW';
          await AuditService.logEvent({
            workflowInstanceId: instance._id,
            requestId: instance.requestId,
            eventType: 'RETRY_EXHAUSTED',
            result: exhaustionTarget,
            explanation: `External dependency retries exhausted (${instance.executionAttempts}/${maxRetries}). Escalating to ${exhaustionTarget}.`,
            configVersion: config.version
          });

          if (exhaustionTarget === 'MANUAL_REVIEW') {
            instance.decision = 'MANUAL_REVIEW';
            instance.decisionExplanation = `External dependency unavailable after ${instance.executionAttempts} attempts; routed for manual review.`;
            await this.transitionStatus(instance, 'MANUAL_REVIEW', 'MANUAL_REVIEW', 'Escalated to manual review due to external dependency unavailability');
          } else {
            instance.decision = 'REJECTED';
            instance.decisionExplanation = `External dependency failed and retries exhausted.`;
            await this.transitionStatus(instance, 'FAILED', 'COMPLETED', 'Failed due to dependency exhaustion');
          }
          return instance;
        }
      }
    }

    // 5. Stage 3: Evaluating Rules
    await this.transitionStatus(instance, 'EVALUATING_RULES', 'EVALUATING_RULES', 'Evaluating business rules');

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'RULES_EVALUATION_STARTED',
      explanation: `Evaluating ${config.rules.length} configured business rules`,
      configVersion: config.version
    });

    const combinedContext = {
      ...inputData,
      external: externalData,
      bureauScore: externalData.bureauScore,
      fraudRiskScore: externalData.fraudRiskScore
    };

    const ruleResults = RulesEngine.evaluateAll(config.rules, combinedContext);
    instance.ruleEvaluationResults = ruleResults.rulesEvaluated;
    instance.decision = ruleResults.decision;
    instance.decisionExplanation = ruleResults.explanation;

    // Log individual rule evaluation traces in audit log
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
          expected: trace.expectedValue,
          action: trace.resultAction
        },
        configVersion: config.version
      });
    }

    await AuditService.logEvent({
      workflowInstanceId: instance._id,
      requestId: instance.requestId,
      eventType: 'DECISION_GENERATED',
      result: ruleResults.decision,
      explanation: ruleResults.explanation,
      metadata: ruleResults.summary,
      configVersion: config.version
    });

    // 6. Transition to final decision status
    let finalStatus = 'APPROVED';
    if (ruleResults.decision === 'REJECTED') finalStatus = 'REJECTED';
    else if (ruleResults.decision === 'MANUAL_REVIEW') finalStatus = 'MANUAL_REVIEW';

    await this.transitionStatus(
      instance,
      finalStatus,
      finalStatus === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'COMPLETED',
      ruleResults.explanation
    );

    return instance;
  }
}
