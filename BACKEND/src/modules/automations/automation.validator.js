/**
 * Automation validators.
 * Pattern matches call.validator.js / booking.validator.js exactly.
 */

import { body, param, query, validationResult } from 'express-validator';
import { sendError } from '../../utils/apiResponse.js';
import {
  TRIGGER_TYPE_VALUES,
  CONDITION_OPERATOR_VALUES,
  ACTION_TYPE_VALUES,
  AUTOMATION_STATUS_VALUES,
} from './automation.constants.js';

/** Collect express-validator errors and return 422. */
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

/**
 * validateCreateAutomation — POST /api/automations
 * SOURCE: DEVELOPER_HANDOFF.md §6 Automation entity.
 */
export const validateCreateAutomation = [
  body('name')
    .notEmpty().withMessage('name is required')
    .isLength({ max: 100 }).withMessage('name cannot exceed 100 characters'),

  body('description')
    .optional()
    .isString(),

  body('trigger')
    .notEmpty().withMessage('trigger is required')
    .isObject().withMessage('trigger must be an object'),

  body('trigger.type')
    .notEmpty().withMessage('trigger.type is required')
    .isIn(TRIGGER_TYPE_VALUES)
    .withMessage('trigger.type must be one of: ' + TRIGGER_TYPE_VALUES.join(', ')),

  body('condition')
    .optional()
    .isObject().withMessage('condition must be an object'),

  body('condition.operator')
    .optional({ nullable: true })
    .isIn(CONDITION_OPERATOR_VALUES)
    .withMessage('condition.operator must be one of: ' + CONDITION_OPERATOR_VALUES.join(', ')),

  body('action')
    .notEmpty().withMessage('action is required')
    .isObject().withMessage('action must be an object'),

  body('action.type')
    .notEmpty().withMessage('action.type is required')
    .isIn(ACTION_TYPE_VALUES)
    .withMessage('action.type must be one of: ' + ACTION_TYPE_VALUES.join(', ')),

  handleValidation,
];

/**
 * validateUpdateAutomation — PATCH /api/automations/:id
 * All fields optional for partial update.
 */
// NOTE: validateUpdateAutomation was removed along with the PATCH /:id
// route -- update is not in spec's action list for this module (see
// automation.routes.js header comment for the full explanation).

/**
 * validateListQuery — GET /api/automations
 */
export const validateListQuery = [
  query('status')
    .optional()
    .isIn(AUTOMATION_STATUS_VALUES)
    .withMessage('status must be one of: ' + AUTOMATION_STATUS_VALUES.join(', ')),

  query('trigger')
    .optional()
    .isIn(TRIGGER_TYPE_VALUES)
    .withMessage('Invalid trigger filter'),

  query('search')
    .optional()
    .isString(),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('page must be >= 1'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),

  handleValidation,
];

/**
 * validateIdParam — routes with only an :id param.
 */
export const validateIdParam = [
  param('id').isMongoId().withMessage('Automation ID must be a valid MongoDB ObjectId'),
  handleValidation,
];

/**
 * validateSimulate — POST /api/automations/:id/simulate
 * leadId is optional context for condition evaluation.
 */
export const validateSimulate = [
  param('id').isMongoId().withMessage('Automation ID must be a valid MongoDB ObjectId'),

  body('leadId')
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId().withMessage('leadId must be a valid MongoDB ObjectId'),

  body('context')
    .optional()
    .isObject().withMessage('context must be an object'),

  handleValidation,
];