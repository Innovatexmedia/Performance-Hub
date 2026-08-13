import { body, validationResult } from 'express-validator';
import { sendError } from '../../utils/apiResponse.js';
import { PLAN_TRACK_VALUES, PLAN_TIER_VALUES } from './plan.model.js';

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      'Validation failed',
      422,
      errors.array().map((e) => ({ field: e.path, message: e.msg })),
    );
  }
  next();
};

const limitsRules = [
  body('limits.maxUsers').isInt({ min: 1 }).withMessage('maxUsers must be at least 1'),
  body('limits.maxLeads').isInt({ min: 1 }).withMessage('maxLeads must be at least 1'),
  body('limits.maxCampaigns').isInt({ min: 0 }).withMessage('maxCampaigns must be 0 or more'),
  body('limits.maxWorkspaces').isInt({ min: 1 }).withMessage('maxWorkspaces must be at least 1'),
];

export const validateCreatePlan = [
  body('key').trim().notEmpty().withMessage('key is required')
    .matches(/^[a-z0-9_]+$/).withMessage('key must be lowercase letters/numbers/underscores only'),
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 60 }),
  body('track').isIn(PLAN_TRACK_VALUES).withMessage(`track must be one of: ${PLAN_TRACK_VALUES.join(', ')}`),
  body('tier').isIn(PLAN_TIER_VALUES).withMessage(`tier must be one of: ${PLAN_TIER_VALUES.join(', ')}`),
  body('price').optional().isFloat({ min: 0 }).withMessage('price must be 0 or more'),
  ...limitsRules,
  handleValidation,
];

export const validateUpdatePlan = [
  body('name').optional().trim().notEmpty().isLength({ max: 60 }),
  body('price').optional().isFloat({ min: 0 }).withMessage('price must be 0 or more'),
  body('isActive').optional().isBoolean(),
  body('isDefault').optional().isBoolean(),
  body('sortOrder').optional().isInt(),
  body('limits').optional(),
  body('limits.maxUsers').if(body('limits').exists()).isInt({ min: 1 }),
  body('limits.maxLeads').if(body('limits').exists()).isInt({ min: 1 }),
  body('limits.maxCampaigns').if(body('limits').exists()).isInt({ min: 0 }),
  body('limits.maxWorkspaces').if(body('limits').exists()).isInt({ min: 1 }),
  handleValidation,
];
