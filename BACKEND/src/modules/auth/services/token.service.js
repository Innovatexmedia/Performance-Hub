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
 *
 * Claims the old token atomically (see tokenRepo.markRefreshTokenRotated),
 * then issues a new pair. Only the request that wins the claim rotates.
 *
 * Throws ROTATION_ALREADY_CLAIMED when another concurrent request got there
 * first. That is NOT an attack -- two tabs sharing one cookie produce it
 * routinely -- so the caller (auth.service.js refreshTokens) handles it via
 * the grace path instead of revoking anything.
 *
 * What changed and why: this used to deleteOne() the old row and, on a
 * falsy result, revoke EVERY session the user had. Two problems. First, the
 * Mongoose delete result is an object and therefore always truthy, so that
 * branch never actually ran. Second, the equivalent check in
 * auth.service.js DID run, and revoked all sessions for what is normally
 * just a race -- logging the user out of every device.
 *
 * @param {string} oldPlainRefreshToken
 * @param {Object} user
 * @param {Object} meta
 * @returns {{ accessToken, refreshToken, sessionId }}
 * @throws {Error} ROTATION_ALREADY_CLAIMED
 */
export const rotateRefreshToken = async (oldPlainRefreshToken, user, meta = {}) => {
  const oldHash = hashToken(oldPlainRefreshToken);

  const claimed = await tokenRepo.markRefreshTokenRotated(oldHash, {
    graceSeconds: TOKEN_EXPIRY.ROTATION_GRACE_SECONDS,
  });

  if (!claimed) {
    // Someone else already rotated this exact token (or it was revoked).
    const err = new Error('ROTATION_ALREADY_CLAIMED');
    err.code = 'ROTATION_ALREADY_CLAIMED';
    throw err;
  }

  const pair = await issueTokenPair(user, meta);

  // Audit/debug link from the old row to its replacement. Best-effort: a
  // failure here must not fail a refresh that has already succeeded.
  try {
    await tokenRepo.linkRotatedToken(oldHash, hashToken(pair.refreshToken));
  } catch {
    // Intentionally ignored -- see above.
  }

  return pair;
};

/**
 * isWithinRotationGrace — true when a rotated token was rotated recently
 * enough that a second request presenting it is the other half of a race,
 * not a replay of a stolen token.
 *
 * @param {Object} tokenRecord — a row with isRotated: true
 * @returns {boolean}
 */
export const isWithinRotationGrace = (tokenRecord) => {
  if (!tokenRecord?.isRotated || !tokenRecord.rotatedAt) return false;
  if (tokenRecord.isRevoked) return false;
  const ageMs = Date.now() - new Date(tokenRecord.rotatedAt).getTime();
  return ageMs >= 0 && ageMs <= TOKEN_EXPIRY.ROTATION_GRACE_SECONDS * 1000;
};

/**
 * findTokenRecordByPlain — raw lookup including rotated/expired rows.
 * Only for the grace check above.
 */
export const findTokenRecordByPlain = (plainToken) =>
  tokenRepo.findAnyRefreshTokenByHash(hashToken(plainToken));

/**
 * issueAccessTokenForSession — mints a fresh access token WITHOUT rotating
 * anything, for the losing side of a rotation race. The winner has already
 * set the new refresh cookie on its own response; this request just needs a
 * usable access token so the user's page load doesn't fail.
 *
 * @param {Object} user
 * @param {string} sessionId — the session the caller was already on
 * @returns {{ accessToken }}
 */
export const issueAccessTokenForSession = (user, sessionId) => ({
  accessToken: signAccessToken({
    userId:      user._id.toString(),
    tenantId:    user.tenantId?.toString() ?? null,
    role:        user.role,
    permissions: user.permissions || [],
    sessionId,
  }),
});

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
 * revokeSessionById — logs out ONE specific session by sessionId, scoped
 * to the requesting user (see token.repository.js's
 * revokeRefreshTokenBySessionId for why this is scoped by both fields).
 * This is the real function behind "log out this device" when picking a
 * session from a list -- revokeSession() above only works when you
 * already have that session's plain refresh token, which is only ever
 * true for your OWN current device, not one you're viewing in a list.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @throws {Error} if no matching active session exists for this user
 */
export const revokeSessionById = async (userId, sessionId) => {
  const revoked = await tokenRepo.revokeRefreshTokenBySessionId(userId, sessionId);
  if (!revoked) {
    throw new Error('SESSION_NOT_FOUND');
  }
  return revoked;
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