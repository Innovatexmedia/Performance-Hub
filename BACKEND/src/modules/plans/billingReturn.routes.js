/**
 * FILE: src/modules/plans/billingReturn.routes.js
 * Mounted PUBLICLY (no authenticate/resolveTenant) and BEFORE the
 * authenticated routes in app.js -- same precedent as
 * cashfreeWebhook.routes.js and calcomWebhook.routes.js.
 *
 * Accepts BOTH methods deliberately: Cashfree's return_url redirect has
 * been confirmed (in practice) to arrive as an HTML form POST, but this
 * also covers a plain GET in case that ever differs by payment method
 * (UPI vs bank vs card) or API behavior change.
 */

import { Router } from 'express';
import { handleReturn } from './billingReturn.controller.js';

const router = Router();

router.get('/', handleReturn);
router.post('/', handleReturn);

export default router;