/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Webhook Routes
 * =============================================================================
 * FILE: src/modules/email/sendgridWebhook.routes.js
 *
 * Public (no authenticate/resolveTenant) -- SendGrid can't carry our
 * session, same as every other real inbound webhook in this app
 * (Shopify/Cal.com/Meta/Cashfree). Real authenticity comes from the
 * signature verification inside the controller, not from route auth.
 * =============================================================================
 */

import { Router } from 'express';
import { handleEvents } from './sendgridWebhook.controller.js';

const router = Router();

router.post('/webhook', handleEvents);

export default router;