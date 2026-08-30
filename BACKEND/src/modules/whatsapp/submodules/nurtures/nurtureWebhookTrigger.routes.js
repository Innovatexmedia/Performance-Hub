/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Incoming Webhook Routes
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureWebhookTrigger.routes.js
 *
 * Mounted SEPARATELY and BEFORE the main /api/whatsapp router -- same
 * real precedent as Cal.com's and Shopify's webhooks. This is an
 * external system calling in, not an authenticated user, so it cannot
 * sit behind this app's normal `authenticate` middleware.
 * =============================================================================
 */

import { Router } from 'express';
import { nurtureWebhookTriggerController } from './nurtureWebhookTrigger.controller.js';
import { nurtureWebhookRateLimit } from '../../../../shared/middlewares/rateLimit.middleware.js';

const router = Router();

router.post('/:sequenceId/:token', nurtureWebhookRateLimit, nurtureWebhookTriggerController.trigger);

export default router;