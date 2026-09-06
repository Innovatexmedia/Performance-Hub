/**
 * =============================================================================
 * InnovateX Revenue OS — Cookie Utilities
 * =============================================================================
 *
 * FILE: src/utils/cookies.js
 *
 * PURPOSE
 * ───────
 * Centralised helpers for setting and clearing HTTP cookies.
 * Enforces consistent security attributes across all auth endpoints.
 *
 * HOW IT FITS
 * ───────────
 * cookies.js → auth.service.js (set refresh token cookie on login/refresh)
 *            → auth.controller.js (clear cookie on logout)
 *
 * SECURITY ATTRIBUTES
 * ───────────────────
 * httpOnly: true   — inaccessible to JavaScript (prevents XSS token theft)
 * secure: true     — HTTPS only in production (REQUIRED for sameSite:'none'
 *                     to work at all -- modern browsers refuse a
 *                     SameSite=None cookie without Secure)
 * sameSite: production ? 'none' : 'lax' — see below for why this differs
 *                     by environment.
 * path: /          — cookie available on all routes
 *
 * WHY sameSite DIFFERS BY ENVIRONMENT
 * ─────────────────────────────────────
 * 'strict' was tried first and confirmed to break OAuth flows -- it
 * blocks the cookie on ANY top-level navigation arriving from a
 * cross-site redirect, including a legitimate OAuth provider (Shopify,
 * Google Ads) redirecting back to our own callback, logging users out
 * immediately after starting any OAuth flow.
 *
 * 'lax' was the fix for that -- but 'lax' STILL blocks the cookie on
 * cross-site background fetch/XHR calls (not full-page navigations),
 * which is exactly how the frontend calls /api/auth/refresh on page
 * load to resume a session. This was invisible locally (frontend and
 * backend both on localhost, effectively same-site regardless of port)
 * but confirmed broken the moment frontend (vercel.app) and backend
 * (onrender.com) became genuinely different registrable domains in
 * production: refresh-token cookie silently never sent on that
 * background call, /api/auth/refresh always 401s, and every page
 * reload logged the user out.
 *
 * 'none' (production only) is the actual correct setting for this real
 * cross-origin-frontend-and-backend deployment topology -- it's
 * strictly MORE permissive than 'lax', so anything that already worked
 * under 'lax' (including the OAuth redirect case above) keeps working;
 * it additionally allows the cookie on cross-site background requests,
 * which is what this app actually needs. Kept as 'lax' in development,
 * since 'none' requires Secure (HTTPS), which local dev doesn't have.
 *
 * ENVIRONMENT VARIABLES
 * ──────────────────────
 * NODE_ENV — "production" enables secure flag AND switches sameSite to 'none'
 * =============================================================================
 */

import { COOKIE_NAMES, TOKEN_EXPIRY } from '../modules/auth/constants/auth.constants.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * getRefreshTokenCookieOptions — returns the standard options for the refresh token cookie.
 * @returns {Object} cookie options
 */
export const getRefreshTokenCookieOptions = () => ({
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   TOKEN_EXPIRY.REFRESH_TOKEN_SECONDS * 1000, // milliseconds
  path:     '/',
});

/**
 * setRefreshTokenCookie — sets the HttpOnly refresh token cookie on the response.
 * @param {Object} res           — Express response object
 * @param {string} refreshToken  — plain refresh token (NOT the hash)
 */
export const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie(
    COOKIE_NAMES.REFRESH_TOKEN,
    refreshToken,
    getRefreshTokenCookieOptions()
  );
};

/**
 * clearRefreshTokenCookie — clears the refresh token cookie (logout/session revocation).
 * Must use identical path, sameSite, and domain as the set call -- a
 * mismatched sameSite/secure here means the browser treats this as a
 * DIFFERENT cookie and the real one never actually gets cleared on logout.
 * @param {Object} res — Express response object
 */
export const clearRefreshTokenCookie = (res) => {
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, {
    httpOnly: true,
    secure:   isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path:     '/',
  });
};

/**
 * getRefreshTokenFromCookies — safely reads the refresh token from request cookies.
 * Returns null if not present (avoids undefined errors).
 * @param {Object} req — Express request object
 * @returns {string|null}
 */
export const getRefreshTokenFromCookies = (req) =>
  req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN] ?? null;