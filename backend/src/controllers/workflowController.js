import { WorkflowInstance } from '../models/WorkflowInstance.js';
import { WorkflowEngine } from '../engines/workflowEngine.js';
import { IdempotencyService } from '../services/idempotencyService.js';
import { AuditService } from '../services/auditService.js';
import { ExplanationService } from '../services/explanationService.js';
import { RetryService } from '../services/retryService.js';
import { successResponse } from '../utils/apiResponse.js';
import { AppError, NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkflowController {
  /**
   * Executes a workflow with idempotency support
   */
  static async execute(req, res, next) {
    try {
      const { workflowType = 'LOAN_APPLICATION', inputData, simulationOptions = {} } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey || null;

      if (!inputData) {
        throw new ValidationError("Missing required request body property 'inputData'");
      }

      // Check header-based simulation overrides for convenience in testing/demos
      const mergedSimOptions = {
        ...simulationOptions,
        forceFailure: simulationOptions.forceFailure ?? (req.headers['x-simulate-failure'] === 'true'),
        forceTimeout: simulationOptions.forceTimeout ?? (req.headers['x-simulate-timeout'] === 'true'),
        failureType: simulationOptions.failureType || req.headers['x-failure-type']
      };

      // 1. Idempotency reservation
      let reservation = null;
      if (idempotencyKey) {
        reservation = await IdempotencyService.reserveKey(idempotencyKey, workflowType, inputData);
        if (reservation.isReplay) {
          res.setHeader('X-Cache-Lookup', 'HIT');
          res.setHeader('Idempotent-Replay', 'true');
          return successResponse(res, reservation.cachedResponse, 200, 'Duplicate request - returned cached workflow execution result');
        }
      }

      // 2. Execute workflow
      let instance;
      try {
        instance = await WorkflowEngine.execute({
          workflowType,
          inputData,
          idempotencyKey,
          simulationOptions: mergedSimOptions
        });
      } catch (execErr) {
        if (idempotencyKey) {
          await IdempotencyService.failKey(idempotencyKey, { message: execErr.message, code: execErr.code });
        }
        throw execErr;
      }

      const explanation = ExplanationService.generateExplanation(instance);
      const responsePayload = {
        instance: instance.toObject ? instance.toObject() : instance,
        explanation
      };

      // 3. Mark idempotency key completed
      if (idempotencyKey) {
        await IdempotencyService.completeKey(idempotencyKey, instance._id, responsePayload);
      }

      return successResponse(res, responsePayload, 201, 'Workflow executed successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves workflow instance by ObjectId or requestId
   */
  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { requestId: id };
      const instance = await WorkflowInstance.findOne(query).populate('workflowConfigId');

      if (!instance) {
        throw new NotFoundError(`Workflow instance '${id}' not found`);
      }

      const explanation = ExplanationService.generateExplanation(instance);
      return successResponse(res, { instance, explanation });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves complete audit history for workflow instance
   */
  static async getAudit(req, res, next) {
    try {
      const { id } = req.params;
      const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { requestId: id };
      const instance = await WorkflowInstance.findOne(query);

      if (!instance) {
        throw new NotFoundError(`Workflow instance '${id}' not found`);
      }

      const auditTrail = await AuditService.getHistoryForInstance(instance._id);
      return successResponse(res, {
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        currentStatus: instance.status,
        auditTrail
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Returns human-readable explainable decision
   */
  static async getExplanation(req, res, next) {
    try {
      const { id } = req.params;
      const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { requestId: id };
      const instance = await WorkflowInstance.findOne(query);

      if (!instance) {
        throw new NotFoundError(`Workflow instance '${id}' not found`);
      }

      const explanation = ExplanationService.generateExplanation(instance);
      return successResponse(res, explanation);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Performs manual review action (Approve / Reject)
   */
  static async manualReview(req, res, next) {
    try {
      const { id } = req.params;
      const { action, comment = '' } = req.body;
      const reviewer = req.user?.username || req.body.reviewer || 'Underwriter';

      if (!action || !['APPROVE', 'REJECT'].includes(action.toUpperCase())) {
        throw new ValidationError("Manual review action must be either 'APPROVE' or 'REJECT'");
      }

      const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { requestId: id };
      const instance = await WorkflowInstance.findOne(query);

      if (!instance) {
        throw new NotFoundError(`Workflow instance '${id}' not found`);
      }

      if (instance.status !== 'MANUAL_REVIEW') {
        throw new AppError(`Cannot review application with status '${instance.status}'. Status must be 'MANUAL_REVIEW'`, 400, 'INVALID_REVIEW_STATE');
      }

      const normalizedAction = action.toUpperCase();
      const newStatus = normalizedAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const oldStatus = instance.status;

      instance.decision = newStatus;
      instance.status = newStatus;
      instance.previousStatus = oldStatus;
      instance.currentStage = 'COMPLETED';
      instance.completedAt = new Date();
      instance.manualReview = {
        reviewedBy: reviewer,
        comment,
        action: normalizedAction,
        reviewedAt: new Date()
      };
      instance.decisionExplanation = `Manual Review ${normalizedAction} by ${reviewer}: ${comment || 'No comment provided'}`;

      await instance.save();

      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'MANUAL_REVIEW_SUBMITTED',
        previousState: oldStatus,
        newState: newStatus,
        result: normalizedAction,
        explanation: `Manual review override: ${normalizedAction}. Comment: "${comment}"`,
        metadata: { reviewer, comment, action: normalizedAction },
        configVersion: instance.workflowConfigVersion
      });

      await AuditService.logEvent({
        workflowInstanceId: instance._id,
        requestId: instance.requestId,
        eventType: 'STAGE_TRANSITION',
        previousState: oldStatus,
        newState: newStatus,
        explanation: `Application transitioned to ${newStatus} via underwriter manual review`,
        configVersion: instance.workflowConfigVersion
      });

      return successResponse(res, {
        instance,
        explanation: ExplanationService.generateExplanation(instance)
      }, 200, `Application successfully ${newStatus.toLowerCase()} by manual review`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Manually triggers retry for RETRY_PENDING instance
   */
  static async retry(req, res, next) {
    try {
      const { id } = req.params;
      const { simulationOptions = {} } = req.body;
      const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { requestId: id };
      const instance = await WorkflowInstance.findOne(query);

      if (!instance) {
        throw new NotFoundError(`Workflow instance '${id}' not found`);
      }

      const updated = await RetryService.retryInstance(instance._id, simulationOptions);
      const explanation = ExplanationService.generateExplanation(updated);

      return successResponse(res, {
        instance: updated,
        explanation
      }, 200, `Workflow retry executed. Current status: ${updated.status}`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Lists workflow instances with search, filtering, and pagination
   */
  static async list(req, res, next) {
    try {
      const {
        status,
        workflowType,
        search,
        page = 1,
        limit = 20
      } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (workflowType) filter.workflowType = workflowType.toUpperCase();

      if (search) {
        filter.$or = [
          { requestId: { $regex: search, $options: 'i' } },
          { 'inputData.applicantName': { $regex: search, $options: 'i' } },
          { 'inputData.email': { $regex: search, $options: 'i' } }
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [instances, total] = await Promise.all([
        WorkflowInstance.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        WorkflowInstance.countDocuments(filter)
      ]);

      return successResponse(res, {
        items: instances,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

