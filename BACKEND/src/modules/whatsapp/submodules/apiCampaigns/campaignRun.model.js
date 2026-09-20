/**
 * CampaignRun — one execution of a campaign.
 *
 * WHY THIS EXISTS
 * ───────────────
 * A dashboard campaign is sent once: its own counters ARE the result, which is
 * why the existing WhatsAppCampaign carries `metrics` directly. An API
 * campaign is the opposite — the same campaign is triggered over and over, with
 * different recipients each time. Aggregate counters alone would make a
 * customer's real question unanswerable: "the call I made at 14:32 — did those
 * 40 messages land?"
 *
 * So each trigger gets a row. The campaign keeps its aggregate counters
 * (unchanged, so existing analytics keep working); the run holds the per-call
 * detail.
 *
 * WHAT IT IS NOT
 * ──────────────
 * Not a second send engine. A run is a record plus a status; the sending is
 * still the existing queue → worker → messageSender path. The only thing the
 * worker does differently is increment the run's counters alongside the
 * campaign's.
 */

import mongoose from 'mongoose';
const { Schema } = mongoose;

export const RUN_STATUS = Object.freeze({
  /** Accepted and enqueued. The API returns at this point. */
  QUEUED: 'QUEUED',
  /** At least one job has been picked up. */
  RUNNING: 'RUNNING',
  /** Every recipient has been attempted. */
  COMPLETED: 'COMPLETED',
  /** Every attempt failed, or the run was rejected before enqueueing. */
  FAILED: 'FAILED',
});
export const RUN_STATUS_VALUES = Object.freeze(Object.values(RUN_STATUS));

export const RUN_SOURCE = Object.freeze({
  API: 'API',
  DASHBOARD: 'DASHBOARD',
});

/**
 * Per-recipient outcome, kept only for recipients that were REJECTED before
 * enqueueing (bad phone, opted out, missing required variable).
 *
 * Deliberately not a row per accepted recipient: those already produce a
 * Message and a DeliveryLog, and duplicating thousands of them here would make
 * this document unbounded. Rejections have no such record anywhere else, and
 * without them a customer sending 500 contacts and seeing 480 queued has no
 * way to find out which 20 were dropped or why.
 */
const rejectedRecipientSchema = new Schema(
  {
    phone:  { type: String, required: true },
    reason: { type: String, required: true },
    code:   { type: String, default: '' },
  },
  { _id: false }
);

const campaignRunSchema = new Schema(
  {
    tenantId:   { type: String, required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'WhatsAppCampaign', required: true, index: true },

    source: { type: String, enum: Object.values(RUN_SOURCE), default: RUN_SOURCE.API },
    status: { type: String, enum: RUN_STATUS_VALUES, default: RUN_STATUS.QUEUED, index: true },

    /** Which key triggered it. Null for dashboard-sourced runs. Kept even
     *  after the key is revoked, which is why keys are revoked, not deleted. */
    apiKeyId:     { type: Schema.Types.ObjectId, ref: 'ApiKey', default: null },
    apiKeyPrefix: { type: String, default: '' },

    /** Echoed back to the caller and used for correlation in support. */
    idempotencyKey: { type: String, default: null, index: true },

    // ── Counters ────────────────────────────────────────────────────────────
    /** What the caller sent us. */
    requestedCount: { type: Number, default: 0, min: 0 },
    /** What passed validation and reached the queue. */
    queuedCount:    { type: Number, default: 0, min: 0 },
    /** Rejected before enqueueing — see rejectedRecipients. */
    rejectedCount:  { type: Number, default: 0, min: 0 },

    /** Incremented by the worker, exactly like campaign metrics. */
    sentCount:    { type: Number, default: 0, min: 0 },
    failedCount:  { type: Number, default: 0, min: 0 },
    skippedCount: { type: Number, default: 0, min: 0 },

    rejectedRecipients: { type: [rejectedRecipientSchema], default: [] },

    failureReason: { type: String, default: '' },
    startedAt:     { type: Date, default: null },
    completedAt:   { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// "Recent runs" for one campaign, newest first — the dashboard's main query.
campaignRunSchema.index({ tenantId: 1, campaignId: 1, created_at: -1 });

export const CampaignRun = mongoose.model('CampaignRun', campaignRunSchema);
export default CampaignRun;