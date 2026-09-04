/**
 * FILE: src/modules/plans/cashfreeWebhook.routes.js
 * Mounted SEPARATELY from plan.routes.js and BEFORE the authenticated
 * routes in app.js -- same precedent as calcomWebhook.routes.js and
 * shopifyWebhook.routes.js.
 *
 * NOTE: the previous razorpayWebhook.routes.js existed but was never
 * actually mounted in app.js -- the endpoint didn't exist in the running
 * app at all. Fixed here; see app.js's '/api/webhooks/cashfree' mount.
 */

import { Router } from 'express';
import { handleWebhook } from './cashfreeWebhook.controller.js';

const router = Router();

router.post('/', handleWebhook);

export default router;