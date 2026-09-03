import { apiClient } from '@/lib/apiClient';
import type { PublicWorkspaceInfo, PublicEventType, PublicSlotsResult, PublicBookingInput, PublicBookingResult } from '@/types/publicBooking';

/**
 * SOURCE: src/modules/bookings/calcomPublicBooking.controller.js
 * These hit a genuinely public (unauthenticated) backend surface -- no
 * token is required or sent (apiClient simply omits the Authorization
 * header when the visitor has no session), matching the real, connected
 * tenant's own Cal.com data. No mock/hardcoded fallback anywhere here.
 */
export const publicCalcomApi = {
  /** GET /api/public/calcom/:tenantId/workspace -- wrapped in { workspace }. */
  getWorkspace: (tenantId: string) =>
    apiClient.get<{ workspace: PublicWorkspaceInfo }>(`/public/calcom/${tenantId}/workspace`).then((r) => r.workspace),

  /** GET /api/public/calcom/:tenantId/event-types -- wrapped in { eventTypes }. */
  listEventTypes: (tenantId: string) =>
    apiClient.get<{ eventTypes: PublicEventType[] }>(`/public/calcom/${tenantId}/event-types`).then((r) => r.eventTypes),

  /** GET /api/public/calcom/:tenantId/slots?eventTypeId=&start=&end=&timeZone= */
  listSlots: (tenantId: string, params: { eventTypeId: number; start: string; end: string; timeZone: string }) =>
    apiClient.get<PublicSlotsResult>(`/public/calcom/${tenantId}/slots`, params as unknown as Record<string, string | number>).then((r) => r.slots),

  /** POST /api/public/calcom/:tenantId/book -- wrapped in { booking }. */
  book: (tenantId: string, input: PublicBookingInput) =>
    apiClient.post<{ booking: PublicBookingResult }>(`/public/calcom/${tenantId}/book`, input).then((r) => r.booking),
};
