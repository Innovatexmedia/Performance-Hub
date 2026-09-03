/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Public Booking Controller
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomPublicBooking.controller.js
 *
 * Real, public (unauthenticated) endpoints that power the customer-facing
 * booking widget: list a connected tenant's real Cal.com event types,
 * list real available slots for one, and create a real booking on
 * Cal.com directly from the widget. Mounted SEPARATELY from
 * booking.routes.js and BEFORE it in app.js -- same precedent as
 * calcomWebhook.routes.js (Cal.com's server calling in) and Shopify's
 * OAuth/webhook routes: a customer picking a slot has no InnovateX
 * session, so this cannot sit behind the normal `authenticate` chain.
 *
 * No mock/hardcoded data anywhere in this file -- every response comes
 * from a real Cal.com API call via calcomSettingsService, using the
 * tenant's own real, connected API key. If the tenant isn't connected,
 * this returns a real 404 rather than fabricating a fallback list.
 * =============================================================================
 */

import { calcomSettingsService } from './calcomSettings.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * getWorkspace -- GET /api/public/calcom/:tenantId/workspace
 * Non-sensitive branding for the public booking page header (name, logo,
 * brand color) + whether booking is actually available right now.
 */
export const getWorkspace = asyncHandler(async (req, res) => {
  const workspace = await calcomSettingsService.getPublicWorkspaceInfo(req.params.tenantId);
  return sendSuccess(res, { workspace }, 'Workspace info fetched successfully');
});

/**
 * getEventTypes -- GET /api/public/calcom/:tenantId/event-types
 */
export const getEventTypes = asyncHandler(async (req, res) => {
  const eventTypes = await calcomSettingsService.listPublicEventTypes(req.params.tenantId);
  return sendSuccess(res, { eventTypes }, 'Event types fetched successfully');
});

/**
 * getSlots -- GET /api/public/calcom/:tenantId/slots?eventTypeId=&start=&end=&timeZone=
 * start/end are date-only (YYYY-MM-DD), matching Cal.com's real /v2/slots contract.
 */
export const getSlots = asyncHandler(async (req, res) => {
  const slots = await calcomSettingsService.listPublicSlots(req.params.tenantId, {
    eventTypeId: req.query.eventTypeId,
    start:       req.query.start,
    end:         req.query.end,
    timeZone:    req.query.timeZone,
  });
  return sendSuccess(res, { slots }, 'Available slots fetched successfully');
});

/**
 * createBooking -- POST /api/public/calcom/:tenantId/book
 * Body: { eventTypeId, start, name, email, timeZone }
 * Creates the booking for real on Cal.com, then immediately syncs it
 * into InnovateX (lead/deal/timeline/notification/tracking-event chain
 * all fire via the same real applyCalcomBooking()/createBooking() path
 * a webhook-driven sync uses).
 */
export const createBooking = asyncHandler(async (req, res) => {
  const booking = await calcomSettingsService.createPublicBooking(req.params.tenantId, {
    eventTypeId: req.body.eventTypeId,
    start:       req.body.start,
    name:        req.body.name,
    email:       req.body.email,
    timeZone:    req.body.timeZone,
  });
  return sendSuccess(res, { booking }, 'Booking confirmed');
});
