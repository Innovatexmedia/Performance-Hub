/**
 * Super Admin validators.
 * FILE: src/modules/superAdmin/superAdmin.validator.js
 * Pattern matches team.validator.js exactly.
 */

import { body, validationResult } from 'express-validator';
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

export const validateCreateTenant = [
  body('workspaceName')
    .trim()
    .notEmpty().withMessage('workspaceName is required')
    .isLength({ min: 2, max: 100 }).withMessage('workspaceName must be between 2 and 100 characters'),

  body('ownerFirstName')
    .trim()
    .notEmpty().withMessage('ownerFirstName is required'),

  body('ownerLastName')
    .trim()
    .notEmpty().withMessage('ownerLastName is required'),

  body('ownerEmail')
    .trim()
    .notEmpty().withMessage('ownerEmail is required')
    .isEmail().withMessage('ownerEmail must be a valid email address')
    .normalizeEmail(),

  body('ownerPassword')
    .notEmpty().withMessage('ownerPassword is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  body('planId')
    .optional()
    .isMongoId().withMessage('planId must be a valid plan ID'),

  handleValidation,
];

export const validateUpdateTenant = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('planId').optional().isMongoId().withMessage('planId must be a valid plan ID'),
  body('maxUsers').optional().isInt({ min: 1 }),
  body('maxLeads').optional().isInt({ min: 1 }),
  body('maxCampaigns').optional().isInt({ min: 1 }),
  body('maxWorkspaces').optional().isInt({ min: 1 }),
  body('mrr').optional().isFloat({ min: 0 }),

  handleValidation,
];