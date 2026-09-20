/**
 * API Key service — issue, verify and revoke customer API credentials.
 *
 * KEY FORMAT: ixk_live_<43 url-safe chars>
 *   ixk_   — vendor prefix, so a key found in a log or a git commit is
 *            immediately identifiable as ours (the same reason Stripe uses
 *            sk_, GitHub ghp_). Secret scanners key off exactly this.
 *   live_  — environment segment, so a test-mode key can be added later
 *            without changing the parsing of existing keys.
 *   suffix — 32 random bytes from generateSecureToken (crypto.randomBytes),
 *            base64url-encoded. Not Math.random, not a UUID.
 */

import { ApiKey, API_KEY_SCOPE, API_KEY_SCOPE_VALUES } from './apiKey.model.js';
import { hashToken, generateSecureToken } from '../../utils/crypto.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

const KEY_PREFIX = 'ixk_live_';
const PREFIX_DISPLAY_LENGTH = 12;

/** How stale lastUsedAt is allowed to get. See the model's comment. */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * toDTO — what the dashboard sees. Deliberately has no `keyHash`: the hash is
 * as sensitive as the key for an offline attacker, and nothing in the UI needs
 * it.
 */
export const toApiKeyDTO = (doc) => ({
  id:         String(doc._id),
  name:       doc.name,
  prefix:     doc.prefix,
  scopes:     doc.scopes,
  createdBy:  doc.createdBy,
  lastUsedAt: doc.lastUsedAt,
  expiresAt:  doc.expiresAt,
  revokedAt:  doc.revokedAt,
  isActive:   !doc.revokedAt && (!doc.expiresAt || doc.expiresAt.getTime() > Date.now()),
  createdAt:  doc.created_at,
});

export const apiKeyService = {
  /**
   * create — issues a new key.
   *
   * Returns the plaintext key EXACTLY ONCE, in `key`. It is never stored and
   * cannot be recovered; a customer who loses it creates a new one and revokes
   * the old. The controller must make that clear in the UI.
   */
  async create(ctx, { name, scopes = [API_KEY_SCOPE.CAMPAIGNS_SEND], expiresAt = null }) {
    if (!name || !String(name).trim()) {
      throw new AppError(400, 'A name is required so you can tell your keys apart later');
    }

    const invalid = scopes.filter((s) => !API_KEY_SCOPE_VALUES.includes(s));
    if (invalid.length) {
      throw new AppError(400, `Unknown scope(s): ${invalid.join(', ')}`);
    }

    const plaintext = `${KEY_PREFIX}${generateSecureToken(32)}`;

    const doc = await ApiKey.create({
      tenantId:  String(ctx.tenantId),
      name:      String(name).trim(),
      keyHash:   hashToken(plaintext),
      prefix:    plaintext.slice(0, PREFIX_DISPLAY_LENGTH),
      scopes,
      createdBy: ctx.userId ? String(ctx.userId) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    return { apiKey: toApiKeyDTO(doc), key: plaintext };
  },

  async list(ctx) {
    const docs = await ApiKey.find({ tenantId: String(ctx.tenantId) }).sort({ created_at: -1 });
    return docs.map(toApiKeyDTO);
  },

  /**
   * revoke — irreversible. Revoked rows are kept rather than deleted so the
   * audit trail survives: "which key triggered this run" must still resolve
   * for a key that has since been turned off.
   */
  async revoke(ctx, id) {
    const doc = await ApiKey.findOne({ _id: id, tenantId: String(ctx.tenantId) });
    if (!doc) throw new AppError(404, 'API key not found');
    if (doc.revokedAt) return toApiKeyDTO(doc);

    doc.revokedAt = new Date();
    doc.revokedBy = ctx.userId ? String(ctx.userId) : null;
    await doc.save();

    return toApiKeyDTO(doc);
  },

  /**
   * verify — resolves a plaintext key to its record.
   *
   * Looks up by hash, so this is a single indexed equality query rather than a
   * scan-and-compare: no timing side channel, and no need to load every key
   * for the tenant (we don't even know the tenant yet — the key IS the tenant
   * identifier).
   *
   * Returns null for every failure mode (unknown, revoked, expired) so the
   * caller cannot accidentally leak which one it was in an error message.
   */
  async verify(plaintextKey) {
    if (!plaintextKey || typeof plaintextKey !== 'string') return null;
    if (!plaintextKey.startsWith(KEY_PREFIX)) return null;

    const doc = await ApiKey.findOne({ keyHash: hashToken(plaintextKey) });
    if (!doc || !doc.isActive()) return null;

    return doc;
  },

  /**
   * touchLastUsed — throttled write, fire-and-forget by design.
   * The $lt guard means concurrent requests for the same key collapse into at
   * most one write per window, without a read-then-write race.
   */
  touchLastUsed(apiKeyId) {
    const cutoff = new Date(Date.now() - LAST_USED_THROTTLE_MS);
    return ApiKey.updateOne(
      { _id: apiKeyId, $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: cutoff } }] },
      { $set: { lastUsedAt: new Date() } }
    ).catch(() => {
      /* Never fail a customer's API call over a usage timestamp. */
    });
  },
};

export default apiKeyService;