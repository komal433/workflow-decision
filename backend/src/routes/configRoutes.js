import { Router } from 'express';
import { ConfigController } from '../controllers/configController.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Public / Read
router.get('/', ConfigController.listConfigs);
router.get('/:id', ConfigController.getConfigById);

// Admin-protected configuration modifications
router.post('/', requireRole('ADMIN'), ConfigController.createConfig);
router.put('/:id', requireRole('ADMIN'), ConfigController.updateConfig);
router.post('/:id/activate', requireRole('ADMIN'), ConfigController.activateConfig);

export default router;

