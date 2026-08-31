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

import { generateSecureToken, hashToken, generateOTP } from '../../../utils/crypto.js';
import { hashPassword }                   from '../../../utils/password.js';
import * as tokenRepo                     from '../repositories/token.repository.js';
import * as userRepo                      from '../repositories/user.repository.js';
import { sendPasswordReset }              from './email.service.js';
import { TOKEN_EXPIRY, RATE_LIMITS }      from '../constants/auth.constants.js';
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

  // Generate token + real OTP -- same document, same real reasoning as
  // auth.service.js's issueVerificationEmail.
  const plainToken = generateSecureToken(32);
  const otp        = generateOTP(6);
  const expiresAt  = new Date(Date.now() + TOKEN_EXPIRY.PASSWORD_RESET_SECONDS * 1000);

  // Store hashed token + hashed OTP -- the plain OTP is never stored,
  // never logged.
  await tokenRepo.createPasswordResetToken({
    userId:          user._id,
    email:           user.email,
    tokenHash:       hashToken(plainToken),
    otpHash:         hashToken(otp),
    expiresAt,
    requestedFromIp: ip ?? null,
  });

  // Send email with plain token + plain OTP (the only place either ever
  // appears outside this function's own local scope).
  await sendPasswordReset({
    email:     user.email,
    firstName: user.firstName,
    token:     plainToken,
    otp,
  });
};

/**
 * verifyPasswordResetOtp — verifies a real, hashed, expiring 6-digit code
 * and sets the new password in one step (matching how a real "enter your
 * code and new password" reset screen works) -- real per-record attempt
 * limiting, same RATE_LIMITS.OTP_MAX_ATTEMPTS ceiling as email
 * verification's OTP. Never logs the plain OTP anywhere.
 */
export const verifyPasswordResetOtp = async ({ email, otp, newPassword }) => {
  const record = await tokenRepo.findLatestPasswordResetOtpRecord(email);
  if (!record) throw new AppError('Invalid or expired reset code', 400);

  if (record.otpAttempts >= RATE_LIMITS.OTP_MAX_ATTEMPTS) {
    throw new AppError('Too many incorrect attempts — request a new code', 429);
  }

  if (hashToken(otp) !== record.otpHash) {
    await tokenRepo.incrementPasswordResetOtpAttempts(record._id);
    throw new AppError('Incorrect reset code', 400);
  }

  const user = await userRepo.findById(record.userId);
  if (!user) throw new AppError('User not found', 404);

  const hashedPassword = await hashPassword(newPassword);
  await userRepo.updatePassword(user._id, hashedPassword);
  await tokenRepo.markPasswordResetTokenUsed(record._id);

  return user;
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