/**
 * WhatsApp Settings — controller.
 *
 * Thin HTTP layer. All business logic lives in whatsappSettingsService.
 * Same buildCtx + response-helper pattern as every other WhatsApp submodule.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated } from '../../../../utils/responses.js';
import { whatsappSettingsService } from './whatsappSettings.service.js';
import { SYNC_ENTITY } from './whatsappSettings.constants.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_demo';

function buildCtx(req) {
  if (req.user?.tenantId) {
    return {
      tenantId: req.user.tenantId,
      userId:   req.user.sub || req.user.id || req.user._id || null,
      role:     req.user.role || null,
    };
  }
  return {
    tenantId: req.context?.tenantId || req.header('x-tenant-id') || DEFAULT_TENANT_ID,
    userId:   req.context?.userId   || req.header('x-user-id')   || null,
    role:     req.context?.role     || req.header('x-user-role') || 'tenant_owner',
  };
}

export const whatsappSettingsController = {
  // POST /api/whatsapp/settings
  create: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.createSettings(buildCtx(req), req.body);
    return sendCreated(res, data, 'Settings created');
  }),

  // GET /api/whatsapp/settings
  get: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.getSettings(buildCtx(req));
    return sendSuccess(res, data, 'Settings fetched successfully');
  }),

  // PATCH /api/whatsapp/settings
  update: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSettings(buildCtx(req), req.body);
    return sendSuccess(res, data, 'Settings updated');
  }),

  // PATCH /api/whatsapp/settings/provider
  updateProvider: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'provider', req.body);
    return sendSuccess(res, data, 'Provider settings updated');
  }),

  // PATCH /api/whatsapp/settings/business-profile
  updateBusinessProfile: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'businessProfile', req.body);
    return sendSuccess(res, data, 'Business profile updated');
  }),

  // PATCH /api/whatsapp/settings/messaging
  updateMessaging: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'messaging', req.body);
    return sendSuccess(res, data, 'Messaging settings updated');
  }),

  // PATCH /api/whatsapp/settings/media
  updateMedia: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'media', req.body);
    return sendSuccess(res, data, 'Media settings updated');
  }),

  // PATCH /api/whatsapp/settings/ai
  updateAI: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'ai', req.body);
    return sendSuccess(res, data, 'AI settings updated');
  }),

  // PATCH /api/whatsapp/settings/automation
  updateAutomation: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'automation', req.body);
    return sendSuccess(res, data, 'Automation settings updated');
  }),

  // PATCH /api/whatsapp/settings/notifications
  updateNotifications: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'notifications', req.body);
    return sendSuccess(res, data, 'Notification settings updated');
  }),

  // PATCH /api/whatsapp/settings/security
  updateSecurity: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'security', req.body);
    return sendSuccess(res, data, 'Security settings updated');
  }),

  // PATCH /api/whatsapp/settings/sync
  updateSync: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'sync', req.body);
    return sendSuccess(res, data, 'Sync settings updated');
  }),

  // PATCH /api/whatsapp/settings/limits
  updateLimits: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.updateSection(buildCtx(req), 'limits', req.body);
    return sendSuccess(res, data, 'Limits updated');
  }),

  // POST /api/whatsapp/settings/test-connection
  testConnection: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.testConnection(buildCtx(req));
    return sendSuccess(res, data, 'Connection test completed');
  }),

  // POST /api/whatsapp/settings/embedded-signup/exchange
  exchangeEmbeddedSignup: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.exchangeEmbeddedSignupCode(buildCtx(req), req.body);
    return sendSuccess(res, data, 'WhatsApp connected via Embedded Signup');
  }),

  // POST /api/whatsapp/settings/sync/templates
  syncTemplates: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.sync(buildCtx(req), SYNC_ENTITY.TEMPLATES);
    return sendSuccess(res, data, 'Templates sync triggered');
  }),

  // POST /api/whatsapp/settings/sync/contacts
  syncContacts: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.sync(buildCtx(req), SYNC_ENTITY.CONTACTS);
    return sendSuccess(res, data, 'Contacts sync triggered');
  }),

  // POST /api/whatsapp/settings/sync/messages
  syncMessages: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.sync(buildCtx(req), SYNC_ENTITY.MESSAGES);
    return sendSuccess(res, data, 'Messages sync triggered');
  }),

  // POST /api/whatsapp/settings/sync/profile
  syncProfile: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.sync(buildCtx(req), SYNC_ENTITY.PROFILE);
    return sendSuccess(res, data, 'Business profile sync triggered');
  }),

  // POST /api/whatsapp/settings/reset
  reset: asyncHandler(async (req, res) => {
    const data = await whatsappSettingsService.resetSettings(buildCtx(req));
    return sendSuccess(res, data, 'Settings reset to defaults');
  }),
};