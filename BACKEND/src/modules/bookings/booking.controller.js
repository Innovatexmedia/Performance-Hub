import * as bookingService from './booking.service.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * getBookings — GET /api/bookings
 * Query params use snake_case matching validator and model field names.
 */
export const getBookings = asyncHandler(async (req, res) => {
  const filter = {
    status:           req.query.status,
    assigned_user_id: req.query.assigned_user_id,
    meeting_type:     req.query.meeting_type,
    source:           req.query.source,
    date_from:        req.query.date_from,
    date_to:          req.query.date_to,
  };
  const options = {
    page:  parseInt(req.query.page)  || 1,
    limit: parseInt(req.query.limit) || 20,
  };

  const result = await bookingService.getBookings(req.user.tenantId, filter, options);
  return sendPaginated(res, result.bookings, result.pagination, 'Bookings fetched successfully');
});

/**
 * getKpis — GET /api/bookings/kpis
 * Returns { total, upcoming, completed, noShows, cancelled, rescheduled }
 * SOURCE: FRONTEND_SPEC §9 — 4 KPI cards
 */
export const getKpis = asyncHandler(async (req, res) => {
  const kpis = await bookingService.getKpiSummary(req.user.tenantId);
  return sendSuccess(res, kpis, 'KPIs fetched successfully');
});

/**
 * getBooking — GET /api/bookings/:id
 */
export const getBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.getBookingById(req.user.tenantId, req.params.id);
  return sendSuccess(res, { booking }, 'Booking fetched successfully');
});

/**
 * createBooking — POST /api/bookings
 * Body uses snake_case: lead_id, assigned_user_id, meeting_date, meeting_time etc.
 * Triggers: lead→Booked, deal→'Booked Call', activity log, notification.
 */
export const createBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.createBooking(req.body, req.user);
  return sendCreated(res, { booking }, 'Booking created successfully');
});

/**
 * updateBooking — PATCH /api/bookings/:id
 * Generic edit: meeting_type, assigned_user_id, meeting_link,
 * duration_minutes, notes. Does not touch status or move the meeting
 * time -- see updateStatus/reschedule below for those.
 */
export const updateBooking = asyncHandler(async (req, res) => {
  const updated = await bookingService.updateBooking(
    req.user.tenantId,
    req.params.id,
    req.body,
    req.user
  );
  return sendSuccess(res, { booking: updated }, 'Booking updated successfully');
});

/**
 * updateStatus — PATCH /api/bookings/:id/status
 * Inline status update — the dropdown in the table (FRONTEND_SPEC §9).
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const updated = await bookingService.updateBookingStatus(
    req.user.tenantId,
    req.params.id,
    req.body.status,
    req.user
  );
  return sendSuccess(res, { booking: updated }, 'Booking status updated');
});

/**
 * reschedule — POST /api/bookings/:id/reschedule
 */
export const reschedule = asyncHandler(async (req, res) => {
  const newBooking = await bookingService.rescheduleBooking(
    req.user.tenantId,
    req.params.id,
    req.body,
    req.user
  );
  return sendCreated(res, { booking: newBooking }, 'Booking rescheduled successfully');
});

/**
 * getBookingsByLead — GET /api/bookings/lead/:leadId
 * All bookings for a lead — used in lead detail drawer linked counts.
 */
export const getBookingsByLead = asyncHandler(async (req, res) => {
  const bookings = await bookingService.getBookingsByLead(
    req.user.tenantId,
    req.params.leadId
  );
  return sendSuccess(res, { bookings }, 'Lead bookings fetched successfully');
});