export const TOKEN_TYPES = Object.freeze({
  ACCESS:               "access",
  REFRESH:              "refresh",
  PASSWORD_RESET:       "password_reset",
  EMAIL_VERIFICATION:   "email_verification",
  // Short-lived token proving "this user's password was already verified"
  // during login, used only to pick which workspace to enter when a user
  // has more than one active Membership. Never used for actual API access.
  WORKSPACE_SELECTION:  "workspace_selection",
});

// ─── Cookie Names ─────────────────────────────────────────────────────────────

export const COOKIE_NAMES = Object.freeze({
  REFRESH_TOKEN: "innovatex_rt",      // HttpOnly refresh token cookie
  ACCESS_TOKEN:  "innovatex_at",      // Optional: if storing AT in cookie
});

// ─── Token Expiry ─────────────────────────────────────────────────────────────

export const TOKEN_EXPIRY = Object.freeze({
  ACCESS_TOKEN_SECONDS:             15 * 60,              // 15 minutes
  REFRESH_TOKEN_SECONDS:            7 * 24 * 60 * 60,    // 7 days
  PASSWORD_RESET_SECONDS:           15 * 60,              // 15 minutes
  EMAIL_VERIFICATION_SECONDS:       24 * 60 * 60,         // 24 hours
  INVITATION_SECONDS:               7 * 24 * 60 * 60,     // 7 days

  // JWT-format strings (used by jsonwebtoken)
  ACCESS_TOKEN_JWT:                 "15m",
  REFRESH_TOKEN_JWT:                "7d",
});

// ─── Account Security Limits ─────────────────────────────────────────────────

export const ACCOUNT_LIMITS = Object.freeze({
  MAX_LOGIN_ATTEMPTS:       10,    // Lockout after this many failed attempts
  LOCKOUT_DURATION_MINUTES: 60,    // Lock duration in minutes
  MAX_ACTIVE_SESSIONS:      5,     // Max concurrent device logins per user
  PASSWORD_MIN_LENGTH:      8,
  PASSWORD_RESET_RESEND_WAIT_MINUTES: 2, // Prevent spam on forgot-password
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const RATE_LIMITS = Object.freeze({
  LOGIN_MAX_REQUESTS:       5,     // Max login attempts per window
  LOGIN_WINDOW_MINUTES:     15,    // Rate limit window in minutes
  FORGOT_PASSWORD_REQUESTS: 3,
  FORGOT_PASSWORD_WINDOW_MINUTES: 60,
  GENERAL_API_REQUESTS:     300,   // Raised from 100, AND the window shortened from 15 min to 1 min (see below) -- a long window with even a generous cap locks a real user out for the rest of their session if ever approached; a short window recovers in under a minute. 300/min is far more than any real click-driven usage produces, while a genuine runaway loop still hits this within seconds.
  GENERAL_API_WINDOW_MINUTES: 1,
  // A 6-digit OTP has 1,000,000 possibilities -- unlike a 15-min link
  // token (impossible to brute-force), a short numeric code genuinely
  // needs its own real per-request attempt ceiling, not just the
  // generation-side limit above. 5 wrong tries invalidates the OTP
  // entirely (see auth.service.js's verifyOtp helper) rather than
  // allowing unlimited guesses within the expiry window.
  OTP_MAX_ATTEMPTS:            5,
  OTP_GENERATION_REQUESTS:     3,   // per window -- same real ceiling as FORGOT_PASSWORD_REQUESTS, reused for OTP (re)generation on both flows
  OTP_GENERATION_WINDOW_MINUTES: 60,
  OTP_VERIFY_REQUESTS:         10,  // per window -- more generous than generation since a genuine user can mistype a digit
  OTP_VERIFY_WINDOW_MINUTES:   15,
  OTP_EXPIRY_MINUTES:          10,
});

// ─── User Status Values ───────────────────────────────────────────────────────

export const USER_STATUS = Object.freeze({
  ACTIVE:    "active",
  INACTIVE:  "inactive",
  SUSPENDED: "suspended",
  PENDING:   "pending",   // Invited but not yet accepted
  DELETED:   "deleted",   // Soft-deleted -- account no longer usable
});

// ─── Subscription Status Values ───────────────────────────────────────────────

export const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL:     "trial",
  ACTIVE:    "active",
  INACTIVE:  "inactive",
  SUSPENDED: "suspended",
  CANCELLED: "cancelled",
});

// ─── Audit Event Types ────────────────────────────────────────────────────────

export const AUDIT_EVENTS = Object.freeze({
  LOGIN_SUCCESS:        "login_success",
  LOGIN_FAILED:         "login_failed",
  LOGOUT:               "logout",
  LOGOUT_ALL:           "logout_all",
  PASSWORD_CHANGED:     "password_changed",
  PASSWORD_RESET:       "password_reset",
  EMAIL_VERIFIED:       "email_verified",
  TOKEN_REFRESHED:      "token_refreshed",
  ACCOUNT_LOCKED:       "account_locked",
  ACCOUNT_UNLOCKED:     "account_unlocked",
  INVITATION_CREATED:   "invitation_created",
  INVITATION_ACCEPTED:  "invitation_accepted",
  ROLE_CHANGED:         "role_changed",
  WORKSPACE_SWITCHED:   "workspace_switched",
  WORKSPACE_CREATED:    "workspace_created",
  SESSION_REVOKED:      "session_revoked",
  USER_ACTIVATED:       "user_activated",
  USER_DEACTIVATED:     "user_deactivated",
});