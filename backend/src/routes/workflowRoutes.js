import { Router } from 'express';
import { WorkflowController } from '../controllers/workflowController.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Workflow execution & listing
router.post('/execute', WorkflowController.execute);
router.get('/', WorkflowController.list);

// Instance status, audit trail, and decision explanation
router.get('/:id', WorkflowController.getById);
router.get('/:id/audit', WorkflowController.getAudit);
router.get('/:id/explanation', WorkflowController.getExplanation);

// Manual Review (Admin protected)
router.post('/:id/review', requireRole('ADMIN'), WorkflowController.manualReview);

// Retry
router.post('/:id/retry', WorkflowController.retry);

export default router;

