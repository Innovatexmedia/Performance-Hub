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
 * secure: true     — HTTPS only in production
 * sameSite: lax    — blocks cross-site POST/PUT/DELETE (CSRF protection),
 *                     while still allowing this cookie on a top-level GET
 *                     navigation arriving from a cross-site redirect (e.g.
 *                     an OAuth provider like Shopify/Google redirecting
 *                     back to our own callback) -- 'strict' was tried
 *                     first and confirmed to break exactly that case,
 *                     logging users out immediately after starting any
 *                     OAuth flow in production.
 * path: /          — cookie available on all routes
 *
 * ENVIRONMENT VARIABLES
 * ──────────────────────
 * NODE_ENV — "production" enables secure flag
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
  // 'lax' in both environments -- 'strict' blocks this cookie on any
  // top-level navigation arriving from a cross-site redirect, which
  // includes a legitimate OAuth provider (Shopify, Google Ads) redirecting
  // back to our own callback. Confirmed as the real cause of users being
  // logged out immediately after starting an OAuth flow in production.
  // Lax still blocks cross-site POST/PUT/DELETE, so CSRF protection is
  // unaffected -- this is the standard setting used specifically because
  // it survives OAuth/external-redirect flows.
  sameSite: 'lax',
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
 * Must use identical path and domain as the set call.
 * @param {Object} res — Express response object
 */
export const clearRefreshTokenCookie = (res) => {
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, {
    httpOnly: true,
    secure:   isProduction,
    sameSite: 'lax',
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