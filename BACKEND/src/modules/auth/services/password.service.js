/**
 * =============================================================================
 * InnovateX Revenue OS — Password Service
 * =============================================================================
 *
 * FILE: src/modules/auth/services/password.service.js
 *
 * PURPOSE
 * ───────
 * Forgot password and reset password flows.
 * Coordinates: token generation → email → token validation → password update.
 * =============================================================================
 */

import { generateSecureToken, hashToken } from '../../../utils/crypto.js';
import { hashPassword }                   from '../../../utils/password.js';
import * as tokenRepo                     from '../repositories/token.repository.js';
import * as userRepo                      from '../repositories/user.repository.js';
import { sendPasswordReset }              from './email.service.js';
import { TOKEN_EXPIRY }                   from '../constants/auth.constants.js';
import AppError                           from '../../../utils/AppError.js';

/**
 * requestPasswordReset — initiates the forgot password flow.
 * Creates a hashed reset token, stores it, sends the email.
 * Always returns success (don't reveal if email exists — anti-enumeration).
 *
 * @param {{ email: string, ip: string }}
 */
export const requestPasswordReset = async ({ email, ip }) => {
  const user = await userRepo.findByEmail(email);

  // Anti-enumeration: don't throw if user not found — just return silently
  // to the CALLER (the HTTP response stays identical either way, by
  // design). This console log is server-side only, never sent to the
  // requester -- it exists purely so local testing doesn't look
  // indistinguishable from "the reset flow is broken" when the real
  // explanation is just "that email isn't registered."
  if (!user) {
    console.log(`\n[forgot-password] No account found for "${email}" -- no email sent (this is correct anti-enumeration behavior, not a bug). If you're testing locally, use a real registered email.\n`);
    return;
  }

  // Invalidate any existing unused tokens for this user
  await tokenRepo.invalidateExistingResetTokens(user._id);

  // Generate token
  const plainToken = generateSecureToken(32);
  const expiresAt  = new Date(Date.now() + TOKEN_EXPIRY.PASSWORD_RESET_SECONDS * 1000);

  // Store hashed token
  await tokenRepo.createPasswordResetToken({
    userId:          user._id,
    email:           user.email,
    tokenHash:       hashToken(plainToken),
    expiresAt,
    requestedFromIp: ip ?? null,
  });

  // Send email with plain token
  await sendPasswordReset({
    email:     user.email,
    firstName: user.firstName,
    token:     plainToken,
  });
};

/**
 * resetPassword — validates token and sets new password.
 *
 * @param {{ token: string, newPassword: string }}
 */
export const resetPassword = async ({ token, newPassword }) => {
  // Find token record (hashes internally)
  const tokenRecord = await tokenRepo.findPasswordResetToken(token);
  if (!tokenRecord) {
    throw new AppError('Invalid or expired password reset token', 400);
  }

  // Find user
  const user = await userRepo.findById(tokenRecord.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Hash new password and update
  const hashedPassword = await hashPassword(newPassword);
  await userRepo.updatePassword(user._id, hashedPassword);

  // Mark token as used
  await tokenRepo.markPasswordResetTokenUsed(tokenRecord._id);

  return user;
};