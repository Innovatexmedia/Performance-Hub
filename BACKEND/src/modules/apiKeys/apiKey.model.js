/**
 * ApiKey — a tenant-facing credential for the public API.
 *
 * WHY A NEW MODEL
 * ───────────────
 * Nothing in this codebase issued customer-facing credentials before: the
 * `apiKey` fields elsewhere belong to OUTBOUND integrations (Gemini, OpenAI,
 * Meta) — secrets we hold for third parties, not secrets customers hold for
 * us. Those are encrypted-at-rest and decrypted for use. A customer API key
 * is the opposite: it must be hashed, never decrypted, and never shown again
 * after issue.
 *
 * STORAGE
 * ───────
 * Only a SHA-256 hash is stored (the same hashToken used for refresh tokens).
 * A leaked database dump therefore cannot be used to call the API. The
 * plaintext key exists exactly once, in the HTTP response to the create call.
 *
 * `prefix` is the first 12 characters of the key, stored in the clear. That is
 * not a security hole — it is what makes the dashboard usable: the customer
 * sees "ixk_live_a1b2…" and knows which key a row refers to, and support can
 * match a key from a log line without ever seeing the secret half.
 */

import mongoose from 'mongoose';
const { Schema } = mongoose;

export const API_KEY_SCOPE = Object.freeze({
  /** Trigger API campaigns. The only scope today; more can be added without
   *  reissuing existing keys, since scopes are stored per key. */
  CAMPAIGNS_SEND: 'campaigns:send',
});
export const API_KEY_SCOPE_VALUES = Object.freeze(Object.values(API_KEY_SCOPE));

const apiKeySchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },

    /** Human label chosen by the customer: "Production backend", "n8n". */
    name: { type: String, required: true, trim: true, maxlength: 80 },

    /** SHA-256 of the full key. Unique so a hash collision or a double-insert
     *  can never produce two keys that authenticate as different tenants. */
    keyHash: { type: String, required: true, unique: true, index: true },

    /** Visible identifier — first 12 chars of the plaintext key. */
    prefix: { type: String, required: true },

    scopes: {
      type: [String],
      enum: API_KEY_SCOPE_VALUES,
      default: [API_KEY_SCOPE.CAMPAIGNS_SEND],
    },

    /** Who created it, for the audit trail the dashboard shows. */
    createdBy: { type: String, default: null },

    /**
     * Updated at most once a minute (see apiKey.service.js touchLastUsed), not
     * on every request: a busy key would otherwise turn every authenticated
     * API call into an extra write, for a timestamp nobody reads at that
     * resolution.
     */
    lastUsedAt: { type: Date, default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },

    /** Optional expiry. Null means the key does not expire. */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// Listing a tenant's keys, newest first.
apiKeySchema.index({ tenantId: 1, created_at: -1 });

/** Active = not revoked and not past its expiry. */
apiKeySchema.methods.isActive = function isActive() {
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

export const ApiKey = mongoose.model('ApiKey', apiKeySchema);
export default ApiKey;