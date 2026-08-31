/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Webhook Event Model
 * =============================================================================
 *
 * FILE: src/modules/email/sendgridWebhookEvent.model.js
 *
 * Real, DB-level idempotency guarantee, mirroring
 * shopifyWebhookEvent.model.js's exact pattern: SendGrid's own Event
 * Webhook payload includes a real, documented sg_event_id per event
 * (docs.sendgrid.com/for-developers/tracking-events/event), unique across
 * SendGrid's own system -- this collection's unique index is what makes
 * "duplicate webhook protection" a real, enforced guarantee rather than a
 * best-effort check, regardless of how many times SendGrid retries
 * delivery (a real, documented behavior on their side, same as Shopify's).
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const sendgridWebhookEventSchema = new Schema(
  {
    sgEventId: { type: String, required: true }, // SendGrid's real sg_event_id
    eventType: { type: String, required: true }, // delivered/open/click/bounce/dropped/spamreport/unsubscribe/...
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

sendgridWebhookEventSchema.index({ sgEventId: 1 }, { unique: true });
// Real, bounded retention -- these records only ever exist to answer
// "have I seen this exact event before", not for reporting/audit (that's
// what EmailLog is for), so they don't need to accumulate forever.
sendgridWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model('SendGridWebhookEvent', sendgridWebhookEventSchema, 'sendgrid_webhook_events');
