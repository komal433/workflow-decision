import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

/**
 * Append-only Audit Service
 * Records every lifecycle event, rule evaluation trace, state transition, and retry.
 */
export class AuditService {
  /**
   * Appends an audit event to MongoDB
   * @param {Object} params - Event parameters
   * @returns {Promise<Object>} Created audit log document
   */
  static async logEvent({
    workflowInstanceId,
    requestId,
    eventType,
    previousState = null,
    newState = null,
    ruleId = null,
    result = null,
    explanation = '',
    metadata = {},
    configVersion = 1,
    session = null
  }) {
    try {
      const logEntry = new AuditLog({
        workflowInstanceId,
        requestId,
        eventType,
        previousState,
        newState,
        ruleId,
        result,
        explanation,
        metadata,
        configVersion,
        timestamp: new Date()
      });

      const saved = await logEntry.save({ session });
      logger.info(`[AUDIT] ${eventType}`, {
        workflowInstanceId: String(workflowInstanceId),
        requestId,
        previousState,
        newState,
        result
      });
      return saved;
    } catch (err) {
      logger.error('Failed to write audit log event', {
        error: err.message,
        eventType,
        workflowInstanceId: String(workflowInstanceId)
      });
      // Do not crash workflow if audit fails in standalone mode, but rethrow if in transaction
      if (session) throw err;
      return null;
    }
  }

  /**
   * Retrieves full chronological audit history for a workflow instance
   * @param {string|ObjectId} workflowInstanceId
   * @returns {Promise<Array>}
   */
  static async getHistoryForInstance(workflowInstanceId) {
    return AuditLog.find({ workflowInstanceId })
      .sort({ timestamp: 1 })
      .lean();
  }

  /**
   * Retrieves global audit logs with filtering and pagination
   */
  static async getGlobalAuditLogs({ limit = 50, skip = 0, eventType = null, requestId = null }) {
    const filter = {};
    if (eventType) filter.eventType = eventType;
    if (requestId) filter.requestId = requestId;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    return { logs, total, limit: Number(limit), skip: Number(skip) };
  }
}

