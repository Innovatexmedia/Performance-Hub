/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Public Booking Routes
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomPublicBooking.routes.js
 *
 * Mounted at app.use('/api/public/calcom', ...) -- BEFORE booking.routes.js
 * and outside its `authenticate` chain, same real precedent as
 * calcomWebhook.routes.js. Covered by the same generalApiRateLimit
 * already applied to the whole '/api' prefix in app.js -- no separate
 * limiter needed.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './calcomPublicBooking.controller.js';
import { validateGetSlots, validateCreateBooking, validateTenantParam } from './calcomPublicBooking.validator.js';

const router = Router();

router.get('/:tenantId/workspace',   validateTenantParam, controller.getWorkspace);
router.get('/:tenantId/event-types', validateTenantParam, controller.getEventTypes);
router.get('/:tenantId/slots',       validateGetSlots,    controller.getSlots);
router.post('/:tenantId/book',       validateCreateBooking, controller.createBooking);

export default router;
