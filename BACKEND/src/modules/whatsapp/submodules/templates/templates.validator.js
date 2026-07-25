import { body, param, query, validationResult } from 'express-validator';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import {
  TEMPLATE_CATEGORY_VALUES,
  TEMPLATE_STATUS_VALUES,
  APPROVAL_STATUS_VALUES,
  PROVIDER_VALUES,
  PROVIDER_STATUS_VALUES,
  HEADER_TYPE_VALUES,
  BUTTON_TYPE_VALUES,
  MAX_BUTTONS,
  MAX_BODY_LENGTH,
  MAX_FOOTER_LENGTH,
  MAX_LIMIT,
} from './templates.constants.js';

export const handleValidation = (req, _res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.path ?? e.param, message: e.msg }));
    return next(new AppError(400, 'Validation failed', details));
  }
  next();
};

const idParam = param('id').isMongoId().withMessage('Invalid template id');

const buttonsRule = body('buttons').optional().isArray({ max: MAX_BUTTONS })
  .withMessage(`buttons must be an array of at most ${MAX_BUTTONS}`)
  .bail()
  .custom((buttons) => {
    for (const btn of buttons) {
      if (!btn || !BUTTON_TYPE_VALUES.includes(btn.type)) {
        throw new Error('each button needs a valid type');
      }
      if (!btn.text || !String(btn.text).trim()) {
        throw new Error('each button needs text');
      }
    }
    return true;
  });

const headerTypeRule = body('header.type').optional().isIn(HEADER_TYPE_VALUES)
  .withMessage('Invalid header type');

// NOTE: `approvalStatus` is deliberately NOT a validated/accepted body
// field on create or update anymore. It is never settable by a client --
// every template starts at DRAFT on create, and every later transition
// goes exclusively through the Template Approval workflow's own
// role-gated, transition-validated endpoints (submit-review / approve /
// reject / request-changes / submit-provider). templates.service.js now
// 400s if `approvalStatus` shows up in a generic PATCH body; this
// validator matches that by never accepting it in the first place.
// APPROVAL_STATUS_VALUES is still imported/exported here for any other
// consumer that needs the canonical enum (e.g. listing/filtering).
export { APPROVAL_STATUS_VALUES };

export const validateCreateTemplate = [
  body('name').trim().notEmpty().withMessage('name is required'),
  body('category').notEmpty().withMessage('category is required')
    .bail().isIn(TEMPLATE_CATEGORY_VALUES).withMessage('Invalid category'),
  body('languageCode').trim().notEmpty().withMessage('languageCode is required'),
  body('body').notEmpty().withMessage('body is required')
    .bail().isLength({ max: MAX_BODY_LENGTH }).withMessage(`body exceeds ${MAX_BODY_LENGTH} characters`),
  body('footer').optional().isLength({ max: MAX_FOOTER_LENGTH }).withMessage(`footer exceeds ${MAX_FOOTER_LENGTH} characters`),
  body('status').optional().isIn(TEMPLATE_STATUS_VALUES).withMessage('Invalid status'),
  body('provider').optional().isIn(PROVIDER_VALUES).withMessage('Invalid provider'),
  body('providerMetadata.providerStatus').optional().isIn(PROVIDER_STATUS_VALUES).withMessage('Invalid provider status'),
  headerTypeRule,
  buttonsRule,
  handleValidation,
];

export const validateUpdateTemplate = [
  idParam,
  body('name').optional().trim().notEmpty().withMessage('name cannot be empty'),
  body('category').optional().isIn(TEMPLATE_CATEGORY_VALUES).withMessage('Invalid category'),
  body('languageCode').optional().trim().notEmpty().withMessage('languageCode cannot be empty'),
  body('body').optional().isLength({ max: MAX_BODY_LENGTH }).withMessage(`body exceeds ${MAX_BODY_LENGTH} characters`),
  body('footer').optional().isLength({ max: MAX_FOOTER_LENGTH }).withMessage(`footer exceeds ${MAX_FOOTER_LENGTH} characters`),
  body('status').optional().isIn(TEMPLATE_STATUS_VALUES).withMessage('Invalid status'),
  body('provider').optional().isIn(PROVIDER_VALUES).withMessage('Invalid provider'),
  body('providerMetadata.providerStatus').optional().isIn(PROVIDER_STATUS_VALUES).withMessage('Invalid provider status'),
  headerTypeRule,
  buttonsRule,
  handleValidation,
];

export const validateIdParam = [idParam, handleValidation];

export const validatePreview = [
  idParam,
  body('variables').optional().isObject().withMessage('variables must be an object'),
  handleValidation,
];

export const validateListTemplates = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).toInt(),
  query('category').optional().isIn(TEMPLATE_CATEGORY_VALUES).withMessage('Invalid category'),
  query('status').optional().isIn(TEMPLATE_STATUS_VALUES).withMessage('Invalid status'),
  query('approvalStatus').optional().isIn(APPROVAL_STATUS_VALUES).withMessage('Invalid approvalStatus'),
  query('provider').optional().isIn(PROVIDER_VALUES).withMessage('Invalid provider'),
  query('providerStatus').optional().isIn(PROVIDER_STATUS_VALUES).withMessage('Invalid provider status'),
  query('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  handleValidation,
];