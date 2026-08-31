/**
 * =============================================================================
 * InnovateX Revenue OS — Rate Limit Middleware
 * =============================================================================
 *
 * FILE: src/shared/middlewares/rateLimit.middleware.js
 *
 * PURPOSE
 * ───────
 * Protects auth endpoints from brute-force attacks.
 * Uses express-rate-limit (in-memory store — use Redis for multi-server deployments).
 *
 * PACKAGES REQUIRED
 * ─────────────────
 * npm install express-rate-limit
 * =============================================================================
 */

let rateLimit;
try {
  rateLimit = (await import('express-rate-limit')).default;
} catch {
  // Fallback: pass-through if express-rate-limit not installed
  rateLimit = () => (req, res, next) => next();
  console.warn('⚠️  express-rate-limit not installed. Rate limiting is DISABLED. Run: npm install express-rate-limit');
}

import { sendError } from '../../utils/apiResponse.js';
import { RATE_LIMITS } from '../../modules/auth/constants/auth.constants.js';

const rateLimitHandler = (req, res) =>
  sendError(res, 'Too many requests. Please try again later.', 429);

/**
 * nurtureWebhookRateLimit — 60 requests per minute per IP.
 * Applied to the public incoming Nurture webhook trigger endpoint.
 * More generous than login (this is meant for real external system
 * traffic, not a human typing a password), but still a real, enforced
 * ceiling against abuse of a public, token-authenticated endpoint.
 */
export const nurtureWebhookRateLimit = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

/**
 * loginRateLimit — 5 attempts per 15 minutes per IP.
 * Applied to POST /auth/login and POST /auth/forgot-password.
 */
export const loginRateLimit = rateLimit({
  windowMs:         RATE_LIMITS.LOGIN_WINDOW_MINUTES * 60 * 1000,
  max:              RATE_LIMITS.LOGIN_MAX_REQUESTS,
  standardHeaders:  true,  // Return rate limit info in RateLimit-* headers
  legacyHeaders:    false,
  handler:          rateLimitHandler,
  skipSuccessfulRequests: false,
  // keyGenerator:     (req) => req.ip, // Rate limit per IP
});

/**
 * forgotPasswordRateLimit — 3 attempts per hour per IP.
 */
export const forgotPasswordRateLimit = rateLimit({
  windowMs:        RATE_LIMITS.FORGOT_PASSWORD_WINDOW_MINUTES * 60 * 1000,
  max:             RATE_LIMITS.FORGOT_PASSWORD_REQUESTS,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

/**
 * otpGenerationRateLimit — real per-request-rate ceiling on ISSUING an
 * OTP (email verification resend, password reset request). Distinct
 * from otpVerifyRateLimit below (which limits VERIFY calls) and from
 * the per-record otpAttempts limit inside auth.service.js/
 * password.service.js (which limits WRONG GUESSES on one already
 * -issued code) -- three separate, real ceilings, not one doing double
 * duty for two different attack shapes (spamming code generation vs.
 * brute-forcing a code that already exists).
 */
export const otpGenerationRateLimit = rateLimit({
  windowMs:        RATE_LIMITS.OTP_GENERATION_WINDOW_MINUTES * 60 * 1000,
  max:             RATE_LIMITS.OTP_GENERATION_REQUESTS,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

/**
 * otpVerifyRateLimit — real per-request-rate ceiling on the VERIFY
 * endpoint itself, on top of (not instead of) the per-record attempt
 * limit that invalidates a specific OTP after too many wrong guesses.
 */
export const otpVerifyRateLimit = rateLimit({
  windowMs:        RATE_LIMITS.OTP_VERIFY_WINDOW_MINUTES * 60 * 1000,
  max:             RATE_LIMITS.OTP_VERIFY_REQUESTS,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

/**
 * generalApiRateLimit — applied globally in app.js for all /api routes.
 * 300 requests per 1 minute per IP (see RATE_LIMITS in auth.constants.js
 * for the real reasoning: a short window with a generous cap recovers
 * fast if ever approached, instead of locking a real user out for 15
 * minutes the way the original 100/15min config did).
 *
 * NOTE: previously had a `skip: (req) => req.user?.role === 'super_admin'`
 * condition -- removed because it never actually worked. This middleware
 * is mounted in app.js BEFORE any route-specific `authenticate` runs, so
 * req.user is always undefined at this point regardless of who's calling
 * -- the check silently evaluated to false for every single request. Real
 * per-user exemption would require moving auth resolution earlier in the
 * global chain (a bigger change); removed rather than leave broken dead
 * code, and the substantially raised limit above makes this far less
 * necessary anyway.
 */
export const generalApiRateLimit = rateLimit({
  windowMs:        RATE_LIMITS.GENERAL_API_WINDOW_MINUTES * 60 * 1000,
  max:             RATE_LIMITS.GENERAL_API_REQUESTS,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});