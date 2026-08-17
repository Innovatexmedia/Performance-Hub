/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Webhook Event Model
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifyWebhookEvent.model.js
 *
 * Real, generic idempotency tracking across all 5 webhook topics. Unlike
 * Cal.com (which had no dedicated event ID, so dedup relied on the
 * booking's own uid), Shopify's real webhook headers include a genuine,
 * dedicated X-Shopify-Event-Id -- confirmed from Shopify's own docs.
 * This collection is a real, DB-level unique-index guarantee that the
 * same event is never processed twice, regardless of how many times
 * Shopify retries delivery (a real, documented behavior on their side).
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const shopifyWebhookEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    eventId:  { type: String, required: true }, // Shopify's real X-Shopify-Event-Id
    topic:    { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

shopifyWebhookEventSchema.index({ tenantId: 1, eventId: 1 }, { unique: true });
// Real, bounded retention -- these records only ever exist to answer
// "have I seen this exact event before", not for reporting/audit, so
// they don't need to accumulate forever.
shopifyWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model('ShopifyWebhookEvent', shopifyWebhookEventSchema, 'shopify_webhook_events');