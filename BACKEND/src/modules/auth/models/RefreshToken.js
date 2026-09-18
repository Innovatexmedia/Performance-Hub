/**
 * =============================================================================
 * InnovateX Revenue OS — RefreshToken Model
 * =============================================================================
 *
 * FILE: src/modules/auth/models/RefreshToken.js
 *
 * PURPOSE
 * ───────
 * Stores active login sessions. Each row = one device/session.
 * Enables: logout, multi-device login, refresh token rotation, session revocation.
 *
 * SECURITY DESIGN
 * ───────────────
 * - tokenHash: SHA-256 hash of the plain refresh token (stored, never the raw token)
 * - Plain token is sent to the client in an HttpOnly cookie
 * - On use: hash the incoming cookie value, find by hash, validate
 * - Rotation: on every /auth/refresh call the old row is marked rotated
 *   (isRotated/rotatedAt) and a new row is created. The old row is kept for a
 *   short grace window so two concurrent refresh calls sharing one cookie
 *   don't look like a replay attack -- see the isRotated field comment below.
 *
 * COLLECTION: refresh_tokens
 * TTL INDEX: expiresAt → MongoDB auto-deletes expired documents
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    tenantId: {
      type:    Schema.Types.ObjectId,
      ref:     'Tenant',
      default: null,
      index:   true,
    },
    // SHA-256 hash of the plain token — never store the raw token
    tokenHash: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },
    // Unique session ID — included in JWT payload for session tracking
    sessionId: {
      type:     String,
      required: true,
      index:    true,
    },
    // Device/client information for the sessions list UI
    deviceInfo: {
      userAgent: { type: String, default: null },
      ip:        { type: String, default: null },
      platform:  { type: String, default: null }, // e.g. "Windows", "macOS", "iOS"
      browser:   { type: String, default: null },
    },
    // When this token expires — TTL index auto-deletes the document
    expiresAt: {
      type:     Date,
      required: true,
    },
    isRevoked: {
      type:    Boolean,
      default: false,
    },
    revokedAt: {
      type:    Date,
      default: null,
    },
    // ─── Rotation grace window ────────────────────────────────────────────
    // Rotation used to DELETE the old row outright. That made any two
    // concurrent /auth/refresh calls carrying the SAME cookie (two browser
    // tabs, a socket-driven permission refresh landing at the same moment as
    // a 401-driven one, a StrictMode double-mount in dev) fatal: the first
    // call deleted the row, the second found nothing, and the "nothing found
    // = replay attack" branch revoked EVERY session for the user -- including
    // the brand-new one the first call had just issued. The user was logged
    // out of every device for doing nothing wrong.
    //
    // Instead of deleting, the old row is now marked rotated and kept for a
    // short grace window (see TOKEN_EXPIRY.ROTATION_GRACE_SECONDS). A second
    // request arriving inside that window is recognised as the same rotation,
    // not a replay: it gets a fresh access token and simply keeps using the
    // cookie the winning request already set. Outside the window the token is
    // rejected with a plain 401 -- no session nuking.
    // NOTE: queries filter on { $ne: true }, never { isRotated: false } --
    // documents written before this field existed don't have it, and Mongo
    // won't match a missing field against `false`. See token.repository.js.
    isRotated: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    rotatedAt: {
      type:    Date,
      default: null,
    },
    // Hash of the token that replaced this one -- audit/debug only, never
    // used to authenticate anything.
    replacedByTokenHash: {
      type:    String,
      default: null,
    },
    // Track last usage for security auditing
    lastUsedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash; // NEVER expose the hash
        return ret;
      },
    },
  }
);

// TTL index — MongoDB automatically removes expired documents
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Compound for session lookup by user
refreshTokenSchema.index({ userId: 1, sessionId: 1 });
// Compound for revoking all sessions of a user
refreshTokenSchema.index({ userId: 1, isRevoked: 1 });
// Active-session lookups now also filter on isRotated, so it belongs in the
// same compound index rather than relying on the standalone one above.
refreshTokenSchema.index({ userId: 1, isRevoked: 1, isRotated: 1 });

export default mongoose.model('RefreshToken', refreshTokenSchema, 'refresh_tokens');