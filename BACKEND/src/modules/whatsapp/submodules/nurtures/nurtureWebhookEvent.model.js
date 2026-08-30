/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Webhook Event Model
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureWebhookEvent.model.js
 *
 * Real duplicate-delivery protection for the incoming webhook trigger.
 * Unlike Shopify (which provides a real X-Shopify-Event-Id header) or
 * Cal.com, a generic incoming webhook caller has no standardized
 * request-identity header this app can rely on. Real approach: hash the
 * exact raw request body -- an identical retry (the most common real
 * duplicate-delivery cause) produces an identical hash, caught by the
 * same real DB-level unique index pattern already proven for every
 * other webhook in this codebase.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const nurtureWebhookEventSchema = new Schema(
  {
    tenantId:    { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    sequenceId:  { type: Schema.Types.ObjectId, ref: 'NurtureSequence', required: true },
    bodyHash:    { type: String, required: true }, // real SHA-256 of the exact raw request body
    receivedAt:  { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Real, DB-level dedup guarantee -- an identical retry (same sequence,
// same exact body) is rejected here, not just by application logic.
nurtureWebhookEventSchema.index({ tenantId: 1, sequenceId: 1, bodyHash: 1 }, { unique: true });
// Real, bounded retention -- these records exist only to catch
// near-term retries, not as a permanent audit log (that's what the
// enrollment's own auditLog is for). Auto-expires after 24 hours.
nurtureWebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export default mongoose.model('NurtureWebhookEvent', nurtureWebhookEventSchema, 'nurture_webhook_events');