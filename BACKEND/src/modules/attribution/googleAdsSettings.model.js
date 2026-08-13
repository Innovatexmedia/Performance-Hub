/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads Settings Model
 * =============================================================================
 *
 * FILE: src/modules/attribution/googleAdsSettings.model.js
 *
 * Genuinely SEPARATE from adTrackingSettings.model.js's `google` field
 * (which is GA4 Measurement Protocol) -- kept deliberately unchanged per
 * explicit instruction. This model is for real Google Ads API access:
 * campaign/spend/click/impression/conversion reporting via OAuth2, not
 * server-side conversion event sending.
 *
 * SECURITY: refreshToken and accessToken are stored using this
 * codebase's existing real AES-256-GCM encrypt()/decrypt() utility (see
 * src/utils/crypto.js) -- genuinely reversible encryption, not hashing,
 * since these tokens must be decrypted again to make real API calls
 * (unlike a password, which only ever needs comparison). This utility
 * already existed in the codebase, fully built and documented for
 * exactly this purpose, but had no real caller yet.
 *
 * SOURCE: real Google Ads API docs (developers.google.com/google-ads/api) --
 * confirmed OAuth2 flow (accounts.google.com/o/oauth2/auth →
 * oauth2.googleapis.com/token), confirmed REST reporting endpoint
 * (googleads.googleapis.com/v{version}/customers/{id}/googleAds:search),
 * confirmed required headers (developer-token, login-customer-id).
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const googleAdsSettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
      index:    true,
    },

    // ── OAuth2 tokens (encrypted at rest) ────────────────────────────────────
    refreshToken:          { type: String, default: null }, // encrypted -- long-lived, the real credential that matters most
    accessToken:            { type: String, default: null }, // encrypted -- short-lived (~1hr), cached to avoid refreshing on every call
    accessTokenExpiresAt:   { type: Date, default: null },

    // ── Real Google Ads account context ──────────────────────────────────────
    // A developer token is issued once, at the PLATFORM level (InnovateX
    // itself applies for it, per Google's real "one token per company"
    // model) -- NOT stored per-tenant. See config.js's GOOGLE_ADS_DEVELOPER_TOKEN.
    // managerCustomerId is also platform-level (InnovateX's own manager
    // account) -- sent as the real `login-customer-id` header on every
    // call. clientCustomerId is the one genuinely tenant-specific value:
    // which Google Ads account (under that manager, or independently
    // linked) this tenant's data should be pulled from.
    clientCustomerId:       { type: String, default: '' }, // 10-digit Google Ads customer ID, no dashes
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
        // strip-before-response treatment as every other provider's
        // credentials in this codebase.
        ret.hasRefreshToken = !!ret.refreshToken;
        delete ret.refreshToken;
        delete ret.accessToken;
        delete ret.accessTokenExpiresAt;
        return ret;
      },
    },
  }
);

export default mongoose.model('GoogleAdsSettings', googleAdsSettingsSchema, 'google_ads_settings');