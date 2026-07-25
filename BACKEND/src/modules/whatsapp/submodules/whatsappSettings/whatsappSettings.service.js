/**
 * WhatsApp Settings — service.
 *
 * Contains ALL business logic:
 *   • Create / get / update settings (one document per tenant)
 *   • Section-specific updates (provider, business-profile, messaging, …)
 *   • Provider configuration validation
 *   • WhatsApp Mode (panelMode) governance:
 *       - NATIVE      -> provider is locked server-side to META_CLOUD.
 *       - THIRD_PARTY -> provider is a user choice among THIRD_PARTY_PROVIDER_VALUES
 *                        (architecture only -- no working adapter yet).
 *   • providerMode governance: NEVER accepted from a client request. It is
 *     derived exclusively by the backend --
 *       - reset to SIMULATION ("unverified") whenever `provider` changes
 *       - flipped to LIVE only inside testConnection(), only after a real
 *         successful Meta Graph API response
 *     This is what templateApproval.service.js's submit-to-provider gate
 *     relies on to decide whether to actually call Meta -- see
 *     `provider === META_CLOUD && providerMode !== 'SIMULATION'` there.
 *   • Connection test (real Graph API call for META_CLOUD; "coming soon"
 *     for every other provider, which has no adapter implemented yet)
 *   • Synchronisation stamps
 *   • Reset to defaults
 *   • Credential stripping — accessToken / appSecret / verifyToken are NEVER
 *     returned to a client
 *   • getProviderConfig() — the integration helper other modules call to
 *     obtain credentials WITHOUT going through the HTTP layer
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import config from '../../../../config/config.js';
import { whatsappSettingsRepository } from './whatsappSettings.repository.js';
import {
  DEFAULT_SETTINGS,
  SENSITIVE_FIELDS,
  PROVIDER,
  PROVIDER_MODE,
  PANEL_MODE,
  THIRD_PARTY_PROVIDER_VALUES,
  GRAPH_API_VERSION_PATTERN,
  SYNC_ENTITY,
} from './whatsappSettings.constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Deep-merge source onto a clone of target (arrays + dates replaced wholesale). */
function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, val] of Object.entries(source || {})) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Flatten a nested patch into dot-notation keys so Mongo $set merges nested
 * sub-objects field-by-field. e.g. { meta: { appId: 'x' } } → { 'meta.appId': 'x' }.
 * Arrays and Dates are treated as leaf values.
 */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, val] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      flatten(val, path, out);
    } else {
      out[path] = val;
    }
  }
  return out;
}

/** Remove a dot-path from a plain object (mutates). */
function unsetPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cur || typeof cur !== 'object') return;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}

/** Strip sensitive credentials and return a safe plain object for responses. */
function sanitize(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const { _id, ...rest } = o;
  const safe = { id: String(_id ?? o.id), ...rest };

  // Capture presence flags BEFORE stripping. `safe` is built with a
  // shallow spread of `o` above -- nested objects are NOT cloned, so
  // safe.meta and o.meta are literally the same object in memory.
  // unsetPath() below does `delete cur[key]`, which mutates that shared
  // object in place. Computing hasAccessToken/hasAppSecret/hasVerifyToken
  // from o.meta AFTER that delete (as this used to do) reads a field that
  // was just wiped a few lines earlier -- so these flags were always
  // `false`, on every response, regardless of whether a token was ever
  // actually saved. That's what made the Settings UI perpetually ask for
  // credentials that were genuinely already persisted in the database.
  const hasAccessToken = !!(o.meta && o.meta.accessToken);
  const hasAppSecret   = !!(o.meta && o.meta.appSecret);
  const hasVerifyToken = !!(o.meta && o.meta.verifyToken);

  for (const path of SENSITIVE_FIELDS) unsetPath(safe, path);

  // Surface a boolean so the UI knows a token exists without exposing it.
  if (safe.meta) {
    safe.meta.hasAccessToken = hasAccessToken;
    safe.meta.hasAppSecret   = hasAppSecret;
    safe.meta.hasVerifyToken = hasVerifyToken;
  }
  return safe;
}

/** Validate provider-specific required configuration before persisting. */
function validateProviderConfig(provider, meta = {}) {
  if (provider === PROVIDER.META_CLOUD) {
    if (meta.graphApiVersion && !GRAPH_API_VERSION_PATTERN.test(meta.graphApiVersion)) {
      throw new AppError(400, 'graphApiVersion must look like v21.0');
    }
  }
}

/**
 * The ONE place `provider` / `panelMode` / `providerMode` are ever resolved.
 * Used by both the generic PATCH /settings (updateSettings) and the
 * PATCH /settings/provider section endpoint (updateSection), so there is no
 * second path a client can use to smuggle in a provider or providerMode
 * value the backend didn't derive itself.
 *
 * Rules (Architecture Decision, Option B):
 *   - providerMode is NEVER read from `patch`. Full stop. It's only ever
 *     written here as a *reset* (see below) or inside testConnection().
 *   - panelMode NATIVE  -> provider is forced to META_CLOUD. An explicit,
 *     conflicting `patch.provider` is a 400, not a silent override --
 *     that's a client bug (locked dropdown sent an unexpected value), not
 *     something to paper over.
 *   - panelMode THIRD_PARTY -> provider may be set to any of
 *     THIRD_PARTY_PROVIDER_VALUES. If omitted, the existing provider is
 *     left as-is (it may still legitimately be META_CLOUD until the user
 *     actively picks a third-party provider).
 *   - Whenever the resolved `provider` differs from the existing one
 *     (including as a side effect of a panelMode flip), providerMode resets
 *     to SIMULATION ("unverified") and the meta connection-state fields
 *     reset too -- a previous provider's verified/live state must never
 *     silently carry over to a different provider.
 *
 * Returns a flat object of ONLY the fields that actually need to change
 * (dot-notation for nested meta.* keys), suitable for merging into a Mongo
 * $set. Returns {} if nothing provider-related changed.
 */
function resolveProviderFields(existing, patch = {}) {
  const result = {};

  const requestedPanelMode = patch.panelMode;
  const resolvedPanelMode = requestedPanelMode || existing.panelMode || PANEL_MODE.NATIVE;
  if (requestedPanelMode && requestedPanelMode !== existing.panelMode) {
    result.panelMode = requestedPanelMode;
  }

  let resolvedProvider = existing.provider;

  if (resolvedPanelMode === PANEL_MODE.NATIVE) {
    if (patch.provider && patch.provider !== PROVIDER.META_CLOUD) {
      throw new AppError(
        400,
        'Provider is fixed to Native Meta Cloud API while WhatsApp Mode is Native InnovateX Panel.',
      );
    }
    resolvedProvider = PROVIDER.META_CLOUD;
  } else if (resolvedPanelMode === PANEL_MODE.THIRD_PARTY) {
    if (patch.provider) {
      if (!THIRD_PARTY_PROVIDER_VALUES.includes(patch.provider)) {
        throw new AppError(400, `provider must be one of: ${THIRD_PARTY_PROVIDER_VALUES.join(', ')}`);
      }
      resolvedProvider = patch.provider;
    }
    // else: leave existing.provider as-is (may still be META_CLOUD if the
    // tenant just switched into THIRD_PARTY mode and hasn't picked yet).
  }

  if (resolvedProvider !== existing.provider) {
    result.provider = resolvedProvider;
    result.providerMode = PROVIDER_MODE.SIMULATION;
    result['meta.connected'] = false;
    result['meta.connectedAt'] = null;
    result['meta.lastVerifiedAt'] = null;
  }

  return result;
}

// ── Service ────────────────────────────────────────────────────────────────────

export const whatsappSettingsService = {
  // ── Create ─────────────────────────────────────────────────────────────────

  async createSettings(ctx, data = {}) {
    const existing = await whatsappSettingsRepository.findByTenant(ctx.tenantId);
    if (existing) {
      throw new AppError(409, 'Settings already exist for this tenant. Use PATCH to update.');
    }

    // providerMode is never client-settable, even on create.
    const { providerMode: _ignoredProviderMode, ...safeData } = data;

    if (safeData.provider) validateProviderConfig(safeData.provider, safeData.meta || {});

    // Deep-merge supplied values onto defaults so omitted fields are filled.
    const merged = deepMerge(DEFAULT_SETTINGS, safeData);
    // Re-derive provider/panelMode consistency the same way any later PATCH
    // would (e.g. a caller explicitly creating with panelMode: THIRD_PARTY
    // and no provider should not end up with provider: META_CLOUD + a live
    // providerMode leaking through from DEFAULT_SETTINGS).
    const providerFields = resolveProviderFields(DEFAULT_SETTINGS, {
      provider: safeData.provider,
      panelMode: safeData.panelMode,
    });
    Object.assign(merged, providerFields, {
      provider: providerFields.provider ?? merged.provider,
      panelMode: providerFields.panelMode ?? merged.panelMode,
      providerMode: providerFields.providerMode ?? DEFAULT_SETTINGS.providerMode,
    });

    const created = await whatsappSettingsRepository.create({
      ...merged,
      tenantId:  ctx.tenantId,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    return sanitize(created);
  },

  // ── Read ───────────────────────────────────────────────────────────────────

  async getSettings(ctx) {
    let settings = await whatsappSettingsRepository.findByTenant(ctx.tenantId);
    // Auto-provision a default document on first read so other modules can rely
    // on settings always existing.
    if (!settings) {
      settings = await whatsappSettingsRepository.create({
        ...DEFAULT_SETTINGS,
        tenantId:  ctx.tenantId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
    const safe = sanitize(settings);
    // Computed fresh on every read, NOT the stored meta.webhookUrl value --
    // this is OUR receiving endpoint, not something a tenant should type
    // in. Always reflects whatever API_BASE_URL is currently configured,
    // so it can't go stale if the backend's public URL changes (e.g. a new
    // ngrok tunnel after a restart).
    safe.meta.webhookUrl = `${config.API_BASE_URL}/api/whatsapp/webhooks/meta/${ctx.tenantId}`;
    return safe;
  },

  // ── Generic update (whole document, deep) ──────────────────────────────────

  async updateSettings(ctx, patch = {}) {
    const existing = await this._ensureExists(ctx);

    // provider / panelMode go through resolveProviderFields exclusively;
    // providerMode is never accepted from the client under any endpoint.
    const {
      providerMode: _ignoredProviderMode,
      provider: _ignoredProvider,
      panelMode: _ignoredPanelMode,
      ...restPatch
    } = patch;

    const providerFields = resolveProviderFields(existing, patch);
    const finalProvider = providerFields.provider ?? existing.provider;
    if (patch.provider || patch.meta) {
      if (finalProvider === PROVIDER.META_CLOUD) {
        validateProviderConfig(finalProvider, patch.meta || {});
      }
    }

    const setOps = flatten(restPatch);
    Object.assign(setOps, providerFields); // provider-derived fields win over anything in restPatch
    setOps.updatedBy = ctx.userId;
    const updated = await whatsappSettingsRepository.update(ctx.tenantId, setOps);
    return sanitize(updated);
  },

  // ── Section-specific updates ───────────────────────────────────────────────

  async updateSection(ctx, section, sectionPatch = {}) {
    const existing = await this._ensureExists(ctx);

    // Provider section can change top-level provider + panelMode + meta.
    // providerMode is deliberately NOT destructured from sectionPatch here --
    // it is never accepted from a client, only derived (see
    // resolveProviderFields) or set inside testConnection().
    if (section === 'provider') {
      const { meta } = sectionPatch;

      const providerFields = resolveProviderFields(existing, sectionPatch);
      const finalProvider = providerFields.provider ?? existing.provider;

      if (finalProvider === PROVIDER.META_CLOUD && meta) {
        validateProviderConfig(finalProvider, meta);
      }

      // Duplicate-connection prevention: a phoneNumberId can only belong to
      // ONE tenant. The unique partial index on the model is the final
      // guarantee (holds even under a race), but this pre-check gives a
      // clear, friendly error instead of a raw MongoDB E11000 leaking out.
      if (meta?.phoneNumberId) {
        const dup = await whatsappSettingsRepository.findByPhoneNumberId(meta.phoneNumberId, ctx.tenantId);
        if (dup) {
          throw new AppError(409, 'This WhatsApp number is already connected to another workspace. Each number can only be connected to one workspace at a time.');
        }
      }

      const setOps = { ...providerFields };
      if (meta) Object.assign(setOps, flatten({ meta }));
      setOps.updatedBy = ctx.userId;
      const updated = await whatsappSettingsRepository.update(ctx.tenantId, setOps);
      return sanitize(updated);
    }

    // All other sections are a single nested object.
    const setOps = flatten({ [section]: sectionPatch });
    setOps.updatedBy = ctx.userId;
    const updated = await whatsappSettingsRepository.update(ctx.tenantId, setOps);
    return sanitize(updated);
  },

  // ── Connection test ────────────────────────────────────────────────────────

  /**
   * Real Graph API ping for META_CLOUD -- the only implemented provider.
   * On success this is the SOLE place providerMode is ever set to LIVE.
   * Every other provider is a real, stored enum value with no adapter
   * implemented yet, so this returns a clear "coming soon" error rather
   * than faking a successful connection.
   */
  async testConnection(ctx) {
    const settings = await whatsappSettingsRepository.findByTenant(ctx.tenantId);
    if (!settings) throw new AppError(404, 'Settings not found');

    const { provider, meta } = settings;

    if (provider !== PROVIDER.META_CLOUD) {
      throw new AppError(
        501,
        `${provider} isn't connected yet — support for this provider is coming soon. Native Meta Cloud API is the only fully working integration right now.`,
      );
    }

    const missing = [];
    if (!meta?.phoneNumberId)     missing.push('phoneNumberId');
    if (!meta?.businessAccountId) missing.push('businessAccountId');
    if (!meta?.accessToken)       missing.push('accessToken');
    if (missing.length) {
      throw new AppError(400, `Cannot test connection — missing: ${missing.join(', ')}`);
    }

    const graphApiVersion = meta.graphApiVersion || 'v21.0';
    const url = `https://graph.facebook.com/${graphApiVersion}/${meta.phoneNumberId}?fields=display_phone_number,verified_name`;

    let graphResponse;
    try {
      graphResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${meta.accessToken}` },
      });
    } catch (networkError) {
      throw new AppError(502, `Could not reach Meta's Graph API — ${networkError.message}`);
    }

    const graphJson = await graphResponse.json().catch(() => ({}));

    if (!graphResponse.ok) {
      const metaMessage = graphJson?.error?.message || `HTTP ${graphResponse.status}`;
      throw new AppError(400, `Meta rejected these credentials — ${metaMessage}`);
    }

    const now = new Date();
    await whatsappSettingsRepository.update(ctx.tenantId, {
      'meta.connected': true,
      'meta.connectedAt': now,
      'meta.lastVerifiedAt': now,
      'meta.displayPhoneNumber': graphJson.display_phone_number || '',
      'meta.verifiedName': graphJson.verified_name || '',
      // The ONLY line in the entire codebase that sets providerMode to LIVE.
      providerMode: PROVIDER_MODE.LIVE,
      updatedBy: ctx.userId,
    });

    return {
      connected: true,
      provider,
      mode: PROVIDER_MODE.LIVE,
      displayPhoneNumber: graphJson.display_phone_number || '',
      verifiedName: graphJson.verified_name || '',
      message: 'Connected — credentials verified against Meta\'s Graph API. This integration is now live.',
    };
  },

  // ── Synchronisation ────────────────────────────────────────────────────────

  /**
   * Records a sync stamp for an entity. The actual data pull is delegated to
   * the owning module in production; here we stamp lastSyncAt so the dashboard
   * reflects the action and the operation is idempotent and testable.
   */
  async sync(ctx, entity) {
    await this._ensureExists(ctx);
    const now = new Date();
    const setOps = { 'sync.lastSyncAt': now, updatedBy: ctx.userId };

    // Stamp the per-entity flag as recently exercised (kept simple + honest).
    const entityFlag = {
      [SYNC_ENTITY.TEMPLATES]: 'sync.autoSyncTemplates',
      [SYNC_ENTITY.CONTACTS]:  'sync.autoSyncContacts',
      [SYNC_ENTITY.MESSAGES]:  'sync.autoSyncMessages',
      [SYNC_ENTITY.PROFILE]:   'sync.autoSyncBusinessProfile',
    }[entity];

    const updated = await whatsappSettingsRepository.update(ctx.tenantId, setOps);
    return {
      entity,
      syncedAt: now,
      flagField: entityFlag || null,
      settings: sanitize(updated),
    };
  },

  // ── Reset to defaults ──────────────────────────────────────────────────────

  async resetSettings(ctx) {
    await this._ensureExists(ctx);
    // Replace every section with defaults while preserving identity + audit.
    const setOps = flatten(DEFAULT_SETTINGS);
    setOps.updatedBy = ctx.userId;
    const updated = await whatsappSettingsRepository.update(ctx.tenantId, setOps);
    return sanitize(updated);
  },

  // ── Integration helper (NOT exposed over HTTP) ──────────────────────────────

  /**
   * Returns provider configuration INCLUDING credentials for internal use by
   * other modules (Campaigns, Broadcasts, Messages, Template Approval, …).
   * This is the single source of truth so no module hardcodes credentials.
   *
   * `providerMode` here is trustworthy precisely because nothing but
   * testConnection() (and the reset-on-provider-change logic above) is ever
   * allowed to write it.
   *
   * NEVER pass the result of this method directly into an HTTP response.
   */
  async getProviderConfig(ctx) {
    const settings = await whatsappSettingsRepository.findByTenant(ctx.tenantId);
    if (!settings) throw new AppError(404, 'WhatsApp settings not configured for this tenant');
    const o = settings.toObject ? settings.toObject() : settings;
    return {
      provider:     o.provider,
      providerMode: o.providerMode,
      panelMode:    o.panelMode,
      meta:         o.meta,        // full credentials — internal callers only
      messaging:    o.messaging,
      limits:       o.limits,
      advanced:     o.advanced,
    };
  },

  // ── Internal ───────────────────────────────────────────────────────────────

  /** Returns the tenant's settings doc, auto-provisioning one if missing. */
  async _ensureExists(ctx) {
    let existing = await whatsappSettingsRepository.findByTenant(ctx.tenantId);
    if (!existing) {
      existing = await whatsappSettingsRepository.create({
        ...DEFAULT_SETTINGS,
        tenantId:  ctx.tenantId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
    return existing;
  },
};