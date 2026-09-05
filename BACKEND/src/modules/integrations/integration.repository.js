/**
 * =============================================================================
 * InnovateX Revenue OS — Integration Repository
 * =============================================================================
 *
 * FILE: src/modules/integrations/integration.repository.js
 *
 * Pattern matches template.repository.js / automation.repository.js exactly:
 *   - No business logic, no validation, no formatting
 *   - Returns raw Mongoose documents
 */

import { Integration } from './integration.model.js';
import { INTEGRATION_CATALOG } from './integration.constants.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

/**
 * ENCRYPTION AT REST for the generic `config` field (added -- see audit
 * finding on WhatsApp/ad-tracking credential storage, extended here to
 * this module's own analogous gap).
 * ─────────────────────────────────────────────────────────────────────
 * `config` is a schema-less Mixed blob (see integration.model.js) used
 * by two very different kinds of catalog entries:
 *   - The 9 real, functional integrations (WhatsApp, Meta/Google Ads,
 *     Cal.com, SendGrid, Google Ads OAuth) -- these route their actual
 *     credentials through their OWN dedicated, already-encrypted
 *     settings models entirely (see integration.service.js's
 *     special-cased branches in updateIntegrationConfig); this
 *     document's own `config` field is never their real source of
 *     truth, and integration.service.js's overlay functions always
 *     rebuild a fresh, safe `config` object for them anyway.
 *   - Every other catalog entry -- explicitly "simulation mode" in the
 *     product UI ("credentials are saved but no live connection is
 *     made"). This app never uses these values to call anything real,
 *     but a user could still paste a genuine third-party API key into
 *     one of these fields without registering that it's inert -- that
 *     real secret was, until now, stored as plain JSON.
 *
 * Because the field has no fixed shape (varies per catalog entry --
 * some might be { apiKey }, others { clientId, clientSecret }, etc.),
 * this encrypts the WHOLE object as one AES-256-GCM blob rather than
 * targeting named sub-fields the way WhatsApp/ad-tracking do. Decrypted
 * transparently on every read here, so every existing service function
 * (hasRealConfig(), the Object.assign merge in updateIntegrationConfig,
 * etc.) keeps working with the real, usable object unchanged.
 */
const CONFIG_ENCRYPTED_MARKER = '_encrypted';

function encryptConfig(configObj) {
  if (!configObj || typeof configObj !== 'object' || Object.keys(configObj).length === 0) {
    return configObj; // nothing to encrypt -- keep the empty-object default as-is
  }
  return { [CONFIG_ENCRYPTED_MARKER]: encrypt(JSON.stringify(configObj)) };
}

function decryptConfig(configObj) {
  if (!configObj || typeof configObj !== 'object' || !configObj[CONFIG_ENCRYPTED_MARKER]) {
    return configObj; // not an encrypted blob (empty default, or somehow already-plain legacy data) -- return as-is
  }
  try {
    return JSON.parse(decrypt(configObj[CONFIG_ENCRYPTED_MARKER]));
  } catch (err) {
    console.error('[integrations] failed to decrypt config -- wrong/rotated ENCRYPTION_KEY or corrupted data:', err.message);
    return {}; // fail safe to "no config" rather than crash the whole Integrations page over one bad record
  }
}

/** Decrypts `config` on a single doc (or null) in place. Returns the doc for chaining. */
function decryptDoc(doc) {
  if (!doc) return doc;
  doc.config = decryptConfig(doc.config);
  return doc;
}

/** Decrypts `config` across an array of docs in place. Returns the array for chaining. */
function decryptDocs(docs) {
  (docs || []).forEach(decryptDoc);
  return docs;
}

// =============================================================================
// CATALOG SEEDING
// =============================================================================

/**
 * ensureCatalogSeeded - upserts one Integration doc per catalog entry for
 * this tenant.
 *
 * REAL FIX: previously used $setOnInsert for EVERYTHING, meaning once a
 * tenant's row existed, it could never receive updates to the catalog's
 * own metadata (name/description/available/etc) again -- a developer
 * renaming or un-hiding a card in code had no effect on any tenant who'd
 * already loaded the Integrations page before that change shipped. Real
 * catalog metadata (owned by the developer, not the tenant) is now a
 * genuine $set on every call, so every tenant always sees the current,
 * correct definition. Tenant-owned STATE (status/config/error_logs)
 * still uses $setOnInsert -- set once at creation, never silently
 * overwritten by a later catalog change.
 */
export const ensureCatalogSeeded = (tenantId) =>
  Promise.all(
    INTEGRATION_CATALOG.map((entry) =>
      Integration.findOneAndUpdate(
        { tenant_id: tenantId, key: entry.key },
        {
          $set: {
            name: entry.name,
            category: entry.category,
            description: entry.description,
            logo_color: entry.logo_color,
            available: entry.available,
          },
          $setOnInsert: {
            tenant_id: tenantId,
            key: entry.key,
            status: 'disconnected',
            config: {},
            error_logs: [],
          },
        },
        { upsert: true, new: false },
      ),
    ),
  );

// =============================================================================
// READ
// =============================================================================

export const findById = async (tenantId, id) =>
  decryptDoc(await Integration.findOne({ _id: id, tenant_id: tenantId }));

/** Looks up one tenant's integration record by its stable catalog key (e.g. 'gemini'). */
export const findByKey = async (tenantId, key) =>
  decryptDoc(await Integration.findOne({ tenant_id: tenantId, key }));

export const list = async (tenantId, filter, options) => {
  const opts = options || {};
  const query = buildQuery(tenantId, filter);
  const docs = await Integration.find(query)
    .sort({ category: 1, name: 1 })
    .skip(opts.skip || 0)
    .limit(opts.limit || 50);
  return decryptDocs(docs);
};

export const count = (tenantId, filter) =>
  Integration.countDocuments(buildQuery(tenantId, filter));

/** Per-category counts, honoring status/search filters - powers "category tabs". */
export const countByCategory = (tenantId, filter) => {
  const query = buildQuery(tenantId, filter);
  return Integration.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, category: '$_id', count: 1, connected: 1 } },
  ]);
};

// =============================================================================
// UPDATE
// =============================================================================

export const update = async (tenantId, id, patch) => {
  const finalPatch = 'config' in patch ? { ...patch, config: encryptConfig(patch.config) } : patch;
  return decryptDoc(
    await Integration.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: finalPatch },
      { new: true, runValidators: true },
    ),
  );
};

// =============================================================================
// PRIVATE: BUILD QUERY
// =============================================================================

const buildQuery = (tenantId, filter) => {
  const f = filter || {};
  const query = { tenant_id: tenantId };
  if (f.category) query.category = f.category;
  if (f.status) query.status = f.status;
  if (f.search) {
    query.$or = [
      { name: { $regex: f.search, $options: 'i' } },
      { description: { $regex: f.search, $options: 'i' } },
    ];
  }
  return query;
};