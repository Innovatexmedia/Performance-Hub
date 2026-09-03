

export type BookingStatus = 'Scheduled' | 'Completed' | 'No Show' | 'Cancelled' | 'Rescheduled';

export const BOOKING_STATUS_VALUES: BookingStatus[] = ['Scheduled', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'];

export const SELECTABLE_STATUS_VALUES: BookingStatus[] = ['Scheduled', 'Completed', 'No Show', 'Cancelled'];

export type MeetingType =
  | 'Discovery Call' | 'Proposal Review' | 'Strategy Call' | 'Demo'
  | 'Follow Up' | 'Onboarding Call' | 'Closing Call';

export const MEETING_TYPE_VALUES: MeetingType[] = [
  'Discovery Call', 'Proposal Review', 'Strategy Call', 'Demo', 'Follow Up', 'Onboarding Call', 'Closing Call',
];

/** Populated subset of Lead embedded on every booking read. */
export interface BookingLeadRef {
  _id: string;
  name: string;
  email: string;
  source: string;
}

/** Populated subset of Deal embedded on every booking read. */
export interface BookingDealRef {
  _id: string;
  stage: string;
  value: number;
}

export interface Booking {
  _id: string;
  tenant_id: string;
  lead_id: BookingLeadRef;
  deal_id: BookingDealRef | null;
  assigned_user_id: string | null;
  meeting_type: MeetingType;
  status: BookingStatus;
  meeting_date: string;
  meeting_time: string;
  duration_minutes: number;
  meeting_link: string | null;
  source: string | null;
  campaign: string | null;
  notes: string;
  rescheduled_from: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** POST body -- lead_id and assigned_user_id are REQUIRED (validator enforces both). */
export interface BookingInput {
  lead_id: string;
  assigned_user_id: string;
  meeting_date: string;
  meeting_time: string;
  meeting_type?: MeetingType;
  duration_minutes?: number;
  meeting_link?: string;
  notes?: string;
  source?: string;
  campaign?: string;
}

/** PATCH /api/bookings/:id body -- everything optional, at least one required. */
export interface BookingUpdateInput {
  meeting_type?: MeetingType;
  assigned_user_id?: string;
  meeting_link?: string;
  duration_minutes?: number;
  notes?: string;
}

export interface RescheduleInput {
  meeting_date: string;
  meeting_time: string;
  notes?: string;
}

export interface BookingListQuery {
  status?: BookingStatus;
  assigned_user_id?: string;
  meeting_type?: MeetingType;
  source?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

/** GET /api/bookings/kpis -- SOURCE: booking.repository.js getKpiCounts. */
export interface BookingKpis {
  total: number;
  upcoming: number;
  completed: number;
  noShows: number;
  cancelled: number;
  rescheduled: number;
}