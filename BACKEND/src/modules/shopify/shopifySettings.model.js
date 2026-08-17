/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Settings Model
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifySettings.model.js
 *
 * Real Shopify integration credentials, per tenant. Given its own
 * dedicated module (not attribution or bookings) since this integration
 * spans Lead sync + WhatsApp triggers, not one existing module's concern
 * -- same "large integration gets its own home" precedent as Cal.com
 * living in bookings/.
 *
 * SOURCE: real, current Shopify docs (shopify.dev), confirmed before
 * building:
 *   - New public apps MUST use the GraphQL Admin API (REST is legacy as
 *     of Oct 2024; GraphQL-only required for new apps since Apr 2025) --
 *     the provider adapter for this integration is GraphQL, not REST,
 *     unlike every other provider built so far this session.
 *   - Auth: real OAuth 2.0, offline access tokens (don't expire until
 *     the merchant uninstalls the app) -- same "long-lived credential,
 *     genuinely encrypt it" treatment as Google Ads' refresh token and
 *     Cal.com's API key.
 *   - Real, requested scopes kept minimal on purpose: read_customers,
 *     read_orders, write_customers (no read_all_orders -- that requires
 *     a SEPARATE Shopify approval and isn't needed for real-time
 *     webhook-driven flows, only historical bulk access).
 *
 * SECURITY: accessToken encrypted at rest via this codebase's real
 * AES-256-GCM utility (src/utils/crypto.js), same as Google Ads/Cal.com.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const shopifySettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
      index:    true,
    },

    // ── Real shop + credentials ───────────────────────────────────────────────
    shopDomain:   { type: String, default: '' }, // real format: {shop}.myshopify.com
    accessToken:  { type: String, default: null }, // encrypted -- real offline OAuth token
    scopes:       { type: [String], default: [] }, // real granted scopes, as Shopify actually reports them back

    // ── Real webhook registrations (Shopify returns a real numeric/gid ID per topic) ─
    webhookIds: {
      checkoutsCreate: { type: String, default: null },
      checkoutsUpdate: { type: String, default: null },
      ordersCreate:    { type: String, default: null },
      ordersUpdated:   { type: String, default: null },
      customersCreate: { type: String, default: null },
    },

    // ── Connection state ──────────────────────────────────────────────────────
    connected:      { type: Boolean, default: false },
    connectedAt:    { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    lastSyncedAt:   { type: Date, default: null },
    lastSyncError:  { type: String, default: null },
    shopName:       { type: String, default: '' }, // real store display name, fetched on connect

    // ── Real abandoned-cart detection config ──────────────────────────────────
    // No dedicated Shopify webhook exists for this (confirmed) -- real
    // reconciliation window instead, configurable per tenant.
    abandonedCartMinutes: { type: Number, default: 60, min: 15 },

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
        ret.hasAccessToken = !!ret.accessToken;
        delete ret.accessToken;
        return ret;
      },
    },
  }
);

export default mongoose.model('ShopifySettings', shopifySettingsSchema, 'shopify_settings');