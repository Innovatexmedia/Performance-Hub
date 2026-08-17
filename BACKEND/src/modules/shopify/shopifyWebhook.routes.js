/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Webhook Routes
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifyWebhook.routes.js
 *
 * Mounted SEPARATELY and BEFORE any authenticated router -- same real
 * precedent as the Google Ads OAuth callback and Cal.com's webhook.
 * Route shape matches exactly what shopifySettings.service.js registers
 * with Shopify as each topic's callbackUrl.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './shopifyWebhook.controller.js';

const router = Router();

router.post('/:tenantId/:topicPath', controller.handleWebhook);

export default router;