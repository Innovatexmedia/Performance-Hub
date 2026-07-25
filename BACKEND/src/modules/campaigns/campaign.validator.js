/**
 * Campaign validators.
 *
 * FILE: src/modules/campaigns/campaign.validator.js
 * Pattern matches booking.validator.js and call.validator.js exactly.
 *
 * SOURCE: FRONTEND_SPEC §12 New Campaign modal fields:
 *   Campaign Name | Source | Type | Medium | Budget
 */

import { body, query, validationResult } from 'express-validator';
import {
  CAMPAIGN_STATUS_VALUES,
  CAMPAIGN_TYPE_VALUES,
  CAMPAIGN_SOURCE_VALUES,
  CAMPAIGN_MEDIUM_VALUES,
} from './campaign.constants.js';
import { sendError } from '../../utils/apiResponse.js';

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

// =============================================================================
// CREATE CAMPAIGN — POST /api/campaigns
// =============================================================================

/**
 * validateCreateCampaign — New Campaign modal form fields.
 * SOURCE: FRONTEND_SPEC §12 modal:
 *   CAMPAIGN NAME | SOURCE | TYPE | MEDIUM | BUDGET (USD)
 */
export const validateCreateCampaign = [
  body('campaign_name')
    .trim()
    .notEmpty().withMessage('campaign_name is required')
    .isLength({ max: 100 }).withMessage('campaign_name cannot exceed 100 characters')
    .matches(/^[a-zA-Z0-9_\-\s]+$/)
    .withMessage('campaign_name can only contain letters, numbers, underscores, hyphens, and spaces'),

  body('source')
    .notEmpty().withMessage('source is required')
    .isIn(CAMPAIGN_SOURCE_VALUES)
    .withMessage(`source must be one of: ${CAMPAIGN_SOURCE_VALUES.join(', ')}`),

  body('campaign_type')
    .notEmpty().withMessage('campaign_type is required')
    .isIn(CAMPAIGN_TYPE_VALUES)
    .withMessage(`campaign_type must be one of: ${CAMPAIGN_TYPE_VALUES.join(', ')}`),

  body('medium')
    .optional()
    .isIn(CAMPAIGN_MEDIUM_VALUES)
    .withMessage(`medium must be one of: ${CAMPAIGN_MEDIUM_VALUES.join(', ')}`),

  body('budget')
    .optional()
    .isFloat({ min: 0 }).withMessage('budget must be a non-negative number'),

  body('spend')
    .optional()
    .isFloat({ min: 0 }).withMessage('spend must be a non-negative number'),

  body('revenue')
    .optional()
    .isFloat({ min: 0 }).withMessage('revenue must be a non-negative number'),

  body('leads_generated')
    .optional()
    .isInt({ min: 0 }).withMessage('leads_generated must be a non-negative integer'),

  body('bookings')
    .optional()
    .isInt({ min: 0 }).withMessage('bookings must be a non-negative integer'),

  body('status')
    .optional()
    .isIn(CAMPAIGN_STATUS_VALUES)
    .withMessage(`status must be one of: ${CAMPAIGN_STATUS_VALUES.join(', ')}`),

  body('start_date')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('start_date must be a valid date (YYYY-MM-DD)'),

  body('end_date')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('end_date must be a valid date (YYYY-MM-DD)'),

  handleValidation,
];

// =============================================================================
// UPDATE CAMPAIGN — PATCH /api/campaigns/:id
// =============================================================================

// NOTE: validateUpdateCampaign was removed along with the PATCH /:id route
// -- update is not in spec's action list for this module (see routes.js
// header comment for the full explanation).

// =============================================================================
// LIST QUERY — GET /api/campaigns
// =============================================================================

export const validateListQuery = [
  query('status')
    .optional()
    .isIn(CAMPAIGN_STATUS_VALUES)
    .withMessage('Invalid status filter'),

  query('source')
    .optional()
    .isIn(CAMPAIGN_SOURCE_VALUES)
    .withMessage('Invalid source filter'),

  query('campaign_type')
    .optional()
    .isIn(CAMPAIGN_TYPE_VALUES)
    .withMessage('Invalid campaign_type filter'),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('page must be >= 1'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),

  handleValidation,
];