import { body, param, validationResult } from 'express-validator';
import { ROLES }                  from '../constants/roles.js';
import { sendError }              from '../../../utils/apiResponse.js';

// =============================================================================
// VALIDATION ERROR HANDLER
// =============================================================================

/**
 * handleValidation — placed LAST in every validator array.
 * Collects all validation errors and returns a 422 response if any exist.
 */
export const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      'Validation failed',
      422,
      errors.array().map((e) => ({
        field:   e.path,
        message: e.msg,
      }))
    );
  }
  next();
};

// =============================================================================
// REGISTER VALIDATOR
// =============================================================================

export const validateRegister = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required')
    .isLength({ max: 50 }).withMessage('First name cannot exceed 50 characters'),

  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ max: 50 }).withMessage('Last name cannot exceed 50 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  /**
   * role — only tenant_owner (self-registration, default) or super_admin
   * (requires superAdminSecret, see below) can be created through this
   * public endpoint. tenant_admin/sales_user/read_only_user were removed
   * from the allowed set here on purpose -- SECURITY: this endpoint used
   * to accept any of the 5 roles including those, with only a bare
   * tenantId as a "check" (no real invitation verification at all). The
   * real, secure way to add those roles is team.service.js's
   * addTeamMember(), which requires the caller to already be
   * authenticated as tenant_admin+ on that specific tenant.
   */
  body('role')
    .optional()
    .isIn([ROLES.TENANT_OWNER, ROLES.SUPER_ADMIN])
    .withMessage(`This endpoint can only register a ${ROLES.TENANT_OWNER} or ${ROLES.SUPER_ADMIN}. Other roles must be added via the Team page by an existing tenant admin or owner.`),

  /**
   * workspaceName — required when role is tenant_owner.
   * The service also validates this, but we validate here for a clean
   * 422 response before the request reaches service layer.
   */
  body('workspaceName')
    .if(body('role').equals(ROLES.TENANT_OWNER))
    .trim()
    .notEmpty().withMessage('workspaceName is required when registering as a tenant owner')
    .isLength({ min: 2, max: 100 })
    .withMessage('workspaceName must be between 2 and 100 characters'),

  /**
   * superAdminSecret — required when role is super_admin. SECURITY: this
   * is the ONLY thing standing between the public internet and creating
   * a full-platform-access account -- see auth.service.js's register()
   * for the real check against config.SUPER_ADMIN_SECRET.
   */
  body('superAdminSecret')
    .if(body('role').equals(ROLES.SUPER_ADMIN))
    .notEmpty().withMessage('superAdminSecret is required when registering as a super admin'),

  handleValidation,
];

// =============================================================================
// LOGIN VALIDATOR
// =============================================================================

export const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required'),

  handleValidation,
];

// =============================================================================
// FORGOT PASSWORD VALIDATOR
// =============================================================================

export const validateForgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  handleValidation,
];

// =============================================================================
// RESET PASSWORD VALIDATOR
// =============================================================================

export const validateResetPassword = [
  body('token')
    .trim()
    .notEmpty().withMessage('Reset token is required'),

  body('password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  handleValidation,
];

/**
 * validateResetPasswordWithOtp -- real 6-digit format check
 * (isNumeric + isLength) so a genuinely malformed OTP is rejected here,
 * at the validator layer, before ever reaching the real hashed
 * per-record comparison (and its attempt-limit counter) in
 * password.service.js -- an obviously-wrong submission shouldn't burn
 * one of the limited real attempts.
 */
export const validateResetPasswordWithOtp = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('otp')
    .trim()
    .notEmpty().withMessage('Verification code is required')
    .isNumeric().withMessage('Verification code must be numeric')
    .isLength({ min: 6, max: 6 }).withMessage('Verification code must be 6 digits'),

  body('password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  handleValidation,
];

// =============================================================================
// ACCEPT INVITATION VALIDATOR
// =============================================================================

export const validateAcceptInvitation = [
  param('token')
    .trim()
    .notEmpty().withMessage('Invitation token is required'),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  handleValidation,
];

// =============================================================================
// CHANGE PASSWORD VALIDATOR
// =============================================================================

export const validateChangePassword = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),

  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .custom((val, { req }) => {
      if (val === req.body.currentPassword) {
        throw new Error('New password must be different from your current password');
      }
      return true;
    }),

  handleValidation,
];

// =============================================================================
// UPDATE PROFILE VALIDATOR
// =============================================================================

export const validateUpdateProfile = [
  body('firstName')
    .optional()
    .trim()
    .notEmpty().withMessage('First name cannot be empty')
    .isLength({ max: 50 }).withMessage('First name cannot exceed 50 characters'),

  body('lastName')
    .optional()
    .trim()
    .notEmpty().withMessage('Last name cannot be empty')
    .isLength({ max: 50 }).withMessage('Last name cannot exceed 50 characters'),

  body('phoneNumber')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20 }).withMessage('Phone number is too long'),

  body('profileImage')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isURL().withMessage('profileImage must be a valid URL'),

  handleValidation,
];

// =============================================================================
// VERIFY EMAIL VALIDATOR
// =============================================================================

export const validateVerifyEmail = [
  body('token')
    .trim()
    .notEmpty().withMessage('Verification token is required'),

  handleValidation,
];

/**
 * validateVerifyEmailWithOtp -- same real format-check-before-hashing
 * reasoning as validateResetPasswordWithOtp above.
 */
export const validateVerifyEmailWithOtp = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('otp')
    .trim()
    .notEmpty().withMessage('Verification code is required')
    .isNumeric().withMessage('Verification code must be numeric')
    .isLength({ min: 6, max: 6 }).withMessage('Verification code must be 6 digits'),

  handleValidation,
];