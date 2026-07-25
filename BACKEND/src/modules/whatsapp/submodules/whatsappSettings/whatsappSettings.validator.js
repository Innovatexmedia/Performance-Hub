/**
 * WhatsApp Settings — validator (express-validator).
 * Consistent with the other WhatsApp submodule validators.
 */
import { body, param, validationResult } from 'express-validator';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import {
  PROVIDER_VALUES,
  PANEL_MODE_VALUES,
  AI_PROVIDER_VALUES,
  BUSINESS_VERTICAL_VALUES,
  GRAPH_API_VERSION_PATTERN,
  SYNC_ENTITY,
} from './whatsappSettings.constants.js';

export const handleValidation = (req, _res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.path ?? e.param, message: e.msg }));
    return next(new AppError(400, 'Validation failed', details));
  }
  next();
};

// NOTE: `providerMode` is deliberately NOT validated/accepted anywhere in
// this file anymore. It is never client-settable -- the backend derives it
// exclusively (see whatsappSettings.service.js#resolveProviderFields and
// #testConnection). Even if a client sends it, the service never reads it
// from the request body, so leaving a validation rule for it here would
// just validate a value that's silently ignored, which is confusing.
// `panelMode` IS a real, validated, user-facing field (Architecture
// Decision, Option B) -- it governs `provider` server-side.

// ── Create / full update ───────────────────────────────────────────────────────
export const validateCreateSettings = [
  body('provider').optional().isIn(PROVIDER_VALUES).withMessage(`provider must be one of: ${PROVIDER_VALUES.join(', ')}`),
  body('panelMode').optional().isIn(PANEL_MODE_VALUES).withMessage('Invalid panelMode'),
  body('meta.graphApiVersion').optional().matches(GRAPH_API_VERSION_PATTERN).withMessage('graphApiVersion must look like v21.0'),
  body('meta.webhookUrl').optional({ values: 'falsy' }).isURL().withMessage('webhookUrl must be a valid URL'),
  body('businessProfile.email').optional({ values: 'falsy' }).isEmail().withMessage('Invalid business email'),
  body('businessProfile.website').optional({ values: 'falsy' }).isURL().withMessage('website must be a valid URL'),
  body('businessProfile.vertical').optional().isIn(BUSINESS_VERTICAL_VALUES).withMessage('Invalid vertical'),
  body('ai.provider').optional().isIn(AI_PROVIDER_VALUES).withMessage('Invalid AI provider'),
  body('ai.temperature').optional().isFloat({ min: 0, max: 2 }).withMessage('temperature must be 0–2'),
  handleValidation,
];

export const validateUpdateSettings = validateCreateSettings;

// ── Provider section ───────────────────────────────────────────────────────────
export const validateProviderSection = [
  body('provider').optional().isIn(PROVIDER_VALUES).withMessage('Invalid provider'),
  body('panelMode').optional().isIn(PANEL_MODE_VALUES).withMessage('Invalid panelMode'),
  body('meta.graphApiVersion').optional().matches(GRAPH_API_VERSION_PATTERN).withMessage('graphApiVersion must look like v21.0'),
  body('meta.webhookUrl').optional({ values: 'falsy' }).isURL().withMessage('webhookUrl must be a valid URL'),
  body('meta.phoneNumberId').optional().isString().trim(),
  body('meta.businessAccountId').optional().isString().trim(),
  body('meta.connected').optional().isBoolean().withMessage('meta.connected must be a boolean'),
  handleValidation,
];

// ── Business profile section ───────────────────────────────────────────────────
export const validateBusinessProfile = [
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Invalid email'),
  body('website').optional({ values: 'falsy' }).isURL().withMessage('website must be a valid URL'),
  body('profilePicture').optional({ values: 'falsy' }).isURL().withMessage('profilePicture must be a valid URL'),
  body('vertical').optional().isIn(BUSINESS_VERTICAL_VALUES).withMessage('Invalid vertical'),
  handleValidation,
];

// ── Messaging section ──────────────────────────────────────────────────────────
export const validateMessaging = [
  body('defaultLanguage').optional().isString().isLength({ min: 2, max: 10 }),
  body('defaultTemplate').optional({ values: 'null' }).isMongoId().withMessage('defaultTemplate must be a valid id'),
  body('typingIndicator').optional().isBoolean(),
  body('readReceipts').optional().isBoolean(),
  body('deliveryReceipts').optional().isBoolean(),
  body('autoMarkRead').optional().isBoolean(),
  body('replyDelay').optional().isInt({ min: 0 }).withMessage('replyDelay must be >= 0'),
  body('timezone').optional().isString(),
  handleValidation,
];

// ── Media section ──────────────────────────────────────────────────────────────
export const validateMedia = [
  body('maxUploadSize').optional().isInt({ min: 1, max: 100 }).withMessage('maxUploadSize must be 1–100 MB'),
  body('allowedExtensions').optional().isArray().withMessage('allowedExtensions must be an array'),
  body('imageCompression').optional().isBoolean(),
  body('videoCompression').optional().isBoolean(),
  body('documentPreview').optional().isBoolean(),
  body('audioSupport').optional().isBoolean(),
  body('stickerSupport').optional().isBoolean(),
  handleValidation,
];

// ── AI section ─────────────────────────────────────────────────────────────────
export const validateAI = [
  body('enabled').optional().isBoolean(),
  body('provider').optional().isIn(AI_PROVIDER_VALUES).withMessage('Invalid AI provider'),
  body('model').optional().isString(),
  body('temperature').optional().isFloat({ min: 0, max: 2 }).withMessage('temperature must be 0–2'),
  body('maxTokens').optional().isInt({ min: 1, max: 32000 }).withMessage('maxTokens must be 1–32000'),
  body('confidenceThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('confidenceThreshold must be 0–1'),
  body('fallbackReply').optional().isString().isLength({ max: 1000 }),
  body('humanHandoff').optional().isBoolean(),
  handleValidation,
];

// ── Automation section ─────────────────────────────────────────────────────────
export const validateAutomation = [
  body('enabled').optional().isBoolean(),
  body('retryFailedMessages').optional().isBoolean(),
  body('retryAttempts').optional().isInt({ min: 0, max: 10 }).withMessage('retryAttempts must be 0–10'),
  body('retryInterval').optional().isInt({ min: 0 }).withMessage('retryInterval must be >= 0'),
  body('defaultExecutionDelay').optional().isInt({ min: 0 }).withMessage('defaultExecutionDelay must be >= 0'),
  handleValidation,
];

// ── Notifications section ──────────────────────────────────────────────────────
export const validateNotifications = [
  body('campaignCompleted').optional().isBoolean(),
  body('templateRejected').optional().isBoolean(),
  body('providerDisconnected').optional().isBoolean(),
  body('failedMessages').optional().isBoolean(),
  body('quotaExceeded').optional().isBoolean(),
  body('systemAlerts').optional().isBoolean(),
  handleValidation,
];

// ── Security section ───────────────────────────────────────────────────────────
export const validateSecurity = [
  body('encryptAccessToken').optional().isBoolean(),
  body('ipWhitelist').optional().isArray().withMessage('ipWhitelist must be an array'),
  body('ipWhitelist.*').optional().isIP().withMessage('ipWhitelist entries must be valid IPs'),
  body('allowedDomains').optional().isArray().withMessage('allowedDomains must be an array'),
  body('auditEnabled').optional().isBoolean(),
  body('apiKeyRotation').optional().isBoolean(),
  handleValidation,
];

// ── Sync section ───────────────────────────────────────────────────────────────
export const validateSyncSettings = [
  body('autoSyncTemplates').optional().isBoolean(),
  body('autoSyncContacts').optional().isBoolean(),
  body('autoSyncMessages').optional().isBoolean(),
  body('autoSyncBusinessProfile').optional().isBoolean(),
  handleValidation,
];

// ── Limits section ─────────────────────────────────────────────────────────────
export const validateLimits = [
  body('dailyMessages').optional().isInt({ min: 0 }),
  body('monthlyMessages').optional().isInt({ min: 0 }),
  body('contacts').optional().isInt({ min: 0 }),
  body('campaigns').optional().isInt({ min: 0 }),
  body('broadcasts').optional().isInt({ min: 0 }),
  body('templates').optional().isInt({ min: 0 }),
  body('apiRequests').optional().isInt({ min: 0 }),
  handleValidation,
];

// ── Sync entity param ──────────────────────────────────────────────────────────
export const validateSyncEntity = [
  param('entity')
    .toUpperCase()
    .isIn(Object.values(SYNC_ENTITY))
    .withMessage(`entity must be one of: ${Object.values(SYNC_ENTITY).join(', ')}`),
  handleValidation,
];