/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Public Booking Routes
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomPublicBooking.routes.js
 *
 * Mounted at app.use('/api/public/calcom', ...) -- BEFORE booking.routes.js
 * and outside its `authenticate` chain, same real precedent as
 * calcomWebhook.routes.js. The read-only lookups (workspace,
 * event-types, slots) rely on the general '/api'-wide rate limit
 * already applied in app.js -- the actual write (POST .../book) has its
 * own tighter, dedicated limit layered on top (see
 * publicBookingRateLimit in rateLimit.middleware.js for why: this is
 * the one route here that creates real downstream state -- a Cal.com
 * booking, a Lead status change, a Deal -- from a fully unauthenticated
 * caller).
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './calcomPublicBooking.controller.js';
import { validateGetSlots, validateCreateBooking, validateTenantParam } from './calcomPublicBooking.validator.js';
import { publicBookingRateLimit } from '../../shared/middlewares/rateLimit.middleware.js';

const router = Router();

router.get('/:tenantId/workspace',   validateTenantParam, controller.getWorkspace);
router.get('/:tenantId/event-types', validateTenantParam, controller.getEventTypes);
router.get('/:tenantId/slots',       validateGetSlots,    controller.getSlots);
// Tighter, dedicated limit on the actual write (see publicBookingRateLimit's
// own comment) -- layered on TOP OF, not instead of, the general '/api'
// floor already applied in app.js.
router.post('/:tenantId/book',       publicBookingRateLimit, validateCreateBooking, controller.createBooking);

export default router;