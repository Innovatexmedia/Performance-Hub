/**
 * =============================================================================
 * InnovateX Revenue OS — Auth Routes
 * =============================================================================
 *
 * FILE: src/modules/auth/routes/auth.routes.js
 *
 * ROUTES
 * ──────
 * POST   /auth/register              — create account
 * POST   /auth/login                 — login
 * POST   /auth/logout                — logout (revoke session)
 * POST   /auth/refresh               — refresh access token
 * GET    /auth/me                    — get current user (protected)
 * PATCH  /auth/change-password       — change password (protected)
 * POST   /auth/forgot-password       — initiate password reset
 * POST   /auth/reset-password        — complete password reset
 * POST   /auth/verify-email          — verify email with token
 * POST   /auth/resend-verification   — resend verification email (protected)
 * =============================================================================
 */

import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate, optionalAuthenticate } from '../../../shared/middlewares/auth.middleware.js';
import {
  loginRateLimit,
  forgotPasswordRateLimit,
} from '../../../shared/middlewares/rateLimit.middleware.js';
import {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateVerifyEmail,
} from '../validators/auth.validator.js';

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

router.post('/register',            validateRegister,       authController.register);
router.post('/login',               loginRateLimit, validateLogin, authController.login);
router.post('/refresh',             authController.refresh);
router.post('/forgot-password',     forgotPasswordRateLimit, validateForgotPassword, authController.forgotPassword);
router.post('/reset-password',      validateResetPassword,  authController.resetPassword);
router.post('/verify-email',        validateVerifyEmail,    authController.verifyEmail);
router.post('/switch-workspace',    optionalAuthenticate, authController.switchWorkspace);

// ─── Protected Routes (require valid access token) ───────────────────────────

router.post('/logout',              authenticate, authController.logout);
router.get('/me',                   authenticate, authController.getMe);
router.get('/my-workspaces',        authenticate, authController.listMyWorkspaces);
router.patch('/change-password',    authenticate, validateChangePassword, authController.changePassword);
router.post('/resend-verification', authenticate, authController.resendVerification);

export default router;