/** Non-sensitive public workspace/branding info -- GET /api/public/calcom/:tenantId/workspace */
export interface PublicWorkspaceInfo {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  bookingAvailable: boolean;
}

/** Real Cal.com event type -- from GET /api/public/calcom/:tenantId/event-types */
export interface PublicEventType {
  id: number;
  title: string;
  slug: string;
  description: string;
  lengthInMinutes: number;
}

/** GET /api/public/calcom/:tenantId/slots response -- flat sorted ISO datetime strings. */
export interface PublicSlotsResult {
  slots: string[];
}

/** POST /api/public/calcom/:tenantId/book body. */
export interface PublicBookingInput {
  eventTypeId: number;
  start: string; // ISO 8601
  name: string;
  email: string;
  timeZone: string;
}

/** Real Cal.com booking object returned by POST /v2/bookings, passed through. */
export interface PublicBookingResult {
  uid: string;
  title: string;
  start: string;
  end: string;
  status: string;
}
