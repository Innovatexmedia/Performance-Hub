
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import config from '../../../../config/config.js';
import { whatsappSettingsRepository } from './whatsappSettings.repository.js';
import { templatesService } from '../templates/templates.service.js';
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
  const hasDialog360ApiKey = !!(o.dialog360 && o.dialog360.apiKey);
  const hasTwilioAuthToken = !!(o.twilio && o.twilio.authToken);
  const hasInteraktApiKey = !!(o.interakt && o.interakt.apiKey);

  for (const path of SENSITIVE_FIELDS) unsetPath(safe, path);

  // Surface a boolean so the UI knows a token exists without exposing it.
  if (safe.meta) {
    safe.meta.hasAccessToken = hasAccessToken;
    safe.meta.hasAppSecret   = hasAppSecret;
    safe.meta.hasVerifyToken = hasVerifyToken;
  }
  if (safe.dialog360) {
    safe.dialog360.hasApiKey = hasDialog360ApiKey;
  }
  if (safe.twilio) {
    safe.twilio.hasAuthToken = hasTwilioAuthToken;
  }
  if (safe.interakt) {
    safe.interakt.hasApiKey = hasInteraktApiKey;
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
    //
    // BUG FIX: this used to be a plain findOne-then-create. Real callers can
    // genuinely race each other here -- e.g. integration.service.js's
    // listIntegrations() overlays 4 different catalog cards (meta_cloud,
    // 360dialog, twilio_wa, interakt) concurrently via Promise.all, and each
    // one independently calls getSettings() for the same tenant. On a brand
    // -new tenant with no WhatsAppSettings document yet, all 4 calls can see
    // "not found" before any of them has committed a create -- a classic
    // TOCTOU race -- and 3 of the 4 then throw a real duplicate-key error on
    // the unique tenantId index. findOneAndUpdate with upsert:true is atomic
    // at the database level, so concurrent callers safely converge on the
    // same single document instead of racing to create it.
    if (!settings) {
      settings = await whatsappSettingsRepository.upsertDefault(ctx.tenantId, {
        ...DEFAULT_SETTINGS,
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
    // App-level config the frontend's Meta JS SDK needs to actually render
    // the "Continue with Facebook" button -- the App ID and Config ID are
    // safe to expose client-side (Meta's own JS SDK requires them in the
    // browser); the App SECRET never leaves the backend. Omitted entirely
    // (embeddedSignupAvailable: false) until Tech Provider approval is
    // done and these are set -- the frontend uses this to hide the button
    // rather than show a broken one.
    safe.embeddedSignupAvailable = Boolean(config.META_TECH_PROVIDER_APP_ID && config.META_TECH_PROVIDER_APP_SECRET && config.META_EMBEDDED_SIGNUP_CONFIG_ID);
    safe.embeddedSignupAppId = config.META_TECH_PROVIDER_APP_ID || null;
    safe.embeddedSignupConfigId = config.META_EMBEDDED_SIGNUP_CONFIG_ID || null;
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
      const { meta, dialog360, twilio, interakt } = sectionPatch;

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
      if (dialog360) Object.assign(setOps, flatten({ dialog360 }));
      if (twilio) Object.assign(setOps, flatten({ twilio }));
      if (interakt) Object.assign(setOps, flatten({ interakt }));
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
   * exchangeEmbeddedSignupCode -- completes the Meta Embedded Signup flow
   * for THIS tenant. Called after the frontend's Facebook JS SDK popup
   * hands back a short-lived `code` (plus the WABA id and phone number id
   * the tenant picked during the flow).
   *
   * Uses InnovateX's OWN app-level credentials (config.META_TECH_PROVIDER_APP_ID/
   * _APP_SECRET -- see config.js's comment for why these are app-level,
   * not per-tenant) to exchange that code for a real access token scoped
   * to this specific tenant's WABA, subscribes InnovateX's app to receive
   * that WABA's webhooks (required for inbound messages/status updates to
   * ever reach us), then delegates to the EXACT SAME updateSection +
   * testConnection methods the manual-connect form already uses --
   * meaning duplicate-phoneNumberId prevention, connected-flag setting,
   * providerMode->LIVE, and display-name verification all come for free,
   * already tested, not reimplemented here.
   *
   * NOTE: implemented against Meta's documented Embedded Signup v4 flow
   * but NOT exercised against a live flow in this environment -- there is
   * no way to test this without real Tech Provider approval and a real
   * config_id, neither of which exist yet. Flagging this honestly, same
   * as the Resumable Upload API implementation earlier.
   */
  async exchangeEmbeddedSignupCode(ctx, { code, wabaId, phoneNumberId }) {
    if (!config.META_TECH_PROVIDER_APP_ID || !config.META_TECH_PROVIDER_APP_SECRET) {
      throw new AppError(400, 'Embedded Signup is not configured on this server yet -- set META_TECH_PROVIDER_APP_ID and META_TECH_PROVIDER_APP_SECRET once Meta Tech Provider approval is complete.');
    }
    if (!code || !wabaId || !phoneNumberId) {
      throw new AppError(400, 'Missing code, wabaId, or phoneNumberId from the Embedded Signup flow.');
    }

    // Step 1: exchange the short-lived code for a real access token.
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${config.META_TECH_PROVIDER_APP_ID}&client_secret=${config.META_TECH_PROVIDER_APP_SECRET}&code=${encodeURIComponent(code)}`;
    let tokenJson;
    try {
      const tokenRes = await fetch(tokenUrl);
      tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson?.error?.message || `status ${tokenRes.status}`);
      }
    } catch (err) {
      throw new AppError(502, `Meta rejected the Embedded Signup code exchange -- ${err.message}`);
    }
    const accessToken = tokenJson.access_token;

    // Step 2: subscribe InnovateX's app to this WABA's webhooks -- without
    // this, the connection succeeds but inbound messages/status updates
    // never arrive, since Meta only sends webhooks for WABAs the app has
    // explicitly subscribed to.
    try {
      const subRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!subRes.ok) {
        const subJson = await subRes.json().catch(() => ({}));
        console.error(`[EMBEDDED_SIGNUP] Failed to subscribe app to WABA ${wabaId} for tenant ${ctx.tenantId}: ${subJson?.error?.message || subRes.status}`);
        // Not fatal -- the tenant is still connected, but flagged loudly
        // since webhooks silently not arriving is a hard-to-diagnose
        // failure mode otherwise.
      }
    } catch (err) {
      console.error(`[EMBEDDED_SIGNUP] Could not reach Meta to subscribe app to WABA ${wabaId}:`, err.message);
    }

    // Step 3: save via the exact same path manual connect uses.
    await this.updateSection(ctx, 'provider', {
      provider: PROVIDER.META_CLOUD,
      panelMode: 'NATIVE',
      meta: { businessAccountId: wabaId, phoneNumberId, accessToken },
    });

    // Step 4: verify + mark connected, same real Graph API ping manual
    // connect's "Test connection" button triggers.
    return this.testConnection(ctx);
  },

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

    const { provider } = settings;

    if (provider === PROVIDER.META_CLOUD) {
      return this._testMetaConnection(ctx, settings);
    }
    if (provider === PROVIDER.DIALOG360) {
      return this._test360DialogConnection(ctx, settings);
    }
    if (provider === PROVIDER.TWILIO) {
      return this._testTwilioConnection(ctx, settings);
    }
    if (provider === PROVIDER.INTERAKT) {
      return this._testInteraktConnection(ctx, settings);
    }

    throw new AppError(
      501,
      `${provider} isn't connected yet — support for this provider is coming soon. Native Meta Cloud API, 360Dialog, Twilio, and Interakt are the only fully working integrations right now.`,
    );
  },

  async _testMetaConnection(ctx, settings) {
    const { provider, meta } = settings;

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
      // The ONLY two lines in the entire codebase that set providerMode to LIVE (the other is 360Dialog's own verification, right below).
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

  /**
   * Real 360Dialog verification. SOURCE: docs.360dialog.com (Messaging
   * API) -- base URL waba-v2.360dialog.io, single D360-API-KEY header
   * auth (no separate phoneNumberId/businessAccountId needed, since the
   * key is already scoped to one channel on 360dialog's side). Uses the
   * real GET /whatsapp_business_profile endpoint as a lightweight,
   * read-only credential check -- same role Meta's phone-number lookup
   * plays above, not a message send.
   */
  async _test360DialogConnection(ctx, settings) {
    const { provider, dialog360 } = settings;

    if (!dialog360?.apiKey) {
      throw new AppError(400, 'Cannot test connection — missing: apiKey');
    }

    const url = 'https://waba-v2.360dialog.io/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical';

    let response;
    try {
      response = await fetch(url, {
        headers: { 'D360-API-KEY': dialog360.apiKey },
      });
    } catch (networkError) {
      throw new AppError(502, `Could not reach 360Dialog's API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json?.error?.message || json?.errors?.[0]?.details || `HTTP ${response.status}`;
      throw new AppError(400, `360Dialog rejected this API key — ${message}`);
    }

    const profile = json?.data?.[0] || json;
    const now = new Date();
    await whatsappSettingsRepository.update(ctx.tenantId, {
      'dialog360.connected': true,
      'dialog360.connectedAt': now,
      'dialog360.lastVerifiedAt': now,
      'dialog360.about': profile?.about || '',
      providerMode: PROVIDER_MODE.LIVE,
      updatedBy: ctx.userId,
    });

    return {
      connected: true,
      provider,
      mode: PROVIDER_MODE.LIVE,
      about: profile?.about || '',
      message: 'Connected — API key verified against 360Dialog\'s real Messaging API. This integration is now live.',
    };
  },

  /**
   * Real Twilio verification. SOURCE: real Twilio API docs
   * (twilio.com/docs/whatsapp) -- Twilio uses HTTP Basic Auth
   * (accountSid:authToken), not a bearer token or single API key. Uses
   * the real GET /Accounts/{sid}.json endpoint as a lightweight,
   * read-only credential check -- fails with a real 401 if the
   * Account SID/Auth Token pair is wrong, same role the Meta and
   * 360Dialog checks play above.
   */
  async _testTwilioConnection(ctx, settings) {
    const { provider, twilio } = settings;

    const missing = [];
    if (!twilio?.accountSid)     missing.push('accountSid');
    if (!twilio?.authToken)      missing.push('authToken');
    if (!twilio?.whatsappNumber) missing.push('whatsappNumber');
    if (missing.length) {
      throw new AppError(400, `Cannot test connection — missing: ${missing.join(', ')}`);
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}.json`;
    const basicAuth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64');

    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });
    } catch (networkError) {
      throw new AppError(502, `Could not reach Twilio's API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json?.message || `HTTP ${response.status}`;
      throw new AppError(400, `Twilio rejected these credentials — ${message}`);
    }

    const now = new Date();
    await whatsappSettingsRepository.update(ctx.tenantId, {
      'twilio.connected': true,
      'twilio.connectedAt': now,
      'twilio.lastVerifiedAt': now,
      'twilio.friendlyName': json.friendly_name || '',
      providerMode: PROVIDER_MODE.LIVE,
      updatedBy: ctx.userId,
    });

    return {
      connected: true,
      provider,
      mode: PROVIDER_MODE.LIVE,
      friendlyName: json.friendly_name || '',
      message: 'Connected — credentials verified against Twilio\'s real Account API. This integration is now live.',
    };
  },

  /**
   * Real Interakt verification. SOURCE: real Interakt API docs
   * (interakt.shop/resource-center) -- Authorization header is literally
   * 'Basic <API Key>' with the raw key, NOT a base64-encoded
   * username:password pair (confirmed directly from Interakt's own
   * Postman examples -- this is genuinely different from Twilio's Basic
   * Auth, which does require that encoding). Uses their real, documented
   * Get Users endpoint (limit=1) as a lightweight, read-only credential
   * check -- fails with a real 401/403 if the key is wrong.
   *
   * IMPORTANT LIMITATION, surfaced honestly rather than silently: unlike
   * Meta/360Dialog/Twilio, Interakt's real public Send Message API
   * (POST /v1/public/message/) is template-only -- every documented
   * example requires a pre-approved template name, with no free-text
   * "session message" option. This means credentials CAN be genuinely
   * verified here, but InteraktProvider.sendMessage() (see
   * interakt.provider.js) will throw a clear error for the app's normal
   * free-text send flow until real template support exists elsewhere.
   */
  async _testInteraktConnection(ctx, settings) {
    const { provider, interakt } = settings;

    if (!interakt?.apiKey) {
      throw new AppError(400, 'Cannot test connection — missing: apiKey');
    }

    const url = 'https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=1';

    let response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Basic ${interakt.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (networkError) {
      throw new AppError(502, `Could not reach Interakt's API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json?.message || json?.error || `HTTP ${response.status}`;
      throw new AppError(400, `Interakt rejected this API key — ${message}`);
    }

    const now = new Date();
    await whatsappSettingsRepository.update(ctx.tenantId, {
      'interakt.connected': true,
      'interakt.connectedAt': now,
      'interakt.lastVerifiedAt': now,
      providerMode: PROVIDER_MODE.LIVE,
      updatedBy: ctx.userId,
    });

    return {
      connected: true,
      provider,
      mode: PROVIDER_MODE.LIVE,
      message: 'Connected — API key verified against Interakt\'s real API. Note: Interakt only supports pre-approved template messages, not free text — sending will be limited until template support is added.',
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

    // TEMPLATES is the only entity with a REAL sync implementation --
    // it actually calls Meta's GET /message_templates and reconciles our
    // DB against it (see templatesService.syncFromMeta). CONTACTS/MESSAGES/
    // PROFILE below remain the original stub: they only stamp a
    // "last synced" timestamp and don't call any real API yet. Flagged
    // here explicitly rather than silently -- these three still need
    // their own real implementations as a separate piece of work.
    let result = null;
    if (entity === SYNC_ENTITY.TEMPLATES) {
      result = await templatesService.syncFromMeta(ctx);
    }

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
      // null for CONTACTS/MESSAGES/PROFILE -- honestly reflects that
      // nothing real happened for those yet, rather than implying it did.
      result,
      implemented: entity === SYNC_ENTITY.TEMPLATES,
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
      dialog360:    o.dialog360,   // full credentials — internal callers only
      twilio:       o.twilio,      // full credentials — internal callers only
      interakt:     o.interakt,    // full credentials — internal callers only
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