/**
 * =============================================================================
 * InnovateX Revenue OS — Zoho CRM Settings Model
 * =============================================================================
 *
 * FILE: src/modules/integrations/zoho/zohoSettings.model.js
 *
 * One-way LEAD PULL only (Zoho CRM -> InnovateX Lead), per explicit
 * product decision -- no push back to Zoho. Mirrors
 * googleAdsSettings.model.js's real-OAuth-token-storage pattern exactly
 * (same encrypted-at-rest treatment via src/utils/crypto.js's
 * encrypt()/safeDecrypt(), same one-doc-per-tenant shape).
 *
 * apiDomain is real, tenant-specific state Zoho returns in the token
 * response (e.g. "https://www.zohoapis.in") -- NOT guessable from the
 * accounts domain alone, so it must be stored, not recalculated.
 *
 * SOURCE: real Zoho CRM API docs (zoho.com/crm/developer/docs/api/v8/) --
 * confirmed OAuth2 flow, confirmed REST Leads endpoint
 * ({api_domain}/crm/v2/Leads), confirmed required header
 * (Authorization: Zoho-oauthtoken {token}).
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const zohoSettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
      index:    true,
    },

    refreshToken:        { type: String, default: null }, // encrypted -- long-lived, Zoho's own refresh tokens don't expire
    accessToken:          { type: String, default: null }, // encrypted -- short-lived (~1hr)
    accessTokenExpiresAt: { type: Date, default: null },

    apiDomain:  { type: String, default: '' }, // real, returned by Zoho on token exchange
    orgName:    { type: String, default: '' },

    connected:     { type: Boolean, default: false },
    connectedAt:   { type: Date, default: null },
    lastSyncedAt:  { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    lastSyncLeadCount: { type: Number, default: 0 },

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
        ret.hasRefreshToken = !!ret.refreshToken;
        delete ret.refreshToken;
        delete ret.accessToken;
        delete ret.accessTokenExpiresAt;
        return ret;
      },
    },
  }
);

export default mongoose.model('ZohoSettings', zohoSettingsSchema, 'zoho_settings');
