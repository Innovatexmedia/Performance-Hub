import { apiClient } from '@/lib/apiClient';
import type {
  Booking, BookingInput, BookingListQuery, BookingKpis, BookingUpdateInput, RescheduleInput,
} from '@/types/booking';

/**
 * SOURCE: src/modules/bookings/booking.controller.js
 * Unlike Leads/Pipeline, single-resource responses here wrap the booking in
 * a named key -- { data: { booking: {...} } } -- not the object directly.
 * Confirmed per-endpoint from the actual controller, not assumed uniform.
 */
export const bookingsApi = {
  /** GET /api/bookings -- paginated, data is the bookings array directly. */
  list: (query?: BookingListQuery) =>
    apiClient.getPaginated<Booking>('/bookings', query as Record<string, string | number | boolean | undefined>),

  /** GET /api/bookings/kpis */
  getKpis: () => apiClient.get<BookingKpis>('/bookings/kpis'),

  /** GET /api/bookings/:id -- wrapped in { booking }. */
  get: (id: string) => apiClient.get<{ booking: Booking }>(`/bookings/${id}`).then((r) => r.booking),

  /** GET /api/bookings/lead/:leadId -- wrapped in { bookings }. */
  listByLead: (leadId: string) =>
    apiClient.get<{ bookings: Booking[] }>(`/bookings/lead/${leadId}`).then((r) => r.bookings),

  /** POST /api/bookings -- wrapped in { booking }. */
  create: (input: BookingInput) =>
    apiClient.post<{ booking: Booking }>('/bookings', input).then((r) => r.booking),

  /**
   * PATCH /api/bookings/:id -- generic edit (meeting_type, owner,
   * meeting_link, duration, notes). Does NOT move meeting_date/time or
   * status -- use reschedule/updateStatus for those. Wrapped in { booking }.
   */
  update: (id: string, input: BookingUpdateInput) =>
    apiClient.patch<{ booking: Booking }>(`/bookings/${id}`, input).then((r) => r.booking),

  /** PATCH /api/bookings/:id/status -- wrapped in { booking }. */
  updateStatus: (id: string, status: string) =>
    apiClient.patch<{ booking: Booking }>(`/bookings/${id}/status`, { status }).then((r) => r.booking),

  /**
   * POST /api/bookings/:id/reschedule -- creates a NEW booking, marks the
   * original as 'Rescheduled', and links it via rescheduled_from. Returns
   * the NEW booking, wrapped in { booking }.
   */
  reschedule: (id: string, input: RescheduleInput) =>
    apiClient.post<{ booking: Booking }>(`/bookings/${id}/reschedule`, input).then((r) => r.booking),
};