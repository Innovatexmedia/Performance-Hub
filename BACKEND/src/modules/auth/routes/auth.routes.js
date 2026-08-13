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
 * GET    /auth/invitations/:token    — preview an invitation (public)
 * POST   /auth/invitations/:token/accept — accept invitation, set password, log in
 * =============================================================================
 */

import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate, optionalAuthenticate } from '../../../shared/middlewares/auth.middleware.js';
import { requireRole } from '../../../shared/middlewares/role.middleware.js';
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
  validateAcceptInvitation,
  validateUpdateProfile,
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
router.get('/invitations/:token',   authController.getInvitationPreview);
router.post('/invitations/:token/accept', validateAcceptInvitation, authController.acceptInvitation);

// ─── Protected Routes (require valid access token) ───────────────────────────

router.post('/logout',              authenticate, authController.logout);
router.post('/logout-all',          authenticate, authController.logoutAll);
router.get('/sessions',             authenticate, authController.listSessions);
router.delete('/sessions/:sessionId', authenticate, authController.revokeSession);
router.get('/me',                   authenticate, authController.getMe);
router.patch('/profile',            authenticate, validateUpdateProfile, authController.updateProfile);
router.get('/my-workspaces',        authenticate, authController.listMyWorkspaces);
router.post('/workspaces',          authenticate, requireRole('tenant_admin'), authController.createWorkspace);
router.patch('/change-password',    authenticate, validateChangePassword, authController.changePassword);
router.post('/resend-verification', authenticate, authController.resendVerification);

export default router;