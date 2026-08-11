/**
 * Settings validators.
 *
 * FILE: src/modules/settings/settings.validator.js
 * Pattern matches booking.validator.js exactly.
 */

import { body, validationResult } from 'express-validator';
import { ACCENT_COLORS }          from './settings.constants.js';
import { sendError }              from '../../utils/apiResponse.js';

export const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      'Validation failed',
      422,
      errors.array().map((e) => ({ field: e.path, message: e.msg }))
    );
  }
  next();
};

/** validateCompany — PATCH /api/settings/company */
export const validateCompany = [
  body('company_name')
    .optional()
    .trim()
    .notEmpty().withMessage('company_name cannot be empty')
    .isLength({ max: 100 }).withMessage('company_name cannot exceed 100 characters'),

  body('company_website')
    .optional({ nullable: true, checkFalsy: true })
    .isURL({ require_protocol: false }).withMessage('company_website must be a valid URL'),

  body('description')
    .optional()
    .isLength({ max: 500 }).withMessage('description cannot exceed 500 characters'),

  handleValidation,
];

/** validateBranding — PATCH /api/settings/branding */
export const validateBranding = [
  body('accent_color')
    .optional()
    .isHexColor().withMessage('accent_color must be a valid hex color (e.g. #6366f1)'),

  body('primary_color')
    .optional()
    .isHexColor().withMessage('primary_color must be a valid hex color'),

  body('logo_url')
    .optional({ nullable: true, checkFalsy: true })
    .isURL().withMessage('logo_url must be a valid URL'),

  handleValidation,
];

/** validateLeadFields — PATCH /api/settings/lead-fields */
export const validateLeadFields = [
  body('required')
    .notEmpty().withMessage('required array is required')
    .isArray({ min: 1 }).withMessage('At least one field must be required'),

  body('required.*')
    .isString().withMessage('Each field must be a string'),

  handleValidation,
];

/** validatePipelineStages — PATCH /api/settings/pipeline-stages */
export const validatePipelineStages = [
  body('stages')
    .notEmpty().withMessage('stages array is required')
    .isArray({ min: 9, max: 9 }).withMessage('stages must contain exactly 9 items'),

  body('stages.*.key')
    .isString().withMessage('Each stage needs its fixed key'),

  body('stages.*.name')
    .isString().trim()
    .notEmpty().withMessage('Each stage needs a label')
    .isLength({ max: 40 }).withMessage('Stage label cannot exceed 40 characters'),

  body('stages.*.color')
    .isHexColor().withMessage('Each stage needs a valid hex color'),

  handleValidation,
];

/** validateQualification — PATCH /api/settings/qualification */
export const validateQualification = [
  body('questions')
    .notEmpty().withMessage('questions array is required')
    .isArray({ min: 1 }).withMessage('At least one question is required'),

  body('questions.*')
    .isString().withMessage('Each question must be a string')
    .trim()
    .notEmpty().withMessage('Questions cannot be empty')
    .isLength({ max: 500 }).withMessage('Each question cannot exceed 500 characters'),

  handleValidation,
];

/** validateScoringRules — PATCH /api/settings/scoring-rules */
export const validateScoringRules = [
  body('rules')
    .notEmpty().withMessage('rules array is required')
    .isArray({ min: 1 }).withMessage('At least one scoring rule is required'),

  body('rules.*.factor')
    .notEmpty().withMessage('Each rule must have a factor')
    .isString()
    .isLength({ max: 100 }).withMessage('Factor name cannot exceed 100 characters'),

  body('rules.*.weight')
    .notEmpty().withMessage('Each rule must have a weight')
    .isFloat({ min: 0, max: 100 }).withMessage('Each weight must be between 0 and 100'),

  handleValidation,
];

/** validateNotifications — PATCH /api/settings/notifications */
export const validateNotifications = [
  body('hot_lead_alert')
    .optional().isBoolean().withMessage('hot_lead_alert must be true or false'),
  body('booking_created')
    .optional().isBoolean().withMessage('booking_created must be true or false'),
  body('payment_received')
    .optional().isBoolean().withMessage('payment_received must be true or false'),
  body('template_approved')
    .optional().isBoolean().withMessage('template_approved must be true or false'),
  body('campaign_sent')
    .optional().isBoolean().withMessage('campaign_sent must be true or false'),
  body('deal_won')
    .optional().isBoolean().withMessage('deal_won must be true or false'),
  body('deal_lost')
    .optional().isBoolean().withMessage('deal_lost must be true or false'),

  handleValidation,
];

/** validateConsent — PATCH /api/settings/consent */
export const validateConsent = [
  body('consent_required')
    .optional().isBoolean().withMessage('consent_required must be true or false'),

  body('data_retention_days')
    .optional()
    .isInt({ min: 30, max: 3650 })
    .withMessage('data_retention_days must be between 30 and 3650'),

  body('opt_out_keywords')
    .optional()
    .isArray().withMessage('opt_out_keywords must be an array'),

  body('opt_out_keywords.*')
    .optional()
    .isString()
    .isLength({ max: 50 }).withMessage('Each keyword cannot exceed 50 characters'),

  handleValidation,
];

/** validateSecurity — PATCH /api/settings/security */
export const validateSecurity = [
  body('two_factor_auth')
    .optional().isBoolean().withMessage('two_factor_auth must be true or false'),
  body('ip_allowlist_enabled')
    .optional().isBoolean().withMessage('ip_allowlist_enabled must be true or false'),
  body('ip_allowlist')
    .optional().isArray().withMessage('ip_allowlist must be an array'),
  body('ip_allowlist.*')
    .optional()
    .isIP().withMessage('Each IP address must be a valid IPv4 or IPv6 address'),
  body('session_timeout_minutes')
    .optional()
    .isInt({ min: 15, max: 10080 })
    .withMessage('session_timeout_minutes must be between 15 and 10080'),

  handleValidation,
];