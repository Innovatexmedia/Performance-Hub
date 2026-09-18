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

/**
 * parseDuration — turns a jsonwebtoken-style duration string ("15m", "7d",
 * "90s", "12h") into seconds. Returns null for anything it doesn't
 * understand, so the caller can fall back rather than silently running on a
 * garbage value.
 */
const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

const parseDuration = (value) => {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * DURATION_UNITS[match[2]];
};

/**
 * resolveExpiry — reads a duration from env, validates it, and returns BOTH
 * representations from the one source.
 *
 * Why both: every expiry in this file is needed twice, in two different
 * formats. The "15m" string goes to jsonwebtoken's expiresIn; the seconds
 * number drives the refresh cookie's maxAge (utils/cookies.js) and the
 * RefreshToken row's expiresAt (token.service.js). Deriving them separately
 * is how they drift -- set the JWT to 30d but leave the seconds at 7d and the
 * token stays valid for 30 days while the cookie and DB row die at 7, so the
 * effective session is 7 days and nothing says why.
 *
 * An unset or malformed env value falls back to the default and warns rather
 * than throwing: a typo in an optional tuning knob shouldn't take down a
 * production boot, but it shouldn't pass silently either.
 *
 * @param {string} envName — env var to read
 * @param {string} fallback — duration string used when env is unset/invalid
 */
const resolveExpiry = (envName, fallback) => {
  const raw = process.env[envName];
  const seconds = parseDuration(raw);

  if (raw && seconds === null) {
    console.warn(
      `⚠️  ${envName}="${raw}" is not a valid duration (expected e.g. "15m", "2h", "7d"). ` +
      `Falling back to ${fallback}.`
    );
  }

  const chosen = seconds ?? parseDuration(fallback);
  return { jwt: seconds ? raw.trim().toLowerCase() : fallback, seconds: chosen };
};

const ACCESS_EXPIRY  = resolveExpiry('JWT_ACCESS_EXPIRES_IN',  '15m');
const REFRESH_EXPIRY = resolveExpiry('JWT_REFRESH_EXPIRES_IN', '7d');

// A long-lived access token is the one setting here with real security
// weight: access tokens are stateless, so nothing -- not "log out all
// devices", not a password change -- can revoke one before it expires. The
// refresh token is the opposite: HttpOnly, hashed in the DB, revocable at any
// time. So a long refresh expiry is fine; a long access expiry is not.
if (ACCESS_EXPIRY.seconds > 60 * 60) {
  console.warn(
    `⚠️  JWT_ACCESS_EXPIRES_IN is set to ${ACCESS_EXPIRY.jwt}. Access tokens cannot be ` +
    `revoked before they expire, so a leaked one stays usable for that entire window. ` +
    `Anything above ~1h is a real risk; 15m is the recommended value. Session length is ` +
    `governed by JWT_REFRESH_EXPIRES_IN, not this.`
  );
}

export const TOKEN_EXPIRY = Object.freeze({
  ACCESS_TOKEN_SECONDS:             ACCESS_EXPIRY.seconds,
  REFRESH_TOKEN_SECONDS:            REFRESH_EXPIRY.seconds,
  PASSWORD_RESET_SECONDS:           15 * 60,              // 15 minutes
  EMAIL_VERIFICATION_SECONDS:       24 * 60 * 60,         // 24 hours
  INVITATION_SECONDS:               7 * 24 * 60 * 60,     // 7 days

  // How long a just-rotated refresh token still counts as "the same
  // rotation" rather than a replay. Two concurrent /auth/refresh calls
  // carrying the same cookie (two tabs, socket-triggered refresh racing a
  // 401-triggered one) land milliseconds apart, so this only needs to cover
  // request latency -- 30s is generous for that while still being far too
  // short to be useful to an attacker holding a stolen token.
  ROTATION_GRACE_SECONDS:           30,

  // JWT-format strings (used by jsonwebtoken). Derived from the SAME env
  // value as the *_SECONDS entries above -- see resolveExpiry.
  ACCESS_TOKEN_JWT:                 ACCESS_EXPIRY.jwt,
  REFRESH_TOKEN_JWT:                REFRESH_EXPIRY.jwt,
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