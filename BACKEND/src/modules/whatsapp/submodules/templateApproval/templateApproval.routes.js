/**
 * WhatsApp Template Approval — routes.
 *
 * Exports TWO routers:
 *
 *   templateApprovalRoutes      — action endpoints mounted under the existing
 *     /api/whatsapp/templates router (shares /:id namespace; declared AFTER
 *     the templates module's own routes to avoid shadowing GET/PATCH/DELETE /:id).
 *
 *   templateApprovalWebhookRoutes — provider webhook endpoints mounted at
 *     /api/whatsapp/template-approval (NO authenticate middleware, must be
 *     verified by provider-signature logic in production).
 *
 * Suggested additions to src/app.js:
 *
 *   import { templateApprovalRoutes, templateApprovalWebhookRoutes }
 *     from './modules/whatsapp/submodules/templateApproval/templateApproval.routes.js';
 *
 *   app.use('/api/whatsapp/templates', templateApprovalRoutes);
 *   app.use('/api/whatsapp/template-approval', templateApprovalWebhookRoutes);
 *
 * Both imports go AFTER the existing templatesRoutes mount so the static routes
 * (/categories, /languages) are not overshadowed.
 */
import { Router } from 'express';
import { authenticate } from '../../../../shared/middlewares/auth.middleware.js';
import { requireRole, requireRoleOrPermission } from '../../../../shared/middlewares/role.middleware.js';
import { PERMISSIONS } from '../../../auth/constants/permissions.js';
import { ROLE_MIN } from './templateApproval.constants.js';
import { templateApprovalController } from './templateApproval.controller.js';
import {
  validateIdParam,
  validateWithComment,
  validateWithRequiredComment,
  validateProviderWebhook,
} from './templateApproval.validator.js';

// ── Authenticated action endpoints (/api/whatsapp/templates/:id/…) ───────────
const templateApprovalRouter = Router();

templateApprovalRouter.post(
  '/:id/submit-review',
  authenticate,
  requireRole(ROLE_MIN.SUBMIT_FOR_REVIEW),
  validateWithComment,
  templateApprovalController.submitForReview,
);

templateApprovalRouter.post(
  '/:id/request-changes',
  authenticate,
  requireRole(ROLE_MIN.REQUEST_CHANGES),
  validateWithRequiredComment,
  templateApprovalController.requestChanges,
);

templateApprovalRouter.post(
  '/:id/approve',
  authenticate,
  requireRoleOrPermission(ROLE_MIN.APPROVE, PERMISSIONS.APPROVE_TEMPLATES),
  validateWithComment,
  templateApprovalController.approve,
);

templateApprovalRouter.post(
  '/:id/reject',
  authenticate,
  requireRole(ROLE_MIN.REJECT),
  validateWithRequiredComment,
  templateApprovalController.reject,
);

templateApprovalRouter.post(
  '/:id/submit-provider',
  authenticate,
  requireRoleOrPermission(ROLE_MIN.SUBMIT_TO_PROVIDER, PERMISSIONS.APPROVE_TEMPLATES),
  validateIdParam,
  templateApprovalController.submitToProvider,
);

templateApprovalRouter.get(
  '/:id/timeline',
  authenticate,
  requireRole(ROLE_MIN.VIEW_TIMELINE),
  validateIdParam,
  templateApprovalController.getTimeline,
);

// ── Unauthenticated provider webhook endpoints (/api/whatsapp/template-approval/…)
const templateApprovalWebhookRouter = Router();

templateApprovalWebhookRouter.post(
  '/provider/approved',
  validateProviderWebhook,
  templateApprovalController.webhookApproved,
);

templateApprovalWebhookRouter.post(
  '/provider/rejected',
  validateProviderWebhook,
  templateApprovalController.webhookRejected,
);

templateApprovalWebhookRouter.post(
  '/provider/paused',
  validateProviderWebhook,
  templateApprovalController.webhookPaused,
);

templateApprovalWebhookRouter.post(
  '/provider/disabled',
  validateProviderWebhook,
  templateApprovalController.webhookDisabled,
);

export const templateApprovalRoutes = templateApprovalRouter;
export const templateApprovalWebhookRoutes = templateApprovalWebhookRouter;