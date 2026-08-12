/**
 * =============================================================================
 * InnovateX Revenue OS — Ad Tracking Settings Model
 * =============================================================================
 *
 * FILE: src/modules/attribution/adTrackingSettings.model.js
 *
 * Exactly ONE document per tenant (enforced by a unique index on tenantId),
 * mirroring WhatsAppSettings.model.js's exact pattern. Sensitive credentials
 * are stored here but stripped by the service before any response leaves
 * the server, same treatment as WhatsApp's accessToken/appSecret.
 *
 * Meta and Google are independent, both connectable at once -- a real
 * business commonly runs both platforms simultaneously, so this isn't a
 * single "pick one" selector the way WhatsApp provider selection is
 * (WhatsApp only ever sends through ONE active number; ad tracking
 * legitimately fans out to every platform a tenant has actually running).
 *
 * SCOPE: real Meta Conversions API + real Google Analytics 4 Measurement
 * Protocol (the closest real, directly-comparable Google analog to
 * Meta's CAPI -- simple API-key based, no OAuth, real server-to-server
 * events). This is deliberately NOT the full Google Ads API, which needs
 * OAuth2 + a developer-token approval process + a manager account -- a
 * much heavier, slower setup, not built here.
 *
 * MASTER_SPEC.md B10/PART H describes a much larger eventual vision
 * (first-party pixel, identity graph, multi-touch, TikTok Conversions
 * API, ad-spend ingestion) -- deliberately NOT built here either, to
 * match the actual scope of what was asked, not the full roadmap.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const metaAdsSchema = new Schema(
  {
    // SOURCE: real Meta Conversions API docs (developers.facebook.com) --
    // events post to /{pixelId}/events with an access_token query param.
    // "pixelId" here is Meta's own terminology, but functions as a real
    // dataset ID -- same value shown in Events Manager for a Pixel or a
    // standalone Conversions API dataset.
    pixelId:          { type: String, default: '' },
    accessToken:      { type: String, default: '' },
    // Optional -- included in every payload if set, marks test events in
    // Meta's Test Events tool without affecting real ad optimization.
    testEventCode:    { type: String, default: '' },
    connected:        { type: Boolean, default: false },
    connectedAt:      { type: Date, default: null },
    lastVerifiedAt:   { type: Date, default: null },
    lastEventSentAt:  { type: Date, default: null },
    eventsSent:       { type: Number, default: 0 },
    eventsFailed:     { type: Number, default: 0 },
  },
  { _id: false },
);

const googleAdsSchema = new Schema(
  {
    // SOURCE: real GA4 Measurement Protocol docs (developers.google.com) --
    // events post to /mp/collect with measurement_id + api_secret query
    // params. Both values come from GA4 Admin > Data Streams > your
    // stream > Measurement Protocol API secrets.
    measurementId:    { type: String, default: '' },  // format: G-XXXXXXXXXX
    apiSecret:        { type: String, default: '' },
    connected:        { type: Boolean, default: false },
    connectedAt:      { type: Date, default: null },
    lastVerifiedAt:   { type: Date, default: null },
    lastEventSentAt:  { type: Date, default: null },
    eventsSent:       { type: Number, default: 0 },
    eventsFailed:     { type: Number, default: 0 },
  },
  { _id: false },
);

const adTrackingSettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
      index:    true,
    },
    meta:   { type: metaAdsSchema,   default: () => ({}) },
    google: { type: googleAdsSchema, default: () => ({}) },
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
        // Strip real secrets before this ever leaves the server -- same
        // treatment as WhatsAppSettings' accessToken/appSecret.
        if (ret.meta) {
          ret.meta.hasAccessToken = !!ret.meta.accessToken;
          delete ret.meta.accessToken;
        }
        if (ret.google) {
          ret.google.hasApiSecret = !!ret.google.apiSecret;
          delete ret.google.apiSecret;
        }
        return ret;
      },
    },
  }
);

export default mongoose.model('AdTrackingSettings', adTrackingSettingsSchema, 'ad_tracking_settings');