import { Router } from 'express';
import { AuditController } from '../controllers/auditController.js';

const router = Router();

router.get('/', AuditController.listLogs);

export default router;

