/**
 * WhatsApp Nurtures — routes.
 *
 * Mount at: app.use('/api/whatsapp/nurtures', nurturesRoutes)
 *
 * Route declaration order matters:
 *   1. Static collection prefix  /enrollments/...  (before /:id)
 *   2. CRUD                      /   /:id
 *   3. Sequence lifecycle        /:id/activate  /:id/pause  /:id/archive
 *   4. Enrollment on sequence    /:id/enroll
 */
import { Router } from 'express';
import { authenticate } from '../../../../shared/middlewares/auth.middleware.js';
import { requireRole }  from '../../../../shared/middlewares/role.middleware.js';
import { ROLE_MIN }     from './nurtures.constants.js';
import { nurturesController } from './nurtures.controller.js';
import {
  validateCreateSequence,
  validateUpdateSequence,
  validateListSequences,
  validateIdParam,
  validateWithComment,
  validateEnroll,
  validateListEnrollments,
} from './nurtures.validator.js';

const router = Router();

// ── Enrollment collection routes (MUST come before /:id) ──────────────────────

router.get('/enrollments',
  authenticate, requireRole(ROLE_MIN.LIST_ENROLLMENTS),
  validateListEnrollments, nurturesController.listEnrollments,
);

router.get('/enrollments/:id',
  authenticate, requireRole(ROLE_MIN.LIST_ENROLLMENTS),
  validateIdParam, nurturesController.getEnrollment,
);

router.post('/enrollments/:id/pause',
  authenticate, requireRole(ROLE_MIN.MANAGE_ENROLLMENT),
  validateWithComment, nurturesController.pauseEnrollment,
);

router.post('/enrollments/:id/resume',
  authenticate, requireRole(ROLE_MIN.MANAGE_ENROLLMENT),
  validateWithComment, nurturesController.resumeEnrollment,
);

router.post('/enrollments/:id/cancel',
  authenticate, requireRole(ROLE_MIN.MANAGE_ENROLLMENT),
  validateWithComment, nurturesController.cancelEnrollment,
);

// ── Sequence CRUD ──────────────────────────────────────────────────────────────

// Real, static route -- must stay before /:id, same discipline as
// /enrollments above. Exposes VARIABLE_REGISTRY so the frontend's
// Insert Variable picker reads from the exact same source the backend
// interpolation actually uses, not a separately maintained duplicate.
router.get('/variables',
  authenticate, requireRole(ROLE_MIN.READ),
  nurturesController.getVariables,
);

router.post('/',
  authenticate, requireRole(ROLE_MIN.CREATE),
  validateCreateSequence, nurturesController.create,
);

router.get('/',
  authenticate, requireRole(ROLE_MIN.READ),
  validateListSequences, nurturesController.list,
);

router.get('/:id',
  authenticate, requireRole(ROLE_MIN.READ),
  validateIdParam, nurturesController.get,
);

// Real, admin-only -- exposes/regenerates a real security credential
// (the webhook token), gated higher than plain sequence viewing.
router.get('/:id/webhook-url',
  authenticate, requireRole(ROLE_MIN.ACTIVATE),
  validateIdParam, nurturesController.getWebhookUrl,
);
router.post('/:id/webhook-url/regenerate',
  authenticate, requireRole(ROLE_MIN.ACTIVATE),
  validateIdParam, nurturesController.regenerateWebhookUrl,
);

router.patch('/:id',
  authenticate, requireRole(ROLE_MIN.UPDATE),
  validateUpdateSequence, nurturesController.update,
);

router.delete('/:id',
  authenticate, requireRole(ROLE_MIN.DELETE),
  validateIdParam, nurturesController.remove,
);

// ── Sequence lifecycle ─────────────────────────────────────────────────────────

router.post('/:id/activate',
  authenticate, requireRole(ROLE_MIN.ACTIVATE),
  validateWithComment, nurturesController.activate,
);

router.post('/:id/pause',
  authenticate, requireRole(ROLE_MIN.PAUSE),
  validateWithComment, nurturesController.pause,
);

router.post('/:id/archive',
  authenticate, requireRole(ROLE_MIN.ARCHIVE),
  validateWithComment, nurturesController.archive,
);

// ── Enroll a lead into the sequence ───────────────────────────────────────────

router.post('/:id/enroll',
  authenticate, requireRole(ROLE_MIN.ENROLL),
  validateEnroll, nurturesController.enroll,
);

export default router;