/**
 * =============================================================================
 * InnovateX Revenue OS — Token Service
 * =============================================================================
 *
 * FILE: src/modules/auth/services/token.service.js
 *
 * PURPOSE
 * ───────
 * Business logic for token lifecycle: create, rotate, revoke.
 * Called by auth.service.js — never directly from controllers.
 * =============================================================================
 */

import crypto from 'crypto';
import { signAccessToken, signRefreshToken } from '../../../config/jwt.js';
import { hashToken, generateSecureToken }    from '../../../utils/crypto.js';
import * as tokenRepo                        from '../repositories/token.repository.js';
import { TOKEN_EXPIRY, ACCOUNT_LIMITS }      from '../constants/auth.constants.js';

/**
 * generateSessionId — creates a unique session identifier.
 */
const generateSessionId = () => crypto.randomUUID();

/**
 * issueTokenPair — creates access + refresh tokens for a login session.
 * Stores the hashed refresh token in DB.
 * Returns both tokens for the controller to use.
 *
 * @param {Object} user    — User document
 * @param {Object} meta    — { ip, userAgent }
 * @returns {{ accessToken, refreshToken, sessionId }}
 */
export const issueTokenPair = async (user, meta = {}) => {
  const sessionId = generateSessionId();

  // Sign tokens
  const accessToken  = signAccessToken({
    userId:   user._id.toString(),
    tenantId: user.tenantId?.toString() ?? null,
    role:     user.role,
    // Without this, req.user.permissions is always empty everywhere
    // downstream (requirePermission, ctx.permissions in service layers,
    // etc.) -- the whole per-user permission-override feature is inert
    // without it actually being on the token.
    permissions: user.permissions || [],
    sessionId,
  });

  const refreshToken = signRefreshToken({
    userId:    user._id.toString(),
    sessionId,
  });

  // Enforce max concurrent sessions
  const activeSessions = await tokenRepo.countActiveSessionsByUser(user._id);
  if (activeSessions >= ACCOUNT_LIMITS.MAX_ACTIVE_SESSIONS) {
    // Revoke the oldest session to make room
    const oldest = await tokenRepo.getActiveSessionsByUser(user._id);
    if (oldest.length > 0) {
      await tokenRepo.revokeRefreshToken(oldest[0].tokenHash);
    }
  }

  // Calculate expiry
  const expiresAt = new Date(
    Date.now() + TOKEN_EXPIRY.REFRESH_TOKEN_SECONDS * 1000
  );

  // Store hashed refresh token in DB
  await tokenRepo.createRefreshToken({
    userId:     user._id,
    tenantId:   user.tenantId ?? null,
    tokenHash:  hashToken(refreshToken),
    sessionId,
    expiresAt,
    deviceInfo: {
      userAgent: meta.userAgent ?? null,
      ip:        meta.ip ?? null,
    },
  });

  return { accessToken, refreshToken, sessionId };
};

/**
 * rotateRefreshToken — implements refresh token rotation.
 * Invalidates the old token, issues a new pair.
 * If the old token is not found (already used), this is a replay attack.
 *
 * @param {string} oldPlainRefreshToken
 * @param {Object} user
 * @param {Object} meta
 * @returns {{ accessToken, refreshToken }}
 */
export const rotateRefreshToken = async (oldPlainRefreshToken, user, meta = {}) => {
  const oldHash = hashToken(oldPlainRefreshToken);

  // Delete old token (rotation — one-time use)
  const deleted = await tokenRepo.deleteRefreshTokenByHash(oldHash);
  if (!deleted) {
    // Token not found or already deleted — possible replay attack
    // Revoke ALL sessions for this user as a security measure
    await tokenRepo.revokeAllUserRefreshTokens(user._id);
    throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
  }

  // Issue new pair
  return issueTokenPair(user, meta);
};

/**
 * revokeSession — logs out a specific session (single device logout).
 * @param {string} plainRefreshToken
 */
export const revokeSession = async (plainRefreshToken) => {
  if (!plainRefreshToken) return;
  const tokenHash = hashToken(plainRefreshToken);
  await tokenRepo.revokeRefreshToken(tokenHash);
};

/**
 * revokeAllSessions — logs out all devices (logout everywhere).
 * @param {string} userId
 */
export const revokeAllSessions = async (userId) => {
  await tokenRepo.revokeAllUserRefreshTokens(userId);
};

/**
 * getActiveSessions — returns active device sessions for a user.
 */
export const getActiveSessions = (userId) =>
  tokenRepo.getActiveSessionsByUser(userId);

/**
 * validateRefreshToken — finds and validates a stored refresh token.
 * @param {string} plainToken
 * @returns {RefreshToken|null}
 */
export const validateRefreshToken = (plainToken) =>
  tokenRepo.findRefreshToken(plainToken);