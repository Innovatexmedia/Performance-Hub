/**
 * WhatsApp Consent & Opt-Out — routes.
 *
 * Mounted at: whatsappRouter.use('/consent', consentRoutes)
 * → all endpoints live under /api/whatsapp/consent/...
 *
 * Route order: static paths ("/stats", "/verify/:phoneNumber") are
 * declared BEFORE "/:id" so Express does not treat "stats"/"verify" as an
 * :id value.
 */
import { Router } from 'express';
import { authenticate } from '../../../../shared/middlewares/auth.middleware.js';
import { requireRole }  from '../../../../shared/middlewares/role.middleware.js';
import { withContext }  from '../../../../shared/helpers/lead.helpers.js';
import { ROLE_MIN }     from './consent.constants.js';
import { consentController } from './consent.controller.js';
import {
  validateCreateConsent,
  validateListConsents,
  validateIdParam,
  validateOptIn,
  validateOptOut,
  validateBlock,
  validateVerify,
} from './consent.validator.js';

const router = Router();

router.use(withContext);

// ── Static paths (MUST be before /:id) ─────────────────────────────────────────
router.get('/stats',
  authenticate, requireRole(ROLE_MIN.READ),
  consentController.stats,
);

router.get('/verify/:phoneNumber',
  authenticate, requireRole(ROLE_MIN.VERIFY),
  validateVerify, consentController.verify,
);

// ── Collection routes ──────────────────────────────────────────────────────────
router.post('/',
  authenticate, requireRole(ROLE_MIN.CREATE),
  validateCreateConsent, consentController.create,
);

router.get('/',
  authenticate, requireRole(ROLE_MIN.READ),
  validateListConsents, consentController.list,
);

// ── Resource routes (:id) ──────────────────────────────────────────────────────
router.get('/:id',
  authenticate, requireRole(ROLE_MIN.READ),
  validateIdParam, consentController.get,
);

router.get('/:id/history',
  authenticate, requireRole(ROLE_MIN.HISTORY),
  validateIdParam, consentController.history,
);

router.post('/:id/opt-in',
  authenticate, requireRole(ROLE_MIN.OPT_IN),
  validateOptIn, consentController.optIn,
);

router.post('/:id/opt-out',
  authenticate, requireRole(ROLE_MIN.OPT_OUT),
  validateOptOut, consentController.optOut,
);

router.post('/:id/block',
  authenticate, requireRole(ROLE_MIN.BLOCK),
  validateBlock, consentController.block,
);

router.post('/:id/unblock',
  authenticate, requireRole(ROLE_MIN.UNBLOCK),
  validateBlock, consentController.unblock,
);

export default router;