/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Webhook Routes
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomWebhook.routes.js
 *
 * Mounted SEPARATELY from booking.routes.js and BEFORE it in app.js --
 * same real precedent already established for the Google Ads OAuth
 * callback and WhatsApp's own webhooks. This is Cal.com's own server
 * calling in, not an authenticated user, so it cannot sit behind this
 * app's normal `authenticate` middleware.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './calcomWebhook.controller.js';

const router = Router();

router.post('/:tenantId', controller.handleWebhook);

export default router;