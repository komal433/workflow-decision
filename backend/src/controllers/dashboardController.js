import { WorkflowInstance } from '../models/WorkflowInstance.js';
import { AuditLog } from '../models/AuditLog.js';
import { successResponse } from '../utils/apiResponse.js';

export class DashboardController {
  /**
   * Aggregates real backend dashboard metrics
   */
  static async getStats(req, res, next) {
    try {
      const [
        totalRequests,
        approvedCount,
        rejectedCount,
        manualReviewCount,
        retryPendingCount,
        failedCount,
        decisionDistribution,
        workflowTypeBreakdown,
        recentActivity
      ] = await Promise.all([
        WorkflowInstance.countDocuments(),
        WorkflowInstance.countDocuments({ status: 'APPROVED' }),
        WorkflowInstance.countDocuments({ status: 'REJECTED' }),
        WorkflowInstance.countDocuments({ status: 'MANUAL_REVIEW' }),
        WorkflowInstance.countDocuments({ status: 'RETRY_PENDING' }),
        WorkflowInstance.countDocuments({ status: 'FAILED' }),
        WorkflowInstance.aggregate([
          {
            $group: {
              _id: '$decision',
              count: { $sum: 1 }
            }
          }
        ]),
        WorkflowInstance.aggregate([
          {
            $group: {
              _id: '$workflowType',
              count: { $sum: 1 }
            }
          }
        ]),
        AuditLog.find()
          .sort({ timestamp: -1 })
          .limit(10)
          .lean()
      ]);

      // Calculate total retries triggered
      const retryStats = await WorkflowInstance.aggregate([
        {
          $group: {
            _id: null,
            totalExecutionAttempts: { $sum: '$executionAttempts' },
            retriedInstancesCount: {
              $sum: { $cond: [{ $gt: ['$executionAttempts', 1] }, 1, 0] }
            }
          }
        }
      ]);

      const totalRetries = retryStats[0] ? (retryStats[0].totalExecutionAttempts - totalRequests) : 0;

      return successResponse(res, {
        summary: {
          totalRequests,
          approvedCount,
          rejectedCount,
          manualReviewCount,
          retryPendingCount,
          failedCount,
          totalRetries: Math.max(0, totalRetries),
          retriedInstancesCount: retryStats[0]?.retriedInstancesCount || 0
        },
        decisionDistribution: decisionDistribution.map(d => ({
          decision: d._id || 'PENDING',
          count: d.count
        })),
        workflowTypeBreakdown: workflowTypeBreakdown.map(w => ({
          type: w._id,
          count: w.count
        })),
        recentActivity
      });
    } catch (err) {
      next(err);
    }
  }
}

