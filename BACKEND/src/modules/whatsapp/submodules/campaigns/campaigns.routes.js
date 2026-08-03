/**
 * WhatsApp Campaigns — routes.
 *
 * Mount at: app.use('/api/whatsapp/campaigns', campaignsRoutes)
 *
 * Static routes (preview-audience) are declared before /:id to avoid shadowing.
 */
import { Router } from 'express';
import { authenticate }   from '../../../../shared/middlewares/auth.middleware.js';
import { requireRole, requireRoleOrPermission } from '../../../../shared/middlewares/role.middleware.js';
import { PERMISSIONS } from '../../../auth/constants/permissions.js';
import { ROLE_MIN } from './campaigns.constants.js';
import { campaignsController } from './campaigns.controller.js';
import {
  validateCreateCampaign,
  validateUpdateCampaign,
  validateListCampaigns,
  validateIdParam,
  validateWithComment,
  validateSchedule,
  validateFail,
  validatePreviewAudience,
} from './campaigns.validator.js';

const router = Router();

// ── Static endpoints (must come before /:id) ───────────────────────────────────
router.post('/preview-audience',
  authenticate,
  requireRole(ROLE_MIN.PREVIEW_AUDIENCE),
  validatePreviewAudience,
  campaignsController.previewAudience,
);

// ── CRUD ───────────────────────────────────────────────────────────────────────
router.post('/',
  authenticate,
  requireRole(ROLE_MIN.CREATE),
  validateCreateCampaign,
  campaignsController.create,
);

router.get('/',
  authenticate,
  requireRole(ROLE_MIN.READ),
  validateListCampaigns,
  campaignsController.list,
);

router.get('/:id',
  authenticate,
  requireRole(ROLE_MIN.READ),
  validateIdParam,
  campaignsController.get,
);

router.patch('/:id',
  authenticate,
  requireRole(ROLE_MIN.UPDATE),
  validateUpdateCampaign,
  campaignsController.update,
);

router.delete('/:id',
  authenticate,
  requireRole(ROLE_MIN.DELETE),
  validateIdParam,
  campaignsController.remove,
);

// ── Lifecycle transitions ──────────────────────────────────────────────────────
router.post('/:id/approve',
  authenticate,
  requireRoleOrPermission(ROLE_MIN.APPROVE, PERMISSIONS.APPROVE_CAMPAIGNS),
  validateWithComment,
  campaignsController.approve,
);

router.post('/:id/schedule',
  authenticate,
  requireRole(ROLE_MIN.SCHEDULE),
  validateSchedule,
  campaignsController.schedule,
);

router.post('/:id/start',
  authenticate,
  requireRoleOrPermission(ROLE_MIN.START, PERMISSIONS.APPROVE_CAMPAIGNS),
  validateWithComment,
  campaignsController.start,
);

router.post('/:id/complete',
  authenticate,
  requireRole(ROLE_MIN.COMPLETE),
  validateWithComment,
  campaignsController.complete,
);

router.post('/:id/fail',
  authenticate,
  requireRole(ROLE_MIN.FAIL),
  validateFail,
  campaignsController.fail,
);

router.post('/:id/cancel',
  authenticate,
  requireRole(ROLE_MIN.CANCEL),
  validateWithComment,
  campaignsController.cancel,
);

export default router;