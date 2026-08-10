import { Router } from 'express';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';
import { tenantProfileController } from './tenantProfile.controller.js';

const router = Router();

router.get('/profile', authenticate, tenantProfileController.getProfile);
router.patch('/profile', authenticate, requireRole('tenant_admin'), tenantProfileController.updateProfile);

export default router;