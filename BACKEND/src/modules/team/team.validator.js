/**
 * Team validators.
 *
 * FILE: src/modules/team/team.validator.js
 * Pattern matches booking.validator.js exactly.
 *
 * SOURCE: FRONTEND_SPEC §17 Add User modal fields:
 *   First Name | Last Name | Email | Role | (optional Password)
 */

import { body, param, validationResult } from 'express-validator';
import { ROLES }                          from '../auth/constants/roles.js';
import { USER_STATUS }                    from '../auth/constants/auth.constants.js';
import { sendError }                      from '../../utils/apiResponse.js';

const ROLE_VALUES = Object.values(ROLES);

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
 * validateAddMember — POST /api/team
 * SOURCE: FRONTEND_SPEC §17 "+ Add User" modal
 * Excludes super_admin — cannot be assigned via team management UI
 */
export const validateAddMember = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('firstName is required')
    .isLength({ max: 50 }).withMessage('firstName cannot exceed 50 characters'),

  body('lastName')
    .trim()
    .notEmpty().withMessage('lastName is required')
    .isLength({ max: 50 }).withMessage('lastName cannot exceed 50 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('email is required')
    .isEmail().withMessage('email must be a valid email address')
    .normalizeEmail(),

  body('role')
    .notEmpty().withMessage('role is required')
    .isIn([ROLES.TENANT_OWNER, ROLES.TENANT_ADMIN, ROLES.SALES_USER, ROLES.READ_ONLY_USER])
    .withMessage(`role must be one of: tenant_owner, tenant_admin, sales_user, read_only_user`),

  handleValidation,
];

/**
 * validateUpdateRole — PATCH /api/team/:id/role
 * SOURCE: FRONTEND_SPEC §17 "inline role change"
 */
export const validateUpdateRole = [
  param('id')
    .isMongoId().withMessage('Member ID must be a valid MongoDB ObjectId'),

  body('role')
    .notEmpty().withMessage('role is required')
    .isIn(ROLE_VALUES)
    .withMessage(`role must be one of: ${ROLE_VALUES.join(', ')}`),

  handleValidation,
];

/**
 * validateSetStatus — PATCH /api/team/:id/status
 * SOURCE: FRONTEND_SPEC §17 "activate/deactivate" button
 */
export const validateSetStatus = [
  param('id')
    .isMongoId().withMessage('Member ID must be a valid MongoDB ObjectId'),

  body('status')
    .notEmpty().withMessage('status is required')
    .isIn(Object.values(USER_STATUS))
    .withMessage(`status must be 'active' or 'inactive'`),

  handleValidation,
];