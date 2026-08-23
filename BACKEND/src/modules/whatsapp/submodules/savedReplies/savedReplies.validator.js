import { body, param, validationResult } from 'express-validator';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';

export const handleValidation = (req, _res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.path ?? e.param, message: e.msg }));
    return next(new AppError(400, 'Validation failed', details));
  }
  next();
};

const idParam = param('id').isMongoId().withMessage('Invalid saved reply id');

export const validateCreate = [
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 80 }).withMessage('title must be 80 characters or fewer'),
  body('content').trim().notEmpty().withMessage('content is required').isLength({ max: 4000 }).withMessage('content must be 4000 characters or fewer'),
  handleValidation,
];

export const validateUpdate = [
  idParam,
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 80 }).withMessage('title must be 80 characters or fewer'),
  body('content').trim().notEmpty().withMessage('content is required').isLength({ max: 4000 }).withMessage('content must be 4000 characters or fewer'),
  handleValidation,
];

export const validateIdParam = [idParam, handleValidation];