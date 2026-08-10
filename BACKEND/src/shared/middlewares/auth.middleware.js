/**
 * =============================================================================
 * InnovateX Revenue OS — Auth Middleware
 * =============================================================================
 *
 * FILE: src/shared/middlewares/auth.middleware.js
 *
 * PURPOSE
 * ───────
 * Verifies the JWT access token on every protected route.
 * Attaches req.user = { sub, tenantId, role, sessionId } from the token payload.
 * Does NOT hit the database — stateless verification using JWT signature.
 *
 * HOW IT FITS
 * ───────────
 * auth.routes.js (public) → no auth middleware
 * all protected routes    → authenticate → role/permission middleware → controller
 * =============================================================================
 */

import { verifyAccessToken, extractBearerToken } from '../../config/jwt.js';
import AppError from '../../utils/AppError.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * authenticate — verifies JWT and attaches req.user.
 * Throws 401 if token is missing, invalid, or expired.
 */

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw new AppError('Authentication required. Please log in.', 401);
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Your session has expired. Please log in again.', 401);
    }
    throw new AppError('Invalid authentication token', 401);
  }

  // Attach decoded payload to request
  req.user = {
    sub:       decoded.sub,        // userId
    tenantId:  decoded.tenantId,   // null for super_admin
    role:      decoded.role,
    permissions: decoded.permissions || [],
    sessionId: decoded.sessionId,
  };

  next();
});

/**
 * optionalAuthenticate — same as authenticate but doesn't throw if no token.
 * Used for routes that work both authenticated and unauthenticated.
 */


export const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      sub:       decoded.sub,
      tenantId:  decoded.tenantId,
      role:      decoded.role,
      permissions: decoded.permissions || [],
      sessionId: decoded.sessionId,
    };
  } catch {
    // Invalid token — proceed unauthenticated (no error)
  }

  next();
});