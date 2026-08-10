/**
 * =============================================================================
 * InnovateX Revenue OS — JWT Configuration & Utilities
 * =============================================================================
 *
 * FILE: src/config/jwt.js
 *
 * PURPOSE
 * ───────
 * Pure JWT utility functions: sign, verify, decode.
 * No database access — all DB operations are in token.service.js.
 *
 * HOW IT FITS
 * ───────────
 * jwt.js → token.service.js (calls signAccessToken, signRefreshToken)
 *        → auth.middleware.js (calls verifyAccessToken)
 *        → auth.service.js (calls signAccessToken after refresh)
 *
 * TOKEN PAYLOAD SHAPE
 * ───────────────────
 * Access Token:
 *   { sub: userId, tenantId, role, sessionId, type: 'access' }
 *
 * Refresh Token:
 *   { sub: userId, sessionId, type: 'refresh' }
 *   (minimal payload — full user data re-fetched from DB on refresh)
 *
 * ENVIRONMENT VARIABLES REQUIRED
 * ───────────────────────────────
 * JWT_ACCESS_SECRET   — min 32 chars
 * JWT_REFRESH_SECRET  — min 32 chars (MUST differ from access secret)
 *
 * PACKAGES REQUIRED
 * ─────────────────
 * jsonwebtoken — npm install jsonwebtoken
 * =============================================================================
 */

import jwt from 'jsonwebtoken';
import { TOKEN_EXPIRY, TOKEN_TYPES } from '../modules/auth/constants/auth.constants.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const ACCESS_SECRET  = () => process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET;

// ─── Sign Functions ───────────────────────────────────────────────────────────

/**
 * signAccessToken — creates a short-lived access token.
 * @param {Object} payload — { userId, tenantId, role, sessionId }
 * @returns {string} signed JWT
 */
export const signAccessToken = ({ userId, tenantId, role, sessionId }) => {
  return jwt.sign(
    {
      sub:       userId,
      tenantId:  tenantId ?? null,
      role,
      sessionId,
      type:      TOKEN_TYPES.ACCESS,
    },
    ACCESS_SECRET(),
    { expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN_JWT }
  );
};

/**
 * signRefreshToken — creates a long-lived refresh token.
 * Payload is minimal — full user context re-fetched from DB on use.
 * @param {Object} payload — { userId, sessionId }
 * @returns {string} signed JWT
 */
export const signRefreshToken = ({ userId, sessionId }) => {
  return jwt.sign(
    {
      sub:       userId,
      sessionId,
      type:      TOKEN_TYPES.REFRESH,
    },
    REFRESH_SECRET(),
    { expiresIn: TOKEN_EXPIRY.REFRESH_TOKEN_JWT }
  );
};

/**
 * signWorkspaceSelectionToken — short-lived token proving a user's
 * password was already verified during login, used only to pick which
 * workspace to enter (when Membership count > 1). Deliberately NOT a real
 * access token -- distinct `type` claim, 5-minute expiry, and
 * verifyWorkspaceSelectionToken below rejects anything that isn't
 * exactly this type, so it can never be used for real API access.
 * @param {Object} payload — { userId }
 * @returns {string} signed JWT
 */
export const signWorkspaceSelectionToken = ({ userId }) => {
  return jwt.sign(
    {
      sub:  userId,
      type: TOKEN_TYPES.WORKSPACE_SELECTION,
    },
    ACCESS_SECRET(),
    { expiresIn: '5m' }
  );
};

/**
 * verifyWorkspaceSelectionToken — verifies a workspace-selection token AND
 * confirms it's genuinely that type, not a real access/refresh token that
 * happened to verify against the same secret.
 * @param {string} token
 * @returns {Object} decoded payload
 * @throws {JsonWebTokenError} if invalid, expired, or wrong type
 */
export const verifyWorkspaceSelectionToken = (token) => {
  const decoded = jwt.verify(token, ACCESS_SECRET());
  if (decoded.type !== TOKEN_TYPES.WORKSPACE_SELECTION) {
    throw new Error('Invalid token type for workspace selection');
  }
  return decoded;
};

// ─── Verify Functions ─────────────────────────────────────────────────────────

/**
 * verifyAccessToken — verifies signature, expiry, AND that this is
 * genuinely an access token (not a workspace-selection token or any
 * other type signed with the same ACCESS_SECRET). Previously only
 * checked signature+expiry -- a workspace-selection token could be
 * presented here and would have passed with no error, since both are
 * signed with the same secret.
 * @param {string} token
 * @returns {Object} decoded payload
 * @throws {JsonWebTokenError} if invalid or expired
 * @throws {Error} if the token is valid but not actually an access token
 */
export const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, ACCESS_SECRET());
  if (decoded.type !== TOKEN_TYPES.ACCESS) {
    throw new Error('Invalid token type for access');
  }
  return decoded;
};

/**
 * verifyRefreshToken — verifies signature, expiry, AND that this is
 * genuinely a refresh token, same reasoning as verifyAccessToken above.
 * @param {string} token
 * @returns {Object} decoded payload
 * @throws {JsonWebTokenError} if invalid or expired
 * @throws {Error} if the token is valid but not actually a refresh token
 */
export const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, REFRESH_SECRET());
  if (decoded.type !== TOKEN_TYPES.REFRESH) {
    throw new Error('Invalid token type for refresh');
  }
  return decoded;
};

// ─── Decode (no verification) ─────────────────────────────────────────────────

/**
 * decodeToken — decodes a JWT without verifying the signature.
 * Use ONLY for non-security purposes (e.g. logging, debugging).
 * NEVER use this for authentication.
 * @param {string} token
 * @returns {Object|null} decoded payload or null
 */
export const decodeToken = (token) => jwt.decode(token);

// ─── Extract from Header ──────────────────────────────────────────────────────

/**
 * extractBearerToken — extracts token from "Authorization: Bearer <token>" header.
 * @param {Object} req — Express request
 * @returns {string|null}
 */
export const extractBearerToken = (req) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1] ?? null;
};