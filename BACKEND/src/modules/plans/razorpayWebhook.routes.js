/**
 * FILE: src/modules/plans/razorpayWebhook.routes.js
 * Mounted SEPARATELY from plan.routes.js and BEFORE the authenticated
 * routes in app.js -- same precedent as calcomWebhook.routes.js and
 * metaWebhook.routes.js.
 */

import { Router } from 'express';
import { handleWebhook } from './razorpayWebhook.controller.js';

const router = Router();

router.post('/', handleWebhook);

export default router;