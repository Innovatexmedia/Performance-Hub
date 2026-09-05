/**
 * WhatsApp Settings — repository.
 *
 * The only layer that touches the WhatsAppSettings collection.
 * Every query is tenant-scoped. No business logic, no response
 * formatting (that happens in the service's sanitize()).
 *
 * ENCRYPTION AT REST (added -- see audit finding "WhatsApp credentials
 * stored in plaintext despite a purpose-built encryption utility")
 * ─────────────────────────────────────────────────────────────────
 * SENSITIVE_FIELDS (meta.accessToken, meta.appSecret, meta.verifyToken,
 * dialog360.apiKey, twilio.authToken, interakt.apiKey -- the exact same
 * list whatsappSettings.service.js's sanitize() already uses to strip
 * these from API responses) are encrypted with AES-256-GCM
 * (src/utils/crypto.js) before ever reaching MongoDB, and transparently
 * decrypted on every read, so nothing outside this file needs to know
 * encryption is happening at all -- the service layer keeps working
 * with plain, usable credential strings exactly as before.
 *
 * This is a deliberate, narrow exception to "no business logic here":
 * encryption-at-rest is a storage-format concern belonging at the
 * boundary closest to the database, not a business rule. It's handled
 * HERE rather than wrapping each of the ~18 call sites in the service
 * individually specifically because there are that many call sites --
 * every future one automatically gets this correctly, with nothing to
 * remember to add.
 *
 * Uses findOneAndUpdate exclusively (never .save()) -- a Mongoose
 * pre('save') hook would silently never fire here, which is why this
 * wraps the repository's own read/write methods directly instead.
 */
import { WhatsAppSettings } from './whatsappSettings.model.js';
import { encrypt, decrypt, safeDecrypt } from '../../../../utils/crypto.js';
import { SENSITIVE_FIELDS } from './whatsappSettings.constants.js';

// ── Dot-path helpers ─────────────────────────────────────────────────────────

/** Reads a dot-path ('meta.accessToken') off a nested plain object or Mongoose doc. */
function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

/** Writes a dot-path value onto a nested plain object, creating intermediate objects as needed. */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * encryptNested — for create()/upsertDefault()'s payload shape, a
 * genuinely NESTED plain object (e.g. { meta: { accessToken: 'xyz' } }).
 * Returns a new object; does not mutate the input.
 */
function encryptNested(data) {
  if (!data) return data;
  const out = JSON.parse(JSON.stringify(data)); // cheap deep clone -- payloads here are plain JSON-safe data, never Dates/ObjectIds at these specific paths
  for (const path of SENSITIVE_FIELDS) {
    const value = getPath(out, path);
    if (value) setPath(out, path, encrypt(value));
  }
  return out;
}

/**
 * encryptFlat — for update()/upsert()'s $set payload shape, ALREADY
 * flattened to dot-notation keys by the service's own flatten() helper
 * (e.g. { 'meta.accessToken': 'xyz' }) -- the object's keys ARE the
 * dot-paths already, no nested traversal needed. Returns a new object;
 * does not mutate the input.
 */
function encryptFlat(setOps) {
  if (!setOps) return setOps;
  const out = { ...setOps };
  for (const path of SENSITIVE_FIELDS) {
    if (out[path]) out[path] = encrypt(out[path]);
  }
  return out;
}

/**
 * decryptDoc — mutates a returned Mongoose document (or plain object, or
 * null/undefined) in place, decrypting every SENSITIVE_FIELDS path that's
 * actually set. Safe to call on null (e.g. findByTenant finding nothing).
 *
 * Uses safeDecrypt (see crypto.js) rather than decrypt() directly --
 * backward compatibility for any tenant whose settings were saved
 * BEFORE this encryption fix shipped (genuine plaintext already in the
 * DB, confirmed to 500 the whole request otherwise). Self-heals to real
 * ciphertext on this tenant's next settings save.
 */
function decryptDoc(doc) {
  if (!doc) return doc;
  for (const path of SENSITIVE_FIELDS) {
    const value = getPath(doc, path);
    if (value) setPath(doc, path, safeDecrypt(value));
  }
  return doc;
}

export const whatsappSettingsRepository = {
  async create(data) {
    const created = await WhatsAppSettings.create(encryptNested(data));
    return decryptDoc(created);
  },

  /**
   * upsertDefault -- atomic find-or-create for the auto-provision path.
   * $setOnInsert means an existing document is returned completely
   * untouched (no field gets overwritten back to a default); a genuinely
   * missing one is created exactly once even under concurrent callers,
   * since findOneAndUpdate's upsert is atomic at the database level.
   */
  async upsertDefault(tenantId, defaults) {
    const updated = await WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { ...encryptNested(defaults), tenantId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return decryptDoc(updated);
  },

  async findByTenant(tenantId) {
    const found = await WhatsAppSettings.findOne({ tenantId });
    return decryptDoc(found);
  },

  /**
   * Apply a partial update using dot-notation $set so nested sub-objects
   * are merged field-by-field instead of being replaced wholesale.
   */
  async update(tenantId, setOps) {
    const updated = await WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $set: encryptFlat(setOps) },
      { new: true, runValidators: true },
    );
    return decryptDoc(updated);
  },

  /**
   * Upsert — create if missing, otherwise update. Used by create-settings
   * to guarantee a single document per tenant even under race conditions.
   */
  async upsert(tenantId, setOnInsert, setOps = {}) {
    const updated = await WhatsAppSettings.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: encryptNested(setOnInsert), $set: encryptFlat(setOps) },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return decryptDoc(updated);
  },

  deleteByTenant(tenantId) {
    return WhatsAppSettings.findOneAndDelete({ tenantId });
  },

  /**
   * findByPhoneNumberId -- the ONE deliberately cross-tenant query in this
   * repository. Every other method is tenant-scoped by design; this one
   * exists specifically to check whether phoneNumberId is already claimed
   * by a DIFFERENT tenant, for duplicate-connection prevention.
   * excludeTenantId lets a tenant re-save their own already-connected
   * number without it flagging itself as a duplicate.
   *
   * phoneNumberId is NOT a SENSITIVE_FIELDS entry (it's an identifier
   * used for lookups/uniqueness, not a credential) -- no encryption
   * involved on this path.
   */
  findByPhoneNumberId(phoneNumberId, excludeTenantId) {
    return WhatsAppSettings.findOne({
      'meta.phoneNumberId': phoneNumberId,
      tenantId: { $ne: excludeTenantId },
    });
  },
};