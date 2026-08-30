import * as bookingRepo from './booking.repository.js';
import {
  BOOKING_STATUS,
  PIPELINE_STAGE_ON_BOOKING,
  LEAD_STATUS_ON_BOOKING,
  LEAD_STATUS_ON_COMPLETION,
  TRACKING_EVENT_ON_BOOKING,
} from './booking.constants.js';

// Named imports — Lead and Deal use named exports (export const Lead / export const Deal)
import { Lead } from '../leads/lead/lead.model.js';
import { Deal } from '../pipeline/deals/deal.model.js';

// ACTIVITY_TYPE from activity.model.js — includes BOOKING_* types
import { ACTIVITY_TYPE } from '../leads/activities/activity.model.js';
import { activityService } from '../leads/activities/activity.service.js';

// Notification model — uses tenantId (String) and body field
import Notification from '../leads/notifications/notification.model.js';

// AppError — from shared helpers matching lead.service.js pattern
import { AppError, paginationMeta } from '../../shared/helpers/lead.helpers.js';
import { NurtureEnrollment, NurtureSequence } from '../whatsapp/submodules/nurtures/nurtures.model.js';
import { ENROLLMENT_STATUS, TRIGGER_TYPE, SEQUENCE_STATUS } from '../whatsapp/submodules/nurtures/nurtures.constants.js';
import { nurturesService } from '../whatsapp/submodules/nurtures/nurtures.service.js';
// Real tracking-event writer -- same import every other module that calls
// emitTrackingEvent/createTrackingEvent already uses (lead/call/qualification/
// payment.service.js). This was missing here, which is why calling this
// file's own emitTrackingEvent() below threw "createTrackingEvent is not
// defined" at runtime -- the function body referenced it but nothing ever
// imported it into this file's scope.
import { createTrackingEvent } from '../attribution/attribution.service.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * buildCtx — converts req.user (JWT shape) to the ctx shape used by
 * activityService.log() and all existing services.
 * req.user = { sub, tenantId, role, sessionId }  (from auth.middleware.js)
 * ctx      = { tenantId, userId, role }           (used by all lead services)
 */
const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/**
 * logActivity — logs a booking event to the lead activity timeline.
 * Wraps activityService.log() — non-blocking, never throws into caller.
 */
const logActivity = async (ctx, leadId, type, message, meta = {}) => {
  try {
    await activityService.log(ctx, leadId, type, { message, meta });
  } catch (err) {
    console.warn(`[booking] activity log failed for lead ${leadId}: ${err.message}`);
  }
};

/**
 * createNotification — creates an in-app notification.
 * Notification model fields: tenantId (String), userId (ObjectId), title, body, isRead, metadata
 * Non-blocking — notification failure never crashes a booking operation.
 */
const createNotification = async (tenantId, userId, title, body, metadata = {}) => {
  try {
    if (!userId) return;
    await Notification.create({ tenantId, userId, title, body, isRead: false, metadata });
  } catch (err) {
    console.warn(`[booking] notification failed: ${err.message}`);
  }
};

/**
 * emitTrackingEvent — placeholder until the tracking module is built.
 * SOURCE: MASTER_SPEC §I2 TrackingEventType — 18 event types
 */
const emitTrackingEvent = async (eventType, leadId, tenantId, metadata = {}) => {
  await createTrackingEvent({ tenant_id: tenantId, event_type: eventType, lead_id: leadId, ...metadata }).catch(() => {});
};

// =============================================================================
// GET BOOKINGS — paginated list
// =============================================================================

export const getBookings = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [bookings, total] = await Promise.all([
    bookingRepo.findByTenantId(tenantId, filter, { skip, limit }),
    bookingRepo.countByTenantId(tenantId, filter),
  ]);

  return {
    bookings,
    pagination: paginationMeta({ page, limit, total }),
  };
};

// =============================================================================
// GET SINGLE BOOKING
// =============================================================================

export const getBookingById = async (tenantId, id) => {
  const booking = await bookingRepo.findById(tenantId, id);
  if (!booking) throw AppError.notFound('Booking not found');
  return booking;
};

// =============================================================================
// GET KPI SUMMARY — 4 cards in FRONTEND_SPEC §9
// =============================================================================

export const getKpiSummary = (tenantId) => bookingRepo.getKpiCounts(tenantId);

// =============================================================================
// COUNT BOOKINGS BY LEAD — used by lead.service.js getLeadDetails()
// =============================================================================

export const countBookingsByLead = (tenantId, leadId) =>
  bookingRepo.countByLead(tenantId, leadId);

// =============================================================================
// CREATE BOOKING
// =============================================================================

/**
 * createBooking — creates a booking and fires all connected side effects.
 *
 * CONNECTED EFFECTS (DEVELOPER_HANDOFF.md §8 + MASTER_SPEC §B8):
 *   1. Verify lead exists in tenant
 *   2. Create booking document
 *   3. Update lead.status → 'Booked'
 *   4. Create or advance pipeline deal → 'Booked Call' stage
 *   5. Link deal._id back to booking
 *   6. Log 'Booking Created' to lead activity timeline
 *   7. Create in-app notification for assigned user
 *   8. Emit tracking event
 *
 * @param {Object} data    — validated request body (snake_case field names)
 * @param {Object} reqUser — req.user from authenticate middleware
 *                           { sub, tenantId, role, sessionId }
 */
export const createBooking = async (data, reqUser) => {
  const ctx = buildCtx(reqUser);

  // ── 1. Verify lead exists in this tenant ──────────────────────────────────
  // Lead uses tenant_id (String) — must use String(tenantId) for comparison
  const lead = await Lead.findOne({
    _id:       data.lead_id,
    tenant_id: String(ctx.tenantId),
    archived:  false,
  });
  if (!lead) throw AppError.notFound('Lead not found in this workspace');

  // ── 2. Create booking document ────────────────────────────────────────────
  const booking = await bookingRepo.create({
    tenant_id:        ctx.tenantId,
    lead_id:          data.lead_id,
    assigned_user_id: data.assigned_user_id || null,
    meeting_type:     data.meeting_type || 'Discovery Call',
    meeting_date:     data.meeting_date,
    meeting_time:     data.meeting_time,
    duration_minutes: data.duration_minutes || 30,
    meeting_link:     data.meeting_link    || null,
    source:           lead.source          || null,
    campaign:         lead.campaign        || null,
    notes:            data.notes           || '',
    status:           BOOKING_STATUS.SCHEDULED,
    created_by:       ctx.userId,
  });

  // ── 3. Update lead.status → 'Booked' ─────────────────────────────────────
  // leadRepository.updateById(tenantId, id, patch) — matching existing pattern
  await Lead.findOneAndUpdate(
    { _id: data.lead_id, tenant_id: String(ctx.tenantId) },
    { $set: { status: LEAD_STATUS_ON_BOOKING } }
  );

  // Real pause-on-booking -- a lead who just booked a real meeting
  // shouldn't keep receiving automated nurture messages. Best-effort,
  // same principle as every other non-critical side effect in this flow.
  await NurtureEnrollment.updateMany(
    { tenantId: String(ctx.tenantId), leadId: data.lead_id, status: ENROLLMENT_STATUS.ACTIVE },
    {
      $set: { status: ENROLLMENT_STATUS.PAUSED, pauseReason: 'BOOKED', nextExecutionAt: null },
      $push: { auditLog: { action: 'PAUSE', performedAt: new Date(), note: 'Lead booked a meeting' } },
    },
  ).catch((err) => {
    console.error('[nurture] failed to pause enrollments on booking for lead', String(data.lead_id), err);
  });

  // Real auto-enroll for sequences configured with triggerType
  // BOOKING_CREATED (e.g. a pre-call preparation sequence) -- genuinely
  // complementary to the pause above, not conflicting: pause stops
  // general nurturing now that they've booked, this starts a sequence
  // specifically meant to run BECAUSE they booked. Was previously a
  // dead trigger type -- selectable and storable, never acted on.
  (async () => {
    try {
      const matchingSequences = await NurtureSequence.find({
        tenantId: String(ctx.tenantId),
        status: SEQUENCE_STATUS.ACTIVE,
        triggerType: TRIGGER_TYPE.BOOKING_CREATED,
      });
      for (const seq of matchingSequences) {
        await nurturesService.enrollLead(ctx, String(seq._id), { leadId: String(data.lead_id) }).catch((err) => {
          console.warn(`[nurture] BOOKING_CREATED auto-enroll failed for lead ${data.lead_id}, sequence ${seq._id}: ${err.message}`);
        });
      }
    } catch (err) {
      console.warn(`[nurture] BOOKING_CREATED auto-enroll lookup failed for lead ${data.lead_id}: ${err.message}`);
    }
  })();

  // ── 4. Create or advance pipeline deal → 'Booked Call' ───────────────────
  // Deal uses: tenant_id (String), lead_id (ObjectId), assigned_user_id (String)
  // PIPELINE_STAGE_ON_BOOKING = 'Booked Call' (matches DEAL_STAGE.BOOKED_CALL)
  // Closed stages from deal.constants.js: 'Won', 'Lost'
  const openDeal = await Deal.findOne({
    tenant_id: String(ctx.tenantId),
    lead_id:   data.lead_id,
    archived:  false,
    stage:     { $nin: ['Won', 'Lost'] },
  }).sort({ created_at: -1 });

  let deal = null;

  if (openDeal) {
    deal = await Deal.findOneAndUpdate(
      { _id: openDeal._id, tenant_id: String(ctx.tenantId) },
      {
        $set:  { stage: PIPELINE_STAGE_ON_BOOKING },
        $push: {
          stageHistory: {
            stage:   PIPELINE_STAGE_ON_BOOKING,
            movedAt: new Date(),
            movedBy: ctx.userId,
          },
        },
      },
      { new: true }
    );
  } else {
    // Deal.create requires: tenant_id, lead_id, title (required), stage
    deal = await Deal.create({
      tenant_id:        String(ctx.tenantId),
      lead_id:          data.lead_id,
      assigned_user_id: data.assigned_user_id || null,
      title:            `${lead.name || lead.email || 'Lead'} — Booking`,
      stage:            PIPELINE_STAGE_ON_BOOKING,
      probability:      40,
      source:           lead.source || null,
      value:            0,
      stageHistory: [{
        stage:   PIPELINE_STAGE_ON_BOOKING,
        movedAt: new Date(),
        movedBy: ctx.userId,
      }],
    });
  }

  // ── 5. Link deal back to booking ──────────────────────────────────────────
  if (deal) {
    await bookingRepo.updateById(ctx.tenantId, booking._id, { deal_id: deal._id });
  }

  // ── 6. Log to lead activity timeline ──────────────────────────────────────
  await logActivity(
    ctx,
    data.lead_id,
    ACTIVITY_TYPE.BOOKING_CREATED,
    `${data.meeting_type || 'Meeting'} booked for ${data.meeting_date} at ${data.meeting_time}`,
    {
      booking_id:   String(booking._id),
      meeting_type: data.meeting_type,
      meeting_date: data.meeting_date,
      meeting_time: data.meeting_time,
    }
  );

  // ── 7. Create in-app notification ─────────────────────────────────────────
  await createNotification(
    String(ctx.tenantId),
    data.assigned_user_id,
    'New Booking Created',
    `${data.meeting_type || 'Meeting'} scheduled with ${lead.name || lead.email} on ${data.meeting_date} at ${data.meeting_time}`,
    { booking_id: String(booking._id), lead_id: String(data.lead_id) }
  );

  // ── 8. Emit tracking event ────────────────────────────────────────────────
  emitTrackingEvent(TRACKING_EVENT_ON_BOOKING, data.lead_id, ctx.tenantId, {
    booking_id:   String(booking._id),
    meeting_type: data.meeting_type,
    meeting_date: data.meeting_date,
  });

  return booking;
};

// =============================================================================
// UPDATE BOOKING STATUS
// =============================================================================

/**
 * updateBookingStatus — updates status with connected side effects.
 * SOURCE: FRONTEND_SPEC §9 "status inline editable"
 *
 * Side effects:
 *   Completed → lead.status = 'Call Completed'
 *   Cancelled / No Show → log activity only
 */
export const updateBookingStatus = async (tenantId, id, status, reqUser) => {
  const ctx = buildCtx(reqUser);

  const booking = await bookingRepo.findById(tenantId, id);
  if (!booking) throw AppError.notFound('Booking not found');

  if (!BOOKING_STATUS_VALUES_SET.has(status)) {
    throw AppError.badRequest(`Invalid status: ${status}`);
  }

  if (
    booking.status === BOOKING_STATUS.COMPLETED &&
    status === BOOKING_STATUS.SCHEDULED
  ) {
    throw AppError.badRequest('Cannot revert a completed booking to scheduled');
  }

  const updated = await bookingRepo.updateById(tenantId, id, {
    status,
    updated_by: ctx.userId,
  });

  const leadId = booking.lead_id;

  if (status === BOOKING_STATUS.COMPLETED) {
    await Lead.findOneAndUpdate(
      { _id: leadId, tenant_id: String(tenantId) },
      { $set: { status: LEAD_STATUS_ON_COMPLETION } }
    );
    await logActivity(
      ctx, leadId,
      ACTIVITY_TYPE.BOOKING_COMPLETED,
      `${booking.meeting_type || 'Meeting'} completed on ${booking.meeting_date}`,
      { booking_id: id }
    );
  }

  if (status === BOOKING_STATUS.CANCELLED) {
    await logActivity(
      ctx, leadId,
      ACTIVITY_TYPE.BOOKING_CANCELLED,
      `${booking.meeting_type || 'Meeting'} cancelled`,
      { booking_id: id }
    );
  }

  if (status === BOOKING_STATUS.NO_SHOW) {
    await logActivity(
      ctx, leadId,
      ACTIVITY_TYPE.BOOKING_NO_SHOW,
      `${booking.meeting_type || 'Meeting'} — no show on ${booking.meeting_date}`,
      { booking_id: id }
    );
  }

  return updated;
};

// Precompute set for O(1) status validation
const BOOKING_STATUS_VALUES_SET = new Set(Object.values(BOOKING_STATUS));

// =============================================================================
// RESCHEDULE BOOKING
// =============================================================================

/**
 * rescheduleBooking — marks original as Rescheduled, creates new booking.
 * SOURCE: MASTER_SPEC §B8 "Rescheduled" status
 * SOURCE: FRONTEND_SPEC §9 — Hannah Kim row shows "Rescheduled"
 */
export const rescheduleBooking = async (tenantId, originalId, newData, reqUser) => {
  const ctx = buildCtx(reqUser);

  const original = await bookingRepo.findById(tenantId, originalId);
  if (!original) throw AppError.notFound('Booking not found');

  if (original.status === BOOKING_STATUS.COMPLETED) {
    throw AppError.badRequest('Cannot reschedule a completed booking');
  }

  await bookingRepo.updateById(tenantId, originalId, {
    status:     BOOKING_STATUS.RESCHEDULED,
    updated_by: ctx.userId,
  });

  const newBooking = await bookingRepo.create({
    tenant_id:        tenantId,
    lead_id:          original.lead_id,
    deal_id:          original.deal_id  || null,
    assigned_user_id: original.assigned_user_id || null,
    meeting_type:     original.meeting_type,
    meeting_date:     newData.meeting_date,
    meeting_time:     newData.meeting_time,
    duration_minutes: newData.duration_minutes || original.duration_minutes,
    meeting_link:     newData.meeting_link    || original.meeting_link || null,
    source:           original.source,
    campaign:         original.campaign,
    notes:            newData.notes || '',
    status:           BOOKING_STATUS.SCHEDULED,
    rescheduled_from: originalId,
    created_by:       ctx.userId,
  });

  await logActivity(
    ctx,
    original.lead_id,
    ACTIVITY_TYPE.BOOKING_RESCHEDULED,
    `${original.meeting_type || 'Meeting'} rescheduled to ${newData.meeting_date} at ${newData.meeting_time}`,
    {
      original_booking_id: String(originalId),
      new_booking_id:      String(newBooking._id),
    }
  );

  return newBooking;
};

// =============================================================================
// GET BOOKINGS BY LEAD — for lead detail drawer
// =============================================================================

/**
 * getBookingsByLead — all bookings for a specific lead.
 * SOURCE: FRONTEND_SPEC §4 lead drawer "linked record counts (bookings)"
 */
export const getBookingsByLead = (tenantId, leadId) =>
  bookingRepo.findByLead(tenantId, leadId);