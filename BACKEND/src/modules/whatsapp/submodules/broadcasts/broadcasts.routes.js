/**
 * WhatsApp Broadcasts — routes.
 * Mount at: app.use('/api/whatsapp/broadcasts', broadcastsRoutes)
 *
 * Static route (preview-audience) declared before /:id to avoid shadowing.
 */
import { Router } from 'express';
import { authenticate } from '../../../../shared/middlewares/auth.middleware.js';
import { requireRole, requireRoleOrPermission } from '../../../../shared/middlewares/role.middleware.js';
import { PERMISSIONS } from '../../../auth/constants/permissions.js';
import { ROLE_MIN }     from './broadcasts.constants.js';
import { broadcastsController } from './broadcasts.controller.js';
import {
  validateCreateBroadcast,
  validateUpdateBroadcast,
  validateListBroadcasts,
  validateIdParam,
  validateWithComment,
  validateSchedule,
  validateFail,
  validatePreviewAudience,
} from './broadcasts.validator.js';

const router = Router();

// ── Static (before /:id) ───────────────────────────────────────────────────────
router.post('/preview-audience',
  authenticate,
  requireRole(ROLE_MIN.PREVIEW_AUDIENCE),
  validatePreviewAudience,
  broadcastsController.previewAudience,
);

// ── CRUD ───────────────────────────────────────────────────────────────────────
router.post('/',
  authenticate, requireRole(ROLE_MIN.CREATE),
  validateCreateBroadcast, broadcastsController.create,
);

router.get('/',
  authenticate, requireRole(ROLE_MIN.READ),
  validateListBroadcasts, broadcastsController.list,
);

router.get('/:id',
  authenticate, requireRole(ROLE_MIN.READ),
  validateIdParam, broadcastsController.get,
);

router.patch('/:id',
  authenticate, requireRole(ROLE_MIN.UPDATE),
  validateUpdateBroadcast, broadcastsController.update,
);

router.delete('/:id',
  authenticate, requireRole(ROLE_MIN.DELETE),
  validateIdParam, broadcastsController.remove,
);

// ── Lifecycle ──────────────────────────────────────────────────────────────────
router.post('/:id/approve',
  authenticate, requireRoleOrPermission(ROLE_MIN.APPROVE, PERMISSIONS.APPROVE_CAMPAIGNS),
  validateWithComment, broadcastsController.approve,
);

router.post('/:id/schedule',
  authenticate, requireRole(ROLE_MIN.SCHEDULE),
  validateSchedule, broadcastsController.schedule,
);

router.post('/:id/start',
  authenticate, requireRoleOrPermission(ROLE_MIN.START, PERMISSIONS.APPROVE_CAMPAIGNS),
  validateWithComment, broadcastsController.start,
);

// POST /api/whatsapp/broadcasts/:id/resend-failed -- see
// campaigns.routes.js's identical route for the reasoning; gated like
// creating a broadcast since that's what this does under the hood.
router.post('/:id/resend-failed',
  authenticate, requireRole(ROLE_MIN.CREATE),
  broadcastsController.resendFailed,
);

router.post('/:id/complete',
  authenticate, requireRole(ROLE_MIN.COMPLETE),
  validateWithComment, broadcastsController.complete,
);

router.post('/:id/fail',
  authenticate, requireRole(ROLE_MIN.FAIL),
  validateFail, broadcastsController.fail,
);

router.post('/:id/cancel',
  authenticate, requireRole(ROLE_MIN.CANCEL),
  validateWithComment, broadcastsController.cancel,
);

export default router;