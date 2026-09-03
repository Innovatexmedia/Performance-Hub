
import { Router } from 'express';
import { requireRole } from '../../../../shared/middlewares/role.middleware.js';
import { ROLE_MIN }    from './whatsappSettings.constants.js';
import { whatsappSettingsController } from './whatsappSettings.controller.js';
import {
  validateCreateSettings,
  validateUpdateSettings,
  validateProviderSection,
  validateBusinessProfile,
  validateMessaging,
  validateMedia,
  validateAI,
  validateAutomation,
  validateNotifications,
  validateSecurity,
  validateSyncSettings,
  validateLimits,
} from './whatsappSettings.validator.js';

const router = Router();

// ── Core CRUD ──────────────────────────────────────────────────────────────────
router.post('/',
  requireRole(ROLE_MIN.CREATE),
  validateCreateSettings, whatsappSettingsController.create,
);

router.get('/',
  requireRole(ROLE_MIN.READ),
  whatsappSettingsController.get,
);

router.patch('/',
  requireRole(ROLE_MIN.UPDATE),
  validateUpdateSettings, whatsappSettingsController.update,
);

// ── Section-specific updates ───────────────────────────────────────────────────
router.patch('/provider',
  requireRole(ROLE_MIN.UPDATE),
  validateProviderSection, whatsappSettingsController.updateProvider,
);

router.patch('/business-profile',
  requireRole(ROLE_MIN.UPDATE),
  validateBusinessProfile, whatsappSettingsController.updateBusinessProfile,
);

router.patch('/messaging',
  requireRole(ROLE_MIN.UPDATE),
  validateMessaging, whatsappSettingsController.updateMessaging,
);

router.patch('/media',
  requireRole(ROLE_MIN.UPDATE),
  validateMedia, whatsappSettingsController.updateMedia,
);

router.patch('/ai',
  requireRole(ROLE_MIN.UPDATE),
  validateAI, whatsappSettingsController.updateAI,
);

router.patch('/automation',
  requireRole(ROLE_MIN.UPDATE),
  validateAutomation, whatsappSettingsController.updateAutomation,
);

router.patch('/notifications',
  requireRole(ROLE_MIN.UPDATE),
  validateNotifications, whatsappSettingsController.updateNotifications,
);

router.patch('/security',
  requireRole(ROLE_MIN.UPDATE),
  validateSecurity, whatsappSettingsController.updateSecurity,
);

router.patch('/sync',
  requireRole(ROLE_MIN.UPDATE),
  validateSyncSettings, whatsappSettingsController.updateSync,
);

router.patch('/limits',
  requireRole(ROLE_MIN.UPDATE),
  validateLimits, whatsappSettingsController.updateLimits,
);

// ── Operations ─────────────────────────────────────────────────────────────────
router.post('/test-connection',
  requireRole(ROLE_MIN.TEST),
  whatsappSettingsController.testConnection,
);

// POST /api/whatsapp/settings/embedded-signup/exchange -- same permission
// as the manual connect form (updateProvider), since this achieves the
// exact same end state (a connected WhatsApp), just via Meta's flow
// instead of pasted credentials.
router.post('/embedded-signup/exchange',
  requireRole(ROLE_MIN.UPDATE),
  whatsappSettingsController.exchangeEmbeddedSignup,
);

router.post('/sync/templates',
  requireRole(ROLE_MIN.SYNC),
  whatsappSettingsController.syncTemplates,
);

router.post('/sync/contacts',
  requireRole(ROLE_MIN.SYNC),
  whatsappSettingsController.syncContacts,
);

router.post('/sync/messages',
  requireRole(ROLE_MIN.SYNC),
  whatsappSettingsController.syncMessages,
);

router.post('/sync/profile',
  requireRole(ROLE_MIN.SYNC),
  whatsappSettingsController.syncProfile,
);

router.post('/reset',
  requireRole(ROLE_MIN.RESET),
  whatsappSettingsController.reset,
);

export default router;