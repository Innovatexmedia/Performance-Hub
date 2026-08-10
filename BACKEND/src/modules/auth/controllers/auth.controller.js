/**
 * =============================================================================
 * InnovateX Revenue OS — Auth Controller
 * =============================================================================
 *
 * FILE: src/modules/auth/controllers/auth.controller.js
 *
 * PURPOSE
 * ───────
 * Thin HTTP layer only. Extracts data from req, calls service, sends response.
 * Contains NO business logic — all logic lives in auth.service.js.
 *
 * HOW IT FITS
 * ───────────
 * auth.routes.js → validators → auth.controller.js → auth.service.js
 * =============================================================================
 */

import * as authService     from '../services/auth.service.js';
import * as passwordService from '../services/password.service.js';
import * as invitationService from '../services/invitation.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../../utils/apiResponse.js';
import { setRefreshTokenCookie, clearRefreshTokenCookie, getRefreshTokenFromCookies } from '../../../utils/cookies.js';
import asyncHandler from '../../../utils/asyncHandler.js';

/**
 * register — POST /auth/register
 */
export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);

  setRefreshTokenCookie(res, result.refreshToken);

  return sendCreated(res, {
    user:        result.user,
    accessToken: result.accessToken,
  }, 'Account created successfully. Please verify your email.');
});

/**
 * login — POST /auth/login
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password }, req);

  // Multi-workspace case: no tokens issued yet, nothing to set a cookie
  // from -- the client shows a workspace picker and calls switchWorkspace
  // once one is chosen. Every existing single-workspace account never
  // reaches this branch at all (see auth.service.js login()'s comment).
  if (result.requiresWorkspaceSelection) {
    return sendSuccess(res, {
      requiresWorkspaceSelection: true,
      selectionToken: result.selectionToken,
      user: result.user,
      workspaces: result.workspaces,
    }, 'Multiple workspaces found -- please select one');
  }

  setRefreshTokenCookie(res, result.refreshToken);

  return sendSuccess(res, {
    user:        result.user,
    accessToken: result.accessToken,
  }, 'Login successful');
});

/**
 * switchWorkspace — POST /auth/switch-workspace
 */
export const switchWorkspace = asyncHandler(async (req, res) => {
  const { selectionToken, tenantId } = req.body;
  const result = await authService.switchWorkspace({ selectionToken, tenantId }, req);

  setRefreshTokenCookie(res, result.refreshToken);

  return sendSuccess(res, {
    user:        result.user,
    accessToken: result.accessToken,
  }, 'Workspace switched');
});

/**
 * listMyWorkspaces — GET /auth/my-workspaces
 * Every workspace the currently authenticated user belongs to -- for
 * rendering the workspace switcher dropdown any time, not just at login.
 */
export const listMyWorkspaces = asyncHandler(async (req, res) => {
  const workspaces = await authService.listMyWorkspaces(req.user.sub);
  return sendSuccess(res, { workspaces }, 'Workspaces retrieved');
});

/**
 * logout — POST /auth/logout
 */
export const logout = asyncHandler(async (req, res) => {
  const refreshToken = getRefreshTokenFromCookies(req);
  await authService.logout(refreshToken, req);
  clearRefreshTokenCookie(res);
  return sendNoContent(res);
});

/**
 * logoutAll — POST /auth/logout-all
 * Revokes every active session for the requesting user.
 */
export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req);
  clearRefreshTokenCookie(res);
  return sendNoContent(res);
});

/**
 * listSessions — GET /auth/sessions
 */
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions(req);
  return sendSuccess(res, { sessions }, 'Active sessions retrieved');
});

/**
 * revokeSession — DELETE /auth/sessions/:sessionId
 * Logs out one specific OTHER session (device) from the list.
 */
export const revokeSession = asyncHandler(async (req, res) => {
  await authService.revokeUserSession(req, req.params.sessionId);
  return sendSuccess(res, null, 'Session logged out');
});

/**
 * refresh — POST /auth/refresh
 * Reads refresh token from HttpOnly cookie, issues new token pair.
 */
export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = getRefreshTokenFromCookies(req);
  const result = await authService.refreshTokens(refreshToken, req);

  setRefreshTokenCookie(res, result.refreshToken);

  return sendSuccess(res, {
    user:        result.user,
    accessToken: result.accessToken,
  }, 'Token refreshed successfully');
});

/**
 * getMe — GET /auth/me
 * Returns the authenticated user's profile.
 */
export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.sub);
  return sendSuccess(res, { user }, 'Profile fetched successfully');
});

/**
 * updateProfile — PATCH /auth/profile
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNumber, profileImage } = req.body;
  const user = await authService.updateProfile(req.user.sub, { firstName, lastName, phoneNumber, profileImage });
  return sendSuccess(res, { user }, 'Profile updated successfully');
});

/**
 * changePassword — PATCH /auth/change-password
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword({
    userId: req.user.sub,
    currentPassword,
    newPassword,
  }, req);

  clearRefreshTokenCookie(res);
  return sendSuccess(res, null, 'Password changed successfully. Please log in again.');
});

/**
 * forgotPassword — POST /auth/forgot-password
 * Always returns 200 (anti-enumeration — don't reveal if email exists).
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  await passwordService.requestPasswordReset({
    email: req.body.email,
    ip:    req.ip,
  });
  return sendSuccess(res, null,
    'If that email exists, you will receive a password reset link shortly.'
  );
});

/**
 * resetPassword — POST /auth/reset-password
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  await passwordService.resetPassword({ token, newPassword: password });
  return sendSuccess(res, null, 'Password reset successfully. Please log in with your new password.');
});

/**
 * getInvitationPreview — GET /auth/invitations/:token
 * Public, read-only -- lets the Accept Invitation page show who invited
 * them and to which workspace/role before they set a password.
 */
export const getInvitationPreview = asyncHandler(async (req, res) => {
  const preview = await invitationService.getInvitationPreview(req.params.token);
  return sendSuccess(res, preview, 'Invitation is valid');
});

/**
 * acceptInvitation — POST /auth/invitations/:token/accept
 * Public -- sets the real password, activates the account, and logs the
 * person straight in (same as register()'s flow).
 */
export const acceptInvitation = asyncHandler(async (req, res) => {
  const result = await invitationService.acceptInvitation(
    { token: req.params.token, password: req.body.password },
    req
  );

  setRefreshTokenCookie(res, result.refreshToken);

  return sendSuccess(res, {
    user:        result.user,
    accessToken: result.accessToken,
  }, 'Invitation accepted -- welcome!');
});

/**
 * verifyEmail — POST /auth/verify-email
 */
export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.body.token);
  return sendSuccess(res, { user }, 'Email verified successfully. Welcome to InnovateX!');
});

/**
 * resendVerification — POST /auth/resend-verification
 */
export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerificationEmail(req.user.sub);
  return sendSuccess(res, null, 'Verification email sent. Please check your inbox.');
});