import mongoose from 'mongoose';
import {
  BOOKING_STATUS,
  BOOKING_STATUS_VALUES,
  MEETING_TYPES,
  MEETING_TYPE_VALUES,
  DEFAULT_DURATION_MINUTES,
} from './booking.constants.js';

const { Schema } = mongoose;

/**
 * Booking schema.
 *
 * NAMING CONVENTION: snake_case throughout — matches Lead and Deal models exactly.
 * Lead model: tenant_id, lead_id, assigned_user_id  (lead.model.js)
 * Deal model: tenant_id, lead_id, assigned_user_id  (deal.model.js)
 *
 * SOURCE: DEVELOPER_HANDOFF.md §6 Booking entity fields:
 *   lead_id, deal_id, meeting_date, meeting_time, meeting_type,
 *   assigned_user_id, status, source, campaign, notes
 *
 * SOURCE: MASTER_SPEC.md §I2 BookingStatus (5 values)
 * SOURCE: FRONTEND_SPEC §9 table columns: Lead|Type|Date|Time|Owner|Source|Status
 *
 * TIMESTAMP: Uses { createdAt: 'created_at', updatedAt: 'updated_at' }
 * to match Lead and Deal timestamp conventions.
 */
const bookingSchema = new Schema(
  {
    // ── Tenant scope — mandatory on every collection ──────────────────────────
    // Type String to match lead.model.js and deal.model.js (both use String)
    tenant_id: {
      type:     String,
      required: [true, 'tenant_id is required'],
      index:    true,
    },

    // ── Core relations ────────────────────────────────────────────────────────

    /**
     * lead_id — the lead this booking belongs to.
     * On create: lead.status → 'Booked' (done in booking.service.js)
     */
    lead_id: {
      type:     Schema.Types.ObjectId,
      ref:      'Lead',
      required: [true, 'lead_id is required'],
      index:    true,
    },

    /**
     * deal_id — linked pipeline deal.
     * Set after deal is created/advanced by booking.service.js createBooking().
     */
    deal_id: {
      type:    Schema.Types.ObjectId,
      ref:     'Deal',
      default: null,
    },

    /**
     * assigned_user_id — the sales rep who will take the call.
     * Shown as "Owner" in FRONTEND_SPEC §9 table.
     */
    assigned_user_id: {
      type:     String,
      default:  null,
      index:    true,
    },

    // ── Booking details ───────────────────────────────────────────────────────

    /**
     * meeting_type — type of call.
     * FRONTEND_SPEC §9 Type column: "Discovery Call", "Proposal Review"
     */
    meeting_type: {
      type:    String,
      enum:    MEETING_TYPE_VALUES,
      default: MEETING_TYPES.DISCOVERY_CALL,
    },

    /**
     * status — 5 values from MASTER_SPEC §I2 BookingStatus.
     * Inline editable in the table via dropdown (FRONTEND_SPEC §9).
     */
    status: {
      type:    String,
      enum:    BOOKING_STATUS_VALUES,
      default: BOOKING_STATUS.SCHEDULED,
      index:   true,
    },

    /**
     * meeting_date — YYYY-MM-DD string.
     * Stored as string to match frontend display (Jun 17, 2026).
     */
    meeting_date: {
      type:     String,
      required: [true, 'meeting_date is required'],
      match:    [/^\d{4}-\d{2}-\d{2}$/, 'meeting_date must be YYYY-MM-DD'],
    },

    /**
     * meeting_time — HH:MM 24-hour format.
     * FRONTEND_SPEC §9 Time column: "14:00", "11:30", "17:00"
     */
    meeting_time: {
      type:     String,
      required: [true, 'meeting_time is required'],
      match:    [/^\d{2}:\d{2}$/, 'meeting_time must be HH:MM'],
    },

    /** duration_minutes — call length in minutes. */
    duration_minutes: {
      type:    Number,
      default: DEFAULT_DURATION_MINUTES,
      min:     15,
    },

    /** meeting_link — Zoom/Google Meet/Teams URL. */
    meeting_link: {
      type:    String,
      default: null,
      trim:    true,
    },

    // ── Attribution ───────────────────────────────────────────────────────────

    /**
     * source — lead source at time of booking.
     * FRONTEND_SPEC §9 Source column: "YouTube", "Meta Ads", "Webinar"
     */
    source: {
      type:    String,
      default: null,
      trim:    true,
    },

    /** campaign — marketing campaign name at time of booking. */
    campaign: {
      type:    String,
      default: null,
      trim:    true,
    },

    // ── Notes ─────────────────────────────────────────────────────────────────

    notes: {
      type:    String,
      default: '',
      trim:    true,
    },

    // ── Rescheduling ──────────────────────────────────────────────────────────

    /**
     * rescheduled_from — links to the original booking when rescheduled.
     * Original booking.status → 'Rescheduled'.
     */
    rescheduled_from: {
      type:    Schema.Types.ObjectId,
      ref:     'Booking',
      default: null,
    },

    // ── External provider sync (added for real Cal.com integration) ─────────
    // external_source/external_id together are what makes sync genuinely
    // idempotent -- re-processing the same Cal.com booking (whether via a
    // webhook retry or a periodic sync overlap) updates the same
    // document instead of creating a duplicate. null/null for bookings
    // created natively in this app, unaffected by this addition.
    external_source: {
      type:    String,
      enum:    ['calcom', null],
      default: null,
      index:   true,
    },
    external_id: {
      type:    String,
      default: null,
      index:   true,
    },

    // ── Audit ─────────────────────────────────────────────────────────────────
    created_by: { type: String, default: null },
    updated_by: { type: String, default: null },
  },
  {
    // Match timestamp convention used by Lead and Deal models
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

// ── Indexes matching repository access patterns ───────────────────────────────
bookingSchema.index({ tenant_id: 1, status: 1 });
bookingSchema.index({ tenant_id: 1, lead_id: 1 });
bookingSchema.index({ tenant_id: 1, meeting_date: 1, status: 1 });
bookingSchema.index({ tenant_id: 1, assigned_user_id: 1, status: 1 });
// Real, DB-level dedup guarantee for externally-synced bookings -- sparse
// so this never applies to natively-created bookings (external_id: null).
bookingSchema.index(
  { tenant_id: 1, external_source: 1, external_id: 1 },
  { unique: true, sparse: true }
);

// Named export — matches Lead and Deal model export patterns
export const Booking = mongoose.model('Booking', bookingSchema);