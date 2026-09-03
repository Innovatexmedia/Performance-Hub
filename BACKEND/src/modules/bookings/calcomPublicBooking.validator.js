import { param, query, body, validationResult } from 'express-validator';
import { sendError } from '../../utils/apiResponse.js';

const handleValidation = (req, res, next) => {
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

export const validateTenantParam = [
  param('tenantId').isMongoId().withMessage('Invalid workspace link'),
  handleValidation,
];

export const validateGetSlots = [
  param('tenantId').isMongoId().withMessage('Invalid workspace link'),
  query('eventTypeId').notEmpty().withMessage('eventTypeId is required'),
  query('start').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('start must be YYYY-MM-DD'),
  query('end').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('end must be YYYY-MM-DD'),
  query('timeZone').optional().isString(),
  handleValidation,
];

export const validateCreateBooking = [
  param('tenantId').isMongoId().withMessage('Invalid workspace link'),
  body('eventTypeId').notEmpty().withMessage('eventTypeId is required'),
  body('start').isISO8601().withMessage('start must be a valid ISO 8601 datetime'),
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 200 }),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('timeZone').optional().isString(),
  handleValidation,
];
