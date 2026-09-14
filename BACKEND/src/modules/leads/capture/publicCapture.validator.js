/**
 * Public Lead Capture — validator (express-validator).
 * FILE: src/modules/leads/capture/publicCapture.validator.js
 */
import { body, param, validationResult } from 'express-validator';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

const handleValidation = (req, _res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.path ?? e.param, message: e.msg }));
    return next(new AppError(400, 'Validation failed', details));
  }
  next();
};

export const validateCapture = [
  param('tenantId').isMongoId().withMessage('Invalid form link'),
  body('name').optional().isString().trim().isLength({ max: 200 }),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email').normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 30 }),
  body('company').optional().isString().trim().isLength({ max: 200 }),
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
  body('segment').optional().isString().trim().isLength({ max: 100 }),
  // Real attribution fields -- format-validated only (bounded length, no
  // enum) since a tenant's own ad campaigns/UTM tagging can legitimately
  // use any value here; the business meaning of these is a free-text
  // real-world label (a campaign name, a UTM tag), not a closed set.
  body(['source', 'medium', 'campaign', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'])
    .optional().isString().trim().isLength({ max: 200 }),
  // Real ad-group/ad-set, ad, and click identifiers -- automatically
  // filled in by Google Ads ValueTrack / Meta's dynamic URL macros, not
  // typed by a person, but still real user-controllable input arriving
  // over a public, unauthenticated endpoint -- format-validated the
  // same as every other attribution field above.
  body(['ad_group_id', 'ad_id', 'click_id'])
    .optional().isString().trim().isLength({ max: 200 }),
  handleValidation,
];
