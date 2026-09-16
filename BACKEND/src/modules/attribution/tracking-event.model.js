/**
 * TrackingEvent model.
 *
 * FILE: src/modules/attribution/tracking-event.model.js
 *
 * SOURCE: DEVELOPER_HANDOFF.md §6 TrackingEvent entity:
 *   "event_type(TrackingEventType), lead_id, source, medium, campaign, utm_*,
 *    provider_name, lifecycle_stage, metadata_json"
 *
 * SOURCE: MASTER_SPEC §B10:
 *   "Tracking-event model with 18 event types + full UTM lineage"
 *
 * PURPOSE:
 *   Every meaningful action in the platform emits a tracking event.
 *   This collection is the foundation for the Attribution page.
 *   Currently booking.service.js, call.service.js, qualification.service.js
 *   all have placeholder emitTrackingEvent() — they will now write here.
 *
 * NAMING: snake_case, timestamps: created_at/updated_at, versionKey: false
 * EXPORT: named export — matches Lead, Call, Booking, Qualification patterns
 *
 * COLLECTION: tracking_events
 */

import mongoose from 'mongoose';
import {
  TRACKING_EVENT_TYPE,
  TRACKING_EVENT_TYPE_VALUES,
  LIFECYCLE_STAGE_VALUES,
} from './attribution.constants.js';

const { Schema } = mongoose;

const trackingEventSchema = new Schema(
  {
    // ── Tenant scope ──────────────────────────────────────────────────────────
    tenant_id: {
      type:     String,
      required: [true, 'tenant_id is required'],
      index:    true,
    },

    // ── Event type ────────────────────────────────────────────────────────────
    /**
     * event_type — one of 18 defined types.
     * SOURCE: DEVELOPER_HANDOFF.md TrackingEventType (18)
     * SOURCE: FRONTEND_SPEC §11 "events by type" chart
     */
    event_type: {
      type:     String,
      enum:     TRACKING_EVENT_TYPE_VALUES,
      required: [true, 'event_type is required'],
      index:    true,
    },

    // ── Lead relation ─────────────────────────────────────────────────────────
    /**
     * lead_id — the lead this event belongs to.
     * Optional — page view events may not have a lead yet.
     */
    lead_id: {
      type:    Schema.Types.ObjectId,
      ref:     'Lead',
      default: null,
      index:   true,
    },

    // ── Attribution data ──────────────────────────────────────────────────────
    /**
     * UTM parameters + source — full attribution lineage.
     * SOURCE: DEVELOPER_HANDOFF.md "full UTM lineage"
     * Copied from the Lead at time of event creation.
     */
    source:       { type: String, default: null, trim: true, index: true },
    medium:       { type: String, default: null, trim: true },
    campaign:     { type: String, default: null, trim: true, index: true },
    utm_source:   { type: String, default: null, trim: true },
    utm_medium:   { type: String, default: null, trim: true },
    utm_campaign: { type: String, default: null, trim: true },
    utm_content:  { type: String, default: null, trim: true },
    utm_term:     { type: String, default: null, trim: true },

    /**
     * provider_name — WhatsApp/payment provider if applicable.
     * SOURCE: DEVELOPER_HANDOFF.md TrackingEvent.provider_name
     * Shown in Recent Tracking Events table (FRONTEND_SPEC §11)
     */
    provider_name: { type: String, default: null, trim: true },

    /**
     * lifecycle_stage — where in the funnel this event occurred.
     * SOURCE: DEVELOPER_HANDOFF.md TrackingEvent.lifecycle_stage
     */
    lifecycle_stage: {
      type:    String,
      enum:    [...LIFECYCLE_STAGE_VALUES, null],
      default: null,
    },

    /**
     * revenue — attributed revenue for this event (populated on PAYMENT_COMPLETED).
     * Used to compute "Revenue by Source" and "Attributed Revenue" KPI.
     * SOURCE: FRONTEND_SPEC §11 "attributed revenue", "revenue by source" chart
     */
    revenue: { type: Number, default: 0, min: 0 },
    // REAL FIX: which currency `revenue` above is actually denominated
    // in -- previously never stored as a first-class field (only
    // buried inside the free-form `metadata` object on some events),
    // so getRevenueBySource/getRevenueByCampaign had no way to tell a
    // USD-denominated payment apart from an INR one before summing them
    // together. Copied from the real Payment.currency at the exact
    // moment this event is created (see payment.service.js) -- NOT
    // re-derived from the tenant's CURRENT workspace currency setting,
    // since a tenant can change that setting later while old payments
    // stay recorded in whatever currency they actually happened in.
    currency: { type: String, default: null, trim: true },

    /**
     * metadata_json — flexible extra data per event type.
     * SOURCE: DEVELOPER_HANDOFF.md TrackingEvent.metadata_json
     * Examples:
     *   BOOKING_CREATED → { booking_id, meeting_type }
     *   PAYMENT_COMPLETED → { payment_id, amount }
     *   DEAL_WON → { deal_id, value }
     */
    metadata: { type: Schema.Types.Mixed, default: {} },

    // ── Audit ─────────────────────────────────────────────────────────────────
    created_by: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

// ── Indexes — match attribution query patterns ────────────────────────────────
// Recent events list — most common query (FRONTEND_SPEC §11 recent events table)
trackingEventSchema.index({ tenant_id: 1, created_at: -1 });
// Events by source — for "Leads by Source", "Revenue by Source" charts
trackingEventSchema.index({ tenant_id: 1, source: 1, event_type: 1 });
// Events by type — for "Tracking Events by Type" chart
trackingEventSchema.index({ tenant_id: 1, event_type: 1, created_at: -1 });
// Revenue attribution queries
trackingEventSchema.index({ tenant_id: 1, event_type: 1, revenue: 1 });

export const TrackingEvent = mongoose.model(
  'TrackingEvent',
  trackingEventSchema,
  'tracking_events'
);