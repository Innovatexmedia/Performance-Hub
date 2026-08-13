import { Router } from 'express';
import { planController } from './plan.controller.js';
import { validateCreatePlan, validateUpdatePlan } from './plan.validator.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';

const router = Router();

router.use(authenticate);

// Any authenticated user -- a tenant_owner needs to browse plans to
// consider upgrading (Settings > Billing), not just super_admin.
router.get('/',     planController.list);
router.get('/:id',  planController.get);

// Mutations are platform-staff-only -- see plan.service.js's comment on
// why track/tier/key aren't editable even for super_admin via update().
router.post('/',       requireRole('super_admin'), validateCreatePlan, planController.create);
router.patch('/:id',   requireRole('super_admin'), validateUpdatePlan, planController.update);
router.delete('/:id',  requireRole('super_admin'), planController.remove);

export default router;
