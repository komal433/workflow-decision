import { AuditService } from '../services/auditService.js';
import { successResponse } from '../utils/apiResponse.js';

export class AuditController {
  /**
   * Retrieves global audit logs with filtering and pagination
   */
  static async listLogs(req, res, next) {
    try {
      const { limit = 50, skip = 0, eventType, requestId } = req.query;
      const result = await AuditService.getGlobalAuditLogs({
        limit: parseInt(limit, 10),
        skip: parseInt(skip, 10),
        eventType,
        requestId
      });
      return successResponse(res, result);
    } catch (err) {
      next(err);
    }
  }
}

