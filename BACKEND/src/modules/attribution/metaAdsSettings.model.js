/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads Settings Model
 * =============================================================================
 *
 * FILE: src/modules/attribution/metaAdsSettings.model.js
 *
 * Genuinely SEPARATE from adTrackingSettings.model.js's `meta` field
 * (which is the Conversions API -- server-to-server event PUSH). This
 * model is for real Meta Marketing API access: campaign/spend/click/
 * impression/conversion reporting via Facebook Login OAuth, a
 * completely different Meta product and OAuth app configuration than
 * Conversions API credentials. Mirrors googleAdsSettings.model.js's
 * structure/reasoning throughout, with one real, structural difference:
 * Meta has no refresh_token grant the way Google does. A short-lived
 * user token is exchanged once for a long-lived token (~60 days), which
 * must itself be re-exchanged before it expires -- there is no separate
 * refresh credential to store, just the one long-lived access token and
 * its own expiry.
 *
 * SECURITY: accessToken is stored using this codebase's existing real
 * AES-256-GCM encrypt()/decrypt() utility (see src/utils/crypto.js) --
 * same treatment as every other provider credential in this codebase.
 *
 * SOURCE: real Meta Marketing API docs (developers.facebook.com) --
 * confirmed OAuth2 flow (facebook.com/v{version}/dialog/oauth ->
 * graph.facebook.com/v{version}/oauth/access_token), confirmed
 * long-lived token exchange (same token endpoint,
 * grant_type=fb_exchange_token), confirmed Insights API endpoint
 * (graph.facebook.com/v{version}/act_{ad_account_id}/insights).
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const metaAdsSettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
      index:    true,
    },

    // ── OAuth token (encrypted at rest) ──────────────────────────────────────
    // No refresh token -- Meta's real model is a single long-lived token
    // (~60 days) that gets re-exchanged for a fresh one before expiry,
    // not a separate refresh grant. accessTokenExpiresAt tracks that
    // real expiry so getValidAccessToken knows when to re-exchange.
    accessToken:            { type: String, default: null }, // encrypted -- the real long-lived user token
    accessTokenExpiresAt:   { type: Date, default: null },

    // ── Real Meta ad account context ─────────────────────────────────────────
    // appId/appSecret are platform-level (InnovateX's own Meta Business
    // app, per Meta's real "one app per company" model) -- NOT stored
    // per-tenant. See config.js's META_ADS_APP_ID/META_ADS_APP_SECRET.
    // adAccountId is the one genuinely tenant-specific value: which real
    // Meta ad account (act_XXXXXXXXXX) this tenant's data should be
    // pulled from.
    adAccountId:            { type: String, default: '' }, // real Meta ad account ID, WITHOUT the "act_" prefix (added at call time, same convention as clientCustomerId's no-dashes storage)
    accountName:            { type: String, default: '' }, // real display name, fetched on connect for a friendlier UI

    connected:              { type: Boolean, default: false },
    connectedAt:            { type: Date, default: null },
    lastSyncedAt:           { type: Date, default: null },
    lastSyncError:          { type: String, default: null },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref:  'User',
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
        // Real secrets never leave the server, even encrypted -- same
        // strip-before-response treatment as GoogleAdsSettings and
        // every other provider's credentials in this codebase.
        ret.hasAccessToken = !!ret.accessToken;
        delete ret.accessToken;
        delete ret.accessTokenExpiresAt;
        return ret;
      },
    },
  }
);

export default mongoose.model('MetaAdsSettings', metaAdsSettingsSchema, 'meta_ads_settings');